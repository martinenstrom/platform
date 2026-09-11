# Investment Command Center v1 — UX / Information Architecture Gate

**Status: RULED AND IMPLEMENTED. Stages 1-3 built, placement corrected (§11), Huvudkontoret redesigned against the north star (§12-13). Verified 2026-08-24; awaiting visual acceptance.**

Written after C3 closed at `58a61c9`. Everything in §1 is **measured** out of the
repository and the running development database on 2026-08-20 — marked
**probed** where a query or a page fetch produced it, **read** where it comes
from the source. Nothing here is recalled.

---

## 1. Measured current state

### 1.1 The product is two products, and only one of them is the institution — **read**

| route | subject | data |
|---|---|---|
| `/` | market overview (`LightCommandCenter`, 935 lines) | real market data |
| `/markets` | market tickers | real market data |
| `/watchlist` | watchlist | real market data |
| `/portfolio` | portfolio | **`~/data/mockData` — fabricated** |
| `/reports` | reports | **`~/data/mockData` — fabricated**, labelled *"Exempeldata"* |
| `/agents` | desk directory | real institutional state |
| `/agents/$departmentId` | one desk | real institutional state |
| `/agents/$departmentId/commission` | commissioning | real institutional state |
| `/cases`, `/cases/$caseId` | cases | real institutional state |
| `/evidence` | evidence holdings and assembly | real institutional state |
| `/runs/$runId` | run review, accept/reject | real institutional state |
| `/settings` | settings | — |

**The home page contains no institutional state at all.** Its panels are
Marknadsöversikt, Aktuella marknader, Sentiment, Utveckling idag, Räntemarknaden,
Sektorer, Senaste nytt, Bevakning. Not one case, desk, claim, decision or piece
of evidence appears on it.

### 1.2 Primary navigation omits half the institution — **read**

`src/lib/navigation.ts` — `primaryNav` is Översikt, Agenter, Portfölj, Marknader,
Bevakning, Rapporter. **`/cases`, `/evidence` and `/runs/$runId` are not
reachable from the primary navigation.** The two screens that carry the firm's
cases and its evidence are reachable only by link-following or by URL.

Two of the six nav destinations — Portfölj and Rapporter — lead to fabricated
data. That is dead theatre in the primary navigation today.

### 1.3 A naming collision at the centre of the concept — **read**

`/cases` renders `title="Huvudkontor"`. `/agents` renders `title="Agenter"`.
Two destinations, and the one called Headquarters is the one without the desks
on it. The "one Agent Headquarters" ruling has no single surface that
implements it.

### 1.4 The institution can perform twenty acts; the product can perform four — **read**

`productionCommands()` registers **20** institutional acts. The server functions
that a person can reach from the product are:

| act | surface |
|---|---|
| `AssembleEvidenceSet` | `/evidence` |
| `StartAgentRun` + `RecordContribution` | `/agents/$id/commission` |
| `AcceptContribution` | `/runs/$runId` |
| `RejectContribution` | `/runs/$runId` |

**Sixteen have no interface**, including every governance act and every CIO act:
`ProposeThesis`, `AggregateManagerConclusion`, `ReviseThesis`,
`ResolveConditionalRequirement`, `SubmitForVerification`,
`RecordVerificationReview`, `RecordDevilsAdvocateReview`, `RecordRiskReview`,
`SubmitForCioDecision`, `RecordCaseDecision`, `ReturnFromCioReview`,
`ReopenForReconsideration`. `OpenInvestmentCase` and `InstantiatePlaybook` are
performed by a development script.

**This is the single most important measurement in this gate.** The Command
Center's gap is not decoration. It is that the firm's own operating surface can
reach a fifth of what the firm can do.

### 1.5 The firm has never held an investment thesis — **probed**

```
thesis_revisions   0
cases             14
assignments queued 69
completed runs      4
claims             34
transition_events 208
evidence sets       3
decisions           0
reviews             0
```

Every governance and decision table is empty. Those capabilities exist and are
registered; **nothing has ever exercised them**, because §1.4 gives them no
surface.

The consequence for this gate is direct and unavoidable: **"what the firm
currently believes" has nothing behind it.** A CIO message panel, a firm view, a
current-thesis card and a decision panel would all be rendering an empty set
today — and populating them from anything else would be fabrication.

### 1.6 What is already typed, projected and reachable — **read**

The read models exist and are richer than the screens using them:

| read model | what it carries | used by |
|---|---|---|
| `caseStanding` (domain) | stage, `settled`, **ownership**, per-step standing, **blockers**, **`nextAct`** | `/cases`, `/cases/$caseId` |
| `caseListing` | every case + its standing, outstanding first | `/cases` |
| `caseOverview` | standing, revisions, aggregations, claims, runs, evidence sets, all three governance reviews, submissions, returns, live decision, decision history, reconsiderations, **`timeline: TransitionEvent[]`**, eligibility | `/cases/$caseId` |
| `agentDirectory` | desks with `isGovernance`, manager, responsibilities (carrying `interpretive`), assignable work, runs | `/agents` |
| `runReview` | the run, its produced claims, citations resolved | `/runs/$runId` |
| `evidenceDesk` | holdings per tenor, selection offers, recent assemblies | `/evidence` |
| `commandLog` | `LedgerEntry` — intent + outcomes | point lookup only |

**`CaseStanding` is the semantic authority for obligation** and already answers
*who owes what next* through `ownership` and `nextAct`. No Command Center panel
needs to re-derive that, and none may.

### 1.7 Two truthful sources exist with zero consumers — **read/probed**

- **`events.recent(limit)`** is on `EventRepository`, implemented by both
  adapters, covered by the repository contract, and called by **no production
  code**. 208 `transition_events` are persisted. This is the activity feed's
  backing, already built.
- **`OverviewSnapshot.hasDegradedCategory`** is computed and **rendered
  nowhere**. The overview shows one `Data uppdaterad` timestamp and no
  per-panel availability, while `MARKETDATA_MODE=hybrid` and chains such as
  `treasury,fixture` mean a panel can legitimately be serving fixture data
  without saying so.

The second is a truth-before-theatre defect in the surface that exists today.

### 1.8 The visual system does not match the north star — **read**

`src/styles/app.css` defines a dark HUD palette: canvas `#080a0f`, surfaces
`#101419`–`#1d222b`, and **`--color-accent: #4de8f5` — cyan**, with HUD glow
tokens built on it.

Against the stated north star of **dark navy/black with restrained bronze/gold**:

