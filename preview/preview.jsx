// Design preview: the real board page against mock runs, for screenshots. Not shipped.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { makeBoardPage } from '../src/client/board.jsx';
import { withI18n } from '../src/client/i18n.jsx';
import { CSS } from '../src/client/styles.js';

const now = Date.now();
const at = (min) => new Date(now + min * 60_000).toISOString();
const tl = (...pairs) => pairs.map(([phase, min]) => ({ phase, at: at(min) }));
const it = (n, o) => ({ n, base: 'b1c2d3e4f5a6b7c8d9e0', ...o });
const limits = (m, s) => ({ maxIterations: m, streakLimit: s });
const models = { maker: { provider: 'deepseek-official', model: 'claude/claude-sonnet-5-5', reasoningEffort: 'medium' }, reviewer: { provider: 'deepseek-official', model: 'claude/claude-opus-5-5', reasoningEffort: 'high' }, advisor: { provider: 'deepseek-official', model: 'claude/claude-fable-5-1', reasoningEffort: 'high' } };
const adv = (point, verdict, advice, n) => ({ point, verdict, advice, sessionId: `adv-${n}-${point}`, addressable: true });
const RUNS = [
  { slug: 'parser-speed', models, status: 'running', repo: '/Users/me/code/fastparse', branch: 'main', originSessionId: 'chat-1', limits: limits(6, 3), streak: 1, guidance: [{ text: '先别碰 lexer' }],
    brief: 'Goal: make parse() faster on large inputs…', rubric: 'BETTER means measurably faster on bench/large.json with no test regressions…', success: 'bench/large.json under 120ms', checkCommand: '/opt/node/bin/node --test',
    iterations: [
      it(1, { outcome: 'BETTER', verdict: 'BETTER', success: 'NOT_MET', landing: 'MERGED', sha: '84e09e76ab12', startedAt: at(-52), finishedAt: at(-41), timeline: tl(['setup', -52], ['plan', -51.8], ['advise_plan', -50.5], ['maker', -49.6], ['advise_done', -47], ['checks', -46], ['review', -45.5], ['landing', -41.2], ['done', -41]), plan: 'Profile parse() on bench/large.json, then hoist the token regex out of the per-token loop in src/lexer.js; check with the benchmark and node --test.', advice: [adv('plan', 'PROCEED', 'The regex compile is the hot spot. Keep the sticky flag, or lastIndex handling changes.', 1), adv('done', 'PROCEED', 'Ready. The lastIndex reset on error paths is covered by the existing tests.', 1)], summary: 'Hoists the regex out of the token loop: 212ms → 168ms', makerSummary: 'Compiled the token regex once per parser instead of per token.', rationale: 'Base took 212ms on bench/large.json, the candidate 168ms (5 runs each). Tests pass. The change is 6 lines.', evidence: 'node bench/run.js large.json ×5 on Base and Candidate; node --test', learnings: 'Allocation in the hot loop is the main cost; look at string slicing next.' }),
      it(2, { outcome: 'NOT_BETTER', verdict: 'NOT_BETTER', success: 'NOT_MET', sha: '1d4f80289dff', repaired: true, startedAt: at(-40), finishedAt: at(-24), timeline: tl(['setup', -40], ['maker', -39.8], ['advise_done', -35], ['revise', -34], ['checks', -33], ['repair', -32.5], ['review', -29], ['done', -24]), advice: [adv('done', 'REVISE', 'The cache key ignores parse options, so two calls with different options share a result. Include the options in the key.', 2)], revised: true, summary: 'Adds a cache that is slower on first parse', reason: 'reviewer: Adds a cache that is slower on first parse', makerSummary: 'Memoized parse results by input hash.', rationale: 'First-parse time rose to 190ms; the cache only helps repeated inputs, which the rubric does not reward.', learnings: 'Avoid caching; attack per-token allocation.' }),
    ],
    current: it(3, { phase: 'advise_done', startedAt: at(-23), timeline: tl(['setup', -23], ['maker', -22.7], ['advise_done', -1.5]), makerSummary: 'Slices tokens by index instead of copying substrings.', sha: '5be0c2d11f3a', advice: [{ point: 'done', sessionId: 'adv-3-done', addressable: true }], activity: { kind: 'advisor', sessionId: 'adv-3-done', toolCalls: 4, lastTool: 'bash', lastHint: 'git diff b1c2d3e4 5be0c2d1', lastAt: at(-0.3) } }),
  },
  { slug: 'docs-cleanup', models, status: 'paused', repo: '/Users/me/code/site', branch: 'main', originSessionId: 'chat-2', limits: limits(3, 2), streak: 0, guidance: [], pauseReason: 'not landed: main checkout has uncommitted changes; fix it and resume',
    brief: 'Goal: fix broken links…', rubric: 'BETTER means fewer broken links…', success: '', checkCommand: 'npm run linkcheck',
    iterations: [it(1, { outcome: 'BLOCKED', verdict: 'BETTER', success: 'N/A', landing: 'BLOCKED', sha: '0996052f77aa', startedAt: at(-15), finishedAt: at(-6), timeline: tl(['setup', -15], ['maker', -14.8], ['checks', -10], ['review', -9.6], ['landing', -6.1], ['done', -6]), summary: 'Fixes 23 of 25 broken links', reason: 'not landed: main checkout has uncommitted changes', makerSummary: 'Rewrote relative links after the docs/ move.', rationale: 'linkcheck reports 2 broken links instead of 25.' })], current: null },
  { slug: 'toy-stats-3', models, status: 'stopped', stopReason: 'success criterion met', repo: '/private/tmp/ap-toy', branch: 'main', originSessionId: 'chat-3', limits: limits(1, 1), streak: 0, guidance: [], brief: '…', rubric: '…', success: 'tests pass', checkCommand: 'node test/stats.test.js',
    iterations: [it(1, { outcome: 'BETTER', verdict: 'BETTER', success: 'MET', landing: 'MERGED', sha: '84e09e7abcd0', startedAt: at(-180), finishedAt: at(-178), summary: 'Candidate fixes median sorting and empty-input handling', makerSummary: 'Sort a copy numerically; guard empty arrays.' })], current: null },
];
window.fetch = async (url) => {
  const path = new URL(url, location.href).pathname;
  if (path.endsWith('/wait')) return new Promise(() => {});
  return new Response(JSON.stringify({ revision: 1, now: new Date().toISOString(), runs: RUNS }));
};
const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
const lang = params.get('lang') ?? 'zh';
const locale = { getSnapshot: () => ({ active: lang }), subscribe: () => () => {} };
const { api } = await import('../src/client/api.js');
const Page = withI18n(locale, makeBoardPage({ api, openTranscript: (p, c) => alert(`open ${c} under ${p}`) }));
createRoot(document.getElementById('root')).render(<Page />);
if (params.get('open')) setTimeout(() => document.querySelectorAll('.apk-card')[Number(params.get('open'))]?.click(), 200);
if (params.get('measure')) setTimeout(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const sc = document.querySelector('.apk-scroll');
  document.body.dataset.m = JSON.stringify({
    vw: innerWidth, h1: r(document.querySelector('.apk-title h1')), toolbar: r(document.querySelector('.apk-toolbar')),
    main: r(document.querySelector('.apk-main')), cols: [...document.querySelectorAll('.apk-col')].map(r),
    panel: r(document.querySelector('.apk-panel')), scrollX: sc ? sc.scrollWidth - sc.clientWidth : null,
    pageOverflow: document.documentElement.scrollWidth - innerWidth,
  });
}, 700);
