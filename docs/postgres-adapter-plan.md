# Stage 2 — the PostgreSQL adapter

Planning gate. Nothing here is implemented.

The adapter implements the **already-approved** repository semantics. Where SQL
offers an easier behaviour than the in-memory reference, the reference wins:
stage 4 compares the two stores, and a divergence introduced here for
convenience is a divergence that has to be explained there.

---

## 0. What the ports actually require

39 methods, across eleven interfaces.

| Port                   | Methods | Notes                                                       |
| ---------------------- | ------- | ----------------------------------------------------------- |
| `CaseRepository`       | 4       | `get list create save` — the only optimistically-locked one |
| `ThesisRepository`     | 3       | `get listForCase save` — save may move only `lifecycle`     |
| `AssignmentRepository` | 4       | `get listForCase listForDepartment save`                    |
| `RunRepository`        | 3       | `get listForCase save`                                      |
| `ClaimRepository`      | 4       | `get listForRun listForCase save` — write-once              |
| `ReviewRepository`     | 8       | four reads, four writes, one table plus typed children      |
| `EventRepository`      | 3       | `append listForCase recent` — no update, no delete          |
| `EvidenceRepository`   | 2       | `get save` — content-addressed                              |
| `DecisionRepository`   | 3       | `getForCase list save` — write-once                         |
| `ResultStore`          | 2       | `get put` — write-once                                      |
| `IdempotencyStore`     | 2       | `get reserve`                                               |
| container              | 1       | `withTransaction`                                           |

---

## 1. Files

**Added**, all under `src/infrastructure/analysis/postgres/`:

| File                        | Contents                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| `pool.ts`                   | Pool construction, config, shutdown, type parsers                |
| `sql.ts`                    | Query execution, timing, error mapping, the timestamp projection |
| `rows.ts`                   | Row types. **Never exported from this directory**                |
| `mapping.ts`                | Row → domain, through domain builders; `seal` on the way out     |
| `transaction.ts`            | `withTransaction`, scope guard, client lifetime                  |
| `caseRepositories.ts`       | cases + theses                                                   |
| `workRepositories.ts`       | assignments + runs + claims                                      |
| `evidenceRepositories.ts`   | evidence + results + idempotency                                 |
| `governanceRepositories.ts` | reviews + decisions + events, and derived review ids             |
| `postgresRepositories.ts`   | Assembles `AnalysisRepositories`                                 |
| `*.pg.test.ts`              | PostgreSQL-specific integrity tests                              |

**Deviation from the plan, as built.** The table originally said one file per
port — eleven files, plus a separate `identity.ts`. The repositories were
grouped into four files by aggregate instead, because the ports that share
hydration also share their SQL: `runs` cannot be loaded without `claims`, and
`claims` cannot be loaded without `claim_evidence`. Splitting them would have
put `CLAIM_SQL` in one file and its only other caller in another.

The grouping is by what loads together, not by convenience, and it does not
change the port surface. The derived review id lives beside the reviews it
identifies rather than in its own module, for the same reason.

**Added elsewhere:**

| File                                                   | Contents                                     |
| ------------------------------------------------------ | -------------------------------------------- |
| `src/infrastructure/analysis/repositoryContract.ts`    | The shared parity suite (§21)                |
| `src/infrastructure/analysis/inMemoryContract.test.ts` | Runs it against in-memory                    |
| `src/application/shared/metrics.ts`                    | Extracted `Metrics` port — **decision D-S1** |
| `src/application/shared/logger.ts`                     | Extracted logger port — **decision D-S1**    |

**Modified:**

| File                                       | Change                                        |
| ------------------------------------------ | --------------------------------------------- |
| `src/application/analysis/repositories.ts` | New error types (§18) — **decision D-S14**    |
| `src/application/marketData/metrics.ts`    | Re-exports from `application/shared` — D-S1   |
| `src/test/importGraph.test.ts`             | Two rules: rows never escape; not wired (§24) |
| `docs/technical-debt.md`                   | Stage table                                   |

**Not modified:** the composition root, any route, any presentation file, the
market-data pipeline, `services/investmentLetter`, and every applied migration.

---

## 2. Connection and pool

One `pg.Pool` per process, built by `createPostgresRepositories(config)`. The
connection string comes from the environment, is never logged, and never
appears in an error (§18).

```
max                     10      one pool, small workload, 100 server connections
idleTimeoutMillis       30_000
connectionTimeoutMillis 5_000   fail fast rather than queue behind a dead server
statement_timeout       15_000  server-side; a runaway query cannot pin a client
application_name        finos-analysis
```

`statement_timeout` is set as a connection parameter rather than per query, so
it cannot be forgotten at a call site.

**Type parsers are overridden at construction**, not globally, so the market
data code is unaffected:

- `int8` (OID 20) → `BigInt`-safe parse to `number`, throwing above
  `MAX_SAFE_INTEGER`. `cost_minor_units` is the only `bigint`, and silently
  losing precision on money is not acceptable.
- `timestamptz` is **not** parsed at all — see §5.3.

`close()` drains the pool. There is no global singleton: the pool is owned by
whatever constructs it, which keeps tests independent.

---

## 3. Transactions

