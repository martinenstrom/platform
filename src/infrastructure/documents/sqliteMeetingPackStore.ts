/**
 * Generated packs on the record: one row per generation in
 * `generated_documents`, the file itself under the person's data directory
 * at `documents/meeting-packs/<clientId>/<fileName>`, and the file's SHA-256
 * beside the row so a download can prove the bytes are the ones generated.
 *
 * The file is never a blob in the database: a pack is opened in PowerPoint
 * or a PDF reader, backed up as a file and restored as a file. The row is
 * what makes the version a fact of the record — the file alone could be
 * renamed, copied or edited, and a row whose file does not match its
 * checksum is reported, never served as if it were the pack.
 *
 * A version is immutable: nothing here updates or deletes a row, and a
 * file name already taken is never written over.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { MeetingPackDepth } from '~/application/advisory/meetingPack'
import type { Database } from '~/infrastructure/advisory/sqlite/database'
import {
  freePath,
  generationKey,
  highestVersionOnDisk,
  type GeneratedPack,
  type GeneratedPackMeta,
  type MeetingPackStore,
  type NewGeneration,
  type PackFormat,
} from './meetingPackStore'

export const MEETING_PACK_KIND = 'meeting-pack'

/** A stored file that does not match its record: missing, or with other bytes than were generated. */
export class DocumentIntegrityError extends Error {
  constructor(
    readonly code: 'FILE_MISSING' | 'CHECKSUM_MISMATCH',
    readonly documentId: string,
  ) {
    super(`${code}: ${documentId}`)
    this.name = 'DocumentIntegrityError'
  }
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

type Row = Record<string, unknown>

const COLUMNS =
  'id, client_id, kind, version, format, file_name, relative_path, byte_length, fingerprint, sha256, generated_at, source_as_of, meeting_id, meeting_date, audience, depth, slide_count, core_count, appendix_count'

export class SqliteMeetingPackStore implements MeetingPackStore {
  constructor(
    private readonly db: Database,
    /** The data directory's `documents` folder; every `relative_path` is under it. */
    private readonly documentsRoot: string,
  ) {}

  list(
    clientId: string,
    meetingId: string | null,
    depth: MeetingPackDepth,
  ): GeneratedPackMeta[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM generated_documents WHERE kind = ? AND client_id = ? AND depth = ? AND meeting_id IS ? ORDER BY version DESC, generated_at DESC`,
      )
      .all(MEETING_PACK_KIND, clientId, depth, meetingId) as Row[]
    return rows.map((row) => this.metaOf(row))
  }

  listForClient(clientId: string, depth?: MeetingPackDepth): GeneratedPackMeta[] {
    const rows = (
      depth
        ? this.db
            .prepare(
              `SELECT ${COLUMNS} FROM generated_documents WHERE kind = ? AND client_id = ? AND depth = ? ORDER BY generated_at DESC, version DESC`,
            )
            .all(MEETING_PACK_KIND, clientId, depth)
        : this.db
            .prepare(
              `SELECT ${COLUMNS} FROM generated_documents WHERE kind = ? AND client_id = ? ORDER BY generated_at DESC, version DESC`,
            )
            .all(MEETING_PACK_KIND, clientId)
    ) as Row[]
    return rows.map((row) => this.metaOf(row))
  }

  /**
   * The generation's bytes, read from the file and proved against the
   * checksum the row carries. A missing or altered file throws a
   * `DocumentIntegrityError`; the caller says so rather than serving it.
   */
  get(id: string): GeneratedPack | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM generated_documents WHERE id = ?`)
      .get(id) as Row | undefined
    if (!row) return null
    const meta = this.metaOf(row)
    const path = meta.filePath!
    if (!existsSync(path)) throw new DocumentIntegrityError('FILE_MISSING', id)
    const bytes = readFileSync(path)
    if (sha256Of(bytes) !== String(row['sha256']))
      throw new DocumentIntegrityError('CHECKSUM_MISMATCH', id)
    return { meta, bytes }
  }

  existing(key: string, fingerprint: string, format: PackFormat): GeneratedPack | null {
    const { clientId, meetingId, depth } = splitKey(key)
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM generated_documents WHERE kind = ? AND client_id = ? AND depth = ? AND meeting_id IS ? AND fingerprint = ? AND format = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(MEETING_PACK_KIND, clientId, depth, meetingId, fingerprint, format) as
      | Row
      | undefined
    if (!row) return null
    return this.get(String(row['id']))
  }

