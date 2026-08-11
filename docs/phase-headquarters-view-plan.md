# Planning gate — Headquarters View

**Status:** awaiting approval. Nothing implemented.

**Objective.** One institutional view over one case that has travelled the
complete workflow. A portfolio manager or CIO opens a case and sees the thesis,
evidence, contributions, verification, devil's advocate, risk, eligibility, the
CIO submission, the decision, dissent, the timeline, and the policy version that
governed it.

---

## 1. The fact that shapes everything below

**No user interface has ever read real analysis data.**

`agents.tsx`, `portfolio.tsx` and `reports.tsx` render `~/data/mockData`. There
is no server-function boundary for the analysis runtime — `src/infrastructure/`
publishes one for market data and nothing for the institution. `presentation/
analysis/` contains a single string helper.

So this is not "add a page". It is **the first channel between the institution
and a human**, and the first time anything outside the test suite reads what the
firm recorded. That is why it deserves a gate of its own rather than being
treated as UI work on top of finished plumbing.

## 2. What already exists, and what does not

Every one of the twelve items is reachable through existing repositories. **No
new table, column or migration is required**, and the plan does not propose one.

| Item | Source | Status |
|---|---|---|
| Thesis + revisions | `theses.listForCase` | stored |
| Evidence | `evidenceSets.get` via runs | stored |
| Contributions | `claims.listForCase`, `runs.listForCase` | stored |
| Verification | `reviews.verificationsForCase` | stored |
| Devil's Advocate | `reviews.challengesForCase` | stored |
| Risk | `reviews.riskForCase` + `requirements.listForCase` | stored |
| CIO submission | `submissions.applicableForRevision` | stored |
| Decision | `decisions.getForCase` / `historyForCase` | stored |
| Dissent | `decision.unresolvedDissent` | stored |
| Timeline | `events.listForCase` | stored |
| Policy version | `submission.basis.eligibilityPolicyVersion` | stored |
| **Eligibility** | `evaluateEligibilityGates(basis, policy)` | **derived** |

Eligibility is the only derived item, and §4 is entirely about it.

## 3. The read boundary

A new `createServerFn` surface, `src/infrastructure/analysis/serverFns.ts`, is
the **only** thing the browser may reach. The existing fitness rule
`no-ui-import-of-infrastructure` already enforces this and needs no change.

The assembly itself lives in the **application** layer
(`src/application/analysis/caseOverview.ts`), not in the server function and not
in a component:

```
repositories ──► caseOverview (application) ──► serverFn (infrastructure)
                                                   │
                                                   ▼
                                            route + components
```

**Why assembly is not in the server function.** A server function is a transport
boundary. Putting the reading logic there would make it unreachable from the
PostgreSQL suite, which is where this must be proven against a case that
actually travelled — and "untestable except through HTTP" is how the last five
defects stayed invisible.

**The view issues no commands.** Read-only in this stage. Publication and
reconsideration are separate milestones and build on this one.

## 4. The decision that matters: recorded eligibility, not recomputed

A case decided in March was judged under the policy in force in March. Opening
it in July must not show it re-judged under July's policy.

The view therefore shows **the basis as stored**, evaluated under **the policy
version the basis names** — `eligibilityPolicy(basis.eligibilityPolicyVersion)`,
never "the current one". This is the same rule the evaluators already follow and
the reason `challengeBlocksAtOrAbove` became a parameter.

Two distinct questions exist and both are legitimate:

1. **"What did the firm conclude then?"** — the stored basis under its own
   policy. This is what a decision record means.
2. **"What would it conclude now?"** — today's facts under today's policy.

They must never be rendered as one number. This plan implements **(1) only**.
(2) is a separate feature with its own labelling problem, and shipping it
unlabelled beside (1) would let a reader mistake a hypothetical for a record.

For a case with **no submission yet**, there is no stored basis and therefore no
recorded eligibility. The view says *not yet submitted* — it does **not**
silently fall back to evaluating current facts under a default policy, which
would be a default policy by the back door.

