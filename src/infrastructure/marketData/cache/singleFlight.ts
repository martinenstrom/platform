/**
 * Keyed single-flight.
 *
 * Concurrent callers for the same key share one execution. This is the
 * outermost layer of the resolution pipeline, which is what stops N page loads
 * from becoming N provider calls — and, more importantly, from becoming
 * N × maxAttempts calls once retries are involved.
 *
 * The same registry covers stale-while-revalidate background refreshes, so a
 * refresh already in flight is never started twice.
 */

export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  /** Number of callers that joined an existing execution. Diagnostics only. */
  private sharedCount = 0

  /**
   * @param onJoin Called once per JOIN EVENT — i.e. per caller that attached
   *   to work already running. Counting join events rather than
   *   distinct-keys-shared keeps the metric's meaning stable: "requests this
   *   saved".
   */
  constructor(private readonly onJoin?: (key: string) => void) {}

  async run<T>(key: string, execute: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key)
    if (existing) {
      this.sharedCount += 1
      this.onJoin?.(key)
      return existing as Promise<T>
    }
    // Settled promises are removed in `finally`, so a rejection cannot poison
    // the key for later callers.
    const promise = execute().finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  /** True when work is already running for this key. */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key)
  }

  shared(): number {
    return this.sharedCount
  }

  size(): number {
    return this.inFlight.size
  }
}
