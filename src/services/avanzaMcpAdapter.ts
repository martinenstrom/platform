/**
 * Avanza MCP adapter — real, partial implementation.
 *
 * Backed by the `avanza-mcp` PyPI package (run via `uvx`, see
 * `./avanzaMcp/client.ts`), which wraps Avanza's **public, unauthenticated**
 * market-data API. There is no login and no account/portfolio access here —
 * confirmed by reading that package's source: it exposes only search, quotes,
 * charts, financials, dividends and similar public instrument data, never
 * holdings, positions, watchlists or orders.
 *
 * That means only three `MarketDataService` methods have anything real to
 * call: `searchInstruments`, `getMarketStatus` and `getQuote` (see
 * `./avanzaMcp/serverFns.ts` for the `createServerFn` wrappers,
 * `./avanzaMcp/mappers.ts` for the raw Avanza JSON -> domain type mapping).
 * Everything else — holdings, portfolio summary, allocation, risk score,
 * watchlist, opportunities, the AI brief, recent analyses, reports, the
 * screener, and `getMarketIndices` (whose mock list mixes Swedish/US/FX/crypto
 * — not something this Swedish-broker-only search maps onto cleanly) — has no
 * real endpoint to call and stays mocked.
 *
 * Scope guard: this integration is read-only by design, and so is the
 * upstream package — do not add order placement or trading tools here.
 */

import {
  getAvanzaMarketStatusFn,
  getAvanzaStockQuoteFn,
  searchAvanzaInstrumentsFn,
} from './avanzaMcp/serverFns'
import type { MarketDataService } from './marketDataService'

/** The full real tool catalog exposed by `avanza-mcp`, for reference — only a few are wired up above. */
export const AVANZA_MCP_TOOLS = {
  searchInstruments: 'search_instruments',
  getInstrumentByOrderBookId: 'get_instrument_by_order_book_id',
  getMarketplaceInfo: 'get_marketplace_info',
  getStockQuote: 'get_stock_quote',
  getStockInfo: 'get_stock_info',
  getStockChart: 'get_stock_chart',
  getStockAnalysis: 'get_stock_analysis',
  getOrderbook: 'get_orderbook',
  getRecentTrades: 'get_recent_trades',
  getBrokerTradeSummary: 'get_broker_trade_summary',
  getDividends: 'get_dividends',
  getCompanyFinancials: 'get_company_financials',
  getFundInfo: 'get_fund_info',
  getNumberOfOwners: 'get_number_of_owners',
  getShortSelling: 'get_short_selling',
} as const

/**
 * Returns a `MarketDataService` where `searchInstruments`, `getMarketStatus`
 * and `getQuote` are routed through `createServerFn`s that hit the real
 * Avanza public API when `AVANZA_MCP_ENABLED=true` server-side, and the same
 * mock data as `fallback` otherwise (see `avanzaMcp/serverFns.ts` — that
 * check happens there, not here, since it needs `process.env`, which this
 * file's caller may be evaluating in a browser bundle). Every other method
 * falls back to `fallback` directly (pass `mockMarketDataService`). Roll more
 * methods over as real endpoints are found for them. Takes the fallback as a
 * parameter rather than importing it, so this module never depends on
 * `marketDataService.ts` at runtime — only `marketDataService.ts` depends on
 * this one.
 */
export function createAvanzaMcpMarketDataService(
  fallback: MarketDataService,
): MarketDataService {
  return {
    ...fallback,
    searchInstruments: (query) => searchAvanzaInstrumentsFn({ data: query }),
    getMarketStatus: () => getAvanzaMarketStatusFn(),
    getQuote: (instrumentId) => getAvanzaStockQuoteFn({ data: instrumentId }),
  }
}

/**
 * AI briefs, opportunities and analysis runs are produced by analysis agents
 * rather than Avanza — see `./analysisAgentService.ts`, which follows the
 * same async-interface pattern as this file.
 */
