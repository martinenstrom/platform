/**
 * Generation, end to end: the pack from the record, the audience checked
 * against the policy, the readiness gate, the document composed once, each
 * requested format rendered from that one document, the version assigned
 * and the file kept. The two formats cannot disagree: they never saw
 * anything but the same PackDocument.
 */

import type { AdvisoryContext } from '~/application/advisory/ports'
import {
  meetingPack,
  type MeetingPack,
  type MeetingPackAudience,
  type MeetingPackDepth,
} from '~/application/advisory/meetingPack'
import { isGeneratable } from '~/application/advisory/meetingPackPolicy'
import { composePackDocument } from '~/presentation/documents/meetingPackDocument'
import type { PackDocument } from '~/presentation/documents/packDocument'
import {
  generationKey,
  type GeneratedPackMeta,
  type MeetingPackStore,
  type PackFormat,
} from './meetingPackStore'
import { renderPdf } from './pdf'
import { renderPptx } from './pptx'

export interface GenerateMeetingPackInput {
  clientId: string
  depth: MeetingPackDepth
  formats: readonly PackFormat[]
  audience: MeetingPackAudience
}

export interface GeneratedFile {
  meta: GeneratedPackMeta
  base64: string
  /** True when the store already held this content in this format and nothing was rendered again. */
  reused: boolean
}

export type GenerateMeetingPackResult =
  | {
      ok: true
      pack: MeetingPack
      document: Pick<PackDocument, 'coreCount' | 'appendixCount' | 'fileBaseName'>
      files: GeneratedFile[]
      versions: GeneratedPackMeta[]
    }
  | {
      ok: false
      code: 'NOT_FOUND' | 'BLOCKED' | 'AUDIENCE_NOT_ALLOWED' | 'NO_FORMAT'
    }

export async function generateMeetingPack(
  context: AdvisoryContext,
  store: MeetingPackStore,
  input: GenerateMeetingPackInput,
): Promise<GenerateMeetingPackResult> {
  if (!isGeneratable(input.audience)) return { ok: false, code: 'AUDIENCE_NOT_ALLOWED' }
  const formats = [...new Set(input.formats)]
  if (formats.length === 0) return { ok: false, code: 'NO_FORMAT' }
  const pack = await meetingPack(context, input.clientId, input.depth)
  if (!pack) return { ok: false, code: 'NOT_FOUND' }
  if (pack.readiness.state === 'BLOCKERAD') return { ok: false, code: 'BLOCKED' }

  const document = composePackDocument(pack)
  const key = generationKey(pack.identity.clientId, pack.meeting.eventId, pack.depth)
  const files: GeneratedFile[] = []
  for (const format of formats) {
    const existing = store.existing(key, pack.fingerprint, format)
    if (existing) {
      files.push({
        meta: existing.meta,
        base64: existing.bytes.toString('base64'),
        reused: true,
      })
      continue
    }
    const bytes =
      format === 'pptx' ? await renderPptx(document) : await renderPdf(document)
    const version = store.nextVersion(key, pack.fingerprint, document.fileBaseName)
    const generated = store.add(
      {
        version,
        generatedAt: pack.generatedAt,
        sourceAsOf: pack.dataAsOf,
        clientId: pack.identity.clientId,
        meetingId: pack.meeting.eventId,
        meetingDate: pack.meeting.date,
        audience: pack.audience,
        format,
        depth: pack.depth,
        fileName: `${document.fileBaseName}_v${version}.${format}`,
        byteLength: bytes.length,
        fingerprint: pack.fingerprint,
        slideCount: document.slides.length,
        coreCount: document.coreCount,
        appendixCount: document.appendixCount,
      },
      bytes,
    )
    files.push({ meta: generated.meta, base64: bytes.toString('base64'), reused: false })
  }
  return {
    ok: true,
    pack,
    document: {
      coreCount: document.coreCount,
      appendixCount: document.appendixCount,
      fileBaseName: document.fileBaseName,
    },
    files,
    versions: store.listForClient(pack.identity.clientId, pack.depth),
  }
}
