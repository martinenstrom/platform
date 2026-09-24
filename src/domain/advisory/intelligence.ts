/**
 * The relationship read as intelligence: health, signals, the next best
 * action. Rule-based and explainable in Phase 1 — every output names the
 * facts it rests on, and nothing here is stored. A later ranking model
 * replaces these functions behind the same shapes.
 *
 * The domain speaks in identifiers and numbers. Every kind below becomes a
 * Swedish sentence in `presentation/advisory`, the one place that happens.
 */

import type { Client } from './client'
import { addDays, daysBetween, nextYearlyOccurrence } from './dates'
import type { Goal } from './goals'
import { largestDeviation, type AssetClass, type Portfolio } from './portfolio'
import type {
  Commitment,
  ContextFact,
  ImportantEvent,
  Interaction,
  Opportunity,
  Reminder,
} from './relationship'
import type { BalanceSheet, Liability } from './wealth'

/** Everything the rules read, assembled by the application from the record. */
export interface ClientFacts {
  client: Client
  balanceSheet: BalanceSheet
  portfolio: Portfolio | null
  goals: readonly Goal[]
  /** Newest first. */
  interactions: readonly Interaction[]
  contextFacts: readonly ContextFact[]
  commitments: readonly Commitment[]
  events: readonly ImportantEvent[]
  opportunities: readonly Opportunity[]
  liabilities: readonly Liability[]
  /** ISO date, from the Clock. */
  today: string
}

/* ---------------------------------------------------------- derivations */

export function lastContact(facts: ClientFacts): Interaction | null {
  const contact = facts.interactions.filter((i) =>
    [
      'meeting',
      'phone',
      'email',
      'teams',
      'portfolio-discussion',
      'financing-discussion',
      'follow-up',
    ].includes(i.type),
  )
  return contact[0] ?? null
}

export function daysSinceContact(facts: ClientFacts): number | null {
  const last = lastContact(facts)
  return last ? daysBetween(last.date, facts.today) : null
}

export function lastMeeting(facts: ClientFacts): Interaction | null {
  return facts.interactions.find((i) => i.type === 'meeting') ?? null
}

/** The next occurrence of every upcoming event, on or after today. */
export function upcomingEvents(
  facts: ClientFacts,
): readonly (ImportantEvent & { occursOn: string })[] {
  return facts.events
    .filter((event) => event.status === 'upcoming')
    .map((event) => ({
      ...event,
      occursOn:
        event.recurring === 'yearly'
          ? nextYearlyOccurrence(event.date, facts.today)
          : event.date,
    }))
    .filter((event) => daysBetween(facts.today, event.occursOn) >= 0)
    .sort((a, b) => daysBetween(b.occursOn, a.occursOn) || (a.id < b.id ? -1 : 1))
}

export function nextMeeting(
  facts: ClientFacts,
): (ImportantEvent & { occursOn: string }) | null {
  return upcomingEvents(facts).find((event) => event.type === 'client-meeting') ?? null
}

export function isOverdue(commitment: Commitment, today: string): boolean {
  return (
    commitment.status === 'open' &&
    commitment.dueDate !== null &&
    daysBetween(commitment.dueDate, today) > 0
  )
}

export function openCommitments(facts: ClientFacts): readonly Commitment[] {
  return facts.commitments
    .filter((c) => c.status === 'open')
    .sort((a, b) => {
      const da = a.dueDate ?? '9999-12-31'
      const db = b.dueDate ?? '9999-12-31'
      return da < db ? -1 : da > db ? 1 : a.id < b.id ? -1 : 1
    })
}

export function overdueCommitments(facts: ClientFacts): readonly Commitment[] {
  return openCommitments(facts).filter((c) => isOverdue(c, facts.today))
}

export function openConcerns(facts: ClientFacts): readonly ContextFact[] {
  return facts.contextFacts.filter(
    (f) => f.category === 'concern' && f.status === 'active',
  )
}

/** Reminders falling within `horizonDays` of today, derived from the events' rules. */
export function remindersDue(facts: ClientFacts, horizonDays = 30): readonly Reminder[] {
  const reminders: Reminder[] = []
  for (const event of upcomingEvents(facts)) {
    for (const rule of event.reminderRules) {
      const remindAt = addDays(event.occursOn, -rule.daysBefore)
      const distance = daysBetween(facts.today, remindAt)
      if (distance >= 0 && distance <= horizonDays) {
        reminders.push({ eventId: event.id, remindAt, daysBefore: rule.daysBefore })
      }
    }
  }
  return reminders.sort((a, b) =>
    a.remindAt < b.remindAt
      ? -1
      : a.remindAt > b.remindAt
        ? 1
        : a.eventId < b.eventId
          ? -1
          : 1,
  )
}

