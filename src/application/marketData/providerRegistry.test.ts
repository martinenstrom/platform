import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import {
  buildProvenance,
  type DataSourceMetadata,
  type ErrorCode,
  type Provenance,
} from '~/domain/market'
import {
  createProviderRegistry,
  FIXTURE_PROVIDER_ID,
  noopLogger,
  resolve,
  type CachedValue,
  type ResolutionCache,
  type ResolutionLog,
  type ResolveDeps,
} from './providerRegistry'
import type { AnyProvider, ProviderRegistration, QuoteProvider } from './ports'
import { noopMetrics } from './metrics'
import type { RunAttempt } from './resolution'
import { NO_CORRELATION } from '~/domain/shared/correlation'

/* --------------------------------------------------------------- test doubles */

const clock = new FakeClock('2026-07-26T12:00:00.000Z')

function source(providerId: string): DataSourceMetadata {
  return { providerId, providerName: providerId }
}

function provenanceFor(providerId: string, asOf = clock.isoNow()): Provenance {
  return buildProvenance({
    asOf,
    nowMs: clock.epochMs(),
    source: source(providerId),
    quality: providerId === FIXTURE_PROVIDER_ID ? 'fixture' : 'realtime',
  })
}

/** A quote provider that either answers with a marker value or throws. */
function stubProvider(id: string, behaviour: 'ok' | Error): ProviderRegistration {
  const provider: QuoteProvider = {
    id,
    name: id,
    fetchQuotes: async () => {
      if (behaviour !== 'ok') throw behaviour
      return []
    },
  }
  return { provider, capabilities: new Set(['quotes'] as const) }
}

/** In-memory cache double with an explicit clock, so expiry is deterministic. */
function memoryCache(): ResolutionCache & { entries: Map<string, CachedValue<unknown>> } {
  const entries = new Map<string, CachedValue<unknown>>()
  return {
    entries,
    async get<T>(key: string) {
      return (entries.get(key) as CachedValue<T> | undefined) ?? null
    },
    async set<T>(key: string, value: T, provenance: Provenance, ttlMs: number) {
      entries.set(key, { value, provenance, expiresAtMs: clock.epochMs() + ttlMs })
    },
  }
}

function attemptReturning(marker: string) {
  return async (provider: AnyProvider) => ({
    data: `${marker}:${provider.id}`,
    provenance: provenanceFor(provider.id),
  })
}

/**
 * Pass-through attempt runner. The operational pipeline — breaker, budget,
 * limiter, timeout, retry — has its own suites; these tests exercise chain
 * ordering, staleness and fallback in isolation from it.
 */
const passThrough: RunAttempt = async ({ providerId, call }) => {
  try {
    const value = await call({
      signal: new AbortController().signal,
      clock,
      correlationId: NO_CORRELATION,
    })
    return { kind: 'success', value, latencyMs: 0, attempts: 1 }
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? (error.code as ErrorCode)
        : 'unknown'
    return {
      kind: 'failed',
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
        providerId,
        retryable: false,
      },
      attempts: 1,
    }
  }
}

function deps(
  overrides: Partial<ResolveDeps> & Pick<ResolveDeps, 'registry'>,
): ResolveDeps {
  return {
    clock,
    production: false,
    logger: noopLogger,
    metrics: noopMetrics,
    runAttempt: passThrough,
    // Not deduplicated here: single-flight has its own suite, and sharing an
    // execution would mask the per-call assertions below.
    singleFlight: (_key, execute) => execute(),
    correlationId: NO_CORRELATION,
    ...overrides,
  }
}

beforeEach(() => {
  clock.setTo('2026-07-26T12:00:00.000Z')
})

/* ------------------------------------------------------------------- T7 */

