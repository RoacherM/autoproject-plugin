import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEngine, STUCK_AFTER } from '../src/host/engine.js';
import { createStore } from '../src/host/store.js';
import { globToRegExp, protectedHits } from '../src/host/checks.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ap-repo-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'score.txt'), '0\n');
  writeFileSync(join(dir, 'check.sh'), 'test "$(cat score.txt)" != "bad"\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-qm', 'init');
  return dir;
}

/**
 * Fake roles, told apart by `kind`. `script.maker(cwd, n, text, step)` edits files and returns a
 * submit value for the step's tool (`submit_plan` or `submit_candidate`); `script.advisor(cwd, text)`
 * returns advice (default PROCEED); `script.reviewer(cwd, text)` returns a verdict. Every prompt is
 * recorded with the tool and sandbox mode its turn asked for.
 */
const MODELS = { maker: { provider: 'p', model: 'sonnet', reasoningEffort: 'medium' }, reviewer: { provider: 'p', model: 'opus' }, advisor: { provider: 'p', model: 'fable' } };
const proceed = { verdict: 'PROCEED', advice: 'ADVICE-TEXT looks fine' };

function fakeRoles(script) {
  const prompts = { maker: [], reviewer: [], advisor: [] };
  const turns = [];
  let makerCount = 0;
  const startRole = async ({ kind, cwd, submits, model, parentSession }) => {
    const n = kind === 'maker' ? ++makerCount : 0;
    let cancelled = false;
    return {
      sessionId: `${kind}-${n || prompts[kind].length + 1}`,
      addressable: Boolean(parentSession),
      model,
      async turn(text, { submit, mode }) {
        assert.ok(submits.some((s) => s.name === submit), `${kind} has no ${submit}`);
        prompts[kind].push(text);
        turns.push({ kind, submit, mode, model: model.model });
        if (script.hang?.[kind]) await new Promise((r) => { const t = setInterval(() => { if (cancelled) { clearInterval(t); r(); } }, 5); });
        if (cancelled) return { stop: 'aborted', text: '' };
        const value = kind === 'maker' ? await script.maker(cwd, n, text, submit)
          : kind === 'advisor' ? await (script.advisor ?? (() => proceed))(cwd, text)
            : await script.reviewer(cwd, text);
        return { value, stop: 'completed', text: '' };
      },
      // Each kind reports a fixed, distinct size so sums are checkable: maker 100+10, advisor 20+2, reviewer 50+5 per session.
      usage: () => ({ maker: { calls: 1, inputTokens: 100, outputTokens: 10 }, advisor: { calls: 1, inputTokens: 20, outputTokens: 2 }, reviewer: { calls: 1, inputTokens: 50, outputTokens: 5 } })[kind],
      cancel() { cancelled = true; },
      async dispose() {},
    };
  };
  return { startRole, prompts, turns };
}

/** A maker that plans when asked and otherwise runs `edit`. */
const maker = (edit, summary = 's') => (cwd, n, text, submit) => (submit === 'submit_plan' ? { plan: 'PLAN-TEXT bump the score' } : (edit(cwd, n, text), { summary }));

function setup(script, extra = {}) {
  const dir = repo();
  const store = createStore({ dir: mkdtempSync(join(tmpdir(), 'ap-data-')) });
  const roles = fakeRoles(script);
  const notified = [];
  const engine = createEngine({ store, startRole: roles.startRole, notify: (run) => notified.push(structuredClone(run)), ...extra });
  const spec = { slug: 'demo', repo: dir, brief: 'BRIEF-TEXT raise the score', rubric: 'RUBRIC-TEXT higher score is better', checkCommand: 'sh check.sh', protectedPaths: ['check.sh', 'test/'], maxIterations: 3, streakLimit: 2, models: MODELS };
  return { dir, store, engine, roles, notified, spec };
}

