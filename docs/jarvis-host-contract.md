# JARVIS → Financial OS — the host contract (slice B, refined by B.1, extended for the open case)

**Status: implemented and verified; contract version 3.** Written 2026-09-14
under the Slice B ruling, refined the same day under the B.1 review, and
extended on 2026-09-16 with the two acts a person performs on their own open
case — `amend` and `close` (§10, TD-94). The contract is the deliverable; the
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
FinancialOsSystem            ask / resume / amend / close / overview / reference — nothing else
        ↓
persisted institutional state
        ↓
HostResult                   working · answer-ready · blocked · needs-decision · closed · unsupported · failed
```

Files: [`src/application/analysis/hostContract.ts`](../src/application/analysis/hostContract.ts)
(types and parser), [`src/application/analysis/hostGateway.ts`](../src/application/analysis/hostGateway.ts)
(derivation and gateway), `financialOsHostFn` in
[`src/infrastructure/analysis/serverFns.ts`](../src/infrastructure/analysis/serverFns.ts)
(the door), [`scripts/probe-host-gateway.mjs`](../scripts/probe-host-gateway.mjs)
(the browser probe).

---

## 0. The three states the firm must never confuse

| The firm…            | State            | A host may say                         |
| -------------------- | ---------------- | -------------------------------------- |
| has work in progress | `working`        | "Jag kollar på det."                   |
| cannot proceed alone | `blocked`        | "Analysen kan inte fortsätta just nu." |
| needs the person     | `needs-decision` | "Jag behöver ditt beslut på en sak."   |
| was told to stop     | `closed`         | "Ärendet är stängt."                   |

Financial OS provides the state and its typed reason. JARVIS owns the
sentence; none of these strings live in Financial OS.

## 1. The request union

```ts
type HostRequest =
  | { kind: 'ask'; requestId: string; question: string; subject: string }
  | { kind: 'resume'; reference: DomainReference }
  | { kind: 'status'; reference: DomainReference }
  | { kind: 'result'; reference: DomainReference }
  | { kind: 'inspect'; reference: DomainReference; view: InspectView }
  | { kind: 'amend'; reference: DomainReference; requestId: string; text: string }   // v3, §10
  | { kind: 'close'; reference: DomainReference; reason: string }                    // v3, §10

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
  | (Context & { state: 'answer-ready'; kind: 'committee-conclusion' | 'cio-decision'; answer?; inspection? })
  | (Context & { state: 'blocked'; block: HostBlock; inspection? })
  | (Context & { state: 'needs-decision'; decision: HostDecision; inspection? })
  | (Context & { state: 'closed'; closure: HostClosure; inspection? })              // v3, §10
  | { state: 'unsupported'; reason: UnsupportedReason; reference? }
  | { state: 'failed'; reason: FailureReason; code?; field?; reference?; resumable? }

Context      = { reference; question; subject; surfaces: { boardroom; record }; activity; amendments }
HostActivity = { stage; desks: HostDesk[]; outstanding: CaseStep[]; inFlight; expired; awaitingAdoption }
HostAmendments = { count; latestAt; workPredates }                          // counted, never copied (v3)
HostClosure    = { kind: 'cancelled' | 'abandoned'; reason; at; byDesk }     // read off the record (v3)

HostDecision =
  | { reason: 'institutional-initialization-required' }   // TD-88
  | { reason: 'cio-decision-required' }

HostBlock = { reason: BlockedReason; owner: HostDesk | null }
BlockedReason =
  | 'execution-recovery-required' | 'adoption-required' | 'analysis-required'
  | 'synthesis-required' | 'peer-scrutiny-required' | 'verification-required'
  | 'challenge-required' | 'risk-review-required' | 'objections-unresolved'
  | 'returned-for-revision' | 'institutional-requirement-outstanding'

UnsupportedReason = 'unknown-reference' | 'not-routable' | 'unknown-desk' | 'no-institutional-conclusion'
FailureReason     = 'invalid-request' | 'operator-unresolved' | 'convening-incomplete'
                  | 'not-configured' | 'service-unavailable' | 'case-settled' | 'refused'
