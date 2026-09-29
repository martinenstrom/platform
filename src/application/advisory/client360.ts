/**
 * Client 360 — one relationship in full, read once.
 *
 * Everything the client page shows arrives in this shape: the record's
 * facts beside the derivations over them (balance sheet, deviations, health,
 * signals, the next best action, reminders). The surface renders it and
 * recomputes nothing — the same presentation boundary the institution's
 * surfaces keep.
 */

import {
  allocationDeviations,
  assessClient,
  clientFlags,
  currencyExposure,
  daysBetween,
  daysSinceContact,
  isOverdue,
  lastContact,
  lastMeeting,
  nextBestAction,
  nextMeeting,
  openCommitments,
  relationshipHealth,
  remindersDue,
  sectorExposure,
  signalsFor,
  upcomingEvents,
  type Advisor,
  type AllocationDeviation,
  type Asset,
  type BalanceSheet,
  type Client,
  type ClientFlags,
  type ClientId,
  type ClientMarketImpact,
  type Commitment,
  type ContextFact,
  type Goal,
  type Holding,
  type Household,
  type ImportantEvent,
  type Interaction,
  type Liability,
  type MemoryCandidate,
  type NextBestAction,
  type Opportunity,
  type Portfolio,
  type RelationshipHealth,
  type Reminder,
  type Sector,
  type Signal,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import {
  marketChangesSince,
  marketLedger,
  marketWindowStart,
  type MarketChangeSince,
} from './marketImpact'
import type { AdvisoryContext } from './ports'

export type UpcomingEvent = ImportantEvent & { occursOn: string; daysAhead: number }

/** An open commitment with the two facts a surface shows beside it. */
export type CommitmentView = Commitment & { overdue: boolean; daysToDue: number | null }

export interface Client360 {
  client: Client
  household: Household | null
  advisor: Advisor | null
  balanceSheet: BalanceSheet
  assets: readonly Asset[]
  liabilities: readonly Liability[]
  portfolio: Portfolio | null
  deviations: readonly AllocationDeviation[]
  currencyExposure: readonly { currency: Holding['currency']; percent: number }[]
  sectorExposure: readonly { sector: Sector; percent: number }[]
  goals: readonly Goal[]
  /** Newest first. */
  interactions: readonly Interaction[]
  /** Notes recorded and analysed but not yet confirmed. */
  pendingCandidates: readonly MemoryCandidate[]
  contextFacts: readonly ContextFact[]
  /** Every commitment, newest first. */
  commitments: readonly Commitment[]
  /** Open commitments, soonest due first, each saying whether it is overdue. */
  openCommitments: readonly CommitmentView[]
  /** Soonest first, on or after today. */
  upcomingEvents: readonly UpcomingEvent[]
  /** Within 60 days, soonest first. */
  reminders: readonly Reminder[]
  opportunities: readonly Opportunity[]
  health: RelationshipHealth
  signals: readonly Signal[]
  nextBestAction: NextBestAction | null
  flags: ClientFlags
  /** Market-to-Client: the open market events this record is exposed to, most relevant first. Empty is an answer. */
  marketImpacts: readonly ClientMarketImpact[]
  /**
   * The client-relevant moves that have already closed within the standing
   * window: history, quoted at peak, contributing to no priority — so the
   * page can answer "what happened lately" after the urgency has passed.
   */
  recentMarketHistory: readonly MarketChangeSince[]
  lastContact: Interaction | null
  lastMeeting: Interaction | null
  nextMeeting: UpcomingEvent | null
  daysSinceContact: number | null
  today: string
  generatedAt: string
  method: 'rule-based-v1'
}

const REMINDER_HORIZON_DAYS = 60

export async function client360(
  context: AdvisoryContext,
  clientId: ClientId,
): Promise<Client360 | null> {
  const facts = await assembleClientFacts(context, clientId)
  if (!facts) return null
  const { repositories } = context
  const [assets, household, advisor, candidates, ledger] = await Promise.all([
    repositories.wealth.assetsOf(clientId),
    repositories.clients.householdById(facts.client.householdId),
    repositories.clients.advisorById(facts.client.primaryAdvisorId),
    repositories.interactions.candidatesOf(clientId),
    marketLedger(context),
  ])
  const marketHistory = marketChangesSince(
    ledger,
    facts,
    marketWindowStart(null, facts.today),
  ).filter((change) => change.status === 'closed')
  const health = relationshipHealth(facts)
  const signals = signalsFor(facts, health)
  const meeting = nextMeeting(facts)

  return {
    client: facts.client,
    household,
    advisor,
    balanceSheet: facts.balanceSheet,
    assets,
    liabilities: facts.liabilities,
    portfolio: facts.portfolio,
    deviations: facts.portfolio ? allocationDeviations(facts.portfolio) : [],
    currencyExposure: facts.portfolio ? currencyExposure(facts.portfolio) : [],
    sectorExposure: facts.portfolio ? sectorExposure(facts.portfolio) : [],
    goals: facts.goals,
    interactions: facts.interactions,
    pendingCandidates: candidates.filter((c) => c.status === 'pending'),
    contextFacts: facts.contextFacts,
    commitments: facts.commitments,
    openCommitments: openCommitments(facts).map((c) => ({
      ...c,
      overdue: isOverdue(c, facts.today),
      daysToDue: c.dueDate === null ? null : daysBetween(facts.today, c.dueDate),
    })),
    upcomingEvents: upcomingEvents(facts).map((e) => ({
      ...e,
      daysAhead: daysBetween(facts.today, e.occursOn),
    })),
    reminders: remindersDue(facts, REMINDER_HORIZON_DAYS),
    opportunities: facts.opportunities,
    health,
    signals,
    nextBestAction: nextBestAction(facts, signals),
    flags: clientFlags(facts, signals, health),
    marketImpacts: assessClient(ledger.active, facts),
    recentMarketHistory: marketHistory,
    lastContact: lastContact(facts),
    lastMeeting: lastMeeting(facts),
    nextMeeting: meeting
      ? { ...meeting, daysAhead: daysBetween(facts.today, meeting.occursOn) }
      : null,
    daysSinceContact: daysSinceContact(facts),
    today: facts.today,
    generatedAt: context.clock.isoNow(),
    method: 'rule-based-v1',
  }
}
