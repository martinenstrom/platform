/**
 * Avanza — Swedish equity quotes and index levels, via the local
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
 *  - `isRealTime: false` on every EQUITY response. The Swedish equity feed is
 *    delayed and is never presented otherwise. **Index levels differ**: DAX
 *    and Nasdaq 100 report `true`, Nikkei reports `false`, so `toIndexQuote`
 *    reads the flag per observation instead of assuming it. Avanza does not
 *    quantify the delay either way, so `delayMinutes` stays `null`.
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
import type {
  CommodityProvider,
  FetchContext,
  QuoteProvider,
} from '~/application/marketData/ports'
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

/**
 * `get_stock_info`. Carries identity AND the quote, which is why index levels
 * use it rather than `get_stock_quote`: the binding can verify what it fetched
 * in the same call that fetched it.
 */
interface AvanzaInfoPayload {
  isin?: unknown
  type?: unknown
  /** Echoed back by Avanza. Verified, so a redirect cannot pass unnoticed. */
  orderbookId?: unknown
  name?: unknown
  listing?: { tickerSymbol?: unknown }
  quote?: {
    last?: unknown
    change?: unknown
    changePercent?: unknown
    highest?: unknown
    lowest?: unknown
    timeOfLast?: unknown
    isRealTime?: unknown
  }
  marketPlace?: { currentStatus?: unknown }
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

export function createAvanzaProvider(
  callTool: AvanzaToolCall,
): QuoteProvider & CommodityProvider {
  const gate = createGate(MAX_CONCURRENCY, MAX_QUEUE_DEPTH)

  const call = <T>(ctx: FetchContext, name: string, args: Record<string, unknown>) =>
    gate(() => abandonOnAbort(callTool<T>(name, args), ctx.signal))

  return {
    id: AVANZA_PROVIDER_ID,
    name: AVANZA_SOURCE.providerName,
    attributionUrl: AVANZA_SOURCE.attributionUrl,

    /**
     * Gold and Brent spot.
     *
     * The same transport, the same identity verification and the same
     * normalization as everything else this adapter serves — the split exists
     * because the pipeline routes on capability, not because commodities need
     * different handling. Both bindings are `fetchWith: 'info'`, so each
     * observation verifies its own identity in the call that fetched it.
     *
     * No session lookup: both are `sessionModel: 'unknown'` by ruling, since
     * Avanza's beQuoted schedule describes its quoting window rather than the
     * commodity market. Asking would produce a Stockholm answer to a question
     * about a market that trades nearly around the clock.
     */
    async fetchCommodities(symbols, ctx): Promise<MarketQuote[]> {
      const instruments = symbols.map((symbol) => ({
        symbol,
        instrument: orderBookIdFor(symbol),
      }))

      return Promise.all(
        instruments.map(async ({ symbol, instrument }) => {
          const info = await call<AvanzaInfoPayload>(ctx, 'get_stock_info', {
            instrument_id: instrument.orderBookId,
          })
          return toIndexQuote(symbol, instrument, info, ctx)
        }),
      )
    },

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
          /*
           * Index levels take `get_stock_info` rather than `get_stock_quote`,
           * because it returns the ISIN and the type alongside the price. That
           * is what lets the binding verify what it fetched in the same call
           * that fetched it, instead of trusting an order book id that Avanza
           * is free to reassign.
           *
           * It also carries `isRealTime` and the instrument's own market state,
           * so freshness is read per observation rather than assumed for the
           * feed — DAX and Nasdaq 100 report real-time where Nikkei does not.
           */
          if (instrument.fetchWith === 'info') {
            const info = await call<AvanzaInfoPayload>(ctx, 'get_stock_info', {
              instrument_id: instrument.orderBookId,
            })
            return toIndexQuote(symbol, instrument, info, ctx)
          }

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
 * One index level, identity-checked against the reviewed binding.
 *
 * ## Why identity is verified at fetch time
 *
 * An order book id is a number Avanza controls. It can be retired, and it can
 * be **reassigned** — and a reassigned id is the dangerous case, because it
 * keeps returning a plausible price for an instrument nobody asked for. The
 * map records what each id is supposed to be; this asserts it on every fetch.
 *
 * Both checks are load-bearing and neither is redundant:
 *
 *  - **ISIN** catches a reassignment. `DE0008469008` is the DAX and nothing
 *    else, whatever the instrument is called this quarter.
 *  - **type** catches the far likelier mistake. Avanza lists thousands of
 *    certificates and warrants written on these indices; a binding pointed at
 *    `BULL DAX X20` by accident would serve a leveraged product's price as an
 *    index level, and the number would look entirely reasonable.
 *
 * A mismatch throws, which the pipeline reports as a provider error on the
 * category. The chain then continues to fixture and the disclosure layer says
 * so. **It never serves the instrument it actually got.**
 */
/**
 * Rejects a payload that is not demonstrably the reviewed instrument.
 *
 * ## What each check is for
 *
 * `type` catches the likeliest mistake by a wide margin. Avanza lists
 * thousands of certificates and warrants written on these underlyings — 744
 * gold certificates and 1084 gold warrants against one gold spot quote — and
 * every one of them returns a number that would look reasonable on a tape.
 *
 * `orderbookId` catches a redirect: Avanza answering about a different book
 * than the one asked for means the response is about something else, whatever
 * it contains.
 *
 * The identity anchor then differs by class, and the difference is real:
 *
 *  - **strong** — an ISIN, issued outside Avanza. One field, decisive. It
 *    survives a rename and it survives a reassigned order book id.
 *  - **composite** — no such anchor exists. `isin` holds a placeholder
 *    (`"GC"`, `"BRENT"`), so the evidence is agreement across the placeholder,
 *    the instrument name and the ticker at once. Three fields that would all
 *    have to change together for the wrong instrument to pass. Weaker than an
 *    ISIN, and never to be described as equivalent to one — but it fails
 *    closed on exactly the same terms.
 *
 * Any mismatch throws. The pipeline reports a provider error on the category,
 * the chain continues to fixture, and the disclosure layer says so. **The
 * instrument actually received is never served.**
 */
function verifyIdentity(
  symbol: CanonicalSymbol,
  instrument: AvanzaInstrument,
  payload: AvanzaInfoPayload,
): void {
  const reject = (field: string, got: unknown, want: unknown): never => {
    throw new HttpError(
      'schema',
      `Avanza order book ${instrument.orderBookId} returned ${field} ` +
        `${JSON.stringify(got)} for ${symbol}; expected ${JSON.stringify(want)}. ` +
        `Refusing to serve an unverified instrument.`,
    )
  }

  if (payload?.type !== instrument.expectedType) {
    reject('type', payload?.type, instrument.expectedType)
  }

  /*
   * Only checked when Avanza sends it. `get_stock_info` returns `orderbookId`
   * for every instrument bound here, but the field is absent from the older
   * recorded payloads, and a check that turned missing data into a rejection
   * would fail closed on the wrong thing.
   */
  if (
    payload?.orderbookId !== undefined &&
    String(payload.orderbookId) !== instrument.orderBookId
  ) {
    reject('orderbookId', payload.orderbookId, instrument.orderBookId)
  }

  const identity = instrument.identity
  if (identity.class === 'strong') {
    if (payload?.isin !== identity.isin) {
      reject('ISIN', payload?.isin, identity.isin)
    }
    return
  }

  /* Composite: no single field carries the identity, so all three must agree. */
  if (payload?.isin !== identity.identifier) {
    reject('identifier', payload?.isin, identity.identifier)
  }
  if (payload?.name !== instrument.expectedName) {
    reject('name', payload?.name, instrument.expectedName)
  }
  if (payload?.listing?.tickerSymbol !== instrument.expectedTicker) {
    reject('ticker', payload?.listing?.tickerSymbol, instrument.expectedTicker)
  }
}

export function toIndexQuote(
  symbol: CanonicalSymbol,
  instrument: AvanzaInstrument,
  payload: AvanzaInfoPayload,
  ctx: FetchContext,
): MarketQuote {
  verifyIdentity(symbol, instrument, payload)

  const quote = payload.quote
  const value = requireFiniteNumber(quote?.last, 'quote.last', symbol)
  const timeOfLast = requireFiniteNumber(quote?.timeOfLast, 'quote.timeOfLast', symbol)

  const now = ctx.clock.now()
  /*
   * Freshness is read per observation, never assumed for the feed.
   *
   * The Swedish equity path hard-codes `delayed` because every response it has
   * ever seen carried `isRealTime: false`. That is not true of the index
   * levels: DAX and Nasdaq 100 report `true`, Nikkei reports `false`, and the
   * three arrive from the same provider in the same call. Assigning one
   * blanket quality would either understate two of them or promote a stale
   * Tokyo close to a live tick.
   *
   * `true` becomes `near-realtime` rather than `realtime`: Avanza is a broker
   * redistributing a level it did not compute, and `realtime` in this domain
   * means an exchange-grade tick from the venue itself.
   */
  const realTime = quote?.isRealTime === true
  const provenance: Provenance = {
    asOf: new Date(timeOfLast).toISOString(),
    asOfPrecision: 'second',
    receivedAt: now.toISOString(),
    ageMs: Math.max(0, now.getTime() - timeOfLast),
    source: AVANZA_SOURCE,
    quality: realTime ? 'near-realtime' : 'delayed',
    isDelayed: !realTime,
    // Avanza does not quantify its delay anywhere in the payload.
    delayMinutes: null,
    venue: venueFrom(instrument),
    isProxy: false,
  }

  const percentageChange = optionalFiniteNumber(quote?.changePercent)

  return buildQuote({
    symbol,
    value,
    percentageChange,
    absoluteChange:
      percentageChange === null ? null : optionalFiniteNumber(quote?.change),
    dayHigh: optionalFiniteNumber(quote?.highest),
    dayLow: optionalFiniteNumber(quote?.lowest),
    /*
     * The instrument's own venue schedule where that schedule describes the
     * market, and `unknown` where it describes only Avanza's quoting window —
     * see `AvanzaSessionModel`. Correcting this here, at the provider
     * boundary, is what keeps the frozen freshness policy general.
     */
    session:
      instrument.sessionModel === 'unknown'
        ? 'unknown'
        : sessionFrom(payload?.marketPlace?.currentStatus),
    changePeriod: 'intraday',
    sourcePrecision: decimalsOf(value),
    requestedPrecision: null,
    provenance,
  })
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
