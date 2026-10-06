/**
 * The relationship's lifecycle — a client joins, is onboarded, becomes
 * active, may move office or advisor, leaves, and may return; an office is
 * created, edited, archived and may be reopened. Every change is an event
 * with an effective date and an actor, kept forever: the book's history is
 * read from these, never reconstructed from the current state.
 *
 * Pure: statuses, events, the transitions the record allows, and the
 * readings a surface shows before an act (what a closure would leave open,
 * how far an onboarding has come). No clock, no store.
 */

import type { AdvisorId, Client, ClientId, OfficeId } from './client'
import type { ClientFacts } from './intelligence'

/* ------------------------------------------------------------- statuses */

export type LifecycleStatus = 'onboarding' | 'active' | 'former'

export type ClosureReason =
  | 'CLIENT_CHOICE'
  | 'COMPETITOR'
  | 'NO_LONGER_ELIGIBLE'
  | 'DECEASED_OR_ESTATE'
  | 'MOVED_OR_REASSIGNED'
  | 'OTHER'

export const CLOSURE_REASONS: readonly ClosureReason[] = [
  'CLIENT_CHOICE',
  'COMPETITOR',
  'NO_LONGER_ELIGIBLE',
  'DECEASED_OR_ESTATE',
  'MOVED_OR_REASSIGNED',
  'OTHER',
]

/** What closed the relationship, kept on the client while it is former. */
export interface ClientClosure {
  /** ISO date the relationship ended. */
  effectiveDate: string
  reason: ClosureReason
  note: string | null
}

/** The lifecycle facts a client record carries. */
export interface ClientLifecycle {
  status: LifecycleStatus
  /** ISO date the current status began. */
  since: string
  /** The closure while the client is former; null otherwise. */
  closure: ClientClosure | null
}

/* -------------------------------------------------------------- events */

export type LifecycleEventKind =
  | 'CLIENT_CREATED'
  | 'CLIENT_ACTIVATED'
  | 'CLIENT_UPDATED'
  | 'CLIENT_MOVED_OFFICE'
  | 'CLIENT_ADVISOR_CHANGED'
  | 'CLIENT_CLOSED'
  | 'CLIENT_REACTIVATED'
  | 'OFFICE_CREATED'
  | 'OFFICE_UPDATED'
  | 'OFFICE_ARCHIVED'
  | 'OFFICE_REACTIVATED'

/**
 * One change to the book. `detail` carries the facts the kind needs — the
 * offices of a move, the reason of a closure — as plain values, so the
 * event reads on its own years later.
 */
export interface LifecycleEvent {
  id: string
  subject: 'client' | 'office'
  subjectId: string
  kind: LifecycleEventKind
  /** ISO date the change takes effect. */
  effectiveDate: string
  /** ISO timestamp the change was recorded. */
  at: string
  by: AdvisorId
  detail: Readonly<Record<string, string | number | null>>
  note: string | null
}

/** One stretch of a relationship at one office; `to` is null while current. */
export interface ClientOfficeHistory {
  id: string
  clientId: ClientId
  officeId: OfficeId
  /** ISO date. */
  from: string
  /** ISO date the stretch ended, null while it is the current one. */
  to: string | null
}

/* ----------------------------------------------------------- transitions */

export type LifecycleAct = 'activate' | 'close' | 'reactivate'

const TRANSITIONS: Record<
  LifecycleStatus,
  Partial<Record<LifecycleAct, LifecycleStatus>>
> = {
  onboarding: { activate: 'active' },
  active: { close: 'former' },
  former: { reactivate: 'active' },
}

/** The status an act leads to from the current one, or null where the record does not allow it. */
export function transition(
  from: LifecycleStatus,
  act: LifecycleAct,
): LifecycleStatus | null {
  return TRANSITIONS[from][act] ?? null
}

/** Only an active relationship stands in the active book, its aggregates and Sentinel. */
export function contributesToActiveBook(client: Pick<Client, 'lifecycle'>): boolean {
  return client.lifecycle.status === 'active'
}

