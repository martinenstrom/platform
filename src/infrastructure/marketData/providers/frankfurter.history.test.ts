/**
 * Frankfurter's reference-rate series: every ECB publication in the window
 * as a point, dated by the ECB and never by retrieval, eod and not delayed.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { canonicalSymbol } from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import type { HttpClient } from './httpClient'
import { createFrankfurterProvider } from './frankfurter'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const USDSEK = canonicalSymbol('fx:usdsek')
const clock = new FakeClock('2026-07-26T12:00:00.000Z')
const ctx = (): FetchContext => ({
  signal: new AbortController().signal,
  clock,
  correlationId: NO_CORRELATION,
})

function stubHttp(
  byUrlFragment: Record<string, unknown>,
  calls: string[] = [],
): HttpClient {
  return {
    async getText(): Promise<string> {
      throw new Error('getText not used in this stub')
    },
    async getJson<T>(url: string): Promise<T> {
      calls.push(url)
      for (const [fragment, payload] of Object.entries(byUrlFragment)) {
        if (url.includes(fragment)) return payload as T
      }
      throw new Error(`No recorded payload for ${url}`)
    },
  }
}

describe('Frankfurter — daily series', () => {
  it('asks for the window itself and serves one point per publication date, cut to the window', async () => {
    const calls: string[] = []
    const http = stubHttp(
      { 'base=USD&symbols=SEK': recorded('frankfurter.usdsek.timeseries.json') },
      calls,
    )
    const series = await createFrankfurterProvider(http).fetchSeries(
      USDSEK,
      '1d',
      { from: '2026-07-17', to: '2026-07-24' },
      ctx(),
    )
    expect(calls[0]).toBe(
      'https://api.frankfurter.dev/v1/2026-07-17..2026-07-24?base=USD&symbols=SEK',
    )
    expect(series.points.map((point) => [point.t, point.v])).toEqual([
      ['2026-07-17T00:00:00.000Z', 9.655],
      ['2026-07-20T00:00:00.000Z', 9.6665],
      ['2026-07-21T00:00:00.000Z', 9.6764],
      ['2026-07-22T00:00:00.000Z', 9.7103],
      ['2026-07-23T00:00:00.000Z', 9.7397],
      ['2026-07-24T00:00:00.000Z', 9.717],
    ])
    expect(series.provenance).toMatchObject({
      asOf: '2026-07-24T00:00:00.000Z',
      asOfPrecision: 'date',
      sourceDate: '2026-07-24',
      quality: 'eod',
      isDelayed: false,
      source: { providerId: 'frankfurter', originator: 'European Central Bank' },
    })
  })

  it('refuses an interval the ECB does not publish, and a shape it does not recognise', async () => {
    const http = stubHttp({ 'base=USD': { nonsense: true } })
    await expect(
      createFrankfurterProvider(http).fetchSeries(
        USDSEK,
        '1h',
        { from: '2026-07-17', to: '2026-07-24' },
        ctx(),
      ),
    ).rejects.toThrow(/daily/)
    await expect(
      createFrankfurterProvider(http).fetchSeries(
        USDSEK,
        '1d',
        { from: '2026-07-17', to: '2026-07-24' },
        ctx(),
      ),
    ).rejects.toThrow(/unexpected shape/)
  })
})
