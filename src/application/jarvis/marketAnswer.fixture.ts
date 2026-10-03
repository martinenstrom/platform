/**
 * A market brief and a week of history, as the tests of the market answer
 * and its renderers read them. Friday 2 October 2026: S&P 500 up 0,42 %
 * today and from last Friday's 7 650 to 7 772 this week (+1,59 %); Nasdaq
 * 100 up 0,7 % today and +0,8 % this week; the US ten-year up 14 bp this
 * week to 5,28 %. Trading days only. Test data; nothing imports this at
 * runtime.
 */

import {
  buildProvenance,
  buildSeries,
  SYM_DJIA,
  SYM_NASDAQ100,
  SYM_RUSSELL2000,
  SYM_SP500,
  SYM_US10Y,
  type CanonicalSymbol,
  type MarketSeries,
} from '~/domain/market'
import type { BriefQuote, BriefYield, MarketBrief, MarketScope } from './marketBrief'
import type { MarketHistorySource } from './marketHistory'

export const FIXTURE_NOW = new Date('2026-10-02T15:00:00.000Z')

/** Fri 25 Sep, then Mon 28 Sep – Fri 2 Oct. */
export const WEEK_DATES = [
  '2026-09-25',
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
] as const

const quote = (
  over: Partial<BriefQuote> &
    Pick<BriefQuote, 'symbol' | 'name' | 'level' | 'changePercent'>,
): BriefQuote => ({
  observedAt: '2026-10-02T14:59:40.000Z',
  source: 'Yahoo Finance',
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
  yieldPercent: 5.28,
  changeBasisPoints: -2,
  observationDate: '2026-10-02',
}

export const briefFixture = (scope: MarketScope): MarketBrief => ({
  scope,
  generatedAt: FIXTURE_NOW.toISOString(),
  indices: [
    quote({ symbol: 'idx:sp500', name: 'S&P 500', level: 7772, changePercent: 0.42 }),
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

const YAHOO = { providerId: 'yahoo', providerName: 'Yahoo Finance' }
const TREASURY = { providerId: 'treasury', providerName: 'U.S. Treasury' }

export const weekSeriesFixture = (
  symbol: CanonicalSymbol,
  values: readonly number[],
  source = YAHOO,
  quality: 'delayed' | 'official-daily' = 'delayed',
): MarketSeries =>
  buildSeries({
    symbol,
    interval: '1d',
    points: WEEK_DATES.map((date, index) => ({
      t: quality === 'official-daily' ? `${date}T00:00:00.000Z` : `${date}T20:00:00.000Z`,
      v: values[index]!,
    })),
    provenance: buildProvenance({
      asOf:
        quality === 'official-daily'
          ? '2026-10-02T00:00:00.000Z'
          : '2026-10-02T14:59:40.000Z',
      nowMs: FIXTURE_NOW.getTime(),
      source,
      quality,
    }),
  })

/** Two weeks of sessions, Fri 18 Sep – Fri 2 Oct, so "förra veckan" (seven days back) has its prior close on Thu 24 Sep. */
export const FORTNIGHT_DATES = [
  '2026-09-18',
  '2026-09-21',
  '2026-09-22',
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
] as const

const fortnightSeries = (
  symbol: CanonicalSymbol,
  values: readonly number[],
): MarketSeries =>
  buildSeries({
    symbol,
    interval: '1d',
    points: FORTNIGHT_DATES.map((date, index) => ({
      t: `${date}T20:00:00.000Z`,
      v: values[index]!,
    })),
    provenance: buildProvenance({
      asOf: '2026-10-02T14:59:40.000Z',
      nowMs: FIXTURE_NOW.getTime(),
      source: YAHOO,
      quality: 'delayed',
    }),
  })

const ok = (data: MarketSeries) => ({
  state: 'ok' as const,
  data,
  provenance: data.provenance,
})
const none = () => ({
  state: 'error' as const,
  error: {
    code: 'not-found' as const,
    message: 'none',
    providerId: null,
    retryable: false,
  },
})

/**
 * The four US majors over the fortnight, as the user's example reads them
 * for "förra veckan" — seven days back, so from the close of Fri 25 Sep to
 * Fri 2 Oct: Nasdaq 100 best at +0,65 %, the Dow +0,30 %, S&P 500 −0,27 %,
 * the Russell −0,50 %.
 */
export const usMajorsHistoryFixture: MarketHistorySource = {
  series: async (symbol) => {
    switch (symbol) {
      case SYM_SP500:
        return ok(
          fortnightSeries(
            SYM_SP500,
            [7700, 7710, 7720, 7730, 7740, 7743.41, 7750, 7730, 7735, 7740, 7722.72],
          ),
        )
      case SYM_NASDAQ100:
        return ok(
          fortnightSeries(
            SYM_NASDAQ100,
            [30400, 30450, 30500, 30550, 30580, 30608, 30700, 30650, 30750, 30790, 30808],
          ),
        )
      case SYM_DJIA:
        return ok(
          fortnightSeries(
            SYM_DJIA,
            [
              50000, 50100, 50200, 50300, 50400, 50500, 50600, 50550, 50650, 50700,
              50651.5,
            ],
          ),
        )
      case SYM_RUSSELL2000:
        return ok(
          fortnightSeries(
            SYM_RUSSELL2000,
            [2800, 2805, 2810, 2815, 2818, 2820, 2830, 2825, 2810, 2812, 2805.9],
          ),
        )
      default:
        return none()
    }
  },
}

/** S&P 500 7 650 → 7 772 (+1,59 %), Nasdaq 100 +0,8 %, the ten-year 5,14 → 5,28 (+14 bp); nothing else served. */
export const weekHistoryFixture: MarketHistorySource = {
  series: async (symbol) => {
    const data =
      symbol === SYM_SP500
        ? weekSeriesFixture(SYM_SP500, [7650, 7700, 7680, 7710, 7740, 7772])
        : symbol === SYM_NASDAQ100
          ? weekSeriesFixture(
              SYM_NASDAQ100,
              [23760, 23800, 23900, 23850, 23930, 23950.08],
            )
          : symbol === SYM_US10Y
            ? weekSeriesFixture(
                SYM_US10Y,
                [5.14, 5.2, 5.18, 5.25, 5.3, 5.28],
                TREASURY,
                'official-daily',
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
