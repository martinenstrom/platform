/**
 * Restoring a person's Financial OS from a bundle or a snapshot — on the
 * same computer after a loss, or on a new one.
 *
 * The primary database is never written over. What arrives is written
 * beside it under a restoring name, opened, checked and brought to the
 * application's schema there; only then is the current file moved aside
 * with its side files and the restored one renamed into place. The current
 * record, when it can still be opened, is snapshotted first; when it
 * cannot, the file moved aside is what remains of it. Documents follow the
 * same pattern: unpacked beside, each checksum proved, then swapped.
 *
 * The caller closes the live store before this runs and relaunches after.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  closeInOrder,
  inspectDatabaseFile,
  openDatabase,
} from '~/infrastructure/advisory/sqlite/database'
import { migrate } from '~/infrastructure/advisory/sqlite/migrate'
import { CURRENT_SCHEMA_VERSION } from '~/infrastructure/advisory/sqlite/schema'
import type { DataLayout } from '~/infrastructure/platform/dataDir'
import {
  BundleError,
  DATABASE_ENTRY,
  openBundle,
  readEntry,
  verifyBundle,
  type BundleErrorCode,
  type BundleManifest,
} from './bundle'
import { createSnapshot, verifySnapshot, type SnapshotMeta } from './snapshots'

export type RestoreFailureCode =
  | BundleErrorCode
  | 'VERIFY_FAILED'
  | 'MIGRATION_FAILED'
  | 'SWAP_FAILED'
  | 'SNAPSHOT_INVALID'

export interface RestoreSummary {
  source: 'bundle' | 'snapshot'
  /** The bundle's id, or the snapshot's. */
  sourceId: string
  sourceCreatedAt: string
  counts: { clients: number; offices: number; documents: number } | null
  schema: { from: number; to: number }
  documentsRestored: number
  /** The snapshot taken of the record that was replaced, when it could be read. */
  safetySnapshot: string | null
  /** Where the replaced database file was moved, when there was one. */
  replacedDatabase: string | null
  replacedDocuments: string | null
  restoredAt: string
}

export type RestoreResult =
  | { ok: true; summary: RestoreSummary }
  | { ok: false; code: RestoreFailureCode; detail: string }

export interface RestoreInput {
  layout: DataLayout
  appVersion: string
  now?: () => Date
}

/** A bundle, with its passphrase, into the data directory. */
export async function restoreFromBundle(
  input: RestoreInput & { bundlePath: string; passphrase: string },
): Promise<RestoreResult> {
  const now = input.now ?? (() => new Date())
  let inspection
  try {
    inspection = await verifyBundle(input.bundlePath, input.passphrase)
  } catch (error) {
    return failure(error)
  }
  if (!inspection.ok) {
    const first = inspection.issues[0]!
    return {
      ok: false,
      code: first.code,
      detail: [first.path, first.detail].filter(Boolean).join(' '),
    }
  }
  const bundle = await openBundle(input.bundlePath, input.passphrase)
  const stamp = now().toISOString().replace(/[:.]/gu, '-')

  /* The database, beside the live one. */
  const restoring = `${input.layout.database}.restoring`
  removeDatabaseSet(restoring)
  try {
    writeFileSync(restoring, await readEntry(bundle, DATABASE_ENTRY))
  } catch (error) {
    return failure(error)
  }
  const prepared = await prepareRestoringDatabase(restoring)
  if (!prepared.ok) {
    removeDatabaseSet(restoring)
    return prepared
  }

  /* The documents, beside the live ones, each proved. */
  const documentsRestoring = `${input.layout.documents}.restoring`
  rmSync(documentsRestoring, { recursive: true, force: true })
  mkdirSync(documentsRestoring, { recursive: true })
  let documentsRestored = 0
  try {
    for (const entry of bundle.manifest.entries) {
      if (!entry.path.startsWith('documents/')) continue
      const relativePath = entry.path.slice('documents/'.length)
      if (relativePath.split('/').some((part) => part === '..' || part === ''))
        throw new BundleError('CORRUPT', `entry path ${entry.path}`)
      const target = join(documentsRestoring, ...relativePath.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, await readEntry(bundle, entry.path))
      documentsRestored += 1
    }
  } catch (error) {
    removeDatabaseSet(restoring)
    rmSync(documentsRestoring, { recursive: true, force: true })
    return failure(error)
  }

  /* The record that is being replaced: snapshotted when readable, moved aside regardless. */
  const safetySnapshot = await safetySnapshotOf(input, 'bundle', now)
  const swapped = swapDatabase(input.layout.database, restoring, stamp)
  if (!swapped.ok) {
    rmSync(documentsRestoring, { recursive: true, force: true })
    return swapped
  }
  let replacedDocuments: string | null = null
  if (existsSync(input.layout.documents)) {
    replacedDocuments = `${input.layout.documents}.replaced-${stamp}`
    renameSync(input.layout.documents, replacedDocuments)
  }
  renameSync(documentsRestoring, input.layout.documents)
  for (const dir of [input.layout.meetingPacks, input.layout.reports, input.layout.attachments])
    mkdirSync(dir, { recursive: true })

  return {
    ok: true,
    summary: {
      source: 'bundle',
      sourceId: bundle.manifest.bundleId,
      sourceCreatedAt: bundle.manifest.createdAt,
      counts: bundle.manifest.counts,
      schema: { from: bundle.manifest.schemaVersion, to: prepared.schemaVersion },
      documentsRestored,
      safetySnapshot,
      replacedDatabase: swapped.replaced,
      replacedDocuments,
      restoredAt: now().toISOString(),
    },
  }
}

