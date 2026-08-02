# C1D-1B stage B2 — the PostgreSQL adapter

**Planning gate. No implementation.**

B1 defined the institutional semantics without PostgreSQL: two ports, four pure
validators, lossless mapping, an in-memory reference and 51 shared contract
tests. B2 implements the same contract against a real database.

**PostgreSQL implements the contract. It does not redefine it.** Where the
database reveals an ambiguity or an incorrect in-memory behaviour, the
authoritative institutional rule is identified, the shared contract or the
reference is fixed, and the deviation is reported. The adapter is never
silently different.

The 51 shared tests run **unchanged**. PostgreSQL-specific tests are additional.

---

## 0 · Three things found while planning

Stated first because two of them change what B2 builds.

### 0.1 The throwing stubs — how they go away

Your requirement is that a missing capability fails at construction rather than
during an institutional command. Agreed, and the current `Proxy` stub fails the
wrong way: it satisfies the port structurally and throws on invocation.

B2 removes it entirely, and adds the construction-time guard you asked for:

- `createPostgresRepositories` builds real repositories for both ports — after
  B2C there is nothing left to stub.
- **A completeness assertion at construction.** `repositoriesFor(scope)` is
  checked against a frozen list of required port names, and a container missing
  one throws from `createPostgresRepositories` — before any caller holds it.
- **A fitness rule (14) with a planted violation**: no file under
  `infrastructure/analysis/` may satisfy a repository port with a value whose
  methods throw "not implemented", and no `Proxy` may stand in for a port.
- The stub is deleted in **B2C**, not left to be tidied later, and B2C's exit
  criteria include a grep-level assertion that `notUntilB2` no longer exists.

Between B2A and B2C the stub still exists for `decisions` only, which is the
shortest bridge that lets B2A commit separately. If you would rather it not
exist at all mid-stage, the alternative is one B2 commit instead of three; I
recommend the three-commit shape and the temporary narrowing, because a single
commit implementing eleven tables is harder to review than the risk is worth.

### 0.2 Provenance and command references — the columns do not exist, and should not

Your submission list asks for "command/result references · storage provenance",
your return list for "command and provenance references", your decision list for
"storage provenance". I checked the schema rather than assuming:

| Table             | `storage_provenance_id` | `command_id` |
| ----------------- | ----------------------- | ------------ |
| `cio_submissions` | **yes** (0020:129)      | no           |
| `cio_returns`     | no                      | no           |
| `case_decisions`  | no                      | no           |

**Recommendation: add none of them.**

`analysis.commands` and `analysis.command_outcomes` each carry `provenance_id`
(0013:107, 0013:174), and `command_outcomes` carries `result_kind` and
`result_ref` (0013:164-165). Every submission, return and decision is produced by
exactly one command whose outcome names it. So "which command wrote this record,
under which adapter build" is already answerable by one join, and a column for it
would store what can be derived — which this project has refused consistently.

The submission's own `storage_provenance_id` is **not** an exception to that. It
does not record which build wrote the row; it records which build produced the
**eligibility projection**, and is part of the basis. Different fact, and the
column earns its place.

If you want the write-provenance denormalised onto decisions anyway, that is
migration 0021 and I will do it — but I would want the reason to be a query that
needs it, not symmetry with the submission.

### 0.3 The B1 fixtures land on real organization rows

Checked, because the PostgreSQL contract has real foreign keys where the
in-memory one has none: `cio`, `research-director`, `executive` and
`research-office` are all seeded by migration 0010. The `seed` hook has to create
the case, thesis revisions, reviews, challenges, claims, runs, aggregation,
evidence sets and storage provenance — not the organization.

---

## 1 · Files

| File                                                        | What                                              |
| ----------------------------------------------------------- | ------------------------------------------------- |
| `postgres/submissionRepositories.ts`                         | `SUBMISSION_SQL`, `RETURN_SQL`, both repositories  |
| `postgres/decisionRepositories.ts`                           | `DECISION_SQL`, `SUPERSESSION_SQL`, the repository |
| `postgres/deferredConstraints.ts`                            | the named constraint catalogue and its forcing helper |
| `postgres/postgresRepositories.ts`                           | wires both, deletes the stub, adds the completeness guard |
| `postgres/decisionMapping.ts`                                | gains `tenant_id` injection; otherwise unchanged   |
| `postgres/postgresDecisionContract.pg.test.ts`               | the 51 shared tests, as `finos_app`                |
| `postgres/c1d1Repositories.pg.test.ts`                       | PostgreSQL-only behaviour                          |
| `postgres/queryCount.pg.test.ts`                             | extended with the §8 budgets                       |
| `test/fitness/rules.ts`, `planted.ts`                        | rules 13 and 14 with fixtures                      |
| `db/migrations/0021_decision_history_index.sql`              | **only if §11 justifies it**                       |

