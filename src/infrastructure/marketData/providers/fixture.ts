/**
 * Fixture provider — the always-available tail of every fallback chain.
 *
 * Reproduces the pre-migration Overview exactly, as domain models rather than
 * localized strings, so Phase 0 can rewire the data path without changing what
 * the screen renders.
 *
 * Two guarantees this module must keep:
 *
 *  1. **Deterministic.** Time comes from `ctx.clock`; there is no `Date.now()`
 *     and no unseeded randomness. The same clock always yields the same
 *     output, on any machine.
 *  2. **Honestly labelled.** Everything it returns is stamped
 *     `quality: 'fixture'`, and every category's `FallbackPolicy` sets
 *     `allowFixture: 'non-production'`, so none of it can reach a production
 *     user.
 */

import {
  buildDerivedSentiment,
  buildNewsItem,
  buildProvenance,
  buildQuote,
  buildSeries,
  buildYield,
  buildYieldCurve,
  instrumentRef,
  labelForScore,
  SENTIMENT_BASELINE,
  type CanonicalSymbol,
  type DataSourceMetadata,
  type GovernmentYield,
  type MarketQuote,
  type MarketSentiment,
  type MarketSeries,
  type NewsItem,
  type Provenance,
  type SeriesRange,
  type YieldCurve,
} from '~/domain/market'
import { SERIES_RANGES } from '~/domain/market'
import type {
  CommodityProvider,
  CryptoProvider,
  FetchContext,
  FxProvider,
  NewsProvider,
  NewsQuery,
  QuoteProvider,
  SentimentProvider,
  SeriesProvider,
  YieldProvider,
} from '~/application/marketData/ports'
import {
  FIXTURE_COMMODITY_QUOTES,
  FIXTURE_CRYPTO_QUOTES,
  FIXTURE_FX_QUOTES,
  FIXTURE_INDEX_QUOTES,
  FIXTURE_INTRADAY_POINTS,
  FIXTURE_INTRADAY_START_HOUR,
  FIXTURE_INTRADAY_STEP_MINUTES,
  FIXTURE_INTRADAY_SYMBOLS,
  FIXTURE_NEWS,
  FIXTURE_SECTOR_CHANGES,
  FIXTURE_SENTIMENT_SCORE,
  FIXTURE_WATCHLIST,
  FIXTURE_YIELD_CURVE_POINTS,
  FIXTURE_YIELD_CURVE_SEED,
  FIXTURE_YIELDS,
  type FixtureQuote,
} from './fixture/data'
import { syntheticSeries } from './fixture/syntheticSeries'

export const FIXTURE_SOURCE: DataSourceMetadata = {
  providerId: 'fixture',
  providerName: 'Exempeldata',
}

const MINUTE_MS = 60_000

/* --------------------------------------------------------------- time utils */

/** Offset of `timeZone` from UTC at `date`, in ms. DST-correct. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return asUtc - date.getTime()
}

/** The instant at which it is `hour:00` in Stockholm on `reference`'s local day. */
function stockholmHourOn(reference: Date, hour: number): Date {
  const zone = 'Europe/Stockholm'
  const offset = zoneOffsetMs(reference, zone)
  const local = new Date(reference.getTime() + offset)
  const utcForLocalHour = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    hour,
    0,
    0,
    0,
  )
  return new Date(utcForLocalHour - offset)
}

/* ------------------------------------------------------------- provenance */

function fixtureProvenance(ctx: FetchContext, asOf?: string): Provenance {
  const now = ctx.clock.now()
  return buildProvenance({
    asOf: asOf ?? now.toISOString(),
    nowMs: now.getTime(),
    source: FIXTURE_SOURCE,
    quality: 'fixture',
  })
}

/* ------------------------------------------------------------------ quotes */

function toQuote(fixture: FixtureQuote, ctx: FetchContext): MarketQuote {
  // previousClose is derived from the day change so the two can never
  // disagree — the legacy mock carried the change alone and no close at all.
  const previousClose = fixture.value / (1 + fixture.changePercent / 100)
  return buildQuote({
    symbol: fixture.symbol,
    value: fixture.value,
    previousClose,
    session: 'unknown',
    provenance: fixtureProvenance(ctx),
  })
}

