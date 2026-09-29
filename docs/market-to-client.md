# Market-to-Client V1 — which clients does this move touch, and why

**Status: implemented 2026-09-24 on top of the Sentinel checkpoint
`1a47df3`; hardened 2026-09-29 (episodes, history, the relevance split, the
policy boundary — §10) and frozen for review. Synthetic clients only; the
existing market-data stack only; no persistence; no recommendations.**

Market-to-Client connects the market intelligence Financial OS already
renders to the client intelligence it already holds:

```
MARKET OBSERVATION → MARKET EVENT → CLIENT EXPOSURE → CLIENT CONTEXT
                   → CLIENT RELEVANCE → SENTINEL DRIVER → ADVISOR PREPARATION
```

A market move is not a client alert. An impact exists only where a material
move meets a recorded exposure or a recorded context; a client whose record
says nothing relevant stays quiet, and the product is comfortable saying so.
Nothing here recommends a trade: an interpretation is typed as an
interpretation, and the preparation it suggests is the advisor's to judge.

## 1. Where it lives

```
domain/advisory/marketToClient.ts   MarketObservation, MaterialityPolicy + MATERIALITY,
                                    MarketEvent, reconcileMarketEvents (enter/exit/dedupe),
                                    ClosedMarketEvent + MarketLedgerState +
                                    reconcileMarketLedger + marketEventsSince (history);
                                    ClientExposure, EXPOSURE_THRESHOLDS, exposureOf;
                                    ImpactReason, ClientMarketImpact (relevance, financial
                                    and conversation relevance), assessImpact, assessClient
application/advisory/marketEpisodes.ts
                                    groupMarketEpisodes — the advisor-facing aggregation
                                    over MarketEventEntry, events kept intact
domain/advisory/sentinel.ts         the `market` driver, the `market-impact` theme,
                                    strengthenedByMarket (§5)
application/advisory/marketImpact.ts
                                    marketObservationsFrom(OverviewSnapshot) — the one
                                    mapper from the market pipeline; activeMarketEvents
                                    (ledger reconciliation); marketImpactBrief
application/advisory/ports.ts       MarketEventLedger (repositories.marketEvents — active
                                    and history), MarketObservationSource (context.market,
                                    optional), context.materiality (optional policy)
application/advisory/{sentinel,client360,meetingPrep}.ts
                                    fold the same impacts into the brief, Client 360
                                    (`marketImpacts`) and the meeting briefing
                                    (`marketSinceLastMeeting`)
infrastructure/advisory/marketSource.ts
                                    the market as the advisory context observes it:
                                    getContainer → createOverviewDataSource →
                                    getOverviewSnapshot → marketObservationsFrom;
                                    server-only, reached by dynamic import inside
                                    each handler (TD-107 discipline)
infrastructure/advisory/marketScenarios.ts
                                    MARKET_TO_CLIENT_SCENARIO example moves, stamped
                                    `quality: 'fixture'` / `source: 'Exempelscenario'`
infrastructure/advisory/serverFns.ts
                                    getMarketImpactFn; every handler passes the market
                                    source loader into the one memoised context
presentation/advisory/marketImpactText.ts
                                    labels, the market fact, exposure and context
                                    sentences, the interpretation, the preparation
components/marketImpact             ImpactExplanation (the five sections),
                                    MarketImpactModule (dashboard tiles + row marks),
                                    MarketImpactMatrix (/market-impact)
components/clients/MarketImpactPanel.tsx   "Marknadspåverkan" on Client 360
components/clients/MeetingPrepPanel.tsx    "Marknad sedan senaste mötet"
routes/market-impact.tsx, routes/index.tsx (loader)
```

No second market stack: the observations are the `OverviewSnapshot` the
dashboard renders, read through the same container and the same use case.
The advisory domain defines its own `MarketObservation` so it stays free of
the market domain; the application layer owns the one mapping.

## 2. V1 pathways and materiality thresholds

Every threshold is stated once, in `MATERIALITY`. `enter` opens an event;
`exit` keeps an open event alive until the move fades below it
(hysteresis); `major` marks severity; the event lapses `expiryHours` after
its last observation.