- the dark foundation is **already there**
- the accent is **cyan, not bronze/gold**
- and the home page is a **light** command center, which contradicts both

Three visual languages coexist. Reconciling them touches surfaces recorded as
finished — the chart system, the globe and financial-network layer, and the
overview hero and its navigation column. **That is a ruling, not an
implementation detail** (§8).

---

## 2. The governing judgement

> What real institutional state should an investment professional be able to
> understand, inspect and act on from the Command Center?

Measured, the honest answer for v1 is **three things, and not the fourth**:

1. **What the firm owes** — 14 cases with standing, ownership, blockers and a
   named next act; 69 queued assignments. Real, typed, and currently almost
   invisible.
2. **What the floor is doing** — desks, their governance separation, their runs
   and what is awaiting a human.
3. **What changed** — 208 persisted transition events nothing reads.

And **not**: *what the firm believes.* There is no thesis, no aggregation and no
decision in existence. A Command Center that opened with the firm's view would
be opening with a fabrication.

**So Command Center v1 is an obligation-and-activity surface, not a
belief-and-recommendation surface.** That is a statement about where the
institution actually is, and the page should say it plainly rather than leave a
handsome empty panel implying otherwise.

---

## 3. Proposed information architecture

### 3.1 Primary navigation

| position | destination | change | why |
|---|---|---|---|
| 1 | **Kommandocentral** `/` | replaces the market-only overview | the firm's operating picture, institution first |
| 2 | **Huvudkontor** `/headquarters` | **merges `/agents` + `/cases`** | one floor, one name; resolves §1.3 |
| 3 | **Underlag** `/evidence` | **promoted into the nav** | the firm's evidence is a first-class institutional surface |
| 4 | **Marknader** `/markets` | absorbs `/watchlist` as a view | market context, honestly one thing |
| 5 | **Portfölj** `/portfolio` | **removed from primary nav** | fabricated (§1.1) — see §8.3 |
| 6 | **Rapporter** `/reports` | **removed from primary nav** | fabricated (§1.1) — see §8.3 |

`/runs/$runId`, `/cases/$caseId`, `/agents/$departmentId` and the commission
screen become **drill-downs**, not destinations. They keep their URLs.

### 3.2 Command Center page hierarchy

**Above the fold — the ten-second read, in this order:**

1. **Vad firman är skyldig att göra** — the attention queue. Outstanding cases
   ordered by standing, each showing owner, blocker and `nextAct` verbatim from
   `CaseStanding`. *This is the top of the page because it is the only thing on
   it that is genuinely urgent.*
2. **Golvet** — a compact floor strip: each desk, its queued/running/awaiting
   count, governance functions visually separated.
3. **Marknadsläge** — a restrained market context strip **with per-panel
   availability disclosed** (fixes §1.7).

**Below the fold:**

4. **Vad som har hänt** — the activity feed from `events.recent`.
5. **Underlag firman håller** — evidence set count, latest assembly, who
   declared it fit.
6. **Vad firman ännu inte kan svara på** — an explicit, honest statement that no
   thesis, aggregation, governance review or CIO decision exists yet, with what
   each would require. **This panel is the opposite of a placeholder**: it
   states a limitation instead of implying a capability.

**Deliberately absent from v1:** CIO message, firm view, portfolio exposure,
scenarios, alerts, recommendations, "live" status indicators. Each is either
fabricated or empty today.

### 3.3 Agent Headquarters interaction model

One floor, one page, two axes of movement:

```
/headquarters
  ├── the floor            desks as entrances, governance separated
  │     ├── investment desks     Global Macro, Equity Research, Quant, News
  │     └── governance functions Verification, Devil's Advocate, Risk, Compliance
  └── the work             cases on the floor, ordered by standing
```

Entering a desk (`/agents/$departmentId`, kept) opens a **workspace** with a
persistent floor rail so shared-firm context is never lost, and four views:

| view | backing | state |
|---|---|---|
| **Uppdrag** — what it is working on now | assignments + runs | READY |
| **Underlag** — the evidence it is reasoning over | `EvidenceSet` per run | READY |
| **Körningar** — runs and history | `agentDirectory.runs`, `runReview` | READY |
| **Utfall** — accepted output | accepted claims | READY |

Conversation is **not** part of v1 (§7).

Governance desks get the same workspace shape, not a lesser one — they are
independent functions, and rendering them as accessories to investment desks
would contradict the ruling that keeps them independent.

### 3.4 Evidence visibility — progressive disclosure

Three depths, so the C3 review page's density is available without being
everywhere:

1. **Badge** — on any claim: confidence level, cap if one bit, citation count.
2. **Popover** — the cited observations: subject, source, trust, reference
   period, and whether the figure is derived.
3. **Full record** — `/runs/$runId` unchanged, plus `/evidence`.

**Institutional limitations are never hidden by disclosure level.** A cap, a
`no-evidence` claim, a disagreement, a revision and a v1 observation that
declares no reference period all surface at depth 1, because those are exactly
the facts a reader must not have to dig for.

---

## 4. Component classification

### READY — current state and read models support it truthfully

| component | backing |
|---|---|
| Attention queue (outstanding cases, owner, blocker, next act) | `caseListing` + `caseStanding` |
| Case drill-down | `caseOverview` |
| Desk directory with governance separation | `agentDirectory`, `isGovernance` |
| Desk workspace: current work, runs, history, accepted output | `agentDirectory`, `runReview` |
| Run review, accept / reject | `runReview` + existing server fns |
| Commission a desk | `getCommissionBrief` + `commissionAnalysis` |
| Evidence holdings, assembly record, selection rule | `evidenceDesk` |
| Claim confidence, cap and citation badges | `runReview`, `ClaimConfidence` |
| Market context strip | `OverviewSnapshot` |

### READ-MODEL NEEDED — the truth exists, the projection does not

| component | what exists | what is missing |
|---|---|---|
| **Activity feed** | 208 `transition_events`; `events.recent()` on both adapters, contract-tested, **zero consumers** | a presentation projection resolving actor, subject and target into readable entries |
| **Firm-wide obligation queue** | 69 queued assignments; `CaseStanding.ownership` and `nextAct` per case | a cross-case aggregate; today standing is computed per case, one at a time (TD-71 warns against fanning that out) |
| **Governance standing across cases** | `CaseStanding.steps` carries each review step's status | a cross-case rollup of outstanding governance work |
| **Floor status strip** | runs and assignments per desk | a per-desk counts projection |
| **Market data-quality disclosure** | `hasDegradedCategory` computed | it is rendered nowhere (§1.7) |
| **Evidence sufficiency per case** | evidence sets, claims, caps | a per-case "what the evidence supports" projection |