```ts
async withTransaction(operation) {
  const client = await pool.connect()
  const scope: Scope = { open: true, client }
  try {
    await client.query('BEGIN')
    const result = await operation(repositoriesFor(scope))
    await client.query('COMMIT')      // may throw — see below
    scope.open = false
    scope.client = null
    return result
  } catch (error) {
    scope.open = false
    scope.client = null
    await rollbackQuietly(client)
    throw mapError(error)
  } finally {
    client.release()
  }
}
```

Point by point against the Stage 0 contract:

- **One transaction across all repositories** — every scoped repository closes
  over the same `Scope`, and therefore the same client.
- **Callback failure rolls everything back** — the `catch` rolls back before
  rethrowing.
- **Commit failure propagates** — `COMMIT` is inside the `try`, so a failure
  there takes the same path as any other.
- **No success before commit** — the callback's value is returned only after
  `COMMIT` resolves. This is the ordering the code above exists to make
  obvious.
- **No nested transactions** — the callback receives
  `TransactionalAnalysisRepositories`, which omits `withTransaction`. Unchanged
  from Stage 0; a compile error, not a runtime one.

### 3.1 Transaction lifetime

**Decision D-S8: the guard is application-level and checked before the client
is touched.**

Every scoped method begins with `guard(scope, 'cases.get')`, exactly as the
in-memory adapter does. Relying on `pg` to throw after `release()` is not
acceptable for three reasons: the message is a driver detail rather than a
domain error; the client may have been handed to another caller by then, so the
query could execute against **someone else's transaction**; and the failure
would be timing-dependent rather than deterministic.

Two mechanisms, in order:

1. `scope.open === false` → `TransactionClosedError(operation)`, thrown
   synchronously before any I/O.
2. `scope.client === null` → the same error. Belt and braces: even if a future
   edit forgets the flag, there is no client to query.

**Scope leaking through a returned object or closure** is covered by the same
guard — a repository captured inside the callback and called afterwards hits
case 1. The parity suite tests this against both adapters (§21), and Stage 0's
`@ts-expect-error` test already proves nesting does not compile.

### 3.2 Non-transactional reads

Reads outside `withTransaction` use `pool.query` directly — one statement, one
implicit transaction. Convenient and correct; a multi-statement read that needs
a consistent snapshot must use `withTransaction`, and the headquarters snapshot
(§17) does.

---

## 4. Isolation level

**Decision D-S2: `READ COMMITTED`, the PostgreSQL default, chosen rather than
inherited.** Two of the six scenarios actively argue _against_ stronger levels.

### Evaluated against each scenario

**Optimistic case-version updates.** `UPDATE cases SET … WHERE id = $1 AND
version = $2`. Under `READ COMMITTED`, a second concurrent update blocks on the
row lock, then **re-evaluates its `WHERE` against the newly committed row** —
the version no longer matches, zero rows update, and the adapter raises
`ConcurrencyConflictError`. That is precisely the behaviour the port specifies.

Under `REPEATABLE READ` the same statement raises `40001 could not serialize
access` instead. The lost update is still prevented, but the caller now sees a
retryable database error where the domain has a clean, meaningful conflict —
worse diagnostics and a retry loop instead of a re-read. **Stronger isolation
makes this case worse, not better.**

**Concurrent department completions.** Runs, run events, claims and transition
events are inserts into distinct rows. No read-modify-write, no conflict at any
level.

**Idempotent command retries — the decisive case.** The pattern is
`INSERT … ON CONFLICT DO NOTHING`, then `SELECT` the existing row. Two
concurrent retries: the loser's `INSERT` blocks on the unique index until the
winner commits, then inserts nothing.

Under `READ COMMITTED` each statement takes a fresh snapshot, so the following
`SELECT` sees the winner's committed row and the replay returns the original
result. Under `REPEATABLE READ` the snapshot is fixed at transaction start, so
that `SELECT` **finds nothing** — the transaction has proof the row exists
(the insert conflicted) and cannot read it. The adapter would have to raise on
a case that is supposed to succeed.

`ON CONFLICT DO UPDATE … RETURNING` would sidestep this, and is **not
available**: migration 0009 grants `finos_app` `INSERT` and no `UPDATE` on
`idempotency_keys`, so it would be denied. The grant and the isolation level
have to agree, and they agree on `READ COMMITTED`.

**Duplicate assignment creation.** Prevented by
`assignments_case_playbook_entry_unique`, same pattern as above.

**CaseDecision creation.** `case_decisions.case_id` is the primary key, plus
the immutability trigger. A second decision fails on the key regardless of
isolation.

**Transition-event ordering.** Events are ordered by `(occurred_at, event_id)`,
both supplied by the domain through the `Clock`. Ordering is therefore
independent of commit visibility, which is why the activity feed is stable even
when two transactions commit out of order. No isolation dependency at all.

### Targeted locking instead of a raised level

**Decision D-S3: state transitions use a conditional `WHERE`, not a row lock.**

`assignments` and `runs` have no version column, so two concurrent status
updates could lose one. Rather than `SELECT … FOR UPDATE` (a round trip and a
held lock) or raising isolation globally, status writes carry the expected
current state:

```sql
UPDATE analysis.assignments SET status = $2, … WHERE id = $1 AND status = $3
```

Zero rows means somebody else moved it. This is the same optimistic pattern as
`cases`, expressed against the state machine instead of a counter, and it
matches the domain, where `canTransitionRun` already says which moves are legal.

