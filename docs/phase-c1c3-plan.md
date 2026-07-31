# Phase C1C-3 — aggregation, revision minting and the conditional gate

Planning gate. Nothing in this stage is implemented until it is approved.

C1C-2 gave the firm contributions: a desk produces claims, the institution
accepts or refuses them, and the record says which. C1C-3 is the act that turns
several desks' claims into **one argument the firm is prepared to be judged on**
— and the act that decides whether Risk has anything to review.

The stage exists because that act is where analysis is most easily lost. A
manager reconciling four desks can quietly drop the one that disagreed, and the
result reads exactly like a manager who reconciled four desks that agreed. Every
decision below follows from refusing that.

---

## 0. What already exists, and what that changes

| Already true after C1C-2                                                                      | Consequence for this stage                                                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `RecordContribution` stores claims under derived ids, immutably, with dispositions of its own | Aggregation reads stored claims and never rewrites them                            |
| Reviews are revision-scoped (storage stage 1.5)                                               | A new revision inherits no verdict **by construction** — there is nothing to clear |
| `RequirementResolution` is keyed on an exact `revisionId`                                     | A new revision reopens the conditional gate **by construction**                    |
| `reviseThesis()` in the domain already mints revision _n+1_ and supersedes _n_                | The shared minting operation wraps this rather than reinventing it                 |
| `evaluateRequirement()` is the only producer of a resolution                                  | `ResolveConditionalRequirement` recomputes rather than accepts                     |
| `RISK_REVIEW_WHEN_IMPLEMENTABLE` reads declared `implications`, never prose                   | The "no prose scanning" requirement is already structural                          |
| The orchestrator writes only through commands                                                 | Aggregation is a command the orchestrator may initiate and cannot author           |

Two things are **not** already true and are the substance of this stage: there is
no record of _how_ a manager reached a conclusion, and `ProposeThesis` still
accepts a caller-supplied `revisionId` — a TD-30 leftover that C1C-1 removed
everywhere else.

---

## 1. The aggregation record is first-class

**D-C1C3-1. A manager aggregation is its own immutable record, not fields on the
thesis revision.**

Two different questions, two different records:

| Record                              | Answers                             |
| ----------------------------------- | ----------------------------------- |
| `InvestmentThesis` (revision _n+1_) | What the firm's position now **is** |
| `ManagerAggregation`                | **How** the manager arrived at it   |

The revision is what governance reviews and what the CIO selects; it must read
as a position. The aggregation is process history — which contributions were in
scope, what happened to every claim in them, which perspectives were missing,
who synthesised, and why. Folding the second into the first would make the
conclusion harder to read than its own construction history, and the CIO would
be selecting between arguments padded with bookkeeping.

They **commit atomically**. An aggregation whose revision rolled back would
describe a synthesis that never happened; a revision without its aggregation
would be a managerial conclusion with no account of how it was reached, which is
precisely the state this stage exists to make impossible.

The revision keeps only what a _position_ needs: statement, position,
implications, invalidation criteria, supporting and opposing claim references,
and the lineage. It gains one field — `aggregationId` — so the construction
history is one hop away and never inline.

---

## 2. Claim preservation and disposition

**D-C1C3-2. Every claim inside the aggregation's declared input scope receives
an explicit disposition. The manager chooses the scope; the manager does not
choose which claims inside it to answer for.**

### The declared input set

The aggregation names the exact contributions it considered — a set of **run
ids**, each of which is a completed, accepted contribution. From those runs the
claim set is derived, not declared: the manager cannot narrow scope one claim at
a time.

Two rules bound the manager's freedom to choose scope:

1. **Every required upstream entry's completed run must be in the set.** A
   manager cannot exclude the macro desk by leaving it out of scope; §4 refuses
   the command outright if that desk has not delivered.
2. **Every optional upstream entry must be accounted for** — either its run is
   in the set, or the optional-input record says why it is not (§5).

Anything else — an ad-hoc contribution from a desk the playbook did not name, a
run against a superseded revision — may legitimately be out of scope, and its
absence is visible because the input set is stored.

### The disposition vocabulary

```ts
export type ClaimDisposition =
  | 'adopted-supporting'
  | 'adopted-opposing'
  | 'retained-unresolved'
  | 'superseded-by-stronger-evidence'
  | 'excluded-duplicate'
  | 'excluded-out-of-scope'
  | 'excluded-methodologically-incompatible'
  | 'excluded-insufficiently-supported'
```

Closed, for the same reason `RunFailureCategory` is closed: a free-text field on
the path where work disappears is where the reasons stop being comparable.

