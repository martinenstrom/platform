/**
 * One provider attempt, with every operational guarantee composed in order.
 *
 * Order matters, and the rule is **cheapest and most protective first**:
 *
 *   breaker → budget → limiter → timeout → call
 *
 *  - A tripped breaker must not spend a budget unit.
 *  - An exhausted budget must not consume a rate token or wait for one.
 *  - Only once all three permit the call do we start a clock on it.
 *
 * Retries live *inside* this function and re-enter budget and limiter on every
 * attempt, because a retry is a request and the provider counts it as one
 * (§19). The breaker is evaluated once per provider rather than per retry, so
 * a single bad minute does not trip it three times as fast.
 */

import type { Clock } from '~/domain/shared/clock'
import type { Random } from '~/domain/shared/random'
import type { CorrelationId } from '~/domain/shared/correlation'
import type { DomainError, ErrorCode } from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import {
  BREAKER_STATE_VALUE,
  METRIC,
  type Metrics,
} from '~/application/marketData/metrics'
import type { DailyBudget } from './resilience/budget'
import type { CircuitBreakerRegistry } from './resilience/circuitBreaker'
import type { TokenBucket } from './resilience/tokenBucket'
import { backoffDelayMs, isRetryable, sleep, type RetryOptions } from './resilience/retry'
import { TimeoutError, withTimeout } from './resilience/timeout'

export interface AttemptDeps {
  clock: Clock
  random: Random
  metrics: Metrics
  breakers: CircuitBreakerRegistry
  budget: DailyBudget
  bucketFor(providerId: string): TokenBucket
  budgetLimitFor(providerId: string): number | null
  timeoutMsFor(providerId: string, capability: string): number
  retry: RetryOptions
}

export type AttemptOutcome<T> =
  | { kind: 'success'; value: T; latencyMs: number; attempts: number }
  | { kind: 'skipped'; reason: SkipReason; error: DomainError }
  | { kind: 'failed'; error: DomainError; attempts: number }

export type SkipReason = 'circuit-open' | 'budget-exhausted' | 'rate-limited'

/** Skip reasons map onto the domain's error vocabulary, not their own. */
const SKIP_ERROR_CODE: Record<SkipReason, ErrorCode> = {
  'circuit-open': 'circuit-open',
  'budget-exhausted': 'budget-exhausted',
  'rate-limited': 'rate-limit',
}

function toDomainError(error: unknown, providerId: string): DomainError {
  if (error instanceof TimeoutError) {
    return { code: 'timeout', message: error.message, providerId, retryable: true }
  }
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? (error.code as ErrorCode)
      : 'unknown'
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    providerId,
    retryable: isRetryable(code),
  }
}

/**
 * Publishes the latest known budget state for a provider.
 *
 * These gauges are **instance-local unless the cache store is shared**. They
 * describe what this process has spent, which is not the global quota position
 * in a multi-instance deployment — `MarketDataHealth.sharedBudget` says which
 * of the two you are looking at.
 */
async function recordBudget(
  deps: AttemptDeps,
  providerId: string,
  limit: number | null,
): Promise<void> {
  if (limit === null) return
  const status = await deps.budget.status(providerId, limit)
  deps.metrics.gauge(METRIC.budgetUsed, status.used, { provider: providerId })
  if (status.remaining !== null) {
    deps.metrics.gauge(METRIC.budgetRemaining, status.remaining, { provider: providerId })
  }
}

function skip(providerId: string, reason: SkipReason): AttemptOutcome<never> {
  const message: Record<SkipReason, string> = {
    'circuit-open': `Provider ${providerId} is circuit-open`,
    'budget-exhausted': `Provider ${providerId} has exhausted its daily budget`,
    'rate-limited': `Provider ${providerId} has no rate-limit token available`,
  }
  return {
    kind: 'skipped',
    reason,
    error: {
      code: SKIP_ERROR_CODE[reason],
      message: message[reason],
      providerId,
      retryable: true,
    },
  }
}

/**
 * Runs `call` against one provider under the full pipeline.
 *
 * Never throws: every failure mode is returned as an `AttemptOutcome`, so the
 * resolver's control flow stays explicit rather than exception-driven.
 */
