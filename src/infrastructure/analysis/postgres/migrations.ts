/**
 * The migration runner.
 *
 * Plain SQL files applied in order and recorded in `analysis.schema_migrations`.
 * No ORM and no migration framework: the schema is twenty-odd tables that
 * change rarely, and a framework would be a larger dependency than the thing
 * it manages.
 *
 * ## Forward-only
 *
 * There are no down migrations, and this runner will never undo anything. A
 * mistake is corrected by writing a new migration.
 *
 * That is a deliberate choice rather than a missing feature. A down migration
 * is written before the failure it is meant to handle, is almost never
 * executed, and is therefore almost never correct — and the one situation it
 * exists for is the one where being wrong is most expensive. Worse, most down
 * migrations for a schema like this one are `DROP TABLE` or `DROP COLUMN`
 * against institutional records that are supposed to be permanent. Rolling
 * forward is recoverable; rolling back is data loss with a plan attached.
 *
 * ## One transaction per migration
 *
 * PostgreSQL has transactional DDL, so a failed migration leaves nothing
 * behind — no half-created table, no partially granted role. A migration that
 * genuinely cannot run inside a transaction (`CREATE INDEX CONCURRENTLY` is
 * the usual one) declares itself with a directive and is run without one; the
 * declaration is required, so nobody discovers the limitation from a
 * production error message.
 *
 * ## Server only
 *
 * This module opens a database connection and reads the filesystem. It must
 * never reach a browser bundle, which the guard below and a fitness rule in
 * `src/test/importGraph.test.ts` both enforce.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Client, PoolClient } from 'pg'

/** A migration file may declare that it cannot run inside a transaction. */
const NO_TRANSACTION_DIRECTIVE = '-- migrate:no-transaction'

/** `0007_decisions_events_results.sql` → version `0007`. */
const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/

/**
 * Serializes migration runs across instances.
 *
 * Two application instances starting at once would otherwise both read an
 * empty `schema_migrations` and both try to create the same tables. The
 * arbitrary constant is this schema's lock; any other advisory lock in the
 * database uses a different one.
 */
const ADVISORY_LOCK_KEY = 8_417_209_553_001

export interface Migration {
  version: string
  name: string
  filename: string
  sql: string
  checksum: string
  transactional: boolean
}

export interface AppliedMigration {
  version: string
  name: string
  checksum: string
  appliedAt: Date
}

export interface MigrationResult {
  applied: Migration[]
  alreadyApplied: string[]
}

/** A database handle. Narrowed to what the runner uses, so tests can pass either. */
export type SqlClient = Pick<Client | PoolClient, 'query'>

/* ---------------------------------------------------------------- errors */

/*
 * Declared as fields rather than constructor parameter properties: this module
 * is imported directly by `scripts/db-migrate.ts`, which Node runs by stripping
 * types, and strip-only mode cannot compile a parameter property. Keeping the
 * runner runnable without a build step is worth the four extra lines.
 */
export class MigrationChecksumError extends Error {
  readonly version: string
  readonly expected: string
  readonly actual: string

  constructor(version: string, expected: string, actual: string) {
    super(
      `Migration ${version} has changed since it was applied.\n` +
        `  recorded: ${expected}\n` +
        `  on disk:  ${actual}\n` +
        `An applied migration is a historical fact — every database that ran it ` +
        `already has the old version's effects. Write a new migration that makes ` +
        `the change you intended; do not edit this one.`,
    )
    this.name = 'MigrationChecksumError'
    this.version = version
    this.expected = expected
    this.actual = actual
  }
}

export class MigrationFailedError extends Error {
  readonly version: string
  readonly filename: string

  constructor(version: string, filename: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(
      `Migration ${version} (${filename}) failed and was rolled back.\n` +
        `  ${detail}\n` +
        `Migrations applied before it are still applied and were NOT undone. ` +
        `Fix the migration and run again — the runner resumes at this one.`,
      { cause },
    )
    this.name = 'MigrationFailedError'
    this.version = version
    this.filename = filename
  }
}

/* --------------------------------------------------------------- loading */

/**
 * Hashes the file with line endings normalized.
 *
 * Without this, a checkout with `core.autocrlf=true` would compute a different
 * checksum from the machine that applied the migration and report a change
 * that never happened — on Windows, on the first run, every time.
 */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

export const DEFAULT_MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

