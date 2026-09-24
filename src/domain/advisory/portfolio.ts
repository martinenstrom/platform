/**
 * The portfolio the firm manages for a client: what is held, how it is
 * allocated against the strategy the client agreed, and how it has performed.
 *
 * Phase 1 values are synthetic and say so through their valuation source.
 * The shapes are what a custodian feed or the market pipeline would later
 * fill: every holding carries the exposure tags a market event will be
 * matched against (currency, region, sector), so "US 10Y +20 bp — which
 * clients are affected?" needs data, not a rewrite.
 *
 * No client allocation is RECOMMENDED here (ruled 2026-08-17): the strategic
 * allocation is the client's agreed mandate, a fact; the deviation is
 * arithmetic on facts.
 */

import type { ClientId } from './client'

export type AssetClass = 'equities' | 'fixed-income' | 'alternatives' | 'cash'

export const ASSET_CLASSES: readonly AssetClass[] = [
  'equities',
  'fixed-income',
  'alternatives',
  'cash',
] as const

export type StrategicRole =
  'core-equity' | 'liquidity' | 'inflation-hedge' | 'satellite' | 'income' | 'diversifier'

export type Region = 'sweden' | 'nordics' | 'europe' | 'us' | 'emerging' | 'global'
export type Sector =
  | 'energy'
  | 'technology'
  | 'financials'
  | 'industrials'
  | 'healthcare'
  | 'real-estate'
  | 'consumer'
  | 'government'
  | 'credit'
  | 'multi'

export interface Allocation {
  assetClass: AssetClass
  /** The agreed strategic weight, percent. */
  strategicPercent: number
  /** The current weight, percent, at the valuation date. */
  currentPercent: number
}

export interface Holding {
  id: string
  portfolioId: string
  name: string
  assetClass: AssetClass
  marketValue: number
  /** Weight of the portfolio, percent, at the valuation date. */
  weightPercent: number
  /** Year-to-date performance, percent. */
  performanceYtdPercent: number
  role: StrategicRole
  currency: 'SEK' | 'USD' | 'EUR' | 'NOK' | 'DKK' | 'GBP'
  region: Region
  sector: Sector
}

export interface PerformancePoint {
  /** ISO date. */
  date: string
  /** Portfolio value index, 100 at the start of the series. */
  portfolio: number
  /** Benchmark index, 100 at the start of the series. */
  benchmark: number
}

export interface Portfolio {
  id: string
  clientId: ClientId
  /** ISO date the values were struck. */
  valuedAt: string
  source: 'synthetic' | 'custodian' | 'manual'
  totalValue: number
  benchmarkName: string
  allocation: readonly Allocation[]
  holdings: readonly Holding[]
  performance: readonly PerformancePoint[]
  /** Year-to-date performance of the whole portfolio, percent. */
  performanceYtdPercent: number
}

export interface AllocationDeviation {
  assetClass: AssetClass
  strategicPercent: number
  currentPercent: number
  /** Percentage points, current minus strategic; positive is overweight. */
  deviationPoints: number
}

export function allocationDeviations(
  portfolio: Portfolio,
): readonly AllocationDeviation[] {
  return portfolio.allocation.map((slice) => ({
    assetClass: slice.assetClass,
    strategicPercent: slice.strategicPercent,
    currentPercent: slice.currentPercent,
    deviationPoints:
      Math.round((slice.currentPercent - slice.strategicPercent) * 10) / 10,
  }))
}

/** The largest absolute deviation from strategy, or null for an empty allocation. */
export function largestDeviation(portfolio: Portfolio): AllocationDeviation | null {
  const deviations = allocationDeviations(portfolio)
  let largest: AllocationDeviation | null = null
  for (const deviation of deviations) {
    if (
      !largest ||
      Math.abs(deviation.deviationPoints) > Math.abs(largest.deviationPoints)
    ) {
      largest = deviation
    }
  }
  return largest
}

/** Currency exposure by holding currency, percent of portfolio value. */
export function currencyExposure(
  portfolio: Portfolio,
): readonly { currency: Holding['currency']; percent: number }[] {
  const byCurrency = new Map<Holding['currency'], number>()
  for (const holding of portfolio.holdings) {
    byCurrency.set(
      holding.currency,
      (byCurrency.get(holding.currency) ?? 0) + holding.weightPercent,
    )
  }
  return [...byCurrency.entries()]
    .map(([currency, percent]) => ({ currency, percent: Math.round(percent * 10) / 10 }))
    .sort(
      (a, b) =>
        b.percent - a.percent ||
        (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0),
    )
}

/** Sector exposure by holding sector, percent of portfolio value. */
export function sectorExposure(
  portfolio: Portfolio,
): readonly { sector: Sector; percent: number }[] {
  const bySector = new Map<Sector, number>()
  for (const holding of portfolio.holdings) {
    bySector.set(
      holding.sector,
      (bySector.get(holding.sector) ?? 0) + holding.weightPercent,
    )
  }
  return [...bySector.entries()]
    .map(([sector, percent]) => ({ sector, percent: Math.round(percent * 10) / 10 }))
    .sort(
      (a, b) =>
        b.percent - a.percent || (a.sector < b.sector ? -1 : a.sector > b.sector ? 1 : 0),
    )
}
