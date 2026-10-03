/**
 * Runs → a Vibe Kanban board. Pure, so the page and the tests share it.
 *
 * One card per iteration (the unit of work: one candidate, one verdict), in Vibe Kanban's columns:
 *   To Do        the next iteration a running or paused run will start
 *   In Progress  setup · advisor on a stuck streak · maker planning · advisor on the plan · maker
 *                editing · advisor before done · maker revising · checks · repair
 *   In Review    reviewer judging · landing
 *   Done         landed on the run branch (merging it into the user's branch is a run-level step)
 *   Cancelled    NOT_BETTER or ABORTED
 */

export const COLUMNS = ['todo', 'inprogress', 'inreview', 'done', 'cancelled'];

/**
 * The nodes one iteration can pass through, in order. Conditional ones: `advise_stuck` after a
 * failure streak, `plan` + `advise_plan` on the first iteration and after a stuck streak, `revise`
 * when the advisor objects before done, `repair` when checks failed.
 */
export const PIPELINE = ['setup', 'advise_stuck', 'plan', 'advise_plan', 'maker', 'advise_done', 'revise', 'checks', 'repair', 'review', 'landing'];

/** Nodes that only some iterations visit; the drawer does not predict them. */
export const CONDITIONAL = new Set(['advise_stuck', 'plan', 'advise_plan', 'revise', 'repair']);

const LIVE_COLUMN = Object.fromEntries(PIPELINE.map((p) => [p, p === 'review' || p === 'landing' ? 'inreview' : 'inprogress']));

const finishedColumn = (it) => (it.outcome === 'BETTER' ? 'done' : 'cancelled');

/** A run whose landed work waits for the user to merge it. */
export const awaitingMerge = (run) => run.status !== 'running' && run.pendingCommits > 0;

/** When the iteration entered its current node (old records without a timeline: its start). */
export function phaseSince(it) {
  return it.timeline?.at(-1)?.at ?? it.startedAt;
}

/** Each node the iteration passed through with how long it stayed there; the last one is still open when live. */
export function steps(it, now = new Date()) {
  const line = it.timeline?.length ? it.timeline : [{ phase: 'setup', at: it.startedAt }, ...(it.finishedAt ? [{ phase: 'done', at: it.finishedAt }] : [])];
  const out = [];
  for (let i = 0; i < line.length; i++) {
    const { phase, at } = line[i];
    if (phase === 'done') break;
    const end = line[i + 1]?.at ?? (it.finishedAt ?? null);
    out.push({ phase, at, ms: (end ? new Date(end) : now) - new Date(at), open: !end });
  }
  return out;
}

function card(run, it, extra) {
  return {
    id: `${run.slug}#${it.n}`,
    slug: run.slug,
    n: it.n,
    runStatus: run.status,
    originSessionId: run.originSessionId,
    startedAt: it.startedAt,
    finishedAt: it.finishedAt,
    phaseSince: phaseSince(it),
    sha: it.sha,
    base: it.base,
    repaired: it.repaired === true,
    makerSession: it.makerSession,
    reviewerSession: it.reviewerSession,
    // Roles created before the plugin recorded a subagent descriptor cannot be opened in the GUI.
    makerViewable: it.makerAddressable === true,
    reviewerViewable: it.reviewerAddressable === true,
    makerSummary: it.makerSummary,
    plan: it.plan,
    advice: it.advice ?? [],
    stuck: it.stuck === true,
    revised: it.revised === true,
    verdict: it.verdict,
    success: it.success,
    summary: it.summary,
    reason: it.reason,
    rationale: it.rationale,
    evidence: it.evidence,
    learnings: it.learnings,
    landing: it.landing,
    outcome: it.outcome,
    iteration: it,
    ...extra,
  };
}

/**
 * @param runs - runs as the host serves them (`current` carries the live role's `activity`).
 * @param filter - optional slug to show one run only.
 * @returns { columns: { todo: Card[], ... }, stats }
 */
export function buildBoard(runs, { filter } = {}) {
  const columns = Object.fromEntries(COLUMNS.map((c) => [c, []]));
  const shown = filter ? runs.filter((r) => r.slug === filter) : runs;
  for (const run of shown) {
    for (const it of run.iterations) {
      columns[finishedColumn(it)].push(card(run, it, { live: false }));
    }
    if (run.current) {
      const phase = run.current.phase ?? 'setup';
      columns[LIVE_COLUMN[phase] ?? 'inprogress'].push(card(run, run.current, { live: true, phase, activity: run.current.activity }));
    }
    if (run.status !== 'stopped') {
      const used = run.iterations.length + (run.current ? 1 : 0);
      const left = run.limits.maxIterations - used;
      if (left > 0) {
        columns.todo.push({
          id: `${run.slug}#next`, slug: run.slug, n: used + 1, queued: true, left, runStatus: run.status,
          paused: run.status === 'paused', pauseReason: run.pauseReason, originSessionId: run.originSessionId,
          guidance: run.guidance.filter((g) => !g.sentIn).map((g) => g.text),
        });
      }
    }
  }
  const recent = (c) => new Date(c.finishedAt ?? c.phaseSince ?? 0).getTime();
  for (const c of COLUMNS) columns[c].sort((a, b) => (b.live === true) - (a.live === true) || recent(b) - recent(a));
  const stats = {
    running: runs.filter((r) => r.status === 'running').length,
    paused: runs.filter((r) => r.status === 'paused').length,
    stopped: runs.filter((r) => r.status === 'stopped').length,
    live: runs.filter((r) => r.current).length,
    landed: runs.reduce((sum, r) => sum + r.iterations.filter((it) => it.landing === 'LANDED').length, 0),
    attention: runs.filter(awaitingMerge).length,
  };
  return { columns, stats };
}

/** 3s · 4m 12s · 1h 05m */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