/* ------------------------------------------------------------ thresholds */

/** The rules' thresholds, stated once so the explanation can quote them. */
export const INTELLIGENCE_THRESHOLDS = Object.freeze({
  /** Percentage points from strategy at which a deviation is a signal. */
  driftPoints: 5,
  /** Cash above this amount is excess liquidity when a growth goal exists. */
  excessCashAmount: 1_500_000,
  /** Cash above this share of financial assets is excess liquidity. */
  excessCashSharePercent: 20,
  /** Days without contact at which contact is owed. */
  contactDueDays: 60,
  /** Days without contact at which the relationship is at risk. */
  contactLapsedDays: 90,
  /** Days ahead within which a refinancing or maturity is a signal. */
  refinancingHorizonDays: 60,
  /** Days ahead within which a meeting is "upcoming" for the list. */
  meetingHorizonDays: 14,
  /** Days back within which a withdrawal counts as recent. */
  withdrawalWindowDays: 90,
  /** A withdrawal above this share of AUM is large. */
  largeWithdrawalPercent: 10,
})

/* ----------------------------------------------------------------- health */

export type HealthBand = 'strong' | 'stable' | 'watch' | 'at-risk'

export type HealthDriverKind =
  | 'recent-contact'
  | 'recent-meeting'
  | 'no-overdue-commitments'
  | 'next-meeting-booked'
  | 'no-open-concerns'
  | 'overdue-commitments'
  | 'contact-lapsed'
  | 'open-concerns'
  | 'recent-large-withdrawal'
  | 'open-complaint'
  | 'fee-sensitive'
  | 'goal-behind'

export interface HealthDriver {
  kind: HealthDriverKind
  effect: 'positive' | 'negative'
  points: number
  /** The count or magnitude the driver rests on, where one applies. */
  count?: number
}

export interface RelationshipHealth {
  score: number
  band: HealthBand
  drivers: readonly HealthDriver[]
  /** ISO date the score was derived for. */
  assessedAt: string
  method: 'rule-based-v1'
}

const BASE_SCORE = 70

export function bandOf(score: number): HealthBand {
  if (score >= 80) return 'strong'
  if (score >= 65) return 'stable'
  if (score >= 50) return 'watch'
  return 'at-risk'
}

export function relationshipHealth(facts: ClientFacts): RelationshipHealth {
  const drivers: HealthDriver[] = []
  const since = daysSinceContact(facts)
  const t = INTELLIGENCE_THRESHOLDS

  if (since !== null && since <= 30)
    drivers.push({ kind: 'recent-contact', effect: 'positive', points: 10, count: since })
  const meeting = lastMeeting(facts)
  if (meeting && daysBetween(meeting.date, facts.today) <= 90) {
    drivers.push({ kind: 'recent-meeting', effect: 'positive', points: 5 })
  }
  const overdue = overdueCommitments(facts)
  if (overdue.length === 0)
    drivers.push({ kind: 'no-overdue-commitments', effect: 'positive', points: 5 })
  else
    drivers.push({
      kind: 'overdue-commitments',
      effect: 'negative',
      points: Math.min(20, 10 * overdue.length),
      count: overdue.length,
    })
  if (nextMeeting(facts))
    drivers.push({ kind: 'next-meeting-booked', effect: 'positive', points: 5 })
  const concerns = openConcerns(facts)
  if (concerns.length === 0)
    drivers.push({ kind: 'no-open-concerns', effect: 'positive', points: 5 })
  else
    drivers.push({
      kind: 'open-concerns',
      effect: 'negative',
      points: Math.min(20, 8 * concerns.length),
      count: concerns.length,
    })
  if (since !== null && since > t.contactLapsedDays)
    drivers.push({ kind: 'contact-lapsed', effect: 'negative', points: 20, count: since })
  else if (since !== null && since > t.contactDueDays)
    drivers.push({ kind: 'contact-lapsed', effect: 'negative', points: 10, count: since })
  const withdrawal = facts.interactions.find(
    (i) =>
      i.type === 'withdrawal' &&
      daysBetween(i.date, facts.today) <= t.withdrawalWindowDays &&
      (i.amount ?? 0) >=
        (facts.balanceSheet.assetsWithBank * t.largeWithdrawalPercent) / 100,
  )
  if (withdrawal)
    drivers.push({
      kind: 'recent-large-withdrawal',
      effect: 'negative',
      points: 10,
      count: withdrawal.amount,
    })
  if (
    facts.interactions.some(
      (i) => i.type === 'complaint' && daysBetween(i.date, facts.today) <= 180,
    )
  ) {
    drivers.push({ kind: 'open-complaint', effect: 'negative', points: 10 })
  }
  if (
    facts.contextFacts.some(
      (f) =>
        f.status === 'active' &&
        f.category === 'preference' &&
        /avgift|fee/i.test(f.statement),
    )
  ) {
    drivers.push({ kind: 'fee-sensitive', effect: 'negative', points: 5 })
  }
  if (facts.goals.some((g) => g.status === 'behind'))
    drivers.push({ kind: 'goal-behind', effect: 'negative', points: 5 })

  const score = Math.max(
    0,
    Math.min(
      100,
      drivers.reduce(
        (sum, d) => sum + (d.effect === 'positive' ? d.points : -d.points),
        BASE_SCORE,
      ),
    ),
  )
  return {
    score,
    band: bandOf(score),
    drivers,
    assessedAt: facts.today,
    method: 'rule-based-v1',
  }
}

