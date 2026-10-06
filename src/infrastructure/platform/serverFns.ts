/**
 * The doors to the system itself: its status, the first-run choice, the
 * backups and the restore. The same discipline as the record's doors —
 * one function per act, bounded codes, never free text or a stack — and
 * everything that touches files happens behind a dynamic import inside
 * the handler, so none of it reaches the client bundle.
 */

import { createServerFn } from '@tanstack/react-start'
import type { RestoreResult, RestoreSummary } from '~/infrastructure/backup/restore'
import type { BundleInspection } from '~/infrastructure/backup/bundle'
import type { ExportRecord } from '~/infrastructure/backup/destinations'
import type { PassphraseKeeping } from '~/infrastructure/backup/secrets'
import type { SnapshotMeta, SnapshotVerification } from '~/infrastructure/backup/snapshots'
import type { SystemStatus } from './systemStatus'

/* The types a surface needs, published here: this module is the boundary the UI may name. */
export type { RestoreResult, RestoreSummary, BundleInspection, ExportRecord, PassphraseKeeping }
export type { SnapshotMeta, SnapshotVerification }
export type { SnapshotTrigger } from '~/infrastructure/backup/snapshots'
export type { StoreFailureCode } from '~/infrastructure/advisory/sqlite/store'
export type { SystemStatus, DatabaseState } from './systemStatus'

export type PlatformFailure =
  | 'NOT_SQLITE'
  | 'NOT_OPEN'
  | 'NO_PASSPHRASE'
  | 'PASSPHRASE_TOO_SHORT'
  | 'DESTINATION_UNAVAILABLE'
  | 'EXPORT_FAILED'
  | 'VERIFY_FAILED'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'SERVICE_UNAVAILABLE'

const MIN_PASSPHRASE = 8

async function advisoryDoors() {
  return import('~/infrastructure/advisory/serverFns')
}

/** The status of the whole system, opening the record where it can and must. */
export const getSystemStatusFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<SystemStatus> => {
    const [{ systemStatus }, doors] = await Promise.all([
      import('./systemStatus'),
      advisoryDoors(),
    ])
    return systemStatus(
      () => doors.advisoryContext(
        () => import('~/infrastructure/advisory/marketSource'),
        () => import('~/infrastructure/advisory/container'),
      ),
      doors.platformClock().now(),
    )
  },
)

export type InitialiseResponse =
  | { ok: true; created: boolean }
  | { ok: false; code: PlatformFailure | string }