```

`answer` travels only with `result`; `status` states the fact — and its
`kind` — without the material. `inspection` travels only with `inspect`. No
model, provider or reasoning tier appears anywhere. No institutional act code
(`record-verification-review`, `submit-for-cio-decision`, …) appears in any
result: `blocked.reason` is the capability the case waits on, and `owner` is
named only from the firm's governance table, never from array order (TD-91).

## 3. Mapping to `FinancialOsSystem`

| Request   | Port call                                       | Then                                                                                         |
| --------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ask`     | `system.ask(delegation, { question, subject })` | `convened` → read the case; `convening-incomplete` → `failed` + `resumable`; refusals mapped |
| `resume`  | `system.resume(delegation, reference.id)`       | same                                                                                         |
| `status`  | `system.overview(id)`, `system.reference(id)`   | derive the product state                                                                     |
| `result`  | same                                            | derive; on `answer-ready`, read the answer off the record                                    |
| `inspect` | same                                            | derive; attach the projection                                                                |
| `amend`   | `system.amend(delegation, id, text)`            | `done` → read the case; `not-found` → `unsupported`; `illegal-prior-state` → `failed / case-settled`; other refusals → `failed / refused` |
| `close`   | `system.close(delegation, id, reason)`          | same                                                                                         |

Nothing else on the port is reachable through the gateway.

## 4. How each state is derived — read, never kept

`productStateFor(overview, now)` is pure over `CaseOverview`, the read model
Huvudkontoret and the Boardroom render. There is no host-side state machine.
Precedence, top to bottom:

0. **`closed`** ⇔ the case is `withdrawn` (v3, §10). Precedes everything, a
   run inside its window included: the person ended the case, and work the
   firm will not adopt is not "in progress" to them — it is still counted in
   `activity.inFlight`. `closure.kind` is derived, never stored: `cancelled`
   when a run, a claim or a revision exists, else `abandoned`.
1. **`working`** ⇔ some run is inside its **active execution window**:
   `running` and `startedAt + budget.deadline.deadlineMs > now`. This is the
   firm's own view of the run — every live run records that deadline because
   the firm refuses to start one without — and it is _not_ a claim that a
   process or provider connection is physically alive at this instant (TD-92).
2. **`answer-ready / cio-decision`** ⇔ a live decision on a settled case.
3. **`blocked / execution-recovery-required`** ⇔ a `running` row outside any
   window (`activity.expired > 0`). Measured: a stub run left `running` on
   2026-09-06 was still there on 2026-09-14. The person is never asked to
   repair infrastructure, so this precedes every decision.
4. **`blocked / adoption-required`** ⇔ produced work awaits its desk; nothing
   continues it on its own today.
5. From `standing.nextAct`, the firm's own reading:

| `nextAct.act`                                     | Product state                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `propose-thesis`                                  | `needs-decision / institutional-initialization-required` (TD-88)                                  |
| `decide-or-return`                                | `needs-decision / cio-decision-required`                                                          |
| `submit-for-cio-decision`                         | `answer-ready / committee-conclusion` if ready (§5); else `blocked` from the evaluator's blockers |
| `unblock`                                         | `blocked` from the blockers, owner from the blocker                                               |
| `aggregate-conclusion`                            | `blocked / synthesis-required`, owner null                                                        |
| `submit-for-verification`                         | `blocked / verification-required`, owner null                                                     |
| `record-peer-examination`                         | `blocked / peer-scrutiny-required`, owner null                                                    |
| `record-verification-review`                      | `blocked / verification-required`, owner Verification                                             |
| `record-devils-advocate-review`                   | `blocked / challenge-required`, owner Devil's Advocate                                            |
| `resolve-risk-requirement` / `record-risk-review` | `blocked / risk-review-required`, owner Risk                                                      |
| `resubmit-after-return`                           | `blocked / returned-for-revision`                                                                 |
| `none-settled` without a decision                 | `unsupported / no-institutional-conclusion`                                                       |

