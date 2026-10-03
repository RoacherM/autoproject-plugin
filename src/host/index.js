/**
 * Host half of autoproject v2: the reviewed improvement ratchet (engine.js) plus the chat-facing
 * tools. The chat agent is the planner — it drafts Brief, Rubric and Limits with the user and
 * shows the model recommendation `autoproject_models` computes from the live providers — and
 * `autoproject_start` itself asks the user to confirm before anything runs.
 * Only `ctx` services are used at runtime — no @deepseek-ai imports.
 */
import { randomUUID } from 'node:crypto';
import { CODE_VERSION, createEngine, RunError, STUCK_AFTER, tally } from './engine.js';
import { describeRecommendation, modelLabel, recommend, resolveModel } from './models.js';
import { createRoleRunner } from './roles.js';
import { registerRoutes } from './routes.js';
import { createStore, defaultDataDir } from './store.js';

export const name = 'dsh-autoproject';
export const inject = ['tools', 'agents', 'agentPresets', 'workspaceRegistry', 'agentDefaultModel', 'userQuestions', 'connection'];

const OUTPUT = {
  schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
  render: (_args, value) => [{ type: 'text', text: value.text }],
};

const clip = (text, max = 160) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max)}…` : s; };

export function describeRun(run, { verbose = false } = {}) {
  const t = tally(run);
  const head = [
    `autoproject ${run.slug} — ${run.status}${run.stopReason ? ` (${run.stopReason})` : ''}${run.pauseReason ? ` (${run.pauseReason})` : ''}`,
    `repo ${run.repo} · branch ${run.branch} · iterations ${t.iterations}/${run.limits.maxIterations} · streak ${run.streak}/${run.limits.streakLimit} · landed ${t.merged} · advice ${t.advice}`,
    `maker ${modelLabel(run.models.maker)} · reviewer ${modelLabel(run.models.reviewer)} · advisor ${modelLabel(run.models.advisor)}${run.checkCommand ? ` · checks \`${run.checkCommand}\`` : ''}`,
  ];
  if (run.current) head.push(`now: iteration ${run.current.n}, ${run.current.phase}`);
  const rows = run.iterations.map((it) => `| ${it.n} | ${it.outcome} | ${it.landing ?? ''} | ${it.sha ? it.sha.slice(0, 8) : ''} | ${clip(it.reason, verbose ? 300 : 120)} |`);
  const table = rows.length ? ['', '| # | outcome | landing | sha | reason |', '|---|---|---|---|---|', ...rows] : [];
  const adviceLines = (it) => (it.advice ?? []).map((a) => `advisor · ${a.point} · ${a.error ?? `${a.verdict}: ${clip(a.advice, 300)}`} (session ${a.sessionId})`);
  const details = verbose ? run.iterations.map((it) => [
    `\n### ${it.n} · ${it.outcome}${it.verdict ? ` · ${it.verdict} · success ${it.success}` : ''}`,
    ...(it.plan ? [`plan: ${clip(it.plan, 300)}`] : []),
    ...adviceLines(it),
    ...(it.rationale ? [clip(it.rationale, 600), `learnings: ${clip(it.learnings, 300)}`] : []),
    `sessions: maker ${it.makerSession ?? '-'}, reviewer ${it.reviewerSession ?? '-'}`,
  ].join('\n')) : [];
  return [...head, ...table, ...details].join('\n');
}

function notifyText(run) {
  const verb = run.status === 'stopped' ? 'stopped' : 'paused';
  return `[autoproject] Run ${run.slug} ${verb}. Tell the user briefly what happened, from this report (do not start a new run):\n\n${describeRun(run)}\n\nCandidates are kept as refs/autoproject/${run.slug}/<n> in the repository; the maker, advisor and reviewer sessions are subagent children of this chat (not in the sidebar); autoproject_status with verbose lists the advice and the session ids.`;
}

