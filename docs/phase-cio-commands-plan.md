# Planning gate · the three CIO commands

**Status:** plan only. Nothing implemented. Approval required before any code.

**Objective:** *The First Defensible Decision* — a case travels from question to
decision, and the whole chain replays.

**Scope:** `SubmitForCioDecision`, `RecordCaseDecision`, `ReturnFromCioReview`,
planned together because they share the authority model, the write-once
semantics and the eligibility path. Specified apart, they would answer the same
questions three slightly different ways.

---

## 0 · What already exists, measured

Taken from the tree, because the amount already built changes what these
commands are.

| Piece | State |
| --- | --- |
| command machinery | **built** — `definition.ts`, `runCommand`, ledger, envelope, payload hash, 14 working commands to pattern-match |
| submission repository | **built** — `get`, `listForCase`, `applicableForRevision`, `pending`, `save`, `settle`, `recordReturn`, `getReturn`, `returnsForCase` |
| decision repository | **built** — `get`, `getForCase`, `historyForCase`, `listRecent`, `save`. **No `supersede()`**: the predecessor is marked and the successor inserted by one `save`, deliberately |
| eligibility evaluation | **built** — `evaluateThesisEligibility` in `domain/analysis/lifecycle.ts` |
| eligibility policy registry | **built** — versioned, `eligibilityPolicy(version)` |
| basis integrity | **built** — manifest written, verified on read, TD-58 closed |
| **basis assembly** | **MISSING.** Nothing in `application/` assembles an `EligibilityBasis` from repositories. This is the substance of `SubmitForCioDecision` |

**The finding that shapes the plan:** these are not three thin handlers over
existing services. Two are thin; `SubmitForCioDecision` contains real work that
exists nowhere yet.

---

## 1 · `SubmitForCioDecision`

### 1.1 What it does

Gathers the eligibility basis from storage, asks the domain whether the revision
is eligible, and either refuses with the reason or writes the submission.

### 1.2 The basis assembly — the new work

