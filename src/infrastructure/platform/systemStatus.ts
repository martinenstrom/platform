/**
 * What the Recovery Center, the first-run page and the shell's notice read:
 * one typed account of the system — which mode, which store, where the
 * data lives, whether the record opened and why not, when it was last
 * snapshotted and last exported, whether a passphrase is kept. Codes and
 * dates, never a stack; nothing here is written to.
 */

import { existsSync, statSync } from 'node:fs'
import type { AdvisoryContext } from '~/application/advisory/ports'
import {
  advisoryStoreState,
  StoreNotInitialisedError,
} from '~/infrastructure/advisory/container'
import { recordCounts } from '~/infrastructure/advisory/sqlite/database'
import { CURRENT_SCHEMA_VERSION } from '~/infrastructure/advisory/sqlite/schema'
import type { StoreFailureCode } from '~/infrastructure/advisory/sqlite/store'
import { readBackupConfig, type BackupConfig } from '~/infrastructure/backup/destinations'
import { passphraseKeeping, type PassphraseKeeping } from '~/infrastructure/backup/secrets'
import { listSnapshots, type SnapshotMeta } from '~/infrastructure/backup/snapshots'
import {
  appVersion,
  createsOnFirstOpen,
  dataLayout,
  isDesktopHost,
  runtimeMode,
  storeKind,
  type RuntimeMode,
  type StoreKind,
} from './dataDir'

export type DatabaseState =
  /** The synthetic record: nothing on disk, nothing to back up. */
  | 'SYNTHETIC'
  /** No record yet: the first-run page decides. */
  | 'NOT_INITIALISED'
  | 'OK'
  /** The record refused to open; Recovery Mode. */
  | 'RECOVERY'

export interface SystemStatus {
  mode: RuntimeMode
  store: StoreKind
  desktop: boolean
  appVersion: string
  /** The schema this application writes. */
  schemaVersion: number
  dataRoot: string | null
  database: {
    state: DatabaseState
    path: string | null
    sizeBytes: number | null
    code: StoreFailureCode | null
    detail: string | null
    uncleanShutdown: boolean
    openedAt: string | null
    counts: { clients: number; offices: number; documents: number } | null
  }
  backups: {
    snapshotsDir: string | null
    bundlesDir: string | null
    snapshots: SnapshotMeta[]
    lastSnapshot: SnapshotMeta | null
    config: BackupConfig | null
    passphrase: PassphraseKeeping
  }
  generatedAt: string
}

/**
 * The status, opening the record through the door given when that is what
 * it takes — never when the record is not there, since opening would
 * create it, and that is the person's choice to make.
 */
export async function systemStatus(
  openContext: () => Promise<AdvisoryContext>,
  now: Date,
): Promise<SystemStatus> {
  const mode = runtimeMode()
  const store = storeKind(mode)
  const base = {
    mode,
    store,
    desktop: isDesktopHost(),
    appVersion: appVersion(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
  }
  if (store === 'synthetic') {
    return {
      ...base,
      dataRoot: null,
      database: {
        state: 'SYNTHETIC',
        path: null,
        sizeBytes: null,
        code: null,
        detail: null,
        uncleanShutdown: false,
        openedAt: advisoryStoreState()?.openedAt ?? null,
        counts: null,
      },
      backups: {
        snapshotsDir: null,
        bundlesDir: null,
        snapshots: [],
        lastSnapshot: null,
        config: null,
        passphrase: 'none',
      },
    }
  }
  const layout = dataLayout()
  const backups = {
    snapshotsDir: layout.snapshots,
    bundlesDir: layout.bundles,
    snapshots: listSnapshots(layout.snapshots),
    lastSnapshot: null as SnapshotMeta | null,
    config: readBackupConfig(layout),
    passphrase: passphraseKeeping(layout),
  }
  backups.lastSnapshot = backups.snapshots[0] ?? null
  const sizeBytes = existsSync(layout.database) ? statSync(layout.database).size : null

  if (!existsSync(layout.database) && !createsOnFirstOpen(mode) && !advisoryStoreState()?.outcome?.ok) {
    return {
      ...base,
      dataRoot: layout.root,
      database: {
        state: 'NOT_INITIALISED',
        path: layout.database,
        sizeBytes: null,
        code: 'NOT_INITIALISED',
        detail: null,
        uncleanShutdown: false,
        openedAt: null,
        counts: null,
      },
      backups,
    }
  }

  let counts: SystemStatus['database']['counts'] = null
  let failure: { code: StoreFailureCode; detail: string; uncleanShutdown: boolean } | null = null
  try {
    await openContext()
    const state = advisoryStoreState()
    if (state?.outcome?.ok) {
      try {
        counts = recordCounts(state.outcome.db)
      } catch {
        counts = null
      }
    }
  } catch (error) {
    const state = advisoryStoreState()
    if (state?.outcome && !state.outcome.ok) failure = state.outcome
    else if (error instanceof StoreNotInitialisedError)
      failure = { code: 'NOT_INITIALISED', detail: '', uncleanShutdown: false }
    else
      failure = {
        code: 'CANNOT_OPEN',
        detail: error instanceof Error ? error.message : String(error),
        uncleanShutdown: false,
      }
  }
  const state = advisoryStoreState()
  if (failure) {
    return {
      ...base,
      dataRoot: layout.root,
      database: {
        state: failure.code === 'NOT_INITIALISED' ? 'NOT_INITIALISED' : 'RECOVERY',
        path: layout.database,
        sizeBytes,
        code: failure.code,
        detail: failure.detail || null,
        uncleanShutdown: failure.uncleanShutdown,
        openedAt: null,
        counts: null,
      },
      backups,
    }
  }
  return {
    ...base,
    dataRoot: layout.root,
    database: {
      state: 'OK',
      path: layout.database,
      sizeBytes,
      code: null,
      detail: null,
      uncleanShutdown: state?.outcome?.ok ? state.outcome.uncleanShutdown : false,
      openedAt: state?.openedAt ?? null,
      counts,
    },
    backups: { ...backups, lastSnapshot: state?.lastSnapshot ?? backups.lastSnapshot },
  }
}
