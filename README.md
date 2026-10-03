# autoproject v2

A DSH plugin that improves a local git repository unattended. Agents propose changes one at a
time; an independent agent judges each one; only accepted changes are kept, on a branch of their
own; the person merges the result when they choose. This document is complete on its own: it
describes the whole flow and defines every term, so neither the code nor `docs/paradigm.md` (the
same pattern written for any project) is needed to understand it.

v2 is not compatible with v1. v1 runs (in `~/.dsh/plugin-data/autoproject/`) stay on disk and are
not loaded.

## Terms

| Term | Meaning here |
|---|---|
| **DSH** | DeepSeek Harness, the agent app this plugin runs in. A plugin adds tools for the chat agent and pages to the app. |
| **chat agent** | The agent the person talks to in DSH. It plans the run with the person and calls the tools below. |
| **run** | One unattended improvement session on one repository, named by a **slug** (lowercase-hyphen, e.g. `speed-up-parser`). One run per repository at a time. |
| **iteration** | One attempt inside a run, numbered from 1: one candidate, one verdict. |
| **harness** | This plugin's engine (`src/host/engine.js`): code, not an agent. It starts the agents, commits, runs checks, enforces limits and decides every branch of the flow. |
| **role / agent session** | A maker, advisor or reviewer is a separate DSH session, shown as a child of the chat that started the run. Each step of its work ends when it calls that step's submit tool, whose arguments are the step's result: maker `submit_plan` and `submit_candidate`, advisor `submit_advice`, reviewer `submit_verdict`. |
| **maker** | The agent that plans and edits. Default model: the best standard-tier model available (e.g. Sonnet) at medium effort. |
| **advisor** | The agent on call at three points (below) to question the maker's approach. Default: the strongest model (e.g. Fable) at high effort. Read-only. |
| **reviewer** | The agent that judges a candidate against the rubric. Default: the strongest model of another family than the advisor's (e.g. Opus) at high effort. |
| **worktree** | A separate git checkout of the same repository in its own folder (`~/.dsh/plugin-data/autoproject-v2/worktrees/<slug>/<role>`). Each iteration makes one maker worktree, used by the maker through all its steps and by the advisor (read-only), and one reviewer worktree; both are deleted when the iteration ends. |
| **base** | The commit an iteration starts from: the current head of the run branch. |
| **candidate** | The commit the harness makes from the maker's worktree (fixed commit message, so it carries no instructions). Every candidate is kept as `refs/autoproject/<slug>/<n>` even if rejected. |
| **brief** | What the maker is told: goal, scope, constraints, checks, repo context. No judging criteria. |
| **rubric** | What the reviewer judges by. Only the reviewer sees it. |
| **success criterion** | Optional goal; the run stops when a landed candidate meets it (reviewer says MET). |
| **checks** | An optional shell command (e.g. `npm test`) the harness runs on each candidate in its worktree. Exit code 0 passes; anything else, or running longer than 10 minutes, fails. Without a command there are no checks. |
| **protected paths** | Globs (`test/`, `**/*.test.js`) a candidate may not touch; such a candidate is rejected before review. |
| **lesson** | One line per finished iteration, `n · outcome · reason · learnings`, quoted to later makers and advisors (the last ten). The reason is written by the harness (where it was rejected) or is the reviewer's one-line summary; learnings are the reviewer's one-line hint, empty when no reviewer saw the candidate. Learnings are the only reviewer text the maker side ever sees; the reviewer is told not to quote the rubric in them. |
| **guidance** | Text the person sends mid-run ("steer"). Everything queued since the last maker started reaches the next maker and its plan advisor once, never the reviewer; it stays in the run record, marked as sent. |
| **outcome** | How an iteration ended: BETTER (landed), NOT_BETTER (rejected anywhere: no change, protected path, failed checks, an agent handed nothing in, reviewer said NOT_BETTER, landing failed), ABORTED (stopped by the person, or cut off by a DSH restart). |
| **streak** | Consecutive NOT_BETTER iterations. BETTER resets it to 0; ABORTED leaves it as it is. |
| **status** | Of a run: `running`, `paused` (by the person, or after a DSH restart; resumable) or `stopped` (final). |
| **limits** | `max_iterations` (default 5; every iteration counts, ABORTED included) and `streak_limit` (default 3; the run stops when the streak reaches it). |
| **run branch** | `autoproject/<slug>`, created from the person's branch when the run starts. Accepted candidates land here. |
| **target** | The person's branch the run started from (e.g. `main`). Changes only when the person merges. |
| **landing** | Moving the run branch to an accepted candidate, as one compare-and-swap (`git update-ref` with the expected old value). Never touches the person's checkout. |
| **merging** | Taking the run branch into the target in the main checkout: fast-forward if the target has not moved, else a merge commit; a conflict is aborted and reported. Only on the person's request. |
| **effort** | The reasoning effort a model is asked for. Each model's adapter in DSH reports which efforts it accepts (names such as `low`, `medium`, `high`; the set differs per model). |
| **advice** | The advisor's answer: PROCEED (go on as is) or REVISE (change course), plus a few sentences. It only informs: the maker may weigh and reject it, and nothing is blocked by a REVISE. |
| **phase** | A named step of an iteration, recorded with its start time: `setup`, `advise_stuck`, `plan`, `advise_plan`, `maker`, `advise_done`, `revise`, `checks`, `repair`, `review`, `landing`. |

