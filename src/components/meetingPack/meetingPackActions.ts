/**
 * What the Meeting Pack preview may ask for: a generation in one or two
 * formats, an earlier version's bytes again, and a way to hand a file to
 * the person. The route implements these over the server functions and the
 * browser's download; a test implements them in memory.
 */

import type { MeetingPackDepth } from '~/application/advisory/meetingPack'
import type {
  DownloadMeetingPackResponse,
  GenerateMeetingPackResponse,
} from '~/infrastructure/advisory/serverFns'
import type { PackFormat } from '~/application/advisory/meetingPackVersions'

export interface PackFile {
  fileName: string
  base64: string
  format: PackFormat
}

/** What a door asked for: one format, or both. Only preselects a button. */
export type RequestedFormat = PackFormat | 'both'

export interface MeetingPackActions {
  generate(
    depth: MeetingPackDepth,
    formats: readonly PackFormat[],
  ): Promise<GenerateMeetingPackResponse>
  download(id: string): Promise<DownloadMeetingPackResponse>
  /** Hand the file to the person — the browser's download in the product, a spy in a test. */
  save(file: PackFile): void
}

export const PACK_MIME: Record<PackFormat, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
}

/** The browser's download of a generated file, from its base64 bytes. */
export function saveInBrowser(file: PackFile): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: PACK_MIME[file.format] })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
