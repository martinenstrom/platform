# Phase C1D — the decision, and the floor that shows it

**Status:** planning gate. Nothing here is implemented.

C1C ended with a revision the firm can defend: manager-aggregated, reviewed by
three control functions, and eligible or blocked for reasons the record can
name. C1D does two things with that. It puts an eligible revision in front of
the CIO and records what the CIO decided, immutably. And it builds the durable
read model the headquarters floor will later be assembled from — one shared
institution, resolved in one coherent snapshot, from PostgreSQL.

No LLM. No Agents UI migration. No publication, no portfolio execution.

---

## 0 · Staging

Three stages, each reviewable on its own and each leaving the tree green.

| Stage     | Contents                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1D-1** | `SubmitForCioDecision`, `RecordCaseDecision`, the eligibility snapshot, structured reconsideration triggers, migration 0020, decision storage and events |
| **C1D-2** | `getHeadquartersSnapshot`, the case timeline projection, current-state metrics, derived presence, derived case health, migration 0021 (indexes only)     |
| **C1D-3** | Observed eligibility transitions **and** historical metrics — only if §12's recommendation is accepted, and only after C1D-2's query counts are measured |

C1D-3 is deliberately conditional. Both of its candidates are optimisations or
observations of things C1D-1 and C1D-2 already answer correctly, and building
either before the cost is measured would be exactly what TD-44 says not to do.

---

## 1 · Commands

### 1.1 The two that are certain

**`SubmitForCioDecision`** and **`RecordCaseDecision`** — both already named in
`VERSION_GUARDED_COMMANDS`, and `RecordCaseDecision` in
`REASON_REQUIRED_COMMANDS`.

### 1.2 The three to evaluate — recommendation

