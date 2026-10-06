/**
 * Opening the relationship record for use: the file opened with its
 * pragmas, an unclean last session noticed, a pre-migration snapshot taken
 * when the schema is behind and the file holds anything, the migrations
 * applied and verified, the repositories bound. A refusal is a typed
 * outcome the caller shows as Recovery Mode — never a thrown stack.
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AdvisoryRepositories } from '~/application/advisory/ports'
import {
  hadUncleanShutdown,
  openDatabase,
  quickIntegrity,
  schemaVersion,
  snapshotTo,
  type Database,
} from './database'
import { migrate, migrationPlan, type MigrationOutcome } from './migrate'
import { createSqliteAdvisoryRepositories } from './repositories'

export interface OpenStoreOptions {
  /** Where a pre-migration snapshot is written; none is taken without it. */
  preMigrationDir?: string
  now?: () => Date
  /**
   * Whether an absent file is created. False for a person's Financial OS,
   * which starts at the setup choice: an absent file is then
   * `NOT_INITIALISED`, and nothing is written.
   */
  createIfMissing?: boolean
}

export interface OpenedStore {
  ok: true
  db: Database
  repositories: AdvisoryRepositories
  path: string
  /** True when the file was created by this open. */
  created: boolean
  uncleanShutdown: boolean
  migration: Extract<MigrationOutcome, { ok: true }>
  preMigrationSnapshot: string | null
}

export type OpenStoreOutcome =
  | OpenedStore
  | {
      ok: false
      code:
        | 'NOT_INITIALISED'
        | 'SCHEMA_TOO_NEW'
        | 'CHECKSUM_MISMATCH'
        | 'MIGRATION_FAILED'
        | 'VERIFICATION_FAILED'
        | 'INTEGRITY_FAILED'
        | 'CANNOT_OPEN'
      detail: string
      uncleanShutdown: boolean
    }

export type StoreFailureCode = Extract<OpenStoreOutcome, { ok: false }>['code']

export async function openAdvisoryStore(
  path: string,
  options: OpenStoreOptions = {},
): Promise<OpenStoreOutcome> {
  const existed = existsSync(path)
  if (!existed && options.createIfMissing === false) {
    return {
      ok: false,
      code: 'NOT_INITIALISED',
      detail: 'no database file',
      uncleanShutdown: false,
    }
  }
  const uncleanShutdown = existed && hadUncleanShutdown(path)
  let db: Database
  try {
    db = openDatabase(path)
  } catch (error) {
    return { ok: false, code: 'CANNOT_OPEN', detail: describe(error), uncleanShutdown }
  }
  try {
    if (existed) {
      const integrity = quickIntegrity(db)
      if (integrity.quickCheck !== 'ok' || integrity.foreignKeyViolations > 0) {
        db.close()
        return {
          ok: false,
          code: 'INTEGRITY_FAILED',
          detail:
            integrity.quickCheck !== 'ok'
              ? integrity.quickCheck
              : `${integrity.foreignKeyViolations} foreign key violations`,
          uncleanShutdown,
        }
      }
    }
    let preMigrationSnapshot: string | null = null
    const plan = migrationPlan(db)
    if (
      existed &&
      plan.pending.length > 0 &&
      !plan.tooNew &&
      options.preMigrationDir &&
      statSync(path).size > 0 &&
      schemaVersion(db) > 0
    ) {
      const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/gu, '-')
      preMigrationSnapshot = join(options.preMigrationDir, `v${plan.from}-${stamp}.db`)
      await snapshotTo(db, preMigrationSnapshot)
    }
    const migration = await migrate(db)
    if (!migration.ok) {
      db.close()
      return {
        ok: false,
        code: migration.code,
        detail:
          migration.code === 'MIGRATION_FAILED'
            ? `v${migration.version}: ${migration.message}`
            : migration.code === 'SCHEMA_TOO_NEW'
              ? `file v${migration.fileVersion}, application v${migration.appVersion}`
              : migration.code === 'CHECKSUM_MISMATCH'
                ? `v${migration.version}`
                : migration.detail,
        uncleanShutdown,
      }
    }
    return {
      ok: true,
      db,
      repositories: createSqliteAdvisoryRepositories(db),
      path,
      created: !existed,
      uncleanShutdown,
      migration,
      preMigrationSnapshot,
    }
  } catch (error) {
    db.close()
    return { ok: false, code: 'CANNOT_OPEN', detail: describe(error), uncleanShutdown }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
