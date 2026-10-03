/**
 * The PackDocument as an internal briefing book.
 *
 * Not a print of the screen and not a slide export: a cover page that
 * already carries the brief, then one chapter per core slide with its own
 * page, the appendix flowing as data pages, a running header with the
 * meeting and the data date, a footer with the page and the generation
 * time, tables with a gold rule under the header and a rule above every
 * total, charts drawn as vectors from the same data, margin notes in a
 * tinted column, and the speaker notes as a marked internal box at the
 * foot of each chapter. Print palette: paper, navy ink, a darker gold.
 * Standard PDF fonts in V1 (Times for display, Helvetica for body), so
 * every character is written through WinAnsi — the minus sign and the
 * arrow are mapped before they reach the page.
 */

import pdfmake from 'pdfmake'
import type {
  CanvasElement,
  Content,
  ContentTable,
  CustomTableLayout,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces'
import { formatLongDate } from '~/presentation/advisory/format'
import {
  CALLOUT_LABEL,
  DEPTH_LABEL,
  NOTE_KIND_LABEL,
} from '~/presentation/documents/meetingPackText'
import {
  DOCUMENT_PALETTE,
  type CalloutKind,
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
  ruleStrong: '#8A97A8',
  positive: '#1F7A4D',
  negative: '#B03A31',
  steel: '#5B7DB1',
}

const TONE_COLOR: Record<Tone, string> = {
  gold: P.gold,
  neutral: P.ink,
  warning: P.negative,
  positive: P.positive,
  negative: P.negative,
}

const CALLOUT_COLOR: Record<CalloutKind, string> = {
  observation: P.gold,
  implication: P.gold,
  'why-it-matters': P.ruleStrong,
  'watch-out': P.negative,
  verify: P.ruleStrong,
}

const MARKER_LABEL = {
  fact: 'FAKTA',
  assessment: 'BEDÖMNING',
  suggestion: 'FÖRSLAG',
} as const

/** A4 portrait, the margins below: what a line of content may span, in points. */
const PAGE_WIDTH = 595.28
const MARGIN_X = 44
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

/** A rule under the header in gold, a hairline between rows, a rule above every total. */
const tableLayout = (totals: ReadonlySet<number>): CustomTableLayout => ({
  hLineWidth: (i, node) => {
    if (i === 0) return 0
    if (i === 1) return 0.8
    if (i === node.table.body.length) return 0.6
    /* The line above body row (i - 1); header is row 0. */
    return totals.has(i - 1) ? 0.8 : 0.4
  },
  vLineWidth: () => 0,
  hLineColor: (i, node) => {
    if (i === 1) return P.goldLine
    if (i === node.table.body.length) return P.rule
    return totals.has(i - 1) ? P.ruleStrong : P.rule
  },
  paddingLeft: () => 3,
  paddingRight: () => 3,
  paddingTop: () => 2.6,
  paddingBottom: () => 2.6,
})

const BAR_LAYOUT = (color: string): CustomTableLayout => ({
  hLineWidth: () => 0,
  vLineWidth: (i) => (i === 0 ? 2.5 : 0),
  vLineColor: () => color,
  paddingLeft: () => 9,
  paddingRight: () => 8,
  paddingTop: () => 6,
  paddingBottom: () => 6,
})

/** The figure strip: a hairline between the figures, nothing around them. */
const STRIP_LAYOUT: CustomTableLayout = {
  hLineWidth: () => 0,
  vLineWidth: (i, node) => (i === 0 || i === node.table.widths?.length ? 0 : 0.5),
  vLineColor: () => P.rule,
  paddingLeft: (i) => (i === 0 ? 0 : 8),
  paddingRight: () => 6,
  paddingTop: () => 2,
  paddingBottom: () => 2,
}

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
  const content: Content[] = []
  doc.slides.forEach((slide, index) => {
    if (index === 0) content.push(...cover(doc, slide))
    else content.push(...section(doc, slide, index))
  })
  const generated = doc.generatedAt.slice(0, 16).replace('T', ' ')
  return {
    info: {
      title: t(doc.title),
      author: 'Financial OS',
      subject: t(doc.meetingLabel),
      creator: 'Financial OS',
      producer: 'Financial OS',
    },
    pageSize: 'A4',
    pageMargins: [MARGIN_X, 58, MARGIN_X, 52],
    defaultStyle: { font: 'Helvetica', fontSize: 9, color: P.ink, lineHeight: 1.2 },
    header: (currentPage) =>
      currentPage === 1
        ? ''
        : {
            margin: [MARGIN_X, 22, MARGIN_X, 0],
            columns: [
              {
                text: t(`MÖTESUNDERLAG · ${doc.client} · ${doc.meetingLabel}`),
                style: 'runningHead',
                width: '*',
              },
              {
                text: t(`${doc.internalMark} · Data per ${formatLongDate(doc.dataAsOf)}`),
                style: 'runningHead',
                alignment: 'right',
                width: 'auto',
              },
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
              text: t(
                `${doc.client} · Data per ${formatLongDate(doc.dataAsOf)} · Genererad ${generated}`,
              ),
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
      coverKicker: { fontSize: 7.5, bold: true, color: P.gold, characterSpacing: 0 },
      coverTitle: { font: 'Times', fontSize: 28, color: P.navy, lineHeight: 1.02 },
      coverMeeting: { fontSize: 10.5, color: P.ink },
      coverMeta: { fontSize: 7.5, color: P.muted },
      coverHeadline: { font: 'Times', fontSize: 15, color: P.navy, lineHeight: 1.12 },
      kicker: { fontSize: 7.2, bold: true, color: P.gold },
      kickerAppendix: { fontSize: 7.2, bold: true, color: P.muted },
      h1: { font: 'Times', fontSize: 15, color: P.navy, lineHeight: 1.12 },
      blockTitle: { fontSize: 7, bold: true, color: P.muted },
      kpiLabel: { fontSize: 6.4, color: P.muted },
      kpiValue: { font: 'Times', fontSize: 12.5, color: P.navy },
      kpiDetail: { fontSize: 7, color: P.muted },
      statementLabel: { fontSize: 6.8, bold: true, color: P.gold },
      statement: { font: 'Times', fontSize: 11.5, color: P.navy, lineHeight: 1.18 },
      caption: { fontSize: 7.4, color: P.muted, italics: true },
      th: { fontSize: 6.8, bold: true, color: P.muted },
      td: { fontSize: 8.2 },
      li: { fontSize: 8.8 },
      detail: { fontSize: 7.4, color: P.muted },
      marker: { fontSize: 6.2, bold: true, color: P.gold },
      calloutTitle: { fontSize: 6.6, bold: true },
      calloutText: { font: 'Times', fontSize: 11, color: P.navy, lineHeight: 1.16 },
      calloutDetail: { fontSize: 7.8, color: P.muted },
      noteTitle: { fontSize: 6.4, bold: true },
      noteText: { fontSize: 8, color: P.ink, lineHeight: 1.18 },
      noteDetail: { fontSize: 7.2, color: P.muted },
      metaLabel: { fontSize: 6.4, bold: true, color: P.muted },
      metaValue: { fontSize: 8, color: P.ink },
      legend: { fontSize: 7.2, color: P.muted },
      noteHead: { fontSize: 6.8, bold: true, color: P.muted },
      noteLabel: { fontSize: 6.4, bold: true, color: P.muted },
      note: { fontSize: 7.9, color: P.ink },
      runningHead: { fontSize: 6.8, color: P.muted },
      footer: { fontSize: 6.8, color: P.muted },
    },
  }
}

/* ------------------------------------------------------------------- cover */

/** The first page: the brief itself, with the title block and the provenance above it. */
function cover(doc: PackDocument, slide: PackSlide): Content[] {
  const generated = doc.generatedAt.slice(0, 16).replace('T', ' ')
  const prov = doc.provenance
  const metaLine = [
    `${DEPTH_LABEL[doc.depth]}`,
    `${doc.coreCount} kärnavsnitt${doc.appendixCount > 0 ? ` · ${doc.appendixCount} bilagor` : ''}`,
    `data per ${formatLongDate(doc.dataAsOf)}`,
    prov.portfolioValuedAt
      ? `portfölj värderad ${formatLongDate(prov.portfolioValuedAt)}`
      : null,
    prov.marketDataAsOf
      ? `marknadsdata ${formatLongDate(prov.marketDataAsOf.slice(0, 10))}`
      : null,
    prov.baselineMeetingDate
      ? `baslinje ${formatLongDate(prov.baselineMeetingDate)}`
      : null,
    `${prov.sourceCount} källposter`,
    `genererad ${generated}`,
  ]
    .filter((p): p is string => p !== null)
    .join(' · ')
  return [
    {
      stack: [
        { text: t(`MÖTESUNDERLAG · ${doc.confidentiality}`), style: 'coverKicker' },
        { text: t(doc.client), style: 'coverTitle', margin: [0, 6, 0, 2] },
        {
          columns: [
            { text: t(doc.meetingLabel), style: 'coverMeeting', width: '*' },
            {
              text: t(
                [
                  doc.advisor ? `Rådgivare ${doc.advisor}` : null,
                  doc.office ? `Kontor ${doc.office}` : null,
                ]
                  .filter((p): p is string => p !== null)
                  .join(' · '),
              ),
              style: 'coverMeeting',
              alignment: 'right',
              width: 'auto',
            },
          ],
        },
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
          margin: [0, 8, 0, 5],
        },
        { text: t(metaLine), style: 'coverMeta' },
      ],
      margin: [0, 0, 0, 14],
    },
    { text: t(slide.kicker.toUpperCase()), style: 'kicker' },
    { text: t(slide.headline), style: 'coverHeadline', margin: [0, 3, 0, 8] },
    ...slide.blocks.flatMap((block) => renderBlock(block, CONTENT_WIDTH)),
    ...(slide.notes.length > 0 ? [notesBox(slide.notes)] : []),
  ]
}

