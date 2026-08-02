# Phase C1D-1 — the CIO decision, revised

**Status:** planning gate, revision 2. Nothing implemented.

Supersedes §1–§7 of [phase-c1d-plan.md](phase-c1d-plan.md) for stage 1. The
headquarters read model (C1D-2) is unchanged and stays in that document.

This revision folds in the eleven findings from the design review and the
resolutions approved with them. Four would have forced a redesign after
implementation; two would have put a fabricated fact in the decision record.

**One item in the amendment contradicts itself** — see §12. It is the only open
question.

---

## 1 · Decision outcome

Explicit union. No nullable field decides anything.

```ts
export type CioDecisionOutcome =
  | {
      kind: 'selected'
      /** Exactly one. Must also appear in `consideredRevisionIds`. */
      selectedRevisionId: RevisionId
      /** Everything formally in front of the CIO, including the selected one. */
      consideredRevisionIds: readonly RevisionId[]
    }
  | {
      kind: 'deferred'
      consideredRevisionIds: readonly RevisionId[]
      selectedRevisionId?: never
    }
  | {
      kind: 'declined'
      /** Must equal `consideredRevisionIds` — see below. */
      declinedRevisionIds: readonly RevisionId[]
      consideredRevisionIds: readonly RevisionId[]
      selectedRevisionId?: never
    }
```

**`notSelectedRevisionIds` is gone.** It is `considered` minus `selected`, and
storing both invites them to disagree. The relational table (§3) still writes a
`not-selected` relation per revision, derived at write time.

**`reconsiderationTriggers` stays on `CaseDecision`, not inside the deferred
arm** — a departure from the sketch, and deliberate. A _selected_ decision has
reconsideration conditions too; that is most of the value of the record. What
is specific to a deferral is that it must have **at least one**, which
`buildDecision` enforces rather than the type.

**For `declined`, the two lists must be identical.** A revision that was
considered and neither selected nor declined is an alternative the record
cannot account for. This makes one deliberate limitation explicit: **a decision
carries one outcome**. The CIO cannot decline two revisions and defer on a
third in a single record; that is two decisions, or a deferral with the
declines stated in the rationale. Recorded as TD-54.

### Domain refusals in `buildDecision`

| Condition                                                       | Refusal  |
| --------------------------------------------------------------- | -------- |
| no rationale, no evidence set                                   | existing |
| `selected` names a revision not in `considered`                 | new      |
| `selected` revision superseded, or not eligible                 | existing |
| `deferred` with zero considered revisions                       | new      |
| `deferred` with zero reconsideration triggers                   | new      |
| `declined` where declined ≠ considered                          | new      |
| a considered revision with no submission among those referenced | new      |
| material dissent with no acknowledgement                        | new      |
| an eligibility basis carrying any blocker                       | new      |

---

## 2 · Case stages

Four institutionally distinct states, none inferred from a related record.

| Stage      | Means                                           |
| ---------- | ----------------------------------------------- |
| `decision` | submitted; awaiting CIO action                  |
| `decided`  | a completed decision — `selected` or `declined` |
| `deferred` | the CIO formally chose to wait                  |
| `returned` | the material was not ready, and was sent back   |

### Transition table

```
review    -> decision, returned, blocked, withdrawn        (unchanged)
decision  -> decided, deferred, returned, blocked, withdrawn
decided   -> withdrawn                          (published is not C1D)
deferred  -> decision, withdrawn
returned  -> research, aggregation, withdrawn              (unchanged)
```

**`deferred -> decision` is declared and untaken in C1D-1.** No command performs
it; the reconsideration command is TD-50. Declaring it now keeps the table a
statement of what is legal rather than of what happens to be implemented — and
**a test asserts that no C1D-1 command takes it**, so the gap is visible rather
than assumed.

**`decided -> decided` is not a transition.** A superseding decision does not
move the case; it replaces the live decision while the stage stays `decided`.
`deferred -> decided` is one, and it is how a superseding decision converts a
deferral into a position.

**Second competing revision.** `SubmitForCioDecision` accepts a case in `review`
**or** `decision`. The first submission moves the case; the second finds it
already in `decision` and moves nothing. Without this, competing theses could
not both reach the CIO — which is the model's whole point.

### Touch list

The domain transition table · `CASE_STAGES` in `mapping.ts` · the
`cases_stage_known` CHECK · case health (§6) · every command's legal-state rule
· the timeline and event mapping · every test that pins a stage.