Blockers map to reasons by kind — verification kinds → `verification-required`,
unresolved material challenge and decision-critical disagreement →
`objections-unresolved`, risk kinds → `risk-review-required`, missing or
failed contributions → `analysis-required`, everything else →
`institutional-requirement-outstanding`. The gateway reads which blockers
exist; it decides nothing about whether they block.

**TD-88** therefore surfaces as a decision boundary and nothing is
manufactured: `ask` on a routable question convenes the committee and comes
back `needs-decision / institutional-initialization-required` with the
reference — seventeen of the dev firm's twenty-one persisted cases sit there.

## 5. The answer — committee conclusion or CIO decision, never confused

`answer-ready` carries `kind`, and `result` carries the matching answer:

**`committee-conclusion`** — the normal investment answer while CIO authority
is deferred. Ready ⇔ the current revision was produced by a synthesis (not
merely proposed) **and** every scrutiny step the instantiated workflow
requires — peer examination, Verification, Devil's Advocate, Risk — is
complete or not applicable as the standing reads it **and** the eligibility
evaluator records no `blocks-decision` blocker **and** the firm's own next act
is the submission to the CIO — so the case is not returned, not blocked on a
stage, and not already with the CIO. Carries `thesis` (revision, statement, position,
invalidation criteria, horizon, implications), `synthesisedBy`, `scrutiny`
(the verdicts on that exact revision, as stored), `dissent` (every objection
still open against it) and `materialDissentCount`. No dev case qualifies yet —
every governed case in the firm was submitted to the CIO as soon as
governance cleared it — so the test constructs one from the `awaiting`
record with the submission removed. The contract models the meaning now.

