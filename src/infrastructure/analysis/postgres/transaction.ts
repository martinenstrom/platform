/**
 * The transaction boundary, the lifetime guard, and the unit of work.
 *
 * The Stage 0 contract, preserved exactly:
 *
 *   - every scoped repository shares one database transaction
 *   - a scoped repository stops working the moment the callback resolves
 *   - a callback failure rolls everything back
 *   - a commit failure propagates
 *   - no caller receives a success result before commit succeeds
 *   - nested transactions are unavailable through the scoped interface
 */

import type { Pool, PoolClient } from 'pg'
import { TransactionClosedError } from '~/application/analysis/repositories'
import {
  ANALYSIS_DB_METRIC,
  type StorageMetrics,
} from '~/application/analysis/storageObservability'
import { AmbiguousCommitError, type Queryable } from './sql'

/**
 * `READ COMMITTED`, stated rather than inherited.
 *
 * The idempotency design depends on it: `INSERT … ON CONFLICT DO NOTHING`
 * followed by `SELECT` is correct only when each statement takes a fresh
 * snapshot, and under `REPEATABLE READ` the loser of a race has proof the row
 * exists and cannot read it.
 *
 * Inheriting the server default made a load-bearing semantic assumption depend
 * on a deployment setting nobody would think to check — and no test would have
 * failed, because the test cluster happens to use the default.
 */
export const BEGIN_READ_COMMITTED = 'BEGIN ISOLATION LEVEL READ COMMITTED'

/**
 * A transaction's liveness, shared by every repository scoped to it.
 *
 * `client` is set for a caller's explicit transaction and null for the ambient
 * scope, which acquires a connection per unit of work. `open` and `client` are
 * cleared together so that even if a future edit forgets the flag, there is no
 * connection left to query.
 *
 * The failure being prevented is quiet and severe: a repository captured
 * inside `withTransaction` and called afterwards would run against a
 * connection that has been committed, rolled back, or **handed to a different
 * caller** — writing into someone else's transaction.
 */
export interface Scope {
  open: boolean
  client: Queryable | null
  /** Present only on the ambient scope, which owns no connection of its own. */
  pool: Pool | null
  /** Sampled when the ambient scope acquires a connection. */
  onAcquire?: (pool: Pool) => void
}

export function poolScope(pool: Pool, onAcquire?: (pool: Pool) => void): Scope {
  return { open: true, client: null, pool, onAcquire }
}

/**
 * Asserts the scope is usable and returns its client.
 *
 * For use INSIDE a unit of work, where a connection has already been
 * established. Checked before any I/O and application-level rather than
 * relying on the driver to throw after `release()` — a driver message is not a
 * domain error, it is timing-dependent, and it would not fire at all if the
 * client had already been reissued.
 */
export function activeClient(scope: Scope, operation: string): Queryable {
  if (!scope.open) throw new TransactionClosedError(operation)
  if (scope.client) return scope.client
  if (scope.pool) return scope.pool as unknown as Queryable
  throw new TransactionClosedError(operation)
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // The connection may already be unusable — which is itself a rollback, an
    // uncommitted transaction on a dropped connection being discarded. The
    // original error is the one worth surfacing.
  }
}

/**
 * Runs one logical port operation on **one connection, in one transaction**.
 *
 * Two defects from the Stage 2 review, closed by the same mechanism.
 *
 * **Atomicity (B4).** `cases.create` issues three statements. Against a pool
 * those are three implicit transactions on up to three connections, so a crash
 * between them leaves a case with no participants — a state the in-memory
 * store cannot produce. A port method is one logical operation, and whether it
 * is atomic must not depend on the caller knowing how many statements it
 * happens to use.
 *
 * **Read consistency (H1).** The same three statements could observe three
 * different moments, assembling a case that never existed. Inside one
 * transaction they share a snapshot.
 *
 * When the caller already opened a transaction this joins it — no nesting, no
 * savepoint, and the caller's boundary stays the atomic one.
 */
export async function unitOfWork<T>(
  scope: Scope,
  operation: string,
  work: (client: Queryable) => Promise<T>,
): Promise<T> {
  if (!scope.open) throw new TransactionClosedError(operation)

  // Already inside the caller's transaction: join it.
  if (scope.client) return work(scope.client)

  if (!scope.pool) throw new TransactionClosedError(operation)
  /*
   * Sampled here as well as in `withTransaction`, because ambient reads are
   * most of the traffic — gauges that only moved during explicit transactions
   * would show an idle pool while the pool was the bottleneck.
   */
  scope.onAcquire?.(scope.pool)
  const client = await scope.pool.connect()
  try {
    await client.query(BEGIN_READ_COMMITTED)
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  } finally {
    client.release()
  }
}

/**
 * A client for an operation that is provably **one statement**.
 *
 * Wrapping a single statement in `BEGIN`/`COMMIT` triples its round trips to
 * buy a snapshot it already has — a lone statement is atomic and consistent by
 * definition. Used only where the method issues exactly one query, and each
 * call site says so.
 */
export function singleStatement(scope: Scope, operation: string): Queryable {
  return activeClient(scope, operation)
}

/** Did the failure happen while committing, with no answer either way? */
function isAmbiguousCommit(error: unknown, committing: boolean): boolean {
  if (!committing) return false
  const code = (error as { code?: string } | null)?.code
  return code === undefined || code.startsWith('08') || code === 'ECONNRESET'
}

export async function runInTransaction<T>(
  pool: Pool,
  metrics: StorageMetrics,
  scopedRepositories: (scope: Scope) => unknown,
  operation: (repositories: never) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  const acquireStartedAt = Date.now()
  const client = await pool.connect()
  metrics.observe(ANALYSIS_DB_METRIC.poolAcquireWait, Date.now() - acquireStartedAt)

  const scope: Scope = { open: true, client, pool: null }
  let committing = false

  try {
    await client.query(BEGIN_READ_COMMITTED)
    const result = await operation(scopedRepositories(scope) as never)

    committing = true
    await client.query('COMMIT')

    // Closed only after COMMIT resolves, and before the value is returned.
    scope.open = false
    scope.client = null

    metrics.increment(ANALYSIS_DB_METRIC.transaction, { outcome: 'committed' })
    metrics.observe(ANALYSIS_DB_METRIC.transactionLatency, Date.now() - startedAt, {
      outcome: 'committed',
    })
    return result
  } catch (error) {
    scope.open = false
    scope.client = null

    metrics.increment(ANALYSIS_DB_METRIC.transaction, { outcome: 'rolled-back' })
    metrics.observe(ANALYSIS_DB_METRIC.transactionLatency, Date.now() - startedAt, {
      outcome: 'rolled-back',
    })
    metrics.increment(ANALYSIS_DB_METRIC.rollback, { reason: rollbackReason(error) })
    if ((error as { code?: string }).code === '40P01') {
      metrics.increment(ANALYSIS_DB_METRIC.deadlock)
    }

    if (isAmbiguousCommit(error, committing)) {
      // The COMMIT was sent and its outcome is unknown. Not retryable: only the
      // caller knows whether its command has an idempotency identity.
      await rollbackQuietly(client)
      throw new AmbiguousCommitError('withTransaction')
    }

    await rollbackQuietly(client)
    throw error
  } finally {
    client.release()
  }
}

function rollbackReason(error: unknown): string {
  const name = (error as { name?: string } | null)?.name
  if (name === 'ConcurrencyConflictError') return 'conflict'
  const code = (error as { code?: string } | null)?.code
  if (code === '40P01') return 'deadlock'
  if (code === '40001') return 'serialization'
  return 'error'
}
