# JARVIS → Financial OS — the host contract (slice B)

**Status: implemented, verified, awaiting review before slice C.** Written
2026-09-14 under the Slice B ruling. The contract is the deliverable; the
endpoint is how it is reached.

```
JARVIS decides: "does this need Financial OS?"
        ↓ yes
financialOsHostFn            one server function, POST, input taken as unknown
        ↓
parseHostRequest             the door: exact shapes, unknown fields refused by name
        ↓
createHostGateway            application layer, on FinancialOsSystem
        ↓
FinancialOsSystem            ask / resume / overview / reference — nothing else
        ↓
persisted institutional state
        ↓
HostResult                   working · answer-ready · needs-decision · unsupported · failed
```

Files: [`src/application/analysis/hostContract.ts`](../src/application/analysis/hostContract.ts)
(types and parser), [`src/application/analysis/hostGateway.ts`](../src/application/analysis/hostGateway.ts)
(derivation and gateway), `financialOsHostFn` in
[`src/infrastructure/analysis/serverFns.ts`](../src/infrastructure/analysis/serverFns.ts)
(the door), [`scripts/probe-host-gateway.mjs`](../scripts/probe-host-gateway.mjs)
(the browser probe).

---

## 1. The request union

```ts
type HostRequest =
  | { kind: 'ask'; requestId: string; question: string; subject: string }
  | { kind: 'resume'; reference: DomainReference }
  | { kind: 'status'; reference: DomainReference }
  | { kind: 'result'; reference: DomainReference }
  | { kind: 'inspect'; reference: DomainReference; view: InspectView }

type InspectView =
  { kind: 'debate' } | { kind: 'desk'; departmentId: string } | { kind: 'objections' }

type DomainReference = {
  system: 'financial-os'
  kind: 'case'
  id: string
  provenanceId: string
}
```

No actor. No playbook entry. No command. No candidate. No `advance`.
`parseHostRequest` takes `unknown` and refuses any key the contract does not
name — `actingEmployeeId`, `actorId`, `agentPrincipalId`, `command`,
`entryKey`, `candidateFromRunId`, `initiator` all come back as
`{ state: 'failed', reason: 'invalid-request', field }`. `kind: 'advance'`
comes back as `field: 'kind'`.

## 2. The result union

```ts
type HostResult =
  | (Context & { state: 'working'; inspection? })
  | (Context & { state: 'answer-ready'; answer?: InstitutionalAnswer; inspection? })
  | (Context & { state: 'needs-decision'; decision: HostDecision; inspection? })
  | { state: 'unsupported'; reason: UnsupportedReason; reference? }
  | { state: 'failed'; reason: FailureReason; code?; field?; reference?; resumable? }

Context = { reference; question; subject; surfaces: { boardroom; record }; activity }

HostActivity = { stage; desks: HostDesk[]; outstanding: CaseStep[]; inFlight; unverified; awaitingAdoption }

HostDecision =
  | { reason: 'institutional-initialization-required' }              // TD-88
  | { reason: 'cio-decision-required' }
  | { reason: 'institutional-act-required'; act: InstitutionalAct; owner: HostDesk | null }

UnsupportedReason = 'unknown-reference' | 'not-routable' | 'unknown-desk' | 'no-institutional-conclusion'
FailureReason     = 'invalid-request' | 'operator-unresolved' | 'convening-incomplete'
                  | 'not-configured' | 'service-unavailable' | 'refused'
```

`answer` travels only with `result`; `status` states the fact without the
material. `inspection` travels only with `inspect`. No model, provider or
reasoning tier appears anywhere in either union.

## 3. Mapping to `FinancialOsSystem`

