/**
 * Metrics contracts.
 *
 * The port only — no exporter, no dashboard. Defining it now means the call
 * sites exist before anyone needs the data, which is the expensive part to
 * retrofit.
 *
 * Ratios (cache hit ratio, stale hit ratio, provider success rate) are
 * deliberately NOT recorded. They are derived from the counters below at read
 * time; a ratio stored as a gauge is a ratio that goes stale.
 */

export type MetricLabels = Readonly<Record<string, string | number>>

export interface Metrics {
  /** Monotonic count of events. */
  increment(name: MetricName, labels?: MetricLabels, by?: number): void
  /** Distribution of a measured value, e.g. latency. */
  observe(name: MetricName, value: number, labels?: MetricLabels): void
  /** Point-in-time value that can go up or down. */
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
  breakerState: 'marketdata.breaker.state',
  budgetUsed: 'marketdata.budget.used',
  budgetRemaining: 'marketdata.budget.remaining',
  singleFlightShared: 'marketdata.singleflight.shared',
  resolution: 'marketdata.resolution',
} as const

export type MetricName = (typeof METRIC)[keyof typeof METRIC]

export const noopMetrics: Metrics = {
  increment: () => {},
  observe: () => {},
  gauge: () => {},
}
