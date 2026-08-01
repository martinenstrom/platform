# Phase C1C-4 — governance, and the revision it is allowed to speak about

**Status:** planning gate. Nothing here is implemented.

C1C-3 produced an immutable, manager-aggregated revision and the record of how
it was assembled. C1C-4 puts that exact revision in front of the three control
functions, records what they found, and derives whether it may reach the CIO.

It stops one step short of the CIO. `SubmitForCioDecision` and `CaseDecision`
are C1D.

---

## 0 · What C1C-4 is, in one paragraph

Four commands move a revision through review and record three verdicts against
it. A revision under review is frozen: no governance command may touch thesis
content, claims, implications, invalidation criteria, aggregation dispositions
or evidence references, and a required correction produces later work and a new
revision rather than an edit to the reviewed one. An adapter translates the
durable conditional-requirement state into the Risk gate input the domain
already expects, and `evaluateRevisionEligibility` — unchanged as the sole
authority — produces the answer. No CIO decision, no Agents UI, no LLM.

### Not in scope

| Excluded                          | Where it belongs                                     |
| --------------------------------- | ---------------------------------------------------- |
| `SubmitForCioDecision`            | C1D                                                  |
| `RecordCaseDecision`              | C1D                                                  |
| Compliance review                 | publication, not decision eligibility — C1D or later |
| The Agents headquarters migration | C1D, with TD-36                                      |
| Any model client                  | C2                                                   |
| Abandoned-run recovery            | TD-34, still a hard gate before a live provider      |

Compliance is deliberately left out. `ComplianceReview` exists in the domain and
`evaluateGate` already reads it, but compliance answers "may we publish this",
which gates `eligibleForPublication`, not `eligibleForDecision`. Adding it here
would mean building a governance function whose verdict C1C-4 cannot act on.

---

## 1 · Decisions

### D-C1C4-1 · Submission is a workflow movement, and never an approval

`SubmitForVerification` moves the case's workflow into review. It is not a
verdict, it does not pre-approve anything, and it emits no event that could be
read as one. It moves the revision `under-analysis → awaiting-verification`,
which is the lifecycle's own word for "waiting to be checked".

The strongest form of this is structural: the command has **no status, outcome
or verdict field in its input**, the same shape that closed TD-29 for
`ResolveConditionalRequirement`. A caller cannot state an opinion because there
is nowhere to put one.

### D-C1C4-2 · The governance queue already exists

The Macro playbook declares `verification` (required), `challenge` (required)
and `risk-review` (conditional) as entries, blocked on `aggregation`.
Submission therefore does not invent a queue: it activates the assignments the
playbook already created, which is what makes a governance review visible on a
department's floor in exactly the way a Global Macro assignment is.

Risk is activated **only** when the conditional requirement for that exact
revision has resolved to `required`. Unresolved and `not-required` both leave
the Risk desk with nothing in its queue, and they are distinguished in the
event record rather than by absence.

### D-C1C4-3 · Verdict commands are not guarded by the case version

`SubmitForVerification` is version-guarded — it is already on
`VERSION_GUARDED_COMMANDS` — because it moves aggregate-level case workflow
state. The three verdict commands are not.

If they were, Verification and the Devil's Advocate could not record
concurrently against the same immutable revision: whichever committed second
would fail a version check over a conflict that does not exist, because the two
verdicts touch nothing in common. Their protection is their own identity, not a
shared counter. This is the concurrency requirement restated as a policy.

### D-C1C4-4 · A review is immutable, and a re-review is a new record

No command mutates a stored verdict. A later review of the same revision by the
same discipline is a new immutable record naming the one it supersedes.
Previous blocking findings stay readable forever; the gate reads the current
verdict.

**Selection is by an explicit sequence, not by timestamp.**
`evaluateRevisionGates` currently sorts by `at` and takes the last, which is
under-determined the moment two reviews share an instant — and two reviews of
one revision by one discipline at one instant is exactly what a retry storm
produces. Each review carries `sequence`, a monotonically increasing integer
per `(caseId, revisionId, kind)` assigned inside the transaction that writes it.
That is a total order, it survives identical timestamps, and it is the same
number after a restart.

Assigning it serialises writes within one `(revision, kind)`. That is the
correct scope: the concurrency the firm needs is _across_ disciplines, and two
simultaneous Verification verdicts on one revision genuinely do need ordering.

### D-C1C4-5 · A re-review that changes the verdict must say why

`reasonPolicy` stays `'optional'` at the definition level and the handler
refuses a superseding review whose `status` differs from the one it supersedes
and which carries no reason. Reversing an institutional verdict without stating
why is the case this exists for; re-recording the same verdict after a
re-check is not, and requiring prose for it produces prose nobody reads.

