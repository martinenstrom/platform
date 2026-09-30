/**
 * The meeting baseline — the client's structured state as it stood around
 * a meeting, kept so the next meeting can say what changed since, against
 * what was actually known then rather than against a reconstruction of it.
 *
 * A snapshot is structured domain data, never UI state: the balance sheet,
 * the portfolio and its allocation, the loans, the goals, the relationship
 * health, and the ids of what was open, upcoming and worrying. It is
 * captured when a meaningful meeting is recorded and confirmed, and read
 * by the next preparation. Without one, the comparison falls back to what
 * the record itself dates — commitments, facts, events — and says plainly
 * that no allocation baseline is available.
 *
 * What counts as a meaningful change is stated once, in
 * `MEETING_CHANGE_THRESHOLDS`, so a briefing never floods a meeting with
 * trivial differences and never hides a material one.
 */

import type { ClientId } from './client'
import { daysBetween } from './dates'
import type { GoalStatus } from './goals'
import {
  bandOf,
  lastMeeting,
  openCommitments,
  openConcerns,
  overdueCommitments,
  relationshipHealth,
  upcomingEvents,
  type ClientFacts,
  type HealthBand,
} from './intelligence'
import type { AssetClass } from './portfolio'
import type { ContextCategory, EventType } from './relationship'
import type { InterestType } from './wealth'

/* ---------------------------------------------------------------- snapshot */

export interface MeetingSnapshot {
  /** `snap-${meetingInteractionId}`. */
  id: string
  clientId: ClientId
  /** The recorded meeting the baseline belongs to. */
  meetingInteractionId: string
  /** ISO date of that meeting. */
  meetingDate: string
  /** ISO timestamp the baseline was captured. */
  capturedAt: string
  financial: {
    totalAssets: number
    totalLiabilities: number
    netWorth: number
    assetsWithBank: number
    liquidity: number
  }
  /** Null when the client had no managed portfolio at the time. */
  portfolio: {
    valuedAt: string
    totalValue: number
    performanceYtdPercent: number
  } | null
  allocation:
    | readonly {
        assetClass: AssetClass
        currentPercent: number
        strategicPercent: number
      }[]
    | null
  loans: readonly {
    id: string
    outstandingBalance: number
    interestType: InterestType
    ratePercent: number
    maturityDate: string | null
  }[]
  goals: readonly { id: string; status: GoalStatus; progressPercent: number }[]
  relationship: { healthScore: number; healthBand: HealthBand }
  openCommitmentIds: readonly string[]
  /** Upcoming events at the time, by id. */
  importantEventIds: readonly string[]
  activeConcernIds: readonly string[]
  method: 'meeting-snapshot-v1'
}

/** The baseline for a recorded meeting, from the facts as they stand when it is captured. */
export function snapshotOf(
  facts: ClientFacts,
  meetingInteractionId: string,
  meetingDate: string,
  capturedAt: string,
): MeetingSnapshot {
  const health = relationshipHealth(facts)
  return {
    id: `snap-${meetingInteractionId}`,
    clientId: facts.client.id,
    meetingInteractionId,
    meetingDate,
    capturedAt,
    financial: {
      totalAssets: facts.balanceSheet.totalAssets,
      totalLiabilities: facts.balanceSheet.totalLiabilities,
      netWorth: facts.balanceSheet.netWorth,
      assetsWithBank: facts.balanceSheet.assetsWithBank,
      liquidity: facts.balanceSheet.liquidity,
    },
    portfolio: facts.portfolio
      ? {
          valuedAt: facts.portfolio.valuedAt,
          totalValue: facts.portfolio.totalValue,
          performanceYtdPercent: facts.portfolio.performanceYtdPercent,
        }
      : null,
    allocation: facts.portfolio
      ? facts.portfolio.allocation.map((a) => ({
          assetClass: a.assetClass,
          currentPercent: a.currentPercent,
          strategicPercent: a.strategicPercent,
        }))
      : null,
    loans: facts.liabilities.map((l) => ({
      id: l.id,
      outstandingBalance: l.outstandingBalance,
      interestType: l.interestType,
      ratePercent: l.ratePercent,
      maturityDate: l.maturityDate,
    })),
    goals: facts.goals.map((g) => ({
      id: g.id,
      status: g.status,
      progressPercent: g.progressPercent,
    })),
    relationship: { healthScore: health.score, healthBand: health.band },
    openCommitmentIds: openCommitments(facts).map((c) => c.id),
    importantEventIds: upcomingEvents(facts).map((e) => e.id),
    activeConcernIds: openConcerns(facts).map((f) => f.id),
    method: 'meeting-snapshot-v1',
  }
}

/* -------------------------------------------------------------- thresholds */