const done = async (engine, slug) => { await engine.live.get(slug)?.done; return engine.get(slug); };
const bump = (cwd) => writeFileSync(join(cwd, 'score.txt'), `${Number(readFileSync(join(cwd, 'score.txt'), 'utf8')) + 1}\n`);
const better = (success = 'NOT_MET') => ({ verdict: 'BETTER', success, summary: 'higher', rationale: 'RATIONALE-TEXT', evidence: 'EVIDENCE-TEXT', learnings: 'keep going' });
const worse = { verdict: 'NOT_BETTER', success: 'NOT_MET', summary: 'no gain', rationale: 'RATIONALE-TEXT', evidence: 'EVIDENCE-TEXT', learnings: 'try something else' };

test('BETTER lands the exact reviewed SHA by fast-forward; MET stops the run', async () => {
  const t = setup({
    maker: maker(bump, 'MAKER-SUMMARY bumped'),
    reviewer: (_cwd, text) => (text.includes('Candidate:') ? better(t.roles.prompts.reviewer.length === 2 ? 'MET' : 'NOT_MET') : worse),
  });
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.equal(run.status, 'stopped');
  assert.equal(run.stopReason, 'success criterion met');
  assert.deepEqual(run.iterations.map((i) => i.outcome), ['BETTER', 'BETTER']);
  assert.deepEqual(run.iterations.map((i) => i.landing), ['LANDED', 'LANDED']);
  assert.equal(run.branch, 'autoproject/demo');
  assert.equal(sh(t.dir, 'rev-parse', 'autoproject/demo'), run.iterations[1].sha);
  assert.equal(sh(t.dir, 'log', '-1', '--format=%s', 'autoproject/demo'), 'autoproject demo iteration 2');
  // The user's branch and checkout are untouched until they merge.
  assert.equal(sh(t.dir, 'rev-parse', 'main'), run.from);
  assert.equal(readFileSync(join(t.dir, 'score.txt'), 'utf8'), '0\n');
  assert.equal(t.notified.length, 1);
  assert.equal((await t.store.get('demo')).status, 'stopped');
});

test('each role runs on its own model; the maker plans read-only, everything else it does may write', async () => {
  const t = setup({ maker: maker(bump), reviewer: () => better('MET') });
  await t.engine.start(t.spec);
  await done(t.engine, 'demo');
  assert.deepEqual(t.roles.turns.map((x) => `${x.kind}:${x.model}:${x.submit}:${x.mode}`), [
    'maker:sonnet:submit_plan:read-only',
    'advisor:fable:submit_advice:read-only',
    'maker:sonnet:submit_candidate:workspace-write',
    'advisor:fable:submit_advice:read-only',
    'reviewer:opus:submit_verdict:workspace-write',
  ]);
});

test('information flow: the rubric reaches only the reviewer; advice never reaches the reviewer', async () => {
  const t = setup({ maker: maker(bump, 'MAKER-SUMMARY'), reviewer: () => worse });
  t.spec.streakLimit = 3;
  await t.engine.start(t.spec);
  await done(t.engine, 'demo');
  for (const p of [...t.roles.prompts.maker, ...t.roles.prompts.advisor]) {
    assert.doesNotMatch(p, /RUBRIC-TEXT|RATIONALE-TEXT|EVIDENCE-TEXT/);
  }
  for (const p of t.roles.prompts.maker.filter((x) => x.startsWith('You are maker'))) assert.match(p, /BRIEF-TEXT/);
  for (const p of t.roles.prompts.advisor) assert.match(p, /BRIEF-TEXT/);
  for (const p of t.roles.prompts.reviewer) { assert.match(p, /RUBRIC-TEXT/); assert.doesNotMatch(p, /BRIEF-TEXT|MAKER-SUMMARY|try something else|ADVICE-TEXT|PLAN-TEXT/); }
  // Lessons reach the next maker as quoted data.
  assert.match(t.roles.prompts.maker.find((p) => p.startsWith('You are maker 2')), /> 1 · NOT_BETTER · reviewer: no gain · try something else/);
});