/* ----------------------------------------------------------------- section */

/** A core chapter takes a page of its own; the appendix flows, each data page under a rule. */
function section(doc: PackDocument, slide: PackSlide, index: number): Content[] {
  void doc
  const appendix = slide.section === 'appendix'
  const firstAppendix = appendix && doc.slides[index - 1]?.section === 'core'
  const breakBefore = !appendix || firstAppendix
  const out: Content[] = []
  if (appendix && !firstAppendix) {
    out.push({
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: CONTENT_WIDTH,
          y2: 0,
          lineWidth: 0.5,
          lineColor: P.rule,
        },
      ],
      margin: [0, 16, 0, 10],
    })
  }
  out.push(
    {
      text: t(slide.kicker.toUpperCase()),
      style: appendix ? 'kickerAppendix' : 'kicker',
      ...(breakBefore ? { pageBreak: 'before' } : {}),
    },
    { text: t(slide.headline), style: 'h1', margin: [0, 3, 0, 9] },
    ...slide.blocks.flatMap((block) => renderBlock(block, CONTENT_WIDTH)),
  )
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
    margin: [0, 10, 0, 0],
    unbreakable: notes.length <= 8,
  }
}

/* ------------------------------------------------------------------ blocks */

function renderBlock(block: PackBlock, width: number): Content[] {
  switch (block.kind) {
    case 'kpis':
      return [kpis(block.items, block.lead ?? false)]
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
                    ...(block.addendum
                      ? [
                          {
                            text: t(block.addendum.label.toUpperCase()),
                            style: 'blockTitle',
                            margin: [0, 5, 0, 1],
                          } as Content,
                          { text: t(block.addendum.text), style: 'li' } as Content,
                        ]
                      : []),
                  ],
                },
              ],
            ],
          },
          layout: BAR_LAYOUT(P.gold),
          margin: [0, 3, 0, 7],
        },
      ]
    case 'caption':
      return [{ text: t(block.text), style: 'caption', margin: [0, 2, 0, 6] }]
    case 'list':
      return list(block)
    case 'table':
      return table({
        title: block.title,
        columns: block.columns,
        rows: block.rows,
        width,
        widths: block.widths,
        align: block.align,
        emphasis: block.emphasis,
        totals: block.totals,
        tones: block.rowTones,
        toneColumn: block.toneColumn,
        footnote: block.footnote,
      })
    case 'chart':
      return chart(block, width)
    case 'timeline':
      return timeline(block, width)
    case 'callout': {
      const bar =
        block.tone === 'gold'
          ? P.gold
          : block.tone === 'warning'
            ? P.negative
            : P.ruleStrong
      const fill =
        block.tone === 'warning' ? P.warning : block.tone === 'gold' ? P.tint : P.grey
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
                    { text: t(block.text), style: block.compact ? 'li' : 'calloutText' },
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
          margin: [0, 3, 0, 7],
        },
      ]
    }
    case 'callouts':
      return [callouts(block, width)]
    case 'meta':
      return [
        {
          text: block.items.flatMap((item, i) => [
            ...(i > 0 ? [{ text: '   ·   ', color: P.rule }] : []),
            { text: `${t(item.label).toUpperCase()}  `, style: 'metaLabel' },
            { text: t(item.value), style: 'metaValue' },
          ]),
          margin: [0, 2, 0, 8],
        },
      ]
    case 'columns': {
      const widths = columnWidthsOf(block.columns.length, block.weights, width)
      return [
        {
          columns: block.columns.map((col, i) => ({
            width: widths[i]!,
            stack: col.flatMap((b) => renderBlock(b, widths[i]!)),
          })),
          columnGap: COLUMN_GAP,
        },
      ]
    }
    case 'changes':
      return table({
        title: block.title,
        columns: ['Vad', 'Före', 'Nu', 'Förändring'],
        rows: block.rows.map((r) => [r.label, r.before, r.after, r.note ?? '']),
        width,
        widths: [2.2, 1.6, 1.6, 2.2],
        align: ['left', 'right', 'right', 'left'],
        tones: block.rows.map((r) => r.tone),
        toneColumn: 2,
      })
    case 'actions':
      return table({
        columns: ['Åtgärd', 'Ägare', 'Datum', 'Status'],
        rows: block.rows.map((r) => [r.action, r.owner, r.date, r.status]),
        width,
        widths: [4.2, 1.2, 1.3, 1.1],
        tones: block.rows.map((r) => r.tone),
        toneColumn: 3,
      })
  }
}

