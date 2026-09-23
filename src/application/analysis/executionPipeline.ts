/**
 * Executing one contribution: attempts, deadline and retryability.
 *
 * Analysis-specific by ruling, not by accident. The market-data pipeline solves
 * the same *sounding* problems and two of its primitives were genuinely
 * identical and extracted — `withTimeout` and `backoffDelayMs`. The rest is
 * different in kind, and building a shared abstraction over it would be
 * generalising shared vocabulary rather than shared semantics.
 *
 * ## The deadline is per RUN, not per attempt
 *
 * This is the sharpest difference. Market data bounds each attempt: many small
 * frequent calls, where the useful question is "did this one call hang". An
 * analysis run is one long expensive piece of work with a budget the firm
 * authorised, and the useful question is "has this run spent its time" —
 * including everything it spent retrying.
 *
 * So attempts share one wall clock. Each gets whatever remains, and when
 * nothing remains there are no more attempts. A per-attempt deadline would let
 * three retries quietly consume three times the authorised time, which would
 * make the recorded budget a description of one attempt rather than of the run.
 *
 * ## A retry is an attempt, never a second run
 *
 * The rule both pipelines genuinely share, for the same reason: the record
 * would otherwise double-count work. `AgentRunRecord` carries one `attempt`
 * count on its failure, and this returns the count so the caller records **one**
 * run that took N attempts — never N runs.
 *
 * That matters more here than in market data. A run is an institutional act
 * with an identity, an assignment and a budget; a second run is the firm having
 * commissioned the work twice, which is a thing a person may legitimately do
 * and which the record must never invent on their behalf.
 *
 * ## No breaker and no rate limiter
 *
 * Ruled, and worth restating where the code would otherwise grow one. Runs are
 * infrequent, so a token bucket has nothing to smooth. And the analysis
 * analogue of a tripped breaker — an agent whose work keeps being declined —
 * is not an operational fact at all: every call succeeded, and what is wrong is
 * the quality of the work. That is an institutional judgement the rejection
 * vocabulary exists to surface to a person, and a breaker here would hide the
 * very signal it was built to collect.
 */

import type { Random } from '~/domain/shared/random'
import type { RunFailureCategory } from '~/domain/analysis'
import { backoffDelayMs, sleep as realSleep } from '~/application/shared/backoff'
import { TimeoutError, withTimeout } from '~/application/shared/timeout'

/**
 * Which failures are worth another attempt, keyed to the analysis vocabulary.
 *
 * Deliberately NOT market data's `isRetryable`, and one entry shows why the
 * two could not share an implementation even if the vocabularies were mapped.
 *
 * **`malformed-output` is retryable here and its market-data analogue is not.**
 * There, a schema error means the API and the parser disagree, so it will fail
 * identically every time and retrying only burns quota. Here, the producer is a
 * sampled model: the same prompt genuinely may parse on the next attempt, and
 * refusing to retry would discard a run over one bad sample.
 *
 * `schema-violation` stays non-retryable precisely because it is *not* sampling
 * noise — it means the provider answered against a contract it did not declare,
 * which is a configuration mismatch that will repeat.
 */
export function isRetryableFailure(category: RunFailureCategory): boolean {
  switch (category) {
    // Transient: the provider was unreachable, or did not answer in time.
    case 'provider-unavailable':
    case 'provider-timeout':
      return true
    // A sampled producer may simply produce something parseable next time.
    case 'malformed-output':
      return true
    /*
     * An error the provider chose to return will be returned again, and
     * returning the work to the queue would repeat it forever.
     */
    case 'provider-error':
    case 'schema-violation':
    // Spending more is the opposite of the remedy.
    case 'budget-exhausted':
    // All of these need a person or another part of the firm, not another call.
    case 'evidence-unavailable':
    case 'upstream-failed':
    case 'cancelled-by-organization':
    case 'revision-superseded':
    case 'internal-error':
      return false
  }
}

export interface AttemptPolicy {
  /** Total attempts, not retries. 1 means no retry at all. */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

/**
 * Three attempts inside one run's deadline.
 *
 * Modest on purpose: each attempt is a full model call against the same
 * authorised budget, so the cost of optimism here is real money rather than a
 * few extra HTTP requests.
 */
export const DEFAULT_ATTEMPT_POLICY: AttemptPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
}

export interface ExecutionDeps {
  random: Random
  /** Wall-clock reader. Injected so a test can drive the run deadline. */
  monotonicNowMs: () => number
  /** Injected so tests need not sleep in real time. */
  sleep?: (ms: number) => Promise<void>
  policy?: AttemptPolicy
}

/** What one attempt produced, in the caller's own terms. */
export type AttemptOutcome<T> =
  { state: 'ok'; value: T } | { state: 'failed'; category: RunFailureCategory }

export type ExecutionOutcome<T> =
  | { state: 'ok'; value: T; attempts: number }
  | {
      state: 'failed'
      category: RunFailureCategory
      /** How many attempts were made. Recorded on the run's failure. */
      attempts: number
      /** Whether the ORGANIZATION should queue the work again. */
      retryable: boolean
    }

/**
 * Runs `attempt` until it succeeds, exhausts its attempts, or runs out of the
 * run's time — whichever comes first.
 *
 * `deadlineMs` is the run's whole authorised wall clock. Pass `null` only for a
 * producer whose deadline dimension is `not-applicable`; a live run always has
 * one, because a live run with no decided deadline refuses to start.
 */
