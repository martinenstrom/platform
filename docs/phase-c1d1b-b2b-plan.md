# C1D-1B stage B2B — the PostgreSQL decision repository

**Planning gate. No implementation.**

B2A implemented submissions and returns against PostgreSQL and the shared
contract's submission half passes unchanged. B2B implements the decision half:
persistence, relations, dissent, triggers, supersession, live/history/recent
reads, and the named deferred-constraint forcing. It removes the decision
placeholder.

The **25 currently skipped** decision contract tests become active. They run
unchanged — no assertion in `decisionRepositoryContract.ts` is edited, and if
one has to be, that is a divergence to report and resolve.

---

## 0 · Two things the schema says that the brief does not

Both found by reading migration 0020 rather than the brief.

### 0.1 The eligibility policy version is not on the decision, and must not be

The decision-save list asks for "eligibility policy version" among the columns
persisted atomically. `case_decisions` has no such column — and its absence is
**asserted by a test**: `c1d1Upgrade.pg.test.ts` lists
`case_decisions.eligibility_policy_version` among the structures that must not
exist on either migration path.

That is the C1D-1A design, approved: the eligibility basis lives on the
submission and nowhere else, so a decision reaches its policy version through
the submissions it references. Copying it onto the decision would be a second
source of truth for the audit question the submissions already answer — and it
would answer it *worse*, because a decision considering three revisions may
reference three submissions evaluated under one policy version each.

**Recommendation: no column, no change.** The policy version is persisted, on
the submissions, and a decision read reaches it by joining
`decision_submissions → cio_submissions`. If you want it denormalised anyway,
that is a migration and a reversal of a C1D-1A decision, and I would want the
reason to be a query that needs it.

### 0.2 Decision relations DO have a database backstop — unlike R6

Worth stating because it is the opposite of the submission situation.
`decision_submissions` carries two composite foreign keys (0020:418-421):

```
FOREIGN KEY (submission_id, case_id)     REFERENCES cio_submissions (id, case_id)
FOREIGN KEY (submission_id, revision_id) REFERENCES cio_submissions (id, revision_id)
```

So "the submission belongs to this case" and "the submission targets exactly the
revision this row names" are **structural**, enforced by the database, not by
the repository's good intentions. R6 does not extend to decisions.

The repository still checks them first — not for integrity but for **parity**: a
raw FK violation surfaces as `ReferentialIntegrityError`, and the in-memory
reference raises `InvariantViolationError` for a cross-case submission. Same
rejection, different class, which the shared contract would catch. §5 covers it.

---

## 1 · Files

| File                                                    | What                                                      |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `postgres/decisionRepositories.ts`                       | `DECISION_READ_SQL`, `DECISION_HYDRATE_SQL`, `DECISION_WRITE_SQL`, `SUPERSESSION_SQL`, the repository |
| `postgres/deferredConstraints.ts`                        | the frozen constraint catalogue and its forcing helper     |
| `postgres/sql.ts`                                        | the error-taxonomy correction (§6)                         |
| `postgres/postgresRepositories.ts`                       | wires the repository, deletes `notUntilB2`                 |
| `postgres/postgresSubmissionContract.pg.test.ts`         | renamed; also invokes the decision half                    |
| `postgres/c1d1Decisions.pg.test.ts`                      | PostgreSQL-only decision behaviour                         |
| `db/migrations/0021_decision_history_index.sql`          | the history index                                          |
| `postgres/c1d1Upgrade.pg.test.ts`                        | extended to 0021                                           |

---

## 2 · SQL catalogues

Frozen, named, grouped by responsibility. Nothing inline; nothing assembled at a
call site. All four registered in `CATALOGS`.

```
DECISION_WRITE_SQL     insertDecision · insertRelations · insertDissent
                       · insertDissentEvidence · insertTriggers
DECISION_READ_SQL      byId · liveForCase · historyForCase · recent
DECISION_HYDRATE_SQL   relationsFor · dissentFor · dissentEvidenceFor · triggersFor
SUPERSESSION_SQL       predecessorFor · markSuperseded
CONSTRAINT_SQL         forceDecisionConstraints · restoreDecisionConstraints
                       · verifyDeferrable
```