`decisionMapping.ts` needs one change: `submissionToRows`, `returnToRows` and
`decisionToRows` currently write `tenant_id: ''` because a pure mapper has no
tenant. B2 threads the tenant through as a parameter rather than leaving the
repository to patch the row afterwards — patching would put a column assignment
outside the mapper the round-trip test covers.

---

## 2 · SQL catalogue structure

All SQL in frozen `catalog({ … })` blocks, grouped by responsibility as you
specified. Nothing inline in a method; nothing assembled at a call site.

```
SUBMISSION_WRITE_SQL   insertSubmission · insertRequiredWork · insertDisagreements
                       · insertEvidence · insertOpenChallenges · settle
SUBMISSION_READ_SQL    byId · forCase · forRevision · pending
                       · requiredWorkFor · disagreementsFor · evidenceFor
                       · openChallengesFor
RETURN_WRITE_SQL       insertReturn · insertConcerns
RETURN_READ_SQL        byId · forCase · forRevision · concernsFor
DECISION_WRITE_SQL     insertDecision · insertRelations · insertDissent
                       · insertDissentEvidence · insertTriggers
DECISION_READ_SQL      byId · liveForCase · historyForCase · recent
DECISION_HYDRATE_SQL   relationsFor · dissentFor · dissentEvidenceFor · triggersFor
SUPERSESSION_SQL       markSuperseded · liveDecisionIdFor
CONSTRAINT_SQL         forceDecisionConstraints · restoreDecisionConstraints
```

Every catalogue is registered in `CATALOGS` in `postgresRepositories.ts`, and
B2C adds the test that **every exported `*_SQL` appears there** — today that is
remembered rather than enforced, and this stage adds nine more chances to forget
(TD-56).

Row types and catalogue entries stay inside `infrastructure/analysis/postgres/`;
`importGraph.test.ts` already asserts the row types cannot escape, and the
catalogue rule at `importGraph.test.ts:780` already requires every statement to
sit inside `catalog({ … })`.

---

## 3 · Repository method → query map

### 3.1 Submissions

| Method                   | Statements                                                        | Transaction        |
| ------------------------ | ----------------------------------------------------------------- | ------------------ |
| `get`                    | `byId` + 4 child reads                                            | `unitOfWork`       |
| `listForCase`            | `forCase` + 4 child reads (`= ANY($1)`)                            | `unitOfWork`       |
| `applicableForRevision`  | `forRevision` + 4 child reads                                      | `unitOfWork`       |
| `pending`                | `pending` + 4 child reads                                          | `unitOfWork`       |
| `save`                   | read-back (5) then `insertSubmission` + 4 child inserts            | `unitOfWork`       |
| `settle`                 | `settle` (one `UPDATE … WHERE id = ANY($1) AND state = 'pending'`) | `singleStatement`  |
| `recordReturn`           | read-back (2) then `insertReturn` + `insertConcerns` + `settle`    | `unitOfWork`       |
| `getReturn`              | `byId` + `concernsFor`                                             | `unitOfWork`       |
| `returnsForCase`         | `forCase` + `concernsFor`                                          | `unitOfWork`       |
| `returnsForRevision`     | `forRevision` + `concernsFor`                                      | `unitOfWork`       |

`settle` is `singleStatement` because it is provably one statement — but it must
still report a violation rather than silently updating nothing. The statement
returns the affected ids, and the repository compares against what it was asked
to settle: a row missing entirely is `ReferentialIntegrityError`, a row already
settled to the *other* state is `InvariantViolationError`, a row already settled
to the *same* state is a replay. That comparison needs the current states, so
`settle` becomes `unitOfWork` with a `SELECT … FOR UPDATE`-free read plus the
update — **two statements, still constant.** I am flagging this as a correction
to the §14 budget in the C1D-1B plan, which said 1.

### 3.2 Decisions