| Candidate                    | Recommendation   | Why                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReturnFromCioReview`        | **Build it**     | The CIO looking at work and sending it back is a real institutional act with a real effect: the case leaves `decision` and returns to `returned`, and the reason belongs to the CIO rather than to whoever notices. Without it the only way out of the CIO queue is a decision, which would make "not yet" indistinguishable from "no". |
| `RecordCioDeferral`          | **Do not build** | A deferral is a decision to wait, and every field it would carry — reason, what would change the answer, when to look again — is already `reconsiderationTriggers` on a `CaseDecision` with `selectedRevisionId: null`. A second command for it would give the record two shapes for one act.                                           |
| A generic "more work needed" | **Do not build** | `ReturnFromCioReview` is that command, with a scope. A generic one would be a command whose meaning depends on its prose.                                                                                                                                                                                                               |

`ReturnFromCioReview` therefore joins the plan, making **three** commands.

**A CIO decision is not a contribution.** It creates no `AgentRun`, no claim and
no assignment, and `RecordCaseDecision`'s category is `decision` rather than
`analysis`. The CIO consumes verified work; a decision filed as a contribution
would appear in the aggregation input scope of the next revision, which would
mean the firm's own conclusion could become evidence for itself.

### 1.3 `SubmitForCioDecision`

| Property       | Value                                                         |
| -------------- | ------------------------------------------------------------- |
| Category       | `workflow`                                                    |
| Mandate        | `department-manager` of the aggregating department            |
| Reason policy  | `optional`                                                    |
| Version policy | `requires-expected-version` — it moves the case to `decision` |
| Idempotency    | payload hash over `(caseId, revisionId)`                      |
| Transaction    | one — the snapshot, the case movement, the events             |
| Result         | `resultKind: 'cio-submission'`, `resultRef: submissionId`     |

**Input:** `caseId`, `revisionId`, `submittedByDepartmentId`. No decision field,
no `eligible` field — the same structural refusal `SubmitForVerification` uses.

**It calls the approved domain function and refuses on any blocker.** Through
the adapter, not by reimplementing it: `revisionEligibility` is invoked, and if
`eligibleForDecision` is false the command rejects with `invariant-violated`
naming the blocker kinds. The fitness rule forbidding handlers from importing
`evaluateRevisionEligibility` stays — the handler calls the _adapter_, which
calls the domain.

**Refusals:** revision not found; another case's; not the lineage's current;
superseded, withdrawn or rejected; no manager aggregation; not the aggregating
department; case not in `review`; case blocked, withdrawn or closed; any
blocker present; already submitted and not returned; stale `expectedVersion`.

**Effects:** the eligibility snapshot is written (§4); the case moves
`review → decision`; the CIO queue gains an item; events per §7.

**Submission is not a decision.** Nothing creates a `CaseDecision` because a
submission succeeded, and there is no field on the submission that could.

### 1.4 `RecordCaseDecision`

| Property       | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| Category       | `decision`                                                      |
| Mandate        | `chief-decision`                                                |
| Reason policy  | `required` — already on `REASON_REQUIRED_COMMANDS`              |
| Version policy | `requires-expected-version`                                     |
| Actor          | employee holding the chief-decision mandate; **system refused** |
| Initiator      | may be the orchestrator; the actor may not be                   |
| Idempotency    | payload hash over the full decision                             |
| Transaction    | one — decision, revision relations, case movement, events       |
| Result         | `resultKind: 'decision'`, `resultRef: caseId`                   |

**Input:** `caseId`, `selectedRevisionId` (nullable), `notSelectedRevisionIds`,
`rejectedRevisionIds`, `rationale`, `unresolvedDissent`,
`reconsiderationTriggers` (structured — §5), `evidenceSetId`.

**Refusals:** case not in `decision`; no submission for the selected revision;
the submission's revision is no longer current; the selected revision is not in
the submission's eligible set; `buildDecision`'s own refusals (no rationale, no
evidence set, superseded or ineligible selection); a decision already exists for
the case; a `notSelected` id that was never submitted; a system actor; a
non-chief mandate; stale `expectedVersion`.

**Immutability.** `DecisionRepository.save` is already documented as idempotent
on `caseId` and write-once. C1D keeps that and adds the correction path in §3.3
rather than an update.

### 1.5 `ReturnFromCioReview`

| Property       | Value                                             |
| -------------- | ------------------------------------------------- |
| Category       | `workflow`                                        |
| Mandate        | `chief-decision`                                  |
| Reason policy  | **`required`** — joins `REASON_REQUIRED_COMMANDS` |
| Version policy | `requires-expected-version`                       |
| Result         | `resultKind: 'case'`, `resultRef: caseId`         |

Moves the case `decision → returned` and records what the CIO wants addressed.
Structured: `returnedFor` is a bounded set — `insufficient-evidence`,
`unaddressed-dissent`, `scope-too-narrow`, `alternative-not-considered`,
`timing` — plus the required reason. It creates no assignment, which is exactly
the TD-43 gap and is stated as such in §14 rather than papered over.

---

## 2 · CIO authority

The mandate is `chief-decision`, which `authority.ts` already defines. Three
things C1D adds:

**The decision snapshots the CIO as the organization described them at
decision time** — employee id, role id, department, seniority, the organization
seed version, the authorization basis and the authentication state. Not a
foreign key to `employees`: a role changes, a person leaves, and a decision
whose authority is a join is a decision whose authority can be edited later by
somebody updating a row.

`ActorSnapshot` already carries most of this and is already stored on every
ledger entry. C1D adds `decided_by` snapshot columns on `case_decisions` so the
decision record is readable without the ledger.

**`authentication` will read `system-asserted`, and the record will say so.**
TD-8 is open: the runtime cannot assert that an actor is authenticated. A
decision claiming otherwise would be the single most consequential false
statement in the system, so the field is stored verbatim and the exit report
names it.

**The orchestrator may initiate, never impersonate.** `initiator` may be
`{ kind: 'orchestrator' }`; `actor` may not. A fitness rule with a planted
violation: no command whose mandate is `chief-decision` may accept a `system`
actor.

---

## 3 · The decision record

### 3.1 What is added to `CaseDecision`

The existing shape already carries the selected revision, the not-selected and
rejected ids, the evidence set, a governance snapshot, the rationale, dissent
and triggers. C1D adds the references that make it auditable without inference:

```ts
/** Exactly what justified eligibility, at the moment it was decided. */
eligibilityBasis: EligibilityBasis        // §4
/** The managerial synthesis behind the selected revision. */
aggregationId: string | null
/** The verdicts read, by id — not merely their statuses. */
verificationReviewId: string | null
devilsAdvocateReviewId: string | null
riskReviewId: string | null
riskRequirement: RiskRequirementState
riskRuleId: string | null
riskRuleVersion: string | null
/** Structured, not sentences. */
unresolvedDissent: readonly DisclosedDissent[]
reconsiderationTriggers: readonly ReconsiderationTrigger[]
/** Who decided, as the firm described them then. */
decidedBy: ActorSnapshot
/** The submission this decided. */
submissionId: string
```

`unresolvedDissent` becomes structured for the same reason blockers did:
`readonly string[]` cannot say which claim, which challenge or whose objection.

```ts
export interface DisclosedDissent {
  kind: 'unresolved-challenge' | 'retained-disagreement' | 'risk-limit' | 'qualification'
  claimId?: ClaimId
  challengeId?: string
  reviewId?: string
  materiality: DisagreementMateriality
  /** Why the CIO decided anyway. Required — this is the field that matters. */
  acknowledgement: string
}
```

**Non-blocking dissent reaching the CIO is the point.** A non-material challenge
does not block, and it must still be in front of the person deciding — otherwise
"it did not block" quietly becomes "nobody saw it".

### 3.2 Migration 0020

1. `case_decisions` gains `submission_id`, `aggregation_id`,
   `verification_review_id`, `devils_advocate_review_id`, `risk_review_id`,
   `risk_requirement`, `risk_rule_id`, `risk_rule_version`,
   `eligibility_policy_version`, and the `decided_by_*` snapshot columns.
2. New `analysis.decision_dissent` — one row per disclosed dissent, with its
   kind, references, materiality and acknowledgement. Replaces the
   `unresolved_dissent` jsonb.
3. New `analysis.decision_reconsideration_triggers` — §5's columns. Replaces the
   `reconsideration_triggers` jsonb.
4. New `analysis.cio_submissions` — `id`, `case_id`, `revision_id`,
   `submitted_by_department_id`, `submitted_at`, `state`
   (`pending | decided | returned`), `case_version`, plus the eligibility-basis
   columns of §4.
5. New `analysis.submission_eligibility_inputs` — one row per input that
   justified eligibility, so §4's audit answer is a join.
6. `case_decisions.governance` jsonb **dropped** once 1–3 cover it, guarded the
   way 0019 guarded `reviews.detail`.
7. Column-level grants: SELECT and INSERT only, everywhere. No UPDATE on any
   decision table — a correction is a new row.

**`decision_revisions` already exists** with `selected | not-selected |
rejected`, and needs no change.

### 3.3 Correction

A decision is never edited. `case_decisions` gains
`supersedes_case_decision_id` and the primary key moves from `case_id` to a
derived `decision_id`, with a partial unique index keeping **at most one
live decision per case** (`WHERE superseded_by IS NULL`). A correcting decision
names the one it replaces and carries its own reason; the superseded row keeps
every field it had.

`RecordCaseDecision` is the same command for both — a correction is a decision
that names a predecessor — which avoids a second command whose only difference
is a foreign key.

---

## 4 · The eligibility snapshot

**Eligibility stays derived.** Nothing stores a maintained flag, and
`revisionEligibility` remains the only path. What the submission and the
decision store is the _evidence_ that it was eligible at that moment:

```ts
export interface EligibilityBasis {
  /** The exact revision, never a lineage. */
  revisionId: RevisionId
  /** The policy that produced the answer. */
  eligibilityPolicyVersion: string
  /** Empty, and stored as empty — an audit reader should not infer it. */
  blockers: readonly Blocker[]
  /** The verdicts read, by id and sequence. */
  verification: { reviewId: string; sequence: number; status: VerificationStatus } | null
  devilsAdvocate: {
    reviewId: string
    sequence: number
    openChallengeIds: readonly string[]
  } | null
  risk: { reviewId: string; sequence: number; status: RiskStatus } | null
  riskRequirement: RiskRequirementState
  riskRuleId: string | null
  riskRuleVersion: string | null
  /** Required playbook work, and that all of it was accepted. */
  requiredWork: ReadonlyArray<{ playbookEntryKey: string; runId: string }>
  /** What the manager could not settle, and at what level. */
  materialDisagreements: ReadonlyArray<{
    claimId: ClaimId
    materiality: DisagreementMateriality
  }>
  /** The evidence and provenance the decision rests on. */
  evidenceSetIds: readonly string[]
  storageProvenanceId: string
  /** When the projection ran. NOT when the revision became eligible. */
  evaluatedAt: string
}
```

**`eligibilityPolicyVersion`** is new and is the field that makes this survive.
Today's answer is produced by today's thresholds — decision-critical for
aggregation disagreement, material for challenges, three-state Risk. If those
change, a decision recorded under the old policy must still be readable as
having been correct under the policy that was in force. The version is a
constant in the domain beside `DOMAIN_CONTRACT_VERSION`, bumped whenever a
blocking rule changes, and a domain test asserts that changing a threshold
without bumping it fails.

**Never `eligible: true` alone.** The audit record explains _why_, and the
`blockers: []` is stored explicitly rather than left to be inferred from
absence — the same reason `not-required` is an explicit Risk resolution.

---

## 5 · Reconsideration triggers

Structured, and deliberately **not** monitored in C1D.

```ts
export type TriggerConditionType =
  | 'threshold-breach' // inflation exceeds 3%
  | 'policy-change' // the ECB changes direction
  | 'assumption-invalidated' // earnings break the margin assumption
  | 'valuation-level' // price reaches a level
  | 'evidence-revised' // a cited observation is restated
  | 'dissent-vindicated' // a decision-critical objection proves right
  | 'time-elapsed' // review after two quarters