test('① the plan is reviewed on the first iteration only; the advice reaches the maker before it edits', async () => {
  const t = setup({ maker: maker(bump), advisor: (_cwd, text) => (text.includes("The maker's plan") ? { verdict: 'REVISE', advice: 'PLAN-ADVICE start from the parser' } : proceed), reviewer: () => better() });
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  const plans = t.roles.turns.filter((x) => x.submit === 'submit_plan');
  assert.equal(plans.length, 1);
  assert.match(t.roles.prompts.advisor[0], /PLAN-TEXT/);
  assert.match(t.roles.prompts.maker[1], /REVISE[\s\S]*PLAN-ADVICE/);
  assert.equal(run.iterations[0].plan, 'PLAN-TEXT bump the score');
  assert.deepEqual(run.iterations[0].advice.map((a) => `${a.point}:${a.verdict}`), ['plan:REVISE', 'done:PROCEED']);
  assert.deepEqual(run.iterations[1].advice.map((a) => a.point), ['done']);
  assert.deepEqual(run.iterations[0].timeline.map((x) => x.phase), ['setup', 'plan', 'advise_plan', 'maker', 'advise_done', 'checks', 'review', 'landing', 'done']);
});

test('a maker that edits while planning fails the iteration', async () => {
  const t = setup({ maker: (cwd, _n, _text, submit) => { bump(cwd); return submit === 'submit_plan' ? { plan: 'p' } : { summary: 's' }; }, reviewer: () => better() });
  t.spec.maxIterations = 1;
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.equal(run.iterations[0].reason, 'maker changed files while planning');
  assert.equal(t.roles.prompts.advisor.length, 0);
});

test('③ REVISE before done gives the maker exactly one revision, committed before the checks', async () => {
  const t = setup({
    maker: (cwd, n, text, submit) => {
      if (submit === 'submit_plan') return { plan: 'p' };
      writeFileSync(join(cwd, 'score.txt'), text.includes('DONE-ADVICE') ? '7\n' : '1\n');
      return { summary: text.includes('DONE-ADVICE') ? 'REVISED-SUMMARY' : 's' };
    },
    advisor: (_cwd, text) => (text.includes('What did it miss') ? { verdict: 'REVISE', advice: 'DONE-ADVICE you missed the edge case' } : proceed),
    reviewer: () => better('MET'),
  });
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  const it = run.iterations[0];
  assert.equal(it.revised, true);
  assert.equal(it.makerSummary, 'REVISED-SUMMARY');
  assert.equal(t.roles.prompts.advisor.filter((p) => p.includes('What did it miss')).length, 1);
  assert.equal(sh(t.dir, 'show', 'autoproject/demo:score.txt'), '7');
  assert.equal(sh(t.dir, 'log', '-1', '--format=%s', 'autoproject/demo'), 'autoproject demo iteration 1 (revised)');
});

test('② after STUCK_AFTER failures in a row the advisor names a direction, and that maker plans again', async () => {
  const t = setup({
    maker: maker(bump),
    advisor: (_cwd, text) => (text.includes('were not accepted') ? { verdict: 'REVISE', advice: 'DIRECTION-TEXT try the cache' } : proceed),
    reviewer: () => worse,
  });
  t.spec.maxIterations = 3;
  t.spec.streakLimit = 5;
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.equal(STUCK_AFTER, 2);
  assert.deepEqual(run.iterations.map((i) => i.stuck === true), [false, false, true]);
  const third = run.iterations[2];
  assert.deepEqual(third.advice.map((a) => a.point), ['stuck', 'plan', 'done']);
  const stuckPrompt = t.roles.prompts.advisor.find((p) => p.includes('were not accepted'));
  assert.match(stuckPrompt, /refs\/autoproject\/demo\/1/);
  assert.match(stuckPrompt, /refs\/autoproject\/demo\/2/);
  assert.match(t.roles.prompts.maker.find((p) => p.startsWith('You are maker 3')), /Direction from the advisor[\s\S]*DIRECTION-TEXT/);
  assert.equal(t.roles.turns.filter((x) => x.submit === 'submit_plan').length, 2);
});