const ALL_QUOTES: FixtureQuote[] = [
  ...FIXTURE_INDEX_QUOTES,
  ...FIXTURE_FX_QUOTES,
  ...FIXTURE_COMMODITY_QUOTES,
  ...FIXTURE_CRYPTO_QUOTES,
  ...FIXTURE_WATCHLIST.map((item) => ({
    symbol: item.symbol,
    value: item.price,
    changePercent: item.changePercent,
  })),
  ...FIXTURE_SECTOR_CHANGES.map((sector) => ({
    // Sector tiles render only a percentage; the level is a placeholder that
    // the UI never displays. Kept non-zero so `previousClose` stays derivable.
    symbol: sector.symbol,
    value: 100,
    changePercent: sector.changePercent,
  })),
]

function quotesFor(
  symbols: readonly CanonicalSymbol[],
  ctx: FetchContext,
): MarketQuote[] {
  return symbols.map((symbol) => {
    const fixture = ALL_QUOTES.find((quote) => quote.symbol === symbol)
    if (!fixture) throw new Error(`No fixture quote for ${symbol}`)
    return toQuote(fixture, ctx)
  })
}

/* ------------------------------------------------------------------ series */

/** Tile sparkline: 16 points, drift signed by the day move — legacy seeds. */
function sparklineSeries(symbol: CanonicalSymbol, ctx: FetchContext): MarketSeries {
  const fixture = FIXTURE_INDEX_QUOTES.find((quote) => quote.symbol === symbol)
  if (!fixture?.sparkSeed) throw new Error(`No fixture sparkline for ${symbol}`)
  const values = syntheticSeries(
    fixture.sparkSeed,
    16,
    fixture.changePercent >= 0 ? 0.16 : -0.16,
  )
  const now = ctx.clock.now()
  return buildSeries({
    symbol,
    interval: '15m',
    points: values.map((v, i) => ({
      t: new Date(now.getTime() - (values.length - 1 - i) * 15 * MINUTE_MS).toISOString(),
      v,
    })),
    provenance: fixtureProvenance(ctx),
  })
}

/**
 * Intraday comparison series. 33 points at 15-minute steps from 09:00 to
 * 17:00 Stockholm, matching the legacy grid, with the same per-range and
 * per-series seeds so the rendered chart geometry is unchanged.
 */
function intradaySeries(range: SeriesRange, ctx: FetchContext): MarketSeries[] {
  const rangeIndex = SERIES_RANGES.indexOf(range)
  const rangeSeed = rangeIndex * 97 + 29
  const start = stockholmHourOn(ctx.clock.now(), FIXTURE_INTRADAY_START_HOUR)

  return FIXTURE_INTRADAY_SYMBOLS.map((symbol, index) => {
    const values = syntheticSeries(
      rangeSeed + index * 13,
      FIXTURE_INTRADAY_POINTS,
      0.08 + index * 0.01,
    )
    return buildSeries({
      symbol,
      interval: '15m',
      points: values.map((v, i) => ({
        t: new Date(
          start.getTime() + i * FIXTURE_INTRADAY_STEP_MINUTES * MINUTE_MS,
        ).toISOString(),
        v: Number(v.toFixed(2)),
      })),
      provenance: fixtureProvenance(ctx),
    })
  })
}

/** Watchlist sparkline: literal series from the legacy mock. */
function watchlistSeries(symbol: CanonicalSymbol, ctx: FetchContext): MarketSeries {
  const item = FIXTURE_WATCHLIST.find((entry) => entry.symbol === symbol)
  if (!item) throw new Error(`No fixture watchlist series for ${symbol}`)
  const now = ctx.clock.now()
  return buildSeries({
    symbol,
    interval: '1h',
    points: item.spark.map((v, i) => ({
      t: new Date(
        now.getTime() - (item.spark.length - 1 - i) * 60 * MINUTE_MS,
      ).toISOString(),
      v,
    })),
    provenance: fixtureProvenance(ctx),
  })
}

/* ------------------------------------------------------------------- yields */

function yieldsFor(
  symbols: readonly CanonicalSymbol[],
  ctx: FetchContext,
): GovernmentYield[] {
  return symbols.map((symbol) => {
    const fixture = FIXTURE_YIELDS.find((entry) => entry.symbol === symbol)
    if (!fixture) throw new Error(`No fixture yield for ${symbol}`)
    return buildYield({
      symbol: fixture.symbol,
      countryCode: fixture.countryCode,
      tenorMonths: fixture.tenorMonths,
      yieldPercent: fixture.yieldPercent,
      previousYieldPercent: fixture.yieldPercent - fixture.changeBasisPoints / 100,
      provenance: fixtureProvenance(ctx),
    })
  })
}

/**
 * Curve preview. Still the legacy synthetic shape — Phase 4 replaces it with a
 * real term structure (defects D6/D9). Kept only because it is fixture data,
 * barred from production, and Phase 0's contract is to change nothing visible.
 */
