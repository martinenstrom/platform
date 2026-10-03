/**
 * The series contract and the period change: trading-day policy, per-kind
 * calculation, completeness, and nothing fabricated.
 */

import { describe, expect, it } from 'vitest'
import {
  buildProvenance,
  buildSeries,
  SYM_EURUSD,
  SYM_SP500,
  SYM_US10Y,
  SYM_USDSEK,
  type CanonicalSymbol,
  type Envelope,
  type MarketSeries,
  type SeriesPoint,
} from '~/domain/market'
import {
  MAX_GAP_CALENDAR_DAYS,
  metricOf,
  periodBounds,
  periodChange,
  periodChanges,
  toHistoricalSeries,
  type HistoricalSeriesSource,
} from './history'

/* Friday 2 October 2026, 15:00 UTC. */
const NOW = new Date('2026-10-02T15:00:00.000Z')
const YAHOO = { providerId: 'yahoo', providerName: 'Yahoo Finance' }

const tradingDays = (from: string, count: number): string[] => {
  const out: string[] = []
  const cursor = new Date(`${from}T00:00:00.000Z`)
  while (out.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const closesOn = (
  dates: readonly string[],
  values: readonly number[],
  hour = 20,
): SeriesPoint[] =>
  dates.map((date, index) => ({
    t: `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`,
    v: values[index]!,
  }))

const series = (
  symbol: CanonicalSymbol,
  points: SeriesPoint[],
  quality: 'delayed' | 'eod' | 'official-daily' = 'delayed',
): MarketSeries =>
  buildSeries({
    symbol,
    interval: '1d',
    points,
    provenance: buildProvenance({
      asOf: points[points.length - 1]!.t,
      nowMs: NOW.getTime(),
      source: YAHOO,
      quality,
    }),
  })

const ok = (data: MarketSeries): Envelope<MarketSeries> => ({
  state: 'ok',
  data,
  provenance: data.provenance,
})

describe('the typed series', () => {
  it('keeps the observations inside the window, judges completeness, and names the source', () => {
    const dates = tradingDays('2026-09-01', 24)
    const typed = toHistoricalSeries(
      series(
        SYM_SP500,
        closesOn(
          dates,
          dates.map((_, i) => 7600 + i),
        ),
      ),
      {
        from: '2026-09-01',
        to: '2026-10-02',
      },
    )
    expect(typed.frequency).toBe('daily')
    expect(typed.metric).toBe('price')
    expect(typed.start).toBe('2026-09-01')
    expect(typed.end).toBe('2026-10-02')
    expect(typed.observations).toHaveLength(24)
    expect(typed.source).toEqual({ providerId: 'yahoo', providerName: 'Yahoo Finance' })
    expect(typed.isCompleteForRequestedRange).toBe(true)
    expect(typed.gaps).toEqual([])
  })

  it('marks a hole beyond the trading-calendar policy as a gap, and the series incomplete', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-15', '2026-09-16']
    const typed = toHistoricalSeries(series(SYM_SP500, closesOn(dates, [1, 2, 3, 4])), {
      from: '2026-09-01',
      to: '2026-09-16',
    })
    expect(typed.gaps).toEqual([
      { from: '2026-09-02', to: '2026-09-15', calendarDays: 13 },
    ])
    expect(typed.isCompleteForRequestedRange).toBe(false)
    expect(MAX_GAP_CALENDAR_DAYS).toBe(6)
  })

  it('knows a yield from a price from an FX pair', () => {
    expect(metricOf(SYM_SP500)).toBe('price')
    expect(metricOf(SYM_US10Y)).toBe('yield')
    expect(metricOf(SYM_USDSEK)).toBe('fx')
  })
})

describe('the period bounds at a Friday in October', () => {
  it('measures the week from the close before Monday, five sessions as sessions, and a named month inside itself', () => {
    const week = periodBounds({ kind: 'range', range: 'this-week' }, NOW)!
    expect(week.startRule).toBe('prior-close')
    expect(week.boundary).toBe('2026-09-27')
    expect(week.fetch).toEqual({ from: '2026-09-01', to: '2026-10-02' })
    const five = periodBounds({ kind: 'range', range: '5d' }, NOW)!
    expect(five.startRule).toBe('sessions-back')
    expect(five.sessions).toBe(5)
    const september = periodBounds({ kind: 'month', year: 2026, month: 9 }, NOW)!
    expect(september.startRule).toBe('first-in-window')
    expect(september.window).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    const october = periodBounds({ kind: 'month', year: 2026, month: 10 }, NOW)!
    expect(october.window).toEqual({ from: '2026-10-01', to: '2026-10-02' })
    expect(periodBounds({ kind: 'month', year: 2026, month: 11 }, NOW)).toBeNull()
  })

  it('sets month-to-date and year-to-date from the previous period’s last close', () => {
    expect(periodBounds({ kind: 'range', range: 'mtd' }, NOW)?.boundary).toBe(
      '2026-09-30',
    )
    expect(periodBounds({ kind: 'range', range: 'ytd' }, NOW)?.boundary).toBe(
      '2025-12-31',
    )
    expect(periodBounds({ kind: 'range', range: '1w' }, NOW)?.boundary).toBe('2026-09-25')
    expect(periodBounds({ kind: 'range', range: '1m' }, NOW)?.boundary).toBe('2026-09-02')
  })
})

describe('the change over a period', () => {
  /* Fri 25 Sep 7 650, then Mon 28 Sep – Fri 2 Oct up to 7 772. */
  const week = tradingDays('2026-09-25', 6)
  const sp = toHistoricalSeries(
    series(SYM_SP500, closesOn(week, [7650, 7700, 7680, 7710, 7740, 7772])),
    {
      from: '2026-09-01',
      to: '2026-10-02',
    },
  )

  it('this week: from the previous Friday’s close to the latest close — a weekend boundary snaps to the prior session', () => {
    const outcome = periodChange(
      sp,
      periodBounds({ kind: 'range', range: 'this-week' }, NOW)!,
      NOW,
    )
    expect('change' in outcome).toBe(true)
    if (!('change' in outcome)) return
    expect(outcome.change.start.date).toBe('2026-09-25')
    expect(outcome.change.end.date).toBe('2026-10-02')
    expect(outcome.change.changePercent).toBeCloseTo((7772 / 7650 - 1) * 100, 6)
    expect(outcome.change.sessions).toBe(5)
    expect(outcome.change.latestIsStale).toBe(false)
  })

  it('five sessions: exactly the latest five, from the close before the first of them', () => {
    const outcome = periodChange(
      sp,
      periodBounds({ kind: 'range', range: '5d' }, NOW)!,
      NOW,
    )
    expect('change' in outcome && outcome.change.start.date).toBe('2026-09-25')
    expect('change' in outcome && outcome.change.sessions).toBe(5)
    /* Four sessions in the series: not five, so no five-session move. */
    const short = toHistoricalSeries(
      series(SYM_SP500, closesOn(week.slice(2), [7680, 7710, 7740, 7772])),
      { from: '2026-09-01', to: '2026-10-02' },
    )
    expect(
      periodChange(short, periodBounds({ kind: 'range', range: '5d' }, NOW)!, NOW),
    ).toEqual({ reason: 'insufficient-coverage' })
  })

  it('a named month: first to last observation inside the month, and to the latest when the month is under way', () => {
    const dates = tradingDays('2026-08-28', 26)
    const values = dates.map((_, i) => 7500 + i * 10)
    const long = toHistoricalSeries(series(SYM_SP500, closesOn(dates, values)), {
      from: '2026-08-01',
      to: '2026-10-02',
    })
    const september = periodChange(
      long,
      periodBounds({ kind: 'month', year: 2026, month: 9 }, NOW)!,
      NOW,
    )
    expect('change' in september && september.change.start.date).toBe('2026-09-01')
    expect('change' in september && september.change.end.date).toBe('2026-09-30')
    const october = periodChange(
      long,
      periodBounds({ kind: 'month', year: 2026, month: 10 }, NOW)!,
      NOW,
    )
    expect('change' in october && october.change.start.date).toBe('2026-10-01')
    expect('change' in october && october.change.end.date).toBe('2026-10-02')
  })

  it('year to date: from the previous year’s last close', () => {
    const dates = [
      '2025-12-30',
      '2025-12-31',
      '2026-01-02',
      ...tradingDays('2026-09-28', 5),
    ]
    const values = [7000, 7050, 7100, 7700, 7710, 7720, 7730, 7772]
    const typed = toHistoricalSeries(series(SYM_SP500, closesOn(dates, values)), {
      from: '2025-12-01',
      to: '2026-10-02',
    })
    const gapped = periodChange(
      typed,
      periodBounds({ kind: 'range', range: 'ytd' }, NOW)!,
      NOW,
    )
    /* The series skips from January to September: incomplete, and said so rather than interpolated. */
    expect(gapped).toEqual({ reason: 'incomplete-series' })
    const full = tradingDays('2025-12-29', 200)
    const complete = toHistoricalSeries(
      series(
        SYM_SP500,
        closesOn(
          full,
          full.map((_, i) => 7000 + i),
        ),
      ),
      { from: '2025-12-01', to: '2026-10-02' },
    )
    const ytd = periodChange(
      complete,
      periodBounds({ kind: 'range', range: 'ytd' }, NOW)!,
      NOW,
    )
    expect('change' in ytd && ytd.change.start.date).toBe('2025-12-31')
  })

  it('refuses a series that does not reach back to the period’s start', () => {
    const late = toHistoricalSeries(
      series(SYM_SP500, closesOn(week.slice(3), [7710, 7740, 7772])),
      { from: '2026-09-01', to: '2026-10-02' },
    )
    expect(
      periodChange(late, periodBounds({ kind: 'range', range: 'this-week' }, NOW)!, NOW),
    ).toEqual({ reason: 'insufficient-coverage' })
  })

  it('a yield moves in basis points; an FX pair in percent of the quoted pair', () => {
    const ten = toHistoricalSeries(
      series(
        SYM_US10Y,
        closesOn(week, [5.14, 5.2, 5.18, 5.25, 5.3, 5.28], 0),
        'official-daily',
      ),
      { from: '2026-09-01', to: '2026-10-02' },
    )
    const tenMove = periodChange(
      ten,
      periodBounds({ kind: 'range', range: 'this-week' }, NOW)!,
      NOW,
    )
    expect('change' in tenMove && tenMove.change.changeBasisPoints).toBeCloseTo(14, 6)
    expect('change' in tenMove && tenMove.change.changePercent).toBeNull()
    const usdsek = toHistoricalSeries(
      series(SYM_USDSEK, closesOn(week, [9.9, 9.95, 10.0, 10.02, 10.05, 10.0], 0), 'eod'),
      { from: '2026-09-01', to: '2026-10-02' },
    )
    const fxMove = periodChange(
      usdsek,
      periodBounds({ kind: 'range', range: 'this-week' }, NOW)!,
      NOW,
    )
    expect('change' in fxMove && fxMove.change.changePercent).toBeCloseTo(
      (10.0 / 9.9 - 1) * 100,
      6,
    )
    expect(metricOf(SYM_EURUSD)).toBe('fx')
  })

  it('flags a latest observation older than the policy as stale, and still measures', () => {
    /* A month back from 2 October, with a series that stops on 25 September: measured, and called out. */
    const dates = tradingDays('2026-09-01', 19)
    const stale = toHistoricalSeries(
      series(
        SYM_SP500,
        closesOn(
          dates,
          dates.map((_, i) => 7600 + i * 5),
        ),
      ),
      { from: '2026-08-01', to: '2026-10-02' },
    )
    const outcome = periodChange(
      stale,
      periodBounds({ kind: 'range', range: '1m' }, NOW)!,
      NOW,
    )
    expect('change' in outcome && outcome.change.latestIsStale).toBe(true)
    expect('change' in outcome && outcome.change.end.date).toBe('2026-09-25')
    expect('change' in outcome && outcome.change.start.date).toBe('2026-09-02')
  })
})

describe('several instruments through the port', () => {
  it('reads each series once for the period’s fetch window, and judges each on its own', async () => {
    const asked: Array<[string, string, string]> = []
    const week = tradingDays('2026-09-25', 6)
    const source: HistoricalSeriesSource = {
      series: async (symbol, window) => {
        asked.push([symbol, window.from, window.to])
        return symbol === SYM_SP500
          ? ok(series(SYM_SP500, closesOn(week, [7650, 7700, 7680, 7710, 7740, 7772])))
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
    const result = await periodChanges(
      source,
      [SYM_SP500, 'idx:dax' as CanonicalSymbol],
      { kind: 'range', range: 'this-week' },
      NOW,
    )
    expect(asked).toEqual([
      [SYM_SP500, '2026-09-01', '2026-10-02'],
      ['idx:dax', '2026-09-01', '2026-10-02'],
    ])
    expect(result.changes.map((change) => change.symbol)).toEqual([SYM_SP500])
    expect(result.missing).toEqual([
      { symbol: 'idx:dax', name: 'DAX', reason: 'no-series' },
    ])
  })
})
