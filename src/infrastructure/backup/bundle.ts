/**
 * The recovery bundle: everything a person's Financial OS is, in one
 * encrypted file that can leave the computer — the database as a verified
 * snapshot, every generated document, and a manifest that names each entry
 * with its SHA-256 — so a new computer can be given the file and the
 * passphrase and have the record back exactly.
 *
 * The cryptography is the platform's, not ours: scrypt turns the
 * passphrase into a key with a fresh salt; AES-256-GCM seals the archive
 * with a fresh nonce and authenticates the header beside it. A wrong
 * passphrase and a damaged file are indistinguishable by design — the seal
 * fails to open — and are reported as one refusal. Nothing of the key, the
 * passphrase or the plaintext is ever written anywhere but the caller's
 * memory.
 *
 *   FOSB · version · logN · r · p · salt(16) · nonce(12) · tag(16) · ciphertext
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto'
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
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import JSZip from 'jszip'
import {
  inspectDatabaseFile,
  makeSelfContained,
  recordCounts,
  snapshotTo,
  type Database,
} from '~/infrastructure/advisory/sqlite/database'
import { CURRENT_SCHEMA_VERSION } from '~/infrastructure/advisory/sqlite/schema'

export const BUNDLE_EXTENSION = '.financialos'
export const BUNDLE_FORMAT = 'financialos-bundle'
export const DATABASE_ENTRY = 'database/financial-os.db'
export const MANIFEST_ENTRY = 'manifest.json'

const MAGIC = Buffer.from('FOSB', 'ascii')
const FORMAT_VERSION = 1
const SALT_BYTES = 16
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + 4 + SALT_BYTES + NONCE_BYTES
/** scrypt: N = 2^14, r = 8, p = 1 — 16 MB of memory, well under a second on a laptop. */
const KDF = { logN: 14, r: 8, p: 1 }
const KDF_MAXMEM = 128 * 1024 * 1024

export interface BundleEntry {
  path: string
  bytes: number
  sha256: string
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT
  formatVersion: 1
  bundleId: string
  createdAt: string
  appVersion: string
  schemaVersion: number
  counts: { clients: number; offices: number; documents: number }
  entries: BundleEntry[]
}

export type BundleErrorCode =
  | 'NOT_A_BUNDLE'
  | 'UNSUPPORTED_VERSION'
  | 'WRONG_PASSPHRASE'
  | 'CORRUPT'
  | 'MISSING_ENTRY'
  | 'CHECKSUM_MISMATCH'
  | 'SCHEMA_TOO_NEW'
  | 'DATABASE_INVALID'

export class BundleError extends Error {
  constructor(
    readonly code: BundleErrorCode,
    readonly detail: string = '',
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'BundleError'
  }
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/* ---------------------------------------------------------------- create */

export interface CreateBundleInput {
  db: Database
  /** The data directory's `documents` folder; every file under it enters the bundle. */
  documentsRoot: string
  /** The bundle's final path; written whole under a temporary name and renamed into place. */
  destination: string
  passphrase: string
  appVersion: string
  now?: () => Date
}

export interface CreatedBundle {
  path: string
  manifest: BundleManifest
  sizeBytes: number
  /** SHA-256 of the whole file as written, for the destination's record. */
  sha256: string
}

export async function createBundle(input: CreateBundleInput): Promise<CreatedBundle> {
  if (input.passphrase.length < 8) throw new Error('passphrase too short')
  const at = (input.now ?? (() => new Date()))()
  mkdirSync(dirname(input.destination), { recursive: true })

  /* The database: a verified, self-contained snapshot taken through the backup API. */
  const temp = join(tmpdir(), `fos-bundle-${randomUUID()}.db`)
  await snapshotTo(input.db, temp)
  makeSelfContained(temp)
  const inspection = inspectDatabaseFile(temp)
  if (inspection.quickCheck !== 'ok' || inspection.foreignKeyViolations > 0) {
    unlinkSync(temp)
    throw new BundleError('DATABASE_INVALID', inspection.quickCheck)
  }
  const dbBytes = readFileSync(temp)
  unlinkSync(temp)

  const entries: BundleEntry[] = []
  const zip = new JSZip()
  const put = (path: string, bytes: Buffer) => {
    zip.file(path, bytes, { date: at })
    entries.push({ path, bytes: bytes.length, sha256: sha256Of(bytes) })
  }
  put(DATABASE_ENTRY, dbBytes)
  for (const file of walkDocuments(input.documentsRoot)) {
    put(`documents/${file.relativePath}`, readFileSync(file.path))
  }
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    formatVersion: FORMAT_VERSION,
    bundleId: randomUUID(),
    createdAt: at.toISOString(),
    appVersion: input.appVersion,
    schemaVersion: inspection.schemaVersion,
    counts: recordCounts(input.db),
    entries,
  }
  zip.file(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2)), { date: at })
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const sealed = seal(archive, input.passphrase)
  const part = `${input.destination}.part`
  writeFileSync(part, sealed)
  renameSync(part, input.destination)
  return {
    path: input.destination,
    manifest,
    sizeBytes: sealed.length,
    sha256: sha256Of(sealed),
  }
}

