# Dual write — a deferred migration design

**Status: designed, reviewed, approved as a design, and deliberately NOT
implemented.** Reclassified from "Stage 3 of the durable-storage migration" on
2026-07-28.

## Why it is not implemented

The prerequisite problem does not exist. Dual write, shadow read verification
and a gradual read switch are how you migrate an **active stateful runtime**
without taking correctness on trust. At the time of deferral Financial OS had:

- no application command writing to the repositories
- no production read path consuming them
- in-memory state that is empty after every restart
- no accumulated institutional history
- no users and no live agents

There was therefore no cutover risk for dual write to protect against, and
building the journal, replay, divergence ledger, reconciliation and
ambiguous-commit spool would have been substantial migration machinery wrapped
around a command boundary that did not yet exist — likely to be reshaped once
Phase C defined the real commands.

The revised sequence makes PostgreSQL the sole authoritative runtime store from
the first real command, and keeps the in-memory adapter as the unit-test
reference, the semantic parity oracle, and a deterministic runtime-test tool.
See `docs/phase-c-plan.md`.

## When to come back to this

When Financial OS actually has one of:

- an existing authoritative store with persistent data to migrate
- live traffic that cannot be interrupted
- a rollback requirement
- a replacement database or storage backend

The design below is retained in full because the reasoning does not expire.
What is worth keeping regardless of the eventual migration:

- **recorded replay rather than double callback execution** (§2) — running a
  callback against two stores whose contents differ produces two different
  sequences of writes, so the mechanism meant to detect divergence causes it
- **canonical comparison functions** (§9) rather than ad-hoc deep equality
- **divergence classification** into safe-to-repair and must-be-blocked (§8)
- **ambiguous-commit handling** by identity lookup rather than blind replay (§5)
- **reconciliation that never overwrites to make counts match** (§8)
- **storage provenance** (§10), which was extracted and is being implemented
  independently — see D-T6 and the Phase C plan

Everything below is the original plan, unchanged.

---

## 0. A finding that changes what Stage 3 means

**Nothing in the runtime writes to any store.**

- `createInMemoryRepositories` is constructed by no file outside its own module
  and the tests.
- `withTransaction` has **zero callers** in application or presentation code.
- No application module calls any repository method.
- There is no command layer. `orchestrator.ts` runs a playbook and persists
  nothing.

So "write every committed analysis operation to both stores" currently means
duplicating **zero** operations, and "in-memory remains authoritative for
reads" describes a store nothing reads.

This does not make Stage 3 pointless, but it changes what it buys and it
changes the exit criteria, so it has to be said before the design rather than
discovered during it.

### What dual write was originally for

Stages 3–5 were designed in `docs/durable-storage-plan.md` §14 as a **safe
cutover for a live system**: write both, verify reads match, then switch, so
that at no point is correctness taken on trust. That shape assumes there is
something to migrate and something to break.

Neither holds here. The in-memory store is process-local and **empty at every
boot**. There is no accumulated data, no user, no traffic and no rollback
exposure. A direct cutover would risk nothing that dual write protects.

### What it still buys

Three things, and they are real:

1. **The adapter is exercised by whole commands rather than by test fixtures.**
   The parity suite calls one port method at a time; dual write runs the same
   multi-repository sequence through both stores.
2. **The comparison machinery gets built before Phase C**, when the first real
   agent output arrives and mistakes become institutional records.
3. **A rollback path exists** for the period when PostgreSQL becomes
   authoritative but is not yet trusted.

### Decision D-T1 — is Stage 3 still the right next step?

| Option                                                                  | Cost   | What it protects                         |
| ----------------------------------------------------------------------- | ------ | ---------------------------------------- |
| **A. Stage 3 as specified**, built now, exercised by tests only         | high   | future commands, once they exist         |
| **B. Collapse 3–5 into a single cutover**, keep in-memory for tests     | low    | nothing, because nothing is at risk yet  |
| **C. Defer Stage 3 until Phase C commands exist**, then dual-write them | medium | the same as A, but against real commands |

**Recommendation: C.** Dual write with no commands to write is machinery
verified against its own tests, and the parity suite already does that more
cheaply and more deterministically. Building it now also fixes its design
around a command boundary that does not yet exist — which is the most likely
way it ends up being rebuilt.

**But this plan assumes A**, because that is what was asked for, and because
the design below is what C would need anyway. Nothing in it is wasted under any
option; only the timing changes.

---

## 1. The core principle, stated