### D-C1C4-6 · The eligibility decision does not move

`evaluateRevisionEligibility` remains the only producer of the final result.
The adapter translates stored application state into its inputs and decides
nothing. Three fitness rules — in the registry, with planted violations —
prove that no handler, no SQL and no presentation module reimplements it.

### D-C1C4-7 · `evaluateGate` stops emitting prose and parsing it back

Today `evaluateGate` builds `blockers: string[]` and `blockerKindFor` recovers
the `BlockerKind` by prefix-matching those sentences. That is prose used as a
data channel, in the codebase that spent three phases removing prose from
exactly these paths: renaming a blocker message silently reclassifies the
blocker, and nothing fails.

`evaluateGate` will return `Blocker[]` directly. `GateResult.blockers` becomes
structured, `governanceBlockers` becomes the identity function and then goes
away, and `blockerKindFor` is deleted. This is a prerequisite for the Risk
mapping below, which needs three new kinds that no sentence prefix could
distinguish reliably.

### D-C1C4-8 · The Risk gate has three states, and the third is not "no"

`GovernanceGate` gains `riskRequirement: 'unresolved' | 'not-required' |
'required'`, supplied by the adapter from the stored resolution.

| State          | Risk review | Gate                                                 |
| -------------- | ----------- | ---------------------------------------------------- |
| `unresolved`   | any         | blocked — `risk-requirement-unresolved`              |
| `not-required` | absent      | satisfied, and the resolution stays visible to audit |
| `not-required` | present     | blocked — `risk-review-not-expected` (see below)     |
| `required`     | absent      | blocked — `risk-review-missing`                      |
| `required`     | rejected    | blocked — `risk-rejected` (existing kind)            |
| `required`     | accepted    | satisfied                                            |

`unresolved` blocking is the load-bearing row. Nobody has decided whether Risk
applies to this argument, so **no Risk verdict can satisfy the gate** — not
even an approving one, because an approval of a review nobody established was
needed is not evidence that the question was asked.

The `not-required` + present row is a judgement call worth naming: a Risk
verdict exists against a revision the firm recorded as not needing one. Treating
it as a pass would let the Risk desk create its own mandate; treating it as
a blocker surfaces the contradiction to a manager. Blocked, and easily cleared
by resolving the requirement to `required`.

### D-C1C4-9 · The existing verdict vocabulary is authoritative

No second taxonomy. `VerificationStatus` keeps all six values including
`unresolved-discrepancy`, which the review's list omitted; it is a real and
distinct outcome — the verifier and the analyst disagree about a number and
neither can settle it — and removing it would fold a stalemate into
`correction-required`, which names something the analyst can act on alone.

`RiskVerdict.status` keeps `accepted | accepted-with-limits | rejected`.
`ChallengeStatus` keeps `open | accepted | rejected | resolved`.

What changes is **structure inside the verdicts**, not the verdicts.

### D-C1C4-10 · Two blocking thresholds on one materiality scale

`DisagreementMateriality` (`non-material | material | decision-critical`) from
C1C-3 is reused for challenges rather than duplicated. The thresholds differ:

- an unresolved **aggregation disagreement** blocks at `decision-critical`
- an unresolved **Devil's Advocate challenge** blocks at `material` and above

Both as directed, and the asymmetry is defensible: a formal objection filed by
the control function whose entire mandate is to attack the argument is a
stronger institutional signal than a manager recording that two desks did not
agree. Each threshold is one named function — `disagreementBlocksEligibility`
(existing) and `challengeBlocksEligibility` (new) — and neither restates the
other's rule.

A non-material challenge does not block and does not disappear. It is stored,
it is visible on the revision, and the CIO reads it.

### D-C1C4-11 · Eligibility is derived, not stored

No `eligible` column. A stored flag is a second source of truth that drifts the
first moment a review lands and nothing recomputes it, and this codebase has
already paid for that lesson with `missingRequiredContributions`.

This deviates from one line of the review's event list, which named
"revision became eligible" and "revision remained blocked" as events. Those are
_transitions_, and detecting a transition needs something that compares two
evaluations. Nothing in C1C-4 runs periodically, so there is nothing to notice
the moment a revision becomes eligible.

**Recommended:** C1C-4 emits events for what actually happened — a verdict was
recorded, a correction was required, a challenge was opened — and eligibility is
computed on read by the adapter. The transition events arrive in C1D with the
projection that materialises the read model, which is the first component that
runs continuously enough to observe a transition.

