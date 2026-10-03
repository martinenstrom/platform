/**
 * The PackDocument as a native, editable PowerPoint.
 *
 * One slide master carries the identity — navy ground, a gold hairline at
 * the head, a hairline above the footer — and every slide is drawn from
 * typed blocks with native text, shapes, tables and charts built from
 * data. Nothing is rasterised: the advisor can edit every word, move
 * every box, change every number and delete any slide. Speaker notes go
 * to the notes page, never to the slide body.
 *
 * The design language is editorial, not a dashboard: a 12-column grid
 * with weighted columns, figure strips separated by hairlines, tables
 * with a gold rule under the header and a rule above every total, charts
 * on the slide's own ground, small sans-serif margin notes, and Georgia
 * reserved for the headline and the key figures.
 */

import PptxGenJS from 'pptxgenjs'
import { formatLongDate } from '~/presentation/advisory/format'
import { CALLOUT_LABEL, NOTE_KIND_LABEL } from '~/presentation/documents/meetingPackText'
import {
  DOCUMENT_PALETTE as C,
  type CalloutKind,
  type KpiItem,
  type ListItem,
  type NoteLine,
  type PackBlock,
  type PackDocument,
  type PackSlide,
  type TimelineItem,
  type Tone,
} from '~/presentation/documents/packDocument'

/* --------------------------------------------------------------- geometry */

const W = 10
const H = 5.625
const M = 0.4
const BODY_BOTTOM = H - 0.5
const GAP = 0.1
const COLUMN_GAP = 0.22
const MASTER = 'FINANCIAL_OS_MEETING_PACK'

const DISPLAY = 'Georgia'
const BODY = 'Calibri'

const TONE_COLOR: Record<Tone, string> = {
  gold: C.gold,
  neutral: C.ivory,
  warning: C.negative,
  positive: C.positive,
  negative: C.negative,
}

const CALLOUT_COLOR: Record<CalloutKind, string> = {
  observation: C.gold,
  implication: C.gold,
  'why-it-matters': C.blueGrey,
  'watch-out': C.negative,
  verify: C.blueGrey,
}

const MARKER_LABEL = {
  fact: 'FAKTA',
  assessment: 'BEDÖMNING',
  suggestion: 'FÖRSLAG',
} as const

type Slide = PptxGenJS.Slide

/* ------------------------------------------------------------------ render */

export async function renderPptx(doc: PackDocument): Promise<Buffer> {
  if (doc.audience !== 'INTERNAL_ADVISOR') {
    throw new Error(`The PowerPoint renderer is built for the internal advisor pack only`)
  }
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'Financial OS'
  pptx.company = 'Financial OS'
  pptx.title = doc.title
  pptx.subject = doc.meetingLabel
  pptx.defineSlideMaster({
    title: MASTER,
    background: { color: C.navy },
    objects: [
      /* A hairline of gold at the head, not a band. */
      { rect: { x: 0, y: 0, w: W, h: 0.025, fill: { color: C.gold } } },
      {
        line: {
          x: M,
          y: H - 0.42,
          w: W - 2 * M,
          h: 0,
          line: { color: C.line, width: 0.5 },
        },
      },
    ],
  })
  const total = doc.slides.length
  doc.slides.forEach((slide, index) => {
    renderSlide(pptx, pptx.addSlide(MASTER), doc, slide, index + 1, total)
  })
  const out = await pptx.write({ outputType: 'nodebuffer' })
  return out as Buffer
}

function renderSlide(
  pptx: PptxGenJS,
  slide: Slide,
  doc: PackDocument,
  s: PackSlide,
  number: number,
  total: number,
): void {
  const appendix = s.section === 'appendix'
  smallCaps(slide, s.kicker, {
    x: M,
    y: 0.22,
    w: W - 2 * M - 3,
    h: 0.2,
    color: appendix ? C.blueGrey : C.gold,
  })
  slide.addText(`${doc.internalMark} · Data per ${formatLongDate(doc.dataAsOf)}`, {
    x: W - M - 3,
    y: 0.22,
    w: 3,
    h: 0.2,
    align: 'right',
    fontFace: BODY,
    fontSize: 7,
    color: C.blueGrey,
    charSpacing: 1.5,
    margin: 0,
    valign: 'middle',
  })
  const size = headlineSize(s.headline)
  const headlineLines = Math.min(2, lines(s.headline, W - 2 * M, size, DISPLAY))
  const headlineH = headlineLines * (size / 72) * 1.18 + 0.06
  slide.addText(s.headline, {
    x: M,
    y: 0.46,
    w: W - 2 * M,
    h: headlineH,
    fontFace: DISPLAY,
    fontSize: size,
    color: C.ivory,
    valign: 'top',
    margin: 0,
    fit: 'shrink',
    lineSpacingMultiple: 1.04,
  })
  const ruleY = 0.46 + headlineH + 0.08
  slide.addShape(pptx.ShapeType.line, {
    x: M,
    y: ruleY,
    w: W - 2 * M,
    h: 0,
    line: { color: C.line, width: 0.5 },
  })
  flow(pptx, slide, s.blocks, M, ruleY + 0.14, W - 2 * M, BODY_BOTTOM)
  footer(slide, doc, number, total)
  slide.addNotes(notesText(s.notes))
}

