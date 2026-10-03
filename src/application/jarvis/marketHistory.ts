/**
 * A period's move, as JARVIS reads it from the platform's history.
 *
 * The one consumer of `application/marketData/history`: the market query
 * names the instruments and the period, this module reads each series
 * through the port and hands back the changes with their reasons for
 * absence. Nothing here derives a week from a day — a period move comes
 * from two observations of a real series or it does not come at all —
 * and a fixture is never quoted as the market.
 */

import type { CanonicalSymbol } from '~/domain/market'
import {
  periodChanges,
  type HistoricalSeriesSource,
  type HistoryMissingReason,
  type HistoryPeriod,
  type PeriodChange,
} from '~/application/marketData/history'
import type { MarketPeriod } from './marketQuery'

export type {
  HistoricalSeriesSource as MarketHistorySource,
  PeriodChange,
} from '~/application/marketData/history'

export type PeriodMissingReason = HistoryMissingReason

export interface PeriodMissing {
  symbol: CanonicalSymbol
  name: string
  reason: PeriodMissingReason
}

export interface PeriodPerformance {
  moves: PeriodChange[]
  missing: PeriodMissing[]
}

/** The query's period as the history service measures it; null for today and for a period no series covers. */
export function historyPeriodOf(period: MarketPeriod): HistoryPeriod | null {
  switch (period.kind) {
    case 'today':
    case 'unsupported':
      return null
    case 'range':
      return { kind: 'range', range: period.range }
    case 'month':
      return { kind: 'month', year: period.year, month: period.month }
  }
}

/**
 * The moves of the symbols over the period, and what could not be served.
 * One missing symbol never hides another's move.
 */
export async function periodPerformance(
  source: HistoricalSeriesSource | null,
  symbols: readonly CanonicalSymbol[],
  period: MarketPeriod,
  now: Date,
): Promise<PeriodPerformance> {
  const history = historyPeriodOf(period)
  if (!history) {
    return {
      moves: [],
      missing: symbols.map((symbol) => ({
        symbol,
        name: nameOf(symbol),
        reason: 'unsupported-period',
      })),
    }
  }
  const result = await periodChanges(source, symbols, history, now)
  return { moves: result.changes, missing: result.missing }
}

function nameOf(symbol: CanonicalSymbol): string {
  return DISPLAY_NAMES[symbol] ?? symbol
}

const DISPLAY_NAMES: Partial<Record<string, string>> = {
  'idx:sp500': 'S&P 500',
  'idx:nasdaq100': 'Nasdaq 100',
  'idx:omxs30': 'OMXS30',
  'idx:dax': 'DAX',
  'idx:ftse100': 'FTSE 100',
  'idx:nikkei225': 'Nikkei 225',
  'idx:djia': 'Dow Jones',
  'idx:russell2000': 'Russell 2000',
  'rate:us10y': '10Y U.S. Yield',
  'rate:us2y': '2Y U.S. Yield',
  'fx:usdsek': 'USD/SEK',
  'fx:eurusd': 'EUR/USD',
}