| Disposition                       | Effect on the revision                                                             | Explanation  |
| --------------------------------- | ---------------------------------------------------------------------------------- | ------------ |
| `adopted-supporting`              | added to `supportingClaimIds`                                                      | optional     |
| `adopted-opposing`                | added to `opposingClaimIds`                                                        | optional     |
| `retained-unresolved`             | added to `opposingClaimIds` **and** to the aggregation's `unresolvedDisagreements` | **required** |
| `superseded-by-stronger-evidence` | not on the revision; names `supersededByClaimId`                                   | **required** |
| `excluded-*`                      | not on the revision                                                                | **required** |

`retained-unresolved` is the disposition the whole design is for. A manager who
cannot reconcile two desks must be able to say so without either deleting the
disagreement or being blocked by it — and the CIO must see it. It is **not** an
exclusion: the claim stays attached to the revision as opposing.

### Unresolved disagreement carries materiality

**D-C1C3-11. Unresolved disagreements do not all behave the same way.**

```ts
export type DisagreementMateriality = 'non-material' | 'material' | 'decision-critical'
```

| Materiality         | What follows                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `non-material`      | travels to the CIO with disclosure; blocks nothing                                                      |
| `material`          | travels, and carries `escalationRequired: true` — a manager escalation or a CIO acknowledgement is owed |
| `decision-critical` | **blocks eligibility** until resolved or overridden by an authorized governance or decision command     |

Every `retained-unresolved` disposition records: `claimId`, `disposition`,
`materiality`, `rationale`, the accountable manager (once, on the aggregation),
`escalationRequired`, and `blocksEligibility`.

`blocksEligibility` is stored rather than recomputed downstream, and it is
derived by one domain function — `disagreementBlocksEligibility(materiality)` —
so the stored consequence and the rule that produced it cannot drift.

**The eligibility decision itself stays where it already lives.**
`evaluateRevisionEligibility()` gains a `blockingDisagreements` input alongside
its existing `missingRequiredContributions`, exactly as C1C-4 will supply the
latter. The aggregation handler records facts; it does not decide eligibility,
and nothing about eligibility is reimplemented inside it.

**Materiality cannot be quietly downgraded.** A later aggregation on the same
lineage recording a lower materiality for a claim than the highest previously
recorded must state why: the rationale is required, the prior level is stored as
`downgradedFrom`, and the record names the manager who did it. A manager may
change their mind; a manager may not change their mind invisibly to clear a
gate. Raising materiality needs no justification, for the obvious asymmetry.

### What a disposition preserves

Per claim: `claimId`, `runId` (source contribution), `disposition`,
`reasonCode` (the disposition itself is the bounded code), `explanation` where
required, `materiality` / `escalationRequired` / `blocksEligibility` /
`downgradedFrom` for unresolved disagreements, and — carried once on the
aggregation rather than repeated per row — the accountable manager and the
timestamp.

### Refusals, each one a test

- a claim in scope with no disposition → `invariant-violated`
- a claim with two dispositions → `invariant-violated`
- a disposition naming a claim outside the declared input set → `not-found`
- `superseded-by-stronger-evidence` whose `supersededByClaimId` is not itself
  adopted in this aggregation → `invariant-violated`
- an excluded or superseded claim with a blank explanation → `invariant-violated`
- `retained-unresolved` with no materiality or no rationale →
  `invariant-violated`
- a materiality downgrade with no rationale → `invariant-violated`
- `adopted-supporting` for a claim whose own `opposesThesisId` names this
  lineage → `invariant-violated` (a manager may weigh a claim, not invert it)
- any attempt to write a modified claim → impossible: the command has no claim
  write path at all, and `claims.save` is write-once with a semantic-key
  conflict check

The original contribution and its claims are never touched, and no disposition
deletes either. The aggregation references them; that is the only relationship
it has to them.

### Scope cannot be used to hide contrary work

**D-C1C3-12. A completed contribution that opposes the lineage is in scope
whether the manager lists it or not.**

Three rules, checked before anything is written:

1. every required upstream entry's completed run is in the declared set (§4)
2. every completed run holding a claim whose `opposesThesisId` names this
   lineage is in the declared set — mechanical, not a judgement call, and the
   one rule that makes scope selection unusable as a way to lose a dissenting
   desk
3. every **available** optional contribution the manager declares materially
   relevant is in the declared set

For an available optional contribution the manager keeps out of scope, the
aggregation records a bounded reason:

```ts
export type ContributionScope =
  | 'in-scope'
  | 'excluded-out-of-scope'
  | 'excluded-duplicate'
  | 'excluded-methodologically-incompatible'
  | 'excluded-other'
```

with an explanation required for every `excluded-*`, and `materiallyRelevant`
recorded beside it. A materially relevant available contribution may not be
excluded at all; an opposing one may not be excluded regardless of what the
manager declares about its relevance.

---

## 3. One authoritative revision-minting operation

**D-C1C3-3. `application/analysis/revisions.ts` holds the one operation that
mints a revision. Three commands call it; no command calls another command.**

