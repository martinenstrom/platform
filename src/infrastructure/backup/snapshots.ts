/**
 * Local snapshots of the record: a consistent copy of the live database
 * taken through SQLite's online backup while the application runs — never
 * a file copy of a database in use — made self-contained, verified by
 * opening it, hashed, and described in a sidecar so a later reading knows
 * what it is without opening it.
 *
 * Retention keeps the recent ones, one a day for a week and one a week for
 * a month; a snapshot taken to protect a restore is never thinned away.
 * Nothing here touches the live file.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  inspectDatabaseFile,
  makeSelfContained,
  snapshotTo,
  type Database,
} from '~/infrastructure/advisory/sqlite/database'

export type SnapshotTrigger =
  | 'startup'
  | 'interval'
  | 'post-migration'
  | 'post-act'
  | 'shutdown'
  | 'manual'
  | 'pre-restore'
  | 'bundle'

export interface SnapshotMeta {
  /** The file's base name, which carries the moment and the trigger. */
  id: string
  path: string
  createdAt: string
  trigger: SnapshotTrigger
  sizeBytes: number
  schemaVersion: number
  sha256: string
  /** Whether the copy opened and passed its checks when it was taken. */
  verified: boolean
  verification: string
  appVersion: string
  counts: { clients: number; offices: number; documents: number } | null
}

export const SNAPSHOT_PREFIX = 'financial-os-'

export interface RetentionPolicy {
  /** The newest ones, whatever their age. */
  recent: number
  /** One a day, this many days back. */
  daily: number
  /** One a week, this many weeks back. */
  weekly: number
}

export const DEFAULT_RETENTION: RetentionPolicy = { recent: 6, daily: 7, weekly: 4 }

/** Triggers whose snapshots retention never removes: what protected a restore stays. */
const PROTECTED: readonly SnapshotTrigger[] = ['pre-restore']

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function createSnapshot(
  db: Database,
  directory: string,
  options: { trigger: SnapshotTrigger; appVersion: string; now?: () => Date },
): Promise<SnapshotMeta> {
  mkdirSync(directory, { recursive: true })
  const at = (options.now ?? (() => new Date()))()
  const id = `${SNAPSHOT_PREFIX}${at.toISOString().replace(/[:.]/gu, '-')}-${options.trigger}`
  const path = join(directory, `${id}.db`)
  const part = `${path}.part`
  if (existsSync(part)) unlinkSync(part)
  await snapshotTo(db, part)
  makeSelfContained(part)
  const inspection = inspectDatabaseFile(part)
  const bytes = readFileSync(part)
  const verified = inspection.quickCheck === 'ok' && inspection.foreignKeyViolations === 0
  const meta: SnapshotMeta = {
    id,
    path,
    createdAt: at.toISOString(),
    trigger: options.trigger,
    sizeBytes: bytes.length,
    schemaVersion: inspection.schemaVersion,
    sha256: sha256Of(bytes),
    verified,
    verification: verified
      ? 'ok'
      : inspection.quickCheck !== 'ok'
        ? inspection.quickCheck
        : `${inspection.foreignKeyViolations} foreign key violations`,
    appVersion: options.appVersion,
    counts: inspection.counts,
  }
  writeFileSync(sidecarOf(path), JSON.stringify(withoutPath(meta), null, 2))
  renameSync(part, path)
  return meta
}