**Alternative, if you want it durable now:** a fifth command,
`RecordEligibilityEvaluation`, which calls the adapter, stores an immutable
evaluation (revision, result, blockers, input hash, evaluated-at) and emits the
transition by comparing with the previous evaluation. It records what the domain
decided and decides nothing itself, so D-C1C4-6 survives. It costs one table,
one command and the question of who invokes it. **Say which you want; the plan
below assumes the recommended path.**

---

## 2 · The commands

Every field below is declared in the form C1C-1 established.

### 2.1 `SubmitForVerification`

| Property         | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| Category         | `workflow`                                                          |
| Mandate          | `department-manager` (the department that aggregated) — see §5      |
| Reason policy    | `optional`                                                          |
| Version policy   | `requires-expected-version` — already on `VERSION_GUARDED_COMMANDS` |
| Contract version | command 2 (unchanged), domain 7                                     |
| Actor            | employee; `system` refused                                          |
| Initiator        | a manager or the orchestrator on a manager's behalf                 |
| Idempotency      | payload hash over `(caseId, revisionId)`                            |
| Transaction      | one — assignments, revision lifecycle and events together           |
| Result           | `resultKind: 'revision'`, `resultRef: revisionId`                   |

**Input:** `caseId`, `revisionId`, `submittedByDepartmentId`. No outcome field.

**Refusals**, each a bounded `RejectionCode`:

| Condition                                                 | Code                 |
| --------------------------------------------------------- | -------------------- |
| revision does not exist                                   | `not-found`          |
| revision belongs to another case                          | `invariant-violated` |
| revision is not the lineage's current one                 | `invariant-violated` |
| revision lifecycle is `superseded`/`withdrawn`/`rejected` | `invariant-violated` |
| no manager aggregation produced this revision             | `invariant-violated` |
| required upstream work is not complete                    | `invariant-violated` |
| case is blocked or closed                                 | `invariant-violated` |
| already submitted and not returned                        | `already-exists`     |
| caller is not the aggregating department                  | `not-authorised`     |

"No manager aggregation produced this revision" is the one that keeps the two
records apart: a revision minted by `ProposeThesis` or `ReviseThesis` has no
`aggregationId`, and a specialist cannot route their own thesis into governance
without a manager having synthesised it. Required-work completeness is
re-derived through `unmetRequiredWork`, not re-stated.

**Effects:** revision → `awaiting-verification`; the `verification` and
`challenge` assignments → `active`; the `risk-review` assignment → `active`
only where the conditional requirement for this revision resolved to
`required`; events per §7.

### 2.2 `RecordVerificationReview`

| Property       | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| Category       | `governance`                                                |
| Mandate        | `governance-verdict` with `discipline: 'verification'`      |
| Reason policy  | `optional`, required when superseding with a changed status |
| Version policy | `refuses-expected-version` — D-C1C4-3                       |
| Idempotency    | payload hash over the full verdict, findings sorted         |
| Transaction    | one — review, findings, assignment status and events        |
| Result         | `resultKind: 'review'`, `resultRef: reviewId`               |

**Input:** `caseId`, `revisionId`, `thesisId`, `byDepartmentId`, `status`,
`findings[]`, `claimsReviewed[]`, `supersedesReviewId?`.

`reviewId` is derived — `deriveReviewId(context)` — and is not an input.

**`VerificationFinding` gains the structure the review asked for:**

```ts
export interface VerificationFinding {
  kind: VerificationFindingKind // unchanged, 15 values
  claimId: ClaimId
  detail: string // the verifier's own words
  evidence?: EvidenceRef // carries contentHash already
  blocking: boolean
  severity: 'advisory' | 'material' | 'critical' // new
  /** What the claim asserted and what the verifier measured. */
  expected?: FindingValue // new
  observed?: FindingValue // new
  /** How the verifier arrived at `observed`. */
  methodology?: string // new
  /** What must happen before this stops blocking. */
  correctionRequired?: string // new
}

/** A value, with the two things that make numbers comparable. */
export interface FindingValue {
  amount: string // decimal as text; never a float
  unit?: string
  currency?: string
}
```

`amount` is text because a finding that says "we expected 2.5% and observed
2.50000000000000004%" is a finding about IEEE-754, not about the analysis.

**Refusals:** unknown revision; revision belongs to another case; the revision
is not in review; a finding naming a claim that is not in the revision's
aggregation scope; a finding naming an `EvidenceRef` no claim in scope cites;
`blocking: true` with no `correctionRequired`; a superseding review targeting a
different revision than the one it supersedes; wrong discipline; system actor.

