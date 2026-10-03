/**
 * A market brief and a week of history, as the tests of the market answer
 * and its renderers read them: S&P 500 up 0,42 % today and 1,4 % over the
 * week, Nasdaq 100 up 0,7 % today and 0,8 % over the week, one US yield.
 * Test data only; nothing imports this at runtime.
 */

import {
  buildProvenance,
  buildSeries,
  SYM_NASDAQ100,
  SYM_SP500,
  type MarketSeries,
} from '~/domain/market'
import type { BriefQuote, BriefYield, MarketBrief, MarketScope } from './marketBrief'
import type { MarketHistorySource } from './marketHistory'

export const FIXTURE_NOW = new Date('2026-10-02T15:00:00.000Z')

const quote = (
  over: Partial<BriefQuote> &
    Pick<BriefQuote, 'symbol' | 'name' | 'level' | 'changePercent'>,
): BriefQuote => ({
  observedAt: '2026-10-02T14:59:40.000Z',
  source: 'Yahoo',
  quality: 'delayed',
  session: 'open',
  freshness: 'current',
  delivery: 'fresh',
  changeAbsolute: null,
  changePeriod: 'intraday',
  ...over,
})

const us10y: BriefYield = {
  symbol: 'rate:us10y',
  name: '10Y U.S. Yield',
  observedAt: '2026-10-02T00:00:00.000Z',
  source: 'U.S. Treasury',
  quality: 'official-daily',
  session: 'unknown',
  freshness: 'current',
  delivery: 'fresh',
  yieldPercent: 4.12,
  changeBasisPoints: 4,
  observationDate: '2026-10-02',
}

export const briefFixture = (scope: MarketScope): MarketBrief => ({
  scope,
  generatedAt: FIXTURE_NOW.toISOString(),
  indices: [
    quote({ symbol: 'idx:sp500', name: 'S&P 500', level: 6512.3, changePercent: 0.42 }),
    quote({
      symbol: 'idx:nasdaq100',
      name: 'Nasdaq 100',
      level: 23950,
      changePercent: 0.7,
    }),
  ],
  sectors: [],
  rates: [us10y],
  curveSlopeBasisPoints: null,
  fx: [],
  commodities: [],
  riskAppetite: null,
  headlines: [],
  unavailable: [],
  notServed: ['Dow Jones'],
})

const YAHOO = { providerId: 'yahoo', providerName: 'Yahoo' }

export const weekSeriesFixture = (
  symbol: typeof SYM_SP500,
  values: number[],
): MarketSeries =>
  buildSeries({
    symbol,
    interval: '1d',
    points: values.map((v, index) => ({
      t: new Date(Date.UTC(2026, 8, 25 + index, 20)).toISOString(),
      v,
    })),
    provenance: buildProvenance({
      asOf: '2026-10-02T20:00:00.000Z',
      nowMs: FIXTURE_NOW.getTime(),
      source: YAHOO,
      quality: 'eod',
    }),
  })

/** S&P 500 up 1,4 % over the week, Nasdaq 100 up 0,8 %; nothing else served. */
export const weekHistoryFixture: MarketHistorySource = {
  series: async (symbol) => {
    const data =
      symbol === SYM_SP500
        ? weekSeriesFixture(
            SYM_SP500,
            [6400, 6420, 6450, 6410, 6470, 6480, 6489.6, 6489.6],
          )
        : symbol === SYM_NASDAQ100
          ? weekSeriesFixture(
              SYM_NASDAQ100,
              [23760, 23800, 23900, 23850, 23900, 23930, 23950.08, 23950.08],
            )
          : null
    return data
      ? { state: 'ok', data, provenance: data.provenance }
      : {
          state: 'error',
          error: {
            code: 'not-found',
            message: 'none',
            providerId: null,
            retryable: false,
          },
        }
  },
}
