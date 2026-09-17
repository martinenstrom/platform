# Governance as a production path — reconciliation against P5C/P5D/P5E, and the smallest legitimate slice

**Status: analysis only, 2026-09-17. Nothing implemented. STOPPED for
ruling.** Written after the ruling that accepted `b0e1028` and named
governance the next boundary: the autonomous loop after `begin` settles at
_Research Office revision → blocked: verification required_, which is
institutionally correct, because the control functions have no production
principals and no production filing path.

The end-to-end status, recorded as ruled:

| Step | Status |
| --- | --- |
| natural-language initiation | PROVEN |
| institutional opening | PROVEN |
| specialist commissioning | PROVEN |
| specialist internal adoption | PROVEN |
| Research Office candidate adoption / revision | PROVEN IN TESTED INSTITUTIONAL FLOW |
| live provider completion | BLOCKED BY PROVIDER CREDIT BALANCE |
| full authoritative institutional conclusion | NOT YET PROVEN END-TO-END |

Nothing below claims the final loop is proven. It says what would let the
retained gold case reach the authoritative state policy permits, with no
turn of the person's after the instruction.

---

## 0. What P5 established, measured in the tree

**P5C (closed at `1b88087`)** made governance an instance of the firm's
candidate/adoption doctrine for three control acts. `RecordGovernanceCandidate`
writes what a control function's model produced — a verification verdict
with findings, a Devil's Advocate objection set, a peer examination — into
its own candidate store and leaves the run **awaiting acceptance**; it
carries no `governance-verdict` mandate and creates no review. Filing is
the institutional act: `RecordVerificationReview`, `RecordDevilsAdvocateReview`
and `RecordPeerExamination` each accept a `candidateFromRunId` form that
institutionalises **the persisted candidate and nothing the caller says**,
completes the producing run, and refuses a principal that is not the
control function (`not-authorised`), a candidate that was never produced,
and a candidate whose argument moved underneath it. The candidate's basis
— revision, playbook pin, the claim ids in scope — is read off the record
at production, never supplied. Two doctrines are in the domain builders
themselves: a Devil's Advocate candidate with no objection **throws**
("the control not being performed, recorded as though it had been"); a
peer examination with no objection is accepted as scrutiny that happened.

**What P5C left out, deliberately:** the dev firm's governance principals
(P5D) and live proofs (P5E). The test organisation seats
`verification-agent` and `devils-advocate-agent`; the dev firm seats only
`global-macro-agent`, `rates-agent` (migration 0040) and
`research-office-agent` (0046). Risk got no candidate boundary:
`RecordRiskReview` has only the direct form.

**What is already fine and needs no work.** The `governance-verdict`
mandate (`domain/analysis/authority.ts`) authorises an actor whose
department is a control function, whose role's function is `governance`,
and whose department handles the discipline — it reads nothing
employee-shaped, so an agent principal passes it unchanged. Independence is
structural: a Research Office principal can never file a verdict because
its department is not a control function, and `governanceAdoption.test.ts`
proves the refusal. The dev firm's roles `head-of-verification`,
`head-of-devils-advocate` and `chief-risk-officer` have function
`governance`; the departments `verification`, `devils-advocate` and `risk`
are governance departments handling `verification`, `challenge` and `risk`.

**What the orchestration cannot do yet.** `runPlaybook` records every
provider result through `RecordContribution`, which refuses a claimless
result — correctly, twice over — so a control function's output has no way
from a provider into its candidate store: no governance provider exists, no
orchestration step routes to `RecordGovernanceCandidate`, and macro-regime
v6 budgets none of the governance entries, so each still refuses to start
live. Nothing violates the boundary today because nothing can reach it.

---

## 1. Which governance functions can legitimately be autonomous

The ruling's distinction — an **internal governance act** is not a **human
decision** — maps onto the firm's own mandates as follows.

