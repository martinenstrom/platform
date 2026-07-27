/**
 * Provider registry and the single resolution path.
 *
 * This is the one place chain ordering, staleness and fallback compose. In
 * Phase A it implements chain ordering, cache read/write, staleness and the
 * fallback policy. Rate limiting, circuit breaking, retry and timeout land in
 * Phase 1 *behind this same signature* — callers will not change.
 *
 * Resolution order, per the architecture doc:
 *   fresh cache → live providers in order → stale cache → fixture → error
 *
 * Note that the fixture provider is deliberately NOT tried as part of the live
 * chain. An explicitly stale real value beats an invented one, so the stale
 * check runs first even though `fixture` is configured at the chain's tail.
 */

import type { Logger as SharedLogger } from '~/application/shared/logger'
import type { ErrorCode, Provenance, StaleReason } from '~/domain/market'
import type { Capability, DataCategory, ProviderRegistration } from './ports'

/** Provider id reserved for the fixture adapter. */
/* -------------------------------------------------------------------- ports */

export interface CachedValue<T> {
  value: T
  provenance: Provenance
  expiresAtMs: number
}

/**
 * Cache port. Infrastructure supplies the implementation; the application
 * layer never learns whether it is memory, disk or KV.
 */
export interface ResolutionCache {
  get<T>(key: string): Promise<CachedValue<T> | null>
  set<T>(key: string, value: T, provenance: Provenance, ttlMs: number): Promise<void>
}

export type ResolutionOutcome =
  | 'cache-hit'
  | 'provider-success'
  | 'provider-failure'
  | 'provider-skipped'
  | 'stale-served'
  | 'fixture-served'
  | 'error'

export interface ResolutionLog {
  /** Threads this record onto the request chain it belongs to. */
  correlationId: string
  category: DataCategory
  capability: Capability
  cacheKey: string
  providerId: string | null
  outcome: ResolutionOutcome
  latencyMs: number
  quality?: string
  staleReason?: StaleReason
  errorCode?: ErrorCode
  /** Free-text reason for a skip. Never contains a key or a response body. */
  note?: string
}

/** The shared base plus this context's structured resolution event. */
export interface Logger extends SharedLogger {
  resolution(entry: ResolutionLog): void
}

export const noopLogger: Logger = { resolution: () => {}, warn: () => {} }

/* ----------------------------------------------------------------- registry */

export interface ProviderRegistry {
  /** All providers serving a capability, in the configured chain order. */
  chainFor(capability: Capability, chain: readonly string[]): ProviderRegistration[]
  get(providerId: string): ProviderRegistration | undefined
  has(providerId: string, capability: Capability): boolean
}

/**
 * Builds a registry from explicit registrations. Registration is explicit
 * rather than inferred from method presence, so a half-written adapter cannot
 * silently advertise a capability it does not serve.
 */
export function createProviderRegistry(
  registrations: readonly ProviderRegistration[],
): ProviderRegistry {
  const byId = new Map<string, ProviderRegistration>()
  for (const registration of registrations) {
    if (byId.has(registration.provider.id)) {
      throw new Error(`Duplicate provider registration: ${registration.provider.id}`)
    }
    byId.set(registration.provider.id, registration)
  }

  return {
    get: (providerId) => byId.get(providerId),
    has: (providerId, capability) =>
      byId.get(providerId)?.capabilities.has(capability) ?? false,
    chainFor(capability, chain) {
      const resolved: ProviderRegistration[] = []
      for (const id of chain) {
        const registration = byId.get(id)
        // An unconfigured or non-capable provider is skipped, not fatal: a
        // missing API key legitimately drops a provider from its chain.
        if (registration?.capabilities.has(capability)) resolved.push(registration)
      }
      return resolved
    },
  }
}

/*
 * Resolution itself lives in `./resolution.ts`, which composes this registry
 * with the cache, the attempt pipeline and the fallback policy. Re-exported
 * here so existing call sites keep one import.
 */
export {
  resolve,
  FIXTURE_PROVIDER_ID,
  type ProviderAttempt,
  type ResolveDeps,
  type ResolveRequest,
  type RunAttempt,
} from './resolution'
