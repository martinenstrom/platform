# JARVIS → Financial OS — the host contract (slice B, refined by B.1, extended for the open case, the opening and the loop through governance)

**Status: implemented and verified; contract version 4.** Written 2026-09-14
under the Slice B ruling, refined the same day under the B.1 review,
extended on 2026-09-16 with the two acts a person performs on their own open
case — `amend` and `close` (§10, TD-94) — and on 2026-09-17 with the
opening position on the person's behalf and the firm advanced on their word
— `begin` (§11, TD-88). The contract is the deliverable; the endpoint is how
it is reached.

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

## 11. The opening, on the person's behalf — `begin` (contract v4, 2026-09-17)

Until v4 `ask` convened the committee and came back `needs-decision /
institutional-initialization-required`, and nothing in the contract could
answer it: the opening position could be proposed only by a script at a
terminal (TD-88), and `amend` moves no stage. Measured on 2026-09-17 in the
gold conversation: one question, five confirmations filed as amendments,
five times "needs a thesis", no work — the loop the ruling of that day
named. The ruling settled the authority: **the person who put the question
establishes the opening, in their own words, translated by JARVIS and
confirmed by them.** `begin` is that act, and the firm advanced as far as
policy permits on it.

```ts
| { kind: 'begin'; reference: DomainReference; requestId: string; opening: HostOpening }

HostOpening =
  | { kind: 'explanation'; focus: string[] }
  | { kind: 'position'; focus: string[]; view: { statement: string; position: string } | null }

Context adds (on the result of begin only)
  commission: {
    evidence: { family; from; to; observations } | null
    started: HostDesk[]
    withheld: { desk: HostDesk | null; reason: HostWithheldReason }[]
  }
HostWithheldReason = 'no-evidence-basis' | 'no-observations' | 'no-provider' | 'no-authorized-budget'
                   | 'dependencies-not-met' | 'not-assignable' | 'no-principal' | 'declined'
```

**What the host says, and what it may not.** The host says what the person
meant: an **explanation** (why, what drives — the firm can open on it at
once) with the focus they named, or a **position** (what to do with
capital) with their view in their words and the position word read off it,
or `view: null` when they said to examine it openly or only said to go
ahead. The parser refuses a `statement`, `implications`, an
`invalidationCriteria`, a `proposedByDepartmentId` or an actor beside the
opening, by name. The firm's record is written by the firm's own
application (`opening.ts`, `openingProposal`): the statement is the
question or the view plus "Prövas mot: …"; the position is `explain`,
`open` or the person's word; the invalidation criterion is stated for the
shape; implications are `[]` for an explanation and `position-sizing` for a
position — so a conditional Risk review is decided by what the question is,
never by how the host phrased it.

**`begin`** → `ProposeThesis` revision 1 as the operator's act with the host
as initiator, unless the case already holds a revision (then nothing is
proposed and the standing is re-read); then the firm advanced:

1. the workflow's **standing evidence basis** (`STANDING_EVIDENCE`, a policy
   per playbook: `macro-regime` → `sovereign-yield-curve@1` /
   `us-par-curve`, seven days ending on the day of the act — thirty was
   measured to exhaust the desks' token budget) is assembled
   by `AssembleEvidenceSet` under the operator's convenor mandate — a
   workflow without a basis withholds every desk as `no-evidence-basis`; a
   basis with nothing in the window withholds as `no-observations`;
2. every entry of the pinned workflow, in its order, is commissioned through
   `commissionAnalysis` under **the desk's own institutional agent**
   (`no-principal` where a desk has none), with the mandate, readiness,
   dependency and budget checks exactly as the product's commission button
   applies them; the firm's refusals come back as the reasons above;
3. `begin` waits only until each run is on the record (`startWaitMs`, 3 s),
   then returns the case re-read with `commission` beside it. **The live
   run continues in the process**; how it ended is logged by the container
   (`[analysis] [begin] <case> <entry>: ran awaiting-acceptance`) and read
   back by the next `status`. A process that dies mid-run leaves what
   TD-92 describes, and the gateway reports it as `blocked /
   execution-recovery-required` as before. Without a provider (no model
   credential) every desk is `no-provider`.

**Derivation refined.** A case whose opening exists and whose desks have
not contributed reads `blocked / analysis-required` naming the desk (from
the `missing-required-contribution` blocker), no longer `synthesis-required`
for a synthesis nobody could have produced. `working` is unchanged: a run
inside its window.

