// @vitest-environment node
/**
 * The backup engine in temporary directories: a snapshot is a verified,
 * self-contained copy with a sidecar, taken while the record is open;
 * retention keeps what the policy says and never a restore's safety copy;
 * a bundle seals the database and every document under a passphrase, opens
 * only with that passphrase, and reports a changed byte, a missing entry
 * and a schema ahead of the application; a restore writes beside the
 * primary, proves what it unpacked, moves the old record aside and brings
 * the new one into place; an export to a destination that is not there is
 * a recorded failure, never a silent skip.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import {
  closeInOrder,
  inspectDatabaseFile,
  openDatabase,
  recordCounts,
} from '~/infrastructure/advisory/sqlite/database'
import { writeSeed } from '~/infrastructure/advisory/sqlite/repositories'
import { CURRENT_SCHEMA_VERSION } from '~/infrastructure/advisory/sqlite/schema'
import { openAdvisoryStore, type OpenedStore } from '~/infrastructure/advisory/sqlite/store'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { generateMeetingPack } from '~/infrastructure/documents/generateMeetingPack'
import { SqliteMeetingPackStore } from '~/infrastructure/documents/sqliteMeetingPackStore'
import { dataLayout, type DataLayout } from '~/infrastructure/platform/dataDir'
import {
  BundleError,
  createBundle,
  DATABASE_ENTRY,
  openBundle,
  verifyBundle,
} from './bundle'
import {
  dailyExportDue,
  DestinationError,
  exportBundle,
  readBackupConfig,
} from './destinations'
import { restoreFromBundle, restoreFromSnapshot } from './restore'
import {
  applyRetention,
  createSnapshot,
  listSnapshots,
  verifySnapshot,
  type SnapshotMeta,
} from './snapshots'

const TODAY = '2026-10-04'
const PASSPHRASE = 'correct horse battery staple'
const APP = '0.1.0-test'

let root: string
let layout: DataLayout
let opened: OpenedStore | null = null
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fos-backup-'))
  layout = dataLayout(join(root, 'data'))
})
afterEach(() => {
  opened?.db.close()
  opened = null
  rmSync(root, { recursive: true, force: true })
})

/** A seeded record with one generated document, open. */
async function seededStore(): Promise<OpenedStore> {
  const result = await openAdvisoryStore(layout.database)
  if (!result.ok) throw new Error(result.code)
  opened = result
  if (result.created) {
    await writeSeed(result.db, syntheticClients(TODAY))
    const store = new SqliteMeetingPackStore(result.db, layout.documents)
    const generated = await generateMeetingPack(
      { repositories: result.repositories, clock: new FakeClock(`${TODAY}T10:00:00.000Z`) },
      store,
      { clientId: 'cl-dahlqvist', depth: 'executive', formats: ['pdf'], audience: 'INTERNAL_ADVISOR' },
    )
    if (!generated.ok) throw new Error(generated.code)
  }
  return result
}

function closeLive(): void {
  if (opened) closeInOrder(opened.db)
  opened = null
}