Child inserts are one statement per child **table**, using
`SELECT $1, * FROM unnest(…)`, never one per row — the same shape B2A used.

---

## 3 · The named deferred constraints

Read from migration 0020 with line references, not recalled. Six, and only six.

| Constraint                             | Table                                | Invariant it enforces                                                | Deferrable | Initial mode | Why `decisions.save` forces it |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- | ---------- | ------------ | ------------------------------ |
| `case_decisions_supersedes_fk` (0020:376) | `case_decisions`                  | the predecessor exists **and belongs to the same case**               | yes        | deferred     | the successor names a predecessor before the row it points from is complete |
| `case_decisions_superseded_by_fk` (0020:380) | `case_decisions`               | the successor exists and belongs to the same case                     | yes        | deferred     | the predecessor is updated to point at a successor that does not exist yet |
| `case_decisions_outcome_guard` (0020:688) | `case_decisions`                  | the outcome agrees with the relations (§4)                            | yes        | deferred     | the root is inserted before its relations                                   |
| `decision_submissions_outcome_guard` (0020:693) | `decision_submissions`      | the same rule, re-checked as relations arrive                         | yes        | deferred     | each relation row is written after the root                                 |
| `triggers_outcome_guard` (0020:698)    | `decision_reconsideration_triggers`  | a deferral records at least one condition                             | yes        | deferred     | triggers are written after the root                                         |
| `case_decisions_no_supersession_cycle` (0020:737) | `case_decisions`         | supersession forms no ring, at any depth                              | yes        | deferred     | the chain is only complete once both rows exist                             |

Note the third trigger is `triggers_outcome_guard` — **not**
`decision_reconsideration_triggers_outcome_guard`, which is what the C1D-1B plan
guessed. The catalogue is verified against `pg_constraint` (§3.2) rather than
trusted.

`SET CONSTRAINTS ALL IMMEDIATE` is not used.

### 3.1 The forcing sequence

At the end of `decisions.save`, after every row is written and before returning:

```
SET CONSTRAINTS <the six> IMMEDIATE
SET CONSTRAINTS <the six> DEFERRED
```

Two statements, both parameterless, both in `CONSTRAINT_SQL`. The restore hands
the transaction back in the mode the caller gave it, so a caller with unrelated
deferred work is unaffected.

### 3.2 Verification — the test that matters most

`SET CONSTRAINTS` on a name that does not exist raises. On a name that **exists
and is not deferrable** it succeeds and does nothing. So a constraint renamed, or
quietly made immediate, would turn the entire mechanism into a no-op that every
other test still passes.

A PostgreSQL test therefore reads `pg_constraint` and asserts, per catalogued
name: it exists · it belongs to the expected relation · `condeferrable` is true ·
`condeferred` is true. A name failing any of the four fails the suite.

### 3.3 Unrelated deferred work is not forced

A test opens a transaction, creates pending deferred work that is *not* a
decision constraint, performs a decision write, and asserts the unrelated work is
still deferred and still commits. This is the property `ALL` would have destroyed.

---

## 4 · Outcome semantics and the save sequence

The domain meaning, unchanged, enforced in three independent layers: the shared
validator before any SQL, the deferred triggers at the forcing point, and the
partial unique indexes.

| Outcome      | Relations written                                                    | Additional                        |
| ------------ | -------------------------------------------------------------------- | --------------------------------- |
| **selected** | exactly one `selected`; every other considered revision `not-selected`; no `declined` | selected revision is among considered |
| **deferred** | every considered revision `considered`; no `selected`, no `declined`  | at least one reconsideration trigger |
| **declined** | every considered revision `declined`; no `selected`                   | none unaccounted                  |

Relations come from `relationsOf(outcome)` and from nowhere else. The adapter
never computes a relation from an outcome kind — fitness rule 13 in B2C asserts
this with a planted violation.

