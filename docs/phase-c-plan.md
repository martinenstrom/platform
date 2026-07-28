# AI Phase C — the command layer, durable runtime, and the first Macro Agent

Planning gate. No code.

Split into **C1** (commands and durable runtime, no LLM) and **C2** (the first
real Macro Agent). C2 does not begin until C1 is green.

---

## 0. What is missing, precisely

The domain, the ports, both adapters and the schema are built and tested. What
does not exist:

| Missing | Consequence |
| ------- | ----------- |
| A command layer | Nothing calls `withTransaction`; the transaction boundary has no callers |
| A composition root for analysis | `createInMemoryRepositories` is constructed by nothing outside its own module |
| A headquarters read model | The Agents page renders `mockFixtures` — fabricated activity |
| A live contribution provider | `recorded` and `stub` exist; neither is a model |

Phase C1 is the first three. C2 is the fourth.

---

## 1. The command boundary

### Shape

```ts
interface CommandEnvelope {
  commandId: string          // caller-supplied, stable across retries
  correlationId: string
  actor: Actor
  occurredAt: string         // from the Clock, never the database
}

type CommandResult<T> =
  | { outcome: 'committed'; value: T; provenance: StorageProvenance }
  | { outcome: 'rejected'; reason: DomainRejection }      // the command was invalid
  | { outcome: 'failed'; error: StorageError }            // nothing was written
  | { outcome: 'unresolved'; probe: CommandProbe }        // ambiguous commit

type CommandHandler<C, T> = (command: C & CommandEnvelope, deps: CommandDeps) => Promise<CommandResult<T>>
```

**One handler = one `withTransaction`.** No handler calls a repository outside
one, and no handler calls another handler — composition happens above, by
issuing a second command, so every transaction boundary stays visible.

`committed` is returned **only after PostgreSQL confirms the commit.** There is
no degraded success and no volatile acknowledgement (D-C1).

`rejected` and `failed` are separated because they are different facts: the
first says the organization refused the work, the second says the system could
not record it. Collapsing them would make "the CIO cannot decide this yet"
indistinguishable from "the database is down".

### Actor

```ts
type Actor =
  | { kind: 'employee'; employeeId: string; departmentId: string }
  | { kind: 'system'; reason: string }     // scheduled work, replay, migration
```

**Authorization assumption for C1:** there is no authentication (TD-8), so the
actor is *asserted* by the caller and trusted. Every command records it, so when
authentication arrives the check is added at one place and the historical
record is already shaped for it. Commands that move a case require an `employee`
actor — migration 0012 enforces that at the database.

### Where handlers live

`src/application/analysis/commands/` — one file per command, plus
`commands/index.ts`. They may use the domain and the ports, and nothing else.
A fitness rule asserts no handler imports `infrastructure`.

---

## 2. Command inventory

Sixteen commands. Two of the suggested list are **not** commands and one is
split, with reasons.

| # | Command | Notes |
| - | ------- | ----- |
| 1 | `OpenInvestmentCase` | Creates the case and its intake event |
| 2 | `InstantiatePlaybook` | Pins the version, creates every assignment |
| 3 | `ProposeThesis` | Revision 1 of a lineage |
| 4 | `ReviseThesis` | Supersedes and mints n+1 |
| 5 | `StartAgentRun` | Assignment → active, run → running |
| 6 | `RecordContribution` | Run terminal state, claims, result, evidence links |
| 7 | `FailAgentRun` | The other terminal path — see below |
| 8 | `AssembleEvidenceSet` | Content-addressed; separate transaction |
| 9 | `SubmitForVerification` | Assignment → submitted; creates governance assignments |
| 10 | `RecordVerificationReview` | Verdict + findings |
| 11 | `RecordDevilsAdvocateChallenge` | Verdict + challenges + counter-evidence |
| 12 | `RecordRiskReview` | Verdict |
| 13 | `RecordComplianceReview` | Verdict; case-wide |
| 14 | `AggregateManagerConclusion` | Research Office reconciliation |
| 15 | `SubmitForCioDecision` | `review` → `decision` |
| 16 | `RecordCaseDecision` | The institutional record |
| 17 | `CloseCase` / `ReopenCase` | `published` / `withdrawn`, and `returned` |

