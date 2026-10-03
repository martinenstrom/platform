/**
 * A period's move comes from two points of a real series, or it does not
 * come at all: a fixture is refused, a series that does not reach the start
 * of the period is refused, and the day is never read as the week.
 */

import { describe, expect, it } from 'vitest'
import {
  buildProvenance,
  buildSeries,
  SYM_NASDAQ100,
  SYM_SP500,
  type Envelope,
  type MarketSeries,
  type SeriesPoint,
} from '~/domain/market'
import {
  moveFromSeries,
  periodPerformance,
  periodWindow,
  type MarketHistorySource,
} from './marketHistory'

const NOW = new Date('2026-10-02T15:00:00.000Z')
const YAHOO = { providerId: 'yahoo', providerName: 'Yahoo' }
const FIXTURE = { providerId: 'fixture', providerName: 'Fixture' }

const daily = (from: string, values: number[]): SeriesPoint[] =>
  values.map((v, index) => ({
    t: new Date(new Date(from).getTime() + index * 24 * 60 * 60 * 1000).toISOString(),
    v,
  }))

const series = (
  symbol: typeof SYM_SP500,
  points: SeriesPoint[],
  source = YAHOO,
  quality: 'eod' | 'fixture' = 'eod',
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

describe('the window a period covers', () => {
  it('reaches back a week, a month, to New Year, or over a named month', () => {
    expect(periodWindow({ kind: 'range', range: '1w' }, NOW)?.from.toISOString()).toBe(
      '2026-09-25T15:00:00.000Z',
    )
    expect(periodWindow({ kind: 'range', range: 'ytd' }, NOW)?.from.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    )
    const september = periodWindow({ kind: 'month', year: 2026, month: 9 }, NOW)!
    expect(september.from.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(september.to.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(september.range).toBe('3m')
  })

  it('has no window for today, for an unsupported period, or for a month still to come', () => {
    expect(periodWindow({ kind: 'today' }, NOW)).toBeNull()
    expect(periodWindow({ kind: 'unsupported', label: 'igår' }, NOW)).toBeNull()
    expect(periodWindow({ kind: 'month', year: 2026, month: 11 }, NOW)).toBeNull()
  })
})

describe('a move from a series', () => {
  const week = periodWindow({ kind: 'range', range: '1w' }, NOW)!

  it('is the last point over the first point inside the window', () => {
    /* Trading days 25 Sep – 2 Oct, the week's first close 6 400 and its last 6 489.6. */
    const outcome = moveFromSeries(
      series(
        SYM_SP500,
        daily(
          '2026-09-25T20:00:00.000Z',
          [6400, 6420, 6450, 6410, 6470, 6480, 6489.6, 6489.6],
        ),
      ),
      week,
    )
    expect('move' in outcome).toBe(true)
    if ('move' in outcome) {
      expect(outcome.move.changePercent).toBeCloseTo(1.4, 5)
      expect(outcome.move.from.v).toBe(6400)
      expect(outcome.move.to.v).toBe(6489.6)
      expect(outcome.move.source).toBe('Yahoo')
    }
  })

  it('refuses a fixture, however complete', () => {
    const outcome = moveFromSeries(
      series(
        SYM_SP500,
        daily(
          '2026-09-25T20:00:00.000Z',
          [6400, 6420, 6450, 6410, 6470, 6480, 6489.6, 6489.6],
        ),
        FIXTURE,
        'fixture',
      ),
      week,
    )
    expect(outcome).toEqual({ reason: 'fixture' })
  })

  it('refuses a series that starts after the period began, or ends long before now', () => {
    expect(
      moveFromSeries(
        series(SYM_SP500, daily('2026-09-30T20:00:00.000Z', [6450, 6470, 6489.6])),
        week,
      ),
    ).toEqual({
      reason: 'insufficient-coverage',
    })
    expect(
      moveFromSeries(
        series(SYM_SP500, daily('2026-09-25T20:00:00.000Z', [6400, 6420])),
        week,
      ),
    ).toEqual({
      reason: 'insufficient-coverage',
    })
    expect(
      moveFromSeries(
        series(SYM_SP500, [{ t: '2026-10-01T20:00:00.000Z', v: 6489.6 }]),
        week,
      ),
    ).toEqual({
      reason: 'insufficient-coverage',
    })
  })
})

describe('the period performance of several instruments', () => {
  const source: MarketHistorySource = {
    series: async (symbol) =>
      symbol === SYM_SP500
        ? ok(
            series(
              SYM_SP500,
              daily(
                '2026-09-25T20:00:00.000Z',
                [6400, 6420, 6450, 6410, 6470, 6480, 6489.6, 6489.6],
              ),
            ),
          )
        : {
            state: 'error',
            error: {
              code: 'not-found',
              message: 'no series',
              providerId: null,
              retryable: false,
            },
          },
  }

  it('serves what it can and names what it cannot, one never hiding the other', async () => {
    const performance = await periodPerformance(
      source,
      [SYM_SP500, SYM_NASDAQ100],
      { kind: 'range', range: '1w' },
      NOW,
    )
    expect(
      performance.moves.map((m) => [m.symbol, Number(m.changePercent.toFixed(2))]),
    ).toEqual([[SYM_SP500, 1.4]])
    expect(performance.missing).toEqual([
      { symbol: SYM_NASDAQ100, name: 'Nasdaq 100', reason: 'no-series' },
    ])
  })

  it('reports every instrument missing when no history source is bound, or the period has no series', async () => {
    const none = await periodPerformance(
      null,
      [SYM_SP500],
      { kind: 'range', range: '1w' },
      NOW,
    )
    expect(none.missing).toEqual([
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
          daily('2026-09-25T20:00:00.000Z', [100, 101, 102, 103, 104, 105, 106, 107]),
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
      { kind: 'range', range: '1w' },
      NOW,
    )
    expect(performance.moves).toEqual([])
    expect(performance.missing[0]?.reason).toBe('fixture')
  })
})