**This is not a distributed transaction.** There is no mechanism that commits
an in-memory map and a PostgreSQL transaction atomically, and none is
attempted. Two-phase commit against a process-local `Map` would be theatre: the
prepare step cannot fail and the participant cannot survive a crash.

What the design does instead is make the **ordering** such that only one step is
irreversible, and put it last.

---

## 2. The write path — journal and replay

### Why not simply run the callback twice

The obvious implementation is: run the caller's `withTransaction` callback
against the in-memory repositories, then run it again against PostgreSQL. It is
wrong for a reason worth stating, because it will be proposed again later.

A callback is arbitrary code. It reads, branches on what it read, generates
ids, reads the clock, and returns a value. Running it twice against two stores
whose contents differ produces **two different sequences of writes**, and the
divergence is caused by the mechanism meant to detect divergence.

### The design

One pass, recorded, replayed.

```
dual.withTransaction(operation):

  memory.withTransaction(memoryTx => {
     journal  = []
     recorded = recordingProxy(memoryTx, journal)   // reads pass through,
     result   = await operation(recorded)           // writes are appended

     // still inside the in-memory transaction, before it commits
     await replay(journal, postgres)                // ONE pg transaction, commits here

     return result
  })
```

`recordingProxy` forwards every call to the in-memory scoped repositories and
appends `{ seq, repository, method, args }` for every **write**. Reads are not
journalled — PostgreSQL is not read in Stage 3, and a read that influenced a
branch has already had its effect captured in the writes that followed.

Replay calls the same methods with the same arguments against the PostgreSQL
scoped repositories inside one `withTransaction`. Same inputs, same effects; no
re-execution of caller logic.

### Ordering, and why this ordering

**PostgreSQL commits first. The in-memory commit follows and cannot fail** —
committing an in-memory transaction is _not restoring the snapshot_, which has
no failure mode.

That is the whole argument for this shape, and it answers the ordering question
without needing per-operation rules:

| Failure point                 | In-memory             | PostgreSQL  | Result                |
| ----------------------------- | --------------------- | ----------- | --------------------- |
| callback throws               | rolled back           | never began | neither store changed |
| replay fails before PG commit | rolled back           | rolled back | neither store changed |
| PG commit fails               | rolled back           | rolled back | neither store changed |
| PG commit succeeds            | commits (cannot fail) | committed   | both stores changed   |
| **PG commit outcome unknown** | policy (§5)           | unknown     | the one real hazard   |

Compare the two naive orderings the question asks about. _Memory first, then
PostgreSQL_ leaves the authoritative read store holding non-durable state on
every PostgreSQL failure. _PostgreSQL first, then memory_ leaves durable
records the authoritative store has never seen, and — because the callback
would have to run against PostgreSQL — reintroduces the double-execution
problem above. The journal gets the good half of both.

**Decision D-T2: journal-and-replay, PostgreSQL committing inside the in-memory
transaction.**

### What this requires from the in-memory adapter

`withTransaction` must let an outer wrapper interpose between "callback
resolved" and "commit". Today it does not — commit is implicit in the callback
resolving.

Proposed: an infrastructure-only interface on the in-memory adapter,

```ts
interface InterposableRepositories extends AnalysisRepositories {
  withTransaction<T>(
    operation: (r: TransactionalAnalysisRepositories) => Promise<T>,
    beforeCommit?: (r: TransactionalAnalysisRepositories) => Promise<void>,
  ): Promise<T>
}
```

`beforeCommit` runs after the callback and before the snapshot is discarded;
throwing from it rolls back exactly as the callback throwing does. The public
port is unchanged, so no consumer sees it.

**Decision D-T3: add `beforeCommit` to the in-memory adapter, not to the port.**

---

## 3. Transaction boundaries

- One logical command → **one** in-memory transaction and **one** PostgreSQL
  transaction. The wrapper never calls a repository method outside a
  transaction, and replay is one `postgres.withTransaction` for the whole
  journal.
- The wrapper operates at `withTransaction` — the command boundary by
  construction, since it is the only place a multi-repository unit exists.
- Ambient (non-transactional) writes through the dual container are wrapped in
  a transaction of their own rather than passed through, so there is no path
  that writes to one store outside a boundary.
- Each adapter keeps its own guarantees unchanged: `unitOfWork` still joins the
  caller transaction, the scope guard still fires, the in-memory snapshot still
  restores.

---

## 4. Command identity

Every dual-written command carries a `CommandEnvelope`:

```ts
interface CommandEnvelope {
  commandId: string // ULID; the wrapper mints it if the caller does not
  operationType: string // e.g. 'open-case', from the caller
  correlationId: string
  occurredAt: string // domain Clock, never the database
  caseId?: string // derived from the journal when unambiguous
  aggregateVersion?: number // ditto
  idempotencyKey?: string // observed in the journal, when the command reserves one
  tier: 1 | 2 // derived, see §6
}
```

