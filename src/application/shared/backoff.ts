/**
 * Exponential backoff with full jitter.
 *
 * Shared by the market-data resilience pipeline and the analysis execution
 * pipeline. The same maths and the same need for reproducibility, measured as
 * genuinely identical rather than assumed so because both retry.
 *
 * Full jitter (`random() * cappedDelay`) rather than a fixed backoff, because
 * every instance that failed at the same moment would otherwise retry at the
 * same moment — the thundering herd the retry is supposed to avoid.
 *
 * Jitter comes from the injected `Random`, so a seeded test reproduces the
 * exact delay sequence. That is the property that makes this worth sharing:
 * a pure function of (attempt, bounds, randomness) has nothing to diverge.
 *
 * **What is deliberately NOT here:** how many attempts are allowed, and which
 * failures are worth repeating. Both are keyed to a specific error vocabulary
 * and a specific idea of what an attempt costs, and the two pipelines differ
 * on both. Market data counts attempts against a daily provider quota; an
 * analysis run counts them inside one run's own deadline.
 */

import type { Random } from '~/domain/shared/random'

/**
 * The bounds this calculation needs, and nothing else.
 *
 * Narrower than either caller's own retry configuration on purpose: a shared
 * primitive that accepted `maxAttempts` would invite callers to believe it
 * decided how many attempts they get, which is exactly the policy each
 * pipeline owns for itself.
 */
export interface BackoffBounds {
  baseDelayMs: number
  maxDelayMs: number
}

/** `attempt` is 1 for the first retry delay. */
export function backoffDelayMs(
  attempt: number,
  bounds: BackoffBounds,
  random: Random,
): number {
  const exponential = Math.min(bounds.maxDelayMs, bounds.baseDelayMs * 2 ** (attempt - 1))
  return Math.floor(random.next() * exponential)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
