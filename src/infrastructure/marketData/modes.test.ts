/**
 * Mode semantics (D18 defect fix).
 *
 * `MARKETDATA_MODE=fixture` used to mean only "fixtures are permitted" — live
 * providers were still attempted, so a fresh clone would call an external API
 * on its first page load. These tests pin all three modes so that cannot
 * silently return.
 */

import { describe, expect, it, vi } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { hasData } from '~/domain/market'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import { loadMarketDataConfig } from './config'
import { createContainer } from './container'
import { createOverviewDataSource } from './overviewDataSource'
import { createFixtureProvider } from './providers/fixture'
import { createFrankfurterProvider } from './providers/frankfurter'
import type { HttpClient } from './providers/httpClient'

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

/** Fails the test if anything reaches it. */
function forbiddenHttp(onCall: () => void): HttpClient {
  return {
    async getJson<T>(): Promise<T> {
      onCall()
      throw new Error('network must not be reached')
    },
  }
}

describe('a clean checkout is fully offline', () => {
  it('registers no network provider by default', () => {
    const config = loadMarketDataConfig({})
    expect(config.mode).toBe('fixture')
    expect(config.allowNetworkProviders).toBe(false)
  })

  it('strips network providers from every configured chain', () => {
    const config = loadMarketDataConfig({})
    // The chains must TELL THE TRUTH, so health and diagnostics do too.
    for (const [, chain] of Object.entries(config.chains)) {
      expect(chain).toEqual(['fixture'])
    }
  })

  it('makes no external request and consumes no budget', async () => {
    let called = 0
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const container = createContainer({
      env: {},
      clock,
      providers: [
        // Registered on purpose: even so, the chain must never reach it.
        {
          provider: createFrankfurterProvider(forbiddenHttp(() => (called += 1))),
          capabilities: new Set(['fx'] as const),
        },
        { provider: createFixtureProvider(), capabilities: ALL_CAPS },
      ],
    })
    const snapshot = await getOverviewSnapshot(createOverviewDataSource(container))
    expect(called).toBe(0)
    expect(snapshot.fx.state).toBe('fixture')
    const budget = await container.budget.status('frankfurter', 100)
    expect(budget.used).toBe(0)
  })

  it('renders deterministically from fixtures', async () => {
    const build = async () => {
      const container = createContainer({
        env: {},
        clock: new FakeClock('2026-07-26T12:00:00.000Z'),
        providers: [{ provider: createFixtureProvider(), capabilities: ALL_CAPS }],
      })
      return getOverviewSnapshot(createOverviewDataSource(container))
    }
    expect(JSON.stringify(await build())).toBe(JSON.stringify(await build()))
  })
})

describe('mode semantics', () => {
  it('fixture: no network providers, fixtures permitted', () => {
    const config = loadMarketDataConfig({ MARKETDATA_MODE: 'fixture' })
    expect(config.allowNetworkProviders).toBe(false)
    expect(config.production).toBe(false)
  })

  it('hybrid: live providers first, fixture fallback allowed', () => {
    const config = loadMarketDataConfig({ MARKETDATA_MODE: 'hybrid' })
    expect(config.allowNetworkProviders).toBe(true)
    expect(config.production).toBe(false)
    expect(config.chains.fx).toEqual(['frankfurter', 'fixture'])
  })

  it('live: live providers, fixture fallback disallowed by policy', () => {
    const config = loadMarketDataConfig({ MARKETDATA_MODE: 'live' })
    expect(config.allowNetworkProviders).toBe(true)
    expect(config.production).toBe(true)
  })

  it('DISABLE_NETWORK overrides hybrid and live alike', () => {
    for (const mode of ['hybrid', 'live'] as const) {
      const config = loadMarketDataConfig({
        MARKETDATA_MODE: mode,
        MARKETDATA_DISABLE_NETWORK: 'true',
      })
      expect(config.allowNetworkProviders).toBe(false)
      expect(config.chains.fx).toEqual(['fixture'])
    }
  })
})

describe('the composition root honours the mode', () => {
  it('wires no network adapter when the mode forbids it', async () => {
    // Mirrors serverFns: registration is conditional on the flag, so in
    // fixture mode there is literally nothing to invoke.
    const config = loadMarketDataConfig({})
    const shouldRegister = config.allowNetworkProviders
    expect(shouldRegister).toBe(false)

    const spy = vi.fn()
    const container = createContainer({
      env: {},
      clock: new FakeClock('2026-07-26T12:00:00.000Z'),
      providers: [
        ...(shouldRegister
          ? [
              {
                provider: createFrankfurterProvider(forbiddenHttp(spy)),
                capabilities: new Set(['fx'] as const),
              },
            ]
          : []),
        { provider: createFixtureProvider(), capabilities: ALL_CAPS },
      ],
    })
    const snapshot = await getOverviewSnapshot(createOverviewDataSource(container))
    expect(spy).not.toHaveBeenCalled()
    expect(hasData(snapshot.fx)).toBe(true)
    if (hasData(snapshot.fx)) {
      expect(snapshot.fx.provenance.source.providerId).toBe('fixture')
    }
  })
})
