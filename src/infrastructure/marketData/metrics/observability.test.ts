/**
 * Observability guarantees (Phase 3.5).
 *
 * The load-bearing ones: high-cardinality data cannot enter metric labels
 * through any public API, the Prometheus output is correct and deterministic,
 * normalization collisions are refused rather than silently merged, log
 * sampling is reproducible, and the health endpoint is closed by default
 * wherever it could reveal real topology.
 */

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_LABEL_KEYS,
  BREAKER_STATE_VALUE,
  LATENCY_BUCKETS_MS,
  METRIC,
  validateLabel,
} from '~/application/marketData/metrics'
import { sampledIn, stableHash } from '~/domain/shared/hash'
import { createLogger } from '../logging'
import { createMetricsRegistry, MAX_SERIES } from './registry'
import {
  findNameCollisions,
  PrometheusNameCollisionError,
  renderPrometheus,
  toPrometheusName,
} from './prometheus'
import { isHealthAuthorized } from '../healthFns'
import { loadMarketDataConfig } from '../config'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { MemoryCacheStore } from '../cache/store'
import { SingleFlight } from '../cache/singleFlight'
import { CircuitBreakerRegistry } from '../resilience/circuitBreaker'
import { DailyBudget } from '../resilience/budget'
import { TokenBucket } from '../resilience/tokenBucket'
import { attemptProvider, type AttemptDeps } from '../attempt'

/* ------------------------------------------------------- label cardinality */

describe('metric label cardinality', () => {
  const HIGH_CARDINALITY: Array<[string, string]> = [
    ['cache key', 's1.n1:quotes:idx:sp500'],
    ['URL', 'https://api.coingecko.com/api/v3/simple/price'],
    ['symbol list', 'idx:dax|idx:sp500'],
    ['timestamp', '2026-07-26T12:00:00.000Z'],
    ['correlation id', 'a1b2c3d4e5f60718'],
    ['error message', 'connect ECONNREFUSED 10.0.0.1:443'],
  ]

  it.each(HIGH_CARDINALITY)('rejects a %s as a label value', (_kind, value) => {
    expect(validateLabel('provider', value)).not.toBeNull()
  })

  it('rejects any label key outside the allowlist', () => {
    for (const key of ['cacheKey', 'correlationId', 'url', 'symbol', 'message']) {
      expect(validateLabel(key, 'x')).not.toBeNull()
    }
    for (const key of ALLOWED_LABEL_KEYS) {
      expect(validateLabel(key, 'ok')).toBeNull()
    }
  })

  it('drops the whole series rather than admitting a bad label', () => {
    const registry = createMetricsRegistry()
    registry.increment(METRIC.cacheHit, {
      provider: 'https://evil.test/leak',
    })
    // Not merely sanitized — the write is refused, so the intended series is
    // never created. The only series present is the rejection counter itself.
    expect(registry.snapshot().map((s) => s.name)).toEqual([METRIC.metricsRejected])
    expect(registry.droppedWrites().invalidLabel).toBe(1)
    expect(registry.rejections()[0]?.why).toMatch(/URL/)
  })

  it('cannot be bypassed through gauge or observe either', () => {
    const registry = createMetricsRegistry()
    const bad = { category: '2026-07-26T00:00:00Z' } as never
    registry.gauge(METRIC.budgetUsed, 1, bad)
    registry.observe(METRIC.providerLatency, 1, bad)
    expect(registry.snapshot().map((s) => s.name)).toEqual([METRIC.metricsRejected])
    expect(registry.droppedWrites().invalidLabel).toBe(2)
  })

  it('reports a visible diagnostic when the series cap is reached', () => {
    const warnings: number[] = []
    const registry = createMetricsRegistry({
      onCapacityReached: (limit) => warnings.push(limit),
    })
    for (let i = 0; i < MAX_SERIES + 10; i++) {
      registry.increment(METRIC.providerRequest, { provider: `p${i}` })
    }
    // Once, not once per dropped write: a counter alone is not a diagnostic,
    // and a flood of identical warnings is not one either.
    expect(warnings).toEqual([MAX_SERIES])
  })

  it('bounds the number of retained series', () => {
    const registry = createMetricsRegistry()
    // Legitimate labels could still combine past any sane limit.
    for (let i = 0; i < MAX_SERIES + 25; i++) {
      registry.increment(METRIC.providerRequest, { provider: `p${i}` })
    }
    expect(registry.snapshot()).toHaveLength(MAX_SERIES)
    expect(registry.droppedWrites().capacity).toBe(25)
  })

  it('bounds the retained rejection list', () => {
    const registry = createMetricsRegistry()
    for (let i = 0; i < 500; i++) {
      registry.increment(METRIC.cacheHit, { provider: `bad|${i}` })
    }
    // A flood of rejections must not become the memory problem validation
    // exists to prevent.
    expect(registry.rejections().length).toBeLessThanOrEqual(100)
    expect(registry.droppedWrites().invalidLabel).toBe(500)
    // The rejection counter is label-free, so 500 distinct bad values still
    // produce exactly ONE series. It cannot recurse or grow.
    const series = registry.snapshot()
    expect(series).toHaveLength(1)
    expect(series[0]?.name).toBe(METRIC.metricsRejected)
    expect(series[0] && 'value' in series[0] && series[0].value).toBe(500)
  })
})

