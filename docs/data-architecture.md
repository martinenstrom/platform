# Financial OS — data architecture

Status: **design contract. No production code has been changed.**

This document is the agreed architecture for replacing mocked Overview data with
real market data, structured so the same foundation carries the country,
portfolio and AI-agent experiences later.

**Governing principle: the application is designed around financial domain
models first, and data providers second.** The UI must never know whether a
value came from Avanza, Twelve Data, Finnhub, Polygon, a fixture, or a provider
that does not exist yet.

- **Part I — Audit** (§1–§3): what is mocked today, who consumes it, what
  providers exist. Reviewed and approved.
- **Part II — Architecture** (§4–§14): the domain-first design.
- **Part III — Execution** (§15–§17): migration sequence, open decisions, and
  the concrete plan for Architecture Phase A and Phase 0.

---

---

# Part I — Audit

## 1. Inventory of mocked data

The Overview **does not use the service layer that already exists.** There is a
working provider seam — `marketDataService` → `avanzaMcpAdapter` →
`createServerFn`, with a correct server/client split documented in
`avanzaMcp/serverFns.ts:1-16` — and `LightCommandCenter.tsx:46-57` bypasses it
entirely, importing mock modules directly. Closing that gap is Phase 0.

| #   | Value(s)                                                       | Where defined                                                | Kind                                                                                                           |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | OMXS30, S&P 500, Nasdaq 100, EUR/SEK, USD/SEK, BTC             | `src/data/mockData.ts:65-85` (`marketIndices`)               | static literals, `MOCK_NOW = 2025-03-14`                                                                       |
| 2   | DAX name/value/change (as **strings**: `'19 840'`, `'+0.32%'`) | `src/data/countryExplorer/germany.ts:294-308`                | static literals, re-parsed by `parseSignedPercent`                                                             |
| 3   | Nikkei 225 name/value/change                                   | `src/data/countryExplorer/japan.ts` (`markets`)              | static literals, same string round-trip                                                                        |
| 4   | FTSE 100 `8 363,95` / `+0.28%`                                 | `LightCommandCenter.tsx:165`                                 | inline literal                                                                                                 |
| 5   | EUR/USD, Brent, Gold, Bitcoin fallback                         | `LightCommandCenter.tsx:188-193`                             | inline literals                                                                                                |
| 6   | US 10Y yield                                                   | `src/data/countryExplorer/globalMarketOverview.ts:36-46`     | static literal (`'4.32%'`, change `+0.00 pp`)                                                                  |
| 7   | DE 10Y, US 2Y, SE 10Y                                          | `LightCommandCenter.tsx:207-209`                             | inline literals                                                                                                |
| 8   | 9 S&P sector day-moves                                         | `LightCommandCenter.tsx:214-224` (`SECTORS`)                 | inline literals                                                                                                |
| 9   | Risk sentiment gauge (`position: 72`, `risk-on`)               | `globalMarketOverview.ts:64-67`                              | inline literal, self-documented as "not a computed signal"                                                     |
| 10  | News feed (4 items)                                            | `src/data/countryExplorer/index.ts:44` (`getGlobalNewsFeed`) | hand-written fixtures from 4 country files, timestamps relative to `COUNTRY_MOCK_NOW = 2026-07-22T16:24+02:00` |
| 11  | Every market-card sparkline                                    | `LightCommandCenter.tsx:109` (`seededSeries`) → `:149`       | **mulberry32 PRNG random walk**                                                                                |
| 12  | Entire intraday chart, all 4 series × all 6 ranges             | `LightCommandCenter.tsx:239` (`buildIntraday`)               | **PRNG random walk**                                                                                           |
| 13  | Yield-curve sparkline (`RATE_CURVE`)                           | `LightCommandCenter.tsx:257`                                 | **PRNG noise — not a curve**                                                                                   |
| 14  | Watchlist tiles (6 names, prices, sparks)                      | `src/data/mockData.ts:123-190`                               | static literals                                                                                                |
| 15  | "Data uppdaterad HH:MM"                                        | `LightCommandCenter.tsx:955-963`                             | **`new Date()` at render — reports render time, not data time**                                                |
| 16  | Greeting name "Anders"                                         | `LightCommandCenter.tsx:371`                                 | inline literal (user profile, not market data)                                                                 |

### Genuinely real today — keep

- `MARKET_CENTERS` + `getMarketStatus` (`marketCenters.ts`) — a pure function of
  the real clock against published exchange session hours. Not fetched, but not
  fake. Gap: no holiday calendar, so an exchange holiday reads as CLOSED.
- `useClock()` — real wall clock, correctly hydration-guarded via `mounted`.

### Defects (scheduled in §15, not hidden behind the new abstraction)

| ID     | Defect                                                                                                                                           | Fixed in                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **D1** | `indexQuote('bitcoin')` never matches — mock id is `'btc'` (`mockData.ts:78`), so `:191` always falls through to a hardcoded literal. Dead code. | Phase 0                                             |
| **D2** | Financial values stored and parsed as localized strings (`'19 840'` → `parseSignedPercent`).                                                     | Phase 0 (domain), Phase 5 (source)                  |
| **D3** | Frozen clocks `MOCK_NOW` (2025-03-14) and `COUNTRY_MOCK_NOW` (2026-07-22) leak into rendered output.                                             | Phase 0                                             |
| **D4** | Intraday x-axis is always 09:00–17:00 regardless of range — `1M`/`YTD` show one day's hour labels.                                               | Phase 6                                             |
| **D5** | "Data uppdaterad" prints render time, not data time. The one label a user would trust for freshness is fabricated.                               | Phase 0                                             |
| **D6** | `RATE_CURVE` is PRNG noise presented as a yield curve.                                                                                           | Phase 4 (replace); removed earlier if Phase 4 slips |

## 2. Components consuming each source

All within `LightCommandCenter.tsx` — the Overview is one file.

| Panel                    | Function                             | Consumes                      |
| ------------------------ | ------------------------------------ | ----------------------------- |
| "Marknadsöversikt" cards | `buildMarketCards()` `:143`          | #1, #2, #3, #4, #11           |
| "Aktuella marknader"     | `buildCurrentMarkets()` `:181`       | #1, #5                        |
| "Räntemarknaden"         | `buildRates()` `:198` + `RATE_CURVE` | #6, #7, #13                   |
| "Sektorer (S&P 500)"     | `SECTORS` `:214`                     | #8                            |
| "Sentiment"              | `GLOBAL_RISK_SENTIMENT` `:526`       | #9                            |
| "Senaste nytt"           | `getGlobalNewsFeed(4)` `:524`        | #10                           |
| "Utveckling idag"        | `buildIntraday(range)` `:525`        | #12                           |
| "Bevakning"              | `watchlist.slice(0,6)` `:911`        | #14                           |
| Bottom ticker rail       | `tickerItems` `:528`                 | derived from #1–#5            |
| Header status + clock    | `Header()` `:345`                    | real clock + `MARKET_CENTERS` |
| Globe                    | `LightGlobe`                         | locked, out of scope          |

Shared components that must not change visually: `Sparkline`, `ChartTooltip`,
`SectionCard`, `ChangeText`, recharts `LineChart`.

## 3. Provider landscape

Verified July 2026. Free-tier terms move — re-verify before committing spend.

| Category                                    | Recommendation                                                          | Free?            | Key limits                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| FX                                          | **Frankfurter**                                                         | ✅ permanent     | no key, no rate limit; ECB reference rates, published once daily ~16:00 CET |
| Government yields                           | **FRED** + **US Treasury**; **Riksbank** for SE; ECB Data Portal for EA | ✅ permanent     | FRED needs a free key; all EOD                                              |
| Crypto                                      | **CoinGecko Demo**                                                      | ✅ permanent     | 100 calls/min, 10 000 calls/month                                           |
| SE equities + OMXS30                        | **Avanza MCP** (already built)                                          | ✅ permanent     | unauthenticated public API, no key                                          |
| News                                        | **Marketaux**                                                           | ✅ at 15-min TTL | **100 requests/day**                                                        |
| Foreign indices, commodities, VIX, intraday | **Twelve Data Grow**                                                    | ❌ ~$29/mo       | free tier excludes indices; 800 calls/day, 8/min                            |
| Sentiment                                   | derived in-house                                                        | ✅               | no credible free risk-on/off feed exists                                    |