If a future command genuinely needs a read-then-write on one case, it takes
`SELECT … FROM cases WHERE id = $1 FOR UPDATE` inside its own transaction — one
row, one command, rather than a global level change. **No global lock, at any
point.**

`SERIALIZABLE` is rejected: it buys protection against write skew that this
workload does not exhibit, at the cost of serialization failures on every
command and a retry policy for all of them.

---

## 5. Domain-row mapping

**Row types live in `rows.ts` and never leave the directory.** A fitness rule
asserts no file outside `infrastructure/analysis/postgres/` imports it.

### 5.1 Everything goes through the domain builders

`buildAssignment`, `buildThesis`, `buildClaim`, `buildRunRecord`,
`buildChallenge`, `buildTransitionEvent`, `buildDecision` — a row from the
database is validated exactly like a row from anywhere else. A database that
has been edited by hand, restored from an old backup, or written by an earlier
version of this code is precisely when validation matters most.

Where a builder does not exist (`InvestmentCase`, the four review types), the
mapper validates the discriminants explicitly and raises `MalformedRowError`.

### 5.2 Reseal on the way out

`jsonb` arrives from `pg` as freshly allocated **mutable** objects, and the
constraint from the Stage 0 follow-up is that no mutable structure reaches
application code. Every mapper ends with `seal(value, label)` — the same
function the in-memory adapter uses, so both stores return deeply frozen
aggregates and the parity suite can assert immutability identically.

### 5.3 Timestamps

**Decision D-S12: timestamps are projected as text, in UTC, to millisecond
precision.**

The domain stores ISO-8601 strings. `timestamptz` holds microseconds, and the
`pg` driver parses it into a JS `Date`, which holds milliseconds — a lossy
round trip, and one that silently changes the string the domain wrote.

Every read projects explicitly:

```sql
to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS opened_at
```

Verbose, and worth it: the string returned is byte-identical to the string
written, ordering still uses the indexed `timestamptz`, and a parity test
asserts exact round-trip equality against the in-memory store. A shared SQL
helper generates the fragment so no column is projected by hand.

Writes pass the ISO string directly; PostgreSQL parses it with the offset.

### 5.4 Surrogate ids the domain does not carry

**Decision D-S16: derived deterministically, never generated.**

`reviews.id` and `verification_findings.id` exist in the schema but not in the
domain — a `VerificationReview` has no id. A random `uuid` would break
idempotency: a retry would produce a new id and only fail at the natural-key
index, leaving the intent unclear.

- `reviews.id` = `stableHashHex(reviewIdentity(kind, review))` — the same
  natural key the unique index uses, so a retry computes the same id.
- `verification_findings.id` = `${reviewId}#${ordinal}` — stable within a
  review, and the ordinal preserves the order the verifier reported findings in.
- `challenges.id` comes from the domain (`Challenge.id`) and is used as-is.

### 5.5 Aggregate hydration

Several aggregates span tables. Every one is loaded in a **fixed** number of
queries using `= ANY($1::text[])`, never a per-row loop.

| Aggregate              | Composed from                                                        | Queries |
| ---------------------- | -------------------------------------------------------------------- | ------- |
| `InvestmentCase`       | `cases`, `case_participants`, `transition_events` (`subject='case'`) | 3       |
| `AgentRunRecord`       | `runs`, `run_events`, `claims`, `claim_evidence`                     | 4       |
| `AgentClaim`           | `claims`, `claim_evidence`                                           | 2       |
| `EvidenceSet`          | `evidence_sets`, `evidence_items`                                    | 2       |
| `VerificationReview`   | `reviews`, `verification_findings`                                   | 2       |
| `DevilsAdvocateReview` | `reviews`, `challenges`, `challenge_evidence`                        | 3       |
| `CaseDecision`         | `case_decisions`, `decision_revisions`                               | 2       |

`InvestmentCase.transitions` is **projected from `transition_events`**, as
decided in migration 0003: storing the movement history twice would create two
records that can disagree, and the events table is the one with append-only
permissions behind it.

### 5.6 Evidence sets verify themselves

**Decision D-S10.** `EvidenceSet.id` is a content hash. On read the adapter
hydrates the items, calls `buildEvidenceSet`, and **asserts the recomputed id
equals the stored id**, raising `MalformedRowError` on mismatch.

That turns every read into an integrity check on the one record whose whole
purpose is "this is exactly what the agent reasoned over". The stored
`co_temporality` and `disagreements` columns become derived caches for snapshot
queries that do not hydrate items; they are documented as derived, and the
recomputed values are authoritative.

---

## 6. JSONB

Ten columns. For each: why, mutability, indexing, evolution, rejection.

| Column                                                           | Why JSONB                                        | Immutable | Index |
| ---------------------------------------------------------------- | ------------------------------------------------ | --------- | ----- |
| `evidence_sets.co_temporality`                                   | Three-arm union, read whole                      | yes       | no    |
| `evidence_sets.disagreements`                                    | Variable-length list, read whole                 | yes       | no    |
| `evidence_items.value`                                           | Shape differs per observation kind               | yes       | no    |
| `evidence_items.provenance`                                      | Large fixed record, never filtered on            | yes       | no    |
| `claims.confidence_basis`                                        | Ordered prose list, displayed not queried        | yes       | no    |
| `claims.causal_attribution`                                      | Three-arm union with different fields per arm    | yes       | no    |
| `runs.model_parameters`                                          | Open provider-specific bag                       | yes       | no    |
| `reviews.detail`                                                 | Kind-specific scalars with no cross-kind meaning | yes       | no    |
| `case_decisions.governance`                                      | Snapshot, read whole                             | yes       | no    |
| `case_decisions.unresolved_dissent` / `reconsideration_triggers` | Prose lists                                      | yes       | no    |

