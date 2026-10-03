/**
 * The Treasury's yield series: every published observation in the window
 * as a point in percent, the month pages fetched together, the series'
 * provenance the latest publication's.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { canonicalSymbol } from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import type { HttpClient } from './httpClient'
import { createUsTreasuryProvider } from './usTreasury'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const recordedText = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

const US10Y = canonicalSymbol('rate:us10y')
const clock = new FakeClock('2026-07-26T12:00:00.000Z')
const ctx = (): FetchContext => ({
  signal: new AbortController().signal,
  clock,
  correlationId: NO_CORRELATION,
})

function stub(text: string, calls: string[] = []): HttpClient {
  return {
    async getText(url: string) {
      calls.push(url)
      return text
    },
    async getJson<T>(): Promise<T> {
      throw new Error('no recorded json')
    },
  }
}

describe('US Treasury — daily series', () => {
  it('serves the ten-year’s publications in the window as points in percent, with the latest publication’s provenance', async () => {
    const calls: string[] = []
    const series = await createUsTreasuryProvider(
      stub(recordedText('treasury.parcurve.202607.xml'), calls),
    ).fetchSeries(US10Y, '1d', { from: '2026-07-01', to: '2026-07-08' }, ctx())
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('field_tdr_date_value_month=202607')
    expect(series.symbol).toBe(US10Y)
    expect(series.points.map((point) => [point.t.slice(0, 10), point.v])).toEqual([
      ['2026-07-01', 4.48],
      ['2026-07-02', 4.49],
      ['2026-07-06', 4.48],
      ['2026-07-07', 4.55],
      ['2026-07-08', 4.56],
    ])
    expect(series.provenance).toMatchObject({
      asOfPrecision: 'date',
      sourceDate: '2026-07-08',
      quality: 'official-daily',
      source: { providerId: 'treasury' },
    })
  })

  it('fetches every month page of a longer window together, in order', async () => {
    const calls: string[] = []
    await createUsTreasuryProvider(
      stub(recordedText('treasury.parcurve.202607.xml'), calls),
    ).fetchSeries(US10Y, '1d', { from: '2026-05-15', to: '2026-07-20' }, ctx())
    expect(calls.map((url) => url.slice(-6))).toEqual(['202605', '202606', '202607'])
  })

  it('refuses an interval the Treasury does not publish', async () => {
    await expect(
      createUsTreasuryProvider(stub('')).fetchSeries(
        US10Y,
        '1h',
        { from: '2026-07-01', to: '2026-07-08' },
        ctx(),
      ),
    ).rejects.toThrow(/daily/)
  })
})