function columnWidthsOf(
  count: number,
  weights: number[] | undefined,
  width: number,
): number[] {
  const rel =
    weights && weights.length === count ? weights : Array.from({ length: count }, () => 1)
  const sum = rel.reduce((a, b) => a + b, 0)
  const available = width - COLUMN_GAP * (count - 1)
  return rel.map((r) => Math.floor((available * r) / sum))
}

function kpis(items: readonly KpiItem[], lead: boolean): Content {
  const perRow = items.length <= 6 ? Math.max(1, items.length) : 4
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
      ...(lead ? { fillColor: P.tint } : {}),
    }))
    while (cells.length < perRow)
      cells.push({ text: '', ...(lead ? { fillColor: P.tint } : {}) })
    rows.push(cells)
  }
  return {
    table: { widths: Array.from({ length: perRow }, () => '*'), body: rows },
    layout: lead
      ? {
          ...STRIP_LAYOUT,
          paddingLeft: () => 8,
          paddingTop: () => 5,
          paddingBottom: () => 5,
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.5 : 0),
          hLineColor: () => P.goldLine,
        }
      : STRIP_LAYOUT,
    margin: [0, 2, 0, 7],
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
    margin: [0, 0, 0, 2.5],
  }))
  const body: Content = block.numbered
    ? { ol: items, margin: [0, 2, 0, 7] }
    : { ul: items, margin: [0, 2, 0, 7], markerColor: P.gold }
  return [
    ...(block.title
      ? [
          {
            text: t(block.title.toUpperCase()),
            style: 'blockTitle',
            margin: [0, 3, 0, 2],
          } as Content,
        ]
      : []),
    body,
  ]
}

