/**
 * The ratchet, as code. Each iteration:
 *   fresh maker worktree at the branch head
 *   → [② the last STUCK_AFTER attempts all failed: advisor names a new direction]
 *   → [first iteration, or after ②: maker plans read-only → ① advisor reviews the plan]
 *   → maker edits → plugin commits → ③ advisor asks what was missed → [REVISE: one maker revision]
 *   → protected-path gate → plugin runs checks (one repair round on failure)
 *   → fresh reviewer worktree at the candidate → reviewer verdict → BETTER lands by fast-forward of
 *   exactly that SHA; anything else is one NOT_BETTER and adds 1 to the failure streak.
 * Stops at the iteration limit, the streak limit, a MET success criterion that landed, or on request.
 * No LLM decides any of this: when the advisor is called, whether its advice gets a second round,
 * retry or stop are all decided here. Roles only edit files and submit structured results.
 */
import * as realGit from './git.js';
import { protectedHits, runChecks as realChecks } from './checks.js';
import {
  adviseDonePrompt, advisePlanPrompt, adviseStuckPrompt, implementPrompt, makerPrompt, repairPrompt, reviewerPrompt, revisePrompt,
  SUBMIT_ADVICE, SUBMIT_CANDIDATE, SUBMIT_PLAN, SUBMIT_VERDICT,
} from './prompts.js';

export class RunError extends Error {}

/** Written into every run, so a run's record says which code produced it. */
export const CODE_VERSION = '2.0.0';

/** Consecutive NOT_BETTER iterations after which the advisor is asked for a new direction. */
export const STUCK_AFTER = 2;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ROLES = ['maker', 'reviewer', 'advisor'];

export function tally(run) {
  const count = (key, value) => run.iterations.filter((it) => it[key] === value).length;
  return {
    iterations: run.iterations.length,
    better: count('verdict', 'BETTER'),
    notBetter: count('outcome', 'NOT_BETTER'),
    merged: count('landing', 'MERGED'),
    failed: count('landing', 'FAILED'),
    blocked: count('landing', 'BLOCKED'),
    aborted: count('outcome', 'ABORTED'),
    advice: run.iterations.reduce((sum, it) => sum + (it.advice?.length ?? 0), 0),
  };
}

