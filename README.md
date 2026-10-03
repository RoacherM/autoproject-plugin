# autoproject v2

An unattended, independently reviewed improvement ratchet on a local git repository, for DSH.
v2 splits the work across three roles on three models and is not compatible with v1: v1 runs
(`~/.dsh/plugin-data/autoproject/`) are left on disk and not loaded; v2 keeps its runs in
`~/.dsh/plugin-data/autoproject-v2/`.

## Roles

| Role | Default model | Sees | Does |
|---|---|---|---|
| chat agent (planner) | whatever the chat runs on | everything | drafts Brief, Rubric, Limits with the user; shows the model recommendation; starts, steers, stops |
| maker | best standard-tier model (e.g. Sonnet) @medium | Brief, lessons, guidance, advice | plans (read-only), edits, runs the checks |
| advisor | best model there is (e.g. Fable) @high | what the maker sees + its plan / diff / recent failures | advises at three points; never writes code; read-only |
| reviewer | best model of another family (e.g. Opus) @high | Rubric, success criterion, the two SHAs | judges one commit; its verdict decides landing |

The rubric reaches only the reviewer. The advisor never sees the rubric or a reviewer's rationale
or evidence, so its advice cannot carry the rubric to the maker. The reviewer never sees the advice.

## One iteration

```
fresh maker worktree at the branch head
  │
  ├─ streak ≥ 2 ──► ② advisor: "are we digging in the wrong place?" → direction for this maker
  │
  ├─ iteration 1, or after ② ──► maker plans (read-only) ──► ① advisor reviews the plan
  │
  ▼
maker edits → harness commits → ③ advisor: "what did I miss?" ──REVISE──► one maker revision
  │
  ▼
protected-path gate → checks (one repair round) → reviewer (fresh worktree, hidden rubric)
  │
  ▼
BETTER → fast-forward exactly the reviewed SHA      anything else → NOT_BETTER, streak + 1
```

Decided by code (`src/host/engine.js`): when the advisor is called, that its objection gets
exactly one revision, retry, stop, landing. Decided by an agent: the plan, the edits, the advice,
the verdict. Every advisor call is a fresh read-only session that ends with `submit_advice`
(`PROCEED` or `REVISE` plus a few sentences); an advisor that hands nothing in fails the iteration.

## Models

`autoproject_models` lists every model of every provider DSH has right now and recommends one per
role; `autoproject_start` uses the same live recommendation for any role the user does not name.
DSH reports only model ids and names, so the tier is a name heuristic (`classify` in
`src/host/models.js`): fable/opus/`-pro` are frontier, sonnet and unknown names standard,
haiku/mini/nano/flash/lite small. Efforts come from each model's adapter; a role gets its effort
(maker medium, reviewer and advisor high) only when the model accepts it. Name a model as
`provider/model`, a model id or a display name, optionally with `@effort`.

## Data kept per iteration

`plan`, `advice[]` (`point` stuck/plan/done, `verdict`, `advice`, `sessionId`), `stuck`, `revised`,
`repaired`, `makerSummary`, `sha` (also `refs/autoproject/<slug>/<n>`), the reviewer's verdict
fields, `outcome`, `reason`, and a `timeline` of the nodes above for the board.

## Develop

```sh
npm test          # node --test, against real git repos in tmp and fake roles
npm run build     # client.js
```
