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
import { noopMetrics, type Metrics } from '~/application/marketData/metrics'
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
import {
  checkCacheSharing,
  checkLiveReadiness,
  loadMarketDataConfig,
  type MarketDataConfig,
} from './config'
import type { DataCategory } from '~/application/marketData/ports'

export interface Container {
  config: MarketDataConfig
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
  const metrics = overrides.metrics ?? noopMetrics
  const config =
    overrides.config ?? loadMarketDataConfig(overrides.env ?? (process.env as never))

  // No credential values are passed: `config` never holds one, and the
  // logger's allowlist means it could not emit one anyway.
  const logger = overrides.logger ?? createLogger()

  const store = overrides.store ?? new MemoryCacheStore(clock)
  const cache = new TieredCache(store, overrides.persistentStore)
  const registry = createProviderRegistry(overrides.providers ?? [])
  const singleFlight = new SingleFlight()
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

  const runAttempt: RunAttempt = (args) => attemptProvider(attemptDeps, args)

  for (const warning of config.warnings) logger.warn(warning)
  for (const issue of checkLiveReadiness(config)) {
    logger.warn(issue.message, { category: issue.category })
  }
  const sharingWarning = checkCacheSharing(config, cache.isShared)
  if (sharingWarning) logger.warn(sharingWarning)

  async function health(): Promise<MarketDataHealth> {
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

    return summarizeHealth(providers, categories, clock.now().toISOString())
  }

  return {
    config,
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
