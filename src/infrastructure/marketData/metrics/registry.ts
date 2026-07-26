/**
 * In-memory metrics recorder.
 *
 * ## Limitations, stated up front
 *
 *  - **Per instance.** Nothing is shared between processes.
 *  - **Reset on restart.** There is no persistence and none is intended.
 *  - **Not suitable for long-term trending.** It answers "what is happening
 *    now?", not "what happened last Tuesday?".
 *  - It exists to be **scraped** (see `./prometheus.ts`) or adapted into an
 *    external collector. Adopting OpenTelemetry later is an adapter over this
 *    port, not a change to the pipeline.
 *
 * ## Safety properties
 *
 *  - All retained state is bounded: series count is capped, and histograms
 *    keep bucket counts rather than raw observations.
 *  - Label keys and values are validated; anything high-cardinality is dropped
 *    and counted rather than admitted.
 *  - Counters only increase. Gauges overwrite.
 *  - A metric write can never throw, so it can never fail a market-data
 *    request.
 */

import {
  LATENCY_BUCKETS_MS,
  validateLabel,
  type LabelRejection,
  type MetricLabels,
  type MetricName,
  type Metrics,
} from '~/application/marketData/metrics'

export type SeriesKind = 'counter' | 'gauge' | 'histogram'

export interface CounterSeries {
  kind: 'counter'
  name: string
  labels: Record<string, string>
  value: number
}

export interface GaugeSeries {
  kind: 'gauge'
  name: string
  labels: Record<string, string>
  value: number
}

export interface HistogramSeries {
  kind: 'histogram'
  name: string
  labels: Record<string, string>
  /** Non-cumulative counts, one per bucket boundary plus a final overflow. */
  counts: number[]
  sum: number
  count: number
}

export type Series = CounterSeries | GaugeSeries | HistogramSeries

/**
 * Hard cap on distinct series.
 *
 * Belt and braces on top of label validation: even entirely legitimate labels
 * could combine into more series than anyone wants to hold. Past the cap,
 * writes are dropped and counted rather than growing memory without limit.
 */
export const MAX_SERIES = 2_000

export interface MetricsRegistry extends Metrics {
  /** Immutable snapshot, sorted deterministically for stable serialization. */
  snapshot(): Series[]
  /** Label pairs refused by validation. Diagnostics and tests. */
  rejections(): LabelRejection[]
  /** Count of dropped writes, by cause. */
  droppedWrites(): { invalidLabel: number; capacity: number; invalidValue: number }
  /** TEST ONLY. Never called by application code. */
  resetForTests(): void
}

function labelKey(name: string, labels: Record<string, string>): string {
  const pairs = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(',')
  return `${name}{${pairs}}`
}

export function createMetricsRegistry(): MetricsRegistry {
  const series = new Map<string, Series>()
  const rejected: LabelRejection[] = []
  let droppedInvalidLabel = 0
  let droppedCapacity = 0
  let droppedInvalidValue = 0

  /** Returns validated labels, or null when the write must be dropped. */
  function clean(labels: MetricLabels | undefined): Record<string, string> | null {
    if (!labels) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(labels)) {
      if (value === undefined) continue
      const rejection = validateLabel(key, value)
      if (rejection) {
        // Kept bounded: a flood of distinct rejections must not become the
        // very memory problem the validation exists to prevent.
        if (rejected.length < 100) rejected.push(rejection)
        droppedInvalidLabel += 1
        return null
      }
      out[key] = String(value)
    }
    return out
  }

  function upsert<T extends Series>(key: string, create: () => T): T | null {
    const existing = series.get(key)
    if (existing) return existing as T
    if (series.size >= MAX_SERIES) {
      droppedCapacity += 1
      return null
    }
    const created = create()
    series.set(key, created)
    return created
  }

  return {
    increment(name: MetricName, labels?: MetricLabels, by = 1) {
      // Counters only increase; a negative increment is a programming error,
      // and silently applying it would corrupt every rate derived from it.
      if (!Number.isFinite(by) || by < 0) {
        droppedInvalidValue += 1
        return
      }
      const clean_ = clean(labels)
      if (clean_ === null) return
      const entry = upsert<CounterSeries>(labelKey(name, clean_), () => ({
        kind: 'counter',
        name,
        labels: clean_,
        value: 0,
      }))
      // Read-modify-write is safe: a single JavaScript process has no
      // preemption between these two statements, so no increment is lost.
      if (entry && entry.kind === 'counter') entry.value += by
    },

    gauge(name: MetricName, value: number, labels?: MetricLabels) {
      if (!Number.isFinite(value)) {
        droppedInvalidValue += 1
        return
      }
      const clean_ = clean(labels)
      if (clean_ === null) return
      const entry = upsert<GaugeSeries>(labelKey(name, clean_), () => ({
        kind: 'gauge',
        name,
        labels: clean_,
        value,
      }))
      // Gauges overwrite: the latest known value is the whole point.
      if (entry && entry.kind === 'gauge') entry.value = value
    },

    observe(name: MetricName, value: number, labels?: MetricLabels) {
      // A negative latency is not a slow request, it is a clock problem.
      if (!Number.isFinite(value) || value < 0) {
        droppedInvalidValue += 1
        return
      }
      const clean_ = clean(labels)
      if (clean_ === null) return
      const entry = upsert<HistogramSeries>(labelKey(name, clean_), () => ({
        kind: 'histogram',
        name,
        labels: clean_,
        // One slot per boundary, plus a final slot for everything above the
        // largest boundary (rendered as `+Inf`).
        counts: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
        sum: 0,
        count: 0,
      }))
      if (!entry || entry.kind !== 'histogram') return

      let index: number = LATENCY_BUCKETS_MS.length
      for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
        // `<=` so an observation exactly on a boundary lands in that bucket,
        // which is what Prometheus's `le` semantics mean.
        if (value <= LATENCY_BUCKETS_MS[i]!) {
          index = i
          break
        }
      }
      entry.counts[index] = (entry.counts[index] ?? 0) + 1
      entry.sum += value
      entry.count += 1
    },

    snapshot() {
      // Deep-copied so callers cannot mutate internal state, and sorted so
      // serialization is byte-stable across runs.
      return [...series.values()]
        .map((entry): Series =>
          entry.kind === 'histogram'
            ? { ...entry, labels: { ...entry.labels }, counts: [...entry.counts] }
            : { ...entry, labels: { ...entry.labels } },
        )
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            labelKey(a.name, a.labels).localeCompare(labelKey(b.name, b.labels)),
        )
    },

    rejections() {
      return rejected.map((entry) => ({ ...entry }))
    },

    droppedWrites() {
      return {
        invalidLabel: droppedInvalidLabel,
        capacity: droppedCapacity,
        invalidValue: droppedInvalidValue,
      }
    },

    resetForTests() {
      series.clear()
      rejected.length = 0
      droppedInvalidLabel = 0
      droppedCapacity = 0
      droppedInvalidValue = 0
    },
  }
}