| Method            | Statements                                                                   | Transaction  |
| ----------------- | ---------------------------------------------------------------------------- | ------------ |
| `get`             | `byId` + 4 hydration reads                                                    | `unitOfWork` |
| `getForCase`      | `liveForCase` + 4                                                             | `unitOfWork` |
| `historyForCase`  | `historyForCase` + 4                                                          | `unitOfWork` |
| `listRecent`      | `recent` + 4                                                                  | `unitOfWork` |
| `save`            | read-back (5) · `markSuperseded` · `insertDecision` · 4 child inserts · force · restore | `unitOfWork` |

---

## 4 · Transaction map

Unchanged from the established contract. Every multi-statement operation uses
`unitOfWork`, which **joins the caller's transaction when one is open** and
otherwise opens its own on one connection — no nesting, no savepoints, and the
lifetime guard (`TransactionClosedError`) runs before any I/O.

Reads use `unitOfWork` too, not the ambient pool: a submission spans five tables
and five implicit transactions could assemble a submission that never existed.
That is the H1 defect already closed for cases, applied here.

**Success is returned only after the logical operation is valid** — which for a
decision means after the named constraints have been forced (§5), not merely
after the inserts returned.

---

## 5 · Named deferred constraints

`SET CONSTRAINTS ALL IMMEDIATE` is rejected, per your decision. One catalogue,
in `deferredConstraints.ts`, holding exactly the constraints the decision write
owns — verified against migration 0020 rather than recalled:

| Constraint                                | Kind               | Source     |
| ----------------------------------------- | ------------------ | ---------- |
| `case_decisions_supersedes_fk`            | deferred FK        | 0020:376   |
| `case_decisions_superseded_by_fk`         | deferred FK        | 0020:380   |
| `case_decisions_outcome_guard`            | constraint trigger | 0020:688   |
| `decision_submissions_outcome_guard`      | constraint trigger | 0020:693   |
| `triggers_outcome_guard`                  | constraint trigger | 0020:698   |
| `case_decisions_no_supersession_cycle`    | constraint trigger | 0020:737   |

Note the third trigger is named `triggers_outcome_guard`, not
`decision_reconsideration_triggers_outcome_guard` as the C1D-1B plan guessed.
That is the kind of error §5.1's test exists to catch.

**Which writes force which.** Only `decisions.save` forces anything. Submissions
and returns own no deferred constraint, so they force nothing and their writes
stay composable inside a caller's transaction that has decision work pending.

**Sequence inside `decisions.save`**, after all rows are written and before
returning:

```
SET CONSTRAINTS <the six> IMMEDIATE     -- checks now, inside the transaction
SET CONSTRAINTS <the six> DEFERRED      -- restores what the caller handed over
```

### 5.1 The test that matters most

`SET CONSTRAINTS` on a name that does not exist raises — but on a name that
exists and is **not deferrable** it succeeds and does nothing. A constraint
renamed or quietly made immediate would turn this whole mechanism into a no-op
that every other test still passes. So:

- a test asserts every catalogued name exists in `pg_constraint` **and is
  deferrable**, read from the live database;
- three tests assert an invalid `selected`, `deferred` and `declined` decision
  each fails **from `decisions.save`**, not from the outer commit;
- one test opens a transaction with an unrelated deferred constraint pending,
  performs a decision write, and asserts the unrelated work is **still deferred**
  and still commits;
- one test asserts no raw constraint name, SQL or PostgreSQL `detail` reaches
  the thrown error's message.

---

## 6 · Submission persistence

One transaction writes the root and its four child tables. Rejected **before any
statement is issued**, by `validateCioSubmission`:

- non-empty blockers
- basis describing a different revision
- unresolved Risk requirement
- required Risk with no review named
- missing policy version or provenance
- a decision-critical disagreement

Rejected **by the database**, mapped to bounded errors: unknown eligibility
policy version (`cio_submissions_eligibility_policy_version_fkey` → 23503 →
`ReferentialIntegrityError`); a case/tenant pair that does not exist; a revision,
review, run, claim, challenge or evidence set that does not exist.

**Cross-revision review references are not constrained by the schema.** 0020's
foreign keys prove a review exists; nothing proves it reviewed *this* revision.
The check needs a read, so it belongs to `SubmitForCioDecision` in C1D-1C, which
already reads the reviews to build the basis. I am recording this rather than
adding a repository read that would duplicate the command's work — say the word
if you would rather the repository enforce it.