**Every one is immutable and read whole.** None is indexed, because none is
filtered or ordered on — and if one ever needs to be, that is the signal it
should have been a column.

**Nothing relational is inside JSONB.** Foreign keys, uniqueness, filtering,
ordering, revision linkage, ownership, tenancy, governance scope and decision
references are all first-class columns. `claims.confidence_level` is a column
_and_ `confidence_basis` is JSONB precisely because the level is queried and the
prose is not.

**Rejection.** `jsonb_typeof` CHECKs already reject wrong shapes at the top
level (array vs object). Deeper validation happens in the mapper through the
domain builders — a malformed `causal_attribution` fails `buildClaim`, which is
the same code path a malformed in-memory value would fail.

**Evolution.** Each JSONB payload is versioned by the record that owns it: a
run carries `output_schema_version`, a result carries its full `inputs`. A
shape change bumps that version rather than migrating rows, because the old
rows describe what was actually produced at the time and rewriting them would
be falsifying the record.

---

## 7. Deterministic ordering

Every list method emits an explicit `ORDER BY` matching the port contract, with
the tie-breaker the port names. The Stage 1 index tests already assert the
indexes match these orders.

| Method                          | `ORDER BY`                                      |
| ------------------------------- | ----------------------------------------------- |
| `cases.list`                    | `opened_at DESC, id`                            |
| `theses.listForCase`            | `thesis_id, revision_number`                    |
| `assignments.listForCase`       | `priority DESC, created_at, id`                 |
| `assignments.listForDepartment` | `priority DESC, created_at, id`                 |
| `runs.listForCase`              | `started_at, id`                                |
| `claims.listForRun` / `ForCase` | `id`                                            |
| `reviews.*ForCase`              | `at, by_employee_id, coalesce(revision_id, '')` |
| `events.listForCase`            | `occurred_at, event_id`                         |
| `events.recent`                 | `occurred_at DESC, event_id DESC`               |
| `decisions.list`                | `decided_at DESC, case_id`                      |

`coalesce(revision_id, '')` matches the in-memory tie-break, where a case-wide
review sorts as the empty string and therefore first among ties.

**Collation.** The in-memory adapter sorts with `localeCompare`; PostgreSQL
sorts with the database collation, and the test cluster is
`Swedish_Sweden.1252`. These disagree on non-ASCII — `å` sorts after `z` in
Swedish and between `a` and `b` in many others. **Decision D-S17: every
ordering column that is an identifier uses `COLLATE "C"`** (byte order), and
the in-memory adapter's comparator changes to a plain `<`/`>` comparison to
match. Ids are kebab-case ASCII, so this changes nothing observable today and
removes an entire class of environment-dependent divergence before stage 4 has
to diagnose it. Parity tests include non-ASCII ids to hold it.

---

## 8. Optimistic concurrency

```sql
UPDATE analysis.cases
   SET stage = $2, version = $3, closed_at = $4
 WHERE id = $1 AND version = $5
RETURNING version
```

Zero rows → read the current version in the same transaction → raise
`ConcurrencyConflictError(caseId, expected, actual)`. The extra read is what
makes the error say what actually happened; it costs one statement on a path
that is already failing.

Only the three granted columns are written (§19), so the statement cannot be
denied and cannot rewrite the question, owner or subject.

Tests, all as `finos_app`: two readers at the same version; the first update
succeeds; the second fails with `ConcurrencyConflictError`; a reload-and-retry
succeeds; concurrent appends to _different_ cases and to append-only tables run
without blocking each other; and a final assertion that the first writer's
state survives — no lost update.

---

## 9. Idempotency

**The key and its effect commit in the same transaction**, which the port
already requires and `withTransaction` already provides.

`reserve` is:

```sql
INSERT INTO analysis.idempotency_keys (key, command_type, result_ref, created_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (key) DO NOTHING
RETURNING key, command_type, result_ref, created_at
```

No rows returned → the key is held → `SELECT` it and return the original. This
is the pattern §4 shows requires `READ COMMITTED`.

**Decision D-S4: the result is stored by reference, not materialized.**
`result_ref` holds the id of what the command produced; a replay re-reads that
record. Storing a copy of the payload would create a second version of an
institutional record that can drift from the first, and the extra read on
replay is cheap. It also means an idempotency row cannot describe something
that does not exist — the row and the effect commit together, so a key without
its effect is not reachable.

Retention deletes **only** `idempotency_keys` rows, never the effect. It is the
one table anything may delete from.

Concurrency test: two simultaneous `withTransaction` calls reserving the same
key, both completing; exactly one row exists; both callers receive the same
`result_ref`; and exactly one effect row exists.

---

## 10–15. Write-once, immutable, scoped