export async function attemptProvider<T>(
  deps: AttemptDeps,
  args: {
    providerId: string
    capability: string
    correlationId: CorrelationId
    signal?: AbortSignal
    call: (ctx: FetchContext) => Promise<T>
  },
): Promise<AttemptOutcome<T>> {
  const { providerId, capability } = args
  const labels = { provider: providerId, capability }

  // 1 — breaker. Checked once, before anything is spent.
  const breakerState = deps.breakers.state(providerId)
  // Emitted on every attempt so the gauge reflects the latest known state
  // rather than only changing on a transition.
  deps.metrics.gauge(METRIC.breakerState, BREAKER_STATE_VALUE[breakerState], {
    provider: providerId,
  })
  if (breakerState === 'open') {
    deps.metrics.increment(METRIC.providerSkipped, { ...labels, reason: 'circuit-open' })
    return skip(providerId, 'circuit-open')
  }

  /*
   * A half-open probe is ONE request.
   *
   * Retrying a probe cannot improve the answer to "are you back yet?", but it
   * does triple the cost of being down. That matters whenever the refresh
   * interval exceeds the breaker cooldown — with a 10-minute crypto TTL and a
   * 60-second cooldown, every refresh finds the breaker half-open, so
   * retrying probes would spend 3 requests per window (432/day) instead of 1
   * (144/day) throughout an outage.
   */
  const maxAttempts = breakerState === 'half-open' ? 1 : deps.retry.maxAttempts

  const budgetLimit = deps.budgetLimitFor(providerId)
  const bucket = deps.bucketFor(providerId)
  const timeoutMs = deps.timeoutMsFor(providerId, capability)
  let lastError: DomainError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 2 — budget, reserved BEFORE the call so a crash costs a unit rather
    //     than allowing an overdraft. Re-entered on every retry.
    if (!(await deps.budget.reserve(providerId, budgetLimit))) {
      await recordBudget(deps, providerId, budgetLimit)
      deps.metrics.increment(METRIC.providerSkipped, {
        ...labels,
        reason: 'budget-exhausted',
      })
      return lastError
        ? { kind: 'failed', error: lastError, attempts: attempt - 1 }
        : skip(providerId, 'budget-exhausted')
    }

    await recordBudget(deps, providerId, budgetLimit)

    // 3 — rate limit. Non-blocking: an exhausted bucket skips the provider
    //     rather than queueing, because stale-now beats fresh-in-nine-seconds.
    if (!bucket.tryAcquire()) {
      deps.metrics.increment(METRIC.providerSkipped, {
        ...labels,
        reason: 'rate-limited',
      })
      return lastError
        ? { kind: 'failed', error: lastError, attempts: attempt - 1 }
        : skip(providerId, 'rate-limited')
    }

    // 4 — timeout wraps the call itself.
    const startedAt = deps.clock.epochMs()
    const controller = new AbortController()
    if (args.signal) {
      if (args.signal.aborted) controller.abort()
      else args.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    try {
      const value = await withTimeout(timeoutMs, controller, (signal) =>
        args.call({ signal, clock: deps.clock, correlationId: args.correlationId }),
      )
      const latencyMs = deps.clock.epochMs() - startedAt
      deps.breakers.onSuccess(providerId)
      deps.metrics.observe(METRIC.providerLatency, latencyMs, {
        ...labels,
        outcome: 'success',
      })
      deps.metrics.increment(METRIC.providerRequest, { ...labels, outcome: 'success' })
      return { kind: 'success', value, latencyMs, attempts: attempt }
    } catch (error) {
      const domainError = toDomainError(error, providerId)
      lastError = domainError
      const latencyMs = deps.clock.epochMs() - startedAt

      deps.metrics.observe(METRIC.providerLatency, latencyMs, {
        ...labels,
        outcome: 'failure',
      })
      deps.metrics.increment(METRIC.providerRequest, { ...labels, outcome: 'failure' })
      if (domainError.code === 'timeout') {
        deps.metrics.increment(METRIC.providerTimeout, labels)
      }

      // A 429 gets its own, lower ceiling: the provider is healthy and we are
      // simply over quota, so extra attempts only spend more budget.
      const ceiling =
        domainError.code === 'rate-limit'
          ? Math.min(deps.retry.maxAttemptsRateLimited, maxAttempts)
          : maxAttempts
      const canRetry = domainError.retryable && attempt < ceiling
      if (!canRetry) break

      deps.metrics.increment(METRIC.providerRetry, { ...labels, attempt })
      // Retry-After is the provider telling us exactly when to come back; it
      // always beats our computed backoff.
      const delay =
        domainError.retryAfterMs ?? backoffDelayMs(attempt, deps.retry, deps.random)
      await sleep(delay)
    }
  }

  const error = lastError ?? {
    code: 'unknown' as ErrorCode,
    message: `Provider ${providerId} produced no result`,
    providerId,
    retryable: false,
  }
  // The breaker sees one failure per provider, not one per retry.
  if (deps.breakers.onFailure(providerId, error.code)) {
    deps.metrics.increment(METRIC.breakerOpened, { provider: providerId })
  }
  return { kind: 'failed', error, attempts: maxAttempts }
}
