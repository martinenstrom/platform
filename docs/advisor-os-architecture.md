# Advisor Operating System — architecture, gap analysis and staged roadmap

**Status: analysis only, 2026-09-17. Nothing of the Advisor OS is
implemented. STOPPED for ruling.** Written after the ruling of 2026-09-17
accepted `3697179`, closed the fast-path performance milestone and named the
Advisor Operating System the next product milestone — with the instruction
to return to the architecture and gap analysis before broad implementation.

One fact first: **no earlier Advisor OS specification exists** in this
repository, in the project memory, or in the session record (searched for
the vocabulary — advisor, household, meeting preparation, PowerPoint,
gap analysis — across every transcript). The ruling's chain is the
specification, and this document reconciles that chain with what JARVIS
has proven and with the rulings already on record.

The chain, as ruled:

> client / household context → meeting preparation → portfolio + market
> context → Financial OS only where genuine investment judgement is required
> → Advisor Brief → real PowerPoint artifact → post-meeting memory →
> commitments / follow-ups → better preparation next time

---

## 0. The chain, link by link

| Link | What it is | Who owns the truth | Execution class |
| --- | --- | --- | --- |
| client / household context | a person or household: profile, constraints (risk capacity, horizon, liquidity, objectives), relationships, documents, history | **Advisor OS domain** — new; client truth, never institutional truth | Tier 0 for a fact (_"Vad har Anna för horisont?"_) |
| meeting preparation | the act that assembles everything for a named meeting | Advisor OS application — new | Tier 1–2 composition; the assembly itself is deterministic |
| portfolio + market context | holdings and performance (new data) beside the market brief (exists, `3697179`) | portfolio: Advisor OS; market: the platform's market pipeline with per-value provenance | Tier 0 for a value; Tier 1 for "what stands out" |
| Financial OS only where judgement is required | a capital question for the client — _"Borde Anna minska USA?"_ | Financial OS, through the host contract (v3) | Tier 3 — governance before latency |
| Advisor Brief | a typed document: agenda, client state, portfolio, market, the firm's positions relevant to this client, commitments due, talking points | Advisor OS; every number carries its provenance; institutional content by **reference** | assembly deterministic; narration Tier 1 |
| real PowerPoint artifact | a rendering of the Brief, stored with a content hash | Advisor OS infrastructure (renderer) | deterministic — a slide never carries a number the Brief does not |
| post-meeting memory | the advisor's own debrief → structured memory: what was said, decided, promised | **JARVIS Brain** — episodes and references, never copies of the institutional record | capture Tier 2; confirmation by the advisor |
| commitments / follow-ups | promises with owners and due dates, surfaced before they are late | JARVIS-owned commitment ledger (the integration gate already places it there, §2: "none — JARVIS-owned") | Tier 0 to list; proactive surfacing |
| better preparation next time | the next Brief reads memory and commitments; measured | the whole loop | measured, not asserted |

---

## 1. What JARVIS has proven, and what each proof gives the Advisor OS

