/**
 * The PackDocument as an internal briefing book.
 *
 * Not a print of the screen: the same slides, adapted to a page — a cover
 * block, one section per slide, running header and footer with page
 * numbers, tables that break cleanly, charts drawn as vector bars from
 * the same data, and the speaker notes as a marked internal box at the
 * foot of each section. Print palette: paper, navy ink, a darker gold.
 * Standard PDF fonts in V1 (Times for display, Helvetica for body), so
 * every character is written through WinAnsi — the minus sign and the
 * arrow are mapped before they reach the page.
 */

import pdfmake from 'pdfmake'
import type {
  Content,
  ContentTable,
  CustomTableLayout,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces'
import { formatLongDate } from '~/presentation/advisory/format'
import { DEPTH_LABEL, NOTE_KIND_LABEL } from '~/presentation/documents/meetingPackText'
import {
  DOCUMENT_PALETTE,
  type KpiItem,
  type ListItem,
  type NoteLine,
  type PackBlock,
  type PackDocument,
  type PackSlide,
  type Tone,
} from '~/presentation/documents/packDocument'

const P = {
  navy: `#${DOCUMENT_PALETTE.navy}`,
  gold: `#${DOCUMENT_PALETTE.goldDeep}`,
  goldLine: '#D9C9A3',
  ink: `#${DOCUMENT_PALETTE.inkText}`,
  muted: `#${DOCUMENT_PALETTE.inkMuted}`,
  tint: `#${DOCUMENT_PALETTE.paperTint}`,
  grey: `#${DOCUMENT_PALETTE.paperGrey}`,
  warning: `#${DOCUMENT_PALETTE.paperWarning}`,
  rule: '#D9DEE5',
  positive: '#1F7A4D',
  negative: '#B03A31',
}

const TONE_COLOR: Record<Tone, string> = {
  gold: P.gold,
  neutral: P.ink,
  warning: P.negative,
  positive: P.positive,
  negative: P.negative,
}

const MARKER_LABEL = {
  fact: 'FAKTA',
  assessment: 'BEDÖMNING',
  suggestion: 'FÖRSLAG',
} as const

/** A4 portrait, the margins below: what a line of content may span, in points. */
const PAGE_WIDTH = 595.28
const MARGIN_X = 46
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X
const COLUMN_GAP = 14

const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
  Times: {
    normal: 'Times-Roman',
    bold: 'Times-Bold',
    italics: 'Times-Italic',
    bolditalics: 'Times-BoldItalic',
  },
}

const STANDARD_FONT_NAMES = new Set(
  Object.values(FONTS).flatMap((face) => Object.values(face)),
)

/** WinAnsi cannot carry these; the page says the same thing in characters it has. */
function t(text: string): string {
  return text
    .replace(/−/g, '-')
    .replace(/→/g, ' till ')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/■/g, '')
}

const TABLE_LAYOUT: CustomTableLayout = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.8 : 0.4),
  vLineWidth: () => 0,
  hLineColor: (i) => (i <= 1 ? P.goldLine : P.rule),
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  fillColor: (i) => (i === 0 ? P.tint : null),
}

const BAR_LAYOUT = (color: string): CustomTableLayout => ({
  hLineWidth: () => 0,
  vLineWidth: (i) => (i === 0 ? 3 : 0),
  vLineColor: () => color,
  paddingLeft: () => 10,
  paddingRight: () => 8,
  paddingTop: () => 7,
  paddingBottom: () => 7,
})

/* ------------------------------------------------------------------ render */

export async function renderPdf(doc: PackDocument): Promise<Buffer> {
  if (doc.audience !== 'INTERNAL_ADVISOR') {
    throw new Error('The PDF renderer is built for the internal advisor pack only')
  }
  pdfmake.setFonts(FONTS)
  /*
   * The document is composed from typed data: it fetches nothing and reads no
   * file. pdfkit's standard fonts are named, not read, but pdfmake asks the
   * local policy about them by name, so exactly those names are allowed.
   */
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy((path) => STANDARD_FONT_NAMES.has(path))
  const definition = definitionOf(doc)
  const created = pdfmake.createPdf(definition)
  const buffer = await created.getBuffer()
  return Buffer.from(buffer)
}

