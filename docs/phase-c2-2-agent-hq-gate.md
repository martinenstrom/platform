# C2-2 — Agent Headquarters: the first usable agent

**Status:** **approved**, with the rulings in §2. **Stage C is gated** on one
open institutional decision (§3). Stage A may begin.

C2-1 is closed at `6583a97`. It proved the institutional execution path. C2-2
makes that path reachable from the product, and nothing more.

**The capability target:**

> From Agent Headquarters, the user can select a real investment agent, give it
> an analysis assignment, run it, inspect the resulting claims, evidence and
> confidence, and accept or reject the work — entirely through the Financial OS
> interface.

**Stage success is judged by one question:** *what can the user do through
Financial OS after this stage that they could not do before?*

---

## 1. Measured current state

Read out of the repository, not recalled. Retained because the plan is only
small if these findings hold.

### 1.1 Agent Headquarters does not exist

| Surface | What it is |
|---|---|
| `routes/agents.tsx` | **Fiction.** Five invented agents from `data/mockData.ts` with invented progress values, sorted by a status vocabulary unrelated to `RunState`. Closes with *"Simulerade agentkörningar."* A "Ny agent" button wired to nothing |
| `components/agents/` | `AgentCard`, `AgentStatusDot` — presentational, typed against `types/index.ts` `Agent`, importing `MOCK_NOW` |
| `lib/navigation.ts` | `/agents` is in `primaryNav` as **"Agenter"**; `LightCommandCenter` links to it as **"Analys"** |
| `routes/cases.index.tsx`, `cases.$caseId.tsx` | **Real**, read-only by design, provable without a router. Not in navigation |
| `components/headquarters/` | `CaseStandingPanel`, `DecisionHistory` |
| `presentation/analysis/` | `caseStandingText.ts`, `activityText.ts` |

`agents` and `recentAnalyses` are imported **only** by `routes/agents.tsx`.

`activityText.RUN_STATE_TEXT` has **no entry for `awaiting-acceptance` or
`rejected`** — the two states C2-1 exists to create are the two the floor cannot
describe.

### 1.2 The institution has no write door

`serverFns.ts` exposes exactly two functions — `getCaseOverviewFn`,
`getCaseListFn` — plus the re-exported smoke proof. Its header: *"Nothing here
issues a command."* Nineteen commands are registered in `productionCommands()`,
including `acceptContribution` and `rejectContribution`, and **none is invocable
from a browser**.

### 1.3 The seven capabilities

| Capability | Application layer | Reachable | Rendered |
|---|---|---|---|
| Commission a run | complete | only in `smokeFns`, env-gated, hard-coded | no |
| Read run status | `caseOverview.runs` | per case | entry key + id only |
| **Produced claims** | `producedClaims.listForRun` — the only accessor | **no** | **no** |
| Evidence / provenance | full per-item provenance | per case | a count |
| **Confidence + basis** | computed and stored | per case | **not at all** |
| Accept / reject | both complete and tested | **no** | no |

**The finding that shapes Stage B:** in the PostgreSQL adapter
`AgentRunRecord.claims` is a projection of `analysis.claims` by `run_id`
(`CLAIM_SQL.forRuns`). A run in `awaiting-acceptance` reads back with
**`claims: []`**. Produced work is durable, paid for, and invisible to every read
model in the system.

### 1.4 The registry is sufficient

Migration `0010` seeds the firm as data: roles with responsibilities, departments
with `handles` tags, employees with reporting lines. `global-macro` — *Global
Macro*, manager `macro-head`, role `head-of-macro`, responsibility `macro-regime`,
handling `macro`/`rates`/`fx`/`policy`. `MACRO_REGIME_PLAYBOOK` routes
`macro-analysis` to it as **required**, priority 100.

**Global Macro needs no special-casing.** Two rival catalogues exist and neither
may be used: `mockData.agents` (deleted by this stage) and
`services/investmentLetter/agentRoster.ts` (a different, unbuilt pipeline).

**Live-executable desks are derived** from organisation × registered playbook.
Never stored.

### 1.5 Progression

`RunEvent[]`, the `TransitionEvent` log and `projectActivity` all exist and are
persisted. There is **no SSE, WebSocket, subscription or polling anywhere in the
analysis path**. Real progression is repeated reads of persisted state.