**Evidence-change detection.** `EvidenceRef` already carries `contentHash`. The
handler compares each cited ref's hash against the stored evidence set's current
hash and, on a mismatch, requires the verdict to carry a `revised-evidence` or
`stale-evidence` finding for that claim. It does not invent the finding — that
is the verifier's judgement — it refuses a verdict that is silent about
evidence that moved under it.

### 2.3 `RecordDevilsAdvocateReview`

| Property    | Value                                                     |
| ----------- | --------------------------------------------------------- |
| Category    | `governance`                                              |
| Mandate     | `governance-verdict` with `discipline: 'devils-advocate'` |
| Version     | `refuses-expected-version`                                |
| Idempotency | payload hash over challenges and outcomes, sorted by id   |
| Result      | `resultKind: 'review'`, `resultRef: reviewId`             |

**Input:** scope fields, `byDepartmentId`, `challenges[]`, `outcomes{}`,
`supersedesReviewId?`.

**`Challenge` gains:**

```ts
materiality: DisagreementMateriality   // reused from aggregation.ts
resolvedBy?: string                    // recorded when outcomes[id] !== 'open'
```

Challenge ids derive from the command plus the challenge's ordinal, like claim
ids in C1C-2. A caller does not name them.

`buildChallenge` already refuses an evidence-less challenge except for
`fragile-assumption` and `overconfidence`. C1C-4 tightens the exception rather
than removing it: those two kinds must carry `wouldBeResolvedBy`, so an
objection with no counter-evidence must at least state what would settle it.
That is the mechanical form of "no theatrical or generic disagreement".

**Refusals:** a challenge contesting a claim outside the revision's aggregation
scope; a challenge with neither counter-evidence nor `wouldBeResolvedBy`; an
outcome naming a challenge not in the list; marking a challenge resolved with no
`resolvedBy`; wrong discipline; system actor.

### 2.4 `RecordRiskReview`

| Property | Value                                          |
| -------- | ---------------------------------------------- |
| Category | `governance`                                   |
| Mandate  | `governance-verdict` with `discipline: 'risk'` |
| Version  | `refuses-expected-version`                     |
| Result   | `resultKind: 'review'`, `resultRef: reviewId`  |

**Input:** scope fields, `byDepartmentId`, `status`, `findings[]`, `limits[]`,
`supersedesReviewId?`.

**`RiskVerdict.concerns: readonly string[]` becomes structured:**

```ts
export type RiskFindingKind =
  | 'allocation'
  | 'position-sizing'
  | 'concentration'
  | 'leverage'
  | 'liquidity'
  | 'currency-exposure'
  | 'correlation'
  | 'downside'
  | 'tail-risk'
  | 'implementation-constraint'

export interface RiskFinding {
  kind: RiskFindingKind
  detail: string
  severity: 'advisory' | 'material' | 'critical'
  /** The implication this concerns, where one is identifiable. */
  implication?: string
  /** What would have to change for the concern to fall away. */
  mitigatedBy?: string
}
```

**Refusals:** the conditional requirement for this revision is not `required`
(the load-bearing one — Risk may not review what it was not asked to review);
`accepted-with-limits` with no limits; a finding naming an implication not in
the revision; wrong discipline; system actor.

Risk changes nothing about the thesis. It has no field that could.

---

## 3 · Files and migrations

### New

| File                                                            | What                             |
| --------------------------------------------------------------- | -------------------------------- |
| `application/analysis/commands/submitForVerification.ts`        | §2.1                             |
| `application/analysis/commands/recordVerificationReview.ts`     | §2.2                             |
| `application/analysis/commands/recordDevilsAdvocateReview.ts`   | §2.3                             |
| `application/analysis/commands/recordRiskReview.ts`             | §2.4                             |
| `application/analysis/eligibility.ts`                           | the adapter — §8                 |
| `application/analysis/reviewSequence.ts`                        | the per-(revision, kind) counter |
| `infrastructure/analysis/postgres/reviewFindingRepositories.ts` | relational finding writes        |
| `db/migrations/0019_structured_governance_findings.sql`         | §4                               |

### Changed

| File                                                     | Change                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `domain/analysis/review.ts`                              | structured findings, challenge materiality, `sequence`, `riskRequirement` on the gate, structured `Blocker[]` |
| `domain/analysis/lifecycle.ts`                           | three new `BlockerKind`s; `blockerKindFor` deleted                                                            |
| `domain/analysis/requirements.ts`                        | unchanged — the resolution shape is already right                                                             |
| `application/analysis/repositories.ts`                   | `ReviewRepository` gains sequence allocation and finding reads                                                |
| `application/analysis/commands/registry.ts`              | four registrations                                                                                            |
| `infrastructure/analysis/postgres/reviewRepositories.ts` | relational columns, `detail` jsonb removed                                                                    |
| `infrastructure/analysis/inMemoryRepositories.ts`        | parity                                                                                                        |
| `test/fitness/rules.ts`                                  | three eligibility rules, with fixtures                                                                        |

