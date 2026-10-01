// @vitest-environment node
/**
 * The generated files, read back: the PowerPoint opens as a zip of native
 * slides with editable text, tables, charts and notes and no picture; the
 * PDF opens with the expected pages, titles, figures, footer and page
 * numbers; and, from one pack, the two formats agree on the client, the
 * meeting, the focus, the figures, the commitments and the data date. The
 * store versions without overwriting; the policy is enforced at the door.
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { meetingPack, type MeetingPack } from '~/application/advisory/meetingPack'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { composePackDocument } from '~/presentation/documents/meetingPackDocument'
import type { PackDocument } from '~/presentation/documents/packDocument'
import {
  readPdf,
  readPptx,
  type PdfReading,
  type PptxReading,
} from '~/test/documentReaders'
import { generateMeetingPack } from './generateMeetingPack'
import { MeetingPackStore } from './meetingPackStore'
import { renderPdf } from './pdf'
import { renderPptx } from './pptx'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

let pack: MeetingPack
let doc: PackDocument
let pptx: PptxReading
let pdf: PdfReading
let pptxBytes: Buffer
let pdfBytes: Buffer

beforeAll(async () => {
  pack = (await meetingPack(contextAt(), 'cl-dahlqvist'))!
  doc = composePackDocument(pack)
  ;[pptxBytes, pdfBytes] = await Promise.all([renderPptx(doc), renderPdf(doc)])
  ;[pptx, pdf] = await Promise.all([readPptx(pptxBytes), readPdf(pdfBytes)])
}, 60_000)

const ids = () => [...Object.keys(pack.titles), pack.identity.clientId]

describe('the PowerPoint', () => {
  it('opens as one native slide per document slide, in order, with the titles', () => {
    expect(pptxBytes.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(pptx.slides.length).toBe(doc.slides.length)
    doc.slides.forEach((slide, i) => {
      const texts = pptx.slides[i]!.texts.join(' ')
      expect(texts, slide.kind).toContain(slide.headline)
      expect(texts, slide.kind).toContain(slide.kicker.toUpperCase())
    })
  })

  it('is built from editable text, tables and charts — never a picture of a screen', () => {
    expect(pptx.slides.every((s) => s.texts.length > 3)).toBe(true)
    expect(pptx.slides.some((s) => s.hasTable)).toBe(true)
    expect(pptx.slides.filter((s) => s.hasChart).length).toBe(2)
    expect(pptx.chartParts).toBe(2)
    expect(pptx.slides.every((s) => !s.hasPicture)).toBe(true)
  })

  it('carries speaker notes on every slide that has them, and keeps them off the body', () => {
    doc.slides.forEach((slide, i) => {
      const reading = pptx.slides[i]!
      if (slide.notes.length === 0) return
      const notes = reading.notes.join('\n')
      for (const note of slide.notes) expect(notes, slide.kind).toContain(note.text)
      const body = reading.texts.join('\n')
      const internalOnly = slide.notes.find(
        (n) => n.kind === 'do-not-claim' || n.kind === 'watch-out',
      )
      if (internalOnly) expect(body).not.toContain(internalOnly.text)
    })
  })

  it('names the right client and meeting on every slide, with the footer and no id', () => {
    for (const slide of pptx.slides) {
      const texts = slide.texts.join(' ')
      expect(texts).toContain('Anna & Per Dahlqvist')
      expect(texts).toContain('KONFIDENTIELLT · INTERNT RÅDGIVARMATERIAL')
      expect(texts).toMatch(/Data per 23 sep 2026/)
      expect(texts).toMatch(new RegExp(`Bild ${slide.index} / ${doc.slides.length}`))
      expect(texts).toContain('INTERNT')
      for (const id of ids()) expect(texts, id).not.toContain(id)
    }
    expect(pptx.slides[0]!.texts.join(' ')).toContain('möte 26 sep')
  })
})

describe('the PDF', () => {
  it('opens with one section per slide, the titles selectable as text', () => {
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdf.pageCount).toBeGreaterThanOrEqual(doc.slides.length)
    expect(pdf.pageCount).toBeLessThanOrEqual(doc.slides.length + 8)
    const all = pdf.pages.join('\n')
    for (const slide of doc.slides) {
      expect(all, slide.kind).toContain(slide.kicker.toUpperCase())
    }
    expect(all).toContain(doc.slides[1]!.headline)
    expect(pdf.title).toBe('Mötesunderlag · Anna & Per Dahlqvist')
  })

  it('numbers its pages, carries the confidential footer, the client and the figures, and no id', () => {
    pdf.pages.forEach((page, i) => {
      expect(page, `page ${i + 1}`).toContain(`Sida ${i + 1} / ${pdf.pageCount}`)
      expect(page).toContain('KONFIDENTIELLT · INTERNT RÅDGIVARMATERIAL')
      expect(page).toContain('Anna & Per Dahlqvist')
      for (const id of ids()) expect(page, id).not.toContain(id)
    })
    const all = pdf.pages.join(' ')
    expect(all).toContain('42,0 MSEK')
    expect(all).toContain('22,5 MSEK')
    expect(all).toContain('TALEPUNKTER · INTERNT')
    expect(all).not.toMatch(/−|→/)
  })
})

describe('cross-format consistency', () => {
  it('the two files say the same thing about the client, the meeting, the focus, the figures, the promises and the date', () => {
    const slidesText = pptx.slides.map((s) => s.texts.join(' ')).join('\n')
    const pagesText = pdf.pages.join('\n')
    const normalise = (t: string) => t.replace(/−/g, '-').replace(/\s+/g, ' ')
    const a = normalise(slidesText)
    const b = normalise(pagesText)
    const shared = [
      pack.identity.clientName,
      doc.slides[0]!.blocks.find((x) => x.kind === 'kpis')!.kind === 'kpis'
        ? '26 sep 2026'
        : '',
      ...doc.slides.map((s) => s.headline),
      '42,0 MSEK',
      '4,9 MSEK',
      '22,5 MSEK',
      '19,5 MSEK',
      ...pack.commitments.map((p) => p.commitment.title),
      'Data per 23 sep 2026',
    ].filter((t) => t.length > 0)
    for (const text of shared) {
      const t = normalise(text)
      expect(a, `pptx: ${text}`).toContain(t)
      expect(b, `pdf: ${text}`).toContain(t)
    }
  })
})

describe('generation, versions and the policy', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'meeting-pack-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates both formats under one version, reuses it for an unchanged record, and steps the version when the record moves', async () => {
    const store = new MeetingPackStore(dir)
    const context = contextAt()
    const first = await generateMeetingPack(context, store, {
      clientId: 'cl-dahlqvist',
      depth: 'full',
      formats: ['pptx', 'pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!first.ok) throw new Error(first.code)
    expect(first.files.map((f) => f.meta.version)).toEqual([1, 1])
    expect(first.files.map((f) => f.meta.fileName)).toEqual([
      'Anna_Per_Dahlqvist_Motesunderlag_2026-09-26_v1.pptx',
      'Anna_Per_Dahlqvist_Motesunderlag_2026-09-26_v1.pdf',
    ])
    expect(first.files.every((f) => !f.reused)).toBe(true)
    expect(first.files[0]!.meta).toMatchObject({
      audience: 'INTERNAL_ADVISOR',
      clientId: 'cl-dahlqvist',
      depth: 'full',
      sourceAsOf: TODAY,
      format: 'pptx',
    })
    expect(first.files[0]!.meta.meetingId).toBe(first.pack.meeting.eventId)
    expect(readdirSync(dir).sort()).toEqual([
      'Anna_Per_Dahlqvist_Motesunderlag_2026-09-26_v1.pdf',
      'Anna_Per_Dahlqvist_Motesunderlag_2026-09-26_v1.pptx',
    ])

    const again = await generateMeetingPack(context, store, {
      clientId: 'cl-dahlqvist',
      depth: 'full',
      formats: ['pptx'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!again.ok) throw new Error(again.code)
    expect(again.files[0]!.reused).toBe(true)
    expect(again.files[0]!.meta.id).toBe(first.files[0]!.meta.id)
    expect(readdirSync(dir).length).toBe(2)

    /* The record moves: a promise is completed. */
    await context.repositories.commitments.saveCommitment({
      ...first.pack.commitments[0]!.commitment,
      status: 'done',
      completedAt: TODAY,
    })
    const moved = await generateMeetingPack(context, store, {
      clientId: 'cl-dahlqvist',
      depth: 'full',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!moved.ok) throw new Error(moved.code)
    expect(moved.files[0]!.meta.version).toBe(2)
    expect(moved.files[0]!.reused).toBe(false)
    expect(moved.pack.fingerprint).not.toBe(first.pack.fingerprint)
    /* v1 is intact: same metadata, same bytes. */
    const v1 = store.get(first.files[1]!.meta.id)!
    expect(v1.meta).toEqual(first.files[1]!.meta)
    expect(v1.bytes.toString('base64')).toBe(first.files[1]!.base64)
    expect(
      store
        .list('cl-dahlqvist', first.pack.meeting.eventId, 'full')
        .map((m) => m.version),
    ).toEqual([2, 1, 1])
    expect(readdirSync(dir)).toContain(
      'Anna_Per_Dahlqvist_Motesunderlag_2026-09-26_v2.pdf',
    )
  })

  it('respects versions already on disk from an earlier process', async () => {
    const store = new MeetingPackStore(dir)
    const result = await generateMeetingPack(contextAt(), store, {
      clientId: 'cl-dahlqvist',
      depth: 'full',
      formats: ['pptx'],
      audience: 'INTERNAL_ADVISOR',
    })
    if (!result.ok) throw new Error(result.code)
    expect(result.files[0]!.meta.version).toBe(3)
  })

  it('refuses any audience but the internal advisor, and a blocked record', async () => {
    const store = new MeetingPackStore(null)
    const facing = await generateMeetingPack(contextAt(), store, {
      clientId: 'cl-dahlqvist',
      depth: 'full',
      formats: ['pptx'],
      audience: 'FUTURE_CLIENT',
    })
    expect(facing).toEqual({ ok: false, code: 'AUDIENCE_NOT_ALLOWED' })
    await expect(
      renderPptx({ ...doc, audience: 'FUTURE_CLIENT' as never }),
    ).rejects.toThrow()
    await expect(
      renderPdf({ ...doc, audience: 'FUTURE_CLIENT' as never }),
    ).rejects.toThrow()

    const seed = syntheticClients(TODAY)
    const blockedContext: AdvisoryContext = {
      repositories: createSyntheticAdvisoryRepositories({
        ...seed,
        assets: seed.assets.filter((a) => a.clientId !== 'cl-ceder'),
        portfolios: seed.portfolios.filter((p) => p.clientId !== 'cl-ceder'),
      }),
      clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
    }
    const blocked = await generateMeetingPack(blockedContext, store, {
      clientId: 'cl-ceder',
      depth: 'full',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    expect(blocked).toEqual({ ok: false, code: 'BLOCKED' })
    const unknown = await generateMeetingPack(contextAt(), store, {
      clientId: 'cl-nobody',
      depth: 'full',
      formats: ['pdf'],
      audience: 'INTERNAL_ADVISOR',
    })
    expect(unknown).toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})