/* ---------------------------------------------------------------- signals */

export type SignalKind =
  | 'allocation-drift'
  | 'excess-cash'
  | 'refinancing-approaching'
  | 'loan-maturity-approaching'
  | 'no-recent-contact'
  | 'open-concern'
  | 'overdue-commitment'
  | 'commitment-due-soon'
  | 'meeting-approaching'
  | 'birthday-approaching'
  | 'opportunity-open'
  | 'goal-at-risk'
  | 'large-withdrawal'
  | 'retention-risk'

export type Priority = 'low' | 'medium' | 'high'

/** A signal is a typed fact with the numbers it rests on; the sentence is presentation's. */
export type Signal =
  | {
      kind: 'allocation-drift'
      priority: Priority
      assetClass: AssetClass
      deviationPoints: number
      strategicPercent: number
      currentPercent: number
    }
  | { kind: 'excess-cash'; priority: Priority; amount: number; sharePercent: number }
  | {
      kind: 'refinancing-approaching'
      priority: Priority
      eventId: string
      liabilityId: string | null
      date: string
      daysAhead: number
    }
  | {
      kind: 'loan-maturity-approaching'
      priority: Priority
      eventId: string
      liabilityId: string | null
      date: string
      daysAhead: number
    }
  | { kind: 'no-recent-contact'; priority: Priority; days: number }
  | { kind: 'open-concern'; priority: Priority; contextFactId: string; statement: string }
  | {
      kind: 'overdue-commitment'
      priority: Priority
      commitmentId: string
      title: string
      daysOverdue: number
    }
  | {
      kind: 'commitment-due-soon'
      priority: Priority
      commitmentId: string
      title: string
      daysAhead: number
    }
  | {
      kind: 'meeting-approaching'
      priority: Priority
      eventId: string
      date: string
      daysAhead: number
      openCommitments: number
    }
  | {
      kind: 'birthday-approaching'
      priority: Priority
      date: string
      daysAhead: number
      turning: number
    }
  | {
      kind: 'opportunity-open'
      priority: Priority
      opportunityId: string
      title: string
      potentialValue: number
    }
  | {
      kind: 'goal-at-risk'
      priority: Priority
      goalId: string
      title: string
      status: Goal['status']
    }
  | {
      kind: 'large-withdrawal'
      priority: Priority
      interactionId: string
      amount: number
      date: string
    }
  | {
      kind: 'retention-risk'
      priority: Priority
      score: number
      drivers: readonly HealthDriverKind[]
    }

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

const KIND_RANK: Record<SignalKind, number> = {
  'overdue-commitment': 0,
  'retention-risk': 1,
  'meeting-approaching': 2,
  'allocation-drift': 3,
  'refinancing-approaching': 4,
  'loan-maturity-approaching': 5,
  'excess-cash': 6,
  'no-recent-contact': 7,
  'open-concern': 8,
  'commitment-due-soon': 9,
  'large-withdrawal': 10,
  'goal-at-risk': 11,
  'opportunity-open': 12,
  'birthday-approaching': 13,
}