**Adoption and the passes after `begin` (ruled 2026-09-17, second ruling
of the day).** A finished desk run is a candidate until its desk adopts it,
and the ruling made that adoption an internal institutional act with a
production path: on every advance, each run in `awaiting-acceptance` whose
desk has an active institutional agent is adopted by **that agent** —
`AcceptContribution`, actor the desk's principal, initiator the host — and
a synthesis candidate goes one act further through the office's own
`AggregateManagerConclusion`, which mints the revision from the exact
persisted candidate. The person is never asked; JARVIS never adopts; a
desk with no principal leaves its work waiting and is reported
`no-principal`. Adoption happens before evidence and before commissioning,
needs neither, and `commission.adopted` names the desks it happened for.
Each finished run then earns the case one more pass in the same process —
adopt what finished, commission what is now ready (the synthesis entry
scoped to the current revision, its facts read off the record at
dispatch) — up to eight passes per beginning, logged as `[advance]`. The
firm's own order of work is what stops it: under macro-regime v6 the
governance entries carry no live budget and the dev firm has no
governance principals, so the case settles at
`blocked / verification-required` with the office's revision on the
record — the honest end of what policy permits, said to the person as
such.

**The spoken sentence** is produced from the read-back
(`beginSpeech`): what the desks were asked — "ta reda på vad som driver
guld idag — makro, flöden, specifika händelser" — which desks started and on
what basis, and "Jag återkommer när det är klart" only when a run is
running; when nothing started, why, once, in plain words. Never a thesis, a
scope or an approval.

