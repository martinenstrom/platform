/**
 * Market data service — the single seam between the UI and any real data source.
 *
 * Today every method returns local mock data synchronously. The interface is
 * already async-shaped so swapping in the Avanza MCP adapter (see
 * `./avanzaMcpAdapter.ts`) requires no component changes.
 *
 * INTEGRATION POINT
 * -----------------
 * Replace `mockMarketDataService` with `createAvanzaMcpMarketDataService(...)`
 * in `getMarketDataService()` once the MCP client is wired up. Components should
 * only ever import `marketDataService`, never the mock module directly.
 */

import {
  agents,
  aiMarketBrief,
  allocation,
  getPerformanceSeries,
  holdings,
  instrumentUniverse,
  marketIndices,
  marketStatus,
  marketTrends,
  opportunities,
  portfolioSummary,
  recentAnalyses,
  reports,
  riskScore,
  screenerRows,
  watchlist,
} from '~/data/mockData'
import type {
  Agent,
  AIMarketBrief,
  AllocationSlice,
  AnalysisRun,
  Holding,
  Instrument,
  MarketIndexQuote,
  MarketStatus,
  MarketTrend,
  Opportunity,
  PerformancePoint,
  PortfolioSummary,
  ReportItem,
  RiskScore,
  ScreenerRow,
  TimeRange,
  WatchlistItem,
} from '~/types'

export interface MarketDataService {
  getAgents(): Promise<Agent[]>
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
  getRecentAnalyses(): Promise<AnalysisRun[]>
  getReports(): Promise<ReportItem[]>
  getScreenerRows(): Promise<ScreenerRow[]>
  searchInstruments(query: string): Promise<Instrument[]>
}

/**
 * Purely local implementation. No timers, no fake latency — the UI should never
 * pretend to make requests it isn't making.
 */
export const mockMarketDataService: MarketDataService = {
  getAgents: async () => agents,
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
  getRecentAnalyses: async () => recentAnalyses,
  getReports: async () => reports,
  getScreenerRows: async () => screenerRows,
  searchInstruments: async (query) => searchInstrumentsLocal(query),
}

/** Synchronous variant used by the header search, which filters as you type. */
export function searchInstrumentsLocal(query: string, limit = 6): Instrument[] {
  const q = query.trim().toLocaleLowerCase('sv-SE')
  if (!q) return []
  return instrumentUniverse
    .filter(
      (instrument) =>
        instrument.name.toLocaleLowerCase('sv-SE').includes(q) ||
        instrument.ticker.toLocaleLowerCase('sv-SE').includes(q),
    )
    .slice(0, limit)
}

/**
 * Resolves the active service implementation.
 *
 * TODO(avanza-mcp): return the MCP-backed service when a client is configured,
 * e.g. `return createAvanzaMcpMarketDataService(mcpClient)`.
 */
export function getMarketDataService(): MarketDataService {
  return mockMarketDataService
}

export const marketDataService = getMarketDataService()