interface TableSpec {
  title?: string
  columns: readonly string[]
  rows: readonly string[][]
  width: number
  widths?: number[]
  align?: readonly ('left' | 'right')[]
  emphasis?: readonly number[]
  totals?: readonly number[]
  tones?: readonly (Tone | undefined)[]
  toneColumn?: number
  footnote?: string
}

function table(spec: TableSpec): Content[] {
  const rel =
    spec.widths && spec.widths.length === spec.columns.length
      ? spec.widths
      : spec.columns.map(() => 1)
  const sum = rel.reduce((a, b) => a + b, 0)
  const points = rel.map((r) => Math.floor((spec.width * r) / sum) - 6)
  const header: TableCell[] = spec.columns.map((c, i) => ({
    text: t(c.toUpperCase()),
    style: 'th',
    alignment: spec.align?.[i] ?? 'left',
  }))
  const totals = new Set(spec.totals ?? [])
  const body: TableCell[][] = spec.rows.map((row, r) =>
    row.map((cell, i) => ({
      text: t(cell),
      style: 'td',
      alignment: spec.align?.[i] ?? 'left',
      /* A figure never breaks across lines; a sentence may. */
      noWrap: spec.align?.[i] === 'right' && cell.length <= 14,
      bold: totals.has(r) || (spec.emphasis?.includes(r) ?? false),
      ...(i === (spec.toneColumn ?? 2) && spec.tones?.[r] && spec.tones[r] !== 'neutral'
        ? { color: TONE_COLOR[spec.tones[r]!] }
        : {}),
    })),
  )
  const content: ContentTable = {
    table: {
      headerRows: 1,
      widths: points,
      body: [header, ...body],
      dontBreakRows: true,
    },
    layout: tableLayout(totals),
    margin: [0, 2, 0, spec.footnote ? 2 : 7],
  }
  return [
    ...(spec.title
      ? [
          {
            text: t(spec.title.toUpperCase()),
            style: 'blockTitle',
            margin: [0, 3, 0, 2],
          } as Content,
        ]
      : []),
    content,
    ...(spec.footnote
      ? [{ text: t(spec.footnote), style: 'caption', margin: [0, 0, 0, 7] } as Content]
      : []),
  ]
}