/** A local snapshot back into place: the database only; documents stay as they are. */
export async function restoreFromSnapshot(
  input: RestoreInput & { snapshot: SnapshotMeta },
): Promise<RestoreResult> {
  const now = input.now ?? (() => new Date())
  const verification = verifySnapshot(input.snapshot)
  if (!verification.ok)
    return {
      ok: false,
      code: 'SNAPSHOT_INVALID',
      detail:
        verification.checksum === 'mismatch' ? 'checksum mismatch' : verification.quickCheck,
    }
  const stamp = now().toISOString().replace(/[:.]/gu, '-')
  const restoring = `${input.layout.database}.restoring`
  removeDatabaseSet(restoring)
  copyFileSync(input.snapshot.path, restoring)
  const prepared = await prepareRestoringDatabase(restoring)
  if (!prepared.ok) {
    removeDatabaseSet(restoring)
    return prepared
  }
  const safetySnapshot = await safetySnapshotOf(input, 'snapshot', now)
  const swapped = swapDatabase(input.layout.database, restoring, stamp)
  if (!swapped.ok) return swapped
  return {
    ok: true,
    summary: {
      source: 'snapshot',
      sourceId: input.snapshot.id,
      sourceCreatedAt: input.snapshot.createdAt,
      counts: verification.counts,
      schema: { from: verification.schemaVersion, to: prepared.schemaVersion },
      documentsRestored: 0,
      safetySnapshot,
      replacedDatabase: swapped.replaced,
      replacedDocuments: null,
      restoredAt: now().toISOString(),
    },
  }
}

/* --------------------------------------------------------------- pieces */

/** Open the restoring file, check it, bring it to the application's schema, close it in order. */
async function prepareRestoringDatabase(
  path: string,
): Promise<{ ok: true; schemaVersion: number } | Extract<RestoreResult, { ok: false }>> {
  let inspection
  try {
    inspection = inspectDatabaseFile(path)
  } catch (error) {
    return failure(error, 'VERIFY_FAILED')
  }
  if (inspection.quickCheck !== 'ok' || inspection.foreignKeyViolations > 0)
    return { ok: false, code: 'VERIFY_FAILED', detail: inspection.quickCheck }
  if (inspection.schemaVersion > CURRENT_SCHEMA_VERSION)
    return {
      ok: false,
      code: 'SCHEMA_TOO_NEW',
      detail: `file v${inspection.schemaVersion}, application v${CURRENT_SCHEMA_VERSION}`,
    }
  const db = openDatabase(path)
  try {
    const migration = await migrate(db)
    if (!migration.ok)
      return {
        ok: false,
        code: 'MIGRATION_FAILED',
        detail: migration.code === 'MIGRATION_FAILED' ? migration.message : migration.code,
      }
    return { ok: true, schemaVersion: migration.to }
  } finally {
    closeInOrder(db)
  }
}

/** The live record snapshotted before it is replaced — when it can still be read. */
async function safetySnapshotOf(
  input: RestoreInput,
  _source: 'bundle' | 'snapshot',
  now: () => Date,
): Promise<string | null> {
  if (!existsSync(input.layout.database)) return null
  try {
    const live = openDatabase(input.layout.database)
    try {
      const meta = await createSnapshot(live, input.layout.snapshots, {
        trigger: 'pre-restore',
        appVersion: input.appVersion,
        now,
      })
      return meta.path
    } finally {
      closeInOrder(live)
    }
  } catch {
    return null
  }
}

/**
 * The swap: the current file and its side files moved aside under one
 * suffix (so they stay a consistent set should anyone open them), then the
 * restoring file renamed into place. Two renames; no copy of the primary.
 */
function swapDatabase(
  database: string,
  restoring: string,
  stamp: string,
): { ok: true; replaced: string | null } | Extract<RestoreResult, { ok: false }> {
  try {
    let replaced: string | null = null
    if (existsSync(database)) {
      replaced = `${database}.replaced-${stamp}`
      renameSync(database, replaced)
      for (const side of ['-wal', '-shm', '-journal']) {
        if (existsSync(`${database}${side}`))
          renameSync(`${database}${side}`, `${replaced}${side}`)
      }
    }
    renameSync(restoring, database)
    /* The restoring file was closed in order; its own side files, if any linger, must not follow it. */
    for (const side of ['-wal', '-shm', '-journal']) {
      if (existsSync(`${restoring}${side}`)) unlinkSync(`${restoring}${side}`)
    }
    return { ok: true, replaced }
  } catch (error) {
    return failure(error, 'SWAP_FAILED')
  }
}

function removeDatabaseSet(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (existsSync(`${path}${suffix}`)) unlinkSync(`${path}${suffix}`)
  }
}

function failure(
  error: unknown,
  fallback: RestoreFailureCode = 'CORRUPT',
): Extract<RestoreResult, { ok: false }> {
  if (error instanceof BundleError) return { ok: false, code: error.code, detail: error.detail }
  return {
    ok: false,
    code: fallback,
    detail: error instanceof Error ? error.message : String(error),
  }
}

export type { BundleManifest }
