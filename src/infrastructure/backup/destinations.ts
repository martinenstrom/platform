/**
 * Where a recovery bundle goes, and the record of the last one that went.
 *
 * Two destinations: the local one under the data directory, and an external
 * folder the person chose — a USB drive, a synced folder, a network share;
 * the application names no vendor and mounts nothing. A destination that
 * is not there when it is needed is reported, never silently skipped: the
 * configuration keeps the last export and the last failure side by side,
 * and the Recovery Center shows both.
 */

import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Database } from '~/infrastructure/advisory/sqlite/database'
import type { DataLayout } from '~/infrastructure/platform/dataDir'
import { BUNDLE_EXTENSION, BundleError, createBundle, verifyBundle } from './bundle'

export type DestinationKind = 'LOCAL' | 'EXTERNAL'

export interface BackupDestination {
  kind: DestinationKind
  path: string
}

export interface ExportRecord {
  at: string
  destination: DestinationKind
  path: string
  bundleId: string
  sha256: string
  sizeBytes: number
  counts: { clients: number; offices: number; documents: number }
  /** Whether the file was opened and proved after it was written. */
  verified: boolean
}

export interface ExportFailure {
  at: string
  destination: DestinationKind
  code: 'DESTINATION_UNAVAILABLE' | 'NO_PASSPHRASE' | 'EXPORT_FAILED' | 'VERIFY_FAILED'
  detail: string
}

export interface BackupConfig {
  external: { path: string; chosenAt: string } | null
  lastExport: ExportRecord | null
  lastExportError: ExportFailure | null
  /** Unattended exports to the external destination, once a day, when a passphrase is kept. */
  dailyExport: boolean
}

export const BACKUP_CONFIG_FILE = 'backup.json'

const EMPTY: BackupConfig = {
  external: null,
  lastExport: null,
  lastExportError: null,
  dailyExport: true,
}

export function readBackupConfig(layout: DataLayout): BackupConfig {
  const path = join(layout.config, BACKUP_CONFIG_FILE)
  if (!existsSync(path)) return { ...EMPTY }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BackupConfig>
    return { ...EMPTY, ...parsed }
  } catch {
    return { ...EMPTY }
  }
}

export function writeBackupConfig(layout: DataLayout, config: BackupConfig): void {
  mkdirSync(layout.config, { recursive: true })
  const path = join(layout.config, BACKUP_CONFIG_FILE)
  const part = `${path}.part`
  writeFileSync(part, JSON.stringify(config, null, 2))
  renameSync(part, path)
}

export class DestinationError extends Error {
  constructor(
    readonly code: ExportFailure['code'],
    readonly detail: string = '',
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'DestinationError'
  }
}

/** Whether a destination can take a file right now. */
export function destinationAvailable(path: string): { ok: true } | { ok: false; detail: string } {
  if (!existsSync(path)) return { ok: false, detail: 'folder missing' }
  try {
    accessSync(path, constants.W_OK)
  } catch {
    return { ok: false, detail: 'folder not writable' }
  }
  return { ok: true }
}

export function bundleFileName(now: Date): string {
  return `financial-os-${now.toISOString().replace(/[:.]/gu, '-')}${BUNDLE_EXTENSION}`
}

export interface ExportInput {
  db: Database
  layout: DataLayout
  destination: BackupDestination
  passphrase: string
  appVersion: string
  now?: () => Date
}

/**
 * One bundle to one destination: written, then opened again and proved
 * with the same passphrase before it counts. The configuration records the
 * outcome either way.
 */
export async function exportBundle(input: ExportInput): Promise<ExportRecord> {
  const now = input.now ?? (() => new Date())
  const config = readBackupConfig(input.layout)
  const fail = (code: ExportFailure['code'], detail: string): never => {
    writeBackupConfig(input.layout, {
      ...config,
      lastExportError: { at: now().toISOString(), destination: input.destination.kind, code, detail },
    })
    throw new DestinationError(code, detail)
  }
  const available = destinationAvailable(input.destination.path)
  if (!available.ok) fail('DESTINATION_UNAVAILABLE', available.detail)
  const path = join(input.destination.path, bundleFileName(now()))
  let created
  try {
    created = await createBundle({
      db: input.db,
      documentsRoot: input.layout.documents,
      destination: path,
      passphrase: input.passphrase,
      appVersion: input.appVersion,
      now,
    })
  } catch (error) {
    return fail('EXPORT_FAILED', error instanceof Error ? error.message : String(error))
  }
  let verified = false
  try {
    const inspection = await verifyBundle(path, input.passphrase)
    verified = inspection.ok
    if (!inspection.ok)
      return fail(
        'VERIFY_FAILED',
        inspection.issues.map((i) => [i.code, i.path].filter(Boolean).join(' ')).join('; '),
      )
  } catch (error) {
    return fail(
      'VERIFY_FAILED',
      error instanceof BundleError ? error.code : error instanceof Error ? error.message : String(error),
    )
  }
  const record: ExportRecord = {
    at: now().toISOString(),
    destination: input.destination.kind,
    path,
    bundleId: created.manifest.bundleId,
    sha256: created.sha256,
    sizeBytes: created.sizeBytes,
    counts: created.manifest.counts,
    verified,
  }
  writeBackupConfig(input.layout, { ...config, lastExport: record, lastExportError: null })
  return record
}

/** Whether the daily unattended export is due: never done, or done more than a day ago. */
export function dailyExportDue(config: BackupConfig, now: Date): boolean {
  if (!config.dailyExport || !config.external) return false
  if (!config.lastExport || config.lastExport.destination !== 'EXTERNAL') return true
  return now.getTime() - Date.parse(config.lastExport.at) >= 24 * 60 * 60 * 1000
}