function definitionOf(doc: PackDocument): TDocumentDefinitions {
  const content: Content[] = [cover(doc)]
  doc.slides.forEach((slide, index) => {
    content.push(...section(doc, slide, index > 0))
  })
  return {
    info: {
      title: t(doc.title),
      author: 'Financial OS',
      subject: t(doc.meetingLabel),
      creator: 'Financial OS',
      producer: 'Financial OS',
    },
    pageSize: 'A4',
    pageMargins: [MARGIN_X, 60, MARGIN_X, 54],
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, color: P.ink, lineHeight: 1.22 },
    header: (currentPage) =>
      currentPage === 1
        ? ''
        : {
            margin: [MARGIN_X, 22, MARGIN_X, 0],
            columns: [
              { text: t(`MÖTESUNDERLAG · ${doc.client}`), style: 'runningHead' },
              { text: doc.internalMark, style: 'runningHead', alignment: 'right' },
            ],
          },
    footer: (currentPage, pageCount) => ({
      margin: [MARGIN_X, 12, MARGIN_X, 0],
      stack: [
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 0,
              x2: CONTENT_WIDTH,
              y2: 0,
              lineWidth: 0.5,
              lineColor: P.goldLine,
            },
          ],
        },
        {
          margin: [0, 6, 0, 0],
          columns: [
            { text: doc.confidentiality, style: 'footer', width: '*' },
            {
              text: t(`${doc.client} · Data per ${formatLongDate(doc.dataAsOf)}`),
              style: 'footer',
              alignment: 'center',
              width: '*',
            },
            {
              text: `Sida ${currentPage} / ${pageCount}`,
              style: 'footer',
              alignment: 'right',
              width: 70,
            },
          ],
        },
      ],
    }),
    content,
    styles: {
      coverKicker: { fontSize: 8, bold: true, color: P.gold },
      coverTitle: { font: 'Times', fontSize: 26, color: P.navy, lineHeight: 1.05 },
      coverMeeting: { fontSize: 11, color: P.ink },
      coverMeta: { fontSize: 8, color: P.muted },
      kicker: { fontSize: 7.5, bold: true, color: P.gold },
      kickerAppendix: {
        fontSize: 7.5,
        bold: true,
        color: P.muted,
      },
      h1: { font: 'Times', fontSize: 16, color: P.navy, lineHeight: 1.15 },
      blockTitle: { fontSize: 7.5, bold: true, color: P.muted },
      kpiLabel: { fontSize: 6.8, color: P.muted },
      kpiValue: { font: 'Times', fontSize: 13, color: P.navy },
      kpiDetail: { fontSize: 7.5, color: P.muted },
      statementLabel: { fontSize: 7, bold: true, color: P.gold },
      statement: { font: 'Times', fontSize: 12, color: P.navy, lineHeight: 1.2 },
      caption: { fontSize: 8, color: P.muted, italics: true },
      th: { fontSize: 7.3, bold: true, color: P.muted },
      td: { fontSize: 8.6 },
      li: { fontSize: 9.2 },
      detail: { fontSize: 7.8, color: P.muted },
      marker: { fontSize: 6.5, bold: true, color: P.gold },
      calloutTitle: { fontSize: 7, bold: true },
      calloutText: { font: 'Times', fontSize: 11.5, color: P.navy, lineHeight: 1.18 },
      calloutDetail: { fontSize: 8.2, color: P.muted },
      legend: { fontSize: 7.5, color: P.muted },
      noteHead: { fontSize: 7, bold: true, color: P.muted },
      noteLabel: { fontSize: 6.6, bold: true, color: P.muted },
      note: { fontSize: 8.2, color: P.ink },
      runningHead: { fontSize: 7, color: P.muted },
      footer: { fontSize: 7, color: P.muted },
    },
  }
}

