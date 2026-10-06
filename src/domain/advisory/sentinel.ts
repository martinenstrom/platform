/**
 * Sentinel — which clients need the advisor's attention, why now, and what to
 * prepare. Deterministic, rule-based, and read from the same facts Client
 * Intelligence already derives; nothing here is stored.
 *
 * ## One priority per client
 *
 * A notification centre lists every fact. Sentinel names the one thing the
 * advisor should do for a client and folds every related fact into it as a
 * driver: Henrik's meeting in ten days, his refinancing in fifty-three and
 * the comparison he was promised become *prepare the financing discussion
 * before the meeting*, with three drivers — not three items. The anchor is
 * chosen by precedence (a broken promise before a meeting before an event
 * before a silence before an opportunity); everything else the client's
 * record says becomes evidence beneath it.
 *
 * ## Severity, not precision
 *
 * The advisor sees four bands — kritisk, hög, normal, låg — and a horizon:
 * today, upcoming, watch. A numeric score exists only to order the queue and
 * is never shown. Every band, threshold and weight is stated once below so
 * the explanation can quote it.
 *
 * ## Resolution is derived
 *
 * A completed promise, a passed meeting, a fresh interaction or a portfolio
 * back within its mandate simply stop producing drivers; the priority
 * disappears because the facts did, not because someone closed it. What the
 * advisor decides about a priority — reviewed, snoozed, dismissed — is a
 * disposition bound to the priority's fingerprint, so a dismissal lapses
 * the moment the facts behind the priority change.
 */

import type { AdvisorId, ClientId } from './client'
import { daysBetween } from './dates'
import {
  daysSinceContact,
  lastContact,
  nextMeeting,
  openCommitments,
  openConcerns,
  overdueCommitments,
  relationshipHealth,
  signalsFor,
  upcomingEvents,
  type ClientFacts,
  type HealthBand,
  type HealthDriverKind,
  type RelationshipHealth,
  type Signal,
} from './intelligence'
import type {
  ClientMarketImpact,
  Directness,
  MarketCategory,
  MarketSeverity,
  Relevance,
} from './marketToClient'
import type { AssetClass } from './portfolio'
import type {
  DiscussionTopic,
  EventType,
  OpportunityStatus,
  OpportunityType,
} from './relationship'

/* ------------------------------------------------------------- thresholds */

/** Every day-count Sentinel reasons with, stated once. */
export const SENTINEL_THRESHOLDS = Object.freeze({
  /** A meeting today or tomorrow is imminent. */
  meetingImminentDays: 1,
  /** A meeting within this many days is prepared for. */
  meetingPreparationDays: 14,
  /** A meeting within this many days, with something to prepare, is today's work. */
  meetingActNowDays: 7,
  /** A promise due within this many days is due soon. */
  commitmentDueSoonDays: 7,
  /** A material event within this many days is urgent. */
  eventUrgentDays: 14,
  /** … within this many days is upcoming. */
  eventUpcomingDays: 30,
  /** … within this many days is watched. */
  eventWatchDays: 90,
  /** Silence thresholds: watch, contact due, relationship at risk. */
  silenceWatchDays: 30,
  silenceContactDays: 60,
  silenceRiskDays: 90,
  /** A birthday within this many days is a relationship prompt. */
  birthdayDays: 7,
  /** A concern recorded within this many days is recent. */
  concernRecentDays: 30,
  /** A valuation older than this, before a review, is stale. */
  staleValuationDays: 180,
  /** A review or meeting within this many days makes staleness relevant. */
  staleValuationHorizonDays: 30,
  /** An opportunity expected within this many days is timely on its own. */
  opportunityTimingDays: 60,
  /** No interaction with this topic within this many days means "not discussed". */
  discussedWithinDays: 60,
})

