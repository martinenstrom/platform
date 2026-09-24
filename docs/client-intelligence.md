# Client Intelligence — Phase 1

**Status: implemented 2026-09-23, synthetic clients only.** The Clients
module is the advisor's memory and intelligence layer for every
relationship: who the client is, their whole financial life, what changed,
what they care about, what was promised, what is coming, what needs
attention, and what to do next. It is the first built stage of the Advisor
OS (`docs/advisor-os-architecture.md`, stages A1, A5 and A6 in their
Phase 1 form), and it is not a CRM.

## 1. The product

- `/clients` — the relationship command centre. Eight metrics, twelve
  filters, seven sorts, and one dense row per client carrying the figures,
  the health, the last and next contact, the signals, the promises, the
  opportunity value and JARVIS's next best action.
- `/clients/:clientId` — Client 360. A relationship header (identity,
  health, last contact, next meeting, the next best action, _Förbered
  möte_, _Lägg till klientuppdatering_), then the financial snapshot, the
  wealth structure, the portfolio against its mandate, the goals, the
  relationship intelligence (context, promises, events and reminders, the
  timeline with every original note), financing and household,
  opportunities, JARVIS intelligence, and _Fråga JARVIS om klienten_. The
  intelligence rail stands beside all of it on a wide screen.
- **Client memory** — the daily workflow. The advisor writes what happened;
  JARVIS proposes what it understood (the interaction, a concern, an event
  with a date, the next meeting, a promise, the topics); the advisor
  confirms, edits or removes each item, or confirms all; only confirmed
  items become records. The note is always kept, exactly as written.

The product is Swedish-language, as the rest of Financial OS is; the
specification's labels are rendered in Swedish and JARVIS's terms are kept.

## 2. Where things live

```
domain/advisory         Client, Household, Asset, Liability, Portfolio, Holding, Goal,
                        Interaction (carries the note), ContextFact, Commitment,
                        ImportantEvent + ReminderRule, Opportunity, MemoryCandidate,
                        Provenance; date arithmetic; the rules (health, signals, next
                        best action, flags, reminders, meeting preparation); deterministic
                        extraction; memory search. Pure. No clock, no locale, no prose.
application/advisory    repository ports; assembleClientFacts (the one assembly);
                        clientDirectory and client360 (read models, derived on the
                        server); recordClientUpdate (note → candidate);
                        confirmClientUpdate (candidate → records, with provenance);
                        completeCommitment; askAboutClient; prepareMeeting.
infrastructure/advisory syntheticClients (seven fictional relationships, built relative
                        to the clock's date); in-memory repositories; the container;
                        serverFns — the only door the browser may use.
presentation/advisory   every domain kind as Swedish text, once; figures and dates;
                        the signal sentences (signal / why / action); the directory's
                        filters and sorts; chart data with fixed asset-class colours.
components/clients      the surfaces. They import the door, the presentation layer and
                        types only; they derive nothing.
routes/clients.*        loaders over the door; acts go back through it and the page
                        re-reads itself.
```

The fitness rules already in force apply unchanged: the UI names no
infrastructure module but `serverFns`; the domain imports nothing outside
the domain; nothing new reads `~/data/mockData`. `routes/clients.test.tsx`
adds the module's own boundary checks.

## 3. Rules the product stands behind

**Facts, not conclusions.** A record carries what the client said and what
was promised, dated and sourced. Health, signals, the next best action, the
flags, reminders and the briefing are derived on every read from those
facts (`intelligence.ts`, `meetingPrep.ts`) and are never stored, so a
changed threshold changes every answer tomorrow. The thresholds are stated
once in `INTELLIGENCE_THRESHOLDS`, and every signal quotes the numbers it
rests on.

**Provenance on everything JARVIS produced.** A context fact, commitment or
event drawn from a note carries `origin: 'jarvis-extraction'`, the
interaction it came from, the exact words it rests on, the source date, who
created it, JARVIS's confidence, and the advisor's confirmation with its
time. The surfaces show it: _källa_ beneath a statement opens the words.

**Nothing silent.** A candidate is not a fact. An item the advisor did not
decide on is discarded, not confirmed. An event without a date is refused
rather than stored undated.

**One derivation per fact.** The balance sheet is `balanceSheetOf`; the
deviation is `allocationDeviations`; overdue is `isOverdue`. The read models
carry the derived values so no surface recomputes them.

**Explainable health.** The score is a base of 70 plus and minus named
drivers with their points, listed on the page. The method is named
(`rule-based-v1`) beside the score and beside the directory.

**Synthetic only.** Every name, figure, note and family detail is invented.
The seed is built relative to today so the demonstration stays alive, and
the pages say _syntetiska klienter_. Real client data enters only behind
the authentication, audit and governance the production posture requires.

## 4. What Phase 1 deliberately does not do

- No Sentinel, no market-to-client engine, no notifications, no calendar
  or e-mail integration. Reminders are stored as rules on events and
  derived as dates; the model can answer the Sentinel's future questions
  (birthdays this week, loans maturing within 60 days, overdue promises,
  no contact for 90 days, excess cash, portfolios outside target) from the
  flags and derivations already present.
- No production LLM. Extraction is a lexicon and a set of patterns, Swedish
  first with English alongside, and it is tested by planting sentences. A
  model may later propose items through the same `ExtractedItem` shape;
  the confirmation step does not change.