/**
 * Reads and orders the migrations.
 *
 * Ordered by the numeric prefix and not by directory listing order, which is
 * filesystem-dependent — the difference only shows up on a machine whose
 * locale sorts differently, which is exactly the machine nobody tests on.
 */
export async function loadMigrations(
  directory: string = DEFAULT_MIGRATIONS_DIR,
): Promise<Migration[]> {
  const entries = await readdir(directory)
  const migrations: Migration[] = []
  const seen = new Map<string, string>()

  for (const filename of entries) {
    if (!filename.endsWith('.sql')) continue
    const match = FILENAME.exec(filename)
    if (!match) {
      throw new Error(
        `"${filename}" is not a migration. Expected NNNN_lower_snake_case.sql, ` +
          `e.g. 0011_add_something.sql.`,
      )
    }
    const [, version, name] = match as unknown as [string, string, string]

    const duplicate = seen.get(version)
    if (duplicate) {
      throw new Error(
        `Migrations ${duplicate} and ${filename} share version ${version}. ` +
          `Two developers numbered a migration at the same time; renumber one.`,
      )
    }
    seen.set(version, filename)

    const sql = await readFile(join(directory, filename), 'utf8')
    migrations.push({
      version,
      name,
      filename,
      sql,
      checksum: checksumOf(sql),
      transactional: !sql.includes(NO_TRANSACTION_DIRECTIVE),
    })
  }

  return migrations.sort((a, b) => a.version.localeCompare(b.version))
}

/* --------------------------------------------------------------- running */

/**
 * Creates the history table.
 *
 * Bootstrapped by the runner rather than by a migration, since a migration
 * cannot record itself in a table that does not exist yet.
 */
async function ensureHistory(client: SqlClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS analysis')
  await client.query(`
    CREATE TABLE IF NOT EXISTS analysis.schema_migrations (
      version      text PRIMARY KEY,
      name         text        NOT NULL,
      checksum     text        NOT NULL,
      applied_at   timestamptz NOT NULL DEFAULT now(),
      execution_ms integer     NOT NULL
    )
  `)
}

export async function appliedMigrations(client: SqlClient): Promise<AppliedMigration[]> {
  const { rows } = await client.query<{
    version: string
    name: string
    checksum: string
    applied_at: Date
  }>(
    'SELECT version, name, checksum, applied_at FROM analysis.schema_migrations ORDER BY version',
  )

  return rows.map((row) => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }))
}

/**
 * Applies every migration that has not been applied.
 *
 * Checksums are verified for the whole set BEFORE anything runs. A single
 * edited migration stops the run entirely rather than being discovered halfway
 * through, when some of the new ones have already been applied.
 */
export async function migrate(
  client: SqlClient,
  options: { directory?: string; log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Migrations run on the server. This module must not be bundled.')
  }

  const log = options.log ?? (() => {})
  const migrations = await loadMigrations(options.directory)

  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY])
  try {
    await ensureHistory(client)
    const applied = new Map(
      (await appliedMigrations(client)).map((row) => [row.version, row]),
    )

    for (const migration of migrations) {
      const previous = applied.get(migration.version)
      if (previous && previous.checksum !== migration.checksum) {
        throw new MigrationChecksumError(
          migration.version,
          previous.checksum,
          migration.checksum,
        )
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.version))
    if (pending.length === 0) {
      log(
        `schema is up to date at ${migrations[migrations.length - 1]?.version ?? 'empty'}`,
      )
      return { applied: [], alreadyApplied: [...applied.keys()] }
    }

    const done: Migration[] = []
    for (const migration of pending) {
      const startedAt = Date.now()
      if (migration.transactional) await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(
          `INSERT INTO analysis.schema_migrations (version, name, checksum, execution_ms)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt],
        )
        if (migration.transactional) await client.query('COMMIT')
      } catch (error) {
        if (migration.transactional) {
          await client.query('ROLLBACK').catch(() => {
            /* The connection may already be unusable; the original error matters. */
          })
        }
        /*
         * A non-transactional migration cannot be undone, and this runner will
         * not guess at how. The error says what ran; the fix is a new
         * migration.
         */
        throw new MigrationFailedError(migration.version, migration.filename, error)
      }
      log(`applied ${migration.version}_${migration.name} in ${Date.now() - startedAt}ms`)
      done.push(migration)
    }

    return { applied: done, alreadyApplied: [...applied.keys()] }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
  }
}