**`cio-decision`** — a live decision on a settled case, read field by field:
`decision`, the selected `thesis`, the acknowledged `dissent`,
`materialDissentCount` (by the domain's own `dissentRequiresAcknowledgement`),
`reconsiderationTriggers`.

A conclusion is never promoted into a decision; a decision, where one exists,
sits above the conclusion. Proven: a test walks every string in either answer
and requires it verbatim in the record; the gateway module imports no
provider.

## 6. Identity

- **Initiator** — `HOST_ORCHESTRATOR_ID = 'jarvis'`, set by the server.
- **Actor** — the server-resolved current operator, the same rule
  `getCurrentOperatorFn` applies. The request cannot name one. Unconfigured →
  `failed / operator-unresolved / NOT_CONFIGURED`, and nothing is created.
- Reads record no act and need no operator.

## 7. The reference

Every positive result carries `reference` — enough to bind the next turn to
the same institutional work. The inbound `provenanceId` is never used to
answer; every call re-reads the case and returns the provenance of that read.
`surfaces` carries the canonical deep links.

## 8. What `inspect` exposes

Typed projections the Boardroom already renders: `debate` (entries and
seats), `desk` (one desk's entries, participation, claim statements),
`objections` (each with `reviewId`, `byDepartmentId`, `raisedAs`, `superseded`).

## 9. Verification

**Semantic-boundary tests** — `hostContract.test.ts` (fixtures generated
from PostgreSQL) and `hostGateway.test.ts` (in-memory firm). Working never
without a run in its window · working with one, whatever else is owed ·
never for a row past its deadline, nor one without a deadline (→ `blocked`,
recovery) · produced work awaiting adoption → `blocked` · outstanding
Verification, Devil's Advocate and peer work → `blocked`, never a decision ·
owners only from the governance table · a synthesis with a blocking
objection → `blocked`, not an answer · CIO decision for the decided and
reconsidered cases · committee conclusion once every gate is settled ·
never promoted into a decision · not an answer merely because prose exists ·
a reopened deferral is with the CIO · TD-88 → needs-decision · with the CIO
→ needs-decision · never needs-decision for desk work · an orphan run never
becomes the person's decision · answers verbatim from the record · no
invented string · dissent kept in both kinds · no act code in any state or
activity · parser refuses actors, commands, entry keys, candidates,
`advance` · ledger initiator/actor · nothing created without an operator ·
stale provenance re-read · no run state or command name in any result ·
gateway imports no provider.

**Live browser probe** — `scripts/probe-host-gateway.mjs`: headless Chromium
loads HQ, imports the client-transformed `serverFns` and calls the function
through the production RPC path (`x-tsr-serverFn: true`, seroval framing)
against every case the dev firm holds. The orphan run is the specimen for
TD-92.

## 10. The two acts on the open case — `amend` and `close` (contract v3, 2026-09-16)

The two things a person says most while a case is open, measured in the
voice proof: _"Ta hänsyn till dollarn också"_ and _"Stäng ner det pågående
ärendet."_ Before v3 the first had no door (TD-94) and the second had a
stage (`withdrawn`) but no act — and the voice, asked to do either, said it
had. Both are now real institutional acts with provenance, reached through
the same door as everything else, with the same identity rule: the request
names no actor; the server-resolved operator is the actor and the host is
the initiator.

```ts
| { kind: 'amend'; reference: DomainReference; requestId: string; text: string }
| { kind: 'close'; reference: DomainReference; reason: string }

HostResult adds
  | (Context & { state: 'closed'; closure: HostClosure; inspection? })
Context adds
  amendments: { count: number; latestAt: string | null; workPredates: boolean }
HostClosure = { kind: 'cancelled' | 'abandoned'; reason: string | null; at: string; byDesk: HostDesk | null }
FailureReason adds 'case-settled'
```

**`amend`** → `AmendCase`. The person's words are appended beside the
question — never folded into it; the question is the one column the
application may not update — with who, when, and the case version at the
time. It moves no stage and starts no work. `requestId` is the idempotency
key, as on `ask`: a retry lands on the same record. The result is the case
re-read, so the host learns what the firm recorded and nothing else; the
words themselves are not repeated in the contract (`amendments` counts them).
`workPredates` is the one fact a host must say beside an addition: some run
started before the latest addition, so work already done did not take it
into account. Whether the desks must look again is a later act with its own
mandate; nothing here promises it.

**`close`** → `CloseCase`. The case becomes `withdrawn` with the person's
reason, the actor and one movement event; history stands. **`closed`** is
derived, never stored, and precedes every other product state — a run
inside its window on a closed case is still counted in `activity.inFlight`
(it is true and it costs money) but the person is not told the firm is
working for them. `closure.kind` is read off the record: `cancelled` when a
run, a claim or a revision existed; `abandoned` when nothing had been done.
There is no reopening from the contract; `ReopenCase` is unwritten.

**Refusals.** Either act on a case the firm has settled or the person has
closed → `failed / case-settled`. Unknown case → `unsupported /
unknown-reference`. Any other institutional refusal → `failed / refused`
with the institution's own code. No operator → `failed /
operator-unresolved`, and nothing is written.

**Verification.** `hostContract.test.ts`: closed never for a case that is
not withdrawn · wins over a run in its window and reads cancelled · past
the window still closed, never blocked on recovery · abandoned when nothing
started, missing reason kept missing · a claim alone is work · additions
counted, `workPredates` only when a run started before the latest · the
words never copied · parser accepts both acts in their exact shapes,
refuses empty words, a missing request id, a missing reason, and an actor,
version, stage or department by name. `hostGateway.test.ts` (in-memory
firm): an addition lands as the operator's act with the host as initiator
beside an unchanged question · a retry lands once, a second addition beside
the first · `workPredates` after a run started earlier · close carries the
reason into the transition and the ledger, reads back closed, and refuses
both acts afterwards as `case-settled` · cancelled with work in flight, and
still counted · no operator, nothing changes · a foreign reference refused
for both · no command name, version or stage in any result.
`caseCommands.test.ts`: both commands against the in-memory reference
(mandate, owner check, blank words, closed case, reason and version
policies, replay, second addition as a second record; withdraw with reason
and event, cancelled/abandoned derived, from a working stage, never twice,
stale version). `repositoryContract.ts`: the addition store, both adapters
(empty list, round trip, idempotent append that never rewords, ordering by
time then id, frozen reads). `permissions.pg.test.ts`: `finos_app` may add
and may not reword or remove. `liveTools.test.ts`, `liveSession.test.ts`,
`liveSpeech.test.ts`: the voice's two tools, bound-case only, the spoken
sentence produced from the read-back.
