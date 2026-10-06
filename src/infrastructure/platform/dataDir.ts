/**
 * Where the application keeps a person's data, and which mode it runs in.
 *
 * The desktop host tells the application both through the environment
 * before it loads (`FINANCIAL_OS_MODE=desktop`, `FINANCIAL_OS_DATA_DIR=…`).
 * Development without the host keeps today's synthetic record unless the
 * SQLite store is asked for; a test points the directory at a temporary
 * folder. Nothing of a person's ever lives in the repository.
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type RuntimeMode = 'desktop' | 'dev' | 'test'
export type StoreKind = 'sqlite' | 'synthetic'

export const DATABASE_FILE = 'financial-os.db'

export function runtimeMode(): RuntimeMode {
  const mode = process.env.FINANCIAL_OS_MODE?.trim()
  if (mode === 'desktop' || mode === 'test') return mode
  if (process.env.VITEST) return 'test'
  return 'dev'
}

/** The desktop always runs on SQLite; development opts in; tests say so themselves. */
export function storeKind(mode: RuntimeMode = runtimeMode()): StoreKind {
  if (mode === 'desktop') return 'sqlite'
  return process.env.FINANCIAL_OS_STORE?.trim() === 'sqlite' ? 'sqlite' : 'synthetic'
}

/**
 * Whether development may seed the synthetic relationships into an empty
 * SQLite store. Never in desktop mode: a person's Financial OS starts empty
 * or restored, and no demonstration client ever enters it silently.
 */
export function demoSeedAllowed(mode: RuntimeMode = runtimeMode()): boolean {
  return mode !== 'desktop' && process.env.FINANCIAL_OS_DEMO_SEED?.trim() === '1'
}

/**
 * Whether an absent database file is created silently on the first open.
 * Never for a person's Financial OS: the desktop, and development on SQLite
 * without the demonstration seed, start at `/setup` — CREATE NEW or RESTORE
 * EXISTING — and nothing is written before the person has chosen. A test,
 * or development that asked for the seed, creates on open.
 */
export function createsOnFirstOpen(mode: RuntimeMode = runtimeMode()): boolean {
  return mode === 'test' || demoSeedAllowed(mode)
}

/** The application's version, as the desktop host reports it; a development marker otherwise. */
export function appVersion(): string {
  return process.env.FINANCIAL_OS_APP_VERSION?.trim() || '0.1.0-dev'
}

/** True when the desktop host is running the application. */
export function isDesktopHost(): boolean {
  return runtimeMode() === 'desktop'
}

export interface DataLayout {
  root: string
  database: string
  documents: string
  meetingPacks: string
  reports: string
  attachments: string
  backups: string
  snapshots: string
  preMigration: string
  /** Encrypted recovery bundles exported locally. */
  bundles: string
  logs: string
  config: string
}

export function resolveDataRoot(): string {
  const override = process.env.FINANCIAL_OS_DATA_DIR?.trim()
  if (override) return override
  const local = process.env.LOCALAPPDATA?.trim()
  return join(local || join(homedir(), '.local', 'share'), 'Financial OS Dev')
}

/** The layout under the root, every directory created. */
export function dataLayout(root: string = resolveDataRoot()): DataLayout {
  const layout: DataLayout = {
    root,
    database: join(root, DATABASE_FILE),
    documents: join(root, 'documents'),
    meetingPacks: join(root, 'documents', 'meeting-packs'),
    reports: join(root, 'documents', 'reports'),
    attachments: join(root, 'documents', 'attachments'),
    backups: join(root, 'backups'),
    snapshots: join(root, 'backups', 'snapshots'),
    preMigration: join(root, 'backups', 'pre-migration'),
    bundles: join(root, 'backups', 'bundles'),
    logs: join(root, 'logs'),
    config: join(root, 'config'),
  }
  for (const dir of [
    layout.root,
    layout.documents,
    layout.meetingPacks,
    layout.reports,
    layout.attachments,
    layout.backups,
    layout.snapshots,
    layout.preMigration,
    layout.bundles,
    layout.logs,
    layout.config,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  return layout
}
