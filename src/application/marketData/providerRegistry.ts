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

import type { Clock } from '~/domain/shared/clock'
import {
  type DomainError,
  type Envelope,
  type ErrorCode,
  type Provenance,
  type StaleReason,
} from '~/domain/market'
import { fixtureAllowed, policyFor, ttlFor } from './policy'
import type {
  AnyProvider,
  Capability,
  DataCategory,
  FetchContext,
  ProviderRegistration,
} from './ports'

/** Provider id reserved for the fixture adapter. */
export const FIXTURE_PROVIDER_ID = 'fixture'

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

export interface Logger {
  resolution(entry: ResolutionLog): void
  warn(message: string, meta?: Record<string, unknown>): void
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

/* ---------------------------------------------------------------- resolution */

export interface ResolveDeps {
  registry: ProviderRegistry
  clock: Clock
  /**
   * True when the deployment must not show fabricated data — derived from
   * `MARKETDATA_MODE=live`, not from `NODE_ENV`.
   */
  production: boolean
  cache?: ResolutionCache
  logger?: Logger
}

export interface ResolveRequest<T> {
  category: DataCategory
  capability: Capability
  /** Normalized request identity. Never a component name. */
  cacheKey: string
  /** Configured provider ids, in order. May include `fixture` at the tail. */
  chain: readonly string[]
  marketOpen: boolean
  /** Calls one provider. The only place a provider-specific method is invoked. */
  attempt: (
    provider: AnyProvider,
    ctx: FetchContext,
  ) => Promise<{ data: T; provenance: Provenance }>
  signal?: AbortSignal
}

function toDomainError(error: unknown, providerId: string | null): DomainError {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return {
      code: error.code as ErrorCode,
      message: error.message,
      providerId,
      retryable: false,
    }
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    providerId,
    retryable: false,
  }
}

/** Recomputes `ageMs` against the current clock — a cached age is meaningless. */
function refreshAge(provenance: Provenance, nowMs: number): Provenance {
  const asOfMs = new Date(provenance.asOf).getTime()
  return { ...provenance, ageMs: Math.max(0, nowMs - asOfMs) }
}

export async function resolve<T>(
  deps: ResolveDeps,
  request: ResolveRequest<T>,
): Promise<Envelope<T>> {
  const logger = deps.logger ?? noopLogger
  const policy = policyFor(request.category)
  const ttlMs = ttlFor(request.category, request.marketOpen)
  const startedAt = deps.clock.epochMs()

  const log = (
    entry: Omit<ResolutionLog, 'category' | 'capability' | 'cacheKey' | 'latencyMs'>,
  ) =>
    logger.resolution({
      category: request.category,
      capability: request.capability,
      cacheKey: request.cacheKey,
      latencyMs: deps.clock.epochMs() - startedAt,
      ...entry,
    })

  /* 1 — fresh cache -------------------------------------------------------- */
  const cached = (await deps.cache?.get<T>(request.cacheKey)) ?? null
  if (cached && cached.expiresAtMs > deps.clock.epochMs()) {
    log({ providerId: cached.provenance.source.providerId, outcome: 'cache-hit' })
    return {
      state: 'ok',
      data: cached.value,
      provenance: refreshAge(cached.provenance, deps.clock.epochMs()),
    }
  }

  /* 2 — live providers, in chain order ------------------------------------- */
  const chain = deps.registry.chainFor(request.capability, request.chain)
  const live = chain.filter((r) => r.provider.id !== FIXTURE_PROVIDER_ID)
  const fixture = chain.find((r) => r.provider.id === FIXTURE_PROVIDER_ID)

  let lastError: DomainError | null = null
  const controller = new AbortController()
  if (request.signal) {
    request.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const ctx: FetchContext = { signal: controller.signal, clock: deps.clock }

  for (const registration of live) {
    try {
      const result = await request.attempt(registration.provider, ctx)
      await deps.cache?.set(request.cacheKey, result.data, result.provenance, ttlMs)
      log({
        providerId: registration.provider.id,
        outcome: 'provider-success',
        quality: result.provenance.quality,
      })
      return {
        state: 'ok',
        data: result.data,
        provenance: refreshAge(result.provenance, deps.clock.epochMs()),
      }
    } catch (error) {
      lastError = toDomainError(error, registration.provider.id)
      log({
        providerId: registration.provider.id,
        outcome: 'provider-failure',
        errorCode: lastError.code,
      })
    }
  }

  /* 3 — stale cache, before any fixture ------------------------------------ */
  if (cached && policy.fallback.allowStale) {
    const provenance = refreshAge(cached.provenance, deps.clock.epochMs())
    if (provenance.ageMs <= policy.fallback.maxStaleMs) {
      const staleReason: StaleReason =
        lastError === null ? 'no-fresh-source' : mapErrorToStaleReason(lastError.code)
      log({
        providerId: provenance.source.providerId,
        outcome: 'stale-served',
        quality: provenance.quality,
        staleReason,
      })
      return { state: 'stale', data: cached.value, provenance, staleReason }
    }
  }

  /* 4 — fixture, only if policy permits it here ---------------------------- */
  if (fixture) {
    if (fixtureAllowed(policy.fallback, deps.production)) {
      try {
        const result = await request.attempt(fixture.provider, ctx)
        log({
          providerId: fixture.provider.id,
          outcome: 'fixture-served',
          quality: result.provenance.quality,
        })
        return {
          state: 'fixture',
          data: result.data,
          provenance: refreshAge(result.provenance, deps.clock.epochMs()),
          reason:
            lastError === null
              ? 'no live provider configured for this category'
              : `live providers unavailable: ${lastError.code}`,
        }
      } catch (error) {
        lastError = toDomainError(error, fixture.provider.id)
      }
    } else {
      // The honest failure: a fixture exists, but showing it in production
      // would misrepresent invented data as market data.
      log({
        providerId: FIXTURE_PROVIDER_ID,
        outcome: 'provider-skipped',
        note: 'fixture not permitted in production for this category',
      })
      return {
        state: 'error',
        error: {
          code: 'fallback-disallowed',
          message:
            `No live or acceptably stale source for "${request.category}", ` +
            `and fixture data may not be shown in production.`,
          providerId: null,
          retryable: true,
        },
        ...(cached
          ? {
              lastGood: {
                data: cached.value,
                provenance: refreshAge(cached.provenance, deps.clock.epochMs()),
              },
            }
          : {}),
      }
    }
  }

  /* 5 — genuine error ------------------------------------------------------ */
  const error: DomainError = lastError ?? {
    code: live.length === 0 ? 'no-provider-configured' : 'unknown',
    message: `No provider produced a value for "${request.category}"`,
    providerId: null,
    retryable: true,
  }
  log({ providerId: error.providerId, outcome: 'error', errorCode: error.code })
  return {
    state: 'error',
    error,
    ...(cached
      ? {
          lastGood: {
            data: cached.value,
            provenance: refreshAge(cached.provenance, deps.clock.epochMs()),
          },
        }
      : {}),
  }
}

function mapErrorToStaleReason(code: ErrorCode): StaleReason {
  switch (code) {
    case 'rate-limit':
      return 'rate-limited'
    case 'budget-exhausted':
      return 'budget-exhausted'
    case 'circuit-open':
      return 'circuit-open'
    case 'timeout':
      return 'timeout'
    case 'network':
      return 'offline'
    default:
      return 'provider-error'
  }
}