**Not commands:**

- **`CreateAssignment`** is not a standalone command. Every assignment
  originates from a playbook entry or from a manager returning work, and both
  already have commands. A free-floating "create an assignment" would be the
  one path that bypasses `(caseId, playbookEntryKey)` uniqueness — the invariant
  Stage 2.1 spent a domain change making reachable.
- **`RecordClaims`** is not separable from `RecordContribution`. Claims are
  produced *by* a run and are write-once; a separate command would allow claims
  with no run, and a run whose claims arrive in a second transaction.

**Split out:** `FailAgentRun`, because a run that failed and a run that
completed take different paths through the state machine, write different
fields, and — critically — a failure must still record its events and free its
assignment. Folding it into `RecordContribution` as an optional shape is how
the failure path ends up untested.

---

## 3. Command contracts

Common to all: `commandId`, `correlationId`, `actor`, `occurredAt`.
`expectedVersion` appears **only** on commands that move the case (§5).

### 1. OpenInvestmentCase

| | |
| --- | --- |
| **Input** | `caseId`, `subject {kind, ref, displayName}`, `question`, `ownerEmployeeId`, `participatingDepartmentIds` |
| **Actor** | employee (a manager) or system |
| **Authorization** | asserted; TD-8 |
| **Version** | creates at version 1; no `expectedVersion` |
| **Idempotency** | `caseId` — `cases.create` is idempotent on it |
| **Transaction** | case + participants + creation event |
| **Events** | `subject=case, from=null, to=intake` |
| **Repositories** | cases, events |
| **Prior state** | case does not exist |
| **Result** | `InvestmentCase` at `intake` |
| **Failure** | unknown owner or department → `rejected` |
| **Retry** | safe; returns the existing case |

### 2. InstantiatePlaybook

| | |
| --- | --- |
| **Input** | `caseId`, `playbookId`, `playbookVersion`, `expectedVersion` |
| **Version** | `intake → research`, version +1 |
| **Idempotency** | `(caseId, playbookEntryKey)` per assignment |
| **Transaction** | validate playbook → N assignments → participants → stage move → events |
| **Events** | one case movement, plus one `subject=assignment, to=queued` per entry |
| **Prior state** | `intake`, no assignments |
| **Failure** | `validatePlaybook` failure → `rejected`; unknown department → `rejected` |
| **Retry** | safe; existing assignments are returned unchanged |

Registers the playbook version in `playbook_versions` if absent — append-only,
so a version a case has pinned can never change.

### 3. ProposeThesis / 4. ReviseThesis

| | ProposeThesis | ReviseThesis |
| --- | --- | --- |
| **Input** | `caseId`, `thesisId`, `revisionId`, statement, position, invalidation criteria, horizon, proposer | `caseId`, `currentRevisionId`, `newRevisionId`, changes, `reason` |
| **Idempotency** | `revisionId` | `newRevisionId` |
| **Transaction** | revision + thesis event | new revision + supersede old + events |
| **Events** | `subject=thesis, from=null, to=proposed` | `to=superseded` on the old, `to=under-analysis` on the new |
| **Prior state** | revision 1 does not exist | current revision is not superseded |
| **Version** | none — a thesis does not move the case | none |
| **Failure** | no invalidation criteria → `rejected` | revising a superseded revision → `rejected` |

`ReviseThesis` is where governance resets. Both are written in one transaction
because a lineage showing two live versions, even briefly, is a lineage that
cannot be audited.

**Reopening review on revision** is a *consequence*, not a field: the new
revision has no reviews, and `evaluateRevisionGates` counts missing verification
as a blocker. Nothing needs to un-approve anything.

### 5. StartAgentRun

| | |
| --- | --- |
| **Input** | `caseId`, `assignmentId`, `runId`, `evidenceSetId`, `revisionId?`, contract/schema/prompt/model refs |
| **Idempotency** | `runId` |
| **Transaction** | run (`running`) + run event + assignment `queued → active` + transition event |
| **Prior state** | assignment `queued` or `returned`; evidence set exists |
| **Failure** | assignment already active → `rejected` |
| **Retry** | safe; the run exists, the status update is idempotent by value |

