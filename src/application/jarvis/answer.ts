/**
 * What JARVIS answers about the relationship record: a structured answer,
 * never a wall of text.
 *
 * Every item is typed with the record it rests on, so the surface can
 * render it in the product's own words and the reader can open the
 * evidence behind it. Facts, assessments and suggestions are told apart
 * on the item, never blended: a stored client fact is a fact; what the
 * rules make of it is an assessment; what to do about it is a suggestion.
 * Nothing here is a sentence nobody wrote — the record's own words, or a
 * typed item the presentation phrases.
 */

import type {
  AdvisorQuestion,
  AgendaItem,
  ClientQuestion,
  Commitment,
  ContextFact,
  DataQualityItem,
  FinancingItem,
  FocusTopic,
  Goal,
  ImportantEvent,
  Interaction,
  Liability,
  MarketContextItem,
  MarketEvent,
  MeetingChange,
  MeetingFocus,
  MemoryHit,
  ObjectiveItem,
  Opportunity,
  OpportunityToExplore,
  PromiseView,
  RelationshipHealth,
  RiskItem,
  SentinelDriver,
  Signal,
  StrategyObservation,
} from '~/domain/advisory'
import type { ClientDirectoryRow } from '~/application/advisory/clientDirectory'
import type { AffectedClient } from '~/application/advisory/marketImpact'
import type { MarketEpisode } from '~/application/advisory/marketEpisodes'
import type {
  MeetingPackDepth,
  PackReadiness,
  ReadinessReason,
} from '~/application/advisory/meetingPack'
import type { SentinelEntry } from '~/application/advisory/sentinel'
import type { RecordSource, SourceType } from '~/application/advisory/sources'
import type { JarvisScope } from './context'

export type { SourceType }

/* ---------------------------------------------------------------- intents */

export type AdvisoryIntentKind =
  | 'CLIENT_SUMMARY'
  | 'LAST_INTERACTION'
  | 'OPEN_COMMITMENTS'
  | 'MEETING_PREP'
  | 'CHANGES_SINCE_LAST_MEETING'
  | 'WHY_PRIORITY'
  | 'MARKET_RELEVANCE'
  | 'FINANCING'
  | 'GOALS'
  | 'OPPORTUNITIES'
  | 'RISKS'
  | 'QUESTIONS_TO_ASK'
  | 'CLIENT_QUESTIONS'
  | 'KEY_FIGURES'
  | 'OFFICE_PRIORITIES'
  | 'OFFICE_MEETINGS'
  | 'OFFICE_OVERDUE'
  | 'OFFICE_OPPORTUNITIES'
  | 'DIRECTORY_CALL_TODAY'
  | 'DIRECTORY_MEETINGS'
  | 'DIRECTORY_OVERDUE'
  | 'DIRECTORY_EXTERNAL_ASSETS'
  | 'SENTINEL_TODAY'
  | 'MARKET_IMPACT_CLIENTS'
  | 'GENERAL_CLIENT_QUERY'
  /** The Meeting Pack: prepare, in a depth or a format, or refresh against the record. */
  | 'MEETING_PACK_FULL'
  | 'MEETING_PACK_EXECUTIVE'
  | 'MEETING_PACK_PPTX'
  | 'MEETING_PACK_PDF'
  | 'MEETING_PACK_UPDATE'

/* ------------------------------------------------------------------ about */

export type JarvisAboutKind =
  'client' | 'meeting' | 'office' | 'directory' | 'sentinel' | 'market-impact'

/** What the answer is about — the screen's subject, or the client the line named. */
export interface JarvisAbout {
  kind: JarvisAboutKind
  id: string | null
  /** The subject's own name: a client's, an office's. */
  label: string
  /** Where the subject lives, so the answer can offer the door. */
  href: string | null
  /** True when the line named a client other than the screen's; the route is never changed for it. */
  switched: boolean
  /** ISO date of the meeting the answer is about, when it is, and the event's id. */
  meetingDate?: string
  meetingId?: string
}

/* ------------------------------------------------------------------ items */

export type ItemNature = 'fact' | 'assessment' | 'suggestion'

export type FigureKind =
  | 'total-wealth'
  | 'aum'
  | 'external-assets'
  | 'debt'
  | 'net-worth'
  | 'liquidity'
  | 'property-share'
  | 'portfolio-value'
  | 'portfolio-ytd'
  | 'opportunity-value'

/** Why a client row is in an answer. */
export type RowReason =
  | 'needs-attention'
  | 'meeting-soon'
  | 'overdue-commitment'
  | 'opportunity'
  | 'external-assets'

/** What an empty answer says, typed so the words are the presentation's. */
export type NoteKind =
  | 'no-upcoming-meeting'
  | 'no-recorded-contact'
  | 'no-open-commitments'
  | 'few-changes'
  | 'no-baseline'
  | 'no-market-moves'
  | 'nothing-documented'
  | 'no-priority'
  | 'no-loans'
  | 'no-goals'
  | 'no-opportunities'
  | 'no-risks'
  | 'no-questions'
  | 'nobody-needs-attention'
  | 'no-meetings-soon'
  | 'no-overdue'
  | 'no-external-assets'
  | 'no-affected-clients'
  | 'not-answerable-here'

