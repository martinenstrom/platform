/**
 * How many attempts this pipeline allows, and which failures deserve one.
 *
 * The backoff calculation itself moved to `~/application/shared/backoff` when
 * the analysis pipeline needed the same maths with the same injected
 * randomness — measured as identical, so extracted and used by both unchanged.
 *
 * What stays here is what is **not** shared: `isRetryable` is keyed to this
 * module's `ErrorCode`, and the attempt counts are keyed to what an attempt
 * costs against a daily provider quota. The other pipeline has a different
 * error vocabulary and counts attempts inside one run's deadline instead.
 */

import type { ErrorCode } from '~/domain/market'

export { backoffDelayMs, sleep } from '~/application/shared/backoff'

export interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  /**
   * Separate, lower ceiling for HTTP 429.
   *
   * A rate limit means the provider is fine and we are asking too often, so
   * hammering it is both futile and expensive: every retry is a real external
   * request and consumes the daily budget. One retry, honouring Retry-After,
   * is the most that can help.
   */
  maxAttemptsRateLimited: number
}

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  maxAttemptsRateLimited: 2,
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
