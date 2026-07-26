/**
 * Metrics contracts.
 *
 * The port and its rules only — no exporter, no SDK. Defining this before it is
 * needed means the call sites already exist when someone wants the data, which
 * is the expensive part to retrofit.
 *
 * Ratios (cache hit ratio, stale-serve rate, provider success rate) are
 * deliberately NOT recorded. They are derived from the counters below at read
 * time; a ratio stored as a gauge is a ratio that goes stale.
 */

/* ------------------------------------------------------------------- labels */

/**
 * The only permitted label keys.
 *
 * A label is a time series. Anything unbounded — a cache key, a symbol list, a
 * URL, a timestamp, a correlation id, an error message — would multiply series
 * until the metrics store is the outage. Those belong in logs, where a high
 * cardinality is exactly what you want.
 */
export const ALLOWED_LABEL_KEYS = [
  'provider',
  'capability',
  'category',
  'outcome',
  'state',
  'reason',
  'attempt',
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
 * Returns rather than throws: a metrics call must never be able to fail a
 * market-data request. The recorder drops the offending series and counts the
 * rejection, which is what tests assert against.
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
 * name. These may be tuned once real operational data exists, but they are not
 * runtime-configurable in this phase — a histogram whose buckets change is a
 * histogram whose history cannot be compared.
 */
export const LATENCY_BUCKETS_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000,
] as const

/* ------------------------------------------------------------------- port */

export interface Metrics {
  /** Monotonic count. Negative increments are rejected. */
  increment(name: MetricName, labels?: MetricLabels, by?: number): void
  /** Distribution of a measured value. Negative observations are rejected. */
  observe(name: MetricName, value: number, labels?: MetricLabels): void
  /** Point-in-time value. Overwrites the previous value for the same labels. */
  gauge(name: MetricName, value: number, labels?: MetricLabels): void
}

export const METRIC = {
  cacheHit: 'marketdata.cache.hit',
  cacheMiss: 'marketdata.cache.miss',
  cacheStaleHit: 'marketdata.cache.stale_hit',
  cacheRevalidate: 'marketdata.cache.revalidate',
  providerLatency: 'marketdata.provider.latency_ms',
  providerRequest: 'marketdata.provider.request',
  providerRetry: 'marketdata.provider.retry',
  providerTimeout: 'marketdata.provider.timeout',
  providerSkipped: 'marketdata.provider.skipped',
  breakerOpened: 'marketdata.breaker.opened',
  /** Numeric state: 0 closed, 1 half-open, 2 open. See `BREAKER_STATE_VALUE`. */
  breakerState: 'marketdata.breaker.state',
  budgetUsed: 'marketdata.budget.used',
  budgetRemaining: 'marketdata.budget.remaining',
  /** Counter of JOIN EVENTS: callers that attached to an in-flight request. */
  singleFlightShared: 'marketdata.singleflight.shared',
  resolution: 'marketdata.resolution',
  /** Diagnostic: metric writes dropped by validation or capacity limits. */
  metricsRejected: 'marketdata.metrics.rejected',
} as const

export type MetricName = (typeof METRIC)[keyof typeof METRIC]

/**
 * Documented numeric mapping for `breakerState`, so a dashboard can read it
 * without guessing. Ordered by severity, which makes `max()` meaningful.
 */
export const BREAKER_STATE_VALUE = {
  closed: 0,
  'half-open': 1,
  open: 2,
} as const

export const noopMetrics: Metrics = {
  increment: () => {},
  observe: () => {},
  gauge: () => {},
}