interface Grounded {
  nature: ItemNature
  /** The record ids the item rests on; every one is listed among the answer's sources. */
  sourceIds: readonly string[]
}

export type JarvisItem =
  | (Grounded & { kind: 'note'; note: NoteKind })
  /** The record's own words: a title, a statement, a key point. */
  | (Grounded & { kind: 'record-text'; text: string; date?: string })
  | (Grounded & { kind: 'focus'; focus: MeetingFocus })
  | (Grounded & { kind: 'focus-topic'; topic: FocusTopic })
  | (Grounded & { kind: 'change'; change: MeetingChange })
  | (Grounded & { kind: 'promise'; view: PromiseView })
  | (Grounded & {
      kind: 'commitment'
      commitment: Commitment
      overdue: boolean
      daysToDue: number | null
    })
  | (Grounded & { kind: 'interaction'; interaction: Interaction })
  | (Grounded & { kind: 'context-fact'; fact: ContextFact })
  | (Grounded & {
      kind: 'event'
      event: ImportantEvent
      occursOn: string
      daysAhead: number
    })
  | (Grounded & {
      kind: 'liability'
      liability: Liability
      daysToMaturity: number | null
    })
  | (Grounded & { kind: 'signal'; signal: Signal })
  | (Grounded & { kind: 'sentinel-entry'; entry: SentinelEntry })
  | (Grounded & { kind: 'sentinel-driver'; driver: SentinelDriver })
  | (Grounded & { kind: 'market'; item: MarketContextItem })
  | (Grounded & { kind: 'client-question'; question: ClientQuestion })
  | (Grounded & { kind: 'advisor-question'; question: AdvisorQuestion })
  | (Grounded & { kind: 'opportunity'; opportunity: OpportunityToExplore })
  | (Grounded & { kind: 'opportunity-record'; opportunity: Opportunity })
  | (Grounded & { kind: 'risk'; risk: RiskItem })
  | (Grounded & { kind: 'data-quality'; item: DataQualityItem })
  | (Grounded & { kind: 'objective'; objective: ObjectiveItem })
  | (Grounded & { kind: 'agenda'; item: AgendaItem; position: number })
  | (Grounded & {
      kind: 'figure'
      figure: FigureKind
      amount: number
      percent?: number
      asOf?: string
    })
  | (Grounded & {
      kind: 'health'
      health: RelationshipHealth
      daysSinceContact: number | null
    })
  | (Grounded & { kind: 'goal'; goal: Goal })
  | (Grounded & { kind: 'strategy-observation'; observation: StrategyObservation })
  | (Grounded & { kind: 'financing'; item: FinancingItem })
  | (Grounded & { kind: 'client-row'; row: ClientDirectoryRow; because: RowReason })
  | (Grounded & { kind: 'episode'; episode: MarketEpisode })
  | (Grounded & { kind: 'affected-client'; affected: AffectedClient; event: MarketEvent })
  | (Grounded & { kind: 'memory-hit'; hit: MemoryHit })
  | (Grounded & { kind: 'pack-readiness'; readiness: PackReadiness })
  | (Grounded & { kind: 'readiness-reason'; reason: ReadinessReason })
  | (Grounded & {
      kind: 'pack-outline'
      depth: MeetingPackDepth
      core: number
      appendix: number
      meetingDate: string | null
    })

export type SectionKey =
  | 'focus'
  | 'bring-up'
  | 'since-last'
  | 'promises'
  | 'completed'
  | 'questions-to-ask'
  | 'client-may-ask'
  | 'dont-forget'
  | 'data-quality'
  | 'discussed'
  | 'client-expressed'
  | 'next-step'
  | 'figures'
  | 'relationship'
  | 'issue'
  | 'upcoming'
  | 'concerns'
  | 'why-now'
  | 'drivers'
  | 'preparation'
  | 'market'
  | 'financing'
  | 'goals'
  | 'opportunities'
  | 'risks'
  | 'strategy'
  | 'clients'
  | 'meetings'
  | 'overdue'
  | 'episodes'
  | 'memory'
  | 'agenda'
  | 'objectives'
  | 'readiness'
  | 'contents'

export interface JarvisSection {
  key: SectionKey
  items: readonly JarvisItem[]
}

/* ---------------------------------------------------------------- sources */

/** A source is the record's own entry, as `application/advisory/sources` indexes it. */
export type JarvisSource = RecordSource

export interface JarvisAction {
  kind:
    | 'open-client'
    | 'open-meeting-prep'
    | 'open-meeting-pack'
    | 'open-office'
    | 'open-sentinel'
    | 'open-market-impact'
  href: string
}

/* ----------------------------------------------------------------- answer */

export interface JarvisAnswer {
  scope: JarvisScope
  intent: AdvisoryIntentKind
  about: JarvisAbout
  sections: readonly JarvisSection[]
  sources: readonly JarvisSource[]
  actions: readonly JarvisAction[]
  /** A door JARVIS opens itself once the answer is shown — the pack preview a "prepare the pack" line asked for. */
  opens?: string
  /** Display titles for every record id the items point at, so the presentation can name a source. */
  titles: Readonly<Record<string, string>>
  /** ISO date the derivations used. */
  today: string
  confidence: 'high' | 'medium' | 'low'
  method: 'advisory-rules-v1'
  askedAt: string
}
