/**
 * Frankfurter — ECB reference rates.
 *
 * **This is not real-time data.** The ECB publishes one reference rate per
 * currency per TARGET business day, at roughly 16:00 CET. It is a reference,
 * not a tradeable quote, and there is no intraday movement to report. Every
 * decision below follows from that.
 *
 * ## Why v1 and not v2
 *
 * Probed on Sunday 2026-07-26, when the ECB had last published on Friday:
 *
 *   v1  → {"date":"2026-07-24","rates":{"SEK":9.717}}      honest
 *   v2  → [{"date":"2026-07-26","rate":9.7253}]            today's date, Friday's data
 *
 * v2 carries the last value forward onto non-publication days and stamps it
 * with the current date. Using it would silently destroy the real source
 * timestamp, so this adapter targets v1 only.
 *
 * ## What it does NOT do
 *
 *  - does not describe itself as real-time or delayed (`quality: 'eod'`)
 *  - does not fabricate a publication time from a publication date
 *  - does not fabricate intraday movement — the change it reports spans two
 *    consecutive publications, and says so via `changePeriod`
 *  - does not pad precision the source did not supply
 *  - does not retry, time out, cache or fall back; the pipeline owns those
 */

import {
  buildQuote,
  buildSeries,
  canonicalSymbol,
  decimalsOf,
  type CanonicalSymbol,
  type DataSourceMetadata,
  type MarketQuote,
  type MarketSeries,
} from '~/domain/market'
import type {
  FetchContext,
  FxProvider,
  SeriesProvider,
} from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'

export const FRANKFURTER_PROVIDER_ID = 'frankfurter'

export const FRANKFURTER_SOURCE: DataSourceMetadata = {
  providerId: FRANKFURTER_PROVIDER_ID,
  // Names the actual origin of the numbers, not just the API in front of them.
  providerName: 'Frankfurter (ECB reference rates)',
  attributionUrl: 'https://frankfurter.dev',
  licenseNote:
    'European Central Bank reference rates, published each TARGET business day',
  // Frankfurter is the route; the ECB produces the numbers. Naming
  // Frankfurter as the source would understate the provenance exactly as
  // badly as naming a redistributor overstates it elsewhere.
  originator: 'European Central Bank',
  trust: 'aggregator',
  originatorTrust: 'central-bank',
}

const BASE_URL = 'https://api.frankfurter.dev/v1'

/**
 * How far back to ask. Long enough to span a long weekend plus a holiday, so
 * the response always contains at least two publications and a change can be
 * derived without a second call.
 */
const LOOKBACK_DAYS = 10

/* ------------------------------------------------------------ wire contract */
/* Declared here and never exported: a provider's response shape must not
 * escape its adapter. The import-graph test enforces that.                   */

interface FrankfurterTimeSeries {
  amount: number
  base: string
  start_date: string
  end_date: string
  /** date -> { CURRENCY: rate } */
  rates: Record<string, Record<string, number>>
}

function isTimeSeries(value: unknown): value is FrankfurterTimeSeries {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<FrankfurterTimeSeries>
  return (
    typeof candidate.base === 'string' &&
    typeof candidate.rates === 'object' &&
    candidate.rates !== null
  )
}

/* --------------------------------------------------------- symbol mapping */

interface PairMapping {
  base: string
  quote: string
}

/** Canonical symbol → the ECB currency pair. An unmapped symbol throws. */
const PAIRS: Record<string, PairMapping> = {
  'fx:usdsek': { base: 'USD', quote: 'SEK' },
  'fx:eurusd': { base: 'EUR', quote: 'USD' },
  'fx:eursek': { base: 'EUR', quote: 'SEK' },
}

function pairFor(symbol: CanonicalSymbol): PairMapping {
  const pair = PAIRS[symbol]
  if (!pair) {
    throw new HttpError('not-found', `Frankfurter has no mapping for ${symbol}`)
  }
  return pair
}

/* ------------------------------------------------------------- timestamps */

/** UTC offset of Europe/Brussels at `date`, in minutes. DST-correct. */
function brusselsOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Brussels',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
  )
  return (asUtc - date.getTime()) / 60_000
}

/**
 * ESTIMATED publication instant — 16:00 Europe/Brussels on the publication
 * date, DST-correct.
 *
 * Operational metadata only. It is never used as `asOf` and never feeds
 * `ageMs`; inventing a time for a date-precision source and then treating it
 * as fact would replace one fabrication with another.
 */
