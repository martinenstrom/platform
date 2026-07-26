/**
 * Composition root for the market-data layer.
 *
 * The one place concrete providers, the cache tiers, the resilience
 * primitives, the clock, the RNG, the logger and the metrics sink are bound to
 * the application's ports. Nothing in `application/`, `domain/` or
 * `presentation/` names a concrete provider — swapping Frankfurter for Twelve
 * Data is an environment change, and swapping either for a stub is a
 * constructor argument.
 *
 * Deliberately hand-rolled: a typed factory that can be read in one sitting
 * beats a DI framework this stack does not need.
 */

import {
  createProviderRegistry,
  type Logger,
  type ProviderRegistry,
  type ResolutionCache,
} from '~/application/marketData/providerRegistry'
import type { ProviderRegistration } from '~/application/marketData/ports'
import { METRIC, type Metrics } from '~/application/marketData/metrics'
import {
  summarizeHealth,
  type CategoryHealth,
  type MarketDataHealth,
  type ProviderHealth,
} from '~/application/marketData/health'
import { policyFor } from '~/application/marketData/policy'
import { fixtureAllowed } from '~/application/marketData/policy'
import { systemClock, type Clock } from '~/domain/shared/clock'
import { systemRandom, type Random } from '~/domain/shared/random'
import { newCorrelationId, type CorrelationId } from '~/domain/shared/correlation'
import { MemoryCacheStore, type CacheStore } from './cache/store'
import { TieredCache } from './cache/tiered'
import { SingleFlight } from './cache/singleFlight'
import { CircuitBreakerRegistry, DEFAULT_BREAKER } from './resilience/circuitBreaker'
import { DailyBudget } from './resilience/budget'
import { TokenBucket } from './resilience/tokenBucket'
import { DEFAULT_RETRY, type RetryOptions } from './resilience/retry'
import { attemptProvider, type AttemptDeps } from './attempt'
import type { RunAttempt } from '~/application/marketData/resolution'
import { createLogger } from './logging'
import { createMetricsRegistry, type MetricsRegistry } from './metrics/registry'
import {
  checkCacheSharing,
  checkLiveReadiness,
  checkProviderCredentials,
  checkQuotaSafety,
  loadMarketDataConfig,
  type MarketDataConfig,
} from './config'
import type { DataCategory } from '~/application/marketData/ports'

export interface Container {
  config: MarketDataConfig
  /**
   * Present when the container owns an in-memory recorder, which is what the
   * Prometheus exporter and health both read. Absent when metrics were
   * injected (tests) or disabled.
   */
  metricsRegistry?: MetricsRegistry
  registry: ProviderRegistry
  cache: ResolutionCache
  store: CacheStore
  clock: Clock
  random: Random
  logger: Logger
  metrics: Metrics
  singleFlight: SingleFlight
  breakers: CircuitBreakerRegistry
  budget: DailyBudget
  runAttempt: RunAttempt
  /** Mints one id per inbound request; threaded through the whole pipeline. */
  newCorrelationId(): CorrelationId
  health(): Promise<MarketDataHealth>
}

export interface ContainerOverrides {
  env?: Record<string, string | undefined>
  config?: MarketDataConfig
  /** Providers to register. Tests pass stubs; the app passes real adapters. */
  providers?: readonly ProviderRegistration[]
  store?: CacheStore
  /** Optional durable tier. Absent means memory-only, which is fully correct. */
  persistentStore?: CacheStore
  clock?: Clock
  random?: Random
  logger?: Logger
  metrics?: Metrics
  retry?: RetryOptions
}