Domain contract version 6 → **7**. Command contract stays at 2: the envelope,
the ledger and the identity scheme are unchanged.

### Migration `0019`

Forward-only, empty-table guarded where it narrows, column-level grants like 0018.

1. `analysis.reviews` gains `sequence integer NOT NULL`, `supersedes_review_id
text REFERENCES analysis.reviews (id)`, `reason text`.
   `UNIQUE (case_id, revision_id, kind, sequence)`.
2. `analysis.verification_findings` gains `severity`, `expected_amount`,
   `expected_unit`, `expected_currency`, `observed_amount`, `observed_unit`,
   `observed_currency`, `methodology`, `correction_required`,
   `evidence_content_hash`. Each a column, none of it jsonb.
3. New `analysis.risk_findings` — `review_id`, `ordinal`, `kind`, `detail`,
   `severity`, `implication`, `mitigated_by`. Replaces `detail->>'concerns'`.
4. New `analysis.risk_limits` — `review_id`, `ordinal`, `limit_text`.
5. New `analysis.verification_claims_reviewed` — `review_id`, `claim_id`.
   Replaces `detail->>'claimsReviewed'`, so "which claims did the verifier
   actually check" is a join rather than a scan.
6. `analysis.challenges` gains `materiality`, `resolved_by`,
   `would_be_resolved_by`.
7. CHECK constraints per kind, written as per-kind implications so an unknown
   value trips exactly one constraint — the shape 0017 settled on.
8. `analysis.reviews.detail` **dropped** once 2–5 carry everything. The
   headquarters asks "which findings block this revision, and whose queue is
   it in"; behind a document that is a scan and a parse.

Dropping a column is not forward-only in the usual sense. It runs last, guarded
on the new tables being populated for every existing review, and the guard fails
the migration rather than losing data. There are no production rows.

---

## 4 · Review persistence model

One row per review in `analysis.reviews`, plus child rows per finding,
challenge, limit and reviewed claim. Nothing kind-specific in a shared jsonb
column.

- **Immutable.** Write-once by semantic key, like every other record since
  C1B. The key is `(kind, caseId, thesisId, revisionId, byDepartmentId,
byEmployeeId, at)` — `reviewIdentity`, unchanged — so a differing second write
  raises `ConflictingRecordError` rather than overwriting.
- **Exact revision.** `revision_id` is a foreign key and is never null for a
  governance review. `reviewApplies` already refuses to match a review of
  revision n against revision n+1, by exact equality and with no lineage
  fallback.
- **Ordered.** `sequence` per `(caseId, revisionId, kind)`.
- **Superseded, not replaced.** `supersedes_review_id` is a self-reference. The
  superseded row keeps its findings and stays queryable.

---

## 5 · Repeated review

| Situation                                   | Result                                                      |
| ------------------------------------------- | ----------------------------------------------------------- |
| identical command replayed                  | ledger returns the original review; nothing is written      |
| same verdict re-recorded at a later instant | new row, `sequence + 1`, supersedes the previous            |
| different verdict, no reason                | **rejected** — `invariant-violated` (D-C1C4-5)              |
| different verdict, with reason              | new row, supersedes, both readable                          |
| earlier blocking findings                   | retained forever on the superseded row                      |
| a later passing review                      | does not delete the earlier failure                         |
| review retargeted to another revision       | **rejected** — the supersession must name the same revision |
| two reviews at the identical timestamp      | ordered by `sequence`; both stored                          |

`evaluateRevisionGates` selects `max(sequence)` per `(revision, kind)` among
reviews that `reviewApplies` accepts. Deterministic, and the same after a
restart.

---

## 6 · Authorization

| Command                      | Mandate                                            | Refuses                            |
| ---------------------------- | -------------------------------------------------- | ---------------------------------- |
| `SubmitForVerification`      | `department-manager` of the aggregating department | another department; system actor   |
| `RecordVerificationReview`   | `governance-verdict` · `verification`              | any other discipline; system actor |
| `RecordDevilsAdvocateReview` | `governance-verdict` · `devils-advocate`           | any other discipline; system actor |
| `RecordRiskReview`           | `governance-verdict` · `risk`                      | any other discipline; system actor |