/** Event types whose approach is financially material, as opposed to a review or a family date. */
export const MATERIAL_EVENT_TYPES: readonly EventType[] = [
  'loan-maturity',
  'mortgage-refinancing',
  'investment-maturity',
  'company-sale',
  'liquidity-event',
  'pension-event',
  'property-completion',
  'property-purchase',
  'planned-withdrawal',
  'tax-deadline',
]

/* ---------------------------------------------------------------- shapes */

export type SentinelTheme =
  | 'overdue-commitment'
  | 'commitment-due'
  | 'meeting-imminent'
  | 'meeting-preparation'
  | 'event-approaching'
  | 'relationship-risk'
  | 'contact-silence'
  | 'concern'
  | 'portfolio'
  | 'birthday'
  | 'stale-valuation'
  | 'opportunity'
  /** A material market move the client's record is highly exposed to, when nothing else calls. */
  | 'market-impact'

export type SentinelSeverity = 'critical' | 'high' | 'normal' | 'low'
export type SentinelHorizon = 'today' | 'upcoming' | 'watch'

/** A fact the priority rests on, typed with the numbers it carries and the record it points at. */
export type SentinelDriver =
  | {
      kind: 'overdue-commitment'
      commitmentId: string
      title: string
      dueDate: string
      daysOverdue: number
    }
  | {
      kind: 'commitment-due'
      commitmentId: string
      title: string
      dueDate: string
      daysAhead: number
    }
  | {
      kind: 'open-commitment'
      commitmentId: string
      title: string
      dueDate: string | null
    }
  | { kind: 'meeting'; eventId: string; title: string; date: string; daysAhead: number }
  | {
      kind: 'event'
      eventId: string
      eventType: EventType
      title: string
      date: string
      daysAhead: number
      material: boolean
      liabilityId: string | null
      amount: number | null
    }
  | {
      kind: 'concern'
      contextFactId: string
      statement: string
      sourceDate: string
      daysOld: number
    }
  | {
      kind: 'silence'
      days: number
      lastInteractionId: string | null
      lastDate: string | null
    }
  | {
      kind: 'health'
      score: number
      band: HealthBand
      negativeDrivers: readonly HealthDriverKind[]
    }
  | {
      kind: 'allocation-drift'
      assetClass: AssetClass
      deviationPoints: number
      strategicPercent: number
      currentPercent: number
    }
  | { kind: 'excess-cash'; amount: number; sharePercent: number }
  | {
      kind: 'opportunity'
      opportunityId: string
      title: string
      type: OpportunityType
      status: OpportunityStatus
      potentialValue: number
      expectedDate: string | null
    }
  | {
      kind: 'stale-valuation'
      valuedAt: string
      daysOld: number
      reviewEventId: string | null
    }
  | {
      kind: 'birthday'
      eventId: string
      date: string
      daysAhead: number
      turning: number | null
    }
  | { kind: 'large-withdrawal'; interactionId: string; amount: number; date: string }
  | { kind: 'complaint'; interactionId: string; date: string }
  /** An approaching matter the record shows no recent conversation about. */
  | { kind: 'undiscussed'; topic: DiscussionTopic; sinceDays: number | null }
  /**
   * A material market move the client's record is exposed to, or has context
   * for — Market-to-Client's verdict, carried as evidence. Only medium and
   * high relevance reach Sentinel; low relevance stays on the client page.
   */
  | {
      kind: 'market'
      eventId: string
      impactId: string
      category: MarketCategory
      symbol: string
      label: string
      change: number
      changeUnit: 'bp' | 'percent' | 'points'
      direction: 'up' | 'down'
      eventSeverity: MarketSeverity
      relevance: Relevance
      directness: Directness
      /** The record ids the impact rests on: holdings, loans, facts, events. */
      sourceIds: readonly string[]
    }