| Record              | Statement                                                        |
| ------------------- | ---------------------------------------------------------------- |
| Claims              | `INSERT … ON CONFLICT (id) DO NOTHING`, then select and compare  |
| Evidence sets/items | `INSERT … ON CONFLICT DO NOTHING` — the id _is_ the content hash |
| Agent results       | `INSERT … ON CONFLICT (key) DO NOTHING`, then compare            |
| Transition events   | `INSERT … ON CONFLICT (event_id) DO NOTHING`                     |
| Thesis revisions    | `INSERT … ON CONFLICT (revision_id) DO UPDATE SET lifecycle = …` |
| Case decisions      | `INSERT … ON CONFLICT (case_id) DO NOTHING`, then compare        |
| Reviews             | `INSERT … ON CONFLICT DO NOTHING RETURNING id`; children skipped |

**Decision D-S18: a conflicting duplicate fails loudly.**

`ON CONFLICT DO NOTHING` alone would make "already stored, identical" and
"already stored, different" indistinguishable. For claims, results and
decisions the adapter re-reads the existing row and compares semantic identity
— for content-addressed records, the hash; for a claim, the full mapped value.
Identical → return the existing record, matching the in-memory adapter.
Different → `ConflictingRecordError`, because the same key holding different
content means something upstream is wrong and silence would hide it.

For **evidence sets** the id is the hash of the contents, so equality of id is
equality of content by construction, and the recomputation in §5.6 is what
verifies that claim rather than assuming it.

Thesis revisions are the one legitimate `DO UPDATE`, restricted to `lifecycle`
— which is also the only column granted (§19), so the statement is bounded by
permission as well as by intent.

**Reviews (§12).** Insert with `ON CONFLICT DO NOTHING RETURNING id`. If no id
comes back, the review already exists and the child rows are **not** inserted —
mirroring the in-memory adapter, which skips the whole submission on a natural
key collision. The scope columns come from the domain union: `scope = 'case'`
writes `NULL` for both `thesis_id` and `revision_id`, and the CHECK constraints
from 0011 reject anything else.

**Events (§13).** `EventRepository` exposes `append`, `listForCase` and
`recent`. There is no update method and no delete method to expose — the port
does not have them, the adapter will not add them, and `finos_app` holds no
grant for either. Three independent barriers.

**Decisions (§15).** `selected_revision_id` is a foreign key to
`thesis_revisions`, and `decision_revisions` records every revision that was in
play with its relation. Both written in the same transaction.

---

## 16. Organization and playbooks

Read-only for the runtime (0009 grants `SELECT` only on the organization).

The organization graph is ~60 rows across five tables and changes only by
migration, so it is loaded once and **cached per process** behind an explicit
`OrganizationReader`, with the cache keyed on
`organization_seed_versions.checksum`. A changed checksum means a migration
changed the firm, and the cache reloads. No `AnalysisRepositories` port exists
for it today, so this is additive and does not alter the approved surface.

Playbooks are `SELECT, INSERT` — the runtime may register the version it is
compiled with, append-only, and can never change one a case has pinned.

---

## 17. The Headquarters snapshot read model

The floor is intended to become one of the most important screens in the
product, so its loading is **designed once, here**, rather than accumulating a
query per panel over the following year. That accumulation is the normal
failure: every addition is individually reasonable, and the total is forty
queries nobody chose.

The rule that keeps it designed: **the snapshot is a fixed set of queries whose
count does not depend on how much data exists.** Adding a panel means either
reusing what is already loaded or amending this section — never adding a query
inside a loop.

### The nine reads

All inside **one** `withTransaction`, so they share a snapshot. A workload count
that disagrees with the case list beside it is a bug that appears only under
load, which is the worst kind to find.

| #   | Read                 | Shape                                                       | Rows  |
| --- | -------------------- | ----------------------------------------------------------- | ----- |
| 0   | Organization graph   | **cached**, five tables, reloaded on seed-checksum change   | ~60   |
| 1   | Active cases         | `WHERE stage NOT IN ('published','withdrawn')` + `ORDER BY` | ≤ 60  |
| 2   | Case participants    | `WHERE case_id = ANY($1)`                                   | ≤ 200 |
| 3   | Thesis revisions     | `WHERE case_id = ANY($1)`                                   | ≤ 200 |
| 4   | Open assignments     | `WHERE status = ANY(open) ` + department grouping           | ≤ 300 |
| 5   | Department workloads | `GROUP BY department_id, status` over the same predicate    | ~45   |
| 6   | Governance reviews   | `WHERE case_id = ANY($1)`, all four kinds, one table        | ≤ 200 |
| 7   | Recent activity      | `ORDER BY occurred_at DESC, event_id DESC LIMIT n`          | n     |
| 8   | Recent decisions     | `ORDER BY decided_at DESC, case_id LIMIT n`                 | n     |

Reads 2, 3 and 6 take their id array from read 1. That is the whole batching
strategy: **one query for the parents, one `= ANY($1::text[])` query per child
collection, assembled in memory.** Three round trips for the case bodies rather
than 1 + 3n.

Read 5 is a separate aggregate rather than a count over read 4, because the
workload tiles include departments with no open work, and those departments do
not appear in a list of assignments. Deriving zero from absence is how a
department silently disappears from the floor.

### Why `= ANY`, and not `JOIN`