## The flow

```
chat agent + person: autoproject_models → draft brief, rubric, limits → autoproject_start
                                                         │ person presses Go
                                         run branch autoproject/<slug> created from target
┌──────────────────────────────── one iteration ─────────┴────────────────────────────────┐
│ fresh maker worktree at the run branch head (base)                                        │
│   ├─ streak ≥ 2 ─► advise_stuck: advisor reads the failed attempts → direction for maker  │
│   ├─ iteration 1, or after advise_stuck ─► plan: maker explores read-only, submit_plan    │
│   │                                       └► advise_plan: advisor → PROCEED / REVISE      │
│   ▼                                                                                       │
│ maker: maker edits, submit_candidate → harness commits the candidate                     │
│   └► advise_done: advisor reads the diff → REVISE ─► revise: maker revises once, recommit│
│   ▼                                                                                       │
│ protected-path gate → checks; fail ─► repair: maker fixes once ─► gate + checks again   │
│   ▼                                                                                       │
│ review: reviewer in a fresh worktree at exactly the candidate, by the rubric             │
│   ▼                                                                                       │
│ BETTER ─► landing: run branch moves to the candidate        else ─► NOT_BETTER, streak+1 │
└───────────────────────────────────────────────────────────────────────────────────────────┘
  stop when: iteration limit · streak limit · success MET · person stops
  then the harness posts a report into the chat; the chat agent tells the person and offers
  autoproject_merge, which shows the diff and merges into the target only if the person says so
```

The words before a colon in the diagram (`advise_stuck`, `plan`, …) are the phases.

## Who decides what

| Decision | Decided by |
|---|---|
| goal, brief, rubric, limits, models | the person, with the chat agent |
| when the advisor is called, one revision / one repair, retry, stop, landing | the harness, by the rules above |
| plan and edits | maker |
| PROCEED / REVISE (advice only, cannot block) | advisor |
| BETTER / NOT_BETTER, MET / NOT_MET / N/A | reviewer |
| merge into the target | the person (Merge in the dialog or on the board) |

The advisor's advice never blocks anything. But an agent that hands in nothing at all (no submit
call, whatever its role) fails its iteration with NOT_BETTER: nothing falls back to a default.

## Rules in detail

- **Iteration start**: the base is the run branch head. If the streak is 2 or more, `advise_stuck`
  runs first, on every such iteration; with `streak_limit` 2 it never gets the chance.
- **Planning** happens on iteration 1 and on every iteration that had `advise_stuck`, never
  otherwise. A REVISE on the plan is passed to the maker with the request to implement; the plan
  is not reviewed again.