**Only the Risk discipline may issue the Risk verdict**, checked twice: the
mandate names the discipline, and the handler checks `byDepartmentId` against
the revision's playbook entry for `risk-review`. Declared authority and recorded
authorship must agree — the same double check `StartAgentRun` and `ReviseThesis`
use, and for the same reason: a mandate proves what the caller claimed, not what
the record will say.

A `system` actor cannot issue any verdict. Governance is an accountable human
act, and TD-8 means the runtime cannot even assert that an actor is
authenticated — so a system-issued verdict would be an unattributable
institutional judgement.

---

## 7 · Transaction and event map

One command, one transaction, one ledger entry. No handler opens a transaction;
`runCommand` owns the boundary. No provider runs inside one — there is no
provider in C1C-4 at all.

| Command                      | Writes in one transaction                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `SubmitForVerification`      | revision lifecycle · governance assignments → `active` · case version bump · events |
| `RecordVerificationReview`   | review · findings · claims-reviewed · assignment status · events                    |
| `RecordDevilsAdvocateReview` | review · challenges · challenge evidence · assignment status · events               |
| `RecordRiskReview`           | review · risk findings · limits · assignment status · events                        |

**Events**, all with ids derived from the command via `deriveEventId`, all
structured, none carrying prose:

| Event type                         | Subject       | Structured payload                                |
| ---------------------------------- | ------------- | ------------------------------------------------- |
| `revision-submitted-for-review`    | `revision`    | revisionId, aggregationId, riskRequirement        |
| `governance-review-opened`         | `assignment`  | departmentId, discipline, revisionId              |
| `verification-completed`           | `review`      | reviewId, status, blockingFindingCount, sequence  |
| `verification-correction-required` | `review`      | reviewId, claimIds                                |
| `challenge-opened`                 | `review`      | reviewId, challengeId, kind, materiality          |
| `challenge-resolved`               | `review`      | reviewId, challengeId, outcome                    |
| `risk-requirement-not-required`    | `requirement` | playbookEntryKey, revisionId, ruleId, ruleVersion |
| `risk-review-completed`            | `review`      | reviewId, status, limitCount                      |
| `governance-verdict-superseded`    | `review`      | supersededReviewId, supersedingReviewId           |

`transition_events.subject` widens with `review` (0018 already widened it with
`requirement`).

Human-readable labels are projected in the presentation layer from the event
type and its structured fields. No free-form headquarters activity prose is
stored — and as of the fitness-integrity work that is an executable rule with a
planted violation behind it, rather than a convention.

---

## 8 · The conditional-gate adapter

`application/analysis/eligibility.ts`:

```ts
export async function revisionEligibility(
  repositories: AnalysisRepositories,
  caseId: CaseId,
): Promise<ThesisEligibility[]>
```

It reads revisions, reviews, requirement resolutions, aggregations, assignments,
runs and the pinned playbook; assembles the domain's inputs; and calls
`evaluateRevisionEligibility`. It contains no threshold, no comparison against a
status, and no `if` that produces an eligibility answer.

**The mapping it performs, and nothing more:**

| Stored state                                            | Domain input                               |
| ------------------------------------------------------- | ------------------------------------------ |
| no `RequirementResolution` for `risk-review` + revision | `riskRequirement: 'unresolved'`            |
| resolution `state: 'not-required'`                      | `riskRequirement: 'not-required'`          |
| resolution `state: 'required'`                          | `riskRequirement: 'required'`              |
| verification reviews for the case                       | `CaseReviews.verification`                 |
| devil's advocate reviews                                | `CaseReviews.devilsAdvocate`               |
| risk reviews                                            | `CaseReviews.risk`                         |
| `unmetRequiredWork(...)`                                | `missingRequiredContributions`             |
| aggregation dispositions where `blocksEligibility`      | `blockingDisagreements`                    |
| revision `lifecycle`                                    | `lifecycle`                                |
| `supersededBy !== null`                                 | `lifecycle: 'superseded'` — already stored |

Unresolved citations and missing provenance surface as verification findings of
kind `unresolved-citation` and `source-unreachable`, which the gate already
reads. They are not a second path.

**Fitness rules added to the registry, each with a planted violation and a
benign near-miss:**

1. no module under `application/analysis/commands/` references
   `evaluateRevisionEligibility`, `evaluateThesisEligibility` or `evaluateGate`
2. no SQL file computes eligibility — no migration mentions `eligible`,
   `blocks_decision` or a CASE over review statuses
3. nothing under `presentation/`, `components/` or `routes/` imports the
   lifecycle evaluators
4. `evaluateGate` is called from exactly one place outside the domain

---

## 9 · Eligible versus submitted

Kept apart, and neither implies the other.