/** The series legend as one wrapping line: a coloured bullet and the name, never a column per entry. */
function legendLine(series: readonly { name: string; color: string }[]): Content {
  return {
    text: series.flatMap((s) => [
      { text: '• ', color: `#${s.color}`, fontSize: 10 },
      { text: `${t(s.name)}   `, style: 'legend' },
    ]),
    margin: [0, 2, 0, 1],
  }
}

/** Vector bars from the chart's data: no image, no external renderer. */
function chart(block: Extract<PackBlock, { kind: 'chart' }>, width: number): Content[] {
  const caption: Content = {
    text: t(
      `${block.unit} · per ${formatLongDate(block.asOf)} · ${block.source}${block.note ? ` · ${block.note}` : ''}`,
    ),
    style: 'caption',
    margin: [0, 0, 0, 7],
  }
  const title: Content = {
    text: t(block.title.toUpperCase()),
    style: 'blockTitle',
    margin: [0, 3, 0, 2],
  }
  if (block.chart === 'donut') return [title, donut(block, width), caption]
  const labelW = Math.min(96, Math.max(64, width * 0.3))
  const valueW = block.chart === 'paired-bar' || block.chart === 'grouped-bar' ? 78 : 56
  const barW = Math.max(50, width - labelW - valueW - 18)
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
          const rect: CanvasElement = {
            type: 'rect',
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
    const bars: CanvasElement[] = block.series.map((s, i) => ({
      type: 'rect',
      x: 0,
      y: 1 + i * 7,
      w: ((s.values[c] ?? 0) / max) * barW,
      h: block.series.length === 1 ? 9 : 5,
      color: `#${s.color}`,
    }))
    return [
      { text: t(category), style: 'td' },
      { canvas: bars, margin: [0, 1, 0, 1] },
      {
        text: block.series
          .map(
            (s) => `${formatNumber(s.values[c] ?? 0)}${block.unit === '%' ? ' %' : ''}`,
          )
          .join(' / '),
        style: 'td',
        alignment: 'right',
      },
    ]
  })
  return [
    title,
    {
      table: { widths: [labelW, barW, valueW], body: rows },
      layout: 'noBorders',
    },
    ...(block.series.length > 1 ? [legendLine(block.series)] : []),
    caption,
  ]
}