### 4.1 `decisions.save` — a decision that supersedes nothing

Inside one `unitOfWork`:

```
1.  byId + hydration            -- replay probe; returns the stored decision if identical
2.  validateCaseDecision(...)   -- before any write; InvariantViolationError
3.  submissionCheck             -- one statement: id, case_id, revision_id, state
                                --   for every referenced submission (§5)
4.  INSERT case_decisions
5.  INSERT decision_submissions        (one multi-row statement)
6.  INSERT decision_dissent            (one)
7.  INSERT decision_dissent_evidence   (one)
8.  INSERT decision_reconsideration_triggers (one)
9.  SET CONSTRAINTS <six> IMMEDIATE
10. SET CONSTRAINTS <six> DEFERRED
11. return seal(decision)
```

Step 2 precedes every write, so an invalid aggregate reaches no statement. Step 9
is what makes an invalid *relation set* fail **from `save`** rather than from the
caller's commit — the parity property the whole named-constraint design exists
for.

A second live decision for a case is refused by
`case_decisions_one_live_per_case`, which is a plain unique index and not
deferred: it fires at insert, as `DuplicateRecordError`.

### 4.2 `decisions.save` — a correcting decision

```
1.  byId + hydration            -- replay probe
2.  validateCaseDecision(...)
3.  predecessorFor($supersedesDecisionId)
      -- reads decision_id, case_id, superseded_by_decision_id
      -- absent            -> ReferentialIntegrityError
      -- other case        -> InvariantViolationError   (parity with memory)
      -- already superseded-> ConcurrencyConflictError
4.  submissionCheck
5.  UPDATE case_decisions
       SET superseded_by_decision_id = $new
     WHERE decision_id = $old AND superseded_by_decision_id IS NULL
      -- 0 rows and the successor does not exist -> ConcurrencyConflictError
      -- 0 rows and the successor DOES exist     -> replay, already done
6.  INSERT case_decisions (the successor)
7-10. the four child inserts
11. SET CONSTRAINTS <six> IMMEDIATE
12. SET CONSTRAINTS <six> DEFERRED
```

Step 5 **precedes** step 6, which is possible only because both supersession
foreign keys are `DEFERRABLE INITIALLY DEFERRED`: the old row leaves the partial
unique index before the new one enters it, so no instant has two live decisions.
C1D-1A.1 asserts that deferrability positively, on both migration paths.

Step 5's zero-row case is the one that gets its own test in both directions.
Reading it as "someone else won" when the successor already exists turns every
retry into a `ConcurrencyConflictError`; reading it as "already done" when the
successor does not exist would silently drop a correction.

**Self-supersession** is refused by the shared validator (step 2) before any
read. **Cycles** are refused by `case_decisions_no_supersession_cycle` at the
forcing point; the supported write path cannot form one, because a successor is
always a new id, and the test asserts the guard fires on a hand-built ring.

---

## 5 · What the repository verifies about submissions

One statement, before the writes:

```sql
SELECT id, case_id, revision_id, state
FROM analysis.cio_submissions WHERE id = ANY($1)
```

Checked against the decision:

- **exists** — absent → `ReferentialIntegrityError`
- **same case** — → `InvariantViolationError` (parity, §0.2)
- **targets the exact related revision** — the revision this decision pairs it
  with must be the revision the submission is about → `InvariantViolationError`
- **structurally usable** — the submission is not in a state that makes the
  pairing incoherent

That last one needs a definition, and I want it approved rather than assumed.

**What the repository checks:** the submission exists, belongs to the case, and
targets the revision. Structural facts, all of them.

**What it does not check:** whether the submission is still `pending`. The
approved C1D-1 rule is that every submission must be `pending` **or already
referenced by the decision being superseded** — a correction legitimately reuses
the basis it is correcting. Whether a given submission qualifies is therefore a
question about *which decision is being corrected*, which is command policy
(`RecordCaseDecision`, C1D-1D), not a structural property of the row.

