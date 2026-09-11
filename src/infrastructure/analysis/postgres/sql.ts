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

/**
 * One named catalogue, as the production registry holds it.
 *
 * The name is part of the hashed identity, so two catalogues that happen to
 * share a statement name -- `byId` appears in most of them -- stay
 * distinguishable. Without it, a second `byId` with the same text somewhere
 * else would collapse into the first and the hash would not move.
 */
export interface CatalogueEntry {
  name: string
  statements: Readonly<Record<string, string>>
}

/** Thrown when the production registry is malformed. */
export class CatalogueRegistrationError extends Error {
  constructor(reason: string) {
    super(`The production SQL registry is invalid: ${reason}`)
    this.name = 'CatalogueRegistrationError'
  }
}

/**
 * Validates the production registry, at module load.
 *
 * Registering a catalogue twice is REFUSED rather than deduplicated. Silently
 * collapsing it would hide a definition defect behind a hash that still looks
 * plausible -- and `COMMAND_SQL` was registered twice for two phases without
 * anything noticing, which is exactly that failure.
 */
export function registerCatalogues(
  entries: readonly CatalogueEntry[],
): readonly CatalogueEntry[] {
  const names = new Set<string>()
  const objects = new Set<object>()

  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new CatalogueRegistrationError(`"${entry.name}" is registered twice`)
    }
    if (objects.has(entry.statements)) {
      throw new CatalogueRegistrationError(
        `"${entry.name}" registers a catalogue object already registered under ` +
          `another name`,
      )
    }
    if (!Object.isFrozen(entry.statements)) {
      throw new CatalogueRegistrationError(`"${entry.name}" is not frozen`)
    }
    names.add(entry.name)
    objects.add(entry.statements)
  }

  return Object.freeze([...entries])
}

/**
 * A content address over every statement this build can issue.
 *
 * Sorted, so registration ORDER does not change the identity: reordering the
 * registry is not a change in capability. Whitespace is collapsed, so
 * reindenting a query is not one either. Nothing else is normalised -- two
 * materially different statements must never hash alike.
 */
export function catalogHash(entries: readonly CatalogueEntry[]): string {
  const statements = entries
    .flatMap((entry) =>
      Object.entries(entry.statements).map(
        ([name, sql]) => `${entry.name}.${name}:${sql.replace(/\s+/g, ' ').trim()}`,
      ),
    )
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
/**
 * Which rule the schema raised, from a fixed machine prefix.
 *
 * Every `RAISE` in this schema uses `integrity_constraint_violation`, so the
 * SQLSTATE alone cannot say whether an aggregate was invalid or an immutable
 * record was being rewritten. Those are different institutional failures and
 * the in-memory reference distinguishes them, so mapping all of them to
 * `ImmutableRecordError` made the two stores disagree about the same mistake.
 *
 * The prefixes are **schema-owned identifiers**, written in migration 0020
 * precisely to be matched on. No user-authored or institutional text influences
 * the classification, and an unknown message is not guessed into a domain error
 * -- it falls through to the conservative default.
 *
 * A message prefix is a weak identity for a rule. TD-57 replaces it with a
 * structured SQLSTATE in a later migration; until then a fitness test pins the
 * prefixes so a reword cannot silently reclassify a failure.
 */
const SCHEMA_RAISE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['decision_outcome:', 'decision_outcome'],
  ['supersession_cycle:', 'supersession_cycle'],
]

function schemaRaised(
  failure: DatabaseFailure,
  operation: string,
  correlationId?: string,
): StorageError {
  const message = failure.message ?? ''
  for (const [prefix, code] of SCHEMA_RAISE_PREFIXES) {
    if (message.startsWith(prefix)) {
      /*
       * The bounded code, never the raised text: the message interpolates a
       * decision id, and the constraint field is for schema identifiers.
       */
      return new InvariantViolationError(code, operation, correlationId)
    }
  }
  /*
   * Everything else the schema raises is a refusal to rewrite or delete a
   * sealed record -- the immutability guards in 0008 and 0020.
   */
  return new ImmutableRecordError(message || 'a sealed record', operation, correlationId)
}

/**
 * Socket errnos that mean the firm never reached its storage.
 *
 * Not SQLSTATEs and never rendered as such: the server did not answer, so it
 * had nothing to say. All five are one institutional event — storage was
 * unreachable — and the distinction between them is an operator's, not the
 * institution's.
 */
const CONNECTION_ERRNOS: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
])

export function mapDatabaseError(
  error: unknown,
  operation: string,
  correlationId?: string,
): StorageError {
  /*
   * Already mapped — a nested call, or an error the repository raised itself.
   *
   * `TransactionClosedError` deliberately has no branch here: the scope guard
   * runs before any statement is issued, so it never reaches a driver catch.
   * A branch for it would have been dead code that looked like protection.
   */
  if (error instanceof StorageError) return error

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
    /*
     * Our own RAISEs, from the immutability, scope and terminality triggers.
     *
     * `23000` is bare `integrity_constraint_violation`, which the engine never
     * emits on its own — it always uses a specific subclass — so it uniquely
     * identifies a rule this schema raised. `P0001` is plpgsql's default for a
     * RAISE without an explicit ERRCODE.
     *
     * The message is ours and was written to be shown: it names records and
     * constraints, never content.
     */
    case '23000':
    case 'P0001':
      return schemaRaised(failure, operation, correlationId)
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

  /*
   * Reachability, from either side of the socket.
   *
   * `08` is the server's own connection-exception class. The errnos are the
   * client socket's, and they arrive with no SQLSTATE at all — reporting one
   * as `(SQLSTATE ECONNREFUSED)` named a thing that does not exist and sent an
   * operator to the schema when nothing was listening on the port.
   */
  if (failure.code?.startsWith('08') || CONNECTION_ERRNOS.has(failure.code!)) {
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
