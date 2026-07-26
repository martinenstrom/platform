/**
 * Prometheus text exposition renderer.
 *
 * Internal metric names are dotted and OTel-oriented
 * (`marketdata.provider.latency_ms`); Prometheus requires
 * `[a-zA-Z_:][a-zA-Z0-9_:]*`. Translation happens **here, at the exporter
 * boundary**, so neither vendor's convention becomes the internal truth and
 * adopting OpenTelemetry later needs no rename.
 *
 * Because normalization is lossy — `a.b` and `a_b` both become `a_b` — it can
 * introduce collisions that would silently merge two unrelated series. This
 * module detects that and refuses, rather than emitting corrupt output.
 */

import { LATENCY_BUCKETS_MS } from '~/application/marketData/metrics'
import type { Series } from './registry'

/** Dotted internal name → valid Prometheus metric name. */
export function toPrometheusName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_:]/g, '_')
  // A name may not start with a digit.
  return /^[a-zA-Z_:]/.test(normalized) ? normalized : `_${normalized}`
}

export function isValidPrometheusLabelName(key: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
}

/** Escapes a label value per the exposition format: backslash, quote, newline. */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

export class PrometheusNameCollisionError extends Error {
  constructor(
    readonly promName: string,
    readonly internalNames: string[],
  ) {
    super(
      `Prometheus name "${promName}" is produced by more than one internal metric: ` +
        `${internalNames.join(', ')}. Rename one so normalization stays injective.`,
    )
    this.name = 'PrometheusNameCollisionError'
  }
}

/**
 * Detects internal names that normalize to the same Prometheus name.
 *
 * Called before rendering so the failure is loud and specific instead of two
 * unrelated series quietly summing together on a dashboard.
 */
export function findNameCollisions(names: readonly string[]): Map<string, string[]> {
  const byPromName = new Map<string, Set<string>>()
  for (const name of names) {
    const prom = toPrometheusName(name)
    const bucket = byPromName.get(prom) ?? new Set<string>()
    bucket.add(name)
    byPromName.set(prom, bucket)
  }
  const collisions = new Map<string, string[]>()
  for (const [prom, internal] of byPromName) {
    if (internal.size > 1) collisions.set(prom, [...internal].sort())
  }
  return collisions
}

function renderLabels(labels: Record<string, string>, extra?: [string, string]): string {
  const pairs = Object.keys(labels)
    .filter(isValidPrometheusLabelName)
    .sort()
    .map((key) => `${key}="${escapeLabelValue(labels[key]!)}"`)
  if (extra) pairs.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`)
  return pairs.length > 0 ? `{${pairs.join(',')}}` : ''
}

const PROM_TYPE: Record<Series['kind'], string> = {
  counter: 'counter',
  gauge: 'gauge',
  histogram: 'histogram',
}

const HELP: Record<string, string> = {
  'marketdata.cache.hit': 'Resolutions served from a fresh cache entry',
  'marketdata.cache.miss': 'Resolutions that had no fresh cache entry',
  'marketdata.cache.stale_hit': 'Resolutions served from an expired cache entry',
  'marketdata.cache.revalidate': 'Background refreshes started behind a stale serve',
  'marketdata.provider.latency_ms': 'Provider call latency in milliseconds',
  'marketdata.provider.request': 'Provider calls attempted, by outcome',
  'marketdata.provider.retry': 'Provider call retries',
  'marketdata.provider.timeout': 'Provider calls that exceeded their deadline',
  'marketdata.provider.skipped': 'Provider calls skipped before dispatch, by reason',
  'marketdata.breaker.opened': 'Circuit breaker open transitions',
  'marketdata.breaker.state': 'Circuit breaker state: 0 closed, 1 half-open, 2 open',
  'marketdata.budget.used':
    'Daily provider budget consumed (instance-local unless shared)',
  'marketdata.budget.remaining':
    'Daily provider budget remaining (instance-local unless shared)',
  'marketdata.singleflight.shared': 'Callers that joined an in-flight request',
  'marketdata.resolution': 'Completed resolutions, by resulting state',
  'marketdata.metrics.rejected': 'Metric writes dropped by validation or capacity limits',
}

/**
 * Renders the text exposition format.
 *
 * Output is deterministic — series are pre-sorted by the registry and label
 * keys are sorted here — so it can be asserted against a golden sample.
 */
export function renderPrometheus(series: readonly Series[]): string {
  const collisions = findNameCollisions(series.map((entry) => entry.name))
  const first = [...collisions.entries()][0]
  if (first) throw new PrometheusNameCollisionError(first[0], first[1])

  const lines: string[] = []
  let lastName: string | null = null

  for (const entry of series) {
    const name = toPrometheusName(entry.name)

    // HELP and TYPE are emitted once per metric family, not per series.
    if (name !== lastName) {
      const help = HELP[entry.name]
      if (help) lines.push(`# HELP ${name} ${help}`)
      lines.push(`# TYPE ${name} ${PROM_TYPE[entry.kind]}`)
      lastName = name
    }

    if (entry.kind === 'histogram') {
      // Prometheus buckets are CUMULATIVE: each `le` counts everything at or
      // below it, so the registry's per-bucket counts are summed as we go.
      let cumulative = 0
      for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
        cumulative += entry.counts[i] ?? 0
        const le = String(LATENCY_BUCKETS_MS[i])
        lines.push(
          `${name}_bucket${renderLabels(entry.labels, ['le', le])} ${cumulative}`,
        )
      }
      cumulative += entry.counts[LATENCY_BUCKETS_MS.length] ?? 0
      lines.push(
        `${name}_bucket${renderLabels(entry.labels, ['le', '+Inf'])} ${cumulative}`,
      )
      lines.push(`${name}_sum${renderLabels(entry.labels)} ${entry.sum}`)
      lines.push(`${name}_count${renderLabels(entry.labels)} ${entry.count}`)
      continue
    }

    lines.push(`${name}${renderLabels(entry.labels)} ${entry.value}`)
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/**
 * OpenTelemetry mapping, documented rather than implemented.
 *
 *   increment  → Counter.add(value, attributes)
 *   observe    → Histogram.record(value, attributes)   (explicit buckets)
 *   gauge      → ObservableGauge callback
 *   labels     → attributes, verbatim — dotted names are already OTel-native
 *
 * `correlationId` is deliberately absent: it is a log field, and may only
 * become a metric **exemplar** once an exporter that supports exemplars is
 * chosen. This renderer emits none.
 */
export const OPEN_TELEMETRY_MAPPING = {
  increment: 'Counter.add',
  observe: 'Histogram.record',
  gauge: 'ObservableGauge',
  labels: 'attributes',
} as const