export interface SentinelPriority {
  /** Stable while the theme persists: `${clientId}:${theme}`. */
  id: string
  clientId: ClientId
  theme: SentinelTheme
  severity: SentinelSeverity
  horizon: SentinelHorizon
  /** Ordering only. Never shown. */
  score: number
  /** The driver the priority is named after; always `drivers[0]`. */
  primary: SentinelDriver
  drivers: readonly SentinelDriver[]
  /** ISO date the priority is about, where it has one. */
  dueAt: string | null
  /** Every record id the priority rests on, sorted. */
  sourceIds: readonly string[]
  /** True when a high-relevance market impact lifted a normal priority to high. */
  strengthenedByMarket: boolean
  /** Changes when the facts change; a dismissal is bound to it. */
  fingerprint: string
  /** ISO date the priority was derived for. */
  assessedAt: string
  method: 'sentinel-v1'
}

export type DispositionStatus = 'reviewed' | 'snoozed' | 'dismissed'

/** What the advisor decided about a priority. Stored; the only state Sentinel keeps. */
export interface SentinelDisposition {
  priorityId: string
  clientId: ClientId
  status: DispositionStatus
  /** The priority's fingerprint when the decision was made. */
  fingerprint: string
  /** ISO timestamp. */
  at: string
  by: AdvisorId
  /** ISO date a snooze ends. */
  until: string | null
  reason: string | null
}

export type PriorityStatus = 'active' | 'reviewed' | 'snoozed' | 'dismissed'

/* --------------------------------------------------------------- weights */

const SEVERITY_BASE: Record<SentinelSeverity, number> = {
  critical: 400,
  high: 300,
  normal: 200,
  low: 100,
}

const SEVERITY_RANK: Record<SentinelSeverity, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}
const HORIZON_RANK: Record<SentinelHorizon, number> = { today: 0, upcoming: 1, watch: 2 }

/** How much a driver adds to the score, and how early it is listed. */
function driverWeight(driver: SentinelDriver): number {
  switch (driver.kind) {
    case 'overdue-commitment':
      return 25
    case 'commitment-due':
      return 15
    case 'complaint':
      return 12
    case 'meeting':
      return 12
    case 'concern':
      return driver.daysOld <= SENTINEL_THRESHOLDS.concernRecentDays ? 12 : 8
    case 'event':
      return driver.material ? 10 : 4
    case 'market':
      return driver.relevance === 'high' ? 12 : 6
    case 'health':
      return driver.band === 'at-risk' ? 15 : driver.band === 'watch' ? 6 : 0
    case 'silence':
      return driver.days >= SENTINEL_THRESHOLDS.silenceRiskDays
        ? 15
        : driver.days >= SENTINEL_THRESHOLDS.silenceContactDays
          ? 8
          : 3
    case 'large-withdrawal':
      return 8
    case 'allocation-drift':
      return 6
    case 'excess-cash':
      return 6
    case 'undiscussed':
      return 5
    case 'open-commitment':
      return 4
    case 'opportunity':
      return 3
    case 'birthday':
      return 2
    case 'stale-valuation':
      return 2
  }
}

function sourceIdOf(driver: SentinelDriver): string | null {
  switch (driver.kind) {
    case 'overdue-commitment':
    case 'commitment-due':
    case 'open-commitment':
      return driver.commitmentId
    case 'meeting':
    case 'event':
    case 'birthday':
      return driver.eventId
    case 'concern':
      return driver.contextFactId
    case 'silence':
      return driver.lastInteractionId
    case 'opportunity':
      return driver.opportunityId
    case 'large-withdrawal':
    case 'complaint':
      return driver.interactionId
    case 'stale-valuation':
      return driver.reviewEventId
    /* The event key, not the impact id: the same episode keeps the same fingerprint while its values update. */
    case 'market':
      return driver.eventId
    case 'health':
    case 'allocation-drift':
    case 'excess-cash':
    case 'undiscussed':
      return null
  }
}

/* ---------------------------------------------------------- the drivers */