Reads, in one transaction: the revision and its thesis; the manager aggregation
that produced it; the playbook and its required entries; the runs satisfying
them; the governance reviews (Verification, Devil's Advocate, Risk) with their
sequences; open challenges; material disagreements; cited evidence-set ids; the
requirement resolution for the conditional Risk rule; and the storage
provenance.

From those it builds `EligibilityBasis`, then `buildBasisManifest`, then
`validateCioSubmission` — which already verifies the witness describes the
basis, so a mis-assembled basis is refused before storage.

**Open question A — where does assembly live?** A command handler is the wrong
home for 150 lines of gathering. Options: an application service
(`assembleEligibilityBasis`) the command calls; or a domain function taking
already-loaded aggregates. **Recommendation: an application service**, because
gathering is repository work and the domain may not read.

### 1.3 Eligibility is decided in the domain

The command gathers and passes; it does not judge. `evaluateThesisEligibility`
returns the blockers, and a fitness rule already enforces this
(`eligibility-decided-only-in-the-domain`). A blocked revision is a
**rejection**, not a failure — `CommandRejectedError` with a bounded code naming
the gate that blocked.

**Open question B — which rejection codes?** They become the vocabulary a PM and
later an agent reads. Proposal: one per gate — `verification-incomplete`,
`challenge-unresolved`, `risk-unresolved`, `required-work-incomplete`,
`disagreement-blocking`, `revision-not-current`, `already-submitted`.

### 1.4 Refusals that are not eligibility

Already submitted and still pending; the revision is superseded; the case is not
in a stage that admits submission; the caller lacks the mandate.

---

## 2 · `RecordCaseDecision`

### 2.1 What it does

Records the CIO's outcome against one or more submissions: the outcome union,
the accountable actor, dissent, reconsideration triggers — and settles the
submissions it decided.

### 2.2 What makes it non-trivial

**Supersession.** A correction supersedes a live decision, and the repository
does this in one `save`, deliberately — there is no `supersede()` a caller could
invoke alone. The command passes `supersedesDecisionId`; the repository and its
deferred constraints do the rest.

**Settlement.** Deciding must settle the submissions in the same transaction, or
a decided case keeps a pending submission. `settle()` exists.

**Dissent survives.** A disclosed dissent is part of the record, not a comment
on it — it is written with the decision and is not editable afterwards.

**Open question C — may one decision cover several submissions?** The schema
supports it (`decision_submissions`). It matters for a case with two competing
revisions. **Recommendation: yes**, since the schema was built for it and
retrofitting the plural later would change identity.

---

## 3 · `ReturnFromCioReview`

### 3.1 What it does

Returns work to the desk with concerns, and settles the submission as returned.

Simplest of the three, and the one that makes the loop real: a case that can only
go forward is not a review process.

**Ruled already:** a return must carry **at least one concern**, and each concern
carries its owner. Both were approved in B2C-2B and are enforced by the
repositories.

**Open question D — does a return reopen the case stage, or is that separate?**
Proposal: the return settles the submission and records the concerns; any case
stage change is its own transition, so a return does not silently move the case.

---

## 4 · Shared across all three

### 4.1 Authority

Each declares a `mandate` and a `category`, cross-checked at execution.

**Open question E — what mandate does each require?** Proposal: submission is a
desk act (research mandate); decision and return are **CIO acts** and must
refuse a caller without that authority. This is the single most important
rejection in the group — a decision recorded by someone without the mandate is
worse than no decision.

### 4.2 Identity and replay

Every record derives its id from the command id, as the existing commands do.
Replay is settled by the ledger: the same command id with the same payload
returns the original; with a different payload it conflicts. The submission's
semantic key already includes the manifest digest, so a changed basis conflicts
rather than silently replacing.

### 4.3 Transactions

One `withTransaction` per command. No handler calls another — composition is a
second command, so every boundary stays visible in the ledger.

### 4.4 Events

Each writes a transition event with a derived id.

**Open question F — one event per command, or per state change?** Proposal: one
per command, since the command is the institutional act.

---

## 5 · The end-to-end proof

The milestone's success criteria as one flow test, run against **both adapters**:
open a case, propose a thesis, instantiate a playbook, record contributions,
record the three reviews (**including a blocking path**), submit and be refused,
fix, submit and succeed, return with concerns, re-submit, decide, record dissent
— then **reload everything and verify every identity, witness and reference**.

Criterion 7 of the milestone — the replay — is what makes this *defensible*
rather than merely functional. It is the test that would fail if any layer built
in this phase were subtly wrong.

---

## 6 · Risks

**R28 — the basis assembly is the whole stage.** §0 shows the other two commands
are thin. If assembly is underestimated, the stage overruns. *Mitigation:* stage
it first and alone (§7).

**R29 — eligibility logic leaking into the command.** The temptation is to
decide in the handler because it has the data. *Mitigation:* the fitness rule
already fails the build; the gathering service returns inputs, never verdicts.

**R30 — a decision recorded without the mandate.** *Mitigation:* §4.1, and a test
per command asserting refusal for an unauthorised caller.

**R31 — the flow test becoming the only real coverage.** An end-to-end test is
slow and vague when it fails. *Mitigation:* each command carries its own unit and
contract coverage; the flow test proves composition, not behaviour.

---

## 7 · Staging

| Stage | Contents |
| --- | --- |
| **A** | basis assembly service + its tests. No command. The largest and least certain piece, sized before anything depends on it |
| **B** | `SubmitForCioDecision` — eligibility refusals, rejection vocabulary, replay |
| **C** | `RecordCaseDecision` — outcome, dissent, triggers, supersession, settlement |
| **D** | `ReturnFromCioReview` — concerns, settlement, re-submission |
| **E** | the end-to-end flow test and replay, both adapters |

Each green and committed separately. **A first**, because if assembly is larger
than §0 suggests, that is worth knowing before three commands depend on it.

---

## 8 · Questions for the gate

| | Question | Recommendation |
| --- | --- | --- |
| **A** | Where does basis assembly live? | application service |
| **B** | The rejection vocabulary | one code per gate, §1.3 |
| **C** | May one decision cover several submissions? | yes |
| **D** | Does a return move the case stage? | no — separate transition |
| **E** | Mandates per command | desk for submit; CIO for decide and return |
| **F** | One event per command, or per state change? | per command |

Out of scope: agents, LLM integration, Agents UI, any new migration.