/* ------------------------------------------------------------------- cover */

function cover(doc: PackDocument): Content {
  return {
    stack: [
      { text: t(`MÖTESUNDERLAG · ${doc.confidentiality}`), style: 'coverKicker' },
      { text: t(doc.client), style: 'coverTitle', margin: [0, 6, 0, 2] },
      { text: t(doc.meetingLabel), style: 'coverMeeting' },
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: CONTENT_WIDTH,
            y2: 0,
            lineWidth: 1,
            lineColor: `#${DOCUMENT_PALETTE.goldDeep}`,
          },
        ],
        margin: [0, 10, 0, 6],
      },
      {
        text: t(
          `${DEPTH_LABEL[doc.depth]} · ${doc.coreCount} kärnavsnitt${doc.appendixCount > 0 ? ` · ${doc.appendixCount} bilagor` : ''} · data per ${formatLongDate(doc.dataAsOf)} · genererad ${doc.generatedAt.slice(0, 16).replace('T', ' ')} · ${doc.internalMark}`,
        ),
        style: 'coverMeta',
      },
    ],
    margin: [0, 0, 0, 18],
  }
}

/* ----------------------------------------------------------------- section */

function section(doc: PackDocument, slide: PackSlide, breakBefore: boolean): Content[] {
  void doc
  const out: Content[] = [
    {
      text: t(slide.kicker.toUpperCase()),
      style: slide.section === 'appendix' ? 'kickerAppendix' : 'kicker',
      ...(breakBefore ? { pageBreak: 'before' } : {}),
    },
    { text: t(slide.headline), style: 'h1', margin: [0, 3, 0, 10] },
    ...slide.blocks.flatMap((block) => renderBlock(block, CONTENT_WIDTH)),
  ]
  if (slide.notes.length > 0) out.push(notesBox(slide.notes))
  return out
}

function notesBox(notes: readonly NoteLine[]): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            fillColor: P.grey,
            stack: [
              { text: 'TALEPUNKTER · INTERNT', style: 'noteHead', margin: [0, 0, 0, 3] },
              ...notes.map<Content>((n) => ({
                text: [
                  { text: `${NOTE_KIND_LABEL[n.kind]} `, style: 'noteLabel' },
                  { text: t(n.text) },
                ],
                style: 'note',
                margin: [0, 0, 0, 2],
              })),
            ],
            margin: [8, 6, 8, 6],
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 12, 0, 0],
  }
}

/* ------------------------------------------------------------------ blocks */