---

## 2. Rulings in force

Approved and binding for this stage.

### 2.1 Acting identity

Every browser-issued act carries a real employee identity from the existing
organisation model and passes the existing mandate checks.

**One session-scoped "Acting as" selection** in Agent Headquarters, populated
from the real organisation registry. Not re-chosen per button press. Commission,
Accept and Reject all use the selected actor until it is changed explicitly.

**This is operator identity, not authentication.** The UI must not represent it
as proof that the human user is that employee. No second identity or employee
registry. TD-8 is untouched.

### 2.2 Execution shape

**Synchronous.** The institutional run and its state transitions persist
normally. The UI observes progression by repeated reads of persisted state.

No detached execution. No TD-72. **No invented progress percentages and no
local-only activity.**

### 2.3 Evidence

Commissioning runs **only against existing institutional `EvidenceSet`s already
associated with the selected case/workflow.**

No market-data → `EvidenceSet` bridge in C2-2. **No fixture evidence to make
commissioning appear functional.** Where no eligible institutional evidence
exists, the UI says so and **refuses commissioning** rather than producing a
low-quality demonstration. Live evidence ingestion is a separate future
capability.

### 2.4 Case semantics

**Commissioning never implicitly creates or opens a case.** The user explicitly
selects an existing open `InvestmentCase` first. With none selected, commissioning
is unavailable and the UI explains why. Opening a case is its own institutional
act and is not hidden inside Commission Analysis.

### 2.5 Standing constraints

- No generic `runCommand(type, payload)` endpoint. **Act-scoped server functions only**
- No second agent catalogue
- No presentation-layer derivation of confidence, standing, citability or governance
- Produced claims reach the UI through a **real read model / application boundary**, never by a component reaching into repositories
- `awaiting-acceptance`, `rejected` and `failed` are represented honestly from persisted state
- **Failed runs are institutional activity, not UI noise**
- No Agent HQ chat, multi-agent collaboration, SSE/WebSockets or speculative infrastructure

---

## 3. The one open decision — the firm execution-budget ceiling

**Measured, and reported rather than resolved, per the instruction that the smoke
constant must not become production policy.**

| Source | State |
|---|---|
| Playbook proposal — `PlaybookEntry.budget` | The field exists and participates in `playbookContentHash`. **`MACRO_REGIME_PLAYBOOK` defines no budget on any entry** |
| Case constraint | No durable home — TD-73 |
| Firm ceiling — `OrchestrationOptions.firmBudgetCeiling` | **The only production caller that ever supplied one is `smokeFns.SMOKE_BUDGET`.** Every other occurrence is the type, the orchestrator's pass-through, or a test/harness constant. No env var, no config module, no policy table |

**Mechanically:** `resolveExecutionBudget('live', { firmCeiling: {} })` yields
tokens `not-measured` and cost `not-measured`; `budgetPermitsStart` returns false;
`StartAgentRun` refuses and `buildRunRecord` refuses. A commission path built
today cannot start a live run.

**There is a mechanism but no source.** `PlaybookEntry.budget` is real,
content-hashed, append-only and versioned — but the macro entries carry none, and
adding one changes the content hash, so it requires registering `macro-regime`
**v2**. The numbers would still be invented. Copying 8,000 tokens / $1.00 / 60s
into a playbook entry is the smoke constant becoming policy by a longer route.

**RULED: (a), with a semantic clarification that is part of the ruling.**

Stage C registers a `macro-regime` version carrying a budget on the
`macro-analysis` entry. That budget is a **versioned playbook-level execution
proposal for `macro-analysis` — the first of the three sources — and it is NOT
the firm's hard global ceiling.** It must not be renamed, described or read as
firm-wide policy in code, comment or interface.

The absence of a durable firm-wide ceiling is **explicit technical debt with its
own entry, TD-76**, deliberately not collapsed into TD-73: TD-73 is the case
constraint in the middle of the chain, and this is the outer bound. **The
mechanism is not built inside C2-2.**

**Values are not registered yet.** Before Stage C begins, the initial budget
dimensions are proposed from measured evidence — observed live token usage from
the C2-1 proof, observed elapsed execution against the previous run budget, what
each limit protects against, the headroom each provides, and whether any
monetary limit can be justified without a pricing subsystem. **The C2-1 smoke
values are evidence, not defaults.** They are approved explicitly before any
version is registered.