/** What qualifies as a meaningful change between two meetings, stated once. */
export const MEETING_CHANGE_THRESHOLDS = Object.freeze({
  /** Percentage points an asset class must move to be shown. */
  allocationPoints: 2,
  /** Percent the managed portfolio's value must move. */
  portfolioValuePercent: 1,
  /** Percent liquidity must move — and at least the amount below. */
  liquidityPercent: 10,
  liquidityAmount: 250_000,
  /** Percent total assets must move. */
  wealthPercent: 2,
  /** Percent a loan balance must move. */
  loanBalancePercent: 5,
  /** Points the health score must move. */
  healthPoints: 5,
  /** Points a goal's progress must move. */
  goalProgressPoints: 5,
  /** Days ahead within which a financing event has become approaching. */
  financingHorizonDays: 60,
  /** Days back the record-based comparison looks without a baseline. */
  fallbackWindowDays: 30,
})

/* ----------------------------------------------------------------- changes */

export type ChangeCategory =
  | 'portfolio'
  | 'liquidity'
  | 'wealth'
  | 'financing'
  | 'goals'
  | 'relationship'
  | 'commitments'
  | 'events'
  | 'context'

/** One meaningful difference between the baseline and now, typed with its numbers and its records. */
export type MeetingChange =
  | {
      kind: 'portfolio-value'
      category: 'portfolio'
      before: number
      after: number
      percent: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'allocation'
      category: 'portfolio'
      assetClass: AssetClass
      before: number
      after: number
      points: number
      strategicPercent: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'liquidity'
      category: 'liquidity'
      before: number
      after: number
      percent: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'wealth'
      category: 'wealth'
      before: number
      after: number
      percent: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'loan-new' | 'loan-closed'
      category: 'financing'
      loanId: string
      balance: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'loan-balance'
      category: 'financing'
      loanId: string
      before: number
      after: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'financing-approaching'
      category: 'financing'
      eventId: string
      eventType: EventType
      liabilityId: string | null
      daysAhead: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'goal-status'
      category: 'goals'
      goalId: string
      before: GoalStatus
      after: GoalStatus
      sourceIds: readonly string[]
    }
  | {
      kind: 'goal-progress'
      category: 'goals'
      goalId: string
      before: number
      after: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'health'
      category: 'relationship'
      before: number
      after: number
      bandBefore: HealthBand
      bandAfter: HealthBand
      sourceIds: readonly string[]
    }
  | {
      kind: 'contacts'
      category: 'relationship'
      interactionIds: readonly string[]
      sourceIds: readonly string[]
    }
  | {
      kind: 'commitments'
      category: 'commitments'
      createdIds: readonly string[]
      completedIds: readonly string[]
      overdueIds: readonly string[]
      openIds: readonly string[]
      sourceIds: readonly string[]
    }
  | {
      kind: 'event-new'
      category: 'events'
      eventId: string
      eventType: EventType
      date: string
      sourceIds: readonly string[]
    }
  | {
      kind: 'concern-new'
      category: 'context'
      contextFactId: string
      statement: string
      sourceIds: readonly string[]
    }
  | {
      kind: 'context-new'
      category: 'context'
      contextFactId: string
      contextCategory: ContextCategory
      statement: string
      sourceIds: readonly string[]
    }

export type ComparisonGap =
  'no-baseline' | 'no-portfolio-baseline' | 'no-recorded-meeting'

export interface MeetingChanges {
  /** The baseline compared against, where one exists. */
  baseline: {
    meetingInteractionId: string
    meetingDate: string
    capturedAt: string
  } | null
  /** ISO date the comparison starts: the baseline's meeting, else the last recorded meeting, else a standing window. */
  since: string
  changes: readonly MeetingChange[]
  /** What could not be compared, said rather than hidden. */
  gaps: readonly ComparisonGap[]
  method: 'meeting-changes-v1'
}

const pct = (before: number, after: number): number =>
  before === 0 ? 0 : Math.round(((after - before) / before) * 1000) / 10

const FINANCING_EVENTS: readonly EventType[] = [
  'mortgage-refinancing',
  'loan-maturity',
  'investment-maturity',
]

/**
 * The meaningful changes since the baseline. With a snapshot: numbers
 * against numbers, above the thresholds. Without one: only what the record
 * itself dates since the last recorded meeting (or the fallback window),
 * and a gap saying no allocation baseline exists.
 */