The brief also asks that a deferral's submissions "remain decision-ready
according to the approved lifecycle". Decision-readiness is a **gate result**,
and the standing rule is that the repository validates references and never
recalculates eligibility. I am not implementing it in the repository.

**Open question 1** below asks you to confirm both.

---

## 6 · Error taxonomy

The correction you approved, made concrete. All three of the schema's own
`RAISE`s use `ERRCODE = 'integrity_constraint_violation'` (SQLSTATE 23000), and
`mapDatabaseError` currently maps every 23000 to `ImmutableRecordError`. That is
wrong for two of the three, and the in-memory reference disagrees with it today.

The messages are distinguishable by prefix, and the prefixes are already in
migration 0020:

| Raised by                        | Message begins                                  | Maps to                    |
| -------------------------------- | ------------------------------------------------ | -------------------------- |
| `assert_decision_outcome`        | `decision_outcome:`                              | `InvariantViolationError`  |
| `assert_no_supersession_cycle`   | `supersession_cycle:`                            | `InvariantViolationError`  |
| `refuse_decision_rewrite`        | `Case decision "…" is committed and cannot be …` | `ImmutableRecordError`     |
| every other 23000 / P0001        | (unchanged)                                      | `ImmutableRecordError`     |

**The constraint field carries a bounded code, never the message.** The raised
text interpolates a decision id and a case id; passing it through as the
`constraint` would put identifiers into a field meant for schema names. The
mapping extracts `decision_outcome` or `supersession_cycle` and passes that.

No SQLSTATE, no constraint internals, no PostgreSQL `detail`, no parameters, and
no rationale reach the caller. A test asserts each.

Parity proven for: invalid `selected`, invalid `deferred`, invalid `declined`,
missing required trigger, contradictory relations, attempted rewrite of a
committed decision, attempted deletion — each raising the same class from the
same logical call in both adapters.

---

## 7 · Reads

| Method             | Semantics                                                       | SQL                                                                     |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `get`              | one decision by id, superseded or not — for command replay        | `WHERE decision_id = $1`                                                 |
| `getForCase`       | **the live decision only**                                        | `WHERE case_id = $1 AND superseded_by_decision_id IS NULL`               |
| `historyForCase`   | **every** decision, superseded included, with its links intact    | `WHERE case_id = $1 ORDER BY decided_at, decision_id COLLATE "C"`        |
| `listRecent`       | **live decisions only**, newest first                             | `WHERE tenant_id = $1 AND superseded_by_decision_id IS NULL ORDER BY decided_at DESC, decision_id COLLATE "C" DESC LIMIT $2` |

`listRecent` never returns both an original and its correction: the live
predicate is what makes "recent institutional decisions" mean current positions
rather than a changelog. The complete history is `historyForCase`, and nothing is
hidden from audit — the distinction is which question is being asked.

`supersedesDecisionId` and `supersededByDecisionId` are both projected on every
read, so a history consumer can reconstruct the chain without a second query.

Child ordering, explicit in SQL with unique tie-breakers: relations by
`revision_id COLLATE "C"`; dissent and triggers by `ordinal`; dissent evidence by
`ordinal, evidence_set_id COLLATE "C", observation_id COLLATE "C"`. Nothing
relies on insertion or planner order.

---

## 8 · Hydration and query counts

Batched: each child table read once with `WHERE decision_id = ANY($1)`, grouped
in memory. Never one query per decision, relation, dissent row, evidence ref or
trigger.

**The property is that the count does not grow with the data.** Measured at 1 and
at 25 of every child collection, and required to be identical.

| Operation                    | Count | Composition                                                      |
| ---------------------------- | ----- | ---------------------------------------------------------------- |
| `decisions.get`              | 5     | root + relations + dissent + dissent evidence + triggers          |
| `decisions.getForCase`       | 5     | same                                                              |
| `decisions.historyForCase`   | 5     | same                                                              |
| `decisions.listRecent`       | 5     | same                                                              |
| `decisions.save` (new)       | 9     | replay probe + submission check + root + 4 children + 2 constraint statements |
| `decisions.save` (superseding) | 11  | the above + predecessor read + the supersession update            |
| `decisions.save` (replay)    | 5     | replay probe only; nothing written                                |

