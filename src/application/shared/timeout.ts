/**
 * A wall-clock deadline on an in-flight call, with cancellation.
 *
 * Shared by the market-data resilience pipeline and the analysis execution
 * pipeline, because measurement showed the semantics are **genuinely
 * identical** rather than merely similarly named: both need "stop waiting at
 * N milliseconds, and tell the call to stop working". That is the whole test
 * for extraction here — generalise shared semantics, not shared vocabulary.
 *
 * ## Not the same thing as `withDeadline`
 *
 * `withDeadline` in this same directory bounds how long a *reader* waits and
 * deliberately leaves the work running to warm a cache, returning a degraded
 * envelope. This aborts the shared signal so the underlying call can stop —
 * which is what an expensive external call needs, and what makes a budget
 * enforceable rather than advisory.
 *
 * Two different answers to "the time ran out", and both are wanted. A page
 * that abandons a slow panel is degrading gracefully; a model call that keeps
 * spending after its deadline is spending money nobody authorised.
 *
 * ## Why a real timer
 *
 * Wall-clock elapsed time during an in-flight call is not something the
 * injected `Clock` can model — a `FakeClock` advances when told, and the point
 * here is time passing while something else is awaited. Tests drive this with
 * `vi.useFakeTimers()`, which controls `setTimeout` directly.
 */

export class TimeoutError extends Error {
  readonly code = 'timeout' as const
  constructor(readonly timeoutMs: number) {
    super(`Request exceeded its ${timeoutMs}ms deadline`)
    this.name = 'TimeoutError'
  }
}

/**
 * Races `run` against a deadline, aborting the shared signal on expiry so the
 * underlying call can stop work rather than merely being ignored.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  controller: AbortController,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new TimeoutError(timeoutMs))
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(controller.signal), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
