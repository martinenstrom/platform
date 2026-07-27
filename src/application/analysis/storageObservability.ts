/**
 * What the storage layer reports about itself.
 *
 * Names and shapes only. The recorder, the label allowlist and the cardinality
 * rules are shared (`application/shared/metrics`); this file is the analysis
 * context's vocabulary, sitting beside `marketdata.*` in the same registry and
 * under the same 2000-series cap.
 *
 * The signals were chosen for what they answer, not for what is easy to emit:
 * a rising rollback rate means commands are failing; a rising conflict rate
 * means the aggregate boundary is too coarse; a non-zero deadlock count means
 * two commands take locks in different orders, which is a design defect rather
 * than a load problem; and `pool.waiting` above zero means the pool, not the
 * database, is the bottleneck.
 */

import type { Logger } from '~/application/shared/logger'
import type { Metrics } from '~/application/shared/metrics'

export const ANALYSIS_DB_METRIC = {
  /** Labelled `outcome=committed|rolled-back`. */
  transaction: 'analysis.db.transaction',
  transactionLatency: 'analysis.db.transaction.latency_ms',
  /** Labelled `reason=conflict|error|deadlock`. */
  rollback: 'analysis.db.rollback',
  /** PostgreSQL 40P01. Should be zero. */
  deadlock: 'analysis.db.deadlock',
  /** Optimistic-concurrency losses. */
  conflict: 'analysis.db.conflict',
  retry: 'analysis.db.retry',
  /** Labelled by `operation` — a port method name, never an id. */
  queryLatency: 'analysis.db.query.latency_ms',
  querySlow: 'analysis.db.query.slow',
  /** Labelled by `category`, from the error map. */
  error: 'analysis.db.error',
  poolSize: 'analysis.db.pool.size',
  poolIdle: 'analysis.db.pool.idle',
  poolWaiting: 'analysis.db.pool.waiting',
  poolAcquireWait: 'analysis.db.pool.acquire_wait_ms',
} as const

export type AnalysisDbMetricName =
  (typeof ANALYSIS_DB_METRIC)[keyof typeof ANALYSIS_DB_METRIC]

export type StorageMetrics = Metrics<AnalysisDbMetricName>

/**
 * A statement that took longer than the threshold.
 *
 * Note what this cannot carry. There is no field for the SQL and no field for
 * the parameters, because a query's parameters contain case ids, thesis
 * statements, rationales and evidence payloads — and a slow-query log is
 * exactly the artefact that gets pasted into an issue. `operation` is a port
 * method name; the correlation id is how a specific occurrence is found in the
 * event log, which is where the detail legitimately lives.
 */
export interface SlowQuery {
  operation: string
  durationMs: number
  correlationId?: string
  /** How many rows came back. A count, never the rows. */
  rowCount?: number
}

export interface StorageLogger extends Logger {
  slowQuery(entry: SlowQuery): void
}

export const noopStorageLogger: StorageLogger = {
  warn: () => {},
  slowQuery: () => {},
}

/** Statements above this are logged. Tunable per deployment, not per call. */
export const DEFAULT_SLOW_QUERY_MS = 200