  nextVersion(key: string, fingerprint: string, fileBaseName: string): number {
    const { clientId, meetingId, depth } = splitKey(key)
    const same = this.db
      .prepare(
        'SELECT version FROM generated_documents WHERE kind = ? AND client_id = ? AND depth = ? AND meeting_id IS ? AND fingerprint = ? LIMIT 1',
      )
      .get(MEETING_PACK_KIND, clientId, depth, meetingId, fingerprint) as Row | undefined
    if (same) return Number(same['version'])
    const highest = this.db
      .prepare(
        'SELECT COALESCE(MAX(version), 0) AS highest FROM generated_documents WHERE kind = ? AND client_id = ? AND depth = ? AND meeting_id IS ?',
      )
      .get(MEETING_PACK_KIND, clientId, depth, meetingId) as Row
    return (
      Math.max(
        Number(highest['highest']),
        highestVersionOnDisk(this.clientDirectory(clientId), fileBaseName),
      ) + 1
    )
  }

  /**
   * The file first, written whole under a temporary name and renamed into
   * place, then the row; a row that cannot be written takes the file with
   * it. The id is minted from the record's own sequence.
   */
  add(generation: NewGeneration, bytes: Buffer): GeneratedPack {
    const directory = this.clientDirectory(generation.clientId)
    mkdirSync(directory, { recursive: true })
    const path = freePath(directory, generation.fileName)
    const part = `${path}.part`
    writeFileSync(part, bytes)
    renameSync(part, path)
    const relativePath = relative(this.documentsRoot, path).split(sep).join('/')
    const sha256 = sha256Of(bytes)
    try {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db
          .prepare(
            'INSERT INTO id_sequences (kind, next) VALUES (?, 1) ON CONFLICT(kind) DO UPDATE SET next = next + 1',
          )
          .run('document')
        const next = this.db
          .prepare('SELECT next FROM id_sequences WHERE kind = ?')
          .get('document') as Row
        const id = `document-${String(Number(next['next'])).padStart(4, '0')}`
        this.db
          .prepare(
            `INSERT INTO generated_documents (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            generation.clientId,
            MEETING_PACK_KIND,
            generation.version,
            generation.format,
            generation.fileName,
            relativePath,
            bytes.length,
            generation.fingerprint,
            sha256,
            generation.generatedAt,
            generation.sourceAsOf,
            generation.meetingId,
            generation.meetingDate,
            generation.audience,
            generation.depth,
            generation.slideCount,
            generation.coreCount,
            generation.appendixCount,
          )
        this.db.exec('COMMIT')
        return { meta: { ...generation, id, filePath: path }, bytes }
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    } catch (error) {
      try {
        unlinkSync(path)
      } catch {
        /* the file may already be gone; the row is what failed */
      }
      throw error
    }
  }

  private clientDirectory(clientId: string): string {
    return join(this.documentsRoot, 'meeting-packs', safeSegment(clientId))
  }

  private metaOf(row: Row): GeneratedPackMeta {
    const relativePath = String(row['relative_path'])
    return {
      id: String(row['id']),
      version: Number(row['version']),
      generatedAt: String(row['generated_at']),
      sourceAsOf: String(row['source_as_of']),
      clientId: String(row['client_id']),
      meetingId: row['meeting_id'] === null ? null : String(row['meeting_id']),
      meetingDate: row['meeting_date'] === null ? null : String(row['meeting_date']),
      audience: String(row['audience']) as GeneratedPackMeta['audience'],
      format: String(row['format']) as PackFormat,
      depth: String(row['depth']) as MeetingPackDepth,
      fileName: String(row['file_name']),
      byteLength: Number(row['byte_length']),
      fingerprint: String(row['fingerprint']),
      slideCount: Number(row['slide_count']),
      coreCount: Number(row['core_count']),
      appendixCount: Number(row['appendix_count']),
      filePath: join(this.documentsRoot, ...relativePath.split('/')),
    }
  }
}

/** A client id as a directory name: nothing that could leave the documents root. */
function safeSegment(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/gu, '_')
  return safe === '.' || safe === '..' || safe === '' ? '_' : safe
}

function splitKey(key: string): {
  clientId: string
  meetingId: string | null
  depth: MeetingPackDepth
} {
  const [clientId = '', meeting = 'unscheduled', depth = 'full'] = key.split('|')
  return {
    clientId,
    meetingId: meeting === 'unscheduled' ? null : meeting,
    depth: depth as MeetingPackDepth,
  }
}

/** The directory a document's file lives in, for a caller that opens the folder. */
export function documentDirectory(meta: GeneratedPackMeta): string | null {
  return meta.filePath ? dirname(meta.filePath) : null
}

export { generationKey }
