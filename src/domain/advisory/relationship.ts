/**
 * The relationship's memory: what happened, what the client said, what the
 * advisor promised, what is coming up.
 *
 * Every structured item that came out of an advisor's note keeps its
 * provenance — which note, when, who, how confident, and whether the
 * advisor confirmed it. The original note is never destroyed: an
 * interaction carries the advisor's text as written, beneath whatever
 * structure was drawn from it. Nothing here is generated prose: titles are
 * short structured statements the advisor confirmed, and the free text is
 * the advisor's own.
 */

import type { AdvisorId, ClientId } from './client'

/* ------------------------------------------------------------ provenance */

export type FactOrigin =
  /** Recorded directly by the advisor. */
  | 'advisor'
  /** Drawn from an advisor's note by JARVIS and confirmed by the advisor. */
  | 'jarvis-extraction'
  /** Imported with the client record (Phase 1: the synthetic seed). */
  | 'seed'

export type Confidence = 'high' | 'medium' | 'low'

export interface Provenance {
  origin: FactOrigin
  /** The interaction whose note the item came from, where one did. */
  sourceInteractionId: string | null
  /** The exact words of the note the item rests on, where it came from one. */
  sourceText: string | null
  /** ISO date of the source — the interaction's date, or the record's. */
  sourceDate: string
  /** ISO timestamp the item was created. */
  createdAt: string
  createdBy: AdvisorId
  confidence: Confidence
  confirmedByAdvisor: boolean
  /** ISO timestamp of the confirmation, where confirmed. */
  confirmedAt: string | null
}

/* ----------------------------------------------------------- interactions */

export type InteractionType =
  | 'meeting'
  | 'phone'
  | 'email'
  | 'teams'
  | 'internal-note'
  | 'portfolio-discussion'
  | 'financing-discussion'
  | 'portfolio-change'
  | 'credit-decision'
  | 'investment-proposal'
  | 'deposit'
  | 'withdrawal'
  | 'complaint'
  | 'follow-up'
  | 'family-event'
  | 'financial-event'
  | 'other'

export type InteractionSource = 'advisor' | 'client' | 'system'
export type Importance = 'low' | 'normal' | 'high'

export type DiscussionTopic =
  | 'portfolio-performance'
  | 'allocation'
  | 'energy-exposure'
  | 'financing'
  | 'investment-alternatives'
  | 'fees'
  | 'pension'
  | 'property'
  | 'liquidity'
  | 'risk'
  | 'market-volatility'
  | 'family'
  | 'company'
  | 'tax'
  | 'insurance'
  | 'succession'

export interface Interaction {
  id: string
  clientId: ClientId
  type: InteractionType
  /** ISO date the interaction happened. */
  date: string
  advisorId: AdvisorId
  source: InteractionSource
  importance: Importance
  /** A short structured title the advisor confirmed. */
  title: string
  /** The advisor's note, exactly as written. Never rewritten. */
  noteText: string
  topics: readonly DiscussionTopic[]
  /** Structured points drawn from the note and confirmed, in the advisor's words. */
  keyPoints: readonly string[]
  /** Amount, where the interaction was a deposit or withdrawal. */
  amount?: number
  provenance: Provenance
}

/* ------------------------------------------------------- client context */

export type ContextCategory =
  | 'preference'
  | 'concern'
  | 'objective'
  | 'family'
  | 'business'
  | 'communication'
  | 'behaviour'

export type ContextStatus = 'active' | 'resolved' | 'superseded'

/** One thing the firm knows about the client, as a dated, sourced statement. */
export interface ContextFact {
  id: string
  clientId: ClientId
  category: ContextCategory
  statement: string
  status: ContextStatus
  /** ISO date the status last changed. */
  statusAt: string
  provenance: Provenance
}

/* ------------------------------------------------------------ commitments */

export type CommitmentStatus = 'open' | 'done' | 'cancelled'
export type CommitmentPriority = 'low' | 'medium' | 'high'

/** Something the advisor promised the client. The advisor never forgets one. */
export interface Commitment {
  id: string
  clientId: ClientId
  title: string
  /** ISO date the promise was made. */
  createdAt: string
  /** ISO date it is due, where a date was given. */
  dueDate: string | null
  status: CommitmentStatus
  priority: CommitmentPriority
  ownerAdvisorId: AdvisorId
  /** ISO date it was completed, where it was. */
  completedAt: string | null
  provenance: Provenance
}

