/**
 * Avanza — delayed Swedish equity and index quotes, via the local
 * `avanza-mcp` server.
 *
 * Avanza is a **broker**, not the venue. It redistributes Stockholmsbörsen
 * prices to retail clients; it did not originate them. `trust: 'broker'`
 * records the access route, and nothing here names Nasdaq Stockholm as the
 * originator, because the payload never claims to be speaking for the
 * exchange. Venue is copied from the payload's own MIC when it gives a real
 * one, and left absent when it does not — see `venueFrom`.
 *
 * ## Transport
 *
 * Not HTTP. `services/avanzaMcp/client.ts` speaks MCP over stdio to a `uvx`
 * child process, and that module is the single transport seam — this adapter
 * reaches it only through the injected `callTool`, so nothing Avanza-specific
 * and nothing Node-specific is statically importable from here.
 *
 * **A dispatched MCP call cannot be cancelled.** `ctx.signal` stops us
 * awaiting the result; it does not stop the child process doing the work. The
 * consequences are handled deliberately:
 *
 *  - a timeout is reported as a timeout, because that is what the caller saw
 *  - the abandoned result is dropped on arrival, never written to cache, so it
 *    cannot overwrite a fresher entry that landed while it was in flight
 *  - `MAX_CONCURRENCY` and `MAX_QUEUE_DEPTH` bound how much abandoned work can
 *    accumulate, so a slow session cannot queue an unbounded backlog
 *
 * ## Payload traps
 *
 *  - `updated` is NOT an observation time. It moved to Saturday 18:17 for a
 *    trade that happened Friday 17:29. Only `timeOfLast` is used.
 *  - `isRealTime: false` on every response from the public API. The feed is
 *    delayed and is never presented otherwise. Avanza does not quantify the
 *    delay, so `delayMinutes` stays `null`.
 *  - `search_instruments` returns Swedish-formatted strings (`"354,80"`, NBSP
 *    thousands separators) and carries no timestamp at all. It is not used for
 *    quotes. `get_stock_quote` returns real numbers and `timeOfLast`.
 *  - no `previousClose` is supplied. `last - change` is arithmetically a prior
 *    level, but Avanza never calls it the official close, so `previousClose`
 *    stays `null` rather than asserting a close it did not publish.
 */

import {
  buildQuote,
  decimalsOf,
  type CanonicalSymbol,
  type DataSourceMetadata,
  SYM_OMXS30,
  type MarketQuote,
  type Provenance,
  type SessionState,
} from '~/domain/market'
import type { FetchContext, QuoteProvider } from '~/application/marketData/ports'
import { HttpError } from './httpClient'
import { orderBookIdFor, type AvanzaInstrument } from './avanza/map'

export const AVANZA_PROVIDER_ID = 'avanza'

export const AVANZA_SOURCE: DataSourceMetadata = {
  providerId: AVANZA_PROVIDER_ID,
  providerName: 'Avanza',
  attributionUrl: 'https://www.avanza.se',
  licenseNote: 'Delayed retail market data from Avanza Bank AB',
  // The route is a broker. No originator is claimed: see the module note.
  trust: 'broker',
}

/** Simultaneous in-flight MCP calls. The child process is one shared pipe. */
export const MAX_CONCURRENCY = 4
/**
 * Calls allowed to wait for a slot. Beyond this the request fails fast rather
 * than joining a queue it will not be served from before the pipeline times
 * out — a fast honest failure beats a slow one plus abandoned work.
 */
export const MAX_QUEUE_DEPTH = 16

/* ------------------------------------------------------------ wire contract */

/** `get_stock_quote`. Every field optional: this is untrusted wire data. */
interface AvanzaQuotePayload {
  last?: unknown
  change?: unknown
  changePercent?: unknown
  highest?: unknown
  lowest?: unknown
  timeOfLast?: unknown
  /** Provider housekeeping. Deliberately never read — see the module note. */
  updated?: unknown
  isRealTime?: unknown
}