/* ------------------------------------------------------------------ open */

export interface OpenedBundle {
  manifest: BundleManifest
  zip: JSZip
  /** Bytes of the file as read, so a caller can record what it verified. */
  sizeBytes: number
  sha256: string
}

/** Open and unseal; the manifest is read and checked for shape, nothing else is yet. */
export async function openBundle(path: string, passphrase: string): Promise<OpenedBundle> {
  if (!existsSync(path)) throw new BundleError('NOT_A_BUNDLE', 'file missing')
  const sealed = readFileSync(path)
  const archive = unseal(sealed, passphrase)
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(archive)
  } catch (error) {
    throw new BundleError('CORRUPT', error instanceof Error ? error.message : 'archive')
  }
  const manifestFile = zip.file(MANIFEST_ENTRY)
  if (!manifestFile) throw new BundleError('MISSING_ENTRY', MANIFEST_ENTRY)
  let manifest: BundleManifest
  try {
    manifest = JSON.parse(await manifestFile.async('string')) as BundleManifest
  } catch {
    throw new BundleError('CORRUPT', 'manifest')
  }
  if (manifest.format !== BUNDLE_FORMAT || !Array.isArray(manifest.entries))
    throw new BundleError('NOT_A_BUNDLE', 'manifest format')
  if (manifest.formatVersion !== FORMAT_VERSION)
    throw new BundleError('UNSUPPORTED_VERSION', String(manifest.formatVersion))
  return { manifest, zip, sizeBytes: sealed.length, sha256: sha256Of(sealed) }
}

export async function readEntry(bundle: OpenedBundle, path: string): Promise<Buffer> {
  const file = bundle.zip.file(path)
  if (!file) throw new BundleError('MISSING_ENTRY', path)
  const bytes = await file.async('nodebuffer')
  const entry = bundle.manifest.entries.find((e) => e.path === path)
  if (!entry) throw new BundleError('MISSING_ENTRY', `${path} not in manifest`)
  if (sha256Of(bytes) !== entry.sha256) throw new BundleError('CHECKSUM_MISMATCH', path)
  return bytes
}

/* ---------------------------------------------------------------- verify */

export interface BundleIssue {
  code: BundleErrorCode
  path?: string
  detail?: string
}

export interface BundleInspection {
  ok: boolean
  manifest: BundleManifest
  issues: BundleIssue[]
  /** The bundled database opened and checked, when its bytes were sound. */
  database: { quickCheck: string; foreignKeyViolations: number; schemaVersion: number } | null
  /** Whether this application can open the bundled record: its schema is not ahead of ours. */
  schemaCompatible: boolean
  documents: number
  sizeBytes: number
  sha256: string
}

/**
 * Everything short of restoring: every entry present and matching its
 * checksum, the database opened and checked, its schema not ahead of the
 * application's. The file is not changed.
 */