/** Everything the record says about the client that could bear on a priority. */
function collectDrivers(
  facts: ClientFacts,
  health: RelationshipHealth,
  signals: readonly Signal[],
): SentinelDriver[] {
  const t = SENTINEL_THRESHOLDS
  const drivers: SentinelDriver[] = []
  const today = facts.today

  for (const c of overdueCommitments(facts)) {
    drivers.push({
      kind: 'overdue-commitment',
      commitmentId: c.id,
      title: c.title,
      dueDate: c.dueDate!,
      daysOverdue: daysBetween(c.dueDate!, today),
    })
  }
  for (const c of openCommitments(facts)) {
    if (c.dueDate !== null && daysBetween(c.dueDate, today) > 0) continue
    const ahead = c.dueDate === null ? null : daysBetween(today, c.dueDate)
    if (ahead !== null && ahead <= t.commitmentDueSoonDays) {
      drivers.push({
        kind: 'commitment-due',
        commitmentId: c.id,
        title: c.title,
        dueDate: c.dueDate!,
        daysAhead: ahead,
      })
    } else {
      drivers.push({
        kind: 'open-commitment',
        commitmentId: c.id,
        title: c.title,
        dueDate: c.dueDate,
      })
    }
  }

  const meeting = nextMeeting(facts)
  if (meeting && daysBetween(today, meeting.occursOn) <= t.meetingPreparationDays) {
    drivers.push({
      kind: 'meeting',
      eventId: meeting.id,
      title: meeting.title,
      date: meeting.occursOn,
      daysAhead: daysBetween(today, meeting.occursOn),
    })
  }

  const liabilityAmount = (liabilityId: string | undefined) =>
    liabilityId
      ? (facts.liabilities.find((l) => l.id === liabilityId)?.outstandingBalance ?? null)
      : null
  for (const event of upcomingEvents(facts)) {
    const ahead = daysBetween(today, event.occursOn)
    if (event.type === 'client-meeting') continue
    if (event.type === 'birthday') {
      if (ahead <= t.birthdayDays) {
        drivers.push({
          kind: 'birthday',
          eventId: event.id,
          date: event.occursOn,
          daysAhead: ahead,
          turning:
            facts.client.dateOfBirth === null
              ? null
              : Number(event.occursOn.slice(0, 4)) - Number(facts.client.dateOfBirth.slice(0, 4)),
        })
      }
      continue
    }
    if (ahead > t.eventWatchDays) continue
    drivers.push({
      kind: 'event',
      eventId: event.id,
      eventType: event.type,
      title: event.title,
      date: event.occursOn,
      daysAhead: ahead,
      material: MATERIAL_EVENT_TYPES.includes(event.type),
      liabilityId: event.liabilityId ?? null,
      amount: liabilityAmount(event.liabilityId),
    })
  }

  for (const concern of openConcerns(facts)) {
    drivers.push({
      kind: 'concern',
      contextFactId: concern.id,
      statement: concern.statement,
      sourceDate: concern.provenance.sourceDate,
      daysOld: daysBetween(concern.provenance.sourceDate, today),
    })
  }

  const silence = daysSinceContact(facts)
  if (silence !== null && silence >= t.silenceWatchDays) {
    const last = lastContact(facts)
    drivers.push({
      kind: 'silence',
      days: silence,
      lastInteractionId: last?.id ?? null,
      lastDate: last?.date ?? null,
    })
  }

  if (health.band === 'watch' || health.band === 'at-risk') {
    drivers.push({
      kind: 'health',
      score: health.score,
      band: health.band,
      negativeDrivers: health.drivers
        .filter((d) => d.effect === 'negative')
        .map((d) => d.kind),
    })
  }

  for (const signal of signals) {
    if (signal.kind === 'allocation-drift') {
      drivers.push({
        kind: 'allocation-drift',
        assetClass: signal.assetClass,
        deviationPoints: signal.deviationPoints,
        strategicPercent: signal.strategicPercent,
        currentPercent: signal.currentPercent,
      })
    }
    if (signal.kind === 'excess-cash') {
      drivers.push({
        kind: 'excess-cash',
        amount: signal.amount,
        sharePercent: signal.sharePercent,
      })
    }
    if (signal.kind === 'large-withdrawal') {
      drivers.push({
        kind: 'large-withdrawal',
        interactionId: signal.interactionId,
        amount: signal.amount,
        date: signal.date,
      })
    }
  }

  for (const i of facts.interactions) {
    if (i.type === 'complaint' && daysBetween(i.date, today) <= 180) {
      drivers.push({ kind: 'complaint', interactionId: i.id, date: i.date })
    }
  }

  for (const o of facts.opportunities) {
    if (['won', 'lost'].includes(o.status)) continue
    drivers.push({
      kind: 'opportunity',
      opportunityId: o.id,
      title: o.title,
      type: o.type,
      status: o.status,
      potentialValue: o.potentialValue,
      expectedDate: o.expectedDate,
    })
  }

  /* A stale valuation matters when a review or meeting is close enough to be embarrassed by it. */
  const review = upcomingEvents(facts).find(
    (e) =>
      (e.type === 'annual-review' || e.type === 'client-meeting') &&
      daysBetween(today, e.occursOn) <= t.staleValuationHorizonDays,
  )
  const oldest = facts.balanceSheet.oldestValuationAt
  if (review && oldest !== null && daysBetween(oldest, today) > t.staleValuationDays) {
    drivers.push({
      kind: 'stale-valuation',
      valuedAt: oldest,
      daysOld: daysBetween(oldest, today),
      reviewEventId: review.id,
    })
  }

  /* A material financing event nobody has talked about recently. */
  const financingEvent = drivers.find(
    (d): d is Extract<SentinelDriver, { kind: 'event' }> =>
      d.kind === 'event' &&
      (d.eventType === 'mortgage-refinancing' || d.eventType === 'loan-maturity') &&
      d.daysAhead <= t.eventWatchDays,
  )
  if (financingEvent) {
    const discussed = facts.interactions.find(
      (i) =>
        i.topics.includes('financing') &&
        daysBetween(i.date, today) <= t.discussedWithinDays,
    )
    if (!discussed) {
      const lastMention = facts.interactions.find((i) => i.topics.includes('financing'))
      drivers.push({
        kind: 'undiscussed',
        topic: 'financing',
        sinceDays: lastMention ? daysBetween(lastMention.date, today) : null,
      })
    }
  }

  return drivers
}