**This gates Stage C only.** Stage A issues no command; Stage B acts on the run
C2-1 already persisted. Neither touches a budget.

---

## 4. Architecture

### 4.1 Domain — no change

Run states, transitions, rejection codes and record, budget, usage, provenance,
confidence and the acceptance boundary all exist and are enforced by
`buildRunRecord`. **C2-2 adds no domain type and changes no invariant.**

### 4.2 Application — three derivations and one port method

| Module | What it does |
|---|---|
| `agentDirectory.ts` | `Organization` × `registeredPlaybooks()` → selectable desks with role, responsibilities, and the playbook entry that would execute. Pure derivation; holds no list |
| `runReview.ts` | One run id → run state, budget, usage, execution identity, produced claims, cited evidence items with provenance, confidence level and basis. The `caseOverview` pattern for one run. Assembled, never stored |
| `commissionAnalysis.ts` | The command sequence `smokeFns` already proves, parameterised — against a **selected** case and a **selected** existing evidence set |

Produced claims need reaching for the runs of a case: either
`ProducedClaimRepository.listForCase`, or `runs.listForCase` → filter
`awaiting-acceptance` → `listForRun`. **No new store, no table, no migration.**

### 4.3 Infrastructure — act-scoped server functions

| Function | Act |
|---|---|
| `getAgentDirectoryFn()` | read |
| `getAgentFn(departmentId)` | read — the desk and its real runs |
| `getRunReviewFn(runId)` | read — the review surface |
| `commissionAnalysisFn(input)` | **write** |
| `acceptContributionFn(...)` | **write** |
| `rejectContributionFn(...)` | **write** |

Existing container singleton, existing bounded failure codes. Rejection codes
validated by `rejectContribution` against `CONTRIBUTION_REJECTION_CODES` — no
second vocabulary.

### 4.4 Presentation

`/agents` keeps its route and both navigation links; its content is replaced.
`mockData.agents` and `recentAnalyses` are **deleted, not retained as fallback**.

**Mandatory:** every new Agent HQ file is added to the `HEADQUARTERS` list in
`src/test/headquartersBoundary.test.ts`. Its own header warns that a rule scoped
to a directory nobody has added to *"selects nothing, finds nothing, and passes."*

---

## 5. Stages and exit criteria

Written as things a person does.

### Stage A — the honest floor — **DELIVERED**

Real organisation- and playbook-derived desks; real persisted run and activity
state; the simulated surface deleted.

**Verified:** unit **2177 pass / 8 skipped, 88 files**; PostgreSQL **786 pass,
32 files**; `tsc --noEmit` clean. Render-verified against
`agentFloor.mixed.json`, captured from a real PostgreSQL run holding
`completed`, `failed`, `awaiting-acceptance` and `rejected` runs.

- [ ] `/agents` shows only desks that exist in the seeded organisation, with their real role and responsibilities
- [ ] Live-executable desks are derived from organisation × registered playbook; no stored list exists
- [ ] Opening Global Macro shows its real runs with state, execution identity, authorised budget and reported usage
- [ ] A **failed** run appears as institutional activity with its bounded category, visibly distinct from a **rejected** one
- [ ] `awaiting-acceptance` and `rejected` have honest wording in `activityText`
- [ ] A desk with no runs says so and implies no activity
- [ ] **`mockData.agents` and `recentAnalyses` no longer exist**; no invented agent, progress value or run remains anywhere
- [ ] New files are named in `headquartersBoundary.test.ts`; no presentation file imports an institutional evaluator
- [ ] Both suites green, typecheck clean, PostgreSQL file count checked; the page **render-verified** against real persisted records

**User capability gained:** *the user can see the firm's real desks and every run
the institution has actually performed* — including the C2-1 run already in the
database.

### Stage B — the judgement — **DELIVERED**

**Verified:** unit **2197 pass / 8 skipped, 89 files**; PostgreSQL **790 pass,
33 files**; `tsc --noEmit` clean. Render-verified against `runReview.awaiting`,
`runReview.accepted` and `runReview.rejected`, captured from a real PostgreSQL
run either side of the acceptance boundary.

