# Phase C1D-1B — the submission and decision repositories

**Approved planning gate.** Revision 2, incorporating the review decisions.
Implementation proceeds stage by stage; B0 first, committed and reported alone.

C1D-1A built the decision domain and migration 0020. Nothing can read or write
either. C1D-1B closes that gap and stops: **no commands, no orchestration, no
UI, no LLM, no publication.**

---

## 0 · What the review decided

Recorded at the top because the rest of the plan is downstream of it.

| #   | Decision                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Two ports. Returns stay on the submission port — but with **explicit types and methods**, not a grab bag                |
| 2   | **No `SET CONSTRAINTS ALL`.** A named catalogue of the decision's own deferred constraints, forced inside the transaction |
| 3   | **Migration 0021 for indexes that serve a demonstrated repository query**, justified per index against a stated template |
| 4   | Reopening `decisions.ts` for a **pure shared validator** is approved; one authoritative implementation, four callers    |
| 5   | Empty `blockers` becomes a **hard invariant of a submission**, rejected at the builder, the validator and the mapping   |
| 6   | Obsolete row types deleted with **no deprecated aliases**, and a parser-based rule stopping the old shape reappearing   |

---

## 1 · Repository port shape

### 1.1 Two ports, three record families, no confusion between them

Approved: `SubmissionRepository` and `DecisionRepository`. Eleven tables.

The reasoning the review set down, kept here because it is what the port shape
has to express:

- a **submission** is material entering CIO consideration;
- a **return** is material leaving CIO consideration for further work;
- a **`CaseDecision`** is a completed institutional CIO outcome.

**A return is not a decision and must never be stored through the decision
repository.** Sharing a port boundary with submissions must not make a return
look interchangeable with either neighbour.

So the submission port is explicitly typed per record family — no
`save(thing: Submission | Return)`, no shared `record` parameter, no method that
takes a discriminated union across families:

```
interface SubmissionRepository {
  // submissions
  get(submissionId: string): Promise<CioSubmission | null>
  listForCase(caseId: string): Promise<CioSubmission[]>
  pending(limit?: number): Promise<CioSubmission[]>
  applicableForRevision(revisionId: string): Promise<CioSubmission[]>
  save(submission: CioSubmission): Promise<CioSubmission>
  settle(submissionIds: readonly string[], state: SettledSubmissionState): Promise<void>

  // returns — their own types, their own methods
  recordReturn(cioReturn: CioReturn): Promise<CioReturn>
  getReturn(returnId: string): Promise<CioReturn | null>
  returnsForCase(caseId: string): Promise<CioReturn[]>
}
```

`SettledSubmissionState = 'decided' | 'returned'` — a named type, so `settle`
cannot be handed `'pending'` and quietly un-settle a submission.

`applicableForRevision` is the **applicable submission query** the review asked
for: every submission targeting one exact revision, in submission order. It is
what C1D-1C's "a pending submission already exists for this revision" refusal
reads, and what C1D-1D reads to prove a decision's revisions each have exactly
one submission. Naming it on the port keeps that lookup from being reimplemented
as a filter over `listForCase` in two commands.

**`EligibilityBasis` is a type, not a method.** It is reached only through the
submission that carries it — there is no `basisFor(revisionId)`, because a basis
with no submission is a photograph of nothing, and a second path to it is a
second place the "eligibility is derived, this is only its record" distinction
could be lost.

### 1.2 The eligibility policy registry is not a repository

`analysis.eligibility_policies` gets **no port and no runtime read path.**

The domain holds the policy in `eligibilityPolicy.ts` as a frozen object.
Loading policy content from the database at runtime would put the rule that
decides eligibility in two places, and the one nobody tests would eventually
win. The table's job is narrower and worth keeping: it is the FK target for
`cio_submissions.eligibility_policy_version`, so a submission cannot name a
policy that never existed, and it is a readable record of what version 1 meant
for an auditor reading the database without the source.

**One test, not a runtime check:** a PostgreSQL test asserts the seeded row
equals `eligibilityPolicy('1')` field by field. If the two ever disagree, the
domain is right and the migration is wrong.

---

## 2 · Adapter responsibilities vs domain responsibilities

| The domain decides                                          | The adapter does                                  |
| ------------------------------------------------------------ | ------------------------------------------------- |
| whether a decision aggregate is valid (§4)                    | writes the rows it is given, atomically           |
| whether dissent requires acknowledgement                      | stores `acknowledgement` as given                 |
| which revisions an outcome disposes of (`relationsOf`)        | writes one `decision_submissions` row per relation |
| what eligibility means (`eligibilityPolicy`)                  | stores the basis as a snapshot, uninterpreted      |
| identity (`deriveDecisionId` and friends)                     | never invents an id, timestamp or actor            |