export function changesSince(
  snapshot: MeetingSnapshot | null,
  facts: ClientFacts,
): MeetingChanges {
  const t = MEETING_CHANGE_THRESHOLDS
  const changes: MeetingChange[] = []
  const gaps: ComparisonGap[] = []
  const meeting = lastMeeting(facts)
  const since =
    snapshot?.meetingDate ??
    meeting?.date ??
    (() => {
      const d = new Date(`${facts.today}T00:00:00.000Z`)
      d.setUTCDate(d.getUTCDate() - t.fallbackWindowDays)
      return d.toISOString().slice(0, 10)
    })()
  if (!snapshot) gaps.push('no-baseline')
  if (!snapshot && !meeting) gaps.push('no-recorded-meeting')

  if (snapshot) {
    /* Portfolio value and allocation. */
    if (snapshot.portfolio && facts.portfolio) {
      const percent = pct(snapshot.portfolio.totalValue, facts.portfolio.totalValue)
      if (Math.abs(percent) >= t.portfolioValuePercent) {
        changes.push({
          kind: 'portfolio-value',
          category: 'portfolio',
          before: snapshot.portfolio.totalValue,
          after: facts.portfolio.totalValue,
          percent,
          sourceIds: [facts.portfolio.id, snapshot.id],
        })
      }
    } else if (facts.portfolio && !snapshot.portfolio) {
      gaps.push('no-portfolio-baseline')
    }
    if (snapshot.allocation && facts.portfolio) {
      for (const now of facts.portfolio.allocation) {
        const then = snapshot.allocation.find((a) => a.assetClass === now.assetClass)
        if (!then) continue
        const points = Math.round((now.currentPercent - then.currentPercent) * 10) / 10
        if (Math.abs(points) >= t.allocationPoints) {
          changes.push({
            kind: 'allocation',
            category: 'portfolio',
            assetClass: now.assetClass,
            before: then.currentPercent,
            after: now.currentPercent,
            points,
            strategicPercent: now.strategicPercent,
            sourceIds: [facts.portfolio.id, snapshot.id],
          })
        }
      }
    } else if (facts.portfolio && !snapshot.allocation) {
      if (!gaps.includes('no-portfolio-baseline')) gaps.push('no-portfolio-baseline')
    }

    /* Liquidity and wealth. */
    const liquidityPercent = pct(
      snapshot.financial.liquidity,
      facts.balanceSheet.liquidity,
    )
    if (
      Math.abs(liquidityPercent) >= t.liquidityPercent &&
      Math.abs(facts.balanceSheet.liquidity - snapshot.financial.liquidity) >=
        t.liquidityAmount
    ) {
      changes.push({
        kind: 'liquidity',
        category: 'liquidity',
        before: snapshot.financial.liquidity,
        after: facts.balanceSheet.liquidity,
        percent: liquidityPercent,
        sourceIds: [snapshot.id],
      })
    }
    const wealthPercent = pct(
      snapshot.financial.totalAssets,
      facts.balanceSheet.totalAssets,
    )
    if (Math.abs(wealthPercent) >= t.wealthPercent) {
      changes.push({
        kind: 'wealth',
        category: 'wealth',
        before: snapshot.financial.totalAssets,
        after: facts.balanceSheet.totalAssets,
        percent: wealthPercent,
        sourceIds: [snapshot.id],
      })
    }

    /* Loans. */
    for (const loan of facts.liabilities) {
      const then = snapshot.loans.find((l) => l.id === loan.id)
      if (!then) {
        changes.push({
          kind: 'loan-new',
          category: 'financing',
          loanId: loan.id,
          balance: loan.outstandingBalance,
          sourceIds: [loan.id],
        })
        continue
      }
      if (
        Math.abs(pct(then.outstandingBalance, loan.outstandingBalance)) >=
        t.loanBalancePercent
      ) {
        changes.push({
          kind: 'loan-balance',
          category: 'financing',
          loanId: loan.id,
          before: then.outstandingBalance,
          after: loan.outstandingBalance,
          sourceIds: [loan.id, snapshot.id],
        })
      }
    }
    for (const then of snapshot.loans) {
      if (!facts.liabilities.some((l) => l.id === then.id)) {
        changes.push({
          kind: 'loan-closed',
          category: 'financing',
          loanId: then.id,
          balance: then.outstandingBalance,
          sourceIds: [then.id, snapshot.id],
        })
      }
    }

    /* Goals. */
    for (const goal of facts.goals) {
      const then = snapshot.goals.find((g) => g.id === goal.id)
      if (!then) continue
      if (then.status !== goal.status) {
        changes.push({
          kind: 'goal-status',
          category: 'goals',
          goalId: goal.id,
          before: then.status,
          after: goal.status,
          sourceIds: [goal.id, snapshot.id],
        })
      } else if (
        Math.abs(goal.progressPercent - then.progressPercent) >= t.goalProgressPoints
      ) {
        changes.push({
          kind: 'goal-progress',
          category: 'goals',
          goalId: goal.id,
          before: then.progressPercent,
          after: goal.progressPercent,
          sourceIds: [goal.id, snapshot.id],
        })
      }
    }

    /* Relationship health. */
    const health = relationshipHealth(facts)
    if (Math.abs(health.score - snapshot.relationship.healthScore) >= t.healthPoints) {
      changes.push({
        kind: 'health',
        category: 'relationship',
        before: snapshot.relationship.healthScore,
        after: health.score,
        bandBefore: snapshot.relationship.healthBand,
        bandAfter: bandOf(health.score),
        sourceIds: [snapshot.id],
      })
    }
  }

  /* Financing events that have come within the horizon since the baseline. */
  for (const event of upcomingEvents(facts)) {
    if (!FINANCING_EVENTS.includes(event.type)) continue
    const daysAhead = daysBetween(facts.today, event.occursOn)
    const daysAheadThen = daysBetween(since, event.occursOn)
    if (daysAhead <= t.financingHorizonDays && daysAheadThen > t.financingHorizonDays) {
      changes.push({
        kind: 'financing-approaching',
        category: 'financing',
        eventId: event.id,
        eventType: event.type,
        liabilityId: event.liabilityId ?? null,
        daysAhead,
        sourceIds: [event.id, ...(event.liabilityId ? [event.liabilityId] : [])],
      })
    }
  }

  /* What the record itself dates since the baseline: contacts, promises, events, facts. */
  const contacts = facts.interactions.filter(
    (i) =>
      i.date >= since &&
      i.id !== snapshot?.meetingInteractionId &&
      i.id !== meeting?.id &&
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
  if (contacts.length > 0) {
    changes.push({
      kind: 'contacts',
      category: 'relationship',
      interactionIds: contacts.map((i) => i.id),
      sourceIds: contacts.map((i) => i.id),
    })
  }

  const baselineOpen = new Set(snapshot?.openCommitmentIds ?? [])
  const createdIds = facts.commitments
    .filter((c) =>
      snapshot ? !baselineOpen.has(c.id) && c.createdAt >= since : c.createdAt > since,
    )
    .filter((c) => c.status !== 'cancelled')
    .map((c) => c.id)
  const completedIds = facts.commitments
    .filter(
      (c) => c.status === 'done' && c.completedAt !== null && c.completedAt >= since,
    )
    .map((c) => c.id)
  const overdueIds = overdueCommitments(facts).map((c) => c.id)
  const openIds = openCommitments(facts).map((c) => c.id)
  if (createdIds.length > 0 || completedIds.length > 0 || overdueIds.length > 0) {
    changes.push({
      kind: 'commitments',
      category: 'commitments',
      createdIds,
      completedIds,
      overdueIds,
      openIds,
      sourceIds: [...new Set([...createdIds, ...completedIds, ...overdueIds])],
    })
  }

  const baselineEvents = new Set(snapshot?.importantEventIds ?? [])
  for (const event of upcomingEvents(facts)) {
    if (event.type === 'client-meeting') continue
    const isNew = snapshot
      ? !baselineEvents.has(event.id)
      : event.provenance.sourceDate > since
    if (!isNew) continue
    changes.push({
      kind: 'event-new',
      category: 'events',
      eventId: event.id,
      eventType: event.type,
      date: event.occursOn,
      sourceIds: [event.id],
    })
  }

  const baselineConcerns = new Set(snapshot?.activeConcernIds ?? [])
  for (const fact of facts.contextFacts) {
    if (fact.status !== 'active') continue
    if (fact.category === 'concern') {
      const isNew = snapshot
        ? !baselineConcerns.has(fact.id)
        : fact.provenance.sourceDate > since
      if (isNew) {
        changes.push({
          kind: 'concern-new',
          category: 'context',
          contextFactId: fact.id,
          statement: fact.statement,
          sourceIds: [fact.id],
        })
      }
      continue
    }
    if (fact.provenance.sourceDate > since && fact.category !== 'communication') {
      changes.push({
        kind: 'context-new',
        category: 'context',
        contextFactId: fact.id,
        contextCategory: fact.category,
        statement: fact.statement,
        sourceIds: [fact.id],
      })
    }
  }

  return {
    baseline: snapshot
      ? {
          meetingInteractionId: snapshot.meetingInteractionId,
          meetingDate: snapshot.meetingDate,
          capturedAt: snapshot.capturedAt,
        }
      : null,
    since,
    changes,
    gaps,
    method: 'meeting-changes-v1',
  }
}

/** True when the comparison found nothing an advisor would call a change. */
export function fewChanges(changes: MeetingChanges): boolean {
  return changes.changes.filter((c) => c.kind !== 'contacts').length === 0
}