- **eligible for decision** — derived, `eligibleForDecision === true`
- **submitted for CIO consideration** — a durable act, and C1D's

Nothing in C1C-4 submits anything to the CIO. Eligibility becoming true fires no
command and creates no queue item. Automatic submission on eligibility would
make the CIO's inbox a function of a computation rather than of a decision
somebody took, and would remove the last human step before capital allocation.

---

## 10 · Concurrency

| Requirement                                 | Mechanism                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| no shared case-version bump for verdicts    | D-C1C4-3 — verdict commands refuse `expectedVersion`                                     |
| independent review identities               | `deriveReviewId(context)` — different commands, different ids                            |
| exact revision scope                        | `ReviewScope` union; `revision_id` foreign key                                           |
| no lost review                              | every verdict is an insert; nothing updates                                              |
| deterministic latest-review selection       | `max(sequence)` per `(revision, kind)`                                                   |
| no review consumes another's output         | handlers read only the revision, its aggregation and their own discipline's prior review |
| simultaneous valid verdicts do not conflict | different rows, different keys, no shared counter                                        |

Verification and the Devil's Advocate run concurrently by default. Risk runs
concurrently with both once its requirement resolves to `required`.

The only serialisation is `sequence` allocation within one `(revision, kind)`,
taken as `SELECT ... FOR UPDATE` on the revision's review rows of that kind.
Two Verification verdicts on one revision serialise; a Verification and a
challenge do not touch.

Later reconciliation creates new work. A verdict is never rewritten to agree
with another.

---

## 11 · End-to-end deterministic Macro flow

One PostgreSQL-backed test, real commands, real adapter, no network and no
model. Steps 1–8 exist; 9–15 are C1C-4.

1. open case · 2. instantiate Macro playbook · 3. propose thesis ·
2. complete required Global Macro work · 5. complete or omit optional Quant
   work · 6. complete the Research Office run · 7. aggregate and mint the revision ·
3. resolve the conditional Risk requirement · 9. submit the exact revision ·
4. record Verification · 11. record the Devil's Advocate review · 12. record
   Risk where required · 13. derive eligibility · 14. restart the runtime ·
5. reload and confirm identical eligibility, reviews, events and provenance.

**Branches, each its own case so none can mask another:**

| #   | Branch                                     | Expected                                                                             |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| A   | Risk not required, all gates pass          | eligible                                                                             |
| B   | Risk required and approved                 | eligible                                                                             |
| C   | Risk required, review missing              | blocked — `risk-review-missing`                                                      |
| D   | Risk unresolved                            | blocked — `risk-requirement-unresolved`, and an approving Risk verdict does not help |
| E   | Verification `correction-required`         | blocked — `verification-correction-required`                                         |
| F   | unresolved material challenge              | blocked — `unresolved-challenge`                                                     |
| G   | unresolved non-material challenge          | eligible, challenge visible                                                          |
| H   | decision-critical aggregation disagreement | blocked — `decision-critical-disagreement`                                           |
| I   | new revision after a correction            | every gate reopens; no review, no Risk resolution inherited                          |

Branch I is the one the whole phase is for. A correction produces a new
aggregation and a new revision, and the new revision starts with nothing: no
verification, no challenge outcome, no Risk resolution, and `evaluateGate`
counts missing verification as a blocker rather than a pass.

---

## 12 · Tests

Every item the review listed, plus what the branches above require.

**Targeting** — exact revision target · superseded revision refused · missing
manager aggregation refused · submission version conflict · revision of another
case refused · closed or blocked case refused.

**Verification** — evidence hash round-trip · changed evidence detected ·
missing citation finding · calculation finding · unit finding · currency
finding · blocking finding without a correction requirement refused · finding
naming an out-of-scope claim refused.

**Devil's Advocate** — evidence-less invalid challenge rejected ·
`fragile-assumption` without `wouldBeResolvedBy` rejected · material challenge
blocks · non-material challenge remains visible and does not block ·
decision-critical challenge blocks · resolved challenge stops blocking ·
challenge against an out-of-scope claim refused.

**Risk** — unresolved mapping · not-required mapping · required-and-missing
mapping · required-and-approved · required-and-rejected · verdict when the
requirement is not `required` refused · `accepted-with-limits` without limits
refused · wrong discipline refused · system actor refused.

**Repetition** — replay returns the original review · re-review creates a new
record · changed verdict without a reason refused · changed verdict with a
reason accepted · latest selected deterministically at an identical timestamp ·
earlier blocking findings still readable · supersession across revisions refused.

**Concurrency** — Verification and challenge recorded concurrently both commit ·
neither bumps the case version · two Verification verdicts at one instant both
stored and ordered.