describe('createProviderRegistry', () => {
  it('returns providers in the configured chain order', () => {
    const registry = createProviderRegistry([
      stubProvider('b', 'ok'),
      stubProvider('a', 'ok'),
    ])
    const chain = registry.chainFor('quotes', ['a', 'b'])
    expect(chain.map((r) => r.provider.id)).toEqual(['a', 'b'])
  })

  it('skips unconfigured providers instead of failing', () => {
    // A missing API key legitimately drops a provider from its chain.
    const registry = createProviderRegistry([stubProvider('a', 'ok')])
    expect(
      registry.chainFor('quotes', ['missing', 'a']).map((r) => r.provider.id),
    ).toEqual(['a'])
  })

  it('skips providers that do not serve the requested capability', () => {
    const registry = createProviderRegistry([stubProvider('a', 'ok')])
    expect(registry.chainFor('news', ['a'])).toEqual([])
    expect(registry.has('a', 'quotes')).toBe(true)
    expect(registry.has('a', 'news')).toBe(false)
  })

  it('rejects duplicate registrations', () => {
    expect(() =>
      createProviderRegistry([stubProvider('a', 'ok'), stubProvider('a', 'ok')]),
    ).toThrow(/Duplicate provider/)
  })
})

/* ------------------------------------------------------------------- T8 */

describe('resolve — fallback chain', () => {
  const base = {
    category: 'crypto' as const,
    capability: 'quotes' as const,
    cacheKey: 'v1:quotes:crypto:btc',
    marketOpen: true,
  }

  it('uses the first healthy provider', async () => {
    const registry = createProviderRegistry([
      stubProvider('a', 'ok'),
      stubProvider('b', 'ok'),
    ])
    const result = await resolve(deps({ registry }), {
      ...base,
      chain: ['a', 'b'],
      attempt: attemptReturning('quote'),
    })
    expect(result.state).toBe('ok')
    expect(result.state === 'ok' && result.data).toBe('quote:a')
  })

  it('falls through to the next provider when the first throws', async () => {
    const registry = createProviderRegistry([
      stubProvider('a', new Error('boom')),
      stubProvider('b', 'ok'),
    ])
    const result = await resolve(deps({ registry }), {
      ...base,
      chain: ['a', 'b'],
      attempt: async (provider) => {
        if (provider.id === 'a') throw new Error('boom')
        return { data: 'quote:b', provenance: provenanceFor('b') }
      },
    })
    expect(result.state).toBe('ok')
    expect(result.state === 'ok' && result.provenance.source.providerId).toBe('b')
  })

  it('serves a stale entry immediately under stale-while-revalidate', async () => {
    // Crypto enables SWR, so an expired-but-usable entry is returned without
    // waiting for a provider — and still labelled `stale`, never `ok`.
    const cache = memoryCache()
    cache.entries.set(base.cacheKey, {
      value: 'cached-real',
      provenance: provenanceFor('a', '2026-07-26T11:00:00.000Z'),
      expiresAtMs: clock.epochMs() - 1,
    })
    const registry = createProviderRegistry([stubProvider('a', 'ok')])
    const result = await resolve(deps({ registry, cache }), {
      ...base,
      chain: ['a'],
      attempt: attemptReturning('fresh'),
    })
    expect(result.state).toBe('stale')
    expect(result.state === 'stale' && result.data).toBe('cached-real')
  })

  it('serves a stale cached value before ever reaching the fixture', async () => {
    // An explicitly stale real value beats an invented one.
    const cache = memoryCache()
    cache.entries.set(base.cacheKey, {
      value: 'cached-real',
      provenance: provenanceFor('a', '2026-07-26T11:00:00.000Z'),
      expiresAtMs: clock.epochMs() - 1,
    })
    const registry = createProviderRegistry([
      stubProvider('a', new Error('down')),
      stubProvider(FIXTURE_PROVIDER_ID, 'ok'),
    ])
    // yields-us disables SWR, so the chain is tried first and the stale
    // reason reflects why it failed rather than a generic label.
    const result = await resolve(deps({ registry, cache }), {
      ...base,
      category: 'yields-us',
      chain: ['a', FIXTURE_PROVIDER_ID],
      attempt: async (provider) => {
        if (provider.id === 'a') throw new Error('down')
        return { data: 'fixture', provenance: provenanceFor(FIXTURE_PROVIDER_ID) }
      },
    })
    expect(result.state).toBe('stale')
    expect(result.state === 'stale' && result.data).toBe('cached-real')
    expect(result.state === 'stale' && result.staleReason).toBe('provider-error')
  })

  it('discards a cached value older than maxStaleMs', async () => {
    const cache = memoryCache()
    // crypto maxStaleMs is 2h; make it 3h old.
    cache.entries.set(base.cacheKey, {
      value: 'ancient',
      provenance: provenanceFor('a', '2026-07-26T09:00:00.000Z'),
      expiresAtMs: clock.epochMs() - 1,
    })
    const registry = createProviderRegistry([
      stubProvider('a', new Error('down')),
      stubProvider(FIXTURE_PROVIDER_ID, 'ok'),
    ])
    const result = await resolve(deps({ registry, cache }), {
      ...base,
      chain: ['a', FIXTURE_PROVIDER_ID],
      attempt: async (provider) => {
        if (provider.id === 'a') throw new Error('down')
        return { data: 'fixture', provenance: provenanceFor(FIXTURE_PROVIDER_ID) }
      },
    })
    expect(result.state).toBe('fixture')
  })

  it('serves a fresh cache hit without calling any provider', async () => {
    const cache = memoryCache()
    cache.entries.set(base.cacheKey, {
      value: 'cached',
      provenance: provenanceFor('a'),
      expiresAtMs: clock.epochMs() + 60_000,
    })
    const attempt = vi.fn(attemptReturning('quote'))
    const registry = createProviderRegistry([stubProvider('a', 'ok')])
    const result = await resolve(deps({ registry, cache }), {
      ...base,
      chain: ['a'],
      attempt,
    })
    expect(result.state).toBe('ok')
    expect(attempt).not.toHaveBeenCalled()
  })

  it('reports no-provider-configured when the chain is empty', async () => {
    const registry = createProviderRegistry([])
    const result = await resolve(deps({ registry }), {
      ...base,
      chain: ['nobody'],
      attempt: attemptReturning('quote'),
    })
    expect(result.state).toBe('error')
    expect(result.state === 'error' && result.error.code).toBe('no-provider-configured')
  })
})

