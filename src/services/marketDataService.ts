/**
 * Market data service — the single seam between the UI and any real data source.
 *
 * `searchInstruments`, `getMarketStatus` and `getQuote` always go through
 * `createAvanzaMcpMarketDataService`, whose `createServerFn` wrappers decide
 * server-side (via `AVANZA_MCP_ENABLED`) whether to call the real Avanza API
 * or fall back to the same mock data used here — see `./avanzaMcpAdapter.ts`.
 *
 * That decision deliberately does NOT happen in this file: `process.env` is
 * only meaningfully populated in the Node/SSR process, not in the browser
 * bundle this module is also part of, so branching on it here would make the
 * client silently fall back to mock even when the server has the real
 * integration enabled. `createServerFn`s are safe to call unconditionally
 * from anywhere for exactly this reason — the real-vs-mock branch lives
 * inside their handlers instead.
 */

import { createAvanzaMcpMarketDataService } from './avanzaMcpAdapter'
import {
  aiMarketBrief,
  allocation,
  getMockQuote,
  getPerformanceSeries,
  holdings,
  marketIndices,
  marketStatus,
  marketTrends,
  opportunities,
  portfolioSummary,
  reports,
  riskScore,
  screenerRows,
  searchInstrumentsLocal,
  watchlist,
} from '~/data/mockData'
import type {
  AIMarketBrief,
  AllocationSlice,
  Holding,
  Instrument,
  MarketIndexQuote,
  MarketStatus,
  MarketTrend,
  Opportunity,
  PerformancePoint,
  PortfolioSummary,
  Quote,
  ReportItem,
  RiskScore,
  ScreenerRow,
  TimeRange,
  WatchlistItem,
} from '~/types'

export interface MarketDataService {
  getMarketStatus(): Promise<MarketStatus>
  getMarketIndices(): Promise<MarketIndexQuote[]>
  getMarketTrends(): Promise<MarketTrend[]>
  getPortfolioSummary(): Promise<PortfolioSummary>
  getPerformance(range: TimeRange): Promise<PerformancePoint[]>
  getAllocation(): Promise<AllocationSlice[]>
  getRiskScore(): Promise<RiskScore>
  getHoldings(): Promise<Holding[]>
  getWatchlist(): Promise<WatchlistItem[]>
  getOpportunities(): Promise<Opportunity[]>
  getMarketBrief(): Promise<AIMarketBrief>
  getReports(): Promise<ReportItem[]>
  getScreenerRows(): Promise<ScreenerRow[]>
  searchInstruments(query: string): Promise<Instrument[]>
  /** Real-time (when AVANZA_MCP_ENABLED) last price/change for one instrument. */
  getQuote(instrumentId: string): Promise<Quote>
}

/**
 * Purely local implementation. No timers, no fake latency — the UI should never
 * pretend to make requests it isn't making.
 */
export const mockMarketDataService: MarketDataService = {
  getMarketStatus: async () => marketStatus,
  getMarketIndices: async () => marketIndices,
  getMarketTrends: async () => marketTrends,
  getPortfolioSummary: async () => portfolioSummary,
  getPerformance: async (range) => getPerformanceSeries(range),
  getAllocation: async () => allocation,
  getRiskScore: async () => riskScore,
  getHoldings: async () => holdings,
  getWatchlist: async () => watchlist,
  getOpportunities: async () => opportunities,
  getMarketBrief: async () => aiMarketBrief,
  getReports: async () => reports,
  getScreenerRows: async () => screenerRows,
  searchInstruments: async (query) => searchInstrumentsLocal(query),
  getQuote: async (instrumentId) => getMockQuote(instrumentId),
}

/**
 * Resolves the active service implementation. Always wired to the
 * Avanza-capable service — see the module doc above for why the real/mock
 * branch lives server-side, inside the `createServerFn` handlers, instead of
 * here.
 */
export function getMarketDataService(): MarketDataService {
  return createAvanzaMcpMarketDataService(mockMarketDataService)
}

export const marketDataService = getMarketDataService()
