/**
 * CoinGecko adapter contract tests, over payloads recorded from the live API
 * on 2026-07-26. No network is touched.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { canonicalSymbol, type CanonicalSymbol } from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'
import { createCoinGeckoProvider } from './coinGecko'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const BTC = canonicalSymbol('crypto:btc')
// 110s after the recorded last_updated_at (epoch 1785074890).
const clock = new FakeClock('2026-07-26T14:10:00.000Z')

function ctx(): FetchContext {
  return { signal: new AbortController().signal, clock, correlationId: NO_CORRELATION }
}

function stub(
  payload: unknown,
  capture?: (url: string, headers?: Record<string, string>) => void,
): HttpClient {
  return {
    async getText(): Promise<string> {
      throw new Error('getText not used in this stub')
    },
    async getJson<T>(
      url: string,
      _signal: AbortSignal,
      headers?: Record<string, string>,
    ) {
      capture?.(url, headers)
      return payload as T
    },
  }
}

const PRICE = stub(recorded('coingecko.btc.price.json'))

describe('CoinGecko adapter — normalization', () => {
  it('maps a recorded payload onto MarketQuote', async () => {
    const [quote] = await createCoinGeckoProvider(PRICE).fetchCrypto([BTC], ctx())
    expect(quote!.symbol).toBe(BTC)
    expect(quote!.value).toBe(64637.39)
  })

  it('preserves the provider-reported 24-hour change without inventing a close', async () => {
    const [quote] = await createCoinGeckoProvider(PRICE).fetchCrypto([BTC], ctx())
    expect(quote!.percentageChange).toBeCloseTo(0.8346, 4)
    expect(quote!.changePeriod).toBe('rolling-24h')
    expect(quote!.changeSource).toBe('provider')
    // CoinGecko publishes no 24-hour-ago price; reverse-engineering one from
    // the percentage would invent a number it never gave.
    expect(quote!.previousClose).toBeNull()
    expect(quote!.absoluteChange).toBeNull()
  })

  it('records precision as requested, not as intrinsic to the source', async () => {
    const [quote] = await createCoinGeckoProvider(PRICE).fetchCrypto([BTC], ctx())
    // We chose 2 and the API rounded to it, so it is ours, not the data's.
    expect(quote!.requestedPrecision).toBe(2)
    expect(quote!.sourcePrecision).toBeNull()
  })

  it('does not infer precision from the decimal form of the number', async () => {
    // 64447.5 would look like 1 dp; the requested precision is still 2.
    const [quote] = await createCoinGeckoProvider(
      stub({ bitcoin: { usd: 64447.5, last_updated_at: 1785074890 } }),
    ).fetchCrypto([BTC], ctx())
    expect(quote!.requestedPrecision).toBe(2)
  })

  it('asks for the parameters the contract depends on', async () => {
    let seen = ''
    await createCoinGeckoProvider(
      stub(recorded('coingecko.btc.price.json'), (u) => (seen = u)),
    ).fetchCrypto([BTC], ctx())
    expect(seen).toContain('ids=bitcoin')
    expect(seen).toContain('vs_currencies=usd')
    expect(seen).toContain('include_24hr_change=true')
    expect(seen).toContain('include_last_updated_at=true')
    expect(seen).toContain('precision=2')
  })
})

describe('CoinGecko adapter — provenance', () => {
  it('uses the provider timestamp at second precision', async () => {
    const [quote] = await createCoinGeckoProvider(PRICE).fetchCrypto([BTC], ctx())
    // 1785074890 -> the real last_updated_at, not our clock.
    expect(quote!.provenance.asOf).toBe('2026-07-26T14:08:10.000Z')
    expect(quote!.provenance.asOfPrecision).toBe('second')
    expect(quote!.provenance.ageMs).toBe(110_000)
  })

  it('classifies as near-realtime, not exchange-grade realtime', async () => {
    const [quote] = await createCoinGeckoProvider(PRICE).fetchCrypto([BTC], ctx())
    // A cross-exchange aggregate with a 30-60 s cache is current, but it is
    // not a venue feed, and it is not a delayed one either.
    expect(quote!.provenance.quality).toBe('near-realtime')
    expect(quote!.provenance.isDelayed).toBe(false)
    expect(quote!.provenance.source.providerId).toBe('coingecko')
    expect(quote!.provenance.source.providerName).toMatch(/aggregated/i)
  })
})

describe('CoinGecko adapter — honest gaps', () => {
  it('reports a null change when the provider omits it', async () => {
    const [quote] = await createCoinGeckoProvider(
      stub(recorded('coingecko.btc.no-change.json')),
    ).fetchCrypto([BTC], ctx())
    expect(quote!.percentageChange).toBeNull()
    expect(quote!.changeSource).toBeNull()
  })

  it('rejects a payload with no usable price', async () => {
    await expect(
      createCoinGeckoProvider(stub(recorded('coingecko.btc.malformed.json'))).fetchCrypto(
        [BTC],
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'schema' })
  })

  it('rejects a non-object payload', async () => {
    await expect(
      createCoinGeckoProvider(stub('nope')).fetchCrypto([BTC], ctx()),
    ).rejects.toMatchObject({ code: 'schema' })
  })

  it('refuses an unmapped symbol instead of guessing', async () => {
    await expect(
      createCoinGeckoProvider(PRICE).fetchCrypto(
        ['crypto:eth' as CanonicalSymbol],
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('CoinGecko adapter — credentials', () => {
  it('sends the Demo key as a header, never in the query string', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> | undefined
    await createCoinGeckoProvider(
      stub(recorded('coingecko.btc.price.json'), (u, h) => {
        seenUrl = u
        seenHeaders = h
      }),
      { apiKey: 'CG-secret-key' },
    ).fetchCrypto([BTC], ctx())

    expect(seenHeaders?.['x-cg-demo-api-key']).toBe('CG-secret-key')
    // A query string ends up in access logs, proxy caches and error messages.
    expect(seenUrl).not.toContain('CG-secret-key')
    expect(seenUrl).not.toContain('api_key')
  })

  it('sends no key header when none is configured', async () => {
    let seenHeaders: Record<string, string> | undefined
    await createCoinGeckoProvider(
      stub(recorded('coingecko.btc.price.json'), (_u, h) => (seenHeaders = h)),
    ).fetchCrypto([BTC], ctx())
    expect(seenHeaders?.['x-cg-demo-api-key']).toBeUndefined()
  })
})

describe('CoinGecko adapter — rate limiting', () => {
  it('surfaces 429 as a retryable rate-limit error carrying Retry-After', async () => {
    const client = {
      async getText(): Promise<string> {
        throw new Error('getText not used in this stub')
      },
      async getJson<T>(): Promise<T> {
        throw new HttpError('rate-limit', 'HTTP 429 from upstream', 429, 30_000)
      },
    }
    await expect(
      createCoinGeckoProvider(client).fetchCrypto([BTC], ctx()),
    ).rejects.toMatchObject({ code: 'rate-limit', retryAfterMs: 30_000 })
  })

  it('parses Retry-After from a real 429 response', async () => {
    const { createHttpClient } = await import('./httpClient')
    const client = createHttpClient({
      networkDisabled: false,
      fetchImpl: (async () =>
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': '30' },
        })) as unknown as typeof fetch,
    })
    await expect(client.getJson('u', new AbortController().signal)).rejects.toMatchObject(
      { code: 'rate-limit', retryAfterMs: 30_000 },
    )
  })
})

describe('CoinGecko adapter — batching', () => {
  it('issues one request for all requested symbols', async () => {
    const calls = vi.fn()
    await createCoinGeckoProvider(
      stub(recorded('coingecko.btc.price.json'), () => calls()),
    ).fetchCrypto([BTC], ctx())
    // Batching natively is what keeps a metered provider affordable.
    expect(calls).toHaveBeenCalledOnce()
  })

  it('makes no request at all for an empty symbol list', async () => {
    const calls = vi.fn()
    const quotes = await createCoinGeckoProvider(stub({}, () => calls())).fetchCrypto(
      [],
      ctx(),
    )
    expect(quotes).toEqual([])
    expect(calls).not.toHaveBeenCalled()
  })
})