| Request   | Port call                                       | Then                                                                                         |
| --------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ask`     | `system.ask(delegation, { question, subject })` | `convened` → read the case; `convening-incomplete` → `failed` + `resumable`; refusals mapped |
| `resume`  | `system.resume(delegation, reference.id)`       | same                                                                                         |
| `status`  | `system.overview(id)`, `system.reference(id)`   | derive the product state                                                                     |
| `result`  | same                                            | derive; on `answer-ready`, read the answer off the record                                    |
| `inspect` | same                                            | derive; attach the projection                                                                |

Nothing else on the port is reachable through the gateway. `queue`,
`operators`, `caseIdFor` are not exposed.

Delegation refusals: `NOT_ROUTABLE` → `unsupported/not-routable`;
`UNKNOWN_OPERATOR` → `failed/operator-unresolved`; `QUESTION_REQUIRED`,
`SUBJECT_REQUIRED`, `REQUEST_ID_REQUIRED` → `failed/invalid-request` with the
firm's code; `SERVICE_UNAVAILABLE` → `failed/service-unavailable`; anything
else → `failed/refused` with the code.

## 4. How each state is proven — read, never kept

The derivation (`productStateFor(overview, now)`) is pure and reads
`CaseOverview`, the same read model Huvudkontoret and the Boardroom render.
There is no host-side state machine.

**`working`** ⇔ some run is `running` **and inside its own recorded deadline**
(`startedAt + budget.deadline.deadlineMs > now`). Nothing else: not a case
id, not a convened committee, not produced work awaiting adoption, not a
blocked human act. The deadline is the run's own record — every live run
carries one because the firm refuses to start one without (`commissionAnalysis`,
`orchestrator`). A `running` row with no measured deadline, or past it, is
counted in `activity.unverified` and is **not** work: measured on the dev
firm, a stub run started 2026-09-06 still sat in `running` on 2026-09-14, and
the first cut of the derivation would have told a host to wait for it.

**`answer-ready`** ⇔ `overview.decision !== null` **and** `standing.settled`.
A decision that still stands on a reopened case (a deferral brought back) is
history, not the answer; the case is with the CIO.

**`needs-decision`** — from `standing.nextAct`, the firm's own reading:

| `nextAct.act`                   | `decision.reason`                                   |
| ------------------------------- | --------------------------------------------------- |
| `propose-thesis`                | `institutional-initialization-required` (TD-88)     |
| `decide-or-return`              | `cio-decision-required`                             |
| any other act                   | `institutional-act-required` + `act` + `owner` desk |
| `none-settled` with no decision | `unsupported/no-institutional-conclusion`           |

**TD-88** therefore surfaces as a decision boundary and nothing is
manufactured: `ask` on a routable question convenes the committee and comes
back `needs-decision / institutional-initialization-required` with the
reference — the live probe measured seventeen of the dev firm's twenty-one
persisted cases in exactly that state.

**`unsupported`** — a reference from another system or kind, a case the firm
does not hold, a desk the organisation lacks, a question the firm has no
workflow for.

**`failed`** — the request was malformed (`field`), no operator is configured
(`code: NOT_CONFIGURED`), the convening landed half way (`resumable: true`),
the runtime is not configured or unavailable, or the institution refused with
a bounded code.

## 5. The answer is the decision

`InstitutionalAnswer` is read field by field from the live `CaseDecision`,
the revision its outcome selected, the dissent it acknowledged and the
triggers it set: `decision { decisionId, outcome, consideredRevisionIds,
rationale, decidedAt, decidedByEmployeeId, authorizationBasis, evidenceSetId }`,
`thesis { revisionId, statement, position, invalidationCriteria, horizon?,
implications, proposedByDepartmentId } | null`, `dissent[]` (every disclosed
objection, its materiality, the raiser's words and the CIO's acknowledgement),
`materialDissentCount` (by the domain's own `dissentRequiresAcknowledgement`),
`reconsiderationTriggers[]`.

Proven, not promised: a test walks every string in the answer and requires
it to exist verbatim in the fixture record; another requires the gateway
module to import no provider. There is no second conclusion.

## 6. Identity

- **Initiator** — `HOST_ORCHESTRATOR_ID = 'jarvis'`, set by the server. Both
  ledger rows of a delegated `ask` carry
  `initiator = { kind: 'orchestrator', orchestratorId: 'jarvis' }`.
- **Actor** — the server-resolved current operator
  (`resolveCurrentOperator(process.env.FINANCIAL_OS_OPERATOR_EMPLOYEE_ID, organisation)`),
  the same rule `getCurrentOperatorFn` applies. The request cannot name one.
  Unconfigured → `failed / operator-unresolved / NOT_CONFIGURED`, and nothing
  is created (measured live; the case count stayed at 21).
- Reads (`status`, `result`, `inspect`) record no act and need no operator.

## 7. The reference

Every positive result carries `reference: { system, kind, id, provenanceId }`
— enough to bind the next conversational turn to the same institutional work.
The inbound `provenanceId` is never used to answer: every call re-reads the
case and returns the provenance of that read (tested: a remembered provenance
in, the current one out, state derived from the store). `surfaces` carries
the canonical deep links `/cases/$caseId` and `/cases/$caseId/underlag`.

## 8. What `inspect` exposes

Typed projections the Boardroom already renders, never storage objects:

- `debate` — `BoardroomEntry[]` (every persisted act by durable id, with
  objections where an act filed them) and `BoardroomSeat[]`.
- `desk` — one desk's entries, its participation state, and its claims
  `{ id, statement, type, status, confidence, supportsThesisId?, opposesThesisId? }`
  — "vad sa Rates?"
- `objections` — every objection with `reviewId`, `byDepartmentId`, `raisedAs`
  (`peer-examination` | `devils-advocate`), `superseded` — "vilka invändningar
  återstår?"

## 9. Verification

**Semantic-boundary tests** (`hostContract.test.ts`, 23; `hostGateway.test.ts`, 12):
working never without a verifiably running run · working with one, whatever
else is owed · not for produced work awaiting adoption · not for a running
row past its deadline · not for one with no measured deadline · answer-ready
only with a live decision on a settled case · not while with the CIO · not on
a reopened deferral · TD-88 as `institutional-initialization-required` ·
outstanding act and owner named · answer fields verbatim from the record ·
no invented string · material dissent not stripped · inspect views ·
parser refuses actors, commands, entry keys, candidates, `advance`,
malformed references, empty questions · ledger initiator/actor · no case on
operator-unresolved · retried delegation lands on one reference · stale
provenance re-read · no run state, candidate, entry key or command name in
any result · gateway imports no provider.

**Live browser probe** (`scripts/probe-host-gateway.mjs`, headless Chromium
against the dev server, the production RPC path — `x-tsr-serverFn: true`,
seroval framing): HQ renders; 21 persisted cases read through `status` and
`result`; `inspect` debate/objections/ghost desk; unknown and foreign
references → `unsupported`; actor, `advance` and `command` refused by field;
no operator → `failed/operator-unresolved`, nothing created. Results are
recorded in the slice B report.