**Eligibility** — computed only in the domain (four fitness rules) · no
inherited review on a new revision · no inherited Risk resolution · blockers
structured rather than parsed from prose.

**Durability** — restart and reload gives identical eligibility, reviews,
findings, challenges, events and provenance · every event id derives from its
command · in-memory and PostgreSQL adapters agree, through the existing
repository contract.

**Absence** — no LLM import (registry rule) · no UI change · no
`SubmitForCioDecision` · no `RecordCaseDecision` · the approved command list
grows by exactly four.

---

## 13 · Risks

| Risk                                                                  | Response                                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `evaluateGate` returning structured blockers touches C1C-3 call sites | Mechanical and typechecked; `blockerKindFor`'s deletion removes a fragile path rather than adding one |
| Dropping `reviews.detail` is destructive                              | Runs last, guarded on the new tables covering every row; no production data exists                    |
| `sequence` allocation serialises within a `(revision, kind)`          | Correct scope; cross-discipline concurrency is untouched                                              |
| Two materiality thresholds confuse a reader                           | Two named functions, each documented with its threshold and its reason; neither restates the other    |
| Structured Risk findings are a bigger domain change than they look    | `concerns: string[]` has no production data; conversion is additive                                   |
| The adapter grows into a second decision site                         | Four fitness rules, with planted violations, per D-C1C4-6                                             |
| Governance queue reuses assignments, which carry a `brief`            | The brief comes from the playbook, not from a caller; no new prose channel                            |

---

## 14 · Technical Debt & Future Improvements

**Opened by C1C-4**

- **TD-41 · No governance escalation path.** `Escalation` exists in the domain
  and nothing produces one. A blocked revision sits blocked; nothing routes it
  to a manager or the CIO. C1D, with the headquarters floor that would show it.
- **TD-42 · Compliance is defined and unreachable.** `ComplianceReview`,
  `complianceBlocks` and the `compliance` review kind all exist; no command
  records one. Publication is not in C1C-4's scope, so it is dead contract
  until the publication phase.
- **TD-43 · Correction does not create the work it requires.**
  `correction-required` blocks the revision and names what must change, but
  nothing opens an assignment for the desk that must change it. The manager
  reads the finding and issues the next command by hand. A `ReturnWork` command
  exists on `REASON_REQUIRED_COMMANDS` and is unimplemented.
- **TD-44 · Eligibility is recomputed on every read.** Acceptable at C1C's
  scale — one case, tens of reviews — and the reason there is no stored flag.
  C1D's read model is where it gets materialised, with TD-36.

**Carried forward, unchanged**

TD-34 (abandoned-run recovery — still a hard gate before any live or
long-running provider) · TD-35 (exceptional-aggregation override, deferred; any
override needs its own command, mandate, reason, exact missing work, durable
record and CIO visibility) · TD-36 (aggregation read model, C1D; not duplicated
for presentation) · TD-37 (cross-case result reuse, deferred; case-scoping is
the correct behaviour today and reuse must never let two cases share claim
identities) · TD-39 (phase gates outside the registry are still unproved; the
four new eligibility rules go in the registry with fixtures from the start) ·
TD-8, TD-24, TD-25, TD-26, TD-27, TD-33 enforcement.

---

## 15 · Order of work

1. Domain: structured findings, challenge materiality, `riskRequirement`,
   structured `Blocker[]`, `blockerKindFor` deleted. Unit tests only.
2. Migration 0019 and both adapters, to the existing repository contract.
3. `SubmitForVerification`.
4. The three verdict commands.
5. The adapter and its four fitness rules.
6. The end-to-end PostgreSQL flow, all nine branches.
7. Documentation and the exit report.

Each step leaves the tree green. Steps 1–2 are inert on their own, which is
deliberate: the domain and the schema can be reviewed before any command can
write through them.

## 16 · Exit criteria

- four commands registered, and the approved list grows by exactly four
- every C1C-4 test in §12 passing, both suites green, `tsc` clean
- eligibility produced by `evaluateRevisionEligibility` alone, proved by four
  registry rules with planted violations
- the end-to-end Macro flow passing all nine branches, including restart
- no LLM client, no UI change, no CIO decision command
- domain contract version 7; command contract version 2

---

## Open question for the gate

**D-C1C4-11** — eligibility derived on read (recommended) versus a fifth
command recording a durable evaluation. The recommendation is derived-only, with
the transition events arriving in C1D alongside the projection that can observe
a transition. If you want `eligibleForDecision` durable within C1C-4, say so and
`RecordEligibilityEvaluation` joins §2 as a fifth command.

Nothing is implemented until this plan is approved.
