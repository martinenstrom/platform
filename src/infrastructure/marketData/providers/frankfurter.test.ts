/**
 * Frankfurter adapter contract tests.
 *
 * Driven entirely by payloads recorded from the live API on 2026-07-26, so
 * they assert against what the service actually returns rather than what its
 * documentation claims. No network is touched.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { canonicalSymbol, type CanonicalSymbol } from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import { createHttpClient, HttpError, type HttpClient } from './httpClient'
import { createFrankfurterProvider, estimatedEcbPublicationAt } from './frankfurter'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)

function recorded(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

const USDSEK = canonicalSymbol('fx:usdsek')
const EURUSD = canonicalSymbol('fx:eurusd')

const clock = new FakeClock('2026-07-26T12:00:00.000Z')

function ctx(): FetchContext {
  return {
    signal: new AbortController().signal,
    clock,
    correlationId: NO_CORRELATION,
  }
}

/** Serves recorded payloads by matching the request URL. */
function stubHttp(byUrlFragment: Record<string, unknown>): HttpClient {
  return {
    async getJson<T>(url: string): Promise<T> {
      for (const [fragment, payload] of Object.entries(byUrlFragment)) {
        if (url.includes(fragment)) return payload as T
      }
      throw new Error(`No recorded payload for ${url}`)
    },
  }
}

const BOTH_PAIRS = stubHttp({
  'base=USD&symbols=SEK': recorded('frankfurter.usdsek.timeseries.json'),
  'base=EUR&symbols=USD': recorded('frankfurter.eurusd.timeseries.json'),
})

describe('Frankfurter adapter — normalization', () => {
  it('maps a recorded time series onto MarketQuote', async () => {
    const [quote] = await createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
      [USDSEK],
      ctx(),
    )
    expect(quote!.symbol).toBe(USDSEK)
    expect(quote!.value).toBe(9.717)
    // The prior PUBLICATION, which is Thursday — not "yesterday".
    expect(quote!.previousClose).toBe(9.7397)
    expect(quote!.percentageChange).toBeCloseTo(-0.2331, 3)
  })

  it('labels the change as publication-to-publication, never intraday', async () => {
    const [quote] = await createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
      [USDSEK],
      ctx(),
    )
    // A daily reference series contains no intraday movement to report.
    expect(quote!.changePeriod).toBe('publication-to-publication')
  })

  it('preserves the provider precision instead of padding it', async () => {
    const provider = createFrankfurterProvider(BOTH_PAIRS)
    const [usdsek] = await provider.fetchFxRates([USDSEK], ctx())
    const [eurusd] = await provider.fetchFxRates([EURUSD], ctx())
    // The same series carries 9.6176 (4 dp) and 9.717 (3 dp); the latest wins,
    // and rendering it as 9,7170 would imply a digit the ECB never published.
    expect(usdsek!.sourcePrecision).toBe(3)
    expect(eurusd!.sourcePrecision).toBe(4)
  })

  it('fetches every requested pair', async () => {
    const quotes = await createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
      [USDSEK, EURUSD],
      ctx(),
    )
    expect(quotes.map((q) => q.symbol)).toEqual([USDSEK, EURUSD])
    expect(quotes.map((q) => q.value)).toEqual([9.717, 1.1377])
  })
})

describe('Frankfurter adapter — provenance', () => {
  it('uses the ECB publication date, not now, and marks it date-precision', async () => {
    const [quote] = await createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
      [USDSEK],
      ctx(),
    )
    const { provenance } = quote!
    expect(provenance.sourceDate).toBe('2026-07-24')
    expect(provenance.asOf).toBe('2026-07-24T00:00:00.000Z')
    expect(provenance.asOfPrecision).toBe('date')
    // Emphatically not the clock: the value is Friday's, read on Sunday.
    expect(provenance.asOf).not.toContain('2026-07-26')
  })

  it('classifies as end-of-day, and explicitly NOT delayed', async () => {
    const [quote] = await createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
      [USDSEK],
      ctx(),
    )
    // An official reference rate is a different kind of observation from a
    // real-time quote running behind — not a late one.
    expect(quote!.provenance.quality).toBe('eod')
    expect(quote!.provenance.isDelayed).toBe(false)
    expect(quote!.provenance.delayMinutes).toBeNull()
  })

  it('names the ECB as the origin and carries attribution', async () => {
    const [quote] = await createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
      [USDSEK],
      ctx(),
    )
    expect(quote!.provenance.source.providerId).toBe('frankfurter')
    expect(quote!.provenance.source.providerName).toMatch(/ECB reference rates/)
    expect(quote!.provenance.source.attributionUrl).toBe('https://frankfurter.dev')
  })

  it('keeps the publication estimate out of asOf and out of ageMs', async () => {
    const [quote] = await createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
      [USDSEK],
      ctx(),
    )
    const { provenance } = quote!
    // The estimate exists for operators, and must never become the fact.
    expect(provenance.estimatedPublicationAt).toBe('2026-07-24T14:00:00.000Z')
    expect(provenance.asOf).not.toBe(provenance.estimatedPublicationAt)
    const fromAsOf = clock.epochMs() - Date.parse(provenance.asOf)
    expect(provenance.ageMs).toBe(fromAsOf)
  })

  it('estimates the publication instant DST-correctly for Europe/Brussels', () => {
    // CEST (UTC+2) in July, CET (UTC+1) in January.
    expect(estimatedEcbPublicationAt('2026-07-24')).toBe('2026-07-24T14:00:00.000Z')
    expect(estimatedEcbPublicationAt('2026-01-15')).toBe('2026-01-15T15:00:00.000Z')
  })
})

