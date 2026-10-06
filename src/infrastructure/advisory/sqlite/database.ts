/**
 * The database file, opened for a personal desktop: write-ahead logging so
 * a crash mid-write leaves the last committed state, foreign keys enforced,
 * a busy timeout rather than an immediate error, and every multi-record act
 * inside one immediate transaction. The checks a startup and a backup rely
 * on are here too, so no other module speaks PRAGMA.
 *
 * Node's own SQLite binding: the same driver in the test runtime and in the
 * desktop host, no native module to rebuild.
 */

import { existsSync } from 'node:fs'
import type { DatabaseSync as DatabaseSyncType, backup as backupType } from 'node:sqlite'

/*
 * `node:sqlite` is reached through the process, not a static import: the
 * client build follows the composition root's dynamic import into this
 * module while it maps the graph, and a named import from a builtin it does
 * not know how to stub is a hard error there — whereas the module is never
 * part of the browser bundle. Every other builtin here is one Vite stubs.
 */
const sqlite = (
  process as unknown as { getBuiltinModule(id: string): unknown }
).getBuiltinModule('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType
  backup: typeof backupType
}
const { DatabaseSync, backup } = sqlite

export type Database = DatabaseSyncType

export interface OpenOptions {
  /** Open read-only (a verification, a bundle's snapshot). */
  readonly?: boolean
}

export function openDatabase(path: string, options: OpenOptions = {}): Database {
  const db = new DatabaseSync(path, { readOnly: options.readonly === true })
  if (!options.readonly) {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}

/** An in-memory database with the same settings: tests, and the contract. */
export function openMemoryDatabase(): Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

/**
 * One unit of work. `BEGIN IMMEDIATE` takes the write lock up front, so a
 * second writer waits rather than failing halfway; the work's throw rolls
 * everything back. Nests: an inner call joins the outer transaction.
 */
export async function inTransaction<T>(db: Database, work: () => Promise<T>): Promise<T> {
  if (depthOf(db) > 0) {
    enter(db)
    try {
      return await work()
    } finally {
      leave(db)
    }
  }
  db.exec('BEGIN IMMEDIATE')
  enter(db)
  try {
    const result = await work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* already rolled back by the failure itself */
    }
    throw error
  } finally {
    leave(db)
  }
}

const depths = new WeakMap<Database, number>()
const depthOf = (db: Database) => depths.get(db) ?? 0
const enter = (db: Database) => depths.set(db, depthOf(db) + 1)
const leave = (db: Database) => depths.set(db, Math.max(0, depthOf(db) - 1))

export interface IntegrityReport {
  quickCheck: 'ok' | string
  foreignKeyViolations: number
}

/** The light check a startup runs: a quick page scan and the foreign keys. */
export function quickIntegrity(db: Database): IntegrityReport {
  const rows = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[]
  const first = rows[0]?.quick_check ?? 'no result'
  const violations = db.prepare('PRAGMA foreign_key_check').all().length
  return {
    quickCheck:
      rows.length === 1 && first === 'ok'
        ? 'ok'
        : rows.map((r) => r.quick_check).join('; '),
    foreignKeyViolations: violations,
  }
}

/** The deep check: every page, every index, run on demand, never on every start. */
export function fullIntegrity(db: Database): string {
  const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]
  return rows.length === 1 && rows[0]?.integrity_check === 'ok'
    ? 'ok'
    : rows.map((r) => r.integrity_check).join('; ')
}

export function schemaVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return Number(row.user_version)
}

export function setSchemaVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${Math.trunc(version)}`)
}

/**
 * A consistent copy of the live database, page by page through SQLite's
 * online backup, while the application keeps running. Never a file copy of
 * a database in use.
 */
export async function snapshotTo(db: Database, destination: string): Promise<void> {
  await backup(db, destination)
}

/** Whether a database file stands at the path — the first-run question. */
export function databaseExists(path: string): boolean {
  return existsSync(path)
}

/** A leftover write-ahead log before the first open: the last session did not close in order. */
export function hadUncleanShutdown(path: string): boolean {
  return existsSync(`${path}-wal`)
}

/**
 * Fold the write-ahead log back into the file and truncate it, so the file
 * alone is the database — before a controlled close, before the file is
 * moved aside, before anything reads it as a plain file.
 */
export function checkpoint(db: Database): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

/** Rows this connection has changed since it opened: unchanged between two readings means nothing was written. */
export function totalChanges(db: Database): number {
  const row = db.prepare('SELECT total_changes() AS changes').get() as { changes: number }
  return Number(row.changes)
}

/** Close in order: checkpoint, then close, so no -wal file is left to be read as an unclean end. */
export function closeInOrder(db: Database): void {
  try {
    checkpoint(db)
  } finally {
    db.close()
  }
}

/**
 * A copy made by the backup API inherits the live file's write-ahead mode.
 * A snapshot or a bundle's database must be one self-contained file, so
 * the copy is switched to the rollback journal before it is kept.
 */
export function makeSelfContained(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA journal_mode = DELETE')
  } finally {
    db.close()
  }
}

export interface FileInspection {
  quickCheck: 'ok' | string
  foreignKeyViolations: number
  schemaVersion: number
  /** Rows in the tables a person counts their record by; absent where the table is not there yet. */
  counts: { clients: number; offices: number; documents: number } | null
}

/** A database file read without being changed: its integrity, its schema version, its counts. */
export function inspectDatabaseFile(path: string): FileInspection {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const integrity = quickIntegrity(db)
    let counts: FileInspection['counts'] = null
    try {
      counts = recordCounts(db)
    } catch {
      counts = null
    }
    return { ...integrity, schemaVersion: schemaVersion(db), counts }
  } finally {
    db.close()
  }
}

/** How much of a record there is: what a backup's summary and a restore's confirmation say. */
export function recordCounts(db: Database): { clients: number; offices: number; documents: number } {
  const count = (table: string) =>
    Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n)
  return {
    clients: count('clients'),
    offices: count('offices'),
    documents: count('generated_documents'),
  }
}