/* -------------------------------------------------------- important events */

export type EventType =
  | 'birthday'
  | 'loan-maturity'
  | 'mortgage-refinancing'
  | 'investment-maturity'
  | 'pension-event'
  | 'company-sale'
  | 'property-purchase'
  | 'property-completion'
  | 'tax-deadline'
  | 'planned-withdrawal'
  | 'liquidity-event'
  | 'client-meeting'
  | 'annual-review'
  | 'family-event'
  | 'insurance-review'
  | 'custom'

export type EventStatus = 'upcoming' | 'done' | 'cancelled'

export interface ReminderRule {
  daysBefore: number
}

export interface ImportantEvent {
  id: string
  clientId: ClientId
  type: EventType
  title: string
  /** ISO date of the event; for a recurring event, the next occurrence is derived. */
  date: string
  recurring: 'none' | 'yearly'
  importance: Importance
  /** The advisor's words about the event, where any. */
  notes: string
  reminderRules: readonly ReminderRule[]
  status: EventStatus
  /** The liability the event concerns, where it does (a maturity, a refinancing). */
  liabilityId?: string
  provenance: Provenance
}

/** A reminder derived from an event's rules: never stored, always derived. */
export interface Reminder {
  eventId: string
  /** ISO date the reminder falls on. */
  remindAt: string
  daysBefore: number
}

/* ---------------------------------------------------------- opportunities */

export type OpportunityType =
  | 'investment'
  | 'financing'
  | 'external-asset-transfer'
  | 'pension'
  | 'insurance'
  | 'company-sale-proceeds'
  | 'liquidity-deployment'
  | 'property-financing'
  | 'family-wealth'
  | 'next-generation'
  | 'other'

export type OpportunityStatus =
  'identified' | 'in-discussion' | 'proposed' | 'won' | 'lost'

export interface Opportunity {
  id: string
  clientId: ClientId
  type: OpportunityType
  title: string
  potentialValue: number
  /** Probability of winning, percent. */
  probabilityPercent: number
  status: OpportunityStatus
  /** The facts the opportunity rests on, in the advisor's words. */
  basis: string
  nextAction: string
  ownerAdvisorId: AdvisorId
  /** ISO date. */
  expectedDate: string | null
  provenance: Provenance
}

/* ------------------------------------------------------- memory candidate */

export type ExtractedItemKind =
  | 'interaction'
  | 'concern'
  | 'preference'
  | 'objective'
  | 'family'
  | 'business'
  | 'important-event'
  | 'next-meeting'
  | 'commitment'
  | 'discussion-topics'
  | 'key-point'
  /** An open promise the note says was kept, and an active concern the note says has eased: the record moves, nothing is added. */
  | 'commitment-completed'
  | 'concern-eased'

/** One thing JARVIS understood from a note, awaiting the advisor's word. */
export interface ExtractedItem {
  id: string
  kind: ExtractedItemKind
  /** The structured statement JARVIS proposes. */
  title: string
  /** The words in the note it rests on. */
  sourceText: string
  confidence: Confidence
  /** ISO date, where the item carries one (an event, a due date, a meeting). */
  date: string | null
  interactionType?: InteractionType
  eventType?: EventType
  topics?: readonly DiscussionTopic[]
  contextCategory?: ContextCategory
  priority?: CommitmentPriority
  /** The open commitment a `commitment-completed` item would close. */
  commitmentId?: string
  /** The active concern a `concern-eased` item would resolve. */
  contextFactId?: string
}

export type CandidateStatus = 'pending' | 'confirmed' | 'discarded'

/**
 * The advisor's note plus what JARVIS understood, before any of it is a
 * fact. Only confirmed items ever reach the client model.
 */
export interface MemoryCandidate {
  id: string
  clientId: ClientId
  advisorId: AdvisorId
  /** The note, exactly as written. */
  noteText: string
  /** ISO date the interaction happened. */
  interactionDate: string
  interactionType: InteractionType
  source: InteractionSource
  importance: Importance
  items: readonly ExtractedItem[]
  status: CandidateStatus
  /** ISO timestamp. */
  createdAt: string
  /** ISO timestamp, where confirmed or discarded. */
  resolvedAt: string | null
  /** The interaction the confirmation created, where it did. */
  interactionId: string | null
}
