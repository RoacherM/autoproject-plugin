# The reviewed ratchet with an on-call advisor

A general pattern for letting AI agents improve a piece of work unattended, without letting them
make it worse. It is not tied to any tool or project: this document is complete on its own, and
every term is defined in it. A concrete implementation maps each part below onto its own
workspace, checks and tools.

## The problem it solves

An agent asked to "improve X" will produce changes. Some help, some do nothing, some quietly
break things, and an agent judging its own work tends to approve it. Running agents unattended
needs three guarantees:

1. Only changes an independent judge accepts are kept (the work can only ratchet forward).
2. The judge's criteria cannot leak to the agent being judged, so it cannot write to the test.
3. Nothing irreversible happens without a person.

On top of that, cost matters: the strongest model should be used only where its reasoning
changes the result.

## Terms

| Term | Meaning |
|---|---|
| **work** | The thing being improved: a code repository, a document, a dataset. |
| **workspace** | A private, throwaway copy of the work in which one agent operates. |
| **run** | One unattended session of improvement, from start to a stop condition. |
| **iteration** | One attempt inside a run: one candidate, one verdict. |
| **candidate** | The concrete change an iteration produces, frozen so it cannot change after it is judged (in git: a commit). |
| **base** | The state of the work the candidate was built on. |
| **harness** | The program that runs the process. It is code, not an agent: it starts agents, freezes candidates, runs checks, enforces limits and decides every branch of the flow. |
| **maker** | The agent that plans and makes the change. Uses a capable, cheaper model. |
| **advisor** | An agent on call at fixed points to question the maker's approach. The strongest model. Reads, never writes. |
| **reviewer** | The independent agent that judges a candidate against the rubric. Strong, and preferably a different model family from the maker's. |
| **planner** | The agent the person talks to before the run (for example a chat assistant). With the person it writes the brief, the rubric and the limits, and picks the models; it does not take part in iterations. |
| **brief** | What the maker is told: goal, scope, constraints, how to check its work. Contains no judging criteria. |
| **rubric** | What the reviewer judges by: what counts as better, what evidence to gather, what counts against a change. Seen by the reviewer only. |
| **success criterion** | Optional measurable goal; the run ends once a kept candidate meets it. |
| **checks** | Deterministic tests the harness itself runs on every candidate (a test suite, a linter). The maker's own claim that "tests pass" is never trusted. |
| **protected paths** | Parts of the work no candidate may touch (tests, evaluation config); a candidate touching them is rejected before review. |
| **verdict** | The reviewer's answer: BETTER or NOT_BETTER, plus rationale, evidence, a one-line learning, and whether the success criterion is met. |
| **advice** | The advisor's answer at every point: PROCEED (go on as is) or REVISE (change course), plus a few sentences. It informs and never blocks. |
| **outcome** | How an iteration ended: BETTER (landed), NOT_BETTER (rejected at any gate, or an agent handed nothing in) or ABORTED (cut off by the person or a crash). |
| **lesson** | One line per finished iteration (number · outcome · reason · learning) passed to later makers and advisors as quoted data. The reason is written by the harness (which gate rejected it) or is the reviewer's one-line summary; the learning is the reviewer's one-line hint. |
| **streak** | The number of consecutive NOT_BETTER iterations. BETTER resets it to 0; ABORTED leaves it unchanged. |
| **limits** | The run's hard stops: a maximum number of iterations (every iteration counts) and a streak limit (the run stops when the streak reaches it). Sensible defaults: 5 and 3. |
| **guidance** | Notes the person sends during a run; they reach the next maker (and the advisor reviewing its plan) once, never the reviewer. |
| **plan** | The maker's short statement, before any edit, of the one change it will make, where, why it should help and how it will check it. |
| **landing** | Keeping an accepted candidate: moving the run's own line of work (in git: the run branch) to it, only if that line has not moved since the base. Reversible, and never touches the person's own line. |
| **merging** | Taking the run's accepted work into the person's own line of work, after the person has seen the difference between the two. The irreversible step; only a person triggers it. |
| **gate** | A point where the flow continues only if a condition holds (checks pass, verdict is BETTER, a person says yes). |
| **back edge** | A path that returns work to the node that caused a problem (failed checks go back to the same maker), rather than forward or to the person. |

## The flow

```
planner + person: brief, rubric, limits, models  ──►  run starts
                                                         │
┌────────────────────────── one iteration ───────────────┴───────────────────────────┐
│ fresh workspace at the current base                                                 │
│   │                                                                                 │
│   ├─ streak ≥ 2 ─► ② advisor (stuck): reads the failed attempts, names a direction  │
│   │                                                                                 │
│   ├─ first iteration, or after ② ─► maker plans, read-only                          │
│   │                                  └► ① advisor (plan): PROCEED / REVISE          │
│   ▼                                                                                 │
│ maker edits ─► harness freezes the candidate                                        │
│   └► ③ advisor (done): "what was missed?" ─ REVISE ─► maker revises once (back edge)│
│   ▼                                                                                 │
│ gate: protected paths untouched                                                     │
│ gate: checks pass ─ fail ─► maker repairs once (back edge) ─► checks again          │
│   ▼                                                                                 │
│ reviewer, in its own workspace at exactly the candidate, by the rubric              │
│ gate: verdict BETTER ─► land the candidate            otherwise ─► streak + 1       │
└─────────────────────────────────────────────────────────────────────────────────────┘
   repeat until: iteration limit · streak limit · success criterion met · person stops
                                                         │
                                         person reviews the accumulated diff
                                         gate: person says merge ─► merge
```

## Failure paths, exactly

