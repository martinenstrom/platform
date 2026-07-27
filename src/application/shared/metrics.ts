/**
 * The metrics port, and the cardinality rules that keep it safe.
 *
 * Extracted from `application/marketData/metrics.ts` when the analysis storage
 * layer needed to record transaction and query metrics. The alternative was
 * `application/analysis` importing from `application/marketData`, which would
 * make the analysis context depend on the market-data context for no reason
 * other than where a file happened to live first.
 *
 * What stayed behind: the metric NAMES. `marketdata.*` and `analysis.db.*` are
 * each their context's vocabulary, and a shared list of every metric in the
 * system would be a file every context has to edit.
 *
 * Ratios are deliberately not recordable here. They are derived from counters
 * at read time; a ratio stored as a gauge is a ratio that goes stale.
 */

/* ------------------------------------------------------------------- labels */

/**
 * The only permitted label keys.
 *
 * A label is a time series. Anything unbounded — a cache key, a symbol list, a
 * URL, a timestamp, a correlation id, an error message — would multiply series
 * until the metrics store is the outage. Those belong in logs, where a high
 * cardinality is exactly what you want.
 *
 * `operation` was added for the storage layer: it names a repository method,
 * of which there are 39. Bounded by the port, not by the data.
 */
export const ALLOWED_LABEL_KEYS = [
  'provider',
  'capability',
  'category',
  'outcome',
  'state',
  'reason',
  'attempt',
  'operation',
] as const

export type AllowedLabelKey = (typeof ALLOWED_LABEL_KEYS)[number]

export type MetricLabels = Partial<Record<AllowedLabelKey, string | number>>

/** Label values must be short, bounded tokens — codes and enums, not prose. */
export const MAX_LABEL_VALUE_LENGTH = 48

const LABEL_VALUE_PATTERN = /^[A-Za-z0-9_.:-]+$/

/** Shapes that betray unbounded data even when they pass the character test. */
const HIGH_CARDINALITY_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /:\/\//, why: 'looks like a URL' },
  { pattern: /\|/, why: 'looks like a joined symbol list' },
  { pattern: /^\d{4}-\d{2}-\d{2}/, why: 'looks like a timestamp' },
  { pattern: /^[0-9a-f]{16,}$/i, why: 'looks like a correlation id or hash' },
  { pattern: /^s\d+\.n\d+:/, why: 'looks like a cache key' },
]

export type LabelRejection = { key: string; value: string; why: string }

/**
 * Validates one label pair, returning why it was rejected or `null` if fine.
 *
 * Returns rather than throws: a metrics call must never be able to fail the
 * request it is measuring. The recorder drops the offending series and counts
 * the rejection, which is what tests assert against.
 */
export function validateLabel(
  key: string,
  value: string | number,
): LabelRejection | null {
  const text = String(value)
  if (!(ALLOWED_LABEL_KEYS as readonly string[]).includes(key)) {
    return { key, value: text, why: 'label key is not on the allowlist' }
  }
  if (text.length === 0) return { key, value: text, why: 'label value is empty' }
  if (text.length > MAX_LABEL_VALUE_LENGTH) {
    return {
      key,
      value: text,
      why: `label value exceeds ${MAX_LABEL_VALUE_LENGTH} chars`,
    }
  }
  // Shape checks run BEFORE the character check so the rejection says
  // something useful: "looks like a URL" is actionable, whereas "unsupported
  // characters" leaves the caller guessing which character and why it matters.
  for (const { pattern, why } of HIGH_CARDINALITY_PATTERNS) {
    if (pattern.test(text)) return { key, value: text, why }
  }
  if (!LABEL_VALUE_PATTERN.test(text)) {
    return { key, value: text, why: 'label value contains unsupported characters' }
  }
  return null
}

/* --------------------------------------------------------------- histograms */

/**
 * Fixed latency buckets, in milliseconds.
 *
 * Bounded on purpose: retaining raw observations is a memory leak with a nice
 * name. A histogram whose buckets change is a histogram whose history cannot
 * be compared, so these are not runtime-configurable.
 */
export const LATENCY_BUCKETS_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000,
] as const

/* ------------------------------------------------------------------- port */

/**
 * The recorder.
 *
 * Generic in the metric name so each context can narrow it to its own
 * vocabulary — `Metrics<MarketDataMetricName>`, `Metrics<AnalysisMetricName>`
 * — while a single registry implementing `Metrics<string>` satisfies both. The
 * alternative, a union of every metric name in the system, would couple the
 * contexts through their observability.
 */
export interface Metrics<Name extends string = string> {
  /** Monotonic count. Negative increments are rejected. */
  increment(name: Name, labels?: MetricLabels, by?: number): void
  /** Distribution of a measured value. Negative observations are rejected. */
  observe(name: Name, value: number, labels?: MetricLabels): void
  /** Point-in-time value. Overwrites the previous value for the same labels. */
  gauge(name: Name, value: number, labels?: MetricLabels): void
}

export const noopMetrics: Metrics = {
  increment: () => {},
  observe: () => {},
  gauge: () => {},
}