function headlineSize(text: string): number {
  if (text.length < 60) return 19
  if (text.length < 95) return 16.5
  if (text.length < 130) return 14.5
  return 13
}

function footer(slide: Slide, doc: PackDocument, number: number, total: number): void {
  const base = {
    y: H - 0.38,
    h: 0.22,
    fontFace: BODY,
    fontSize: 7,
    color: C.blueGrey,
    margin: 0,
    valign: 'middle' as const,
  }
  slide.addText(doc.confidentiality, { ...base, x: M, w: 3.4, charSpacing: 1.2 })
  const meeting = doc.meetingDate
    ? `Möte ${formatLongDate(doc.meetingDate)}`
    : 'Nästa kontakt'
  slide.addText(
    `${doc.client} · ${meeting} · Data per ${formatLongDate(doc.dataAsOf)} · Genererad ${generatedLabel(doc.generatedAt)}`,
    {
      ...base,
      x: M + 3.4,
      w: W - 2 * M - 3.4 - 1.1,
      align: 'center',
      fit: 'shrink',
    },
  )
  slide.addText(`Bild ${number} / ${total}`, {
    ...base,
    x: W - M - 1.1,
    w: 1.1,
    align: 'right',
  })
}

function generatedLabel(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

function notesText(notes: readonly NoteLine[]): string {
  if (notes.length === 0) return 'Inga anteckningar.'
  return notes.map((n) => `${NOTE_KIND_LABEL[n.kind]}: ${n.text}`).join('\n')
}

/** The small-caps label every block title, kicker and table header shares. */
function smallCaps(
  slide: Slide,
  text: string,
  box: {
    x: number
    y: number
    w: number
    h: number
    color?: string
    align?: 'left' | 'right'
  },
): void {
  slide.addText(text.toUpperCase(), {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fontFace: BODY,
    fontSize: 6.8,
    bold: true,
    color: box.color ?? C.gold,
    charSpacing: 1.6,
    margin: 0,
    valign: 'middle',
    align: box.align ?? 'left',
  })
}

/* -------------------------------------------------------------------- flow */

/** Lay blocks out top to bottom; each takes its estimated height, clamped to what is left. */
function flow(
  pptx: PptxGenJS,
  slide: Slide,
  blocks: readonly PackBlock[],
  x: number,
  top: number,
  w: number,
  bottom: number,
): number {
  let y = top
  for (const block of blocks) {
    const room = bottom - y
    if (room < 0.18) break
    const wanted = estimate(block, w)
    /* A figure strip, a table or a chart cannot shrink into a gap: it is left off rather than drawn over the footer. */
    if (!SHRINKS.has(block.kind) && wanted > room + 0.1) break
    const h = Math.min(wanted, room)
    render(pptx, slide, block, x, y, w, h)
    y += h + GAP
  }
  return y
}

const SHRINKS = new Set<PackBlock['kind']>([
  'statement',
  'caption',
  'list',
  'callout',
  'meta',
])

const KPI_ROW = 0.54
const KPI_ROW_LEAD = 0.5
const TIMELINE_ROW = 0.23
const TIMELINE_AXIS = 0.2

/** Each chart kind takes the height it reads well at; the donut and the bars need less than a column chart. */
const CHART_H: Record<Extract<PackBlock, { kind: 'chart' }>['chart'], number> = {
  'stacked-bar': 1.9,
  'grouped-bar': 1.7,
  donut: 1.7,
  'paired-bar': 1.8,
  'horizontal-bar': 1.3,
}

function timelineHeight(items: readonly TimelineItem[]): number {
  return items.length * TIMELINE_ROW + TIMELINE_AXIS
}

function estimate(block: PackBlock, w: number): number {
  switch (block.kind) {
    case 'kpis':
      return (
        kpiRows(block.items).length * (block.lead ? KPI_ROW_LEAD : KPI_ROW) +
        (block.lead ? 0.1 : 0)
      )
    case 'statement':
      return (
        0.3 +
        lines(block.text, w - 0.45, 12, DISPLAY) * 0.215 +
        (block.label ? 0.2 : 0) +
        (block.addendum ? 0.2 + lines(block.addendum.text, w - 0.45, 9, BODY) * 0.15 : 0)
      )
    case 'caption':
      return lines(block.text, w, 7.5, BODY) * 0.15 + 0.03
    case 'list':
      return (
        (block.title ? 0.22 : 0) +
        block.items.reduce(
          (sum, item) =>
            sum +
            lines(item.text, w - 0.25, 9.5, BODY) * 0.17 +
            (item.detail ? lines(item.detail, w - 0.25, 7.5, BODY) * 0.135 : 0) +
            0.04,
          0,
        )
      )
    case 'table':
      return (
        (block.title ? 0.22 : 0) +
        tableHeight(block.columns, block.rows, w, block.widths) +
        (block.footnote ? 0.16 : 0)
      )
    case 'chart':
      return 0.22 + CHART_H[block.chart] + 0.16
    case 'timeline':
      return 0.22 + timelineHeight(block.items) + 0.16
    case 'callout':
      return block.compact
        ? 0.24 +
            lines(block.text, w - 0.45, 9, BODY) * 0.15 +
            (block.detail ? lines(block.detail, w - 0.45, 7.5, BODY) * 0.135 : 0) +
            0.1
        : 0.26 +
            lines(block.text, w - 0.45, 11.5, DISPLAY) * 0.22 +
            (block.detail ? lines(block.detail, w - 0.45, 8, BODY) * 0.145 : 0) +
            0.14
    case 'callouts': {
      const n = Math.max(1, block.items.length)
      const colW = (w - COLUMN_GAP * (n - 1)) / n
      return Math.max(
        ...block.items.map(
          (item) =>
            0.24 +
            lines(item.text, colW - 0.3, 8.5, BODY) * 0.155 +
            (item.detail ? lines(item.detail, colW - 0.3, 7.5, BODY) * 0.135 : 0) +
            0.12,
        ),
      )
    }
    case 'meta':
      return 0.22
    case 'columns': {
      const widths = columnWidthsOf(block, w)
      return Math.max(
        ...block.columns.map((col, i) =>
          col.reduce((sum, b) => sum + estimate(b, widths[i]!) + GAP, -GAP),
        ),
      )
    }
    case 'changes':
      return (
        (block.title ? 0.22 : 0) +
        tableHeight(
          ['', '', '', ''],
          block.rows.map((r) => [r.label, r.before, r.after, r.note ?? '']),
          w,
          [2.2, 1.6, 1.6, 2.2],
        )
      )
    case 'actions':
      return tableHeight(
        ['', '', '', ''],
        block.rows.map((r) => [r.action, r.owner, r.date, r.status]),
        w,
        [4.2, 1.2, 1.3, 1.1],
      )
  }
}

/**
 * Characters per line at a size, then lines for a text, with a margin for
 * word wrap. Georgia averages about 0.53 em per character, Calibri 0.46.
 */
function lines(text: string, w: number, fontSize: number, face: string): number {
  const perLine = Math.max(
    8,
    Math.floor((w * 72) / (fontSize * (face === DISPLAY ? 0.53 : 0.46))),
  )
  return Math.max(1, Math.ceil((text.length * 1.06) / perLine))
}

function columnWidths(count: number, w: number, widths?: number[]): number[] {
  const rel =
    widths && widths.length === count ? widths : Array.from({ length: count }, () => 1)
  const sum = rel.reduce((a, b) => a + b, 0)
  return rel.map((r) => (w * r) / sum)
}

function columnWidthsOf(
  block: Extract<PackBlock, { kind: 'columns' }>,
  w: number,
): number[] {
  const n = block.columns.length
  const available = w - COLUMN_GAP * (n - 1)
  return columnWidths(n, available, block.weights)
}

function tableHeight(
  columns: readonly string[],
  rows: readonly string[][],
  w: number,
  widths?: number[],
): number {
  const colW = columnWidths(columns.length, w, widths)
  const header = columns.some((c) => c.length > 0) ? 0.2 : 0
  /* A single-line row of 8.5-pt text with the cell margins measures about 0.19 in. */
  return (
    header +
    rows.reduce((sum, row) => {
      const tallest = Math.max(
        1,
        ...row.map((cell, i) => lines(cell, (colW[i] ?? w) - 0.1, 8.5, BODY)),
      )
      return sum + tallest * 0.14 + 0.05
    }, 0)
  )
}

/* ------------------------------------------------------------------ blocks */

function render(
  pptx: PptxGenJS,
  slide: Slide,
  block: PackBlock,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  switch (block.kind) {
    case 'kpis':
      return renderKpis(pptx, slide, block.items, x, y, w, block.lead ?? false)
    case 'statement':
      return renderStatement(pptx, slide, block, x, y, w, h)
    case 'caption':
      slide.addText(block.text, {
        x,
        y,
        w,
        h,
        fontFace: BODY,
        fontSize: 7.5,
        italic: true,
        color: C.muted,
        margin: 0,
        valign: 'top',
        fit: 'shrink',
      })
      return
    case 'list':
      return renderList(slide, block, x, y, w, h)
    case 'table':
      return renderTable(slide, {
        title: block.title,
        columns: block.columns,
        rows: block.rows,
        x,
        y,
        w,
        widths: block.widths,
        align: block.align,
        emphasis: block.emphasis,
        totals: block.totals,
        tones: block.rowTones,
        toneColumn: block.toneColumn,
        footnote: block.footnote,
      })
    case 'chart':
      return renderChart(pptx, slide, block, x, y, w, h)
    case 'timeline':
      return renderTimeline(pptx, slide, block, x, y, w, h)
    case 'callout':
      return renderCallout(pptx, slide, block, x, y, w, h)
    case 'callouts':
      return renderCallouts(pptx, slide, block, x, y, w, h)
    case 'meta':
      return renderMeta(slide, block, x, y, w, h)
    case 'columns': {
      const widths = columnWidthsOf(block, w)
      let cx = x
      block.columns.forEach((col, i) => {
        flow(pptx, slide, col, cx, y, widths[i]!, y + h)
        cx += widths[i]! + COLUMN_GAP
      })
      return
    }
    case 'changes':
      return renderTable(slide, {
        title: block.title,
        columns: ['Vad', 'Före', 'Nu', 'Förändring'],
        rows: block.rows.map((r) => [r.label, r.before, r.after, r.note ?? '']),
        x,
        y,
        w,
        widths: [2.2, 1.6, 1.6, 2.2],
        align: ['left', 'right', 'right', 'left'],
        tones: block.rows.map((r) => r.tone),
        toneColumn: 2,
      })
    case 'actions':
      return renderTable(slide, {
        columns: ['Åtgärd', 'Ägare', 'Datum', 'Status'],
        rows: block.rows.map((r) => [r.action, r.owner, r.date, r.status]),
        x,
        y,
        w,
        widths: [4.2, 1.2, 1.3, 1.1],
        align: ['left', 'left', 'left', 'left'],
        tones: block.rows.map((r) => r.tone),
        toneColumn: 3,
      })
  }
}

/** Up to six figures share one row; more wrap in fours. */
function kpiPerRow(count: number): number {
  return count <= 6 ? Math.max(1, count) : 4
}

function kpiRows(items: readonly KpiItem[]): KpiItem[][] {
  const perRow = kpiPerRow(items.length)
  const rows: KpiItem[][] = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  return rows
}

/** A figure strip: label, figure, detail, with a hairline between the figures. */
function renderKpis(
  pptx: PptxGenJS,
  slide: Slide,
  items: readonly KpiItem[],
  x: number,
  y: number,
  w: number,
  lead: boolean,
): void {
  const rows = kpiRows(items)
  const perRow = kpiPerRow(items.length)
  const rowH = lead ? KPI_ROW_LEAD : KPI_ROW
  const valueH = lead ? 0.24 : 0.27
  const inset = lead ? 0.14 : 0
  if (lead) {
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w,
      h: rows.length * rowH + 0.1,
      fill: { color: C.panel },
      line: { color: C.line, width: 0.5 },
    })
  }
  rows.forEach((row, r) => {
    const cellW = (w - 2 * inset) / perRow
    row.forEach((item, c) => {
      const cx = x + inset + c * cellW
      const cy = y + r * rowH + (lead ? 0.07 : 0)
      if (c > 0) {
        slide.addShape(pptx.ShapeType.line, {
          x: cx - 0.08,
          y: cy + 0.02,
          w: 0,
          h: rowH - 0.1,
          line: { color: C.lineSoft, width: 0.5 },
        })
      }
      smallCaps(slide, item.label, {
        x: cx,
        y: cy,
        w: cellW - 0.14,
        h: 0.14,
        color: C.blueGrey,
      })
      slide.addText(item.value, {
        x: cx,
        y: cy + 0.14,
        w: cellW - 0.14,
        h: valueH,
        fontFace: DISPLAY,
        fontSize: item.value.length > 18 ? 10.5 : lead ? 12.5 : 14,
        color: item.tone ? TONE_COLOR[item.tone] : C.ivory,
        margin: 0,
        valign: 'middle',
        fit: 'shrink',
      })
      if (item.detail) {
        slide.addText(item.detail, {
          x: cx,
          y: cy + 0.14 + valueH,
          w: cellW - 0.14,
          h: 0.16,
          fontFace: BODY,
          fontSize: 7,
          color: C.muted,
          margin: 0,
          valign: 'top',
          fit: 'shrink',
        })
      }
    })
  })
}