export interface ReconsiderationTrigger {
  id: string // derived from the command
  conditionType: TriggerConditionType
  /** What is being watched, as a reference rather than a phrase. */
  subject: {
    kind: 'series' | 'instrument' | 'claim' | 'evidence' | 'policy-rate' | 'date'
    ref: string
  }
  comparator?: 'above' | 'below' | 'crosses' | 'changes' | 'restated'
  threshold?: { amount: string; unit?: string; currency?: string }
  /** For conditions no comparator captures. */
  qualitativeCondition?: string
  /** Where the answer would come from when somebody checks. */
  expectedSource?: string
  /** Why this would change the firm's mind. Required. */
  rationale: string
  createdByEmployeeId: EmployeeId
  createdAt: string
  active: boolean
}
```

`amount` is text, for the reason `FindingValue.amount` is.
`qualitativeCondition` exists because refusing it would push real conditions
into `rationale`, where nothing could ever evaluate them — but a trigger must
carry a comparator **or** a qualitative condition, and a domain builder refuses
one with neither.

**No monitoring.** Nothing evaluates a trigger in C1D. Recording a condition and
watching for it are different capabilities, and building the second without a
scheduler — which this runtime still does not have, see TD-34 — would produce a
watcher nobody runs.

---

## 6 · Transaction map

| Command                | One transaction writes                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SubmitForCioDecision` | submission · eligibility-basis rows · case `review → decision` · events                                    |
| `RecordCaseDecision`   | decision · decision_revisions · dissent · triggers · submission → `decided` · case `decision → …` · events |
| `ReturnFromCioReview`  | submission → `returned` · case `decision → returned` · events                                              |

