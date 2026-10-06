// @vitest-environment node
/**
 * Generated packs on the record: a version generated in one process is
 * listed and downloadable after the record is closed and reopened; the
 * download proves the bytes against the checksum and reports a file that
 * was altered or removed instead of serving it; an unchanged record reuses
 * the version, a moved record steps it, and the earlier version's file
 * and row stay exactly as they were.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { writeSeed } from '~/infrastructure/advisory/sqlite/repositories'
import { openAdvisoryStore, type OpenedStore } from '~/infrastructure/advisory/sqlite/store'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { generateMeetingPack } from './generateMeetingPack'
import { DocumentIntegrityError, SqliteMeetingPackStore, sha256Of } from './sqliteMeetingPackStore'

const TODAY = '2026-09-23'

let dir: string
let opened: OpenedStore | null = null
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fos-packs-'))
})
afterEach(() => {
  opened?.db.close()
  opened = null
  rmSync(dir, { recursive: true, force: true })
})

async function open(): Promise<{ context: AdvisoryContext; store: SqliteMeetingPackStore }> {
  const result = await openAdvisoryStore(join(dir, 'financial-os.db'))
  if (!result.ok) throw new Error(result.code)
  opened = result
  if (result.created) await writeSeed(result.db, syntheticClients(TODAY))
  return {
    context: {
      repositories: result.repositories,
      clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
    },
    store: new SqliteMeetingPackStore(result.db, join(dir, 'documents')),
  }
}

async function close(): Promise<void> {
  opened?.db.close()
  opened = null
}

describe('generated packs on the record', () => {
  it('keeps a generated version across a close and a reopen, with its bytes proved on download', async () => {
    const first = await open()
    const generated = await generateMeetingPack(first.context, first.store, {
      clientId: 'cl-dahlqvist',
      depth: 'executive',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!generated.ok) throw new Error(generated.code)
    const [file] = generated.files
    expect(file!.meta.id).toMatch(/^document-\d{4}$/)
    expect(file!.meta.version).toBe(1)
    /* The file lives under the data directory's documents folder, per client — never beside the repository. */
    expect(file!.meta.filePath).toBe(
      join(dir, 'documents', 'meeting-packs', 'cl-dahlqvist', file!.meta.fileName),
    )
    expect(readdirSync(join(dir, 'documents', 'meeting-packs', 'cl-dahlqvist'))).toEqual([
      file!.meta.fileName,
    ])
    await close()

    const second = await open()
    const versions = second.store.listForClient('cl-dahlqvist', 'executive')
    expect(versions.map((v) => v.id)).toEqual([file!.meta.id])
    expect(versions[0]).toEqual(file!.meta)
    const again = second.store.get(file!.meta.id)!
    expect(again.bytes.toString('base64')).toBe(file!.base64)
    expect(sha256Of(again.bytes)).toBe(sha256Of(Buffer.from(file!.base64, 'base64')))
    /* And the generator, on the reopened record, reuses the version rather than rendering again. */
    const reused = await generateMeetingPack(second.context, second.store, {
      clientId: 'cl-dahlqvist',
      depth: 'executive',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!reused.ok) throw new Error(reused.code)
    expect(reused.files[0]).toMatchObject({ reused: true, meta: { id: file!.meta.id } })
    expect(second.store.list('cl-dahlqvist', file!.meta.meetingId, 'executive')).toHaveLength(1)
  })

  it('reports an altered or missing file instead of serving it, and never touches the row', async () => {
    const { context, store } = await open()
    const generated = await generateMeetingPack(context, store, {
      clientId: 'cl-dahlqvist',
      depth: 'executive',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!generated.ok) throw new Error(generated.code)
    const meta = generated.files[0]!.meta
    writeFileSync(meta.filePath!, Buffer.from('not the pack'))
    expect(() => store.get(meta.id)).toThrow(DocumentIntegrityError)
    try {
      store.get(meta.id)
    } catch (error) {
      expect((error as DocumentIntegrityError).code).toBe('CHECKSUM_MISMATCH')
    }
    unlinkSync(meta.filePath!)
    try {
      store.get(meta.id)
      throw new Error('served a missing file')
    } catch (error) {
      expect((error as DocumentIntegrityError).code).toBe('FILE_MISSING')
    }
    /* The record still knows the version: the row is the fact, the file is what needs restoring. */
    expect(store.listForClient('cl-dahlqvist').map((v) => v.id)).toEqual([meta.id])
  })

  it('steps the version when the record moves and leaves the earlier version intact', async () => {
    const { context, store } = await open()
    const first = await generateMeetingPack(context, store, {
      clientId: 'cl-dahlqvist',
      depth: 'executive',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!first.ok) throw new Error(first.code)
    await context.repositories.commitments.saveCommitment({
      ...first.pack.commitments[0]!.commitment,
      status: 'done',
      completedAt: TODAY,
    })
    const moved = await generateMeetingPack(context, store, {
      clientId: 'cl-dahlqvist',
      depth: 'executive',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!moved.ok) throw new Error(moved.code)
    expect(moved.files[0]!.meta.version).toBe(2)
    expect(moved.files[0]!.reused).toBe(false)
    const v1 = store.get(first.files[0]!.meta.id)!
    expect(v1.meta).toEqual(first.files[0]!.meta)
    expect(v1.bytes.toString('base64')).toBe(first.files[0]!.base64)
    expect(existsSync(first.files[0]!.meta.filePath!)).toBe(true)
    expect(
      store
        .list('cl-dahlqvist', first.pack.meeting.eventId, 'executive')
        .map((m) => m.version),
    ).toEqual([2, 1])
  })
})