### 2.1 What the repositories must not do

Binding, and the subject of fitness rule 13:

- calculate eligibility
- invent Compliance state
- infer a decision outcome from nullable fields
- perform authorization
- choose which revision the CIO selected
- convert a blocked submission into an eligible one
- produce presentation prose
- hide superseded decision history

### 2.2 What they may do

- load related relational rows in fixed batches
- validate domain aggregates before writing
- force **their own named** deferred constraints
- distinguish identical replay from conflicting content
- map malformed rows to bounded repository errors
- offer live and historical query variants

---

## 3 · Transaction boundaries

Unchanged from
[transaction.ts](src/infrastructure/analysis/postgres/transaction.ts): the
boundary is on the container, `withTransaction` is the whole abstraction, and
scoped repositories die when the callback resolves.

C1D-1B adds one rule:

> **One port call is one institutional act, and it is atomic on its own.**

`decisions.save(decision)` writes, in a single unit of work:

1. `UPDATE case_decisions SET superseded_by_decision_id = $new WHERE decision_id = $old AND superseded_by_decision_id IS NULL` — only when superseding
2. `INSERT INTO case_decisions`
3. `INSERT INTO decision_submissions` — one multi-row statement
4. `INSERT INTO decision_dissent` — one multi-row statement
5. `INSERT INTO decision_dissent_evidence` — one multi-row statement
6. `INSERT INTO decision_reconsideration_triggers` — one multi-row statement
7. the named constraint check of §3.1

The update **precedes** the insert, which is possible only because
`case_decisions_supersedes_fk` and `case_decisions_superseded_by_fk` are
`DEFERRABLE INITIALLY DEFERRED`.

Supersession is **not** a separate method. A `supersede()` a caller could invoke
without inserting the successor is a way to leave a case with no live decision.

### 3.1 Named deferred constraints — `SET CONSTRAINTS ALL` is rejected

`decision_outcome_guard` fires at COMMIT. Inside `withTransaction`, an invalid
decision would therefore surface **from `withTransaction`** while the in-memory
adapter throws **from `save`** — a parity break on call site, which the contract
suite asserts on.

The fix is to force the check at the end of the decision write, **naming only
the constraints this repository owns**:

```
DECISION_DEFERRED_CONSTRAINTS = [
  'analysis.case_decisions_outcome_guard',
  'analysis.decision_submissions_outcome_guard',
  'analysis.decision_reconsideration_triggers_outcome_guard',
  'analysis.case_decisions_supersedes_fk',
  'analysis.case_decisions_superseded_by_fk',
]
```

**One centralized catalogue.** The exact names live in a single exported
constant beside the SQL catalogues — never as raw strings inside a repository
method, and never assembled at a call site. Two statements, both parameterless
and both in the catalogue: `SET CONSTRAINTS <names> IMMEDIATE` after the rows are
written, and `SET CONSTRAINTS <names> DEFERRED` to restore the transaction to the
state the caller handed over.

Why not `ALL`, in the review's words and kept because they are the design
rationale:

- `ALL` couples the repository operation to every deferred constraint in the
  transaction;
- future unrelated constraints would begin failing at this call site;
- a repository should force validation only of the invariants it owns;
- error attribution stays clear;
- nested application transactions stay composable.

**The deferred constraints remain the final protection.** The domain validator
(§4) and this immediate check are additional layers, not replacements. A caller
that bypasses the port entirely still meets the trigger at COMMIT.

Required tests:

1. the named constraints are actually forced — an invalid decision fails **from
   `save`**, not from the outer commit;
2. an unrelated deferred constraint pending in the same transaction is **not**
   forced by the decision write;
3. after a decision write, an outer transaction can still perform and commit
   unrelated deferred work;
4. the constraint names are read from the catalogue — a test asserts every entry
   exists in `pg_constraint` and is deferrable, so a renamed constraint fails
   loudly rather than degrading into a check that silently does nothing;
5. no raw PostgreSQL constraint detail escapes into the thrown error.

Test 4 matters more than it looks. `SET CONSTRAINTS` on a name that does not
exist raises; but a name that exists and is **not** deferrable is accepted and
does nothing — so a constraint quietly made immediate elsewhere would turn this
whole mechanism into a no-op that every other test still passes.

---

## 4 · The shared decision validator

Approved: `domain/analysis/decisions.ts` reopens for a pure validator. It is
neither repository behaviour nor PostgreSQL behaviour — it is the domain's
definition of a valid `CaseDecision` aggregate.