### CAPABILITY NEEDED — the institutional truth does not exist yet

| component | why |
|---|---|
| **CIO message / what the firm believes** | no thesis has ever existed (§1.5); needs `ProposeThesis` + `AggregateManagerConclusion` performable from the product |
| **CIO decision panel** | `SubmitForCioDecision`, `RecordCaseDecision`, `ReturnFromCioReview` exist with **no interface** (§1.4) |
| **Governance verdict surfaces** | `RecordVerificationReview`, `RecordDevilsAdvocateReview`, `RecordRiskReview` exist with no interface |
| **Investment decisions list** | zero decisions exist |
| **Portfolio exposure** | no portfolio domain at all; `/portfolio` is `mockData` |
| **Scenarios** | no domain |
| **Alerts / notifications** | no domain; the bell in the current header is decorative |
| **News intelligence as institutional input** | `news` is market data and is **not an admissible observation kind** — it fails `isStorableObservationKind`, by C3's fail-closed design |
| **Sentiment as a firm view** | market sentiment exists as market data; the firm holds no sentiment claim |

### DEFER — insufficient decision-quality benefit for v1

- `/portfolio` and `/reports` as product surfaces (fabricated; see §8.3)
- Watchlist as a first-class navigation item (real, but not institutional)
- Conversation / chat inside desk workspaces
- Globe, financial-network layer and country explorer — **recorded as finished; left untouched**
- Cross-case search, saved views, keyboard command palette

---

## 5. Implementation stages, in dependency order

**Stage 1 — Shell and IA.** Navigation restructure, `/headquarters` as the one
floor, evidence promoted, fabricated destinations removed from primary nav.
*Nothing else can be positioned until the shell says where things live.*

**Stage 2 — Command Center v1, READY sources only.** Attention queue, floor
strip, market context with availability disclosed, and the honest
"not-yet-answerable" panel. *No new read models; this proves the page against
state that already exists.*

**Stage 3 — Activity projection.** `events.recent` → a presentation read model →
the feed. *Smallest READ-MODEL NEEDED item, and the one with a fully built
backing.*

**Stage 4 — Obligation and governance rollups.** The cross-case aggregates,
respecting TD-71's warning about per-case standing fan-out.

**Stage 5 — Desk workspace consolidation.** Four views behind one floor rail.

**Beyond this gate, and separately gated:** surfaces for the sixteen acts with
no interface (§1.4). That is a **capability phase, not a UX phase**, and it is
what would eventually make the CIO and governance panels truthful.

---

## 6. First implementation slice — recommendation

**Stage 1 + Stage 2, together, and nothing else.**

They are one coherent change: the shell decides where the institution lives, and
the Command Center page is the first thing that lives there. Both are built
entirely on read models that exist today, so the slice adds **no new
institutional semantics and no new derivation** — which keeps it squarely
inside the presentation boundary.

It is also the slice that closes the largest measured gap for the least risk:
the firm's cases, standing and evidence stop being URL-only, and the home page
starts describing the institution instead of the market.

---

## 7. Non-goals

- **No new institutional semantics.** Every panel reads typed state; none
  computes standing, confidence, eligibility or sufficiency. `CaseStanding`
  stays the authority.
- **No reopening of C3.** No CPI, PCE, growth, labour, FX or policy-path family
  is added to make a panel look full.
- **No opportunistic debt repayment.** TD-79–82 and the rest stay open; none of
  them blocks this architecture.
- **No fabricated anything** — activity, market state, CIO view,
  recommendations, alerts, exposure, decisions or "live" status.
- **No per-agent mini-apps.** One floor.
- **No governance demotion.** Control functions are independent surfaces.
- **No pixel-polishing in this gate.**
- **No implementation before approval.**

---

## 8. Questions requiring a ruling

These are product and visual decisions I should not settle alone. Work can
proceed on §6 once they are answered; two of them change what Stage 1 does.

### 8.1 The accent colour — cyan today, bronze/gold in the north star

`--color-accent: #4de8f5` is used by every surface, including the chart system
and the network layer, both recorded as finished. Options:

**(a)** change the accent system-wide to bronze/gold — coherent, touches
finished surfaces; **(b)** keep cyan for market/analytical surfaces and
introduce bronze/gold as the *institutional* accent — no rework, but two accents
must be given a rule so it does not read as inconsistency; **(c)** keep cyan and
treat the north star's bronze as aspiration.

**Recommendation: (b)**, with the rule stated once — bronze/gold marks
institutional acts and standing, cyan stays with market and chart data.

### 8.2 The home page is light; the north star is dark

`/` is the light `LightCommandCenter`, and its hero and navigation column are
recorded as finished. Replacing `/` with a dark institutional Command Center
supersedes that surface. Options: **(a)** the Command Center takes `/` and the
light overview moves to `/markets`; **(b)** the Command Center takes a new route
and `/` stays; **(c)** the Command Center is built light.

**Recommendation: (a).** The home page should be the firm, not the market — but
this deliberately supersedes a locked surface and needs your word.

### 8.3 Fabricated destinations

`/portfolio` and `/reports` are `mockData` and sit in the primary navigation.
**Recommendation: remove both from primary nav in v1** and leave the routes
reachable. Keeping fabricated data one click from the home page is the clearest
violation of truth-before-theatre currently in the product. If you would rather
keep them, they need an unmissable *Exempeldata* treatment rather than a quiet
caption.

### 8.4 Merging `/agents` and `/cases` under one Headquarters

Resolves §1.3 and implements the one-headquarters ruling, but changes two
existing destinations and their tests. **Recommendation: merge**, keeping both
URLs redirecting into the floor.

---

## 9. What this gate does not claim

The Command Center cannot make the firm's view complete, because the firm does
not have one. What it can do in v1 is make the firm's **obligations, floor and
history** visible and inspectable, and state the limitation where a belief would
otherwise be implied.

C3 made the pipe true for one family. This gate proposes to make **what the
institution is currently doing** visible. Neither is the Macro View, and no
panel, label or report may suggest otherwise.

---

## 10. Implementation record — 2026-08-23

