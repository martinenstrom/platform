# C1D-1B stage B2C-2B — refusal, bounds and cleanup

**Planning gate. No implementation.**

B2C-2A proved the layer survives a restart and reloads only from PostgreSQL.
B2C-2B proves it **refuses malformed stored state, stays bounded regardless of
child volume, and releases every client it takes.**

It also carries three additions to the restart suite that the B2C-2A review
asked for. They are B2C-2A-shaped, but the instruction was planning-gate-only,
so they are planned here rather than written — §1.

---

## 0 · The mechanical determination you asked for

### 0.1 A missing required-work row is **not detectable**. It is a representational gap.

Answered against the schema rather than by judgement:

| Question                                                        | Answer |
| --------------------------------------------------------------- | ------ |
| Is there a declared expected set or count on the submission?      | **No.** `cio_submissions` has no count, manifest or hash column — checked. |
| Can the mapper know which row should exist?                       | **No.** `submission_required_work` rows are the entire representation. |
| Is required-work completeness represented independently?          | **No.** Only as the rows themselves. |
| Can the absence be distinguished from a valid empty set?          | **No.** Zero required-work rows is a legitimate basis. |

A submission whose basis lost a required-work row hydrates into a **smaller but
internally consistent** submission. Nothing in the stored representation
distinguishes "the firm required one piece of work" from "the firm required two
and one row was deleted".

The only source of "which entries should be required" is the playbook's
requirement levels — and deriving completeness from those is
`requirementStatusFor`, a domain computation. A repository doing it would be
recalculating a gate result, which is the one thing this layer has consistently
refused to do.

**So there is no test.** Writing one that passes would mean asserting something
the database cannot tell us, which is worse than the gap.

### 0.2 TD-58, and what would close it

> **TD-58 · A CIO submission is not self-validating against row deletion.**
> Deleting a `submission_required_work`, `submission_disagreements`,
> `submission_evidence` or `submission_open_challenges` row produces another
> apparently valid submission. Hydration cannot detect it, and the audit risk is
> that a submission can be made to claim the firm required less work than it did
> — silently, and in the direction that makes eligibility look better.

Three ways to close it, in increasing order of what they buy:

1. **An expected count per child table.** Cheapest; detects deletion, not
   substitution.
2. **The exact referenced identity set**, stored once. Detects deletion and
   substitution; duplicates the child rows.
3. **A basis manifest or semantic hash** — one immutable column over the
   canonical basis. Detects deletion **and** unexpected extra rows, in one
   value, and composes with the existing `cioSubmissionSemanticKey`.

I lean to (3), because it is the only one that catches a row being *added*, and
because the canonicalisation already exists. But it is a schema and domain
decision — a new column, a migration, and a rule about when the manifest is
computed — and **B2C-2B does not take it**. It belongs to a focused gate.

Until then the malformed matrix records the case as *not detectable*, and no
document describes a submission as fully self-validating.

---

## 1 · Carried from the B2C-2A review

Three additions, planned here and implemented first in B2C-2B.

### 1.1 Restart idempotence — hydration is deterministic

A second scenario in `c1d1Restart.pg.test.ts` where the reconstructed runtime
**writes nothing**:

- reload the complete canonical projection twice, through the same container
- assert the two projections are identical
- reload a third time through a **third** container and assert the same again
- assert no statement in either reload was a write, by counting through the
  metrics hook

B2C-2A proved durability by writing after the restart. This proves **hydration
itself is deterministic** — that reading twice cannot produce two different
aggregates from one stored state, which is a different property and the one a
read model depends on.

### 1.2 Canonical ordering, asserted rather than assumed

B2C-2A compared aggregates with deep equality. That passes if insertion order
happens to match, which is exactly the accident this project has been removing.
Every child collection gets an **explicit order assertion**, and the rule is
documented beside it:

| Collection                  | Ordering rule                                            | Where enforced |
| --------------------------- | -------------------------------------------------------- | -------------- |
| submissions for a case      | `submitted_at`, then `id` byte order                      | SQL `ORDER BY` |
| returns for a case          | `returned_at`, then `id` byte order                       | SQL |
| return concerns             | `ordinal` — the caller's order **is** the meaning         | SQL; ordinal is part of the primary key |
| decision relations          | `revision_id` byte order                                  | SQL |
| dissent                     | `ordinal`                                                 | SQL; ordinal in the primary key |
| dissent evidence refs       | `ordinal`, then `evidence_set_id`, then `observation_id`, all byte order | SQL — the table has **no** ordinal of its own, so the mapper imposes a total order |
| reconsideration triggers    | `ordinal`                                                 | SQL |
| decision history            | `decided_at`, then `decision_id` byte order               | SQL |
| required work / disagreements / evidence / open challenges | their own natural key, byte order | SQL |

Each asserted with **at least three entries**, deliberately inserted out of
order, so a collection that came back in insertion order fails.

### 1.3 Provenance — catalogue identity moves, institutional state does not

The negative control the review asked for, and the sharpest statement of the
separation:

1. write institutional state and capture the canonical projection
2. construct a runtime whose catalogue differs by **one added statement** —
   through a test-only catalogue passed to `catalogHash`, never by editing the
   production registry
3. assert `queryCatalogHash` and `provenanceId` both **differ**
4. assert the canonical institutional projection is **byte-identical**

Repository identity and business state are different things, and this is the
test that says so in one place.

---

## 2 · The malformed-row matrix

Every case carries its **enforcement level**, never collapsed into "covered":

| Level | Meaning |
| ----- | ------- |
| **S** | prevented by the schema — cannot be inserted, even by the owner |
| **P** | prevented by runtime-role permissions — the owner can, `finos_app` cannot |
| **H** | accepted only through privileged corruption, **refused on hydration** |
| **N** | not detectable from the persisted representation |

**A test that fails during corrupt insertion does not prove mapper refusal.** An
**H** case must successfully create the malformed stored state first, then read
it; the test asserts both halves. An **S** case asserts the insertion is refused
and does not pretend to exercise the mapper.

### 2.1 Submissions

| Corruption | Level | How produced | Expected |
| ---------- | ----- | ------------ | -------- |
| verification review for another revision | H | owner inserts a submission citing a sibling revision's review | `MalformedRowError` from `get`, `listForCase`, `applicableForRevision`, `pending` |
| Devil's Advocate challenge from another review | H | owner inserts an `submission_open_challenges` row for a foreign challenge | `MalformedRowError` |
| Risk review for another revision | H | as above | `MalformedRowError` |
| unknown eligibility policy version | S | FK to `eligibility_policies` | insertion refused |
| actor snapshot with an impossible authentication | H | owner sets `authentication = 'authenticated'` | `MalformedRowError` from `toActor` |
| Risk requirement `unresolved` | S | CHECK `cio_submissions_risk_resolved` | insertion refused |
| dangling provenance reference | S | FK | insertion refused |
| a deleted required-work row | **N** | — | §0.1; no test, TD-58 |

### 2.2 Returns

| Corruption | Level | How produced | Expected |
| ---------- | ----- | ------------ | -------- |
| a return with no concerns | H | owner deletes the concern rows | **needs the check** — §2.4 |
| concern for a revision that is not the return's | H | owner rewrites `subject_id` | **needs the check** — §2.4 |
| invalid actor snapshot | H | owner rewrites `authentication` | `MalformedRowError` |
| `returned_for` outside the vocabulary | S | CHECK | insertion refused |
| concern `subject_kind` outside the vocabulary | S | CHECK | insertion refused |

### 2.3 Decisions

| Corruption | Level | How produced | Expected |
| ---------- | ----- | ------------ | -------- |
| `selected` with zero selected relations | H | owner flips the relation after commit, constraints deferred within one transaction | `MalformedRowError` from `outcomeFromRows` |
| `selected` with two selected relations | S | partial unique index `decision_submissions_one_selected` | insertion refused |
| `deferred` with a selected relation | H | owner writes both in one transaction | `MalformedRowError` |
| `deferred` with no trigger | S | deferred outcome guard at COMMIT | insertion refused |
| `declined` leaving a revision unaccounted for | S | deferred outcome guard | insertion refused |
| relation naming another case or revision | S | the two composite FKs | insertion refused |
| dissent materiality outside the vocabulary | S | CHECK | insertion refused |
| dissent evidence citing a missing observation | S | composite FK to `evidence_items` | insertion refused |
| quantitative trigger with no unit | S | CHECK `triggers_quantitative_complete` | insertion refused |
| supersession link to another case | S | composite FK | insertion refused |
| supersession cycle | S | deferred cycle guard | insertion refused |
| **two live decisions** | H | index dropped, database destroyed | **landed in B2C-2A** |