export function createContainer(overrides: ContainerOverrides = {}): Container {
  const clock = overrides.clock ?? systemClock
  const random = overrides.random ?? systemRandom
  // An in-memory recorder by default, so the platform is observable without
  // any external dependency. Per-instance and reset on restart -- see
  // `metrics/registry.ts` for the limitations this implies.
  const metricsRegistry = overrides.metrics
    ? undefined
    : createMetricsRegistry({
        onCapacityReached: (limit) =>
          // Deferred below until `logger` exists; see `wireCapacityWarning`.
          capacityWarnings.push(
            `Metrics series cap of ${limit} reached: metric collection is now ` +
              `incomplete. Investigate label cardinality before trusting ` +
              `dashboards built on these series.`,
          ),
      })
  const capacityWarnings: string[] = []
  const metrics: Metrics = overrides.metrics ?? metricsRegistry!
  const config =
    overrides.config ?? loadMarketDataConfig(overrides.env ?? (process.env as never))

  // No credential values are passed: `config` never holds one, and the
  // logger's allowlist means it could not emit one anyway.
  const logger =
    overrides.logger ??
    createLogger({
      level: config.logLevel,
      successSampleRate: config.logSuccessSampleRate,
    })

  const store = overrides.store ?? new MemoryCacheStore(clock)
  const cache = new TieredCache(store, overrides.persistentStore)
  const registry = createProviderRegistry(overrides.providers ?? [])
  // Join events are the useful reading: "requests this saved".
  const singleFlight = new SingleFlight(() =>
    metrics.increment(METRIC.singleFlightShared),
  )
  const breakers = new CircuitBreakerRegistry(clock, DEFAULT_BREAKER)
  const budget = new DailyBudget(overrides.persistentStore ?? store, clock)
  const retry = overrides.retry ?? DEFAULT_RETRY

  const buckets = new Map<string, TokenBucket>()
  const bucketFor = (providerId: string): TokenBucket => {
    let bucket = buckets.get(providerId)
    if (!bucket) {
      bucket = new TokenBucket(
        { ratePerMinute: config.limits[providerId]?.requestsPerMinute ?? null },
        clock,
      )
      buckets.set(providerId, bucket)
    }
    return bucket
  }

  const attemptDeps: AttemptDeps = {
    clock,
    random,
    metrics,
    breakers,
    budget,
    bucketFor,
    budgetLimitFor: (providerId) => config.limits[providerId]?.requestsPerDay ?? null,
    timeoutMsFor: (providerId) => config.timeouts[providerId] ?? config.defaultTimeoutMs,
    retry,
  }

  const lastLatencyMs = new Map<string, number>()
  const runAttempt: RunAttempt = async (args) => {
    const outcome = await attemptProvider(attemptDeps, args)
    if (outcome.kind === 'success') lastLatencyMs.set(args.providerId, outcome.latencyMs)
    return outcome
  }

  for (const warning of config.warnings) logger.warn(warning)
  for (const issue of checkLiveReadiness(config)) {
    logger.warn(issue.message, { category: issue.category })
  }
  const sharingWarning = checkCacheSharing(config, cache.isShared)
  if (sharingWarning) logger.warn(sharingWarning)
  // Drains anything the registry recorded before the logger existed, and keeps
  // draining as the process runs.
  const drainCapacityWarnings = () => {
    while (capacityWarnings.length > 0) logger.warn(capacityWarnings.shift()!)
  }
  drainCapacityWarnings()

  // Quota safety and credentials are FATAL in live mode rather than merely
  // warned about: starting a deployment that will silently overrun a
  // provider's global quota, or that depends on an undocumented keyless
  // endpoint, is worse than refusing to start.
  const instanceCountWasExplicit =
    (overrides.env ?? (process.env as never))?.MARKETDATA_INSTANCE_COUNT !== undefined
  const quota = checkQuotaSafety(config, cache.isShared, instanceCountWasExplicit)
  for (const warning of quota.warnings) logger.warn(warning)
  const fatal = [...quota.errors, ...checkProviderCredentials(config)]
  if (fatal.length > 0) {
    const bullets = fatal.map((issue) => `  - ${issue}`).join('\n')
    throw new Error(`Unsafe market-data configuration:\n${bullets}`)
  }

  async function health(): Promise<MarketDataHealth> {
    drainCapacityWarnings()
    const providerIds = new Set<string>([
      ...breakers.knownProviders(),
      ...Object.values(config.chains).flat(),
    ])
    providerIds.delete('fixture')

    const providers: ProviderHealth[] = []
    for (const providerId of providerIds) {
      const limit = config.limits[providerId]?.requestsPerDay ?? null
      providers.push({
        providerId,
        lastLatencyMs: lastLatencyMs.get(providerId) ?? null,
        ...breakers.snapshot(providerId),
        budget: await budget.status(providerId, limit),
        rateLimit: {
          rpm: config.limits[providerId]?.requestsPerMinute ?? null,
          tokensAvailable: bucketFor(providerId).available(),
        },
      })
    }

    const categories: CategoryHealth[] = (
      Object.keys(config.chains) as DataCategory[]
    ).map((category) => {
      const chain = config.chains[category]
      const live = chain.filter((id) => id !== 'fixture')
      const available = live.filter((id) => breakers.allows(id))
      const policy = policyFor(category)
      const bestAvailable = available.length
        ? 'live'
        : policy.fallback.allowStale
          ? 'stale'
          : fixtureAllowed(policy.fallback, config.production)
            ? 'fixture'
            : 'unavailable'
      return {
        category,
        bestAvailable,
        liveProvidersConfigured: live.length,
        liveProvidersAvailable: available.length,
      }
    })

    return summarizeHealth(providers, categories, clock.now().toISOString(), {
      // Says plainly whether the budget figures above are global or local to
      // this process. Without it, an instance-local count reads as a global
      // quota position, which is exactly the wrong conclusion to draw.
      sharedBudget: cache.isShared,
      ...(metricsRegistry
        ? {
            metrics: {
              scope: 'instance' as const,
              seriesCount: metricsRegistry.snapshot().length,
              droppedWrites: metricsRegistry.droppedWrites(),
            },
          }
        : {}),
    })
  }

  return {
    config,
    ...(metricsRegistry ? { metricsRegistry } : {}),
    registry,
    cache,
    store,
    clock,
    random,
    logger,
    metrics,
    singleFlight,
    breakers,
    budget,
    runAttempt,
    newCorrelationId: () => newCorrelationId(random),
    health,
  }
}