Written after starting the development cluster and reading the running product.
Everything below is **evidenced**: a ruling appears here only where the code
implements it or where it was given directly, and an implementation claim
appears only where a probe or a file shows it. §1's measurements were taken
against the same database and still hold.

### 10.1 The database this was verified against

`scripts/dev-db.ts start` reused the existing cluster in `.pgdata` — 70 MB,
PostgreSQL 18.4, listening on `localhost:54320`. It had not been shut down
cleanly (`last known up at 2026-08-20 20:08:43`, the hour this gate was
written) and recovered automatically: redo from `0/263AE68`, checkpoint
complete, `database system is ready to accept connections`.

Nothing was recreated, re-migrated or reseeded. Schema `analysis`, 33
migrations applied, latest `0033`. Read through the application login in
`ANALYSIS_DATABASE_URL`, the state is the state §1.5 measured:

| table | rows | §1.5 |
|---|---|---|
| `cases` | 14 | 14 |
| `assignments` where `queued` | 69 | 69 |
| `claims` | 34 | 34 |
| `transition_events` | 208 | 208 |
| `evidence_sets` | 3 | 3 |
| `thesis_revisions` | 0 | 0 |
| `case_decisions` | 0 | 0 |
| `reviews` | 0 | 0 |

Also present and not measured before: 325 `evidence_items`, 264
`observations`, 2 `evidence_assemblies`, 23 `runs`, 81 `commands` with 81
`command_outcomes`, 15 `departments`, 15 `employees`, 16 `responsibilities`.

**The firm still holds no thesis, no aggregation, no review and no decision.**
§2's judgement — that v1 is an obligation-and-activity surface and not a
belief-and-recommendation surface — is unchanged by anything implemented since.

### 10.2 Rulings, as evidenced by the code

| question | ruling in force | evidence |
|---|---|---|
| §8.1 accent | **(b)** — cyan stays with market and chart data, bronze marks the institution | `app.css:44-54`: `--color-accent: #4de8f5` kept, `--color-institution: #d9a441` added with the two-accent rule stated in the file |
| §8.3 fabricated destinations | **removed from primary nav, routes kept reachable** | `navigation.ts` carries four items; `/portfolio` and `/reports` are absent and still routable |
| §8.4 merge | **merged, both URLs redirecting** | `agents.index.tsx` and `cases.index.tsx` are `beforeLoad` redirects to `/headquarters`; `/cases/$caseId` and `/agents/$departmentId` untouched |
| §8.2 home page | **superseded — see §10.4** | — |

### 10.3 What is implemented and running

Verified by fetching each route from the development server with the database
up. No route returned a failure state.

- **Stage 1 — shell and IA.** Primary navigation is Kommandocentral,
  Huvudkontor, Underlag, Marknader. Evidence is promoted; the two fabricated
  destinations are gone from it.
- **Stage 2 — Command Center panels, READY sources only.** Rendering against
  real state: the attention queue (14 of 14 outstanding, each with its owner
  and `nextAct` read verbatim — every case currently reads *Formulera en tes*,
  owned by `devils-advocate`), `Institutionellt läge`, `Institutionella ytor`,
  `Var arbetet ligger`, `Underlag firman håller`, and `Vad firman kan svara på`
  stating in words that no CIO decision exists and the firm holds no combined
  view.
- **Stage 3 — activity projection.** Implemented ahead of the §6 slice and
  running: `events.recent()` had zero consumers when this gate was written and
  now backs `Institutionell aktivitet`, rendering 24 entries resolved to desk,
  act and timestamp.
- **Beyond the gate.** A persona layer — `agentPersona.ts`, `PersonaPlate.tsx`,
  `AgentNetwork.tsx` — gives each desk a named head and a portrait, with a
  designed monogram in the same geometry where no photograph exists. Seven of
  fifteen identities are photographed.
- **§1.7's disclosure defect is closed** on the market surface:
  `hasDegradedCategory` is rendered at `LightCommandCenter.tsx:923`.

Suite state at the time of writing: `tsc --noEmit` clean; 2387 passing, 8
skipped, across 101 files with no worker-skip.

### 10.4 One implemented decision is superseded, and the product does not yet reflect it

§8.2 recommended (a) — the Command Center takes `/` and the market overview
moves to `/markets` — and that is what was built.

**The ruling now in force is different.** `/` is the Kommandocentral, the
global market landing page. `/headquarters` is Huvudkontor, and the CIO, the
agent personas, the investment floor, the governance functions and the
institutional workflow belong there.

Measured against that ruling, the running product is wrong in a specific and
recorded way:

- `/` currently renders the agent floor — all six departments with their heads
  and portraits, the independent control functions, `CIO-syntes`, the
  obligation queue and the activity feed — and **no market content at all**.
- `/headquarters` renders the floor, `CIO-syntes`, the eight recorded runs and
  the fourteen open cases.
- **The floor, the personas and the CIO panel are therefore rendered twice**,
  on two destinations, one of which should not carry them.

This is not a defect in any panel. Every one of them reads real state
correctly. It is that the two pages were built under §8.2(a) and the ruling
that replaced it moves the institution off the home page. Reconciling it is a
placement change, not a rebuild, and it is the next piece of work this gate
owes. **What `/` should carry instead is not settled here** — the market
overview that now lives at `/markets` is one candidate and a purpose-built
market landing page is another, and that choice is not evidenced by anything in
the repository.

### 10.5 Not claimed

The slice has not been committed, and Stages 4 and 5 have not been started —
correctly, since §6 recommended stopping after Stage 2. Nothing here revisits
§7: no panel computes standing, confidence, eligibility or sufficiency, and no
fabricated state was introduced to make any surface look complete.

---

## 11. Placement correction — 2026-08-23

§10.4 recorded that the product rendered the institution on two destinations.
The ruling that resolves it, and what was changed to implement it.

### 11.1 The ruling

| destination | subject | question it answers |
|---|---|---|
| `/` **Kommandocentral** | the market | *what is happening in the world?* |
| `/headquarters` **Huvudkontor** | the firm | *who are we, and what do we owe?* |
| `/evidence` **Underlag** | the evidence | *what do we hold to reason from?* |

`/` carries the truthful market experience and **no** Agent Network, CIO
synthesis, governance floor or institutional workflow. `/headquarters` is the
sole home of all of them. This supersedes §8.2(a).

### 11.2 What moved, and what was preserved

A placement change. No page was rebuilt, no read model was touched, and no
institutional semantics changed.

