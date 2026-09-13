# JARVIS integration — architecture mapping and the first seam

**Status: mapping done, minimum foundation implemented, awaiting ruling on the
next slice.** Written against `1b88087` (tag `pre-jarvis-integration`), the last
Financial OS commit before JARVIS became the layer above it. Everything in §1 is
**read** from the repository on 2026-09-13; nothing is recalled.

The JARVIS Master Product & Architecture Specification (v1.0, 2026-09-13) is the
long-term source of truth for the whole system. Financial OS remains the source
of truth for the investment domain. Where they overlap, this document says which
existing Financial OS component plays which JARVIS role — and, more importantly,
which JARVIS components Financial OS must **not** grow a copy of.

---

## 0. The ruling this implements

JARVIS is the personal AI layer. Financial OS is a specialist domain system
inside it. The user talks to one JARVIS; JARVIS decides when a request belongs
to Financial OS, delegates it, preserves context, collects the structured
result and presents it through the single JARVIS identity. Financial OS
principals are internal specialists, never user-facing personalities.

| JARVIS owns                                                 | Financial OS owns                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| global identity and persona; Self Model; Relationship Model | investment-domain reasoning and research                    |
| general Brain and long-term user context                    | market state and signals; domain-specific investment memory |
| conversational orchestration; HUD / voice                   | CIO / IC processes; principals and specialist agents        |
| permissions; Tool Bus / policy                              | Devil's Advocate; Fact Checker (Verification)               |
| durable tasks, commitments, proactive contact               | recommendations and their supporting evidence               |

Nothing working is rewritten to match the JARVIS document. Adapters and
interfaces first; a destructive change needs its own gate.

---

## 1. Measured: what Financial OS already is, in JARVIS terms

### 1.1 The layers — **read** (`src/test/importGraph.test.ts`)

```
domain/        pure TypeScript; imports nothing above it
application/   use cases and read models; never imports infrastructure
infrastructure/ adapters, PostgreSQL, the composition root, TanStack server functions
presentation/  text; never executes domain logic
routes/, components/   the web UI
services/      the frozen legacy prototype
```

Fitness rules enforce the direction. The consequence for JARVIS: **the seam
must be an application-layer port**, constructed by the composition root. A
port defined in infrastructure would be unreachable from tests and from any
host that is not the TanStack process.

### 1.2 The entry and result shapes — **read**

| Financial OS today    | Signature                                                                                      | JARVIS role                                 |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `startInvestmentCase` | `(question, subject, requestId, actingEmployeeId) → convened / convening-incomplete / refused` | **delegation in** — the Chairman's question |
| `resumeConvening`     | `(caseId, actingEmployeeId) → same three states`                                               | retry of the second commit                  |
| `commissionAnalysis`  | `(caseId, entry, evidence, principal) → refused / declined / ran`                              | delegation in — one piece of work           |
| `caseListing`         | `→ CaseListing[]` (case + standing, outstanding first)                                         | **result out** — the queue                  |
| `standingForCase`     | `→ CaseStanding` (stage, settled, ownership, blockers, `nextAct`)                              | result out — the decision-brief shape       |
| `caseOverview`        | `→ CaseOverview` (every institutional record, eligibility as recorded)                         | result out — the whole record               |

Every one is a typed union or a typed record. **There is nothing to summarise
into prose at the seam** — the presentation boundary already forbids the UI
from recomputing institutional state, and JARVIS inherits the same rule.

### 1.3 Identity — **read** (`domain/analysis/authority.ts`, `application/analysis/currentOperator.ts`)

```ts
AssertedActor = employee | (institutional - agent) | system // who is ACCOUNTABLE
CommandInitiator = employee | orchestrator | system | (recorded - provider) // who DISPATCHED
```

The actor/initiator split already exists, is persisted on every ledger row
(`commands.initiator_kind`, `initiator_id`), and `orchestrator` is a
first-class initiator kind. **JARVIS is an orchestrator initiator and the user
is the employee actor.** No new vocabulary is needed, and no schema changes.

The operator today is a **server-trusted configured employee**
(`FINANCIAL_OS_OPERATOR_EMPLOYEE_ID`), resolved against the seeded
organisation, with `authentication: 'system-asserted'` because nobody logged
in (TD-8). In the JARVIS model the _host_ resolves who the user is; Financial
OS keeps refusing to invent a principal it does not employ.

### 1.4 Durable work — **read**

Financial OS already has durable, restart-safe work: cases, assignments, runs,
a write-once command ledger, transition events, storage provenance. A JARVIS
**durable task** that delegates to Financial OS therefore holds a _reference_
to a case, not a copy of its state. Financial OS is the source of truth for
where the case stands; JARVIS's task is the source of truth for the user's
commitment ("I'll come back with the committee's view").

### 1.5 Policy — two different things with one word — **read**

| Name                                                   | What it is                                                             | JARVIS counterpart                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `domain/policy`                                        | **central-bank monetary policy** (rates, cadence, decisions)           | none — this is market domain data                    |
| `authorize(mandate)` in `domain/analysis/authority.ts` | **institutional authority**: who inside the firm may perform which act | composes with, does not replace, the JARVIS Tool Bus |
| execution budgets                                      | what the firm authorised a run to spend                                | a Financial OS concern under a JARVIS spend policy   |

The JARVIS Policy Engine decides whether a _request_ may reach Financial OS
(research: AUTO; spend money: ASK). Financial OS mandates decide who _inside
the firm_ may perform an act. They are layered, not overlapping, and neither
is to be generalised into the other.

### 1.6 Memory — where the boundary falls — **read**

