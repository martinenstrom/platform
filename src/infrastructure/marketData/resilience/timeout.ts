/**
 * Mapping a per-attempt deadline onto this pipeline's error vocabulary.
 *
 * The deadline itself — `withTimeout` and `TimeoutError` — moved to
 * `~/application/shared/timeout` when the analysis pipeline needed the same
 * wall-clock-with-cancellation semantics. Measured as identical, so extracted
 * and used by both unchanged.
 *
 * What stays here is the part that is **not** shared: turning an expiry into a
 * market-data `DomainError`. The other pipeline has a different error
 * vocabulary entirely, and a shared primitive that knew about `DomainError`
 * would be generalising the vocabulary rather than the semantics.
 */

import type { DomainError } from '~/domain/market'

export { TimeoutError, withTimeout } from '~/application/shared/timeout'

export function timeoutDomainError(providerId: string, timeoutMs: number): DomainError {
  return {
    code: 'timeout',
    message: `Request exceeded its ${timeoutMs}ms deadline`,
    providerId,
    retryable: true,
  }
}