**One authoritative implementation, four callers:** the domain builders, the
in-memory repository, the PostgreSQL repository before persistence, and the
contract tests.

Semantics it covers:

- a `selected` outcome has exactly one selected revision
- the selected revision is among those considered
- a `deferred` outcome selects none
- a `deferred` outcome carries at least one reconsideration trigger
- a `declined` outcome accounts for every considered revision
- no revision holds contradictory relations
- every represented revision has exactly one submission
- unresolved dissent meets the acknowledgement policy
- the eligibility basis contains no blockers (§5)
- the supersession relationship is coherent where the aggregate carries it

It must remain **deterministic, side-effect free, independent of SQL,
independent of repositories, and independent of wall-clock time unless a clock
is explicitly supplied.**

These rules are **not** duplicated in either adapter. Database constraints
remain an independent enforcement layer with their own implementation, which is
the point of defence in depth — two implementations of one rule are acceptable
only when they are in different enforcement layers and both are tested.

---

## 5 · `EligibilityBasis.blockers` — a hard invariant

`blockers` has no column and no table in migration 0020. I checked the domain
interfaces against the tables rather than assuming C1D-1A had matched them; it
is the only field in either aggregate that does not map.

**Resolved as an invariant, not as storage.** A submission may be created only
from an eligibility evaluation where `blockers.length === 0`.

Forbidden, explicitly:

- silently dropping blockers during mapping
- normalising a non-empty array into an empty one
- persisting an always-empty child table to mirror a field that is illegal on a
  valid submission

Enforced at four points:

1. the domain submission builder rejects non-empty blockers
2. the shared validator rejects non-empty blockers
3. the repository mapping refuses a malformed row or aggregate implying blockers
4. both adapters behave identically

The read model reconstructs `blockers: []` **because a valid submission
structurally guarantees emptiness**, not because the mapper defaults it.

### 5.1 The audit meaning that must survive

> The firm evaluated eligibility under policy version X and found no blockers.

**An empty blocker list must not be the only proof of eligibility.** The basis
therefore continues to carry the evidence for that conclusion, all of which is
stored: the exact revision, the policy version, the latest applicable review
identities, the Risk requirement state, required workflow completion, the
disagreement state, and the evidence and provenance state.

That is what makes the empty array a *finding* rather than an absence.

### 5.2 The replay hazard this shares with everything else

Write-once conflict detection in this adapter is **read-back-and-compare**:
`aggregationRepositories.ts` reads the stored record, maps it to the domain, and
compares semantic keys. No content-hash column exists and C1D-1B needs none.

That makes the mapping load-bearing in an easy-to-miss way. A mapper that drops
a field, reorders an array or normalises a `null` into an absent key makes the
round trip lossy — and a **benign replay** computes a different semantic key and
throws `ConflictingRecordError`. A correct retry would be reported as an
institutional disagreement.

Round-trip identity is therefore a first-class contract test:

```
semanticKey(await repo.get(id)) === semanticKey(original)
```

asserted for a decision exercising every optional field, every outcome kind,
dissent with and without acknowledgement, both trigger flavours, and for a
submission with a fully populated basis.

### 5.3 Tests

- a submission with zero blockers is accepted
- a submission with one blocker is rejected **before persistence**
- malformed PostgreSQL state cannot be mapped as a valid submission
- an identical round trip retains an explicit `blockers: []`
- adapter mapping never silently drops blockers
- a decision cannot reference a submission created from a blocked eligibility
  result

---

## 6 · Mapping strategy

Five tables become one `CaseDecision`; seven serve `CioSubmission` and
`CioReturn`. The rule `mapping.ts` already follows holds: **columns, not
documents.** No `jsonb` blob is introduced — C1D-1A removed the last one
(`governance`) precisely because a field inside it had to be invented to satisfy
the type.

For a **list** read, each child table is queried once with
`WHERE parent_id = ANY($1)` and grouped in memory with the existing `groupBy`.
Never one query per parent.

`MalformedRowError` on: an unknown `outcome_kind`; a `selected` outcome with no
`selected` relation; a dissent row outside the materiality vocabulary; a trigger
that is neither quantitative-complete nor qualitative; a submission row whose
basis is internally inconsistent. The database constrains all of these, so
reaching them means the row was edited by hand or restored from an incompatible
backup — which is what the error is for.

---

## 7 · Ordering guarantees

Every list method states its order; every order ends in a unique tie-breaker;
byte order (`COLLATE "C"`), matching the rest of the adapter.