The assignment status update uses a conditional `WHERE status = $expected`
(Stage 2 D-S3), so two concurrent starts cannot both claim it.

### 6. RecordContribution

The largest transaction, and deliberately one:

| | |
| --- | --- |
| **Input** | `runId`, `caseId`, claims, `resultKey` + inputs, observed states, usage, completion time |
| **Idempotency** | `runId` for the run; claim ids; `resultKey` is a content hash |
| **Transaction** | run → `completed`, run events, **claims**, claim→evidence links, result, assignment → `submitted`, transition events |
| **Events** | run state changes; assignment movement |
| **Prior state** | run `running`; target revision still current |
| **Result** | `AgentRunRecord` with claims hydrated |
| **Failure** | conflicting claim content → `ConflictingRecordError`; superseded revision → run recorded `obsolete`, not attached to the new revision |
| **Retry** | safe; every write is keyed |

**Obsolescence is recorded, not discarded.** A contribution that finished after
its revision was superseded is stored against the old revision with
`obsolete: true` — the work reasoned over different assumptions, and moving it
would attribute conclusions to a thesis that never saw them.

### 7. FailAgentRun

Run → `failed` / `timed-out` / `cancelled` / `blocked` with a required reason,
run events, assignment → `returned` with the reason. Idempotent on `runId` plus
the terminal state. A failed run **still records its events**: "three teams
blocked behind macro" is only visible if the failures are stored.

### 8. AssembleEvidenceSet

| | |
| --- | --- |
| **Input** | items (`EvidenceItem[]`), `assembledAt`, `correlationId` |
| **Idempotency** | the content hash **is** the id |
| **Transaction** | its own — deliberately not joined to a case transaction |
| **Version** | none |
| **Failure** | conflicting payload under the same id → `ConflictingRecordError` |

Separate because an evidence set is immutable and content-addressed: one
written by an abandoned command is harmless garbage rather than a partial
write, and joining it to the case transaction would make evidence assembly a
reason for a case command to fail.

### 9. SubmitForVerification

Assignment → `submitted`; creates the governance assignments the playbook
declares (verification, challenge, risk); case `research → aggregation` or
`aggregation → review` depending on the entry. Requires `expectedVersion`.

### 10–13. The four governance commands

| | |
| --- | --- |
| **Input** | scope (`case` or `{thesisId, revisionId}`), verdict, findings/challenges/concerns, reviewer |
| **Idempotency** | `reviewIdentity(kind, review)` — the Stage 1.5 natural key |
| **Transaction** | review + typed children + counter-evidence + review event |
| **Prior state** | for a revision review, the revision exists and belongs to the case |
| **Failure** | scope mismatch → `ReferentialIntegrityError` (composite FK); challenge without counter-evidence → `rejected` |
| **Retry** | identical → returns; different verdict at the same instant → `ConflictingRecordError`; a genuine re-review carries a later `at` and is a second review |

`RecordVerificationReview` writes `content_hash` on every finding that cites
evidence (Stage 2.1 H2), so revision of the evidence after verification stays
detectable.

**Blockers are not stored.** `evaluateRevisionGates` derives them from the
reviews at evaluation time. Storing them would create a second source of truth
that drifts — a thesis marked "unblocked" while an open challenge sits in the
queue.

### 14. AggregateManagerConclusion

Research Office reconciliation: an aggregating run whose claims summarise the
desks', plus the case moving `research → aggregation`. Modelled as a normal
contribution plus a stage move rather than a special record, because a manager's
conclusion is evidence-backed work like any other and must be reviewable.

### 15. SubmitForCioDecision

`review → decision`, requiring `expectedVersion`. The handler evaluates
`evaluateRevisionEligibility` and **rejects** if no revision is eligible. This
is the gate: nothing reaches the CIO that governance has not cleared.

### 16. RecordCaseDecision