/* ------------------------------------------------------------------- T9 */

describe('resolve — provenance propagation', () => {
  it('names the provider that actually produced the value, not the chain head', async () => {
    const registry = createProviderRegistry([
      stubProvider('head', new Error('down')),
      stubProvider('tail', 'ok'),
    ])
    const result = await resolve(deps({ registry }), {
      category: 'fx',
      capability: 'quotes',
      cacheKey: 'v1:fx',
      marketOpen: true,
      chain: ['head', 'tail'],
      attempt: async (provider) => {
        if (provider.id === 'head') throw new Error('down')
        return { data: 1, provenance: provenanceFor('tail') }
      },
    })
    expect(result.state === 'ok' && result.provenance.source.providerId).toBe('tail')
  })

  it('recomputes ageMs against the current clock when serving from cache', async () => {
    const cache = memoryCache()
    cache.entries.set('v1:fx', {
      value: 1,
      provenance: provenanceFor('a'),
      expiresAtMs: clock.epochMs() + 600_000,
    })
    clock.advance(120_000)
    const registry = createProviderRegistry([stubProvider('a', 'ok')])
    const result = await resolve(deps({ registry, cache }), {
      category: 'fx',
      capability: 'quotes',
      cacheKey: 'v1:fx',
      marketOpen: true,
      chain: ['a'],
      attempt: attemptReturning('x'),
    })
    // A cached ageMs is meaningless; it must be recomputed on read.
    expect(result.state === 'ok' && result.provenance.ageMs).toBe(120_000)
  })

  it('maps provider error codes onto the matching stale reason', async () => {
    const cache = memoryCache()
    cache.entries.set('v1:fx', {
      value: 1,
      provenance: provenanceFor('a', '2026-07-26T11:59:00.000Z'),
      expiresAtMs: clock.epochMs() - 1,
    })
    const rateLimited = Object.assign(new Error('429'), { code: 'rate-limit' })
    const registry = createProviderRegistry([stubProvider('a', rateLimited)])
    const result = await resolve(deps({ registry, cache }), {
      // Non-SWR, so the provider is actually attempted and its failure code
      // is what selects the stale reason.
      category: 'yields-us',
      capability: 'quotes',
      cacheKey: 'v1:fx',
      marketOpen: true,
      chain: ['a'],
      attempt: async () => {
        throw rateLimited
      },
    })
    expect(result.state === 'stale' && result.staleReason).toBe('rate-limited')
  })

  it('emits one structured log line per resolution step', async () => {
    const logs: ResolutionLog[] = []
    const registry = createProviderRegistry([
      stubProvider('a', new Error('down')),
      stubProvider('b', 'ok'),
    ])
    await resolve(
      deps({
        registry,
        logger: { resolution: (entry) => logs.push(entry), warn: () => {} },
      }),
      {
        category: 'fx',
        capability: 'quotes',
        cacheKey: 'v1:fx',
        marketOpen: true,
        chain: ['a', 'b'],
        attempt: async (provider) => {
          if (provider.id === 'a') throw new Error('down')
          return { data: 1, provenance: provenanceFor('b') }
        },
      },
    )
    expect(logs.map((l) => l.outcome)).toEqual(['provider-failure', 'provider-success'])
    expect(logs.every((l) => l.cacheKey === 'v1:fx')).toBe(true)
  })
})