/** `get_marketplace_info`. Avanza's own statement about the venue's session. */
interface AvanzaMarketplacePayload {
  currentStatus?: unknown
}

/** The one tool call this adapter needs. Injected so tests need no subprocess. */
export type AvanzaToolCall = <T>(
  name: string,
  args: Record<string, unknown>,
) => Promise<T>

function requireFiniteNumber(
  value: unknown,
  field: string,
  symbol: CanonicalSymbol,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(
      'schema',
      `Avanza returned a non-numeric ${field} for ${symbol}: ${JSON.stringify(value)}`,
    )
  }
  return value
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Maps Avanza's session status onto the domain's.
 *
 * Only `OPEN` and `CLOSED` have ever been observed. Anything else — including
 * an auction phase Avanza might report one day — becomes `'unknown'` rather
 * than being guessed at, and the absence of the call at all is `'unknown'`
 * too. The session is never inferred from the local clock: there is no Swedish
 * holiday calendar in this repository, so a weekday at 11:00 tells us nothing.
 */
export function sessionFrom(status: unknown): SessionState {
  if (status === 'OPEN') return 'open'
  if (status === 'CLOSED') return 'closed'
  return 'unknown'
}

/**
 * The venue, only when the payload states a real one.
 *
 * Avanza returns the ISO 10383 placeholder `XXXX` ("no market applicable") for
 * OMXS30, alongside the marketplace name "Inofficiella (beQuoted)". That is
 * Avanza declining to attribute the index to a venue, and it is copied
 * faithfully as "unknown" instead of being upgraded to XSTO because the index
 * happens to be a Stockholm one.
 */
export function venueFrom(instrument: AvanzaInstrument): string | undefined {
  return instrument.venueMic ?? undefined
}

/* --------------------------------------------------------------- concurrency */

/**
 * A bounded gate around the shared stdio pipe.
 *
 * Deliberately not a retry, timeout or cache policy — those belong to the
 * resilience pipeline and a second competing copy here would be a bug. This
 * only limits how many calls are in flight at once and how many may wait.
 */
export function createGate(maxConcurrency: number, maxQueueDepth: number) {
  let active = 0
  const waiting: Array<() => void> = []

  return async function gated<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrency) {
      if (waiting.length >= maxQueueDepth) {
        // Not 'rate-limit': nobody throttled us. Attributing our own
        // backpressure to Avanza would poison the breaker and the metrics.
        throw new HttpError(
          'unknown',
          `Avanza request queue is full (${maxQueueDepth} waiting)`,
        )
      }
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      waiting.shift()?.()
    }
  }
}

/**
 * Races a dispatched call against the pipeline's abort signal.
 *
 * On abort the caller sees a timeout immediately, which is the truth about
 * what it experienced. The underlying promise is still attached to a no-op
 * handler so a later rejection cannot surface as an unhandled rejection, and
 * its eventual value is discarded — it never reaches the cache, so it cannot
 * overwrite whatever arrived in the meantime.
 */
function abandonOnAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (!signal.aborted && typeof signal.addEventListener !== 'function') return work
  return new Promise<T>((resolve, reject) => {
    const fail = () => {
      work.then(
        () => {},
        () => {},
      )
      reject(
        new HttpError(
          'timeout',
          'Avanza call abandoned: the MCP request cannot be cancelled once dispatched',
        ),
      )
    }
    if (signal.aborted) return fail()
    signal.addEventListener('abort', fail, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', fail)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', fail)
        reject(error)
      },
    )
  })
}

/* ---------------------------------------------------------------- provider */