| Proven | Where | What the Advisor OS inherits | What it must not do with it |
| --- | --- | --- | --- |
| **one conversational router** — typed and spoken lines enter one backend router with the firm's tools; no second router | `a68f7d7`, `3697179`; `liveSession.ts` `respond()` | advisory intents become tools of the same router (`prepare_meeting`, `record_debrief`, `list_commitments`…), never a second assistant | introduce an "advisor bot" beside JARVIS; route by keyword |
| **Tier 0/1/2/3 execution depth** — a hard product principle: fact → fresh structured data → deterministic formatting → answer | ruling 2026-09-17; `marketIntent.ts`, `marketSpeech.ts`; fitness rule `fast-path-meets-no-model` | client facts, portfolio values and commitments due are Tier 0: a recogniser and a formatter, no model; the Brief's narration is Tier 1; the debrief's structuring Tier 2; capital questions Tier 3 | put a general model between a client fact and the person; reclassify a synthesis as Tier 0 to hit a number |
| **voice + text continuity** — one conversation, two interfaces; typed-while-live is spoken; history and market pointer travel with a turn | `cfad543`, `a68f7d7`; `JarvisPresence.tsx`, `presenceStore.ts` | meeting preparation and the debrief are spoken or typed, same door; the debrief is voice-first (north star) | build a keyboard-first form for the debrief; a voice-only path |
| **case amendments and closure** — the person adds to and closes the open case through the firm, provenance kept | `fbddeb8`; host contract v3 `amend`/`close` | when a client meeting raises a capital question, the case the firm opens is amended and closed through the same doors; nothing else touches institutional state | let a meeting note mutate a case; let a client statement become a thesis |
| **durable institutional boundaries** — no actor from the browser or the model; initiator JARVIS, actor the server-resolved principal; `parseHostRequest` refuses unknown fields by name | `c7a1246`; `hostContract.ts` | the Advisor OS port refuses the same things: no actor ids, no client ids invented by a model — a reference is resolved server-side or refused | pass a client record through the router as free text; let the model name the actor |
| **market brief / provenance** — every value with its own time, source and quality; fixture never quoted; stale said as "senaste tillgängliga"; drivers unverified without headlines | `a68f7d7`, `3697179`; `marketBrief.ts` | the Brief's market section IS the market brief; the same per-value rule applies to portfolio values (valued through the same pipeline) | cache a conclusion; render a number without its time and source; infer a cause |
| **JARVIS Brain boundary** — references and episodes about institutional records, never copies | `docs/jarvis-integration-gate.md` §1.6 | meeting memory holds `{caseRef, provenanceId}` and an episode ("3 sep: Anna ville minska USA; committee `hold`, material dissent"); the current answer is always resolved from the firm | store the firm's conclusion text in a memory row |
| **Financial OS institutional memory boundary** — the firm remembers evidence, claims, theses, decisions, reconsiderations; generated work is operational until a human accepts it | `26568b1`…`5f17487`; candidate/adoption boundary | the debrief is a **candidate memory** the advisor confirms before it is stored — the same shape as the firm's acceptance boundary | write a model's reading of a meeting into memory without the advisor's confirmation |
| **artifact requirements** — the north star: "Boardroom and Underlag become contextual deep dives opened on request"; presentation boundary: the UI consumes typed state and recomputes nothing | memory `presentation-boundary`; `ContextualSurface.tsx` | the PowerPoint is a **rendering of the Brief**, produced by a deterministic renderer from the Brief's typed model; a "Möte" surface previews it in HQ | let a model write slides; let the renderer compute a number |
| **meeting memory requirements** — raw audio never persisted; browser recording opt-in only; live transcript is conversational data, never institutional truth | architecture ruling 2026-09-15 | the client is never recorded; the input to memory is the advisor's own debrief, spoken to JARVIS after the meeting; a transcript is never a record of what the client said | record client meetings; treat the transcript as evidence |

---

## 2. The rulings on record that bind the design

- **Four layers of client allocation (2026-08-17).** Institutional market view (layer 1, exists) → institutional tactical allocation (layer 2, named, not modelled) → client constraints / profile (layer 3, does not exist) → client-specific recommendation (layer 4, does not exist). A Macro Agent never sets a client's split; the recommendation must trace upward to claims and evidence. **Consequence:** Advisor OS v1 builds layer 3 as data and shows layer 1 beside it in the Brief; it does **not** compute layer 4. The client-specific recommendation remains the advisor's act until layers 2 and 4 get their own capability gate.
- **Humans own authority; act-as identity; no simulated authentication (2026-08-13).** The advisor is the person JARVIS serves, and — when a capital question enters the firm — the firm's operator resolved server-side. A client is data, never an actor.
- **Store facts, not policy conclusions.** A memory row stores what the client said and what was promised, dated; never "the client is risk-averse" as a computed label without the facts it rests on.
- **Presentation boundary.** The Brief is typed state; the surface and the renderer consume it.
- **Build the institution before the staff.** The human advisor uses the Advisor OS before any "advisor agent" exists; agents come later, into a working workflow.
- **Measure, do not reason; operational definition of working.** Every stage below closes on a measured run through HQ, not on green suites.
- **The fast path is a hard product principle (2026-09-17).** Advisor OS, artifact and memory work must keep simple market retrieval → no case → no model when unnecessary → fresh, provenanced value → deterministic answer. Regression: fitness rule `fast-path-meets-no-model`, `liveSession.test.ts` "the fast path, as a product principle", the routing and voice probes.

---

## 3. Gap analysis — measured against the tree