| Category      | Series (V1)                                                                                | Metric                            | enter | exit | major | expiry |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------------------- | ----- | ---- | ----- | ------ |
| rates         | US 10Y, US 2Y, DE 10Y, SE 10Y                                                              | yield change, bp                  | 10    | 6    | 20    | 72 h   |
| equities      | OMXS30, S&P 500, Nasdaq 100, DAX, FTSE 100, Nikkei 225                                     | index change, %                   | 1.5   | 1.0  | 3     | 24 h   |
| sectors       | the nine S&P 500 sectors                                                                   | change **relative to S&P 500**, % | 2     | 1.2  | 4     | 24 h   |
| fx            | USD/SEK, EUR/USD (EUR/USD opens events but reaches no client — see §8)                     | change, %                         | 1.0   | 0.6  | 2     | 48 h   |
| commodities   | Brent (energy), Gold (metal — reaches no client)                                           | change, %                         | 3     | 2    | 6     | 48 h   |
| risk-appetite | Cross-Asset Risk Appetite score                                                            | points **below** neutral 50       | 20    | 12   | 30    | 24 h   |

A series without a comparable prior (`change: null`) opens nothing — never
a fabricated zero. Risk appetite opens only on the risk-off side: a calm
market is not an event. A sector moving with the market is not an event of
its own.

### The policy boundary

`MaterialityPolicy` is the type; `MATERIALITY` is V1's fixed instance.
`reconcileMarketEvents` and `reconcileMarketLedger` take a policy (default
`MATERIALITY`), and the advisory context may carry one
(`context.materiality`). Every event records the lines it was judged
against (`thresholds`), and client relevance reads the event's severity —
never the constants — so a volatility-scaled or regime-aware policy later
replaces the numbers without touching event detection or relevance
(`marketToClient.test.ts` "the materiality policy boundary").

### Deduplication, stability, expiry

One evolving event per key `${category}:${symbol}:daily`. The ledger
(`repositories.marketEvents`, in-process like everything else in the
synthetic record) keeps the open events between reads, so:

- a second read of the same move updates the event in place, keeps
  `firstSeenAt`, and keeps the peak (`peakChange`, `peakAt`);
- a move oscillating around the line does not open and close all day
  (enter 10 bp / exit 6 bp);
- a series the pipeline did not report this read keeps its event until
  `expiresAt`, labelled with the freshness it had;
- an expired entry is no episode: the enter line applies again and the
  first-seen time starts afresh;
- a pipeline that throws leaves the open events standing — a failed read is
  not a calm market.

### Active relevance versus historical events

Expiry means _this event no longer contributes to current urgency_. It never
means the system forgets the event. When an event fades below `exit` or
expires unobserved, `reconcileMarketLedger` moves it to the ledger's
`history` as a `ClosedMarketEvent` — the event as it last stood, with its
peak, `closedAt` and `closeReason` (`faded` | `expired`), keyed
`${id}@${firstSeenAt}` so the same instrument can open a new episode beside
the old. History is pruned after 180 days.

Only `active` events reach Sentinel, Client 360's _Marknadspåverkan_ list
and the dashboard. History is queryable through `marketEventsSince(ledger,
since)` and, per client, `marketChangesSince(ledger, facts, since)`: the
briefing's _Marknad sedan senaste mötet_ lists the client-relevant moves that
opened since the last meeting (or in a 30-day window without one) whether
open or closed, quoted at peak, each marked _räknas inte i prioriteringen_
when closed; Client 360 shows the closed ones of the last 30 days beneath
the active list. Closed events are judged against the record as it stands
today, the only exposure the record holds. Proven in
`marketToClient.test.ts` "active relevance and historical events" and
`marketHistory.test.ts` "active relevance versus historical events".

### Data quality