The children are **collections**, not attributes. A join would return the
Cartesian product — a case with 4 participants, 3 revisions and 5 reviews comes
back 60 times, and every scalar case column is repeated 60 times over the wire.
At 60 active cases that is tens of thousands of duplicated rows to reassemble
into 60 objects.

Joins are used where the relationship is **to-one and small**: a review's
`by_department_id` resolves against the cached organization in memory, not
through a join at all.

So: `JOIN` for to-one, `= ANY` for to-many, never a query inside a loop.

### N+1, and how it is structurally impossible

Not "avoided by review" — the shape does not admit it. Every child read takes an
**array** parameter and is issued exactly once. There is no code path where a
loop body performs a query, because the assembly functions take
`(parents, children[])` and index the children by parent id in memory.

The parity suite asserts the count directly: a snapshot over 1 case and a
snapshot over 40 cases issue the **same number of statements**. A future change
that reintroduces a per-case query fails that test rather than a load test six
months later.

### Caching

Only the organization graph, and only because it is the one thing that cannot
change without a migration. Cached per process, keyed on
`organization_seed_versions.checksum`; a changed checksum means a migration
changed the firm and the cache reloads.

Nothing else is cached. Case state, workloads and activity are what the floor
exists to show, and a cached workload is a workload that is wrong — the failure
mode being a department that looks idle while work sits in its queue. If
snapshot latency ever becomes a problem the answer is an index or a materialized
view with an explicit refresh, both of which are visible decisions; a TTL cache
on live organizational state is not.

### Complexity and performance assumptions

Queries: **8 + 0 cached**, constant in the number of cases. Not O(cases), not
O(departments).

Rows transferred: bounded by the active-case count, itself bounded by how much
work a firm has in flight — the storage plan's workload analysis puts a busy
year at ~400 cases total, so ≤ 60 active is generous.

Every read uses an index created in Stage 1: `cases_active_idx` (partial, so it
covers only the rows the floor asks for), `assignments_department_status_idx`,
`thesis_revisions_case_idx`, `reviews_case_idx`,
`transition_events_recent_idx`, `case_decisions_decided_at_idx`.

At this volume every one of these is a small index scan. The realistic budget is
**under 50 ms warm**, dominated by round-trip latency rather than by PostgreSQL,
which is why the count of queries matters far more than the cost of any one of
them. The existing snapshot deadline (TD-1) applies unchanged.

`Cases eligible for CIO review` is **not** one of the reads. It is
`evaluateRevisionEligibility` over reads 3 and 6 — domain logic, computed in the
application layer. Pushing it into SQL would put the governance rules in two
places, and Stage 1.5 exists precisely because one of those places got it wrong.

---

## 18. Error mapping

`sql.ts` maps SQLSTATE to a typed error. **Decision D-S14: the error types live
on the port**, in `application/analysis/repositories.ts`, so the in-memory
adapter throws the same ones and the parity suite can assert on them.

| SQLSTATE        | Condition                     | Mapped to                               |
| --------------- | ----------------------------- | --------------------------------------- |
| —               | zero rows on versioned update | `ConcurrencyConflictError`              |
| `23505`         | unique violation              | `DuplicateRecordError(constraint)`      |
| `23503`         | foreign key violation         | `ReferentialIntegrityError(constraint)` |
| `23514`         | check violation               | `InvariantViolationError(constraint)`   |
| `23502`/`23xxx` | other integrity               | `InvariantViolationError`               |
| `P0001`         | our `RAISE` (immutability)    | `ImmutableRecordError`                  |
| `40001`         | serialization failure         | `RetryableDatabaseError`                |
| `40P01`         | deadlock                      | `RetryableDatabaseError`                |
| `42501`         | permission denied             | `PermissionDeniedError`                 |
| `57014`         | statement timeout             | `DatabaseTimeoutError`                  |
| `08xxx`         | connection failure            | `DatabaseUnavailableError`              |
| —               | mapping/validation failure    | `MalformedRowError`                     |
| —               | anything else                 | `DatabaseError` (category only)         |
| —               | scope closed                  | `TransactionClosedError`                |

**What errors carry:** the operation name (`cases.save`), the constraint name,
the SQLSTATE, and the correlation id when one is in scope.

**What they never carry:** SQL text, query parameters, `error.detail` — which
PostgreSQL populates with the offending key _values_ — connection strings, or
any claim, thesis, rationale or evidence content. `detail` is dropped
explicitly rather than by omission, and a test asserts that a violation
involving a recognisable case id does not reproduce it in the message.

---

## 19. Runtime-role permissions

**Every write statement is written against the column grants**, because
`finos_app` holds column-level `UPDATE` only:

| Table              | Writable columns                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `cases`            | `stage, version, closed_at`                                                                              |
| `thesis_revisions` | `lifecycle`                                                                                              |
| `assignments`      | `status, assignee_employee_id, priority, started_at, completed_at, waiting_*, returned_reason`           |
| `challenges`       | `outcome`                                                                                                |
| `runs`             | `state, obsolete, completed_at, failure_reason, input_tokens, output_tokens, cost_minor_units, currency` |

A blanket `ON CONFLICT DO UPDATE SET` over all columns would be **denied** on
every one of these. Each upsert names only its granted columns. This is exactly
why the tests run as the runtime role: an owner-level test would pass on
statements production cannot execute.

