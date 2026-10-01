/**
 * Every generated pack, remembered: version, provenance, format, bytes.
 *
 * Process-local, like the rest of the synthetic record (TD-104): nothing
 * persists past a restart. What the store guarantees inside a process is
 * that a version is never silently overwritten — a regenerated pack over
 * an unchanged record returns the version already made; a changed record
 * gets the next number; an earlier version keeps its metadata and its
 * bytes. Files are also written beside the repository, git-ignored, so a
 * generated sample can be opened and inspected; the version counter
 * respects files already on disk with the same base name.
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

export function generationKey(
  clientId: string,
  meetingId: string | null,
  depth: MeetingPackDepth,
): string {
  return `${clientId}|${meetingId ?? 'unscheduled'}|${depth}`
}

export class MeetingPackStore {
  private readonly generations = new Map<string, GeneratedPack[]>()
  private counter = 0

  constructor(private readonly directory: string | null) {}

  /** Every generation for a client, meeting and depth, newest first. */
  list(
    clientId: string,
    meetingId: string | null,
    depth: MeetingPackDepth,
  ): GeneratedPackMeta[] {
    return [...(this.generations.get(generationKey(clientId, meetingId, depth)) ?? [])]
      .map((g) => g.meta)
      .sort((a, b) => b.version - a.version || b.generatedAt.localeCompare(a.generatedAt))
  }

  /**
   * Every generation for a client at a depth, whichever meeting it was for,
   * newest first — the preview's list. A confirmed update can move the next
   * meeting; the packs already made do not vanish with it.
   */
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

  /** The generation already made for this content and format, if any: regenerating it would say nothing new. */
  existing(key: string, fingerprint: string, format: PackFormat): GeneratedPack | null {
    return (
      (this.generations.get(key) ?? []).find(
        (g) => g.meta.fingerprint === fingerprint && g.meta.format === format,
      ) ?? null
    )
  }

  /**
   * The version the next file gets: the version already given to this
   * content, or one past the highest version known — in memory or on disk
   * under the same base name.
   */
  nextVersion(key: string, fingerprint: string, fileBaseName: string): number {
    const gens = this.generations.get(key) ?? []
    const same = gens.find((g) => g.meta.fingerprint === fingerprint)
    if (same) return same.meta.version
    const inMemory = gens.reduce((max, g) => Math.max(max, g.meta.version), 0)
    return Math.max(inMemory, this.highestOnDisk(fileBaseName)) + 1
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

  private highestOnDisk(fileBaseName: string): number {
    if (!this.directory || !existsSync(this.directory)) return 0
    const pattern = new RegExp(`^${escape(fileBaseName)}_v(\\d+)\\.(pptx|pdf)$`)
    let highest = 0
    for (const name of readdirSync(this.directory)) {
      const match = pattern.exec(name)
      if (match) highest = Math.max(highest, Number(match[1]))
    }
    return highest
  }

  /** Never over an existing file: the version counter already accounted for the disk. */
  private write(fileName: string, bytes: Buffer): string | null {
    if (!this.directory) return null
    mkdirSync(this.directory, { recursive: true })
    let path = join(this.directory, fileName)
    let attempt = 1
    while (existsSync(path)) {
      attempt += 1
      path = join(this.directory, fileName.replace(/(\.[a-z]+)$/u, `-${attempt}$1`))
    }
    writeFileSync(path, bytes)
    return path
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

let instance: MeetingPackStore | null = null

/** The process's one store, writing beside the repository under `.generated/meeting-packs`. */
export function meetingPackStore(): MeetingPackStore {
  if (!instance) {
    instance = new MeetingPackStore(join(process.cwd(), '.generated', 'meeting-packs'))
  }
  return instance
}