Every observation carries `observedAt`, `source` and a `quality` folded from
the envelope's freshness and the value's nature: _Aktuell_, _Fördröjd_,
_Officiell dagsnotering_, _Föråldrad_, _Exempeldata_. Every surface prints
_Observerad {time} · {source} · {quality}_ beside the move. Scenario moves
are always _Exempeldata_ from _Exempelscenario_, and the brief names the
scenario it was shaped by.

## 3. Client exposure

`exposureOf(facts)` reads what the record actually holds — never inferred
beyond the recorded holdings, loans and facts:

- asset-class shares, current and strategic, and the equity deviation in
  percentage points;
- sector, currency and region shares summed from the holdings;
- the largest single holding;
- loans with days to maturity; the nearest refinancing; variable-rate debt;
- concerns and the topics they speak to (`concernTopicsOf`: rates, equities,
  energy, fx, drawdown, fees — a Swedish lexicon, deterministic);
- a recorded behaviour of discomfort in drawdowns;
- the next meeting and its distance.

Exposure sizes at which a pathway counts (`EXPOSURE_THRESHOLDS`, percent of
the managed portfolio unless said): fixed income 15, equities 40, region 10,
sector 5, currency 10, deviation 5 pp, meeting within 14 days, refinancing
within 90 days, variable debt ≥ SEK 2m, risk-off equity share 60,
concentration 20.

## 4. Client relevance rules

Each reason is **direct** (a recorded holding is exposed) or **contextual**
(the record gives the move a reason to matter); the impact is labelled by
the stronger. Relevance is a bucket, never a percentage:

```
score = materiality × max(1, Σ direct points) + Σ context points
materiality = 1 (notable) | 2 (major)
relevance   = high ≥ 7 · medium ≥ 4 · low otherwise
```

| Reason                 | Kind       | Points                                  |
| ---------------------- | ---------- | --------------------------------------- |
| fixed-income-duration  | direct     | 1 / 2 (≥ 30 %) / 3 (≥ 50 %)             |
| equity-allocation      | direct     | 1 / 2 (≥ 55 %) / 3 (≥ 70 %)             |
| sector-holding         | direct     | 1 / 2 (≥ 10 %) / 3 (≥ 15 %)             |
| commodity-theme        | direct     | as sector-holding (energy only)         |
| currency-holding       | direct     | 1 / 2 (≥ 25 %) / 3 (≥ 40 %)             |
| related-concern        | contextual | 3 — the client raised the theme         |
| refinancing-approaching| contextual | 2 / 3 (≤ 30 days)                       |
| strategy-deviation     | contextual | 2                                       |
| drawdown-sensitivity   | contextual | 2 (down moves only)                     |
| variable-rate-debt     | contextual | 1                                       |
| meeting-approaching    | contextual | 1                                       |
| concentration          | contextual | 1                                       |

Pathways:

- **rates** — fixed income ≥ 15 % is direct. A refinancing within 90 days,
  else variable debt ≥ SEK 2m, is context — for Swedish and European yields
  only; the US curve carries no financing context for a SEK client. Rising
  yields with equities ≥ 5 pp over strategy add the deviation. A rates
  concern adds itself. A meeting within 14 days adds itself once anything
  else fired.
- **equities** — equities ≥ 40 % with ≥ 10 % in the index's region (or in
  global funds) is direct; Nikkei has no region and reaches every equity
  holder. Deviation, drawdown sensitivity (down only), an equities concern,
  a drawdown concern (down only), concentration ≥ 20 % (with equities ≥ 40 %),
  and the meeting are context.
- **sectors** — a holding in the sector ≥ 5 % is required; without it a
  concern is not an impact. An energy concern adds itself to the energy
  sector.
- **fx** — a holding in the base currency ≥ 10 % is required. Only pairs
  quoted in SEK carry a currency.
- **commodities** — energy only (Brent); an energy holding ≥ 5 % is required.
- **risk-appetite** — equities ≥ 60 % is direct; deviation, drawdown
  sensitivity and a drawdown concern are context.

No impact exists without a direct reason **or** a promise-grade context
(refinancing, concern, deviation, drawdown sensitivity, variable debt): a
meeting alone or a concentration alone never carries a move.

### Financial relevance and conversation relevance

