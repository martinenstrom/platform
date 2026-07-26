/**
 * Frankfurter through the full pipeline (Phase 2 exit criteria).
 *
 * The adapter has its own contract tests; these prove the end-to-end path —
 * Frankfurter → registry → resilience → application service → snapshot — and
 * the two behaviours the probe showed were previously wrong: a Friday rate
 * surviving Monday morning, and fixture FX being barred in live mode.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { hasData, OVERVIEW_FX_SYMBOLS } from '~/domain/market'
import { policyFor } from '~/application/marketData/policy'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import { createContainer } from './container'
import { createOverviewDataSource } from './overviewDataSource'
import { createFixtureProvider } from './providers/fixture'
import { createFrankfurterProvider } from './providers/frankfurter'
import type { HttpClient } from './providers/httpClient'
import { HttpError } from './providers/httpClient'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const ALL_CAPS = new Set([
  'quotes',
  'series',
  'fx',
  'yields',
  'commodities',
  'crypto',
  'news',
  'sentiment',
] as const)

function liveHttp(): HttpClient {
  return {
    async getJson<T>(url: string): Promise<T> {
      if (url.includes('base=USD')) {
        return recorded('frankfurter.usdsek.timeseries.json') as T
      }
      return recorded('frankfurter.eurusd.timeseries.json') as T
    },
  }
}

function failingHttp(code = 'network'): HttpClient {
  return {
    async getJson<T>(): Promise<T> {
      throw new HttpError(code as never, 'upstream down')
    },
  }
}

function build(options: {
  now: string
  http?: HttpClient
  mode?: 'fixture' | 'hybrid' | 'live'
}) {
  const clock = new FakeClock(options.now)
  const env: Record<string, string> = {
    MARKETDATA_MODE: options.mode ?? 'hybrid',
    MARKETDATA_CHAIN_FX: options.http ? 'frankfurter,fixture' : 'fixture',
  }
  const providers = [
    ...(options.http
      ? [
          {
            provider: createFrankfurterProvider(options.http),
            capabilities: new Set(['fx'] as const),
          },
        ]
      : []),
    { provider: createFixtureProvider(), capabilities: ALL_CAPS },
  ]
  const container = createContainer({
    env,
    clock,
    random: new SeededRandom(1),
    providers,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, maxAttemptsRateLimited: 1 },
  })
  return { container, clock }
}

async function fxOf(options: Parameters<typeof build>[0]) {
  const { container } = build(options)
  const snapshot = await getOverviewSnapshot(createOverviewDataSource(container))
  return { snapshot, fx: snapshot.fx }
}

describe('FX through the live path', () => {
  it('serves Frankfurter values with ECB provenance', async () => {
    const { fx } = await fxOf({ now: '2026-07-24T18:00:00.000Z', http: liveHttp() })
    expect(fx.state).toBe('ok')
    if (!hasData(fx)) throw new Error('no fx')
    expect(fx.provenance.source.providerId).toBe('frankfurter')
    expect(fx.provenance.quality).toBe('eod')
    expect(fx.provenance.isDelayed).toBe(false)
    expect(fx.provenance.sourceDate).toBe('2026-07-24')
    expect(fx.data.map((q) => q.value)).toEqual([9.717, 1.1377])
  })

  it('requests exactly the pairs the Overview displays', async () => {
    const urls: string[] = []
    const spy: HttpClient = {
      async getJson<T>(url: string): Promise<T> {
        urls.push(url)
        return (
          url.includes('base=USD')
            ? recorded('frankfurter.usdsek.timeseries.json')
            : recorded('frankfurter.eurusd.timeseries.json')
        ) as T
      },
    }
    await fxOf({ now: '2026-07-24T18:00:00.000Z', http: spy })
    expect(OVERVIEW_FX_SYMBOLS).toEqual(['fx:usdsek', 'fx:eurusd'])
    expect(urls).toHaveLength(2)
    expect(urls.some((u) => u.includes('base=USD&symbols=SEK'))).toBe(true)
    expect(urls.some((u) => u.includes('base=EUR&symbols=USD'))).toBe(true)
    // v1 only: v2 carries values forward onto non-publication days.
    expect(urls.every((u) => u.includes('/v1/'))).toBe(true)
  })
})

describe('weekend and Monday staleness (D13)', () => {
  const ageHours = (now: string) =>
    (Date.parse(now) - Date.parse('2026-07-24T00:00:00.000Z')) / 3_600_000

  it('would have failed the old 48-hour ceiling on Monday morning', () => {
    // The reason the ceiling was raised, pinned so the regression is visible.
    expect(ageHours('2026-07-27T07:00:00.000Z')).toBeGreaterThan(48)
    expect(policyFor('fx').fallback.maxStaleMs).toBe(5 * 24 * 3_600_000)
  })

  it('still serves Friday’s rate on Monday morning', async () => {
    const { fx } = await fxOf({ now: '2026-07-27T07:00:00.000Z', http: liveHttp() })
    // ~79 h old and entirely correct: the ECB has not published since Friday.
    expect(hasData(fx)).toBe(true)
    if (!hasData(fx)) return
    expect(fx.provenance.sourceDate).toBe('2026-07-24')
    expect(fx.data[0]!.value).toBe(9.717)
  })

  it('serves it through a long weekend too', async () => {
    const { fx } = await fxOf({ now: '2026-07-28T07:00:00.000Z', http: liveHttp() })
    expect(hasData(fx)).toBe(true)
  })

  it('uses a 30-minute TTL rather than 60 seconds (D14)', () => {
    expect(policyFor('fx').ttlOpenMs).toBe(30 * 60_000)
    expect(policyFor('fx').ttlClosedMs).toBe(30 * 60_000)
  })
})

describe('fallback by environment', () => {
  it('hybrid: falls back to fixture, labelled as such', async () => {
    const { fx } = await fxOf({
      now: '2026-07-26T12:00:00.000Z',
      http: failingHttp(),
      mode: 'hybrid',
    })
    expect(fx.state).toBe('fixture')
    if (hasData(fx)) expect(fx.provenance.quality).toBe('fixture')
  })

  it('live: returns a genuine error rather than fixture FX', async () => {
    const { fx } = await fxOf({
      now: '2026-07-26T12:00:00.000Z',
      http: failingHttp(),
      mode: 'live',
    })
    expect(fx.state).toBe('error')
    if (fx.state === 'error') expect(fx.error.code).toBe('fallback-disallowed')
  })

  it('fixture mode with no live provider still renders', async () => {
    const { fx } = await fxOf({ now: '2026-07-26T12:00:00.000Z', mode: 'fixture' })
    expect(fx.state).toBe('fixture')
  })
})

describe('snapshot timestamp semantics (D16)', () => {
  it('does not let a Friday FX rate define the displayed refresh time', async () => {
    const now = '2026-07-27T07:00:00.000Z'
    const { snapshot } = await fxOf({ now, http: liveHttp() })

    // generatedAt is when the snapshot resolved — what the label shows.
    expect(snapshot.generatedAt).toBe(now)
    // snapshot.asOf keeps the conservative oldest value, for diagnostics.
    expect(Date.parse(snapshot.asOf)).toBeLessThan(Date.parse(now))
    // And the category keeps its own truthful, much older timestamp.
    if (hasData(snapshot.fx)) {
      expect(snapshot.fx.provenance.sourceDate).toBe('2026-07-24')
      expect(snapshot.fx.provenance.asOfPrecision).toBe('date')
    }
  })

  it('keeps other categories unaffected by FX age', async () => {
    const { snapshot } = await fxOf({ now: '2026-07-27T07:00:00.000Z', http: liveHttp() })
    // One daily source must not redefine the freshness of everything else.
    if (hasData(snapshot.crypto)) {
      expect(snapshot.crypto.provenance.asOf).not.toBe(snapshot.fx.state)
      expect(Date.parse(snapshot.crypto.provenance.asOf)).toBeGreaterThan(
        Date.parse('2026-07-26T00:00:00.000Z'),
      )
    }
  })
})

describe('configuration kill switches', () => {
  it('drops Frankfurter when the chain excludes it', async () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const container = createContainer({
      env: { MARKETDATA_MODE: 'hybrid', MARKETDATA_CHAIN_FX: 'fixture' },
      clock,
      providers: [
        {
          provider: createFrankfurterProvider(liveHttp()),
          capabilities: new Set(['fx'] as const),
        },
        { provider: createFixtureProvider(), capabilities: ALL_CAPS },
      ],
    })
    const snapshot = await getOverviewSnapshot(createOverviewDataSource(container))
    // Registered but unconfigured: the chain, not the registry, decides.
    expect(snapshot.fx.state).toBe('fixture')
  })

  it('reports network-disabled through config', () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const container = createContainer({
      env: { MARKETDATA_DISABLE_NETWORK: 'true' },
      clock,
      providers: [{ provider: createFixtureProvider(), capabilities: ALL_CAPS }],
    })
    // serverFns reads this to skip registering network providers entirely,
    // so there is nothing left to invoke by accident.
    expect(container.config.disableNetwork).toBe(true)
  })
})
