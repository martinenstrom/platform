# Phase C1D-1B — the submission and decision repositories

**Planning gate. No implementation.**

C1D-1A built the decision domain and migration 0020. Nothing can read or write
either. C1D-1B closes that gap and stops: **no commands, no orchestration, no
UI, no LLM, no publication.** The three commands are C1D-1C, C1D-1D and C1D-1E,
and they should find the storage already finished and already proven.

The scope is fixed by the approved C1D-1 staging table:

> **C1D-1B** — row types · mapping · submission and decision repositories ·
> in-memory parity · supersession · deterministic ordering · live vs historical
> reads · contract tests. **No commands.**

---

## 1 · Exact repository scope

### 1.1 Two ports, not three

| Port                   | Owns                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SubmissionRepository` | `cio_submissions` + its four basis tables, and `cio_returns` + `cio_return_concerns`                              |
| `DecisionRepository`   | `case_decisions`, `decision_submissions`, `decision_dissent`, `decision_dissent_evidence`, `decision_reconsideration_triggers` |

Eleven tables, two ports.

**Returns belong to the submission, not to a port of their own.** A return has
no independent existence: it always settles exactly one submission, and the
only thing it can do is move that submission to `returned`. A third port would
put one institutional act across two ports inside one transaction and buy
nothing. The boundary follows the aggregate — the submission is the queue item
and the return is the record of why it left the queue.

I want the alternative on record because it is defensible: if returns ever gain
their own lifecycle (TD-51 differentiates return types), splitting is the first
thing to do. It is not that today.

### 1.2 The eligibility policy registry is not a repository

`analysis.eligibility_policies` gets **no port and no read path.**

The domain already holds the policy in `eligibilityPolicy.ts` as a frozen
object. Loading policy content from the database at runtime would put the rule
that decides eligibility in two places, and the one nobody tests would
eventually win. The table's job is narrower and worth keeping:

- it is the FK target for `cio_submissions.eligibility_policy_version`, so a
  submission cannot name a policy that never existed;
- it is a human-readable record of what version 1 meant, for an auditor reading
  the database without the source.

**One test, not a runtime check:** a PostgreSQL test asserts the seeded row
equals `eligibilityPolicy('1')` field by field. Drift becomes a failing test
rather than a runtime cost on every construction. If the two ever disagree, the
domain is right and the migration is wrong.

### 1.3 What C1D-1B deletes

`DecisionRow` and `DecisionRevisionRow` in
[rows.ts:273-291](src/infrastructure/analysis/postgres/rows.ts#L273-L291) are
orphaned — I checked, nothing imports them. They describe `governance`,
`unresolved_dissent`, `reconsideration_triggers` and a case-keyed primary key,
none of which exist in the database any more. `tsc` does not object to an unused
exported type, so they will sit there looking authoritative until someone
believes them. They go in stage B0.

---

## 2 · Adapter responsibilities vs domain responsibilities

The line, stated once and enforced by fitness rule:

| The domain decides                                                       | The adapter does                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| whether a decision is well-formed (`buildDecision`)                       | writes the rows it is given, atomically             |
| whether dissent requires acknowledgement                                  | stores `acknowledgement` as given                    |
| which revisions an outcome disposes of (`relationsOf`)                    | writes one `decision_submissions` row per relation   |
| what eligibility means (`eligibilityPolicy`)                              | stores the basis as a snapshot, uninterpreted        |
| identity (`deriveDecisionId` and friends)                                 | never invents an id, a timestamp or an actor         |

**The adapter re-derives nothing.** `decision_submissions.relation` is written
from `relationsOf(outcome)`, not computed in SQL; `submission.state` transitions
are given by the caller, not inferred from whether a decision exists.

### 2.1 The one place this gets subtle

Migration 0020's deferred constraint triggers enforce the *same* outcome rules
that `buildDecision` enforces. That is deliberate defence in depth, not a second
implementation with a second opinion: the trigger's job is to catch a
`CaseDecision` assembled by hand or by a future caller that bypassed the
builder.

But the in-memory adapter has no triggers, so without care the two stores
disagree about a hand-assembled decision — PostgreSQL rejects it, memory accepts
it. **Resolution: the domain exports one validator and both adapters call it.**

C1D-1B adds `assertDecisionWellFormed(decision)` to `domain/analysis/decisions.ts`,
extracted from the checks `buildDecision` already performs. `buildDecision` calls
it; both adapters call it in `save`. One rule, three callers, no reimplementation.

This touches the domain after C1D-1A closed. It is additive, changes no stored
shape, and **DOMAIN_CONTRACT_VERSION stays at 8.**

---

## 3 · Transaction boundaries

Unchanged from the established contract in
[transaction.ts](src/infrastructure/analysis/postgres/transaction.ts): the
boundary is on the container, `withTransaction` is the whole abstraction, and
scoped repositories die when the callback resolves.

C1D-1B adds one rule of its own:

> **One port call is one institutional act, and it is atomic on its own.**

Concretely, `decisions.save(decision)` writes, in a single unit of work:

1. `UPDATE case_decisions SET superseded_by_decision_id = $new WHERE decision_id = $old AND superseded_by_decision_id IS NULL` — only when the decision supersedes one
2. `INSERT INTO case_decisions`
3. `INSERT INTO decision_submissions` — one multi-row statement
4. `INSERT INTO decision_dissent` — one multi-row statement
5. `INSERT INTO decision_dissent_evidence` — one multi-row statement
6. `INSERT INTO decision_reconsideration_triggers` — one multi-row statement

The update **precedes** the insert, which is only possible because
`case_decisions_supersedes_fk` and `case_decisions_superseded_by_fk` are
`DEFERRABLE INITIALLY DEFERRED`. This is why C1D-1A.1 asserts that deferrability
positively rather than only comparing it across paths.

Supersession is **not** a separate method. A `supersede()` a caller could invoke
without inserting the successor is a way to leave a case with no live decision,
and there is no legitimate reason to do it.

### 3.1 Deferred triggers vs parity — the decision that matters most here

`decision_outcome_guard` fires at COMMIT. Inside `withTransaction`, an invalid
decision therefore surfaces **from `withTransaction`**, after the callback
returned — while the in-memory adapter throws **from `save`**. Same rejection,
different call site, and the contract suite asserts on call sites.

**Recommendation: force the check at the end of the decision write.**
`decisions.save` ends with `SET CONSTRAINTS ALL IMMEDIATE`, then restores
`SET CONSTRAINTS ALL DEFERRED`. Both adapters then fail at `save`, and a caller
learns which of its writes was wrong instead of learning at commit that
something was.

Two consequences I want approved rather than assumed:

- `ALL` is broader than the decision's own constraints. If a caller has other
  pending deferred work in the same transaction, that work is checked early too.
  Every deferred constraint in the schema belongs to the decision write, so
  today this is a distinction without a difference — but it is a coupling, and
  a future deferred constraint elsewhere would inherit it.
- The alternative is naming the three constraint triggers explicitly. More
  precise, and one more place to remember when a constraint is added. Given
  fitness rules are how this project remembers things, a rule asserting "every
  deferred constraint is named in the immediate-check list" would make the
  precise version safe. **I recommend `ALL` now and the named list only if a
  non-decision deferred constraint ever appears.**

---

## 4 · Repository responsibilities

### 4.1 `SubmissionRepository`

```
get(submissionId)                → CioSubmission | null
listForCase(caseId)              → CioSubmission[]
pending(limit?)                  → CioSubmission[]      the CIO queue
save(submission)                 → CioSubmission        write-once, idempotent
settle(submissionIds, state)     → void                 'decided' | 'returned'
recordReturn(cioReturn)          → CioReturn            write-once; settles the submission
returnsForCase(caseId)           → CioReturn[]
```

`settle` takes a **list** because `RecordCaseDecision` settles every submission
the decision considered, and doing that one round trip per submission is the
N+1 this project has already had to remove once.

`state` is the one mutable field on a submission and the only `GRANT UPDATE` the
runtime holds on that table. Everything else is write-once.

### 4.2 `DecisionRepository`

```
get(decisionId)                  → CaseDecision | null
getForCase(caseId)               → CaseDecision | null   the LIVE decision
historyForCase(caseId)           → CaseDecision[]        every decision, oldest first
listRecent(limit)                → CaseDecision[]        live only, newest first
save(decision)                   → CaseDecision          write-once; performs supersession
```

`get(decisionId)` exists for command replay: the ledger stores only
`resultRef: decisionId`, so a replay must find a decision without being told its
case. Same reasoning as `ReviewRepository.get`.

There is deliberately **no `update` and no `delete`.** Immutability is enforced
three ways and the API absence is the first: a method that cannot be called
cannot be called by accident.

---

## 5 · Mapping strategy

### 5.1 Shape

Five tables become one `CaseDecision`; five become one `CioSubmission`. The rule
is the one `mapping.ts` already follows: **columns, not documents.** No `jsonb`
blob is introduced. C1D-1A removed the last one (`governance`) precisely because
a field inside it had to be invented to satisfy the type.

For a **list** read, each child table is queried once with
`WHERE decision_id = ANY($1)` and grouped in memory with the existing `groupBy`
from [caseRepositories.ts](src/infrastructure/analysis/postgres/caseRepositories.ts).
Never one query per parent.

### 5.2 The replay hazard, and the test that catches it

Write-once conflict detection in this adapter is **read-back-and-compare**:
`aggregationRepositories.ts` reads the stored record, maps it to the domain, and
compares `managerAggregationSemanticKey`. No content-hash column exists and
C1D-1B needs none.

That makes the mapping load-bearing in a way that is easy to miss. If
`toCaseDecision` drops a field, reorders an array, or normalises a `null` into
an absent key, then the round trip is lossy — and a **benign replay** computes a
different semantic key and throws `ConflictingRecordError`. A correct retry
would be reported as an institutional disagreement.

So round-trip identity is a first-class contract test, not an implied property:

```
semanticKey(await repo.get(id)) === semanticKey(original)
```

asserted for a decision exercising every optional field, every outcome kind,
dissent with and without acknowledgement, and both trigger flavours.

### 5.3 The one field with nowhere to go — `blockers`

`EligibilityBasis.blockers` has **no column and no table in migration 0020.** I
checked this rather than assuming the shapes matched, and it is the only field
in either aggregate that does not map.

It is not an oversight in 0020. The domain says why:

> Never `eligible: true` on its own. `blockers` is carried **as an empty array**
> rather than omitted, for the same reason `not-required` is an explicit Risk
> resolution: an audit reader should not infer a conclusion from an absence.

A submission exists only where eligibility held, so `blockers` is `[]` on every
submission that can legitimately be stored, and an always-empty relational table
is structure bought for nothing. Storing the 14-arm `Blocker` union relationally
would be a substantial schema for rows that cannot occur.

**But silently dropping a non-empty array would put a false photograph in the
audit record** — the field exists precisely so an auditor can see that the firm
looked and found nothing. So:

- `assertSubmissionWellFormed` refuses a submission whose `blockers` is
  non-empty, in the domain, called by both adapters — same shape as
  `assertDecisionWellFormed` (§2.1).
- The round trip is then lossless by construction: `[]` in, `[]` out.

**This is the one rule in the stage with no database backstop.** Every other
invariant has a CHECK, a trigger or a constraint behind the port; this one
cannot, because there is no column to constrain. Recorded as R7 rather than
left implicit.

### 5.4 `MalformedRowError`, not a plausible value

A row that cannot become a valid domain value fails loudly. Specifically: an
unknown `outcome_kind`, a `selected` outcome with no `selected` relation, a
dissent row whose materiality is outside the vocabulary, a trigger that is
neither quantitative-complete nor qualitative. The database constrains all of
these, so reaching them means the row was edited by hand or restored from an
incompatible backup — exactly what `MalformedRowError` is for.

---

## 6 · Ordering guarantees

Every list method states its order, and every order ends in a unique
tie-breaker. Byte order (`COLLATE "C"`), matching the rest of the adapter.

| Method                            | Order                                                            |
| --------------------------------- | ---------------------------------------------------------------- |
| `submissions.listForCase`         | `submitted_at`, `id`                                              |
| `submissions.pending`             | `submitted_at`, `id` — oldest first; a queue is FIFO             |
| `submissions.returnsForCase`      | `returned_at`, `id`                                               |
| `decisions.historyForCase`        | `decided_at`, `decision_id` — oldest first                        |
| `decisions.listRecent`            | `decided_at DESC`, `decision_id DESC`                             |
| `decision.outcome.considered*`    | already canonically sorted by the domain; mapping preserves it    |
| `decision_submissions` → relations| `revision_id`                                                     |
| `decision.unresolvedDissent`      | `ordinal` — the column exists precisely so order is not incidental|
| `decision.reconsiderationTriggers`| `ordinal`                                                         |
| `submission` basis child rows     | by their own natural key, ascending                               |

`ordinal` on `decision_dissent` and `decision_reconsideration_triggers` is part
of the primary key, so the write must assign it from the domain array index and
the read must restore that array exactly. A test asserts the order survives a
round trip with more than one entry — one entry proves nothing.

---

## 7 · Optimistic concurrency

**Neither submissions nor decisions are versioned aggregates.** Both are
write-once records; the versioned aggregate they hang off is the case, and
`cases.save(c, expectedVersion)` already guards it.

- `CioSubmission.caseVersion` is a **snapshot of what the submitter saw**, not a
  concurrency token. The repository stores it and never compares it. The version
  guard belongs to `SubmitForCioDecision` in C1D-1C.
- `CaseDecision.aggregateVersion` is the same: a record of the case version the
  CIO decided against.

This must be stated because storing a column called `case_version` next to a
column called `aggregate_version` invites a future implementer to enforce
something with them in the adapter, which would put a governance rule in
storage.

**The one true concurrency guard in this stage** is supersession:

```sql
UPDATE analysis.case_decisions
   SET superseded_by_decision_id = $new
 WHERE decision_id = $old
   AND superseded_by_decision_id IS NULL
