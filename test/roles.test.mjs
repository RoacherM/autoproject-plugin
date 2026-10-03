import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRoleRunner, subagentCatalogEntry, subagentDescriptor } from '../src/host/roles.js';

/** A fake Host with just what createRoleRunner touches; sessions record appended events. */
function fakeHost({ parentLive = true } = {}) {
  const sessions = new Map();
  const session = (id, header) => {
    const events = [];
    const s = { header: { id, createdAt: 1790000000000, ...header }, events, append: (type, data) => events.push({ type, data }), snapshotEvents: () => events, deriveMessages: () => [] };
    sessions.set(id, s);
    return s;
  };
  const parent = session('chat-1', { delegationDepth: 0 });
  const noop = () => () => {};
  const ctx = {
    agentPresets: {
      resolve: async () => ({ id: 'cordis' }),
      acquireScope: async () => ({ [Symbol.asyncDispose]: async () => {} }),
      mount: async () => {},
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    tools: { schemas: () => [] },
    agents: {
      get: (id) => (id === 'chat-1' && parentLive ? { id, session: parent } : undefined),
      create: async ({ sessionId, meta, setup }) => {
        const child = session(sessionId, meta);
        const agent = { id: sessionId, session: child, followup() {}, whenIdle: async () => {}, cancel() {} };
        const agentCtx = { tools: { restrict: noop, guard: (fn) => { child.guard = fn; }, register: noop }, systemPrompt: { section: noop, getSectionOrder: () => 0 } };
        await setup(agentCtx, agent);
        return { agent, dispose: async () => {} };
      },
    },
    get: () => undefined,
  };
  return { ctx, parent, sessions };
}

const SUBMIT = { name: 'submit_x', description: 'd', parameters: { type: 'object', properties: {} } };
const OTHER = { name: 'submit_y', description: 'd', parameters: { type: 'object', properties: {} } };
const MODEL = { provider: 'p', model: 'm', reasoningEffort: 'medium' };

// Mirrors the strict shapes DSH validates (`@deepseek-ai/dsh-subagent` catalog schema, session-format descriptor check).
function assertDescriptor(data) {
  assert.deepEqual(Object.keys(data).sort(), ['label', 'mode', 'provider', 'version']);
  assert.equal(data.version, 3);
  assert.equal(data.mode, 'one-shot');
  assert.ok(typeof data.provider === 'string' && data.provider.trim() !== '');
}
function assertCatalog(data, childId) {
  assert.deepEqual(Object.keys(data).sort(), ['childCreatedAt', 'childId', 'label', 'mode', 'version']);
  assert.equal(data.version, 0);
  assert.equal(data.childId, childId);
  assert.ok(Number.isSafeInteger(data.childCreatedAt) && data.childCreatedAt >= 0);
  assert.equal(data.mode, 'one-shot');
}

test('a role under a chat records a one-shot subagent descriptor and is listed in the chat catalog', async () => {
  const { ctx, parent, sessions } = fakeHost();
  const cwd = await mkdtemp(join(tmpdir(), 'apk-roles-'));
  const role = await createRoleRunner(ctx)({ cwd, title: 'autoproject x · maker 1', submits: [SUBMIT], model: MODEL, parentSession: 'chat-1' });
  const child = sessions.get(role.sessionId);
  assert.equal(child.header.origin, 'subagent');
  assert.equal(child.header.parentSession, 'chat-1');
  const descriptors = child.events.filter((e) => e.type === 'subagent/descriptor');
  assert.equal(descriptors.length, 1);
  assertDescriptor(descriptors[0].data);
  assert.equal(child.events[0].type, 'subagent/descriptor', 'descriptor precedes the first turn');
  const catalog = parent.events.filter((e) => e.type === 'subagent/catalog');
  assert.equal(catalog.length, 1);
  assertCatalog(catalog[0].data, role.sessionId);
  assert.equal(catalog[0].data.childCreatedAt, child.header.createdAt);
  assert.equal(role.addressable, true);
  assert.equal(role.catalogued, true);
});

test('without a live parent the role is still addressable but not catalogued; without a parent it is neither', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'apk-roles-'));
  let host = fakeHost({ parentLive: false });
  let role = await createRoleRunner(host.ctx)({ cwd, title: 't', submits: [SUBMIT], model: MODEL, parentSession: 'chat-1' });
  assert.equal(role.addressable, true);
  assert.equal(role.catalogued, false);
  assert.equal(host.sessions.get(role.sessionId).events.filter((e) => e.type === 'subagent/descriptor').length, 1);

  host = fakeHost();
  role = await createRoleRunner(host.ctx)({ cwd, title: 't', submits: [SUBMIT], model: MODEL });
  assert.equal(role.addressable, false);
  assert.equal(host.sessions.get(role.sessionId).events.some((e) => e.type === 'subagent/descriptor'), false);
  assert.equal(host.parent.events.length, 0);
});

test('payload builders omit an empty label', () => {
  assert.deepEqual(subagentDescriptor(''), { version: 3, mode: 'one-shot', provider: 'autoproject' });
  assert.deepEqual(subagentCatalogEntry('c', 5), { version: 0, childId: 'c', childCreatedAt: 5, mode: 'one-shot' });
});

test('each turn sets its sandbox mode and its submit tool; a read-only turn refuses write and edit', async () => {
  const { ctx, sessions } = fakeHost();
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'apk-roles-')));
  const role = await createRoleRunner(ctx)({ cwd, title: 't', submits: [SUBMIT, OTHER], model: MODEL, parentSession: 'chat-1' });
  const child = sessions.get(role.sessionId);
  const modes = () => child.events.filter((e) => e.type === 'sandbox/mode').map((e) => e.data.mode);

  await role.turn('plan', { submit: 'submit_x', mode: 'read-only' });
  assert.deepEqual(modes(), ['read-only']);
  assert.match(child.guard({ name: 'write', arguments: { file_path: join(cwd, 'a') } }), /read-only/);
  assert.match(child.guard({ name: 'edit', arguments: { file_path: join(cwd, 'a') } }), /read-only/);
  assert.match(child.guard({ name: 'submit_y', arguments: {} }), /not for this step; finish it with `submit_x`/);
  assert.equal(child.guard({ name: 'read', arguments: { file_path: join(cwd, 'a') } }), undefined);

  await role.turn('build', { submit: 'submit_y', mode: 'workspace-write' });
  await role.turn('again', { submit: 'submit_y', mode: 'workspace-write' });
  assert.deepEqual(modes(), ['read-only', 'workspace-write'], 'a mode is appended only when it changes');
  assert.equal(child.guard({ name: 'write', arguments: { file_path: join(cwd, 'a') } }), undefined);
  assert.match(child.guard({ name: 'write', arguments: { file_path: '/etc/x' } }), /only touch files inside your worktree/);
  await assert.rejects(role.turn('x', { submit: 'submit_z', mode: 'read-only' }), /unknown submit tool/);
});