/* ------------------------------------------------------------ the anchor */

interface Anchor {
  theme: SentinelTheme
  severity: SentinelSeverity
  horizon: SentinelHorizon
  primary: SentinelDriver
  dueAt: string | null
}

const meaningfulForMeeting = (d: SentinelDriver) =>
  d.kind === 'open-commitment' ||
  d.kind === 'commitment-due' ||
  d.kind === 'concern' ||
  d.kind === 'allocation-drift' ||
  d.kind === 'excess-cash' ||
  (d.kind === 'event' && d.material) ||
  d.kind === 'stale-valuation' ||
  d.kind === 'health' ||
  d.kind === 'undiscussed' ||
  d.kind === 'market'

/** The one thing to do, by precedence. Null when the record calls for nothing. */
function chooseAnchor(drivers: readonly SentinelDriver[], today: string): Anchor | null {
  const t = SENTINEL_THRESHOLDS
  const find = <K extends SentinelDriver['kind']>(kind: K) =>
    drivers.filter((d): d is Extract<SentinelDriver, { kind: K }> => d.kind === kind)

  const overdue = find('overdue-commitment').sort((a, b) => b.daysOverdue - a.daysOverdue)
  if (overdue[0]) {
    return {
      theme: 'overdue-commitment',
      severity: 'critical',
      horizon: 'today',
      primary: overdue[0],
      dueAt: overdue[0].dueDate,
    }
  }

  const due = find('commitment-due').sort((a, b) => a.daysAhead - b.daysAhead)
  if (due[0] && due[0].daysAhead <= 1) {
    return {
      theme: 'commitment-due',
      severity: 'critical',
      horizon: 'today',
      primary: due[0],
      dueAt: due[0].dueDate,
    }
  }

  const meeting = find('meeting')[0]
  const meaningful = drivers.filter(meaningfulForMeeting)
  if (meeting && meeting.daysAhead <= t.meetingImminentDays) {
    return {
      theme: 'meeting-imminent',
      severity: meaningful.length > 0 ? 'critical' : 'high',
      horizon: 'today',
      primary: meeting,
      dueAt: meeting.date,
    }
  }

  if (due[0]) {
    return {
      theme: 'commitment-due',
      severity: 'high',
      horizon: 'upcoming',
      primary: due[0],
      dueAt: due[0].dueDate,
    }
  }

  if (meeting) {
    const hasWork = meaningful.length > 0
    return {
      theme: 'meeting-preparation',
      severity: hasWork ? 'high' : 'normal',
      horizon: hasWork && meeting.daysAhead <= t.meetingActNowDays ? 'today' : 'upcoming',
      primary: meeting,
      dueAt: meeting.date,
    }
  }

  const material = find('event')
    .filter((e) => e.material)
    .sort((a, b) => a.daysAhead - b.daysAhead)
  if (material[0] && material[0].daysAhead <= t.eventUrgentDays) {
    return {
      theme: 'event-approaching',
      severity: 'high',
      horizon: material[0].daysAhead <= 3 ? 'today' : 'upcoming',
      primary: material[0],
      dueAt: material[0].date,
    }
  }

  const health = find('health')[0]
  const silence = find('silence')[0]
  const concerns = find('concern')
  const complaint = find('complaint')[0]
  if (
    (health && health.band === 'at-risk') ||
    (silence && silence.days >= t.silenceRiskDays) ||
    complaint
  ) {
    const primary =
      silence && silence.days >= t.silenceRiskDays
        ? silence
        : (complaint ?? health ?? silence ?? concerns[0])
    if (primary) {
      return {
        theme: 'relationship-risk',
        severity: 'high',
        horizon: 'today',
        primary,
        dueAt: null,
      }
    }
  }

  /*
   * A market move stands on its own only at high relevance, and only when no
   * promise, meeting, event or relationship risk already calls: a major move
   * is today's work, a notable one is upcoming. Medium relevance is evidence
   * beneath whatever else anchors, never a reason by itself.
   */
  const marketHigh = find('market').filter((m) => m.relevance === 'high')
  const marketMajor = marketHigh.find((m) => m.eventSeverity === 'major')
  if (marketMajor) {
    return {
      theme: 'market-impact',
      severity: 'high',
      horizon: 'today',
      primary: marketMajor,
      dueAt: null,
    }
  }

  if (material[0] && material[0].daysAhead <= t.eventUpcomingDays) {
    return {
      theme: 'event-approaching',
      severity: 'normal',
      horizon: 'upcoming',
      primary: material[0],
      dueAt: material[0].date,
    }
  }

  if (silence && silence.days >= t.silenceContactDays) {
    return {
      theme: 'contact-silence',
      severity: 'normal',
      horizon: 'upcoming',
      primary: silence,
      dueAt: null,
    }
  }

  const recentConcern = concerns
    .filter((c) => c.daysOld <= t.concernRecentDays)
    .sort((a, b) => a.daysOld - b.daysOld)[0]
  if (recentConcern) {
    return {
      theme: 'concern',
      severity: 'normal',
      horizon: 'upcoming',
      primary: recentConcern,
      dueAt: null,
    }
  }

  const cash = find('excess-cash')[0]
  const drift = find('allocation-drift')[0]
  if (cash || drift) {
    return {
      theme: 'portfolio',
      severity: 'normal',
      horizon: 'watch',
      primary: (cash ?? drift)!,
      dueAt: null,
    }
  }

  /* A notable move at high relevance outranks the low anchors below, and nothing above. */
  if (marketHigh[0]) {
    return {
      theme: 'market-impact',
      severity: 'normal',
      horizon: 'upcoming',
      primary: marketHigh[0],
      dueAt: null,
    }
  }

  if (material[0]) {
    return {
      theme: 'event-approaching',
      severity: 'low',
      horizon: 'watch',
      primary: material[0],
      dueAt: material[0].date,
    }
  }

  const birthday = find('birthday')[0]
  if (birthday) {
    return {
      theme: 'birthday',
      severity: 'low',
      horizon: 'upcoming',
      primary: birthday,
      dueAt: birthday.date,
    }
  }

  const soft = find('event')
    .filter((e) => !e.material && e.daysAhead <= t.eventUpcomingDays)
    .sort((a, b) => a.daysAhead - b.daysAhead)[0]
  if (soft) {
    return {
      theme: 'event-approaching',
      severity: 'low',
      horizon: 'upcoming',
      primary: soft,
      dueAt: soft.date,
    }
  }

  if (silence) {
    return {
      theme: 'contact-silence',
      severity: 'low',
      horizon: 'watch',
      primary: silence,
      dueAt: null,
    }
  }

  const stale = find('stale-valuation')[0]
  if (stale) {
    return {
      theme: 'stale-valuation',
      severity: 'low',
      horizon: 'watch',
      primary: stale,
      dueAt: null,
    }
  }

  /* An opportunity stands on its own only when its timing is near; otherwise it is evidence, never a reason. */
  const soonest = find('opportunity')
    .filter(
      (o) =>
        o.expectedDate !== null &&
        daysBetween(today, o.expectedDate) <= t.opportunityTimingDays,
    )
    .sort((a, b) =>
      a.expectedDate! < b.expectedDate! ? -1 : a.expectedDate! > b.expectedDate! ? 1 : 0,
    )[0]
  if (soonest) {
    return {
      theme: 'opportunity',
      severity: 'low',
      horizon: 'watch',
      primary: soonest,
      dueAt: soonest.expectedDate,
    }
  }

  return null
}

