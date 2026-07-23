/**
 * Pure mapping from `avanza-mcp`'s raw JSON shapes (verified empirically
 * against the live tool, not guessed from docs) into this app's domain
 * types. No I/O here — safe to import from anywhere, including tests.
 */

import type { Instrument, InstrumentType, MarketStatus, Quote } from '~/types'

/**
 * Avanza formats numbers with Swedish locale conventions: comma decimals,
 * a (non-breaking) space as thousands separator, and U+2212 MINUS SIGN
 * rather than an ASCII hyphen for negative values, e.g. "3 179,52" or
 * "−0,67".
 */
export function parseAvanzaNumber(value: string | null | undefined): number | null {
  if (!value) return null
  const normalized = value.replace(/[\s ]/g, '').replace(',', '.').replace('−', '-')
  const parsed = Number.parseFloat(normalized)
  return Number.isNaN(parsed) ? null : parsed
}

interface AvanzaSearchPrice {
  last?: string | null
  currency?: string | null
  todayChangePercent?: string | null
}

export interface AvanzaSearchHit {
  type: string
  title: string
  orderBookId?: string | null
  marketPlaceName: string
  price?: AvanzaSearchPrice | null
}

export interface AvanzaSearchResponse {
  totalNumberOfHits: number
  hits: AvanzaSearchHit[]
}

/** Avanza instrument types this app doesn't distinguish; folded onto the closest existing bucket. */
const INSTRUMENT_TYPE_MAP: Record<string, InstrumentType> = {
  STOCK: 'stock',
  FUND: 'fund',
  ETF: 'etf',
  EXCHANGE_TRADED_FUND: 'etf',
  INDEX: 'index',
  CERTIFICATE: 'stock',
  WARRANT: 'stock',
  BOND: 'stock',
  FUTURE_FORWARD: 'stock',
  OPTION: 'stock',
  PREMIUM_BOND: 'stock',
  SUBSCRIPTION_OPTION: 'stock',
  EQUITY_LINKED_BOND: 'stock',
  CONVERTIBLE: 'stock',
}

/** Extracts the ticker from a title like "Volvo B (VOLV B)"; falls back to the full title. */
function extractTicker(title: string): string {
  const match = title.match(/\(([^)]+)\)\s*$/)
  return match?.[1] ?? title
}

export function mapSearchHitToInstrument(hit: AvanzaSearchHit): Instrument | null {
  if (!hit.orderBookId) return null
  return {
    id: hit.orderBookId,
    name: hit.title.replace(/\s*\([^)]+\)\s*$/, ''),
    ticker: extractTicker(hit.title),
    type: INSTRUMENT_TYPE_MAP[hit.type] ?? 'stock',
    market: hit.marketPlaceName,
    currency: hit.price?.currency ?? 'SEK',
  }
}

export function mapSearchResponseToInstruments(
  response: AvanzaSearchResponse,
): Instrument[] {
  return response.hits
    .map(mapSearchHitToInstrument)
    .filter((instrument): instrument is Instrument => instrument !== null)
}

export interface AvanzaMarketplaceInfo {
  marketOpen: boolean
  currentStatus: string
  todayClosingTime: string
}

export function mapMarketplaceInfoToMarketStatus(
  info: AvanzaMarketplaceInfo,
): MarketStatus {
  return {
    isOpen: info.marketOpen,
    label: info.marketOpen ? 'Stockholmsbörsen öppen' : 'Stockholmsbörsen stängd',
    detail: info.marketOpen
      ? `Stänger ${info.todayClosingTime.slice(0, 5)}`
      : info.currentStatus,
  }
}

/**
 * `get_stock_quote` works for any instrument id (verified against both a
 * stock and an index) despite the tool's name. Values are plain numbers
 * (unlike search's localized strings) but carry no currency field — Avanza
 * is a Swedish broker, so default to SEK.
 */
export interface AvanzaStockQuote {
  last: number
  change: number
  changePercent: number
  updated: number
}

export function mapStockQuoteToQuote(
  instrumentId: string,
  quote: AvanzaStockQuote,
): Quote {
  return {
    instrumentId,
    price: quote.last,
    change: quote.change,
    changePercent: quote.changePercent,
    currency: 'SEK',
    updatedAt: new Date(quote.updated).toISOString(),
  }
}