One command, one transaction, one ledger entry. No handler opens a transaction.
No provider runs — there is none in C1D.

---

## 7 · Event map

All ids derived from the command; all structured; no prose.

| Event                       | Subject  | Structured payload                                         |
| --------------------------- | -------- | ---------------------------------------------------------- |
| `revision-submitted-to-cio` | `thesis` | revisionId, submissionId, blockerCount: 0                  |
| `cio-queue-item-opened`     | `case`   | caseId, submissionId                                       |
| `case-decision-recorded`    | `case`   | decisionId, selectedRevisionId, dissentCount, triggerCount |
| `revision-selected`         | `thesis` | revisionId, decisionId                                     |
| `revision-not-selected`     | `thesis` | revisionId, decisionId                                     |
| `decision-superseded`       | `case`   | supersededDecisionId, supersedingDecisionId                |
| `returned-from-cio-review`  | `case`   | submissionId, returnedFor                                  |

`transition_events.subject` widens with nothing new — `case` and `thesis` cover
all of it. A `decision_id` column is added alongside `review_id` and
`challenge_id`, constrained to `subject = 'case'`.

---

## 8 · The headquarters snapshot

`application/analysis/headquarters.ts`:

```ts
export async function getHeadquartersSnapshot(
  repositories: AnalysisRepositories,
  organization: Organization,
  now: string,
): Promise<HeadquartersSnapshot>
```

