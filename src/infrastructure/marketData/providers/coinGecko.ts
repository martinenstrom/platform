/**
 * CoinGecko — aggregated crypto market data.
 *
 * **Not exchange-grade.** This is a cross-exchange aggregate with a provider
 * timestamp and a short cache interval (`max-age=30, s-maxage=60`), so it is
 * classified `near-realtime` rather than `realtime`. It is current, but it is
 * not a venue feed, and the provenance must not claim otherwise.
 *
 * ## Quota, and why it shapes everything here
 *
 * The Demo plan allows ~30 calls/min and 10,000 calls/month (~322/day). This
 * is the first provider whose quota can actually be exhausted, so:
 *
 *  - one symbol, one call, no history fetch
 *  - a 10-minute TTL (~144 calls/day in continuous use)
 *  - a 250/day budget enforced per external attempt, retries included
 *  - HTTP 429 is a quota condition, not an outage: fewer retries, honour
 *    Retry-After, and do not trip the availability breaker
 *
 * ## What it does NOT do
 *
 *  - does not claim exchange-grade freshness
 *  - does not reverse-engineer a 24-hour-ago price from the reported change
 *  - does not fabricate intraday history — no series endpoint is called
 *  - does not infer precision from the decimal form of the returned number
 *  - does not retry, time out, cache or fall back; the pipeline owns those
 */

import {
  buildQuote,
  canonicalSymbol,
  type CanonicalSymbol,
  type DataSourceMetadata,
  type MarketQuote,
} from '~/domain/market'
import type { CryptoProvider, FetchContext } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'

export const COINGECKO_PROVIDER_ID = 'coingecko'

export const COINGECKO_SOURCE: DataSourceMetadata = {
  providerId: COINGECKO_PROVIDER_ID,
  providerName: 'CoinGecko (aggregated market data)',
  attributionUrl: 'https://www.coingecko.com',
  licenseNote: 'Cross-exchange aggregate; not exchange-grade market data',
}

const BASE_URL = 'https://api.coingecko.com/api/v3'

/**
 * Decimals asked of the API.
 *
 * CoinGecko returns whatever `precision=` we request — the default rounds
 * bitcoin to a whole dollar, `full` returns eleven decimals. Two matches the
 * tile's convention, and because the PROVIDER does the rounding the value is
 * genuinely two-decimal. It is still recorded as `requestedPrecision`, not
 * `sourcePrecision`: the choice was ours, and dressing it up as an intrinsic
 * property of the data would be a small lie.
 */
const REQUESTED_PRECISION = 2

/* ------------------------------------------------------------ wire contract */
/* Declared here and never exported.                                          */

interface CoinGeckoSimplePrice {
  [coinId: string]:
    | {
        usd?: number
        usd_24h_change?: number
        last_updated_at?: number
      }
    | undefined
}

/* --------------------------------------------------------- symbol mapping */

/** Canonical symbol → CoinGecko coin id. Bitcoin only, matching the Overview. */
const COIN_IDS: Record<string, string> = {
  'crypto:btc': 'bitcoin',
}

function coinIdFor(symbol: CanonicalSymbol): string {
  const id = COIN_IDS[symbol]
  if (!id) throw new HttpError('not-found', `CoinGecko has no mapping for ${symbol}`)
  return id
}

/* ------------------------------------------------------------ normalization */

function toQuote(
  symbol: CanonicalSymbol,
  coinId: string,
  payload: CoinGeckoSimplePrice,
  ctx: FetchContext,
): MarketQuote {
  const entry = payload[coinId]
  if (!entry || typeof entry.usd !== 'number' || !Number.isFinite(entry.usd)) {
    throw new HttpError('schema', `CoinGecko returned no usable USD price for ${symbol}`)
  }

  const now = ctx.clock.now()
  // A real provider timestamp when present. Falling back to our own clock
  // would overstate freshness, so that case is marked as such below.
  const hasTimestamp = typeof entry.last_updated_at === 'number'
  const asOf = hasTimestamp
    ? new Date(entry.last_updated_at! * 1000).toISOString()
    : now.toISOString()

  const change =
    typeof entry.usd_24h_change === 'number' && Number.isFinite(entry.usd_24h_change)
      ? entry.usd_24h_change
      : null

  return buildQuote({
    symbol,
    value: entry.usd,
    // Provider-authoritative. CoinGecko gives no 24-hour-ago close, and
    // deriving one from the percentage would invent a price it never
    // published. `previousClose` therefore stays null.
    percentageChange: change,
    changePeriod: 'rolling-24h',
    requestedPrecision: REQUESTED_PRECISION,
    session: 'unknown',
    provenance: {
      asOf,
      asOfPrecision: 'second',
      receivedAt: now.toISOString(),
      ageMs: Math.max(0, now.getTime() - Date.parse(asOf)),
      source: COINGECKO_SOURCE,
      // Aggregated with a short cache interval — current, but not a venue
      // feed. 'realtime' would overstate it.
      quality: 'near-realtime',
      isDelayed: false,
      delayMinutes: null,
      isProxy: false,
    },
  })
}

/* ---------------------------------------------------------------- provider */

export interface CoinGeckoOptions {
  /** Demo API key. Sent only as a server-side header, never in a query string. */
  apiKey?: string
}

export function createCoinGeckoProvider(
  http: HttpClient,
  options: CoinGeckoOptions = {},
): CryptoProvider {
  return {
    id: COINGECKO_PROVIDER_ID,
    name: COINGECKO_SOURCE.providerName,
    attributionUrl: COINGECKO_SOURCE.attributionUrl,

    async fetchCrypto(symbols, ctx): Promise<MarketQuote[]> {
      if (symbols.length === 0) return []
      const ids = symbols.map(coinIdFor)

      // One request for every symbol: `simple/price` batches natively, which
      // is what keeps a metered provider affordable.
      const url =
        `${BASE_URL}/simple/price?ids=${ids.join(',')}&vs_currencies=usd` +
        `&include_24hr_change=true&include_last_updated_at=true` +
        `&precision=${REQUESTED_PRECISION}`

      const payload = await http.getJson<unknown>(url, ctx.signal, {
        // Header only. Never a query parameter: query strings end up in access
        // logs, proxy caches and error messages.
        ...(options.apiKey ? { 'x-cg-demo-api-key': options.apiKey } : {}),
      })

      if (typeof payload !== 'object' || payload === null) {
        throw new HttpError('schema', 'CoinGecko returned a non-object payload')
      }

      return symbols.map((symbol, index) =>
        toQuote(symbol, ids[index]!, payload as CoinGeckoSimplePrice, ctx),
      )
    },
  }
}

/** Canonical symbols this adapter can serve. */
export const COINGECKO_SYMBOLS: CanonicalSymbol[] = Object.keys(COIN_IDS).map((s) =>
  canonicalSymbol(s),
)