describe('snapshots', () => {
  it('takes a verified, self-contained copy with a sidecar while the record is open', async () => {
    const store = await seededStore()
    const meta = await createSnapshot(store.db, layout.snapshots, {
      trigger: 'manual',
      appVersion: APP,
      now: () => new Date('2026-10-04T10:00:00.000Z'),
    })
    expect(meta.verified).toBe(true)
    expect(meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(meta.counts).toEqual(recordCounts(store.db))
    expect(meta.id).toBe('financial-os-2026-10-04T10-00-00-000Z-manual')
    expect(readdirSync(layout.snapshots).sort()).toEqual([`${meta.id}.db`, `${meta.id}.db.json`])
    /* No -wal beside the snapshot: it is one file. */
    expect(existsSync(`${meta.path}-wal`)).toBe(false)
    const listed = listSnapshots(layout.snapshots)
    expect(listed).toEqual([meta])
    expect(verifySnapshot(meta)).toMatchObject({ ok: true, checksum: 'ok', quickCheck: 'ok' })
    /* A changed byte is a mismatch, reported, not served. */
    const bytes = readFileSync(meta.path)
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff
    writeFileSync(meta.path, bytes)
    expect(verifySnapshot(meta).checksum).toBe('mismatch')
  })

  it('thins to the policy and never removes a restore’s safety copy', async () => {
    const store = await seededStore()
    const take = (iso: string, trigger: SnapshotMeta['trigger'] = 'interval') =>
      createSnapshot(store.db, layout.snapshots, {
        trigger,
        appVersion: APP,
        now: () => new Date(iso),
      })
    /* Eight today, one on each of the five days before, one three weeks ago, one safety copy five weeks ago. */
    for (let h = 0; h < 8; h += 1) await take(`2026-10-04T${String(h).padStart(2, '0')}:00:00.000Z`)
    for (let d = 1; d <= 5; d += 1) await take(`2026-10-0${4 - d >= 1 ? 4 - d : 1}T12:00:00.000Z`)
    await take('2026-09-29T12:00:00.000Z')
    await take('2026-09-13T12:00:00.000Z')
    await take('2026-08-28T12:00:00.000Z', 'pre-restore')
    const before = listSnapshots(layout.snapshots).length
    const { kept, removed } = applyRetention(layout.snapshots, new Date('2026-10-04T23:00:00.000Z'))
    expect(kept.length + removed.length).toBe(before)
    /* The six newest of today stay; the two oldest of today go (the day is already represented). */
    const todayKept = kept.filter((s) => s.createdAt.startsWith('2026-10-04'))
    expect(todayKept).toHaveLength(6)
    /* Each of the earlier days within a week keeps one. */
    for (const day of ['2026-10-03', '2026-10-02', '2026-10-01'])
      expect(kept.some((s) => s.createdAt.startsWith(day))).toBe(true)
    /* A week-old snapshot stays as its week's; a three-week-old one too; the safety copy stays whatever its age. */
    expect(kept.some((s) => s.createdAt.startsWith('2026-09-29'))).toBe(true)
    expect(kept.some((s) => s.createdAt.startsWith('2026-09-13'))).toBe(true)
    expect(kept.some((s) => s.trigger === 'pre-restore')).toBe(true)
    expect(removed.length).toBeGreaterThan(0)
    for (const s of removed) expect(existsSync(s.path)).toBe(false)
  })
})

describe('the recovery bundle', () => {
  it('seals the database and every document, opens with the passphrase only, and proves every entry', async () => {
    const store = await seededStore()
    const path = join(root, 'out', 'record.financialos')
    const created = await createBundle({
      db: store.db,
      documentsRoot: layout.documents,
      destination: path,
      passphrase: PASSPHRASE,
      appVersion: APP,
      now: () => new Date('2026-10-04T10:00:00.000Z'),
    })
    expect(created.manifest.counts).toEqual(recordCounts(store.db))
    expect(created.manifest.entries.map((e) => e.path)).toEqual(
      expect.arrayContaining([DATABASE_ENTRY, expect.stringMatching(/^documents\/meeting-packs\/cl-dahlqvist\//u)]),
    )
    expect(created.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    /* Nothing of the record is readable in the file. */
    const sealed = readFileSync(path)
    expect(sealed.subarray(0, 4).toString('ascii')).toBe('FOSB')
    expect(sealed.includes(Buffer.from('SQLite format 3'))).toBe(false)
    expect(sealed.includes(Buffer.from('manifest.json'))).toBe(false)
    expect(sealed.includes(Buffer.from('Dahlqvist'))).toBe(false)

    const inspection = await verifyBundle(path, PASSPHRASE)
    expect(inspection.ok).toBe(true)
    expect(inspection.database?.quickCheck).toBe('ok')
    expect(inspection.documents).toBe(1)
    await expect(openBundle(path, 'not the passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    })
    /* A changed byte in the sealed body: the seal does not open. */
    const damaged = Buffer.from(sealed)
    damaged[damaged.length - 10] = damaged[damaged.length - 10]! ^ 0x01
    const damagedPath = join(root, 'out', 'damaged.financialos')
    writeFileSync(damagedPath, damaged)
    await expect(openBundle(damagedPath, PASSPHRASE)).rejects.toBeInstanceOf(BundleError)
    /* Not a bundle at all. */
    const notOne = join(root, 'out', 'notes.txt')
    writeFileSync(notOne, 'hello')
    await expect(openBundle(notOne, PASSPHRASE)).rejects.toMatchObject({ code: 'NOT_A_BUNDLE' })
    /* A bundle ahead of this application is refused as such. */
    const ahead = await verifyBundle(path, PASSPHRASE, { currentSchemaVersion: CURRENT_SCHEMA_VERSION - 1 })
    expect(ahead.ok).toBe(false)
    expect(ahead.issues.map((i) => i.code)).toContain('SCHEMA_TOO_NEW')
  })
})

describe('restore', () => {
  it('brings a bundle into a fresh data directory: database, documents, nothing overwritten', async () => {
    const store = await seededStore()
    const bundlePath = join(root, 'out', 'record.financialos')
    await createBundle({
      db: store.db,
      documentsRoot: layout.documents,
      destination: bundlePath,
      passphrase: PASSPHRASE,
      appVersion: APP,
    })
    const expectedCounts = recordCounts(store.db)
    const documentFile = readdirSync(join(layout.documents, 'meeting-packs', 'cl-dahlqvist'))[0]!
    closeLive()

    /* A new computer: an empty layout. */
    const fresh = dataLayout(join(root, 'fresh'))
    const result = await restoreFromBundle({
      bundlePath,
      passphrase: PASSPHRASE,
      layout: fresh,
      appVersion: APP,
      now: () => new Date('2026-10-05T08:00:00.000Z'),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary).toMatchObject({
      source: 'bundle',
      counts: expectedCounts,
      documentsRestored: 1,
      safetySnapshot: null,
      replacedDatabase: null,
    })
    expect(existsSync(fresh.database)).toBe(true)
    expect(existsSync(`${fresh.database}.restoring`)).toBe(false)
    expect(existsSync(`${fresh.database}-wal`)).toBe(false)
    const inspection = inspectDatabaseFile(fresh.database)
    expect(inspection.quickCheck).toBe('ok')
    expect(inspection.counts).toEqual(expectedCounts)
    expect(readdirSync(join(fresh.documents, 'meeting-packs', 'cl-dahlqvist'))).toEqual([documentFile])
    /* The restored record opens as a record, and its document downloads with its checksum proved. */
    const reopened = await openAdvisoryStore(fresh.database)
    if (!reopened.ok) throw new Error(reopened.code)
    opened = reopened
    expect((await reopened.repositories.clients.list()).length).toBe(expectedCounts.clients)
    const packs = new SqliteMeetingPackStore(reopened.db, fresh.documents)
    const [version] = packs.listForClient('cl-dahlqvist')
    expect(packs.get(version!.id)?.bytes.length).toBe(version!.byteLength)
  })

  it('on a computer with a record: snapshots it, moves it aside with its side files, never over it', async () => {
    const store = await seededStore()
    const bundlePath = join(root, 'out', 'record.financialos')
    await createBundle({
      db: store.db,
      documentsRoot: layout.documents,
      destination: bundlePath,
      passphrase: PASSPHRASE,
      appVersion: APP,
    })
    /* The record moves on after the bundle: a commitment is completed. */
    await store.repositories.commitments.saveCommitment({
      ...(await store.repositories.commitments.commitmentById('co-alv-1'))!,
      status: 'done',
      completedAt: TODAY,
    })
    closeLive()
    const result = await restoreFromBundle({
      bundlePath,
      passphrase: PASSPHRASE,
      layout,
      appVersion: APP,
      now: () => new Date('2026-10-05T08:00:00.000Z'),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.safetySnapshot).toMatch(/pre-restore\.db$/u)
    expect(result.summary.replacedDatabase).toMatch(/financial-os\.db\.replaced-/u)
    expect(existsSync(result.summary.replacedDatabase!)).toBe(true)
    expect(existsSync(result.summary.replacedDocuments!)).toBe(true)
    /* The safety snapshot carries the later state; the restored record carries the bundle's. */
    const safety = openDatabase(result.summary.safetySnapshot!)
    const later = safety.prepare("SELECT status FROM commitments WHERE id = 'co-alv-1'").get() as { status: string }
    closeInOrder(safety)
    expect(later.status).toBe('done')
    const restored = await openAdvisoryStore(layout.database)
    if (!restored.ok) throw new Error(restored.code)
    opened = restored
    expect((await restored.repositories.commitments.commitmentById('co-alv-1'))?.status).not.toBe('done')
  })

  it('refuses a wrong passphrase, a damaged bundle and leaves the record untouched', async () => {
    const store = await seededStore()
    const bundlePath = join(root, 'out', 'record.financialos')
    await createBundle({
      db: store.db,
      documentsRoot: layout.documents,
      destination: bundlePath,
      passphrase: PASSPHRASE,
      appVersion: APP,
    })
    closeLive()
    const before = readFileSync(layout.database)
    const wrong = await restoreFromBundle({ bundlePath, passphrase: 'wrong', layout, appVersion: APP })
    expect(wrong).toMatchObject({ ok: false, code: 'WRONG_PASSPHRASE' })
    const damaged = Buffer.from(readFileSync(bundlePath))
    damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 0x01
    const damagedPath = join(root, 'out', 'damaged.financialos')
    writeFileSync(damagedPath, damaged)
    const broken = await restoreFromBundle({ bundlePath: damagedPath, passphrase: PASSPHRASE, layout, appVersion: APP })
    expect(broken.ok).toBe(false)
    expect(readFileSync(layout.database).equals(before)).toBe(true)
    expect(existsSync(`${layout.database}.restoring`)).toBe(false)
    expect(readdirSync(layout.root).filter((n) => n.includes('replaced'))).toEqual([])
  })

  it('restores a local snapshot, database only', async () => {
    const store = await seededStore()
    const meta = await createSnapshot(store.db, layout.snapshots, { trigger: 'manual', appVersion: APP })
    await store.repositories.commitments.saveCommitment({
      ...(await store.repositories.commitments.commitmentById('co-alv-1'))!,
      status: 'done',
      completedAt: TODAY,
    })
    closeLive()
    const result = await restoreFromSnapshot({ snapshot: meta, layout, appVersion: APP })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.source).toBe('snapshot')
    expect(result.summary.documentsRestored).toBe(0)
    const restored = await openAdvisoryStore(layout.database)
    if (!restored.ok) throw new Error(restored.code)
    opened = restored
    expect((await restored.repositories.commitments.commitmentById('co-alv-1'))?.status).not.toBe('done')
    /* A snapshot that no longer matches its sidecar is refused. */
    const bytes = readFileSync(meta.path)
    bytes[100] = bytes[100]! ^ 0xff
    writeFileSync(meta.path, bytes)
    closeLive()
    expect(await restoreFromSnapshot({ snapshot: meta, layout, appVersion: APP })).toMatchObject({
      ok: false,
      code: 'SNAPSHOT_INVALID',
    })
  })
})

describe('destinations', () => {
  it('exports a verified bundle to a folder and records it; a missing folder is a recorded failure', async () => {
    const store = await seededStore()
    const external = join(root, 'usb')
    mkdirSync(external)
    const record = await exportBundle({
      db: store.db,
      layout,
      destination: { kind: 'EXTERNAL', path: external },
      passphrase: PASSPHRASE,
      appVersion: APP,
      now: () => new Date('2026-10-04T10:00:00.000Z'),
    })
    expect(record.verified).toBe(true)
    expect(record.path).toBe(join(external, 'financial-os-2026-10-04T10-00-00-000Z.financialos'))
    expect(readdirSync(external)).toEqual(['financial-os-2026-10-04T10-00-00-000Z.financialos'])
    const config = readBackupConfig(layout)
    expect(config.lastExport).toEqual(record)
    expect(config.lastExportError).toBeNull()
    expect(dailyExportDue({ ...config, external: { path: external, chosenAt: record.at } }, new Date('2026-10-04T20:00:00.000Z'))).toBe(false)
    expect(dailyExportDue({ ...config, external: { path: external, chosenAt: record.at } }, new Date('2026-10-05T11:00:00.000Z'))).toBe(true)

    rmSync(external, { recursive: true, force: true })
    await expect(
      exportBundle({
        db: store.db,
        layout,
        destination: { kind: 'EXTERNAL', path: external },
        passphrase: PASSPHRASE,
        appVersion: APP,
        now: () => new Date('2026-10-05T10:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(DestinationError)
    const after = readBackupConfig(layout)
    expect(after.lastExport).toEqual(record)
    expect(after.lastExportError).toMatchObject({ code: 'DESTINATION_UNAVAILABLE', destination: 'EXTERNAL' })
  })
})
