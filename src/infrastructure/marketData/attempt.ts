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
import { METRIC, type Metrics } from '~/application/marketData/metrics'
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
  if (!deps.breakers.allows(providerId)) {
    deps.metrics.increment(METRIC.providerSkipped, { ...labels, reason: 'circuit-open' })
    return skip(providerId, 'circuit-open')
  }

  const budgetLimit = deps.budgetLimitFor(providerId)
  const bucket = deps.bucketFor(providerId)
  const timeoutMs = deps.timeoutMsFor(providerId, capability)
  let lastError: DomainError | null = null

  for (let attempt = 1; attempt <= deps.retry.maxAttempts; attempt++) {
    // 2 — budget, reserved BEFORE the call so a crash costs a unit rather
    //     than allowing an overdraft. Re-entered on every retry.
    if (!(await deps.budget.reserve(providerId, budgetLimit))) {
      deps.metrics.increment(METRIC.providerSkipped, {
        ...labels,
        reason: 'budget-exhausted',
      })
      return lastError
        ? { kind: 'failed', error: lastError, attempts: attempt - 1 }
        : skip(providerId, 'budget-exhausted')
    }

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

      const canRetry = domainError.retryable && attempt < deps.retry.maxAttempts
      if (!canRetry) break

      deps.metrics.increment(METRIC.providerRetry, { ...labels, attempt })
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
  return { kind: 'failed', error, attempts: deps.retry.maxAttempts }
}