| Method                             | Order                                                             |
| ---------------------------------- | ----------------------------------------------------------------- |
| `submissions.listForCase`          | `submitted_at`, `id`                                               |
| `submissions.pending`              | `submitted_at`, `id` — oldest first; a queue is FIFO               |
| `submissions.applicableForRevision`| `submitted_at`, `id`                                               |
| `submissions.returnsForCase`       | `returned_at`, `id`                                                |
| `decisions.historyForCase`         | `decided_at`, `decision_id` — oldest first                         |
| `decisions.listRecent`             | `decided_at DESC`, `decision_id DESC`                              |
| `decision.outcome.considered*`     | canonically sorted by the domain; mapping preserves it             |
| `decision_submissions` → relations | `revision_id`                                                      |
| `decision.unresolvedDissent`       | `ordinal`                                                          |
| `decision.reconsiderationTriggers` | `ordinal`                                                          |
| `cioReturn.concerns`               | `ordinal`                                                          |
| submission basis child rows        | by their own natural key, ascending                                |

`ordinal` is part of the primary key on `decision_dissent`,
`decision_reconsideration_triggers` and `cio_return_concerns`, so the write
assigns it from the domain array index and the read restores that array exactly.
Asserted with more than one entry — one proves nothing.

---

## 8 · Optimistic concurrency

**Neither submissions nor decisions are versioned aggregates.** Both are
write-once; the versioned aggregate they hang off is the case, and
`cases.save(c, expectedVersion)` already guards it.

`CioSubmission.caseVersion` and `CaseDecision.aggregateVersion` are **snapshots
of what the actor saw**, not concurrency tokens. The repository stores them and
never compares them; the version guard belongs to the commands. Stated because
two columns with those names invite a future implementer to enforce something
with them in storage, which would put a governance rule in the adapter.

The one true concurrency guard in this stage is supersession:

```sql
UPDATE analysis.case_decisions
   SET superseded_by_decision_id = $new
 WHERE decision_id = $old
   AND superseded_by_decision_id IS NULL
```

Zero rows affected means someone else superseded it first →
`ConcurrencyConflictError`; the caller re-reads and decides again. Under
`READ COMMITTED` the second writer blocks on the row lock, re-evaluates the
predicate and finds it false.

---

## 9 · Concurrency behaviour

| Race                                                | Outcome                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Two decisions for one case, neither superseding      | `case_decisions_one_live_per_case` rejects the second → `DuplicateRecordError` |
| Two corrections superseding the same live decision   | the `superseded_by IS NULL` predicate rejects the second → `ConcurrencyConflictError` |
| Two submissions for the same revision                | **not prevented by the schema** — a C1D-1C command refusal                 |
| A decision referencing a submission being returned   | both touch `cio_submissions.state`; the row lock serialises them           |

Row 3 is a deliberate carry-over from the approved C1D-1 plan, and it means that
between C1D-1B and C1D-1C the repository will store a duplicate pending
submission if asked. Nothing calls it in that window, so it is theoretical —
stated because "storage allows it, the command forbids it" is exactly the split
that gets forgotten. `applicableForRevision` (§1.1) is the query that closes it
in C1D-1C.

**Not attempted:** no advisory locks, no `SELECT … FOR UPDATE`, no serializable
isolation. TD-46 already records that review-race behaviour needs re-examination
at production concurrency; decisions inherit that and no more.

---

## 10 · Replay and idempotency

- `save(x)`, id exists, semantic key **matches** → returns the stored record. No
  write, no error.