- **`/`** renders `LightCommandCenter` from `getOverviewSnapshotFn` again —
  the same market screen, the same snapshot, the chart, globe and hero work
  untouched.
- **`/markets`** redirects to `/`. It had become a second route rendering the
  same component; its own former content — a ticker list of indices, FX and
  crypto — was already absorbed into the overview, so nothing market-specific
  was lost. `/watchlist` is untouched and remains a genuine drill-down.
- **`/headquarters`** now renders the workstation composition — attention
  queue, floor with personas, CIO seat, activity feed, owner load, runs,
  coverage, evidence — above its case queue. Both halves are the work that
  already existed; only their address changed.
- **Primary navigation** is three items. `Marknader` was removed because it
  pointed at the screen `/` now renders.
- **The home page's own rail** lost its `Marknader` entry and its *Visa alla
  marknader* link. Both pointed at `/markets`, which now redirects to the page
  they sit on. The rail's active highlight follows `/` again.
- **The run ledger was folded, not deleted.** Huvudkontoret carried a second,
  fuller run list; its two distinguishing facts — provider kind and measured
  usage — moved into the workstation's run module, so one list on the page
  still refuses to let a stub read as live analysis or an unmeasured cost read
  as a number.

### 11.3 Verified against the running database

`tsc --noEmit` clean. Unit suite 2391 passed, 8 skipped, 104 files. PostgreSQL
suite 819 passed, 35 files — file counts checked, not just the exit code.

Fetched from the development server with the cluster of §10.1 up:

| route | result |
|---|---|
| `/` | 147 KB — Marknadsöversikt, Räntemarknaden, Sektorer, Bevakning. **No** CIO-syntes, Golvet, Kräver uppmärksamhet, Agent Network or activity feed |
| `/headquarters` | 88 KB — Golvet (3 deskar · 3 kontrollfunktioner), Specialistdeskar, Oberoende kontrollfunktioner, CIO-syntes, Kräver uppmärksamhet 14/14, Institutionell aktivitet, Var arbetet ligger, Senaste körningar with provider and usage, Vad firman kan svara på 0/7, Underlag firman håller, Pågående (14) |
| `/markets` | 307 → `/` |
| `/agents`, `/cases` | 307 → `/headquarters` |
| `/evidence` | unchanged |

**The duplication of §10.4 is gone**: the floor, the personas and the CIO seat
appear once in the product.

### 11.4 Not claimed

Visual acceptance. The two pages have been verified by fetching and reading
them, which proves placement and content; it does not prove they look right.
Manual screenshots of `/` and `/headquarters` are the remaining gate, and
nothing here is committed until both are approved.

`Portfölj` and `Rapporter` remain on the home page's own rail and remain
`mockData`. They are out of the primary navigation, which is where the gate
ruled they must not be; giving them real read models is a capability decision
and is still open.

---

## 12. Visual pass — Huvudkontoret — 2026-08-23

A presentation-layer redesign against a north-star reference image. No read
model, server function or institutional semantic was touched; the diff is
components and tokens.

### 12.1 The shell correction

`/` brings its own vertical rail, market-session state, clock and profile. The
application's horizontal rail was rendering above it, so the market landing page
carried **two navigation systems disagreeing about where the reader was**.
`AppLayout` now stands down on `/` and only there — the page gets the bare
canvas, every institutional surface keeps the rail. Guarded by a rendering test
rather than a comment, because this is a placement rule and placement has
regressed here before.

### 12.2 What Huvudkontoret became

| region | reference | what fills it here |
|---|---|---|
| left rail | CIO message, market overview, shortcuts | CIO seat with portrait and **whether a decision exists**; the obligation queue; institutional figures; entrances |
| centre | dealing-room hero with agent network | the floor: the environmental photograph at a scrim that lets the room read, two tiers of portrait-led modules, light paths converging on the CIO |
| right rail | live activity feed | `events.recent()` with the desk's own persona beside each entry |
| lower band | four analytical modules | Var arbetet ligger · Senaste körningar · Vad firman kan svara på · Underlag firman håller |

**Person → desk → role → state.** A desk module leads with a 64px portrait and
the persona's name, then the desk, then the seat, then — below a rule —
institutional state. The previous module led with a card and hung a 40px
headshot off the text.

**The network claims nothing.** Cyan paths carry analysis, bronze paths carry
authority, and both converge on the CIO seat because that is the shape of the
firm's workflow. They encode no quantity and report no event; a path is lit
because the seat exists. The seat at the end of them still says, in words, that
no CIO decision is recorded and the firm holds no combined view.

### 12.3 Nothing from the reference was copied that the firm does not hold

No CIO message, recommendation, exposure, AUM, decision, scenario, sentiment,
market-intelligence event, thesis state or governance act. The reference's CIO
quote card became a card carrying the seat, the person and the single fact the
record holds about it — an invented sentence in the CIO's mouth would be the
firm appearing to hold a view, which is the one fabrication this product exists
to prevent.

### 12.4 One real defect found and fixed

`.ref-portrait` is a `span` and never set `display`. It honoured its size only
where a flex parent had blockified it, so the same plate rendered at 72px in one
layout and at the photograph's natural size in another — portraits rendered five
times their intended size the first time the floor was laid out. The plate now
blockifies itself instead of depending on where it is placed.

### 12.5 Verification

`tsc --noEmit` clean. Unit suite 2393 passed, 8 skipped, 104 files — two new
tests, both guarding the shell rule. PostgreSQL suite 819 passed, 35 files.
Captured from the running product at 1920×1280 against the live database, with
no console errors.

**Not claimed:** acceptance. The screenshot is for side-by-side comparison with
the north star, and nothing is committed until that comparison passes.

---

## 13. Second visual pass — the room — 2026-08-24

### 13.1 The environmental asset

A dealing-room photograph replaced the financial-district skyline. The skyline
gave the panel darkness but no depth; the composition needed a room with people
in it, and no amount of scrim tuning turns a skyline into one.

**It was cropped before installation, and the crop is the point.** The supplied
image carried a real bank's wordmark and an "INVESTMENT COMMAND CENTER" sign on
the right-hand wall. Financial OS is not that bank, and a real institution's
branding on the firm's own floor is a claim of affiliation the product has no
right to make. The right 17% of the frame is gone; what remains is the room —
the floor, the people at terminals, the wall screens, the windows. Stored at
`public/data/dealing-room.jpg`, 192 KB.

