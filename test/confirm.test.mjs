import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmation } from '../src/host/index.js';

const MODELS = { maker: { provider: 'p', model: 'sonnet', reasoningEffort: 'medium' }, reviewer: { provider: 'p', model: 'opus', reasoningEffort: 'high' }, advisor: { provider: 'p', model: 'fable' } };

test('the Go dialog is a short summary with short commands and all three models', () => {
  const long = 'x'.repeat(500);
  const c = confirmation({ slug: 's', brief: long, rubric: long, check_command: '/a/b/node test/t.js', protected_paths: ['test/'], max_iterations: 2, streak_limit: 1 }, '/repo', MODELS);
  assert.equal(c.question, 'Start autoproject "s"?');
  assert.match(c.detail, /\*\*Checks\*\*: `node test\/t\.js`/);
  assert.match(c.detail, /\*\*Maker\*\*: p\/sonnet@medium/);
  assert.match(c.detail, /\*\*Reviewer\*\*: p\/opus@high/);
  assert.match(c.detail, /\*\*Advisor\*\*: p\/fable · plan/);
  assert.doesNotMatch(c.detail, /\/a\/b\/node/);
  assert.ok(c.detail.length < 1000, `detail is ${c.detail.length} chars`);
  assert.ok(c.options[0].label.startsWith('Go'));
});