| | |
| --- | --- |
| **Input** | `caseId`, `selectedRevisionId \| null`, not-selected, rejected, `evidenceSetId`, governance snapshot, rationale, dissent, triggers, `expectedVersion` |
| **Idempotency** | `caseId` — one decision per case |
| **Transaction** | decision + decision_revisions + revision lifecycles (`selected` / `not-selected`) + case `decision → published` + events |
| **Prior state** | case at `decision`; selected revision eligible |
| **Failure** | `buildDecision` refuses a superseded, unverified or blocked revision → `rejected` |
| **Retry** | identical → returns; different → `ConflictingRecordError` |

The governance snapshot is computed by the handler from the stored reviews, not
supplied by the caller — a caller-supplied snapshot could assert a verification
that never happened.

### 17. CloseCase / ReopenCase

`withdrawn` from most stages with a required reason; `returned → research` to
reopen. Both require `expectedVersion` and write a reason: work does not stall
or restart anonymously.

---

## 4. Transaction map

| Command | Repositories written | Statements (PostgreSQL) |
| ------- | -------------------- | ----------------------- |
| OpenInvestmentCase | cases, events | ~7 |
| InstantiatePlaybook | assignments, cases, events, playbooks | ~10 + batched |
| ProposeThesis | theses, events | ~5 |
| ReviseThesis | theses ×2, events ×2 | ~8 |
| StartAgentRun | runs, assignments, events | ~9 |
| RecordContribution | runs, claims, results, assignments, events | ~15, batched |
| FailAgentRun | runs, assignments, events | ~9 |
| AssembleEvidenceSet | evidence | ~5 |
| SubmitForVerification | assignments, cases, events | ~10 |
| Governance ×4 | reviews, events | ~6 |
| SubmitForCioDecision | cases, events | ~6 |
| RecordCaseDecision | decisions, theses, cases, events | ~12 |

None grows with the size of its collections — `queryCount.pg.test.ts` holds
that, and Phase C adds command-level counts to it.

---

## 5. Aggregate version

**`cases.version` moves only when the case moves.** Commands that write
children — runs, claims, reviews, evidence, events — do not bump it and do not
carry `expectedVersion`.

That is the point of the design: two departments finishing concurrently must
not conflict. Making every write bump the version would serialise the whole
organization to protect one row, which the storage plan rejected explicitly.

| Carries `expectedVersion` | Does not |
| ------------------------- | -------- |
| InstantiatePlaybook, SubmitForVerification, SubmitForCioDecision, RecordCaseDecision, CloseCase, ReopenCase | ProposeThesis, ReviseThesis, StartAgentRun, RecordContribution, FailAgentRun, AssembleEvidenceSet, the four governance commands |

Child writes are protected by their own identities: `(caseId, playbookEntryKey)`,
`runId`, claim id, `reviewIdentity`, `eventId`, content hash. Concurrency safety
comes from unique constraints, not from a shared counter.

**Events record the version they observed.** `transition_events.aggregate_version`
is the case version at the time — the version the event *advanced the case to*
for a movement, and the current version for everything else. A reader ordering
by `(occurredAt, eventId)` gets the true sequence regardless.

---

## 6. Idempotency map

**Almost every command is idempotent by natural identity**, because ids are
caller-supplied and the schema is keyed on them.

| Mechanism | Commands |
| --------- | -------- |
| Natural key + unique constraint | all sixteen |
| Content address | AssembleEvidenceSet, agent results |
| `reviewIdentity` | the four governance commands |
| `(caseId, playbookEntryKey)` | InstantiatePlaybook |

**Decision D-C2: ids are supplied by the caller, never generated inside a
handler.** A server-generated id makes a retry produce a second record with a
different id, which no constraint can catch. Callers mint ULIDs.

**What `idempotency_keys` is actually for.** With natural identity everywhere,
the table stops being the duplicate-prevention mechanism — the unique
constraints are — and becomes the **ambiguity-resolution index**: it maps
`commandId → result_ref`, so after an `AmbiguousCommitError` the caller can ask
"did my command land, and what did it produce?" without guessing.

Every command therefore reserves `commandId → primary result id` inside its
transaction. Cheap, and it is the only thing that makes §8 work.

---

## 7. Event map

