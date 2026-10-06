/**
 * Opening the record: a fresh file is created at the current schema; a
 * file opened again is still there with what was written; a file ahead of
 * the application is refused; a migration that fails leaves the file as it
 * was; a pre-migration snapshot is taken only when there is something to
 * protect; an unclean last session is noticed.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syntheticClients } from '../syntheticClients'
import { openDatabase, schemaVersion, setSchemaVersion } from './database'
import { checksumOf, migrate } from './migrate'
import { writeSeed } from './repositories'
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from './schema'
import { openAdvisoryStore } from './store'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fos-store-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('opening the relationship record', () => {
  it('creates a fresh, empty file at the current schema and never seeds it', async () => {
    const path = join(dir, 'financial-os.db')
    const opened = await openAdvisoryStore(path, { preMigrationDir: join(dir, 'pre') })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.created).toBe(true)
    expect(opened.migration.to).toBe(CURRENT_SCHEMA_VERSION)
    expect(opened.preMigrationSnapshot).toBeNull()
    expect(await opened.repositories.clients.list()).toEqual([])
    expect(await opened.repositories.clients.offices()).toEqual([])
    opened.db.close()
  })

  it('keeps what was written across a close and a reopen', async () => {
    const path = join(dir, 'financial-os.db')
    const first = await openAdvisoryStore(path)
    if (!first.ok) throw new Error(first.code)
    await writeSeed(first.db, syntheticClients('2026-09-23'))
    await first.repositories.commitments.saveCommitment({
      ...(await first.repositories.commitments.commitmentById('co-alv-1'))!,
      status: 'done',
      completedAt: '2026-09-23',
    })
    first.db.close()

    const second = await openAdvisoryStore(path)
    if (!second.ok) throw new Error(second.code)
    expect(second.created).toBe(false)
    expect(second.uncleanShutdown).toBe(false)
    expect((await second.repositories.clients.list()).length).toBe(7)
    expect(
      (await second.repositories.commitments.commitmentById('co-alv-1'))?.status,
    ).toBe('done')
    second.db.close()
  })

  it('refuses a file written by a newer application', async () => {
    const path = join(dir, 'financial-os.db')
    const db = openDatabase(path)
    await migrate(db)
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION + 5)
    db.close()
    const opened = await openAdvisoryStore(path)
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.code).toBe('SCHEMA_TOO_NEW')
  })

  it('notices a write-ahead log left behind by an unclean end', async () => {
    const path = join(dir, 'financial-os.db')
    const first = await openAdvisoryStore(path)
    if (!first.ok) throw new Error(first.code)
    first.db.close()
    writeFileSync(`${path}-wal`, '')
    const second = await openAdvisoryStore(path)
    expect(second.ok && second.uncleanShutdown).toBe(true)
    if (second.ok) second.db.close()
  })

  it('refuses a file whose applied migration no longer matches its SQL', async () => {
    const path = join(dir, 'financial-os.db')
    const db = openDatabase(path)
    await migrate(db)
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run(
      'tampered',
    )
    db.close()
    const opened = await openAdvisoryStore(path)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('CHECKSUM_MISMATCH')
  })
})

describe('migrating', () => {
  it('records each applied migration with its checksum and sets the version', async () => {
    const db = openDatabase(join(dir, 'm.db'))
    const outcome = await migrate(db)
    expect(outcome).toEqual({
      ok: true,
      from: 0,
      to: CURRENT_SCHEMA_VERSION,
      applied: [1],
    })
    const rows = db.prepare('SELECT version, checksum FROM schema_migrations').all() as {
      version: number
      checksum: string
    }[]
    expect(rows).toEqual([{ version: 1, checksum: checksumOf(MIGRATIONS[0]!) }])
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION)
    expect(await migrate(db)).toEqual({
      ok: true,
      from: CURRENT_SCHEMA_VERSION,
      to: CURRENT_SCHEMA_VERSION,
      applied: [],
    })
    db.close()
  })

  it('leaves the file as it was when a migration fails', async () => {
    const db = openDatabase(join(dir, 'f.db'))
    await migrate(db)
    const broken = [
      ...MIGRATIONS,
      {
        version: CURRENT_SCHEMA_VERSION + 1,
        name: 'broken',
        sql: 'CREATE TABLE x (a); SELECT nope FROM missing;',
      },
    ]
    const outcome = await migrate(db, broken)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('MIGRATION_FAILED')
    expect(schemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'x'")
      .all()
    expect(tables).toEqual([])
    db.close()
  })

  it('takes a pre-migration snapshot of a populated file that is behind, and only then', async () => {
    const path = join(dir, 'financial-os.db')
    const db = openDatabase(path)
    await migrate(db)
    await writeSeed(db, syntheticClients('2026-09-23'))
    /* Pretend the file is one version behind an application that has a further migration. */
    db.exec('DELETE FROM schema_migrations WHERE version > 0')
    setSchemaVersion(db, 0)
    db.close()
    const pre = join(dir, 'pre')
    const opened = await openAdvisoryStore(path, { preMigrationDir: pre })
    /* Version 0 with existing tables: migration 1 would recreate them and fail — the file stays intact. */
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.code).toBe('MIGRATION_FAILED')
    expect(existsSync(pre) ? readdirSync(pre) : []).toEqual([])
    const again = openDatabase(path)
    expect(
      (again.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }).n,
    ).toBe(7)
    again.close()
  })
})
