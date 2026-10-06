/**
 * Every generated pack, remembered: version, provenance, format, bytes.
 *
 * What a store guarantees is that a version is never silently overwritten
 * — a regenerated pack over an unchanged record returns the version
 * already made; a changed record gets the next number; an earlier version
 * keeps its metadata and its bytes. Two stores keep that promise: the
 * record's own, on SQLite with the files under the person's data
 * directory (`sqliteMeetingPackStore.ts`), which survives a restart; and
 * the process-local one below, for the synthetic record, writing beside
 * the repository so a generated sample can be opened and inspected.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MeetingPackDepth } from '~/application/advisory/meetingPack'
import type {
  GeneratedPackMeta,
  PackFormat,
} from '~/application/advisory/meetingPackVersions'

export type { GeneratedPackMeta, PackFormat }

export interface GeneratedPack {
  meta: GeneratedPackMeta
  bytes: Buffer
}

export type NewGeneration = Omit<GeneratedPackMeta, 'id' | 'filePath'>

/** What a generation needs of a store; the generator never knows which it got. */
export interface MeetingPackStore {
  /** Every generation for a client, meeting and depth, newest first. */
  list(
    clientId: string,
    meetingId: string | null,
    depth: MeetingPackDepth,
  ): GeneratedPackMeta[]
  /**
   * Every generation for a client at a depth, whichever meeting it was for,
   * newest first — the preview's list. A confirmed update can move the next
   * meeting; the packs already made do not vanish with it.
   */
  listForClient(clientId: string, depth?: MeetingPackDepth): GeneratedPackMeta[]
  /** A generation's metadata and bytes again, by id; null when no such generation exists. */
  get(id: string): GeneratedPack | null
  /** The generation already made for this content and format, if any: regenerating it would say nothing new. */
  existing(key: string, fingerprint: string, format: PackFormat): GeneratedPack | null
  /**
   * The version the next file gets: the version already given to this
   * content, or one past the highest version known — in the store or on
   * disk under the same base name.
   */
  nextVersion(key: string, fingerprint: string, fileBaseName: string): number
  add(generation: NewGeneration, bytes: Buffer): GeneratedPack
}

export function generationKey(
  clientId: string,
  meetingId: string | null,
  depth: MeetingPackDepth,
): string {
  return `${clientId}|${meetingId ?? 'unscheduled'}|${depth}`
}

/** The highest `<base>_v<n>.<pptx|pdf>` already in a directory, so a version number is never reused across processes. */
export function highestVersionOnDisk(directory: string | null, fileBaseName: string): number {
  if (!directory || !existsSync(directory)) return 0
  const pattern = new RegExp(`^${escape(fileBaseName)}_v(\\d+)\\.(pptx|pdf)$`)
  let highest = 0
  for (const name of readdirSync(directory)) {
    const match = pattern.exec(name)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return highest
}

/** Never over an existing file: a name already taken gets a suffix. */
export function freePath(directory: string, fileName: string): string {
  let path = join(directory, fileName)
  let attempt = 1
  while (existsSync(path)) {
    attempt += 1
    path = join(directory, fileName.replace(/(\.[a-z]+)$/u, `-${attempt}$1`))
  }
  return path
}

/**
 * Process-local, like the rest of the synthetic record (TD-104): nothing
 * persists past a restart except the files, which the version counter
 * respects when it finds them.
 */
export class MemoryMeetingPackStore implements MeetingPackStore {
  private readonly generations = new Map<string, GeneratedPack[]>()
  private counter = 0

  constructor(private readonly directory: string | null) {}

  list(
    clientId: string,
    meetingId: string | null,
    depth: MeetingPackDepth,
  ): GeneratedPackMeta[] {
    return [...(this.generations.get(generationKey(clientId, meetingId, depth)) ?? [])]
      .map((g) => g.meta)
      .sort((a, b) => b.version - a.version || b.generatedAt.localeCompare(a.generatedAt))
  }

  listForClient(clientId: string, depth?: MeetingPackDepth): GeneratedPackMeta[] {
    const out: GeneratedPackMeta[] = []
    for (const [key, gens] of this.generations) {
      if (!key.startsWith(`${clientId}|`)) continue
      for (const g of gens) if (!depth || g.meta.depth === depth) out.push(g.meta)
    }
    return out.sort(
      (a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.version - a.version,
    )
  }

  get(id: string): GeneratedPack | null {
    for (const gens of this.generations.values()) {
      const found = gens.find((g) => g.meta.id === id)
      if (found) return found
    }
    return null
  }

  existing(key: string, fingerprint: string, format: PackFormat): GeneratedPack | null {
    return (
      (this.generations.get(key) ?? []).find(
        (g) => g.meta.fingerprint === fingerprint && g.meta.format === format,
      ) ?? null
    )
  }

  nextVersion(key: string, fingerprint: string, fileBaseName: string): number {
    const gens = this.generations.get(key) ?? []
    const same = gens.find((g) => g.meta.fingerprint === fingerprint)
    if (same) return same.meta.version
    const inMemory = gens.reduce((max, g) => Math.max(max, g.meta.version), 0)
    return Math.max(inMemory, highestVersionOnDisk(this.directory, fileBaseName)) + 1
  }

  add(generation: NewGeneration, bytes: Buffer): GeneratedPack {
    const key = generationKey(generation.clientId, generation.meetingId, generation.depth)
    this.counter += 1
    const id = `pack-${this.counter}-${generation.version}-${generation.format}`
    const filePath = this.write(generation.fileName, bytes)
    const pack: GeneratedPack = { meta: { ...generation, id, filePath }, bytes }
    const gens = this.generations.get(key) ?? []
    gens.push(pack)
    this.generations.set(key, gens)
    return pack
  }

  private write(fileName: string, bytes: Buffer): string | null {
    if (!this.directory) return null
    mkdirSync(this.directory, { recursive: true })
    const path = freePath(this.directory, fileName)
    writeFileSync(path, bytes)
    return path
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ------------------------------------------------------------ the one */

/*
 * The process's one store, on `globalThis` so every module instance shares
 * it (see `serverFns.ts`). Which store it is follows the record: once the
 * composition root has opened SQLite, the packs live beside it under the
 * person's data directory; on the synthetic record they live beside the
 * repository under `.generated/meeting-packs`, git-ignored.
 */
const STORE_KEY = Symbol.for('financial-os:meeting-pack-store')
interface Registered {
  store: MeetingPackStore
  /** The database the store was bound to, so a reopened record gets a fresh binding. */
  boundTo: unknown
}
const registry = globalThis as unknown as { [STORE_KEY]?: Registered }

export async function meetingPackStore(): Promise<MeetingPackStore> {
  const { advisoryStoreState } = await import('~/infrastructure/advisory/container')
  const state = advisoryStoreState()
  const sqlite = state?.kind === 'sqlite' && state.outcome?.ok ? state : null
  const boundTo = sqlite ? sqlite.outcome : null
  const registered = registry[STORE_KEY]
  if (registered && registered.boundTo === boundTo) return registered.store
  let store: MeetingPackStore
  if (sqlite && sqlite.outcome?.ok && sqlite.layout) {
    const { SqliteMeetingPackStore } = await import('./sqliteMeetingPackStore')
    store = new SqliteMeetingPackStore(sqlite.outcome.db, sqlite.layout.documents)
  } else {
    store = new MemoryMeetingPackStore(join(process.cwd(), '.generated', 'meeting-packs'))
  }
  registry[STORE_KEY] = { store, boundTo }
  return store
}
