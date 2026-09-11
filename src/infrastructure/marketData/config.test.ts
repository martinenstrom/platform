import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { MemoryCacheStore } from './cache/store'
import {
  checkCacheSharing,
  checkChainIntegrity,
  checkLiveReadiness,
  loadMarketDataConfig,
  type EnvSource,
} from './config'
import { budgetKey, newsKey, quotesKey, seriesKey, withProxy } from './keys'
import { createContainer } from './container'
import { canonicalSymbol } from '~/domain/market'

const BASE: EnvSource = { MARKETDATA_MODE: 'fixture' }
/** Credential and chain behaviour is only observable where network providers
 *  are permitted at all — fixture mode strips them by design (D18). */
const HYBRID: EnvSource = { MARKETDATA_MODE: 'hybrid' }

describe('loadMarketDataConfig', () => {
  it('defaults to fixture mode with no environment at all', () => {
    const config = loadMarketDataConfig({})
    expect(config.mode).toBe('fixture')
    expect(config.production).toBe(false)
    expect(config.disableNetwork).toBe(false)
  })

  it('throws on a malformed value — that is a programming error', () => {
    expect(() => loadMarketDataConfig({ MARKETDATA_MODE: 'production' })).toThrow(
      /fixture\|hybrid\|live/,
    )
    expect(() =>
      loadMarketDataConfig({ ...BASE, MARKETDATA_DISABLE_NETWORK: 'yes' }),
    ).toThrow(/"true" or "false"/)
    expect(() => loadMarketDataConfig({ ...BASE, TWELVEDATA_RPD: '-5' })).toThrow(
      /positive integer/,
    )
  })

  it('drops a provider whose key is missing, with a warning, instead of throwing', () => {
    const config = loadMarketDataConfig({
      ...HYBRID,
      MARKETDATA_CHAIN_NEWS: 'marketaux,fixture',
    })
    expect(config.chains.news).toEqual(['fixture'])
    expect(config.warnings.join(' ')).toMatch(/marketaux.*MARKETAUX_API_KEY is not set/)
  })

  it('keeps a provider once its key is present', () => {
    const config = loadMarketDataConfig({
      ...HYBRID,
      MARKETDATA_CHAIN_NEWS: 'marketaux,fixture',
      MARKETAUX_API_KEY: 'abc123',
    })
    expect(config.chains.news).toEqual(['marketaux', 'fixture'])
  })

  it('keeps genuinely keyless providers without any credential', () => {
    const config = loadMarketDataConfig(HYBRID)
    expect(config.chains.fx).toEqual(['frankfurter', 'fixture'])
  })

  it('drops CoinGecko without a key, even though keyless calls work today', () => {
    // The keyless endpoint is not a published production contract, so it is
    // opt-in rather than assumed.
    expect(loadMarketDataConfig(HYBRID).chains.crypto).toEqual(['fixture'])
  })

  it('allows keyless CoinGecko in hybrid when explicitly opted in', () => {
    const config = loadMarketDataConfig({ ...HYBRID, COINGECKO_ALLOW_KEYLESS: 'true' })
    expect(config.chains.crypto).toEqual(['coingecko', 'fixture'])
    expect(config.coinGeckoKeyless).toBe(true)
  })

  it('never allows keyless CoinGecko in live mode', () => {
    const config = loadMarketDataConfig({
      MARKETDATA_MODE: 'live',
      COINGECKO_ALLOW_KEYLESS: 'true',
    })
    expect(config.chains.crypto).toEqual(['fixture'])
  })

  it('keeps CoinGecko when a Demo key is present', () => {
    const config = loadMarketDataConfig({ ...HYBRID, COINGECKO_API_KEY: 'CG-demo-key' })
    expect(config.chains.crypto).toEqual(['coingecko', 'fixture'])
    expect(config.coinGeckoKeyless).toBe(false)
  })

  it('divides per-day budgets across the configured instance count', () => {
    const one = loadMarketDataConfig({ ...HYBRID, COINGECKO_API_KEY: 'k' })
    const three = loadMarketDataConfig({
      ...HYBRID,
      COINGECKO_API_KEY: 'k',
      MARKETDATA_INSTANCE_COUNT: '3',
    })
    expect(one.limits.coingecko?.requestsPerDay).toBe(250)
    // Floor division, conservative by construction.
    expect(three.limits.coingecko?.requestsPerDay).toBe(83)
  })

  it('ignores an unknown provider id with a warning', () => {
    const config = loadMarketDataConfig({
      ...HYBRID,
      MARKETDATA_CHAIN_FX: 'bloomberg,fixture',
    })
    expect(config.chains.fx).toEqual(['fixture'])
    expect(config.warnings.join(' ')).toMatch(/Unknown provider "bloomberg"/)
  })

  it('never exposes a secret under a VITE_ prefix', () => {
    // Vite exposes only VITE_* to the client, so unprefixed names are
    // structurally incapable of reaching the browser bundle.
    const config = loadMarketDataConfig({ ...BASE, FRED_API_KEY: 'k' })
    for (const credential of Object.values(config.credentials)) {
      expect(credential.envVar.startsWith('VITE_')).toBe(false)
    }
  })

  it('does not retain secret values, only their presence', () => {
    const config = loadMarketDataConfig({ ...BASE, FRED_API_KEY: 'super-secret' })
    expect(JSON.stringify(config)).not.toContain('super-secret')
    expect(config.credentials.fred?.present).toBe(true)
  })
})