/** Shares of a whole as a ring, drawn from polygons, beside a legend with the values. */
function donut(block: Extract<PackBlock, { kind: 'chart' }>, width: number): Content {
  const values = block.categories.map((_, c) =>
    block.series.reduce((sum, s) => sum + (s.values[c] ?? 0), 0),
  )
  const total = Math.max(
    1e-9,
    values.reduce((a, b) => a + b, 0),
  )
  const size = width < 260 ? 84 : Math.min(118, Math.max(90, width * 0.4))
  const r = size / 2
  const inner = r * 0.6
  const cx = r
  const cy = r
  const shapes: CanvasElement[] = []
  let angle = -Math.PI / 2
  values.forEach((value, c) => {
    if (value <= 0) return
    const sweep = (value / total) * Math.PI * 2
    const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 36)))
    const points: { x: number; y: number }[] = []
    for (let i = 0; i <= steps; i += 1) {
      const a = angle + (sweep * i) / steps
      points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
    for (let i = steps; i >= 0; i -= 1) {
      const a = angle + (sweep * i) / steps
      points.push({ x: cx + inner * Math.cos(a), y: cy + inner * Math.sin(a) })
    }
    shapes.push({
      type: 'polyline',
      points,
      closePath: true,
      color: `#${block.series[c]?.color ?? DOCUMENT_PALETTE.blueGrey}`,
      lineWidth: 0,
      lineColor: '#FFFFFF',
    })
    angle += sweep
  })
  const legend: TableCell[][] = block.categories.map((category, c) => [
    {
      text: [
        {
          text: '• ',
          color: `#${block.series[c]?.color ?? DOCUMENT_PALETTE.blueGrey}`,
          fontSize: 10,
        },
        { text: t(category), style: 'td' },
      ],
    },
    {
      text: `${formatNumber(values[c] ?? 0)} ${block.unit}`,
      style: 'td',
      alignment: 'right',
      noWrap: true,
    },
    {
      text: `${Math.round(((values[c] ?? 0) / total) * 100)} %`,
      style: 'td',
      alignment: 'right',
      noWrap: true,
    },
  ])
  return {
    columns: [
      {
        width: size,
        stack: [
          { canvas: shapes },
          ...(block.centre
            ? [
                {
                  text: t(block.centre),
                  style: 'kpiValue',
                  alignment: 'center',
                  relativePosition: { x: 0, y: -(r + 7) },
                } as Content,
              ]
            : []),
        ],
      },
      {
        width: '*',
        table: { widths: ['*', 'auto', 'auto'], body: legend },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.4),
          vLineWidth: () => 0,
          hLineColor: () => P.rule,
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
        margin: [10, 4, 0, 0],
      },
    ],
    columnGap: 8,
  }
}

