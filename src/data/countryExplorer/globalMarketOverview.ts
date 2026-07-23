import { buildTrendSeries } from './trendSeries'
import type { MacroIndicator } from '~/types/countryExplorer'

/**
 * Global market-context figures for the Command Center's "Market Overview"
 * panel — illustrative headline figures in the same honest-mock convention
 * as every other fixture in this app, reusing the existing `MacroIndicator`
 * shape (value/change/trend/tone/sparkline) rather than a parallel type.
 */
export const GLOBAL_MARKET_OVERVIEW: MacroIndicator[] = [
  {
    id: 'global-equity-index',
    label: 'Global Equity Index',
    value: '7 542.31',
    previousValue: '7 488.28',
    change: '+0.72%',
    trend: 'up',
    tone: 'positive',
    period: 'Idag',
    source: 'Illustrativt index',
    sparkline: buildTrendSeries(7542.31, 21),
  },
  {
    id: 'vix',
    label: 'VIX',
    value: '14.28',
    previousValue: '14.44',
    change: '−1.12%',
    trend: 'down',
    tone: 'positive',
    period: 'Idag',
    source: 'Illustrativt index',
    sparkline: buildTrendSeries(14.28, 22),
  },
  {
    id: '10y-us-yield',
    label: '10Y U.S. Yield',
    value: '4.32%',
    previousValue: '4.32%',
    change: '+0.00 pp',
    trend: 'flat',
    tone: 'neutral',
    period: 'Idag',
    source: 'Illustrativt', // matches every other fixture's "not live" framing
    sparkline: buildTrendSeries(4.32, 23),
  },
  {
    id: 'dxy-index',
    label: 'DXY Index',
    value: '104.31',
    previousValue: '104.09',
    change: '+0.21%',
    trend: 'up',
    tone: 'neutral',
    period: 'Idag',
    source: 'Illustrativt index',
    sparkline: buildTrendSeries(104.31, 24),
  },
]

export type RiskSentiment = 'risk-on' | 'neutral' | 'risk-off'

/** 0-100 gauge position; higher = more risk-on. Illustrative, not a computed signal. */
export const GLOBAL_RISK_SENTIMENT: { sentiment: RiskSentiment; position: number } = {
  sentiment: 'risk-on',
  position: 72,
}