| # | Capability the chain needs | Exists today (measured) | Gap | Size |
| --- | --- | --- | --- | --- |
| 1 | client / household model | nothing — no client, household, profile or mandate concept anywhere in `domain/` (`grep`; the 2026-08-17 memory measured the same) | a new domain `domain/advisory`: `Client`, `Household`, `Profile` (constraints as facts with dates), `Relationship`, `DocumentRef` | M |
| 2 | client data source | none; `/portfolio` renders `~/data/mockData` and says _"Exempeldata"_ | a decision: manual entry in HQ, file import (CSV/XLSX from the custodian), or a custodian API — nothing exists to adapt | M (import) · L (API) |
| 3 | portfolio holdings and performance | mock only; the market pipeline (provenance, freshness, delivery, circuit) is real and shared | `Holding` model, valuation **through the market pipeline** so every value carries its time/source/quality; performance from stored valuations, never recomputed in the UI | M |
| 4 | meeting model and preparation | none | `Meeting` (client, when, agenda, participants), `prepare(meeting)` in `application/advisory` | M |
| 5 | Advisor Brief composition | the parts: market brief (`marketBrief.ts`), case standing through the host contract (`status`/`result`/`inspect`), the conversation's history; missing: client and portfolio parts, the composer, the narration tier | `AdvisorBrief` typed model with per-value provenance and case references; deterministic composer; Tier-1 narration of talking points over the composed facts | M |
| 6 | real PowerPoint artifact | no artifact library in `package.json`; no artifact store | server-side renderer (candidate: `pptxgenjs`, MIT, pure JS, no native deps — to be measured before adoption); `Artifact` record (brief version, content hash, produced at, by); download through a server function; preview in HQ | M |
| 7 | post-meeting memory | the presence keeps the conversation in `sessionStorage` (dies with the tab); the integration gate defers "JARVIS runtime, Brain" as not in this repository | the **first durable Brain**: `MeetingMemory` (episodes, client statements as dated facts, decisions, references to cases with provenance ids), PostgreSQL, tenant-scoped; capture flow: debrief by voice or text → Tier-2 structuring → advisor confirms → stored | L |
| 8 | commitments / follow-ups | none (gate §2: Commitment Ledger — none) | `Commitment` (who promised what to whom, due, status), surfaced in the next Brief and proactively when due; external communication stays behind a decision gate (north star) | M |
| 9 | identity: advisor and client | act-as operator (`FINANCIAL_OS_OPERATOR_EMPLOYEE_ID`), `tenant_id` throughout storage, no authentication (TD-8 open) | model: advisor = the person (JARVIS) + operator (firm); client = data with a tenant; no new identity mechanism — TD-8 stays where it is | S (model) |
| 10 | privacy and personal data | no policy for client data; dev database holds fixtures and the firm's own record only | a posture before any real client: minimisation, retention, access by tenant, no client audio, synthetic clients in development | decision |
| 11 | advisory intents in the router | the recogniser and lexicon are market-only; tools are the firm's five plus the market snapshot | an advisory Tier-0 recogniser (client facts, portfolio values, commitments due) and router tools for the acts; the fast-path rule extended to the new recogniser and formatter | M |
| 12 | HQ surface for a meeting | presence, Boardroom and Underlag as contextual surfaces (`0d595a0`) | a **Möte** surface: the Brief, the artifact preview, the memory of the last meeting, commitments due — opened on request, never a new shell | M |
| 13 | measurement | routing, voice and bench probes; case-count invariant from the database | meeting-preparation probes: time to a complete Brief, every number verified against its source, the no-case invariant during preparation, memory round-trip | S |

Thirteen gaps: two decisions (2, 10), one large build (7), the rest medium
and shaped like things the codebase already does once.

---

## 4. Target architecture

### 4.1 Where things live

```
domain/advisory        Client, Household, Profile facts, Holding, Meeting, AdvisorBrief,
                       MeetingMemory, Commitment — records with identities and provenance,
                       no prose activity, no policy conclusions
application/advisory   prepareMeeting, composeBrief, recordDebrief (candidate → confirm),
                       commitments; the AdvisoryContext port JARVIS calls
infrastructure/advisory PostgreSQL repositories (tenant-scoped), the pptx renderer,
                       import adapters; valuation goes through the existing market pipeline
presentation/advisory  the Brief as Swedish text; slide text; the Tier-0 formatter for
                       client facts (deterministic, like marketSpeech.ts)
components/…           the Möte contextual surface in HQ; the Portfolio route made real
```