function renderStatement(
  pptx: PptxGenJS,
  slide: Slide,
  block: Extract<PackBlock, { kind: 'statement' }>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { label, text, addendum } = block
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: C.panel },
    line: { color: C.line, width: 0.5 },
  })
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w: 0.04,
    h,
    fill: { color: C.gold },
    line: { color: C.gold, width: 0 },
  })
  let textY = y + 0.08
  if (label) {
    smallCaps(slide, label, { x: x + 0.2, y: textY, w: w - 0.36, h: 0.16 })
    textY += 0.2
  }
  const addendumH = addendum ? 0.2 + lines(addendum.text, w - 0.45, 9, BODY) * 0.15 : 0
  const textH = Math.max(0.2, y + h - textY - 0.06 - addendumH)
  slide.addText(text, {
    x: x + 0.2,
    y: textY,
    w: w - 0.36,
    h: textH,
    fontFace: DISPLAY,
    fontSize: 12,
    color: C.ivory,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
    lineSpacingMultiple: 1.05,
  })
  if (addendum) {
    const ay = textY + textH
    smallCaps(slide, addendum.label, {
      x: x + 0.2,
      y: ay,
      w: w - 0.36,
      h: 0.16,
      color: C.blueGrey,
    })
    slide.addText(addendum.text, {
      x: x + 0.2,
      y: ay + 0.17,
      w: w - 0.36,
      h: Math.max(0.15, addendumH - 0.2),
      fontFace: BODY,
      fontSize: 9,
      color: C.ivory,
      margin: 0,
      valign: 'top',
      fit: 'shrink',
    })
  }
}