function yieldCurveFor(countryCode: string, ctx: FetchContext): YieldCurve {
  const values = syntheticSeries(
    FIXTURE_YIELD_CURVE_SEED,
    FIXTURE_YIELD_CURVE_POINTS,
    0.02,
  )
  const provenance = fixtureProvenance(ctx)
  return buildYieldCurve({
    countryCode,
    points: values.map((v, i) =>
      buildYield({
        symbol: FIXTURE_YIELDS[0]!.symbol,
        countryCode,
        // Synthetic tenor ladder; not a real maturity structure.
        tenorMonths: (i + 1) * 12,
        yieldPercent: v,
        provenance,
      }),
    ),
    provenance,
  })
}

/* -------------------------------------------------------------------- news */

function newsFor(query: NewsQuery, ctx: FetchContext): NewsItem[] {
  const now = ctx.clock.now()
  return FIXTURE_NEWS.slice(0, query.limit).map((item) =>
    buildNewsItem({
      id: item.id,
      headline: item.headline,
      outlet: item.outlet,
      publishedAt: new Date(
        now.getTime() - item.publishedMinutesAgo * MINUTE_MS,
      ).toISOString(),
      provenance: fixtureProvenance(ctx),
    }),
  )
}

/* --------------------------------------------------------------- sentiment */

function sentimentFor(ctx: FetchContext): MarketSentiment {
  const now = ctx.clock.now()
  // A single opaque component: the legacy gauge was a literal, not a computed
  // signal, and pretending otherwise would be the laundering `origin` exists
  // to prevent. Phase 8 replaces this with a real derived score.
  const sentiment = buildDerivedSentiment({
    components: [
      {
        id: 'fixture-position',
        label: 'Exempelvärde',
        contribution: FIXTURE_SENTIMENT_SCORE - SENTIMENT_BASELINE,
        inputValue: FIXTURE_SENTIMENT_SCORE,
        inputAsOf: now.toISOString(),
        inputQuality: 'fixture',
      },
    ],
    formulaVersion: 'fixture',
    nowMs: now.getTime(),
    source: FIXTURE_SOURCE,
  })
  return { ...sentiment, label: labelForScore(sentiment.score) }
}

/* ---------------------------------------------------------------- provider */

export interface FixtureProvider
  extends
    QuoteProvider,
    SeriesProvider,
    FxProvider,
    YieldProvider,
    CommodityProvider,
    CryptoProvider,
    NewsProvider,
    SentimentProvider {
  /** Sparkline for one Overview tile. Not part of any port — Phase 0 helper. */
  fetchSparkline(symbol: CanonicalSymbol, ctx: FetchContext): Promise<MarketSeries>
  fetchWatchlistSeries(symbol: CanonicalSymbol, ctx: FetchContext): Promise<MarketSeries>
  fetchIntraday(range: SeriesRange, ctx: FetchContext): Promise<MarketSeries[]>
}

export function createFixtureProvider(): FixtureProvider {
  return {
    id: 'fixture',
    name: 'Exempeldata',

    async fetchQuotes(symbols, ctx) {
      return quotesFor(symbols, ctx)
    },
    async fetchFxRates(pairs, ctx) {
      return quotesFor(pairs, ctx)
    },
    async fetchCommodities(symbols, ctx) {
      return quotesFor(symbols, ctx)
    },
    async fetchCrypto(symbols, ctx) {
      return quotesFor(symbols, ctx)
    },
    async fetchYields(symbols, ctx) {
      return yieldsFor(symbols, ctx)
    },
    async fetchYieldCurve(countryCode, ctx) {
      return yieldCurveFor(countryCode, ctx)
    },
    async fetchNews(query, ctx) {
      return newsFor(query, ctx)
    },
    async fetchSentiment(ctx) {
      return sentimentFor(ctx)
    },
    async fetchSeries(symbol, _interval, _range, ctx) {
      return sparklineSeries(symbol, ctx)
    },
    async fetchSparkline(symbol, ctx) {
      return sparklineSeries(symbol, ctx)
    },
    async fetchWatchlistSeries(symbol, ctx) {
      return watchlistSeries(symbol, ctx)
    },
    async fetchIntraday(range, ctx) {
      return intradaySeries(range, ctx)
    },
  }
}

/** Instrument reference data, re-exported so the snapshot can carry it. */
export function fixtureInstrumentRef(symbol: CanonicalSymbol) {
  return instrumentRef(symbol)
}