Every hydrated aggregate passes through `decisionFromRows` and is validated;
malformed rows raise `MalformedRowError`. That mapper already refuses an unknown
outcome kind, a `selected` outcome whose relations select nothing or select
something else, and an actor claiming an authentication the runtime cannot
perform.

These counts are **pinned as properties**. If one has to change, that is a design
change and gets reported, not edited to match.

---

## 9 · Migration 0021 — the history index

Only the history index. The live-recent index stays TD-55.

| Field                | Value                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| Query                | `decisions.historyForCase`                                                      |
| Exact SQL            | `SELECT … FROM analysis.case_decisions WHERE case_id = $1 ORDER BY decided_at, decision_id COLLATE "C"` |
| Plan before          | To be captured and reported. Expected: `Seq Scan` on `case_decisions` plus a sort |
| Why existing indexes fail | `case_decisions_one_live_per_case` is partial on `superseded_by IS NULL` — it excludes exactly the superseded rows history exists to return. `case_decisions_recent_idx` leads with `tenant_id, decided_at`, so `case_id` cannot be an access predicate |
| Representative volume | ≥ 200 decisions across ≥ 50 cases, seeded and `ANALYZE`d                        |
| Definition           | `CREATE INDEX case_decisions_history_idx ON analysis.case_decisions (case_id, decided_at, decision_id COLLATE "C")` — not partial |
| Plan after           | To be captured and reported                                                      |
| Ordering             | Served by the index; the read needs no sort, and the tie-breaker keeps it deterministic |

**Asserted as a property, not as pinned planner text:** at representative volume,
`EXPLAIN (FORMAT JSON)` for `historyForCase` contains no `Seq Scan` node on
`case_decisions`; the query count stays at its §8 budget; the ordering stays
deterministic across repeated runs.

Coverage: clean migration · upgrade from 0020 (extending `c1d1Upgrade.pg.test.ts`
to 0001–0021 vs 0001–0020-then-0021) · schema fingerprint, which already compares
`pg_indexes.indexdef` and so captures column order and predicate · a test that
0021 changes no grant · **no edit to any prior migration.**

---

## 10 · Removing the placeholder

B2B deletes `notUntilB2` from `postgresRepositories.ts` — both ports are real,
so nothing is left to stand in for. The construction-time completeness guard
(`assertRepositoriesComplete`) and fitness rule 14 land in **B2C**, together with
the tree-level assertion that no equivalent placeholder exists anywhere.

Between B2B and B2C there is therefore no placeholder in the tree at all; B2C
adds the machinery that keeps one from returning.

The 25 skipped decision contract tests become active in B2B, by invoking
`describeDecisionRepositoryContract` from the PostgreSQL call site alongside the
submission half.

---

## 11 · Tests

**Shared, unchanged:** all 25 decision tests — the three outcome round-trips,
dissent with acknowledgement and evidence, trigger policy versions preserved
individually, dissent ordering across more than one entry, actor snapshot,
no fabricated Compliance, replay, conflicting replay, one live decision per case,
submission-count and validator refusals, supersession, its rollback, self- and
cross-case refusal, live vs history vs recent, immutability, transaction lifetime.

**PostgreSQL-only,** in `c1d1Decisions.pg.test.ts`: every catalogued constraint
exists, belongs to its relation, is deferrable and initially deferred · invalid
`selected`/`deferred`/`declined` each fail **from `save`** · an unrelated deferred
constraint is not forced · outcome guards map to `InvariantViolationError` ·
rewrite and delete attempts map to `ImmutableRecordError` · no SQLSTATE,
constraint name, `detail` or parameter escapes · a hand-built supersession ring
is refused · malformed child rows (inserted as owner, unreachable through the
runtime) raise `MalformedRowError` · query counts at 1 and 25 · runtime-role
permissions · pool and transaction cleanup with no leaked clients · restart
round-trip through a new adapter after the pool is closed and proven dead · the
0021 plan property · no pre-0020 shape · **no command, no LLM, no UI.**

