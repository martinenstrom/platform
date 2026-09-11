/**
 * Yahoo Finance — index levels, best effort.
 *
 * The two indices Financial OS could not source anywhere else: S&P 500 and
 * FTSE 100. Both are licensed intellectual property, neither has a free
 * official route, and the alternative was to keep serving a fixture constant.
 *
 * ## Not exchange-grade, and never described as such
 *
 * Yahoo is a **free aggregator with no service commitment**. It is not the
 * index owner, not the venue, and not a licensed vendor speaking for either —
 * so `trust: 'aggregator'` and the quality ceiling is `delayed`. A recent
 * timestamp is not evidence of an exchange feed, and this adapter will not
 * promote one to `realtime` no matter how fresh it looks.
 *
 * ## Transport, and why there is no Python here
 *
 * `yfinance` is a Python client for Yahoo's public JSON endpoints. Everything
 * needed is in one of them, verified against the live service on 2026-08-25:
 *
 *   v8/finance/chart/{symbol}   200, no cookie, no crumb, all fields present
 *   v7/finance/quote            401 — crumb-gated, deliberately never called
 *
 * Adding a Python runtime to call a public JSON endpoint would buy a process
 * boundary, a deployment artefact and a new failure mode for nothing. The
 * library's *approach* is reused; the library is not.
 *
 * ## The User-Agent is load-bearing
 *
 * Probed directly: the same request **with** a browser-style UA returned 200
 * eight times consecutively, and **without** one returned 429 immediately.
 * Yahoo rate-limits unidentified clients on the first request, so the header
 * is a functional requirement rather than politeness.
 *
 * ## Identity is verified, because this transport also serves futures
 *
 * The same endpoint that returns `^GSPC` as an INDEX returns `GC=F` as a
 * FUTURE — "Gold Dec 26", a specific December contract, which is emphatically
 * not spot gold. A binding that trusted HTTP 200 as proof of identity would
 * happily serve one as the other. `instrumentType` is checked on every fetch
 * and anything but `INDEX` fails closed.
 *
 * ## Rights
 *
 * `yfinance` states it is *"not affiliated, endorsed, or vetted by Yahoo,
 * Inc."*, that it uses *"Yahoo's publicly available APIs"*, that it is
 * *"intended for research and educational purposes"*, and that *"The Yahoo!
 * finance API is intended for personal use only."*
 *
 * This deployment is private and single-user, which is the case that language
 * addresses. **It does not extend to redistribution, a shared deployment or a
 * commercial version**; any of those must be re-evaluated against Yahoo's own
 * terms before shipping, not inferred from this file.
 *
 * ## What it does NOT do
 *
 *  - does not claim exchange-grade freshness
 *  - does not read Yahoo's `currency` for an index — a level has no currency
 *  - does not accept a symbol whose `instrumentType` is not `INDEX`
 *  - does not fabricate a session when Yahoo gives no trading period
 *  - does not retry, cache or fall back; the pipeline owns those
 */

import {
  buildQuote,
  type CanonicalSymbol,
  type DataSourceMetadata,
  type MarketQuote,
  type SessionState,
  type Provenance,
} from '~/domain/market'
import type { FetchContext, QuoteProvider } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'
import { YAHOO_INDICES, yahooBindingFor, type YahooBinding } from './yahoo/map'

export const YAHOO_PROVIDER_ID = 'yahoo'

export const YAHOO_SOURCE: DataSourceMetadata = {
  providerId: YAHOO_PROVIDER_ID,
  providerName: 'Yahoo Finance',
  attributionUrl: 'https://finance.yahoo.com',
  licenseNote:
    'Free public endpoint, personal use; not affiliated with or endorsed by Yahoo',
  /*
   * Yahoo aggregates and republishes; it did not compute these levels. The
   * index owners did, and nothing in the payload speaks for them, so no
   * originator is named — only the route's own trust.
   */
  trust: 'aggregator',
}

const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

/**
 * A stable, honest client identity.
 *
 * Not a spoof of a specific browser build: it names the application and gives
 * Yahoo something to rate-limit deliberately rather than by accident. What it
 * must not be is absent — see the module note.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; FinancialOS/1.0; +private-instance)'

/* ------------------------------------------------------------ wire contract */

/** Every field optional: this is untrusted wire data. */
interface YahooChartMeta {
  symbol?: unknown
  instrumentType?: unknown
  longName?: unknown
  shortName?: unknown
  currency?: unknown
  exchangeName?: unknown
  exchangeTimezoneName?: unknown
  regularMarketPrice?: unknown
  chartPreviousClose?: unknown
  regularMarketTime?: unknown
  regularMarketDayHigh?: unknown
  regularMarketDayLow?: unknown
  currentTradingPeriod?: {
    regular?: { start?: unknown; end?: unknown }
  }
}

interface YahooHistoryResponse {
  chart?: {
    result?: Array<{
      timestamp?: unknown
      indicators?: {
        quote?: Array<{ close?: unknown }>
        adjclose?: Array<{ adjclose?: unknown }>
      }
    }> | null
  }
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{ meta?: YahooChartMeta }> | null
    error?: unknown
  }
}