/* --------------------------------------------------------------- recorder */

describe('metrics recorder semantics', () => {
  it('counters only increase, and reject negative increments', () => {
    const registry = createMetricsRegistry()
    registry.increment(METRIC.cacheHit, undefined, 3)
    registry.increment(METRIC.cacheHit, undefined, -5)
    const [series] = registry.snapshot()
    expect(series?.kind).toBe('counter')
    expect(series && 'value' in series && series.value).toBe(3)
    expect(registry.droppedWrites().invalidValue).toBe(1)
  })

  it('gauges overwrite', () => {
    const registry = createMetricsRegistry()
    registry.gauge(METRIC.budgetRemaining, 250, { provider: 'coingecko' })
    registry.gauge(METRIC.budgetRemaining, 3, { provider: 'coingecko' })
    const [series] = registry.snapshot()
    expect(series && 'value' in series && series.value).toBe(3)
  })

  it('places boundary observations in the bucket named by le', () => {
    const registry = createMetricsRegistry()
    // Exactly 100 belongs to le="100", not le="250".
    registry.observe(METRIC.providerLatency, 100)
    const [series] = registry.snapshot()
    if (!series || series.kind !== 'histogram') throw new Error('expected histogram')
    const boundaryIndex = LATENCY_BUCKETS_MS.indexOf(100)
    expect(series.counts[boundaryIndex]).toBe(1)
    expect(series.count).toBe(1)
    expect(series.sum).toBe(100)
  })

  it('puts an observation past the last boundary in the overflow slot', () => {
    const registry = createMetricsRegistry()
    registry.observe(METRIC.providerLatency, 99_999)
    const [series] = registry.snapshot()
    if (!series || series.kind !== 'histogram') throw new Error('expected histogram')
    expect(series.counts[LATENCY_BUCKETS_MS.length]).toBe(1)
  })

  it('rejects a negative observation — that is a clock problem, not a slow call', () => {
    const registry = createMetricsRegistry()
    registry.observe(METRIC.providerLatency, -5)
    expect(registry.snapshot().map((s) => s.name)).toEqual([METRIC.metricsRejected])
    expect(registry.droppedWrites().invalidValue).toBe(1)
  })

  it('retains no raw observations', () => {
    const registry = createMetricsRegistry()
    for (let i = 0; i < 5_000; i++) registry.observe(METRIC.providerLatency, i % 900)
    const [series] = registry.snapshot()
    if (!series || series.kind !== 'histogram') throw new Error('expected histogram')
    // Bounded state: bucket counts, not 5,000 samples.
    expect(series.counts).toHaveLength(LATENCY_BUCKETS_MS.length + 1)
    expect(series.count).toBe(5_000)
  })

  it('does not expose mutable internal state', () => {
    const registry = createMetricsRegistry()
    registry.increment(METRIC.cacheHit, { provider: 'p' })
    const snapshot = registry.snapshot()
    const first = snapshot[0]!
    if (first.kind === 'counter') first.value = 9_999
    first.labels.provider = 'tampered'
    const [again] = registry.snapshot()
    expect(again && 'value' in again && again.value).toBe(1)
    expect(again?.labels.provider).toBe('p')
  })

  it('does not lose increments across interleaved async writes', async () => {
    const registry = createMetricsRegistry()
    await Promise.all(
      Array.from({ length: 500 }, async () => {
        await Promise.resolve()
        registry.increment(METRIC.cacheHit, { provider: 'p' })
      }),
    )
    const [series] = registry.snapshot()
    expect(series && 'value' in series && series.value).toBe(500)
  })

  it('sorts the snapshot deterministically', () => {
    const build = () => {
      const registry = createMetricsRegistry()
      registry.increment(METRIC.providerRequest, { provider: 'z' })
      registry.increment(METRIC.cacheHit, { provider: 'a' })
      registry.increment(METRIC.providerRequest, { provider: 'a' })
      return registry.snapshot().map((s) => `${s.name}|${JSON.stringify(s.labels)}`)
    }
    expect(build()).toEqual(build())
    expect(build()[0]).toContain('cache.hit')
  })
})