export async function verifyBundle(
  path: string,
  passphrase: string,
  options: { currentSchemaVersion?: number } = {},
): Promise<BundleInspection> {
  const bundle = await openBundle(path, passphrase)
  const issues: BundleIssue[] = []
  let database: BundleInspection['database'] = null
  for (const entry of bundle.manifest.entries) {
    const file = bundle.zip.file(entry.path)
    if (!file) {
      issues.push({ code: 'MISSING_ENTRY', path: entry.path })
      continue
    }
    const bytes = await file.async('nodebuffer')
    if (sha256Of(bytes) !== entry.sha256) {
      issues.push({ code: 'CHECKSUM_MISMATCH', path: entry.path })
      continue
    }
    if (entry.path === DATABASE_ENTRY) {
      const temp = join(tmpdir(), `fos-verify-${randomUUID()}.db`)
      try {
        writeFileSync(temp, bytes)
        const inspection = inspectDatabaseFile(temp)
        database = {
          quickCheck: inspection.quickCheck,
          foreignKeyViolations: inspection.foreignKeyViolations,
          schemaVersion: inspection.schemaVersion,
        }
        if (inspection.quickCheck !== 'ok' || inspection.foreignKeyViolations > 0)
          issues.push({ code: 'DATABASE_INVALID', detail: inspection.quickCheck })
      } catch (error) {
        issues.push({
          code: 'DATABASE_INVALID',
          detail: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (existsSync(temp)) unlinkSync(temp)
      }
    }
  }
  if (!bundle.manifest.entries.some((e) => e.path === DATABASE_ENTRY))
    issues.push({ code: 'MISSING_ENTRY', path: DATABASE_ENTRY })
  const current = options.currentSchemaVersion ?? CURRENT_SCHEMA_VERSION
  const schemaCompatible = bundle.manifest.schemaVersion <= current
  if (!schemaCompatible)
    issues.push({
      code: 'SCHEMA_TOO_NEW',
      detail: `bundle v${bundle.manifest.schemaVersion}, application v${current}`,
    })
  return {
    ok: issues.length === 0,
    manifest: bundle.manifest,
    issues,
    database,
    schemaCompatible,
    documents: bundle.manifest.entries.filter((e) => e.path.startsWith('documents/')).length,
    sizeBytes: bundle.sizeBytes,
    sha256: bundle.sha256,
  }
}

/* --------------------------------------------------------------- sealing */

function deriveKey(passphrase: string, salt: Buffer, logN: number, r: number, p: number): Buffer {
  return scryptSync(Buffer.from(passphrase.normalize('NFKC'), 'utf8'), salt, 32, {
    N: 2 ** logN,
    r,
    p,
    maxmem: KDF_MAXMEM,
  })
}

function seal(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(SALT_BYTES)
  const nonce = randomBytes(NONCE_BYTES)
  const header = Buffer.concat([
    MAGIC,
    Buffer.from([FORMAT_VERSION, KDF.logN, KDF.r, KDF.p]),
    salt,
    nonce,
  ])
  const key = deriveKey(passphrase, salt, KDF.logN, KDF.r, KDF.p)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(header)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  key.fill(0)
  return Buffer.concat([header, tag, ciphertext])
}

function unseal(sealed: Buffer, passphrase: string): Buffer {
  if (sealed.length < HEADER_BYTES + TAG_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC))
    throw new BundleError('NOT_A_BUNDLE')
  const version = sealed[MAGIC.length]!
  if (version !== FORMAT_VERSION) throw new BundleError('UNSUPPORTED_VERSION', String(version))
  const logN = sealed[MAGIC.length + 1]!
  const r = sealed[MAGIC.length + 2]!
  const p = sealed[MAGIC.length + 3]!
  if (logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 16)
    throw new BundleError('CORRUPT', 'kdf parameters')
  const header = sealed.subarray(0, HEADER_BYTES)
  const salt = sealed.subarray(MAGIC.length + 4, MAGIC.length + 4 + SALT_BYTES)
  const nonce = sealed.subarray(MAGIC.length + 4 + SALT_BYTES, HEADER_BYTES)
  const tag = sealed.subarray(HEADER_BYTES, HEADER_BYTES + TAG_BYTES)
  const ciphertext = sealed.subarray(HEADER_BYTES + TAG_BYTES)
  const key = deriveKey(passphrase, salt, logN, r, p)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(header)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    /* The seal did not open: the passphrase is wrong or the file was changed; the two are one refusal by design. */
    throw new BundleError('WRONG_PASSPHRASE')
  } finally {
    key.fill(0)
  }
}

/* ------------------------------------------------------------- documents */

export interface DocumentFile {
  path: string
  /** Forward-slash path relative to the documents root. */
  relativePath: string
}

/** Every file under the documents root, in a stable order; nothing in flight (`.part`) or set aside. */
export function walkDocuments(root: string): DocumentFile[] {
  if (!existsSync(root)) return []
  const out: DocumentFile[] = []
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        if (name.startsWith('.') || /\.replaced-/u.test(name)) continue
        visit(path)
      } else if (stat.isFile() && !name.endsWith('.part')) {
        out.push({ path, relativePath: relative(root, path).split(sep).join('/') })
      }
    }
  }
  visit(root)
  return out
}