**A read model, not a second aggregate.** It writes nothing, stores nothing and
holds no state; every field is derived from the authoritative records on each
call, in the same way eligibility is. Two consequences worth stating: it can be
wrong only by reading wrongly, and it can never disagree with the record.

### 8.1 Shape

```
HeadquartersSnapshot
  organization      departments, teams, reporting lines, employees   (from the seed)
  departments[]     id, workload{queued,active,waiting,submitted,returned},
                    queue: AssignmentRef[], presence (§10)
  cases[]           id, stage, question, subject, ownerEmployeeId, openedAt,
                    currentRevisionRef, health (§11), blockers: Blocker[],
                    waitingOn: WaitBasis[]
  governanceQueues  verification[], devilsAdvocate[], risk[], aggregation[], cio[]
                    — each an item with caseId, revisionId, since, and the
                      department that owes it
  eligibleForCio[]  { caseId, revisionId, thesisId } — derived, never stored
  recentDecisions[] { decisionId, caseId, selectedRevisionId, decidedAt, decidedBy }
  activity[]        structured TransitionEvent references, newest first, bounded
  metrics           §9 current-state only
  asOf              the `now` that was passed in
```

**References, not payloads.** No evidence items, no claim bodies, no finding
detail, no rationale text. A department tile needs a count and a link; loading
the floor must not load the firm's analysis. Focused reads come later, by id.

A fitness rule with a planted violation: the snapshot type may not contain
`EvidenceSet`, `AgentClaim`, `VerificationFinding` or `CaseDecision` — only their
reference shapes.

### 8.2 One headquarters

The shape follows the product vision and is the reason `departments[]` is a flat
list rather than a tree of rooms: every department is present in one snapshot,
expandable in place, with specialists under managers and governance functions
holding their own queues. Nothing in the read model is per-agent, and nothing is
addressable as an isolated conversation.

**C1D does not touch the UI.** It provides what the migration will consume, and
the fitness rule keeping `components/` and `routes/` off the analysis runtime
stays exactly as it is.

---

## 9 · Metrics

**Current-state** — computed inside the snapshot from records already loaded, so
they cost no extra query: active cases, intake cases, blocked cases,
governance-blocked revisions, waiting assignments, running assignments, failed
required assignments, the four queue sizes, the CIO queue, eligible cases.

**Historical** — a separate function, a separate query path, and not part of the
snapshot: cycle time, department processing time, review turnaround, waiting
time. Each is an aggregate over history, and putting one in the floor load would
make every page view scan the event log.

**C1D-2 ships current-state only.** Historical metrics land in C1D-3 or later,
behind a bounded time window and their own cache, and the plan does not pretend
the window is free.

---

## 10 · Presence

Derived, and only from states a durable record can support:

| Presence    | Derived from                                                |
| ----------- | ----------------------------------------------------------- |
| `idle`      | no open assignment                                          |
| `queued`    | an assignment in `queued`                                   |
| `waiting`   | an assignment in `waiting`, with its `WaitBasis`            |
| `running`   | a run in `running`                                          |
| `reviewing` | a governance assignment in `active` on a submitted revision |
| `blocked`   | a failed required assignment, or a returned assignment      |

**Nothing else.** No `reading`, `writing`, `thinking`, `meeting` or `discussing`
— each would be a claim about an inner state no record supports, and the
activity feed is the one thing in this system that must never describe work that
did not happen.

**Recorded and stub work stays visibly non-live.** Presence carries the run's
`providerKind`, so a floor showing `running` for a stub can say so. A fitness
rule forbids a presence value outside the six.

---

## 11 · Case health

A named domain function, `evaluateCaseHealth`, returning one bounded state.
Mechanical definitions, evaluated in order:

| State           | Definition                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------- |
| `selected`      | a live decision selected a revision of this case                                            |
| `rejected`      | a live decision selected none, or the case stage is `withdrawn`                             |
| `critical`      | stage is `blocked`, **or** a required assignment failed non-retryably                       |
| `blocked`       | the current revision has ≥1 `blocks-decision` blocker that is not merely "not yet reviewed" |
| `needs-review`  | the current revision is `awaiting-verification` with a governance queue item open           |
| `ready-for-cio` | the current revision is eligible and not yet submitted                                      |
| `waiting`       | an open assignment is `waiting`                                                             |
| `healthy`       | none of the above                                                                           |

**Stage blocking and governance blocking are kept apart.** `critical` comes from
the case stage or a failed desk; `blocked` comes from the governance gate. A
single "blocked" would make "the Risk desk rejected this" and "somebody blocked
the case" the same word, and they need different people.

No colour, no wording, no icon in the domain. The presentation layer maps these
eight to whatever it shows.

---

## 12 · Eligibility transition events — recommendation

Both options were evaluated.

**Option A — observe and record transitions.** A projection observer compares
the previously projected eligibility for a revision with the current derived
answer and appends an event when they differ, carrying `observedAt` and the
policy version. Idempotent (write-once on `(revisionId, fromState, toState,
observedAt)`), revision-scoped, driven by `revisionEligibility`, and unable to
invent eligibility because it only ever records what that function returned.

**Option B — expose current derived state only.** No transition events; the
snapshot answers "is it eligible now", and the event log already contains every
cause — the verdict, the resolution, the aggregation — from which a reader can
see _why_ it changed.

**Recommendation: Option B for C1D, with Option A deferred to the phase that
introduces a scheduler.**

The reason is honesty about time. An observer only runs when something invokes
it, so `observedAt` would be "when a page was loaded", and the gap between the
logical change and the observation would be unbounded and invisible. Every
consumer would read it as a transition time, because that is what a transition
event is for. Meanwhile the causes are already durable and already ordered: the
Risk verdict that unblocked a revision has an event with its own `occurredAt`,
and it is a better answer to "when did this become eligible" than an observation
timestamp would be.

If Option A is wanted anyway, C1D-3 is where it belongs — after C1D-2 exists to
be observed, and with `observedAt` named in the schema and the type so no reader
can mistake it. **Say which you want.**

---

## 13 · Files, queries and restart

### New

| File                                                                  | Stage |
| --------------------------------------------------------------------- | ----- |
| `application/analysis/commands/submitForCioDecision.ts`               | C1D-1 |
| `application/analysis/commands/recordCaseDecision.ts`                 | C1D-1 |
| `application/analysis/commands/returnFromCioReview.ts`                | C1D-1 |
| `application/analysis/eligibilityBasis.ts`                            | C1D-1 |
| `domain/analysis/reconsideration.ts`                                  | C1D-1 |
| `infrastructure/analysis/postgres/decisionRepositories.ts` (extended) | C1D-1 |
| `db/migrations/0020_cio_decisions.sql`                                | C1D-1 |
| `application/analysis/headquarters.ts`                                | C1D-2 |
| `application/analysis/timeline.ts`                                    | C1D-2 |
| `domain/analysis/health.ts`                                           | C1D-2 |
| `domain/analysis/presence.ts`                                         | C1D-2 |
| `db/migrations/0021_headquarters_indexes.sql`                         | C1D-2 |

