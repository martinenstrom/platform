/**
 * Domain types for the dashboard.
 * These are intentionally transport-agnostic: the Avanza MCP adapter in
 * `src/services/` is responsible for mapping upstream payloads into these shapes.
 */

export type TimeRange = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL'

export type Trend = 'up' | 'down' | 'flat'

export type Tone = 'positive' | 'negative' | 'neutral' | 'warning' | 'accent'

export type InstrumentType = 'stock' | 'fund' | 'etf' | 'index' | 'currency' | 'crypto'

export interface Instrument {
  id: string
  name: string
  ticker: string
  type: InstrumentType
  market: string
  currency: string
}

export interface Quote {
  instrumentId: string
  price: number
  change: number
  changePercent: number
  currency: string
  updatedAt: string
}

export interface MarketIndexQuote {
  id: string
  name: string
  value: number
  changePercent: number
  /** Decimals used when rendering the value (FX pairs need more than indices). */
  precision: number
  currency?: string
}

export interface PortfolioSummary {
  totalValue: number
  dayChange: number
  dayChangePercent: number
  monthChangePercent: number
  investedCapital: number
  cashBalance: number
  /** Cash plus any available margin — what can be deployed right now. */
  buyingPower: number
  unrealizedResult: number
  unrealizedResultPercent: number
  currency: string
}

export interface PerformancePoint {
  /** ISO date or intraday label depending on the selected range. */
  t: string
  portfolio: number
  benchmark: number
}

export interface AllocationSlice {
  id: string
  label: string
  value: number
  percent: number
  color: string
}

export type RiskLevel = 'low' | 'moderate' | 'elevated' | 'high'

export interface RiskScore {
  score: number
  level: RiskLevel
  label: string
  description: string
  updatedAt: string
}

export interface WatchlistItem {
  id: string
  name: string
  ticker: string
  price: number
  changePercent: number
  currency: string
  /** Short intraday series used by the sparkline. */
  spark: number[]
  signal: SignalType
}

export type SignalType = 'buy' | 'sell' | 'hold' | 'watch'

export interface Opportunity {
  id: string
  instrument: string
  ticker: string
  signal: SignalType
  confidence: number
  rationale: string
  horizon: string
}

export interface AIObservation {
  id: string
  title: string
  detail: string
  tone: Tone
}

export interface AIMarketBrief {
  id: string
  summary: string
  generatedAt: string
  model: string
  observations: AIObservation[]
}

/*
 * `Agent` and `AgentStatus` lived here, describing a long-lived worker with an
 * `activity` sentence and a 0–100 `progress` number. Both are gone.
 *
 * They were the shape of the simulated fleet, and nothing in the institution
 * has that shape: a real desk is a `Department` in the seeded organization, and
 * a real execution is an `AgentRunRecord` with a twelve-state machine, a
 * recorded budget, measured usage and an execution identity. A run reports
 * state transitions and never a completion fraction, so `progress` could only
 * ever have been a number nobody measured — which is precisely what it was.
 *
 * Agent Headquarters reads `application/analysis/agentDirectory` instead.
 */

export type AnalysisStatus = 'completed' | 'running' | 'queued' | 'failed'

export interface AnalysisRun {
  id: string
  instrument: string
  ticker: string
  type: string
  generatedAt: string
  status: AnalysisStatus
}

export interface MarketTrend {
  id: string
  label: string
  value: string
  description: string
  /** 0–100 fill used by the indicator bar. */
  strength: number
  tone: Tone
  trend: Trend
}

export interface Holding {
  id: string
  name: string
  ticker: string
  quantity: number
  averagePrice: number
  lastPrice: number
  marketValue: number
  changePercent: number
  weight: number
  currency: string
}

export interface ScreenerRow {
  id: string
  name: string
  ticker: string
  sector: string
  price: number
  changePercent: number
  peRatio: number
  dividendYield: number
  marketCap: number
}

export interface ReportItem {
  id: string
  title: string
  type: string
  createdAt: string
  status: AnalysisStatus
  pages: number
}

export interface MarketStatus {
  isOpen: boolean
  label: string
  detail: string
}