---

## 3 · Schema — migration 0020

### Submissions

`analysis.cio_submissions` as previously planned, and it is **the sole home of
the eligibility basis**. Two additions the composite foreign keys below need:

```sql
UNIQUE (id, case_id)
UNIQUE (id, revision_id)
```

### Decisions

`case_decisions` keyed on `decision_id`. **The fifteen basis columns are gone**
(B4), along with `governance`, `unresolved_dissent` and
`reconsideration_triggers` jsonb. What remains is the decision's own facts: the
outcome kind, the selected revision, the actor snapshot, the rationale, the
evidence set, and the supersession links.

```sql
supersedes_decision_id    text,
superseded_by_decision_id text,

CONSTRAINT case_decisions_supersedes_fk
    FOREIGN KEY (supersedes_decision_id)
    REFERENCES analysis.case_decisions (decision_id)
    DEFERRABLE INITIALLY DEFERRED,
CONSTRAINT case_decisions_superseded_by_fk
    FOREIGN KEY (superseded_by_decision_id)
    REFERENCES analysis.case_decisions (decision_id)
    DEFERRABLE INITIALLY DEFERRED
```

Both deferred, which is what lets the write order be **update the prior
decision, then insert the new one** (B2). The partial unique index is
unchanged and is not weakened:

```sql
CREATE UNIQUE INDEX case_decisions_one_live_per_case
    ON analysis.case_decisions (case_id)
    WHERE superseded_by_decision_id IS NULL;
```

Ordering matters: updating first means the old row leaves the partial index
before the new one enters it, so at no point do two rows satisfy the predicate.
A deferred FK is required because at that instant the successor does not exist.

### The decision's submissions

```sql
CREATE TABLE analysis.decision_submissions (
    decision_id   text NOT NULL REFERENCES analysis.case_decisions (decision_id),
    submission_id text NOT NULL REFERENCES analysis.cio_submissions (id),
    case_id       text NOT NULL,
    revision_id   text NOT NULL,
    relation      text NOT NULL,

    PRIMARY KEY (decision_id, revision_id),

    -- The submission belongs to this case...
    FOREIGN KEY (submission_id, case_id)
        REFERENCES analysis.cio_submissions (id, case_id),
    -- ...and targets exactly the revision this row names.
    FOREIGN KEY (submission_id, revision_id)
        REFERENCES analysis.cio_submissions (id, revision_id),

    CONSTRAINT decision_submissions_relation_known CHECK (
        relation IN ('selected', 'not-selected', 'declined', 'considered')
    )
);
```

Every constraint the amendment asked for is structural rather than checked in
code:

| Requirement                                 | Enforced by                                     |
| ------------------------------------------- | ----------------------------------------------- |
| every submission belongs to the same case   | composite FK on `(submission_id, case_id)`      |
| every submission targets the exact revision | composite FK on `(submission_id, revision_id)`  |
| no contradictory relations for one revision | `PRIMARY KEY (decision_id, revision_id)`        |
| exactly one selected revision               | partial unique index on `relation = 'selected'` |
| deferred and declined select none           | the outcome CHECKs on `case_decisions`          |

```sql
CREATE UNIQUE INDEX decision_submissions_one_selected
    ON analysis.decision_submissions (decision_id)
    WHERE relation = 'selected';
```

**`decision_revisions` is dropped.** It said less than this table and would be a
second answer to the same question.

### Dissent and triggers

`decision_dissent` unchanged from the draft. `decision_reconsideration_triggers`
loses `active` (§5) and gains a per-row `policy_version` that is **written from
each trigger**, never from the first (S2). Quantitative conditions gain a
database-level requirement to carry a unit:

```sql
CONSTRAINT triggers_quantitative_states_unit CHECK (
    condition_type <> 'quantitative-threshold'
    OR (threshold_amount IS NOT NULL AND threshold_unit IS NOT NULL)
)
```

### Returns

`cio_returns` **loses its `state` column** (§5). It is an immutable record of
requested work; whether it has been addressed is derived.

### Grants

INSERT and SELECT everywhere. The only UPDATE grants:
`cio_submissions.state`, `case_decisions.superseded_by_decision_id`. Nothing
else in this migration is mutable — and every column that used to advertise a
lifecycle nothing owned is gone.

---

## 4 · No fabricated governance (B4)

