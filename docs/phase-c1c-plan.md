# Phase C1C — contribution, aggregation and governance

Planning gate. **No implementation until approved.**

C1C makes a deterministic Macro case walk the whole institutional path: required
specialist contribution, optional contribution or recorded absence, manager
aggregation into an exact revision, conditional Risk resolution, and three
governance reviews of that same revision — ending at an eligibility verdict.
Recorded and stub providers only. No LLM, no CIO decision, no Agents UI.

---

## 0. What already exists, and what that changes

Worth stating first, because it removes work the gate might otherwise have
planned for.

| Already in the domain                                                                  | Consequence for C1C                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RunState` with all ten states and a transition table                                  | The run lifecycle needs **no new states**. It needs commands that drive it.                                                                        |
| `VerificationFinding` with eleven finding kinds, `EvidenceRef`, `blocking`             | Verification findings need no new modelling.                                                                                                       |
| `Challenge` with eight kinds, counter-evidence, `wouldBeResolvedBy`, `ChallengeStatus` | The Devil's Advocate record already refuses theatrical disagreement — `buildChallenge` rejects an evidence-less challenge outside two named kinds. |
| `evaluateRevisionEligibility` / `evaluateRevisionGates` / `governanceBlockers`         | Eligibility is **already** one domain path. C1C wires it; it must not reimplement it.                                                              |
| `reviewApplies` — revision-scoped matching                                             | Concurrency safety between reviewers is already modelled.                                                                                          |
| `RequirementResolution`, `RISK_REVIEW_WHEN_IMPLEMENTABLE` (C1B)                        | The conditional gate needs one command, not a model.                                                                                               |
| `ContributionProvider` port, `ContributionBudget` with null-means-unmeasured           | The provider boundary exists; C1C moves it outside the transaction.                                                                                |

So the substance of C1C is **commands, transaction boundaries and provenance** —
not new domain vocabulary. The three genuinely new pieces of modelling are the
manager's aggregation record, execution provenance on runs, and derived event
identity.

---

## 1. The three debts, closed first

These are C1C-1 because everything after them would otherwise be built on the
shapes they replace.

### TD-30 — event identity, derived from command identity

**D-C1C-1.** One shared function, in `application/analysis/commands/eventIdentity.ts`:

```ts
deriveEventId({ commandId, eventType, entityId, ordinal? }): string
```

Returned as `stableHashHex(canonicalJson({...})).slice(0, 32)`.

A hash rather than a readable composite, and the reason is bounded length: a
composite of a command id, a type and an entity id is unbounded text in a
primary key that every child event references. Legibility is not lost — the
event row already carries `subject`, `caseId`, `toState`, `occurredAt` and
`correlationId` as columns, which is where a reader actually looks.

Properties, each with a test:

- **retries produce the same id** — every input is stable across a retry
- **two commands never collide** — `commandId` is unique per tenant
- **callers cannot choose** — `creationEventId`, `eventIdPrefix` and
  `assignmentIdPrefix` are **removed from every command input**; C1B's three
  commands are migrated in C1C-1
- **stable across restart** — no clock, no counter, no randomness
- **conflicting content under one id fails loudly** — `events.append` already
  dedupes on id via `transitionEventSemanticKey`; C1C-1 adds the parity test
  that differing content raises `ConflictingRecordError` rather than being
  silently ignored

`ordinal` is used **only** when one command emits several events of the same
type for the same entity, which today is nothing — assignment events differ by
`entityId`. It exists so that the one case that eventually needs it does not
invent a second scheme.

Assignment ids get the same treatment: `deriveAssignmentId(commandId, entryKey)`.

### TD-31 — centralized playbook resolution

**D-C1C-2.** `application/analysis/playbookRegistry.ts`:

```ts
resolveForCaseKind(caseKind): { playbookId, version }   // the approved workflow
requirePlaybook(playbookId, version): CasePlaybook      // the immutable definition
```

`InstantiatePlaybook`'s input changes from a `CasePlaybook` object to
`{ playbookId, playbookVersion }`. The handler resolves through the registry, so
no caller can hand in an arbitrary in-memory workflow.

Rejections: unknown playbook id → `not-found`; unknown version → `not-found`;
a version whose `caseKind` does not match the case → `invariant-violated`; a
case already pinned → refused by `pinPlaybook` and by the 0014 trigger.

A second playbook later is a second entry in `COMPILED_PLAYBOOKS` plus a
`caseKind` mapping — no conditional logic in any handler. That is the whole test:
**add a fictional second playbook in a test and instantiate it without touching a
command.**

TD-31 closes. A full dynamic registry stays out of scope; the seam is here.

### TD-28 — execution provenance

**D-C1C-3.** Migration 0015 adds to `analysis.runs`:

| Column                                                  | Why                                                       |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `playbook_id`, `playbook_version`, `playbook_entry_key` | which workflow, at which version, produced this work      |
| `provider_id`, `provider_version`                       | which contribution provider                               |
| `provider_kind`                                         | `recorded` \| `stub` \| `live`, **NOT NULL with a CHECK** |
| `provenance_id`                                         | FK to `storage_provenance`, as commands have              |

`provider_kind` is the important one. **A recorded contribution must never
serialize as though a real institutional agent produced it.** Making it NOT NULL
with no default means a run cannot exist without saying what produced it, and
the read model can refuse to present a `recorded` result as live work.

`agent_results` gains `provider_kind` and `provenance_id` for the same reason.

The employee, department and role snapshot is **not** duplicated onto `runs`: the
run carries `employee_id`, and the command that started it carries the full actor
snapshot. Copying it would create a second organizational history that can
disagree with the ledger's.

TD-28 closes.

---

## 2. The external-work boundary

**D-C1C-4. No PostgreSQL transaction is ever open while a provider runs.**

The shape is three separate durable acts:

```
StartAgentRun          commits    (run: ready → running, assignment → active)
   ↓