**How JARVIS walks through the door** (`application/jarvis/opening.ts`,
`liveSession.ts`): the case's own question decides explanation or
position; an explanation is begun by the runtime the moment `ask` comes back
awaiting an opening, with the person's focus or the standing default; a
position gets the one human question ("Vill du att de utgår från din egen
syn — och vad är huvudskälet — eller prövar frågan helt öppet?") and any
reasonable answer — through `begin_delegation`, or as words added to the
case — begins it: a view becomes the view, "pröva den öppet", "kör", "de
kan börja", "ja", "precis" examine openly, a focus alone is a focus.

**Refusals.** Unknown case → `unsupported / unknown-reference`; settled or
closed → `failed / case-settled`; no operator → `failed /
operator-unresolved` and nothing written; the institution's own refusal of
the revision → `failed / refused` with its code.

**Verification.** `hostContract.test.ts`: the opening accepted in its
three shapes, and refused without a request id, with an unknown kind, an
unbounded focus, a view without words, a position that is not a word, and
with the firm's record or an actor beside it. `hostGateway.test.ts`
(in-memory firm): revision 1 proposed from the person's words as the
operator's act initiated by the host, position `explain`, no implication;
a second beginning proposes nothing; a view written with `position-sizing`;
the standing evidence assembled and `no-observations` reported truthfully
with no run; foreign reference, no operator, settled case refused.
`opening.test.ts` (both): the proposal's shapes; the reading of kind, focus,
confirmation, open examination and view. `liveSession.test.ts`: an
explanation begun at once with no second question; the one question for a
capital question and `begin_delegation` on "pröva den öppet"; words added to
an awaiting case taken as the opening; a bare confirmation and a focus read
as such; the truthful sentence when no desk could start.

## 12. The loop through governance — `filed`, `activity.failed`, the objection read (contract v4, G1, 2026-09-17/18)

The ruling that accepted `b0e1028` named governance as the next boundary and
G1 as the slice: the control functions perform their own acts, through their
own principals, with no door for a person to press and nothing asked of the
person. The contract grows by two fields and one runtime read; the request
union does not change.

```ts
Context adds (on the result of begin only)
  commission: {
    …as §11…
    /** A control function's candidate filed as its verdict, objection or examination by its own principal in this pass. */
    filed: HostDesk[]
  }

Activity adds (every case-bearing result)
  activity: {
    …as before…
    /** Runs that failed and were not retried by the firm on its own. */
    failed: number
  }
```

**What the passes now do.** Each pass, in order: adopt every finished desk
run through its desk's principal (§11); **file** every finished control
function run through that function's principal — `RecordVerificationReview`,
`RecordDevilsAdvocateReview`, `RecordPeerExamination`, each with
`candidateFromRunId`, so the verdict is exactly the persisted candidate and
nothing the caller says; then, when the firm's standing says the office owes
the submission, the Risk principal resolves whether Risk applies
(`ResolveConditionalRequirement`, by `risk-agent`) and the office's principal
submits the aggregated revision for verification
(`SubmitForVerification`, by `research-office-agent` — the act that moves the
case from research into review, which a department's principal may now do,
migrations 0052 and 0053); then commission whatever the workflow now owes: the
three control functions, each scoped to the revision under scrutiny, reading
only what its mandate requires off the record at dispatch. Nothing submits to
the CIO. The firm retries a failed run on the person's word only, never on a
pass it gave itself. Passes are serialised per case.

**Where it stops, and how the person hears it.** `answer-ready /
committee-conclusion` when every control function has filed and nothing
blocks; `blocked / objections-unresolved` when an open objection decides the
answer — and the runtime then reads the objections itself
(`inspect: objections`) so the tool result names the objector and the
argument, never a count; `blocked / verification-required`,
`risk-review-required` and the rest as before, with `activity.failed` said as
"Ett bord kunde inte slutföra sitt arbete." when a run failed. A desk with no
principal is `withheld: no-principal`; a control function with no provider or
no authorised budget is `no-provider` / `no-authorized-budget`; Risk's review,
which has no candidate boundary yet (TD-98), is `no-provider` once its queue
is open.

**Identity, unchanged and proven live.** Actor is always the principal
performing the act — a desk's agent, a control function's agent, Risk's
agent, the office's agent, or the operator for the person's own acts (ask,
begin, amend, close). Initiator is the host (`orchestrator:jarvis`) for what
the firm does on the person's word and `orchestrator:agent-headquarters` for
what the orchestrator does inside a run. JARVIS is never the actor of
anything. Every act above is on the ledger with both, read back by
`scripts/probe-jarvis-intent.mjs --keep-open` (§14 of the proof).

## 13. Explanation governance and decision governance are different — `inquiry` (contract v4, ruled 2026-09-18)

The ruling that accepted `a597f55` resolved TD-100 by constraining the
semantics of an explanatory opening: an explanation must not become a
portfolio-risk workflow because the synthesis used broad implication
language, and analytical dissent must not automatically hard-block an
explanation. The contract grows by one word on the committee's conclusion;
the doctrine behind it lives in the domain.

```ts
CommitteeConclusion adds
  /** What kind of question the committee answered, read off the opening revision. */
  inquiry: 'explanation' | 'judgement'
```

**The kind of question is read off the record.** The opening revision is the
record of what the person asked: an explanatory opening carries the position
word `explain` (`EXPLANATORY_POSITION`); anything else asked for a judgement.
`inquiryKindOf(revisions)` is the one derivation, in the domain, and it does
not move when a later revision takes a position — the class is what was asked,
not what a model later wrote.

**What the kind decides.**

| | explanation | judgement |
|---|---|---|
| the synthesis (`synthesisPermittedFor`) | position stays `explain`; implementation implications are refused — the office explains in its prose | any position, any implications |
| Risk's requirement | resolves `not-required` by the pinned rule, because there are no implications | as the implications say |
| an open objection (`challengeBlocks`) | retained dissent whatever its weight, unless it is a factual contradiction (`contradicting-evidence`) at or above the policy's materiality | blocks at or above the policy's materiality, as before |
| Verification | unchanged: a blocking finding still stops the firm | unchanged |
| the answer | `answer-ready / committee-conclusion` with `inquiry: 'explanation'`, said as "Kommitténs förklaring …", retained dissent named as dissent | as before |
| the CIO | never required | never automatic |

The rule is applied where the office institutionalises its conclusion
(`AggregateManagerConclusion` refuses a judgement nobody asked for, whether
a person stated it or a candidate carried it) and stated in the live
synthesis contract, whose parser refuses the same shape as malformed. Every
control function's context carries the kind, the original question and the
opening's scope, so a control reviewing "why is gold up today" does not
evaluate it as "should we increase gold exposure".

**What did not change.** The eligibility policy's materiality threshold;
Verification's hard blocks (an unsupported claim, stale evidence, a citation
mismatch); the human path; the CIO's gate. Risk's own candidate boundary stays
open as TD-98, and the round that would answer a retained objection as TD-99.
