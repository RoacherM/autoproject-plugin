import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeMetrics, metrics } from '../src/shared/metrics.js';

const u = (i, o, cache = 0) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: cache });
const it = (n, o) => ({ n, usage: { maker: u(1000, 100, 5000), advisor: u(200, 20), reviewer: u(500, 50) }, advice: [], ...o });
const adv = (point, verdict) => ({ point, verdict, advice: 'x', usage: u(100, 10) });

test('tokens per landed commit and each role\'s share', () => {
  const m = metrics({ iterations: [it(1, { landing: 'LANDED', verdict: 'BETTER' }), it(2, { verdict: 'NOT_BETTER' })] });
  assert.equal(m.tokens, 2 * 1870);
  assert.equal(m.cacheReadTokens, 10000);
  assert.equal(m.landed, 1);
  assert.equal(m.tokensPerLanded, 3740);
  assert.deepEqual(Object.values(m.share).map((x) => Math.round(x * 1000)), [588, 118, 294]);
  assert.equal(metrics({ iterations: [it(1, {})] }).tokensPerLanded, null, 'nothing landed: no per-landed number');
});

test('per advisor point: objections, and the reviewer pass rate after REVISE vs after PROCEED', () => {
  const runs = [
    { iterations: [
      it(1, { verdict: 'BETTER', landing: 'LANDED', advice: [adv('plan', 'REVISE'), adv('done', 'REVISE')] }),
      it(2, { verdict: 'NOT_BETTER', advice: [adv('done', 'PROCEED')] }),
      it(3, { verdict: 'BETTER', landing: 'LANDED', advice: [adv('done', 'REVISE')] }),
      it(4, { advice: [adv('done', 'PROCEED')] }), // never judged (checks failed): left out of pass rates
    ] },
    { iterations: [it(1, { verdict: 'BETTER', landing: 'LANDED', advice: [adv('stuck', 'REVISE'), { point: 'done', error: 'advisor did not submit' }] })] },
  ];
  const m = metrics(runs);
  assert.deepEqual(m.points.done, { calls: 5, revise: 2, failed: 1, tokens: 440, passAfterRevise: 1, passAfterProceed: 0, landedAfter: 3 });
  assert.equal(m.points.stuck.landedAfter, 1);
  assert.equal(m.points.plan.passAfterProceed, null);
  const text = describeMetrics(m);
  assert.match(text, /advisor done: 5 calls, 2 REVISE, 1 failed, 440 tokens · reviewer pass after REVISE 100% vs after PROCEED 0%/);
  assert.match(text, /advisor stuck: 1 calls, 1 REVISE.*landed after 1\/1/);
});

test('runs without usage (no role finished yet) give zeros, not errors', () => {
  const m = metrics({ iterations: [{ n: 1, outcome: 'ABORTED' }] });
  assert.equal(m.tokens, 0);
  assert.deepEqual(m.share, { maker: 0, advisor: 0, reviewer: 0 });
  assert.match(describeMetrics(m), /tokens 0/);
});
