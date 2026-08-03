# C1D-1B stage B2C-2 — durability, refusal and bounded behaviour

**Planning gate. No implementation.**

B2C-1 proved the container is complete and its capabilities are honestly
described. B2C-2 proves the layer **survives restart, refuses malformed stored
state, stays bounded, and never falls back to memory.**

Hardening, not redesign — with one exception stated up front, because it is a
change rather than a test.

---

## 0 · Three things found while planning

### 0.1 `getForCase` silently picks one of several live decisions

```ts
getForCase: (caseId) => unitOfWork(…, async (client) =>
  (await hydrate(…, DECISION_READ_SQL.liveForCase, [caseId]))[0] ?? null)
```

`[0] ?? null`. If a case somehow held two decisions with
`superseded_by_decision_id IS NULL`, this returns whichever the planner
happened to order first and reports it as *the* live decision — the single most
misleading answer the read could give, because the caller has no way to know it
was a choice.

`case_decisions_one_live_per_case` normally makes that unreachable, including
for the owner. But the malformed matrix you specified explicitly includes
"multiple apparent live decisions where privileged corruption bypassed normal
constraints", and reaching that state proves the read has no opinion about it.

**So B2C-2 adds detection**: more than one live decision for a case raises
`MalformedRowError`. That is a behaviour change, small and in the refusal
direction, and I am flagging it rather than folding it into "tests".

The same shape does not exist elsewhere: `submissions.get`, `getReturn` and
`decisions.get` read by primary key, where more than one row is impossible.

### 0.2 Creating that corruption means dropping the index

There is no way to insert a second live decision while
`case_decisions_one_live_per_case` exists. The test therefore drops the index as
owner, inserts, and asserts the refusal. It does **not** restore it — recreating
a unique index over duplicate rows fails — so that case runs in a database the
suite then discards rather than truncates.

Worth stating plainly because it is the one corruption that cannot be produced
without weakening the schema, and a reader should know the test does that
deliberately.

### 0.3 The parity inventory cannot be compared at runtime

The in-memory contract runs in the **unit** project and the PostgreSQL contract
in the **postgres** project — different vitest processes, different runs, often
minutes apart. Nothing can compare "what the other adapter executed" while
either is running.

**Design:** the shared contract module builds a frozen list of the case names it
defines, exported as `SHARED_CONTRACT_CASES`. Each adapter's call site asserts,
independently, that the suite it just defined registered exactly those names and
skipped none. Two independent checks against one pinned list — which gives the
same guarantee as a comparison without pretending the processes can talk.

---

## 1 · Staging — two, not one, and not three

The malformed matrix is ~25 privileged-corruption cases and carries the §0.1
repository change; the restart suite is a whole institutional round trip. Either
is a reviewable commit; together they are a large one where a reviewer would be
switching between "does this prove durability" and "does this prove refusal".

| Stage       | Contents                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------- |
| **B2C-2A**  | restart durability · canonical comparison · no-memory-fallback proof · parity inventory · provenance consistency |
| **B2C-2B**  | malformed-row matrix (and the §0.1 detection) · full query-budget matrix · transaction and connection cleanup |

Each committed and reported separately. **No B2C-3 harness work in either.**

---

## 2 · Restart durability (B2C-2A)

`c1d1Restart.pg.test.ts`, against its own database.

1. create an isolated database and migrate to the current schema
2. construct the durable container via `createAnalysisContainer`
3. persist, through the ports: two submissions with full eligibility bases · a
   return with two concerns · a **selected** decision · a **deferred** decision
   on a second case, with triggers · a **declined** decision on a third · dissent
   with acknowledgement and two evidence refs · a **supersession** of the
   selected decision
4. `close()` the container and its pool
5. **assert a read through the closed container fails** — a restart that can
   still read proves nothing
6. drop every reference: repositories, mappers, organization reader, container
7. construct a **new** container against the same database
8. reload everything
9. compare the canonical projection (§3)
10. **write again** — a further correction of the live decision, proving the new
    container is functional and not merely readable

**No in-memory repository participates.** Fitness rule 10 already asserts that
for every `.pg.test.ts`; §6 adds the behavioural half.