- **Committing**: the harness commits every file in the worktree (new ones included, ignored ones
  not) after each `submit_candidate`. A submit that changes nothing ends the iteration as "maker
  changed nothing". After a revision or repair the candidate is the newest commit, and
  `refs/autoproject/<slug>/<n>` points to it.
- **Order of gates**: `advise_done` (one revision at most) → protected paths → checks → if they
  fail, one `repair` → protected paths and checks again → `review`. The reviewer is told which
  check command passed, so it knows the tests ran.
- **Review**: on every reviewed candidate the reviewer also answers MET / NOT_MET / N/A for the
  success criterion. The run stops on MET only if that candidate also landed.
- **Landing** fails only if the run branch moved since the base (something else changed it); the
  iteration is then NOT_BETTER.
- **Stopping**: `stop` cancels the running agent and the iteration is ABORTED; a landing already
  underway completes. `pause` lets the current iteration finish first.
- **One run per repository**: a running or paused run blocks a new one on the same repository.
- **Merging**: allowed when the run is paused or stopped; not while running. A paused run may be
  resumed after a merge. Run branches and candidate refs are never deleted automatically.
- **After a restart**: a run that was mid-iteration gets that iteration recorded as ABORTED,
  and the run is `paused` until the person resumes it; resuming starts the next iteration in
  fresh worktrees (leftover ones are replaced).

## What each role sees

| Role | Sees | Never sees |
|---|---|---|
| maker | brief, lessons, guidance, advice, and a section explaining this process | rubric, reviewer rationale and evidence |
| advisor | brief, lessons, guidance, the plan / diff / failed candidates, the same process section | rubric, reviewer rationale and evidence |
| reviewer | rubric, success criterion, base and candidate SHAs, diff stat, check result, its own process section | brief, maker summary, lessons, guidance, advice |

Each role's prompt (`src/host/prompts.js`) explains the process as far as that role may know it
and defines its terms, so the agent needs nothing else to understand its job.

## Tools for the chat agent

| Tool | Does |
|---|---|
| `autoproject_models` | Lists every model of every provider DSH has right now, best first, with the recommended model and effort per role. Computed fresh on every call. |
| `autoproject_start` | Starts a run after the person presses Go in a summary dialog (repo, run branch, limits, checks, protected paths, the three models, brief, rubric). Any role not named gets the live recommendation. A model is named as `provider/model`, a model id or a display name, optionally `@effort`. |
| `autoproject_status` | Per run: status, limits, landings, merges, the numbers below, one row per iteration with tokens per role. Without a slug, also the numbers across all runs. `verbose` adds plans, advice, rationales, session ids. |
| `autoproject_control` | `steer` (queue guidance), `pause` (after this iteration), `resume`, `stop` (cancels the running agent). |
| `autoproject_merge` | For a paused or stopped run: shows the commits and diff stat of the run branch against the target and merges only if the person picks Merge. The main checkout must be on the target and clean. |

When a run stops or pauses, the harness posts a report into the chat that started it.

## Models

DSH reports only model ids and names (no price, no tier). The recommendation is computed from the
providers configured at the moment of asking, with a tier guessed from the name:

- frontier: fable, opus, names with `pro` / `ultra` / `max`;
- small: haiku, and names with a separate `mini` / `nano` / `flash` / `lite` / `small` / `tiny`;
- standard: sonnet and every unknown name.

Ranking ("best"): higher tier first; then family rank (fable above opus above other frontier names,
sonnet above other standard names); then the version number in the model id (5.5 above 4.6); then
the provider of DSH's default model. The first rule that matches a name decides its tier (so
`flash-lite` is small even if it also said `pro`). A **family** is `fable`, `opus` or `sonnet` for
those models, otherwise the model name without its version (`gpt`, `deepseek-chat`).

- advisor = best overall;
- reviewer = best model of another family than the advisor's, else the advisor's model;
- maker = best standard-tier model other than the reviewer's, else the best small one, else
  whatever is left; when only one model exists all roles share it and the recommendation says so.

Effort is set only if the model accepts it (maker medium; reviewer, advisor high). A model named
with an `@effort` it does not accept is refused with the list of efforts it does accept.

## Numbers: does each node earn its tokens?