Domain contract 7 → **8**. Command contract 2 → **3**: `RecordCaseDecision`
introduces a decision category the ledger has not carried before, and reading an
older entry under a newer contract is what the per-command version exists to
prevent.

### Query plan

The snapshot's budget is **a fixed number of statements, independent of how many
cases, departments or reviews exist** — the property `queryCount.pg.test.ts`
already asserts for `cases.list` and `cases.get`, extended to the floor.

Target: **≤ 12 statements**, all batched by `= ANY($1)` over id arrays, never
per-case in a loop. A pg test pins the count and fails if it grows, which is the
only thing that stops an N+1 arriving one convenience at a time.

Migration 0021 adds only the indexes that budget needs: open assignments by
department, active reviews by revision, events by case ordered by
`(occurred_at, event_id)`, submissions by state.

### Restart

Every C1D-1 and C1D-2 test that asserts durability uses the C1C-4.1 harness:
close the pool, prove a read through the dead runtime fails, rebuild, compare a
canonical institutional projection. `institutionalState` is extended with the
decision, its dissent, its triggers, the submission and its eligibility basis.

---

## 14 · What C1D can honestly show, and what it cannot

Stated here rather than discovered later.

**It can honestly show:** which cases exist and at what stage; who is working on
what and who is waiting on whom; every governance queue and its size; which
revisions are eligible for the CIO and which are blocked and by exactly what;
the decisions taken, by whom, on what basis; and an activity feed projected from
durable structured events.

**It cannot honestly show that a blocked case is being handled.** TD-41: no
escalation exists. Nothing routes a blocked revision to a manager, nothing
acknowledges it, nothing tracks it to resolution. The floor may show _that_ a
case is blocked and _why_; it may not imply anybody is on it.

**It cannot honestly show a correction-required case as in progress.** TD-43:
`ReturnFromCioReview` and a `correction-required` verdict both produce a
truthful blocker and **no work**. No assignment is created, no department owes
anything, no due state exists. The floor must render these as _awaiting a
decision by a person_, not as active work.

**Required before the Agents headquarters may claim every blocker has a
resolution workflow:**

1. **TD-41** — escalation: recipient, owner, reason, severity, due,
   acknowledged, resolved, and the exact case/revision/assignment/review/
   challenge it concerns, with structured events.
2. **TD-43** — correction work: a correction assignment naming the responsible
   department, the exact findings to address, a due state, the revision
   expected, and completion-and-resubmission, with the failed review preserved
   and **the reviewed revision never mutated**.
3. **TD-34** — abandoned-run recovery, before any long-running provider.

A fitness rule for C1D-2, with a planted violation: no snapshot field may be
named `escalations`, `assignedTo` or `dueAt` until those exist — so the read
model cannot grow a field that implies a workflow the system does not have.

---

## 15 · Tests

**C1D-1 (PostgreSQL):** eligible revision submitted · blocked revision refused,
naming the blocker kinds · stale case version refused · wrong department refused
· system actor refused for both submission and decision · non-chief mandate
refused · immutable decision (a second differing write fails) · not-selected
alternatives preserved · rejected alternatives preserved · unresolved
non-blocking dissent preserved with its acknowledgement · decision-critical
dissent blocks submission · reconsideration triggers round-trip with comparator,
threshold, unit and rationale · a trigger with neither comparator nor qualitative
condition refused · superseding decision keeps the predecessor intact · decision
survives restart with identical institutional meaning · `ReturnFromCioReview`
moves the case and creates no assignment (asserted, because that is TD-43).

