/**
 * A period's move comes from two observations of a real series, or it does
 * not come at all: a fixture is refused, a series that does not reach the
 * start of the period is refused, and the day is never read as the week.
 */

import { describe, expect, it } from 'vitest'
import {
  buildProvenance,
  buildSeries,
  SYM_NASDAQ100,
  SYM_SP500,
  SYM_US10Y,
  type Envelope,
  type MarketSeries,
  type SeriesPoint,
} from '~/domain/market'
import {
  historyPeriodOf,
  periodPerformance,
  type MarketHistorySource,
} from './marketHistory'

/* Friday 2 October 2026, mid-session in New York. */
const NOW = new Date('2026-10-02T15:00:00.000Z')
const YAHOO = { providerId: 'yahoo', providerName: 'Yahoo Finance' }
const TREASURY = { providerId: 'treasury', providerName: 'U.S. Treasury' }
const FIXTURE = { providerId: 'fixture', providerName: 'Fixture' }

/** Trading days only: Fri 25 Sep, then Mon 28 Sep – Fri 2 Oct. */
const WEEK_DATES = [
  '2026-09-25',
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
]
const closes = (dates: readonly string[], values: readonly number[]): SeriesPoint[] =>
  dates.map((date, index) => ({ t: `${date}T20:00:00.000Z`, v: values[index]! }))

const series = (
  symbol: typeof SYM_SP500,
  points: SeriesPoint[],
  source = YAHOO,
  quality: 'delayed' | 'official-daily' | 'fixture' = 'delayed',
): MarketSeries =>
  buildSeries({
    symbol,
    interval: '1d',
    points,
    provenance: buildProvenance({
      asOf: points[points.length - 1]!.t,
      nowMs: NOW.getTime(),
      source,
      quality,
    }),
  })

const ok = (data: MarketSeries): Envelope<MarketSeries> => ({
  state: 'ok',
  data,
  provenance: data.provenance,
})
const none = (): Envelope<MarketSeries> => ({
  state: 'error',
  error: { code: 'not-found', message: 'no series', providerId: null, retryable: false },
})

describe('the query’s period as history measures it', () => {
  it('maps a range and a month, and has nothing for today or an unsupported period', () => {
    expect(historyPeriodOf({ kind: 'range', range: 'this-week' })).toEqual({
      kind: 'range',
      range: 'this-week',
    })
    expect(historyPeriodOf({ kind: 'month', year: 2026, month: 9 })).toEqual({
      kind: 'month',
      year: 2026,
      month: 9,
    })
    expect(historyPeriodOf({ kind: 'today' })).toBeNull()
    expect(historyPeriodOf({ kind: 'unsupported', label: 'igår' })).toBeNull()
  })
})

describe('the period performance of several instruments', () => {
  /* S&P 500: last Friday 7 650 → this Friday 7 772 (+1,59 %); Nasdaq 100 +0,8 %; the ten-year 5,14 → 5,28 (+14 bp). */
  const source: MarketHistorySource = {
    series: async (symbol) =>
      symbol === SYM_SP500
        ? ok(series(SYM_SP500, closes(WEEK_DATES, [7650, 7700, 7680, 7710, 7740, 7772])))
        : symbol === SYM_NASDAQ100
          ? ok(
              series(
                SYM_NASDAQ100,
                closes(WEEK_DATES, [23760, 23800, 23900, 23850, 23930, 23950.08]),
              ),
            )
          : symbol === SYM_US10Y
            ? ok(
                series(
                  SYM_US10Y,
                  WEEK_DATES.map((date, index) => ({
                    t: `${date}T00:00:00.000Z`,
                    v: [5.14, 5.2, 5.18, 5.25, 5.3, 5.28][index]!,
                  })),
                  TREASURY,
                  'official-daily',
                ),
              )
            : none(),
  }

  it('measures the week from the close before it to the latest close, by the kind of instrument', async () => {
    const week = await periodPerformance(
      source,
      [SYM_SP500, SYM_US10Y],
      { kind: 'range', range: 'this-week' },
      NOW,
    )
    expect(week.missing).toEqual([])
    const [sp, ten] = week.moves
    expect(sp?.start).toMatchObject({ date: '2026-09-25', value: 7650 })
    expect(sp?.end).toMatchObject({ date: '2026-10-02', value: 7772 })
    expect(sp?.changePercent).toBeCloseTo(1.5948, 3)
    expect(sp?.changeBasisPoints).toBeNull()
    expect(sp?.sessions).toBe(5)
    /* A yield moves in basis points, never in "performance". */
    expect(ten?.changeBasisPoints).toBeCloseTo(14, 6)
    expect(ten?.changePercent).toBeNull()
  })

  it('serves what it can and names what it cannot, one never hiding the other', async () => {
    const performance = await periodPerformance(
      source,
      [SYM_SP500, 'idx:dax' as typeof SYM_SP500],
      { kind: 'range', range: 'this-week' },
      NOW,
    )
    expect(performance.moves.map((m) => m.symbol)).toEqual([SYM_SP500])
    expect(performance.missing).toEqual([
      { symbol: 'idx:dax', name: 'DAX', reason: 'no-series' },
    ])
  })

  it('reports every instrument missing when no history source is bound, or the period has no series', async () => {
    const none_ = await periodPerformance(
      null,
      [SYM_SP500],
      { kind: 'range', range: 'this-week' },
      NOW,
    )
    expect(none_.missing).toEqual([
      { symbol: SYM_SP500, name: 'S&P 500', reason: 'no-history-source' },
    ])
    const yesterday = await periodPerformance(
      source,
      [SYM_SP500],
      { kind: 'unsupported', label: 'igår' },
      NOW,
    )
    expect(yesterday.missing[0]?.reason).toBe('unsupported-period')
  })

  it('reports a fixture series as missing, never as a move', async () => {
    const fixtures: MarketHistorySource = {
      series: async (symbol) => ({
        state: 'fixture',
        data: series(
          symbol as typeof SYM_SP500,
          closes(WEEK_DATES, [100, 101, 102, 103, 104, 105]),
          FIXTURE,
          'fixture',
        ),
        provenance: buildProvenance({
          asOf: NOW.toISOString(),
          nowMs: NOW.getTime(),
          source: FIXTURE,
          quality: 'fixture',
        }),
        reason: 'no live series provider',
      }),
    }
    const performance = await periodPerformance(
      fixtures,
      [SYM_SP500],
      { kind: 'range', range: 'this-week' },
      NOW,
    )
    expect(performance.moves).toEqual([])
    expect(performance.missing[0]?.reason).toBe('fixture')
  })

  it('never reads a daily change as a period change: the move is two observations of the series', async () => {
    const week = await periodPerformance(
      source,
      [SYM_SP500],
      { kind: 'range', range: 'this-week' },
      NOW,
    )
    const move = week.moves[0]!
    expect(move.changePercent).toBeCloseTo((7772 / 7650 - 1) * 100, 6)
    /* The last session's own change (7 740 → 7 772, +0,41 %) is not the week's. */
    expect(Math.abs(move.changePercent! - (7772 / 7740 - 1) * 100)).toBeGreaterThan(1)
  })
})