test('an advisor that hands nothing in fails the iteration; no reviewer runs', async () => {
  const t = setup({ maker: maker(bump), advisor: () => undefined, reviewer: () => better() });
  t.spec.maxIterations = 1;
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.match(run.iterations[0].reason, /^advisor did not submit/);
  assert.equal(t.roles.prompts.reviewer.length, 0);
});

test('NOT_BETTER adds to the streak; the streak limit stops the run; the branch never moves; candidates are kept as refs', async () => {
  const t = setup({ maker: maker(bump), reviewer: () => worse });
  const start = sh(t.dir, 'rev-parse', 'main');
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.equal(run.stopReason, 'failure streak limit');
  assert.equal(run.iterations.length, 2);
  assert.equal(run.streak, 2);
  assert.equal(sh(t.dir, 'rev-parse', 'main'), start);
  assert.equal(sh(t.dir, 'rev-parse', 'refs/autoproject/demo/2'), run.iterations[1].sha);
});

test('a candidate touching a protected path is rejected before any reviewer starts', async () => {
  const t = setup({ maker: maker((cwd) => writeFileSync(join(cwd, 'check.sh'), 'true\n')), reviewer: () => better() });
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.equal(t.roles.prompts.reviewer.length, 0);
  assert.match(run.iterations[0].reason, /protected paths: check.sh/);
});

test('failing checks get one repair round with the output; a passing repair goes to review', async () => {
  const t = setup({
    maker: (cwd, _n, text, submit) => {
      if (submit === 'submit_plan') return { plan: 'p' };
      writeFileSync(join(cwd, 'score.txt'), text.includes('failed (exit') ? '5\n' : 'bad\n');
      return { summary: 's' };
    },
    reviewer: () => better('MET'),
  });
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.equal(run.iterations[0].outcome, 'BETTER');
  assert.equal(run.iterations[0].repaired, true);
  assert.ok(t.roles.prompts.maker.some((p) => /failed \(exit 1\)/.test(p)));
  assert.equal(sh(t.dir, 'show', 'autoproject/demo:score.txt'), '5');
});

test('checks still failing after the repair is NOT_BETTER; a maker that changes nothing is NOT_BETTER', async () => {
  const t = setup({ maker: maker((cwd, n) => { if (n === 1) writeFileSync(join(cwd, 'score.txt'), 'bad\n'); }), reviewer: () => better() });
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  assert.match(run.iterations[0].reason, /checks failed after repair/);
  assert.equal(run.iterations[1].reason, 'maker changed nothing');
  assert.equal(t.roles.prompts.reviewer.length, 0);
});

test('a dirty main checkout does not matter while running; merge waits for the run to stop and for a clean checkout on the target', async () => {
  const t = setup({ maker: maker(bump), reviewer: () => better() });
  t.spec.maxIterations = 2;
  writeFileSync(join(t.dir, 'scratch.txt'), 'wip');
  await t.engine.start(t.spec);
  await assert.rejects(t.engine.merge('demo'), /demo is running/);
  let run = await done(t.engine, 'demo');
  assert.deepEqual(run.iterations.map((i) => i.landing), ['LANDED', 'LANDED']);
  assert.equal((await t.engine.pending('demo')).commits, 2);
  await assert.rejects(t.engine.merge('demo'), /uncommitted changes/);
  execFileSync('rm', [join(t.dir, 'scratch.txt')]);
  sh(t.dir, 'checkout', '-q', '-b', 'elsewhere');
  await assert.rejects(t.engine.merge('demo'), /not on main/);
  sh(t.dir, 'checkout', '-q', 'main');
  run = await t.engine.merge('demo');
  assert.deepEqual(run.merges.map((m) => [m.into, m.commits, m.fastForward]), [['main', 2, true]]);
  assert.equal(sh(t.dir, 'rev-parse', 'main'), sh(t.dir, 'rev-parse', 'autoproject/demo'));
  assert.equal(readFileSync(join(t.dir, 'score.txt'), 'utf8'), '2\n');
  assert.equal((await t.store.get('demo')).merges.length, 1);
  await assert.rejects(t.engine.merge('demo'), /has nothing that main does not already have/);
});