```ts
export async function mintRevision(
  repositories: TransactionalAnalysisRepositories,
  input: {
    caseId: string
    thesisId: string
    /** Null for the first revision of a lineage. */
    prior: InvestmentThesis | null
    changes: ThesisRevisionInput
    cause: RevisionCause
    reason?: string
    proposedByDepartmentId: string
    lifecycle: 'proposed' | 'under-analysis'
  },
  context: CommandContext,
): Promise<InvestmentThesis>
```

It enforces, in one place:

| Rule                             | How                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| prior revision immutable         | reads it, writes only its `lifecycle: 'superseded'`                                                    |
| valid lineage                    | `thesisLineage()` over the case's revisions before writing                                             |
| monotonic numbering              | `prior.revisionNumber + 1`, or 1                                                                       |
| exact supersedes                 | `supersedesRevisionId = prior.revisionId`                                                              |
| no cycles                        | `thesisLineage()` re-validated after the write within the transaction                                  |
| revision reason policy           | required whenever `prior` is present (`buildThesis` already refuses otherwise)                         |
| case and thesis ownership        | the prior revision's `caseId` must match; the lineage must belong to the case                          |
| gates begin empty                | nothing to do — reviews are revision-scoped and the new id has none                                    |
| resolutions do not carry forward | nothing to do — resolutions are revision-scoped                                                        |
| deterministic identity           | `deriveRevisionId(context.commandId, thesisId)`                                                        |
| persistence and events           | `theses.save()` for both revisions plus one `thesis` transition event, inside the caller's transaction |

**How `ProposeThesis` uses it with no prior revision.** `prior: null` is the
first-revision case, not a special path: numbering starts at 1,
`supersedesRevisionId` is absent, no prior revision is superseded, the reason
stays optional and the lifecycle is `proposed`. `buildThesis` already refuses a
revision 1 that supersedes anything, so the two shapes cannot be confused.

**`ProposeThesis` stops accepting a caller-supplied `revisionId`** and derives it
like everything else since C1C-1. This is the last caller-supplied identity in
the command layer.

`RevisionCause` is a bounded companion to the free-text reason:

```ts
export type RevisionCause =
  | 'initial-proposal'
  | 'manager-aggregation'
  | 'new-evidence'
  | 'correction'
  | 'governance-finding'
  | 'changed-assumption'
  | 'resolved-challenge'
```

The prose says what happened; the cause makes "how often does governance send a
thesis back" answerable without reading paragraphs.

---

## 4. Required work is derived, and blocks

**D-C1C3-4. `AggregateManagerConclusion` refuses to run on an incomplete
required workflow. No `missingRequiredContributions` field is stored.**

Readiness is derived at execution time from four authoritative sources:

1. the case's pinned playbook entries and their dependency edges
2. assignments for the case
3. run states
4. accepted contributions — a run is `completed`, which only
   `RecordContribution` can produce

**The rule.** Let _U_ be the transitive `blockedBy` closure of the aggregation
entry. Every entry in _U_ whose effective requirement is `required` — or is
`conditional` and has resolved `required` for the source revision — must have a
completed run with at least one stored claim.

The command rejects **before minting anything** when:

- a required blocking assignment is incomplete
- the accepted required contribution is missing
- a required run failed
- a conditional dependency resolved `required` and is incomplete
- a required source contribution was refused rather than accepted
- the manager's declared scope omits required work

Every rejection is `illegal-prior-state` with a bounded detail naming the entry
keys, durably recorded in the ledger. Nothing partial is persisted: the
aggregation and the revision are written after every check, in one transaction,
or not at all.

A failed required run does not become acceptable by being retried into
existence: retryable failures return the assignment to its queue, and the
aggregation simply cannot run until a completed run exists.

**No minting-then-labelling.** A revision is not created and then marked
blocked. A manager's conclusion drawn from work that never arrived is not a
weaker conclusion; it is a different one, and the record must not contain it.

**Overrides are a separate act.** If the firm ever needs to aggregate without a
required desk, that is an explicit command — a named authority, a required
reason, its own ledger entry — and not a flag on this one. Out of scope for
C1C-3; recorded in §14 as TD.

`evaluateRevisionEligibility()` already accepts an optional
`missingRequiredContributions` argument. C1C-4 supplies it from this same
derivation for the _eligibility_ read; nothing stores it.

---

## 5. Optional work is snapshotted, not derived

**D-C1C3-5. The aggregation records what was available when the manager acted.
Nothing recomputes it afterwards.**

For every optional entry in _U_, one of:

```ts
export type OptionalInputAvailability =
  | 'received-and-used'
  | 'received-not-adopted'
  | 'failed'
  | 'timed-out'
  | 'cancelled'
  | 'superseded'
  | 'unavailable-at-aggregation'
```

Recorded on the aggregation with the entry key and, where one exists, the run
id — beside the `ContributionScope` and `materiallyRelevant` of §2, so an
available contribution says both what happened to it and why it is or is not in
scope. Derived at read time this would change as late contributions landed, and
the record would stop describing what the manager actually had — the same
reasoning that put `missingOptionalInputs` on the run at start time in C1C-1.

