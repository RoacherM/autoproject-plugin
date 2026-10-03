/**
 * Models for the three roles, read live from the providers DSH has right now — never from a list
 * kept in this plugin. DSH reports only ids and names (no price, no tier), so the tier comes from
 * a name heuristic (`classify`); everything else (which models exist, which efforts each accepts)
 * comes from the `llm` service at the moment of asking.
 *
 * A model is written "provider/model", a bare model id or a display name, optionally with
 * "@effort" at the end ("claude-sonnet-5-5@medium").
 */

/** The effort each role asks for when its model supports it: builders on medium, judges on high. */
export const ROLE_EFFORT = { maker: 'medium', reviewer: 'high', advisor: 'high' };

/** What each role does, for the recommendation text. */
const ROLE_JOB = {
  maker: 'plans, edits and runs the checks; the cheaper capable tier',
  reviewer: 'judges each candidate against the hidden rubric; strong, and a different model from the maker',
  advisor: 'on call before a plan, when failures repeat, and before a candidate is handed in; the strongest model',
};

const TIER_NAME = { 3: 'frontier', 2: 'standard', 1: 'small' };

/**
 * Tier (3 frontier, 2 standard, 1 small) and family rank from the model's id and name. First match
 * wins, so "flash-lite" is small before "pro" could make it frontier. Size words must stand alone
 * ("gpt-5-mini" is small, "gemini" is not). Unknown names are standard.
 */
const RULES = [
  [/fable/, 3, 3, 'fable'],
  [/opus/, 3, 2, 'opus'],
  [/haiku|(^|[-_/ .])(mini|nano|flash|lite|small|tiny)($|[-_ .\d])/, 1, 0, null],
  [/sonnet/, 2, 2, 'sonnet'],
  [/(^|[-_/ .])(pro|ultra|max)($|[-_ .])/, 3, 1, null],
];

/** "claude-opus-5-5" → 5.5, "gpt-4.1" → 4.1; date stamps (4+ digits) are not versions. */
function version(text) {
  const m = /(?:^|[^\d])(\d{1,2})(?:[.-](\d{1,2}))?(?!\d)/.exec(text);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0) : 0;
}

export function classify(model) {
  const text = `${model.id} ${model.name ?? ''}`.toLowerCase();
  for (const [re, tier, rank, family] of RULES) {
    if (re.test(text)) return { tier, rank, family: family ?? familyOf(model.id), version: version(model.id) };
  }
  return { tier: 2, rank: 0, family: familyOf(model.id), version: version(model.id) };
}

/** "deepseek-official/claude/claude-opus-5-5" → "claude-opus"; the part a model shares with its siblings. */
const familyOf = (id) => id.split('/').pop().replace(/[-_.]?\d.*$/, '').toLowerCase();

/** Every model of every provider DSH has registered right now, each classified. */
export async function catalog(ctx) {
  const llm = ctx.get?.('llm');
  if (!llm) throw new Error('the llm service is not available, so no models can be listed');
  const models = [];
  const failed = [];
  for (const provider of llm.listProviders()) {
    try {
      for (const m of await llm.listModels(provider.id)) {
        models.push({ provider: m.provider ?? provider.id, providerName: provider.name, id: m.id, name: m.name || m.id, ...classify(m) });
      }
    } catch (error) { failed.push(`${provider.id}: ${error.message}`); }
  }
  return { models, failed };
}

/** Higher tier, then family rank, then version; the default model's provider breaks ties. */
function better(a, b, home) {
  return (b.tier - a.tier) || (b.rank - a.rank) || (b.version - a.version) || ((b.provider === home) - (a.provider === home));
}

/** The efforts a model accepts, from its adapter; [] when it has no reasoning control. */
async function effortsOf(ctx, provider, model) {
  const info = await ctx.get('llm').resolveModelInfo(provider, model);
  return (info.reasoning?.efforts ?? []).map((e) => String(e.id));
}