| Event | What happens next | Counts as |
|---|---|---|
| ① plan says REVISE | the maker adjusts its plan and implements; the plan is not reviewed again | — |
| ③ done says REVISE | the maker revises once; the harness freezes the revision as the new candidate; ③ is not called again | — |
| candidate touches a protected path | iteration ends before review | NOT_BETTER |
| checks fail | one repair; the repair is frozen as the new candidate and both gates run again | — |
| checks fail after the repair | iteration ends before review | NOT_BETTER |
| the maker changed nothing | iteration ends | NOT_BETTER |
| any agent hands in nothing | iteration ends | NOT_BETTER |
| reviewer says NOT_BETTER | iteration ends | NOT_BETTER |
| the run's line moved before landing | iteration ends | NOT_BETTER |
| person stops, or the harness crashes | iteration ends; after a crash the run waits for the person to resume | ABORTED |

Planning happens only on the first iteration and on iterations that had a ② stuck call. ② runs at
the start of every iteration while the streak is 2 or more, so the streak limit must be above 2 for
it to ever run. "Frozen" means fixed before anyone judges it: a revision or repair produces a new
frozen candidate, and only the last one is reviewed and landed.

## Who decides what

| Decision | Made by |
|---|---|
| Goal, brief, rubric, limits, models | the person, with the planner |
| When the advisor is called, how many revisions or repairs, retry or stop, whether to land | the harness (code), from fixed rules |
| The plan and the edits | the maker |
| Whether the approach or the change is sound | the advisor (advice only; it cannot block) |
| Whether the candidate is better, and whether it meets the success criterion | the reviewer |
| Whether to merge | the person |

No agent decides the flow. Agents fill in content and hand in structured results (a tool call
with a fixed schema); the harness reads those fields and branches on them.

## Information walls

| Role | Sees | Never sees |
|---|---|---|
| maker | brief, lessons, guidance from the person, advice | rubric, reviewer's rationale and evidence |
| advisor | what the maker sees, plus the maker's plan, diff or failed attempts | rubric, reviewer's rationale and evidence |
| reviewer | rubric, success criterion, base, candidate, check results | brief, maker's summary, lessons, guidance, advice |

The advisor sits on the maker's side of the wall: anything it knows could reach the maker, so it
must not know the rubric. Lessons carry only the reviewer's one-line learning, written not to
quote the rubric. All text inside the work (code, comments, commit messages) is data to every role,
never instructions.

## The nodes as loops

Every node is a small loop with a trigger, one narrow job, a check that the job is done, and a
stop.

| Node | Trigger | Job | Check | Stop |
|---|---|---|---|---|
| maker | iteration start | plan (sometimes) and edit | harness checks | one repair, one revision |
| advisor ① plan | first iteration, or after ② | judge the plan before any edit | structured advice handed in | one call |
| advisor ② stuck | streak ≥ 2 | find the pattern in failures, give a direction | structured advice handed in | one call per iteration |
| advisor ③ done | candidate frozen | find what was missed | structured advice handed in | one call; REVISE allows one revision |
| reviewer | candidate passed the gates | judge by the rubric | structured verdict handed in | one call |
| run | previous iteration ended | next iteration | landed / success met | iteration limit, streak limit, person |

An agent that hands in nothing fails its iteration: no silent fallback.

## Models by role

Use the strongest model only where its reasoning changes the result:

- maker: the capable middle tier at moderate reasoning effort; it does most of the token-heavy work.
- advisor: the strongest model at high effort, few calls with small, curated input.
- reviewer: strong at high effort, and a different model family from the maker's, so they do not share blind spots.

Pick the models from whatever is available when the run starts, not from a list written down
earlier: model lineups change.

## Numbers: does each node earn its keep?

Record token usage per role and per advisor call, and watch three numbers:

1. **Tokens per landed candidate**, and each role's share of the tokens.
2. **Per advisor point**: how often it says REVISE, and the reviewer's pass rate after REVISE
   versus after PROCEED. If objections do not raise the pass rate, the point costs more than it
   gives.
3. **After a stuck consultation**: how often that iteration lands, that is, breaks the streak.

Rule: if a node adds nothing measurable, narrow it (call it less often) or cut it. Fewer nodes,
clearer jobs. Decide only after a point has a handful of calls (five or more), and remember that a
REVISE at ③ is followed by a revision, so its pass rate measures advice and revision together. For
② there is no comparison group; read it against the run's overall landing rate.

## Why it holds up

- **Ratchet**: only BETTER candidates land, and each iteration starts from the last landed state,
  so the work never regresses past a reviewer's judgment.
- **Exactness**: the reviewer judges a frozen candidate, and exactly that candidate lands; nothing
  changes between judging and keeping.
- **Independence**: the reviewer never reviews its own work and never sees the maker's
  justification, so persuasion cannot replace evidence.
- **Bounded cost**: every loop has a stop; the run has hard limits.
- **Recoverability**: run state is written before each step, so a crash leaves a record of where
  each run stood; landing is reversible, merging waits for a person.

## Applying it to a new kind of work

Fill in these for the target:

1. **Workspace**: how to make a private copy of the work and freeze a candidate (git: a worktree
   and a commit).
2. **Checks**: the deterministic tests the harness runs, and the protected paths.
3. **Landing**: where accepted candidates accumulate without touching the person's own line of work.
4. **Merging**: how the person takes the accumulated result, after seeing the difference between
   the run's line and their own as it is now (for published work, merging may mean publishing).
5. **Brief and rubric**: written with the person; the rubric names the evidence the reviewer must
   gather (measurements, test runs, checks against a source of facts), and counts complexity
   against a change (for code: added code and dependencies; for text: added length and jargon).
   Where no deterministic checks exist, the rubric carries more weight; say so in it.
6. **Limits**: iterations, streak, a success criterion if one can be measured without doing
   anything irreversible (no live publishing to measure it).