Every role session sums the token usage of its model calls. Tokens = input + output as the provider
reports them; cache reads are a separate field and are shown apart. DSH keeps no price table, so these
are tokens, not money. Every advisor point, `advise_stuck` included, answers PROCEED or REVISE, so
each has a REVISE rate.

1. tokens per landed candidate, and each role's share;
2. per advisor point: calls, how often REVISE, and the reviewer's pass rate after REVISE vs after
   PROCEED (an objection that does not raise it is not worth its tokens);
3. after `advise_stuck`: how often that iteration landed.

Deciding is the person's job, with these numbers from `autoproject_status`: once a point has at
least five calls, a REVISE that does not raise the pass rate, or a stuck consultation that never
leads to a landing, means the point should be narrowed (called less often) or removed from the
engine. Note that a REVISE at `advise_done` is followed by a revision, so its pass rate measures
advice plus revision together.

## The board

The left sidebar entry "自动迭代 / Autoproject" opens a board with one card per iteration:

- To Do: the next iteration of a running or paused run;
- In Progress: every maker and advisor phase, checks and repair;
- In Review: review and landing;
- Done: landed on the run branch;
- Cancelled (a tab): NOT_BETTER and ABORTED.

A card's drawer shows:
- the phases with their durations;
- the plan;
- each piece of advice, with its tokens and a link to the advisor's session;
- the maker's summary and the reviewer's verdict;
- tokens per role;
- the run's numbers and models;
- Pause / Resume / Stop / Steer;
- when the run is paused or stopped and its branch has commits the target lacks, a Merge button
  that needs two clicks (the second confirms).

The protected-path gate and landing failures show as Cancelled cards with their reason.

## Data kept

One JSON file per run in `~/.dsh/plugin-data/autoproject-v2/runs/<slug>.json`, written before
every step so a DSH restart knows where the run stood. A run that was mid-iteration at a restart
records that iteration as ABORTED and waits to be resumed.

**Per run:**
- `repo`, `target`, `branch` (the run branch), `from` (the target commit it started at);
- `brief`, `rubric`, `success`, `checkCommand`, `protectedPaths`;
- `limits`, `models`, `status`, `streak`, `guidance`;
- `merges[]`, `iterations[]`.

**Per iteration:**
- `base`, `sha`, `plan`, `makerSummary`;
- `advice[]` (`point`, `verdict`, `advice`, `sessionId`, `usage`);
- `usage` per role;
- the flags `stuck`, `revised`, `repaired`;
- the reviewer's `verdict`, `success`, `summary`, `rationale`, `evidence`, `learnings`;
- `landing` (LANDED / FAILED), `outcome`, `reason`;
- a `timeline` of phases.

## Code map

| File | Holds |
|---|---|
| `src/host/engine.js` | the harness: iteration, stop rules, landing, merge, restart recovery |
| `src/host/prompts.js` | every role's prompt and submit tool schema |
| `src/host/roles.js` | how a role session is started: model, per-turn read-only or write sandbox, tool restrictions, usage |
| `src/host/models.js` | live model catalog, tier heuristic, recommendation, `model@effort` |
| `src/host/git.js`, `checks.js` | every git command; the checks runner and protected-path globs |
| `src/host/index.js`, `routes.js` | the chat tools; the board's HTTP routes |
| `src/shared/board.js`, `metrics.js` | board columns; the numbers |
| `src/client/` | the board page |
| `docs/paradigm.md` | the same pattern, written for any project |

## Develop

```sh
npm test          # node --test: real git repos in tmp, fake agents
npm run build     # client.js
npm run deploy    # test + build, then copy into the desktop profile; restart DSH to load it
```

DSH loads plugins per profile; the desktop app uses the **desktop profile**
(`~/.dsh/profiles/desktop/`), which lists this plugin as a bundle and installs this folder as a `file:` copy that `pnpm install` does not refresh, so
`deploy` copies `src/`, `client.js`, `package.json` and `cordis.patch.yml` itself. DSH caches the
loaded module: toggling the bundle does not pick up new code, a restart does.