- `save(x)`, id exists, semantic key **differs** → `ConflictingRecordError`.
- Keys: `decisionSemanticKey` already exists in
  [writeOnce.ts:164](src/application/analysis/writeOnce.ts#L164); C1D-1B adds
  `cioSubmissionSemanticKey` and `cioReturnSemanticKey` beside it.

`settle` is idempotent — setting a submission to the state it already holds is a
no-op. Settling a `returned` submission to `decided` is **not** a replay and
must fail: the two states describe different institutional histories.

**Supersession replay** deserves its own test. `save(decision)` where the
decision already exists and already carries its supersession is a full no-op,
including the `UPDATE` — whose `WHERE superseded_by IS NULL` predicate affects
zero rows on the second attempt. The replay path must read that as "already
done", not as a conflict. Getting it backwards turns every retry into a
`ConcurrencyConflictError`.

---

## 11 · Immutable read/write guarantees

Four layers, deliberately redundant:

1. **No mutating method exists** beyond `settle`.
2. **The grant** — `SELECT, INSERT` only, plus `UPDATE (state)` on
   `cio_submissions` and `UPDATE (superseded_by_decision_id)` on
   `case_decisions`. C1D-1A.1 asserts this on both migration paths.
3. **`refuse_decision_rewrite`**, narrowed by 0020 to permit only
   `NULL → successor`.
4. **Write-once conflict detection** at the port.

Returns and return concerns are immutable with no exception: no grant, no
method, no path.

**Reads are deeply frozen** — both adapters return values passing
`isDeeplyFrozen` from [seal.ts](src/infrastructure/analysis/seal.ts).

---

## 12 · In-memory parity

The in-memory adapter is the reference, not the fallback. It models the same
institutional semantics:

- immutable submissions, returns and decisions
- one live decision per case
- supersession
- live versus historical decision queries
- deterministic ordering, in **byte order** — a JavaScript default sort is
  locale-flavoured and will disagree with `COLLATE "C"` on ids containing `-`
  or `_`
- write-once conflict detection
- the explicit empty-blocker invariant
- exact submission-to-revision mapping

**In-memory-only behaviour is not preserved.** Object identity in particular:
`save` stores a defensive copy and `get` returns a frozen structure, so a caller
cannot mutate what was stored and no test can accidentally depend on receiving
the same reference it passed in.

**No assertion in `repositoryContract.ts` may branch on which adapter is
running.** If a behaviour cannot be expressed identically, it is a divergence to
resolve, not to accommodate.

---

## 13 · Restart durability

C1D-1B has no commands, so the C1C-4.1 macro-flow harness cannot yet carry a
decision end to end. Repository-level durability is still provable:

1. Construct the adapter; write a submission, a return, and a decision
   superseding an earlier one.
2. `close()` the pool.
3. **Assert a read through the dead runtime fails** — a "restart" that can still
   read the old connection proves nothing.
4. Construct a **new** adapter against the same database.
5. Read back and compare a canonical projection: every field, the supersession
   link, the live/historical distinction, dissent order, trigger order.

No in-memory adapter participates (fitness rule 10); no repository, pool or
domain object crosses the boundary.

Excluded from the projection, explicitly rather than quietly: `evaluatedAt`,
which is projection time, and `storageProvenanceId`, which differs because the
second runtime is a different runtime.

---

## 14 · Query budget

Asserted by the counter in
[queryCount.pg.test.ts](src/infrastructure/analysis/postgres/queryCount.pg.test.ts).

**The invariant is not the number — it is that the number does not grow with the
data.** Every budget is measured at 1 child row and again at 25, and must be
identical.

| Operation                      | Budget | Composition                                              |
| ------------------------------ | ------ | -------------------------------------------------------- |
| `submissions.get`              | 5      | parent + 4 basis tables                                   |
| `submissions.listForCase`      | 5      | same, `= ANY($1)`                                         |
| `submissions.pending`          | 5      | same                                                      |
| `submissions.applicableForRevision` | 5 | same                                                      |
| `submissions.save` (new)       | ≤ 10   | 5 read-back + 5 write                                     |
| `submissions.save` (replay)    | 5      | read-back only                                            |
| `submissions.settle`           | 1      | `UPDATE … WHERE id = ANY($1)`                             |
| `submissions.recordReturn`     | 3      | return + concerns + submission state                      |
| `submissions.returnsForCase`   | 2      | returns + concerns                                        |
| `decisions.get` / `getForCase` | 5      | parent + 4 child tables                                   |
| `decisions.historyForCase`     | 5      | same                                                      |
| `decisions.listRecent`         | 5      | same                                                      |
| `decisions.save` (new)         | ≤ 13   | 5 read-back + supersede + parent + 4 children + 2 `SET CONSTRAINTS` |
| `decisions.save` (replay)      | 5      | read-back only                                            |

A budget that has to rise during implementation is a design change and gets
reported, not quietly edited.

---

## 15 · Indexes and migration 0021

Volume assumption, stated so it can be disagreed with: **~400 cases a year, one
to three submissions each, one decision plus rare corrections** — low thousands
of rows within a few years.

Existing and used: `cio_submissions_pending_idx` (partial, `state = 'pending'` —
the CIO queue), `cio_submissions_case_idx`, `cio_returns_case_idx`,
`case_decisions_one_live_per_case` (serves `getForCase`),
`case_decisions_recent_idx`, `decision_submissions_submission_idx`.

Two gaps were identified. Per the review's rule — an index is added when it
serves a demonstrated repository access path and no existing index suffices —
they resolve differently.

### 15.1 `case_decisions_history_idx` — **added in migration 0021**

| Field                       | Value                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Query                       | `decisions.historyForCase(caseId)`                                                                 |
| Statement                   | `SELECT … FROM analysis.case_decisions WHERE case_id = $1 ORDER BY decided_at, decision_id`         |
| Filter predicate            | `case_id = $1` — no other                                                                          |
| Order columns               | `decided_at`, `decision_id COLLATE "C"`                                                            |
| Partial                     | **No.** History must include superseded rows; a predicate would exclude exactly what it is for      |
| Expected cardinality        | 1–3 rows per case; low thousands in the table                                                      |
| Why existing is insufficient| `case_decisions_one_live_per_case` is partial on `superseded_by IS NULL`, so it excludes every superseded row — the ones history exists to return. `case_decisions_recent_idx` leads with `tenant_id, decided_at`, so a `case_id` lookup cannot use it as an access predicate |

Definition: `(case_id, decided_at, decision_id COLLATE "C")`. Ordering is served
by the index, so the read needs no sort.

### 15.2 The live-recent partial index — **left as TD-55, with a stated trigger**

| Field                       | Value                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Query                       | `decisions.listRecent(limit)`                                                                      |
| Statement                   | `SELECT … WHERE tenant_id = $1 AND superseded_by_decision_id IS NULL ORDER BY decided_at DESC, decision_id DESC LIMIT $2` |
| Why existing is sufficient  | `case_decisions_recent_idx (tenant_id, decided_at DESC, decision_id COLLATE "C")` already serves the tenant predicate and the full ordering. Live-ness is a filter applied during the scan, and corrections are rare — the filter rejects a small minority, so `LIMIT` is satisfied after scanning barely more rows than it returns |

Adding a partial index here would be **speculative**, which the review
prohibits. It becomes justified at a stated trigger, not a feeling:

> **TD-55 trigger:** superseded decisions exceed **20%** of `case_decisions`, or
> `listRecent` scans more than **3×** the rows it returns at p95.

### 15.3 Proving the index without pinning planner text

Full `EXPLAIN` output is unstable across PostgreSQL versions and row estimates,
so no test asserts on it verbatim. What the tests assert instead:

- the index exists, on both the clean and the upgrade path, via the schema
  fingerprint;
- at a representative volume (≥ 200 decisions across ≥ 50 cases, seeded and
  `ANALYZE`d), `EXPLAIN (FORMAT JSON)` for `historyForCase` contains **no
  `Seq Scan` node on `case_decisions`** — a property, not a plan;
- the query count for `historyForCase` stays at its §14 budget.

The middle assertion is the one that would catch a regression; the first would
catch a lost migration; the third would catch an N+1.

### 15.4 Migration 0021 requirements

- clean **and** upgrade coverage, extending `c1d1Upgrade.pg.test.ts` to
  0001–0021 versus 0001–0020-then-0021
- included in the schema fingerprint — indexes are already a fingerprint
  dimension via `pg_indexes.indexdef`, so the predicate and column order are
  compared automatically
- grants: none required — an index inherits the table's privileges, and a test
  asserts 0021 changes no grant
- **no edits to any prior migration**

Migration 0021 lands in **B2**, with the repository query it serves, so the
index and its justification arrive together.

---

## 16 · Failure modes

| Failure                                        | Surfaces as                    | Retryable                    |
| ---------------------------------------------- | ------------------------------ | ---------------------------- |
| Same id, different content                     | `ConflictingRecordError`       | No                           |
| Second live decision for a case                | `DuplicateRecordError`         | No                           |
| Supersession lost the race                     | `ConcurrencyConflictError`     | Yes, after re-read           |
| Outcome rules violated                         | `InvariantViolationError`      | No                           |
| Submission carries non-empty `blockers`        | `InvariantViolationError`      | No — the caller is wrong     |
| Settling a returned submission to `decided`    | `InvariantViolationError`      | No                           |
| Submission, revision or evidence set absent    | `ReferentialIntegrityError`    | No                           |
| Stored row cannot become a domain value        | `MalformedRowError`            | No — the store is wrong      |
| Forbidden write attempted                      | `StoragePermissionError`       | No                           |
| Deadlock or serialization failure              | `RetryableStorageError`        | Yes — nothing was written    |
| Commit sent, outcome unknown                   | `AmbiguousCommitError`         | **No** — re-read             |
| Repository used after its transaction closed   | `TransactionClosedError`       | No                           |

No new error class. Every one already exists on the port, which is what lets the
contract suite assert on them against both stores.

**No message carries PostgreSQL's `detail` field**, which contains the offending
key values — a unique violation would otherwise reproduce a case id or a
rationale into a log. Constraint name and operation only, asserted by test.

---

## 17 · Migration dependencies

**Migration 0021 only, and only for §15.1.** Nothing else is required:

- write-once conflict detection is read-back-and-compare, so no content-hash
  column is needed (`aggregationRepositories.ts` establishes the pattern);
- `CioReturn` maps field for field onto `cio_returns` + `cio_return_concerns`,
  including the full actor snapshot — verified against the migration;
- `CaseDecision` and its four child collections map completely;
- `EligibilityBasis` maps completely **except `blockers`**, which is an
  invariant rather than a column (§5);
- every grant the ports need is in 0020, proven on both paths by C1D-1A.1;
- the `ordinal` columns the ordering guarantees depend on exist and are part of
  their primary keys.

---

## 18 · Fitness rules

Two new rules, each with a planted violation and a benign near-miss, each
parser-based rather than raw-regex, per the standing principle.

### Rule 12 — `no-pre-0020-decision-shape` (lands in **B0**)

> No source describes the decision schema that migration 0020 replaced.

Detects: an interface or type member named `governance`, `unresolved_dissent` or
`reconsideration_triggers` on a decision row type; any reference to
`decision_revisions`; a row type keyed on `case_id` where `decision_id` is the
key; SQL naming a dropped column.

Planted violations: a re-added `DecisionRow` carrying `governance: unknown`; a
statement selecting `decision_revisions`. Benign near-misses: the domain's
`reconsiderationTriggers` **camelCase** field, which is the current model and
must pass; a migration comment naming what 0020 dropped; `decision_submissions`,
whose name contains the forbidden substring only by coincidence.

That last near-miss is the one that would break a careless implementation, and
it is why the rule is parser-based rather than a substring search.

### Rule 13 — `no-decision-rules-in-the-adapter` (lands in **B3**)

> No file under `infrastructure/analysis/` re-derives what an outcome disposes
> of, and every `save` path calls the shared validator.

Planted violations: a `CASE`/ternary computing `'selected' | 'not-selected'` from
an outcome kind in adapter code; a SQL literal assigning a relation from a
comparison; a `save` implementation that writes a decision without calling the
validator. Benign near-misses: mapping a stored `relation` string back to the
domain union on read; a comment naming the relations; the domain's own
`relationsOf`, outside the selected paths.

### Rules extended rather than added

- Rule 10 (`no-in-memory-adapter-in-durable-tests`) covers the new `.pg.test.ts`
  files unchanged — it selects by filename.
- The catalogue rule at
  [importGraph.test.ts:780](src/test/importGraph.test.ts#L780) requires every
  statement to sit inside `catalog({ … })`. `SUBMISSION_SQL` and `DECISION_SQL`
  must reach `CATALOGS` in `postgresRepositories.ts`, or `queryCatalogHash`
  under-reports what the adapter can issue. **A test asserting every exported
  `*_SQL` catalogue appears in `CATALOGS`** closes that by construction — today
  it is remembered, not enforced, and this stage adds two more chances to forget.

---

## 19 · Architectural risks

**R1 — The mapping round trip is load-bearing and silent.** A lossy map turns
every replay into a `ConflictingRecordError`. Highest-consequence risk in the
stage, because it fails only under retry — when the system is already stressed.
*Mitigation:* §5.2's round-trip identity test across every optional field and
outcome kind.

**R2 — A renamed or non-deferrable constraint turns the §3.1 check into a
no-op.** `SET CONSTRAINTS` on an existing, immediate constraint succeeds and
does nothing. *Mitigation:* test 4 of §3.1, asserting every catalogued name
exists and is deferrable.

**R3 — Two sources of the eligibility policy.** The domain object and the seeded
row can drift. *Mitigation:* §1.2's equality test. Residual: a new domain field
absent from the table would pass, which is cosmetic precisely because the domain
is authoritative.

**R4 — The schema permits a duplicate pending submission; only the command
refuses it.** §9. Accepted per the approved plan.

**R5 — Eleven tables behind two ports.** A decision write touches five tables. A
future contributor adding a sixth child table touches four places — row type,
mapping, catalogue, budget. *Mitigation:* the query-budget test fails on an
unaccounted statement; blunt but reliable.

**R6 — The in-memory adapter grows a second decision model.** *Mitigation:* §4's
shared validator plus the no-branching rule in the contract suite.

**R7 — `blockers` must be empty and only the domain can say so.** The one
invariant in this stage with no CHECK, trigger or constraint behind it.
*Mitigation:* §5's four enforcement points and rule 13's validator-call check.
Residual: a third adapter written without the validator — accepted.

---

## 20 · Technical debt

**Opened:**

- **TD-55 · No partial index for live-recent decisions.** §15.2. Trigger:
  superseded decisions exceed 20% of `case_decisions`, or `listRecent` scans
  more than 3× the rows it returns at p95.
- **TD-56 · Catalogue membership was remembered, not enforced** — closed by the
  §18 test this stage lands. Listed so the gap is visible if that test is cut.

**Closed:** none outright. TD-45 stays closed.

**Carried:** TD-50 (no reconsideration command), TD-51 (return types
undifferentiated), TD-52 (trigger lineage), TD-53 (nothing monitors a trigger),
TD-54 (one outcome per decision), TD-41–44, TD-46, TD-34–37, TD-39, TD-8.

---

## 21 · Contract versions

**Command contract stays at 2.** No command, envelope field, category or mandate.

**Domain contract stays at 8.** The shared validator is an added function, not a
changed shape. No stored vocabulary gains a value.

---

## 22 · Staging

Four stages. **Each is committed and reported separately. They are not to be
combined into one large commit.**

### B0 — row and obsolete-contract cleanup

- delete `DecisionRow`, `DecisionRevisionRow` and any other pre-0020 type
- **no deprecated aliases** — nothing left that still looks usable
- define the current relational row types for all eleven tables
- add the mapper input types (the row-set groupings hydration consumes)
- fitness rule 12 with its planted violation and benign near-miss
- **no repository port and no adapter implementation**

**Exit criteria** — every row type has a field for every column of its table and
no field the table lacks, asserted against `information_schema.columns` rather
than by inspection; the obsolete types are gone with no alias; rule 12 detects
its planted violation and admits its near-misses; `tsc` clean; both suites green.

### B1 — ports, mapping and the in-memory reference

Ports; the pure shared validator; `cioSubmissionSemanticKey` and
`cioReturnSemanticKey`; mapping functions; the in-memory implementation; the
shared contract suite; the blocker invariant; deterministic ordering. **No
PostgreSQL adapter.**

**Exit criteria** — in-memory satisfies the full contract suite; round-trip
identity holds; orderings are byte order; reads deep-frozen; one validator
shared by builders, adapter and tests, asserted by a test that a hand-assembled
invalid decision is refused identically; domain contract still 8.

### B2 — the PostgreSQL adapter

SQL catalogues; submission, return and decision persistence; relational
hydration; named deferred-constraint forcing; replay and conflict behaviour;
supersession; live versus history queries; migration 0021; runtime-role
permission tests.

**Exit criteria** — the same contract suite passes unmodified against PostgreSQL
as `finos_app`; no assertion branches on adapter; invalid decisions fail from
`save`; unrelated deferred constraints are not forced; permission errors surface
as `StoragePermissionError` with no `detail` leakage; the eligibility seed
matches the domain; 0021 applies clean and as an upgrade.

### B3 — hardening

Fixed query budgets and volume-independence; restart durability; clean versus
upgrade fingerprint including 0021; fitness rule 13 and its integrity fixtures;
malformed-row tests; concurrency tests; resource cleanup.

**Exit criteria** — every §14 budget holds at 1 and 25 child rows; the restart
suite proves the dead runtime cannot read and the new one reads everything; rule
13 detects its planted violation and admits its near-miss, with the negative
control; no pool leaks; `tsc` clean; both suites green; tree clean.

---

## 23 · What the complete stage must prove

Submission round-trip · return round-trip · concerns round-trip · decision
round-trip for `selected`, `deferred` and `declined` · exact
submission-to-revision relations · non-empty eligibility blockers refused · no
lossy mapping · identical replay succeeds · conflicting replay fails · live
decision query · complete history query · superseded decisions excluded from the
live view · superseded decisions retained in history · deterministic ordering ·
actor snapshot canonicalisation · dissent and evidence round-trip · trigger
policy versions preserved individually · eligibility policy version resolves ·
no fabricated Compliance status · `selected` relation semantics · `deferred`
relation semantics · `declined` relation semantics · one live decision per case ·
supersession · return concerns immutable · named constraints forced at `save` ·
unrelated deferred constraints not forced · PostgreSQL and memory contract
parity · restart durability · query counts independent of child counts · pool
cleanup · **no command implementation · no LLM · no UI changes.**

---

## 24 · Exit reporting

Each of B0–B3 reports: commit SHA · files changed · contracts and types added or
removed · repository semantics · mapping guarantees · transaction behaviour
where applicable · query counts · parity results · tests and typecheck ·
remaining risks and technical debt · **explicit confirmation that the next stage
has not begun.**

Per the standing exit-report discipline: any claim not directly verified is
labelled unverified rather than presented as fact.