test('merge makes a merge commit when the user\'s branch moved, and aborts cleanly on a conflict', async () => {
  let t = setup({ maker: maker(bump), reviewer: () => better() });
  t.spec.maxIterations = 1;
  await t.engine.start(t.spec);
  await done(t.engine, 'demo');
  writeFileSync(join(t.dir, 'other.txt'), 'user work\n');
  sh(t.dir, 'add', '-A'); sh(t.dir, 'commit', '-qm', 'user work');
  let run = await t.engine.merge('demo');
  assert.equal(run.merges[0].fastForward, false);
  assert.equal(readFileSync(join(t.dir, 'score.txt'), 'utf8'), '1\n');
  assert.equal(readFileSync(join(t.dir, 'other.txt'), 'utf8'), 'user work\n');

  t = setup({ maker: maker(bump), reviewer: () => better() });
  t.spec.maxIterations = 1;
  await t.engine.start(t.spec);
  await done(t.engine, 'demo');
  writeFileSync(join(t.dir, 'score.txt'), '99\n');
  sh(t.dir, 'commit', '-qam', 'conflicting user work');
  const head = sh(t.dir, 'rev-parse', 'main');
  await assert.rejects(t.engine.merge('demo'), /conflicts; nothing was changed/);
  assert.equal(sh(t.dir, 'rev-parse', 'main'), head);
  assert.equal(sh(t.dir, 'status', '--porcelain'), '');
  assert.equal((await t.store.get('demo')).merges, undefined);
});

test('a run refuses a slug whose branch already exists', async () => {
  const t = setup({ maker: maker(bump), reviewer: () => better() });
  sh(t.dir, 'branch', 'autoproject/demo');
  await assert.rejects(t.engine.start(t.spec), /branch autoproject\/demo already exists/);
});

test('stop cancels the running maker; the iteration is ABORTED and does not count', async () => {
  const t = setup({ hang: { maker: true }, maker: maker(bump), reviewer: () => better() });
  await t.engine.start(t.spec);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(t.engine.activity('demo').kind, 'maker');
  await t.engine.control('demo', 'stop');
  const run = await done(t.engine, 'demo');
  assert.equal(run.stopReason, 'stopped by user');
  assert.equal(run.iterations[0].outcome, 'ABORTED');
  assert.equal(run.streak, 0);
});

test('steer text reaches the next maker and its advisor, once, and never the reviewer', async () => {
  const t = setup({ maker: maker(bump), reviewer: () => worse });
  t.spec.maxIterations = 2;
  t.spec.streakLimit = 5;
  await t.engine.start(t.spec);
  await t.engine.control('demo', 'steer', 'GUIDANCE-TEXT focus on X');
  await done(t.engine, 'demo');
  assert.equal(t.roles.prompts.maker.filter((p) => p.includes('GUIDANCE-TEXT')).length, 1);
  assert.equal(t.roles.prompts.advisor.filter((p) => p.includes('GUIDANCE-TEXT')).length, 1);
  assert.ok(t.roles.prompts.reviewer.every((p) => !p.includes('GUIDANCE-TEXT')));
});

