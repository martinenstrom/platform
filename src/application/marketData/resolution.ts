/**
 * The resolution pipeline — where cache, single-flight, the provider chain,
 * staleness and fallback compose into one `Envelope`.
 *
 * Lifecycle:
 *
 *   singleFlight(key)                      one execution per key, N callers share it
 *     1. fresh cache hit                 → ok
 *        stale + SWR + policy allows     → stale NOW, refresh in background
 *     2. live providers, in chain order  → ok        (attempt pipeline per provider)
 *     3. stale cache within maxStaleMs   → stale + reason
 *     4. fixture, if policy permits      → fixture   (never cached)
 *     5. otherwise                       → error     (with lastGood when known)
 *
 * Two invariants worth stating outright:
 *
 *  - **Fixtures are never written to the cache.** A fixture value can
 *    therefore never be resurrected later and served as stale *real* data.
 *  - **An expired entry is always `stale`, never `ok`** — including while a
 *    background refresh is running. Stale-while-revalidate is about latency,
 *    not about pretending.
 */

import type { Clock } from '~/domain/shared/clock'
import type { CorrelationId } from '~/domain/shared/correlation'
import type {
  DomainError,
  Envelope,
  ErrorCode,
  Provenance,
  StaleReason,
} from '~/domain/market'
import { fixtureAllowed, policyFor, ttlFor } from './policy'
import type {
  AnyProvider,
  Capability,
  DataCategory,
  FetchContext,
  PortByCapability,
} from './ports'
import { METRIC, type Metrics } from './metrics'
import type {
  CachedValue,
  Logger,
  ProviderRegistry,
  ResolutionCache,
  ResolutionOutcome,
} from './providerRegistry'

export const FIXTURE_PROVIDER_ID = 'fixture'

/** Result of running one provider through the operational pipeline. */
export type ProviderAttempt<T> =
  | { kind: 'success'; value: T; latencyMs: number; attempts: number }
  | { kind: 'skipped'; reason: string; error: DomainError }
  | { kind: 'failed'; error: DomainError; attempts: number }

/**
 * Infrastructure supplies this. Keeping it a function means the application
 * layer composes the pipeline without importing any of its parts.
 */
export type RunAttempt = <T>(args: {
  providerId: string
  capability: Capability
  correlationId: CorrelationId
  signal?: AbortSignal
  call: (ctx: FetchContext) => Promise<T>
}) => Promise<ProviderAttempt<T>>

export interface ResolveDeps {
  registry: ProviderRegistry
  clock: Clock
  production: boolean
  cache?: ResolutionCache
  logger: Logger
  metrics: Metrics
  runAttempt: RunAttempt
  /** Shares one execution per key across concurrent callers. */
  singleFlight: <T>(key: string, execute: () => Promise<T>) => Promise<T>
  correlationId: CorrelationId
}

/**
 * A resolution request, generic over the capability it asks for.
 *
 * `C` is inferred from the `capability` field, so `attempt` receives the port
 * that serves it — `QuoteProvider` for `'quotes'`, `PolicyRateProvider` for
 * `'policy-rates'` — instead of the `AnyProvider` union.
 *
 * This is what removes the `as never` casts that used to sit at every call
 * site. They were not cosmetic: a cast is the compiler being told to stop
 * checking, so an adapter registered under the wrong capability, or a call
 * site naming the wrong port, typechecked cleanly and failed at runtime.
 * `PortByCapability` already described this mapping and nothing consulted it.
 */
export interface ResolveRequest<T, C extends Capability = Capability> {
  category: DataCategory
  capability: C
  cacheKey: string
  chain: readonly string[]
  marketOpen: boolean
  attempt: (
    provider: PortByCapability[C],
    ctx: FetchContext,
  ) => Promise<{ data: T; provenance: Provenance }>
  signal?: AbortSignal
}

/**
 * The ONE place the provider union is narrowed to a capability port.
 *
 * The registry stores providers as `AnyProvider` because it routes on
 * capability, not on type. Every call site used to repeat this narrowing as an
 * inline `as never`; now it happens once, here, guarded by the registry's own
 * invariant that a provider is only ever selected for a capability it declared.
 */
function portFor<C extends Capability>(provider: AnyProvider): PortByCapability[C] {
  return provider as PortByCapability[C]
}