Financial OS holds evidence sets, observations, claims, theses, decisions —
domain memory with content identities and provenance. The JARVIS Brain must
hold **references** to these (a case id, a revision id, a decision id, each
with the storage provenance it was read under) and **episodes about them**
("on 11 September you asked about the US curve; the committee's position was
`hold` with material dissent"), never copies of the institutional record.

Two reasons. A copy would be a second answer free to disagree with the firm.
And Financial OS identities already carry canonicalization versions and
provenance, so a reference is verifiable later and a copy is not.

### 1.7 Already present, worth knowing

- `@modelcontextprotocol/sdk` is a dependency (for `avanza-mcp`). MCP is a
  candidate _transport_ for delegation later; it is not the minimum.
- `services/investmentLetter` is the frozen eleven-agent prototype. It maps
  onto the seeded organisation (`docs/agent-organization.md`) and is not a
  JARVIS worker.
- The product title is _Financial OS_; the package is `stock-template`; the
  README says _Stack_. Naming is unresolved and not decided here.

---

## 2. The mapping

| JARVIS component (spec §)                    | Financial OS today                                                                                             | Disposition                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Orchestrator (§6, §54)                       | `commissionAnalysis`, `runPlaybook`, `startInvestmentCase`                                                     | **stays inside Financial OS** as domain orchestration; JARVIS orchestrates _between_ systems, not inside the firm |
| Deep Workers / Deep Task Providers (§6, §34) | contribution providers (`live`, `liveSynthesis`, stub, recorded)                                               | Financial OS's own; a JARVIS DeepTaskProvider is a different seam                                                 |
| Agents / Workers (§39)                       | agent principals (`global-macro-agent`, `rates-agent`, `research-office-agent`; governance agents pending P5D) | **internal specialists** — never user-facing; JARVIS presents the committee's result, not the desks               |
| Tool Bus / Policy Engine (§36)               | `authorize(mandate)`, budgets                                                                                  | layered, see §1.5                                                                                                 |
| Durable Task Engine (§37)                    | cases / assignments / runs / ledger                                                                            | JARVIS task **references** a case; §1.4                                                                           |
| Commitment Ledger (§38)                      | none                                                                                                           | JARVIS-owned; not built in Financial OS                                                                           |
| Brain (§8–§20)                               | evidence, claims, theses, decisions (domain memory)                                                            | JARVIS Brain stores references + episodes; §1.6                                                                   |
| Self / Relationship (§23–§27)                | `currentOperator`, `operatorIdentities` (who may act)                                                          | JARVIS resolves the person; Financial OS resolves the _principal_                                                 |
| HUD / voice (§4, §5)                         | TanStack routes and components                                                                                 | stay; JARVIS is a second client of the same application layer                                                     |
| Decision Brief (§43)                         | `CaseStanding` — stage, ownership, blockers, `nextAct`; eligibility as recorded                                | the shape a brief is built from                                                                                   |

---

## 3. The first seam: a host-facing port

`src/application/analysis/domainSystem.ts` — `FinancialOsSystem`.

Application-layer, transport-agnostic, constructed by the composition root
(`container.domainSystem()`), and callable from a test with the in-memory
store. It wraps existing use cases and read models; it adds no new
institutional behaviour.

```ts
interface Delegation {
  requestId: string // the host's idempotency key; the case id derives from it
  actingEmployeeId: string // the person, as the firm employs them — never invented here
  orchestratorId: string // the host, recorded as INITIATOR, never as actor
}

interface FinancialOsSystem {
  id: 'financial-os'
  operator(configured) // resolve the configured operator, fail closed
  operators() // who may act, from the seeded organisation
  caseIdFor(requestId) // the id a delegation will land on, before it lands
  ask(delegation, { question, subjectDisplayName }) // → StartInvestmentCaseResult
  resume(delegation, caseId) // → StartInvestmentCaseResult
  queue() // → CaseListing[]
  standing(caseId) // → CaseStanding | null
  overview(caseId) // → CaseOverview | null
  reference(caseId) // → DomainReference — what a host may keep
}

interface DomainReference {
  system: 'financial-os'
  kind: 'case'
  id: string
  provenanceId: string
}
```

### 3.1 The one change to working code

`startInvestmentCase` and `resumeConvening` accept an optional `initiator`.
Today the Chairman Console sets initiator = actor, which is true for a person
at a form. A host that set nothing would have the ledger say the person
dispatched the act directly — false provenance. The default preserves the
console's behaviour byte for byte; the host passes
`{ kind: 'orchestrator', orchestratorId }`.

### 3.2 What the port deliberately does not do

- It does not summarise. Results are the typed institutional read models.
- It does not authenticate. `authentication` stays `system-asserted`; TD-8 is
  now a JARVIS identity concern that Financial OS will _consume_, not solve.
- It does not resolve _which_ case kind a question belongs to. Routing a
  question into the firm is `resolveCaseIntake`; routing a request _to the
  firm at all_ is JARVIS's Conversation Director, and is not built here.
- It does not expose `commissionAnalysis`, accept/reject, or any governance
  act. Those are the next slice, and they are where P5D's principals become
  JARVIS-visible workers.

---

## 4. Deferred, with the reason

| Item                                                 | Why not now                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| JARVIS runtime, Brain, Self Model, HUD               | not in this repository; the spec's milestones M0–M4 are elsewhere                                                                                     |
| P5D real principal seeding                           | ruled to wait until principals fit the JARVIS orchestration model — that model is §2 above, and the seam they surface through is the next slice of §3 |
| MCP as delegation transport                          | the in-process port is the minimum; a transport wraps it later                                                                                        |
| Renaming (`stock-template` / Stack / Financial OS)   | product decision, not architecture                                                                                                                    |
| `commissionAnalysis` and governance acts on the port | need a ruling on what a JARVIS task may commission autonomously versus under a decision gate (§40–§43)                                                |