```

Zero rows affected means someone else superseded it first. That raises
`ConcurrencyConflictError` — the caller re-reads the live decision and decides
again. Under `READ COMMITTED` the second writer blocks on the row lock, then
re-evaluates the predicate and finds it false, which is the behaviour we want
and the reason the isolation level is stated explicitly rather than inherited.

---

## 8 · Concurrency behaviour

| Race                                                      | Outcome                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| Two decisions for one case, neither superseding           | `case_decisions_one_live_per_case` rejects the second → `DuplicateRecordError` |
| Two corrections superseding the same live decision        | The `superseded_by IS NULL` predicate rejects the second → `ConcurrencyConflictError` |
| Two submissions for the same revision                     | **Not prevented by the schema.** The "one pending submission per revision" rule is a C1D-1C command refusal (§9 of the C1D-1 plan), not a constraint |
| A decision referencing a submission being returned        | Both touch `cio_submissions.state`; row lock serialises them, loser sees the settled state |
| Decision write racing a `truncate` in tests               | Not a production concern; noted so the contract suite does not create one |

Row 3 deserves attention at review. The schema permits two pending submissions
for one revision, and only the command refuses it. That is a deliberate
carry-over from the approved plan — but it means **between C1D-1B and C1D-1C
there is a window where the repository will happily store a duplicate pending
submission.** Nothing calls the repository in that window, so it is theoretical;
I state it because "the storage allows it and the command forbids it" is exactly
the kind of split that gets forgotten.

**Not attempted in this stage:** no advisory locks, no `SELECT … FOR UPDATE`, no
serializable isolation. TD-46 already records that the review-race behaviour
needs re-examination at production concurrency; decisions inherit that and no
more.

---

## 9 · Replay and idempotency

Uniform with every other write-once record in the adapter:

- `save(x)` where the id exists and the **semantic key matches** → returns the
  stored record. No write, no error.
- `save(x)` where the id exists and the semantic key **differs** →
  `ConflictingRecordError`. Two different decisions wearing one id is not
  something to settle by luck.
- Keys: `decisionSemanticKey` already exists in
  [writeOnce.ts:164](src/application/analysis/writeOnce.ts#L164) and was updated
  for the new outcome union in C1D-1A. C1D-1B adds `cioSubmissionSemanticKey`
  and `cioReturnSemanticKey` beside it.

`settle` is idempotent by nature — setting a submission to the state it already
holds is a no-op. Settling a `returned` submission to `decided` is **not** a
replay and must fail; the repository refuses it rather than silently
overwriting, because the two states describe different institutional histories.

Supersession replay: `save(decision)` where the decision already exists and
already carries its supersession is a full no-op, including the `UPDATE`. The
`WHERE superseded_by IS NULL` predicate makes the second attempt affect zero
rows, which the replay path must recognise as "already done" rather than as a
conflict — a distinction worth a dedicated test, because getting it backwards
turns every retry into a `ConcurrencyConflictError`.

---

## 10 · Immutable read/write guarantees

Four layers, deliberately redundant:

1. **No mutating method exists** on either port beyond `settle`.
2. **The grant.** `GRANT SELECT, INSERT` only, plus
   `GRANT UPDATE (state) ON cio_submissions` and
   `GRANT UPDATE (superseded_by_decision_id) ON case_decisions`. C1D-1A.1
   asserts this on both migration paths.
3. **`refuse_decision_rewrite`**, narrowed by 0020 to permit only the
   `NULL → successor` transition.
4. **Write-once conflict detection** at the port.

**Reads are deeply frozen.** Both adapters return values that pass `isDeeplyFrozen`
from [seal.ts](src/infrastructure/analysis/seal.ts), matching every other read
in the contract suite. A caller that mutates a returned decision must fail
immediately rather than corrupt an in-memory cache that a later assertion
believes.

---

## 11 · In-memory parity requirements

The in-memory adapter is the reference, not the fallback. It must:

- refuse everything PostgreSQL refuses, via `assertDecisionWellFormed` (§2.1)
  rather than a second implementation;
- enforce one live decision per case;
- perform supersession as one atomic act and reject a second supersession of an
  already-superseded decision;
- produce identical orderings, including byte order for ids — a JavaScript
  default sort is locale-flavoured and will disagree with `COLLATE "C"` on ids
  containing `-` or `_`;
- deep-freeze reads;
- store defensive copies, so a caller mutating the object it passed to `save`
  does not retroactively change what was stored.

**No assertion in `repositoryContract.ts` may branch on which adapter is
running.** That rule is already stated in the file header and holds here without
exception: if a behaviour cannot be expressed identically, it is a divergence to
resolve, not to accommodate.

---

## 12 · PostgreSQL parity requirements

The same suite, against a real database, as a login user holding `finos_app` —
never as the owner, or the permission layer proves nothing.

PostgreSQL-only additions, in `c1d1Repositories.pg.test.ts`:

- statement counts (§14);
- the deferred-trigger timing assertion from §3.1 — an invalid decision fails at
  `save`, and the transaction is still usable for a rollback;
- `MalformedRowError` on a row the owner inserted that the runtime could not
  have — the only way to reach that branch;
- the eligibility-policy seed equals `eligibilityPolicy('1')` (§1.2);
- restart durability (§13).

---

## 13 · Restart durability

C1D-1B has no commands, so the C1C-4.1 macro-flow harness cannot yet carry a
decision end to end. Repository-level durability is still provable and still
worth proving:

1. Construct the adapter, write a submission, a return, and a decision that
   supersedes an earlier decision.
2. `close()` the pool.
3. **Assert a read through the dead runtime fails.** Same discipline as
   `macroFlowHarness.restart()` — a "restart" that can still read the old
   connection proves nothing.
4. Construct a **new** adapter against the same database.
5. Read back and compare a canonical projection: every field, the supersession
   link, the live/historical distinction, dissent order, trigger order.

**No in-memory adapter participates**, per fitness rule 10, and no repository,
pool or domain object crosses the restart boundary.

What the projection excludes, and why: `evaluatedAt` on a submission basis is
projection time and differs by construction; `storageProvenanceId` differs
because the second runtime is a different runtime. Both are excluded explicitly
in the comparison rather than quietly ignored — same list discipline as
`institutionalState()`.

---

## 14 · Query budget

Asserted by the existing counter in
[queryCount.pg.test.ts](src/infrastructure/analysis/postgres/queryCount.pg.test.ts),
which counts one entry per statement per port operation.

**The invariant is not the number. It is that the number does not grow with the
data.** Every budget below is measured at 1 row and again at 25 rows, and must
be identical.

| Operation                      | Budget | Composition                                       |
| ------------------------------ | ------ | ------------------------------------------------- |
| `submissions.get`              | 5      | parent + 4 basis tables                            |
| `submissions.listForCase`      | 5      | same, `= ANY($1)`                                  |
| `submissions.pending`          | 5      | same                                               |
| `submissions.save` (new)       | ≤ 10   | 5 read-back + 5 write                              |
| `submissions.save` (replay)    | 5      | read-back only; no write                           |
| `submissions.settle`           | 1      | one `UPDATE … WHERE id = ANY($1)`                  |
| `submissions.recordReturn`     | 3      | return + concerns + submission state               |
| `decisions.get` / `getForCase` | 5      | parent + 4 child tables                            |
| `decisions.historyForCase`     | 5      | same                                               |
| `decisions.listRecent`         | 5      | same                                               |
| `decisions.save` (new)         | ≤ 13   | 5 read-back + supersede + parent + 4 children + 2 `SET CONSTRAINTS` |
| `decisions.save` (replay)      | 5      | read-back only                                     |

A budget that has to rise during implementation is a design change and gets
reported, not quietly edited.

---

## 15 · Performance considerations

Volume assumption, stated so it can be disagreed with: **~400 cases a year, one
to three submissions each, one decision plus rare corrections.** Low thousands
of rows within a few years. Every judgement below follows from that.

**Indexes that already exist and are used:** `cio_submissions_pending_idx`
(partial, on `state = 'pending'` — the CIO queue), `cio_submissions_case_idx`,
`cio_returns_case_idx`, `case_decisions_one_live_per_case` (serves `getForCase`),
`case_decisions_recent_idx`, `decision_submissions_submission_idx`.

**Two gaps I am recommending we accept rather than close:**

1. `historyForCase(caseId)` has **no supporting index**. The unique partial index
   covers live rows only. At the stated volume this is a sequential scan of a
   small table, which PostgreSQL would choose anyway.
2. `listRecent` filters `superseded_by IS NULL`, which `case_decisions_recent_idx`
   does not include, so live-ness is a filter rather than an index condition.

Adding both is one forward-only migration and no risk. I am recommending against
it now for the same reason TD-44 exists: this project's rule is to measure
before optimising, and a speculative index is a structure nobody can later prove
was needed. **Recorded as TD-55, with the volume assumption written down so the
trigger for revisiting it is explicit rather than a feeling.**

If you would rather have the indexes now, that is migration 0021 and it is a
small, safe addition — say so and I will fold it into stage B1.

---

## 16 · Failure modes

| Failure                                        | Surfaces as                    | Retryable |
| ---------------------------------------------- | ------------------------------ | --------- |
| Same id, different content                     | `ConflictingRecordError`       | No        |
| Second live decision for a case                | `DuplicateRecordError`         | No        |
| Supersession lost the race                     | `ConcurrencyConflictError`     | Yes, after re-read |
| Outcome rules violated                         | `InvariantViolationError`      | No        |
| Submission carries non-empty `blockers` (§5.3) | `InvariantViolationError`      | No — caller is wrong |
| Submission/revision/evidence set absent        | `ReferentialIntegrityError`    | No        |
| Stored row cannot become a domain value        | `MalformedRowError`            | No — the store is wrong |
| Runtime attempted a forbidden write            | `StoragePermissionError`       | No |
| Deadlock or serialization failure              | `RetryableStorageError`        | Yes — nothing was written |
| Commit sent, outcome unknown                   | `AmbiguousCommitError`         | **No** — re-read; a duplicate decision is worse than a failed request |
| Repository used after its transaction closed   | `TransactionClosedError`       | No |

No new error class. Every one of these already exists on the port, which is what
lets the contract suite assert on them against both stores.

**None of these messages carry PostgreSQL's `detail` field**, which contains the
offending key values — a unique violation would otherwise reproduce a case id or
a rationale into a log. Constraint name and operation only.

---

## 17 · Migration dependencies

**None. C1D-1B introduces no migration.**

Verified rather than assumed — I walked the domain interfaces against the table
definitions rather than trusting that C1D-1A had matched them:

- write-once conflict detection is read-back-and-compare, so no content-hash
  column is required (`aggregationRepositories.ts` establishes the pattern);
- `CioReturn` maps field for field onto `cio_returns` + `cio_return_concerns`,
  including the full actor snapshot;
- `CaseDecision` and its four child collections map completely;
- `EligibilityBasis` maps completely **except `blockers`**, which by design has
  no storage and must be empty — see §5.3. This is the one place the plan
  depends on a domain-enforced invariant instead of a schema-enforced one;
- every grant the two ports need is in 0020, and C1D-1A.1 proved it on both
  migration paths;
- the `ordinal` columns the ordering guarantees depend on exist and are part of
  their primary keys.

The only thing that would change this is a decision to add the §15 indexes,
which would be migration 0021.

---

## 18 · Fitness rules

**One new rule, with a planted violation and a benign near-miss**, per the
standing principle.

> **Rule 12 — `no-decision-rules-in-the-adapter`.**
> No file under `infrastructure/analysis/` re-derives what an outcome disposes
> of. `relationsOf` is the only source of a `decision_submissions.relation`.

Planted violations: a `CASE`/ternary computing `'selected' | 'not-selected'` from
an outcome kind in adapter code; a SQL literal assigning a relation from a
comparison. Benign near-misses: mapping a stored `relation` string back to the
domain union on read; a comment naming the relations; the domain's own
`relationsOf`, which lives outside the selected paths.

**Rules extended rather than added:**

- Rule 10 (`no-in-memory-adapter-in-durable-tests`) already covers the new
  `.pg.test.ts` files with no change — it selects by filename.
- The catalogue rule in [importGraph.test.ts:780](src/test/importGraph.test.ts#L780)
  requires every statement to sit inside `catalog({ … })`. The two new
  catalogues, `SUBMISSION_SQL` and `DECISION_SQL`, must be added to `CATALOGS` in
  `postgresRepositories.ts` or `queryCatalogHash` silently under-reports what the
  adapter can issue. **A test asserting every exported `*_SQL` catalogue appears
  in `CATALOGS`** closes that by construction — today it is remembered, not
  enforced, and this stage adds two more chances to forget.

I checked the existing rule set for coverage of "the adapter must not invent
identity" — rule 6 (`no-caller-supplied-or-invented-identity`) already covers
the new repositories without change.

---

## 19 · Architectural risks

**R1 — The mapping round trip is load-bearing and silent.** A lossy map turns
every replay into a `ConflictingRecordError`. Highest-consequence risk in the
stage, because it fails only under retry, which is when the system is already
stressed. *Mitigation:* §5.2's round-trip identity test across every optional
field and every outcome kind.

**R2 — `SET CONSTRAINTS ALL IMMEDIATE` couples the decision write to the whole
schema's deferred constraints.** Harmless today, invisible if it stops being
harmless. *Mitigation:* §3.1; the named-list alternative if a non-decision
deferred constraint appears.

**R3 — Two sources of the eligibility policy.** The domain object and the seeded
row can drift. *Mitigation:* §1.2's equality test. The residual risk is that the
test asserts the fields we thought of; a new policy field added to the domain
and not the table would pass. *Accepted*, and the reason the domain is
authoritative is precisely that this failure is then cosmetic.

**R4 — The schema permits a duplicate pending submission; only the command
refuses it.** §8. *Accepted* per the approved plan, stated so it is not
rediscovered.

**R5 — Eleven tables behind two ports.** The write path for a decision touches
five tables in one call. A future contributor adding a sixth child table will
touch four places — row type, mapping, catalogue, budget. *Mitigation:* the
query-budget test fails on an unaccounted statement, which is a blunt but
reliable tripwire.

**R6 — The in-memory adapter grows a second decision model.** Every prior stage
has resisted this and it is the standing temptation. *Mitigation:* §2.1's shared
validator plus the no-branching rule in the contract suite.

**R7 — `blockers` must be empty and only the domain can say so.** §5.3. The one
invariant in this stage with no CHECK, trigger or constraint behind it, so a
future adapter written without the validator would drop the field silently.
*Mitigation:* the shared validator, a contract test that a non-empty `blockers`
is refused by both stores, and — the durable part — fitness rule 12 extended to
assert that both `save` paths call the domain validator. Residual risk accepted:
a third adapter is the scenario this does not cover.

---

## 20 · Technical debt

**Closed by this stage:** none outright. TD-45 stays closed.

**Opened:**

- **TD-55 · No index supports `historyForCase`, and `listRecent` filters live-ness
  outside its index.** Accepted at the stated volume (§15). Revisit when a case
  exceeds ~10 decisions or `case_decisions` exceeds ~50k rows.
- **TD-56 · Catalogue membership is remembered, not enforced** — until the §18
  test lands, which this stage lands. Listed so the gap is visible if that test
  is cut.

**Carried and untouched:** TD-50 (no reconsideration command), TD-51 (return
types undifferentiated), TD-52 (trigger lineage), TD-53 (nothing monitors a
trigger), TD-54 (one outcome per decision), TD-41–44, TD-46, TD-34–37, TD-39,
TD-8.

---

## 21 · Contract versions

**Command contract stays at 2.** C1D-1B adds no command, no envelope field, no
category and no mandate.

**Domain contract stays at 8.** `assertDecisionWellFormed` is an added function,
not a changed shape. No stored vocabulary gains a value.

---

## 22 · Staged implementation plan

Four stages. Each is committed and reported before the next begins.

### B0 — row types and the dead shapes

Delete `DecisionRow` and `DecisionRevisionRow`. Add `CioSubmissionRow`,
`SubmissionRequiredWorkRow`, `SubmissionDisagreementRow`, `SubmissionEvidenceRow`,
`SubmissionOpenChallengeRow`, `CioReturnRow`, `CioReturnConcernRow`,
`CaseDecisionRow`, `DecisionSubmissionRow`, `DecisionDissentRow`,
`DecisionDissentEvidenceRow`, `DecisionTriggerRow`.

**Exit criteria** — every row type has a column for every column in 0020 and no
column that 0020 lacks, asserted by a test reading `information_schema.columns`
rather than by inspection; the two dead types are gone; `tsc` clean; both suites
green.

### B1 — ports, mapping and the in-memory reference

Port definitions in `repositories.ts`; `assertDecisionWellFormed` in the domain;
`cioSubmissionSemanticKey` and `cioReturnSemanticKey` in `writeOnce.ts`; the
in-memory implementations; mapping functions.

**Exit criteria** — the in-memory adapter satisfies the full contract suite;
round-trip identity holds; orderings are byte order; reads deep-frozen;
`buildDecision` and both adapters share one validator, asserted by a test that a
hand-assembled invalid decision is refused identically; domain contract still 8.

### B2 — the PostgreSQL adapter

`submissionRepositories.ts` and `decisionRepositories.ts`; both catalogues
registered in `CATALOGS`; the catalogue-membership test; supersession;
`SET CONSTRAINTS` handling; error translation.

**Exit criteria** — the same contract suite passes unmodified against
PostgreSQL as `finos_app`; no assertion branches on the adapter; the deferred
trigger fires at `save`; permission errors surface as `StoragePermissionError`;
the eligibility seed matches the domain; migration count unchanged at 20.

### B3 — budgets, restart and the fitness rule

Query-budget assertions at 1 row and 25; the restart suite; fitness rule 12 with
its planted violation and benign near-miss, plus the negative control that the
near-miss fails when the rule is broadened.

**Exit criteria** — every §14 budget holds at both sizes; the restart suite
proves the dead runtime cannot read and the new one reads everything; rule 12
detects its planted violation and admits its near-miss; `tsc` clean; both suites
green; working tree clean.

---

## 23 · What I need decided before B0

1. **Two ports or three** — returns folded into `SubmissionRepository` (§1.1), or
   their own port.
2. **`SET CONSTRAINTS ALL IMMEDIATE`** (§3.1) — accept the broad form, or name the
   three constraint triggers explicitly with a fitness rule keeping the list
   complete.
3. **The §15 indexes** — accept as TD-55, or add migration 0021 in B1.
4. **`assertDecisionWellFormed` in the domain** (§2.1) — confirm that reopening
   `domain/analysis/decisions.ts` after C1D-1A closed is acceptable, given it is
   additive and the contract stays at 8.
5. **`blockers` with no storage** (§5.3) — refuse a non-empty array at the port
   and keep the round trip lossless, or add a `submission_blockers` table in
   migration 0021 so the audit record can hold what it claims to. I recommend
   refusing: the rows cannot legitimately occur, and a 14-arm union stored
   relationally for rows that never exist is the kind of structure this project
   has been removing rather than adding.

Everything else in this plan I am prepared to build as written.