`DecisionGovernanceSnapshot` is **deleted**. Every legitimate field is reachable
through the submissions the decision references, by review id rather than by
bare status — which is strictly more, because a status without its review
cannot be traced to its findings.

Compliance is **not stored, not reconstructed, and not defaulted**. There is no
compliance verdict, and `compliance: 'not-required'` would state that a control
function decided review was unnecessary. Nobody decided that.

**What a reader in 2030 uses instead:** `eligibilityPolicyVersion`. Version `1`
is documented as the internal CIO-decision gate, comprising Verification, the
Devil's Advocate and the conditional Risk requirement — **and not Compliance**.
The absence is a property of the gate, recorded once where it is true, rather
than a per-decision claim that would be false.

A fitness rule with a planted violation: nothing under `domain/analysis/` or
`infrastructure/analysis/` may assign a compliance status literal to a decision
field.

---

## 5 · Derived, not stored

Three fields the draft declared mutable that no command owned. All three become
derived; none survives as a column.

| Was                          | Now                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `trigger.active`             | a trigger is active when it belongs to the **live** decision                                       |
| `cioReturn.state`            | a return is addressed when a later submission exists for that revision, submitted after the return |
| `DecisionGovernanceSnapshot` | read through the referenced submissions                                                            |

**Trigger identity.** Ids stay derived from the command and are stable within
the decision that created them. A superseding decision legitimately restates its
conditions and mints new ids; the historical triggers stay immutable and
readable on the superseded decision. A future monitor evaluates **only the live
decision's triggers**, which is what makes double-firing impossible without a
lineage concept. If continuity across decisions is ever needed it gets an
explicit `supersedesTriggerId` and a design — recorded as TD-52 rather than
smuggled in by treating command-derived ids as globally stable.

---

## 6 · Case health

Six decision-related states, each mechanically defined, evaluated in order
before the existing `critical`/`blocked`/`waiting`/`healthy` rules:

| State           | Definition                                                               |
| --------------- | ------------------------------------------------------------------------ |
| `returned`      | stage is `returned`, or a return exists that no later submission answers |
| `deferred`      | stage is `deferred`                                                      |
| `decided`       | stage is `decided` and the live decision's outcome is `selected`         |
| `declined`      | stage is `decided` and the live decision's outcome is `declined`         |
| `awaiting-cio`  | stage is `decision` and a `pending` submission exists                    |
| `ready-for-cio` | a revision is eligible and no submission exists for it                   |

A deferred case can no longer read as `healthy`, `ready-for-cio` or
`awaiting-cio` — the three ways the draft would have misdescribed it.

---

## 7 · Revision lifecycle (B3)

The decision moves the revisions it decided, **in the same transaction**.

| Outcome    | Revision transitions                                           |
| ---------- | -------------------------------------------------------------- |
| `selected` | selected → `selected`; every other considered → `not-selected` |
| `declined` | every declined → `not-selected`                                |
| `deferred` | **none** — the revisions stay `verified` and decision-ready    |

The deferred row is the one that matters: marking a revision `not-selected`
because the CIO chose to wait would record a rejection that never happened.

`SubmitForCioDecision` refuses a revision whose lifecycle is `selected` or
`not-selected`. Without that, `evaluateRevisionEligibility` keeps reporting a
decided revision as eligible and the CIO queue never empties.

`selected` and `not-selected` are existing `ThesisLifecycleState` values with
existing legal transitions from `verified`. No vocabulary changes.

---

## 8 · A live decision protects its revision (D5)

While a decision is live and its outcome selected a revision of a lineage, no
command may mint a new revision of that lineage:

- `AggregateManagerConclusion` — refused
- `ReviseThesis` — refused
- `ProposeThesis` — **unaffected**, because it opens a new lineage, and a
  decision on lineage A says nothing about lineage B

**This modifies two approved C1C-3 commands**, which is the largest risk in this
plan and is called out as such in §13. Each gains one read — the live decision
for the case — and one refusal. A fitness rule with a planted violation asserts
that every revision-minting command performs the check.

The exit is an explicit reopening, which C1D-1 does not build: **TD-50**.

---

## 9 · Commands

Unchanged in shape from the approved plan except where the findings moved them.

### `SubmitForCioDecision`

Category `workflow`, mandate `department-manager`, reason optional,
**version-guarded**. Result `resultKind: 'cio-submission'`.