**The wall screens were kept, and they are pixels.** The photograph's own
screens carry legible figures. Nothing reads them, quotes them, or derives from
them, and no surface implies they are the firm's data — the same rule the
people in the room are held to. This is a deliberate call rather than an
oversight: the reference's depth comes substantially from those screens, and
removing them would have cost the composition the thing the asset was brought
in to supply.

### 13.2 What changed in the composition

- **The floor left its panel.** The dominant element of the screen was a card
  with a head band on it. It is now the region itself, carrying its own label
  over the photograph, and the room takes the top of the frame outright.
- **The organisation moved to the bottom** of the hero, over the floor, in
  glass — the reference's arrangement, and the reason it reads as an
  institution with an interface over it.
- **Modules turned horizontal**: portrait left, person, desk, seat, then
  accountability and state. Less card, more personnel plate.
- **The connectors were rebuilt as an organisation chart.** Stubs from each
  desk into a bus, the bus into a stem, the stem into the tier below, and
  finally into the CIO seat — drawn in the gutters, so the shape reads end to
  end instead of in the fragments that happened to fall between two cards. Cyan
  for analysis, bronze for authority.
- **The dashes came off.** A dashed, drifting line reads as something in
  transit. These lines draw the shape of the firm, not the movement of work
  through it, and the distinction is exactly the one this product exists to
  keep.

### 13.3 Still nothing fabricated

No ACTIVE or LIVE pill, no CIO message, no recommendation, exposure, AUM,
decision, scenario, sentiment or market-intelligence event. The CIO seat is the
endpoint of the whole composition and says, in that position, that no decision
is recorded and the firm holds no combined view. **Visual prominence is a
statement about the organisation; it is not a claim about its output.**

### 13.4 Verification

`tsc --noEmit` clean. Unit suite 2393 passed, 8 skipped, 104 files. PostgreSQL
suite 819 passed, 35 files. No truth or governance test was weakened to let the
design through. Captured at 1920×1280 against the live database, no console
errors.

---

## 14. PostgreSQL verification — 2026-08-24

Recorded because the suite failed four times during this branch's visual work
and none of it was a defect. The conclusion is the measurement, not an
impression.

| runs | conditions | result | duration |
|---|---|---|---|
| 4 | isolated — nothing else on the machine | **819/819, 35/35 files** | ~475–500s |
| 4 | contended — Playwright captures, probes or a second vitest instance | 1–2 failed, **a different test each time** | 700–1692s |

- **No production defect reproduced under isolation.** Every failure was a
  timeout or a resource wait, and every file that failed passed on its own —
  `c1d1Resources.pg.test.ts` gave 13/13 alone.
- **No code or test change was required or made.** No timeout was raised, no
  test skipped, weakened or deleted to reach green.
- **The working tree was byte-identical across the final isolated run**: HEAD
  `58a61c9`, 35 changed paths, tracked diff hash `a9eb89c4b001260d` before and
  after, with an identical path list.
- No PostgreSQL adapter file is modified on this branch, and none may be
  changed on the strength of these failures.

**Classified as contention-related test instability.** The limit of that claim
is worth stating: it establishes the suite is load-sensitive, not that it holds
no intermittent. A saturated CI runner could reproduce it, and that is a
separate matter from this branch.

The operational lesson is procedural and belongs here: **do not run browser
captures or a second vitest instance while the PostgreSQL suite is in flight**,
and never pipe its output through `tail` — one contended run's failure identity
was lost that way and had to be re-run to recover.

---

## 15. Boardroom v1 — implementation record — 2026-08-30

**Status: IMPLEMENTED — AWAITING VISUAL ACCEPTANCE.**

Boardroom v1 is not closed and not accepted. Everything below is measured out of
the repository and the verification runs of 2026-08-30; the one question that
decides the stage is human and is stated, unanswered, in §15.15.

The subject is `/cases/$caseId`: the case rendered as the committee that holds
it, rather than as the tables it is stored in.

### 15.1 What was built

| module | lines | what it is |
|---|---|---|
| `application/analysis/boardroomTimeline.ts` | 322 | the case as a debate — a projection of `CaseOverview` |
| `application/analysis/boardroomSeating.ts` | 215 | who sits at the table, and what they did in this case |
| `presentation/analysis/boardroomAnchors.ts` | 116 | where each position sits on the photographed table |
| `presentation/analysis/boardroomText.ts` | 197 | the institution's wording |
| `components/boardroom/CommitteeRoom.tsx` | 213 | the room: plate, anchored seats, fallbacks |
| `components/boardroom/DebateFloor.tsx` | 230 | the reading order a person arrives with |
| `components/boardroom/DebateTable.tsx` | 382 | the acts, their objections and their gates |
| `components/boardroom/Seat.tsx` | 128 | one institutional position |
| `components/boardroom/CaseMasthead.tsx` | 187 | the question the case asks |
| `components/boardroom/Inspect.tsx` | 33 | disclosure of the underlying record |

Covered by 52 tests across four files: `boardroomSeating.test.ts` (17),
`boardroomTimeline.test.ts` (12), `Seat.test.tsx` (14) and the PostgreSQL
fixture `boardroomFixture.pg.test.ts` (9, 699 lines), which proves the
projections against a real database rather than against constructed objects.

### 15.2 The projection architecture is truthful by construction

`boardroomTimeline` is **a projection of `CaseOverview` and nothing else**.
Every entry resolves back to a persisted institutional object by its durable id,
and the projection holds no opinion about any of them. It does not evaluate
eligibility, infer materiality, recompute confidence, decide which review is
authoritative, or read organisational mandate — every one of those answers
already exists, in `overview.eligibility`, on the challenge, on the claim, in
the repository's own supersession, in the organisation. A second derivation
would be a second answer free to disagree with the first.

The prohibition that does the most work is the one against reading absence:
**it never converts an ABSENCE into a position.** A revision nobody challenged
is not a revision everyone agreed with, and a desk that raised no objection has
not endorsed anything. There is no wording anywhere in the surface for
consensus, because the firm does not record agreement.

`CaseOverview` gained `peerExaminations: readonly PeerExaminationReview[]`
(`caseOverview.ts:104`), loaded through
`repositories.reviews.peerExaminationsForCase` and folded into the case's
transition events. That is what lets a peer examination appear as an act rather
than as a gate result inferred after the fact.

### 15.3 Same-time moments, and the chronology the record does not establish

Institutional acts carry the instant they were recorded, and **that instant is
the only ordering the firm actually wrote down.** Where two acts share it, the
record does not say which came first — so the projection does not decide either.