- No semantic search. _Fråga JARVIS om klienten_ classifies the question by
  lexicon and answers with records; a vector search later replaces the
  classifier behind the same `MemoryAnswer`.
- No client-specific allocation recommendation. The strategic allocation is
  the agreed mandate, a fact; the deviation is arithmetic (ruling
  2026-08-17).
- No wiring into the live JARVIS router (TD-105), no durable storage
  (TD-104), no advisor identity beyond the client's primary advisor
  (TD-106).

## 5. Verification

- Domain: `extraction.test.ts` (the specification's example note in
  Swedish and English, relative dates, near misses), `intelligence.test.ts`
  (each rule with its trigger and its near miss; the score added up by
  hand), `wealth.test.ts`, `memorySearch.test.ts`, `meetingPrep.test.ts`.
- Application: `clientMemory.test.ts` — the workflow end to end against
  the seed on a frozen clock: record, confirm all, discard and edit,
  refusals, the directory's flags and metrics, the client page, completing
  a promise, asking, preparing.
- Surfaces: `ClientCommandCentre.test.tsx` and `Client360.test.tsx`, driven
  through the workflow with the real use cases behind the actions.
- Routes: `clients.test.tsx` — the door, the boundary, the navigation.

## 6. Product-quality review, 2026-09-24

Reviewed at 1600, 1440, 1024 and 768 against the dashboard and
Huvudkontoret, on four synthetic situations (entrepreneur with excess cash,
family with complex financing, conservative retiree with no lending,
at-risk relationship with overdue promises), and through the memory
workflow with notes typed the way an advisor types them.

### What changed

- **Command centre.** The row's second line is now `PB · sedan 2011 · Sofia`
  so it no longer truncates at 1440; the silence reads `64 dagar` / `i dag`
  on one line; the attention tile is _Behöver åtgärd_; the signals cell
  carries its top three sentences as a tooltip. Below `xl` the row keeps
  the seven columns that answer the desk's questions and hides the
  secondary figures, so 1024 and 768 no longer scroll a thirteen-column
  table sideways.
- **Client 360 hero.** Carries AUM beside total wealth, and the next best
  action is now the page's one filled element: _what_ (the action), _därför_
  (the signal it rests on) and _när_ (the due date, the meeting, or the next
  contact), with its urgency and method.
- **Rail order.** Next best action → signals → promises → upcoming →
  opportunities → health (the risks) last, per the review's hierarchy.
- **Edge states.** No lending, no lending panel (the snapshot already says
  _Skulder 0_); the wealth donut stacks above its table below `xl` so
  legends stop truncating; a zero liability total is no longer red.
- **Speed.** Ctrl/Cmd+Enter saves and analyses from the textarea; the
  metadata row stays optional.
- **Extraction, from real notes.** A probe of seven informal notes exposed
  the misses; each is now a planted test in `extraction.test.ts`:
  _ska läggas om 15 nov_ is a refinancing; _Brygglånet … förfaller_ is a
  maturity (compounds allowed) and _stressade_ a concern; _Lovat skicka …
  på måndag_ is the advisor's promise; a sentence that opens with a promise
  verb is a promise even when it mentions booking; _Ny träff … 12/11_ and
  _Nästa kvartalsmöte 16 dec_ are the next meeting; _inom två veckor_ dates
  a promise; _nästa vecka_, _v.43_ and _i mars_ resolve to the first day of
  the period **at low confidence** so the advisor sets the day; a child's
  _10-årsdag_ is a family event, never the client's birthday; _Ev._ does
  not end a sentence.
- **Persistence, said on the page.** Every client page ends with the line
  that the record is synthetic and held in the server process, not stored.

### The synthetic clock

The seed is built relative to the clock's date so the demonstration stays
alive; tests freeze the clock at 2026-09-23 and build the context directly.
For a demonstration or a screenshot that must not drift, the door reads
`ADVISORY_REFERENCE_DATE=YYYY-MM-DD` and pins the clock to that morning
(`infrastructure/advisory/serverFns.ts`, `advisoryClock`). Nothing else in
the product reads the wall clock for client data.

### The production build

`vite build` had failed since `988a327`. Measured cause (2026-09-24, by
neutralising one function and rebuilding): `infrastructure/marketData/serverFns.ts`
exported `getContainer`, a plain function whose body dynamically imports
the providers and `~/services/avanzaMcp/client` →
`@modelcontextprotocol/sdk/dist/esm/client/stdio.js` → `node:stream`.
Every route imports `serverFns`; TanStack Start strips only
`createServerFn` handler bodies from the client build, so rollup loaded
that chain for the browser and could not externalise `PassThrough`.

Remediation, the smallest cut: the factory moved to
`infrastructure/marketData/containerInstance.ts`, which nothing imports
statically; the five market-data handlers, both health endpoints and the
JARVIS door reach it through a dynamic import **inside their handler
bodies** (a module-level helper wrapping the same import would be loaded
again — measured). The JARVIS door passes the getter into its runtime. Two
fitness pins moved with the factory. No behaviour changed: one container
per process, memoised, the same providers.

### Still open after the review

- The lexicon is deterministic and Swedish-first; a model may later propose
  items through the same shape, and the confirmation step is unchanged.
- The record is per process (TD-104); _Fråga JARVIS_ is not a router
  intent (TD-105); the recording advisor is the primary advisor (TD-106).
- Below 1024 the client page stacks its rail beneath the content; the
  command centre keeps a horizontal scroll below 760 px. Desktop first, by
  design.