---

## 12 · Risks

**R8 — the zero-row supersession update is ambiguous by construction.** "Already
done" and "someone else won" look identical. *Mitigation:* §4.2's disambiguation
by successor existence, tested both ways.

**R9 — a renamed or non-deferrable constraint silently disables the forcing.**
*Mitigation:* §3.2's four-way verification read from the live catalogue.

**R10 — the error-taxonomy correction is prefix-based.** A future `RAISE` whose
message does not start with a known prefix falls through to
`ImmutableRecordError`. *Mitigation:* the fall-through is the conservative
direction, and every prefix in 0020 is covered by a test. Recorded as **TD-57**:
a structured ERRCODE per rule would be better than a prefix, and is a schema
change rather than an adapter one.

**R11 — `decisions.save` at 9 statements has more moving parts than any other
port method.** *Mitigation:* the budget test fails on an unaccounted statement.

---

## 13 · Technical debt

**Opened:** TD-57 (§12, prefix-based error classification).
**Carried:** TD-55 (live-recent index, numeric trigger unchanged) · TD-56
(catalogue membership, closed in B2C) · R6 as load-bearing debt per your ruling —
documented in `submissionRepositories.ts` as a repository-only guarantee and
never described as a database constraint · TD-43, TD-50–54, TD-41–44, TD-46,
TD-34–37, TD-39, TD-8.

**Contract versions:** command stays at **2**, domain stays at **8**.

---

## 14 · Approved rulings (review, revision 2)

All three questions answered; B2B splits in two.

### 14.1 Eligibility policy version — confirmed absent from the decision

No `eligibility_policy_version` on `case_decisions`. The version belongs to each
exact submission because it describes the policy under which *that* revision was
evaluated. A decision reaches it through `decision_submissions → cio_submissions`.

Explicitly forbidden: copying one submission's version onto the decision;
requiring all considered submissions to share a version; synthesising a
decision-level version from the first submission; duplicating basis fields for
read convenience.

**Mixed policy versions are preserved honestly.** If a decision considers
submissions evaluated under different versions, the record says so. Whether that
is institutionally permitted — with explicit CIO acknowledgement, or forbidden
outright — is a command rule, and **the repository does not invent it**. Recorded
for C1D-1D. The existing schema tests asserting no decision-level column are
retained.

### 14.2 "Structurally usable" — the narrow definition, confirmed

A referenced submission is structurally usable when it exists · belongs to the
decision's case · targets the exact revision the relation names · hydrates and
passes submission validation · has no blockers in its basis · its governance
artifacts structurally belong to its case and revision · its policy version
exists · it is not malformed or partially persisted · it appears **once** in the
decision.

The repository does **not** decide: whether the revision is currently
decision-ready · whether the submission should still be pending · whether the CIO
may reuse it · whether new evidence invalidated the basis · whether a later
review requires resubmission · whether mixed policy versions may be considered
together. Those are command and workflow rules.

**Settled submissions are not rejected for being settled.** Both approved cases
are supported: a pending submission for an initial decision, and a settled one
explicitly reused by a successor. The repository verifies the relation is
structurally valid; the command authorises the reuse and checks that it was
referenced by the decision being superseded, that the revision is unchanged, that
the basis is still the approved one, and that no later fact invalidated it.

Tests separate: valid pending · valid reused settled · missing · wrong-case ·
wrong-revision · malformed · duplicate revision relation.

### 14.3 Two integrity levels, never described as one

- **Submission → review ownership is repository-enforced only (R6).** `reviews`
  is keyed on `id` alone; no foreign key can prove a cited review reviewed this
  revision. Load-bearing technical debt, documented as such, never described as
  a database constraint.