export function createEngine({ store, startRole, git = realGit, runChecks = realChecks, notify = () => {}, log = () => {}, now = () => new Date() }) {
  const iso = () => now().toISOString();
  /** slug → { run, roles: Set, active?, saving: Promise, done: Promise } for runs whose loop is alive. */
  const live = new Map();

  // Every visible change bumps the revision, so the board can long-poll instead of re-reading on a timer.
  let revision = 0;
  const listeners = new Set();
  const bump = () => { revision++; for (const fn of listeners) { try { fn(); } catch { /* a listener's problem */ } } };

  function persist(state) {
    state.run.updatedAt = iso();
    const snapshot = structuredClone(state.run);
    state.saving = state.saving.then(() => store.save(snapshot)).catch((error) => log(`autoproject: save failed: ${error.message}`));
    bump();
    return state.saving;
  }

  /** Move the iteration to its next node and note when, for the board's timeline and timers. */
  function enter(it, phase) {
    it.phase = phase;
    (it.timeline ??= []).push({ phase, at: iso() });
  }

  /** Run one role for `use`; while it lives it is the run's active role (an advisor nests inside the maker). */
  async function withRole(state, spec, use) {
    const role = await startRole(spec);
    state.roles.add(role);
    const previous = state.active;
    state.active = { kind: spec.kind, role };
    try { return await use(role); } finally { state.roles.delete(role); state.active = previous; await role.dispose(); }
  }

  const stopped = (r) => `${r.stop}${r.error ? `: ${r.error}` : ''}`;

  /**
   * One advisor consultation in `cwd`, read-only. Returns { verdict, advice }, or undefined when
   * the advisor handed nothing in (the reason is on its record).
   */
  async function advise(state, it, point, cwd, prompt) {
    const { run } = state;
    enter(it, `advise_${point}`);
    await persist(state);
    return withRole(state, {
      kind: 'advisor', cwd, title: `autoproject ${run.slug} · advisor ${it.n} · ${point}`,
      submits: [SUBMIT_ADVICE], model: run.models.advisor, parentSession: run.originSessionId,
    }, async (advisor) => {
      const entry = { point, sessionId: advisor.sessionId, addressable: advisor.addressable === true, at: iso() };
      (it.advice ??= []).push(entry);
      await persist(state);
      const got = await advisor.turn(prompt, { submit: SUBMIT_ADVICE.name, mode: 'read-only' });
      if (!got.value) { entry.error = `advisor did not submit (${stopped(got)})`; return undefined; }
      Object.assign(entry, { verdict: got.value.verdict, advice: got.value.advice });
      await persist(state);
      return got.value;
    });
  }

  /** One iteration. Returns the finished iteration record; never throws. */
  async function iteration(state) {
    const { run } = state;
    const n = run.iterations.length + 1;
    const it = { n, startedAt: iso() };
    enter(it, 'setup');
    run.current = it;
    const finish = (outcome, reason, extra = {}) => {
      Object.assign(it, extra, { outcome: run.stopRequested && outcome === 'NOT_BETTER' ? 'ABORTED' : outcome, reason, finishedAt: iso() });
      it.timeline.push({ phase: 'done', at: it.finishedAt });
      delete it.phase;
      return it;
    };
    const lastAdviceError = () => it.advice?.at(-1)?.error ?? 'advisor failed';
    try {
      const base = await git.revParse(run.repo, run.branch);
      it.base = base;
      await persist(state);

      const makerPath = store.worktreePath(run.slug, 'maker');
      await git.freshWorktree(run.repo, makerPath, base);
      const guidance = run.guidance.filter((g) => !g.sentIn);
      let checks;
      const made = await (async () => {
        // ② The same failure keeps coming back: ask where to dig instead, before any maker starts.
        const stuck = run.streak >= STUCK_AFTER;
        let direction;
        if (stuck) {
          it.stuck = true;
          direction = await advise(state, it, 'stuck', makerPath, adviseStuckPrompt(run, n, base, run.iterations.slice(-run.streak)));
          if (!direction) return { fail: lastAdviceError() };
          if (run.stopRequested) return { fail: 'stopped' };
        }
        const planFirst = n === 1 || stuck;

        return withRole(state, {
          kind: 'maker', cwd: makerPath, title: `autoproject ${run.slug} · maker ${n}`,
          submits: [SUBMIT_PLAN, SUBMIT_CANDIDATE], model: run.models.maker, parentSession: run.originSessionId,
        }, async (maker) => {
          it.makerSession = maker.sessionId;
          it.makerAddressable = maker.addressable === true;
          it.makerTools = maker.tools;
          for (const g of guidance) g.sentIn = n;
          const opening = makerPrompt(run, n, base, guidance, { plan: planFirst, direction });
          const write = { submit: SUBMIT_CANDIDATE.name, mode: 'workspace-write' };

          let built;
          if (planFirst) {
            // ① Before a plan: is this the right approach? The maker may not edit until the advisor has read it.
            enter(it, 'plan');
            await persist(state);
            const planned = await maker.turn(opening, { submit: SUBMIT_PLAN.name, mode: 'read-only' });
            if (!planned.value) return { fail: `maker did not submit a plan (${stopped(planned)})` };
            it.plan = planned.value.plan;
            if (!(await git.isClean(makerPath))) return { fail: 'maker changed files while planning' };
            const advice = await advise(state, it, 'plan', makerPath, advisePlanPrompt(run, n, base, guidance, it.plan));
            if (!advice) return { fail: lastAdviceError() };
            if (run.stopRequested) return { fail: 'stopped' };
            enter(it, 'maker');
            await persist(state);
            built = await maker.turn(implementPrompt(advice), write);
          } else {
            enter(it, 'maker');
            await persist(state);
            built = await maker.turn(opening, write);
          }
          if (!built.value) return { fail: `maker did not submit (${stopped(built)})` };
          it.makerSummary = built.value.summary;
          let sha = await git.commitAll(makerPath, `autoproject ${run.slug} iteration ${n}`);
          if (!sha) return { fail: 'maker changed nothing' };
          await git.keepRef(run.repo, run.slug, n, sha);
          it.sha = sha;
          if (run.stopRequested) return { fail: 'stopped' };

          // ③ Before "done": what did the maker miss? One revision at most.
          const review = await advise(state, it, 'done', makerPath, adviseDonePrompt(run, n, base, sha, await git.diffStat(run.repo, base, sha), it.makerSummary));
          if (!review) return { fail: lastAdviceError() };
          if (review.verdict === 'REVISE') {
            if (run.stopRequested) return { fail: 'stopped' };
            enter(it, 'revise');
            it.revised = true;
            await persist(state);
            const revised = await maker.turn(revisePrompt(review), write);
            if (!revised.value) return { fail: `maker did not answer the advisor (${stopped(revised)})` };
            it.makerSummary = revised.value.summary;
            sha = (await git.commitAll(makerPath, `autoproject ${run.slug} iteration ${n} (revised)`)) ?? sha;
            await git.keepRef(run.repo, run.slug, n, sha);
            it.sha = sha;
          }

          const gate = async () => {
            const hits = protectedHits(await git.changedFiles(run.repo, base, sha), run.protectedPaths);
            return hits.length ? `touched protected paths: ${hits.slice(0, 5).join(', ')}` : undefined;
          };
          let blocked = await gate();
          if (blocked) return { fail: blocked };
          if (!run.checkCommand) return { sha };

          enter(it, 'checks');
          await persist(state);
          checks = { command: run.checkCommand, ...(await runChecks(run.checkCommand, makerPath, { timeoutMs: run.checkTimeoutMs })) };
          if (checks.ok) return { sha };
          if (run.stopRequested) return { fail: 'stopped' };

          enter(it, 'repair');
          it.repaired = true;
          await persist(state);
          const repair = await maker.turn(repairPrompt(checks), write);
          if (!repair.value) return { fail: `checks failed (exit ${checks.code}) and the maker did not submit a repair` };
          sha = (await git.commitAll(makerPath, `autoproject ${run.slug} iteration ${n} (repair)`)) ?? sha;
          await git.keepRef(run.repo, run.slug, n, sha);
          it.sha = sha;
          blocked = await gate();
          if (blocked) return { fail: blocked };
          checks = { command: run.checkCommand, ...(await runChecks(run.checkCommand, makerPath, { timeoutMs: run.checkTimeoutMs })) };
          if (!checks.ok) return { fail: `checks failed after repair (exit ${checks.code}): ${checks.output.trim().split('\n').pop()?.slice(0, 200) ?? ''}` };
          return { sha };
        });
      })().finally(() => git.removeWorktree(run.repo, makerPath)); // the candidate lives on in refs/autoproject/<slug>/<n>
      if (made.fail) return finish('NOT_BETTER', made.fail);
      if (run.stopRequested) return finish('ABORTED', 'stopped before review');
      const sha = made.sha;

      // Reviewer: a throwaway worktree at exactly the candidate. It never sees the advice.
      enter(it, 'review');
      await persist(state);
      const reviewerPath = store.worktreePath(run.slug, 'reviewer');
      await git.freshWorktree(run.repo, reviewerPath, sha);
      const stat = await git.diffStat(run.repo, base, sha);
      const judged = await withRole(state, {
        kind: 'reviewer', cwd: reviewerPath, title: `autoproject ${run.slug} · reviewer ${n}`,
        submits: [SUBMIT_VERDICT], model: run.models.reviewer, parentSession: run.originSessionId,
      }, async (reviewer) => {
        it.reviewerSession = reviewer.sessionId;
        it.reviewerAddressable = reviewer.addressable === true;
        it.reviewerTools = reviewer.tools;
        await persist(state);
        return reviewer.turn(reviewerPrompt(run, n, base, sha, stat, checks), { submit: SUBMIT_VERDICT.name, mode: 'workspace-write' });
      }).finally(() => git.removeWorktree(run.repo, reviewerPath));
      const v = judged.value;
      if (!v) return finish('NOT_BETTER', `reviewer did not submit (${stopped(judged)})`);
      Object.assign(it, { verdict: v.verdict, success: v.success, summary: v.summary, rationale: v.rationale, evidence: v.evidence, learnings: v.learnings });
      if (v.verdict !== 'BETTER') return finish('NOT_BETTER', `reviewer: ${v.summary}`);
      if (!(await git.isAncestor(run.repo, base, sha))) return finish('NOT_BETTER', 'candidate does not descend from base');

      // Land exactly the reviewed SHA.
      enter(it, 'landing');
      await persist(state);
      const landing = await git.fastForward(run.repo, run.branch, base, sha);
      it.landing = landing.outcome;
      if (landing.outcome === 'MERGED') return finish('BETTER', landing.reason ?? 'landed', { landed: landing.landed });
      if (landing.outcome === 'BLOCKED') return finish('BLOCKED', `not landed: ${landing.reason}`);
      return finish('NOT_BETTER', `landing failed: ${landing.reason}`);
    } catch (error) {
      log(`autoproject ${run.slug}: iteration ${n}: ${error.stack ?? error.message}`);
      return finish('NOT_BETTER', `error: ${error.message}`);
    }
  }

  function stopReason(run, last) {
    if (run.stopRequested) return 'stopped by user';
    if (last?.outcome === 'BETTER' && last.success === 'MET') return 'success criterion met';
    if (run.iterations.length >= run.limits.maxIterations) return 'iteration limit';
    if (run.streak >= run.limits.streakLimit) return 'failure streak limit';
    return undefined;
  }

  async function drive(state) {
    const { run } = state;
    try {
      while (run.status === 'running') {
        const it = await iteration(state);
        run.iterations.push(it);
        run.current = null;
        if (it.outcome === 'BETTER') run.streak = 0;
        else if (it.outcome === 'NOT_BETTER') run.streak += 1;
        const reason = stopReason(run, it);
        if (reason) {
          Object.assign(run, { status: 'stopped', stopReason: reason, finishedAt: iso(), tally: tally(run) });
        } else if (it.outcome === 'BLOCKED') {
          Object.assign(run, { status: 'paused', pauseReason: `${it.reason}; fix it and resume (candidate ${it.sha.slice(0, 10)} is kept at refs/autoproject/${run.slug}/${it.n})` });
        } else if (run.pauseRequested) {
          Object.assign(run, { status: 'paused', pauseReason: 'paused by user', pauseRequested: false });
        }
        await persist(state);
        log(`autoproject ${run.slug}: iteration ${it.n} ${it.outcome} — ${it.reason}`);
      }
    } catch (error) {
      Object.assign(run, { status: 'paused', pauseReason: `engine error: ${error.message}` });
      await persist(state);
    } finally {
      live.delete(run.slug);
    }
    if (run.status === 'stopped' || run.status === 'paused') notify(run);
  }

  function launch(run) {
    const state = { run, roles: new Set(), saving: Promise.resolve() };
    live.set(run.slug, state);
    state.done = drive(state);
    return state;
  }

  return {
    live,

    get revision() { return revision; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Resolve once the revision moves past `since`, after `timeoutMs`, or when `signal` aborts. */
    wait(since, { timeoutMs = 5_000, signal } = {}) {
      if (since !== revision) return Promise.resolve(revision);
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); listeners.delete(done); signal?.removeEventListener?.('abort', done); resolve(revision); };
        const timer = setTimeout(done, timeoutMs);
        listeners.add(done);
        signal?.addEventListener?.('abort', done, { once: true });
      });
    },
    /** What the live role of a running run is doing right now, or undefined. */
    activity(slug) {
      const active = live.get(slug)?.active;
      if (!active) return undefined;
      let detail = {};
      try { detail = active.role.activity?.() ?? {}; } catch { /* best effort */ }
      return { kind: active.kind, sessionId: active.role.sessionId, ...detail };
    },

    /** Validate and start a new run. Returns the saved run; the loop continues in the background. */
    async start(spec) {
      if (!SLUG.test(spec.slug ?? '')) throw new RunError('slug must be lowercase letters, digits and hyphens (≤ 40)');
      for (const role of ROLES) if (!spec.models?.[role]?.provider || !spec.models[role].model) throw new RunError(`no ${role} model`);
      if (await store.get(spec.slug)) throw new RunError(`a run named ${spec.slug} already exists; pick another slug`);
      if (!spec.brief?.trim() || !spec.rubric?.trim()) throw new RunError('brief and rubric are required');
      const repo = await git.toplevel(spec.repo).catch(() => { throw new RunError(`${spec.repo} is not a git repository`); });
      const branch = spec.branch || (await git.currentBranch(repo));
      if (!branch) throw new RunError('the main checkout is on a detached HEAD; pass branch');
      await git.revParse(repo, branch).catch(() => { throw new RunError(`branch ${branch} does not exist`); });
      const active = (await store.list()).find((r) => r.repo === repo && r.status !== 'stopped');
      if (active) throw new RunError(`run ${active.slug} is already ${active.status} on this repository; one run per repository`);
      const run = {
        slug: spec.slug, codeVersion: CODE_VERSION, repo, branch, createdAt: iso(), updatedAt: iso(), originSessionId: spec.originSessionId,
        status: 'running', brief: spec.brief, rubric: spec.rubric, success: spec.success ?? '',
        checkCommand: spec.checkCommand ?? '', checkTimeoutMs: spec.checkTimeoutMs ?? 10 * 60_000,
        protectedPaths: spec.protectedPaths ?? [],
        limits: { maxIterations: spec.maxIterations ?? 5, streakLimit: spec.streakLimit ?? 3 },
        models: { maker: spec.models.maker, reviewer: spec.models.reviewer, advisor: spec.models.advisor },
        streak: 0, guidance: [], iterations: [], current: null,
      };
      await store.save(run);
      launch(run);
      bump();
      return run;
    },

    async get(slug) { return live.get(slug)?.run ?? store.get(slug); },
    async list() {
      const stored = await store.list();
      return stored.map((r) => live.get(r.slug)?.run ?? r);
    },

    async control(slug, action, text) {
      const state = live.get(slug);
      if (state) {
        const { run } = state;
        if (action === 'stop') {
          run.stopRequested = true;
          if (run.current?.phase !== 'landing') for (const role of state.roles) role.cancel();
        } else if (action === 'pause') run.pauseRequested = true;
        else if (action === 'steer') run.guidance.push({ text, at: iso() });
        else if (action === 'resume') throw new RunError(`${slug} is already running`);
        await persist(state);
        return run;
      }
      const run = await store.get(slug);
      if (!run) throw new RunError(`no run named ${slug}`);
      if (run.status === 'stopped') throw new RunError(`${slug} has stopped (${run.stopReason})`);
      if (action === 'steer') run.guidance.push({ text, at: iso() });
      else if (action === 'stop') Object.assign(run, { status: 'stopped', stopReason: 'stopped by user', finishedAt: iso(), tally: tally(run) });
      else if (action === 'resume') {
        Object.assign(run, { status: 'running', pauseReason: undefined, stopRequested: false, pauseRequested: false });
        await store.save(run);
        launch(run);
        bump();
        return run;
      }
      await store.save(run);
      bump();
      return run;
    },

    /** After a restart: a run that was mid-iteration records it as aborted and waits to be resumed. */
    async recover() {
      for (const run of await store.list()) {
        if (run.status !== 'running' || live.has(run.slug)) continue;
        if (run.current) run.iterations.push({ ...run.current, outcome: 'ABORTED', reason: `interrupted during ${run.current.phase ?? 'setup'} (DSH restarted)`, finishedAt: iso() });
        Object.assign(run, { current: null, status: 'paused', pauseReason: 'DSH restarted; resume to continue' });
        await store.save(run);
      }
      bump();
    },

    async shutdown() {
      await Promise.all([...live.values()].map((state) => { for (const role of state.roles) role.cancel(); return state.saving; }));
    },
  };
}
