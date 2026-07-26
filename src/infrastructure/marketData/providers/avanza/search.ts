/**
 * Avanza instrument search.
 *
 * The one legitimate use of `search_instruments`. Phase 5 established that it
 * must never bind a canonical symbol — searching "Atlas Copco A" returns Atlas
 * Copco B first — but that hazard is about IDENTITY, and this is DISCOVERY:
 * the user reads the list and picks. A ranked-second result is a minor
 * annoyance here and a wrong company on a price tile there.
 *
 * The type keeps the two apart. Results carry `providerRef` (`avanza:5269`),
 * never a `CanonicalSymbol`, so a hit cannot become a tracked instrument by
 * assignment. `isTracked` is resolved against the reviewed catalog rather than
 * inferred from the hit.
 *
 * ## Payload
 *
 * Unlike `get_stock_quote`, search returns Swedish-formatted STRINGS —
 * `"354,80"`, NBSP thousands separators — and carries no timestamp at all.
 * Nothing here reads a price for that reason: a price with no observation time
 * has no place in this system, and the search list does not need one.
 */

import type { InstrumentSearchResult, SearchResultKind } from '~/domain/market'
import type {
  FetchContext,
  InstrumentSearchProvider,
} from '~/application/marketData/ports'
import { AVANZA_INSTRUMENTS } from './map'

/** Provider ids of instruments already in the reviewed catalog. */
const TRACKED_ORDER_BOOKS = new Set(AVANZA_INSTRUMENTS.map((i) => i.orderBookId))

interface AvanzaSearchHit {
  type?: unknown
  title?: unknown
  orderBookId?: unknown
  flagCode?: unknown
  marketPlaceName?: unknown
  price?: { currency?: unknown } | null
}

interface AvanzaSearchPayload {
  hits?: unknown
}

/** Avanza's own type strings, mapped onto ours. Unknown stays unknown. */
function kindOf(raw: unknown): SearchResultKind {
  switch (String(raw).toUpperCase()) {
    case 'STOCK':
      return 'stock'
    case 'FUND':
      return 'fund'
    case 'ETF':
      return 'etf'
    case 'INDEX':
      return 'index'
    case 'CERTIFICATE':
      return 'certificate'
    case 'WARRANT':
      return 'warrant'
    case 'FUTURE_FORWARD':
      return 'future'
    default:
      return 'unknown'
  }
}

/**
 * Splits Avanza's `"Volvo B (VOLV B)"` into a name and a ticker.
 *
 * The ticker is only taken from a trailing parenthesis, because that is the
 * only place Avanza puts one. A company whose NAME contains brackets yields a
 * null ticker rather than a guess.
 */
export function splitTitle(title: string): { name: string; ticker: string | null } {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(title)
  if (!match) return { name: title.trim(), ticker: null }
  return { name: match[1]!.trim(), ticker: match[2]!.trim() }
}

/** Avanza marks Stockholm hits by name; only that one maps to a real MIC. */
function venueOf(marketPlaceName: unknown): string | null {
  return typeof marketPlaceName === 'string' &&
    marketPlaceName.toLowerCase().startsWith('stockholmsb')
    ? 'XSTO'
    : null
}

export function parseSearchHits(payload: AvanzaSearchPayload): InstrumentSearchResult[] {
  const hits = Array.isArray(payload?.hits) ? (payload.hits as AvanzaSearchHit[]) : []
  const results: InstrumentSearchResult[] = []

  for (const hit of hits) {
    // Help articles come back with no order book id. Without an identifier
    // there is nothing to select, so they are not search results.
    if (typeof hit?.orderBookId !== 'string' || hit.orderBookId === '') continue
    if (typeof hit.title !== 'string') continue

    const { name, ticker } = splitTitle(hit.title)
    results.push({
      providerRef: `avanza:${hit.orderBookId}`,
      displayName: name,
      ticker,
      kind: kindOf(hit.type),
      venue: venueOf(hit.marketPlaceName),
      countryCode: typeof hit.flagCode === 'string' ? hit.flagCode : null,
      currency: typeof hit.price?.currency === 'string' ? hit.price.currency : null,
      isTracked: TRACKED_ORDER_BOOKS.has(hit.orderBookId),
    })
  }
  return results
}

export const AVANZA_SEARCH_PROVIDER_ID = 'avanza-search'

/**
 * A distinct provider id from the quote adapter, following the same precedent
 * as `riksbank` / `riksbank-policy`: one institution serving two capabilities
 * registers twice, because the registry keys on provider id and a chain names
 * exactly what it wants. It also keeps search out of the quote adapter's
 * breaker — a flaky search must not open the circuit on price data.
 */
export function createAvanzaSearchProvider(
  callTool: <T>(name: string, args: Record<string, unknown>) => Promise<T>,
  providerId = AVANZA_SEARCH_PROVIDER_ID,
): InstrumentSearchProvider {
  return {
    id: providerId,
    name: 'Avanza',
    attributionUrl: 'https://www.avanza.se',

    async searchInstruments(
      query: string,
      limit: number,
      _ctx: FetchContext,
    ): Promise<InstrumentSearchResult[]> {
      const payload = await callTool<AvanzaSearchPayload>('search_instruments', {
        query,
        instrument_type: 'all',
        limit,
      })
      return parseSearchHits(payload)
    },
  }
}
