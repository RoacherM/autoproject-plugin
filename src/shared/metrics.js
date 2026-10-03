/**
 * The numbers that say whether each node earns its tokens. Pure, so the engine, the chat tools and
 * the board share it. Tokens, not money: DSH keeps no price table. "Tokens" below means input plus
 * output as the provider reports them; cache reads are counted apart.
 *
 *   1. tokens per landed commit, and each role's share;
 *   2. per advisor point: how often it objects, and the reviewer's pass rate after REVISE vs PROCEED
 *      (an objection that does not raise the pass rate is not worth its tokens);
 *   3. after a stuck consultation: how often that iteration landed (broke the streak).
 */

export const ROLES = ['maker', 'advisor', 'reviewer'];
export const POINTS = ['plan', 'stuck', 'done'];

/** Add one role's usage into a running sum of the same shape. */
export function addUsage(into, used) {
  for (const [key, value] of Object.entries(used ?? {})) into[key] = (into[key] ?? 0) + (Number(value) || 0);
  return into;
}

export const tokensOf = (u) => (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0);

/** passed / judged, or null when nothing was judged. */
const rate = (passed, judged) => (judged ? passed / judged : null);

/** @param runs - one run or many; metrics across all their finished iterations. */
export function metrics(runs) {
  const its = (Array.isArray(runs) ? runs : [runs]).flatMap((r) => r.iterations);
  const usage = Object.fromEntries(ROLES.map((r) => [r, {}]));
  for (const it of its) for (const role of ROLES) addUsage(usage[role], it.usage?.[role]);
  const total = ROLES.reduce((sum, r) => sum + tokensOf(usage[r]), 0);
  const landed = its.filter((it) => it.landing === 'MERGED').length;

  const points = {};
  for (const point of POINTS) {
    const seen = its.flatMap((it) => (it.advice ?? []).filter((a) => a.point === point).map((a) => ({ a, it })));
    const judged = (verdict) => seen.filter(({ a, it }) => a.verdict === verdict && it.verdict);
    const passed = (list) => list.filter(({ it }) => it.verdict === 'BETTER').length;
    const afterRevise = judged('REVISE');
    const afterProceed = judged('PROCEED');
    points[point] = {
      calls: seen.length,
      revise: seen.filter(({ a }) => a.verdict === 'REVISE').length,
      failed: seen.filter(({ a }) => a.error).length,
      tokens: seen.reduce((sum, { a }) => sum + tokensOf(a.usage), 0),
      passAfterRevise: rate(passed(afterRevise), afterRevise.length),
      passAfterProceed: rate(passed(afterProceed), afterProceed.length),
      landedAfter: seen.filter(({ it }) => it.landing === 'MERGED').length,
    };
  }

  return {
    iterations: its.length,
    landed,
    tokens: total,
    cacheReadTokens: ROLES.reduce((sum, r) => sum + (usage[r].cacheReadTokens ?? 0), 0),
    tokensPerLanded: landed ? Math.round(total / landed) : null,
    share: Object.fromEntries(ROLES.map((r) => [r, total ? tokensOf(usage[r]) / total : 0])),
    usage,
    points,
  };
}

const pct = (x) => (x === null ? '–' : `${Math.round(x * 100)}%`);
export const kTokens = (n) => (n === null ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** The metrics as a few plain lines, for the chat tools. */
export function describeMetrics(m) {
  const lines = [
    `tokens ${kTokens(m.tokens)} (cache reads not counted: ${kTokens(m.cacheReadTokens)}) · landed ${m.landed}/${m.iterations} · per landed commit ${kTokens(m.tokensPerLanded)}`,
    `share: ${ROLES.map((r) => `${r} ${pct(m.share[r])}`).join(' · ')}`,
  ];
  for (const point of POINTS) {
    const p = m.points[point];
    if (!p.calls) continue;
    lines.push(`advisor ${point}: ${p.calls} calls, ${p.revise} REVISE${p.failed ? `, ${p.failed} failed` : ''}, ${kTokens(p.tokens)} tokens · reviewer pass after REVISE ${pct(p.passAfterRevise)} vs after PROCEED ${pct(p.passAfterProceed)}${point === 'stuck' ? ` · landed after ${p.landedAfter}/${p.calls}` : ''}`);
  }
  return lines.join('\n');
}