## 5. What the view must not do

- **No new storage, no cache, no denormalised "case summary" row.** Everything
  is assembled per read.
- **No recomputation presented as a record** (§4).
- **No policy defaulting.** If a basis names a policy version that no longer
  resolves, the view says so and shows the rest; it does not substitute one.
- **No blocking judgement of its own.** Whether a challenge or disagreement
  blocks comes from the gate report, never from a comparison in a component.
  The `challenge-threshold-only-in-the-gate` rule already covers components.
- **No agent surface.** The standing constraint holds: this shows the
  institution, not staff. `agents.tsx` and its mock data are untouched by this
  plan — whether the mock page should survive is a separate question, and
  yours.

## 6. Open questions for your ruling

**6.1 Language.** The existing UI is Swedish (`Agenter`, `Dina agenter…`) while
the entire domain vocabulary is English (`decision-critical`, `verified`,
`CHALLENGE_UNRESOLVED`). Options: Swedish chrome with English domain terms
verbatim; Swedish throughout with a translation layer for domain codes; or
English for this surface. **Recommendation: Swedish chrome, domain terms
verbatim** — a governance code is an identifier, and translating
`decision-critical` invents a second vocabulary for the same fact. But this is
a house-style call.

**6.2 Route shape.** `/cases/$caseId` as a new top-level nav entry, or nested
under an existing one? The nav layout is recorded as finished, so adding an
entry touches something explicitly locked. **Recommendation: `/cases/$caseId`
reachable by URL in this stage, with no nav change**, so the locked layout is
untouched until you decide it should change.

**6.3 The case list.** Twelve items describe *one* case. Reaching it needs
either a list or a known id. **Recommendation: defer the list**; this stage
proves the single-case view against the case the flow test creates. A list is
its own small milestone with its own sorting and filtering questions.

## 7. Verification strategy

1. **Against a case that actually travelled.** The PostgreSQL suite already
   drives one from intake to a recorded decision (`cioDecision.pg.test.ts`). The
   overview is asserted against *that* case — not a fixture — so it cannot pass
   against a shape the workflow does not produce.
2. **All twelve present.** Each item asserted individually, so a silently
   missing section fails rather than rendering empty.
3. **Recorded, not recomputed.** A case whose stored basis names policy v1 shows
   v1's verdict even when evaluated in a process where another policy exists.
   This is the §4 assertion and the one worth planting a violation against.
4. **The non-material open challenge is visible and marked non-blocking** — the
   state the previous stage made reachable, now shown as it was recorded.
5. **Dissent survives to the screen.** A decision carrying disclosed dissent
   renders it; the view cannot quietly present a unanimous record.
6. **Restart.** The overview is identical when read through a runtime that never
   saw the case being built.
7. **Boundary.** No component imports infrastructure — the existing fitness rule,
   which must be *selected* on the new files, not merely present.
8. **Absence is not emptiness.** A case with no submission shows "not yet
   submitted", distinct from a submission whose gates all passed.

## 8. Exit criteria

- [ ] `/cases/$caseId` renders all twelve items for the fully-travelled case
- [ ] Eligibility shown is the stored basis under the policy the basis names
- [ ] A case with no submission is distinguishable from one with a clear basis
- [ ] Non-material open challenge visible and marked non-blocking
- [ ] Dissent rendered when present
- [ ] Timeline ordered, with each case movement naming its actor
- [ ] Overview identical across a restart
- [ ] Assembly is application-layer and covered by the PostgreSQL suite
- [ ] No new table, column, migration, or cached summary
- [ ] Both suites green; typecheck clean; no change to locked surfaces

## 9. What this stage will not do

- No publication, no reconsideration, no command issuing
- No case list, no search, no filtering
- No agents, no LLM
- No change to the nav, the hero, the charts, the globe, or the network layer
- No "current eligibility" recomputation (§4)