function renderBlock(block: PackBlock, width: number): Content[] {
  switch (block.kind) {
    case 'kpis':
      return [kpis(block.items)]
    case 'statement':
      return [
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  fillColor: P.tint,
                  stack: [
                    ...(block.label
                      ? [
                          {
                            text: t(block.label.toUpperCase()),
                            style: 'statementLabel',
                            margin: [0, 0, 0, 3],
                          } as Content,
                        ]
                      : []),
                    { text: t(block.text), style: 'statement' },
                  ],
                },
              ],
            ],
          },
          layout: BAR_LAYOUT(P.gold),
          margin: [0, 4, 0, 8],
        },
      ]
    case 'caption':
      return [{ text: t(block.text), style: 'caption', margin: [0, 2, 0, 6] }]
    case 'list':
      return list(block)
    case 'table':
      return table(
        block.title,
        block.columns,
        block.rows,
        width,
        block.widths,
        block.align,
        block.emphasis,
      )
    case 'chart':
      return chart(block, width)
    case 'callout': {
      const bar =
        block.tone === 'gold' ? P.gold : block.tone === 'warning' ? P.negative : P.muted
      const fill =
        block.tone === 'gold' ? P.tint : block.tone === 'warning' ? P.warning : P.grey
      return [
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  fillColor: fill,
                  stack: [
                    {
                      text: t(block.title.toUpperCase()),
                      style: 'calloutTitle',
                      color: bar,
                      margin: [0, 0, 0, 3],
                    },
                    { text: t(block.text), style: 'calloutText' },
                    ...(block.detail
                      ? [
                          {
                            text: t(block.detail),
                            style: 'calloutDetail',
                            margin: [0, 3, 0, 0],
                          } as Content,
                        ]
                      : []),
                  ],
                },
              ],
            ],
          },
          layout: BAR_LAYOUT(bar),
          margin: [0, 4, 0, 8],
        },
      ]
    }
    case 'columns': {
      const n = block.columns.length
      const colWidth = (width - COLUMN_GAP * (n - 1)) / n
      return [
        {
          columns: block.columns.map((col) => ({
            width: '*',
            stack: col.flatMap((b) => renderBlock(b, colWidth)),
          })),
          columnGap: COLUMN_GAP,
        },
      ]
    }
    case 'changes':
      return table(
        block.title,
        ['Vad', 'Före', 'Nu', ''],
        block.rows.map((r) => [r.label, r.before, r.after, r.note ?? '']),
        width,
        [2.2, 1.6, 1.6, 2.2],
        ['left', 'right', 'right', 'left'],
        undefined,
        block.rows.map((r) => r.tone),
      )
    case 'actions':
      return table(
        undefined,
        ['Åtgärd', 'Ägare', 'Datum', 'Status'],
        block.rows.map((r) => [r.action, r.owner, r.date, r.status]),
        width,
        [4.2, 1.2, 1.3, 1.1],
      )
  }
}

function kpis(items: readonly KpiItem[]): Content {
  const perRow = items.length <= 5 ? Math.max(1, items.length) : 4
  const rows: TableCell[][] = []
  for (let i = 0; i < items.length; i += perRow) {
    const chunk = items.slice(i, i + perRow)
    const cells: TableCell[] = chunk.map((item) => ({
      stack: [
        { text: t(item.label.toUpperCase()), style: 'kpiLabel' },
        {
          text: t(item.value),
          style: 'kpiValue',
          ...(item.tone && item.tone !== 'neutral'
            ? { color: TONE_COLOR[item.tone] }
            : {}),
          margin: [0, 1, 0, 0],
        },
        ...(item.detail ? [{ text: t(item.detail), style: 'kpiDetail' } as Content] : []),
      ],
      margin: [0, 2, 6, 2],
    }))
    while (cells.length < perRow) cells.push({ text: '' })
    rows.push(cells)
  }
  return {
    table: { widths: Array.from({ length: perRow }, () => '*'), body: rows },
    layout: 'noBorders',
    margin: [0, 2, 0, 6],
  }
}

function list(block: Extract<PackBlock, { kind: 'list' }>): Content[] {
  const items: Content[] = block.items.map((item: ListItem) => ({
    stack: [
      {
        text: [
          ...(item.marker && item.marker !== 'fact'
            ? [{ text: `${MARKER_LABEL[item.marker]} `, style: 'marker' }]
            : []),
          { text: t(item.text) },
        ],
        style: 'li',
      },
      ...(item.detail ? [{ text: t(item.detail), style: 'detail' } as Content] : []),
    ],
    margin: [0, 0, 0, 3],
  }))
  const body: Content = block.numbered
    ? { ol: items, margin: [0, 2, 0, 8] }
    : { ul: items, margin: [0, 2, 0, 8], markerColor: P.gold }
  return [
    ...(block.title
      ? [
          {
            text: t(block.title.toUpperCase()),
            style: 'blockTitle',
            margin: [0, 4, 0, 2],
          } as Content,
        ]
      : []),
    body,
  ]
}