**Decision D-S19: the adapter integration suite connects as `finos_app`.** The
owner is used only to create the database, run migrations, and clean up. Where
a test needs to set up a fixture the runtime cannot write — an organization row,
for instance — it does so as owner and says so in a comment.

---

## 20–21. Testing

### The shared contract suite

`repositoryContract.ts` exports
`describeRepositoryContract(name, createRepositories, options)`. Two callers:

- `inMemoryContract.test.ts` (unit config, jsdom)
- `postgresContract.pg.test.ts` (postgres config, node)

One body of behavioural tests, so the two implementations cannot drift
semantically. Coverage: create/get/list; ordering for all ten listings;
deep immutability on reads; commit; rollback; transaction lifetime; optimistic
concurrency; idempotency; revision lineage; revision-scoped reviews;
append-only events; write-once claims and results; exact-revision decisions;
empty-result behaviour (`[]`, never `null`); not-found behaviour (`null`, never
a throw).

`options` carries the few legitimate differences — a PostgreSQL run needs a
seeded organization for its foreign keys, where the in-memory store needs
nothing. Behavioural assertions are never conditional on the adapter; if a test
has to branch on which store it is running against, that is a divergence and it
gets resolved rather than accommodated.

### PostgreSQL-specific tests

In addition, not instead: constraint violations, permission denials, error
mapping by SQLSTATE, `to_char` timestamp round-trip fidelity, connection loss
during a transaction, `statement_timeout`, pool exhaustion, and concurrent
idempotent reserves from two real connections.

---

## 22. Query counts and performance

| Operation                 | Statements                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Open a case               | **6** — reserve key, insert case, participants, assignments, events, commit        |
| Load a case (`cases.get`) | **3** — case, participants, transitions                                            |
| `cases.list` (n cases)    | **3**, batched with `= ANY` — never 1 + 2n                                         |
| Load a run                | **4**                                                                              |
| Record a contribution     | **7** — run, run events, claims, claim evidence, result, events, assignment status |
| Record a review           | **3–4** — review, findings or challenges, evidence, event                          |
| Headquarters snapshot     | **7** (organization cached)                                                        |

**Batching is mandatory** wherever a list method hydrates children: a naive
`listForCase` that loads claims per run is 1 + n, and at 400 cases a year that
is survivable and still wrong — it is the shape that stops being survivable
without anyone noticing. N+1 is acceptable **nowhere** in this adapter; there
is no method where the child set is unbounded but the parent set is one row.

Indexes each major read uses are the ones Stage 1 created and tested; §7 lists
the mapping.

**No ORM.** Plain parameterized SQL, hand-written per repository. The schema is
33 tables that change rarely, the queries are simple, and an ORM would add a
larger dependency than the thing it manages while making the generated SQL —
and therefore the query count — something to be discovered rather than read.

---

## 23. Observability

Through the existing recorder and its bounded registry, with the metric names
already approved in the storage plan §16: `analysis.db.transaction`,
`.transaction.latency_ms`, `.rollback`, `.deadlock`, `.conflict`, `.retry`,
`.query.latency_ms`, `.pool.size/.idle/.waiting`, `.pool.acquire_wait_ms`.

**Decision D-S1 — the ports must move first.** `Metrics` currently lives in
`application/marketData/metrics.ts`, its `MetricName` is a closed union of
`marketdata.*` names, and its label allowlist has no `operation` key. `Logger`
lives in `providerRegistry.ts` and is shaped around `resolution(entry)`, which
is meaningless here. `application/analysis` importing either would be a
layering violation — analysis depending on market data.

Proposed: extract the `Metrics` interface, `MetricLabels`, the allowlist and
`validateLabel` to `application/shared/metrics.ts`; add `operation` to the
allowlist; make `MetricName` a union of per-context name constants so
`marketdata.*` and `analysis.db.*` both typecheck. Extract a minimal
`Logger { warn, info, error }` to `application/shared/logger.ts`, leaving the
market-data `resolution()` logger extending it. `marketData/metrics.ts`
re-exports, so no market-data call site changes.

**Cardinality.** `operation` is a bounded enum of the 39 port method names.
`outcome`, `reason` and `category` are enums. **No id, hash, correlation id,
case id or SQL text is ever a label** — the existing `validateLabel` already
rejects hash- and timestamp-shaped values, and the registry caps at 2000 series.

**Slow queries** log operation, duration and correlation id above 200 ms.
Never parameters, never SQL containing values, never claims, thesis text,
rationale or evidence.

---

## 24. Not wired in

Stage 2 adds no composition-root wiring, no dual write, no read switch, and
removes nothing. `createInMemoryRepositories` remains the only adapter any
runtime code constructs.

Enforced, not just intended: a fitness rule asserting that no file outside
`infrastructure/analysis/postgres/` and the test tree imports
`postgresRepositories`, alongside the existing rules that keep `pg` out of every
layer above infrastructure and out of routes and presentation entirely.

Out of scope and untouched: the LLM (none exists), the Agents UI, market-data
behaviour, and `services/investmentLetter`.

---

## 25. Storage provenance — D-S20

An analysis is currently traceable to its evidence, prompt, model, output schema
and agent contract. It is **not** traceable to the code that read and wrote it.
Years later, "why does this decision cite an evidence set that looks wrong"
divides into two questions — was the analysis wrong, or was the storage layer
wrong at the time — and today only the first is answerable.