| Command | Events appended |
| ------- | --------------- |
| OpenInvestmentCase | case `null → intake` |
| InstantiatePlaybook | case `intake → research`; assignment `null → queued` ×N |
| ProposeThesis | thesis `null → proposed` |
| ReviseThesis | thesis `→ superseded`; thesis `null → under-analysis` |
| StartAgentRun | run `null → running`; assignment `queued → active` |
| RecordContribution | run `running → completed`; assignment `active → submitted` |
| FailAgentRun | run `running → failed\|timed-out\|cancelled`; assignment `active → returned` |
| Governance ×4 | review `null → recorded` with `revisionId` where scoped |
| SubmitForVerification | case `research → aggregation`; assignment movements |
| SubmitForCioDecision | case `review → decision` |
| RecordCaseDecision | case `decision → published`; thesis `→ selected` / `→ not-selected` |
| CloseCase / ReopenCase | case `→ withdrawn` / `returned → research` |

Every case movement carries `actorEmployeeId` and `actorDepartmentId` — the
domain refuses to build one without (Stage 2.1 H3). `causationId` links an event
to the one that triggered it; `correlationId` groups everything from one command.

**No event carries prose.** The headquarters generates its wording from these
structured facts, which is the mechanism behind "the organization must feel
alive" and "never fabricate activity" holding at the same time.

---

## 8. Ambiguous commit

`AmbiguousCommitError` → `outcome: 'unresolved'` with a probe:

```ts
interface CommandProbe {
  commandId: string
  expect: { repository: 'cases' | 'runs' | 'reviews' | 'decisions' | …; id: string }
}
```

`resolveCommand(probe)` reads `idempotency_keys` for `commandId`:

| Found | Meaning | Result |
| ----- | ------- | ------ |
| yes | the transaction committed | `committed`, with the effect re-read by `result_ref` |
| no, and the expected record absent | it did not commit | `failed`; safe to reissue with the same `commandId` |
| no, but the expected record present | **impossible** unless something wrote outside a command | `blocked`, manual |

Because the key and its effect commit together (Stage 0), the first two rows are
exhaustive in practice and the third is a corruption detector.

**A command is never blindly reissued.** The caller reissues only after
`resolveCommand` returns `failed`, and reissuing carries the same `commandId`,
so a second landing is caught by the same key.

---

## 9. First Macro playbook

`macro-regime@1`:

| Entry | Department | Required | Depends on |
| ----- | ---------- | -------- | ---------- |
| `macro-analysis` | `global-macro` | yes | — |
| `quant-validation` | `quant-technical` | no | `macro-analysis` |
| `aggregation` | `research-office` | yes | `macro-analysis` |
| `verification` | `verification` | yes | `aggregation` |
| `challenge` | `devils-advocate` | yes | `aggregation` |
| `risk-review` | `risk` | conditional | `aggregation` |

The CIO decision is **outside the contribution graph** — the CIO consumes
verified work and performs no analysis, so a playbook entry for it would model
the decision as a contribution to be reviewed.

### Execution flow

```
OpenInvestmentCase        → intake
InstantiatePlaybook       → research, 6 assignments queued
AssembleEvidenceSet       (separate transaction)
StartAgentRun(macro)      → macro active
RecordContribution(macro) → macro submitted, claims stored
ProposeThesis             → revision 1 proposed
  ├─ StartAgentRun(quant) → optional, depends on macro
  └─ StartAgentRun(aggregation)
RecordContribution(aggregation)
SubmitForVerification     → aggregation, governance assignments become workable
RecordVerificationReview      (scoped to revision 1)
RecordDevilsAdvocateChallenge (scoped to revision 1)
RecordRiskReview              (conditional)
SubmitForCioDecision      → decision, gated on evaluateRevisionEligibility
RecordCaseDecision        → published
```

**Dependencies advance** through `readyEntries` in the existing orchestrator:
an entry becomes startable when every `dependsOn` has a completed run. The
orchestrator computes readiness; the commands do the writing. **Nothing is
started by the orchestrator itself** — it returns what is ready and a caller
issues `StartAgentRun`, so every state change passes through a command and a
transaction.