Beside the combined `relevance` that ranks the client and reaches Sentinel,
every impact carries two verdicts that are never merged or relabelled:

```
financialScore    = materiality × Σ direct points + Σ financial-context points
                    financial context: refinancing, variable debt, strategy
                    deviation, concentration
conversationScore = materiality × Σ conversation-context points
                    conversation context: related concern, drawdown
                    sensitivity, meeting approaching
financialRelevance    = none (0) · low · medium (≥ 3) · high (≥ 6)
conversationRelevance = none (0) · low · medium (≥ 3) · high (≥ 5)
```

A client with 6 % in energy who has twice raised energy is _low_ financially
and _high_ in conversation; a client with 71 % in US equities who has said
nothing is _high_ financially and _none_ in conversation; a record whose
only reason is drawdown sensitivity is _none_ financially — context never
claims exposure. Surfaces print both beside the combined verdict
(_Finansiell relevans medel · samtalsrelevans hög_). Ranking behaviour is
unchanged.

Every impact keeps `sourceIds` — the holding, loan, fact and event ids the
reasons rest on — the event id and `method: 'market-to-client-v1'`.

### Explainability

Each impact renders the same five sections wherever it is read
(`ImpactExplanation`): **Marknadsfakta** (the move, its level, the threshold
it crossed, its freshness and source), **Klientexponering** (the direct
reasons, or the honest absence of one), **Klientkontext** (the contextual
reasons), **Tolkning** (typed _tolkning, inte fakta_; what the move means
for this record, never what to do), **Förbered inför kontakt** (what to take
into the conversation, closing with _beslutet är rådgivarens_), and the id
line. _Varför det är relevant_ compresses the reasons into one sentence,
and _klienten har själv tagit upp ämnet_ is flagged where a concern matches.
`explanationOf(impact)` returns the whole explanation as one typed object
(`ImpactExplanationModel`: headline, the three relevance verdicts, market
fact, freshness, the five sections, source ids) built from the impact's own
reasons — the surfaces render it, and a future "why is this move relevant
to Henrik?" answers from it without recomputing anything (TD-105).

## 5. Sentinel integration

Sentinel receives the client's impacts as a typed `market` driver — event,
move, relevance, directness, the impact's record ids — and never a second
inbox:

- **low** relevance never reaches Sentinel (it stays on the client page);
- **medium** is evidence beneath whatever anchors, weight 6;
- **high** is evidence, weight 12, and **strengthens** a _normal_ priority to
  _high_ (`strengthenedByMarket`; a _watch_ horizon becomes _upcoming_);
  _critical_ is never lifted, nothing lifts twice;
- **high** relevance **creates** a `market-impact` priority only when nothing
  else calls: a _major_ move ranks just below relationship risk (high,
  today); a _notable_ move ranks below every normal anchor and above the
  low ones (normal, upcoming).

One priority per client holds: two events are two drivers under one
priority, and an episode (§6a) adds none — Sentinel never sees episodes.
The fingerprint carries the event key, not its values, so a
dismissal holds while the episode lasts and lapses when it fades or expires;
`disposePriority` re-derives against the same market the brief saw, so a
market-created priority can be reviewed, snoozed or dismissed like any
other. Resolution is derived: when the move fades below `exit` or expires,
the driver disappears and the priority returns to what the record alone
says.

## 6a. Market episodes — the advisor-facing aggregation

Seven touching events in one broad selloff are one story to an advisor.
`groupMarketEpisodes(entries)` (`application/advisory/marketEpisodes.ts`)
groups the open events deterministically and exposes them as
`brief.episodes`. It is presentation/application aggregation only: every
`MarketEventEntry` stays intact inside exactly one episode, with its own
affected clients and source evidence, and Sentinel never sees an episode.

Grouping rules, in precedence; an event joins the first rule it matches and
a cluster forms only when the rule's condition holds, otherwise its members
fall through:

| Kind             | Members                                             | Forms when                                   |
| ---------------- | --------------------------------------------------- | -------------------------------------------- |
| global-risk-off  | the risk-appetite event + equity indices down       | a risk-off event and ≥ 1 index down          |
| equity-selloff   | equity indices down                                 | ≥ 2                                          |
| equity-rally     | equity indices up                                   | ≥ 2                                          |
| rates-up / down  | yields in one direction                             | ≥ 2, same direction                          |
| energy-selloff / rally | the energy sector (relative) and Brent, one direction | ≥ 2                                    |
| sek-weaker / stronger | SEK-quoted pairs, one direction                | ≥ 2                                          |
| single           | anything else, or a cluster that did not form       | always                                       |

A cluster holds only events whose `observedAt` lie within 24 hours of the
cluster's earliest (`EPISODE_WINDOW_HOURS`): a rates move from Monday and
one from Wednesday are two episodes. Direction never mixes. Sectors other
than energy, non-energy commodities and EUR/USD are never grouped — nothing
relates them beyond the calendar. No LLM, no clustering.

An episode carries the strongest severity among its events, every touched
client at the strongest relevance any event gave (financial and
conversation relevance likewise), `meaningful` (medium/high clients) and
`high`. Episodes sort by high count, then meaningful, then severity.

## 6. Surfaces

- **Dashboard.** A restrained _N klienter_ mark beside a market card, rate,
  FX/commodity row or sector bar — only when at least one client is
  meaningfully (medium/high) exposed — linking to the event on
  `/market-impact`. One _Marknadspåverkan · Market-to-Client_ module in the
  dashboard's own card and tile language, after the Sentinel module: at
  most three **episodes** that touch somebody (`dashboardEpisodes`), each
  with severity, headline (_Bred aktienedgång_, _Ränteuppgång på bred
  front_, or the single move), the underlying moves, freshness, _N berörda
  klienter · M hög relevans_, the names, the events on request, and _Varför
  det är relevant →_. A calm market, or a day whose moves reach nobody,
  earns no module and no mark.
- **`/market-impact`.** Counts (material moves, affected clients, high
  relevance, clients assessed); _Marknadsepisoder_ with each episode's
  events and clients (financial and conversation relevance beside the
  combined one); _Vilka klienter berörs?_ as a matrix of events × clients
  with relevance in each cell; then one panel per event
  with the market fact, its freshness, and each affected client's relevance,
  directness, _Varför det är relevant_, Sentinel standing (created /
  strengthened / carried as evidence / not reaching the priority) and the
  five-section explanation on request. An event nobody holds anything
  against is listed with its zero. Not a primary destination: the market
  screen links to it where a move touches somebody.
- **Client 360.** _Marknadspåverkan_ after the portfolio: the open moves this
  record is exposed to, most relevant first, each with both relevance
  verdicts and the explanation on request; beneath them _Tidigare rörelser ·
  senaste 30 dagarna_, the client-relevant moves that already closed, at
  peak, marked _räknas inte i prioriteringen_; an empty panel says so.
- **Meeting prep.** _Marknad sedan senaste mötet_: the client-relevant moves
  that opened since the last meeting (or in the 30-day window without one),
  open or closed, at peak, with relevance, the one-line why and the status —
  never the whole market.
- **Sentinel.** The market driver as a sentence under _Varför ser jag
  detta?_; _förstärkt av marknadsläget_ beside a lifted priority; a created
  priority titled _Marknadspåverkan: {move}_ with its own preparation.

## 7. Scenarios

The fixture market is calm (US 10Y 0 bp, S&P 500 +0.41 %), so nothing above
is visible on a clean checkout. `MARKET_TO_CLIENT_SCENARIO` (comma-separated)
reshapes the reported series for demonstration, stamped _Exempeldata_:
`rates-up`, `rates-major`, `equity-selloff`, `energy-down`, `usd-up`,
`gold-up`, `tech-up`, `risk-off`, `calm`.

What the seed shows on the frozen clock (2026-09-23), as tested in
`application/advisory/marketImpact.test.ts`:

| Scenario       | Outcome                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| calm           | no event, no client, Sentinel exactly as Client Intelligence left it; a context without a market source is complete                                                            |
| rates-up       | Dahlqvist **high** (fixed income 36 %, bridge loan in 45 days, their own concern, meeting in 3 days); Alvarsson medium; Ceder untouched; Dahlqvist's one critical priority carries the driver, no second priority |
| energy-down    | Alvarsson **high** on the sector (energy 12 %, his concern, meeting in 10 days — _klienten har själv tagit upp ämnet_) and medium on Brent; Ekstrand's 4 % is below the line; Client 360 and meeting prep show both |
| gold-up        | one material event, zero relevant clients, Sentinel unchanged                                                                                                                  |
| equity-selloff | Ekstrand — quiet until now — gets a market-created priority (high, today) he can dispose of; Berglund via drawdown sensitivity; Forsell (19 % equities) reached only as context |
| usd-up         | USD holders only, low or medium; Forsell (all SEK) untouched                                                                                                                   |
| risk-off       | Ceder direct (84 % equities), Berglund contextual (drawdown sensitivity), Grahn (58 %) untouched                                                                                |
| stability      | two reads keep one event per key with its first-seen time; when the move fades the events, the driver and the created priority are gone; a failing source leaves open events standing |

## 8. Known limitations

- **Coverage is the overview's.** Sectors are the S&P 500 sectors (US);
  there is no Swedish sector series, so a Swedish energy holding is judged
  against the US sector. FX carries a currency only for pairs quoted in SEK
  (USD/SEK today); EUR/USD opens events that reach nobody. Gold and
  non-energy commodities reach nobody by design (TD-108).
- **Thresholds are fixed constants**, not scaled to realised volatility; a
  10 bp day is material whether the curve has been calm or wild (TD-109).
- **The event ledger, history included, is per process** like the rest of
  the synthetic record (TD-104, TD-110): a restart forgets first-seen times
  and closed episodes, and the first read after it re-opens events on the
  enter line.
- **Closed events are judged against today's record.** History keeps the
  market facts, not a snapshot of the client's exposure at the time.
- **Episode rules are the known relationships only.** A sector other than
  energy, Gold, or EUR/USD never joins an episode; a regime the rules do not
  name shows as its single moves.
- **Relevance is exposure × recorded context.** A client whose exposure the
  record does not show (external holdings, unrecorded concerns) is invisible
  to the engine, by design.
- No notifications, no customer messaging, no trade recommendations, no
  scenario simulation, no LLM. _Fråga JARVIS_ does not yet answer "why is
  this move relevant" (TD-105).

## 9. Verification

`domain/advisory/marketToClient.test.ts` (materiality, hysteresis, dedupe,
expiry, null change, sector-relative, risk-off side, ordering; exposure;
every pathway with its near miss; gold; assessing one client; the policy
boundary; faded and expired history at peak, windows, retention, re-opened
keys, a closed event still assessable; financial versus conversation
relevance), `domain/advisory/sentinelMarket.test.ts` (created,
strengthened, never duplicated, critical never lifted, watch → upcoming,
two events one priority, fingerprint by key, lapses),
`application/advisory/marketImpact.test.ts` (the seven scenarios above,
Client 360, meeting prep, dispose, stability, a failing source),
`application/advisory/marketHistory.test.ts` (five events → one episode
with the events intact; unrelated moves apart and each event in exactly
one episode; global risk-off; the time window and direction; determinism;
the dashboard cap; an expired event queryable on Client 360 and in the
briefing while boosting nothing; a faded event at peak; the briefing
window; the relevance split on the seed; a large move nobody holds stays
silent; one priority per client under a five-event episode; a policy on
the context). Browser probes: `.probe/mtc-probe-a.mjs`,
`.probe/mtc-probe-b.mjs`.

## 10. Hardening pass (2026-09-29)

Directionally approved V1, one focused pass before the freeze: episodes
(§6a) and dashboard noise control (§6); active versus historical events
(§2); the financial/conversation split (§4); the materiality policy
boundary (§2); the typed explanation object (§4); and the tests above. No
new pathways, no redesign, no Meeting Cockpit.