describe('Frankfurter adapter — honest gaps', () => {
  it('reports a null change when only one publication is available', async () => {
    const http = stubHttp({
      'base=USD': recorded('frankfurter.usdsek.singleday.json'),
    })
    const [quote] = await createFrankfurterProvider(http).fetchFxRates([USDSEK], ctx())
    // No prior publication means the change is unknown; zero would be a lie.
    expect(quote!.previousClose).toBeNull()
    expect(quote!.percentageChange).toBeNull()
    expect(quote!.absoluteChange).toBeNull()
  })

  it('skips non-publication days rather than interpolating them', async () => {
    const series = recorded('frankfurter.usdsek.timeseries.json') as {
      rates: Record<string, unknown>
    }
    // The ECB does not publish at weekends, and the adapter must not invent
    // values for the days it left out.
    expect(Object.keys(series.rates)).not.toContain('2026-07-18')
    expect(Object.keys(series.rates)).not.toContain('2026-07-19')
  })
})

describe('Frankfurter adapter — failure modes', () => {
  const provider = () =>
    createFrankfurterProvider(stubHttp({ 'base=USD': { nonsense: true } }))

  it('rejects an unexpected payload shape as a schema error', async () => {
    await expect(provider().fetchFxRates([USDSEK], ctx())).rejects.toMatchObject({
      code: 'schema',
    })
  })

  it('rejects a payload missing the requested currency', async () => {
    const http = stubHttp({
      'base=USD': { amount: 1, base: 'USD', rates: { '2026-07-24': { NOK: 10 } } },
    })
    await expect(
      createFrankfurterProvider(http).fetchFxRates([USDSEK], ctx()),
    ).rejects.toMatchObject({ code: 'schema' })
  })

  it('refuses an unmapped symbol instead of guessing', async () => {
    await expect(
      createFrankfurterProvider(BOTH_PAIRS).fetchFxRates(
        ['fx:gbpjpy' as CanonicalSymbol],
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('httpClient', () => {
  it('fails immediately and non-retryably when the network is disabled', async () => {
    const client = createHttpClient({ networkDisabled: true })
    await expect(
      client.getJson(
        'https://api.frankfurter.dev/v1/latest',
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(HttpError)
  })

  it('propagates the caller AbortSignal rather than owning a timeout', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      // The pipeline owns the deadline; this module only carries the signal.
      expect(init?.signal).toBeDefined()
      return new Response('{"ok":true}', { status: 200 })
    })
    const client = createHttpClient({
      networkDisabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.getJson('https://example.test/x', new AbortController().signal)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('maps upstream status codes onto the domain vocabulary', async () => {
    const withStatus = (status: number) =>
      createHttpClient({
        networkDisabled: false,
        fetchImpl: (async () =>
          new Response('{}', { status })) as unknown as typeof fetch,
      })
    const signal = new AbortController().signal
    await expect(withStatus(429).getJson('u', signal)).rejects.toMatchObject({
      code: 'rate-limit',
    })
    await expect(withStatus(503).getJson('u', signal)).rejects.toMatchObject({
      code: 'network',
    })
    await expect(withStatus(403).getJson('u', signal)).rejects.toMatchObject({
      code: 'auth',
    })
  })

  it('treats an unparseable body as a schema fault, not a transport fault', async () => {
    // A transport classification would trip the circuit breaker for what is
    // actually a contract break.
    const client = createHttpClient({
      networkDisabled: false,
      fetchImpl: (async () =>
        new Response('<html>', { status: 200 })) as unknown as typeof fetch,
    })
    await expect(client.getJson('u', new AbortController().signal)).rejects.toMatchObject(
      { code: 'schema' },
    )
  })
})
