/**
 * Read a generated document back as structure and text, so a test can
 * inspect what a PowerPoint or a PDF actually contains rather than trust
 * the renderer that made it.
 */

import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PptxSlideReading {
  index: number
  /** Every text run on the slide body, in document order. */
  texts: string[]
  hasTable: boolean
  hasChart: boolean
  hasPicture: boolean
  /** The notes page's text runs, when the slide has one. */
  notes: string[]
}

export interface PptxReading {
  slides: PptxSlideReading[]
  chartParts: number
}

function decode(xml: string): string {
  return xml
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function runs(xml: string): string[] {
  return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decode(m[1] ?? ''))
}

export async function readPptx(bytes: Buffer): Promise<PptxReading> {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
  const slideNames = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]))
  const slides: PptxSlideReading[] = []
  for (const name of slideNames) {
    const index = Number(name.match(/(\d+)/)![1])
    const xml = await zip.file(name)!.async('string')
    const relsName = `ppt/slides/_rels/slide${index}.xml.rels`
    const rels = zip.file(relsName) ? await zip.file(relsName)!.async('string') : ''
    const notesMatch = rels.match(/notesSlides\/(notesSlide\d+\.xml)/)
    const notesXml = notesMatch
      ? await zip.file(`ppt/notesSlides/${notesMatch[1]}`)?.async('string')
      : undefined
    slides.push({
      index,
      texts: runs(xml),
      hasTable: xml.includes('<a:tbl>'),
      hasChart: xml.includes('<c:chart') || rels.includes('/chart'),
      hasPicture: xml.includes('<p:pic>'),
      notes: notesXml ? runs(notesXml) : [],
    })
  }
  return {
    slides,
    chartParts: names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length,
  }
}

export interface PdfReading {
  pageCount: number
  /** Each page's text, runs joined by a space. */
  pages: string[]
  title: string | null
}

export async function readPdf(bytes: Buffer): Promise<PdfReading> {
  const document = await getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise
  const pages: string[] = []
  for (let n = 1; n <= document.numPages; n += 1) {
    const page = await document.getPage(n)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((s) => s.length > 0)
        .join(' '),
    )
  }
  const metadata = await document.getMetadata()
  const info = metadata.info as { Title?: string }
  return { pageCount: document.numPages, pages, title: info.Title ?? null }
}