function renderList(
  slide: Slide,
  block: Extract<PackBlock, { kind: 'list' }>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  let top = y
  if (block.title) {
    smallCaps(slide, block.title, { x, y: top, w, h: 0.16 })
    top += 0.22
  }
  const runs: PptxGenJS.TextProps[] = []
  block.items.forEach((item: ListItem, index) => {
    const bullet = block.numbered ? { type: 'number' as const } : true
    if (item.marker && item.marker !== 'fact') {
      runs.push({
        text: `${MARKER_LABEL[item.marker]}  `,
        options: {
          bullet,
          fontSize: 6.5,
          bold: true,
          color: C.gold,
          charSpacing: 1,
          paraSpaceBefore: index === 0 ? 0 : 3,
        },
      })
      runs.push({
        text: item.text,
        options: { breakLine: true, fontSize: 9.5, color: C.ivory },
      })
    } else {
      runs.push({
        text: item.text,
        options: {
          bullet,
          breakLine: true,
          fontSize: 9.5,
          color: C.ivory,
          paraSpaceBefore: index === 0 ? 0 : 3,
        },
      })
    }
    if (item.detail) {
      runs.push({
        text: item.detail,
        options: {
          breakLine: true,
          fontSize: 7.5,
          color: C.muted,
          indentLevel: 1,
          bullet: false,
        },
      })
    }
  })
  slide.addText(runs, {
    x,
    y: top,
    w,
    h: Math.max(0.2, y + h - top),
    fontFace: BODY,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
    lineSpacingMultiple: 1.05,
  })
}