Rejected: Alpha Vantage (25 calls/**day** — too small for a 6-tile grid),
Polygon.io (no free tier; revisit only if this goes commercial), NewsAPI.org
($449/mo), API Ninjas commodities (7 rotating commodities/week — unusable for a
fixed panel), GDELT (free but needs heavy filtering).

**The refresh cadence in §12 is quota arithmetic, not taste.** Twelve Data bills
per symbol: 6 index tiles at 60 s = 8 640 calls/day against an 800/day cap, 11×
over; at a 15-min TTL over an 8 h session it is ~192/day and fits. Marketaux at
100/day dies by mid-afternoon on a 5-min TTL; 15 min gives ~40/day.

---

---

# Part II — Architecture

## 4. Layering and dependency direction

Four layers, with dependencies pointing **inward only**. The domain knows
nothing about anything else.

```mermaid
flowchart TD
    P["<b>Presentation</b><br/>src/components, src/routes<br/>React · view models · sv-SE formatting"]
    A["<b>Application</b><br/>src/application/marketData<br/>use cases · ports · policy · registry"]
    D["<b>Domain</b><br/>src/domain/market<br/>models · pure rules · no I/O"]
    I["<b>Infrastructure</b><br/>src/infrastructure/marketData<br/>adapters · cache · resilience · config"]
    X["External APIs<br/>Avanza · Frankfurter · FRED · CoinGecko · …"]

    P -->|"use cases + domain types"| A
    A -->|"models"| D
    I -->|"models"| D
    I -.->|"implements ports"| A
    I --> X
```

Rules, enforced by the boundary test in §13:

1. `domain/` imports nothing outside `domain/`. No React, no `fetch`, no
   `process.env`, no formatting, no locale.
2. `application/` imports `domain/` and its own **ports** (interfaces). It never
   imports a concrete provider, an HTTP client, or `infrastructure/`.
3. `infrastructure/` imports `domain/` and implements `application/` ports.
   Provider-specific response types never escape their adapter file.
4. `presentation/` imports `application/` use cases and `domain/` types. It
   never imports `infrastructure/`.
5. The **composition root** — `infrastructure/marketData/serverFns.ts` — is the
   single place where concrete providers are wired to ports, and the single
   client-reachable surface.

### Proposed directory layout

Files marked ✅ shipped in Architecture Phase A.

```
src/
  domain/shared/
    clock.ts           ✅ Clock, SystemClock, FakeClock — time is injected, never read

  domain/market/
    primitives.ts      ✅ Percent, BasisPoints, Price, YieldPercent, Money, IsoCurrencyCode
    provenance.ts      ✅ Unit, Quality, DataSourceMetadata, Provenance, Envelope, DomainError
    instruments.ts     ✅ CanonicalSymbol, InstrumentRef and its kinds (identity)
    symbols.ts         ✅ canonical instrument catalog (single source of identity)
    observations.ts    ✅ MarketQuote, MarketSeries
    rates.ts           ✅ GovernmentYield, YieldCurve
    news.ts            ✅ NewsItem
    sentiment.ts       ✅ MarketSentiment, SentimentOrigin + derivation rules
    events.ts          ✅ domain event contracts (definitions only — no bus)
    index.ts           ✅ public barrel

  application/marketData/
    ports.ts           ✅ QuoteProvider, SeriesProvider, FxProvider, …
    policy.ts          ✅ per-category TTL, FallbackPolicy, staleness limits
    providerRegistry.ts ✅ capability -> ordered chain resolution
    getOverviewSnapshot.ts   (Phase 0)
    getQuotes.ts  getYieldSnapshot.ts  getNews.ts  calculateSentiment.ts   (Phase 0+)

  infrastructure/marketData/
    config.ts          ✅ env schema, validation, live-readiness check
    container.ts       ✅ composition root factory
    keys.ts            ✅ normalized cache-key construction
    cache/store.ts     ✅ CacheStore interface + MemoryCacheStore
    cache/             disk.ts  singleFlight.ts                            (Phase 1)
    resilience/        tokenBucket.ts  circuitBreaker.ts  retry.ts  timeout.ts  (Phase 1)
    providers/         avanza · frankfurter · fred · treasury · riksbank ·
                       coingecko · twelveData · marketaux · fixture        (Phase 0+)
      __fixtures__/    recorded provider payloads for contract tests
    serverFns.ts       ← only client-reachable module                      (Phase 0)

  presentation/marketData/
    viewModels.ts      domain -> sv-SE display strings (the ONLY formatter) (Phase 0)

  test/
    importGraph.test.ts ✅ T3 + T4 + T16 architectural fitness tests
```

### Value objects (Phase A addition)

Financial primitives are **branded numbers with smart constructors**, not
wrapper classes. A wrapper (`new Percent(0.32)`) buys the same compile-time
safety at three runtime costs this app should not pay: it allocates on every
quote, it does not survive `JSON.stringify` across the `createServerFn`
boundary without a bespoke revive step, and it forces `.value` unwrapping at
every arithmetic site. A brand is erased at compile time — the runtime
representation is a plain `number`, so a snapshot serializes and revives with
no custom logic, while the type system still refuses to assign basis points to
a percent.

`Money` is the exception: its purpose is to bind an amount to a currency, which
a brand on `number` cannot express, so it is a plain data interface (still
JSON-safe, no methods) with pure helpers. `addMoney` refuses to mix currencies —
there is no implicit FX conversion anywhere in the domain, because converting
needs a rate and a timestamp and must not hide inside an operator.

`Yield` from the requested list is served by `YieldPercent` plus the existing
`GovernmentYield` model; a separate value object would have duplicated it.

### Clock (Phase A addition)

No code below the presentation layer calls `Date.now()` or `new Date()`. Time is
an input, injected via `Clock` (`domain/shared/clock.ts`) and carried on
`FetchContext`. `SystemClock` is the single sanctioned caller of `Date.now()`,
enforced by the T3 fitness test. `FakeClock` makes TTL expiry, staleness
thresholds, rate-limit windows, breaker cooldowns and budget resets testable
without sleeping — and is what will let the Phase 0 fixture provider be
provably deterministic (gate G4).

### Domain events (Phase A addition)

`domain/market/events.ts` defines `MarketQuoteUpdated`, `MarketSeriesUpdated`,
`GovernmentYieldUpdated`, `NewsItemReceived`, `SentimentUpdated` and
`OverviewSnapshotUpdated` as a discriminated union, plus a `DomainEventHandler`
signature. **There is no bus, and nothing publishes or consumes them** — by
design. They exist so the AI-agent and event-driven work later starts from
agreed, versioned shapes rather than inventing them at the first call site.
Conventions recorded for whoever wires the bus: events carry domain models
never provider payloads, they are immutable and past-tense, `occurredAt` is
distinct from the payload's own `asOf`, and `eventVersion` is per event type so
one payload can evolve without a global migration.

### Relationship to the existing seam (§8 of the brief)

The existing architecture is kept and evolved, not discarded:

| Existing                                                                       | Disposition                                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `services/avanzaMcp/client.ts` (MCP stdio transport, single-flight connection) | **Keep verbatim.** Becomes the transport used by `providers/avanza.ts`.                                                       |
| `services/avanzaMcp/mappers.ts`                                                | **Keep, retarget.** Maps to domain models instead of `~/types`.                                                               |
| `services/avanzaMcp/serverFns.ts`                                              | **Keep** while other routes depend on it; the new composition root supersedes it for the Overview.                            |
| `services/marketDataService.ts` + `avanzaMcpAdapter.ts`                        | **Keep running** for `/portfolio`, `/watchlist`, `/markets`, `/agents`. Migrating those routes is out of scope for this plan. |
| `src/types/index.ts`                                                           | Stays as the legacy contract for unmigrated routes. New domain models live in `domain/market/`; no big-bang rename.           |

The `createServerFn` + dynamic-`import()` guard pattern documented in
`avanzaMcp/serverFns.ts:11-15` is the precedent the whole infrastructure layer
follows.

## 5. Domain model

### Identity vs observation

The brief lists the models flat. The one structural refinement I would make:
separate **instrument identity** (what a thing _is_ — stable reference data)
from **observations** (what it _did_ at a point in time). Without that split,
`MarketIndex` and `MarketQuote` overlap and every model re-declares
name/currency/precision.

```mermaid
classDiagram
    class InstrumentRef {
        +CanonicalSymbol symbol
        +InstrumentKind kind
        +string displayName
        +IsoCurrencyCode? currency
        +Unit unit
        +int precision
    }
    class EquityIndex { +string? countryCode  +string? exchangeMic }
    class FxPair { +IsoCurrencyCode base  +IsoCurrencyCode quote }
    class Commodity { +CommodityClass class  +Unit unit }
    class CryptoAsset { +string assetId  +IsoCurrencyCode quoteCurrency }
    class Equity { +string ticker  +string exchangeMic  +string? isin }
    class GovernmentBond { +string countryCode  +int tenorMonths }

    InstrumentRef <|-- EquityIndex
    InstrumentRef <|-- FxPair
    InstrumentRef <|-- Commodity
    InstrumentRef <|-- CryptoAsset
    InstrumentRef <|-- Equity
    InstrumentRef <|-- GovernmentBond

    class MarketQuote {
        +CanonicalSymbol symbol
        +number value
        +number? previousClose
        +number? absoluteChange
        +number? percentageChange
        +number? dayHigh
        +number? dayLow
        +SessionState session
        +string asOf
    }
    class MarketSeries {
        +CanonicalSymbol symbol
        +SeriesInterval interval
        +SeriesPoint[] points
        +string asOf
    }
    class GovernmentYield {
        +string countryCode
        +int tenorMonths
        +number yieldPercent
        +number? changeBasisPoints
        +string asOf
    }
    class YieldCurve {
        +string countryCode
        +GovernmentYield[] points
        +string asOf
    }
    class NewsItem {
        +string id
        +string headline
        +string? summary
        +string? url
        +string outlet
        +string publishedAt
        +CanonicalSymbol[] symbols
        +number? sentimentScore
    }
    class MarketSentiment {
        +number score
        +SentimentLabel label
        +SentimentComponent[] components
        +string formulaVersion
        +string asOf
    }
    class DataSourceMetadata {
        +string providerId
        +string providerName
        +string? attributionUrl
        +string? licenseNote
    }

    MarketQuote --> InstrumentRef : describes
    MarketSeries --> InstrumentRef : describes
    YieldCurve *-- GovernmentYield
    MarketSentiment --> DataSourceMetadata
    MarketQuote --> DataSourceMetadata
```

### Coverage of the requested model list

| Requested model       | Disposition                                                                                                                                                    | Where             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `MarketQuote`         | **Build now**                                                                                                                                                  | `observations.ts` |
| `MarketSeries`        | **Build now**                                                                                                                                                  | `observations.ts` |
| `MarketIndex`         | **Build now** as `InstrumentRef` kind `'equity-index'`                                                                                                         | `instruments.ts`  |
| `FXPair`              | **Build now** as `InstrumentRef` kind `'fx-pair'`                                                                                                              | `instruments.ts`  |
| `GovernmentYield`     | **Build now**                                                                                                                                                  | `rates.ts`        |
| `YieldCurve`          | **Build now** (needed to retire D6)                                                                                                                            | `rates.ts`        |
| `Commodity`           | **Build now** as `InstrumentRef` kind `'commodity'`                                                                                                            | `instruments.ts`  |
| `CryptoAsset`         | **Build now** as `InstrumentRef` kind `'crypto'`                                                                                                               | `instruments.ts`  |
| `NewsItem`            | **Build now**                                                                                                                                                  | `news.ts`         |
| `MarketSentiment`     | **Build now**                                                                                                                                                  | `sentiment.ts`    |
| `DataSourceMetadata`  | **Build now**                                                                                                                                                  | `provenance.ts`   |
| `EconomicIndicator`   | **Defer** — no Overview consumer. Intended for the country experience; `globalIndicators.ts` and `globalHeadlineMacro.ts` are the future migration targets.    | documented only   |
| `CountryMacro`        | **Defer** — `types/countryExplorer.ts:CountryMacroData` already serves the country modal. Reconcile when the country experience migrates.                      | documented only   |
| `MarketRegime`        | **Defer** — a derived classification (risk-on/off + volatility + rate direction) over `MarketSentiment` plus trend. No consumer until the AI-agent experience. | documented only   |
| `PortfolioHolding`    | **Defer** — `types/index.ts:Holding` serves `/portfolio` today. Migrate with that route.                                                                       | documented only   |
| `PortfolioAllocation` | **Defer** — `types/index.ts:AllocationSlice` serves `/portfolio` today.                                                                                        | documented only   |

Eleven models built now, five documented as intended extensions. No empty
abstractions.

## 6. Normalized model definitions

`src/domain/market/` — numeric, unit-explicit, locale-free, provider-free.

```ts
/* ---------------------------------------------------------- provenance.ts */

/** ISO 4217. Null where the concept does not apply (an index level, a yield). */
export type IsoCurrencyCode = string & { readonly __iso4217: unique symbol }

/** Explicit unit of the numeric value. Never inferred from the symbol. */
export type Unit =
  | { kind: 'index-points' }
  | { kind: 'currency'; currency: IsoCurrencyCode }
  | { kind: 'fx-rate'; base: IsoCurrencyCode; quote: IsoCurrencyCode }
  | { kind: 'percent' }
  | { kind: 'basis-points' }
  | {
      kind: 'per-physical'
      currency: IsoCurrencyCode
      measure: 'bbl' | 'troy_oz' | 'mt' | 'mmbtu'
    }

/**
 * How the value relates to the real market. Primary classification, and
 * orthogonal to Envelope state: `quality` describes the NATURE of the value,
 * `state` describes its FRESHNESS. A derived value computed from stale inputs
 * is `quality: 'derived'` in `state: 'stale'` — both facts are preserved.
 */
export type Quality = 'realtime' | 'delayed' | 'eod' | 'derived' | 'fixture'

export interface DataSourceMetadata {
  providerId: string // 'frankfurter' | 'fred' | 'avanza' | 'fixture' | …
  providerName: string // human-readable, for attribution
  attributionUrl?: string // some free tiers require visible attribution
  licenseNote?: string
}

/** Provenance travelling with every resolved value. */
export interface Provenance {
  /** When the provider observed the value. */
  asOf: string // ISO 8601 with offset
  /** When we retrieved it. */
  receivedAt: string // ISO 8601 with offset
  /** now - asOf at resolution time. */
  ageMs: number
  source: DataSourceMetadata
  quality: Quality
  isDelayed: boolean
  /** Known provider delay; null when unquantified. */
  delayMinutes: number | null
  /** True when this instrument stands in for the requested one (ETF for index). */
  isProxy: boolean
  /** Required when isProxy — what was substituted, for the UI to disclose. */
  proxyNote?: string
}

/* ---------------------------------------------------------- instruments.ts */

/** Namespaced canonical id. The ONE identity used across the whole system. */
export type CanonicalSymbol = string & { readonly __canonical: unique symbol }
// 'idx:sp500'  'fx:eurusd'  'rate:us10y'  'cmd:brent'  'crypto:btc'  'eq:xsto:INVE-B'

export type InstrumentKind =
  'equity-index' | 'fx-pair' | 'commodity' | 'crypto' | 'equity' | 'government-bond'

export interface InstrumentRefBase {
  symbol: CanonicalSymbol
  kind: InstrumentKind
  /** Locale-neutral canonical name ('S&P 500'). NOT a localized display string. */
  displayName: string
  currency: IsoCurrencyCode | null
  unit: Unit
  /** Decimals for presentation. Reference data, not formatting — 4 for FX, 0 for BTC. */
  precision: number
}

export type InstrumentRef =
  | (InstrumentRefBase & {
      kind: 'equity-index'
      countryCode?: string
      exchangeMic?: string
    })
  | (InstrumentRefBase & {
      kind: 'fx-pair'
      base: IsoCurrencyCode
      quote: IsoCurrencyCode
    })
  | (InstrumentRefBase & {
      kind: 'commodity'
      commodityClass: 'energy' | 'metal' | 'agri'
    })
  | (InstrumentRefBase & {
      kind: 'crypto'
      assetId: string
      quoteCurrency: IsoCurrencyCode
    })
  | (InstrumentRefBase & {
      kind: 'equity'
      ticker: string
      exchangeMic: string
      isin?: string
    })
  | (InstrumentRefBase & {
      kind: 'government-bond'
      countryCode: string
      tenorMonths: number
    })

/* --------------------------------------------------------- observations.ts */

export type SessionState = 'open' | 'closed' | 'pre-market' | 'after-hours' | 'unknown'

export interface MarketQuote {
  symbol: CanonicalSymbol
  /** Current level or price, in `unit`. Numeric. Never a formatted string. */
  value: number
  /** Prior official close. Null when the provider does not supply one. */
  previousClose: number | null
  /** value - previousClose, in `unit`. Null when previousClose is null. */
  absoluteChange: number | null
  /** Percent, e.g. 0.32 means +0.32%. Null when it cannot be derived honestly. */
  percentageChange: number | null
  dayHigh: number | null
  dayLow: number | null
  session: SessionState
  provenance: Provenance
}

export type SeriesInterval = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1mo'

export interface SeriesPoint {
  t: string // ISO 8601 with offset
  v: number // absolute value in the instrument's unit
}

export interface MarketSeries {
  symbol: CanonicalSymbol
  interval: SeriesInterval
  /** Absolute values. Percent-rebasing for a comparison chart is presentation. */
  points: SeriesPoint[]
  provenance: Provenance
}

/* ----------------------------------------------------------------- rates.ts */

export interface GovernmentYield {
  symbol: CanonicalSymbol
  countryCode: string // ISO 3166-1 alpha-2
  tenorMonths: number // 24 = 2Y, 120 = 10Y
  /** Percent per annum, e.g. 4.32. Unit is always { kind: 'percent' }. */
  yieldPercent: number
  /** Change in basis points — the market's unit for rates, never percent. */
  changeBasisPoints: number | null
  provenance: Provenance
}

export interface YieldCurve {
  countryCode: string
  /** Ascending by tenorMonths. A real curve, replacing the PRNG sparkline (D6). */
  points: GovernmentYield[]
  provenance: Provenance
}

/* ------------------------------------------------------------------ news.ts */

export interface NewsItem {
  id: string
  headline: string
  summary: string | null
  url: string | null
  outlet: string
  publishedAt: string // ISO 8601 with offset
  symbols: CanonicalSymbol[]
  /** -1..1. Null when the provider gives none — never fabricated. */
  sentimentScore: number | null
  provenance: Provenance
}

/* ------------------------------------------------------------- sentiment.ts */

export type SentimentLabel = 'risk-off' | 'neutral' | 'risk-on'

/**
 * Three distinct things that must never share one quality label (D2).
 * - 'derived'  — computed in-house from real or explicitly stale market inputs.
 *                Permitted in production; provenance and methodology preserved.
 * - 'provider' — a vendor's own sentiment figure. Quality is theirs
 *                ('realtime' | 'delayed'), not 'derived'.
 * - 'fixture'  — invented. Non-production only.
 */
export type SentimentOrigin = 'derived' | 'provider' | 'fixture'

export interface SentimentComponent {
  id: string // 'vix' | 'us10y-change' | 'dxy-change' | 'btc-24h'
  label: string
  /** Signed contribution to `score`. Components must sum to score - baseline. */
  contribution: number
  /** The domain value the contribution was computed from, for explainability. */
  inputValue: number
  /** When THAT input was observed. A derived score is only as fresh as this. */
  inputAsOf: string // ISO 8601 with offset
  /** Quality of the input itself — a derived score over fixture inputs is a fixture. */
  inputQuality: Quality
}

export interface MarketSentiment {
  /** 0..100, higher = more risk-on. Feeds the gauge position directly. */
  score: number
  label: SentimentLabel
  origin: SentimentOrigin
  components: SentimentComponent[]
  /** Methodology version. Bumped whenever weights change, so historical
   *  scores stay interpretable. Required for `origin: 'derived'`. */
  formulaVersion: string // 'v1'
  provenance: Provenance
}
```

**Derivation rules for sentiment**, enforced in `calculateSentiment`:

1. `provenance.asOf` = the **oldest** `inputAsOf` across components. A derived
   score is never fresher than its stalest input.
2. `provenance.quality` = `'derived'` — _unless_ any component has
   `inputQuality: 'fixture'`, in which case the whole score degrades to
   `'fixture'` and inherits the non-production policy. Deriving from invented
   inputs produces an invented output; the type system should not let that be
   laundered into a production-eligible value.
3. Envelope `state` reflects input freshness independently: real-but-stale
   inputs give `state: 'stale'`, `quality: 'derived'` — permitted in production
   with its `staleReason` and input timestamps intact.
4. `formulaVersion` is required whenever `origin === 'derived'`.

Deliberate exclusions from the domain layer: no `formatNumber` output, no
`sv-SE` strings, no `'+0.32%'`, no colour, no precision-as-formatting, no
recharts shapes. All of that is §11.

## 7. Envelope state model

```ts
/* ---------------------------------------------------------- provenance.ts */

export type StaleReason =
  | 'provider-error'
  | 'rate-limited'
  | 'budget-exhausted'
  | 'circuit-open'
  | 'timeout'
  | 'offline'
  | 'no-fresh-source'

export type ErrorCode =
  | 'network'
  | 'auth'
  | 'rate-limit'
  | 'schema'
  | 'not-found'
  | 'timeout'
  | 'circuit-open'
  | 'budget-exhausted'
  | 'no-provider-configured'
  | 'fallback-disallowed'
  | 'unknown'

export interface DomainError {
  code: ErrorCode
  /** Safe to log and display. Never contains an API key or raw provider body. */
  message: string
  providerId: string | null
  retryable: boolean
  retryAfterMs?: number
}

export type Envelope<T> =
  | { state: 'loading' }
  | { state: 'ok'; data: T; provenance: Provenance }
  | { state: 'stale'; data: T; provenance: Provenance; staleReason: StaleReason }
  | { state: 'fixture'; data: T; provenance: Provenance; reason: string }
  | {
      state: 'error'
      error: DomainError
      /**
       * Last known good value, when one exists. Present so a caller CAN choose
       * to show it — but `state` stays 'error', so nothing renders it as live
       * by accident.
       */
      lastGood?: { data: T; provenance: Provenance }
    }
```

`ageMs`, `asOf`, `receivedAt`, `source`, `quality`, `isDelayed` and `isProxy`
live on `Provenance` (§6) rather than being duplicated per state — one shape,
always present on any state that carries data.

### Error is a real state

Correcting the earlier proposal: **fixture fallback does not make `error`
unreachable.** Whether a fixture may stand in is a per-category policy decision,
because for some data showing a plausible-looking number is worse than showing
nothing.

```ts
/* --------------------------------------------- application/marketData/policy.ts */

export interface FallbackPolicy {
  /** Serve a cached value past its TTL. */
  allowStale: boolean
  /** Hard ceiling; beyond this the value is discarded rather than shown. */
  maxStaleMs: number
  /** When a fixture may substitute for a live value. */
  allowFixture: 'never' | 'non-production' | 'always'
  /** Whether a labelled proxy instrument may substitute (ETF for index). */
  allowProxy: boolean
}
```

**Approved 2026-07-26 (D2).** Every category is `non-production` — there is no
category in which a fabricated value may be shown to a production user.

| Category        | `allowStale` | `maxStaleMs` | `allowFixture`   | `allowProxy`                   | Why                                                                                                                           |
| --------------- | ------------ | ------------ | ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Equity indices  | yes          | 4 h          | `non-production` | **requires approval** (§17 D1) | a stale index level is informative; a fabricated one is not                                                                   |
| FX              | yes          | 48 h         | `non-production` | no                             | ECB rates are daily; a 1-day-old rate is legitimate                                                                           |
| Yields          | yes          | 5 d          | `non-production` | no                             | EOD series; weekends are normal                                                                                               |
| Commodities     | yes          | 8 h          | `non-production` | no                             |                                                                                                                               |
| Crypto          | yes          | 2 h          | `non-production` | no                             | 24/7 market, staleness is meaningful                                                                                          |
| News            | yes          | 24 h         | `non-production` | n/a                            | **plausible fabricated headlines are the worst failure mode on the screen** — a labelled unavailable state is strictly better |
| Sentiment       | yes          | 6 h          | `non-production` | n/a                            | fixture sentiment only; **derived sentiment is not a fixture** — see below                                                    |
| Intraday series | yes          | 4 h          | `non-production` | inherits index policy          |                                                                                                                               |
| Watchlist       | yes          | 4 h          | `non-production` | no                             |                                                                                                                               |

Sentiment is the one category where the distinction matters most, so it is
spelled out (D2):

| Origin                                 | `quality`                                | Production?                                   |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| **Derived** from real inputs           | `derived`                                | ✅ yes, with provenance + `formulaVersion`    |
| **Derived** from real but stale inputs | `derived`, `state: 'stale'`              | ✅ yes, with `staleReason` + input timestamps |
| **Derived** from fixture inputs        | `fixture` (degraded, see §6 rule 2)      | ❌ no                                         |
| **Provider-supplied**                  | `realtime` / `delayed` — _not_ `derived` | ✅ yes                                        |
| **Fixture**                            | `fixture`                                | ❌ no                                         |

When policy forbids the only available fallback, the result is
`{ state:'error', code:'fallback-disallowed' }`, optionally carrying `lastGood`
with full provenance — a genuine error or an explicitly-old value, never a
convincing lie. In `MARKETDATA_MODE=fixture` (dev, CI, demo) `allowFixture` is
treated as `always` for every category, which is what keeps Phase 0 and Phase 1
fully functional with no network and no keys.

### Live-readiness check

A consequence of "every category is `non-production`": in
`MARKETDATA_MODE=live`, any category whose chain is still fixture-only produces
an error state rather than content. That is correct behaviour, but it must not
be discovered in production. `config.ts` therefore performs a **startup
live-readiness check**: when `MARKETDATA_MODE=live`, any category whose
configured chain contains no provider other than `fixture` is logged as a
startup error naming the category. Phases 2–9 each clear one such warning.

## 8. Capability-based provider interfaces (ports)

Small interfaces, one per capability. A provider implements only what it can do.

```ts
/* ---------------------------------------- application/marketData/ports.ts */

export type Capability =
  'quotes' | 'series' | 'fx' | 'yields' | 'commodities' | 'crypto' | 'news' | 'sentiment'

/** Common to every port. `id` is what appears in DataSourceMetadata. */
export interface ProviderIdentity {
  readonly id: string
  readonly name: string
  readonly attributionUrl?: string
}

export interface QuoteProvider extends ProviderIdentity {
  fetchQuotes(symbols: CanonicalSymbol[], ctx: FetchContext): Promise<MarketQuote[]>
}

export interface SeriesProvider extends ProviderIdentity {
  fetchSeries(
    symbol: CanonicalSymbol,
    interval: SeriesInterval,
    range: { from: string; to: string },
    ctx: FetchContext,
  ): Promise<MarketSeries>
}

export interface FxProvider extends ProviderIdentity {
  fetchFxRates(pairs: CanonicalSymbol[], ctx: FetchContext): Promise<MarketQuote[]>
}

export interface YieldProvider extends ProviderIdentity {
  fetchYields(symbols: CanonicalSymbol[], ctx: FetchContext): Promise<GovernmentYield[]>
  fetchYieldCurve?(countryCode: string, ctx: FetchContext): Promise<YieldCurve>
}

export interface CommodityProvider extends ProviderIdentity {
  fetchCommodities(symbols: CanonicalSymbol[], ctx: FetchContext): Promise<MarketQuote[]>
}

export interface CryptoProvider extends ProviderIdentity {
  fetchCrypto(symbols: CanonicalSymbol[], ctx: FetchContext): Promise<MarketQuote[]>
}

export interface NewsProvider extends ProviderIdentity {
  fetchNews(query: NewsQuery, ctx: FetchContext): Promise<NewsItem[]>
}

export interface SentimentProvider extends ProviderIdentity {
  fetchSentiment(ctx: FetchContext): Promise<MarketSentiment>
}

/** Passed by the registry; carries cancellation and the resolution clock. */
export interface FetchContext {
  signal: AbortSignal
  /** Injected, never `Date.now()` inside an adapter — makes tests deterministic. */
  now: () => Date
}
```

Adapter contract, non-negotiable:

- An adapter **fetches, validates, and normalizes**. Nothing else. No caching,
  no retrying, no fallback, no rate limiting — those are cross-cutting and live
  in the registry (§9).
- Provider response types are **declared inside the adapter file and never
  exported**. If a provider type is importable from outside, that is a bug the
  boundary test (§13) fails on.
- Validation at the boundary: an unexpected payload throws a `DomainError` with
  `code:'schema'`. A `NaN` must never reach a component.
- `provenance.quality` and `isDelayed` are set by the adapter, which is the only
  code that knows the provider's delay characteristics.

### Provider → capability matrix

| Provider                   | quotes | series   | fx  | yields     | commodities | crypto | news | sentiment                 |
| -------------------------- | ------ | -------- | --- | ---------- | ----------- | ------ | ---- | ------------------------- |
| `AvanzaProvider`           | ✅ SE  | ✅ SE    | —   | —          | —           | —      | —    | —                         |
| `FrankfurterProvider`      | —      | ✅ daily | ✅  | —          | —           | —      | —    | —                         |
| `FredProvider`             | —      | ✅       | —   | ✅         | —           | —      | —    | —                         |
| `TreasuryProvider`         | —      | —        | —   | ✅ + curve | —           | —      | —    | —                         |
| `RiksbankProvider`         | —      | —        | —   | ✅ SE      | —           | —      | —    | —                         |
| `CoinGeckoProvider`        | —      | ✅       | —   | —          | —           | ✅     | —    | —                         |
| `TwelveDataProvider`       | ✅     | ✅       | ✅  | —          | ✅          | ✅     | —    | —                         |
| `MarketauxProvider`        | —      | —        | —   | —          | —           | —      | ✅   | —                         |
| `FixtureProvider`          | ✅     | ✅       | ✅  | ✅         | ✅          | ✅     | ✅   | ✅                        |
| `DerivedSentimentProvider` | —      | —        | —   | —          | —           | —      | —    | ✅ (composes other ports) |

## 9. Provider registry and dependency injection

A lightweight typed registry — **no DI framework**. The stack does not warrant
one, and a container that can be read in one sitting is worth more than
decorators.

```ts
/* ------------------------------ application/marketData/providerRegistry.ts */

export interface ProviderRegistry {
  /** Ordered chain for a capability, already filtered to healthy + in-budget. */
  chainFor<C extends Capability>(capability: C): ReadonlyArray<PortFor<C>>
}

export interface ResolveOptions<T> {
  capability: Capability
  cacheKey: string
  policy: FallbackPolicy
  ttlMs: number
  attempt: (provider: unknown) => Promise<T>
}

/** The one place retry, cache, limiter, breaker and fallback compose. */
export function resolve<T>(opts: ResolveOptions<T>): Promise<Envelope<T>>
```

Resolution order for one request:

```mermaid
flowchart TD
    S([request]) --> C{"fresh cache hit?"}
    C -->|yes| OK["Envelope: ok"]
    C -->|no| N{"next provider in chain?"}
    N -->|"none left"| ST{"stale cache within maxStaleMs<br/>and allowStale?"}
    N -->|yes| G{"circuit closed<br/>AND budget available<br/>AND rate token free?"}
    G -->|no| REC["record skip reason"] --> N
    G -->|yes| F["fetch → validate → normalize<br/>timeout + bounded retry"]
    F -->|success| W["write cache"] --> OK
    F -->|failure| REC2["record failure<br/>trip breaker if threshold"] --> N
    ST -->|yes| STALE["Envelope: stale<br/>+ staleReason"]
    ST -->|no| FX{"allowFixture permits<br/>in this mode?"}
    FX -->|yes| FIX["Envelope: fixture<br/>+ reason"]
    FX -->|no| ERR["Envelope: error<br/>code: fallback-disallowed"]
```

The composition root:

```ts
/* -------------------------------- infrastructure/marketData/container.ts */

export interface Container {
  registry: ProviderRegistry
  cache: Cache
  clock: () => Date
  logger: Logger
}

/**
 * Built once per server process from validated config. Tests call this with
 * stub providers, a fake clock and an in-memory cache — no env, no network.
 */
export function createContainer(overrides?: Partial<ContainerConfig>): Container
```

`presentation` and `application` receive a `Container`; neither ever names a
concrete provider. Swapping Frankfurter for Twelve Data is an env change, and
swapping either for a stub is a test argument.

## 10. Fallback chains by category

Configured per category, always terminating in `fixture`, always propagating the
true source, quality, staleness and proxy status.

| Category                  | Chain                                     | Notes                                                          |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| FX                        | `frankfurter` → `twelvedata`* → `fixture` | *only if the paid plan is approved                             |
| Swedish equities + OMXS30 | `avanza` → `fixture`                      | existing MCP seam                                              |
| Crypto                    | `coingecko` → `twelvedata`* → `fixture`   |                                                                |
| US yields                 | `treasury` → `fred` → `fixture`           | Treasury is authoritative and keyless; FRED covers history     |
| German yields             | `fred` → `ecb` → `fixture`                | ECB adapter deferred until needed                              |
| Swedish yields            | `riksbank` → `fixture`                    | needs a free key (§16 D6)                                      |
| International indices     | `twelvedata`* → `proxy-etf`† → `fixture`  | †**requires explicit approval and visible labelling** (§16 D1) |
| Commodities               | `twelvedata`* → `fixture`                 | no adequate free source (§3)                                   |
| News                      | `marketaux` → `fixture`                   | 15-min TTL is quota-mandated                                   |
| Sentiment                 | `derived` → `fixture`                     | derived composes yields/fx/crypto/VIX ports                    |

Propagation rules:

1. `provenance.source` always names the provider that actually produced the
   value — never the head of the chain.
2. Falling back sets `quality` accordingly (`fixture` for fixtures, unchanged
   otherwise) and, when serving past TTL, `state:'stale'` with a `staleReason`.
3. A proxy sets `isProxy: true` and **must** set `proxyNote`
   (e.g. `"SPY ETF as proxy for S&P 500"`). The presentation layer is required
   to disclose it — a proxy rendered as the index is a defect, not a style
   choice.
4. **Never present fixture, stale, delayed or proxied data as live.** This is
   the rule the §13 propagation tests exist to enforce.

## 11. Presentation boundary

The domain is numeric and locale-free; every localized string is produced in one
place.

```ts
/* -------------------------------- presentation/marketData/viewModels.ts */

export interface QuoteViewModel {
  label: string // localized display name
  value: string // '19 840,00' — sv-SE, unit-aware
  change: string // '+0,32 %'
  direction: 'up' | 'down' | 'flat'
  /** Localized freshness line — the source of truth for "Data uppdaterad". */
  freshness: string // '16:24' | 'Fördröjd 15 min' | 'Historisk (igår)'
  /** Set only when disclosure is required; the UI must render it. */
  disclosure: string | null // 'Proxy: SPY' | 'Exempeldata'
}

export function toQuoteViewModel(
  quote: MarketQuote,
  ref: InstrumentRef,
  envelope: Envelope<unknown>,
): QuoteViewModel
```

The existing `src/lib/format.ts` (`formatNumber`, `formatPercent`,
`formatRelativeTime`) stays as the formatting primitive; view models compose it.
Components keep receiving strings and rendering them exactly as today — which is
what makes the golden-render test in §13 pass.

## 12. Caching, resilience and budgets

### Cache

**Approved 2026-07-26 (D8).** One interface, three implementations, and
**production correctness must never depend on local disk.**

```ts
/* ------------------------------- infrastructure/marketData/cache/store.ts */

export interface CacheEntry<T> {
  value: T
  storedAt: string
  expiresAt: string
}

/** The only cache abstraction. Callers never know which store backs it. */
export interface CacheStore {
  readonly id: 'memory' | 'disk' | 'kv'
  /** True when the store is shared across instances. Drives the caveats below. */
  readonly isShared: boolean
  get<T>(key: string): Promise<CacheEntry<T> | null>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  /** Atomic counter — used by the daily budget. Correct only when isShared. */
  increment(key: string, by: number, resetAt: string): Promise<number>
}
```

| Store              | Status            | Use                                                                                                                                              |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MemoryCacheStore` | **now**           | L1, always present, per-process `Map` with per-entry expiry. Absorbs nearly all traffic; the SSR process is long-lived.                          |
| `DiskCacheStore`   | **now, optional** | L2 for local development and single-instance deployments. JSON under `MARKETDATA_CACHE_DIR` (gitignored). Enabled by `MARKETDATA_PERSIST_CACHE`. |
| `KvCacheStore`     | **later**         | Shared L2 for multi-instance or serverless. Same interface; no caller changes.                                                                   |

- **Layering** — `TieredCache` composes L1 over an optional L2. With no L2 the
  system is fully correct, only colder after a restart. Nothing in the resolve
  path branches on which store is present.
- **Single-flight** — concurrent identical keys share one in-flight promise.
  `avanzaMcp/client.ts:26-45` already uses this shape for its connection; the
  same pattern generalizes.
- **Stale-while-revalidate** — for categories where a slightly old value is
  fine (indices, crypto, commodities, news), serve the cached value immediately
  and refresh in the background. Not used for yields, where the EOD value is
  either current or it isn't.

#### Deployment caveat — read before scaling out

Local disk is **not a shared cache**. With `MemoryCacheStore` or
`DiskCacheStore`, three pieces of state are per-instance:

| State                    | Consequence with N instances                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Cached values            | N× cold misses; more upstream calls, but correct data                                                                      |
| **Daily request budget** | **N× quota consumption.** Each instance counts its own calls, so 3 instances against Marketaux's 100/day will attempt 300. |
| Circuit-breaker state    | A provider can be open on one instance and closed on another; failures are re-discovered per instance                      |

Only the budget is a correctness problem rather than an efficiency one.
Therefore: **a shared `CacheStore` (`KvCacheStore`) is a prerequisite for any
multi-instance or serverless deployment**, and `config.ts` logs a startup
warning when `MARKETDATA_MODE=live` is combined with a non-shared store
(`isShared === false`). Single-instance deployment — which is what this app is
today — is fully supported without it.

**Cache keys are normalized request identity, never component names:**

```
v1:quotes:idx:dax|idx:ftse|idx:sp500                  ← symbols sorted, pipe-joined
v1:series:idx:sp500:1h:2026-07-26T00:00Z/2026-07-26T17:00Z
v1:yields:rate:us10y|rate:us2y
v1:news:symbols=*:limit=4
```

`v1:` is a schema version prefix — bumping it invalidates every entry when a
domain model changes shape.

### Refresh intervals

Two cadences: a **server TTL** (how often we are willing to spend a call) and a
**client refresh** (how often the browser asks the server). Client refresh is
never shorter than the TTL.

| Category        | TTL (market open) | TTL (closed) | Client refresh  | Rationale                                                   |
| --------------- | ----------------- | ------------ | --------------- | ----------------------------------------------------------- |
| Equity indices  | 60 s              | 15 min       | 60 s            | free tiers are 15-min delayed anyway                        |
| FX              | 60 s              | 60 s         | 60 s            | Frankfurter is daily; TTL protects a future intraday source |
| Bond yields     | 12 h              | 12 h         | on focus        | EOD series — faster is theatre                              |
| Commodities     | 5 min             | 15 min       | 5 min           |                                                             |
| Crypto          | 60 s              | 60 s         | 60 s            | 24/7                                                        |
| Sentiment       | 15 min            | 60 min       | 15 min          | derived from slower inputs                                  |
| News            | 15 min            | 30 min       | 15 min          | **quota-bound** — see §3                                    |
| Intraday series | 5 min             | 60 min       | on range change |                                                             |
| Watchlist       | 60 s              | 15 min       | 60 s            | Avanza, free                                                |

Market-open detection for TTL selection reuses `getMarketStatus` from
`marketCenters.ts` — no new mechanism.

### Resilience

| Mechanism              | Design                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeout**            | Per-request, default 5 s, per-provider override. Always via `AbortSignal` from `FetchContext`.                                                                                          |
| **Retry**              | Bounded exponential backoff with full jitter: 3 attempts, base 250 ms, cap 4 s. Only for `retryable` errors. `Retry-After` is honoured when present.                                    |
| **Token bucket**       | Per provider, RPM and RPD from config. Exhausted → provider skipped, not queued.                                                                                                        |
| **Daily budget**       | Persistent counter in L2, keyed `providerId + UTC date`. Survives restarts, so a dev-server loop cannot silently burn a 100/day quota.                                                  |
| **Circuit breaker**    | Open after 5 consecutive failures; half-open single probe after 60 s; close on success. Prevents a dead provider adding latency to every request.                                       |
| **Provider health**    | `{ providerId, state: 'closed'                                                                                                                                                          | 'open' | 'half-open', consecutiveFailures, lastError, budgetRemaining, resetsAt }`, exposed for diagnostics. |
| **Structured logging** | One record per resolution: `capability`, `cacheKey`, `providerId`, `outcome`, `latencyMs`, `quality`, `staleReason?`, `errorCode?`. **Never** the API key, never the raw response body. |

All provider traffic funnels through one server process, which is the only
reason the limiter is authoritative — and the reason nothing may ever fetch a
provider from the browser.

## 13. Environment-variable strategy

```dotenv
# .env.example  (committed; .env is already gitignored)

MARKETDATA_MODE=fixture              # fixture | hybrid | live
MARKETDATA_CACHE_DIR=.cache
MARKETDATA_PERSIST_CACHE=true
MARKETDATA_DISABLE_NETWORK=false     # true in CI/tests — hard-fails outbound calls

MARKETDATA_CHAIN_FX=frankfurter,fixture
MARKETDATA_CHAIN_EQUITY_SE=avanza,fixture
MARKETDATA_CHAIN_EQUITY_INTL=fixture           # twelvedata added at Phase 6
MARKETDATA_CHAIN_YIELDS_US=treasury,fred,fixture
MARKETDATA_CHAIN_YIELDS_SE=riksbank,fixture
MARKETDATA_CHAIN_CRYPTO=coingecko,fixture
MARKETDATA_CHAIN_COMMODITIES=fixture
MARKETDATA_CHAIN_NEWS=marketaux,fixture
MARKETDATA_CHAIN_SENTIMENT=derived,fixture

FRED_API_KEY=
MARKETAUX_API_KEY=
MARKETAUX_RPD=100
COINGECKO_API_KEY=                   # optional — demo plan works keyless
COINGECKO_RPM=100
COINGECKO_RPM_MONTHLY=10000
TWELVEDATA_API_KEY=
TWELVEDATA_RPM=8
TWELVEDATA_RPD=800
RIKSBANK_API_KEY=

AVANZA_MCP_ENABLED=false             # existing
AVANZA_MCP_UVX_PATH=                 # existing
```

- **No `VITE_` prefix on any secret.** Vite exposes only `VITE_*` to the client,
  so unprefixed names are structurally incapable of reaching the browser bundle.
  `vite.config.ts:12` already loads unprefixed `.env` into `process.env` for
  server code — that mechanism is correct and unchanged.
- Parsed and validated **once**, in `infrastructure/marketData/config.ts`, at
  first server use. Malformed values throw at startup. A **missing key removes
  that provider from its chain with a warning** rather than throwing — the
  fixture tail keeps the app running.
- `MARKETDATA_MODE=live` is what makes `allowFixture: 'non-production'` bite.

## 14. `OverviewSnapshot` contract

The browser makes **one** request; the server aggregates. Categories are
independently timestamped because their sources update at genuinely different
frequencies, and that is made explicit rather than averaged away.

```ts
/* ------------------------ application/marketData/getOverviewSnapshot.ts */

export interface OverviewSnapshot {
  indices: Envelope<MarketQuote[]>
  fx: Envelope<MarketQuote[]>
  commodities: Envelope<MarketQuote[]>
  crypto: Envelope<MarketQuote[]>
  yields: Envelope<GovernmentYield[]>
  yieldCurve: Envelope<YieldCurve>
  sectors: Envelope<MarketQuote[]>
  sentiment: Envelope<MarketSentiment>
  news: Envelope<NewsItem[]>
  intraday: Envelope<MarketSeries[]>
  watchlist: Envelope<MarketQuote[]>

  /** Instrument reference data for every symbol referenced above. */
  instruments: Record<CanonicalSymbol, InstrumentRef>

  /**
   * Snapshot-level provenance. `asOf` is the OLDEST asOf across populated
   * categories — the honest answer to "how current is this screen?", and
   * exactly what "Data uppdaterad" must display (D5, D10).
   */
  asOf: string
  generatedAt: string
  /** True when any category is stale, fixture, delayed or proxied. */
  hasDegradedCategory: boolean
}

export async function getOverviewSnapshot(
  container: Container,
  opts: { intradayRange: IntradayRange },
): Promise<OverviewSnapshot>
```

Categories resolve **concurrently** (`Promise.allSettled`); one slow or failing
category never blocks the snapshot. Exposed to the client through exactly one
`createServerFn` in `infrastructure/marketData/serverFns.ts`.

### Timestamp semantics (D10, approved 2026-07-26)

Category-level provenance is **always retained** on every `Envelope`, even
though the current UI displays a single figure. Two rules govern the displayed
value:

1. **Conservative by construction.** `snapshot.asOf` is the _oldest_ `asOf`
   across populated categories, never the newest and never an average. A screen
   where FX is 6 hours old and crypto is 30 seconds old reports the 6 hours.
   The displayed timestamp can therefore never imply a category is fresher than
   it is — the worst case is that it under-reports a fresh category, which is
   the safe direction.
2. **The format does not change.** `HH:MM`, same position, same styling. Only
   the value's source changes, from render time to `snapshot.asOf`.

Per-category provenance is already carried and will be surfaced later — through
the existing `DataSourceBadge` or a hover affordance — when there is an approved
visual change to hang it on. Until then it is available to the view model and
deliberately unrendered.

---

---

# Part III — Execution

## 15. Test matrix

| #   | Test                              | Layer          | Proves                                                                                                                                            | Tooling                  |
| --- | --------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| T1  | **Golden render, Overview**       | presentation   | Byte-identical DOM before/after Phase 0 and Phase 1 under the fixture provider. _The load-bearing visual-lock test._                              | vitest + RTL snapshot    |
| T2  | Domain model validation           | domain         | Constructors/guards reject `NaN`, negative `ageMs`, `percentageChange` without `previousClose`, unit/currency mismatch                            | vitest unit              |
| T3  | Domain purity                     | domain         | No file under `domain/` imports React, `node:*`, `fetch`, `process.env`, or `~/lib/format`                                                        | import-graph test        |
| T4  | **Dependency-direction boundary** | all            | No file under `components/`, `routes/` or `application/` imports `infrastructure/**`; no provider response type is importable outside its adapter | import-graph test        |
| T5  | Adapter contract tests            | infrastructure | Recorded payload → normalizer → exact domain shape, per provider                                                                                  | vitest + `__fixtures__/` |
| T6  | Adapter schema-failure            | infrastructure | Truncated/renamed payload → `DomainError{code:'schema'}`; never `NaN` downstream                                                                  | vitest                   |
| T7  | Registry resolution               | application    | `chainFor(capability)` honours config order, skips unconfigured and unhealthy providers                                                           | vitest + stubs           |
| T8  | Fallback chain                    | application    | A fails → B used; A+B fail → stale; no cache → fixture; policy forbids → `error`                                                                  | vitest + stubs           |
| T9  | **Provenance propagation**        | application    | `source`, `quality`, `isDelayed`, `isProxy`, `staleReason` survive every fallback path and are never overwritten by the chain head                | vitest                   |
| T10 | Fixture-never-labelled-live       | application    | In `MARKETDATA_MODE=live`, a price category with `allowFixture:'non-production'` yields `error`, not `fixture`                                    | vitest                   |
| T11 | TTL and staleness                 | infrastructure | Fake timers: expiry, open-vs-closed TTL selection, `maxStaleMs` ceiling discards                                                                  | `vi.useFakeTimers()`     |
| T12 | Single-flight                     | infrastructure | N concurrent identical keys → exactly 1 upstream call                                                                                             | vitest                   |
| T13 | Rate budget                       | infrastructure | Token-bucket refill, RPM burst rejection, daily budget exhaustion → provider skipped, counter survives a simulated restart                        | vitest                   |
| T14 | Circuit breaker                   | infrastructure | open → half-open → closed transitions; `Retry-After` honoured                                                                                     | vitest                   |
| T15 | Cache-key identity                | infrastructure | Keys derive from normalized request (sorted symbols), not call site; version prefix invalidates                                                   | vitest                   |
| T16 | Server-only env                   | infrastructure | No secret name carries a `VITE_` prefix; built client bundle contains no key value                                                                | build-output scan        |
| T17 | **No-network CI guard**           | all            | `MARKETDATA_DISABLE_NETWORK=true` in `src/test/setup.ts` + a `fetch` stub that throws on any non-localhost host                                   | vitest setup             |
| T18 | Deterministic fixture provider    | infrastructure | Same inputs → identical output across runs and machines; no `Date.now()`, no PRNG without a seed                                                  | vitest                   |
| T19 | Timestamp discipline              | all            | ISO-with-offset survives the server-fn boundary; no `Date` object crosses it; formatting stable under fixed `TZ`                                  | vitest                   |
| T20 | Sentiment formula                 | domain         | Known inputs → known score/label; boundaries at 0/50/100; every component contributes; `formulaVersion` bumps with weights                        | vitest                   |
| T21 | Live smoke                        | infrastructure | One real call per configured provider; schema + non-null. **Opt-in, manual, never in CI**                                                         | vitest tagged            |

T3 and T4 are implemented as one import-graph walker over `src/` — parse each
file's import specifiers and assert the allowed-edge matrix. Cheap to write,
and it is what makes "UI never imports a concrete provider" enforceable rather
than aspirational.

## 16. Migration sequence

Every phase is reversible through configuration alone.

| Phase                                    | Scope                                                                                                                              | Providers                    | Defects fixed        | Gate                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------- | --------------------------- |
| **A — Domain foundation**                | domain models, `Envelope`, ports, registry, policy, container, config schema, dependency-direction docs + tests                    | none                         | —                    | T2, T3, T4 pass             |
| **0 — Close the seam**                   | `LightCommandCenter` stops importing mocks; routes through `getOverviewSnapshot`; `FixtureProvider` returns exactly today's values | `fixture`                    | **D1, D2, D3, D5**   | **T1 byte-identical**       |
| **1 — Infrastructure**                   | cache (L1+L2), single-flight, token bucket, budgets, breaker, retry, timeout, structured errors + logging                          | `fixture`                    | —                    | T11–T15, T1 still identical |
| **2 — FX**                               | Frankfurter; real `asOf`; daily-rate semantics                                                                                     | `frankfurter`                | —                    | T5, T8, T9                  |
| **3 — Crypto**                           | CoinGecko; first live exercise of the daily budget                                                                                 | `coingecko`                  | —                    | T13 under real quota        |
| **4 — Government yields**                | Treasury + FRED; Riksbank for SE; **real `YieldCurve`**                                                                            | `treasury`,`fred`,`riksbank` | **D6**               | T5, T8                      |
| **5 — Swedish equities + OMXS30**        | wrap the existing Avanza MCP seam as a provider; canonical symbols; numeric end-to-end                                             | `avanza`                     | **D2** (source side) | T5, T19                     |
| **6 — International indices + intraday** | paid-vs-proxy decision first (§17 D1); range-aware chart timestamps                                                                | `twelvedata` or `proxy-etf`  | **D4**               | decision memo approved      |
| **7 — Commodities**                      | Brent, gold; explicit units and currencies                                                                                         | `twelvedata`                 | —                    | depends on Phase 6 outcome  |
| **8 — News + derived sentiment**         | Marketaux at 15-min TTL; versioned sentiment formula                                                                               | `marketaux`,`derived`        | —                    | T20                         |
| **9 — Sectors**                          | last: 11 sector ETFs or drop the panel                                                                                             | TBD                          | —                    | §17 D5                      |

Phases 2–5 are all free and unblocked. **The paid decision does not gate them.**

## 17. Decisions requiring your approval

| #       | Decision                                                                                                             | Status                     | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D2**  | Fixture-in-production policy                                                                                         | ✅ **Approved 2026-07-26** | **Every** category is `allowFixture: 'non-production'`, including news and sentiment. In live mode with no live or permitted stale source, return a genuine `error` or `lastGood` with explicit provenance. Fixture prices are never displayed as live. Sentiment splits three ways — fixture / derived / provider-supplied — under distinct quality labels; **derived sentiment over real or explicitly stale inputs is production-eligible** with provenance, input timestamps and `formulaVersion` preserved. See §7. |
| **D3**  | Project structure                                                                                                    | ✅ **Approved 2026-07-26** | New `domain/ application/ infrastructure/ presentation/` trees, dependency direction enforced by the import-graph tests. **No big-bang migration** — the new architecture coexists with legacy contracts while features migrate incrementally. See §4.                                                                                                                                                                                                                                                                   |
| **D8**  | Cache strategy                                                                                                       | ✅ **Approved 2026-07-26** | One `CacheStore` interface: memory now, optional disk JSON for local dev and single-instance, KV later. **Production correctness must not depend on local disk.** Disk sits behind the same interface and is configurable. Multi-instance caveat documented — a shared store is a prerequisite for scaling out, principally because the daily budget is otherwise counted per instance. See §12.                                                                                                                         |
| **D10** | "Data uppdaterad"                                                                                                    | ✅ **Approved 2026-07-26** | Keep the visible `HH:MM` format and position; change only the underlying value to the true data `asOf`. `OverviewSnapshot` retains category-level provenance regardless; the displayed figure is the **oldest** category `asOf`, so it can never imply an older category is fresher than it is. See §14.                                                                                                                                                                                                                 |
| **D9**  | PRNG yield sparkline                                                                                                 | ✅ **Approved 2026-07-26** | Never retain invented yield movements in a production-facing view. Fallback order: (1) real yield history → (2) explicitly stale `lastGood` history → (3) honest unavailable/empty state → (4) no sparkline. Applies whenever the relevant phase ships without real data.                                                                                                                                                                                                                                                |
| **D11** | `marketCenters` stays under `~/data/**`                                                                              | ✅ **Approved 2026-07-26** | Keep the documented exception. It is a pure time-based market-session function, not mock market data, and relocating it now would mean editing locked globe components for no user value. The boundary test permits **only this exact import** and must not be broadened. Future home: `domain/market/marketCenters.ts`, tracked as a dedicated, separately reviewed domain migration.                                                                                                                                   |
| **D12** | Golden snapshot vs. semantic assertions                                                                              | ✅ **Approved 2026-07-26** | Keep the golden snapshot as migration protection; **complement, do not replace** it with focused semantic tests before a future phase substantially expands it, so failures are diagnosable without reading a 4 000-line serialization diff. Contracts: instrument ordering, displayed values, units, data-source states, category timestamps, conservative snapshot `asOf`, selected intraday range, absence of direct mock-data imports. Delivered in Phase 1.                                                         |
| **D1**  | Foreign index levels: Twelve Data Grow (~$29/mo) vs honestly-labelled ETF proxies (SPY/EWG/EWJ/EWU) vs keep fixtures | ⏳ open                    | Focused decision memo before Phase 6. Lean: proxies acceptable **only** with visible labelling; if the Overview must read as a real product, buy the plan.                                                                                                                                                                                                                                                                                                                                                               |
| **D4**  | Migrate `/portfolio`, `/watchlist`, `/markets` off `marketDataService`                                               | ⏳ deferred                | Out of scope. They keep working unchanged on the legacy contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **D5**  | Sectors panel: source 11 ETFs, or remove it                                                                          | ⏳ open                    | Defer to Phase 9; worst cost-to-value on the screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D6**  | Riksbank API key — requires account registration                                                                     | ⏳ open, **user action**   | You obtain the key; SE yields fall back to fixture until then.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D7**  | Sentiment formula v1 weights (VIX level/percentile, 10Y change, DXY change, BTC 24h)                                 | ⏳ open                    | Drafted with tests in Phase 8; you sign off on the weights and `formulaVersion`.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Approval log

| Date       | Scope                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-26 | Domain design approved: `InstrumentRef` identity/observation split, typed explicit units, basis points for yield changes, single `Provenance` object, genuine error states, import-boundary enforcement, preservation of the Avanza transport and service seam, additive Architecture Phase A, golden snapshot before Phase 0, removal of PRNG financial data from production-facing views. |
| 2026-07-26 | D2, D3, D8, D9, D10 resolved as above. D11 and D12 resolved after Phase 0.                                                                                                                                                                                                                                                                                                                  |
| 2026-07-26 | **Architecture Phase A approved to proceed.** Phase 0 to follow after Phase A is complete and verified. Live-provider integration (Phase 2+) still requires separate approval.                                                                                                                                                                                                              |
| 2026-07-26 | Three Phase A additions approved: domain event **contracts** (definitions only, no bus), a `Clock` abstraction, and value objects for financial primitives. Recommendation accepted: branded primitives over wrapper classes, `Money` as a data interface. See §4.                                                                                                                          |
| 2026-07-26 | **Architecture Phase A complete and verified.** 124 tests green, typecheck clean, zero existing files modified. Awaiting approval of Phase 0.                                                                                                                                                                                                                                               |

---

## 18. Implementation plan — Architecture Phase A and Phase 0

Concise, and the only work I would start on approval. **No live providers, no
network calls, no visual change.**

### Architecture Phase A — domain foundation ✅ COMPLETE (2026-07-26)

Pure additions. No existing file was modified, so the app was untouched throughout.

| Step | Files                                                                      | Output                                                                                                          | Status |
| ---- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| A0   | `src/domain/market/primitives.ts`                                          | Branded `Percent`, `BasisPoints`, `Price`, `YieldPercent`, `IsoCurrencyCode`; `Money` as data + `addMoney`      | ✅     |
| A0b  | `src/domain/shared/clock.ts`                                               | `Clock`, `SystemClock`, `FakeClock`                                                                             | ✅     |
| A1   | `src/domain/market/provenance.ts`                                          | `Unit`, `Quality`, `DataSourceMetadata`, `Provenance`, `Envelope<T>`, `DomainError`, `StaleReason`, `ErrorCode` | ✅     |
| A2   | `src/domain/market/instruments.ts`, `symbols.ts`                           | `CanonicalSymbol`, `InstrumentRef` union, catalog of **32 instruments** + Overview groupings                    | ✅     |
| A3   | `src/domain/market/observations.ts`, `rates.ts`, `news.ts`, `sentiment.ts` | The 11 models from §5, with smart constructors                                                                  | ✅     |
| A4   | `src/domain/market/events.ts`                                              | 6 domain event contracts + `DomainEventHandler`. **No bus; nothing publishes or consumes.**                     | ✅     |
| A5   | `src/domain/**/*.test.ts`                                                  | T2 model validation (48 tests)                                                                                  | ✅     |
| A6   | `src/application/marketData/ports.ts`, `policy.ts`                         | 8 capability interfaces, `DataCategory`, per-category TTL + `FallbackPolicy`                                    | ✅     |
| A7   | `src/application/marketData/providerRegistry.ts`                           | `createProviderRegistry`, `resolve` — chain ordering, cache read/write, staleness, fallback                     | ✅     |
| A8   | `src/application/marketData/providerRegistry.test.ts`                      | T7, T8, T9, T10 (20 tests)                                                                                      | ✅     |
| A9   | `src/infrastructure/marketData/config.ts`, `keys.ts`                       | Env schema + validation, live-readiness check, cache-sharing check, normalized key construction                 | ✅     |
| A10  | `src/infrastructure/marketData/cache/store.ts`, `container.ts`             | `CacheStore` + `MemoryCacheStore` (D8); `createContainer()` with stub injection                                 | ✅     |
| A11  | `src/test/importGraph.test.ts`                                             | T3, T4, T16 architectural fitness (9 tests)                                                                     | ✅     |
| A12  | `docs/data-architecture.md`                                                | This update                                                                                                     | ✅     |

**Exit criteria — all met:**

- `npx tsc --noEmit` clean.
- Full suite: **12 files, 124 tests, 0 failures** (77 new).
- T2, T3, T4, T7, T8, T9, T10, T16 passing.
- Fitness tests verified against a deliberately planted violation: 3 of them
  fired and named the offending file and line. They are not passing vacuously.
- `git status`: only new files under `src/domain/`, `src/application/`,
  `src/infrastructure/`, `src/test/` and `docs/`. **Zero existing files
  modified**, so application behaviour is provably unchanged.

**Deviations from the plan:** none of substance. Two notes for the record —
`resolve()` shipped with working cache read/write rather than the planned bare
skeleton, since the fallback ordering could not be tested honestly without it
(the limiter, breaker, retry and timeout remain Phase 1, behind the same
signature). And the symbol catalog holds 32 entries, not the estimated ~25,
because the nine S&P sector sub-indices and VIX each need identity.

### Phase 0 — close the seam

| Step | Files                                                  | Output                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0a   | `src/components/lightDashboard/__snapshots__/`         | **Capture the golden render first**, against current `main`. Everything after is measured against it.                                                                                                                                  |
| 0b   | `src/infrastructure/marketData/providers/fixture.ts`   | `FixtureProvider` implementing every port, returning **exactly today's values** — sourced from the existing mock modules, converted to domain models. Deterministic, no `Date.now()`.                                                  |
| 0c   | `src/infrastructure/marketData/providers/fixture/*.ts` | Fixture data with **relative timestamps** (offsets from `ctx.now()`), retiring `MOCK_NOW` and `COUNTRY_MOCK_NOW` from the live path — **D3**                                                                                           |
| 0d   | `src/application/marketData/getOverviewSnapshot.ts`    | The use case from §14, `Promise.allSettled` across categories                                                                                                                                                                          |
| 0e   | `src/infrastructure/marketData/serverFns.ts`           | One `createServerFn`, dynamic `import()` guard, following `avanzaMcp/serverFns.ts:11-15`                                                                                                                                               |
| 0f   | `src/routes/index.tsx`                                 | Route loader calls the server fn; snapshot passed to the component                                                                                                                                                                     |
| 0g   | `src/presentation/marketData/viewModels.ts`            | Domain → sv-SE strings, composing the existing `lib/format.ts`. **This is where `'19 840'` and `'+0,32%'` are produced — and nowhere else** — **D2**                                                                                   |
| 0h   | `src/components/lightDashboard/LightCommandCenter.tsx` | Delete the 9 local builders (`buildMarketCards`, `buildCurrentMarkets`, `buildRates`, `buildIntraday`, `seededSeries`, `indexQuote`, `parseSignedPercent`, `SECTORS`, `RATE_CURVE`); consume view models. **No JSX or class changes.** |
| 0i   | same                                                   | Canonical symbols throughout — **D1** (`bitcoin`/`btc` mismatch disappears by construction)                                                                                                                                            |
| 0j   | same, `:955`                                           | "Data uppdaterad" reads `snapshot.asOf`. Same format, same position, same styling — **D5**                                                                                                                                             |
| 0k   | `LightCommandCenter.test.tsx`                          | T1 golden render + T18 determinism                                                                                                                                                                                                     |

#### Phase 0 entry gates

| Gate   | Requirement                                                         | Status                                    |
| ------ | ------------------------------------------------------------------- | ----------------------------------------- |
| **G0** | Clean commit boundaries: hero drift, Phase A, and baseline separate | ✅ 3 commits, see below                   |
| **G1** | Deterministic golden Overview baseline captured and committed       | ✅ `c8338b5`, 3 983 lines, stable ×4 runs |
| **G2** | Exact Phase 0 removal inventory with old → new field mapping        | ✅ below                                  |
| **G3** | Fixture snapshot contract confirmed                                 | ✅ below                                  |
| **G4** | Proxy-disclosure decision recorded (no visual change in Phase 0)    | ✅ below                                  |
| **G5** | Written confirmation nothing visual, geometric or locked is touched | ✅ below                                  |

##### G0 — commit boundaries

| Commit    | Scope                    | Files                                                                                         |
| --------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `93372cd` | Hero environmental drift | `LightCommandCenter.tsx` (+5/−1), `styles/app.css` (+31)                                      |
| `aadba21` | Architecture Phase A     | 24 new source files + `docs/data-architecture.md`; **zero existing files modified**           |
| `c8338b5` | Golden baseline (G1)     | `LightCommandCenter.golden.test.tsx`, `__snapshots__/LightCommandCenter.golden.test.tsx.snap` |

##### G1 — golden baseline

Committed at `c8338b5`. Covers DOM structure, every value and label, ordering,
class names, inline styles, sparkline SVG geometry, recharts series geometry
and news timestamps. Determinism is pinned three ways (TZ before import, frozen
system time, fixed-size `ResizeObserver` so recharts actually renders); verified
byte-identical across four consecutive runs. `LightGlobe` is stubbed — locked,
out of scope, and unrenderable in jsdom.

`Data uppdaterad` is asserted in its own named test, outside the snapshot, so
the one approved intentional change is the only assertion that moves.

**Finding — a second delta needs sign-off.** Capturing the baseline exposed a
pre-existing formatting inconsistency:

| Rendered value                                      | Separator         | Source                             |
| --------------------------------------------------- | ----------------- | ---------------------------------- |
| `2 612,48` `5 843,12` `20 418,65`                   | **NBSP** (U+00A0) | via `formatNumber` — correct sv-SE |
| `19 840` `40 850` `8 363,95` `2 385,40` `71 386,25` | **ASCII space**   | hand-written mock literals         |
| `4.32%`                                             | **dot decimal**   | `GLOBAL_MARKET_OVERVIEW` string    |

Phase 0 makes every value numeric until presentation, so all of them format
through one path and converge on the `formatNumber` output: five values change
ASCII space → NBSP (visually identical, different bytes), and `4.32%` becomes
`4,32%` (a visible glyph change, period → comma).

This is unavoidable without keeping pre-formatted strings in the fixture, which
would defeat "numeric until presentation" and enshrine a formatting bug — the
ASCII-space and dot-decimal values are the anomaly, not the NBSP ones.
**Recommendation: accept as a second enumerated exception.** The list above is
exhaustive; no other value changes.

##### G2 — Phase 0 removal inventory

Every deletion from `LightCommandCenter.tsx`, and where each value comes from
afterwards. Line numbers are as of `c8338b5`.

**Imports to remove (all `~/data/**` reachability):**

| Line  | Import                                                | Why it goes                      |
| ----- | ----------------------------------------------------- | -------------------------------- |
| 46    | `COUNTRY_MOCK_NOW`, `getGlobalNewsFeed`               | frozen clock (D3) + news source  |
| 47    | `GERMANY_DATA`                                        | DAX as localized strings (D2)    |
| 48    | `JAPAN_DATA`                                          | Nikkei as localized strings (D2) |
| 49–52 | `GLOBAL_MARKET_OVERVIEW`, `GLOBAL_RISK_SENTIMENT`     | US 10Y + sentiment gauge         |
| 57    | `marketIndices`, `watchlist`                          | index quotes + watchlist tiles   |
| 60    | `formatNumber`, `formatPercent`, `formatRelativeTime` | move to `viewModels.ts`          |

Retained: `MARKET_CENTERS` / `getMarketStatus` (line 53–56) — a pure function of
the real clock over published session hours, not mock data. Retained:
`countryExplorerService` (58) — the country modal is out of scope.

**Builders and constants to delete:**

| Line    | Symbol                | Replaced by                                                  |
| ------- | --------------------- | ------------------------------------------------------------ |
| 109–125 | `seededSeries`        | real/fixture series — **removes PRNG financial data**        |
| 127–136 | `indexQuote`          | `snapshot.indices` keyed by `CanonicalSymbol`                |
| 138–141 | `parseSignedPercent`  | nothing — values arrive numeric (D2)                         |
| 143–178 | `buildMarketCards`    | `snapshot.indices` + `snapshot.intraday` sparklines          |
| 181–195 | `buildCurrentMarkets` | `snapshot.fx` + `snapshot.commodities` + `snapshot.crypto`   |
| 198–211 | `buildRates`          | `snapshot.yields`                                            |
| 214–224 | `SECTORS`             | `snapshot.sectors`                                           |
| 239–254 | `buildIntraday`       | `snapshot.intraday`                                          |
| 257     | `RATE_CURVE`          | `snapshot.yieldCurve` — **removes PRNG yield noise (D6/D9)** |

**`seededSeries` call sites:** line 149 (market-card sparklines), line 245
(intraday series), line 257 (`RATE_CURVE`). All three go; the function is then
unreferenced and deleted.

**Frozen-clock usages:** line 347 (`new Date(COUNTRY_MOCK_NOW)` as the Header
fallback) and line 889 (`formatRelativeTime(item.publishedAt, COUNTRY_MOCK_NOW)`).
Both are replaced by `snapshot.asOf` / the item's real `publishedAt` measured
against the injected clock. `MOCK_NOW` is not imported here but is reachable
transitively through `marketIndices`; removing the import at 57 severs it.

**String parsing / formatting round-trips:** `parseSignedPercent` (138) applied
at lines 160 and 172 to `'+0.32%'` / `'+0.24%'`; `dax.primaryIndexValue`
(`'19 840'`) and `nikkei.primaryIndexValue` (`'40 850'`) passed through as
display strings; `us10?.value` (`'4.32%'`) and `us10?.change` (`'+0,00 bp'`)
likewise. All become numbers in the domain and are formatted once in
`viewModels.ts`.

**bitcoin/btc mismatch:** line 183, `indexQuote('bitcoin')` against
`mockData.ts:78` where the id is `'btc'`. Always `null`, so line 192–193's
literal `71 386,25` is what renders. Fixed by construction — the canonical
symbol is `crypto:btc` and there is exactly one of it.

**Fake timestamp path:** line 961, `new Intl.DateTimeFormat(...).format(new Date())`
inside the ticker rail. Becomes `snapshot.asOf`.

**Old source → new field map (nothing dropped):**

| Panel               | Old source                                             | New field                                |
| ------------------- | ------------------------------------------------------ | ---------------------------------------- |
| Marknadsöversikt ×6 | `marketIndices`, `GERMANY_DATA`, `JAPAN_DATA`, literal | `snapshot.indices`                       |
| — tile sparklines   | `seededSeries(seed,16,±0.16)`                          | `snapshot.intraday` per symbol           |
| Aktuella marknader  | `marketIndices` + 4 literals                           | `snapshot.fx`, `.commodities`, `.crypto` |
| Räntemarknaden ×4   | `GLOBAL_MARKET_OVERVIEW` + 3 literals                  | `snapshot.yields`                        |
| — curve sparkline   | `RATE_CURVE` (PRNG)                                    | `snapshot.yieldCurve`                    |
| Sektorer ×9         | `SECTORS`                                              | `snapshot.sectors`                       |
| Sentiment           | `GLOBAL_RISK_SENTIMENT`                                | `snapshot.sentiment`                     |
| Senaste nytt ×4     | `getGlobalNewsFeed(4)`                                 | `snapshot.news`                          |
| Utveckling idag ×4  | `buildIntraday(range)` (PRNG)                          | `snapshot.intraday`                      |
| Bevakning ×6        | `watchlist.slice(0,6)`                                 | `snapshot.watchlist`                     |
| Ticker rail         | derived from cards + currentMarkets                    | derived from the same envelopes          |
| Header status/clock | `MARKET_CENTERS` + real clock                          | **unchanged**                            |
| Data uppdaterad     | `new Date()` at render                                 | `snapshot.asOf` (approved change)        |

##### G3 — fixture snapshot contract

Confirmed:

- **Deterministic.** `FixtureProvider` takes its time from the injected
  `Clock` (`FetchContext.clock`); it contains no `Date.now()`, no
  `Math.random()`, and no unseeded generator. Fixture timestamps are expressed
  as offsets from `clock.now()`, so they age correctly and never read as 2025.
  Enforced by T18 and by the T3 fitness rule that only `SystemClock` may call
  `Date.now()`.
- **Reproduces current values.** Every fixture value is transcribed from the
  existing mock module it replaces, as a number. The golden snapshot is the
  check.
- **Category-level provenance.** Each `Envelope` in `OverviewSnapshot` carries
  its own `Provenance` with `quality: 'fixture'`, even though the UI displays
  only `snapshot.asOf` (the oldest across categories, per D10).
- **Numeric until presentation.** Domain models expose `Price`, `Percent`,
  `BasisPoints`, `YieldPercent`; `presentation/marketData/viewModels.ts` is the
  only module that produces a display string, composing the existing
  `lib/format.ts`.
- **No provider types in components.** Enforced by T4, which already fails on a
  planted violation.

##### G4 — proxy disclosure (recorded now, implemented later)

Recorded per your instruction; **no visual change in Phase 0**.

If international-index ETF proxies are approved under D1, the UI **must
visibly disclose** the substitution. `proxyNote` living only in provenance is
insufficient if the presentation never surfaces it — an undisclosed proxy is
the same failure as an undisclosed fixture.

Mechanically ready today: `buildProvenance` already throws when `isProxy` is
set without a `proxyNote`, and `policy.ts` keeps `allowProxy: false` for
`equity-index-intl` until D1 is resolved. What is missing is a rendering
obligation, which needs a visual affordance and therefore explicit approval.

Before Phase 6 I will provide a minimal disclosure proposal respecting the
locked design system — options being a compact labelled indicator, a tooltip or
info affordance reusing the existing `DataSourceBadge`, or explicit instrument
naming in the tile label. A test will then assert that a proxied envelope
cannot render without its disclosure. **This is a future sanctioned visual
exception, not part of Phase 0.**

##### G5 — confirmation of scope

Phase 0 changes the data path only. No change to: styles, Tailwind classes,
layout, component geometry, JSX structure, the hero background and its
environmental drift, the chart system, the globe, or the network layer. The
only edits to `LightCommandCenter.tsx` are deleting the data builders, changing
what the component reads, and the one approved `Data uppdaterad` value. The
golden snapshot is the enforcement, not the promise.

#### Phase 0 exit criteria (approved 2026-07-26)

| #   | Criterion                                                                     | Verified by                                                               |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| X1  | `LightCommandCenter.tsx` imports no data directly from `~/data/**`            | T4 boundary test                                                          |
| X2  | All Overview data arrives through the application service                     | T4 + code review                                                          |
| X3  | Financial values remain numeric until the presentation boundary               | T2 + review of `viewModels.ts` as sole formatter                          |
| X4  | Source and provenance preserved end to end                                    | T9                                                                        |
| X5  | `bitcoin`/`btc` identifier defect fixed (D1)                                  | targeted test asserting a live BTC value reaches the tile                 |
| X6  | Frozen-clock dependencies removed from the migrated path (D3)                 | grep gate: no `MOCK_NOW` / `COUNTRY_MOCK_NOW` reachable from the Overview |
| X7  | Overview visually identical apart from the truthful timestamp                 | **T1 byte-identical vs. G1 baseline**                                     |
| X8  | `npm run typecheck`, boundary tests and golden-render tests pass              | CI                                                                        |
| X9  | `MARKETDATA_MODE=fixture` with no network and no keys renders the full screen | T17 + manual                                                              |

### Deliberately not in Phase 0

Real providers, caching, rate limiting, breakers, the intraday x-axis fix (D4 —
needs real timestamps), the yield curve (D6 — needs Phase 4), and any change to
`/portfolio`, `/watchlist`, `/markets` or `/agents`.

### Estimated shape

Phase A is ~10 new files, all additive, no behavioural risk. Phase 0 is the
delicate one: it deletes ~150 lines of data-generation from
`LightCommandCenter.tsx` while requiring the rendered output to be identical.
The golden snapshot taken at step 0a is what makes that safe, which is why it is
the first action and not the last.

---

## Sources

- [Twelve Data pricing](https://twelvedata.com/pricing) · [docs](https://twelvedata.com/docs)
- [Financial data API comparison 2026](https://fundamentalshub.com/blog/financial-data-api-comparison) · [awesome-financial-data-apis](https://github.com/jeff3388/awesome-financial-data-apis)
- [Alpha Vantage guide 2026](https://alphalog.ai/blog/alphavantage-api-complete-guide)
- [FRED API](https://fred.stlouisfed.org/docs/api/fred/) · [DGS10](https://fred.stlouisfed.org/series/DGS10) · [US Treasury daily yield curve](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value=2026) · [ECB Data Portal API](https://data.ecb.europa.eu/help/api/overview)
- [Frankfurter](https://frankfurter.dev/)
- [CoinGecko API pricing](https://www.coingecko.com/en/api/pricing) · [public plan rate limits](https://support.coingecko.com/hc/en-us/articles/4538771776153-What-is-the-rate-limit-for-CoinGecko-API-public-plan)
- [Marketaux](https://www.marketaux.com/) · [Financial news sentiment APIs 2026](https://adanos.org/insights/blog/best-financial-news-sentiment-apis-2026/) · [Financial news APIs for AI agents](https://qveris.ai/guides/financial-news-api-for-ai-agents/)
- [API Ninjas commodity price](https://api-ninjas.com/api/commodityprice) · [Oil Price API](https://www.oilpriceapi.com/) · [Commodities-API](https://commodities-api.com/)

---

---

# Part IV — Phase 1 architecture (resilience infrastructure)

Approved 2026-07-26 with seven refinements, recorded below. Phase 1 adds
operational guarantees behind the **existing** `resolve()` signature; no live
provider is connected and no UI changes.

## 19. Retry accounting (refinement 1)

**Decision: one daily-budget unit per attempt, not per logical resolution.**

|                                        | Per attempt (chosen)                                      | Per logical resolution                                                                    |
| -------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Fidelity to the provider's own counter | Exact — providers count HTTP requests, and a retry is one | Drifts: three retries decrement our counter once but the provider's three times           |
| Worst-case real overshoot              | None                                                      | Up to the retry factor (3×), and precisely during an outage, when retries are most likely |
| Feature-throughput predictability      | Weaker — a bad afternoon can consume the day's refreshes  | Stronger — "news refreshes 100×/day" holds regardless                                     |
| Starvation risk                        | Real, and bounded (below)                                 | Lower                                                                                     |

The deciding argument: a budget that does not match the provider's own
accounting is not a budget. Its purpose is to keep us inside a quota we do not
control, and Marketaux counts requests, not intentions. Per-resolution
accounting would silently exceed the real quota by up to 3× at exactly the
moment the provider is already unhealthy — the failure mode the budget exists
to prevent.

The starvation risk is accepted because it is bounded from three directions:
retries are capped at 3 and only fire for `retryable` errors; the circuit
breaker opens after 5 consecutive failures and stops attempts entirely; and
`ProviderHealth.budget.remaining` makes consumption observable rather than
mysterious. A partial outage can cost at most a 3× burn on the categories still
attempting, and the breaker curtails even that within a handful of requests.

## 20. Cache-key evolution (refinement 2)

Three independent version axes, so a change invalidates exactly what it must:

```
s<schemaVersion>.n<normalizationVersion>:<capability>:<request-identity>
e.g.  s1.n1:quotes:idx:dax|idx:sp500
```

| Axis                     | Bumped when                                                                                                                                    | Invalidates                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **schemaVersion**        | A domain model's _shape_ changes — a field added, removed or retyped                                                                           | Everything                                                                                                                          |
| **normalizationVersion** | An adapter's _mapping semantics_ change — a unit correction, a different `previousClose` source, a rounding fix — while the shape is identical | Everything, but for a different reason: old entries are structurally valid and semantically wrong, which is the more dangerous case |
| **request identity**     | Never bumped; it _is_ the request (sorted symbols, interval, range, limit)                                                                     | Only the affected request                                                                                                           |

Separating schema from normalization matters because a normalization change is
invisible to the type system. Without its own axis, a corrected unit mapping
would leave plausible, well-typed, wrong values in the cache until their TTL
expired.

## 21. Metrics contracts (refinement 3)

A `Metrics` port; no dashboards, no exporter, no implementation beyond an
in-memory recorder and a no-op. Defining the contract now means the call sites
exist before anyone needs the data.

| Metric                                          | Type      | Labels                                       |
| ----------------------------------------------- | --------- | -------------------------------------------- |
| `marketdata.cache.hit` / `.miss` / `.stale_hit` | counter   | `category`, `capability`                     |
| `marketdata.provider.latency_ms`                | histogram | `provider`, `capability`, `outcome`          |
| `marketdata.provider.request`                   | counter   | `provider`, `capability`, `outcome`          |
| `marketdata.provider.retry`                     | counter   | `provider`, `attempt`                        |
| `marketdata.provider.timeout`                   | counter   | `provider`, `capability`                     |
| `marketdata.breaker.opened`                     | counter   | `provider`                                   |
| `marketdata.breaker.state`                      | gauge     | `provider`                                   |
| `marketdata.budget.used` / `.remaining`         | gauge     | `provider`                                   |
| `marketdata.resolution`                         | counter   | `category`, `state` (ok/stale/fixture/error) |

Cache hit ratio, stale hit ratio and provider success rate are **derived** from
these counters rather than stored — a ratio recorded as a gauge is a ratio that
goes stale.

## 22. Correlation IDs (refinement 4)

A `CorrelationId` is minted once per inbound request (one per
`getOverviewSnapshot`) and threaded through `FetchContext` → every provider
call → every log record and metric → and, when the bus exists, onto
`DomainEventBase.correlationId`, which already reserves the field.

Generated from the injected `Random`, so tests are reproducible. Never derived
from user input, and never contains one.

## 23. Provider capabilities metadata (refinement 5)

Declared at registration, so orchestration can reason about a provider without
hardcoding its name:

```ts
export interface ProviderCapabilityMetadata {
  /** Typical successful round trip, for timeout and ordering decisions. */
  expectedLatencyMs: number
  /** How often the upstream itself changes. Nothing is gained by polling faster. */
  updateFrequency: 'realtime' | 'minutely' | 'hourly' | 'daily' | 'static'
  /** Known delay behind the live market; null when the provider does not say. */
  delayMinutes: number | null
  supportsHistory: boolean
  supportsIntraday: boolean
  /** True when one call can serve many symbols — the free-tier survival trait. */
  supportsBatch: boolean
  /** Attribution the presentation layer is obliged to surface, if any. */
  requiresAttribution: boolean
}
```

Future uses this enables without a rewrite: ordering a chain by latency,
skipping a daily-update provider whose value cannot have changed, choosing a
history-capable provider for a range request, and sizing timeouts per provider
instead of globally.

## 24. Aggregate system health (refinement 6)

Operational metadata, not a UI feature.

```ts
export interface MarketDataHealth {
  status: 'healthy' | 'degraded' | 'critical'
  checkedAt: string
  providers: ProviderHealth[]
  categories: Array<{
    category: DataCategory
    /** Best state currently achievable, given breakers and budgets. */
    bestAvailable: 'live' | 'stale' | 'fixture' | 'unavailable'
    liveProvidersConfigured: number
    liveProvidersAvailable: number
  }>
  /** Categories that would error rather than render in live mode. */
  unservableCategories: DataCategory[]
}
```

`degraded` = at least one category cannot reach a live provider. `critical` =
at least one category is `unavailable` — no live provider, no acceptable stale
value, and fixtures forbidden.

## 25. Snapshot family (refinement 7)

`OverviewSnapshot` is the first of a family, not a one-off. Each is an
application-level aggregate assembled server-side, with independently
timestamped categories and one conservative `asOf`:

| Snapshot            | Status     | Serves                                                                                    |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `OverviewSnapshot`  | ✅ Phase 0 | the Overview                                                                              |
| `CountrySnapshot`   | documented | the country modal; migration target for `types/countryExplorer.ts`                        |
| `PortfolioSnapshot` | documented | `/portfolio`; migration target for `Holding`, `AllocationSlice`                           |
| `AgentSnapshot`     | documented | the AI-agent experience; the natural consumer of `MarketDataHealth` and the domain events |

Shared invariants every member must keep: category-level `Envelope`s,
provenance on every value, `asOf` as the oldest populated category, numeric
until the presentation boundary, and one server round trip.

---

---

# Part V — Phase 2 contracts (Frankfurter FX)

Approved 2026-07-26 with amendments D13–D17 plus four contract refinements.
Several of these correct earlier decisions; where they do, the correction is
stated rather than quietly applied.

## 26. Two findings from probing the live API

**v1, not v2.** ECB does not publish at weekends. Probed on Sunday
2026-07-26, `v1` reported `"date":"2026-07-24"` — honestly Friday's — while
`v2` reported `"date":"2026-07-26"` for the same underlying value, carrying it
forward and stamping it with the current date. v2 would silently violate
"preserve the actual source timestamp", so **Phase 2 targets v1 only**.

**The FX stale ceiling was wrong.** At `maxStaleMs: 48h`, a Friday rate is
already ~47 h old on Sunday afternoon and ~65 h old on Monday morning — so live
FX would have errored every Monday despite holding a perfectly valid rate.

## 27. Timestamp semantics (supersedes part of D10)

Three timestamps, three distinct meanings. Conflating them is what produced the
"Data uppdaterad" defect in the first place, so each is defined exactly.

| Field                  | Meaning                                                                                                              | Displayed?                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `provenance.asOf`      | When **the provider observed** this value. Per category. The only authoritative freshness signal for a given number. | not directly                          |
| `snapshot.generatedAt` | When **we successfully resolved the snapshot**. Server-side, from the injected clock — never render time.            | **yes — the "Data uppdaterad" label** |
| `snapshot.asOf`        | Oldest `provenance.asOf` across populated categories. **Diagnostics only.**                                          | no                                    |

**D16 correction.** The Overview label previously read `snapshot.asOf`. That is
technically conservative but product-wise misleading: categories publish at
fundamentally different frequencies — FX daily, yields daily, indices intraday,
news continuously — so one daily source would make the entire dashboard look
stale. From Phase 2 the label reads `generatedAt`: _"the dashboard was
refreshed at HH:MM"_, which is true regardless of category age.

The label therefore never claims every observation is equally fresh, and it
never claims to be render time. Per-category truth is untouched: every
`Envelope` keeps its own `asOf`, `quality`, `ageMs` and stale state, and
`snapshot.asOf` is retained for diagnostics and health.

## 28. Timestamp precision (new)

Frankfurter v1 supplies a publication **date**, not a verified instant.
Converting `2026-07-24` into `2026-07-24T16:00:00+02:00` and presenting it as
source-provided fact would replace one fabrication with another.

```ts
export type AsOfPrecision = 'date' | 'minute' | 'second'

interface Provenance {
  asOf: string // ISO 8601; for 'date' precision, midnight UTC
  asOfPrecision: AsOfPrecision
  /** The provider's own date string, preserved exactly. */
  sourceDate?: string // '2026-07-24'
  /**
   * Operational ESTIMATE of when the source published — never authoritative,
   * never used for `asOf`, never used to compute `ageMs`. Present so an
   * operator can judge "should newer data exist by now?".
   */
  estimatedPublicationAt?: string
}
```

For date precision `asOf` is midnight UTC of the publication date, which makes
`ageMs` **over**-state age by up to ~16 h — the safe direction. The estimate is
computed DST-correctly for Europe/Brussels and is asserted by test never to
reach `asOf` or `ageMs`.

## 29. Display precision (D17 correction)

Rendering Frankfurter's `9.717` as `9,7170` implies a digit of precision the
source did not supply. Precision therefore has two sources of truth:

- `InstrumentRef.precision` — the instrument's conventional display precision.
- `MarketQuote.sourcePrecision: number | null` — decimals the provider actually
  supplied, when known.

The presentation boundary uses `sourcePrecision ?? ref.precision`. Formatting
may pad _within_ known precision but must never manufacture a digit beyond it.
A future provider quoting 5 decimals simply reports 5.

## 30. EOD is not "delayed" (contract refinement)

`quality: 'delayed'` means _a real-time feed running N minutes behind_.
`quality: 'eod'` means _an official end-of-day figure_, which is a different
kind of observation, not a late one. Encoding an ECB reference rate as delayed
would be contradictory metadata.

| Field          | ECB reference rate |
| -------------- | ------------------ |
| `quality`      | `'eod'`            |
| `isDelayed`    | `false`            |
| `delayMinutes` | `null`             |

`buildProvenance` already defaults `isDelayed` from `quality === 'delayed'`, so
the contract needed no change — only this clarification, and the corresponding
correction to the Phase 2 plan, which had proposed `isDelayed: true`.

## 31. Change period (D15)

A change derived from two consecutive ECB publications is **not** an intraday
move, and nothing in the code may imply it is.

```ts
export type ChangePeriod = 'intraday' | 'daily' | 'publication-to-publication' | 'unknown'

interface MarketQuote {
  percentageChange: Percent | null
  changePeriod: ChangePeriod
}
```

A field is preferred over renaming `percentageChange` to `dailyChange`, because
`MarketQuote` is shared with genuinely intraday instruments where `daily` would
be the dishonest name. The field states the period explicitly for every quote;
Frankfurter sets `'publication-to-publication'`.

**Sanctioned future disclosure task:** the tile carries no period label today.
Phase 2 preserves the layout; a `D/D` or `ECB reference` marker rides along with
the proxy-disclosure affordance before Phase 6.

## 32. Operational ownership (contract refinement)

One owner per concern, no competing policies:

| Concern                                                                            | Owner                               |
| ---------------------------------------------------------------------------------- | ----------------------------------- |
| timeout, retry, rate limit, breaker, budget                                        | the Phase 1 pipeline (`attempt.ts`) |
| performing the call, propagating `AbortSignal`, network-disabled guard, safe parse | `httpClient.ts`                     |
| mapping symbols, validating, normalizing                                           | the adapter                         |

`httpClient.ts` deliberately has **no timeout and no retry of its own** — it
receives the signal the pipeline aborts.

## 33. FX policy (D13, D14)

|                             | Before | Phase 2                  |
| --------------------------- | ------ | ------------------------ |
| `ttlOpenMs` / `ttlClosedMs` | 60 s   | **30 min**, configurable |
| `maxStaleMs`                | 48 h   | **5 days**               |

The 5-day ceiling is a **wall-clock approximation** of "a few missed TARGET
business days". It is deliberately not a holiday calendar: no TARGET calendar
is introduced in Phase 2. A publication-calendar-aware freshness model may
replace it later.

---

---

# Part VI — Phase 3.5: operational readiness

Approved 2026-07-26. Completes the observability contracts Phase 1 declared
but left unwired. No market data, no provider, no UI, no visual change.

## 34. What Phase 1 left dead

An audit before implementing found the gap was larger than "add an exporter":

| Declared in Phase 1 | State before Phase 3.5                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Metrics` port      | only `noopMetrics` — every call went nowhere                                                                                          |
| 15 metric names     | 11 had call sites; `breakerState`, `budgetUsed`, `budgetRemaining`, `singleFlightShared` had **none** — the quota and breaker signals |
| `MarketDataHealth`  | computed by `container.health()`, which nothing ever called                                                                           |
| `CorrelationId`     | reached the pipeline and logs, then stopped; no operator could obtain one                                                             |
| Prometheus / OTel   | no exporter, no mapping, no naming decision                                                                                           |

## 35. Metric naming and the exporter boundary (D24)

Internal names are dotted and OTel-native (`marketdata.provider.latency_ms`).
Prometheus requires `[a-zA-Z_:][a-zA-Z0-9_:]*`, so translation happens **at the
exporter**, not in the pipeline — neither vendor's convention becomes the
internal truth, and adopting an SDK later needs no rename.

Normalization is lossy: `a.b` and `a_b` both become `a_b`. That would silently
merge two unrelated series on a dashboard, so `findNameCollisions` detects it
and `renderPrometheus` **throws** rather than emitting corrupt output. A test
asserts the real catalog is collision-free.

The renderer handles valid names, label-name validation, label-value escaping
(`\`, `"`, newline), `# HELP` / `# TYPE` once per family, cumulative buckets,
`+Inf`, `_sum`, `_count`, and deterministic ordering.

## 36. Cardinality is the safety property

A label is a time series, so unbounded label values are the one way this
subsystem can become the outage it is meant to diagnose.

Label **keys** come from a fixed allowlist: `provider`, `capability`,
`category`, `outcome`, `state`, `reason`, `attempt`. Label **values** must be
≤ 48 chars and match `[A-Za-z0-9_.:-]+`, and are additionally rejected when
they _look_ like unbounded data — a URL, a joined symbol list, a timestamp, a
correlation id or hash, a cache key. Shape checks run before the character
check so the rejection reason is actionable.

A rejected label **drops the whole write** and increments a diagnostic counter;
it is never silently sanitized into a different series. Validation returns
rather than throws, because a metrics call must never be able to fail a
market-data request.

`correlationId` is barred from labels permanently. It is a log field, and may
become a metric **exemplar** only once an exporter that supports exemplars is
chosen. The text renderer emits none.

## 37. Recorder lifecycle and limits

- **Per instance. Reset on restart. Not suitable for long-term trending.** It
  answers "what is happening now?" — trending needs scraping into an external
  store, which is what the renderer enables and this phase stops short of.
- All state is bounded: series capped at `MAX_SERIES` (2 000), histograms keep
  bucket counts rather than raw observations, and the rejection list is capped.
- Counters only increase; negative increments are rejected. Gauges overwrite.
  Negative observations are rejected — a negative latency is a clock problem.
- `snapshot()` deep-copies and sorts, so callers cannot mutate internal state
  and serialization is byte-stable.
- `resetForTests()` exists for tests only.
- Increments cannot be lost: a single JavaScript process has no preemption
  between the read and the write.

## 38. Histogram buckets (D28)

Fixed at `10, 25, 50, 100, 250, 500, 1000, 2500, 5000, +Inf` ms. An observation
exactly on a boundary lands in that bucket, matching Prometheus `le`
semantics. These may be tuned from real operational data later; they are
deliberately not runtime-configurable, because a histogram whose buckets change
is a histogram whose history cannot be compared.

## 39. The four formerly dead signals

| Signal                             | Semantics                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budget.used` / `budget.remaining` | Latest known state, emitted on every reservation so burn is visible before exhaustion. **Instance-local unless the cache store is shared** — `MarketDataHealth.sharedBudget` says which. |
| `breaker.state`                    | Gauge with a documented mapping: `0` closed, `1` half-open, `2` open. Ordered by severity, so `max()` is meaningful. Emitted every attempt, not only on transitions.                     |
| `singleflight.shared`              | Counter of **join events** — callers that attached to work already running. Consistently "requests this saved", never "distinct keys shared".                                            |

Each needs a condition fixture-only mode never produces (fixtures are never
cached, carry no budget, and sequential calls never overlap), so tests drive
them deliberately rather than inferring from a fixture run.

## 40. Health exposure and authorization (D25)

The payload carries no credentials but does reveal operational topology, so:

| Mode              | Default                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `fixture` / local | open, for development diagnostics                                                                 |
| `hybrid` / `live` | **disabled** unless `MARKETDATA_HEALTH_ENABLED=true`, and then requires `MARKETDATA_HEALTH_TOKEN` |

The token value is **never stored on the config object** — only its presence.
The endpoint reads it from the environment at call time, so it cannot be
serialized, logged or returned by accident. Comparison is length-independent.
An unauthorized call returns `{ status: 'unavailable' }`, indistinguishable
between "disabled" and "wrong token" and carrying no provider information: a
probe must not learn the topology from the shape of a refusal. Nothing is
cached — a cached health response is a stale answer to a question only asked
because something might be wrong.

**The token is a narrowly scoped temporary measure, not an authorization
model.** When this application has real authentication, these endpoints move
behind it.

## 41. Health scope semantics

`MarketDataHealth` now carries `scope: 'instance'`, `sharedBudget`, and
optional `metrics` recorder state; `ProviderHealth` carries `lastLatencyMs`.
In-memory health is never described as global system health: breaker state and
metrics are process-local, and the budget is global only when `sharedBudget` is
true.

## 42. Logging (D27)

Allowlist and redaction unchanged. Added: levels
(`MARKETDATA_LOG_LEVEL`), bounded field lengths, a pluggable sink, and
**deterministic sampling**.

Always logged in full: failures, skips, stale serves, fixture serves, errors —
anything an operator would want every instance of. Routine successes are
sampled 1-in-N (`MARKETDATA_LOG_SUCCESS_SAMPLE`, default 20; `1` logs all, `0`
disables). The decision is a stable FNV-1a hash of
`correlationId:outcome:providerId`, never `Math.random()`, so every line
belonging to one resolution is sampled together and tests are reproducible.

A sink failure never fails a request, and is reported **out-of-band** through
`onSinkError` — never back through the failing sink, which would recurse into
the failure it is reporting.

## 43. OpenTelemetry mapping (D29)

No SDK added. The mapping is 1:1 and documented in `metrics/prometheus.ts`:
`increment → Counter.add`, `observe → Histogram.record`,
`gauge → ObservableGauge`, labels → attributes verbatim. Future integrations
are adapters over this port, not changes to the pipeline.

---

---

# Part VII — Phase 4A: yield domain and provider trust

Domain foundation only. No adapter, no wiring, no policy change, no UI. The
recorded Treasury, Riksbank and Bundesbank payloads exist on disk but are
deliberately **not** committed until Phase 4B consumes them.

## 44. Provider trust

Trust attaches to **both** the access route and the originator, because they
differ in practice and in both directions:

| Provider            | Route trust    | Originator                         | Originator trust  |
| ------------------- | -------------- | ---------------------------------- | ----------------- |
| US Treasury _(4B)_  | `issuer`       | itself                             | —                 |
| Bundesbank _(4B)_   | `central-bank` | itself                             | —                 |
| **Riksbank** _(4B)_ | `central-bank` | **Refinitiv**                      | `licensed-vendor` |
| **Frankfurter**     | `aggregator`   | **European Central Bank**          | `central-bank`    |
| CoinGecko           | `aggregator`   | exchanges (no single one nameable) | —                 |
| Fixture             | `synthetic`    | —                                  | —                 |

A single field would have called Riksbank's Refinitiv series "central-bank
data" and Frankfurter's ECB rates "aggregator data". Both wrong, in opposite
directions.

`effectiveTrust(route, originator)` returns the **weaker** of the two: a chain
is only as trustworthy as its weakest link, so a central bank republishing a
vendor series yields vendor-grade provenance, and an aggregator republishing
the ECB does not thereby become a central bank. A test asserts the result is
never stronger than the route, across all 64 combinations.

`issuer` was added to the proposed taxonomy: for a _yield_, the entity that
issued the bond is the strongest provenance available, and it happens to be the
best US source.

Metadata only — nothing reads it for a decision. `ProviderCapabilityMetadata`
requires it, so a new provider cannot be registered without declaring one.

## 45. Canonical maturity, staged

`Maturity` (`1M`…`30Y`) and `MATURITY_MONTHS` are defined, and `buildYield`
derives `tenorMonths` from a maturity when given. It is **optional** in 4A for
one honest reason: the legacy PRNG curve uses tenors like 48 and 168 months
that have no canonical maturity, and forcing it would have changed the golden
snapshot — which is Phase 4B's sanctioned change, not 4A's. Supplying both a
maturity and a contradicting tenor is refused rather than silently resolved.

## 46. Yield methodology

`par-yield`, `constant-maturity`, `zero-coupon-fitted`,
`benchmark-bond-yield`, `specific-bond-quote`, `spot-rate` — **not**
interchangeable. `methodologiesAreComparable` permits exactly one pairing:
`par-yield` with `constant-maturity`, because a FRED DGS series _is_ the
Treasury par curve interpolated to a fixed tenor. Nothing else pairs.

`buildYieldCurve` now refuses a curve that mixes methodologies, mixes
observation dates, mixes issuers, or is empty; and it carries the single
`methodology` and `observationDate` its points share. Missing maturities are
absent, never interpolated.

`observationDate` is stored separately from `provenance.receivedAt`, which is
what makes a revision recognisable: same observation date, later receipt,
different value.

## 47. `official-daily`

A new `Quality`: an official statistic published once per business day.
`eod` implies a market close and `delayed` implies a real-time feed running
behind; a Treasury par yield is neither, having no intraday existence at all.

## 48. Decision: no `MarketObservation` supertype

Assessed and **declined**. The models are converging on _metadata_, not on the
observation body.

The evidence is in the phase history: Phases 2 and 3 added `changePeriod`,
`changeSource`, `sourcePrecision` and `requestedPrecision` to `MarketQuote`
alone, while `GovernmentYield` now needs `methodology`, `seriesId`, `maturity`
and `observationDate` that a quote must never have. Four fields landed on one
model when both needed them; four more landed on the other that the first must
not have.

A generic supertype would force `value: number`, discarding the unit. `Price`
and `YieldPercent` being _distinct branded types_ is the mechanism that stops a
yield rendering as a price — the same protection as basis-points-versus-percent
— and a common supertype hands it back.

**Recommended instead, for a future phase:** extract an `ObservationMetadata`
holding provenance, change period, change source and the two precision fields,
embedded by each model, with bodies staying type-specific. `NewsItem` and
`MarketSentiment` remain outside it entirely: one is content, one is derived,
and forcing them into an observation hierarchy would be modelling for symmetry
rather than for meaning.

---

---

# Part VIII — Phase 4B: government yields

Three keyless official sources. No FRED, no TradingView, no visual redesign.

## 49. Source mappings

| Row         | Provider        | Route trust    | Originator    | Effective trust       | Series id                                         | Methodology            |
| ----------- | --------------- | -------------- | ------------- | --------------------- | ------------------------------------------------- | ---------------------- |
| 10Y U.S.    | US Treasury     | `issuer`       | —             | `issuer`              | `BC_10YEAR`                                       | `par-yield`            |
| 2Y U.S.     | US Treasury     | `issuer`       | —             | `issuer`              | `BC_2YEAR`                                        | `par-yield`            |
| 10Y Germany | Bundesbank      | `central-bank` | —             | `central-bank`        | `D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A` | `zero-coupon-fitted`   |
| Sweden 10Y  | Riksbank (SWEA) | `central-bank` | **Refinitiv** | **`licensed-vendor`** | `SEGVB10YC`                                       | `benchmark-bond-yield` |
| Curve       | US Treasury     | `issuer`       | —             | `issuer`              | 13 `BC_*` tags                                    | `par-yield`            |

Four rows, three methodologies. They sit in one panel because each is that
country's own headline rate, which is normal presentation — but they may never
sit in one _curve_, and `buildYieldCurve` enforces that.

**Riksbank's `DEGVB10Y` is deliberately not a German fallback.** SWEA carries
it, but it is a Refinitiv benchmark rather than the Bundesbank's fitted zero
rate. Substituting one for the other on a failure is exactly what the
methodology type exists to prevent.

## 50. Per-country resolution

Yields resolve through **three separate chains**, because the sources, the
methodologies and the failure modes all differ:

```
yields-us:  treasury   → stale → fixture(non-prod) → error
yields-de:  bundesbank → stale → fixture(non-prod) → error
yields-se:  riksbank   → stale → fixture(non-prod) → error
curve-us:   treasury   → stale → fixture(non-prod) → error
```

`combineYieldEnvelopes` recombines them in display order and takes the **worst**
state of the parts: a partly-stale panel is stale, and a country that fails
outright surfaces as a degraded panel rather than three rows shown as though
nothing happened.

TTL 12 h, `maxStaleMs` 5 days, SWR off — an official daily observation is
either current or it is not. No budget or rate limit configured: all three
sources are public and uncapped.

## 51. Payload traps, each covered by a recorded fixture

- **Treasury**: an empty or `m:null` tag means no publication for that maturity
  that day. Skipped, never read as `0.00%`. `BC_1` and `BC_30YEARDISPLAY` are
  deliberately unmapped — an artefact and a presentation duplicate.
- **Bundesbank**: `;`-delimited CSV with a metadata preamble, **comma decimal
  separator**, and `.` / "Kein Wert vorhanden" on non-publication days. Rows
  that do not parse as a date and a number are dropped.
- **Riksbank**: JSON `[{date,value}]`, which is straightforward — the trap here
  is provenance, not parsing.

## 52. PRNG retirement

`RATE_CURVE = seededSeries(61, 14, 0.02)` is gone. It was 14 points of
mulberry32 noise with no maturities, no observation date and no source, drawn
as though it were a term structure. It is replaced by the real US par curve:
13 maturities, one methodology, one date, no interpolation.

The synthetic generator survives **only** for sparklines, which are Phase 6's
concern. A boundary test asserts no yield adapter references it.

**This was the last synthetic production yield data in the product.**

## 53. Design note: a future confidence score

Not implemented, and not required anywhere today. Recorded because the
provenance model already carries every input it would need, and writing that
down now is cheaper than rediscovering it later.

An observation's confidence would be a function of signals the `Envelope` and
`Provenance` already hold:

| Signal                  | Already available as                       | Direction                                                   |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Provider trust          | `source.trust`                             | `issuer` > `central-bank` > … > `synthetic`                 |
| Originator trust        | `source.originatorTrust`                   | combined via `effectiveTrust` — the weaker wins             |
| Methodology consistency | `GovernmentYield.methodology`              | a curve of one methodology scores above a mixed set         |
| Freshness               | `provenance.ageMs` vs the category TTL     | decays with age, relative to how often the source publishes |
| Stale state             | `Envelope.state`, `staleReason`            | `ok` > `stale` > `fixture`                                  |
| Fallback usage          | which chain position answered              | a first-choice source scores above a fallback               |
| Missing observations    | absent maturities in a curve               | a 13-point curve scores above a 4-point one                 |
| Source agreement        | two providers for one series               | agreement raises, disagreement lowers                       |
| Timestamp agreement     | differing `observationDate` for one series | a mismatch lowers confidence sharply                        |

Two rules it should keep, both learned in earlier phases:

1. **Never average disagreeing sources.** A discrepancy is information; hiding
   it in a mean destroys the information and invents a number neither source
   published. The discrepancy model — `source-disagreement`,
   `methodology-mismatch`, `timestamp-mismatch`, `instrument-mismatch` — should
   be recorded alongside a lowered score, not resolved by arithmetic.
2. **Confidence is not a substitute for provenance.** It is a summary for
   ranking and alerting. Anything user-visible must still be able to state its
   actual source, methodology and observation date, because a single number
   cannot carry "a Refinitiv benchmark via the Riksbank, published Friday".

The natural home is a derived field on the envelope, computed at resolution
time from data already present — no new domain model, and no adapter change.

---

---

# Part IX — Central bank policy rates (future module)

**Status: documentation only.** No domain model, no provider, no wiring, no UI.
Nothing in Part IX is implemented. The endpoints below were probed live on
2026-07-26 to establish that the proposal is buildable, not to build it.

## 54. Two domains, not one

The product must carry both perspectives and must never let one stand in for
the other.

|               | Government yields (Part VIII, built)            | Central bank policy rates (future)      |
| ------------- | ----------------------------------------------- | --------------------------------------- |
| Represents    | how the bond market prices growth and inflation | what the monetary authority has decided |
| Set by        | continuous market trading                       | a committee, at scheduled meetings      |
| Changes       | every business day                              | a handful of times per year, in steps   |
| Answers       | curve shape, term structure, borrowing costs    | policy stance, guidance, next decision  |
| Domain module | `domain/market/rates.ts`                        | future `domain/policy/`                 |

**The yield panel is unchanged and stays unchanged.** It continues to show US
Treasury par yields, the Bundesbank fitted zero rate and the Swedish benchmark
bond yield, with the methodology distinctions of §49 intact. Specifically
forbidden, now and later:

- the ECB deposit rate presented as, or substituted for, the German 10Y Bund
- a Federal Reserve rate presented as, or substituted for, a Treasury yield
- the Riksbank policy rate presented as, or substituted for, `SEGVB10YC`
- any fallback chain that crosses between the two domains

The product value is precisely in the gap between them. A user should be able
to see that the Fed held while the 2Y sold off, that the ECB cut while the Bund
steepened, or that Swedish market yields are pricing faster easing than the
Riksbank is signalling. Collapsing both into one "rates" object destroys the
only thing that makes those observations possible.

## 55. Proposed domain contract, evaluated

The proposed `CentralBankPolicyRate` is close, and three changes are worth
making before it is implemented.

**(a) The Fed's rate is a range, so make the shape a union, not optional
fields.** A flat interface with `currentRatePercent` plus optional
`lowerBoundPercent` / `upperBoundPercent` admits two illegal states: a
target-range bank with no bounds, and a single-rate bank with them. Worse, it
forces a scalar for the Fed — and the only available scalars are a midpoint
nobody publishes (3.625%) or a silently chosen bound. Modelling it as a
discriminated union means the question never arises:

```ts
type PolicyRateLevel =
  | { kind: 'single'; ratePercent: PolicyRatePercent }
  | {
      kind: 'target-range'
      lowerPercent: PolicyRatePercent
      upperPercent: PolicyRatePercent
    }
```

Presentation formats a range as a range. Nothing in the domain has to invent a
midpoint, and the type makes "the Fed's policy rate is 3.63%" — which is the
_effective_ rate, a different measure — unrepresentable.

**(b) Decision date and effective date are different dates.** The ECB announces
on a Thursday with the change effective the following Wednesday; the Fed's
change is effective the day after the announcement. One field cannot carry
both, and the difference is exactly the kind of thing a macro reader cares
about. Carry `decisionDate` and `effectiveDate` separately.

**(c) A rate is state; a decision is an event; a calendar is a third thing.**
Folding `nextMeetingDate` and `statementUrl` into the rate object means every
refresh of a daily rate series drags along communication metadata it did not
observe. Three models, resolved by three capabilities:

```ts
interface CentralBankPolicyRate {
  centralBank: CentralBankId // 'federal-reserve' | 'ecb' | 'riksbank'
  jurisdiction: string
  currency: IsoCurrencyCode
  rateType: PolicyRateType // 'target-range' | 'deposit-facility'
  //  | 'policy-rate' | 'repo-rate' | 'other'
  level: PolicyRateLevel
  previousLevel: PolicyRateLevel | null
  changeBasisPoints: BasisPoints | null // null when the previous level is unknown
  decisionDate: string // when the committee decided
  effectiveDate: string // when the rate began to apply
  seriesId: string
  provenance: Provenance
}

interface CentralBankDecision {
  centralBank: CentralBankId
  decisionDate: string
  outcome: 'raise' | 'hold' | 'cut'
  changeBasisPoints: BasisPoints | null
  statementUrl: string | null
  publishedAt: string
  provenance: Provenance
}

interface CentralBankMeeting {
  centralBank: CentralBankId
  scheduledDate: string
  isConfirmed: boolean // see the calendar caveat in §56
  kind: 'rate-decision' | 'non-policy' | 'projections'
  provenance: Provenance
}
```

**Use a distinct brand.** `PolicyRatePercent` must not be `YieldPercent`. Two
brands over the same runtime number cost nothing and make the central rule of
Part IX a compile error rather than a code-review question: a policy rate
cannot be passed where a yield is expected, in either direction.

**`changeBasisPoints` for a range.** Both bounds move together by convention,
but the domain should compute the delta from the union rather than assume it —
and refuse rather than guess if the two bounds ever moved by different amounts.

## 56. Official source hierarchy — Federal Reserve

All rows below verified live, keyless, on 2026-07-26.

| Datum                  | Source                           | Endpoint                                                 | Verified                     |
| ---------------------- | -------------------------------- | -------------------------------------------------------- | ---------------------------- |
| FOMC target range      | Federal Reserve Bank of New York | `markets.newyorkfed.org/api/rates/unsecured/effr/last/N` | 3.50–3.75%, eff. 2026-07-23  |
| Effective fed funds    | Federal Reserve Bank of New York | same payload, `percentRate`                              | 3.63%                        |
| Statement timestamps   | Federal Reserve Board            | `federalreserve.gov/feeds/press_monetary.xml` (RSS)      | HTTP 200, `text/xml`         |
| Meeting calendar       | Federal Reserve Board            | `federalreserve.gov/monetarypolicy/fomccalendars.htm`    | HTML only — see caveat       |
| Historical convenience | FRED (`DFEDTARU` / `DFEDTARL`)   | requires an API key                                      | **secondary only, deferred** |

The NY Fed payload is a good find: one keyless response carries both the
**target range** (`targetRateFrom` / `targetRateTo`) and the **effective rate**
(`percentRate`), clearly separated, with the operating-desk percentiles and
volume alongside. That removes the need for FRED to obtain the target range at
all, which keeps a future Phase 6A keyless like Phase 4B.

Trust: route `central-bank` (the New York Fed), originator the FOMC. Both are
`central-bank` grade, so `effectiveTrust` is unaffected — but the originator
should still be recorded, because the desk publishes what the committee set.

The four measures that must never be conflated:

1. **target range** — what the FOMC decided
2. **effective federal funds rate** — where the market actually traded within it
3. **Treasury yields** — a different domain entirely (Part VIII)
4. **market-implied expectations** — a different capability entirely (§59)

## 57. Official source hierarchy — European Central Bank

The ECB Data Portal is keyless SDMX. Verified live 2026-07-26:

| Rate                           | Series key                     | Value     |
| ------------------------------ | ------------------------------ | --------- |
| **Deposit facility (primary)** | `FM.D.U2.EUR.4F.KR.DFR.LEV`    | **2.25%** |
| Main refinancing operations    | `FM.D.U2.EUR.4F.KR.MRR_FR.LEV` | 2.40%     |
| Marginal lending facility      | `FM.D.U2.EUR.4F.KR.MLFR.LEV`   | 2.65%     |

The **deposit facility rate is the primary policy-stance indicator**, since it
is the rate that steers short-term money market rates under the current
operational framework. MRO and MLF should be carried in the model but presented
as the corridor around it, not as competing headline rates, unless a later
product spec asks for all three.

Statement and press-conference timestamps: `ecb.europa.eu/rss/press.html`
(HTTP 200, `application/rss+xml`). Governing Council calendar: HTML only.

**Payload trap — the step-series problem.** These are daily series that carry
the last set value forward, so 2026-07-26 returns 2.25% whether or not anything
happened that day. The observation date is therefore **not** the effective
date. A future adapter must scan back for the last value _change_ to derive
`effectiveDate`, and must never report today's date as the date the rate was
set. This is the same failure mode as Frankfurter's v2 carry-forward (§26) and
must be handled the same way: honestly, or not at all.

`format=csvdata` returns one flat row with a full metadata header including
`TITLE`, `DECIMALS` and `SOURCE_AGENCY` — cheaper to parse correctly than the
default SDMX-JSON, whose observations are positional arrays keyed by index.

## 58. Official source hierarchy — Riksbank

SWEA again — the same API Part VIII already consumes for yields. Verified live
2026-07-26:

| Datum           | Series            | Value                |
| --------------- | ----------------- | -------------------- |
| **Policy rate** | `SECBREPOEFF`     | **1.75%**            |
| Deposit rate    | corridor floor    | policy − 0.75pp      |
| Lending rate    | corridor ceiling  | policy + 0.75pp      |
| Statements      | `riksbank.se` RSS | HTTP 200, `text/xml` |

Three things the SWEA metadata makes explicit and a future adapter must honour:

- **The corridor rates are defined by rule**, not independently observed —
  SWEA's own description states they are always ±0.75pp from the policy rate.
  If they are ever displayed, that relationship should be stated rather than
  presented as three independent decisions.
- **The series was renamed.** SWEA records that the policy rate "was called The
  repo rate until June 8, 2022". `rateType` must reflect the period being
  displayed; relabelling the whole history as `repo-rate`, or as `policy-rate`,
  are both wrong.
- **The Riksbank publishes a forecast rate path** — a projection of its own
  future policy rate, which neither the Fed nor the ECB publishes in this form.
  It is a forecast, not an observation, and must never enter
  `CentralBankPolicyRate`. If it is ever shown it belongs in a distinct model
  with its own provenance and a visible forecast label.

That SWEA serves both `SEGVB10YC` (a market yield) and `SECBREPOEFF` (a policy
rate) from one keyless API is the clearest argument for separating these
domains at the **model** level rather than the provider level. The same adapter
seam, the same trust record, the same HTTP client — and two domain types that
cannot be substituted for one another.

## 59. Market-implied policy expectations — a separate capability

Not part of `CentralBankPolicyRate`, and not derivable from it. A dedicated
port, resolved separately:

```ts
interface PolicyExpectationProvider {
  fetchPolicyExpectations(
    bank: CentralBankId,
    ctx: RequestContext,
  ): Promise<PolicyExpectation[]>
}
```

**Nothing is displayed until all seven of these are documented for the specific
source:** underlying instruments, calculation methodology, observation
timestamp, assumptions, probability normalisation, source licensing, and
whether the result is **provider-supplied or internally derived**. That last
flag is not optional metadata — a probability we computed and a probability CME
published are different claims and must be visibly different.

Candidates for later evaluation, none approved: CME FedWatch or an approved
futures-derived calculation for the Fed; OIS or short-rate futures for the ECB;
FRA/OIS or equivalent Swedish instruments for the Riksbank. All three are
licensed or non-keyless, so none can follow the Phase 4B pattern.

**Explicitly forbidden:** inferring a probability distribution from analyst
commentary, from the history of past policy moves, or from the shape of the
government yield curve. A fabricated distribution is worse than an absent one,
because it looks like a measurement.

## 60. Architecture separation

```
domain/market/rates.ts        GovernmentYield, YieldCurve, YieldMethodology   [built]
domain/policy/*.ts            CentralBankPolicyRate, Decision, Meeting        [future]
                              PolicyRatePercent — a brand distinct from YieldPercent

application/marketData/ports  + PolicyRateProvider, + PolicyExpectationProvider
policy.ts categories          + policy-us, policy-ea, policy-se

application layer only:
  interface RatesSnapshot {
    governmentYields: GovernmentYield[]
    yieldCurves: YieldCurve[]
    centralBanks: CentralBankPolicyRate[]
  }
```

`RatesSnapshot` is a **presentation composition**, assembled at the application
boundary from two independently resolved domains. It is not a domain model, it
has no shared identity, and neither side may fall back to the other. The
import-graph fitness test should be extended to assert that `domain/policy` and
`domain/market` do not import each other.

## 61. Future UI, documented only

A separate Central Banks section, not a widening of the yield panel. Per bank:
current rate (a range for the Fed, the DFR for the ECB, the policy rate for
Sweden), latest change with its decision and effective dates, next scheduled
meeting, latest statement link, and — only once §59 is satisfied — market-implied
next move.

**The current Overview is not redesigned in this phase.** The existing yield
cards keep their present content and layout.

**Calendar caveat.** Both the FOMC and Governing Council calendars are HTML
pages; neither offers a machine-readable feed, and scraping them is out of
scope on the same grounds as the TradingView investigation. `nextMeetingDate`
therefore has no automatic official source today. The honest options are a
curated schedule with `quality: 'fixture'` and a visible provenance of "manually
entered from the published calendar", or omitting the field until a feed exists.
It must not be silently interpolated from past meeting cadence.

## 62. Capability boundaries for future agents

Documented so the domain separation survives contact with agents. None of these
are implemented.

| Agent        | Reads                                                 | Must not                                     |
| ------------ | ----------------------------------------------------- | -------------------------------------------- |
| Macro        | policy rates, yield curves, inflation, growth, labour | treat a yield move as a policy decision      |
| Central Bank | decisions, statements, minutes, speeches, guidance    | infer a decision from a market rate          |
| Rates        | yields, curve shape, real rates, implied paths        | present an implied path as official guidance |
| CIO          | both domains, plus portfolio state                    | resolve a divergence by averaging the two    |

The shared rule: an agent may **join** the two domains and describe the gap
between them, which is the entire point. It may never use one as evidence of
the other, and any statement it makes must be able to name which domain each
number came from.

## 63. Sequencing

Phase 5 (Swedish equities) is next and is unaffected by Part IX. The central
bank work is **Phase 6A — Central Bank Policy Data**, to be scheduled after
Phase 5 if that ordering still holds. Its prerequisites are the `domain/policy`
module, the `PolicyRatePercent` brand, the three category entries, and a
decision on the calendar caveat in §61.

---

---

# Part X — Portfolio: three modes (future module)

**Status: documentation only.** Nothing here is implemented. Recorded now
because the portfolio page is the last legacy route to migrate, and what it
should _become_ is a product decision that must be settled before the
engineering one.

## 64. The constraint that decides everything

`avanza-mcp` wraps Avanza's **public, unauthenticated** market-data API. No
login, no account access, no positions. There is therefore **no source that
could make the current portfolio page real**, and no amount of architecture
changes that.

So the honest framing is not "migrate portfolio to live data". It is: decide
which of three products the page is, and build that.

## 65. Mode 1 — Demo portfolio

Deterministic, fixture-backed holdings. What exists today.

- `trust: 'synthetic'`, `quality: 'fixture'` on every value
- identified as demo or model data in the UI, not merely in a footnote
- suitable for development, product demonstration, screenshots and tests
- **may never be presented as a connected account**

The page already carries `Exempeldata` in its description and the application's
own meta description says all data in this version is example data. That is a
real disclosure and it is why this is not currently a product-integrity defect.
What it lacks is _structural_ enforcement: the disclosure is prose a future
edit can delete, not a property of the data.

Mode 1's engineering work is therefore small and worth doing regardless of
which mode follows: give the page a `domain/portfolio` model whose values carry
provenance, so "this is synthetic" travels with the numbers rather than sitting
beside them.

## 66. Mode 2 — Manually managed portfolio

The user enters or imports their own holdings.

- **user-owned data**, which is a new category for this system entirely: every
  domain so far is public market data with no owner
- no claim of broker synchronization, ever
- market values computed from real quotes where the instrument is covered —
  which is exactly what the Phase 5 catalog and the Avanza adapter already do
- an explicit "as of" per position, since a manual entry ages differently from
  a quote

Architecturally this is the first time the system needs **persistence it owns**
rather than a cache it can discard. That is a genuine step change: a cache may
be lost without consequence, user data may not. It brings storage, backup,
export and deletion obligations with it.

It also introduces the first instrument-coverage gap that a user can create.
Someone will enter a holding this product has no quote for, and the honest
answer — a position with a cost basis, no market value, and a visible reason —
must be designed rather than discovered.

## 67. Mode 3 — Connected portfolio

An authenticated broker, custodian or bank integration.

This is a materially different product with obligations the current system has
none of:

- explicit, revocable user consent per connection
- secure credential and token handling — refresh, rotation, revocation, and
  storage that is not `process.env`
- account and position provenance: which institution, which account, when
- synchronization timestamps distinct from market-data timestamps, because a
  position can be stale while its price is fresh
- reconciliation: what happens when the broker and our view disagree, which is
  a _discrepancy_ in exactly the sense §53 describes and must not be resolved
  by averaging or by silently preferring one side
- error handling for partial syncs, expired consent and revoked access

The provenance model already extends to this cleanly — an account balance has a
source, an as-of and a trust level like any other observation. What does not
exist is authentication, authorization, secret management or an audit trail.
**This mode must not be attempted before the application has real
authentication**, and that is a prerequisite, not a detail.

## 68. The rule that holds across all three

**No fixture-backed portfolio data may be presented as a live connected account
in production.**

Structurally, not by convention. The mechanism already exists: `allowFixture:
'non-production'` is what stops a fixture quote reaching live mode, and the
same policy should govern portfolio values once they are envelopes.

If distinguishing the modes needs a small visual change — a badge, a label, a
different treatment for demo values — that is a **sanctioned product-integrity
change**, proposed and approved on its own terms. It is not a candidate for
being quietly skipped to keep the visual lock intact. The lock exists to
prevent unrequested redesign, not to prevent the product from telling the truth
about its own data.

## 69. Sequencing

Portfolio is **last** in the C1 migration order, after watchlist, markets,
agents and reports. That ordering is deliberate: the other four teach the
migration pattern on data this system already has, while portfolio is the one
that needs a product decision first.

Mode 1 is the only mode in scope for the C1 migration itself. Modes 2 and 3
are separate phases with their own gates, and Mode 3 depends on authentication
that does not exist yet.
