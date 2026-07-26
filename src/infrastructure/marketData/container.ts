/**
 * Composition root for the market-data layer.
 *
 * The one place concrete providers, the cache store, the clock and the logger
 * are bound to the application's ports. Nothing in `application/`,
 * `domain/` or `presentation/` names a concrete provider — swapping
 * Frankfurter for Twelve Data is an environment change, and swapping either
 * for a stub is a constructor argument.
 *
 * Deliberately hand-rolled: a typed factory that can be read in one sitting
 * beats a DI framework this stack does not need.
 */

import {
  createProviderRegistry,
  noopLogger,
  type Logger,
  type ProviderRegistry,
  type ResolutionCache,
} from '~/application/marketData/providerRegistry'
import type { ProviderRegistration } from '~/application/marketData/ports'
import { systemClock, type Clock } from '~/domain/shared/clock'
import type { Provenance } from '~/domain/market'
import { MemoryCacheStore, type CacheStore } from './cache/store'
import {
  checkCacheSharing,
  checkLiveReadiness,
  loadMarketDataConfig,
  type MarketDataConfig,
} from './config'

export interface Container {
  config: MarketDataConfig
  registry: ProviderRegistry
  cache: ResolutionCache
  store: CacheStore
  clock: Clock
  logger: Logger
}

export interface ContainerOverrides {
  env?: Record<string, string | undefined>
  config?: MarketDataConfig
  /** Providers to register. Tests pass stubs; the app passes real adapters. */
  providers?: readonly ProviderRegistration[]
  store?: CacheStore
  clock?: Clock
  logger?: Logger
}

/**
 * Adapts a `CacheStore` to the application's `ResolutionCache` port. The
 * application layer stores provenance alongside the value but must not know
 * the store's entry shape, so the two are wrapped together here.
 */
function toResolutionCache(store: CacheStore): ResolutionCache {
  interface Wrapped<T> {
    value: T
    provenance: Provenance
  }
  return {
    async get<T>(key: string) {
      const entry = await store.get<Wrapped<T>>(key)
      if (!entry) return null
      return {
        value: entry.value.value,
        provenance: entry.value.provenance,
        expiresAtMs: entry.expiresAtMs,
      }
    },
    async set<T>(key: string, value: T, provenance: Provenance, ttlMs: number) {
      await store.set<Wrapped<T>>(key, { value, provenance }, ttlMs)
    },
  }
}

/**
 * Builds a container. Called once per server process in production, and
 * freely in tests — with a `FakeClock`, stub providers and a fresh memory
 * store, it needs no environment and performs no I/O.
 */
export function createContainer(overrides: ContainerOverrides = {}): Container {
  const clock = overrides.clock ?? systemClock
  const logger = overrides.logger ?? noopLogger
  const config =
    overrides.config ?? loadMarketDataConfig(overrides.env ?? (process.env as never))

  const store = overrides.store ?? new MemoryCacheStore(clock)
  const registry = createProviderRegistry(overrides.providers ?? [])

  for (const warning of config.warnings) logger.warn(warning)
  for (const issue of checkLiveReadiness(config)) {
    logger.warn(issue.message, { category: issue.category })
  }
  const sharingWarning = checkCacheSharing(config, store.isShared)
  if (sharingWarning) logger.warn(sharingWarning)

  return { config, registry, cache: toResolutionCache(store), store, clock, logger }
}