describe('checkLiveReadiness', () => {
  it('is silent outside live mode', () => {
    expect(checkLiveReadiness(loadMarketDataConfig(BASE))).toEqual([])
  })

  it('names every fixture-only category in live mode', () => {
    // Because every category is allowFixture:'non-production' (D2), these
    // would return errors in production — so they surface at startup instead.
    const issues = checkLiveReadiness(loadMarketDataConfig({ MARKETDATA_MODE: 'live' }))
    const categories = issues.map((issue) => issue.category)
    expect(categories).toContain('crypto')
    expect(categories).not.toContain('fx')
    /*
     * `commodities` left this list on 2026-08-25, when Gold and Brent were
     * bound to Avanza's spot quotes. Nothing on the Overview is fixture-only
     * in live mode any more.
     */
    expect(categories).not.toContain('commodities')
    /*
     * `equity-index-intl` left this list on 2026-08-25, when Yahoo gave the
     * S&P 500 and the FTSE 100 a live route. `commodities` stays: Gold and
     * Brent still have no free spot source, and Yahoo offers only dated
     * futures contracts, which are a different instrument.
     */
    expect(categories).not.toContain('equity-index-intl')
  })
})

describe('checkCacheSharing', () => {
  it('warns only when live mode meets a non-shared store', () => {
    const live = loadMarketDataConfig({ MARKETDATA_MODE: 'live' })
    const fixture = loadMarketDataConfig(BASE)
    expect(checkCacheSharing(live, false)).toMatch(/counted per instance/)
    expect(checkCacheSharing(live, true)).toBeNull()
    expect(checkCacheSharing(fixture, false)).toBeNull()
  })
})

describe('MemoryCacheStore', () => {
  const clock = new FakeClock('2026-07-26T12:00:00.000Z')

  it('returns expired entries rather than dropping them', async () => {
    // The resolver decides whether to serve them as `stale`; deleting here
    // would destroy that option.
    const store = new MemoryCacheStore(clock)
    await store.set('k', 1, 1_000)
    clock.advance(5_000)
    const entry = await store.get<number>('k')
    expect(entry?.value).toBe(1)
    expect(entry!.expiresAtMs).toBeLessThan(clock.epochMs())
  })

  it('resets a counter once its window has passed', async () => {
    const store = new MemoryCacheStore(clock)
    const resetAt = clock.epochMs() + 10_000
    expect(await store.increment('budget', 1, resetAt)).toBe(1)
    expect(await store.increment('budget', 1, resetAt)).toBe(2)
    clock.advance(20_000)
    expect(await store.increment('budget', 1, clock.epochMs() + 10_000)).toBe(1)
  })

  it('declares itself unshared', () => {
    expect(new MemoryCacheStore(clock).isShared).toBe(false)
  })
})

describe('cache keys', () => {
  const a = canonicalSymbol('idx:sp500')
  const b = canonicalSymbol('idx:dax')

  it('separate proxied results from real ones', () => {
    // A proxy is different data and must never occupy the real slot.
    expect(withProxy(quotesKey('quotes', [a]), true)).not.toBe(quotesKey('quotes', [a]))
    expect(withProxy(quotesKey('quotes', [a]), false)).toBe(quotesKey('quotes', [a]))
  })

  it('are independent of argument order', () => {
    expect(quotesKey('quotes', [a, b])).toBe(quotesKey('quotes', [b, a]))
  })

  it('carry schema and normalization versions', () => {
    // Two axes: schema shape and normalization semantics.
    expect(quotesKey('quotes', [a]).startsWith('s1.n1:')).toBe(true)
    expect(seriesKey(a, '1h', { from: 'x', to: 'y' }).startsWith('s1.n1:')).toBe(true)
    expect(newsKey([], 4).startsWith('s1.n1:')).toBe(true)
    // Deliberately unversioned: a schema bump must not hand a provider a
    // fresh quota for the day.
    expect(budgetKey('marketaux', '2026-07-26')).toBe('budget:marketaux:2026-07-26')
  })

  it('distinguish requests that differ only by scope', () => {
    expect(newsKey([], 4)).not.toBe(newsKey([a], 4))
    expect(newsKey([a], 4)).not.toBe(newsKey([a], 8))
  })
})

