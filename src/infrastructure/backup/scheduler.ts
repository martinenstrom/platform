/**
 * When backups happen without being asked for: every half hour while the
 * application runs, a minute after the record last changed, and at a
 * controlled shutdown. The scheduler only keeps time; what a snapshot is,
 * and whether one is needed, belongs to the caller it was given.
 */

export interface SchedulerDeps {
  /** Take a snapshot for the trigger; the callee decides whether anything changed. */
  snapshot(trigger: 'interval' | 'post-act' | 'shutdown'): Promise<void>
  /** Export to the external destination when it is due. */
  dailyExport(): Promise<void>
  intervalMs?: number
  debounceMs?: number
}

export const SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000
export const ACT_DEBOUNCE_MS = 60 * 1000

export class BackupScheduler {
  private interval: ReturnType<typeof setInterval> | null = null
  private pendingAct: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.interval) return
    this.interval = setInterval(() => {
      void this.run(() => this.deps.snapshot('interval'))
      void this.run(() => this.deps.dailyExport())
    }, this.deps.intervalMs ?? SNAPSHOT_INTERVAL_MS)
    this.interval.unref?.()
  }

  /** The record changed: a snapshot a minute from now, however many acts arrive in between. */
  afterAct(): void {
    if (this.pendingAct) clearTimeout(this.pendingAct)
    this.pendingAct = setTimeout(() => {
      this.pendingAct = null
      void this.run(() => this.deps.snapshot('post-act'))
    }, this.deps.debounceMs ?? ACT_DEBOUNCE_MS)
    this.pendingAct.unref?.()
  }

  /** A controlled end: whatever is pending, now. */
  async shutdown(): Promise<void> {
    this.stop()
    await this.run(() => this.deps.snapshot('shutdown'))
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    if (this.pendingAct) clearTimeout(this.pendingAct)
    this.pendingAct = null
  }

  /** One at a time; a failure never stops the next one. */
  private async run(work: () => Promise<void>): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await work()
    } catch {
      /* the callee reports its own failures */
    } finally {
      this.running = false
    }
  }
}