provider.contribute()  outside any transaction, may be slow or fail
   ↓
RecordContribution | FailAgentRun    commits
```

The orchestrator sequences these. It calls `runCommand` and the provider; it
**never touches a repository**.

### How this is proved mechanically

Three tests, because an architectural rule that is only documented is a rule
that erodes.

1. **Fitness rule:** no file under `application/analysis/commands/` imports
   `contributionPort`. A command that cannot see the provider cannot call it.
2. **Fitness rule:** `orchestrator.ts` imports no repository port. Its only
   durable surface is `runCommand`.
3. **Runtime proof:** a test provider whose `contribute` **reads the command
   ledger** and asserts that the `StartAgentRun` command for its own run is
   already `committed`. If a transaction were still open, that row would not yet
   be visible to a separate connection under `READ COMMITTED`. This proves the
   boundary through the public surface rather than by inspecting connections.

### Late results

`RecordContribution` and `FailAgentRun` reject when the world moved on:

| Condition                            | Rejection                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| run is not `running`                 | `illegal-prior-state`                                                               |
| assignment is `cancelled`            | `illegal-prior-state`                                                               |
| the targeted revision was superseded | `illegal-prior-state`, and the run is recorded `superseded` rather than `completed` |
| case is `published` or `withdrawn`   | `illegal-prior-state`                                                               |

A late result is **not** discarded silently. The rejection is durably recorded in
the ledger with its reason code, so "the quant desk answered, but too late"
remains a fact rather than an absence.

---

## 3. The commands

Ten, plus the C1B migrations. Every one declares `versionPolicy`, `reasonPolicy`,
`category` and `mandate`; the category/mandate cross-check from C1B applies
unchanged.

| Command                         | Category       | Mandate                                | Version      | Reason       |
| ------------------------------- | -------------- | -------------------------------------- | ------------ | ------------ |
| `StartAgentRun`                 | workflow       | `department-contribution`              | refuses      | optional     |
| `RecordContribution`            | analysis       | `department-contribution`              | refuses      | optional     |
| `FailAgentRun`                  | workflow       | `department-contribution`              | refuses      | **required** |
| `AggregateManagerConclusion`    | analysis       | `department-manager` (research-office) | refuses      | optional     |
| `ReviseThesis`                  | analysis       | `thesis-owner`                         | refuses      | **required** |
| `ResolveConditionalRequirement` | **governance** | `governance-verdict` (risk)            | refuses      | **required** |
| `SubmitForVerification`         | workflow       | `department-manager`                   | **requires** | optional     |
| `RecordVerificationReview`      | governance     | `governance-verdict` (verification)    | refuses      | optional     |
| `RecordDevilsAdvocateReview`    | governance     | `governance-verdict` (challenge)       | refuses      | optional     |
| `RecordRiskReview`              | governance     | `governance-verdict` (risk)            | refuses      | optional     |

Two deliberate choices in that table.

**Only `SubmitForVerification` is version-guarded.** It is the one command that
moves case-level stage (`aggregation → review`). Every governance verdict
refuses `expectedVersion` — which is what makes concurrent reviews possible at
all. If verdicts bumped the case version, two reviewers finishing at the same
moment would conflict for a reason that has nothing to do with their work.

**`FailAgentRun` requires a reason.** Work that stops owes an explanation; this
is the same rule that makes `transitionCase` demand one for `blocked`.
`REASON_REQUIRED_COMMANDS` gains `FailAgentRun`, `AggregateManagerConclusion`
stays optional (ordinary forward motion), and `ReviseThesis` and
`ResolveConditionalRequirement` are already on the list.

### StartAgentRun

Verifies, in order: assignment exists → belongs to the case → is `queued` or
`ready` → every **blocking** dependency entry has a completed run → actor's
department owns the assignment → no active run already exists for it → the case
is not terminal.

Optional inputs are gathered as **context, never as a gate**: the missing ones
are recorded on the run so the manager and the CIO can see which perspectives
were unavailable at the time the work was done.

Atomically: creates the run in `running`, moves the assignment to `active`,
appends a run event and an assignment transition, writes the execution
provenance, records intent and outcome.

**Duplicate prevention:** at most one non-terminal run per assignment, enforced
by a partial unique index in 0015 rather than by a read-then-write, which is a
race. The playbook may not currently permit parallel runs for one entry; when it
needs to, that becomes an entry field and the index gains it.

### RecordContribution

One command, one transaction, everything or nothing: run completion, the
immutable result, every claim, the assignment's completion, the events.

Refused writes — each one a test:

- claims without a run, or a completed run without claims
- a claim citing an `EvidenceRef` **outside the run's referenced `EvidenceSet`**,
  checked by content hash, not by id alone
- a claim marked supported whose supporting evidence is empty
- a causal claim without the attribution the domain requires
- **fixture-provenance evidence producing a publishable claim** — a claim whose
  confidence is not capped by the fixture provenance is refused, which is the
  storage-side half of the standing "fixture data is never presented as live"
  rule
- a repeated completion with different content → `ConflictingRecordError`

An identical replay returns the existing contribution.

Token and cost fields keep the port's semantics exactly: **`null` means not
measured, never unlimited.** A recorded provider reports `null`, and the column
stays nullable rather than being back-filled with zero, which would read as
"free".

### FailAgentRun

Separate from completion, and shaped so nothing sensitive lands in the record:
a bounded `failureCategory`, a bounded reason code, `retryable`, and the attempt
number. **No provider response bodies, prompts, evidence or raw error text** —
the same discipline already applied to slow-query logs.

Required and optional entries diverge here, which is the point:

| Entry requirement | Effect of failure                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `required`        | downstream blocking dependents move to `blocked`; the revision carries a `missingRequiredContributions` blocker                                                          |
| `optional`        | **nothing downstream blocks**; the absence is recorded and surfaces in aggregation, in the decision record, and to any governance function that later judges it material |
| `conditional`     | treated as its resolved level; unresolved means not yet a blocker                                                                                                        |

---

## 4. One revision-minting mechanism

**D-C1C-5.** There is exactly one path that mints a revision:
`application/analysis/revisions.ts`, a shared operation used beneath
`ProposeThesis` (C1B), `AggregateManagerConclusion` and `ReviseThesis`.

No command handler calls another command handler. The shared operation enforces:

- the prior revision becomes `superseded` and is otherwise untouched
- monotonic `revisionNumber` within the lineage
- `supersedesRevisionId` set, `revisionReason` required beyond revision 1
- the minting employee and department recorded
- the exact source claims and `EvidenceSet` recorded
- **the new revision begins with no inherited governance approval and no
  inherited requirement resolution** — the latter follows for free from C1B's
  revision-scoped keying
- the old revision stays readable with the reviews that were attached to it

`ProposeThesis` is refactored onto it in C1C-3. That is a small change and it is
what stops two revision paths existing.

### Aggregation versus revision

Both mint, and they remain separate commands because they are different
institutional acts with different mandates: aggregation is the Research Office
turning specialist work into the firm's position; `ReviseThesis` is a correction
in response to findings, and it owes a reason.

**`AggregateManagerConclusion` records structure the manager cannot omit:**

supporting claims · opposing claims · source disagreement · unresolved specialist
disagreement · optional contributions received · optional contributions **missing
or failed** · evidence references · confidence composition · manager rationale ·
implications · invalidation criteria · prior revision lineage.

The manager may synthesize and prioritise. The command **refuses** to:

- drop a claim that a completed specialist run marked opposing
- record `optionalContributionsMissing` as empty when the playbook's optional
  entries did not complete — computed from the store, not accepted from the caller
- set any lifecycle beyond `proposed`
- mark the revision verified or eligible

That last pair is worth being blunt about: a manager marking their own
aggregation verified would make every governance gate optional in practice.

---

## 5. ResolveConditionalRequirement (TD-29)

**D-C1C-6. Category `governance`, mandate `governance-verdict` with discipline
`risk`.**

Justification, since the gate asked for one: this command decides whether a
governance gate applies to a specific argument. Deciding that Risk need not
review something is a Risk decision. Filing it as `workflow` would let the
producing desk excuse itself from the control function reviewing it, which is
exactly the failure the conditional design exists to prevent. The seeded
`chief-risk-officer` role is `governance` and the Risk department handles
`risk`, so `authorize` grants it without any new rule.

The **initiator** may be the orchestrator — it notices the gate is due. The
**accountable actor** must be an employee of a control function. C1A's
initiator/accountable split carries this exactly.

Records everything the gate listed: case, thesis, revision, entry key, rule id,
rule version, the deterministic inputs (the revision's declared implications),
the result, the reason, the evaluator snapshot, actor, initiator, command id,
storage provenance and the evaluated timestamp.

**The command recomputes the rule and rejects a supplied result that disagrees
with it.** A deterministic rule whose recorded answer can differ from its actual
answer is not a rule. Overriding it would need its own explicit command, with
its own mandate and reason — out of scope here.

Rejections: missing revision · **superseded revision** · revision belonging to
another case · a rule reference that does not match the playbook entry's ·
a conflicting second resolution → `ConflictingRecordError` · a system actor as
the accountable evaluator.

Identical replay returns the original resolution. A new revision has no
resolution, because the key is revision-scoped.

TD-29 closes.

---

## 6. Governance

**D-C1C-7. Verification, the Devil's Advocate and Risk may run concurrently.**

They review the same immutable revision. None reads another's verdict; none can
edit it. Concurrency is safe by construction rather than by locking:

- the revision is **immutable**, so nothing any reviewer sees can change beneath
  them
- each verdict is keyed on `reviewIdentity` — `(caseId, revisionId, discipline,
reviewer, at)` — so two verdicts never collide
- no verdict bumps the case version, so no verdict conflicts with another
- reconciliation happens **later**, through a correction that mints a new
  revision and reopens every applicable gate

Risk may run concurrently **once its requirement resolves to `required`**. If it
resolves `not-required` no Risk review is created, and the explicit
`not-required` row stays visible in the record.

Ordering that remains mandatory: manager aggregation **before** any governance
review. Enforced by `SubmitForVerification` requiring the case in `aggregation`
and the target revision to exist.

**Verification never changes the thesis.** It records findings; a correction is a
new revision minted by the manager. Same for Risk: it assesses exposure and
records a verdict, and cannot rewrite the argument.

**A resolved challenge is not deleted.** `DevilsAdvocateVerdict` already carries
`challenges` plus a per-challenge `outcomes` map, so the original objection, the
response and the outcome all survive. An unresolved material challenge blocks
eligibility through `evaluateRevisionGates`, which already implements it.

---

## 7. Eligibility

**D-C1C-8. No new eligibility logic anywhere.** C1C calls
`evaluateRevisionEligibility` and supplies the one input the domain cannot
derive on its own: `missingRequiredContributions`, computed from the playbook's
required entries and their run outcomes.

A fitness rule asserts that nothing outside `domain/analysis/review.ts` computes
a governance blocker, and that no SQL file mentions eligibility.

C1C stops at `eligibleForDecision = true`. Submission and `CaseDecision` are
C1D.

One gap to close in the wiring: the domain's gate handles verification, the
Devil's Advocate, compliance and risk. **Risk resolving to `not-required` must
satisfy the risk gate rather than leave it missing** — otherwise a descriptive
thesis could never become eligible. That is a small, explicit adapter between
`RequirementStatus` and the gate inputs, and it belongs in the application layer
beside the other gate assembly, not in the domain's gate.

---

## 8. Providers

`infrastructure/analysis/providers/` — recorded and stub, no live client.

A **recorded** provider replays a fixture: fixed `EvidenceSet`, fixed claims,
fixed confidence, fixed output schema, expected event sequence, and explicit
`provider_kind = 'recorded'`.

A **stub** provider returns controlled outcomes on demand: success, failure,
timeout, malformed contribution, delayed result. The malformed case matters
most — it proves the validation path rejects bad provider output rather than
storing it.

Neither may bypass claim validation, evidence resolution, the command ledger,
assignment state, governance gates or execution provenance. They enter through
the same `ContributionProvider` port a live provider will.

A fitness rule asserts no provider declares `provider_kind: 'live'` in C1C, and
the existing import rule keeps LLM clients out.

---

## 9. Headquarters preparation

No UI. What C1C guarantees C1D can project, from durable rows only:

| Projection           | Source                                              |
| -------------------- | --------------------------------------------------- |
| employee presence    | `runs.state` + assignment status, per `employee_id` |
| department workload  | `assignments GROUP BY department_id, status`        |
| active assignment    | assignments in open statuses                        |
| run state            | `runs` + `run_events`                               |
| waiting dependencies | `waitingChains` over assignments                    |
| governance queues    | assignments in control-function departments         |
| blocked revisions    | `evaluateRevisionGates`                             |
| activity feed        | `transition_events` + `run_events` + `commands`     |
| eligible-for-CIO     | `evaluateRevisionEligibility`                       |

No free-form activity strings are stored, and no sub-run activity is invented —
run events record only states the provider actually reported through
`observedStates`.

---

## 10. Staging

Four stages, each independently green and committed, with a short report
between.

### C1C-1 — foundations and the run boundary

`eventIdentity.ts` · `playbookRegistry.ts` · migration 0015 (execution
provenance, one-active-run index) · `StartAgentRun` · `FailAgentRun` · C1B
commands migrated off caller-supplied ids · the three boundary fitness rules.

_Closes TD-30, TD-31, TD-28._

### C1C-2 — contribution

`RecordContribution` · claim and `EvidenceSet` validation · fixture-provenance
capping · recorded and stub providers · orchestrator rewritten to call commands
instead of repositories · the ledger-visibility proof of the transaction
boundary.

### C1C-3 — aggregation and the conditional gate

`revisions.ts` shared minting · `ProposeThesis` refactored onto it ·
`AggregateManagerConclusion` · `ReviseThesis` · `ResolveConditionalRequirement`.

_Closes TD-29._

### C1C-4 — governance and eligibility

`SubmitForVerification` · the three verdict commands · the
`RequirementStatus` → gate-input adapter · full eligibility wiring · the
end-to-end deterministic Macro walk.

Command contract goes to **3** in C1C-1 and stays there for the phase; the
envelope does not change again mid-phase.

---

## 11. Decisions requiring approval

| #        | Decision                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-C1C-1  | Event and assignment ids derived from the command id by one shared function; caller-supplied ids removed from C1B's commands                          |
| D-C1C-2  | `InstantiatePlaybook` takes `(playbookId, version)` resolved through a registry, never a playbook object                                              |
| D-C1C-3  | Execution provenance on `runs` with a NOT NULL `provider_kind`, so recorded work can never present as live                                            |
| D-C1C-4  | Three-act boundary; no transaction open across provider execution; proved by two fitness rules and one ledger-visibility test                         |
| D-C1C-5  | One revision-minting operation beneath all three minting commands; no handler calls another handler                                                   |
| D-C1C-6  | `ResolveConditionalRequirement` is **governance**, mandated to a control function, and recomputes the rule rather than trusting the supplied result   |
| D-C1C-7  | Verification, Devil's Advocate and Risk run concurrently; no governance verdict carries `expectedVersion`                                             |
| D-C1C-8  | Eligibility stays in the domain; the application supplies `missingRequiredContributions` and maps a `not-required` Risk resolution onto the risk gate |
| D-C1C-9  | Only `SubmitForVerification` is version-guarded; `FailAgentRun` joins the reason-required list                                                        |
| D-C1C-10 | Late provider results are **rejected and durably recorded**, never silently dropped                                                                   |

---

## 12. Risks

**The orchestrator rewrite is the largest single change.** It currently writes
through repositories directly; C1C-2 makes it a command caller. Mitigated by
doing it in one stage with the fitness rule that forbids the old shape.

**`missingRequiredContributions` is computed in two places if we are careless** —
once for aggregation's record of optional absence and once for eligibility. One
application-level function, used by both.

**The conditional-gate adapter is the subtlest piece.** `not-required` must
satisfy the risk gate, and an _unresolved_ conditional entry must **not** — it
must read as a missing gate. Getting that backwards would let a case reach the
CIO with a Risk question nobody asked. It gets its own tests in C1C-4.

**Concurrency is designed for but only single-process today.** The tests will
exercise two governance verdicts committed against one revision; genuine
parallel load testing is not in scope.

---

## 13. Out of scope

No CIO submission, no `CaseDecision`, no LLM or model client, no Agents UI
migration, no route wiring, no live provider, no authentication (TD-26 stays
open), no compliance review workflow.
