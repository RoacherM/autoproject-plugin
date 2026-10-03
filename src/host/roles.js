/**
 * One maker, advisor or reviewer: a Session created the way DSH's in-process subagents create theirs. Its
 * header marks it a subagent child of the chat that started the run (`origin: 'subagent'`,
 * `parentSession`), so the sidebar hides it and counts it under that chat instead of listing a
 * workspace per worktree. The plugin, not the parent agent, owns its lifetime. Scoped to this one
 * agent only:
 *   - sandbox rooted at the worktree, set per turn: `read-only` (a maker planning, every advisor) or
 *     `workspace-write`; approval `never` (unattended: an out-of-bounds action fails instead of
 *     waiting for a human);
 *   - tools that would hang, escape or leak removed (questions, delegation, schedulers, connectors…);
 *   - file tools refused outside the worktree, and `write`/`edit` refused in a read-only turn;
 *   - its submit tools, one per kind of result; each turn names the one it expects, whose
 *     JSON-Schema-checked arguments are the turn's result. Calling it ends the turn.
 * bash can still *read* anywhere the user can; that is the known soft spot.
 */
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const DENY = [
  /^ask_user_question$/, /^exit_plan_mode$/, /^subagent/, /^send_message$/, /^interrupt_agent$/, /^list_agents$/,
  /^workflow$/, /^job_kill$/, /^scheduler_/, /^connectors_/, /^mcp__/, /^plugin_manager$/, /^present$/,
  /_goal$/, /^create_goal$/, /^canvas_/, /^browser_/, /^cordis_/, /^autoproject_/, /^schedule/, /^ralph/,
];
const denied = (name) => DENY.some((re) => re.test(name));

/** Tool name → the argument holding a path it touches. */
const PATH_ARGS = { read: 'file_path', read_image: 'file_path', write: 'file_path', edit: 'file_path', glob: 'path', grep: 'path' };

/** Tools that change files; refused while the turn is read-only. */
const WRITES = new Set(['write', 'edit']);

function outside(root, cwd, path) {
  if (typeof path !== 'string' || path === '') return false;
  const abs = isAbsolute(path) ? path : resolve(cwd, path);
  const rel = relative(root, abs);
  return rel.startsWith('..') || isAbsolute(rel);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const userMessage = (text) => deepFreeze({ role: 'user', id: randomUUID(), content: [{ type: 'text', text }], source: { kind: 'user' } });

function lastAssistantText(session) {
  try {
    const messages = session.deriveMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'assistant') continue;
      const text = messages[i].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) return text;
    }
  } catch { /* best effort */ }
  return '';
}

/** Tool calls so far and the latest one, for the board's live card. Scans the session's own log. */
export function activityOf(events) {
  let toolCalls = 0;
  let last;
  for (const e of events) {
    if (e?.type !== 'tool/call') continue;
    toolCalls++;
    last = e;
  }
  if (!last) return { toolCalls };
  const args = String(last.data?.arguments ?? '');
  let hint = '';
  try {
    const parsed = JSON.parse(args);
    hint = parsed.description ?? parsed.file_path ?? parsed.path ?? parsed.pattern ?? parsed.command ?? '';
  } catch { /* partial or non-JSON arguments */ }
  return { toolCalls, lastTool: last.data?.name, lastHint: String(hint).split('\n')[0].slice(0, 120), lastAt: last.time ? new Date(last.time).toISOString() : undefined };
}

/**
 * The durable facts DSH's own one-shot subagents record, so the Web GUI can open a role's history
 * through its parent (`kind: 'subagent'` address): the Host refuses a subagent child's history
 * without a `subagent/descriptor` in the child, and the parent's `subagent/catalog` lets the
 * client derive that address from the chat. Payloads follow `@deepseek-ai/dsh-subagent`.
 */
export const SUBAGENT_PROVIDER = 'autoproject';
export const subagentDescriptor = (label) => ({ version: 3, mode: 'one-shot', provider: SUBAGENT_PROVIDER, ...(label ? { label } : {}) });
export const subagentCatalogEntry = (childId, childCreatedAt, label) => ({
  version: 0, childId, childCreatedAt, mode: 'one-shot', ...(label ? { label } : {}),
});

function lastTurnEnd(session) {
  const events = session.snapshotEvents();
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'turn/end') return events[i].data.reason;
  return undefined;
}

/**
 * @returns startRole({ kind, cwd, title, submits: [{ name, description, parameters }], model?, parentSession? })
 *   → { sessionId, turn(text, { submit, mode }) → { value?, stop, error?, text }, activity(), cancel(), dispose() }
 */