/* ------------------------------------------------------------- prometheus */

describe('Prometheus renderer', () => {
  it('normalizes dotted names to valid Prometheus names', () => {
    expect(toPrometheusName('marketdata.provider.latency_ms')).toBe(
      'marketdata_provider_latency_ms',
    )
    expect(toPrometheusName('9bad.name')).toMatch(/^_/)
  })

  it('detects and refuses normalization collisions', () => {
    // `a.b` and `a_b` both normalize to `a_b`, which would silently merge two
    // unrelated series on a dashboard.
    const collisions = findNameCollisions(['marketdata.a.b', 'marketdata.a_b'])
    expect(collisions.get('marketdata_a_b')).toEqual(['marketdata.a.b', 'marketdata.a_b'])
  })

  it('never collides across the real metric catalog', () => {
    expect(findNameCollisions(Object.values(METRIC)).size).toBe(0)
  })

  it('throws rather than emitting merged series', () => {
    const series = [
      { kind: 'counter' as const, name: 'x.y', labels: {}, value: 1 },
      { kind: 'counter' as const, name: 'x_y', labels: {}, value: 2 },
    ]
    expect(() => renderPrometheus(series)).toThrow(PrometheusNameCollisionError)
  })

  it('emits cumulative buckets, _sum and _count', () => {
    const registry = createMetricsRegistry()
    registry.observe(METRIC.providerLatency, 5, { provider: 'p' })
    registry.observe(METRIC.providerLatency, 300, { provider: 'p' })
    const text = renderPrometheus(registry.snapshot())

    expect(text).toContain('# TYPE marketdata_provider_latency_ms histogram')
    // Cumulative: le="10" holds the 5ms sample; le="500" holds both.
    expect(text).toContain('le="10"} 1')
    expect(text).toContain('le="500"} 2')
    expect(text).toContain('le="+Inf"} 2')
    expect(text).toContain('marketdata_provider_latency_ms_sum{provider="p"} 305')
    expect(text).toContain('marketdata_provider_latency_ms_count{provider="p"} 2')
  })

  it('emits HELP and TYPE once per family', () => {
    const registry = createMetricsRegistry()
    registry.increment(METRIC.providerRequest, { provider: 'a' })
    registry.increment(METRIC.providerRequest, { provider: 'b' })
    const text = renderPrometheus(registry.snapshot())
    expect(text.match(/# TYPE marketdata_provider_request/g)).toHaveLength(1)
    expect(text.match(/# HELP marketdata_provider_request/g)).toHaveLength(1)
  })

  it('escapes label values', () => {
    const series = [
      {
        kind: 'counter' as const,
        name: 'marketdata.resolution',
        labels: { reason: 'a"b\\c' },
        value: 1,
      },
    ]
    expect(renderPrometheus(series)).toContain('reason="a\\"b\\\\c"')
  })

  it('drops label keys Prometheus would reject', () => {
    const series = [
      {
        kind: 'counter' as const,
        name: 'marketdata.resolution',
        labels: { 'not-valid': 'x', provider: 'p' },
        value: 1,
      },
    ]
    const text = renderPrometheus(series)
    expect(text).toContain('provider="p"')
    expect(text).not.toContain('not-valid')
  })

  it('renders byte-identically across runs', () => {
    const build = () => {
      const registry = createMetricsRegistry()
      registry.increment(METRIC.cacheHit, { category: 'crypto' })
      registry.gauge(METRIC.breakerState, BREAKER_STATE_VALUE.open, { provider: 'p' })
      registry.observe(METRIC.providerLatency, 42, { provider: 'p' })
      return renderPrometheus(registry.snapshot())
    }
    expect(build()).toBe(build())
  })

  it('renders an empty registry as empty output', () => {
    expect(renderPrometheus(createMetricsRegistry().snapshot())).toBe('')
  })
})

/* -------------------------------------------------------- log sampling */

describe('deterministic log sampling', () => {
  it('is reproducible for the same key', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'))
    expect(sampledIn('abc', 20)).toBe(sampledIn('abc', 20))
  })

  it('keeps everything at a denominator of 1 or less', () => {
    for (const denominator of [1, 0, -3, Number.NaN]) {
      expect(sampledIn('anything', denominator)).toBe(true)
    }
  })

  it('samples roughly 1 in N across many keys', () => {
    const kept = Array.from({ length: 2_000 }, (_, i) => sampledIn(`k${i}`, 20)).filter(
      Boolean,
    ).length
    // Distribution, not exactness — this guards against a hash that clumps.
    expect(kept).toBeGreaterThan(50)
    expect(kept).toBeLessThan(150)
  })

  it('always logs failures and degradations in full', () => {
    const records: Array<Record<string, unknown>> = []
    const logger = createLogger({
      sink: (r) => records.push(r),
      // Aggressive sampling that must NOT apply to these outcomes.
      successSampleRate: 1_000_000,
    })
    for (const outcome of [
      'provider-failure',
      'provider-skipped',
      'stale-served',
      'fixture-served',
      'error',
    ] as const) {
      logger.resolution({
        correlationId: 'c',
        category: 'crypto',
        capability: 'crypto',
        cacheKey: 'k',
        providerId: 'p',
        outcome,
        latencyMs: 1,
      })
    }
    expect(records).toHaveLength(5)
  })

  it('can disable successful logs entirely', () => {
    const records: Array<Record<string, unknown>> = []
    const logger = createLogger({ sink: (r) => records.push(r), successSampleRate: 0 })
    logger.resolution({
      correlationId: 'c',
      category: 'crypto',
      capability: 'crypto',
      cacheKey: 'k',
      providerId: 'p',
      outcome: 'provider-success',
      latencyMs: 1,
    })
    expect(records).toEqual([])
    expect(logger.diagnostics().sampledOut).toBe(0)
  })

  it('respects the level threshold', () => {
    const records: Array<Record<string, unknown>> = []
    const logger = createLogger({ sink: (r) => records.push(r), level: 'error' })
    logger.warn('a warning')
    expect(records).toEqual([])
  })

  it('bounds field length', () => {
    const records: Array<Record<string, unknown>> = []
    const logger = createLogger({ sink: (r) => records.push(r) })
    logger.warn('x'.repeat(5_000))
    expect(String(records[0]?.message).length).toBeLessThan(400)
  })

  it('never lets a sink failure fail the caller, and never recurses', () => {
    let sinkCalls = 0
    const errors: unknown[] = []
    const logger = createLogger({
      successSampleRate: 1,
      sink: () => {
        sinkCalls += 1
        throw new Error('sink is down')
      },
      onSinkError: (error) => errors.push(error),
    })
    expect(() => logger.warn('hello')).not.toThrow()
    // Reported out-of-band exactly once, not back through the failing sink.
    expect(sinkCalls).toBe(1)
    expect(errors).toHaveLength(1)
    expect(logger.diagnostics().sinkFailures).toBe(1)
  })
})

/* ------------------------------------------------------- health endpoint */

describe('health endpoint authorization', () => {
  it('is open in fixture mode for local diagnostics', () => {
    expect(loadMarketDataConfig({}).healthEnabled).toBe(true)
    expect(
      isHealthAuthorized({
        enabled: true,
        requiresToken: false,
        configuredToken: undefined,
        presentedToken: undefined,
      }),
    ).toBe(true)
  })

  it('is disabled by default in hybrid and live', () => {
    for (const mode of ['hybrid', 'live'] as const) {
      expect(loadMarketDataConfig({ MARKETDATA_MODE: mode }).healthEnabled).toBe(false)
    }
  })

  it('requires a matching token once enabled outside fixture mode', () => {
    const base = { enabled: true, requiresToken: true, configuredToken: 'operator-token' }
    expect(isHealthAuthorized({ ...base, presentedToken: 'operator-token' })).toBe(true)
    expect(isHealthAuthorized({ ...base, presentedToken: 'wrong' })).toBe(false)
    expect(isHealthAuthorized({ ...base, presentedToken: undefined })).toBe(false)
  })

  it('does not treat a missing configured token as "allow everything"', () => {
    expect(
      isHealthAuthorized({
        enabled: true,
        requiresToken: true,
        configuredToken: undefined,
        presentedToken: 'anything',
      }),
    ).toBe(false)
  })

  it('stays closed when disabled, whatever token is presented', () => {
    expect(
      isHealthAuthorized({
        enabled: false,
        requiresToken: true,
        configuredToken: 't',
        presentedToken: 't',
      }),
    ).toBe(false)
  })

  it('never stores the token value in config', () => {
    const config = loadMarketDataConfig({
      MARKETDATA_MODE: 'hybrid',
      MARKETDATA_HEALTH_TOKEN: 'super-secret-operator-token',
    })
    expect(config.healthTokenPresent).toBe(true)
    expect(JSON.stringify(config)).not.toContain('super-secret-operator-token')
  })
})

/* ------------------------------------------- the four formerly dead signals */

describe('formerly dead signals now emit', () => {
  /**
   * Each needs a condition fixture-only mode never produces: fixtures are
   * never cached, carry no budget, and sequential calls never overlap. So this
   * drives them deliberately rather than inferring from a fixture run.
   */
  function metered() {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const store = new MemoryCacheStore(clock)
    const metrics = createMetricsRegistry()
    const breakers = new CircuitBreakerRegistry(clock, {
      failureThreshold: 1,
      cooldownMs: 60_000,
    })
    const budget = new DailyBudget(store, clock)
    const singleFlight = new SingleFlight(() =>
      metrics.increment(METRIC.singleFlightShared),
    )
    const deps: AttemptDeps = {
      clock,
      random: new SeededRandom(1),
      metrics,
      breakers,
      budget,
      bucketFor: () => new TokenBucket({ ratePerMinute: null }, clock),
      budgetLimitFor: () => 250,
      timeoutMsFor: () => 1_000,
      retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1, maxAttemptsRateLimited: 1 },
    }
    return { metrics, deps, singleFlight, clock, breakers }
  }

  const names = (registry: ReturnType<typeof createMetricsRegistry>) =>
    new Set(registry.snapshot().map((s) => s.name))

  it('emits budget.used and budget.remaining for a metered provider', async () => {
    const h = metered()
    await attemptProvider(h.deps, {
      providerId: 'coingecko',
      capability: 'crypto',
      correlationId: NO_CORRELATION,
      call: async () => 'ok',
    })
    expect(names(h.metrics)).toContain(METRIC.budgetUsed)
    expect(names(h.metrics)).toContain(METRIC.budgetRemaining)
    const used = h.metrics.snapshot().find((s) => s.name === METRIC.budgetUsed)
    expect(used && 'value' in used && used.value).toBe(1)
  })

  it('emits breaker.state with the documented numeric mapping', async () => {
    const h = metered()
    await attemptProvider(h.deps, {
      providerId: 'p',
      capability: 'crypto',
      correlationId: NO_CORRELATION,
      call: async () => {
        throw Object.assign(new Error('down'), { code: 'network' })
      },
    })
    // Threshold is 1, so the breaker is open on the next observation.
    await attemptProvider(h.deps, {
      providerId: 'p',
      capability: 'crypto',
      correlationId: NO_CORRELATION,
      call: async () => 'ok',
    })
    const state = h.metrics.snapshot().find((s) => s.name === METRIC.breakerState)
    expect(state && 'value' in state && state.value).toBe(BREAKER_STATE_VALUE.open)
  })

  it('emits singleflight.shared once per joined caller', async () => {
    const h = metered()
    let started = 0
    const work = async () => {
      started += 1
      await Promise.resolve()
      return 'v'
    }
    await Promise.all([
      h.singleFlight.run('k', work),
      h.singleFlight.run('k', work),
      h.singleFlight.run('k', work),
    ])
    expect(started).toBe(1)
    const shared = h.metrics.snapshot().find((s) => s.name === METRIC.singleFlightShared)
    // Join EVENTS, not distinct keys: two callers attached to one execution.
    expect(shared && 'value' in shared && shared.value).toBe(2)
  })
})