### 2.4 Two checks B2C-2B adds

Both in the refusal direction, both reported as changes rather than tests:

1. **A return must state at least one concern.** A return exists to send work
   back; one that says nothing is an instruction nobody can act on. Refused in
   `validateCioReturn` — which already refuses a blank reason — and therefore
   refused on hydration too.
2. **Every concern's subject must belong to the return's case.** Structural
   ownership, the same shape as `validateSubmissionReferences`, and checkable
   because a concern names a `subject_kind` and a `subject_id`.

For every **H** case: bounded error, **no partial aggregate**, **no silent
repair** — the corrupt row asserted still present and unchanged afterwards — and
no SQL, parameter, constraint name or PostgreSQL detail in the message.

---

## 3 · The full query-budget matrix

Every public method, at **one** child row and at a **representative larger
volume** (25, and 25 decisions for history length). Counts must be identical.

| Method | Budget | Varied independently by |
| ------ | ------ | ----------------------- |
| `submissions.save` (new) | 7 | required work · disagreements · evidence · open challenges |
| `submissions.save` (replay) | 5 | same |
| `submissions.get` | 6 | same |
| `submissions.listForCase` | 6 | same · number of submissions |
| `submissions.applicableForRevision` | 6 | same |
| `submissions.pending` | 6 | same |
| `submissions.settle` | 2 | number settled |
| `submissions.recordReturn` | 5 | concerns |
| `submissions.getReturn` | 2 | concerns |
| `submissions.returnsForCase` | 2 | concerns · number of returns |
| `submissions.returnsForRevision` | 2 | same |
| `decisions.save` (new) | 9 | considered submissions · dissent · evidence per dissent · triggers |
| `decisions.save` (replay) | 5 | same |
| `decisions.save` (first supersession) | 12 | same |
| `decisions.save` (supersession replay) | **to be measured** | same |
| `decisions.save` (supersession conflict) | **to be measured** | same |
| `decisions.get` | 5 | same |
| `decisions.getForCase` | 5 | same |
| `decisions.historyForCase` | 5 | **history length** — 1 vs 25 decisions on one case |
| `decisions.listRecent` | 5 | number of live decisions |

Two are marked *to be measured* rather than guessed: the supersession replay and
conflict paths take different branches through the zero-row disambiguation, and
I would rather report the measured number than pin an estimate and quietly edit
it later.

**`getForCase` stays at 5.** The multiple-live detection reads at most two roots
in the same statement it already issued — no statement added. Stated here
because the review asked for it explicitly if it had changed.

Not optimised for smallness: correctness and fixed batching are the properties.

---

## 4 · Transaction and connection cleanup

| Property | How measured |
| -------- | ------------ |
| an internal unit of work commits and releases | backend count before and after 20 operations |
| a failed unit of work rolls back and releases | after 20 rejected saves |
| an operation inside an outer transaction reuses the caller's client | one backend observed for the whole callback |
| a joined operation does not release the caller's client | the caller's transaction still works afterwards |
| outer rollback removes every write, across all three ports | submissions, returns and decisions all absent |
| outer commit preserves every write | all present |
| an escaped scoped repository is refused | `TransactionClosedError` |
| replay and conflict errors leave no open transaction | backend count after 20 conflicts |
| a malformed-row read releases its client | backend count after 20 refusals |
| repeated operations do not grow `pg_stat_activity` | measured across the whole file |

`close()` idempotency and post-close failure are **assumed**, not retested —
they landed in B2C-1 as a justified dependency.

## 5 · Submission-reference coverage on every public path

Rule 13 stays module-level. Beside it, behavioural coverage:

| Path | wrong-case | wrong-revision |
| ---- | ---------- | -------------- |
| `submissions.save` | rejected before SQL | rejected before SQL |
| `submissions.get` | rejected on hydration | rejected |
| `submissions.listForCase` | rejected | rejected |
| `submissions.applicableForRevision` | rejected | rejected |
| `submissions.pending` | rejected | rejected |
| `submissions.save` replay read-back | rejected | rejected |
| `decisions.save` structural submission read | rejected | rejected |

Branch-level static proof is **not** claimed.

---

## 6 · Files

| File | What |
| ---- | ---- |
| `postgres/c1d1Restart.pg.test.ts` | §1.1 idempotence · §1.2 ordering · §1.3 provenance control |
| `postgres/c1d1Malformed.pg.test.ts` | the matrix, grouped by enforcement level |
| `postgres/c1d1Resources.pg.test.ts` | transaction and connection cleanup |
| `postgres/queryCount.pg.test.ts` | the complete budget matrix |
| `domain/analysis/aggregateValidation.ts` | the two §2.4 return checks |
| `docs/technical-debt.md` | TD-58 |

## 7 · Risks

**R20 — the two §2.4 checks are behaviour changes in a hardening stage.** Small,
in the refusal direction, reported as changes. *Mitigation:* both are shared
validator rules, so memory and PostgreSQL refuse identically and the shared
contract covers them.

**R21 — several H cases need constraints deferred within one transaction to
produce.** A corruption that cannot be created is a test that proves nothing.
*Mitigation:* each H case asserts the malformed state exists before reading it;
any that turns out unreachable is reclassified **S** and reported, not quietly
dropped.

**R22 — TD-58 leaves a real audit gap open.** A submission can be made to claim
less required work than the firm demanded. *Mitigation:* recorded plainly, with
the three closure options and a recommendation; no document may describe a
submission as self-validating while it stands.

## 8 · Technical debt

**Opened:** **TD-58** (§0.2).
**Unchanged:** TD-57 · TD-55 · TD-52 · R6 · TD-43 · TD-50–54 · TD-41–44 · TD-46 ·
TD-34–37 · TD-39 · TD-8. **TD-56 stays closed.**

**Contract versions:** command **2**, domain **8** — the §2.4 checks add rules,
not stored shapes.

---

## 9 · What I need decided before B2C-2B

1. **The two §2.4 return checks** — a return must state at least one concern,
   and every concern's subject must belong to the return's case. Both are
   behaviour changes; confirm, or tell me to record them as gaps instead.
2. **TD-58 opened rather than closed here.** Confirm the manifest/hash approach
   is a separate focused gate and not something to fold into B2C-2B.
3. **One stage.** §1's carried items plus the matrix plus budgets plus cleanup
   is a large commit; I can split it as 2B-1 (carried restart items + malformed
   matrix) and 2B-2 (budgets + cleanup) if you would rather. I lean to **one**,
   because the carried items are small and the rest divides badly.

Everything else I am prepared to build as written.


---

## 15 · The malformed-state classification, retained

Approved and kept as four categories. **They are never collapsed into a
generic "covered" count** — each proves something different, and a single
number would hide which.

| Category | What a passing test proves |
| -------- | -------------------------- |
| **H** — privileged corruption refused on hydration | **repository read integrity.** The malformed state was created successfully and the mapper refused to return it. |
| **S** — schema-prevented | **database integrity, not mapper behaviour.** The insert failed; hydration was never reached, and no claim is made about it. |
| **P** — runtime-permission prevented | **the production role cannot create the state at all.** |
| **N** — not detectable | nothing is proven, and the test says so. Currently: TD-58. |

### Recorded limitation — deferred relations

`decisionFromRows` does **not** independently detect a deferred decision
carrying a selected relation. It builds the considered set and ignores
relations, because a deferral selects nothing by definition.

The normal schema prevents the state — a CHECK ties `outcome_kind` to
`selected_revision_id`, and `decision_outcome_guard` refuses the relation set at
COMMIT — and the runtime cannot bypass either. **No mapper-level protection is
claimed.**

A later storage-import, disaster-recovery or forensic tool that can write past
those constraints must validate the full relational outcome independently before
accepting the data. The limitation is recorded in `decisionMapping.ts` beside
the code it describes.