async function withEffort(ctx, pick, wanted, explicit) {
  const efforts = await effortsOf(ctx, pick.provider, pick.id).catch(() => []);
  if (wanted && efforts.includes(wanted)) return { provider: pick.provider, model: pick.id, reasoningEffort: wanted };
  if (wanted && explicit) throw new Error(`${pick.provider}/${pick.id} has no effort "${wanted}"; it accepts: ${efforts.join(', ') || 'none'}`);
  return { provider: pick.provider, model: pick.id };
}

/**
 * The recommended model for each role, from the live catalog:
 *   advisor  — the best model there is;
 *   reviewer — the best model of another family than the advisor (Opus beside Fable), else the advisor's;
 *   maker    — the best standard-tier model (Sonnet), else the best small one, else whatever is left —
 *              never the reviewer's model when there is any other.
 * @returns { maker, reviewer, advisor, notes[], models, failed }
 */
export async function recommend(ctx) {
  const { models, failed } = await catalog(ctx);
  if (!models.length) throw new Error(`no models are available${failed.length ? ` (${failed.join('; ')})` : ''}`);
  const home = ctx.agentDefaultModel?.currentSelection?.()?.provider;
  const ranked = [...models].sort((a, b) => better(a, b, home));
  const notes = [];

  const advisor = ranked[0];
  const reviewer = ranked.find((m) => m.family !== advisor.family && m.tier >= 2) ?? advisor;
  if (reviewer === advisor) notes.push('only one strong model family is available, so the reviewer and the advisor share a model');
  const others = ranked.filter((m) => !(m.provider === reviewer.provider && m.id === reviewer.id));
  const maker = others.find((m) => m.tier === 2) ?? others.find((m) => m.tier === 1) ?? others[0] ?? reviewer;
  if (maker === reviewer) notes.push('only one model is available, so the maker and the reviewer share it');

  return {
    maker: await withEffort(ctx, maker, ROLE_EFFORT.maker),
    reviewer: await withEffort(ctx, reviewer, ROLE_EFFORT.reviewer),
    advisor: await withEffort(ctx, advisor, ROLE_EFFORT.advisor),
    notes, models: ranked, failed,
  };
}

/** Resolve what the user named for one role: "provider/model", a model id or a display name, with an optional "@effort". */
export async function resolveModel(ctx, input, role) {
  const raw = String(input).trim();
  const at = raw.lastIndexOf('@');
  const wanted = at > 0 ? raw.slice(0, at) : raw;
  const effort = at > 0 ? raw.slice(at + 1) : undefined;
  const { models } = await catalog(ctx);
  const lower = wanted.toLowerCase();
  const match = models.find((m) => `${m.provider}/${m.id}` === wanted)
    ?? models.find((m) => m.id === wanted)
    ?? models.find((m) => m.name.toLowerCase() === lower)
    ?? models.find((m) => m.id.toLowerCase().endsWith(lower) || m.name.toLowerCase().includes(lower));
  if (!match) throw new Error(`unknown ${role} model ${wanted}; run autoproject_models for the available ones`);
  return withEffort(ctx, match, effort ?? ROLE_EFFORT[role], effort !== undefined);
}

export const modelLabel = (m) => `${m.provider}/${m.model}${m.reasoningEffort ? `@${m.reasoningEffort}` : ''}`;

/** The recommendation and the catalog as the chat agent shows them to the user. */
export function describeRecommendation(rec) {
  const lines = [
    'Recommended models (computed now from the providers DSH has configured; the tier is a name heuristic):',
    ...['maker', 'reviewer', 'advisor'].map((role) => `- ${role}: ${modelLabel(rec[role])} — ${ROLE_JOB[role]}`),
    ...rec.notes.map((n) => `- note: ${n}`),
    '',
    'All available models, best first:',
    '| model | name | tier |',
    '|---|---|---|',
    ...rec.models.map((m) => `| ${m.provider}/${m.id} | ${m.name} | ${TIER_NAME[m.tier]} |`),
  ];
  if (rec.failed.length) lines.push('', `Providers that could not list models: ${rec.failed.join('; ')}`);
  return lines.join('\n');
}
