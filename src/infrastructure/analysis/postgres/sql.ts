/**
 * Statement execution, timing, and the error map.
 *
 * Everything the repositories do goes through `run()`, which is what makes
 * "every query is measured" and "no database error reaches the application
 * unmapped" properties of the adapter rather than of each call site.
 */

import { createHash } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import {
  AmbiguousCommitError,
  ConflictingRecordError,
  DuplicateRecordError,
  ImmutableRecordError,
  InvariantViolationError,
  MalformedRowError,
  ReferentialIntegrityError,
  RetryableStorageError,
  StorageError,
  StoragePermissionError,
  StorageUnavailableError,
  TransactionClosedError,
} from '~/application/analysis/repositories'
import {
  ANALYSIS_DB_METRIC,
  DEFAULT_SLOW_QUERY_MS,
  noopStorageLogger,
  type StorageLogger,
  type StorageMetrics,
} from '~/application/analysis/storageObservability'
import { noopMetrics } from '~/application/shared/metrics'

/** Just enough of a `pg` client for the repositories. Pool or Client both fit. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>
}

export interface SqlContext {
  metrics: StorageMetrics
  logger: StorageLogger
  slowQueryMs: number
  correlationId?: string
}

export function defaultSqlContext(over: Partial<SqlContext> = {}): SqlContext {
  return {
    metrics: noopMetrics as StorageMetrics,
    logger: noopStorageLogger,
    slowQueryMs: DEFAULT_SLOW_QUERY_MS,
    ...over,
  }
}

/* ------------------------------------------------------------- timestamps */

/**
 * Projects a `timestamptz` as the exact ISO string the domain wrote.
 *
 * The driver would otherwise parse it into a JS `Date`, which holds
 * milliseconds where PostgreSQL holds microseconds — a lossy round trip that
 * silently changes the value the domain stored. Ordering still uses the
 * indexed column; only the projection is text.
 */
export function ts(column: string, alias = column.split('.').pop()!): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${alias}`
}

/* ----------------------------------------------------------------- catalog */

/**
 * Freezes a repository's statements and makes them enumerable.
 *
 * The enumerability is the point: `queryCatalogHash` in `StorageProvenance`
 * can only exist if every statement the adapter can issue lives somewhere it
 * can be listed. Inlining SQL at call sites would make that a whole-adapter
 * refactor to add later. See D-S20.
 */
export function catalog<T extends Record<string, string>>(statements: T): Readonly<T> {
  return Object.freeze(statements)
}

export function catalogHash(catalogs: ReadonlyArray<Record<string, string>>): string {
  const statements = catalogs
    .flatMap((entry) => Object.entries(entry))
    .map(([name, sql]) => `${name}:${sql.replace(/\s+/g, ' ').trim()}`)
    .sort()
  return createHash('sha256').update(statements.join('\n'), 'utf8').digest('hex')
}

/* ------------------------------------------------------------- error map */

interface DatabaseFailure {
  code?: string
  constraint?: string
  message?: string
}

/**
 * Maps a driver failure onto the port's taxonomy.
 *
 * What is deliberately dropped: `error.detail`, which PostgreSQL populates with
 * the offending key VALUES — `Key (case_id)=(case-1) already exists` — and
 * `error.query`, which contains the statement. Both are exactly the kind of
 * thing that ends up pasted into an issue, and both can carry institutional
 * content. What survives is the constraint NAME, which is a schema identifier
 * and bounded.
 */
export function mapDatabaseError(
  error: unknown,
  operation: string,
  correlationId?: string,
): StorageError {
  if (error instanceof StorageError) return error
  if (error instanceof TransactionClosedError) throw error

  const failure = error as DatabaseFailure
  const constraint = failure.constraint ?? 'unknown'

  switch (failure.code) {
    case '23505':
      return new DuplicateRecordError(constraint, operation, correlationId)
    case '23503':
      return new ReferentialIntegrityError(constraint, operation, correlationId)
    case '23502':
    case '23514':
    case '23P01':
      return new InvariantViolationError(constraint, operation, correlationId)
    case 'P0001':
      // Our own RAISE, from the immutability and scope triggers. The message is
      // ours and was written to be shown; it names records, never content.
      return new ImmutableRecordError(
        failure.message ?? 'a sealed record',
        operation,
        correlationId,
      )
    case '40001':
      return new RetryableStorageError('serialization-failure', operation, correlationId)
    case '40P01':
      return new RetryableStorageError('deadlock', operation, correlationId)
    case '42501':
      return new StoragePermissionError(operation, correlationId)
    case '57014':
      return new StorageError(
        `"${operation}" exceeded the statement timeout`,
        operation,
        correlationId,
      )
    default:
      break
  }

  if (failure.code?.startsWith('08') || failure.code === 'ECONNRESET') {
    return new StorageUnavailableError(operation, correlationId)
  }
  /*
   * Category only. The driver's message can contain the statement, so it is
   * not propagated — the SQLSTATE is what an operator needs to classify it,
   * and the correlation id is how the occurrence is found.
   */
  return new StorageError(
    `"${operation}" failed with an unmapped database error` +
      (failure.code ? ` (SQLSTATE ${failure.code})` : ''),
    operation,
    correlationId,
  )
}

/** Category label for the error metric. Bounded — never a message. */
export function errorCategory(error: StorageError): string {
  return error.name.replace(/Error$/, '').toLowerCase()
}

/* ------------------------------------------------------------------- run */

/**
 * Executes one statement, measured and mapped.
 *
 * Slow statements log their operation, duration and row count. Never the SQL
 * and never the parameters: parameters carry case ids, thesis statements,
 * rationales and evidence payloads.
 */
export async function run<R extends QueryResultRow = QueryResultRow>(
  client: Queryable,
  context: SqlContext,
  operation: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  const startedAt = Date.now()
  try {
    const result = await client.query<R>(text, values)
    const durationMs = Date.now() - startedAt

    context.metrics.observe(ANALYSIS_DB_METRIC.queryLatency, durationMs, { operation })
    if (durationMs >= context.slowQueryMs) {
      context.metrics.increment(ANALYSIS_DB_METRIC.querySlow, { operation })
      context.logger.slowQuery({
        operation,
        durationMs,
        correlationId: context.correlationId,
        rowCount: result.rows.length,
      })
    }
    return result.rows
  } catch (error) {
    const mapped = mapDatabaseError(error, operation, context.correlationId)
    context.metrics.increment(ANALYSIS_DB_METRIC.error, {
      operation,
      category: errorCategory(mapped),
    })
    throw mapped
  }
}

/** One row or null. Throws when a lookup by primary key returns several. */
export async function one<R extends QueryResultRow = QueryResultRow>(
  client: Queryable,
  context: SqlContext,
  operation: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<R | null> {
  const rows = await run<R>(client, context, operation, text, values)
  if (rows.length > 1) {
    throw new MalformedRowError(
      operation,
      `expected at most one row, found ${rows.length}`,
      operation,
      context.correlationId,
    )
  }
  return rows[0] ?? null
}

export { AmbiguousCommitError, ConflictingRecordError }
