/**
 * The PackDocument as a native, editable PowerPoint.
 *
 * One slide master carries the identity — navy ground, a gold hairline,
 * the confidentiality footer — and every slide is drawn from typed blocks
 * with native text, shapes, tables and charts built from data. Nothing is
 * rasterised: the advisor can edit every word, move every box, change
 * every number and delete any slide. Speaker notes go to the notes page,
 * never to the slide body.
 */

import PptxGenJS from 'pptxgenjs'
import { formatLongDate } from '~/presentation/advisory/format'
import { NOTE_KIND_LABEL } from '~/presentation/documents/meetingPackText'
import {
  DOCUMENT_PALETTE as C,
  type KpiItem,
  type ListItem,
  type NoteLine,
  type PackBlock,
  type PackDocument,
  type PackSlide,
  type Tone,
} from '~/presentation/documents/packDocument'

/* --------------------------------------------------------------- geometry */

const W = 10
const H = 5.625
const M = 0.45
const BODY_TOP = 1.42
const BODY_BOTTOM = H - 0.52
const GAP = 0.12
const COLUMN_GAP = 0.25
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
      { rect: { x: 0, y: 0, w: W, h: 0.05, fill: { color: C.gold } } },
      {
        line: {
          x: M,
          y: H - 0.44,
          w: W - 2 * M,
          h: 0,
          line: { color: C.line, width: 0.75 },
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
  slide.addText(s.kicker.toUpperCase(), {
    x: M,
    y: 0.26,
    w: W - 2 * M - 1.8,
    h: 0.24,
    fontFace: BODY,
    fontSize: 8.5,
    bold: true,
    color: s.section === 'appendix' ? C.blueGrey : C.gold,
    charSpacing: 2,
    margin: 0,
    valign: 'middle',
  })
  slide.addText(doc.internalMark, {
    x: W - M - 1.8,
    y: 0.26,
    w: 1.8,
    h: 0.24,
    align: 'right',
    fontFace: BODY,
    fontSize: 8,
    color: C.blueGrey,
    charSpacing: 2,
    margin: 0,
    valign: 'middle',
  })
  const size = headlineSize(s.headline)
  const headlineLines = Math.min(3, lines(s.headline, W - 2 * M, size, DISPLAY))
  const headlineH = headlineLines * (size / 72) * 1.2 + 0.08
  slide.addText(s.headline, {
    x: M,
    y: 0.52,
    w: W - 2 * M,
    h: headlineH,
    fontFace: DISPLAY,
    fontSize: size,
    color: C.ivory,
    valign: 'top',
    margin: 0,
    fit: 'shrink',
    lineSpacingMultiple: 1.05,
  })
  /* The body starts under the headline it got, not under the tallest headline there could be. */
  const bodyTop = Math.max(BODY_TOP - 0.34, 0.52 + headlineH + 0.16)
  flow(pptx, slide, s.blocks, M, bodyTop, W - 2 * M, BODY_BOTTOM)
  footer(slide, doc, number, total)
  slide.addNotes(notesText(s.notes))
}

function headlineSize(text: string): number {
  if (text.length < 70) return 20
  if (text.length < 110) return 17
  return 15
}

function footer(slide: Slide, doc: PackDocument, number: number, total: number): void {
  const base = {
    y: H - 0.4,
    h: 0.24,
    fontFace: BODY,
    fontSize: 7.5,
    color: C.blueGrey,
    margin: 0,
    valign: 'middle' as const,
  }
  slide.addText(doc.confidentiality, { ...base, x: M, w: 4.2, charSpacing: 1.5 })
  slide.addText(`${doc.client} · Data per ${formatLongDate(doc.dataAsOf)}`, {
    ...base,
    x: M + 4.2,
    w: W - 2 * M - 4.2 - 1.3,
    align: 'center',
  })
  slide.addText(`Bild ${number} / ${total}`, {
    ...base,
    x: W - M - 1.3,
    w: 1.3,
    align: 'right',
  })
}

function notesText(notes: readonly NoteLine[]): string {
  if (notes.length === 0) return 'Inga anteckningar.'
  return notes.map((n) => `${NOTE_KIND_LABEL[n.kind]}: ${n.text}`).join('\n')
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
    if (room < 0.2) break
    const h = Math.min(estimate(block, w), room)
    render(pptx, slide, block, x, y, w, h)
    y += h + GAP
  }
  return y
}

