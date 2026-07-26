/**
 * Bounded retry with exponential backoff and full jitter.
 *
 * Full jitter (`random() * cappedDelay`) rather than a fixed backoff, because
 * every instance that failed at the same moment would otherwise retry at the
 * same moment — the thundering herd the retry is supposed to avoid.
 *
 * Jitter comes from the injected `Random`, so a seeded test reproduces the
 * exact delay sequence.
 */

import type { Random } from '~/domain/shared/random'
import type { ErrorCode } from '~/domain/market'

export interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
}

/**
 * Which failures are worth repeating. A schema error will fail identically
 * every time, and an auth error will keep failing until a human intervenes —
 * retrying either just burns budget.
 */
export function isRetryable(code: ErrorCode): boolean {
  switch (code) {
    case 'network':
    case 'timeout':
    case 'rate-limit':
      return true
    case 'auth':
    case 'schema':
    case 'not-found':
    case 'budget-exhausted':
    case 'circuit-open':
    case 'no-provider-configured':
    case 'fallback-disallowed':
    case 'unknown':
      return false
  }
}

export function backoffDelayMs(
  attempt: number,
  options: RetryOptions,
  random: Random,
): number {
  const exponential = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** (attempt - 1),
  )
  return Math.floor(random.next() * exponential)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