- **Decision → submission case/revision ownership is database-enforced**, by the
  two composite foreign keys on `decision_submissions`, and repository-prechecked
  for parity of error class and call boundary.

### 14.4 Zero-row supersession — the algorithm

Inside the same transaction and connection:

1. attempt the guarded update
2. one row changed → continue with the successor
3. zero rows → look up the supplied successor id
4. that exact successor exists and is semantically identical → **replay**, return it
5. a different live successor exists → `ConcurrencyConflictError`
6. neither, and the prior relation is inconsistent → the matching invariant or
   reference error

Zero rows is never read as success without proving the intended successor exists,
and never read as a conflict without proving something else won. No global case
lock; no serialisation of unrelated cases.

### 14.5 The split

**B2B-1** — catalogues, root and child inserts, relations, the three outcome
mappings, dissent and evidence, triggers, actor and authorization snapshot,
`get`, `getForCase`, `historyForCase`, `listRecent`, replay versus conflict for
non-superseding decisions, migration 0021 with its plan tests, and shared
contract activation for standard decision cases. **No supersession.**

**B2B-2** — the superseding transaction, zero-row disambiguation, named
constraint forcing, the error-mapping correction, race tests, runtime-role
completion, restart durability, the full shared decision contract, and removal of
every placeholder.

### 14.6 B2B-1 validation order

Fixed, and asserted:

1. the shared `validateCaseDecision`
2. load and structurally validate the referenced submissions
3. verify case and revision ownership
4. verify no duplicate revision relation
5. compare against an existing decision on replay
6. write the complete relational aggregate
7. force the applicable named outcome constraints *(B2B-2)*
8. return only once the aggregate is valid

**A non-superseding save modifies no other decision and no case row.**

### 14.7 B2B-1 query budgets

Independent of considered submissions, dissent, evidence refs and triggers;
measured at 1 and 25.

| Operation                        | Count | Composition                                     |
| -------------------------------- | ----- | ----------------------------------------------- |
| `decisions.save` (new, no supersession) | 7 | replay probe · submission check · root · 4 child inserts |
| `decisions.save` (replay)        | 5     | probe + 4 hydration reads; nothing written      |
| `decisions.get`                  | 5     | root + relations + dissent + evidence + triggers |
| `decisions.getForCase`           | 5     | same                                             |
| `decisions.historyForCase`       | 5     | same                                             |
| `decisions.listRecent`           | 5     | same                                             |

B2B-2 adds the predecessor read, the supersession update and two constraint
statements to the superseding path.

### 14.8 TD-57, pinned while the compromise stands

Prefix-based classification is approved as temporary and bounded. The prefixes
are schema-owned identifiers, never derived from institutional prose;
interpolated ids never escape; every prefix is covered by a mapping test; an
unknown 23000 message is **not guessed** into a domain error but falls through to
the conservative default.

**A migration fitness test pins the machine prefixes** while the compromise is
active, so a message reword that dropped one fails loudly. TD-57 does not block
B2B and must be resolved before database messages are localised or substantially
refactored.

---

## 15 · Superseded open questions

1. **§5 — what "structurally usable" means.** I propose: exists, same case,
   targets the exact revision. I propose the repository does **not** check
   `pending`-or-reused, because whether a submission may be reused depends on
   which decision is being superseded, which is `RecordCaseDecision`'s policy;
   and does **not** check decision-readiness, because that is a gate result and
   the repository never recalculates eligibility. Confirm, or tell me to pull
   either into the repository.
2. **§0.1 — the eligibility policy version.** Confirm it stays on the
   submissions, reached by join, with no column on `case_decisions`.
3. **Splitting B2B.** Nine tables' worth of write path plus supersession plus
   migration 0021 is a large single commit. I can split it as B2B-1 (persistence,
   relations, dissent, triggers, reads) and B2B-2 (supersession, constraint
   forcing, error taxonomy, 0021). I recommend the split for reviewability; say
   if you would rather have one.

Everything else I am prepared to build as written.