export function estimatedEcbPublicationAt(sourceDate: string): string {
  const midnightUtc = new Date(`${sourceDate}T00:00:00Z`)
  const offsetMinutes = brusselsOffsetMinutes(midnightUtc)
  return new Date(
    Date.UTC(
      midnightUtc.getUTCFullYear(),
      midnightUtc.getUTCMonth(),
      midnightUtc.getUTCDate(),
      16,
      0,
      0,
    ) -
      offsetMinutes * 60_000,
  ).toISOString()
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------ normalization */

/** The two most recent publications, oldest first. */
function lastTwoPublications(
  series: FrankfurterTimeSeries,
  currency: string,
): Array<{ date: string; rate: number }> {
  return Object.entries(series.rates)
    .map(([date, rates]) => ({ date, rate: rates[currency] }))
    .filter(
      (entry): entry is { date: string; rate: number } => typeof entry.rate === 'number',
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-2)
}

function toQuote(
  symbol: CanonicalSymbol,
  series: FrankfurterTimeSeries,
  ctx: FetchContext,
): MarketQuote {
  const { quote: currency } = pairFor(symbol)
  const publications = lastTwoPublications(series, currency)
  const latest = publications.at(-1)
  if (!latest) {
    throw new HttpError(
      'schema',
      `Frankfurter returned no ${currency} rate for ${symbol}`,
    )
  }
  const previous = publications.length > 1 ? publications[0] : undefined
  const now = ctx.clock.now()

  return buildQuote({
    symbol,
    value: latest.rate,
    // Only when a genuinely earlier publication exists. With one data point
    // the change is unknown, and `null` says so rather than implying zero.
    previousClose: previous?.rate ?? null,
    // Two consecutive ECB publications. NOT an intraday move.
    changePeriod: 'publication-to-publication',
    // 9.717 must render as 9,717, not 9,7170.
    sourcePrecision: decimalsOf(latest.rate),
    session: 'unknown',
    provenance: {
      // Midnight UTC of the publication date: the date is all the ECB gave us,
      // and this errs toward over-stating age, which is the safe direction.
      asOf: `${latest.date}T00:00:00.000Z`,
      asOfPrecision: 'date',
      sourceDate: latest.date,
      estimatedPublicationAt: estimatedEcbPublicationAt(latest.date),
      receivedAt: now.toISOString(),
      ageMs: Math.max(
        0,
        now.getTime() - new Date(`${latest.date}T00:00:00.000Z`).getTime(),
      ),
      source: FRANKFURTER_SOURCE,
      // An official end-of-day figure, not a late real-time quote — so it is
      // 'eod' and explicitly NOT delayed.
      quality: 'eod',
      isDelayed: false,
      delayMinutes: null,
      isProxy: false,
    },
  })
}

/* ---------------------------------------------------------------- provider */

/** The ECB's reference rates for a pair over a window, one point per publication date. */
function toSeries(
  symbol: CanonicalSymbol,
  series: FrankfurterTimeSeries,
  window: { from: string; to: string },
  ctx: FetchContext,
): MarketSeries {
  const { quote: currency } = pairFor(symbol)
  const points = Object.entries(series.rates)
    .map(([date, rates]) => ({ date, rate: rates[currency] }))
    .filter(
      (entry): entry is { date: string; rate: number } =>
        typeof entry.rate === 'number' &&
        entry.date >= window.from &&
        entry.date <= window.to,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({ t: `${entry.date}T00:00:00.000Z`, v: entry.rate }))
  const latest = points[points.length - 1]
  if (!latest) {
    throw new HttpError(
      'schema',
      `Frankfurter returned no ${currency} rates for ${symbol} in the window`,
    )
  }
  const now = ctx.clock.now()
  const latestDate = latest.t.slice(0, 10)
  return buildSeries({
    symbol,
    interval: '1d',
    points,
    provenance: {
      asOf: latest.t,
      asOfPrecision: 'date',
      sourceDate: latestDate,
      estimatedPublicationAt: estimatedEcbPublicationAt(latestDate),
      receivedAt: now.toISOString(),
      ageMs: Math.max(0, now.getTime() - Date.parse(latest.t)),
      source: FRANKFURTER_SOURCE,
      quality: 'eod',
      isDelayed: false,
      delayMinutes: null,
      isProxy: false,
    },
  })
}

export function createFrankfurterProvider(http: HttpClient): FxProvider & SeriesProvider {
  return {
    id: FRANKFURTER_PROVIDER_ID,
    name: FRANKFURTER_SOURCE.providerName,
    attributionUrl: FRANKFURTER_SOURCE.attributionUrl,

    /** The reference-rate history of a pair: the same time-series endpoint the quote reads, over the window asked for. */
    async fetchSeries(symbol, interval, range, ctx): Promise<MarketSeries> {
      if (interval !== '1d') {
        throw new HttpError(
          'not-found',
          `Frankfurter publishes daily; ${interval} is not offered.`,
        )
      }
      const { base, quote } = pairFor(symbol)
      const url = `${BASE_URL}/${range.from}..${range.to}?base=${base}&symbols=${quote}`
      const payload = await http.getJson<unknown>(url, ctx.signal)
      if (!isTimeSeries(payload)) {
        throw new HttpError(
          'schema',
          `Frankfurter returned an unexpected shape for ${symbol}`,
        )
      }
      return toSeries(symbol, payload, range, ctx)
    },

    async fetchFxRates(pairs, ctx): Promise<MarketQuote[]> {
      const from = new Date(ctx.clock.epochMs() - LOOKBACK_DAYS * 86_400_000)

      // One request per pair. Frankfurter derives non-EUR bases from the same
      // ECB set itself, so asking it directly keeps the cross-rate arithmetic
      // with the provider rather than inventing our own. There is no daily
      // cap, so the extra call costs nothing that matters.
      return Promise.all(
        pairs.map(async (symbol) => {
          const { base, quote } = pairFor(symbol)
          const url = `${BASE_URL}/${isoDate(from)}..?base=${base}&symbols=${quote}`
          const payload = await http.getJson<unknown>(url, ctx.signal)
          if (!isTimeSeries(payload)) {
            throw new HttpError(
              'schema',
              `Frankfurter returned an unexpected shape for ${symbol}`,
            )
          }
          return toQuote(symbol, payload, ctx)
        }),
      )
    },
  }
}

/** Canonical symbols this adapter can serve. */
export const FRANKFURTER_SYMBOLS: CanonicalSymbol[] = Object.keys(PAIRS).map((s) =>
  canonicalSymbol(s),
)