**Optional versus required.** `quant-validation` failing leaves the case
progressable and is visible in the decision record as an absent perspective.
`macro-analysis` failing blocks: `missingRequired` is non-empty, the case moves
to `blocked` with a reason, and `SubmitForCioDecision` rejects.

**Risk is conditionally required** — required once a thesis carries a position
with portfolio impact, optional for a pure regime read. The condition is
evaluated by the handler from the thesis position, and the outcome is recorded
in the decision's governance snapshot as `not-required` rather than omitted, so
"risk did not review this" is a fact in the record rather than a gap.

**Blockers** are derived, never stored (§3). **Revisions reopen review** by
having none (§3).

**No simulated activity.** The activity feed is `projectActivity` over stored
`transition_events` and `run_events`. `RecordedContributionProvider` produces
real runs with real events from fixtures — the *content* is recorded, the
*activity* is genuine. Nothing writes an activity row directly.

---

## 10. PostgreSQL composition

`src/infrastructure/analysis/container.ts`, mirroring the market-data container:

```ts
createAnalysisContainer({
  connectionString,        // from the environment; never logged
  contributionProvider,    // recorded | stub in C1
  clock, metrics, logger,
})
```

Rules:

- **PostgreSQL is the only runtime store.** `createInMemoryRepositories` is not
  reachable from the container, and a fitness rule asserts it.
- **Live mode refuses to start without a connection string.** No silent
  fallback to memory — a fallback is how a system ends up "working" while
  storing nothing.
- **Migrations are not run at startup.** Deployment runs them as the schema
  owner; the runtime cannot (no grant). The container verifies the schema
  version and refuses to start on a mismatch.
- One pool per process, drained by `close()`.

Server functions in `src/infrastructure/analysis/serverFns.ts`, the same
published-boundary pattern the market-data layer uses.

---

## 11. Restart and recovery

The property C1 exists to prove: **kill the process, start it again, and the
organization is exactly where it was.**

Tested directly — issue a sequence of commands, destroy the container, build a
new one against the same database, and assert every case, thesis, assignment,
run, claim, review, decision and event is byte-identical, including ordering.

Recovery cases:

| Situation | Behaviour |
| --------- | --------- |
| Restart mid-command | The transaction rolled back; nothing partial |
| Restart after `unresolved` | `resolveCommand` settles it against `idempotency_keys` |
| Database unavailable at startup | Refuse to start, loudly |
| Database unavailable at runtime | Commands return `failed`; nothing is acknowledged |
| Schema older than the code expects | Refuse to start |

---

## 12. Storage provenance — D-T6, carried forward

Approved for implementation in Phase C independent of dual write.

```
adapterVersion = short hash of (buildId ∥ queryCatalogHash ∥ schemaVersion ∥ domainContractVersion)
```

`buildId` from the git commit, injected at build time, defaulting to `dev`.
`queryCatalogHash` already covers the SQL automatically; `buildId` covers the
mapping code, which the hand-maintained constant never did.

**Recorded where it answers a real question:** on `runs` and `agent_results`,
via a `storage_provenance` table keyed on the hash of the four coordinates,
with a foreign key from each — so a result is traceable to the exact code and
SQL catalogue that produced it, without repeating five columns on every row.
Migration 0013.

Closes TD-24.

---

## 13. Headquarters read model

`src/application/analysis/headquarters.ts` — the nine reads specified in
`docs/postgres-adapter-plan.md` §17, in one transaction, constant in the number
of cases.

`Cases eligible for CIO review` is **not** a query: it is
`evaluateRevisionEligibility` over the reviews and revisions already loaded.
Pushing it into SQL would put the governance rules in two places, and Stage 1.5
exists because one of those places got it wrong.

**Open decision D-C4.** The hard gate says "headquarters projections use
durable events", and C1 delivers that. But the **Agents page still renders
`mockFixtures`** — it is one of the 11 entries on the C1 freeze list, and
migrating it is a route migration you have not yet approved. Until it happens,
the product shows fabricated activity while the read model beneath it is real.
Three options: migrate the Agents route as part of C1; do it as a separate
approved step before C2; or leave it and accept that the page is a prototype
until then. **Recommendation: a separate approved step between C1 and C2**, so
the durable runtime lands first and the UI migration is judged on its own.

