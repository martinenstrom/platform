import { buildTrendSeries } from './trendSeries'
import type { WatchlistItem } from '~/types'

/**
 * Global top-movers lists for the "Top Movers" card — illustrative prices,
 * reusing the existing `WatchlistItem` shape (already used by the
 * Watchlist page) rather than a parallel type.
 */
export const GLOBAL_TOP_GAINERS: WatchlistItem[] = [
  {
    id: 'nvda',
    name: 'NVIDIA Corp',
    ticker: 'NVDA',
    price: 138.42,
    changePercent: 3.42,
    currency: 'USD',
    spark: buildTrendSeries(138.42, 31),
    signal: 'buy',
  },
  {
    id: 'asml',
    name: 'ASML Holding',
    ticker: 'ASML',
    price: 862.1,
    changePercent: 2.98,
    currency: 'EUR',
    spark: buildTrendSeries(862.1, 32),
    signal: 'buy',
  },
  {
    id: 'sap',
    name: 'SAP SE',
    ticker: 'SAP',
    price: 224.6,
    changePercent: 2.11,
    currency: 'EUR',
    spark: buildTrendSeries(224.6, 33),
    signal: 'buy',
  },
  {
    id: 'mc-pa',
    name: 'LVMH',
    ticker: 'MC.PA',
    price: 638.9,
    changePercent: 1.89,
    currency: 'EUR',
    spark: buildTrendSeries(638.9, 34),
    signal: 'buy',
  },
  {
    id: 'novo-b',
    name: 'Novo Nordisk',
    ticker: 'NOVO B',
    price: 812.3,
    changePercent: 1.75,
    currency: 'DKK',
    spark: buildTrendSeries(812.3, 35),
    signal: 'buy',
  },
]

export const GLOBAL_TOP_LOSERS: WatchlistItem[] = [
  {
    id: 'ba',
    name: 'Boeing Co',
    ticker: 'BA',
    price: 168.2,
    changePercent: -2.64,
    currency: 'USD',
    spark: buildTrendSeries(168.2, 36),
    signal: 'sell',
  },
  {
    id: 'byd',
    name: 'BYD Co',
    ticker: '1211.HK',
    price: 231.4,
    changePercent: -2.1,
    currency: 'HKD',
    spark: buildTrendSeries(231.4, 37),
    signal: 'sell',
  },
  {
    id: 'ubs',
    name: 'UBS Group',
    ticker: 'UBSG',
    price: 27.85,
    changePercent: -1.48,
    currency: 'CHF',
    spark: buildTrendSeries(27.85, 38),
    signal: 'sell',
  },
]

export const GLOBAL_TOP_ACTIVE: WatchlistItem[] = [
  {
    id: 'aapl',
    name: 'Apple Inc',
    ticker: 'AAPL',
    price: 229.14,
    changePercent: 0.38,
    currency: 'USD',
    spark: buildTrendSeries(229.14, 39),
    signal: 'watch',
  },
  {
    id: 'tsla',
    name: 'Tesla Inc',
    ticker: 'TSLA',
    price: 268.5,
    changePercent: -0.62,
    currency: 'USD',
    spark: buildTrendSeries(268.5, 40),
    signal: 'watch',
  },
  {
    id: 'msft',
    name: 'Microsoft Corp',
    ticker: 'MSFT',
    price: 441.7,
    changePercent: 0.55,
    currency: 'USD',
    spark: buildTrendSeries(441.7, 41),
    signal: 'watch',
  },
]