The Advisor OS is a **domain system beside Financial OS**, reached by the
same JARVIS through a port of the same shape as `FinancialOsSystem`. JARVIS
stays one identity. Financial OS owns the investment record; the Advisor OS
owns client truth; the JARVIS Brain owns episodes, references and
commitments. None of the three copies another's record.

### 4.2 The port JARVIS calls

```ts
interface AdvisoryContext {
  client(ref: ClientRef): ClientContext              // profile facts with dates, relationships
  portfolio(ref: ClientRef): PortfolioContext        // holdings valued through the market pipeline
  prepare(ref: MeetingRef): AdvisorBrief             // deterministic assembly; references to cases
  artifact(ref: BriefRef): ArtifactRef               // rendered, hashed, stored
  debrief(ref: MeetingRef, text: string): MemoryCandidate   // Tier-2 structuring, unconfirmed
  confirm(ref: MemoryCandidateRef): MeetingMemory    // the advisor's acceptance
  commitments(ref: ClientRef): Commitment[]
}
```

Requests are parsed like host requests: unknown fields refused by name; no
actor, no model, no client record as free text. Router tools mirror the
port one to one; the voice sees only the port's results.

### 4.3 Execution classes for advisory lines

| Line | Class | Path |
| --- | --- | --- |
| _"Vad har Anna för horisont?"_ · _"Hur mycket har hon i USA?"_ · _"Vad lovade vi henne sist?"_ | Tier 0 | advisory recogniser → repository → formatter; no model |
| _"Förbered mötet med Anna på torsdag."_ | Tier 1 | deterministic `prepare` → Brief; one model pass narrates talking points over the Brief |
| _"Vad bör jag ta upp med henne?"_ · _"Vad har hänt sedan sist?"_ | Tier 2 | one model pass over the Brief and the memory; no fetch it already has |
| _"Borde Anna minska sin USA-exponering?"_ | Tier 3 | the firm, through the host contract, with the client's constraints as facts in the question; the answer is the firm's institutional view (layer 1–2), and the client-specific recommendation stays the advisor's |
| _"Gör en presentation."_ | deterministic | Brief → slide model → pptx → stored; no model on the slides' numbers |

### 4.4 The Brief

A typed document, composed deterministically:

- **Client** — profile facts with dates; what changed since the last meeting.
- **Portfolio** — holdings, allocation, performance; every value `{value, observedAt, source, quality}`; stale said as stale.
- **Market** — the market brief as it stands, by reference to its time; drivers unverified without headlines.
- **The firm** — the standing of any case that concerns this client, resolved live through `status`/`result` (never a stored conclusion); material dissent visible.
- **Memory** — episodes from the last meetings, as references and dated statements.
- **Commitments** — due, overdue, done.
- **Talking points** — Tier-1 narration, marked as such, over the sections above; no number that is not in a section.

### 4.5 The artifact

`Brief → SlideModel → .pptx`. The slide model is a pure function of the
Brief; the renderer draws it; a footer on every numeric slide carries the
provenance line the platform already produces. The artifact record stores
the Brief version, the content hash and who produced it; the file is served
by a server function and previewed in HQ. A regenerated artifact for an
unchanged Brief hashes the same.

### 4.6 The memory

After the meeting the advisor tells JARVIS what happened — by voice, as the
north star wants. JARVIS structures it (Tier 2) into a **candidate**:
dated client statements, decisions, promises with due dates, references to
cases. The advisor confirms or corrects; only then is it stored. The
client's voice is never recorded; the transcript of the advisor's debrief
is discarded once the candidate is confirmed, like a live transcript today.
Retention and access are tenant policy, ruled before real data enters.

---

## 5. Staged implementation sequence

Each stage ships one capability end to end, closes on a measured run in HQ,
keeps the fast-path regression green, and stops for ruling. Stages are
ordered so that nothing depends on a decision not yet taken.