Added refusals: revision lifecycle is `selected` or `not-selected`; a pending
submission already exists for this revision; the lineage is governed by a live
decision. Accepts stage `review` or `decision` (§2).

Writes: submission and its basis rows · `review → decision` on the first
submission only · events.

### `RecordCaseDecision`

Category `decision`, mandate `chief-decision`, reason **required**,
version-guarded, **system actor refused**. Result `resultKind: 'decision'`,
`resultRef: decisionId`.

**Input** takes `submissionIds: readonly string[]` — one per considered
revision — plus the outcome, rationale, dissent and triggers.

Added rules:

- every revision in the outcome has exactly one submission among those given
- every submission is `pending`, **or** already referenced by the decision being
  superseded — a correction reuses the basis it is correcting, which is the
  point of a correction
- all referenced submissions settle to `decided`, including on a deferral: the
  CIO acted, so the queue item is gone until a reconsideration creates a new one

Writes, one transaction: prior decision's `superseded_by` **then** the new
decision (B2) · `decision_submissions` · dissent · triggers · submission states
· revision lifecycles (§7) · case stage → `decided` or `deferred` · events.

### `ReturnFromCioReview`

Category `workflow`, mandate `chief-decision`, reason **required**,
version-guarded. Creates no assignment, and now no mutable state either.

Writes: return and its concerns · submission → `returned` · case
`decision → returned` · events.

**Heavy path confirmed (D4).** A returned case re-enters research or
aggregation and runs governance again. No bypass around Verification and the
Devil's Advocate, even for `alternative-not-considered`. Differentiated return
types with a shorter audited path are **TD-51**.

---

## 10 · Actor snapshots (S3)

`departmentHandles` is canonically sorted **where the snapshot is built**, in
`authorize`, so every consumer — the ledger, the decision, the return, the
restart comparison — sees one order. Byte order, not locale, matching every
other ordering in the adapter.

Verified while reviewing: the actor snapshot does **not** enter the payload hash
today, so command identity is unaffected. Canonicalising at construction keeps
it that way if it ever does.

---

## 11 · Decision reads (S4)

Two distinct semantics, neither hiding anything:

| Query                    | Returns                                               |
| ------------------------ | ----------------------------------------------------- |
| `getForCase(caseId)`     | the live decision — `superseded_by IS NULL`           |
| `historyForCase(caseId)` | every decision, oldest first, with supersession links |
| `listRecent(limit)`      | **live decisions only**, newest first                 |

The floor shows live decisions. The case timeline and every audit read show the
complete history including superseded records. Nothing is deleted and nothing
is hidden from audit — the distinction is which question is being asked.

---

## 12 · Open question — `rejectedRevisionIds` contradicts itself

The amendment lists "rejected alternatives where applicable" among the revisions
a decision represents, and separately requires that **every** revision in the
outcome have a valid CIO submission and eligibility basis.

Those cannot both hold. A rejected revision is one a governance gate stopped —
so it was never eligible, so `SubmitForCioDecision` refuses it, so it has no
submission and no basis. The two requirements are satisfiable only by an empty
set.

**Recommendation: drop `rejectedRevisionIds` from the decision.** A revision a
gate stopped never reached the CIO, and listing it on the decision implies it
was considered. Its state is already fully recorded — its own lifecycle, its
blockers, its reviews — and a reader asking "what else was in play" is better
served by the case's revisions than by a field on the decision that means
something different from every other field beside it.

The plan above assumes this. **If you want `rejected` retained**, it must be a
reference with no submission requirement and a relation the composite foreign
keys skip, and I would want it named `not-considered-blocked` so it cannot be
read as an alternative the CIO weighed.

---

## 13 · Risks

| Risk                                                                                         | Response                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| §8 modifies two approved C1C-3 commands                                                      | Smallest possible change — one read, one refusal — with a fitness rule and tests on both; reported in C1D-1D |
| Four new case stages touch the domain table, the CHECK, `CASE_STAGES`, health and many tests | C1D-1A does only this, and is committed and reported before anything depends on it                           |
| Deferred FK plus partial unique index is subtle                                              | Six explicit PostgreSQL tests (§14), including rollback and invalid-target                                   |
| Multi-submission changes the command's relationship to the case stage                        | §2's `review`-or-`decision` rule, with a test for the second competing revision                              |
| `decision_revisions` is dropped and replaced                                                 | No production rows; the guard proves it rather than assuming                                                 |
| A correction reusing `decided` submissions                                                   | Stated rule in §9, with a test                                                                               |