export function isFormer(client: Pick<Client, 'lifecycle'>): boolean {
  return client.lifecycle.status === 'former'
}

export function isOnboarding(client: Pick<Client, 'lifecycle'>): boolean {
  return client.lifecycle.status === 'onboarding'
}

/* --------------------------------------------------------- closure review */

/** What a closure would leave open, counted from the record as it stands. */
export interface ClosureReview {
  openCommitments: number
  bookedMeetings: number
  futureFinancingEvents: number
  futureImportantEvents: number
  openOpportunities: number
}

const FINANCING_EVENTS = new Set(['loan-maturity', 'mortgage-refinancing'])

export function closureReview(facts: ClientFacts): ClosureReview {
  const { today } = facts
  const future = facts.events.filter(
    (event) => event.status === 'upcoming' && event.date >= today,
  )
  return {
    openCommitments: facts.commitments.filter((c) => c.status === 'open').length,
    bookedMeetings: future.filter((event) => event.type === 'client-meeting').length,
    futureFinancingEvents: future.filter((event) => FINANCING_EVENTS.has(event.type))
      .length,
    futureImportantEvents: future.filter(
      (event) => event.type !== 'client-meeting' && !FINANCING_EVENTS.has(event.type),
    ).length,
    openOpportunities: facts.opportunities.filter(
      (o) => o.status !== 'won' && o.status !== 'lost',
    ).length,
  }
}

export function closureReviewIsClear(review: ClosureReview): boolean {
  return Object.values(review).every((count) => count === 0)
}

/* ------------------------------------------------------------ onboarding */

export type OnboardingArea =
  | 'financial-overview'
  | 'risk-profile'
  | 'portfolio'
  | 'loans'
  | 'goals'
  | 'family-context'
  | 'first-review'

export const ONBOARDING_AREAS: readonly OnboardingArea[] = [
  'financial-overview',
  'risk-profile',
  'portfolio',
  'loans',
  'goals',
  'family-context',
  'first-review',
]

export interface OnboardingOverview {
  /** Every area, with whether the record holds something for it. */
  areas: readonly { area: OnboardingArea; known: boolean }[]
  known: number
  total: number
}

/**
 * How far an onboarding has come: counted from what the record holds, never
 * a percentage. "Loans" is known once a liability is recorded or the client
 * states there are none (a context fact in the `business` or `preference`
 * category saying so is the advisor's call; here, a liability or an asset
 * with the bank counts).
 */
export function onboardingOverview(
  facts: ClientFacts,
  household: { members: readonly unknown[] } | null,
): OnboardingOverview {
  const hasMeeting = facts.interactions.some((i) => i.type === 'meeting')
  const areas: readonly { area: OnboardingArea; known: boolean }[] = [
    { area: 'financial-overview', known: facts.balanceSheet.totalAssets > 0 },
    {
      area: 'risk-profile',
      known: facts.portfolio !== null && facts.portfolio.allocation.length > 0,
    },
    { area: 'portfolio', known: facts.portfolio !== null },
    { area: 'loans', known: facts.liabilities.length > 0 },
    { area: 'goals', known: facts.goals.length > 0 },
    { area: 'family-context', known: (household?.members.length ?? 0) > 1 },
    { area: 'first-review', known: hasMeeting },
  ]
  return {
    areas,
    known: areas.filter((a) => a.known).length,
    total: areas.length,
  }
}

/* ------------------------------------------------------------ duplicates */

/** A name reduced to what a person would call the same: case, diacritics, punctuation and spacing ignored. */
export function normalisedName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Relationships whose name is the same as, or contains, the one being added — a warning, never a block. */
export function similarClients<T extends Pick<Client, 'displayName'>>(
  displayName: string,
  clients: readonly T[],
): readonly T[] {
  const wanted = normalisedName(displayName)
  if (wanted.length < 3) return []
  return clients.filter((client) => {
    const have = normalisedName(client.displayName)
    return have === wanted || have.includes(wanted) || wanted.includes(have)
  })
}