## 3 · The canonical comparison

**Compared, exactly:** submission ids, case, thesis, revision, submitter,
`submittedAt`, `caseVersion`, state · eligibility policy version · aggregation,
verification, Devil's Advocate and Risk review ids with their sequences and
statuses · open challenge ids · Risk requirement, rule id and version · required
work · material disagreements · evidence set ids · return ids, `returnedAt`,
`returnedFor`, reason, `caseVersion`, and every concern in order · actor
snapshots in full, including `departmentHandles` order · decision ids,
`decidedAt`, `aggregateVersion`, `decidedBy`, authorization basis, outcome kind,
selected revision, considered and declined revision ids · every
decision-to-submission relation · dissent in ordinal order with acknowledgement
and evidence refs · triggers in ordinal order with **individual** policy
versions · supersession links in both directions · the live decision · the
complete history in order.

**Excluded, by name and for a stated reason** — never by a heuristic over
timestamps or ids:

| Excluded                    | Why                                                   |
| --------------------------- | ----------------------------------------------------- |
| `provenance.provenanceId`   | derived from the runtime's coordinates; a new container is a new runtime |
| `provenance.buildId`        | same                                                   |
| pool and container identity | not institutional state at all                         |

**`basis.evaluatedAt` is compared, not excluded.** It is a stored institutional
fact — when the eligibility projection ran — and must survive a restart exactly.
Earlier harnesses excluded it because they *recomputed* it; nothing recomputes
it here. Every other timestamp and id is compared.

## 4 · Provenance across the restart (B2C-2A)

- the provenance row referenced before the restart still resolves afterwards
- a new container with the same build and catalogue derives the **same**
  `provenanceId`, and `ensureProvenance` adds no second row
- a container built with a different `buildId` derives a **different** identity
- every statement the restart flow issues belongs to a registered catalogue —
  reusing B2C-1's registry rather than a second list
- **nothing rewrites a historical provenance row**, asserted by comparing the
  pre-restart row byte for byte afterwards

## 5 · Parity inventory (B2C-2A)

Per §0.3: `SHARED_CONTRACT_CASES`, frozen, exported by the contract module.

Each adapter's call site asserts it registered exactly those names, in that
number, with **zero skips**. A shared case added without updating the pin fails
both suites; a suite that silently stopped defining half its cases fails its own.

Counted as parity: only the shared contract. **Not counted:** PostgreSQL
corruption, permission, budget or harness tests — those are additional by
design, and folding them in would inflate a number whose whole value is that it
means "both adapters ran the same thing".

The existing rule that no shared assertion branches on adapter kind stays.

## 6 · No memory fallback (B2C-2A)

**Structural:**

- no file under `application/` or `infrastructure/analysis/` selects a
  repository implementation from `process.env` or a mode flag — fitness rule 14
  already detects environment-selected ports; B2C-2 adds the in-memory case to
  its fixtures
- nothing constructs `createInMemoryRepositories` outside tests, which
  `importGraph.test.ts` already asserts

**Behavioural:**

- `createAnalysisContainer` with no connection string **rejects**, and the
  message says durable storage is required
- with an unreachable database it rejects rather than degrading
- the restart suite's second container reads state it did not write in this
  process — the strongest available proof that nothing was retained

**Explicitly not conflated:** market-data fixture mode (`MARKETDATA_MODE`) has
no bearing on institutional analysis storage. A test asserts that setting it
changes nothing about which repositories the container builds.

---

## 7 · The malformed-row matrix (B2C-2B)

Created **as the owner**, because the runtime role cannot write any of them —
which is the point. Every case expects a bounded `MalformedRowError`, **no
partial aggregate**, **no silent correction**, and no SQL, parameter or
PostgreSQL detail in the message. A test asserts the corrupt row is still there
afterwards, unchanged: a mapper that "fixed" it would be laundering corruption
into the record.

### Submissions