export function signalsFor(
  facts: ClientFacts,
  health: RelationshipHealth = relationshipHealth(facts),
): readonly Signal[] {
  const t = INTELLIGENCE_THRESHOLDS
  const signals: Signal[] = []

  for (const c of overdueCommitments(facts)) {
    signals.push({
      kind: 'overdue-commitment',
      priority: 'high',
      commitmentId: c.id,
      title: c.title,
      daysOverdue: daysBetween(c.dueDate!, facts.today),
    })
  }
  for (const c of openCommitments(facts)) {
    if (
      c.dueDate &&
      !isOverdue(c, facts.today) &&
      daysBetween(facts.today, c.dueDate) <= 7
    ) {
      signals.push({
        kind: 'commitment-due-soon',
        priority: 'medium',
        commitmentId: c.id,
        title: c.title,
        daysAhead: daysBetween(facts.today, c.dueDate),
      })
    }
  }
  if (health.band === 'at-risk') {
    signals.push({
      kind: 'retention-risk',
      priority: 'high',
      score: health.score,
      drivers: health.drivers.filter((d) => d.effect === 'negative').map((d) => d.kind),
    })
  }
  const meeting = nextMeeting(facts)
  if (meeting) {
    const ahead = daysBetween(facts.today, meeting.occursOn)
    if (ahead <= t.meetingHorizonDays) {
      signals.push({
        kind: 'meeting-approaching',
        priority: ahead <= 7 ? 'high' : 'medium',
        eventId: meeting.id,
        date: meeting.occursOn,
        daysAhead: ahead,
        openCommitments: openCommitments(facts).length,
      })
    }
  }
  if (facts.portfolio) {
    const drift = largestDeviation(facts.portfolio)
    if (drift && Math.abs(drift.deviationPoints) >= t.driftPoints) {
      signals.push({
        kind: 'allocation-drift',
        priority: Math.abs(drift.deviationPoints) >= 8 ? 'high' : 'medium',
        assetClass: drift.assetClass,
        deviationPoints: drift.deviationPoints,
        strategicPercent: drift.strategicPercent,
        currentPercent: drift.currentPercent,
      })
    }
  }
  for (const event of upcomingEvents(facts)) {
    const ahead = daysBetween(facts.today, event.occursOn)
    if (
      (event.type === 'mortgage-refinancing' || event.type === 'loan-maturity') &&
      ahead <= t.refinancingHorizonDays
    ) {
      signals.push({
        kind:
          event.type === 'mortgage-refinancing'
            ? 'refinancing-approaching'
            : 'loan-maturity-approaching',
        priority: ahead <= 30 ? 'high' : 'medium',
        eventId: event.id,
        liabilityId: event.liabilityId ?? null,
        date: event.occursOn,
        daysAhead: ahead,
      })
    }
    if (event.type === 'birthday' && ahead <= 14) {
      signals.push({
        kind: 'birthday-approaching',
        priority: 'low',
        date: event.occursOn,
        daysAhead: ahead,
        turning:
          Number(event.occursOn.slice(0, 4)) -
          Number(facts.client.dateOfBirth.slice(0, 4)),
      })
    }
  }
  const financialAssets = facts.balanceSheet.buckets
    .filter((b) =>
      ['investment-portfolio', 'cash', 'pension', 'other-financial'].includes(b.kind),
    )
    .reduce((sum, b) => sum + b.value, 0)
  const cash = facts.balanceSheet.liquidity
  const cashShare = financialAssets === 0 ? 0 : Math.round((cash / financialAssets) * 100)
  const growthGoal = facts.goals.some(
    (g) =>
      ['long-term-growth', 'generational-wealth', 'retirement-income'].includes(g.kind) &&
      g.status !== 'achieved',
  )
  if (
    (cash >= t.excessCashAmount && growthGoal) ||
    cashShare >= t.excessCashSharePercent
  ) {
    signals.push({
      kind: 'excess-cash',
      priority: cash >= 2 * t.excessCashAmount ? 'high' : 'medium',
      amount: cash,
      sharePercent: cashShare,
    })
  }
  const since = daysSinceContact(facts)
  if (since !== null && since > t.contactDueDays) {
    signals.push({
      kind: 'no-recent-contact',
      priority: since > t.contactLapsedDays ? 'high' : 'medium',
      days: since,
    })
  }
  for (const concern of openConcerns(facts)) {
    signals.push({
      kind: 'open-concern',
      priority: 'medium',
      contextFactId: concern.id,
      statement: concern.statement,
    })
  }
  for (const i of facts.interactions) {
    if (
      i.type === 'withdrawal' &&
      daysBetween(i.date, facts.today) <= t.withdrawalWindowDays &&
      (i.amount ?? 0) >=
        (facts.balanceSheet.assetsWithBank * t.largeWithdrawalPercent) / 100
    ) {
      signals.push({
        kind: 'large-withdrawal',
        priority: 'medium',
        interactionId: i.id,
        amount: i.amount ?? 0,
        date: i.date,
      })
    }
  }
  for (const g of facts.goals) {
    if (g.status === 'at-risk' || g.status === 'behind')
      signals.push({
        kind: 'goal-at-risk',
        priority: g.status === 'behind' ? 'medium' : 'low',
        goalId: g.id,
        title: g.title,
        status: g.status,
      })
  }
  for (const o of facts.opportunities) {
    if (o.status === 'identified' || o.status === 'in-discussion')
      signals.push({
        kind: 'opportunity-open',
        priority: 'low',
        opportunityId: o.id,
        title: o.title,
        potentialValue: o.potentialValue,
      })
  }

  return signals.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind],
  )
}

