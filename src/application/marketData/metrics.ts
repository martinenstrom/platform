/**
 * Market-data metric names.
 *
 * The port itself, the label allowlist and the cardinality rules live in
 * `application/shared/metrics` — they are not market-data concerns, and the
 * analysis storage layer needs the same ones. What stays here is this
 * context's vocabulary.
 *
 * Ratios (cache hit ratio, stale-serve rate, provider success rate) are
 * deliberately NOT recorded. They are derived from the counters below at read
 * time; a ratio stored as a gauge is a ratio that goes stale.
 */

export {
  ALLOWED_LABEL_KEYS,
  LATENCY_BUCKETS_MS,
  MAX_LABEL_VALUE_LENGTH,
  noopMetrics,
  validateLabel,
  type AllowedLabelKey,
  type LabelRejection,
  type MetricLabels,
} from '~/application/shared/metrics'

import type { Metrics as SharedMetrics } from '~/application/shared/metrics'

/**
 * The recorder, narrowed to this context's names.
 *
 * Narrowing keeps the guarantee the closed union always gave here: a call site
 * cannot invent a metric name. A registry implementing `Metrics<string>`
 * satisfies this, so nothing downstream changes.
 */
export type Metrics = SharedMetrics<MetricName>

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