**C1D-2 (PostgreSQL):** snapshot survives restart · timeline deterministic
across two runtimes · timeline ordering stable under identical timestamps ·
current-state metrics correct against a hand-built fixture · presence derived
only from durable states · every presence value in the bounded six · case health
for each of the eight states · **no heavy payload in the snapshot** (fitness
rule) · **no duplicate eligibility logic** (existing three rules, extended to
`headquarters.ts`) · snapshot query count pinned.

**Absence, both stages:** no LLM · no UI change · no publication command · no
portfolio or execution command · the approved command list grows by exactly
three.

---

## 16 · Risks

| Risk                                                               | Response                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| The snapshot becomes an N+1 one convenience at a time              | Pinned query count in a pg test, from the first commit                                                             |
| `case_decisions` primary key moves from `case_id` to `decision_id` | Mechanical; no production rows; the partial unique index preserves one-live-decision                               |
| Dropping `governance` jsonb                                        | Guarded like `reviews.detail` in 0019 — the guard fails the migration rather than losing data                      |
| The eligibility basis duplicates the derivation                    | It is a _snapshot of the answer_, never an input to it; the three eligibility rules extend to cover the new module |
| `eligibilityPolicyVersion` is forgotten when a threshold changes   | A domain test asserts the version changes with the thresholds                                                      |
| Case health drifts from the blockers it summarises                 | Derived from the same `Blocker[]`, never from a stored state                                                       |
| The floor implies work is being handled                            | §14, plus the fitness rule forbidding escalation-shaped fields                                                     |

---

## 17 · Technical Debt & Future Improvements

**Expected to open in C1D**

- **TD-47 · No monitoring of reconsideration triggers.** Conditions are
  recorded and nothing watches them. Needs the scheduler TD-34 also needs.
- **TD-48 · Historical metrics unbounded.** C1D-2 ships current-state only;
  the historical path needs a window and a cache before it is loaded on a page.
- **TD-49 · Decision correction has no approval path.** Anyone with the
  chief-decision mandate may supersede a decision. Whether that needs a second
  signature is a governance question this phase does not answer.

**Carried forward**

TD-34 (abandoned-run recovery — hard gate before a live provider) · TD-35
(exceptional-aggregation override) · TD-36 (aggregation read model — folded into
C1D-2's snapshot) · TD-37 (cross-case result reuse) · TD-39 (tier-2 phase gates
still unproved; the C1D rules go in the registry with fixtures from the start) ·
**TD-41** (escalation — blocks the headquarters' operational-completeness claim,
not C1D) · **TD-42** (compliance — hard gate before publication, client
communication, investment letters, recommendations presented as approved output,
or Editorial release; and it stays separate from Verification and Editorial) ·
**TD-43** (correction work — before a real LLM-backed agent and before the
headquarters presents the workflow as operationally complete) · **TD-44**
(eligibility stays derived; measure before optimising) · **TD-46** (review-race
allocation unproven at production concurrency) · TD-8, TD-24, TD-25, TD-26,
TD-27, TD-33 enforcement.

---

## 18 · Exit criteria

- three commands registered; the approved list grows by exactly three
- decision and submission immutable, superseding rather than editing
- the eligibility basis explains _why_, never `eligible: true` alone
- reconsideration triggers structured and round-tripping
- headquarters snapshot from PostgreSQL, within its pinned query budget
- timeline deterministic across a restart
- presence and case health derived, bounded, and mechanically defined
- eligibility produced by `evaluateRevisionEligibility` alone, proved by the
  registry rules extended to the new modules
- every new load-bearing rule carries a planted violation and a benign near-miss
- no LLM, no UI change, no publication, no execution
- both suites green, `tsc` clean, working tree clean

---

## Open questions for the gate

1. **`ReturnFromCioReview`** — recommended as a third command (§1.2). Confirm,
   or restrict C1D to two.
2. **Eligibility transition events** — Option B recommended (§12): current
   derived state only, with the observer deferred to the phase that has a
   scheduler. Confirm, or ask for Option A in C1D-3.
3. **C1D-3** — conditional on both of the above plus measured query counts.
   Confirm it may be dropped if C1D-2's budget holds.

Nothing is implemented until this plan is approved.
