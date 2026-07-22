/**
 * Market data service — the single seam between the UI and any real data source.
 *
 * Most methods still return local mock data. `searchInstruments` and
 * `getMarketStatus` are real when `AVANZA_MCP_ENABLED=true` (see
 * `./avanzaMcpAdapter.ts` for exactly which methods and why only those two).
 * The interface is async-shaped throughout, so this swap requires no
 * component changes either way — components should only ever import
 * `marketDataService`, never the mock module directly.
 */

import { createAvanzaMcpMarketDataService } from './avanzaMcpAdapter'
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
 * Opt-in, not default: the real Avanza integration spawns a Python
 * subprocess (`uvx avanza-mcp`) and makes live network calls, both of which
 * require that host to have `uv` installed — set `AVANZA_MCP_ENABLED=true`
 * (in a local, gitignored `.env`) once that's true for your environment.
 */
export function getMarketDataService(): MarketDataService {
  // Guard `typeof process` — this module is also evaluated in the browser
  // bundle, where `process` does not exist.
  const avanzaMcpEnabled =
    typeof process !== 'undefined' && process.env.AVANZA_MCP_ENABLED === 'true'
  if (avanzaMcpEnabled) {
    return createAvanzaMcpMarketDataService(mockMarketDataService)
  }
  return mockMarketDataService
}

export const marketDataService = getMarketDataService()