| Function | Act | Mandate today | Autonomous under existing policy? | Principal |
| --- | --- | --- | --- | --- |
| **Verification** | verify every claim the revision rests on against its cited evidence; file a verdict with findings | `governance-verdict / verification` | **Yes.** Candidate boundary exists (P5C); the mandate authorises an agent; the workflow requires it | `verification-agent` (to seat) |
| **Devil's Advocate** | argue the opposite; file objections against named claims with materiality | `governance-verdict / challenge` | **Yes.** Candidate boundary exists; the domain refuses an objection-less filing; materiality decides whether the objection blocks (`challengeBlocksAtOrAbove: material`) | `devils-advocate-agent` (to seat) |
| **Peer Examination** (Rates reads the synthesis) | examine as a qualified peer; raise objections or record that none were raised | `department-contribution / rates` | **Yes.** Candidate boundary exists; zero objections is a legitimate examination; the principal already exists | `rates-agent` (exists) |
| **Risk — the conditional resolution** | decide whether Risk Review applies to this revision, by the pinned rule | `governance-verdict / risk`, reason required | **Yes, as a rule application.** `ResolveConditionalRequirement` evaluates `risk-review-when-implementable@1` on the revision's declared implications; the rule supplies the reason; an explanation (`implications: []`) resolves _not required_ | `risk-agent` (to seat) |
| **Risk — the review itself** | assess exposure, sizing, concentration, tail risk; file a verdict | `governance-verdict / risk` | **Not yet.** No candidate boundary (`RecordRiskReview` is direct-only); making it autonomous means extending P5C to Risk first. It is only owed when a revision declares implementation implications — a capital question, never the gold explanation | `risk-agent`, later |
| **Submit for verification** | move the aggregated revision into scrutiny | `department-manager / research-office` | **Yes.** An internal workflow act by the office that owns the synthesis; `research-office-agent` holds the `research-director` role, which manages the department | `research-office-agent` (exists) |
| **Answer a material objection** | revise the thesis for cause `resolved-challenge`; the Devil's Advocate re-examines | `thesis-owner / research-office` then the DA again | **Yes in principle**, as another autonomous round; **not in the first slice** (see §6) | `research-office-agent`, `devils-advocate-agent` |

## 2. Which functions require human authority — preserved, not automated

| Act | Mandate | Why it stays human |
| --- | --- | --- |
| **CIO decision** (`RecordCaseDecision`) | `chief-decision` | the decision itself; the north star's gate; the human/agent boundary ruling of 2026-08-13 |
| **Return from CIO review** | the CIO | same authority, other direction |
| **Submit to the CIO** (`SubmitForCioDecision`) | `thesis-owner` | not a decision, but it places a conclusion before a human decision-maker. Proposed: the autonomous loop **stops at the committee conclusion** (`answer-ready / committee-conclusion`), which is the authoritative pre-decision state; submission to the CIO happens only when the person asks for a decision — a capital question — never for an explanation. **Ruling requested.** |
| Publication, policy, budget, mandate, threshold, playbook version changes | executive / governance | the north star's decision gates; a new playbook version (§5) is itself a human act performed by a migration and a review, never by a runner |
| Capital, trading, external communication | outside the domain | as ruled |
| Reopening a closed case | unwritten (`ReopenCase`) | as ruled in v3 |

The principle the loop enforces, in the firm's own vocabulary: an act with a
`governance-verdict`, `department-contribution` or `department-manager`
mandate held by a seated principal may be performed on the person's
instruction; an act with a `chief-decision` mandate, or any act outside
the domain, is a human decision and stops the loop with the state that
names it.

## 3. Required governance principals — P5D, the minimum

Three rows in `analysis.agent_principals`, by a migration in the shape of
0040 and 0046, reusing the roles the firm already has. No new agent
framework, no new role, no new mandate.

