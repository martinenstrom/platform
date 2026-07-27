/**
 * The transaction boundary and the lifetime guard.
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
 * A transaction's liveness, shared by every repository scoped to it.
 *
 * Two fields rather than one, deliberately. `open` is the flag the guard
 * reads; `client` is nulled at the same moment so that even if a future edit
 * forgets the flag, there is no connection left to query. The failure mode
 * being prevented is severe and quiet: a repository captured inside the
 * callback and called afterwards would otherwise run against a connection that
 * has been committed, rolled back, or **handed to a different caller** — which
 * would write into someone else's transaction.
 */
export interface Scope {
  open: boolean
  client: Queryable | null
}

/** A scope for work outside any transaction. Always open, always the pool. */
export function poolScope(pool: Pool): Scope {
  return { open: true, client: pool as unknown as Queryable }
}

/**
 * Asserts the scope is usable and returns its client.
 *
 * Checked **before any I/O**, and application-level rather than relying on the
 * driver to throw after `release()`. Relying on the driver would make the
 * failure a driver-detail message, would make it timing-dependent, and — worst
 * — would not fire at all if the client had already been reissued.
 */
export function activeClient(scope: Scope, operation: string): Queryable {
  if (!scope.open || scope.client === null) {
    throw new TransactionClosedError(operation)
  }
  return scope.client
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    /*
     * The connection may already be unusable — which is itself a rollback, since
     * an uncommitted transaction on a dropped connection is discarded. The
     * original error is the one worth surfacing.
     */
  }
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

  const scope: Scope = { open: true, client }
  let committing = false

  try {
    await client.query('BEGIN')
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
      // The COMMIT was sent and its outcome is unknown. Not retryable: only
      // the caller knows whether its command has an idempotency identity.
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