function table(
  title: string | undefined,
  columns: readonly string[],
  rows: readonly string[][],
  width: number,
  widths?: number[],
  align?: readonly ('left' | 'right')[],
  emphasis?: readonly number[],
  tones?: readonly (Tone | undefined)[],
): Content[] {
  const rel = widths && widths.length === columns.length ? widths : columns.map(() => 1)
  const sum = rel.reduce((a, b) => a + b, 0)
  const points = rel.map((r) => (width * r) / sum - 8)
  const header: TableCell[] = columns.map((c, i) => ({
    text: t(c.toUpperCase()),
    style: 'th',
    alignment: align?.[i] ?? 'left',
  }))
  const body: TableCell[][] = rows.map((row, r) =>
    row.map((cell, i) => ({
      text: t(cell),
      style: 'td',
      alignment: align?.[i] ?? 'left',
      bold: emphasis?.includes(r) ?? false,
      ...(i === 2 && tones?.[r] && tones[r] !== 'neutral'
        ? { color: TONE_COLOR[tones[r]!] }
        : {}),
    })),
  )
  const content: ContentTable = {
    table: { headerRows: 1, widths: points, body: [header, ...body] },
    layout: TABLE_LAYOUT,
    margin: [0, 2, 0, 8],
  }
  return [
    ...(title
      ? [
          {
            text: t(title.toUpperCase()),
            style: 'blockTitle',
            margin: [0, 4, 0, 2],
          } as Content,
        ]
      : []),
    content,
  ]
}

/** Vector bars from the chart's data: no image, no external renderer. */
function chart(block: Extract<PackBlock, { kind: 'chart' }>, width: number): Content[] {
  const labelW = 88
  const valueW = 92
  const barW = Math.max(60, width - labelW - valueW - 24)
  const max = Math.max(
    1,
    ...(block.chart === 'stacked-bar'
      ? block.categories.map((_, c) =>
          block.series.reduce((s, x) => s + (x.values[c] ?? 0), 0),
        )
      : block.series.flatMap((s) => s.values)),
  )
  const rows: TableCell[][] = block.categories.map((category, c) => {
    if (block.chart === 'stacked-bar') {
      let offset = 0
      const rects = block.series
        .filter((s) => (s.values[c] ?? 0) > 0)
        .map((s) => {
          const w = ((s.values[c] ?? 0) / max) * barW
          const rect = {
            type: 'rect' as const,
            x: offset,
            y: 2,
            w,
            h: 10,
            color: `#${s.color}`,
          }
          offset += w
          return rect
        })
      const total = block.series.reduce((s, x) => s + (x.values[c] ?? 0), 0)
      return [
        { text: t(category), style: 'td' },
        { canvas: rects, margin: [0, 1, 0, 1] },
        { text: `${formatNumber(total)} ${block.unit}`, style: 'td', alignment: 'right' },
      ]
    }
    const bars = block.series.map((s, i) => ({
      type: 'rect' as const,
      x: 0,
      y: 1 + i * 7,
      w: ((s.values[c] ?? 0) / max) * barW,
      h: 5,
      color: `#${s.color}`,
    }))
    return [
      { text: t(category), style: 'td' },
      { canvas: bars, margin: [0, 1, 0, 1] },
      {
        text: block.series
          .map((s) => `${formatNumber(s.values[c] ?? 0)} ${block.unit}`)
          .join(' / '),
        style: 'td',
        alignment: 'right',
      },
    ]
  })
  const legend: Content = {
    columns: block.series.map((s) => ({
      width: 'auto',
      columns: [
        {
          width: 8,
          canvas: [{ type: 'rect', x: 0, y: 2, w: 7, h: 7, color: `#${s.color}` }],
        },
        { width: 'auto', text: t(s.name), style: 'legend', margin: [3, 0, 10, 0] },
      ],
    })),
    margin: [0, 2, 0, 2],
  }
  return [
    { text: t(block.title.toUpperCase()), style: 'blockTitle', margin: [0, 4, 0, 2] },
    {
      table: { widths: [labelW, barW, valueW], body: rows },
      layout: 'noBorders',
    },
    legend,
    {
      text: t(
        `${block.unit} · per ${formatLongDate(block.asOf)} · ${block.source}${block.note ? ` · ${block.note}` : ''}`,
      ),
      style: 'caption',
      margin: [0, 0, 0, 8],
    },
  ]
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value)
}