### The four coordinates

| Coordinate                         | Answers                           | Source                                             |
| ---------------------------------- | --------------------------------- | -------------------------------------------------- |
| `adapterId` + `adapterVersion`     | Which repository implementation?  | A constant per adapter, bumped on behaviour change |
| `queryCatalogHash`                 | Which SQL produced this?          | Hash over every statement the adapter can issue    |
| `schemaVersion` + `schemaChecksum` | Which migration state existed?    | `analysis.schema_migrations`, highest version      |
| `domainContractVersion`            | Which domain contract was active? | A constant in `domain/analysis`                    |

```ts
export interface StorageProvenance {
  adapterId: 'in-memory' | 'postgres'
  adapterVersion: string
  /** Null for the in-memory adapter, which issues no SQL. */
  queryCatalogHash: string | null
  schemaVersion: string | null
  schemaChecksum: string | null
  domainContractVersion: string
}
```

### The structural part, done now

`queryCatalogHash` is the coordinate that is cheap today and expensive later.
It is computable only if every statement lives in one enumerable place, so
**Stage 2 puts the SQL in frozen per-repository catalogues**:

```ts
const CASE_SQL = Object.freeze({ get: `SELECT …`, list: `SELECT …`, … })
```

The hash is `stableHashHex` over the sorted catalogue. Retrofitting this once
statements are inlined at forty call sites is a mechanical refactor of the whole
adapter; deciding it now costs nothing. This is the reason D-S20 is not simply
deferred wholesale.

A caveat worth stating: the hash covers the SQL, not the mapping code around it.
`adapterVersion` covers that, and is a hand-maintained constant — which means it
is only as honest as the discipline of bumping it. A fitness test asserting it
changes whenever the adapter directory changes would be noise; the register in
`docs/technical-debt.md` records the obligation instead.

### What Stage 2 implements

`AnalysisRepositories.provenance(): Promise<StorageProvenance>`, on both
adapters. Additive to the port, no schema change, no migration. The in-memory
adapter reports `queryCatalogHash: null` and no schema version — truthfully,
since it has neither.

### What Stage 2 does not implement

**Recording provenance alongside results.** That means columns on
`agent_results` and `runs`, a migration, and a domain change to
`AgentRunRecord` — and it only becomes meaningful when a real agent writes a
real result, which is Phase C. Doing it now would add columns that nothing
populates, which the schema principles rule out.

The design is fixed here so the later stage is an addition rather than a
redesign: a `storage_provenance` table keyed on the hash of the four
coordinates, with `runs` and `agent_results` carrying a foreign key to it. That
keeps the repeated coordinates out of every result row while making the join
exact. Recorded as **TD-24**.

---

## Decisions requiring approval

| #     | Decision                                                                      |
| ----- | ----------------------------------------------------------------------------- |
| D-S1  | Extract `Metrics` and `Logger` to `application/shared`; add `operation` label |
| D-S2  | `READ COMMITTED`, with the idempotency and conflict arguments above           |
| D-S3  | Conditional-`WHERE` state transitions for assignments and runs, not row locks |
| D-S4  | Idempotent results stored by reference, re-read on replay                     |
| D-S5  | `withTransaction` never auto-retries; ambiguous commit is surfaced, not rerun |
| D-S8  | Application-level transaction-lifetime guard, checked before any I/O          |
| D-S10 | Evidence-set ids recomputed and verified on every read                        |
| D-S12 | Timestamps projected as UTC text to millisecond precision                     |
| D-S14 | New error types added to the approved port file                               |
| D-S16 | Review and finding ids derived deterministically from the natural key         |
| D-S17 | `COLLATE "C"` on ordering columns; in-memory comparator changed to match      |
| D-S18 | Conflicting duplicates fail loudly rather than returning the existing record  |
| D-S19 | Adapter integration tests connect as `finos_app`                              |
| D-S20 | Storage provenance: four coordinates, SQL catalogues now, recording deferred  |

### D-S5 — the ambiguous commit, stated explicitly

If the connection drops after `COMMIT` is sent and before its outcome is known,
the transaction may or may not have committed. **The adapter does not retry.**
It raises `AmbiguousCommitError`, distinct from `RetryableDatabaseError`.

Retrying is safe only for a command carrying an idempotency key, and only the
caller knows whether the command it issued has one. A blanket retry would, for
a command without a key, produce a second assignment, a second run, or a second
decision — and a duplicate decision is a second valid-looking institutional
record, which is worse than a failed request.

`RetryableDatabaseError` (`40001`, `40P01`) is different: those are raised
_before_ commit, so nothing was written, and a retry is unambiguously safe. Even
there the adapter does not retry on its own — it labels the error retryable and
lets the command layer decide, because the command is what knows whether it can
be re-derived.

---

## Exit criteria

Every port has a PostgreSQL implementation; the shared parity suite passes for
both adapters; PostgreSQL-specific integrity tests pass; the transaction
contract matches Stage 0 and revision-scoped governance matches Stage 1.5;
runtime-role permissions are sufficient and no broader; ordering matches
exactly; optimistic concurrency and idempotency work under concurrent retry;
error mapping is explicit; observability emits; no runtime wiring exists; unit
tests, PostgreSQL tests and typecheck pass; the working tree contains only
intended files.