---

## 14. C1 / C2 split

### C1 — commands and durable runtime

Sixteen command handlers; the analysis composition root with PostgreSQL as the
sole authoritative store; server functions; the headquarters read model;
storage provenance and migration 0013; restart-durability tests;
ambiguous-commit resolution; command-level query counts.

**No LLM.** The contribution provider is `recorded` or `stub`, behind the same
`ContributionProvider` interface a live one will implement — so a recorded
contribution goes through exactly the same validation, lifecycle, review and
gating code a live one will.

### C2 — the first Macro Agent

Only after C1 is green: the LLM provider behind `ContributionProvider`; a
versioned prompt with a content hash; `EvidenceSet` assembly from the real
market-data and policy domains via `evidenceRefs`; structured claim parsing
with schema validation; cost, token and latency budgets that **refuse to begin
when a required authorization is absent**; and every publication gate enforced.

The split exists so that "the database is wired correctly" and "the model
returned something useful" are never the same debugging session.

---

## 15. Tests

**C1.** One test per command for the happy path, the rejection path, the retry
path and the failure path. A full-playbook integration test issuing the whole
macro sequence against real PostgreSQL. Restart durability. Concurrency:
two `StartAgentRun` on one assignment, two `RecordCaseDecision`, two stage moves
at the same version. Ambiguous-commit resolution under deterministic fault
injection. Query counts per command. A fitness rule that the runtime constructs
no in-memory repository.

The **repository contract suite runs unchanged** — the in-memory adapter stays
the parity oracle, so a command bug and an adapter bug remain distinguishable.

**C2.** Prompt-version pinning; claim-schema rejection; budget refusal;
evidence-set determinism; a run whose revision was superseded mid-flight
recorded obsolete; verification detecting revised evidence via content hashes;
and no live-model call in any unit test.

---

## 16. Decisions requiring approval

| # | Decision |
| - | -------- |
| D-C1 | `committed` only after PostgreSQL confirms; no degraded volatile success |
| D-C2 | Caller-supplied ids; handlers never generate identity |
| D-C3 | `idempotency_keys` becomes the ambiguity-resolution index, not the duplicate-prevention mechanism |
| D-C4 | **Agents route migration timing** — recommend a separate approved step between C1 and C2 |
| D-C5 | `CreateAssignment` and `RecordClaims` are not commands; `FailAgentRun` is split out |
| D-C6 | Only case-moving commands carry `expectedVersion` |
| D-C7 | Storage provenance recorded via a `storage_provenance` table (migration 0013) |
| D-C8 | Risk review conditionality decided by the handler from the thesis position, recorded as `not-required` rather than omitted |

---

## 17. Risks

1. **Sixteen commands is a large C1.** Mitigation: the macro playbook needs
   twelve of them; `ComplianceReview`, `CloseCase`/`ReopenCase` and
   `AggregateManagerConclusion` could follow. Worth deciding explicitly rather
   than discovering halfway.
2. **No authentication.** Every actor is asserted. The record is shaped for it,
   but until TD-8 lands, "who did this" is only as good as the caller.
3. **The orchestrator does not persist.** It computes readiness and returns
   outcomes; C1 must wire it to commands without letting it write, or the
   transaction boundary moves somewhere invisible.
4. **The Agents page shows mock data** until D-C4 is settled.
5. **Deployment is still undefined** — no database host, no CI container,
   no runbook.

---

## 18. Technical debt

- Stage 4 canonical read verification — **retained in the deferred dual-write
  design**, not needed for a single-store runtime
- TD-25 evidence payload integrity on the read path
- TD-24 closed by §12
- `reviews.detail` relational normalization
- Production database host, CI PostgreSQL container (TD-23), operational
  runbook, alert thresholds
- Durable reconciliation worker — deferred with dual write
- Dual-write removal after cutover — not applicable; never built
- Agents route migration (D-C4); freeze list 11 → 10
- Authentication (TD-8) and the actor assertion above