test('a run needs all three models; one run per repository; recover() pauses a run that was mid-iteration', async () => {
  const t = setup({ hang: { maker: true }, maker: maker(bump), reviewer: () => better() });
  await assert.rejects(t.engine.start({ ...t.spec, models: { maker: MODELS.maker, reviewer: MODELS.reviewer } }), /no advisor model/);
  await t.engine.start(t.spec);
  await assert.rejects(t.engine.start({ ...t.spec, slug: 'other' }), /already running on this repository/);
  await new Promise((r) => setTimeout(r, 300));
  // A second engine over the same store, as after a restart.
  const again = createEngine({ store: t.store, startRole: t.roles.startRole });
  await again.recover();
  const run = await t.store.get('demo');
  assert.equal(run.status, 'paused');
  assert.match(run.iterations[0].reason, /interrupted during plan/);
  await t.engine.control('demo', 'stop');
  await done(t.engine, 'demo');
});

test('protected-path globs', () => {
  assert.ok(globToRegExp('test/').test('test/a/b.js'));
  assert.ok(globToRegExp('**/*.test.js').test('src/x.test.js'));
  assert.ok(globToRegExp('**/*.test.js').test('x.test.js'));
  assert.ok(!globToRegExp('*.md').test('docs/a.md'));
  assert.deepEqual(protectedHits(['src/a.js', '.github/ci.yml'], ['.github/']), ['.github/ci.yml']);
});

test('roles are children of the chat that started the run; worktrees are gone after the iteration', async () => {
  const specs = [];
  const script = { maker: maker(bump), reviewer: () => worse };
  const t = setup(script);
  const roles = fakeRoles(script);
  const engine = createEngine({ store: t.store, startRole: (spec) => { specs.push(spec); return roles.startRole(spec); } });
  await engine.start({ ...t.spec, slug: 'kids', originSessionId: 'chat-1', maxIterations: 1 });
  const run = await done(engine, 'kids');
  assert.deepEqual(specs.map((s) => s.kind), ['maker', 'advisor', 'advisor', 'reviewer']);
  assert.ok(specs.every((s) => s.parentSession === 'chat-1'));
  assert.equal(run.iterations[0].makerAddressable, true);
  assert.equal(run.iterations[0].reviewerAddressable, true);
  assert.ok(run.iterations[0].advice.every((a) => a.addressable));
  assert.ok(!existsSync(t.store.worktreePath('kids', 'maker')));
  assert.ok(!existsSync(t.store.worktreePath('kids', 'reviewer')));
  assert.ok(!existsSync(join(t.store.dir, 'worktrees', 'kids')));
  assert.equal(sh(t.dir, 'rev-parse', 'refs/autoproject/kids/1'), run.iterations[0].sha);
});

test('the engine bumps its revision and wait() wakes on change', async () => {
  const t = setup({ maker: maker(bump), reviewer: () => better('MET') });
  const r0 = t.engine.revision;
  const woke = t.engine.wait(r0, { timeoutMs: 5000 });
  await t.engine.start(t.spec);
  assert.ok((await woke) > r0);
  await done(t.engine, 'demo');
  assert.equal(await t.engine.wait(-5), t.engine.revision);
  assert.equal(t.engine.activity('demo'), undefined);
});

test('each iteration records tokens per role, and each piece of advice its own', async () => {
  const t = setup({ maker: maker(bump), reviewer: () => better('MET') });
  await t.engine.start(t.spec);
  const run = await done(t.engine, 'demo');
  const it = run.iterations[0];
  assert.deepEqual(it.usage, {
    advisor: { calls: 2, inputTokens: 40, outputTokens: 4 }, // plan + done, two sessions
    maker: { calls: 1, inputTokens: 100, outputTokens: 10 },
    reviewer: { calls: 1, inputTokens: 50, outputTokens: 5 },
  });
  assert.ok(it.advice.every((a) => a.usage.inputTokens === 20));
  assert.equal((await t.store.get('demo')).iterations[0].usage.maker.inputTokens, 100, 'saved, not only in memory');
});
