/**
 * Per-attempt deadline.
 *
 * Uses a real timer rather than the injected `Clock`: a timeout is about
 * wall-clock elapsed time during an in-flight call, which `FakeClock` cannot
 * model. Tests drive it with `vi.useFakeTimers()`, which controls `setTimeout`
 * directly.
 */

import type { DomainError } from '~/domain/market'

export class TimeoutError extends Error {
  readonly code = 'timeout' as const
  constructor(readonly timeoutMs: number) {
    super(`Request exceeded its ${timeoutMs}ms deadline`)
    this.name = 'TimeoutError'
  }
}

export function timeoutDomainError(providerId: string, timeoutMs: number): DomainError {
  return {
    code: 'timeout',
    message: `Request exceeded its ${timeoutMs}ms deadline`,
    providerId,
    retryable: true,
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
