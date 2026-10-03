/**
 * The Meeting Pack's own words: readiness, depth, formats, note labels and
 * file names — the small vocabulary the preview, JARVIS and the documents
 * share. Everything about the record itself is phrased by the cockpit's
 * text functions, once.
 */

import type {
  MeetingPackDepth,
  NextStepOwner,
  NextStepStatus,
  PackReadiness,
  ReadinessReason,
  ReadinessState,
} from '~/application/advisory/meetingPack'
import { formatLongDate } from '~/presentation/advisory/format'
import type { CalloutKind, NoteKind } from './packDocument'

export const READINESS_LABEL: Record<ReadinessState, string> = {
  REDO: 'Redo',
  GRANSKA: 'Granska',
  BLOCKERAD: 'Blockerad',
}

export const DEPTH_LABEL: Record<MeetingPackDepth, string> = {
  executive: 'Executive brief',
  full: 'Fullt mötesunderlag',
}

export const FORMAT_LABEL = {
  pptx: 'PowerPoint',
  pdf: 'PDF',
} as const

export const OWNER_LABEL: Record<NextStepOwner, string> = {
  advisor: 'Rådgivare',
  client: 'Klient',
  both: 'Gemensamt',
}

export const STEP_STATUS_LABEL: Record<NextStepStatus, string> = {
  open: 'Öppen',
  overdue: 'Försenad',
  proposed: 'Föreslagen',
}

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  'talking-point': 'TALEPUNKT',
  'why-it-matters': 'VARFÖR DET SPELAR ROLL',
  'watch-out': 'VARNING',
  'do-not-claim': 'PÅSTÅ INTE',
  verify: 'ATT VERIFIERA',
  'follow-up': 'FÖLJDFRÅGA',
  evidence: 'UNDERLAG',
  source: 'KÄLLA',
}

/** The order a slide's notes are read in: the point, why, what to mind, what to check, what comes next, the basis. */
export const NOTE_ORDER: readonly NoteKind[] = [
  'talking-point',
  'why-it-matters',
  'watch-out',
  'do-not-claim',
  'verify',
  'follow-up',
  'evidence',
  'source',
]

/** The margin notes an analyst writes beside a page. */
export const CALLOUT_LABEL: Record<CalloutKind, string> = {
  observation: 'JARVIS-observation',
  implication: 'Mötesimplikation',
  'why-it-matters': 'Varför det spelar roll',
  'watch-out': 'Varning',
  verify: 'Data att verifiera',
}

export const CONFIDENTIALITY = 'KONFIDENTIELLT · INTERNT RÅDGIVARMATERIAL'
export const INTERNAL_MARK = 'INTERNT'
export const DATA_MISSING = 'DATA SAKNAS'
export const NO_MARKET_MOVES =
  'Inga väsentliga klientrelevanta marknadsförändringar sedan senaste mötet.'

/** One reason to review, as a sentence with its date. */
export function readinessReasonText(reason: ReadinessReason): string {
  const date = reason.date ? formatLongDate(reason.date) : ''
  switch (reason.kind) {
    case 'stale-valuation':
      return `${reason.label ?? 'En värdering'} är ${reason.daysOld ?? ''} dagar gammal (${date}).`
    case 'external-not-updated':
      return `${reason.label ?? 'En extern tillgång'} är inte uppdaterad sedan ${date}.`
    case 'portfolio-stale':
      return `Portföljen värderades senast ${date}.`
    case 'no-portfolio':
      return 'Ingen portfölj hos banken är registrerad.'
    case 'pension-unknown':
      return 'Inget aktuellt pensionsvärde är registrerat.'
    case 'loan-rate-unverified':
      return `${reason.label ?? 'Ett lån'}: räntan verifierades senast ${date}; kontrollera aktuell prissättning innan den anges.`
    case 'no-baseline':
      return 'Ingen baslinje från ett tidigare möte finns; jämförelsen bygger på vad registret daterar.'
    case 'no-scheduled-meeting':
      return 'Ingen mötestid är bokad; underlaget gäller nästa kontakt.'
    case 'no-valued-assets':
      return 'Inga värderade tillgångar finns i registret; ett underlag skulle ge en missvisande bild.'
  }
}

/** "2 datapunkter är äldre än sina gränser · 1 finansieringsuppgift saknar aktuell ränta". */
export function readinessSummary(readiness: PackReadiness): string {
  if (readiness.reasons.length === 0) return 'Underlaget kan genereras utan förbehåll.'
  const stale = readiness.reasons.filter((r) =>
    ['stale-valuation', 'external-not-updated', 'portfolio-stale'].includes(r.kind),
  ).length
  const loans = readiness.reasons.filter((r) => r.kind === 'loan-rate-unverified').length
  const missing = readiness.reasons.filter((r) =>
    ['no-portfolio', 'pension-unknown', 'no-baseline', 'no-scheduled-meeting'].includes(
      r.kind,
    ),
  ).length
  const blocked = readiness.reasons.filter((r) => r.severity === 'block').length
  const parts = [
    stale > 0
      ? `${stale} ${stale === 1 ? 'datapunkt' : 'datapunkter'} bör verifieras`
      : null,
    loans > 0
      ? `${loans} ${loans === 1 ? 'finansieringsuppgift' : 'finansieringsuppgifter'} saknar aktuell ränta`
      : null,
    missing > 0 ? `${missing} ${missing === 1 ? 'uppgift' : 'uppgifter'} saknas` : null,
    blocked > 0 ? 'registret kan inte bära ett underlag' : null,
  ].filter((p): p is string => p !== null)
  return parts.join(' · ')
}

/**
 * `Anna_Per_Dahlqvist_Motesunderlag_2026-10-02`: the client's name in ASCII,
 * the document's kind, the meeting date (or the data date without a
 * booked meeting). No id, no diacritics, no characters a file system
 * refuses. The store appends `_v1` and the extension.
 */
export function fileBaseNameOf(
  clientName: string,
  depth: MeetingPackDepth,
  isoDate: string,
): string {
  const ascii = clientName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[Øø]/g, 'o')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  const kind = depth === 'executive' ? 'Executive_brief' : 'Motesunderlag'
  return `${ascii || 'Klient'}_${kind}_${isoDate}`
}