`caseId`, `aggregateVersion` and `idempotencyKey` are **read out of the
journal** rather than passed in, so they cannot disagree with what was actually
written.

Reconciliation questions and how the envelope answers them:

| Question                              | Answered by                                         |
| ------------------------------------- | --------------------------------------------------- |
| did both stores receive this command? | `commandId` on the divergence record                |
| did both produce the same result?     | canonical comparison (§8), Stage 4                  |
| is one store missing it?              | `idempotencyKey` lookup, else journal replay check  |
| was it retried?                       | `commandId` repeated with the same `idempotencyKey` |
| safe to repair?                       | tier + failure category (§7)                        |

**Timestamps are never used to reconcile.** `occurredAt` is recorded for
ordering the operational view and for nothing else.

---

## 5. Ambiguous commit

`AmbiguousCommitError` — the COMMIT was sent and its outcome is unknown —
is handled separately from every other failure.

Rules:

1. **Never blindly replay.** A blind retry of a command without an idempotency
   identity produces a second assignment, a second run, or a second decision.
2. **Resolve by identity where one exists.** If the journal reserved an
   idempotency key, the question "did it commit?" is answered by asking
   PostgreSQL whether that key exists — once it is reachable again.
3. **Classify as unresolved until confirmed.** Not "probably fine".
4. **Tier 1 fails the command** and rolls back in memory. Returning success
   would claim durability nobody can confirm.
5. **Tier 2 commits in memory** and records the divergence as unresolved.

Per command type:

| Command           | Has an idempotency key?               | Ambiguity resolvable automatically                         |
| ----------------- | ------------------------------------- | ---------------------------------------------------------- |
| open case         | yes (`open:<caseId>`)                 | yes, by key lookup                                         |
| start run         | yes                                   | yes                                                        |
| record review     | yes                                   | yes                                                        |
| record decision   | yes                                   | yes                                                        |
| revise thesis     | no — identity is the new `revisionId` | yes, by revision lookup                                    |
| append event      | no — identity is `eventId`            | yes, by event lookup                                       |
| save assignment   | no — identity is `id`                 | yes, by assignment lookup                                  |
| update case stage | **no stable identity**                | **no** — needs the aggregate version, which may have moved |

The last row is the honest gap: a bare version bump has no identity to probe
for. Proposal: the wrapper records the **expected resulting aggregate version**
in the envelope, and resolution compares `cases.version` in PostgreSQL against
it. Equal → committed. Lower → did not commit. Higher → a later write landed and
the answer is unrecoverable → manual.

---

## 6. Failure policy by record importance

Tiering is **per command, derived as the maximum tier of the records the
journal writes**. A single command that writes assignments and a verification
review is Tier 1.

**The line is not "how important does this feel".** It is:

> Does a record existing only in volatile memory create a **false institutional
> statement**, or merely lose work?

| Tier  | Records                                                                                                                 | Why                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | `case_decisions`, `reviews` and their findings/challenges, `thesis_revisions`, `evidence_sets` + items, `agent_results` | Each asserts that something was decided, verified, challenged, reasoned over or produced. Losing one silently leaves a system that claims due process happened |
| **2** | `cases`, `case_participants`, `assignments`, `runs`, `run_events`, `claims`, `transition_events`, `idempotency_keys`    | Losing these loses work, which is visible and recoverable by redoing it                                                                                        |

Two entries are arguable and worth your attention:

- **`transition_events` is Tier 2**, which sits oddly with "the events are the
  record". The reasoning: an event never travels alone — it accompanies the
  operation it describes, so a command writing an event for a decision is Tier 1
  by the decision. A Tier 2 command's events describe Tier 2 work.
- **`claims` is Tier 2** even though claims are cited. A claim that exists only
  in memory is cited only by theses that also exist only in memory, so the
  citation graph stays consistent. A claim cited by a _stored_ review makes the
  command Tier 1 through the review.

**Tier 1 behaviour:** PostgreSQL durability confirmed, or the command fails and
both stores are rolled back. No degraded success.

**Tier 2 behaviour:** in-memory commit proceeds, a divergence is recorded, the
result carries `durability: 'degraded'`, and health degrades.

**Decision D-T4: tiering by "false statement versus lost work", derived per
command from the journal.**

---

## 7. Divergence records

