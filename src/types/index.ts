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

/**
 * Agents are the primary objects in the product: long-lived workers that observe
 * markets and the portfolio and report back. A run is one execution of an agent.
 */
export type AgentStatus = 'running' | 'finished' | 'waiting' | 'failed'

export interface Agent {
  id: string
  name: string
  /** One line on what this agent is for. */
  role: string
  status: AgentStatus
  /** What the agent is doing now, or what it concluded when it last ran. */
  activity: string
  /** Headline result of the last completed run, if any. */
  result?: string
  lastRunAt: string
  /** 0–100, only meaningful while `status` is 'running'. */
  progress?: number
}

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
