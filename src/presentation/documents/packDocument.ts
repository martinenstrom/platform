/**
 * The document a Meeting Pack becomes — one typed description of slides,
 * blocks and speaker notes that the screen, the PowerPoint renderer and
 * the PDF renderer all consume. A renderer draws what is here and adds
 * nothing; the composer (meetingPackDocument.ts) decides what is said.
 * That is what makes two formats agree.
 *
 * Every slide carries an archetype: the composer arranges an executive
 * brief, a snapshot, a change page, a balance sheet, a portfolio
 * analysis, a financing page, a market page, an open-issues page, a
 * questions page, a plan, an action list and a data appendix each in its
 * own deliberate way, and a renderer may vary its treatment by it.
 */

import type { AssetClass, AssetKind } from '~/domain/advisory'
import type { MeetingPackDepth, PackSlideKind } from '~/application/advisory/meetingPack'

export type Marker = 'fact' | 'assessment' | 'suggestion'
export type Tone = 'gold' | 'neutral' | 'warning' | 'positive' | 'negative'

export type SlideArchetype =
  | 'executive'
  | 'snapshot'
  | 'change'
  | 'balance-sheet'
  | 'portfolio'
  | 'financing'
  | 'market'
  | 'issues'
  | 'questions'
  | 'plan'
  | 'actions'
  | 'appendix-data'

export interface KpiItem {
  label: string
  value: string
  detail?: string
  tone?: Tone
}

export interface ListItem {
  text: string
  detail?: string
  marker?: Marker
}

export interface ChartSeries {
  name: string
  values: number[]
  /** Hex without '#'. */
  color: string
}

export type ChartKind =
  | 'stacked-bar'
  | 'grouped-bar'
  /** One series as shares of a whole; the centre carries the total. */
  | 'donut'
  /** Two series side by side per category — previous against current. */
  | 'paired-bar'
  /** One series, one bar per category, read left to right. */
  | 'horizontal-bar'

export interface ChangeRow {
  label: string
  before: string
  after: string
  note?: string
  tone?: Tone
}

export interface ActionRow {
  action: string
  owner: string
  date: string
  status: string
  tone?: Tone
}

/** A small editorial side note: what an analyst would write in the margin. */
export type CalloutKind =
  'observation' | 'implication' | 'why-it-matters' | 'watch-out' | 'verify'

export interface CalloutItem {
  kind: CalloutKind
  text: string
  detail?: string
}

export interface MetaItem {
  label: string
  value: string
}

export interface TimelineItem {
  label: string
  /** ISO date. */
  date: string
  daysAhead: number
  detail?: string
  tone?: Tone
}

export type PackBlock =
  | { kind: 'kpis'; items: KpiItem[]; lead?: boolean }
  | {
      kind: 'statement'
      label?: string
      text: string
      /** A second, smaller paragraph under the statement: the destination beneath the focus. */
      addendum?: { label: string; text: string }
    }
  | { kind: 'caption'; text: string }
  | { kind: 'list'; title?: string; items: ListItem[]; numbered?: boolean }
  | {
      kind: 'table'
      title?: string
      columns: string[]
      rows: string[][]
      align?: ('left' | 'right')[]
      /** Relative widths, one per column. */
      widths?: number[]
      /** Rows set in bold, by index. */
      emphasis?: number[]
      /** Rows that sum what stands above them: bold, with a rule above. */
      totals?: number[]
      /** A tone per row, applied to the column `toneColumn` names. */
      rowTones?: (Tone | undefined)[]
      toneColumn?: number
      footnote?: string
    }
  | {
      kind: 'chart'
      title: string
      chart: ChartKind
      categories: string[]
      series: ChartSeries[]
      unit: string
      asOf: string
      source: string
      note?: string
      /** The donut's centre: the whole the shares add up to. */
      centre?: string
    }
  | {
      kind: 'timeline'
      title: string
      /** ISO date the timeline starts from — today. */
      from: string
      items: TimelineItem[]
      asOf: string
      source: string
      note?: string
    }
  | {
      kind: 'callout'
      title: string
      text: string
      detail?: string
      tone: Tone
      /** Set small, in the body face: a reminder, not a statement. */
      compact?: boolean
    }
  | { kind: 'callouts'; items: CalloutItem[] }
  | { kind: 'meta'; items: MetaItem[] }
  | { kind: 'columns'; columns: PackBlock[][]; weights?: number[] }
  | { kind: 'changes'; title?: string; rows: ChangeRow[] }
  | { kind: 'actions'; rows: ActionRow[] }

export type NoteKind =
  | 'talking-point'
  | 'why-it-matters'
  | 'watch-out'
  | 'do-not-claim'
  | 'verify'
  | 'follow-up'
  | 'evidence'
  | 'source'

export interface NoteLine {
  kind: NoteKind
  text: string
}

export interface PackSlide {
  kind: PackSlideKind
  archetype: SlideArchetype
  section: 'core' | 'appendix'
  /** The small caps line above the headline: the slide's role. */
  kicker: string
  /** The conclusion, never the topic. */
  headline: string
  blocks: PackBlock[]
  /** Internal; a renderer keeps them off the slide body. */
  notes: NoteLine[]
  sourceIds: string[]
}

export interface PackProvenance {
  portfolioValuedAt: string | null
  oldestValuationAt: string | null
  marketDataAsOf: string | null
  baselineMeetingDate: string | null
  sourceCount: number
}

export interface PackDocument {
  audience: 'INTERNAL_ADVISOR'
  depth: MeetingPackDepth
  language: 'sv'
  title: string
  client: string
  advisor: string | null
  office: string | null
  meetingLabel: string
  meetingDate: string | null
  dataAsOf: string
  generatedAt: string
  provenance: PackProvenance
  confidentiality: string
  internalMark: string
  slides: PackSlide[]
  coreCount: number
  appendixCount: number
  /** `Anna_Per_Dahlqvist_Motesunderlag_2026-10-02`; the store adds the version and the extension. */
  fileBaseName: string
}

/* ----------------------------------------------------------------- palette */

/** Financial OS translated into presentation colour, hex without '#'. */
export const DOCUMENT_PALETTE = Object.freeze({
  navy: '0B1220',
  ink: '070C14',
  panel: '101826',
  line: '26344A',
  lineSoft: '1A2535',
  ivory: 'F4EFE6',
  gold: 'D9A441',
  goldDeep: 'B58A2E',
  goldSoft: '2A1F0D',
  blueGrey: '8A97A8',
  steel: '5B7DB1',
  muted: 'B8C0CC',
  positive: '2E9E6B',
  negative: 'C9463D',
  /* The print palette: paper, ink and a darker gold that holds contrast on white. */
  paper: 'FFFFFF',
  paperTint: 'F6F1E6',
  paperGrey: 'EEF1F5',
  paperWarning: 'FBEAE8',
  inkText: '1C2430',
  inkMuted: '5B6675',
})

export const ASSET_CLASS_DOC_COLOR: Record<AssetClass, string> = {
  equities: 'D9A441',
  'fixed-income': '5B7DB1',
  alternatives: '8A6FB5',
  cash: '3FA57A',
}

export const ASSET_KIND_DOC_COLOR: Record<AssetKind, string> = {
  property: 'D9A441',
  'investment-portfolio': '5B7DB1',
  pension: '3FA57A',
  cash: '58B3C9',
  'company-ownership': '8A6FB5',
  'other-financial': '8A97A8',
  other: '6B7382',
}

/** The series colours for a previous-against-current comparison. */
export const COMPARISON_DOC_COLOR = Object.freeze({
  before: '8A97A8',
  after: 'D9A441',
})
