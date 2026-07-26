/**
 * Snapshot-level deadline (H2).
 *
 * Per-attempt timeouts bound one provider call. Nothing bounded the **page**:
 * a snapshot fans out a dozen categories, each of which may retry, and the
 * server-rendered response is only as fast as the slowest one. One degraded
 * source held the whole Overview, and every provider added made the tail
 * heavier.
 *
 * So each unit races the deadline. Whatever has resolved is returned; whatever
 * has not becomes an explicit envelope rather than a delay.
 *
 * ## Why the unfinished ones are `error`, not `loading`
 *
 * `loading` means "ask again shortly and this will fill in" — a client-side
 * state where a refetch is already scheduled. A server-rendered snapshot has
 * no such follow-up: the response is sent and that is the whole answer. A
 * panel marked `loading` forever would be a lie of a different shape.
 *
 * `error` with `retryable: true` and a `deadline-exceeded` message says what
 * actually happened: we stopped waiting. The next request may well succeed,
 * because the abandoned work usually completes and populates the cache — so
 * the deadline degrades a cold page rather than a warm one.
 *
 * The in-flight work is NOT cancelled. It is left to finish and fill the cache
 * exactly as the Avanza adapter leaves an uncancellable MCP call running: what
 * is bounded here is how long a *reader* waits, not how long the work takes.
 */

import type { Envelope } from '~/domain/shared/provenance'

export interface DeadlineOptions {
  /** Milliseconds before an unresolved unit is reported as exceeded. */
  budgetMs: number
  /** Injected so tests are deterministic and never sleep in real time. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

function exceeded<T>(label: string, budgetMs: number): Envelope<T> {
  return {
    state: 'error',
    error: {
      code: 'timeout',
      message: `"${label}" did not resolve within the ${budgetMs}ms snapshot deadline`,
      providerId: null,
      // The work usually completes and warms the cache, so the next request
      // has a good chance of being served immediately.
      retryable: true,
    },
  }
}

/**
 * Resolves with whatever `run` produced, or an exceeded envelope at the
 * deadline — whichever happens first.
 */
export function withDeadline<T>(
  label: string,
  run: () => Promise<Envelope<T>>,
  options: DeadlineOptions,
): Promise<Envelope<T>> {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never))

  return new Promise<Envelope<T>>((resolve) => {
    let settled = false
    const handle = setTimer(() => {
      if (settled) return
      settled = true
      resolve(exceeded<T>(label, options.budgetMs))
    }, options.budgetMs)

    const finish = (envelope: Envelope<T>) => {
      if (settled) return
      settled = true
      clearTimer(handle)
      resolve(envelope)
    }

    run().then(finish, () => {
      // `isolate` already converts throws; this is belt and braces so a
      // rejection can never leave the promise pending past the deadline.
      finish(exceeded<T>(label, options.budgetMs))
    })
  })
}

/**
 * Default page budget.
 *
 * Chosen against what a server-rendered page can afford rather than against
 * any provider's latency: past roughly three seconds the request is a bad
 * experience however well-justified the wait. Individual providers declare
 * `expectedLatencyMs` in the hundreds, so a healthy snapshot never approaches
 * this — it exists for the degraded case.
 */
export const DEFAULT_SNAPSHOT_BUDGET_MS = 3_000
