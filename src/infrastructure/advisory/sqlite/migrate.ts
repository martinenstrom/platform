/**
 * Versioned schema migrations for the relationship record.
 *
 * On open: the version in the file is read; a file ahead of the application
 * is refused; each pending migration runs in its own transaction and is
 * recorded with the checksum of its SQL; the result is verified. A
 * migration that fails rolls back and leaves the file as it was — the
 * caller decides what to tell the person. The pre-migration snapshot is
 * the caller's (it knows the backup directory); this module only says
 * whether one is warranted.
 */

import { createHash } from 'node:crypto'
import {
  inTransaction,
  quickIntegrity,
  schemaVersion,
  setSchemaVersion,
  type Database,
} from './database'
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, type SchemaMigration } from './schema'

export type MigrationOutcome =
  | { ok: true; from: number; to: number; applied: readonly number[] }
  | { ok: false; code: 'SCHEMA_TOO_NEW'; fileVersion: number; appVersion: number }
  | { ok: false; code: 'CHECKSUM_MISMATCH'; version: number }
  | { ok: false; code: 'MIGRATION_FAILED'; version: number; message: string }
  | { ok: false; code: 'VERIFICATION_FAILED'; detail: string }

export function checksumOf(migration: SchemaMigration): string {
  return createHash('sha256').update(migration.sql).digest('hex')
}

/** What the file needs before it can be used: nothing, migrations, or a refusal. */
export function migrationPlan(
  db: Database,
  migrations: readonly SchemaMigration[] = MIGRATIONS,
): { from: number; pending: readonly SchemaMigration[]; tooNew: boolean } {
  const from = schemaVersion(db)
  const latest = migrations[migrations.length - 1]?.version ?? 0
  return {
    from,
    pending: migrations.filter((m) => m.version > from),
    tooNew: from > latest,
  }
}

export async function migrate(
  db: Database,
  migrations: readonly SchemaMigration[] = MIGRATIONS,
): Promise<MigrationOutcome> {
  const plan = migrationPlan(db, migrations)
  const appVersion = migrations[migrations.length - 1]?.version ?? CURRENT_SCHEMA_VERSION
  if (plan.tooNew) {
    return { ok: false, code: 'SCHEMA_TOO_NEW', fileVersion: plan.from, appVersion }
  }
  ensureHistoryTable(db)
  /* A recorded migration whose SQL has changed since is a different schema than the one on disk. */
  for (const applied of appliedMigrations(db)) {
    const known = migrations.find((m) => m.version === applied.version)
    if (known && checksumOf(known) !== applied.checksum) {
      return { ok: false, code: 'CHECKSUM_MISMATCH', version: applied.version }
    }
  }
  const applied: number[] = []
  for (const migration of plan.pending) {
    try {
      await inTransaction(db, async () => {
        db.exec(migration.sql)
        db.prepare(
          'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        ).run(
          migration.version,
          migration.name,
          checksumOf(migration),
          new Date().toISOString(),
        )
        setSchemaVersion(db, migration.version)
      })
      applied.push(migration.version)
    } catch (error) {
      return {
        ok: false,
        code: 'MIGRATION_FAILED',
        version: migration.version,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const integrity = quickIntegrity(db)
  if (integrity.quickCheck !== 'ok' || integrity.foreignKeyViolations > 0) {
    return {
      ok: false,
      code: 'VERIFICATION_FAILED',
      detail: `${integrity.quickCheck}; ${integrity.foreignKeyViolations} foreign-key violation(s)`,
    }
  }
  const to = schemaVersion(db)
  if (to !== appVersion) {
    return {
      ok: false,
      code: 'VERIFICATION_FAILED',
      detail: `version ${to}, expected ${appVersion}`,
    }
  }
  return { ok: true, from: plan.from, to, applied }
}

function ensureHistoryTable(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
}

export function appliedMigrations(
  db: Database,
): readonly { version: number; name: string; checksum: string; appliedAt: string }[] {
  ensureHistoryTable(db)
  return (
    db
      .prepare(
        'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
      )
      .all() as { version: number; name: string; checksum: string; applied_at: string }[]
  ).map((row) => ({
    version: Number(row.version),
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }))
}