**No mapper discards information because no column exists.** The one field with
no column is `blockers`, and it is refused rather than dropped (§0.2 of the B1
work). A fitness rule in B2C asserts no `toRows` function silently omits a
domain field.

---

## 7 · Return persistence

`recordReturn` writes the return, its concerns and the submission's state
transition in one transaction. Preserved: exact case, exact revision, the full
CIO actor snapshot with its canonically-sorted handles, structured concerns with
their subject kind and id, reason, `returnedAt`, case version, authorization
basis.

Concerns are immutable — no grant, no method, no path. Identical replay returns
the stored return; changed concerns raise `ConflictingRecordError`, and because
`cioReturnSemanticKey` hashes the concern list **in order**, a reordering is a
conflict rather than a replay. That is deliberate: a return listing the same
concerns in a different order is a different instruction to whoever picks the
work up.

**No return creates or implies a correction assignment.** There is no
`requested_department_id`, no addressed flag, and none is added. TD-43 is the
capability that turns a return into assigned work.

---

## 8 · Hydration and query budgets

Fixed batched queries. Never one query per submission, review, dissent item,
evidence ref, trigger, concern or relation: child tables are read with
`WHERE parent_id = ANY($1)` and grouped in memory with the existing `groupBy`.

**The invariant is not the number — it is that the number does not grow with the
data.** Every budget is measured at 1 child row and again at 25 and must be
identical, using the existing counter in `queryCount.pg.test.ts`.

| Operation                           | Budget | Composition                              |
| ----------------------------------- | ------ | ---------------------------------------- |
| `submissions.get`                   | 5      | root + 4 children                        |
| `submissions.listForCase`           | 5      | root + 4 children                        |
| `submissions.applicableForRevision` | 5      | root + 4 children                        |
| `submissions.pending`               | 5      | root + 4 children                        |
| `submissions.save` (new)            | ≤ 10   | 5 read-back + 5 write                    |
| `submissions.save` (replay)         | 5      | read-back only                           |
| `submissions.settle`                | 2      | read states + update — **was 1** (§3.1)  |
| `submissions.recordReturn`          | 5      | 2 read-back + return + concerns + settle |
| `submissions.getReturn`             | 2      | root + concerns                          |
| `submissions.returnsForCase`        | 2      | root + concerns                          |
| `submissions.returnsForRevision`    | 2      | root + concerns                          |
| `decisions.get` / `getForCase`      | 5      | root + 4 hydration reads                 |
| `decisions.historyForCase`          | 5      | root + 4                                 |
| `decisions.listRecent`              | 5      | root + 4                                 |
| `decisions.save` (new)              | ≤ 13   | 5 read-back + supersede + root + 4 children + 2 constraint statements |
| `decisions.save` (replay)           | 5      | read-back only                           |

Hydration goes through `decisionMapping.ts`, which already raises
`MalformedRowError` for an unknown outcome kind, a `selected` outcome whose
relations select nothing or select something else, a review reference with no
sequence, an actor claiming an authentication the runtime cannot perform, and a
submission row whose Risk requirement was never resolved. **No partially valid
domain object is ever produced.**

---

## 9 · Ordering

Explicit `ORDER BY` on every list, each ending in a unique tie-breaker, byte
order via `COLLATE "C"` to match the in-memory `byString`.

| Method                              | `ORDER BY`                                                     |
| ----------------------------------- | -------------------------------------------------------------- |
| `submissions.listForCase`           | `submitted_at, id COLLATE "C"`                                  |
| `submissions.applicableForRevision` | `submitted_at, id COLLATE "C"`                                  |
| `submissions.pending`               | `submitted_at, id COLLATE "C"`                                  |
| `submissions.returnsForCase`        | `returned_at, id COLLATE "C"`                                   |
| `submissions.returnsForRevision`    | `returned_at, id COLLATE "C"`                                   |
| `decisions.historyForCase`          | `decided_at, decision_id COLLATE "C"`                           |
| `decisions.listRecent`              | `decided_at DESC, decision_id COLLATE "C" DESC`                 |
| `relationsFor`                      | `revision_id COLLATE "C"`                                       |
| `dissentFor` / `dissentEvidenceFor` | `ordinal` (then `evidence_set_id, observation_id` for evidence) |
| `triggersFor`                       | `ordinal`                                                       |
| `concernsFor`                       | `ordinal`                                                       |
| `requiredWorkFor`                   | `playbook_entry_key COLLATE "C"`                                |
| `disagreementsFor`                  | `claim_id COLLATE "C"`                                          |
| `evidenceFor`                       | `evidence_set_id COLLATE "C"`                                   |
| `openChallengesFor`                 | `challenge_id COLLATE "C"`                                      |