```ts
interface DualWriteDivergence {
  id: string
  commandId: string
  operationType: string
  caseId?: string
  correlationId: string
  tier: 1 | 2
  authoritativeResult: 'committed'
  shadowResult: 'failed' | 'ambiguous' | 'diverged'
  failureCategory: string // from the Stage 2 error taxonomy, bounded
  firstDetectedAt: string
  lastAttemptedAt: string
  retryCount: number
  state: 'unresolved' | 'repairing' | 'repaired' | 'blocked' | 'accepted'
  resolvedAt?: string
  provenance: StorageProvenance
}
```

**No claim, thesis, rationale or evidence payload**, in the record, in logs or
in metric labels. The journal itself is **not** stored in the divergence record
for the same reason — it contains the domain values that were written.

### Where they live, and how they survive restart

The obvious answer — a PostgreSQL table — has an obvious hole: the divergence
that matters most is the one where PostgreSQL is unreachable.

Two tiers, and one argument that removes most of the problem:

1. **`analysis.dual_write_divergences`** (migration 0013) for every divergence
   the wrapper can write, which is all of them except when PostgreSQL is down.

2. **When PostgreSQL is unreachable, only Tier 2 in-memory writes succeeded —
   and those are themselves lost on restart.** Losing the divergence record
   alongside the thing it describes is consistent rather than a gap. Tier 1
   commands failed, so there is nothing to reconcile.

3. **Ambiguous commits are the exception** and need durability the database
   cannot provide, because the database is exactly what is in doubt. Proposal:
   an append-only JSONL spool file, one line per ambiguous commit, drained into
   the table when PostgreSQL recovers. Bounded, local, and the only artefact
   that must outlive both the process and the database.

**Decision D-T5: PostgreSQL ledger for divergences, plus a local append-only
spool for ambiguous commits only.**

---

## 8. Reconciliation

**Automatic, and safe:**

| Case                                                                  | Repair                               |
| --------------------------------------------------------------------- | ------------------------------------ |
| PostgreSQL missing an idempotent write still present in memory        | replay the journal entry by identity |
| Content-addressed record absent from one store (evidence set, result) | insert; the id proves the content    |
| Append-only event with a stable `eventId` missing                     | append                               |
| Connection failure before any PostgreSQL commit                       | replay the whole command             |

**Manual, or blocked:**

| Case                                                 | Why                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Same identity, different content                     | one of the two writers is wrong; overwriting hides which           |
| Ambiguous commit with no safe identity               | the durable state is genuinely unknown                             |
| Divergent thesis lineage                             | a lineage with two versions of the same revision cannot be audited |
| Different selected revision on a decision            | the institutional record disagrees with itself                     |
| Different governance verdict                         | as above, and worse                                                |
| Aggregate-version mismatch with later writes applied | repairing would rewrite history that has already been built on     |

**Nothing is overwritten to make counts match.** A repair writes the missing
record; it never deletes or edits an existing one. Every divergence keeps its
record after resolution, with `state` and `resolvedAt` — the evidence that it
happened is part of the audit trail.

Reconciliation runs as an explicit operation, not a background daemon, in
Stage 3. A worker is Stage 5 work at the earliest, and is recorded as debt.

---

## 9. Preparing Stage 4

`src/application/analysis/canonical.ts` — canonical forms for comparison,
extending the `writeOnce.ts` keys rather than duplicating them.

**Compared:** entity identity, domain values, child collections (sorted),
revision lineage, evidence set ids and item content hashes, review scope,
governance verdicts, decision references, event ordering by
`(occurredAt, eventId)`, aggregate version, and list ordering as the port
specifies it.

**Not compared:** object identity, database row order, adapter-specific
metadata, `StorageProvenance`, and anything deliberately adapter-local.

One canonical function per aggregate, used by both Stage 3 divergence detection
and Stage 4 verification — so a difference of opinion between the two stages is
impossible.

---

## 10. Storage provenance — closing TD-24

Every shadow write and every divergence record carries the full
`StorageProvenance`. The remaining weakness is `adapterVersion`, which is
hand-maintained and will drift.

**Proposal:** derive it.

```
adapterVersion = short hash of (buildId ∥ queryCatalogHash ∥ schemaVersion ∥ domainContractVersion)
```

where `buildId` is the git commit, injected at build time via an environment
variable and defaulting to `dev` locally. `queryCatalogHash` already covers the
SQL automatically; `buildId` covers the mapping code and everything else, which
the hand-maintained constant never did.

The human-readable constant stays as a label, but nothing depends on it.

**Decision D-T6: derive adapter identity from the build id; keep the constant
as a label only.**

---

## 11. Metrics and health