export async function executeWithinRun<T>(
  deadlineMs: number | null,
  attempt: (signal: AbortSignal, attemptNumber: number) => Promise<AttemptOutcome<T>>,
  deps: ExecutionDeps,
): Promise<ExecutionOutcome<T>> {
  const policy = deps.policy ?? DEFAULT_ATTEMPT_POLICY
  const sleep = deps.sleep ?? realSleep
  const startedAtMs = deps.monotonicNowMs()

  const remainingMs = (): number | null =>
    deadlineMs === null ? null : deadlineMs - (deps.monotonicNowMs() - startedAtMs)

  let attemptNumber = 0
  let lastCategory: RunFailureCategory = 'internal-error'

  while (attemptNumber < policy.maxAttempts) {
    const remaining = remainingMs()
    if (remaining !== null && remaining <= 0) {
      /*
       * Out of time before this attempt began. Reported as the budget being
       * exhausted rather than as a provider timeout: nothing timed out, the
       * firm's authorised window simply ended — and a reader chasing a
       * `provider-timeout` would go looking at a provider that was fine.
       */
      return {
        state: 'failed',
        category: 'budget-exhausted',
        attempts: attemptNumber,
        retryable: false,
      }
    }

    attemptNumber += 1
    const controller = new AbortController()

    let outcome: AttemptOutcome<T>
    try {
      outcome =
        remaining === null
          ? await attempt(controller.signal, attemptNumber)
          : await withTimeout(remaining, controller, (signal) =>
              attempt(signal, attemptNumber),
            )
    } catch (error) {
      /*
       * The deadline fired and the signal was aborted, so the call has been
       * told to stop. This is the whole reason `withTimeout` was the primitive
       * worth sharing: an expensive call that keeps running past its deadline
       * is spending money nobody authorised.
       */
      if (error instanceof TimeoutError) {
        return {
          state: 'failed',
          category: 'provider-timeout',
          attempts: attemptNumber,
          retryable: true,
        }
      }
      // A throw the caller did not classify is ours, not the provider's.
      outcome = { state: 'failed', category: 'internal-error' }
    }

    /*
     * A cancelled attempt is a timeout, whatever the call decided to return.
     *
     * `withTimeout` aborts the signal before it rejects, so a callee that
     * handles `abort` by resolving settles the race first and its answer would
     * otherwise stand — including, in the worst case, an `ok` carrying whatever
     * partial output it had assembled. Accepting that would let the firm record
     * a contribution built from a call it had already cancelled.
     *
     * Reported as `provider-timeout` rather than `budget-exhausted`, and the
     * difference is which of the two true things is worth telling a reader.
     * The run's window did end — but it ended *because the provider did not
     * answer*, and that is what someone investigating needs to see. It stays
     * retryable for the reason it always has: a hung provider may well answer
     * next time, so the assignment goes back on the queue.
     *
     * `budget-exhausted` is kept for the case where nothing external
     * misbehaved and the authorised time was simply spent.
     */
    if (controller.signal.aborted) {
      return {
        state: 'failed',
        category: 'provider-timeout',
        attempts: attemptNumber,
        retryable: true,
      }
    }

    /*
     * The deadline passed while the attempt was in flight and the timer did
     * not fire — because the process was not running to fire it. Measured on
     * 2026-09-22 (TD-102): the machine entered modern standby 26 s into a
     * synthesis run, Node's timers stood still with the process, and the
     * attempt settled 59 minutes later, an hour past a 180 s deadline. The
     * clock consulted here is the one `deps` supplies — wall time in
     * production — and it did move.
     *
     * What the attempt produced is refused whatever it is. An answer that
     * arrived after the firm's window closed is a late answer, and a late
     * answer never resurrects an expired run: the run settles `timed-out`,
     * the assignment goes back on the queue, and the next run starts from
     * the record, not from this result. Reported as `provider-timeout` for
     * the same reason the aborted case is — the window ended because the
     * provider did not answer inside it — and not as `budget-exhausted`,
     * which says nothing external misbehaved and sends nobody back to the
     * queue. Run 11 carried that label, and it was false.
     */
    const afterAttemptMs = remainingMs()
    if (afterAttemptMs !== null && afterAttemptMs <= 0) {
      return {
        state: 'failed',
        category: 'provider-timeout',
        attempts: attemptNumber,
        retryable: true,
      }
    }

    if (outcome.state === 'ok') {
      return { state: 'ok', value: outcome.value, attempts: attemptNumber }
    }

    lastCategory = outcome.category
    if (!isRetryableFailure(lastCategory)) break
    if (attemptNumber >= policy.maxAttempts) break

    const delay = backoffDelayMs(attemptNumber, policy, deps.random)
    const left = remainingMs()
    if (left !== null && delay >= left) {
      /*
       * Waiting would consume the rest of the run and leave no time to use it.
       * Stopping now reports the honest reason instead of sleeping into a
       * deadline and reporting a timeout nobody could act on.
       */
      return {
        state: 'failed',
        category: 'budget-exhausted',
        attempts: attemptNumber,
        retryable: false,
      }
    }
    await sleep(delay)
  }

  return {
    state: 'failed',
    category: lastCategory,
    attempts: attemptNumber,
    /*
     * Whether the ORGANIZATION should try again, which is a different question
     * from whether this pipeline should have. The attempts are spent either
     * way; what this says is whether the assignment goes back on the queue for
     * another run, or stays failed for a person to look at.
     */
    retryable: isRetryableFailure(lastCategory),
  }
}