interface TableSpec {
  title?: string
  columns: readonly string[]
  rows: readonly string[][]
  x: number
  y: number
  w: number
  widths?: number[]
  align?: readonly ('left' | 'right')[]
  emphasis?: readonly number[]
  totals?: readonly number[]
  tones?: readonly (Tone | undefined)[]
  toneColumn?: number
  footnote?: string
}

/** No header fill, a gold rule under the header, a hairline between rows, a rule above every total. */
function renderTable(slide: Slide, spec: TableSpec): void {
  let top = spec.y
  if (spec.title) {
    smallCaps(slide, spec.title, { x: spec.x, y: top, w: spec.w, h: 0.16 })
    top += 0.22
  }
  const colW = columnWidths(spec.columns.length, spec.w, spec.widths)
  const hasHeader = spec.columns.some((c) => c.length > 0)
  const body: PptxGenJS.TableRow[] = []
  if (hasHeader) {
    body.push(
      spec.columns.map((c, i) => ({
        text: c.toUpperCase(),
        options: {
          bold: true,
          color: C.blueGrey,
          fontSize: 6.5,
          charSpacing: 1,
          align: spec.align?.[i] ?? 'left',
          border: [
            { type: 'none' },
            { type: 'none' },
            { type: 'solid', pt: 0.75, color: C.gold },
            { type: 'none' },
          ],
        },
      })),
    )
  }
  spec.rows.forEach((row, r) => {
    const total = spec.totals?.includes(r) ?? false
    const bold = total || (spec.emphasis?.includes(r) ?? false)
    const tone =
      spec.tones?.[r] && spec.tones[r] !== 'neutral' ? TONE_COLOR[spec.tones[r]!] : null
    body.push(
      row.map((cell, i) => ({
        text: cell,
        options: {
          fontSize: 8.5,
          color: tone && i === (spec.toneColumn ?? 2) ? tone : C.ivory,
          bold,
          align: spec.align?.[i] ?? 'left',
          border: [
            total ? { type: 'solid', pt: 0.75, color: C.muted } : { type: 'none' },
            { type: 'none' },
            { type: 'solid', pt: 0.4, color: C.line },
            { type: 'none' },
          ],
        },
      })),
    )
  })
  slide.addTable(body, {
    x: spec.x,
    y: top,
    w: spec.w,
    colW,
    fontFace: BODY,
    margin: [0.025, 0.05, 0.025, 0.05],
    valign: 'middle',
    autoPage: false,
  })
  if (spec.footnote) {
    const tableH = tableHeight(spec.columns, spec.rows, spec.w, spec.widths)
    slide.addText(spec.footnote, {
      x: spec.x,
      y: top + tableH + 0.02,
      w: spec.w,
      h: 0.14,
      fontFace: BODY,
      fontSize: 7,
      italic: true,
      color: C.muted,
      margin: 0,
      valign: 'top',
      fit: 'shrink',
    })
  }
}