/* ------------------------------------------------------------------ T10 */

describe('resolve — fixture is never presented as live (D2)', () => {
  const request = {
    category: 'crypto' as const,
    capability: 'quotes' as const,
    cacheKey: 'v1:crypto',
    marketOpen: true,
    chain: ['live', FIXTURE_PROVIDER_ID],
  }

  const registry = () =>
    createProviderRegistry([
      stubProvider('live', new Error('down')),
      stubProvider(FIXTURE_PROVIDER_ID, 'ok'),
    ])

  const attempt = async (provider: AnyProvider) => {
    if (provider.id === 'live') throw new Error('down')
    return { data: 'fixture-value', provenance: provenanceFor(FIXTURE_PROVIDER_ID) }
  }

  it('serves the fixture in non-production, labelled as such', async () => {
    const result = await resolve(deps({ registry: registry(), production: false }), {
      ...request,
      attempt,
    })
    expect(result.state).toBe('fixture')
    expect(result.state === 'fixture' && result.provenance.quality).toBe('fixture')
  })

  it('returns a genuine error in production instead of the fixture', async () => {
    const result = await resolve(deps({ registry: registry(), production: true }), {
      ...request,
      attempt,
    })
    expect(result.state).toBe('error')
    expect(result.state === 'error' && result.error.code).toBe('fallback-disallowed')
  })

  it('attaches lastGood in production so a caller may disclose it explicitly', async () => {
    const cache = memoryCache()
    cache.entries.set(request.cacheKey, {
      value: 'old-real',
      // Older than crypto's 2h maxStaleMs, so it cannot be served as `stale`.
      provenance: provenanceFor('live', '2026-07-26T06:00:00.000Z'),
      expiresAtMs: clock.epochMs() - 1,
    })
    const result = await resolve(
      deps({ registry: registry(), production: true, cache }),
      { ...request, attempt },
    )
    expect(result.state).toBe('error')
    // Present so the caller MAY show it with disclosure — but the state stays
    // 'error', so nothing renders it as live by accident.
    expect(result.state === 'error' && result.lastGood?.data).toBe('old-real')
  })
})