/** The command as the user reads it: an absolute path to the executable shortened to its name. */
const shortCommand = (cmd) => cmd.trim().replace(/^\S*\//, '');

/** The Go dialog: a compact summary that fits above the buttons. The full Brief and Rubric were shown in chat. */
export function confirmation(args, repo, models) {
  const rows = [
    ['Repo', `${repo}${args.branch ? ` · ${args.branch}` : ''}`],
    ['Limits', `up to ${args.max_iterations ?? 5} iterations · stop after ${args.streak_limit ?? 3} failures in a row`],
    ['Success', args.success?.trim() ? clip(args.success, 120) : 'none'],
    ['Checks', args.check_command ? `\`${shortCommand(args.check_command)}\`` : 'none'],
    ['Protected', (args.protected_paths ?? []).map((p) => `\`${p}\``).join(' ') || 'none'],
    ['Maker', modelLabel(models.maker)],
    ['Reviewer', modelLabel(models.reviewer)],
    ['Advisor', `${modelLabel(models.advisor)} · plan (iteration 1 and after ${STUCK_AFTER} failures in a row), stuck, before done`],
    ['Brief', clip(args.brief, 140)],
    ['Rubric', clip(args.rubric, 140)],
  ];
  return {
    question: `Start autoproject "${args.slug}"?`,
    detail: `${rows.map(([k, v]) => `- **${k}**: ${v}`).join('\n')}\n\nRuns unattended; BETTER candidates are fast-forwarded onto the branch.`,
    options: [{ label: 'Go (Recommended)', description: 'Start now; say stop at any time.' }, { label: 'Not yet', description: 'Change the plan first.' }],
  };
}

export function apply(ctx, config = {}) {
  const log = (message) => ctx.logger?.warn?.(message);
  const store = createStore({ dir: config.dataDir ?? defaultDataDir() });
  const engine = createEngine({
    store, log,
    startRole: config.startRole ?? createRoleRunner(ctx),
    notify: (run) => {
      const agent = run.originSessionId ? ctx.agents.get(run.originSessionId) : undefined;
      if (!agent?.followup) return;
      try {
        agent.followup(Object.freeze({ role: 'user', id: randomUUID(), content: Object.freeze([Object.freeze({ type: 'text', text: notifyText(run) })]), source: Object.freeze({ kind: 'user' }) }));
      } catch (error) { log(`autoproject: notify failed: ${error.message}`); }
    },
  });
  ctx.effect(() => () => { engine.shutdown(); }, 'dsh-autoproject: engine');
  engine.recover().catch((error) => log(`autoproject: startup failed: ${error.message}`));

  const register = (definition) => ctx.effect(() => ctx.tools.register({ output: OUTPUT, ...definition }), `dsh-autoproject: ${definition.name}`);
  const fail = (error) => { if (error instanceof RunError) return { text: `Error: ${error.message}` }; throw error; };

  /** The live recommendation, with any role the user named replaced by their pick. */
  async function pickModels(args) {
    const rec = await recommend(ctx);
    const named = { maker: args.maker_model, reviewer: args.reviewer_model, advisor: args.advisor_model };
    const models = {};
    for (const [role, input] of Object.entries(named)) models[role] = input?.trim() ? await resolveModel(ctx, input, role) : rec[role];
    return models;
  }

  register({
    name: 'autoproject_models',
    description: 'List the models DSH has right now, every provider, best first, with the recommended model and effort for each autoproject role (maker, reviewer, advisor). Computed fresh on every call. Call it before drafting a run and show the user the recommendation.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    isConcurrencySafe: () => true,
    async execute() {
      try { return { text: describeRecommendation(await recommend(ctx)) }; } catch (error) { return { text: `Error: ${error.message}` }; }
    },
  });

  register({
    name: 'autoproject_start',
    description: [
      'Start an autoproject run: an unattended, independently reviewed improvement ratchet on a local git repository, with three roles. Each iteration a fresh maker agent (a cheaper capable model) works in a fresh worktree; an advisor (the strongest model, read-only) is on call at three points decided by the harness: it reviews the maker\'s plan before any edit (first iteration, and after repeated failures), names a new direction when failures repeat, and reads the diff before the candidate is handed in (one revision if it objects). The harness commits, runs the checks (one repair round) and rejects changes to protected paths; a fresh reviewer agent then judges exactly that commit against a rubric neither the maker nor the advisor sees, and only a BETTER verdict is fast-forwarded onto the branch. It stops at the iteration limit, the failure-streak limit, a met success criterion, or when the user says stop.',
      'Before calling: (1) call autoproject_models and show the user its recommendation; (2) draft with the user the Brief — goal, scope, constraints, the checks to run and repo context, with NO evaluation criteria; the Rubric — the independent goal, what counts as BETTER, the evidence the reviewer must gather, and complexity cost; and the Limits. Take a quick look at the repo first; ask only about real gaps, one question at a time. Show the user the full Brief, Rubric, Limits and models in chat, then call this tool: it shows a short summary with a Go button and starts only after they choose Go.',
      'Only for local repositories whose main checkout is clean and on the target branch. One run per repository.',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false, required: ['slug', 'brief', 'rubric'],
      properties: {
        slug: { type: 'string', description: 'Short lowercase-hyphen name for this run, e.g. "speed-up-parser".' },
        repo: { type: 'string', description: 'Absolute path of the repository. Default: this session\'s working directory.' },
        branch: { type: 'string', description: 'Branch candidates land on. Default: the branch the main checkout is on.' },
        brief: { type: 'string', description: 'What the maker is told. Never evaluation criteria.' },
        rubric: { type: 'string', description: 'What the reviewer judges by. The maker never sees it.' },
        success: { type: 'string', description: 'Optional success criterion; the run stops once a landed candidate meets it.' },
        check_command: { type: 'string', description: 'Shell command the harness runs in the candidate\'s worktree, e.g. "npm test". Must be self-contained (dependencies installed inside the repo).' },
        protected_paths: { type: 'array', items: { type: 'string' }, description: 'Globs the maker may not change, e.g. ["test/", "**/*.test.js", ".github/"]. A candidate touching them is rejected.' },
        max_iterations: { type: 'integer', description: 'Default 5.' },
        streak_limit: { type: 'integer', description: 'Consecutive NOT_BETTER iterations before stopping. Default 3.' },
        maker_model: { type: 'string', description: 'Only when the user picks another than the recommendation: "provider/model", a model id or a display name, optionally "@effort". Default: the live recommendation (autoproject_models).' },
        reviewer_model: { type: 'string', description: 'Same form. A different model from the maker\'s reduces shared blind spots. Default: the live recommendation.' },
        advisor_model: { type: 'string', description: 'Same form. Default: the live recommendation.' },
      },
    },
    async execute(args, exec) {
      try {
        const repo = args.repo || exec?.agent?.session?.header?.cwd;
        if (!repo) throw new RunError('no repository: pass repo');
        const models = await pickModels(args).catch((error) => { throw new RunError(error.message); });
        const answer = await ctx.userQuestions.ask({
          agent: exec?.agent, signal: exec?.signal,
          questions: [{ id: 'go', header: 'autoproject', ...confirmation(args, repo, models) }],
        });
        const picked = answer.answers?.[0];
        if (!picked?.selected?.[0]?.startsWith('Go')) return { text: `Not started. The user said: ${picked?.custom || picked?.selected?.[0] || 'no'}` };
        const run = await engine.start({
          slug: args.slug, repo, branch: args.branch, brief: args.brief, rubric: args.rubric, success: args.success,
          checkCommand: args.check_command, protectedPaths: args.protected_paths, maxIterations: args.max_iterations,
          streakLimit: args.streak_limit, models, originSessionId: exec?.agent?.id,
        });
        return { text: `Started.\n${describeRun(run)}\n\nIt runs in the background; you will get a message here when it stops. Use autoproject_status to check on it and autoproject_control to steer, pause or stop.` };
      } catch (error) { return fail(error); }
    },
  });

  register({
    name: 'autoproject_status',
    description: 'Show autoproject runs: status, limits, and one row per iteration (outcome, landing, candidate SHA, reason). With slug and verbose, also each verdict\'s rationale and learnings and the session ids.',
    parameters: { type: 'object', additionalProperties: false, properties: { slug: { type: 'string' }, verbose: { type: 'boolean' } } },
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.slug) {
        const run = await engine.get(args.slug);
        return { text: run ? describeRun(run, { verbose: args.verbose }) : `No run named ${args.slug}.` };
      }
      const runs = await engine.list();
      return { text: `${runs.length ? runs.map((r) => describeRun(r)).join('\n\n---\n\n') : 'No autoproject runs yet.'}\n\n(plugin code ${CODE_VERSION})` };
    },
  });

  register({
    name: 'autoproject_control',
    description: 'Steer, pause, resume or stop an autoproject run. steer queues the text as user guidance for the next maker (never the reviewer). pause finishes the current iteration first; stop cancels it (a landing already underway completes).',
    parameters: {
      type: 'object', additionalProperties: false, required: ['slug', 'action'],
      properties: {
        slug: { type: 'string' },
        action: { type: 'string', enum: ['steer', 'pause', 'resume', 'stop'] },
        text: { type: 'string', description: 'steer: the guidance, in the user\'s words.' },
      },
    },
    async execute(args) {
      try {
        if (args.action === 'steer' && !args.text?.trim()) throw new RunError('steer needs text');
        const run = await engine.control(args.slug, args.action, args.text?.trim());
        return { text: `${args.action}: ok.\n${describeRun(run)}` };
      } catch (error) { return fail(error); }
    },
  });

  registerRoutes(ctx, { engine });
  config.onEngine?.(engine);
}