| Principal | Department | Role (existing, function `governance`) | Acts it may perform |
| --- | --- | --- | --- |
| `verification-agent` | `verification` | `head-of-verification` | `RecordGovernanceCandidate` (as its desk's work), `RecordVerificationReview` (filed form) |
| `devils-advocate-agent` | `devils-advocate` | `head-of-devils-advocate` | `RecordGovernanceCandidate`, `RecordDevilsAdvocateReview` (filed form) |
| `risk-agent` | `risk` | `chief-risk-officer` | `ResolveConditionalRequirement`; later `RecordRiskReview` once it has a candidate boundary |

`rates-agent` already performs the peer examination
(`department-contribution / rates`); `research-office-agent` already
submits for verification. The test organisation's two governance agents
carry a synthetic `governance` role; the dev seeding uses the firm's real
role ids so the ledger names the same role a person would hold. No
`organization_seed_versions` bump is needed for principals, as 0046 argued.

## 4. Existing commands and ports to reuse — nothing new is invented

- **Candidate boundary:** `RecordGovernanceCandidate` (three kinds), the
  domain builders `buildVerificationCandidate`, `buildDevilsAdvocateCandidate`,
  `buildPeerExaminationCandidate`, `claimsInScopeOf`, and the stores
  `producedVerifications`, `producedDevilsAdvocateReviews`,
  `producedPeerExaminations`.
- **Filing:** the `candidateFromRunId` forms of `RecordVerificationReview`,
  `RecordDevilsAdvocateReview`, `RecordPeerExamination`; the stale check and
  the control-function check inside them.
- **The conditional:** `ResolveConditionalRequirement` with the pinned rule
  `risk-review-when-implementable@1`.
- **Workflow acts:** `SubmitForVerification` (RO manager), later
  `SubmitForCioDecision` (thesis owner) under the ruling of §2.
- **Commissioning:** `commissionAnalysis` → `runPlaybook` → `StartAgentRun`
  with the same eligibility (dependencies, assignment state, budget) and
  the same run record, identity and usage provenance.
- **Authority and audit:** `authorize` with the existing mandates; the
  command ledger with `actor` (the principal) and `initiator` (the host);
  `runCommand`'s replay by command id.
- **Advancement:** the passes `b0e1028` added to `FinancialOsSystem.begin`
  — adopt what finished, commission what is ready, advance again when a run
  ends — extended with the governance branch, not replaced.
- **Reading and speaking:** `productStateFor`, `committeeConclusionReady`,
  `institutionalAnswerFor`; the host contract's `answer-ready /
  committee-conclusion` with `answer`; JARVIS's `get_delegation_result` and
  the `answerLines` speech, all of which exist and are tested.

## 5. Missing production doors — the smallest set

1. **Governance providers** (`infrastructure/analysis/providers/`): one
   live provider per control act, built like `liveSynthesis.ts` — a
   context read off the record at dispatch, a system prompt that states the
   control's own contract, JSON out, validated by the domain builder, never
   free text. Three contexts: _verification_ (the revision, every claim in
   scope with its cited observations and their values, so the model checks
   each claim against what it cites and returns a finding per discrepancy
   and `verified` only when it found none); _challenge_ (the revision, its
   claims and the evidence, with the instruction that it **must** name at
   least one objection against a named claim and grade its materiality —
   the domain refuses an empty filing); _peer examination_ (the revision
   and the examined desk's claims, from the Rates desk's own discipline,
   allowed to raise nothing). Provider identity — model, prompt hash,
   parameters — is recorded on the run as for every live run.
2. **The recording step.** `ContributionResult` gains an optional
   `governance` field carrying a `ProducedGovernanceCandidate`, beside the
   existing optional `synthesis`; `runPlaybook` records a result that
   carries one through `RecordGovernanceCandidate` instead of
   `RecordContribution`, in the one place it records anything. The
   orchestrator still writes nothing directly and sequences the provider
   from one place; both fitness rules keep holding.
3. **Budgets: macro-regime v7.** The instrument the firm already uses to
   authorise autonomy. v7 gives `verification`, `challenge` and
   `peer-examination` a measured envelope (the provider's own token counter
   on the actual contexts, as v6 was measured — the revision plus its claims
   and the cited evidence is far smaller than a desk's whole evidence set),
   and leaves `quant-validation` and `risk-review` unbudgeted: no principal
   for the first, no candidate boundary for the second. New cases pin v7;
   existing cases keep their pin.
4. **The seeding migration (P5D).** §3.
5. **The governance branch of the advance pass** (`domainSystem.ts`):
   after the office's revision exists — `SubmitForVerification` by
   `research-office-agent`; then the governance entries that are ready are
   commissioned under their principals with the governance providers; then
   each candidate awaiting acceptance is **filed** by its principal (the
   `candidateFromRunId` forms), peer examination by `rates-agent`; the
   conditional risk requirement is resolved by `risk-agent` with the rule's
   reason; and the pass ends when `committeeConclusionReady` holds or the
   record names what stops it. Every act: actor the principal, initiator
   the host, `correlationId` the case, command ids derived from the run.
6. **The host's words.** `commission` gains `filed` beside `adopted`; the
   existing `answer-ready / committee-conclusion` speech carries the
   conclusion; `blocked / objections-unresolved` names the Devil's Advocate
   and what it objects to (`inspect: objections` already exists for the
   follow-up _"vad invänder de mot?"_).

Not needed: a new agent framework, a new mandate, a UI button, a change to
the eligibility policy, a change to any command's authority, a change to
the host contract's shapes beyond one field.

## 6. Advancement semantics

The pass of `b0e1028`, extended, with the record and the pinned policy as
the only authorities:

```
an internal act completes (run ends, candidate filed, requirement resolved)
  ↓ the record changes
policy reads the next required act        standing.nextAct, eligibility gates, blockers
  ↓
an authorised principal exists for it?
   yes → the act is performed by that principal, initiated by the host, and the pass runs again
   no  → stop, visibly:  blocked / <what is owed> naming the desk, or needs-decision naming the human
  ↓ repeat until
   answer-ready / committee-conclusion            authoritative state permitted by policy
   needs-decision / cio-decision-required        a real human decision (only after a deliberate submission, §2)
   blocked with a named reason                   principal, evidence, budget, provider, objection
```

Order within one pass, as the firm reads its own process
(`caseStanding.nextActFor`): adopt and file what finished → submit for
verification once the aggregation revision exists → commission
`verification`, `challenge`, `peer-examination` (all `blockedBy:
aggregation`, all runnable in parallel) → resolve the conditional risk
requirement → when every committee gate is settled and no blocker blocks a
decision, stop at the committee conclusion. Nothing loops on a timer or
on hope: a pass is earned by a finished run or a completed act, and the
allowance per beginning stays bounded (eight today; a governance round may
need it raised to the number of entries plus filings, which is measured,
not guessed).

**The objection round.** If the Devil's Advocate files a challenge at or
above `material`, the record carries `unresolved-material-challenge` and
the case reads `blocked / objections-unresolved`. Answering it is the
thesis owner's act (`ReviseThesis`, cause `resolved-challenge`) followed by
the control functions re-examining the new revision — a second autonomous
round the doctrine permits. **The first slice stops there visibly** and
JARVIS says who objects and to what; the round is the second slice, after
the first has been seen live, because it is where a loop could
manufacture liveness if the stop conditions are not measured first.

## 7. Failure and blocking semantics

Every stop already has a name in the contract; none is new.

| Condition | Where it is decided | What the person hears |
| --- | --- | --- |
| a control function has no seated principal | `advance`: withheld `no-principal` | that desk's work waits; who owes it |
| the pinned version authorises no budget for the entry | `commissionEligibility`: `no-authorized-budget` | the same, with the reason |
| the provider fails, times out, or overruns | run `failed` / `timed-out` (`provider-error`, `budget-exhausted`, TD-96) | `blocked / analysis-required` or `verification-required`, naming the desk; the run record carries the category |
| the candidate is malformed — a Devil's Advocate that objects to nothing, a finding on a claim out of scope | the domain builder throws; `RecordGovernanceCandidate` rejects `invariant-violated`; the run fails `malformed-output` | the control did not perform; reported as a failed run, never filed |
| the argument moved under the candidate | filing refuses (`revision superseded`) | the run is superseded; the new revision is examined afresh |
| a material objection is open | blocker `unresolved-material-challenge` | `blocked / objections-unresolved`, the objector named; the objection readable through `inspect` |
| the process dies mid-run | TD-92: `running` past its window | `blocked / execution-recovery-required` |
| a human decision is required | `needs-decision / cio-decision-required` | said naturally: what decision, and why it is theirs |

No stop asks the person a ceremonial question. The only questions JARVIS
asks remain the one opening question for a capital question and, at a
human gate, what the decision is.

## 8. Independence guarantees

- **Structural, by mandate.** A verdict can be filed only by a principal of
  a governance department whose role function is `governance` and whose
  department handles the discipline; the Research Office cannot file one
  (tested). Peer examination is filed by another analytical desk.
- **The candidate's basis is the record's, not the producer's.**
  `observedClaimIds` and the revision under review are read at production;
  a producer cannot declare a false scope, and filing compares against the
  record.
- **The Devil's Advocate must object; the peer may not.** Both in the
  domain builders, not in a prompt.
- **What each control reads is its own.** The verification context carries
  the claims and what they cite; the challenge context carries the claims
  and the evidence; neither carries the office's rationale as instruction.
  The Research Office writes no governance result: it cannot call a
  governance command, and the governance providers are commissioned under
  the control functions' own principals with their own run records, model
  identities and prompt hashes.
- **Materiality is the control's, blocking is the policy's.** The Devil's
  Advocate grades; `challengeBlocksAtOrAbove` in the eligibility policy
  decides what blocks; the gate applies the policy and neither restates it.
- **What is not guaranteed, said plainly.** The same vendor's model may
  produce both the analysis and its scrutiny. The institution's separation
  holds — different principals, prompts, contexts, records — but model
  monoculture is a real limitation. A ruling may later require a different
  model, or a different provider, for the control functions; the provider
  identity on every run is what makes that auditable.

## 9. The minimal implementation slice (G1), in order

1. **Migration 0051**: seat `verification-agent`, `devils-advocate-agent`,
   `risk-agent` on the firm's existing governance roles (P5D minimum).
   PostgreSQL tests: the rows, the grants, the `governance-verdict`
   authorisation of each principal in `container.pg.test.ts`.
2. **`ContributionResult.governance` and the orchestrator's recording
   branch** to `RecordGovernanceCandidate`; a stub governance provider for
   tests (one per kind: verification `verified` / `correction-required`,
   challenge with one objection at a chosen materiality, peer with none);
   orchestrator and commission tests; the two fitness rules unchanged.
3. **Three live governance providers** with contexts read off the record
   (`governanceContext.ts` beside `synthesisContext.ts`), JSON contracts
   validated by the domain builders, prompt and model identity recorded.
   Measured envelopes with the provider's token counter on real gold
   contexts before any budget is written.
4. **Macro-regime v7** with the measured budgets for `verification`,
   `challenge`, `peer-examination`; registry and pin tests; content hash.
5. **The governance branch of the advance pass**, with the filing by
   principals, the risk resolution, and the stop at the committee
   conclusion; `commission.filed`; in-memory tests through the whole
   chain with the stub providers (opening → desks → adoption → synthesis →
   submission → three candidates → three filings → risk resolved →
   `answer-ready / committee-conclusion`), and the stops (no principal,
   objection open, provider failure).
6. **JARVIS**: no routing change. `get_delegation_result` already returns
   the committee conclusion; `check_delegation` already names blockers.
   One sentence for `objections-unresolved` naming the objector.
7. **Docs and debt**: contract §12; proof §14; TD-96 stays open; a new
   debt for Risk's missing candidate boundary and for the objection round.

Deliberately not in G1: Risk Review as a live act, the objection round,
Quant, Compliance, any HQ surface, any change to the CIO's gate.

## 10. Tests and the live proof plan

**Code proof, before credits.** The chain above in memory with stub
providers, every act's actor and initiator asserted from the ledger; the
PostgreSQL suite with the seeding migration; the fitness rules; the fast-
path regression untouched.

**Live proof, after credits — the retained gold case.** `node
scripts/probe-jarvis-intent.mjs text-5 --keep-open` extended to wait for
the committee conclusion and to ask _"Vad kom de fram till?"_, proving the
thirteen points of the ruling from the record: instruction accepted;
revision 1 opened; evidence assembled; specialist runs complete;
specialists adopt under their own principals; the office synthesises
independently and institutionalises through its own principal;
verification, challenge and peer examination run under their own
principals and are filed legitimately; Risk resolves the conditional; no
internal step asks the person anything; the case reaches the state policy
permits; if the Devil's Advocate's objection is material it stops there
truthfully; JARVIS explains the result. Measured and reported: total
elapsed; each provider call with tokens and cost; adoption latency; office
latency; governance latency; user turns after the instruction (target 0);
actor and initiator of every act.

**Cost, bounded before it is spent.** Each governance context is measured
with the token counter first; the v7 envelopes are written from those
numbers; TD-96 stays the reason the firm still pays before it refuses.