function renderChart(
  pptx: PptxGenJS,
  slide: Slide,
  block: Extract<PackBlock, { kind: 'chart' }>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  smallCaps(slide, block.title, { x, y, w, h: 0.16 })
  const chartH = Math.max(1.0, Math.min(CHART_H[block.chart], h - 0.22 - 0.16))
  const chartY = y + 0.22
  const caption = `${block.unit} · per ${formatLongDate(block.asOf)} · ${block.source}${block.note ? ` · ${block.note}` : ''}`
  const common = {
    x,
    y: chartY,
    w,
    h: chartH,
    chartColors: block.series.map((s) => s.color),
    legendColor: C.muted,
    legendFontSize: 7,
    legendFontFace: BODY,
    catAxisLabelColor: C.ivory,
    catAxisLabelFontSize: 8,
    catAxisLabelFontFace: BODY,
    catAxisLineShow: false,
    valAxisLabelColor: C.blueGrey,
    valAxisLabelFontSize: 7,
    valAxisLabelFontFace: BODY,
    valAxisLineShow: false,
    /* Bars are read from zero; an axis that starts at the smallest value would exaggerate a difference. */
    valAxisMinVal: 0,
    valGridLine: { color: C.lineSoft, style: 'solid' as const, size: 0.5 },
    catGridLine: { style: 'none' as const },
    dataLabelColor: C.ivory,
    dataLabelFontSize: 7,
    dataLabelFontFace: BODY,
    showTitle: false,
    plotArea: { fill: { color: C.navy } },
    chartArea: { fill: { color: C.navy } },
  }
  if (block.chart === 'donut') {
    /* One series as shares: the categories carry the labels, the first series' row the values. */
    const values = block.categories.map((_, c) =>
      block.series.reduce((sum, s) => sum + (s.values[c] ?? 0), 0),
    )
    slide.addChart(
      pptx.ChartType.doughnut,
      [{ name: block.title, labels: [...block.categories], values }],
      {
        ...common,
        holeSize: 62,
        showLegend: true,
        legendPos: 'r',
        showPercent: true,
        showValue: false,
        dataLabelPosition: 'ctr',
        dataLabelFormatCode: '0%',
        showLeaderLines: false,
      },
    )
    if (block.centre) {
      /* The whole the shares add up to, set in the hole; the legend takes the right third. */
      slide.addText(block.centre, {
        x,
        y: chartY + chartH / 2 - 0.2,
        w: w * 0.62,
        h: 0.4,
        align: 'center',
        fontFace: DISPLAY,
        fontSize: 12,
        color: C.ivory,
        margin: 0,
        valign: 'middle',
      })
    }
  } else {
    const stacked = block.chart === 'stacked-bar'
    const horizontal = block.chart !== 'grouped-bar'
    /* A horizontal bar chart draws its first category at the foot; reversed, it reads top to bottom. */
    const order = horizontal
      ? block.categories.map((_, i) => block.categories.length - 1 - i)
      : block.categories.map((_, i) => i)
    const data = block.series.map((s) => ({
      name: s.name,
      labels: order.map((i) => block.categories[i]!),
      values: order.map((i) => s.values[i] ?? 0),
    }))
    slide.addChart(pptx.ChartType.bar, data, {
      ...common,
      barDir: horizontal ? 'bar' : 'col',
      barGrouping: stacked ? 'stacked' : 'clustered',
      barGapWidthPct: stacked ? 55 : block.chart === 'horizontal-bar' ? 70 : 80,
      showLegend: block.series.length > 1,
      legendPos: 'b',
      showValue: true,
      dataLabelFormatCode: stacked ? '0.0;-0.0;;' : block.unit === '%' ? '0' : '0.0',
    })
  }
  slide.addText(caption, {
    x,
    y: chartY + chartH,
    w,
    h: 0.16,
    fontFace: BODY,
    fontSize: 7,
    italic: true,
    color: C.muted,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
  })
}

