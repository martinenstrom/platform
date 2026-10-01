/**
 * What is known about a generated pack: the contract between the store
 * that keeps the files and the surfaces that list them. Application-level
 * so a component names no infrastructure module for a type.
 */

import type { MeetingPackAudience, MeetingPackDepth } from './meetingPack'

export type PackFormat = 'pptx' | 'pdf'

export interface GeneratedPackMeta {
  /** Opaque to the surface. */
  id: string
  version: number
  generatedAt: string
  sourceAsOf: string
  clientId: string
  meetingId: string | null
  meetingDate: string | null
  audience: MeetingPackAudience
  format: PackFormat
  depth: MeetingPackDepth
  fileName: string
  byteLength: number
  fingerprint: string
  slideCount: number
  coreCount: number
  appendixCount: number
  /** Where the file was written, when a directory was configured. */
  filePath: string | null
}
