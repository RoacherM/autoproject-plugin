import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, describeRecommendation, recommend, resolveModel } from '../src/host/models.js';

/** A fake ctx whose llm service lists `catalog` ({ provider: [ids] }) and accepts `efforts` on every model. */
function ctxWith(catalog, { efforts = ['low', 'medium', 'high'], home } = {}) {
  const llm = {
    listProviders: () => Object.keys(catalog).map((id) => ({ id, name: id.toUpperCase() })),
    listModels: async (provider) => catalog[provider].map((id) => ({ provider, id, name: id })),
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, reasoning: { efforts: efforts.map((id) => ({ id, name: id })) } }),
  };
  return { get: (key) => (key === 'llm' ? llm : undefined), agentDefaultModel: { currentSelection: () => ({ provider: home }) } };
}

test('tiers come from the name: frontier, standard, small; unknown names are standard', () => {
  const tier = (id) => classify({ id, name: id }).tier;
  assert.deepEqual(['claude-fable-5-1', 'claude-opus-5-5', 'gemini-2.5-pro', 'gemini-3-pro-preview'].map(tier), [3, 3, 3, 3]);
  assert.deepEqual(['claude-sonnet-5-5', 'group/auto-claude-sonnet-4-6', 'deepseek-chat', 'gpt-5'].map(tier), [2, 2, 2, 2]);
  assert.deepEqual(['claude-haiku-4-5', 'gpt-5-mini', 'o4-mini', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'].map(tier), [1, 1, 1, 1, 1]);
  assert.ok(classify({ id: 'claude-opus-5-5' }).version > classify({ id: 'claude-opus-4-1-20250805' }).version);
});

test('the Claude tree: Fable advises, Opus reviews, Sonnet builds on medium; the default provider wins ties', async () => {
  const ctx = ctxWith({
    a: ['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'],
    b: ['claude-opus-5-5', 'claude-sonnet-4-6'],
  }, { home: 'b' });
  const rec = await recommend(ctx);
  assert.deepEqual(rec.advisor, { provider: 'a', model: 'claude-fable-5-1', reasoningEffort: 'high' });
  assert.deepEqual(rec.reviewer, { provider: 'b', model: 'claude-opus-5-5', reasoningEffort: 'high' });
  assert.deepEqual(rec.maker, { provider: 'a', model: 'claude-sonnet-5-5', reasoningEffort: 'medium' });
  assert.deepEqual(rec.notes, []);
  const text = describeRecommendation(rec);
  assert.match(text, /- maker: a\/claude-sonnet-5-5@medium/);
  assert.match(text, /\| a\/claude-fable-5-1 \| claude-fable-5-1 \| frontier \|/);
});

test('the recommendation follows whatever the providers have now, and says when roles must share a model', async () => {
  let rec = await recommend(ctxWith({ ds: ['deepseek-chat', 'deepseek-reasoner'] }, { efforts: [] }));
  assert.equal(rec.maker.reasoningEffort, undefined, 'no effort when the model has none');
  assert.notDeepEqual(rec.maker, rec.reviewer);
  rec = await recommend(ctxWith({ one: ['only-model'] }));
  assert.equal(rec.maker.model, 'only-model');
  assert.equal(rec.notes.length, 2);
  await assert.rejects(recommend(ctxWith({})), /no models are available/);
});

test('a named model resolves by id, provider/id or name, with an optional @effort that must exist', async () => {
  const ctx = ctxWith({ a: ['claude-sonnet-5-5', 'claude-opus-5-5'] });
  assert.deepEqual(await resolveModel(ctx, 'a/claude-opus-5-5@low', 'reviewer'), { provider: 'a', model: 'claude-opus-5-5', reasoningEffort: 'low' });
  assert.deepEqual(await resolveModel(ctx, 'sonnet-5-5', 'maker'), { provider: 'a', model: 'claude-sonnet-5-5', reasoningEffort: 'medium' });
  await assert.rejects(resolveModel(ctx, 'claude-opus-5-5@ultra', 'advisor'), /has no effort "ultra"; it accepts: low, medium, high/);
  await assert.rejects(resolveModel(ctx, 'gpt-9', 'maker'), /unknown maker model gpt-9/);
});