/**
 * A maturity timeline from today: one row per date, its marker on a common
 * axis, the quarter ticks beneath — drawn from native shapes and text so
 * every marker and label stays editable, and no two labels ever collide.
 */
function renderTimeline(
  pptx: PptxGenJS,
  slide: Slide,
  block: Extract<PackBlock, { kind: 'timeline' }>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  smallCaps(slide, block.title, { x, y, w, h: 0.16 })
  const top = y + 0.22
  const labelW = Math.min(2.1, w * 0.36)
  const valueW = 1.35
  const left = x + labelW + 0.1
  const right = x + w - valueW - 0.1
  const maxDays = Math.max(90, ...block.items.map((i) => i.daysAhead))
  const span = Math.ceil(maxDays / 90) * 90
  const px = (days: number) => left + ((right - left) * Math.min(days, span)) / span
  const rows = block.items.slice(
    0,
    Math.max(1, Math.floor((h - 0.22 - 0.16 - TIMELINE_AXIS) / TIMELINE_ROW)),
  )
  rows.forEach((item: TimelineItem, index) => {
    const ry = top + index * TIMELINE_ROW
    const mid = ry + TIMELINE_ROW / 2
    const color = item.tone ? TONE_COLOR[item.tone] : C.ivory
    slide.addText(
      [
        {
          text: item.label,
          options: { fontSize: 8, color, bold: item.tone === 'gold', breakLine: true },
        },
        ...(item.detail
          ? [{ text: item.detail, options: { fontSize: 6.8, color: C.muted } }]
          : []),
      ],
      {
        x,
        y: ry,
        w: labelW,
        h: TIMELINE_ROW,
        fontFace: BODY,
        margin: 0,
        valign: 'middle',
        fit: 'shrink',
      },
    )
    slide.addShape(pptx.ShapeType.line, {
      x: left,
      y: mid,
      w: right - left,
      h: 0,
      line: { color: C.lineSoft, width: 0.5 },
    })
    slide.addShape(pptx.ShapeType.line, {
      x: left,
      y: mid,
      w: Math.max(0.01, px(item.daysAhead) - left),
      h: 0,
      line: { color, width: 1.25 },
    })
    slide.addShape(pptx.ShapeType.ellipse, {
      x: px(item.daysAhead) - 0.05,
      y: mid - 0.05,
      w: 0.1,
      h: 0.1,
      fill: { color: item.tone === 'gold' ? C.gold : C.ivory },
      line: { color, width: 0 },
    })
    slide.addText(`${formatLongDate(item.date)} · om ${item.daysAhead} dagar`, {
      x: right + 0.1,
      y: ry,
      w: valueW,
      h: TIMELINE_ROW,
      align: 'right',
      fontFace: BODY,
      fontSize: 7,
      color: C.muted,
      margin: 0,
      valign: 'middle',
      fit: 'shrink',
    })
  })
  /* The axis: quarter ticks from today. */
  const axisY = top + rows.length * TIMELINE_ROW + 0.04
  slide.addShape(pptx.ShapeType.line, {
    x: left,
    y: axisY,
    w: right - left,
    h: 0,
    line: { color: C.line, width: 0.75 },
  })
  for (let d = 0; d <= span; d += 90) {
    slide.addShape(pptx.ShapeType.line, {
      x: px(d),
      y: axisY,
      w: 0,
      h: 0.05,
      line: { color: C.line, width: 0.5 },
    })
    slide.addText(d === 0 ? 'I DAG' : `+${d} D`, {
      x: px(d) - 0.3,
      y: axisY + 0.05,
      w: 0.6,
      h: 0.12,
      align: 'center',
      fontFace: BODY,
      fontSize: 6.2,
      color: d === 0 ? C.gold : C.blueGrey,
      charSpacing: 1,
      margin: 0,
      valign: 'top',
    })
  }
  slide.addText(
    `Dagar från ${formatLongDate(block.from)} · ${block.source}${block.note ? ` · ${block.note}` : ''}`,
    {
      x,
      y: axisY + TIMELINE_AXIS,
      w,
      h: 0.16,
      fontFace: BODY,
      fontSize: 7,
      italic: true,
      color: C.muted,
      margin: 0,
      valign: 'top',
      fit: 'shrink',
    },
  )
}