function requireFiniteNumber(
  value: unknown,
  field: string,
  symbol: CanonicalSymbol,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(
      'schema',
      `Yahoo returned a non-numeric ${field} for ${symbol}: ${JSON.stringify(value)}`,
    )
  }
  return value
}

const optionalFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Session from Yahoo's own regular trading window, never from the local clock.
 *
 * `currentTradingPeriod.regular` gives the venue's session bounds in epoch
 * seconds. Comparing the observation against them is a fact about the market;
 * guessing from a weekday and an hour would not be, and there is no exchange
 * holiday calendar in this repository.
 */
export function sessionFromPeriod(meta: YahooChartMeta, atMs: number): SessionState {
  const start = optionalFiniteNumber(meta.currentTradingPeriod?.regular?.start)
  const end = optionalFiniteNumber(meta.currentTradingPeriod?.regular?.end)
  if (start === null || end === null) return 'unknown'
  return atMs >= start * 1000 && atMs < end * 1000 ? 'open' : 'closed'
}

/* ------------------------------------------------------------ normalization */

/**
 * One index level, identity-checked against the reviewed binding.
 *
 * Two checks, neither redundant:
 *
 *  - **`instrumentType`** is what separates an index from the futures,
 *    ETFs and funds the same transport serves. `GC=F` returns a perfectly
 *    well-formed FUTURE payload.
 *  - **`symbol`** catches a redirect or a substitution: Yahoo echoing back a
 *    ticker other than the one requested means the response is about something
 *    else, whatever it contains.
 *
 * A mismatch throws. The pipeline reports a provider error on the category,
 * the chain continues to fixture, and the disclosure layer says so. It never
 * serves the instrument it actually received.
 */
export function toIndexQuote(
  binding: YahooBinding,
  body: YahooChartResponse,
  ctx: FetchContext,
): MarketQuote {
  const meta = body?.chart?.result?.[0]?.meta
  if (!meta) {
    throw new HttpError(
      'schema',
      `Yahoo returned no chart result for ${binding.yahooSymbol}.`,
    )
  }

  if (meta.symbol !== binding.yahooSymbol) {
    throw new HttpError(
      'schema',
      `Yahoo returned symbol ${JSON.stringify(meta.symbol)} for ` +
        `${binding.yahooSymbol}. Refusing to serve an unverified instrument.`,
    )
  }
  if (meta.instrumentType !== 'INDEX') {
    throw new HttpError(
      'schema',
      `Yahoo returned instrumentType ${JSON.stringify(meta.instrumentType)} for ` +
        `${binding.yahooSymbol}; expected INDEX. The same endpoint serves ` +
        `futures and funds, and one must never stand in for an index.`,
    )
  }

  const value = requireFiniteNumber(
    meta.regularMarketPrice,
    'regularMarketPrice',
    binding.symbol,
  )
  const seconds = requireFiniteNumber(
    meta.regularMarketTime,
    'regularMarketTime',
    binding.symbol,
  )
  const observedMs = seconds * 1000
  const now = ctx.clock.now()

  const provenance: Provenance = {
    /* The venue's own observation instant, preserved exactly. */
    asOf: new Date(observedMs).toISOString(),
    asOfPrecision: 'second',
    receivedAt: now.toISOString(),
    ageMs: Math.max(0, now.getTime() - observedMs),
    source: YAHOO_SOURCE,
    /*
     * `delayed`, always — and deliberately not derived from how recent the
     * timestamp happens to be.
     *
     * Yahoo publishes no delay guarantee and no real-time flag on this
     * endpoint. A level that arrived thirty seconds ago may still be a delayed
     * republication, and there is nothing in the payload that would let this
     * adapter tell the difference. Claiming `near-realtime` because a number
     * looks fresh would be inventing a service level nobody offered.
     */
    quality: 'delayed',
    isDelayed: true,
    /* Yahoo does not quantify its delay anywhere in the payload. */
    delayMinutes: null,
    /*
     * No venue. `SNP` and `FGI` are Yahoo's own exchange codes, not ISO 10383
     * MICs, and mapping one to the other here would assert a venue on Yahoo's
     * behalf that the payload never gave.
     */
    isProxy: false,
  }

  const previousClose = optionalFiniteNumber(meta.chartPreviousClose)

  return buildQuote({
    symbol: binding.symbol,
    value,
    previousClose,
    dayHigh: optionalFiniteNumber(meta.regularMarketDayHigh),
    dayLow: optionalFiniteNumber(meta.regularMarketDayLow),
    session: sessionFromPeriod(meta, observedMs),
    changePeriod: 'intraday',
    /*
     * Yahoo's `currency` — USD for the S&P 500, GBP for the FTSE 100 — is
     * deliberately not read. An index level is unitless; the domain records
     * that as `currency: null` / `unit: index-points`, and letting a provider's
     * listing metadata override it would turn a level into a price.
     */
    sourcePrecision: null,
    requestedPrecision: null,
    provenance,
  })
}

