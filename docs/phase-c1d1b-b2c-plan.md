# C1D-1B stage B2C — completeness, resource and harness hardening

**Planning gate. No implementation.**

B2A and B2B built the durable repositories. B2C proves the container is
complete, restart-safe, bounded, and incapable of exposing a placeholder or a
bypass path. **It is hardening, not redesign** — no repository semantics change.

---

## 0 · Three things found while planning

### 0.1 Two catalogues are already unregistered — a live defect I introduced

`SUPERSESSION_SQL` and `CONSTRAINT_SQL` are exported, frozen, used in
production paths, and **not in `CATALOGS`**. So `queryCatalogHash` — the
coordinate that says "these are all the statements this adapter can issue" —
currently under-reports by two catalogues, and every provenance row written
since B2B-2 carries a hash that is wrong about what the build could do.

This is exactly the failure TD-56 predicted: catalogue membership is remembered,
not enforced, and B2B added three more chances to forget. **B2C-1 fixes it and
makes forgetting impossible.**

A third, `ORGANIZATION_SQL`, is also absent, and that one is a judgement call
rather than an oversight: the organization reader is constructed by
`container.ts` against `repositories.sql`, not by the adapter. It issues
statements through the adapter's pool, so I lean towards including it and
widening the hash's meaning to "every statement issued through this pool".
**Open question 1.**

### 0.2 `notUntilB2` is already gone

Confirmed by search: no `notUntilB2`, no "not implemented" anywhere in `src`.
B2B-2 removed it when both ports became real. So B2C's placeholder work is
about **making its return impossible**, not about deleting it — which changes
the emphasis but not the requirement.

### 0.3 The stray-postgres cause is structural, not incidental

`pgGlobalSetup.ts` uses a **fixed port 54330** and stops the cluster only in
`teardown()`. When the runner dies without running teardown — a worker timeout,
an interrupted run, a `SIGINT` — the postmaster survives, keeps 54330, and the
next run's `postgres.start()` cannot bind. The library logs
`could not create any TCP/IP sockets` and the worker then waits until vitest's
own timeout, which surfaces as `Timeout waiting for worker to respond`: a
message with nothing in it about ports.

That is what happened during B2B-2. It is a harness defect with a clear cause,
and §9 fixes the cause rather than the symptom.

---

## 1 · Stages

Three. The third is not symmetry: it changes test infrastructure shared by
every PostgreSQL suite, and a regression there presents as a product failure —
mixing it into a commit that also changes product invariants would make both
harder to review.

| Stage      | Contents                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------- |
| **B2C-1**  | completeness guard · placeholder-return proof · fitness rules 13 and 14 · catalogue membership (and the §0.1 fix) |
| **B2C-2**  | restart durability · malformed-row matrix · full query-budget matrix · parity inventory     |
| **B2C-3**  | pool and transaction cleanup · embedded-PostgreSQL ownership, port strategy and diagnostics |

---

## 2 · Files

| File                                                    | Stage | What                                                  |
| ------------------------------------------------------- | ----- | ----------------------------------------------------- |
| `application/analysis/repositories.ts`                   | B2C-1 | `ANALYSIS_REPOSITORY_CAPABILITIES`, `assertRepositoriesComplete` |
| `infrastructure/analysis/postgres/postgresRepositories.ts` | B2C-1 | asserts at construction; registers the missing catalogues |
| `infrastructure/analysis/container.ts`                   | B2C-1 | refuses an incomplete container; closes the pool on failure |
| `test/fitness/rules.ts`, `planted.ts`                    | B2C-1 | rules 13 and 14 with fixtures                          |
| `test/repositoryCapabilities.test.ts`                    | B2C-1 | the catalogue is derived from the ports, not hand-kept  |
| `test/sqlCatalogues.test.ts`                             | B2C-1 | membership, freezing, hash coverage                    |
| `infrastructure/analysis/postgres/c1d1Restart.pg.test.ts` | B2C-2 | the restart suite                                      |
| `infrastructure/analysis/postgres/c1d1Malformed.pg.test.ts` | B2C-2 | the corruption matrix                                  |
| `infrastructure/analysis/postgres/queryCount.pg.test.ts` | B2C-2 | the complete budget matrix                             |
| `infrastructure/analysis/decisionRepositoryContract.ts`  | B2C-2 | the parity inventory pin                               |
| `test/pgGlobalSetup.ts`                                  | B2C-3 | ownership, dynamic port, diagnostics                   |
| `infrastructure/analysis/postgres/c1d1Resources.pg.test.ts` | B2C-3 | pool and transaction cleanup                          |