Entries are therefore grouped into `BoardroomMoment { at, concurrent, entries }`.
A moment holds one or more acts recorded at the same instant, and `concurrent`
is the whole point: `false` means the firm established that this act came after
the previous group; `true` means it did not. A presentation layer can draw a
sequence as a sequence and a same-time group as a group, and **cannot
accidentally draw an arrow between two acts the record never ordered.**

Two further refusals sit behind it:

- Ordering _within_ a moment is by id, purely so two renders of one case do not
  shuffle. It carries no meaning and is never drawn as though it did.
- A per-kind `sequence` is **not** promoted into a global order. Review
  sequences are allocated per `(case, revision, kind)`, so comparing a
  verification's sequence 1 against a risk review's sequence 1 would be
  comparing two different countings.

This is the stage's central anti-fabrication rule: a committee narrative is
exactly the kind of surface that invents a chronology, and manufactured
chronology is prohibited rather than merely avoided.

### 15.4 Objections, settlement and supersession are read, never reconstructed

`BoardroomObjection` carries the challenge as the challenge recorded it:
`challengeId`, `contests` (a real `ClaimId`, never a paraphrase), `argument`,
`materiality` assigned when the objection was filed, `outcome` as the
organisation answered it — `open` until somebody settles it — `resolvedBy` once
settled, and `counterEvidenceCount`.

Peer and Devil's Advocate objections share one shape because **a challenge is
one institutional object under either mandate**. Which mandate raised it lives
on the entry's lane, not restated per objection, which would let the two drift
apart.

Supersession is read from the repository: `supersedesReviewId` where an act
replaced one, and `superseded` where a later act of the same kind replaced this
one. A superseded review is preserved and shown as superseded, never removed —
the same rule the Headquarters timeline already follows.

An empty objection list is rendered as a finding, not as an absence of one.

### 15.5 The room seats the organisation; participation is a separate fact

`boardroomSeating` exists because of the distance between those two: **a chair
belonging to a desk must never read as evidence that the desk worked on the case
in front of it.** Three participation states, each from a different persisted
fact:

| state | source |
|---|---|
| `acted` | the case holds an institutional act by this desk |
| `assigned-not-acted` | the workflow allocated it work; nothing is recorded yet |
| `not-in-case` | the firm holds the seat; this case never asked for it |

Nothing is inferred. `acted` comes from the projection of persisted acts,
`assigned-not-acted` from the case's own assignments, and the remainder is the
roster minus the two. A desk that ran and was **refused acceptance has no act** —
correctly, because unaccepted work is not institutional — and appears as
assigned rather than acted.

A seat carries identity, classification and whether the desk appears in this
case. It may never carry a verdict, a confidence, a challenge or an opinion;
those belong to the acts, which the debate surface renders from the timeline.

Seats are ordered by participation — acted, then asked, then the rest of the
firm — rather than by a hand-written list of important departments, so **the
case decides who is prominent, not a preference nobody recorded.**

### 15.6 The executive seat: submission, act and decision are three things

`SeatKind` separates `chief` from `governance` deliberately: the control
functions check the work and the chief decides on it, and a room that drew them
alike would put the decision inside the review.

`SeatParticipation` cannot describe the head of the table. A submitted case with
no decision leaves the executive department with no act and no assignment, so
the generic answer is "never asked for" — technically true and, at the head of
the table, badly wrong. `ExecutiveStanding` is that missing fact, kept separate
so the ordinary three states keep meaning what they meant:

| standing | what it says |
|---|---|
| `not-submitted` | the case has never been put to the CIO |
| `awaiting-decision` | submitted, and no decision stands — the office holds it |
| `returned` | the CIO acted and did **not** decide; the case went back to the desks |
| `decided` | a decision stands, carrying the recorded outcome |

Each arm is **read, never inferred**. The live decision answers first; failing
that the newest submission reports its own state, because the domain already
tracks whether it is pending, returned or decided and re-deriving that from
timestamps would be a second opinion about a written fact. `decided` with no
live decision means a reopening superseded it, and waiting is then the honest
reading of two stored facts.

Nothing concludes that the CIO has looked at, considered or accepted anything.
`awaiting-decision` is a statement about where the case is, not about what the
CIO has done with it — a submission is not an act, and an act is not a decision.

### 15.7 The photograph and the institution, with no mapping between them

The room is two layers and there is **no mapping between them**:

```
the photograph says   I am inside a working investment institution
Financial OS says     these desks worked on this case
```

Only the second is derived from anything the firm stored.

**The photographed people represent nobody.** Not Global Macro, not Rates, not
the CIO, not any employee. They carry no participation, activity, agreement or
disagreement, and they are no more semantically meaningful than the skyline, the
chairs, the glasses or the marble. Nothing attaches a label to a body, draws a
ring round a face, or lets a figure's presence change a desk's state — an
inactive desk stays dark whoever is sitting behind its chair, the executive seat
included. A nameplate may land in front of a figure, between two, or in front of
an empty chair; that is geometry, not identity.

Institutional identity and state attach **only** to the application-rendered
table positions and their nameplates.

What varies between cases is **light, not architecture**. One plate serves every
case: three participating desks and nine use the same photograph, because the
institutional layer carries the variation.

### 15.8 Anchors, the Chairman position, and the constructed fallback

`BOARDROOM_ANCHORS` is presentation geometry and nothing else — percentages of
the frame, measured against one asset. No domain type, read model or
organisation rule refers to them, and changing one moves a nameplate without
changing a single fact. They live in `presentation/`, outside domain and read
model.

Ten positions: the analytical desks on the left arc, the desk that synthesises
them beside the head, the control functions on the right — the same separation
the debate surface draws, made spatial. **The order is architecture, not
seniority, and no consumer may read precedence from it.** The executive seat is
the far apex, off the ring, higher and smaller; it is dark until a decision
exists, so **a case merely submitted never makes the room look decided.**

`CHAIRMAN_ANCHOR` is the foreground chair cropped by the frame: where the reader
sits. It is a position for the person looking at the screen, not a department.

Two fallbacks, and one room at a time:

- **Plate fails to load** — the constructed room renders instead: built
  architecture, a table in `rotateX` perspective, the same anchored plates.
  Never drawn underneath the photograph.
- **Below `md`** — the perspective collapses to a roster, because a committee
  table at 375px is a diagram nobody can read and the seats matter more than the
  geometry.