| Stage | Builds | Boundary it must not cross | Closes when (measured) |
| --- | --- | --- | --- |
| **A0** | this document; the two decisions of §6 (data source, privacy) | — | ruled |
| **A1 Client context** | `domain/advisory` (Client, Household, Profile facts), repositories, synthetic clients in dev; advisory Tier-0 recogniser + formatter; router tool `client_context`; the fast-path rule extended to the new modules | no real client data before the privacy posture; no model on a fact | _"Vad har Anna för horisont?"_ answered in ≈ 0.4 s typed / sub-second voice with provenance; no case opened; planted judgement lines go to the router |
| **A2 Portfolio context** | Holding model, import adapter for the chosen source, valuation through the market pipeline, `/portfolio` real for a client | no value without time/source/quality; nothing recomputed in the UI | _"Hur mycket har hon i USA?"_ Tier 0; a stale price said as stale; the Portfolio page shows the same numbers as the port |
| **A3 Meeting preparation and the Brief** | Meeting model, `prepare`, `AdvisorBrief` composer, Tier-1 narration, the Möte surface in HQ, case standing by reference | the firm entered only through the host contract; no stored conclusions; no client split computed | _"Förbered mötet med Anna."_ produces a complete Brief in the Tier-1 window; every number verified against its source by probe; the no-case invariant holds unless the advisor asks a capital question |
| **A4 The PowerPoint artifact** | renderer (library measured first), Artifact record, download door, preview | a slide carries no number the Brief lacks; a regenerated unchanged Brief hashes the same | the artifact opens in PowerPoint; a probe diffs every slide number against the Brief |
| **A5 Post-meeting memory** | `MeetingMemory` + candidate/confirm flow, the first durable Brain, references to cases with provenance ids, retention policy | references and episodes only; no copies; no client audio; confirmation before storage | a spoken debrief becomes a confirmed memory; _"Vad sa Anna sist?"_ answered from it (Tier 0); the firm's current answer still comes from the firm |
| **A6 Commitments and follow-ups** | Commitment ledger, due-date surfacing in the Brief and proactively; external communication behind a decision gate | JARVIS never sends anything to a client on its own | _"Vad lovade vi henne?"_ Tier 0; an overdue commitment surfaces at the next preparation |
| **A7 Better next time** | the Brief reads memory and commitments; preparation-time and correctness probes over repeated meetings | — | measured: second preparation for the same client is shorter and carries what the first meeting produced |

**Why this order.** A1 and A2 are data before behaviour: without a client
and a portfolio the Brief has nothing honest to say. A3 is the first thing
an advisor uses; A4 makes it leave the building; A5 and A6 are the memory
loop and the first durable Brain, placed after the Brief so the memory has
something to improve. A7 is the loop closed and measured. Each stage adds
its own Tier-0 recogniser lines to the fast-path regression.

**What is deliberately not in the sequence.** A client-specific
recommendation engine (layer 4), an "advisor agent", client authentication
(TD-8), a custodian API before a source is chosen, and any further latency
work.

---

## 6. Decisions needed before A1

1. **Client data source.** Manual entry in HQ, file import from the custodian, or an API — and in what format the first import arrives.
2. **Privacy posture.** Synthetic clients in development until ruled; retention, access by tenant, minimisation; explicit rule that clients are never recorded.
3. **Artifact library.** `pptxgenjs` proposed, to be measured (bundle, fonts, Swedish characters, server-side rendering) before adoption.
4. **The recommendation boundary.** Confirm that Advisor OS v1 shows layer 1 beside layer 3 and computes no client split — layers 2 and 4 wait for their own gate.
5. **The debrief's confirmation step.** Confirm that memory is a candidate until the advisor accepts it, mirroring the institution's acceptance boundary.
6. **Naming and placement.** Advisor OS as a domain system beside Financial OS, JARVIS one identity, the Brain owning episodes and commitments — as §4.1 proposes.

---

## 7. Regression coverage the Advisor OS must keep, from day one

- **The fast path** — `fast-path-meets-no-model` (extended to each new Tier-0 recogniser and formatter), `liveSession.test.ts` "the fast path, as a product principle", `scripts/probe-jarvis-routing.mjs` sets `tier0,control,isolation`.
- **The six-line routing acceptance** — finance is not automatically a case; a meeting preparation opens no case.
- **The host contract's refusals** — no actor, no command, no candidate from the browser or the model; the advisory port parses the same way.
- **The Brain boundary** — when the first Brain table exists, a fitness rule that no Brain record carries the text of an institutional conclusion: references and episodes only.
- **Provenance** — no value rendered on a slide or in a Brief without time, source and quality; a fixture never quoted.