describe('createContainer', () => {
  it('builds with no environment, no network and no providers', () => {
    const clock = new FakeClock()
    const container = createContainer({ env: {}, clock })
    expect(container.config.mode).toBe('fixture')
    expect(container.store.id).toBe('memory')
    expect(container.registry.chainFor('quotes', ['anything'])).toEqual([])
  })

  it('routes config and readiness warnings to the injected logger', () => {
    const warnings: string[] = []
    createContainer({
      env: { MARKETDATA_MODE: 'live' },
      clock: new FakeClock(),
      logger: { resolution: () => {}, warn: (message) => warnings.push(message) },
    })
    expect(warnings.some((w) => /no live provider configured/.test(w))).toBe(true)
    expect(warnings.some((w) => /counted per instance/.test(w))).toBe(true)
  })

  it('round-trips a value and its provenance through the cache port', async () => {
    const clock = new FakeClock()
    const container = createContainer({ env: {}, clock })
    const provenance = {
      asOf: clock.isoNow(),
      asOfPrecision: 'second' as const,
      receivedAt: clock.isoNow(),
      ageMs: 0,
      source: { providerId: 'p', providerName: 'P' },
      quality: 'realtime' as const,
      isDelayed: false,
      delayMinutes: null,
      isProxy: false,
    }
    await container.cache.set('k', { n: 1 }, provenance, 60_000)
    const cached = await container.cache.get<{ n: number }>('k')
    expect(cached?.value).toEqual({ n: 1 })
    expect(cached?.provenance.source.providerId).toBe('p')
    expect(cached?.expiresAtMs).toBe(clock.epochMs() + 60_000)
  })
})

describe('checkChainIntegrity', () => {
  /*
   * The check that would have caught both defects of 2026-08-25: `yahoo`
   * implemented but filtered out of every chain by a missing credential entry,
   * and `derived` sitting first in the sentiment chain with no adapter behind
   * it. Each degraded a category to fixture and reported it as though nobody
   * had configured a provider.
   */
  const config = loadMarketDataConfig(HYBRID)
  const everything = () => true

  it('is silent when every configured id is registered', () => {
    expect(checkChainIntegrity(config, everything)).toEqual([])
  })

  it('names a phantom provider and the category it degrades', () => {
    const issues = checkChainIntegrity(config, (id) => id !== 'derived')
    const sentiment = issues.find((issue) => issue.category === 'sentiment')
    expect(sentiment?.message).toContain('"derived"')
    expect(sentiment?.message).toContain('no adapter has registered')
  })

  it('says what the category falls back to, so it is not read as a choice', () => {
    const issues = checkChainIntegrity(config, (id) => id !== 'derived')
    expect(issues.find((i) => i.category === 'sentiment')?.message).toContain('"fixture"')
  })

  it('reports a category left with nothing differently', () => {
    const issues = checkChainIntegrity(config, () => false)
    expect(issues.find((i) => i.category === 'sentiment')?.message).toContain(
      'cannot resolve at all',
    )
  })

  it('is generic rather than knowing about any particular provider', () => {
    /*
     * Planted against a different id entirely: the rule must be about the
     * relation between config and registry, not a list of known-bad names.
     */
    const issues = checkChainIntegrity(config, (id) => id !== 'avanza')
    expect(issues.map((i) => i.category)).toContain('equity-index-se')
    expect(issues.map((i) => i.category)).toContain('commodities')
  })

  it('runs outside live mode, where both real defects were found', () => {
    /* `checkLiveReadiness` returns [] unless production; this must not. */
    expect(checkLiveReadiness(loadMarketDataConfig(HYBRID))).toEqual([])
    expect(
      checkChainIntegrity(loadMarketDataConfig(HYBRID), (id) => id !== 'yahoo'),
    ).not.toEqual([])
  })
})