/* -------------------------------------------------------------- ordering */

const DRIVER_ORDER: Record<SentinelDriver['kind'], number> = {
  'overdue-commitment': 0,
  'commitment-due': 1,
  complaint: 2,
  meeting: 3,
  event: 4,
  concern: 5,
  market: 6,
  silence: 7,
  health: 8,
  undiscussed: 9,
  'large-withdrawal': 10,
  'allocation-drift': 11,
  'excess-cash': 12,
  'open-commitment': 13,
  'stale-valuation': 14,
  opportunity: 15,
  birthday: 16,
}

function orderDrivers(
  primary: SentinelDriver,
  drivers: readonly SentinelDriver[],
): SentinelDriver[] {
  const rest = drivers
    .filter((d) => d !== primary)
    .sort(
      (a, b) =>
        DRIVER_ORDER[a.kind] - DRIVER_ORDER[b.kind] || driverWeight(b) - driverWeight(a),
    )
  return [primary, ...rest]
}

/* ------------------------------------------------------------- the rule */

/** Market-to-Client's verdicts as Sentinel evidence: medium and high relevance only, in relevance order. */
function marketDrivers(impacts: readonly ClientMarketImpact[]): SentinelDriver[] {
  return impacts
    .filter((impact) => impact.relevance !== 'low')
    .map((impact) => ({
      kind: 'market',
      eventId: impact.eventId,
      impactId: impact.id,
      category: impact.event.category,
      symbol: impact.event.symbol,
      label: impact.event.label,
      change: impact.event.change,
      changeUnit: impact.event.changeUnit,
      direction: impact.event.direction,
      eventSeverity: impact.event.severity,
      relevance: impact.relevance,
      directness: impact.directness,
      sourceIds: impact.sourceIds,
    }))
}