function renderCallout(
  pptx: PptxGenJS,
  slide: Slide,
  block: Extract<PackBlock, { kind: 'callout' }>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const bar =
    block.tone === 'gold' ? C.gold : block.tone === 'warning' ? C.negative : C.blueGrey
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: C.panel },
    line: { color: C.line, width: 0.5 },
  })
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w: 0.04,
    h,
    fill: { color: bar },
    line: { color: bar, width: 0 },
  })
  smallCaps(slide, block.title, {
    x: x + 0.2,
    y: y + 0.07,
    w: w - 0.36,
    h: 0.16,
    color: bar,
  })
  const runs: PptxGenJS.TextProps[] = [
    {
      text: block.text,
      options: block.compact
        ? { fontFace: BODY, fontSize: 9, color: C.ivory, breakLine: true }
        : { fontFace: DISPLAY, fontSize: 11.5, color: C.ivory, breakLine: true },
    },
  ]
  if (block.detail) {
    runs.push({
      text: block.detail,
      options: {
        fontFace: BODY,
        fontSize: block.compact ? 7.5 : 8,
        color: C.muted,
        paraSpaceBefore: 2,
      },
    })
  }
  slide.addText(runs, {
    x: x + 0.2,
    y: y + 0.26,
    w: w - 0.36,
    h: Math.max(0.2, h - 0.32),
    margin: 0,
    valign: 'top',
    fit: 'shrink',
    lineSpacingMultiple: 1.05,
  })
}

/** Margin notes in a row: a thin rule in the note's colour, a small-caps label, sans body. */
function renderCallouts(
  pptx: PptxGenJS,
  slide: Slide,
  block: Extract<PackBlock, { kind: 'callouts' }>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const n = Math.max(1, block.items.length)
  const colW = (w - COLUMN_GAP * (n - 1)) / n
  block.items.forEach((item, i) => {
    const cx = x + i * (colW + COLUMN_GAP)
    const color = CALLOUT_COLOR[item.kind]
    slide.addShape(pptx.ShapeType.rect, {
      x: cx,
      y,
      w: 0.025,
      h,
      fill: { color },
      line: { color, width: 0 },
    })
    smallCaps(slide, CALLOUT_LABEL[item.kind], {
      x: cx + 0.14,
      y,
      w: colW - 0.16,
      h: 0.16,
      color,
    })
    const runs: PptxGenJS.TextProps[] = [
      { text: item.text, options: { fontSize: 8.5, color: C.ivory, breakLine: true } },
    ]
    if (item.detail) {
      runs.push({
        text: item.detail,
        options: { fontSize: 7.5, color: C.muted, paraSpaceBefore: 2 },
      })
    }
    slide.addText(runs, {
      x: cx + 0.14,
      y: y + 0.2,
      w: colW - 0.16,
      h: Math.max(0.2, h - 0.22),
      fontFace: BODY,
      margin: 0,
      valign: 'top',
      fit: 'shrink',
      lineSpacingMultiple: 1.05,
    })
  })
}

/** One quiet line of provenance: LABEL value · LABEL value. */
function renderMeta(
  slide: Slide,
  block: Extract<PackBlock, { kind: 'meta' }>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const runs: PptxGenJS.TextProps[] = []
  block.items.forEach((item, i) => {
    if (i > 0) runs.push({ text: '   ·   ', options: { fontSize: 7, color: C.line } })
    runs.push({
      text: `${item.label.toUpperCase()}  `,
      options: { fontSize: 6.5, bold: true, color: C.blueGrey, charSpacing: 1.2 },
    })
    runs.push({ text: item.value, options: { fontSize: 8, color: C.ivory } })
  })
  slide.addText(runs, {
    x,
    y,
    w,
    h,
    fontFace: BODY,
    margin: 0,
    valign: 'middle',
    fit: 'shrink',
  })
}