**Manual verification found it shipped unreachable, and that is recorded rather
than quietly patched.** Every piece was proved in isolation and the journey did
not arrive: the route into the work sat on an unlabelled entry key while the
case id was the visually obvious link, so clicking a run on a desk landed on the
case overview — a page that describes a decision rather than offering one. No
per-page render test could catch it, because every page was correct and the
route between them was the defect. Fixed by making the review the row's primary
affordance, and covered by `agentHeadquarters.journey.test.tsx`, which clicks
from `/agents` to a specific awaiting run's review instead of constructing the
URL.

**Two guards caught a real violation and were obeyed rather than amended.**
`JudgementPanel` value-imported `CONTRIBUTION_REJECTION_CODES` from the domain;
`headquartersBoundary` and the import graph both refused it. The fix was
architectural, not a suppression: the firm's rejection vocabulary now travels to
the surface on `RunReview`, so the interface renders the codes the institution
defines instead of holding a copy that could drift from the ones the command
accepts.

- [ ] A run in `awaiting-acceptance` shows every produced claim — the first time produced work is visible in the product
- [ ] Each claim shows statement, type and status; the observations it cites with source, quality and as-of; and its **proposed and effective confidence with basis**, including the TD-75 wording where the level is model-proposed
- [ ] One session-scoped "Acting as" selection, from the real registry, labelled as operator identity and never as authentication
- [ ] A desk cannot accept another desk's work — the refusal is the mandate system's, not a UI check
- [ ] Accepting makes the claims appear on the case page as institutional claims; the run reads `completed`
- [ ] Rejecting requires one of the six codes **and** prose; the claims stay readable on the run and never appear on the case
- [ ] After rejection nothing is in the result store and nothing is citable — asserted against the database, not a filter
- [ ] Verified against the **existing C2-1 persisted run**, before any new paid run

**User capability gained:** *the user can read work awaiting acceptance and accept
or reject it, with a reason, from the interface.*

### Stage C — the commission — **gated on §3**

- [ ] The user selects an existing **open** case; with none selected, commissioning is unavailable and the UI says why
- [ ] The user selects an existing institutional evidence set associated with that case; where none exists, commissioning is **refused** with an explanation
- [ ] The user selects Global Macro, states the assignment, and commissions without touching an environment variable
- [ ] Execution is synchronous; the UI shows only real recorded progression read from persisted state, with **no invented percentage**
- [ ] The run lands in the Stage B review surface, where the same person judges it
- [ ] A run that exceeds its budget or fails is reported honestly, with no claim to accept
- [ ] The budget it ran under came from the source ruled in §3 — **never a constant copied from `smokeFns`**

**User capability gained:** *the user can commission a real analysis and follow it
to a decision.* The loop closes.

---

## 6. Reuse versus new

| Reused unchanged | New |
|---|---|
| Every domain type, invariant and state machine | `agentDirectory`, `runReview`, `commissionAnalysis` |
| All 19 commands, `acceptContribution` and `rejectContribution` included | Six act-scoped server functions — the institution's first write door |
| `runPlaybook`, `executeWithinRun`, `resolveExecutionBudget`, live provider, `modelClient` | One produced-claim read path |
| The seeded organisation and `MACRO_REGIME_PLAYBOOK` | The Agent HQ pages and components |
| `container`, `serverFns` runtime, bounded failure codes | Session-scoped acting-identity selection |
| `caseOverview`, `caseListing`, both case pages | Two `activityText` entries |
| `projectActivity`, `toActivityLine`, `caseStandingText` | Additions to the boundary test's file list |
| The UI kit and both navigation surfaces | |

**Deleted:** `mockData.agents`, `mockData.recentAnalyses`, and the fiction in
`routes/agents.tsx`.

**Out of scope:** TD-72, TD-73, TD-75, a second agent, the letter pipeline, agent
performance analytics, multi-agent infrastructure, TD-8, and the market-data →
evidence bridge.

---

## 7. What must not happen

An Agent Headquarters that computes what it displays. Confidence, citability,
governance and run standing are each derived in exactly one place today. This
stage adds screens for facts that already exist — and the moment a component
decides one of them, the institution holds two answers and only the screen knows
which one it used.