/* ------------------------------------------------------------------ history */

/**
 * Daily history, adjusted where the caller asks for it.
 *
 * Separate from the quote path because it answers a different question and has
 * different correctness requirements. A quote is one observation; this is the
 * sample a percentile is ranked against, so a silently short or unadjusted
 * series does not produce a wrong-looking number — it produces a
 * plausible-looking one computed against the wrong distribution.
 *
 * ## Why `adjusted` is a parameter rather than always on
 *
 * For an index or an FX pair there is nothing to adjust and Yahoo returns
 * `adjclose === close` on every bar. For a distributing ETF the difference is
 * load-bearing: HYG and LQD each paid twelve distributions in the year to
 * 2026-08, and the unadjusted close carries a step down on each of those
 * dates that has nothing to do with the market.
 *
 * The caller states which it needs, and the credit leg of Cross-Asset Risk
 * Appetite needs adjusted.
 */
export interface DailyBar {
  /** ISO calendar date of the bar. */
  date: string
  /** Close, adjusted when requested. */
  value: number
}

export async function fetchDailyHistory(
  http: HttpClient,
  yahooSymbol: string,
  range: '1y' | '2y' | '5y',
  adjusted: boolean,
  ctx: FetchContext,
): Promise<DailyBar[]> {
  const url =
    `${BASE_URL}/${encodeURIComponent(yahooSymbol)}` +
    `?interval=1d&range=${range}&events=div%7Csplit&includeAdjustedClose=true`
  const body = await http.getJson<YahooHistoryResponse>(url, ctx.signal, {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  })

  const result = body?.chart?.result?.[0]
  const stamps = result?.timestamp as unknown[] | undefined
  const closes = result?.indicators?.quote?.[0]?.close as unknown[] | undefined
  if (!Array.isArray(stamps) || !Array.isArray(closes)) {
    throw new HttpError('schema', `Yahoo returned no daily series for ${yahooSymbol}.`)
  }

  const adjusted_ = result?.indicators?.adjclose?.[0]?.adjclose as unknown[] | undefined
  if (adjusted && !Array.isArray(adjusted_)) {
    /*
     * Fail closed rather than quietly falling back to the unadjusted close.
     * A caller that asked for adjusted prices asked because unadjusted ones
     * would corrupt its statistic.
     */
    throw new HttpError(
      'schema',
      `Yahoo returned no adjusted close for ${yahooSymbol}, which this caller ` +
        `requires. Refusing to substitute the unadjusted close.`,
    )
  }

  const bars: DailyBar[] = []
  for (let i = 0; i < stamps.length; i += 1) {
    const at = stamps[i]
    const raw = adjusted ? adjusted_![i] : closes[i]
    if (typeof at !== 'number' || typeof raw !== 'number' || !Number.isFinite(raw)) {
      /* A hole in the series is skipped, never interpolated. */
      continue
    }
    bars.push({ date: new Date(at * 1000).toISOString().slice(0, 10), value: raw })
  }
  if (bars.length === 0) {
    throw new HttpError('schema', `Yahoo daily series for ${yahooSymbol} was empty.`)
  }
  return bars
}

/* ---------------------------------------------------------------- provider */

export function createYahooProvider(http: HttpClient): QuoteProvider {
  return {
    id: YAHOO_PROVIDER_ID,
    name: YAHOO_SOURCE.providerName,
    attributionUrl: YAHOO_SOURCE.attributionUrl,

    async fetchQuotes(symbols, ctx): Promise<MarketQuote[]> {
      /*
       * Identities resolved before any network work, so an unmapped symbol is
       * a clean programming error rather than a half-finished batch.
       */
      const bindings = symbols.map(yahooBindingFor)

      return Promise.all(
        bindings.map(async (binding) => {
          /*
           * `range=1d`, and the range is load-bearing rather than incidental.
           *
           * `meta.chartPreviousClose` is the close preceding the REQUESTED
           * WINDOW, not the previous session. At `range=5d` it is therefore
           * the close five sessions ago, and Financial OS spent from
           * 2026-08-25 to 2026-08-26 rendering multi-day moves labelled as
           * intraday ones. Measured on 2026-08-26:
           *
           *   ^GSPC   +0.15% on a 1d basis   -0.25% on a 5d basis
           *   ^FTSE   -0.07%                 +1.25%
           *   ^VIX    -0.65%                 -4.12%
           *
           * Not a rounding difference — the sign was wrong on all three. The
           * contract this restores: a market quote's change is the current
           * regular-market level against the IMMEDIATELY PRECEDING
           * regular-session close.
           *
           * The historical path is unaffected and deliberately keeps its own
           * range: it reads the bar series, not this field.
           */
          const url =
            `${BASE_URL}/${encodeURIComponent(binding.yahooSymbol)}` +
            `?interval=1d&range=1d`
          const body = await http.getJson<YahooChartResponse>(url, ctx.signal, {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          })
          return toIndexQuote(binding, body, ctx)
        }),
      )
    },
  }
}

export { YAHOO_INDICES }