function estimate(block: PackBlock, w: number): number {
  switch (block.kind) {
    case 'kpis':
      return (
        kpiRows(block.items).length * (block.lead ? KPI_ROW_LEAD : KPI_ROW) +
        (block.lead ? 0.14 : 0)
      )
    case 'statement':
      return 0.34 + lines(block.text, w - 0.5, 14, DISPLAY) * 0.27
    case 'caption':
      return lines(block.text, w, 8.5, BODY) * 0.17 + 0.04
    case 'list':
      return (
        (block.title ? 0.24 : 0) +
        block.items.reduce(
          (sum, item) =>
            sum +
            lines(item.text, w - 0.25, 10.5, BODY) * 0.19 +
            (item.detail ? lines(item.detail, w - 0.25, 8.5, BODY) * 0.15 : 0) +
            0.05,
          0,
        )
      )
    case 'table':
      return (
        (block.title ? 0.24 : 0) + tableHeight(block.columns, block.rows, w, block.widths)
      )
    case 'chart':
      return 0.24 + 2.35 + 0.18
    case 'callout':
      return (
        0.3 +
        lines(block.text, w - 0.5, 12.5, DISPLAY) * 0.24 +
        (block.detail ? lines(block.detail, w - 0.5, 9, BODY) * 0.16 : 0) +
        0.18
      )
    case 'columns': {
      const n = block.columns.length
      const colW = (w - COLUMN_GAP * (n - 1)) / n
      return Math.max(
        ...block.columns.map((col) =>
          col.reduce((sum, b) => sum + estimate(b, colW) + GAP, -GAP),
        ),
      )
    }
    case 'changes':
      return (
        (block.title ? 0.24 : 0) +
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

/** Characters per line at a size, then lines for a text, with a margin for word wrap. */
function lines(text: string, w: number, fontSize: number, face: string): number {
  const perLine = Math.max(
    8,
    Math.floor((w * 72) / (fontSize * (face === DISPLAY ? 0.56 : 0.5))),
  )
  return Math.max(1, Math.ceil((text.length * 1.12) / perLine))
}

function columnWidths(count: number, w: number, widths?: number[]): number[] {
  const rel =
    widths && widths.length === count ? widths : Array.from({ length: count }, () => 1)
  const sum = rel.reduce((a, b) => a + b, 0)
  return rel.map((r) => (w * r) / sum)
}

function tableHeight(
  columns: readonly string[],
  rows: readonly string[][],
  w: number,
  widths?: number[],
): number {
  const colW = columnWidths(columns.length, w, widths)
  const header = columns.some((c) => c.length > 0) ? 0.27 : 0
  return (
    header +
    rows.reduce((sum, row) => {
      const tallest = Math.max(
        1,
        ...row.map((cell, i) => lines(cell, (colW[i] ?? w) - 0.1, 9, BODY)),
      )
      return sum + tallest * 0.155 + 0.1
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
      return renderStatement(pptx, slide, block.label, block.text, x, y, w, h)
    case 'caption':
      slide.addText(block.text, {
        x,
        y,
        w,
        h,
        fontFace: BODY,
        fontSize: 8.5,
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
      return renderTable(
        slide,
        block.title,
        block.columns,
        block.rows,
        x,
        y,
        w,
        block.widths,
        block.align,
        block.emphasis,
      )
    case 'chart':
      return renderChart(pptx, slide, block, x, y, w, h)
    case 'callout':
      return renderCallout(pptx, slide, block, x, y, w, h)
    case 'columns': {
      const n = block.columns.length
      const colW = (w - COLUMN_GAP * (n - 1)) / n
      block.columns.forEach((col, i) => {
        flow(pptx, slide, col, x + i * (colW + COLUMN_GAP), y, colW, y + h)
      })
      return
    }
    case 'changes':
      return renderTable(
        slide,
        block.title,
        ['Vad', 'Före', 'Nu', ''],
        block.rows.map((r) => [r.label, r.before, r.after, r.note ?? '']),
        x,
        y,
        w,
        [2.2, 1.6, 1.6, 2.2],
        ['left', 'right', 'right', 'left'],
        undefined,
        block.rows.map((r) => r.tone),
      )
    case 'actions':
      return renderTable(
        slide,
        undefined,
        ['Åtgärd', 'Ägare', 'Datum', 'Status'],
        block.rows.map((r) => [r.action, r.owner, r.date, r.status]),
        x,
        y,
        w,
        [4.2, 1.2, 1.3, 1.1],
        ['left', 'left', 'left', 'left'],
      )
  }
}

const KPI_ROW = 0.74
const KPI_ROW_LEAD = 0.6

/** Up to five figures share one row; more wrap in fours. */
function kpiPerRow(count: number): number {
  return count <= 5 ? Math.max(1, count) : 4
}

function kpiRows(items: readonly KpiItem[]): KpiItem[][] {
  const perRow = kpiPerRow(items.length)
  const rows: KpiItem[][] = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  return rows
}

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
  const valueH = lead ? 0.26 : 0.32
  if (lead) {
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w,
      h: rows.length * rowH + 0.14,
      fill: { color: C.panel },
      line: { color: C.line, width: 0.5 },
    })
  }
  rows.forEach((row, r) => {
    const cellW = (w - (lead ? 0.28 : 0)) / perRow
    row.forEach((item, c) => {
      const cx = x + c * cellW + (lead ? 0.14 : 0)
      const cy = y + r * rowH + (lead ? 0.08 : 0)
      slide.addText(item.label.toUpperCase(), {
        x: cx,
        y: cy,
        w: cellW - 0.15,
        h: 0.16,
        fontFace: BODY,
        fontSize: 7,
        color: C.blueGrey,
        charSpacing: 1.5,
        margin: 0,
        valign: 'middle',
      })
      slide.addText(item.value, {
        x: cx,
        y: cy + 0.16,
        w: cellW - 0.15,
        h: valueH,
        fontFace: DISPLAY,
        fontSize: item.value.length > 18 ? 11 : lead ? 13.5 : 15,
        color: item.tone ? TONE_COLOR[item.tone] : C.ivory,
        margin: 0,
        valign: 'middle',
        fit: 'shrink',
      })
      if (item.detail) {
        slide.addText(item.detail, {
          x: cx,
          y: cy + 0.16 + valueH,
          w: cellW - 0.15,
          h: 0.17,
          fontFace: BODY,
          fontSize: 7.5,
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
  label: string | undefined,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
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
    w: 0.05,
    h,
    fill: { color: C.gold },
    line: { color: C.gold, width: 0 },
  })
  let textY = y + 0.08
  if (label) {
    slide.addText(label.toUpperCase(), {
      x: x + 0.22,
      y: textY,
      w: w - 0.4,
      h: 0.2,
      fontFace: BODY,
      fontSize: 7.5,
      bold: true,
      color: C.gold,
      charSpacing: 1.5,
      margin: 0,
      valign: 'middle',
    })
    textY += 0.22
  }
  slide.addText(text, {
    x: x + 0.22,
    y: textY,
    w: w - 0.4,
    h: y + h - textY - 0.06,
    fontFace: DISPLAY,
    fontSize: 14,
    color: C.ivory,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
    lineSpacingMultiple: 1.08,
  })
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
    slide.addText(block.title.toUpperCase(), {
      x,
      y: top,
      w,
      h: 0.2,
      fontFace: BODY,
      fontSize: 7.5,
      bold: true,
      color: C.gold,
      charSpacing: 1.5,
      margin: 0,
      valign: 'middle',
    })
    top += 0.24
  }
  const runs: PptxGenJS.TextProps[] = []
  block.items.forEach((item: ListItem, index) => {
    const bullet = block.numbered ? { type: 'number' as const } : true
    if (item.marker && item.marker !== 'fact') {
      runs.push({
        text: `${MARKER_LABEL[item.marker]}  `,
        options: {
          bullet,
          fontSize: 7,
          bold: true,
          color: C.gold,
          charSpacing: 1,
          paraSpaceBefore: index === 0 ? 0 : 3,
        },
      })
      runs.push({
        text: item.text,
        options: { breakLine: true, fontSize: 10.5, color: C.ivory },
      })
    } else {
      runs.push({
        text: item.text,
        options: {
          bullet,
          breakLine: true,
          fontSize: 10.5,
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
          fontSize: 8.5,
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
    lineSpacingMultiple: 1.06,
  })
}

function renderTable(
  slide: Slide,
  title: string | undefined,
  columns: readonly string[],
  rows: readonly string[][],
  x: number,
  y: number,
  w: number,
  widths?: number[],
  align?: readonly ('left' | 'right')[],
  emphasis?: readonly number[],
  tones?: readonly (Tone | undefined)[],
): void {
  let top = y
  if (title) {
    slide.addText(title.toUpperCase(), {
      x,
      y: top,
      w,
      h: 0.2,
      fontFace: BODY,
      fontSize: 7.5,
      bold: true,
      color: C.gold,
      charSpacing: 1.5,
      margin: 0,
      valign: 'middle',
    })
    top += 0.24
  }
  const colW = columnWidths(columns.length, w, widths)
  const hasHeader = columns.some((c) => c.length > 0)
  const body: PptxGenJS.TableRow[] = []
  if (hasHeader) {
    body.push(
      columns.map((c, i) => ({
        text: c.toUpperCase(),
        options: {
          bold: true,
          color: C.blueGrey,
          fontSize: 7,
          charSpacing: 1,
          align: align?.[i] ?? 'left',
          fill: { color: C.panel },
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
  rows.forEach((row, r) => {
    body.push(
      row.map((cell, i) => ({
        text: cell,
        options: {
          fontSize: 9,
          color: i === 2 && tones?.[r] ? TONE_COLOR[tones[r]!] : C.ivory,
          bold: emphasis?.includes(r) ?? false,
          align: align?.[i] ?? 'left',
          border: [
            { type: 'none' },
            { type: 'none' },
            { type: 'solid', pt: 0.5, color: C.line },
            { type: 'none' },
          ],
        },
      })),
    )
  })
  slide.addTable(body, {
    x,
    y: top,
    w,
    colW,
    fontFace: BODY,
    margin: [0.03, 0.05, 0.03, 0.05],
    valign: 'middle',
    autoPage: false,
  })
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
  slide.addText(block.title.toUpperCase(), {
    x,
    y,
    w,
    h: 0.2,
    fontFace: BODY,
    fontSize: 7.5,
    bold: true,
    color: C.gold,
    charSpacing: 1.5,
    margin: 0,
    valign: 'middle',
  })
  const chartH = Math.max(1.2, h - 0.24 - 0.2)
  const data = block.series.map((s) => ({
    name: s.name,
    labels: [...block.categories],
    values: [...s.values],
  }))
  const stacked = block.chart === 'stacked-bar'
  slide.addChart(pptx.ChartType.bar, data, {
    x,
    y: y + 0.24,
    w,
    h: chartH,
    barDir: stacked ? 'bar' : 'col',
    barGrouping: stacked ? 'stacked' : 'clustered',
    barGapWidthPct: stacked ? 60 : 80,
    chartColors: block.series.map((s) => s.color),
    showLegend: true,
    legendPos: 'b',
    legendColor: C.muted,
    legendFontSize: 7.5,
    legendFontFace: BODY,
    catAxisLabelColor: C.ivory,
    catAxisLabelFontSize: 8.5,
    catAxisLabelFontFace: BODY,
    catAxisLineShow: false,
    valAxisLabelColor: C.blueGrey,
    valAxisLabelFontSize: 7.5,
    valAxisLabelFontFace: BODY,
    valAxisLineShow: false,
    valGridLine: { color: C.line, style: 'solid', size: 0.5 },
    catGridLine: { style: 'none' },
    showValue: true,
    dataLabelColor: C.ivory,
    dataLabelFontSize: 7,
    dataLabelFontFace: BODY,
    dataLabelFormatCode: stacked ? '0.0;-0.0;;' : '0',
    showTitle: false,
    plotArea: { fill: { color: C.navy } },
    chartArea: { fill: { color: C.navy } },
  })
  slide.addText(
    `${block.unit} · per ${formatLongDate(block.asOf)} · ${block.source}${block.note ? ` · ${block.note}` : ''}`,
    {
      x,
      y: y + 0.24 + chartH,
      w,
      h: 0.18,
      fontFace: BODY,
      fontSize: 7.5,
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
  const fill =
    block.tone === 'gold' ? C.goldSoft : block.tone === 'warning' ? '2A1414' : C.panel
  const bar =
    block.tone === 'gold' ? C.gold : block.tone === 'warning' ? C.negative : C.blueGrey
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h,
    fill: { color: fill },
    line: { color: bar, width: 0.5 },
  })
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w: 0.05,
    h,
    fill: { color: bar },
    line: { color: bar, width: 0 },
  })
  slide.addText(block.title.toUpperCase(), {
    x: x + 0.22,
    y: y + 0.07,
    w: w - 0.4,
    h: 0.2,
    fontFace: BODY,
    fontSize: 7.5,
    bold: true,
    color: bar,
    charSpacing: 1.5,
    margin: 0,
    valign: 'middle',
  })
  const runs: PptxGenJS.TextProps[] = [
    {
      text: block.text,
      options: { fontFace: DISPLAY, fontSize: 12.5, color: C.ivory, breakLine: true },
    },
  ]
  if (block.detail) {
    runs.push({
      text: block.detail,
      options: { fontFace: BODY, fontSize: 9, color: C.muted, paraSpaceBefore: 3 },
    })
  }
  slide.addText(runs, {
    x: x + 0.22,
    y: y + 0.29,
    w: w - 0.4,
    h: Math.max(0.2, h - 0.36),
    margin: 0,
    valign: 'top',
    fit: 'shrink',
    lineSpacingMultiple: 1.06,
  })
}