/** Recomputes `ageMs` against the current clock — a cached age is meaningless. */
function refreshAge(provenance: Provenance, nowMs: number): Provenance {
  const asOfMs = new Date(provenance.asOf).getTime()
  return { ...provenance, ageMs: Math.max(0, nowMs - asOfMs) }
}

function staleReasonFor(code: ErrorCode | null): StaleReason {
  switch (code) {
    case null:
      return 'no-fresh-source'
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

export async function resolve<T, C extends Capability = Capability>(
  deps: ResolveDeps,
  request: ResolveRequest<T, C>,
): Promise<Envelope<T>> {
  return deps.singleFlight(request.cacheKey, () => resolveUncoordinated(deps, request))
}

async function resolveUncoordinated<T, C extends Capability>(
  deps: ResolveDeps,
  request: ResolveRequest<T, C>,
): Promise<Envelope<T>> {
  const policy = policyFor(request.category)
  const ttlMs = ttlFor(request.category, request.marketOpen)
  const startedAt = deps.clock.epochMs()
  const labels = { category: request.category, capability: request.capability }

  const log = (
    outcome: ResolutionOutcome,
    extra: {
      providerId?: string | null
      quality?: string
      staleReason?: StaleReason
      errorCode?: ErrorCode
      note?: string
    } = {},
  ) =>
    deps.logger.resolution({
      correlationId: deps.correlationId,
      category: request.category,
      capability: request.capability,
      cacheKey: request.cacheKey,
      latencyMs: deps.clock.epochMs() - startedAt,
      providerId: extra.providerId ?? null,
      outcome,
      ...(extra.quality === undefined ? {} : { quality: extra.quality }),
      ...(extra.staleReason === undefined ? {} : { staleReason: extra.staleReason }),
      ...(extra.errorCode === undefined ? {} : { errorCode: extra.errorCode }),
      ...(extra.note === undefined ? {} : { note: extra.note }),
    })

  const cached: CachedValue<T> | null =
    (await deps.cache?.get<T>(request.cacheKey)) ?? null
  const nowMs = deps.clock.epochMs()

  /* 1 — cache ------------------------------------------------------------- */
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      deps.metrics.increment(METRIC.cacheHit, labels)
      // Counted here too, so `resolution` totals every completed resolution
      // and a hit ratio can be derived against it.
      deps.metrics.increment(METRIC.resolution, { ...labels, state: 'ok' })
      log('cache-hit', {
        providerId: cached.provenance.source.providerId,
        quality: cached.provenance.quality,
      })
      return {
        state: 'ok',
        data: cached.value,
        provenance: refreshAge(cached.provenance, nowMs),
      }
    }

    const provenance = refreshAge(cached.provenance, nowMs)
    const withinMaxStale = provenance.ageMs <= policy.fallback.maxStaleMs
    if (policy.staleWhileRevalidate && policy.fallback.allowStale && withinMaxStale) {
      // Serve now, refresh behind. The background pass goes through the same
      // single-flight key, so repeated loads cannot stack refreshes.
      deps.metrics.increment(METRIC.cacheStaleHit, labels)
      deps.metrics.increment(METRIC.cacheRevalidate, labels)
      deps.metrics.increment(METRIC.resolution, { ...labels, state: 'stale' })
      void revalidate(deps, request, ttlMs)
      log('stale-served', {
        providerId: provenance.source.providerId,
        quality: provenance.quality,
        staleReason: 'no-fresh-source',
        note: 'stale-while-revalidate',
      })
      return {
        state: 'stale',
        data: cached.value,
        provenance,
        staleReason: 'no-fresh-source',
      }
    }
  }

  deps.metrics.increment(METRIC.cacheMiss, labels)

  /* 2 — live providers ----------------------------------------------------- */
  const chain = deps.registry.chainFor(request.capability, request.chain)
  const live = chain.filter((r) => r.provider.id !== FIXTURE_PROVIDER_ID)
  const fixture = chain.find((r) => r.provider.id === FIXTURE_PROVIDER_ID)

  let lastError: DomainError | null = null

  for (const registration of live) {
    const outcome = await deps.runAttempt<{ data: T; provenance: Provenance }>({
      providerId: registration.provider.id,
      capability: request.capability,
      correlationId: deps.correlationId,
      ...(request.signal ? { signal: request.signal } : {}),
      call: (ctx) => request.attempt(portFor(registration.provider), ctx),
    })

    if (outcome.kind === 'success') {
      await deps.cache?.set(
        request.cacheKey,
        outcome.value.data,
        outcome.value.provenance,
        ttlMs,
      )
      deps.metrics.increment(METRIC.resolution, { ...labels, state: 'ok' })
      log('provider-success', {
        providerId: registration.provider.id,
        quality: outcome.value.provenance.quality,
      })
      return {
        state: 'ok',
        data: outcome.value.data,
        provenance: refreshAge(outcome.value.provenance, deps.clock.epochMs()),
      }
    }

    lastError = outcome.error
    log(outcome.kind === 'skipped' ? 'provider-skipped' : 'provider-failure', {
      providerId: registration.provider.id,
      errorCode: outcome.error.code,
      ...(outcome.kind === 'skipped' ? { note: outcome.reason } : {}),
    })
  }

  /* 3 — stale cache, ahead of any fixture ---------------------------------- */
  if (cached && policy.fallback.allowStale) {
    const provenance = refreshAge(cached.provenance, deps.clock.epochMs())
    if (provenance.ageMs <= policy.fallback.maxStaleMs) {
      const staleReason = staleReasonFor(lastError?.code ?? null)
      deps.metrics.increment(METRIC.cacheStaleHit, labels)
      deps.metrics.increment(METRIC.resolution, { ...labels, state: 'stale' })
      log('stale-served', {
        providerId: provenance.source.providerId,
        quality: provenance.quality,
        staleReason,
      })
      return { state: 'stale', data: cached.value, provenance, staleReason }
    }
  }

  /* 4 — fixture, only where policy permits it ------------------------------ */
  if (fixture) {
    if (fixtureAllowed(policy.fallback, deps.production)) {
      const outcome = await deps.runAttempt<{ data: T; provenance: Provenance }>({
        providerId: fixture.provider.id,
        capability: request.capability,
        correlationId: deps.correlationId,
        ...(request.signal ? { signal: request.signal } : {}),
        call: (ctx) => request.attempt(portFor(fixture.provider), ctx),
      })
      if (outcome.kind === 'success') {
        // Deliberately NOT cached: a fixture must never be resurrected later
        // and served as stale real data.
        deps.metrics.increment(METRIC.resolution, { ...labels, state: 'fixture' })
        log('fixture-served', {
          providerId: fixture.provider.id,
          quality: outcome.value.provenance.quality,
        })
        return {
          state: 'fixture',
          data: outcome.value.data,
          provenance: refreshAge(outcome.value.provenance, deps.clock.epochMs()),
          reason:
            lastError === null
              ? 'no live provider configured for this category'
              : `live providers unavailable: ${lastError.code}`,
        }
      }
      lastError = outcome.error
    } else {
      deps.metrics.increment(METRIC.resolution, { ...labels, state: 'error' })
      log('provider-skipped', {
        providerId: FIXTURE_PROVIDER_ID,
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
  deps.metrics.increment(METRIC.resolution, { ...labels, state: 'error' })
  log('error', { providerId: error.providerId, errorCode: error.code })
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

/**
 * Background refresh for stale-while-revalidate.
 *
 * Failures update health and logs but never reach the caller, who already has
 * a value. Uses a distinct single-flight key so it cannot deadlock against the
 * foreground resolution that scheduled it, while still being deduplicated
 * against other background refreshes for the same entry.
 */
async function revalidate<T, C extends Capability>(
  deps: ResolveDeps,
  request: ResolveRequest<T, C>,
  ttlMs: number,
): Promise<void> {
  const key = `revalidate:${request.cacheKey}`
  try {
    await deps.singleFlight(key, async () => {
      const chain = deps.registry
        .chainFor(request.capability, request.chain)
        .filter((r) => r.provider.id !== FIXTURE_PROVIDER_ID)

      for (const registration of chain) {
        const outcome = await deps.runAttempt<{ data: T; provenance: Provenance }>({
          providerId: registration.provider.id,
          capability: request.capability,
          correlationId: deps.correlationId,
          call: (ctx) => request.attempt(portFor(registration.provider), ctx),
        })
        if (outcome.kind === 'success') {
          await deps.cache?.set(
            request.cacheKey,
            outcome.value.data,
            outcome.value.provenance,
            ttlMs,
          )
          return
        }
      }
    })
  } catch {
    // A background refresh that fails leaves the stale value in place, which
    // is exactly the intended behaviour.
  }
}