| Corruption                                        | Detected by                          |
| ------------------------------------------------- | ------------------------------------ |
| verification review belongs to another revision    | `validateSubmissionReferences` on hydration |
| Devil's Advocate challenge belongs to another review | same                               |
| Risk review belongs to another revision            | same                                 |
| unknown eligibility policy version                 | **new**: the FK makes it unreachable, so this one is asserted as *prevented* rather than *refused*, and the plan says so |
| actor snapshot claiming an impossible authentication | `toActor` in the mapper            |
| missing eligibility child row (required work)      | **needs a check** — see §7.1         |
| provenance reference dangling                      | FK prevents it; asserted as prevented |

### Returns

| Corruption                                | Detected by                     |
| ----------------------------------------- | ------------------------------- |
| a return with no concern rows              | **needs a check** — §7.1        |
| concern targeting a revision not the return's | **needs a check** — §7.1     |
| invalid actor snapshot                     | `toActor`                       |
| `returned_for` outside the vocabulary      | CHECK prevents it; asserted as prevented |

### Decisions

| Corruption                                       | Detected by                        |
| ------------------------------------------------ | ---------------------------------- |
| `selected` with zero selected relations           | `outcomeFromRows`                  |
| `selected` with two selected relations            | partial unique index prevents it; asserted as prevented |
| `deferred` with a selected relation               | `outcomeFromRows` / guard          |
| `deferred` with no trigger                        | the deferred guard at COMMIT       |
| `declined` leaving a revision unaccounted for     | the deferred guard at COMMIT       |
| relation pointing at the wrong case or revision   | composite FKs prevent it; asserted as prevented |
| malformed dissent (materiality outside vocabulary)| CHECK prevents it; asserted as prevented |
| dissent evidence referencing a missing observation| composite FK prevents it; asserted as prevented |
| quantitative trigger with no unit                 | CHECK prevents it; asserted as prevented |
| malformed supersession link (other case)          | composite FK prevents it; asserted as prevented |
| **two live decisions for one case**               | **§0.1 — needs the new check**, index dropped to create it |

### 7.1 Where the matrix asks for something that does not exist yet

Three cases have no detection today. B2C-2B adds it, in the refusal direction:

1. **more than one live decision** → `MalformedRowError` (§0.1)
2. **a submission whose stored basis lost a required-work row** — the aggregate
   hydrates into a submission claiming less work than the firm required.
   Detectable only against the stored row count, so the check is "the child rows
   read equal the child rows the parent's basis implies" where that is knowable;
   where it is not, the case is recorded as **undetectable and why**, rather than
   given a test that passes for the wrong reason.
3. **a return with no concerns, or a concern for another revision** — a return
   must state at least one concern, and every concern's subject must belong to
   the return's case.

**A distinction the matrix makes explicit.** Many rows above are *prevented by
the schema*, not *refused by the mapper*. Both are correct outcomes and neither
is a gap — but a test that asserts "this cannot be inserted" is proving
something different from one that asserts "this is refused on read", and the
matrix labels which is which rather than blurring them.

---

## 8 · The full query-budget matrix (B2C-2B)

Every public method, measured at **1** and at **25** of the relevant child
collection, required identical. Existing budgets carried forward; any correction
reported explicitly.

| Method                              | Budget | Varied by                                   |
| ----------------------------------- | ------ | ------------------------------------------- |
| `submissions.save` (new / replay)   | 7 / 5  | required work · disagreements · evidence · open challenges |
| `submissions.get`                   | 6      | same                                        |
| `submissions.listForCase`           | 6      | same, plus number of submissions            |
| `submissions.applicableForRevision` | 6      | same                                        |
| `submissions.pending`               | 6      | same                                        |
| `submissions.settle`                | 2      | number of submissions settled               |
| `submissions.recordReturn`          | 5      | concerns                                    |
| `submissions.getReturn`             | 2      | concerns                                    |
| `submissions.returnsForCase`        | 2      | concerns · number of returns                |
| `submissions.returnsForRevision`    | 2      | same                                        |
| `decisions.save` (new / replay)     | 9 / 5  | submissions · dissent · evidence · triggers |
| `decisions.save` (first supersession) | 12   | same                                        |
| `decisions.get` / `getForCase`      | 5      | same                                        |
| `decisions.historyForCase`          | 5      | **history length** — 1 vs 25 decisions on one case |
| `decisions.listRecent`              | 5      | number of live decisions                    |