export function createRoleRunner(ctx) {
  return async function startRole({ cwd, title, submits, model, parentSession }) {
    const preset = await ctx.agentPresets.resolve(undefined);
    const scope = await ctx.agentPresets.acquireScope(preset.id);
    const names = new Set(submits.map((s) => s.name));
    /** The current turn: which submit tool ends it, whether it may write, and what it handed in. */
    const step = { submit: undefined, mode: undefined, captured: undefined };
    let tools;
    try {
      // The sandbox's write root is the session cwd; use the canonical path so its checks agree.
      const root = await realpath(resolve(cwd));
      const parentDepth = parentSession ? ctx.agents.get(parentSession)?.session?.header?.delegationDepth ?? 0 : 0;
      const lineage = parentSession ? { parentSession, origin: 'subagent', delegationDepth: parentDepth + 1 } : {};
      const sessionId = randomUUID();
      const handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: root, agentPreset: preset.id, ...lineage },
        agentOptions: { provider: model.provider, model: model.model, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) },
        setup: async (agentCtx, agent) => {
          await ctx.agentPresets.mount(agentCtx, preset.id);
          if (parentSession) agent.session.append('subagent/descriptor', subagentDescriptor(title));
          agent.session.append('approval/policy', { policy: 'never' });

          // The agent is its own scope key: its view includes the preset's tools, the global view does not.
          const visible = (ctx.tools.schemas?.(agent) ?? []).map((s) => s.name);
          const removed = visible.filter(denied);
          tools = { visible: visible.length, denied: removed };
          if (removed.length) try { agentCtx.tools.restrict({ deny: removed }); } catch (error) { tools.error = error.message; }
          agentCtx.tools.guard((exec) => {
            if (step.captured !== undefined) return 'your result is already submitted; stop here';
            if (names.has(exec.name) && exec.name !== step.submit) return `\`${exec.name}\` is not for this step; finish it with \`${step.submit}\``;
            if (denied(exec.name)) return `\`${exec.name}\` is not available in an autoproject run`;
            if (step.mode === 'read-only' && WRITES.has(exec.name)) return 'this step is read-only: do not change any file';
            const key = PATH_ARGS[exec.name];
            if (key && outside(root, root, exec.arguments?.[key])) return `\`${exec.name}\` may only touch files inside your worktree ${root}`;
            return undefined;
          });

          for (const submit of submits) {
            agentCtx.tools.register({
              name: submit.name,
              description: submit.description,
              parameters: submit.parameters,
              output: {
                schema: { type: 'object', additionalProperties: false, required: ['recorded'], properties: { recorded: { type: 'boolean' } } },
                render: () => [{ type: 'text', text: 'Recorded. This step is done; do not call any more tools.' }],
              },
              async execute(args, exec) {
                for (const key of submit.parameters.required ?? []) {
                  const v = args?.[key];
                  if (v === undefined || (typeof v === 'string' && !v.trim())) throw new Error(`\`${key}\` is required and may not be empty`);
                }
                step.captured = { value: args };
                exec.concludeTurn();
                return { recorded: true };
              },
            });
          }
          agentCtx.systemPrompt.section({
            name: 'tool:autoproject-submit',
            order: agentCtx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
            text: 'You work unattended: nobody will answer questions. Each message names the tool that finishes that step; when the step is done you MUST call it exactly once. A plain text answer does not count.',
          });
        },
      });
      ctx.get('sessionTitle')?.rename(handle.agent.session, title);

      const agent = handle.agent;
      // List the role under the chat that started the run, as a real one-shot child is listed.
      // Without a live parent the explicit address from the board still works.
      const parent = parentSession ? ctx.agents.get(parentSession) : undefined;
      let catalogued = false;
      if (parent) {
        try {
          const createdAt = agent.session.header?.createdAt;
          parent.session.append('subagent/catalog', subagentCatalogEntry(sessionId, Number.isSafeInteger(createdAt) && createdAt >= 0 ? createdAt : Date.now(), title));
          catalogued = true;
        } catch (error) {
          ctx.logger?.warn?.(`autoproject: could not list ${sessionId} under ${parentSession}`, error);
        }
      }
      return {
        sessionId,
        // The Web GUI can open this role's history through its parent.
        addressable: Boolean(parentSession),
        catalogued,
        tools,
        async turn(text, { submit, mode }) {
          if (!names.has(submit)) throw new Error(`unknown submit tool ${submit}`);
          if (mode !== step.mode) agent.session.append('sandbox/mode', { mode });
          Object.assign(step, { submit, mode, captured: undefined });
          agent.followup(userMessage(text));
          await agent.whenIdle();
          const reason = lastTurnEnd(agent.session);
          return { value: step.captured?.value, stop: reason?.kind ?? 'unknown', error: reason?.error?.message, text: lastAssistantText(agent.session) };
        },
        activity: () => activityOf(agent.session.snapshotEvents()),
        cancel() { try { agent.cancel({ kind: 'hook', reason: 'autoproject stopped' }); } catch { /* idle */ } },
        dispose: () => handle.dispose().catch(() => {}),
      };
    } finally {
      await scope[Symbol.asyncDispose]?.();
    }
  };
}
