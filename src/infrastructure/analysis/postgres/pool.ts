/**
 * Pool construction.
 *
 * One pool per adapter instance rather than a module singleton: the pool is
 * owned by whatever built it, which is what lets a test create and destroy
 * several without leaking connections between them.
 */

import { Pool, types, type PoolConfig } from 'pg'
import {
  ANALYSIS_DB_METRIC,
  type StorageMetrics,
} from '~/application/analysis/storageObservability'

/** `int8`. Returned as a string by default, because it can exceed 2^53. */
const OID_INT8 = 20
/** `timestamptz` and `timestamp`. */
const OID_TIMESTAMPTZ = 1184
const OID_TIMESTAMP = 1114

export interface PostgresPoolOptions {
  connectionString: string
  max?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
  statementTimeoutMs?: number
  applicationName?: string
}

/**
 * Type parsers, applied per pool rather than globally.
 *
 * `types.setTypeParser` is process-wide, which would change how the market-data
 * code reads its own tables if it ever had any. `PoolConfig.types` scopes the
 * override to this pool.
 */
const parsers = {
  getTypeParser: ((oid: number, format?: string) => {
    if (oid === OID_INT8) {
      return (value: string | null) => {
        if (value === null) return null
        const parsed = Number(value)
        if (!Number.isSafeInteger(parsed)) {
          // The only bigint in the schema is `cost_minor_units`. Silently
          // losing precision on money is not an acceptable failure mode.
          throw new Error(`bigint ${value} exceeds the safe integer range`)
        }
        return parsed
      }
    }
    if (oid === OID_TIMESTAMPTZ || oid === OID_TIMESTAMP) {
      // Left as text. Every read projects timestamps through `ts()`, which
      // formats them to the exact ISO string the domain wrote; parsing them
      // into a Date here would discard microseconds and reformat the value.
      return (value: string | null) => value
    }
    return types.getTypeParser(oid, format as never)
  }) as PoolConfig['types'] extends { getTypeParser: infer T } ? T : never,
}

export function createPostgresPool(options: PostgresPoolOptions): Pool {
  const statementTimeoutMs = options.statementTimeoutMs ?? 15_000

  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    // Fail fast rather than queueing behind a database that is not answering.
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    application_name: options.applicationName ?? 'finos-analysis',
    /*
     * Set as a connection parameter rather than per statement, so a runaway
     * query cannot pin a client no matter which call site issued it — and so
     * it cannot be forgotten.
     */
    options: `-c statement_timeout=${statementTimeoutMs}`,
    types: parsers as PoolConfig['types'],
  })
}

/**
 * Samples pool saturation.
 *
 * `waiting` above zero is the signal worth having: it distinguishes "the
 * database is slow" from "we ran out of connections", which look identical
 * from a latency histogram alone.
 */
export function recordPoolGauges(pool: Pool, metrics: StorageMetrics): void {
  metrics.gauge(ANALYSIS_DB_METRIC.poolSize, pool.totalCount)
  metrics.gauge(ANALYSIS_DB_METRIC.poolIdle, pool.idleCount)
  metrics.gauge(ANALYSIS_DB_METRIC.poolWaiting, pool.waitingCount)
}