/** A maturity timeline: one row per date with its marker on a common axis, read left to right from today. */
function timeline(
  block: Extract<PackBlock, { kind: 'timeline' }>,
  width: number,
): Content[] {
  const labelW = Math.min(130, width * 0.36)
  const valueW = 92
  const axisW = Math.max(60, width - labelW - valueW - 18)
  const maxDays = Math.max(90, ...block.items.map((i) => i.daysAhead))
  const span = Math.ceil(maxDays / 90) * 90
  const px = (days: number) => (axisW * Math.min(days, span)) / span
  const rows: TableCell[][] = block.items.map((item) => {
    const color = item.tone ? TONE_COLOR[item.tone] : P.navy
    const shapes: CanvasElement[] = [
      { type: 'line', x1: 0, y1: 7, x2: axisW, y2: 7, lineWidth: 0.4, lineColor: P.rule },
      {
        type: 'line',
        x1: 0,
        y1: 7,
        x2: px(item.daysAhead),
        y2: 7,
        lineWidth: 1.2,
        lineColor: color,
      },
      { type: 'ellipse', x: px(item.daysAhead), y: 7, r1: 3.2, r2: 3.2, color },
    ]
    return [
      {
        stack: [
          { text: t(item.label), style: 'td', bold: item.tone === 'gold', color },
          ...(item.detail ? [{ text: t(item.detail), style: 'detail' } as Content] : []),
        ],
      },
      { canvas: shapes, margin: [0, 2, 0, 2] },
      {
        text: `${formatLongDate(item.date)}\nom ${item.daysAhead} dagar`,
        style: 'detail',
        alignment: 'right',
      },
    ]
  })
  const ticks: CanvasElement[] = []
  for (let d = 0; d <= span; d += 90) {
    ticks.push({
      type: 'line',
      x1: px(d),
      y1: 0,
      x2: px(d),
      y2: 4,
      lineWidth: 0.5,
      lineColor: P.ruleStrong,
    })
  }
  return [
    { text: t(block.title.toUpperCase()), style: 'blockTitle', margin: [0, 3, 0, 2] },
    {
      table: {
        widths: [labelW, axisW, valueW],
        body: [
          ...rows,
          [
            { text: t(`Dagar från ${formatLongDate(block.from)}`), style: 'kpiLabel' },
            {
              stack: [
                { canvas: ticks },
                {
                  columns: Array.from({ length: span / 90 + 1 }, (_, i) => ({
                    text: i === 0 ? 'I DAG' : `+${i * 90} D`,
                    style: 'kpiLabel',
                    width: '*',
                    alignment: i === 0 ? 'left' : i * 90 === span ? 'right' : 'center',
                  })),
                },
              ],
            },
            { text: '', style: 'kpiLabel' },
          ],
        ],
      },
      layout: {
        hLineWidth: (i, node) => (i === 0 || i >= node.table.body.length - 1 ? 0 : 0.4),
        vLineWidth: () => 0,
        hLineColor: () => P.rule,
        paddingLeft: () => 2,
        paddingRight: () => 4,
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
    },
    {
      text: t(`${block.source}${block.note ? ` · ${block.note}` : ''}`),
      style: 'caption',
      margin: [0, 2, 0, 7],
    },
  ]
}

/** Margin notes side by side: a rule in the note's colour, a small label, sans body. */
function callouts(
  block: Extract<PackBlock, { kind: 'callouts' }>,
  width: number,
): Content {
  const n = Math.max(1, block.items.length)
  const colWidth = Math.floor((width - COLUMN_GAP * (n - 1)) / n)
  return {
    columns: block.items.map((item) => ({
      width: colWidth,
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [
                {
                  text: t(CALLOUT_LABEL[item.kind].toUpperCase()),
                  style: 'noteTitle',
                  color: CALLOUT_COLOR[item.kind],
                  margin: [0, 0, 0, 2],
                },
                { text: t(item.text), style: 'noteText' },
                ...(item.detail
                  ? [
                      {
                        text: t(item.detail),
                        style: 'noteDetail',
                        margin: [0, 2, 0, 0],
                      } as Content,
                    ]
                  : []),
              ],
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: (i) => (i === 0 ? 1.5 : 0),
        vLineColor: () => CALLOUT_COLOR[item.kind],
        paddingLeft: () => 7,
        paddingRight: () => 4,
        paddingTop: () => 1,
        paddingBottom: () => 1,
      },
    })),
    columnGap: COLUMN_GAP,
    margin: [0, 4, 0, 8],
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value)
}