**Not optimised for smallness.** Correctness and fixed batching are the
properties; a lower count bought by merging unrelated hydration would weaken
mapping clarity or error attribution, and §0.1 is a reminder of what a
too-clever read costs.

## 9 · Transaction and connection cleanup (B2C-2B)

| Property                                                    | How                                      |
| ----------------------------------------------------------- | ---------------------------------------- |
| an internal unit of work commits and releases                | backend count before/after N operations   |
| a failed unit of work rolls back and releases                | after a rejected save                     |
| an operation inside an outer transaction reuses that client  | one connection observed for the whole callback |
| a joined operation does not release the caller's client      | the caller's transaction still works after |
| outer rollback removes every repository write                | already partly covered; extended to all three ports |
| outer commit preserves every write                           | same                                      |
| an escaped scoped repository is still refused                | `TransactionClosedError`                  |
| replay and conflict errors leave no open transaction         | backend count after 20 conflicts          |
| a malformed-row read releases its client                     | backend count after 20 refusals           |
| `close()` is idempotent                                      | landed in B2C-1; **not repeated here**    |
| reads and writes after close fail predictably                | landed in B2C-1                           |
| repeated operations do not grow `pg_stat_activity`           | measured before and after                 |

**The `close()` idempotency work is not duplicated.** It landed in B2C-1 as a
justified dependency — the construction-failure test could not prove cleanup
without it — and B2C-2 references it rather than re-testing it.

## 10 · Submission-reference path inventory (B2C-2B)

Rule 13 stays module-level. Beside it, a behavioural check on **every public
path that accepts or rebuilds a submission**:

| Path                                     | Wrong-case | Wrong-revision |
| ---------------------------------------- | ---------- | -------------- |
| `submissions.save`                        | rejected   | rejected       |
| `submissions.get`                         | rejected on hydration | rejected |
| `submissions.listForCase`                 | rejected   | rejected       |
| `submissions.applicableForRevision`       | rejected   | rejected       |
| `submissions.pending`                     | rejected   | rejected       |
| `submissions.save` replay read-back       | rejected   | rejected       |
| `decisions.save` structural submission read | rejected | rejected       |

Branch-level static proof is **not** claimed. The rule covers the module, the
table covers the paths, and the plan says which is which.

---

## 11 · Risks

**R16 — the §0.1 change is a behaviour change inside a hardening stage.** Small,
in the refusal direction, and flagged rather than absorbed. *Mitigation:* it is
listed as a change in the exit report, not as a test.

**R17 — dropping a unique index to manufacture corruption weakens the database
the test runs against.** *Mitigation:* that case runs in a database the suite
discards; the index is never restored and never dropped in a shared one.

**R18 — the parity pin is two independent checks, not a comparison.** If both
adapters drifted identically the pin would still pass. *Mitigation:* the pin is
a literal list in the shared module, so drifting identically means editing the
list, which is visible.

**R19 — "missing child row" may prove undetectable** (§7.1). *Mitigation:*
recorded as undetectable with the reason, rather than given a test that passes
for the wrong reason.

## 12 · Technical debt

**Opened:** possibly one, if §7.1 case 2 proves undetectable — a submission
whose basis lost a child row would hydrate as a smaller but internally
consistent basis. It would be recorded with the exact shape and what would be
needed to detect it (a stored child count, or a content hash over the basis).

**Unchanged:** TD-57 · TD-55 · TD-52 · R6 · TD-43 · TD-50–54 · TD-41–44 · TD-46 ·
TD-34–37 · TD-39 · TD-8. **TD-56 stays closed.**

**Contract versions:** command **2**, domain **8**.

---

## 13 · What I need decided before B2C-2A

1. **The §0.1 detection.** Adding "more than one live decision is a
   `MalformedRowError`" is a behaviour change in a hardening stage. Confirm, or
   tell me to leave the read as it is and record the gap instead.
2. **Two stages.** 2A durability and parity; 2B refusal and bounds. Confirm, or
   collapse to one.
3. **`evaluatedAt` compared rather than excluded** (§3) — it is stored
   institutional state here, unlike in the earlier harness that recomputed it.
   Confirm.

Everything else I am prepared to build as written.
