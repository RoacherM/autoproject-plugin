import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitingMerge, buildBoard, formatDuration, steps } from '../src/shared/board.js';

const T = (m) => new Date(Date.UTC(2026, 8, 29, 12, m)).toISOString();
const run = (over) => ({ slug: 'a', status: 'running', limits: { maxIterations: 5, streakLimit: 3 }, guidance: [], iterations: [], current: null, ...over });
const done = (n, outcome, extra = {}) => ({ n, outcome, startedAt: T(n), finishedAt: T(n + 1), timeline: [{ phase: 'setup', at: T(n) }, { phase: 'done', at: T(n + 1) }], ...extra });
const ids = (col) => col.map((c) => c.id);

test('iterations land in Vibe Kanban columns by node and outcome', () => {
  const r = run({
    iterations: [done(1, 'BETTER', { landing: 'LANDED' }), done(2, 'NOT_BETTER'), done(3, 'ABORTED')],
    current: { n: 4, phase: 'review', startedAt: T(4), timeline: [{ phase: 'setup', at: T(4) }, { phase: 'review', at: T(5) }], activity: { kind: 'reviewer', toolCalls: 3 } },
  });
  const other = run({ slug: 'b', current: { n: 1, phase: 'maker', startedAt: T(1), timeline: [{ phase: 'maker', at: T(2) }] } });
  const { columns, stats } = buildBoard([r, other]);
  assert.deepEqual(ids(columns.done), ['a#1']);
  assert.deepEqual(ids(columns.cancelled), ['a#3', 'a#2']);
  assert.deepEqual(ids(columns.inreview), ['a#4']);
  assert.deepEqual(ids(columns.inprogress), ['b#1']);
  assert.deepEqual(ids(columns.todo).sort(), ['a#next', 'b#next']);
  assert.equal(columns.todo.find((c) => c.slug === 'a').left, 1);
  assert.equal(columns.inreview[0].activity.toolCalls, 3);
  assert.equal(columns.inreview[0].phaseSince, T(5));
  assert.deepEqual({ running: stats.running, live: stats.live, landed: stats.landed }, { running: 2, live: 2, landed: 1 });
});

test('a run that is not running and has unmerged commits awaits merge; stopped runs queue nothing', () => {
  let board = buildBoard([run({ status: 'stopped', pendingCommits: 2, iterations: [done(1, 'BETTER', { landing: 'LANDED' }), done(2, 'NOT_BETTER')] })]);
  assert.equal(board.stats.attention, 1);
  assert.equal(board.stats.landed, 1);
  assert.equal(board.columns.todo.length, 0);
  assert.equal(awaitingMerge(run({ status: 'running', pendingCommits: 2 })), false);
  assert.equal(awaitingMerge(run({ status: 'paused', pendingCommits: 0 })), false);
  board = buildBoard([run({ status: 'paused', pauseReason: 'paused by user', iterations: [done(1, 'BETTER')] })]);
  assert.equal(board.columns.todo[0].paused, true);
});

test('only roles recorded as subagent children can be opened from a card', () => {
  const r = run({
    originSessionId: 'chat-1',
    iterations: [
      done(1, 'BETTER', { makerSession: 'm1', reviewerSession: 'r1' }), // older plugin: no descriptor
      done(2, 'NOT_BETTER', { makerSession: 'm2', reviewerSession: 'r2', makerAddressable: true, reviewerAddressable: true }),
    ],
  });
  const { columns } = buildBoard([r]);
  const byN = Object.fromEntries([...columns.done, ...columns.cancelled].map((c) => [c.n, c]));
  assert.deepEqual([byN[1].makerViewable, byN[1].reviewerViewable], [false, false]);
  assert.deepEqual([byN[2].makerViewable, byN[2].reviewerViewable], [true, true]);
  assert.equal(byN[2].originSessionId, 'chat-1');
});

test('filter shows one run; steps give each node its duration, the live one still open', () => {
  const board = buildBoard([run(), run({ slug: 'b' })], { filter: 'b' });
  assert.deepEqual(ids(board.columns.todo), ['b#next']);
  const s = steps({ startedAt: T(0), timeline: [{ phase: 'setup', at: T(0) }, { phase: 'maker', at: T(1) }, { phase: 'checks', at: T(4) }] }, new Date(T(5)));
  assert.deepEqual(s.map((x) => [x.phase, x.ms / 60000, x.open]), [['setup', 1, false], ['maker', 3, false], ['checks', 1, true]]);
  assert.deepEqual(steps({ startedAt: T(0), finishedAt: T(2) }).map((x) => x.phase), ['setup']);
  assert.equal(formatDuration(252_000), '4m 12s');
  assert.equal(formatDuration(3_900_000), '1h 05m');
});

test('v2 nodes: every advisor and maker step is In Progress; a card carries the plan and the advice', () => {
  for (const phase of ['advise_stuck', 'plan', 'advise_plan', 'maker', 'advise_done', 'revise']) {
    const { columns } = buildBoard([run({ current: { n: 1, phase, startedAt: T(1), timeline: [{ phase, at: T(1) }] } })]);
    assert.deepEqual(ids(columns.inprogress), ['a#1'], phase);
  }
  const advice = [{ point: 'plan', verdict: 'REVISE', advice: 'x', sessionId: 'adv-1', addressable: true }];
  const { columns } = buildBoard([run({ iterations: [done(1, 'BETTER', { plan: 'P', advice, stuck: true, revised: true })] })]);
  const card = columns.done[0];
  assert.deepEqual([card.plan, card.advice, card.stuck, card.revised], ['P', advice, true, true]);
});
