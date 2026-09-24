/**
 * What an advisor needs in hand before meeting the client — assembled from
 * the record by rule, never written by a model.
 *
 * Phase 1 is a briefing, not the Meeting Cockpit: the last meeting, what has
 * changed since it, what is owed, what is coming, where the portfolio stands
 * against the mandate, what the client worries about, and the topics those
 * facts suggest. Every entry points at the record it rests on, so the
 * briefing can be checked against the relationship's own memory.
 */

import { daysBetween } from './dates'
import type { Goal } from './goals'
import {
  lastMeeting,
  nextMeeting,
  openCommitments,
  openConcerns,
  relationshipHealth,
  signalsFor,
  upcomingEvents,
  type ClientFacts,
  type Signal,
} from './intelligence'
import { allocationDeviations, type AllocationDeviation } from './portfolio'
import type {
  Commitment,
  ContextFact,
  ImportantEvent,
  Interaction,
  Opportunity,
} from './relationship'

export type SuggestedTopicKind =
  | 'open-commitment'
  | 'client-concern'
  | 'allocation-drift'
  | 'upcoming-event'
  | 'excess-cash'
  | 'goal-at-risk'
  | 'opportunity'
  | 'contact-gap'

export interface SuggestedTopic {
  kind: SuggestedTopicKind
  /** The record the topic rests on: a commitment, a fact, an event, a goal, an opportunity. */
  referenceId: string | null
  /** The statement or title of that record, in the advisor's or the client's words. */
  reference: string
}

export interface MeetingPrep {
  /** The meeting being prepared, where one is booked. */
  meeting: (ImportantEvent & { occursOn: string }) | null
  lastMeeting: Interaction | null
  /** Interactions since the last meeting, newest first. */
  changesSince: readonly Interaction[]
  /** Facts learnt since the last meeting. */
  factsSince: readonly ContextFact[]
  openCommitments: readonly Commitment[]
  overdueCommitments: readonly Commitment[]
  /** Within the horizon, soonest first. */
  upcomingEvents: readonly (ImportantEvent & { occursOn: string })[]
  /** The mandate's deviations, largest first. */
  portfolioDeviations: readonly AllocationDeviation[]
  alerts: readonly Signal[]
  concerns: readonly ContextFact[]
  goals: readonly Goal[]
  suggestedTopics: readonly SuggestedTopic[]
  opportunities: readonly Opportunity[]
  /** ISO date the briefing was assembled for. */
  preparedFor: string
  method: 'rule-based-v1'
}

const EVENT_HORIZON_DAYS = 90

export function meetingPreparation(facts: ClientFacts): MeetingPrep {
  const meeting = lastMeeting(facts)
  const since = meeting
    ? facts.interactions.filter(
        (i) => i.id !== meeting.id && daysBetween(meeting.date, i.date) >= 0,
      )
    : facts.interactions.slice(0, 5)
  const factsSince = meeting
    ? facts.contextFacts.filter(
        (f) => daysBetween(meeting.date, f.provenance.sourceDate) > 0,
      )
    : facts.contextFacts.slice(0, 5)
  const open = openCommitments(facts)
  const overdue = open.filter(
    (c) => c.dueDate !== null && daysBetween(c.dueDate, facts.today) > 0,
  )
  const events = upcomingEvents(facts).filter(
    (e) =>
      e.type !== 'client-meeting' &&
      daysBetween(facts.today, e.occursOn) <= EVENT_HORIZON_DAYS,
  )
  const deviations = facts.portfolio
    ? [...allocationDeviations(facts.portfolio)].sort(
        (a, b) =>
          Math.abs(b.deviationPoints) - Math.abs(a.deviationPoints) ||
          (a.assetClass < b.assetClass ? -1 : 1),
      )
    : []
  const health = relationshipHealth(facts)
  const alerts = signalsFor(facts, health).filter((s) => s.priority !== 'low')
  const concerns = openConcerns(facts)
  const liveOpportunities = facts.opportunities.filter(
    (o) => !['won', 'lost'].includes(o.status),
  )

  const topics: SuggestedTopic[] = []
  for (const c of open)
    topics.push({ kind: 'open-commitment', referenceId: c.id, reference: c.title })
  for (const f of concerns)
    topics.push({ kind: 'client-concern', referenceId: f.id, reference: f.statement })
  for (const d of deviations) {
    if (Math.abs(d.deviationPoints) >= 5) {
      topics.push({
        kind: 'allocation-drift',
        referenceId: null,
        reference: d.assetClass,
      })
    }
  }
  for (const e of events)
    topics.push({ kind: 'upcoming-event', referenceId: e.id, reference: e.title })
  for (const s of alerts) {
    if (s.kind === 'excess-cash')
      topics.push({ kind: 'excess-cash', referenceId: null, reference: String(s.amount) })
    if (s.kind === 'no-recent-contact')
      topics.push({ kind: 'contact-gap', referenceId: null, reference: String(s.days) })
  }
  for (const g of facts.goals) {
    if (g.status === 'at-risk' || g.status === 'behind')
      topics.push({ kind: 'goal-at-risk', referenceId: g.id, reference: g.title })
  }
  for (const o of liveOpportunities)
    topics.push({ kind: 'opportunity', referenceId: o.id, reference: o.title })

  return {
    meeting: nextMeeting(facts),
    lastMeeting: meeting,
    changesSince: since,
    factsSince,
    openCommitments: open,
    overdueCommitments: overdue,
    upcomingEvents: events,
    portfolioDeviations: deviations,
    alerts,
    concerns,
    goals: facts.goals,
    suggestedTopics: topics,
    opportunities: liveOpportunities,
    preparedFor: facts.today,
    method: 'rule-based-v1',
  }
}