The firm holds more desks than the table seats, deliberately — a sixteen-chair
table would be a diagram. A desk with no anchor is still rendered beneath the
room, and **prominently if it acted**, because a desk that acted and then
vanished from the surface would be the room lying about the case.

### 15.9 The environment plate and the file-swap boundary

`public/data/boardroom-plate.webp` — **WebP, 1672×941, 234,302 bytes.**

A higher-resolution plate **of the same composition is a file swap and nothing
else**: overwrite the file and every anchor still lands, because the anchors are
percentages of the frame rather than pixels, and the room renders the plate at
its intrinsic aspect with no crop.

What is not free is a change of composition. If the table, the camera height or
the horizon moves, the coordinates describe a table that is no longer there and
must be re-measured against the new asset — and nothing else in the codebase
needs touching, because nothing else knows where the chairs are.

### 15.10 Responsive and accessibility treatment

The room is a labelled `section`; seats are exposed as a `role="list"` of
`role="listitem"` entries, each carrying an `aria-label` of the form
`{department} — {state}`, so participation reaches assistive technology as words
rather than as illumination. The plate, the scrim, the constructed room and the
plate-mirror flourish are all `aria-hidden="true"`: they are atmosphere, and
atmosphere is not announced.

The `md` breakpoint is the whole responsive story — perspective above it, a
two/three-column roster grid below it. The institutional content is identical on
both sides; only the geometry is dropped.

### 15.11 The defect this stage shipped, and why the earlier verification missed it

Boardroom v1 was **built, reviewed and screenshotted while violating the
`no-ui-import-of-infrastructure` fitness rule.** `DebateFloor` value-imported
`boardroomTimeline` and `boardroomSeating` from `~/application/analysis`.

It went unnoticed for the whole stage for a mechanical reason worth recording
exactly: **the verification runs named `src/test/importGraph.test.ts`
specifically rather than `src/test`**, so `src/test/fitness/` never executed. A
narrow path list looks like a targeted run and reads like a green suite. The
passing count that accompanied it measured the files chosen, not the rules that
apply — and the rules that never ran are precisely the ones that exist to catch
what a component author would not think to check.

The rule's own reasoning is why this mattered rather than being bookkeeping: an
import is a bundle edge, and a value import is how assembly logic — and with it
a second answer to "is this eligible" — arrives inside a component.

### 15.12 The correction: the architecture moved, the rule did not

**The projections are now assembled at the server-function boundary.**
`serverFns.ts:279-283` builds `{ timeline, seats }` and publishes it as
`boardroom: BoardroomProjection` on the case-overview response; the comment at
`:118` records why it is assembled there rather than in the component. The two
projections travel together because they must describe the same moment — a
surface given a fresh timeline with stale seats would light a desk for an act
the record no longer shows beside it.

Every boardroom reference to `~/application/analysis` is now `import type`,
which is erased at compile time: not a bundle edge, and nothing can be called
through it. Value imports remain forbidden.

**The fitness rule was not weakened, relaxed, scoped around or given an
exception.** It fires today exactly as it fired then; what changed is that the
projections moved to where `presentation-boundary` already said they belonged.
The rule caught a real layering violation and the architecture yielded to it.

### 15.13 Verification — 2026-08-30

Reported by tier, with each tier named rather than standing in for another.

**Complete applicable repository verification**

| run | scope | result |
|---|---|---|
| `npm run test` | every applicable path, 121 files collected | **119 passed, 2 skipped, 2698 tests** |
| `npm run test:db` | `src/**/*.pg.test.ts` | **36 of 36 files, 848 tests** |
| `npm run typecheck` | `tsc --noEmit` | clean |

The unit run's collection was enumerated rather than assumed: all four fitness
files — `fitness.test.ts`, `marketDisclosure.test.ts`, `personaIdentity.test.ts`,
`ruleIntegrity.test.ts` — plus `importGraph.test.ts` were collected and
executed. `no-ui-import-of-infrastructure` passes. The two skips are opt-in by
environment flag and are not accidental: `avanza.smoke.test.ts`
(`describe.skipIf(!ENABLED)`, live network) and `determinismProbe.test.ts`
(`describe.skipIf(!OUT)`, diagnostic probe).

The PostgreSQL file count was checked against the 36 `*.pg.test.ts` files on
disk, so no file was silently dropped by a worker-startup timeout. The `ERROR:`
lines in that run's log are planted constraint violations the tests assert
against.

**`npm run format:check` is NOT green.** It fails across **185 files**.
Investigation established the failure is repo-wide and pre-existing rather than
introduced here — `docs/technical-debt.md` already fails Prettier at HEAD,
before any edit made on this date.

The accurate statement of this stage's verification is therefore:
**functional, architecture and PostgreSQL verification green; the repository
formatting gate remains pre-existing red.** The repository is not described as
universally green.

No test was skipped, weakened or deleted to reach this result, and no truth or
governance assertion was altered.

**Addendum — 2026-08-31.** Subsequent diagnostic hardening (`ECONNREFUSED` and
the other connection-level errnos now classified as unreachable rather than as
an unmapped database error) added **one test file and 16 tests**; the latest
complete applicable verification is `npm run test` 122 files, 120 passed, 2
skipped, 2714 tests; `npm run test:db` 36/36 files, 848 tests; `npm run
typecheck` clean; `npm run format:check` still pre-existing red across 185
files. **This later run supersedes the counts operationally but does not rewrite
the historical §15 verification record above**, which stands as measured on
2026-08-30.

### 15.14 Remaining relevant debt

| item | subject | state |
|---|---|---|
| **TD-83** | the organisation seed checksum does not cover `department_handles`, and the reader's cache key inherits the gap | open |
| **TD-84** | no way to re-establish peer scrutiny on a successor revision; the fix must be an explicit act, never inheritance | open |
| **TD-85** | the newest organisation version is selected by lexical ordering of a textual column | open |

None blocks Boardroom v1. TD-83 and TD-85 both concern the organisation seed and
interact operationally, but they are separate defects: TD-83 is about what the
canonical representation covers, TD-85 about which persisted version is newest.

### 15.15 The acceptance question this record does not answer

No automated verification proves the visual and product requirement, and none of
the runs above bears on it. The remaining question is human:

> Does the Boardroom visually feel like entering a premium institutional
> investment committee, while still making the real Macro → Rates → Research →
> challenge → governance → CIO process understandable?

That question is deliberately not answered here. **Boardroom v1 remains
AWAITING VISUAL ACCEPTANCE.**