Nothing relies on planner behaviour, insertion order or primary-key coincidence.

---

## 10 · Replay, conflict and supersession

### 10.1 Replay

`ON CONFLICT DO NOTHING` alone is insufficient and is not used as proof of
anything. For every immutable write:

1. read the **complete aggregate** by id, including every child table;
2. if absent → insert;
3. if present → compare through the approved semantic key
   (`cioSubmissionSemanticKey`, `cioReturnSemanticKey`, `decisionSemanticKey`);
4. identical → return the stored record, write nothing;
5. different → `ConflictingRecordError`.

A duplicate primary key is never treated as evidence the record is equivalent.
The read-back is the whole aggregate precisely because a root that matched while
a child differed would otherwise pass.

This is where B1's round-trip work pays: if the mapping were lossy, step 3 would
report a conflict on every correct retry.

### 10.2 The supersession sequence

Inside one transaction, in this order:

```
1.  liveDecisionIdFor(caseId)        -- read; establishes what is being replaced
2.  markSuperseded:
      UPDATE analysis.case_decisions
         SET superseded_by_decision_id = $new
       WHERE decision_id = $old
         AND superseded_by_decision_id IS NULL
    -- 0 rows affected → ConcurrencyConflictError; someone else got there first
3.  insertDecision (the successor)
4.  the four child inserts
5.  SET CONSTRAINTS <six> IMMEDIATE
6.  SET CONSTRAINTS <six> DEFERRED
```

Step 2 **precedes** step 3, which is possible only because both supersession
foreign keys are `DEFERRABLE INITIALLY DEFERRED` — the old row leaves the partial
unique index before the new one enters it, so no instant has two live decisions.

Guarantees, each with a test:

- one live decision per case **after commit** — `case_decisions_one_live_per_case`
- prior decision content immutable — only `superseded_by_decision_id` is granted
- the link changes **once** — the `IS NULL` predicate makes the second attempt
  affect zero rows
- same case — `case_decisions_supersedes_fk` is composite on `(id, case_id)`
- rollback restores the original as live — the whole sequence is one transaction
- identical replay is a no-op returning the original — step 2's zero-row result
  must be read as "already done" when the successor already exists, and as a
  conflict when it does not. **Getting this backwards turns every retry into a
  `ConcurrencyConflictError`, so it gets its own test.**
- a conflicting successor is a bounded `ConcurrencyConflictError`

The one-live-decision meaning is never disabled or deferred beyond the
transaction: the partial unique index is not deferrable and is not touched.

---

## 11 · Migration 0021 and TD-55

Evaluated against the actual B2 queries, per your template.

### 11.1 `case_decisions_history_idx` — **recommended**

| Field                | Value                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------- |
| Query supported      | `decisions.historyForCase` — `WHERE case_id = $1 ORDER BY decided_at, decision_id`      |
| Plan without it      | Sequential scan on `case_decisions` plus a sort. No index leads with `case_id` over all rows |
| Why existing fails   | `case_decisions_one_live_per_case` is partial on `superseded_by IS NULL` — it excludes exactly the superseded rows history exists to return. `case_decisions_recent_idx` leads with `tenant_id, decided_at`, so `case_id` cannot be an access predicate |
| Representative volume| ~400 cases/yr, 1–3 decisions each; low thousands of rows                                |
| Selectivity          | 1–3 rows of N — highly selective                                                        |
| Definition           | `(case_id, decided_at, decision_id COLLATE "C")`, not partial                            |
| Measured plan after  | To be captured in B2B and reported; the assertion is **no `Seq Scan` on `case_decisions`** at ≥ 200 decisions across ≥ 50 cases after `ANALYZE` |

`historyForCase` is a demonstrated B2 query — it is in the port, in the contract
suite and in the query budget — so this is not speculative.

### 11.2 The live-recent partial index — **stays TD-55**