The manager may proceed without optional work. Three things follow:

- the absence is permanently visible on the aggregation
- confidence composition may cap or reduce accordingly (`composeConfidence`
  already has the vocabulary; the aggregation supplies the signals)
- a later governance review may find the missing perspective material, and the
  record shows exactly what was missing and when

**Late optional work never rewrites history.** A contribution that lands after
the aggregation cannot change the snapshot, cannot be attached to the revision
that was minted without it, and cannot silently alter what the manager is
recorded as having had. If it is material, the response is a **new**
aggregation, a **new** revision and reopened governance — which is exactly the
sequence this stage already supports.

---

## 6. `AggregateManagerConclusion` — the contract

| Field           | Value                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `type`          | `AggregateManagerConclusion`                                                                      |
| `category`      | `analysis`                                                                                        |
| `mandate`       | `department-manager` (the case's aggregating department, `research-office` in the Macro playbook) |
| `versionPolicy` | `refuses-expected-version` — it mints a revision; it does not move case stage                     |
| `reasonPolicy`  | `optional` — the aggregation rationale is a required _input field_, not the envelope reason       |
| `resultKind`    | `revision`; `resultRef` is the new `revisionId`                                                   |

### Input

```ts
export interface AggregateManagerConclusionInput {
  caseId: string
  /** The revision being synthesised from. Must be the lineage's current one. */
  sourceRevisionId: string
  /** Declared for the mandate; verified against the case's playbook entry. */
  departmentId: string
  /** Exact contributions considered. Completed runs on this case. */
  inputRunIds: readonly string[]
  /** One per claim in those runs. Completeness is checked, not trusted. */
  dispositions: readonly ClaimDispositionInput[]
  optionalInputs: readonly OptionalInputRecordInput[]
  /** Why this synthesis reads as it does. Required, and stored on the record. */
  rationale: string
  /** The resulting position. */
  statement: string
  position: string
  implications: readonly InvestmentImplication[]
  invalidationCriteria: string
  horizon?: string
}
```

The manager states the resulting content explicitly rather than the command
deriving it: a synthesis is a judgement, and a command that assembled a
statement out of claims would be authoring the conclusion itself.

### Execution order

1. case exists and is not `published` / `withdrawn`
2. `sourceRevisionId` exists, belongs to the case, is the lineage's **current**
   revision, and is not `superseded`
3. the actor's department owns the case's aggregation entry; the actor is that
   department's manager
4. required-work readiness (§4) — reject `illegal-prior-state` if unmet
5. every `inputRunId` is a completed run on this case; every required upstream
   entry's run is present
6. claim-set completeness and disposition validity (§2)
7. optional-input accounting covers every optional entry in _U_ (§5)
8. build the `ManagerAggregation`; `aggregations.save()`
9. `mintRevision()` with `cause: 'manager-aggregation'`, supporting and opposing
   claim ids taken from the dispositions
10. link the aggregation to the revision it produced; append events

All of it in `runCommand`'s single transaction.

### Authorization

`department-manager` resolves through `authorize()` to
`manager-of-department` — the department's `managerEmployeeId` and nobody else.
A specialist in the same department fails; a governance employee fails; a system
actor fails, because `ActorSnapshot.kind` must be `employee`.

**The orchestrator may initiate and may not author.** The envelope separates the
two already: `initiator: { kind: 'orchestrator' }` with
`actor: { kind: 'employee', employeeId: <the manager> }`. The accountable actor
is the manager in every case, and a command whose _actor_ is an orchestrator is
refused by the mandate.

---

## 7. `ReviseThesis` versus `AggregateManagerConclusion`

Distinct commands, one minting mechanism.

|                    | `AggregateManagerConclusion`                              | `ReviseThesis`                                                |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| when               | a manager synthesises designated specialist contributions | an existing thesis must change for a stated cause             |
| requires           | input set, dispositions, optional accounting, rationale   | a revision cause and a reason                                 |
| mandate            | `department-manager`                                      | `thesis-owner`                                                |
| cause              | always `manager-aggregation`                              | any cause except `manager-aggregation` and `initial-proposal` |
| aggregation record | always                                                    | never                                                         |

**D-C1C3-6. `ReviseThesis` is `thesis-owner`, which is the department that
proposed the revision being revised — and the aggregating manager reaches the
same lineage through `AggregateManagerConclusion`, not through this command.**

The alternative — letting a manager revise any thesis under a manager mandate —
would give one act two authorities and make "who changed this argument" answer
"someone allowed to". A manager who wants to change a thesis they do not own
either performs an aggregation (which is what a manager's change _is_) or asks
the owning desk. `cause: 'manager-aggregation'` is refused on `ReviseThesis`
precisely so it cannot masquerade as one.

Both mint immutable revisions; neither edits a prior one.

---

## 8. `ResolveConditionalRequirement` — closing TD-29

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| `category`      | `governance`                                       |
| `mandate`       | `governance-verdict` with `discipline: 'risk'`     |
| `versionPolicy` | `refuses-expected-version`                         |
| `reasonPolicy`  | `required` (already on `REASON_REQUIRED_COMMANDS`) |
| `resultKind`    | `requirement-resolution`                           |

Input: `caseId`, `playbookEntryKey`, `revisionId`, and **no outcome**.

**D-C1C3-7. The command takes no `required` flag.** The plan's original wording
was that a supplied result disagreeing with the rule is rejected; taking none at
all is strictly stronger and simpler — there is nothing to disagree with. The
outcome comes from `evaluateRequirement()` over the revision's declared
`implications`, which is already the only producer of a resolution.

It verifies: the entry exists in the case's pinned playbook and is
`conditional`; the revision exists, belongs to the case and is current; the rule
named by the entry resolves through `requirementRule()`; and the actor's
department **handles** the `risk` discipline. Verification and the Devil's
Advocate are governance and fail, which C1C-1 already pinned with tests.

Stored write-once on `(caseId, playbookEntryKey, revisionId)`: the state
explicitly as `required` or `not-required`, the rule id and version, the
deterministic reason, the evaluator snapshot, the envelope reason and the
authorization basis.

**New: a normalized-input hash.** `RequirementResolution` gains `inputHash` — a
stable hash of the exact rule input (the sorted `implications`). It makes "was
this resolution computed from the revision it names" checkable years later
without re-running a rule version that may since have been superseded. Migration
0018 adds the column; the table is empty, so it is NOT NULL honestly.

A new revision has no row and is therefore `unresolved`. That is how aggregation
reopens the gate, and §9 is why the order matters.

---

## 9. Ordering, and why Risk comes after aggregation

```
required contributions complete   (derived, §4)
        ↓
accepted claims loaded            (stored, immutable)
        ↓
optional inputs accounted for     (snapshotted, §5)
        ↓
AggregateManagerConclusion        → aggregation record + revision n+1, atomically
        ↓
ResolveConditionalRequirement     → against revision n+1, by Risk
        ↓
C1C-4 governance                  → reviews revision n+1 exactly
```

Resolving Risk against the pre-aggregation revision would answer a question
about an argument nobody is going to review: revision 1's implications are the
proposing desk's, and revision 2's are the manager's. The gate must be decided
on the argument governance will actually see.

---

## 10. Files

### New

| File                                                                 | Contents                                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/analysis/aggregation.ts`                                 | `ManagerAggregation`, `ClaimDisposition`, `OptionalInputAvailability`, `buildManagerAggregation` with the completeness and explanation rules |
| `src/application/analysis/revisions.ts`                              | `mintRevision`, `RevisionCause`                                                                                                              |
| `src/application/analysis/commands/aggregateManagerConclusion.ts`    | the command                                                                                                                                  |
| `src/application/analysis/commands/reviseThesis.ts`                  | the command                                                                                                                                  |
| `src/application/analysis/commands/resolveConditionalRequirement.ts` | the command                                                                                                                                  |
| `src/application/analysis/requiredWork.ts`                           | the derivation in §4, shared by the command and (in C1C-4) eligibility                                                                       |
| `db/migrations/0018_aggregations.sql`                                | aggregation tables, `requirement_resolutions.input_hash`, `thesis_revisions.aggregation_id`                                                  |
| `src/infrastructure/analysis/postgres/aggregationRepositories.ts`    | the adapter                                                                                                                                  |
| `src/infrastructure/analysis/aggregation.test.ts`                    | aggregation and dispositions                                                                                                                 |
| `src/infrastructure/analysis/revisions.test.ts`                      | minting, lineage, inheritance                                                                                                                |
| `src/infrastructure/analysis/conditionalRequirements.test.ts`        | the Risk gate                                                                                                                                |
| `src/infrastructure/analysis/postgres/c1c3Schema.pg.test.ts`         | what 0018 makes impossible                                                                                                                   |

### Changed

| File                                                  | Change                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/domain/analysis/theses.ts`                       | `aggregationId?` on `InvestmentThesis`                                                                                               |
| `src/domain/analysis/requirements.ts`                 | `inputHash` on `RequirementResolution`; `requirementInputHash()`                                                                     |
| `src/domain/analysis/index.ts`                        | export `aggregation.ts`; `DOMAIN_CONTRACT_VERSION` → `6`                                                                             |
| `src/application/analysis/commands/proposeThesis.ts`  | onto `mintRevision`; drops caller-supplied `revisionId`                                                                              |
| `src/application/analysis/commands/eventIdentity.ts`  | `deriveRevisionId`, `deriveAggregationId`                                                                                            |
| `src/application/analysis/commands/registry.ts`       | three commands registered                                                                                                            |
| `src/application/analysis/commands/definition.ts`     | `ReviseThesis` and `ResolveConditionalRequirement` already on `REASON_REQUIRED_COMMANDS`; assert `AggregateManagerConclusion` is not |
| `src/application/analysis/repositories.ts`            | `AggregationRepository` port                                                                                                         |
| `src/infrastructure/analysis/inMemoryRepositories.ts` | the in-memory half                                                                                                                   |
| `src/infrastructure/analysis/repositoryContract.ts`   | parity coverage for aggregations                                                                                                     |
| `src/test/importGraph.test.ts`                        | approved-command list; the new fitness rules in §15                                                                                  |

---

## 11. Migration 0018

```
analysis.aggregations
  id, case_id, tenant_id, source_revision_id, produced_revision_id,
  manager_employee_id, department_id, rationale, aggregated_at, provenance_id
  UNIQUE (produced_revision_id)        -- one aggregation per revision

analysis.aggregation_inputs
  aggregation_id, run_id, playbook_entry_key, requirement_level
  PRIMARY KEY (aggregation_id, run_id)

analysis.aggregation_claim_dispositions
  aggregation_id, claim_id, run_id, disposition, explanation,
  superseded_by_claim_id,
  materiality, escalation_required, blocks_eligibility, downgraded_from
  PRIMARY KEY (aggregation_id, claim_id)   -- exactly one disposition per claim
  CHECK (disposition IN (…the eight…))
  CHECK (disposition NOT IN (…superseded, the four excluded…)
         OR btrim(coalesce(explanation,'')) <> '')
  CHECK ((disposition = 'superseded-by-stronger-evidence')
         = (superseded_by_claim_id IS NOT NULL))
  -- Materiality belongs to unresolved disagreement and to nothing else.
  CHECK ((disposition = 'retained-unresolved')
         = (materiality IS NOT NULL))
  CHECK (materiality IS NULL
         OR materiality IN ('non-material','material','decision-critical'))
  CHECK ((materiality IS NULL)
         = (escalation_required IS NULL AND blocks_eligibility IS NULL))
  -- A downgrade says why.
  CHECK (downgraded_from IS NULL OR btrim(coalesce(explanation,'')) <> '')

analysis.aggregation_optional_inputs
  aggregation_id, playbook_entry_key, availability, run_id,
  scope, materially_relevant, explanation
  PRIMARY KEY (aggregation_id, playbook_entry_key)
  CHECK (availability IN (…the seven…))
  CHECK (scope IS NULL OR scope IN ('in-scope','excluded-out-of-scope',
         'excluded-duplicate','excluded-methodologically-incompatible',
         'excluded-other'))
  -- An available contribution says what became of it.
  CHECK ((run_id IS NULL) = (scope IS NULL))
  -- Excluding one requires a reason, and a materially relevant one may not be
  -- excluded at all.
  CHECK (scope IS NULL OR scope = 'in-scope'
         OR (btrim(coalesce(explanation,'')) <> '' AND NOT materially_relevant))
```

Every field a headquarters or governance query needs is a **column**: claim
ids, run ids, revision ids, disposition, materiality, scope and the eligibility
flag are all filterable and joinable. The only `jsonb` in this migration is the
manager's `rationale` — genuinely document-shaped prose that nothing filters
on.

Indexes for the queries C1D will actually issue: dispositions by
`(aggregation_id, disposition)`, unresolved disagreements by
`(blocks_eligibility)` where non-null, and aggregations by
`(case_id, aggregated_at)`.

Plus `ALTER TABLE analysis.thesis_revisions ADD COLUMN aggregation_id text`
(nullable — revision 1 has no aggregation) and
`ALTER TABLE analysis.requirement_resolutions ADD COLUMN input_hash text NOT NULL`
behind an empty-table guard, as 0015/0016/0017 did.

Grants: `SELECT, INSERT` only on all four aggregation tables. An aggregation is
a record of a judgement at a moment; a changed judgement is a new aggregation
and a new revision.

---

## 12. Transaction, event, idempotency and ambiguous-commit map

### Transactions

One command, one transaction, exactly as C1C-1 and C1C-2. Every write inside
`AggregateManagerConclusion` — aggregation, inputs, dispositions, optional
inputs, the new revision, the superseded prior revision, both events — commits
together or not at all. No command calls another; a fitness rule already forbids
it, and `mintRevision` is deliberately a shared _operation_ rather than a
command so that composing them cannot open a second transaction.

### Events

| Command                         | Events appended                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AggregateManagerConclusion`    | `thesis` `under-analysis` for the new revision (caused by the aggregation), `thesis` `superseded` for the prior |
| `ReviseThesis`                  | the same pair                                                                                                   |
| `ProposeThesis`                 | unchanged: `thesis` `proposed`                                                                                  |
| `ResolveConditionalRequirement` | one `requirement` event carrying the resolved state                                                             |

Every event id derives from `(commandId, recordType, entityId)`. No prose: the
floor renders these.

### Idempotency

The ledger's payload hash covers the semantic input, so a retry with the same
command id and the same content resolves to the original outcome without
re-executing. Derived identities make that safe: the same command id produces
the same `revisionId` and the same `aggregationId`, so a replay addresses the
same rows rather than minting revision 3 from revision 1. A **different** payload
under the same command id is `payload-conflict`, loudly.

### Ambiguous commits

Unchanged from C1A and correct here without special handling: `runCommand`
returns `unresolved` with a probe, and `resolveCommand` settles it by looking
for the command id. Because the revision id is derived rather than generated,
the settle is idempotent — a retry after an ambiguous commit either finds the
committed entry or writes the same rows.

---

## 13. Tests

Every item the review named, mapped to where it lands.

**`aggregation.test.ts`**

- the Research Office run and the manager aggregation are separate records, and
  both survive: the run keeps its claims, the aggregation keeps its dispositions
- refuses when the Research Office contribution has not been accepted
- the accountable manager is recorded independently of the run's provider and
  employee identity
- refuses when a required upstream entry has no completed run
- refuses when a required run failed and nothing replaced it
- refuses when a required run completed but its contribution was refused
- proceeds with a failed optional input, and records `failed`
- snapshots optional availability; a later contribution does not change it
- every claim in the declared input set has a disposition, or `invariant-violated`
- an opposing claim cannot vanish: `adopted-opposing` and `retained-unresolved`
  both land on the revision
- excluded and superseded dispositions require an explanation
- `superseded-by-stronger-evidence` must name an adopted claim
- the original claims are byte-identical after aggregation
- the aggregation and the revision commit atomically (forced mid-write failure)
- manager authorization: the manager passes; a specialist, a governance
  employee and another department's manager all fail
- an orchestrator initiator with a manager actor passes; an orchestrator _actor_
  fails
- the rejection is durably recorded in the ledger with its reason code
- a materially relevant available optional contribution cannot be left out of
  scope
- a completed contribution whose claims oppose the lineage cannot be left out of
  scope, whatever the manager declares about its relevance
- every material considered claim receives **exactly one** disposition; two
  dispositions for one claim is refused
- `decision-critical` unresolved disagreement sets `blocksEligibility`, and
  `evaluateRevisionEligibility` refuses the revision on that basis
- `non-material` unresolved disagreement stays visible and blocks nothing
- `material` unresolved disagreement records `escalationRequired`
- materiality cannot be downgraded without a rationale, and the prior level is
  preserved as `downgradedFrom`
- eligibility is decided by the domain function, not by the handler — asserted
  by a fitness rule (§15)
- a late optional contribution does not alter a committed aggregation

**`revisions.test.ts`**

- aggregation creates revision 2; revision 1 is unchanged except `lifecycle`
- revision numbers are monotonic across a `ProposeThesis` → aggregation →
  `ReviseThesis` sequence
- replay of the same command creates no second revision
- conflicting replay under one command id fails `payload-conflict`
- the new revision inherits no verification, challenge, compliance or risk review
- the new revision inherits no conditional resolution
- `ProposeThesis`, `AggregateManagerConclusion` and `ReviseThesis` all mint
  through `mintRevision` (asserted structurally, see §15)
- `ReviseThesis` refuses `cause: 'manager-aggregation'`
- `ReviseThesis` authority: the proposing department passes, another desk fails
- restart durability: the same command ids produce the same revision ids

**`conditionalRequirements.test.ts`**

- only a department handling `risk` may resolve; Verification and the Devil's
  Advocate fail (extending the C1C-1 authority tests)
- the outcome is computed: a revision with implications resolves `required`, one
  without resolves `not-required`
- there is no input field through which a caller could supply an outcome
- `not-required` is stored explicitly, and absence still reads `unresolved`
- a second resolution with a different outcome fails `ConflictingRecordError`
- a new revision reopens the gate: resolved on revision 2, unresolved on 3
- the stored `inputHash` matches a re-hash of the revision's implications

**`c1c3Schema.pg.test.ts`**

- one aggregation per produced revision
- an excluded disposition with no explanation is refused by the database
- a disposition outside the vocabulary is refused
- the runtime holds no UPDATE grant on any aggregation table

**`importGraph.test.ts`** — §15.

---

## 14. Risks

**The disposition burden.** Six desks producing forty claims means forty
dispositions, and a UI that makes that tedious will produce
`excluded-out-of-scope` by the dozen. Mitigated in this stage only by requiring
an explanation for every exclusion; the real mitigation is C1D's aggregation
surface, which should default nothing.

**The manager becomes a bottleneck.** Aggregation blocks on every required
desk, by design. A desk that fails non-retryably stalls the case until a person
decides — which is correct, and is why the override belongs in a command with
its own authority rather than as a flag here.

**Two records to keep consistent.** The aggregation names its produced revision
and the revision names its aggregation. Mitigated by the unique constraint, by
their atomic commit, and by both being written in one operation.

**`ProposeThesis` changing shape.** Dropping the caller-supplied `revisionId`
touches C1B's tests. Small, mechanical, and the last of TD-30.

---

## 15. Fitness rules this stage adds

- no command handler imports another command handler
- `revisions.ts` is the only module outside the domain that calls
  `buildThesis` or `reviseThesis`
- every command that produces a revision imports `mintRevision`
- no file outside `domain/analysis` re-implements the Risk rule: nothing but
  `requirements.ts` may reference `RISK_REVIEW_WHEN_IMPLEMENTABLE.evaluate`
- eligibility is decided in one place: no command handler references
  `evaluateRevisionEligibility` or reimplements a blocking rule
- `disagreementBlocksEligibility` is the only producer of `blocksEligibility`
- `ResolveConditionalRequirement` declares no input field named `required`,
  `outcome` or `state`
- the approved-command list grows by exactly three
- still no LLM client, still no UI, still no orchestrator repository import

---

## 16. Decisions requiring approval

| #         | Decision                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-C1C3-1  | The manager aggregation is a first-class immutable record; the revision carries only `aggregationId`                                                                                                 |
| D-C1C3-2  | Every claim in the declared input set gets a bounded disposition; the manager picks scope, not which in-scope claims to answer for                                                                   |
| D-C1C3-3  | One `mintRevision` operation beneath all three commands; `prior: null` is the first-revision case, not a separate path                                                                               |
| D-C1C3-4  | Aggregation refuses an incomplete required workflow; nothing stores `missingRequiredContributions`; overrides are a future separate command                                                          |
| D-C1C3-5  | Optional-input availability is snapshotted on the aggregation, never recomputed                                                                                                                      |
| D-C1C3-6  | `ReviseThesis` stays `thesis-owner`; a manager changes a lineage through aggregation, and `cause: 'manager-aggregation'` is refused there                                                            |
| D-C1C3-7  | `ResolveConditionalRequirement` accepts **no** outcome field at all, rather than accepting and rejecting a disagreeing one                                                                           |
| D-C1C3-8  | `ProposeThesis` derives its `revisionId`; the last caller-supplied identity goes                                                                                                                     |
| D-C1C3-9  | `RequirementResolution` gains a normalized `inputHash`                                                                                                                                               |
| D-C1C3-10 | The aggregation entry's own run completes through `RecordContribution` as usual, and `AggregateManagerConclusion` requires it — the desk's contribution and the managerial act stay separate records |
| D-C1C3-11 | Unresolved disagreement carries materiality; `decision-critical` blocks eligibility through the domain evaluation path, and a downgrade requires a recorded rationale                                |
| D-C1C3-12 | A completed contribution opposing the lineage is in scope whether the manager lists it or not; a materially relevant available optional contribution may not be excluded                             |

---

## 17. Technical Debt & Future Improvements

**Closed by this stage:** TD-29 (conditional requirements have no command that
resolves them); the remainder of TD-30 (caller-supplied identity).

**Opened by this stage:**

- **TD-35 · No exceptional-aggregation override.** A case whose required desk
  cannot deliver stalls until a person acts, and the only act available is
  outside the system. The resolution is a governance command with its own
  mandate, a required reason and a ledger entry — deliberately not a flag on
  aggregation. Not blocking: stalling visibly is the correct failure.
- **TD-36 · The aggregation record has no read model.** C1D projects it: which
  claims were not adopted and why is exactly what the CIO needs before
  selecting. Until then it is queryable and unrendered.

**Unchanged and still open:** TD-33 (C2 budget enforcement), TD-24, TD-25,
TD-26, TD-27.

**TD-34 · Run lease and abandoned-run recovery — a hard gate, not this stage.**
Recorded per the review: leasing, heartbeat, attempt identity, takeover,
timeout transition, restart recovery, late-result handling, sweeper ownership,
clock source and concurrent-recovery protection form **one** capability and get
their own planning gate. No part of it — including the cheap lease column — is
introduced inside C1C-3, because an unused or half-specified field is worse than
an absent one. It is a hard gate before a live LLM provider, before any
long-running external provider, and before production orchestration; it may land
before C2 or as a dedicated C1 recovery stage. C1C-2's `silent` scenario keeps
its honest durable `running` state, and nothing fabricates a completion or a
failure without the approved mechanism.

---

## 18. Out of scope

`SubmitForVerification`, the three verdict commands, the `RequirementStatus` →
gate-input adapter, full eligibility wiring and the end-to-end deterministic
Macro walk are **C1C-4**. Any UI is C1D. Any live provider is C2.