/** CREATE NEW FINANCIAL OS: the empty record, written now and only now. */
export const initialiseFinancialOsFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<InitialiseResponse> => {
    try {
      const [{ initialiseFinancialOs }, doors, { workspaceAdvisorRecord }] = await Promise.all([
        import('~/infrastructure/advisory/container'),
        advisoryDoors(),
        import('~/presentation/advisory/advisorIdentity'),
      ])
      const result = await initialiseFinancialOs(doors.platformClock(), workspaceAdvisorRecord())
      if (!result.ok) return { ok: false, code: result.code }
      doors.resetAdvisoryContext()
      return { ok: true, created: result.created }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export type SnapshotResponse =
  | { ok: true; snapshot: SnapshotMeta }
  | { ok: false; code: PlatformFailure }

/** SKAPA BACKUP NU: a snapshot of the live record, verified, kept locally. */
export const createSnapshotFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<SnapshotResponse> => {
    try {
      const doors = await advisoryDoors()
      await doors.advisoryContext(
        () => import('~/infrastructure/advisory/marketSource'),
        () => import('~/infrastructure/advisory/container'),
      )
      const { snapshotIfChanged } = await import('~/infrastructure/advisory/container')
      const snapshot = await snapshotIfChanged('manual')
      return snapshot ? { ok: true, snapshot } : { ok: false, code: 'NOT_OPEN' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export interface VerifiedSnapshot {
  snapshot: SnapshotMeta
  verification: SnapshotVerification
}

export type VerifyBackupsResponse =
  | {
      ok: true
      snapshots: VerifiedSnapshot[]
      /** The last export, opened again and proved with the kept passphrase; null when there is none, or no passphrase. */
      lastExport: { record: ExportRecord; inspection: BundleInspection | null; error: string | null } | null
    }
  | { ok: false; code: PlatformFailure }

/** VERIFIERA BACKUP: every local snapshot opened and checked, and the last export proved. */
export const verifyBackupsFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<VerifyBackupsResponse> => {
    try {
      const [{ dataLayout, storeKind }, { listSnapshots, verifySnapshot }] = await Promise.all([
        import('./dataDir'),
        import('~/infrastructure/backup/snapshots'),
      ])
      if (storeKind() === 'synthetic') return { ok: false, code: 'NOT_SQLITE' }
      const layout = dataLayout()
      const snapshots = listSnapshots(layout.snapshots).map((snapshot) => ({
        snapshot,
        verification: verifySnapshot(snapshot),
      }))
      const [{ readBackupConfig }, { loadPassphrase }, { verifyBundle, BundleError }] =
        await Promise.all([
          import('~/infrastructure/backup/destinations'),
          import('~/infrastructure/backup/secrets'),
          import('~/infrastructure/backup/bundle'),
        ])
      const config = readBackupConfig(layout)
      let lastExport: Extract<VerifyBackupsResponse, { ok: true }>['lastExport'] = null
      if (config.lastExport) {
        const passphrase = loadPassphrase(layout)
        if (!passphrase) lastExport = { record: config.lastExport, inspection: null, error: 'NO_PASSPHRASE' }
        else {
          try {
            lastExport = {
              record: config.lastExport,
              inspection: await verifyBundle(config.lastExport.path, passphrase),
              error: null,
            }
          } catch (error) {
            lastExport = {
              record: config.lastExport,
              inspection: null,
              error: error instanceof BundleError ? error.code : 'VERIFY_FAILED',
            }
          }
        }
      }
      const { logger } = await import('./log')
      logger().info('backup.verified', {
        snapshots: snapshots.length,
        failing: snapshots.filter((s) => !s.verification.ok).length,
        lastExport: lastExport ? (lastExport.inspection?.ok ?? false) : null,
      })
      return { ok: true, snapshots, lastExport }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export type PassphraseResponse =
  | { ok: true; keeping: PassphraseKeeping }
  | { ok: false; code: PlatformFailure }

/** The backup passphrase, kept for unattended exports: sealed by the host where it can be. */
export const setBackupPassphraseFn = createServerFn({ method: 'POST' })
  .validator((input: { passphrase: string }) => input)
  .handler(async ({ data }): Promise<PassphraseResponse> => {
    try {
      if (data.passphrase.length < MIN_PASSPHRASE) return { ok: false, code: 'PASSPHRASE_TOO_SHORT' }
      const [{ dataLayout, storeKind }, { storePassphrase }, { logger }] = await Promise.all([
        import('./dataDir'),
        import('~/infrastructure/backup/secrets'),
        import('./log'),
      ])
      if (storeKind() === 'synthetic') return { ok: false, code: 'NOT_SQLITE' }
      const keeping = storePassphrase(dataLayout(), data.passphrase)
      logger().info('backup.passphrase.set', { keeping })
      return { ok: true, keeping }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export const clearBackupPassphraseFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<PassphraseResponse> => {
    try {
      const [{ dataLayout, storeKind }, { clearPassphrase }] = await Promise.all([
        import('./dataDir'),
        import('~/infrastructure/backup/secrets'),
      ])
      if (storeKind() === 'synthetic') return { ok: false, code: 'NOT_SQLITE' }
      clearPassphrase(dataLayout())
      return { ok: true, keeping: 'none' }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

export type DestinationResponse =
  | { ok: true; external: { path: string; chosenAt: string } | null; dailyExport: boolean }
  | { ok: false, code: PlatformFailure }

/** The external destination — a folder the person chose — and whether the daily export runs. */
export const setBackupDestinationFn = createServerFn({ method: 'POST' })
  .validator((input: { path: string | null; dailyExport?: boolean }) => input)
  .handler(async ({ data }): Promise<DestinationResponse> => {
    try {
      const [{ dataLayout, storeKind }, destinations, doors, { logger }] = await Promise.all([
        import('./dataDir'),
        import('~/infrastructure/backup/destinations'),
        advisoryDoors(),
        import('./log'),
      ])
      if (storeKind() === 'synthetic') return { ok: false, code: 'NOT_SQLITE' }
      const layout = dataLayout()
      const config = destinations.readBackupConfig(layout)
      if (data.path !== null) {
        const available = destinations.destinationAvailable(data.path)
        if (!available.ok) return { ok: false, code: 'DESTINATION_UNAVAILABLE' }
      }
      const next = {
        ...config,
        external:
          data.path === null ? null : { path: data.path, chosenAt: doors.platformClock().isoNow() },
        dailyExport: data.dailyExport ?? config.dailyExport,
      }
      destinations.writeBackupConfig(layout, next)
      logger().info('backup.destination.set', {
        external: next.external !== null,
        dailyExport: next.dailyExport,
      })
      return { ok: true, external: next.external, dailyExport: next.dailyExport }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type ExportResponse =
  | { ok: true; record: ExportRecord }
  | { ok: false; code: PlatformFailure; detail?: string }

/**
 * EXPORTERA KRYPTERAD BACKUP: a bundle to the external destination, or to
 * the local bundles folder when none is chosen; with the passphrase given
 * now, or the one kept.
 */
export const exportBundleFn = createServerFn({ method: 'POST' })
  .validator((input: { passphrase?: string; to?: 'EXTERNAL' | 'LOCAL'; path?: string }) => input)
  .handler(async ({ data }): Promise<ExportResponse> => {
    try {
      const doors = await advisoryDoors()
      await doors.advisoryContext(
        () => import('~/infrastructure/advisory/marketSource'),
        () => import('~/infrastructure/advisory/container'),
      )
      const [{ liveDatabase }, destinations, { loadPassphrase, storePassphrase }, { appVersion }, { logger }] =
        await Promise.all([
          import('~/infrastructure/advisory/container'),
          import('~/infrastructure/backup/destinations'),
          import('~/infrastructure/backup/secrets'),
          import('./dataDir'),
          import('./log'),
        ])
      const live = liveDatabase()
      if (!live) return { ok: false, code: 'NOT_OPEN' }
      let passphrase = data.passphrase?.length ? data.passphrase : loadPassphrase(live.layout)
      if (!passphrase) return { ok: false, code: 'NO_PASSPHRASE' }
      if (passphrase.length < MIN_PASSPHRASE) return { ok: false, code: 'PASSPHRASE_TOO_SHORT' }
      if (data.passphrase?.length) storePassphrase(live.layout, data.passphrase)
      const config = destinations.readBackupConfig(live.layout)
      const destination =
        data.path
          ? { kind: 'EXTERNAL' as const, path: data.path }
          : data.to === 'LOCAL' || !config.external
            ? { kind: 'LOCAL' as const, path: live.layout.bundles }
            : { kind: 'EXTERNAL' as const, path: config.external.path }
      try {
        const record = await destinations.exportBundle({
          db: live.db,
          layout: live.layout,
          destination,
          passphrase,
          appVersion: appVersion(),
          now: () => doors.platformClock().now(),
        })
        passphrase = ''
        logger().info('backup.export', {
          destination: destination.kind,
          bundleId: record.bundleId,
          verified: record.verified,
          sizeBytes: record.sizeBytes,
        })
        return { ok: true, record }
      } catch (error) {
        logger().error('backup.export.failed', error, { destination: destination.kind })
        if (error instanceof destinations.DestinationError)
          return { ok: false, code: error.code, detail: error.detail }
        return { ok: false, code: 'EXPORT_FAILED' }
      }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type InspectBundleResponse =
  | { ok: true; inspection: BundleInspection }
  | { ok: false; code: string; detail?: string }

/** A bundle read and proved before anything is restored: its date, its counts, its schema, every checksum. */
export const inspectBundleFn = createServerFn({ method: 'POST' })
  .validator((input: { path: string; passphrase: string }) => input)
  .handler(async ({ data }): Promise<InspectBundleResponse> => {
    try {
      const { verifyBundle, BundleError } = await import('~/infrastructure/backup/bundle')
      try {
        return { ok: true, inspection: await verifyBundle(data.path, data.passphrase) }
      } catch (error) {
        if (error instanceof BundleError) return { ok: false, code: error.code, detail: error.detail }
        return { ok: false, code: 'CORRUPT' }
      }
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type RestoreResponse = RestoreResult

/**
 * ÅTERSTÄLL FRÅN BACKUP: the live record closed in order, the bundle
 * brought in beside it and swapped into place; the next door — or the
 * relaunched desktop — opens the restored record.
 */
export const restoreFromBundleFn = createServerFn({ method: 'POST' })
  .validator((input: { path: string; passphrase: string }) => input)
  .handler(async ({ data }): Promise<RestoreResponse> => {
    try {
      const [{ dataLayout, storeKind, appVersion }, { shutdownAdvisoryStore }, { restoreFromBundle }, doors, { logger }] =
        await Promise.all([
          import('./dataDir'),
          import('~/infrastructure/advisory/container'),
          import('~/infrastructure/backup/restore'),
          advisoryDoors(),
          import('./log'),
        ])
      if (storeKind() === 'synthetic') return { ok: false, code: 'CORRUPT', detail: 'synthetic record' }
      const layout = dataLayout()
      await shutdownAdvisoryStore()
      doors.resetAdvisoryContext()
      const result = await restoreFromBundle({
        bundlePath: data.path,
        passphrase: data.passphrase,
        layout,
        appVersion: appVersion(),
        now: () => doors.platformClock().now(),
      })
      if (result.ok) logger().info('restore.bundle', summaryFields(result.summary))
      else logger().error('restore.bundle.failed', undefined, { code: result.code, detail: result.detail })
      return result
    } catch {
      return { ok: false, code: 'CORRUPT', detail: 'service unavailable' }
    }
  })

/** A local snapshot back into place — Recovery Mode's first offer. */
export const restoreFromSnapshotFn = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<RestoreResponse> => {
    try {
      const [{ dataLayout, storeKind, appVersion }, { shutdownAdvisoryStore }, { restoreFromSnapshot }, { listSnapshots }, doors, { logger }] =
        await Promise.all([
          import('./dataDir'),
          import('~/infrastructure/advisory/container'),
          import('~/infrastructure/backup/restore'),
          import('~/infrastructure/backup/snapshots'),
          advisoryDoors(),
          import('./log'),
        ])
      if (storeKind() === 'synthetic') return { ok: false, code: 'SNAPSHOT_INVALID', detail: 'synthetic record' }
      const layout = dataLayout()
      const snapshot = listSnapshots(layout.snapshots).find((s) => s.id === data.id)
      if (!snapshot) return { ok: false, code: 'SNAPSHOT_INVALID', detail: 'not found' }
      await shutdownAdvisoryStore()
      doors.resetAdvisoryContext()
      const result = await restoreFromSnapshot({
        snapshot,
        layout,
        appVersion: appVersion(),
        now: () => doors.platformClock().now(),
      })
      if (result.ok) logger().info('restore.snapshot', summaryFields(result.summary))
      else logger().error('restore.snapshot.failed', undefined, { code: result.code, detail: result.detail })
      return result
    } catch {
      return { ok: false, code: 'SNAPSHOT_INVALID', detail: 'service unavailable' }
    }
  })

function summaryFields(summary: RestoreSummary): Record<string, unknown> {
  return {
    source: summary.source,
    sourceId: summary.sourceId,
    schemaFrom: summary.schema.from,
    schemaTo: summary.schema.to,
    documentsRestored: summary.documentsRestored,
    safetySnapshot: summary.safetySnapshot !== null,
  }
}
