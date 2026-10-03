/**
 * Yahoo's daily series: the chart endpoint's bars as a `MarketSeries`,
 * identity-checked like a quote, cut to the window, holes skipped and never
 * interpolated, and the latest bar timestamped by Yahoo's own clock.
 */

import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { SYM_GOLD, SYM_NASDAQ100, SYM_SP500 } from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import type { HttpClient } from './httpClient'
import { createYahooProvider, yahooRangeFor } from './yahoo'
import { YAHOO_HISTORY_INDICES, yahooHistoryBindingFor } from './yahoo/map'

const NOW = new Date('2026-10-02T15:00:00.000Z')
const ctx = (): FetchContext => ({
  signal: new AbortController().signal,
  clock: new FakeClock(NOW.toISOString()),
  correlationId: NO_CORRELATION,
})

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000)

/** Sessions Fri 25 Sep – Fri 2 Oct, opens at 13:30Z, with one null bar on Wednesday. */
const HISTORY = {
  chart: {
    result: [
      {
        meta: {
          symbol: '^GSPC',
          instrumentType: 'INDEX',
          longName: 'S&P 500',
          exchangeName: 'SNP',
          regularMarketPrice: 7772,
          regularMarketTime: epoch('2026-10-02T14:59:40.000Z'),
        },
        timestamp: [
          epoch('2026-09-24T13:30:00.000Z'),
          epoch('2026-09-25T13:30:00.000Z'),
          epoch('2026-09-28T13:30:00.000Z'),
          epoch('2026-09-29T13:30:00.000Z'),
          epoch('2026-09-30T13:30:00.000Z'),
          epoch('2026-10-01T13:30:00.000Z'),
          epoch('2026-10-02T13:30:00.000Z'),
        ],
        indicators: {
          quote: [{ close: [7600, 7650, 7700, 7680, null, 7740, 7772] }],
          adjclose: [{ adjclose: [7600, 7650, 7700, 7680, null, 7740, 7772] }],
        },
      },
    ],
  },
}

const clientReturning = (body: unknown, calls: string[] = []): HttpClient =>
  ({
    getJson: vi.fn(async (url: string) => {
      calls.push(url)
      return body
    }),
    getText: vi.fn(),
  }) as unknown as HttpClient

describe('Yahoo — daily series', () => {
  it('serves the bars inside the window as a series, skipping a hole and stamping the latest by Yahoo’s clock', async () => {
    const calls: string[] = []
    const series = await createYahooProvider(clientReturning(HISTORY, calls)).fetchSeries(
      SYM_SP500,
      '1d',
      { from: '2026-09-25', to: '2026-10-02' },
      ctx(),
    )
    expect(calls[0]).toContain('/%5EGSPC?interval=1d&range=1mo')
    expect(series.symbol).toBe(SYM_SP500)
    expect(series.interval).toBe('1d')
    expect(series.points.map((point) => [point.t.slice(0, 10), point.v])).toEqual([
      ['2026-09-25', 7650],
      ['2026-09-28', 7700],
      ['2026-09-29', 7680],
      ['2026-10-01', 7740],
      ['2026-10-02', 7772],
    ])
    expect(series.provenance).toMatchObject({
      asOf: '2026-10-02T14:59:40.000Z',
      asOfPrecision: 'second',
      quality: 'delayed',
      isDelayed: true,
      source: { providerId: 'yahoo' },
    })
  })

  it('picks the range that covers the window, and cuts the bars to it', () => {
    expect(yahooRangeFor({ from: '2026-09-25', to: '2026-10-02' })).toBe('1mo')
    expect(yahooRangeFor({ from: '2026-08-01', to: '2026-10-02' })).toBe('3mo')
    expect(yahooRangeFor({ from: '2026-05-01', to: '2026-10-02' })).toBe('6mo')
    expect(yahooRangeFor({ from: '2025-12-01', to: '2026-10-02' })).toBe('1y')
    expect(yahooRangeFor({ from: '2024-06-01', to: '2026-10-02' })).toBe('2y')
  })

  it('refuses a payload that is not the index asked for, or not an index at all', async () => {
    const other = {
      chart: {
        result: [
          {
            ...HISTORY.chart.result[0],
            meta: { ...HISTORY.chart.result[0]!.meta, symbol: '^NDX' },
          },
        ],
      },
    }
    await expect(
      createYahooProvider(clientReturning(other)).fetchSeries(
        SYM_SP500,
        '1d',
        { from: '2026-09-25', to: '2026-10-02' },
        ctx(),
      ),
    ).rejects.toThrow(/unverified instrument/)
    const future = {
      chart: {
        result: [
          {
            ...HISTORY.chart.result[0],
            meta: { ...HISTORY.chart.result[0]!.meta, instrumentType: 'FUTURE' },
          },
        ],
      },
    }
    await expect(
      createYahooProvider(clientReturning(future)).fetchSeries(
        SYM_SP500,
        '1d',
        { from: '2026-09-25', to: '2026-10-02' },
        ctx(),
      ),
    ).rejects.toThrow(/expected INDEX/)
  })

  it('has a reviewed history binding for the eight indices and none for a commodity', () => {
    expect(YAHOO_HISTORY_INDICES.map((binding) => binding.symbol)).toEqual([
      'idx:sp500',
      'idx:ftse100',
      'idx:nasdaq100',
      'idx:omxs30',
      'idx:dax',
      'idx:nikkei225',
      'idx:djia',
      'idx:russell2000',
    ])
    expect(yahooHistoryBindingFor(SYM_NASDAQ100)?.yahooSymbol).toBe('^NDX')
    expect(yahooHistoryBindingFor(SYM_GOLD)).toBeNull()
  })

  it('refuses an unbound symbol and an interval it does not serve, without a request', async () => {
    const calls: string[] = []
    const provider = createYahooProvider(clientReturning(HISTORY, calls))
    await expect(
      provider.fetchSeries(
        SYM_GOLD,
        '1d',
        { from: '2026-09-25', to: '2026-10-02' },
        ctx(),
      ),
    ).rejects.toThrow(/no reviewed history binding/)
    await expect(
      provider.fetchSeries(
        SYM_SP500,
        '1h',
        { from: '2026-09-25', to: '2026-10-02' },
        ctx(),
      ),
    ).rejects.toThrow(/served daily/)
    expect(calls).toEqual([])
  })
})