export function createAvanzaProvider(callTool: AvanzaToolCall): QuoteProvider {
  const gate = createGate(MAX_CONCURRENCY, MAX_QUEUE_DEPTH)

  const call = <T>(ctx: FetchContext, name: string, args: Record<string, unknown>) =>
    gate(() => abandonOnAbort(callTool<T>(name, args), ctx.signal))

  return {
    id: AVANZA_PROVIDER_ID,
    name: AVANZA_SOURCE.providerName,
    attributionUrl: AVANZA_SOURCE.attributionUrl,

    async fetchQuotes(symbols, ctx): Promise<MarketQuote[]> {
      // Resolve identities BEFORE any network work, so an unmapped symbol is a
      // clean programming error rather than a half-finished batch.
      const instruments = symbols.map((symbol) => ({
        symbol,
        instrument: orderBookIdFor(symbol),
      }))

      /*
       * One session lookup for the whole batch. Its failure must not cost us
       * the quotes: an unknown session is a small honest gap, while dropping
       * every price because a status endpoint blinked is not.
       *
       * There is no local cache here on purpose. The resolution pipeline
       * already caches this category, and a second private cache would be a
       * competing freshness policy with no configuration and no visibility.
       */
      let session: SessionState = 'unknown'
      try {
        const info = await call<AvanzaMarketplacePayload>(ctx, 'get_marketplace_info', {
          instrument_id: MARKET_STATUS_INSTRUMENT_ID,
        })
        session = sessionFrom(info?.currentStatus)
      } catch {
        session = 'unknown'
      }

      return Promise.all(
        instruments.map(async ({ symbol, instrument }) => {
          const payload = await call<AvanzaQuotePayload>(ctx, 'get_stock_quote', {
            instrument_id: instrument.orderBookId,
          })
          return toQuote(symbol, instrument, payload, session, ctx)
        }),
      )
    },
  }
}

/**
 * OMXS30's order book, used only to ask whether Stockholmsbörsen is open.
 * Every instrument in scope trades on the same venue and the same schedule.
 */
const MARKET_STATUS_INSTRUMENT_ID = orderBookIdFor(SYM_OMXS30).orderBookId

export function toQuote(
  symbol: CanonicalSymbol,
  instrument: AvanzaInstrument,
  payload: AvanzaQuotePayload,
  session: SessionState,
  ctx: FetchContext,
): MarketQuote {
  const value = requireFiniteNumber(payload?.last, 'last', symbol)
  const timeOfLast = requireFiniteNumber(payload?.timeOfLast, 'timeOfLast', symbol)

  const now = ctx.clock.now()
  const asOf = new Date(timeOfLast).toISOString()

  const percentageChange = optionalFiniteNumber(payload?.changePercent)
  const absoluteChange = optionalFiniteNumber(payload?.change)

  const provenance: Provenance = {
    asOf,
    // `timeOfLast` is an exact epoch instant, not a publication date.
    asOfPrecision: 'second',
    receivedAt: now.toISOString(),
    ageMs: Math.max(0, now.getTime() - timeOfLast),
    source: AVANZA_SOURCE,
    /*
     * `isRealTime: false` is Avanza's own statement about its feed, and it is
     * the only thing that sets quality here. A closed venue does NOT turn a
     * delayed quote into an end-of-day close: the session is a fact about the
     * market, the delay is a fact about the feed, and the last trade time is a
     * fact about the trade. Relabelling the last delayed print as an official
     * close would assert an auction result Avanza never gave us.
     */
    quality: 'delayed',
    isDelayed: true,
    // Avanza does not quantify its delay anywhere in the payload.
    delayMinutes: null,
    venue: venueFrom(instrument),
    isProxy: false,
  }

  return buildQuote({
    symbol,
    value,
    // No previousClose: see the module note. The provider's own two change
    // figures are passed through together and cross-checked against each other.
    percentageChange,
    absoluteChange: percentageChange === null ? null : absoluteChange,
    dayHigh: optionalFiniteNumber(payload?.highest),
    dayLow: optionalFiniteNumber(payload?.lowest),
    session,
    changePeriod: 'intraday',
    sourcePrecision: decimalsOf(value),
    // Nothing about this precision was requested by us.
    requestedPrecision: null,
    provenance,
  })
}