---

## 14 · Tests

Every item the amendment listed, plus what the findings added.

**Outcome and submissions** — decision considering multiple eligible revisions ·
every outcome revision has a submission · a submission from another case refused
· a submission for a different revision refused · selected names exactly one ·
deferred selects none · declined selects none · declined ≠ considered refused ·
one revision with two relations impossible.

**Supersession** — first decision commits · second supersedes atomically · no
point after commit has two live decisions · rollback leaves the original live ·
an invalid supersession target fails at commit · replay creates no second
decision · a correction may reuse the superseded decision's submissions.

**Lifecycle** — selected revision becomes `selected` · alternatives become
`not-selected` · deferred revisions stay decision-ready · selected and
not-selected revisions leave the CIO queue · `SubmitForCioDecision` refuses them
· old reviews and submissions stay auditable · no lifecycle inferred from the
decision table.

**Stages** — `decided` distinct from `decision` · `deferred` distinct from
`decision` · `deferred → decision` legal and taken by no C1D-1 command ·
deferred case health · a second competing revision submits into `decision`.

**Honesty** — no duplicated eligibility basis (fitness rule) · no fabricated
compliance state (fitness rule) · a live decision blocks revision minting ·
returned-state derived, never stored · trigger activity derived from the live
decision.

**Triggers** — quantitative requires a unit, refused in the domain **and** by
the database · each trigger stores its own policy version · a batch with mixed
versions round-trips · a trigger with neither comparator nor stated condition
refused.

**Durability and hygiene** — canonical actor-snapshot ordering across a restart
· recent live decisions exclude superseded ones · complete history retains them
· full restart durability through the C1C-4.1 harness · no LLM · no UI change ·
no publication · no execution.

---

## 15 · Staging

Five units, each committed and reported before the next begins.

| Stage      | Contents                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1D-1A** | outcome union · case stages · dissent · triggers · eligibility policy version · migration 0020 · constraints and grants · domain and schema tests. **No commands.**                 |
| **C1D-1B** | row types · mapping · submission and decision repositories · in-memory parity · supersession · deterministic ordering · live vs historical reads · contract tests. **No commands.** |
| **C1D-1C** | `SubmitForCioDecision` · multi-submission · version guard · case transition · events · idempotency and restart tests                                                                |
| **C1D-1D** | `RecordCaseDecision` · three outcomes · revision lifecycles · supersession · triggers · dissent · **the §8 change to the two C1C-3 commands** · events · restart and race tests     |
| **C1D-1E** | `ReturnFromCioReview` · structured return · heavy path · events · restart tests                                                                                                     |

---

## 16 · Contract versions

**Command contract stays at 2.** Verified rather than assumed: the envelope is
unchanged; `canonicalJson`/`stableHashHex` canonicalisation is unchanged;
`resultKind` was always an open string; `decision` is already a
`CommandCategory` and `chief-decision` already a mandate. No stored vocabulary
gains a value.

**Domain contract 7 → 8.** `CaseDecision` changes shape materially and the case
stage vocabulary grows.

---

## 17 · Technical Debt

**Opened by this plan**

- **TD-50 · No reconsideration command.** `deferred → decision` is legal and
  nothing takes it. A deferred case cannot return to the CIO without one, and
  a live decision cannot be reopened. Required before a deferral means anything
  operationally.
- **TD-51 · Return types are undifferentiated.** Every return takes the heavy
  path. A shorter audited path for `clarification-only` or
  `additional-alternative-requested` needs its own command and mandate.
- **TD-52 · Triggers have no lineage across decisions.** A superseding decision
  restates its conditions with new ids. Fine while a monitor reads only the live
  decision; needs `supersedesTriggerId` if continuity is ever required.
- **TD-53 · Nothing monitors a trigger.** Recorded conditions, no watcher.
  Needs the scheduler TD-34 also needs.
- **TD-54 · One outcome per decision.** The CIO cannot decline two revisions and
  defer on a third in one record.

**Carried** — TD-41 (escalation) · TD-42 (compliance, hard gate before
publication) · TD-43 (correction creates no work) · TD-44 (eligibility derived;
measure first) · TD-46 (review-race at production concurrency) · TD-34, TD-35,
TD-36, TD-37, TD-39, TD-8.

---

Nothing is implemented. Awaiting final approval, and an answer on §12.