/* ------------------------------------------------------- next best action */

export interface NextBestAction {
  /** The signal the action answers. */
  signal: Signal
  /** 1 most urgent … 5 routine. */
  urgency: 1 | 2 | 3 | 4 | 5
  /** ISO date by which the action is due, where the signal carries one. */
  dueDate: string | null
  method: 'rule-based-v1'
}

const URGENCY: Record<SignalKind, NextBestAction['urgency']> = {
  'overdue-commitment': 1,
  'retention-risk': 1,
  'meeting-approaching': 2,
  'allocation-drift': 2,
  'refinancing-approaching': 2,
  'loan-maturity-approaching': 2,
  'commitment-due-soon': 3,
  'excess-cash': 3,
  'no-recent-contact': 3,
  'open-concern': 3,
  'large-withdrawal': 3,
  'goal-at-risk': 4,
  'opportunity-open': 4,
  'birthday-approaching': 5,
}

/** One action per client — the highest-ranked signal, or none when nothing calls for one. */
export function nextBestAction(
  facts: ClientFacts,
  signals: readonly Signal[] = signalsFor(facts),
): NextBestAction | null {
  const first = signals[0]
  if (!first) return null
  const dueDate =
    'date' in first
      ? first.date
      : first.kind === 'overdue-commitment' || first.kind === 'commitment-due-soon'
        ? (facts.commitments.find((c) => c.id === first.commitmentId)?.dueDate ?? null)
        : null
  return { signal: first, urgency: URGENCY[first.kind], dueDate, method: 'rule-based-v1' }
}

/* ----------------------------------------------------------- list flags */

/** The attention flags the client list filters and sorts on. Derived, never stored. */
export interface ClientFlags {
  needsAttention: boolean
  upcomingMeeting: boolean
  investmentOpportunity: boolean
  financingOpportunity: boolean
  retentionRisk: boolean
  highCash: boolean
  portfolioDeviation: boolean
  noRecentContact: boolean
  openCommitment: boolean
  overdueCommitment: boolean
  eventApproaching: boolean
}

export function clientFlags(
  facts: ClientFacts,
  signals: readonly Signal[],
  health: RelationshipHealth,
): ClientFlags {
  const has = (kind: SignalKind) => signals.some((s) => s.kind === kind)
  const highPriority = signals.some((s) => s.priority === 'high')
  return {
    needsAttention: highPriority || health.band === 'watch' || health.band === 'at-risk',
    upcomingMeeting: has('meeting-approaching'),
    investmentOpportunity: facts.opportunities.some(
      (o) =>
        [
          'investment',
          'liquidity-deployment',
          'external-asset-transfer',
          'pension',
        ].includes(o.type) && !['won', 'lost'].includes(o.status),
    ),
    financingOpportunity: facts.opportunities.some(
      (o) =>
        ['financing', 'property-financing'].includes(o.type) &&
        !['won', 'lost'].includes(o.status),
    ),
    retentionRisk: has('retention-risk'),
    highCash: has('excess-cash'),
    portfolioDeviation: has('allocation-drift'),
    noRecentContact: has('no-recent-contact'),
    openCommitment: openCommitments(facts).length > 0,
    overdueCommitment: has('overdue-commitment'),
    eventApproaching:
      has('refinancing-approaching') ||
      has('loan-maturity-approaching') ||
      has('birthday-approaching') ||
      upcomingEvents(facts).some(
        (e) => e.type !== 'client-meeting' && daysBetween(facts.today, e.occursOn) <= 30,
      ),
  }
}

/** Opportunity value still open, the sum a pipeline would count. */
export function openOpportunityValue(opportunities: readonly Opportunity[]): number {
  return opportunities
    .filter((o) => !['won', 'lost'].includes(o.status))
    .reduce((sum, o) => sum + o.potentialValue, 0)
}