`decisions.listRecent` filters `tenant_id = $1 AND superseded_by IS NULL` and
orders `decided_at DESC, decision_id DESC`. `case_decisions_recent_idx` already
serves the tenant predicate and the full ordering; live-ness is a filter applied
during the scan, and corrections are rare, so `LIMIT` is satisfied after scanning
barely more rows than it returns. Adding a partial index would be speculative.

> **TD-55 trigger, unchanged:** superseded decisions exceed **20%** of
> `case_decisions`, or `listRecent` scans more than **3×** the rows it returns at
> p95.

### 11.3 If 0021 lands

Implemented in **B2B**, alongside the query it serves. Requirements: clean and
upgrade coverage by extending `c1d1Upgrade.pg.test.ts` to 0001–0021 versus
0001–0020-then-0021; automatic fingerprint coverage, since `pg_indexes.indexdef`
is already a dimension and captures column order and predicate; a test asserting
0021 changes no grant; **no edit to migration 0020 or any earlier migration.**

Plan assertions are properties, never pinned `EXPLAIN` text: full plan output is
unstable across versions and row estimates.

---

## 12 · Error mapping

`mapDatabaseError` in `sql.ts` already covers the taxonomy and is reused
unchanged. The mapping B2 relies on:

| Condition                          | SQLSTATE       | Error                       |
| ---------------------------------- | -------------- | --------------------------- |
| Duplicate key / unique violation   | 23505          | `DuplicateRecordError`      |
| Missing reference                  | 23503          | `ReferentialIntegrityError` |
| CHECK, NOT NULL, exclusion         | 23502/23514/23P01 | `InvariantViolationError` |
| Our own `RAISE` (guards, triggers) | 23000/P0001    | `ImmutableRecordError`      |
| Serialization failure / deadlock   | 40001 / 40P01  | `RetryableStorageError`     |
| Permission denied                  | 42501          | `StoragePermissionError`    |
| Connection lost                    | 08*            | `StorageUnavailableError`   |
| Commit sent, outcome unknown       | —              | `AmbiguousCommitError`      |
| Scope closed                       | —              | `TransactionClosedError`    |

Raised by the repository rather than the driver: `ConflictingRecordError` (§10.1),
`ConcurrencyConflictError` (§10.2), `MalformedRowError` (§8),
`InvariantViolationError` for a validator problem.

**One correction to make in B2.** The outcome guards raise with
`ERRCODE = 'integrity_constraint_violation'` (23000), which `mapDatabaseError`
currently maps to `ImmutableRecordError`. An invalid decision outcome is not an
immutability failure, and the in-memory reference raises
`InvariantViolationError` — so the two adapters would disagree. B2 distinguishes
them by the raised message prefix (`decision_outcome:` and `supersession_cycle:`
are already in 0020) and maps those to `InvariantViolationError`. **This is a
shared-contract fix, reported as a deviation, not an adapter-local workaround.**

Never exposed: SQL, parameter values, case or thesis content, PostgreSQL's
`detail` field, driver messages. Constraint names are used internally for
mapping and do not become user-facing diagnostics — the existing errors carry the
constraint name in a bounded field, which is a schema identifier, not content.

---

## 13 · Runtime role

The whole PostgreSQL suite runs as `finos_app` through `db.loginUrlFor(APP_ROLE)`,
never as the owner. An owner-level run would pass statements production cannot
execute, which is the point of the grants.

**Must succeed:** insert submissions and their four child tables · insert returns
and concerns · insert decisions and their four child tables · the narrowly
permitted `UPDATE (superseded_by_decision_id)` · `UPDATE (state)` on
`cio_submissions` · `SELECT` on `eligibility_policies` · read live and historical
decisions.

**Must be refused (42501 → `StoragePermissionError`):** updating any immutable
column on a decision, submission, return or concern · deleting anything ·
inserting into `eligibility_policies` · `ALTER TABLE … DISABLE TRIGGER` ·
updating `decision_submissions` · touching `schema_migrations`.

C1D-1A.1 already proved the grants exist on both migration paths; B2 proves the
adapter works within them.

---

## 14 · Test plan

**The 51 shared contract tests, unchanged**, via a new
`postgresDecisionContract.pg.test.ts` call site supplying `create`, `destroy` and
the `seed` hook. No assertion in `decisionRepositoryContract.ts` changes; if one
has to, that is a divergence to report and resolve, not to accommodate.

PostgreSQL-only, in `c1d1Repositories.pg.test.ts`:

submission replay and conflict · return replay and conflict · decision replay and
conflict · constraint forcing for `selected`, `deferred` and `declined` ·
unrelated deferred constraint not forced · every catalogued constraint exists and
is deferrable · supersession · supersession rollback · concurrent save of a
second live decision · concurrent supersession of one predecessor · cross-case
submission and cross-case supersession · malformed child row (inserted as owner,
unreachable through the runtime) · non-empty blockers refused **before any SQL is
issued** · unknown policy version · actor snapshot canonicalisation · deterministic
ordering at ≥ 3 rows · live decision excludes superseded · history retains
superseded · `listRecent` semantics · runtime-role permissions (§13) ·
transaction lifetime · pool cleanup with no leaked clients · restart round-trip ·
query budgets at 1 and 25 children · no fabricated Compliance anywhere in a
hydrated aggregate · no pre-0020 shape · **no command implementation, no LLM, no
UI change.**

---

## 15 · Staging

Three commits, each reported before the next begins.

### B2A — submissions and returns

`SUBMISSION_*_SQL`, `RETURN_*_SQL`, both repositories, hydration, replay and
conflict, the `seed` hook, and the submission/return portion of the shared
contract running against PostgreSQL.

**Exit:** the submission and return contract tests pass unchanged as `finos_app`;
budgets hold at 1 and 25; the `decisions` stub is the only one left.

### B2B — decisions

`DECISION_*_SQL`, `SUPERSESSION_SQL`, `deferredConstraints.ts`, relations,
dissent, evidence, triggers, supersession, live and history reads, the error-map
correction of §12, and migration 0021 if §11.1 stands.

**Exit:** all 51 shared tests pass unchanged against PostgreSQL; invalid outcomes
fail from `save`; unrelated deferred constraints stay deferred; 0021 applies
clean and as an upgrade with fingerprint coverage.

### B2C — parity, permissions and stub removal

Concurrency, restart, runtime-role permissions, pool cleanup, the catalogue
membership test, fitness rules 13 and 14, and **deletion of every throwing stub**
plus the construction-time completeness guard.

**Exit:** `notUntilB2` does not exist in the tree; a container missing a port
throws from `createPostgresRepositories`; rule 14 detects a planted throwing
stub and admits a benign near-miss; both suites green; tree clean.

---

## 16 · Risks and technical debt

**R1 — the outcome-guard error maps to the wrong class today** (§12). Highest
likelihood of a silent parity break, because both adapters reject the aggregate
and only the error class differs. *Mitigation:* the shared contract asserts the
class, so it fails loudly in B2B.

**R2 — supersession replay read backwards.** A zero-row `markSuperseded` means
"already done" or "someone else won" depending on whether the successor exists.
*Mitigation:* its own test, both directions.

**R3 — a constraint renamed or made immediate silently disables the forcing.**
*Mitigation:* §5.1's deferrability assertion read from the live catalogue.

**R4 — cross-revision review references are unenforced** (§6). Accepted; the
check belongs to C1D-1C.

**R5 — `settle`'s budget rises from 1 to 2** (§3.1). Reported rather than
edited quietly, per the standing rule that a budget change is a design change.

**Debt opened:** none new.
**Debt closed:** TD-56, by the catalogue membership test in B2C.
**Carried:** TD-55 (§11.2, with its numeric trigger) · TD-43 (a return creates no
work) · TD-50–54 · TD-41–44 · TD-46 · TD-34–37 · TD-39 · TD-8.

**Contract versions:** command stays at **2**, domain stays at **8**. B2 adds no
command, no envelope field, no stored vocabulary value.

---

## 17 · What I need decided before B2A

1. **The stub bridge** (§0.1) — accept it narrowing to `decisions` only across
   B2A/B2B, or collapse B2 into one commit so no stub ever exists.
2. **Provenance and command columns** (§0.2) — accept that they are derivable
   through the command ledger, or add them in migration 0021.
3. **Cross-revision review references** (§6) — leave to C1D-1C, or have the
   repository read and enforce.
4. **Migration 0021** (§11) — confirm the history index lands in B2B and the
   live-recent index stays TD-55.
5. **The error-map correction** (§12) — confirm that changing 23000-with-
   `decision_outcome:` to `InvariantViolationError` is the right resolution,
   rather than changing the in-memory reference to raise `ImmutableRecordError`.

Everything else I am prepared to build as written.