---

## 3 · Repository completeness

### 3.1 The capability catalogue, derived rather than remembered

Your constraint — no hardcoded list that can silently fall behind — is the hard
part. A plain array of names drifts the moment a port gains a method.

Three coupled mechanisms, each catching what the others cannot:

**Type-level, so a missing PORT is a compile error.**

```ts
export const ANALYSIS_REPOSITORY_CAPABILITIES = { … } as const satisfies {
  readonly [K in keyof TransactionalAnalysisRepositories]:
    readonly (keyof TransactionalAnalysisRepositories[K])[]
}
```

A new port with no entry fails the mapped type. A listed method that is not on
its port fails too.

**Parser-level, so a missing METHOD is a test failure.** `satisfies` cannot
require the list to be *exhaustive*. A test parses the port interfaces out of
`repositories.ts` — the same technique `rowShapes.pg.test.ts` uses against
`information_schema` — and asserts the declared method names of each port equal
its catalogue entry, both directions. Adding a method to a port without adding
it here fails immediately, and the failure names the method.

**Runtime, so an incomplete CONTAINER cannot be handed out.**
`assertRepositoriesComplete(repositories)` walks the catalogue and requires
`typeof repositories[port][method] === 'function'`.

### 3.2 What the runtime assertion deliberately does not do

**It never invokes a method.** Presence is checkable without calling; behaviour
is not, and calling `save` to see whether it works would write. A method that is
present and throws a placeholder is therefore invisible to this guard — which is
exactly why fitness rule 14 exists and is static. The two together cover it; the
runtime guard alone would not, and the plan says so rather than implying it.

### 3.3 Failure at construction, and the pool

`createPostgresRepositories` builds the pool before it can assert. On failure it
must release it, or a refused construction leaks connections until the process
exits.

The factory is **synchronous** and `pool.end()` is not. Making the factory async
would ripple through every call site including `container.ts` and four test
harnesses. **Recommendation:** keep it synchronous, and on assertion failure
issue `void pool.end().catch(() => {})` before rethrowing — the drain is started
and not awaited, which for a pool with no checked-out clients completes
immediately. A test asserts no client survives a refused construction.

`createAnalysisContainer` already wraps its work in `try`; B2C-1 verifies it
closes the repositories on **every** throw path, not only the ones it currently
catches, and adds a test that a refused container leaves nothing open.

---

## 4 · Proving placeholders cannot return

A literal search for `notUntilB2` would pass today and prove nothing. The proof
is fitness rule 14 (§6) plus a tree-level inventory:

- no method body consisting solely of a `throw` of a generic `Error`
- no `new Proxy` in a position that satisfies a repository port
- no `as unknown as` cast whose target is a repository port type
- no construction path selecting an implementation from `process.env` or a mode
  flag
- the capability assertion is actually called by both composition roots

Each is parser-based. The last one matters most: a completeness guard nothing
calls is the same shape of defect as a fitness rule that matches nothing.

---

## 5 · Fitness rule 13 — the submission-reference validator cannot be bypassed

> Every module that persists or hydrates a CIO submission calls
> `validateSubmissionReferences`.

**Selection:** a non-test file under `infrastructure/analysis/` that either
writes `cio_submissions` (an `INSERT` naming it, or a `store.submissions.set`)
or reads it back into a domain value.

**Detection:** the module must contain a **CallExpression** to
`validateSubmissionReferences`. An `ImportSpecifier`, a re-export or a mention
in a comment does not satisfy it — which is your explicit requirement, and the
reason this is AST-based rather than a text search.

**Planted violations:** a PostgreSQL submission repository whose `save` inserts
without calling it; an in-memory one whose read returns the stored submission
unchecked; a module that imports the validator and only re-exports it while
persisting submissions.

**Benign near-misses:** a module that re-exports the validator and persists
nothing (must pass — it is not selected); the domain module that *defines* it
(outside the selected paths); a repository that persists returns rather than
submissions.

**Stated limitation, honestly.** This proves the validator is called in the
module that owns submission persistence. It does not prove every branch calls
it. Branch-level proof needs a call graph the rule does not build, and claiming
otherwise would be the kind of overstatement this project has been correcting.
The contract tests cover the branches; the rule covers the module.