/**
 * The client's one priority, or null when the record calls for nothing —
 * a quiet, healthy relationship earns no line on the morning brief.
 *
 * Market impacts never open a second priority: a high-relevance impact
 * anchors only when nothing else does, and otherwise strengthens the one
 * priority the record already calls for — as a weighted driver, and by
 * lifting a normal priority to high. Nothing lifts critical, and nothing
 * lifts twice.
 */
export function prioritiseClient(
  facts: ClientFacts,
  health: RelationshipHealth = relationshipHealth(facts),
  signals: readonly Signal[] = signalsFor(facts, health),
  marketImpacts: readonly ClientMarketImpact[] = [],
): SentinelPriority | null {
  const collected = [
    ...collectDrivers(facts, health, signals),
    ...marketDrivers(marketImpacts),
  ]
  const anchor = chooseAnchor(collected, facts.today)
  if (!anchor) return null

  const strengthenedByMarket =
    anchor.theme !== 'market-impact' &&
    anchor.severity === 'normal' &&
    collected.some((d) => d.kind === 'market' && d.relevance === 'high')
  const severity: SentinelSeverity = strengthenedByMarket ? 'high' : anchor.severity
  const horizon: SentinelHorizon =
    strengthenedByMarket && anchor.horizon === 'watch' ? 'upcoming' : anchor.horizon

  /* Opportunities ride along as evidence only when they are timely, or when the anchor is one. */
  const drivers = orderDrivers(
    anchor.primary,
    collected.filter((d) => {
      if (d.kind !== 'opportunity') return true
      if (anchor.theme === 'opportunity') return true
      if (d.expectedDate === null) return false
      return (
        daysBetween(facts.today, d.expectedDate) <=
        SENTINEL_THRESHOLDS.opportunityTimingDays
      )
    }),
  )

  const urgency =
    anchor.dueAt === null
      ? 0
      : (() => {
          const ahead = daysBetween(facts.today, anchor.dueAt)
          return ahead < 0 ? 30 + Math.min(-ahead, 30) : Math.max(0, 30 - ahead)
        })()
  const score =
    SEVERITY_BASE[severity] +
    urgency +
    drivers.reduce((sum, d) => sum + driverWeight(d), 0)

  const sourceIds = [
    ...new Set(drivers.map(sourceIdOf).filter((id): id is string => id !== null)),
  ].sort()
  const fingerprint = `${anchor.theme}|${severity}|${sourceIds.join(',')}`

  return {
    id: `${facts.client.id}:${anchor.theme}`,
    clientId: facts.client.id,
    theme: anchor.theme,
    severity,
    horizon,
    score,
    primary: drivers[0]!,
    drivers,
    dueAt: anchor.dueAt,
    sourceIds,
    strengthenedByMarket,
    fingerprint,
    assessedAt: facts.today,
    method: 'sentinel-v1',
  }
}

/** Queue order: severity, then horizon, then score, then id — deterministic. */
export function comparePriorities(a: SentinelPriority, b: SentinelPriority): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    HORIZON_RANK[a.horizon] - HORIZON_RANK[b.horizon] ||
    b.score - a.score ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/**
 * What the advisor's dispositions make of a priority today.
 *
 * A snooze holds until its date; a dismissal holds while the facts are the
 * ones dismissed; a review is a marker, not a hiding. The newest matching
 * disposition wins.
 */
export function statusOf(
  priority: SentinelPriority,
  dispositions: readonly SentinelDisposition[],
  today: string,
): PriorityStatus {
  const matching = dispositions
    .filter((d) => d.priorityId === priority.id)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  for (const d of matching) {
    if (d.status === 'snoozed') {
      if (d.until !== null && daysBetween(today, d.until) > 0) return 'snoozed'
      continue
    }
    if (d.status === 'dismissed') {
      if (d.fingerprint === priority.fingerprint) return 'dismissed'
      continue
    }
    if (d.status === 'reviewed') {
      if (d.fingerprint === priority.fingerprint) return 'reviewed'
      continue
    }
  }
  return 'active'
}