Namespaced `analysis.dualwrite.*`, through the shared recorder, with the same
label allowlist.

| Metric                      | Type                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `.attempt`                  | counter, labelled `outcome=both-ok / shadow-failed / ambiguous / diverged`, `tier` |
| `.shadow.failure`           | counter, labelled `category`                                                       |
| `.authoritative.failure`    | counter                                                                            |
| `.divergence`               | counter, labelled `category`                                                       |
| `.ambiguous`                | counter                                                                            |
| `.reconciliation`           | counter, labelled `outcome=repaired / blocked / failed`                            |
| `.unresolved`               | gauge                                                                              |
| `.unresolved.oldest_age_ms` | gauge                                                                              |
| `.latency_ms`               | histogram, whole command                                                           |
| `.store.latency_ms`         | histogram, labelled `state=authoritative / shadow`                                 |

No case, thesis, tenant, user or correlation id is ever a label.

**Health**, four states, and none of them is inferable from "reads still work":

| State         | Meaning                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `healthy`     | no unresolved divergences, shadow writes succeeding                                                      |
| `degraded`    | unresolved but reconcilable divergences exist; Tier 1 still succeeding                                   |
| `blocked`     | at least one divergence in state `blocked` — correctness is in question and the migration cannot advance |
| `unavailable` | PostgreSQL unreachable; every Tier 1 command is failing                                                  |

Stage 3 is **not healthy** merely because the in-memory store answers reads.

---

## 12. Test strategy — deterministic fault injection

A `FaultyRepositories` decorator over the PostgreSQL container, driven by an
explicit script rather than by chance:

```ts
faults.failAt({ operation: 'claims.save', mode: 'before-commit' })
faults.failAt({ operation: 'commit', mode: 'ambiguous' })
```

No random connection drops, no timing dependence, no retries-until-flaky.

Coverage: both stores succeed; PostgreSQL fails before the write; fails midway
and rolls back; commit outcome ambiguous; in-memory write fails; retry after
one-store success; identical replay; conflicting replay; divergence record
created; automatic reconciliation; manual reconciliation refused; unresolved
divergence surviving restart; Tier 1 failure policy; Tier 2 degraded success; no
duplicate events, runs, reviews or decisions; provenance captured; metrics and
health transitions; reads still served from memory; and a fitness rule that no
read path touches PostgreSQL.

---

## 13. Scope

**Adds:** the dual-write container, the recording proxy and journal, the
divergence ledger (migration 0013) and spool, reconciliation primitives,
canonical comparison, metrics and health, `beforeCommit` on the in-memory
adapter, fault injection, Stage 3 test composition.

**Does not:** switch reads, remove in-memory from anything, add an LLM, touch
the Agents UI, change market-data behaviour, modify `services/investmentLetter`,
or claim production readiness.

---

## 14. Decisions requiring approval

| #        | Decision                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| **D-T1** | **Whether Stage 3 runs now at all.** Recommendation: defer to Phase C (option C); this plan assumes it proceeds |
| D-T2     | Journal-and-replay, with PostgreSQL committing inside the in-memory transaction                                 |
| D-T3     | `beforeCommit` added to the in-memory adapter, not to the port                                                  |
| D-T4     | Tiering by "false statement versus lost work", derived per command                                              |
| D-T5     | PostgreSQL divergence ledger plus a local spool for ambiguous commits only                                      |
| D-T6     | Adapter identity derived from the build id; the constant becomes a label                                        |
| D-T7     | Reconciliation is an explicit operation in Stage 3, not a background worker                                     |

---

## 15. Exit criteria

Every intended command dual-written; in-memory authoritative for reads;
per-command failure policy explicit; Tier 1 requires confirmed durability;
idempotent retries do not duplicate; ambiguous commits stay unresolved until
confirmed; divergences structurally recorded; safe reconciliation works and
unsafe is blocked; metrics and health expose migration state; provenance
captured; deterministic fault-injection tests pass; both adapters' transaction
guarantees intact; no read switch; unit, PostgreSQL and typecheck suites pass;
working tree contains only intended changes.

---

## 16. Technical debt to record

- Stage 4 canonical read verification
- **TD-25** evidence payload integrity on the read path
- Automatic adapter-version derivation (**TD-24**, advanced by D-T6)
- `reviews.detail` relational normalization
- Production database host — still undefined
- CI PostgreSQL service container (**TD-23**)
- Durable reconciliation worker
- Migration-mode operational runbook
- Alert thresholds for unresolved divergence age and count
- Dual-write removal after cutover — the wrapper is scaffolding and must not
  outlive the migration