**And R6 stays explicit.** The rule's `because` says in as many words that this
is repository enforcement, that `reviews` is keyed on `id` alone, and that no
database constraint backs it — never that the two integrity levels are
equivalent.

---

## 6 · Fitness rule 14 — no port satisfied by a throwing placeholder

> No repository port is fulfilled by methods whose only behaviour is to refuse.

**Detection**, parser-based:

- an object literal or class method whose body is exactly one `throw`, where the
  thrown expression is `new Error(...)` **or** its message matches the
  placeholder vocabulary (`not implemented`, `unimplemented`, `placeholder`,
  `TODO`, `coming in`, `stage B*`)
- `new Proxy(...)` assigned to, returned as, or cast to a repository port
- `as unknown as X` / `as X` where `X` is a repository port type and the operand
  is an incomplete object literal
- a ternary or `if` selecting a repository implementation from an environment
  variable or mode flag

**The distinction that makes it usable.** A legitimate bounded refusal — `throw
new InvariantViolationError(problems[0]!.code, 'decisions.save')` — is a *named
domain or storage error*, usually guarded by a condition. A placeholder is an
unconditional generic `Error`. The rule keys on both facts, and the near-miss
proves it.

**Planted violations:** a `decisions` port satisfied by a `Proxy` that throws on
every access (the exact shape B2A carried); a `save` whose body is
`throw new Error('not implemented')`; a partial object literal cast to
`SubmissionRepository`.

**Benign near-misses:** a method whose only statement is
`throw new InvalidAggregateError(...)` — a legitimate unconditional refusal;
a validator that throws after a condition; a `Proxy` used somewhere that is not
a repository port.

---

## 7 · SQL catalogue membership

Four properties, each with a planted violation, per your list:

| Property                                     | How                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------- |
| every statement is a catalogue member         | the existing rule at [importGraph.test.ts:780](src/test/importGraph.test.ts#L780) — inline SQL must sit inside `catalog({ … })` |
| no unregistered catalogue                     | **new**: every exported `*_SQL` under `infrastructure/analysis/postgres/` appears in `CATALOGS` |
| catalogues are frozen                         | `catalog()` returns `Readonly`; a test asserts every registered catalogue is `Object.isFrozen` |
| the hash covers every production statement    | the set of statements reachable from `CATALOGS` equals the set of statements declared in production catalogues |

**Test-only SQL is separated by an explicit, frozen list**, not by a heuristic:
`testDatabase.ts`, `schemaFingerprint.ts`, `macroFlowHarness.ts`, every
`*.pg.test.ts`, and `db/migrations/`. Migration SQL and test setup are never
catalogue entries. A file joining that list is a visible edit.

**This stage also fixes §0.1**: `SUPERSESSION_SQL` and `CONSTRAINT_SQL` are
registered, and `COMMAND_SQL` — currently listed **twice** in `CATALOGS` — is
deduplicated. Whether that duplication changes the hash depends on
`catalogHash`; either way it is wrong and the membership test would have caught
it.

**TD-56 closes here.**

---

## 8 · B2C-2 — restart, malformed rows, budgets, parity

### 8.1 Restart durability

1. construct the durable container
2. write submissions, a return with concerns, and a decision
3. supersede it
4. `close()` the container and its pool
5. **assert a read through the closed container fails** — a restart that can
   still read the old connection proves nothing
6. construct a **new** container against the same database
7. reload submissions · returns · concerns · live decision · complete history ·
   dissent · dissent evidence · triggers · supersession links
8. compare a canonical institutional projection
9. **continue writing after the restart** — a second correction, proving the
   new container is fully functional rather than merely readable

No in-memory adapter participates (fitness rule 10 already asserts this for
`.pg.test.ts`). Excluded from the projection, explicitly and by name:
`evaluatedAt` (projection time) and `storageProvenanceId` (a different runtime
wrote it) — the same discipline `institutionalState()` uses.

### 8.2 The malformed-row matrix

Inserted **as the owner**, because the runtime role cannot create any of them —
which is the point: these rows can only arrive by hand-editing or an
incompatible restore.

| Corruption                                            | Expected                        |
| ----------------------------------------------------- | ------------------------------- |
| relation set inconsistent with `outcome_kind`          | `MalformedRowError`             |
| `selected` decision, no `selected` relation            | `MalformedRowError`             |
| decision root with no relation rows at all             | `MalformedRowError`             |
| actor snapshot claiming an authentication that cannot exist | `MalformedRowError`        |
| submission citing a review for another revision        | `MalformedRowError` on hydration |
| dissent evidence pointing at a missing observation     | `MalformedRowError`             |
| quantitative trigger with no unit                      | `MalformedRowError`             |
| supersession link pointing at another case             | `MalformedRowError`             |

**Nothing is repaired or normalised on read.** A test asserts the row is still
there afterwards, unchanged — a mapper that "fixed" it would be laundering
corruption into the record.

### 8.3 The complete budget matrix

Measured at **1 and 25** of every child collection, and required to be identical.

| Operation                            | Count | Varied by                          |
| ------------------------------------ | ----- | ---------------------------------- |
| `submissions.save` (new / replay)    | 7 / 5 | required work, disagreements, evidence, open challenges |
| `submissions.get` / `listForCase` / `applicableForRevision` / `pending` | 6 | same |
| `submissions.settle`                 | 2     | number of submissions settled      |
| `submissions.recordReturn`           | 5     | concerns                           |
| `submissions.getReturn` / `returnsForCase` / `returnsForRevision` | 2 | concerns |
| `decisions.save` (new / replay)      | 9 / 5 | submissions, dissent, evidence, triggers |
| `decisions.save` (first supersession) | 12   | same                               |
| `decisions.get` / `getForCase` / `historyForCase` / `listRecent` | 5 | same |

**No elapsed-time assertions anywhere in either suite.** Timing is
environment-dependent and produces flaky tests that get deleted; the invariant
is statement count. Performance measurement, if it is ever wanted, is a separate
exercise.

### 8.4 The parity inventory

A pin, not a count computed at runtime from the thing it is checking:

- the shared contract's test names are collected once and asserted equal between
  the in-memory and PostgreSQL runs
- the total is pinned, so a suite that silently stopped running half its cases
  fails
- an assertion that **zero** tests are skipped in either adapter's run
- the existing rule that no shared assertion branches on adapter kind stays; the
  inventory adds that both adapters executed the same *names*

---

## 9 · B2C-3 — resources and the harness

### 9.1 Pool and transaction cleanup

| Property                                              | Test                                              |
| ----------------------------------------------------- | ------------------------------------------------- |
| an internally created unit of work releases its client | pool `idleCount`/`totalCount` after N operations   |
| a joined outer transaction does not release the caller's client | the caller's transaction still works after a joined call |
| a failure rolls back and releases                      | after a rejected save, the pool is idle            |
| an ambiguous-commit path leaks nothing                 | simulated by closing the client mid-commit         |
| construction failure closes the pool                   | §3.3                                               |
| `close()` is idempotent                                | calling it twice does not throw                    |
| reads after close fail predictably                     | already asserted by the restart suite              |
| the whole suite leaves no connection behind            | a final check of `pg_stat_activity`                |

### 9.2 The embedded-PostgreSQL harness

Cause established in §0.3. Four changes, in order of importance:

**1 · Detect the occupied port before waiting.** Before `start()`, attempt a TCP
connection to the chosen port. If something answers, fail immediately with a
diagnostic naming the port, what is listening if we can tell, and how to clear
it — rather than letting the worker sit until vitest's timeout produces a
message about workers.

**2 · Ownership, recorded.** A marker file — `tmpdir()/finos-pg-owner.json` —
holding `{ pid, port, directory, startedAt }`, written after a successful start
and removed by teardown. On startup, if the port is occupied **and** the marker
names a live pid whose recorded directory is one of ours, that process is
provably ours and is terminated and its directory removed. Otherwise the run
fails with the diagnostic.

> **It never kills a PostgreSQL it did not start.** A developer's local server
> on the same port produces a clear refusal, never a terminated process. This is
> the requirement I would least like to get wrong, so the check is
> ownership-first: no marker, no kill.

**3 · A dynamic port by default.** Bind an ephemeral socket, read the assigned
port, release it, and hand it to `embedded-postgres`, retrying a small bounded
number of times on a bind race. Removes the collision class rather than
detecting it. `TEST_DATABASE_URL` still overrides everything.

**4 · Interrupted setup, handled.** `start()` wrapped so a failure stops
whatever came up and removes the directory; `process.once('SIGINT'|'SIGTERM')`
stops the cluster so an interrupted run cleans up after itself.

**Deterministically tested where practical:** the port-in-use detection and the
ownership decision are pure functions over `{ portAnswers, marker }`, unit-tested
against every combination — occupied-and-ours, occupied-and-foreign,
occupied-and-stale-marker, free-with-stale-marker. Actually killing a process is
not unit-tested; the decision to kill is.

**Not doing:** raising the worker timeout. That hides the cause and makes the
next occurrence take longer to diagnose.

---

## 10 · Risks

**R12 — the completeness catalogue is three mechanisms, and a contributor may
satisfy the compiler while defeating the parser test.** *Mitigation:* the parser
test compares both directions and names the drifting method.

**R13 — fitness rule 14 must not fire on legitimate refusals.** A false positive
here trains people to weaken the rule. *Mitigation:* the named-error near-miss,
and a negative control that broadening the rule to "any unconditional throw"
makes that near-miss fail.

**R14 — killing a process is the most dangerous thing in this plan.**
*Mitigation:* §9.2's ownership-first rule and its unit-tested decision function.

**R15 — rule 13 is module-level, not branch-level.** Stated as a limitation
rather than presented as complete.

---

## 11 · Technical debt

**Closed:** TD-56 (catalogue membership, §7).
**Open, unchanged:** TD-55 (live-recent index, numeric trigger) · TD-57 (prefix
error classification; must not spread to unrelated errors) · TD-52 (trigger
lineage) · R6 as load-bearing debt, documented and now mechanically protected ·
TD-43, TD-50, TD-51, TD-53, TD-54, TD-41–44, TD-46, TD-34–37, TD-39, TD-8.

**Opened:** none expected.

**Contract versions:** command stays at **2**, domain stays at **8**.

---

## 12 · Approved rulings (review, revision 2)

**`ORGANIZATION_SQL` is production SQL.** The test is not which file constructs
the statement but whether this build can issue it while serving the runtime. It
can, so it is registered and contributes to `queryCatalogHash`. Excluded only:
migrations, test setup, fixture seeding used exclusively by tests, and
diagnostic SQL that cannot run in production.

**Duplicate registration is refused, never deduplicated.** Collapsing it in the
hashing function would conceal a registry defect behind a plausible-looking
hash, which is precisely how `COMMAND_SQL` survived two phases registered twice.
`registerCatalogues` throws.

**The factory becomes asynchronous.** All cleanup is awaited before rejection;
no unawaited `pool.end()`. A cleanup failure is attached to the construction
error rather than replacing or hiding it. No synchronous fallback is provided
and every caller awaits.

**Historical provenance is not rewritten.** The old hash accurately records what
the software claimed at the time, incomplete though the claim was; changing it
retroactively would make the audit trail more misleading, not less. The
catalogue is fixed, the identity is re-derived, and future rows carry the
corrected hash. A regression test proves a catalogue change moves the identity.

**Rule 13 needs both forms of evidence.** The static rule proves the owning
module calls the validator; the behavioural contract tests prove each public
path rejects a wrong-case reference, a wrong-revision reference, a malformed
hydrated reference and a bypassed replay. Branch-level static proof is not
claimed.

**Rule 14 classifies by shape and marker, not by the presence of `throw`.**
Named bounded errors — `InvariantViolationError`, `ConflictingRecordError`,
`ReferentialIntegrityError`, `TransactionClosedError` — are legitimate refusals
and must never be flagged.

**Three stages, approved**, reported separately.

---

## 13 · Superseded open questions

1. **`ORGANIZATION_SQL` in `CATALOGS`?** (§0.1) It is issued through the
   adapter's pool but constructed by `container.ts`. I lean to including it and
   defining the hash as "every statement issued through this pool". The
   alternative is an explicit, frozen exclusion list with a stated reason.
2. **Synchronous factory on construction failure** (§3.3) — accept the
   unawaited `pool.end()`, or make `createPostgresRepositories` async and update
   every call site.
3. **Three stages or two.** I recommend three, because B2C-3 touches only shared
   test infrastructure and a regression there presents as a product failure.
   Fold it into B2C-2 if you would rather have fewer commits.

Everything else I am prepared to build as written.