/** Every snapshot in the directory, newest first; a file without a sidecar is listed as unverified. */
export function listSnapshots(directory: string): SnapshotMeta[] {
  if (!existsSync(directory)) return []
  const out: SnapshotMeta[] = []
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith('.db')) continue
    const path = join(directory, name)
    const sidecar = sidecarOf(path)
    if (existsSync(sidecar)) {
      try {
        const stored = JSON.parse(readFileSync(sidecar, 'utf8')) as Omit<SnapshotMeta, 'path'>
        out.push({ ...stored, path })
        continue
      } catch {
        /* an unreadable sidecar: described from the file alone below */
      }
    }
    const stat = statSync(path)
    out.push({
      id: name.slice(0, -3),
      path,
      createdAt: stat.mtime.toISOString(),
      trigger: triggerOf(name),
      sizeBytes: stat.size,
      schemaVersion: 0,
      sha256: '',
      verified: false,
      verification: 'no sidecar',
      appVersion: '',
      counts: null,
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export interface SnapshotVerification {
  ok: boolean
  /** Whether the file's bytes still hash to what the sidecar recorded. */
  checksum: 'ok' | 'mismatch' | 'unknown'
  quickCheck: string
  foreignKeyViolations: number
  schemaVersion: number
  counts: SnapshotMeta['counts']
}

/** The deep reading of one snapshot: its bytes against the sidecar, and the file opened and checked. */
export function verifySnapshot(meta: SnapshotMeta): SnapshotVerification {
  if (!existsSync(meta.path))
    return {
      ok: false,
      checksum: 'unknown',
      quickCheck: 'file missing',
      foreignKeyViolations: 0,
      schemaVersion: 0,
      counts: null,
    }
  const checksum: SnapshotVerification['checksum'] = meta.sha256
    ? sha256Of(readFileSync(meta.path)) === meta.sha256
      ? 'ok'
      : 'mismatch'
    : 'unknown'
  let inspection: ReturnType<typeof inspectDatabaseFile>
  try {
    inspection = inspectDatabaseFile(meta.path)
  } catch (error) {
    return {
      ok: false,
      checksum,
      quickCheck: error instanceof Error ? error.message : String(error),
      foreignKeyViolations: 0,
      schemaVersion: 0,
      counts: null,
    }
  }
  return {
    ok:
      checksum !== 'mismatch' &&
      inspection.quickCheck === 'ok' &&
      inspection.foreignKeyViolations === 0,
    checksum,
    quickCheck: inspection.quickCheck,
    foreignKeyViolations: inspection.foreignKeyViolations,
    schemaVersion: inspection.schemaVersion,
    counts: inspection.counts,
  }
}

/**
 * Thin the directory to the policy: the newest `recent`, the newest of each
 * of the last `daily` days, the newest of each of the last `weekly` weeks.
 * Protected triggers are kept whatever the policy says.
 */
export function applyRetention(
  directory: string,
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): { kept: SnapshotMeta[]; removed: SnapshotMeta[] } {
  const snapshots = listSnapshots(directory)
  const keep = new Set<string>()
  for (const s of snapshots) if (PROTECTED.includes(s.trigger)) keep.add(s.id)
  for (const s of snapshots.slice(0, policy.recent)) keep.add(s.id)
  const today = dayOf(now.toISOString())
  const dayIndex = (iso: string) => daysSince(dayOf(iso), today)
  const byDay = new Map<string, SnapshotMeta>()
  const byWeek = new Map<string, SnapshotMeta>()
  for (const s of snapshots) {
    const age = dayIndex(s.createdAt)
    if (age < 0) continue
    if (age < policy.daily) {
      const day = dayOf(s.createdAt)
      if (!byDay.has(day)) byDay.set(day, s)
    }
    if (age < policy.weekly * 7) {
      const week = weekOf(s.createdAt)
      if (!byWeek.has(week)) byWeek.set(week, s)
    }
  }
  for (const s of byDay.values()) keep.add(s.id)
  for (const s of byWeek.values()) keep.add(s.id)
  const kept: SnapshotMeta[] = []
  const removed: SnapshotMeta[] = []
  for (const s of snapshots) {
    if (keep.has(s.id)) {
      kept.push(s)
      continue
    }
    try {
      unlinkSync(s.path)
      if (existsSync(sidecarOf(s.path))) unlinkSync(sidecarOf(s.path))
      removed.push(s)
    } catch {
      kept.push(s)
    }
  }
  return { kept, removed }
}

/* ------------------------------------------------------------- helpers */

function sidecarOf(path: string): string {
  return `${path}.json`
}

function withoutPath(meta: SnapshotMeta): Omit<SnapshotMeta, 'path'> {
  const { path: _path, ...rest } = meta
  return rest
}

function triggerOf(name: string): SnapshotTrigger {
  const match = /-([a-z-]+)\.db$/u.exec(name.replace(/^financial-os-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/u, ''))
  const trigger = match?.[1] as SnapshotTrigger | undefined
  return trigger ?? 'manual'
}

const dayOf = (iso: string) => iso.slice(0, 10)

function daysSince(day: string, today: string): number {
  return Math.floor(
    (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${day}T00:00:00.000Z`)) / 86_400_000,
  )
}

/** ISO week key, "2026-W40". */
function weekOf(iso: string): string {
  const date = new Date(`${dayOf(iso)}T00:00:00.000Z`)
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week =
    1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
