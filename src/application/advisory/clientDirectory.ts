/**
 * The client directory — every relationship read once, with the figures,
 * the health, the flags and the next best action the command centre lists
 * and filters on.
 *
 * Derived on the server from the record and the clock; the surface receives
 * rows and metrics as typed data and sorts or filters them as presentation.
 * Nothing here is stored, so a rule change tomorrow changes every row
 * tomorrow.
 */

import {
  clientFlags,
  daysBetween,
  daysSinceContact,
  lastContact,
  nextBestAction,
  nextMeeting,
  openCommitments,
  openOpportunityValue,
  overdueCommitments,
  relationshipHealth,
  signalsFor,
  upcomingEvents,
  type ClientFlags,
  type ClientSegment,
  type InteractionType,
  type NextBestAction,
  type RelationshipHealth,
  type RiskProfile,
  type Signal,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import { todayOf, type AdvisoryContext } from './ports'

export interface ClientDirectoryRow {
  id: string
  displayName: string
  segment: ClientSegment
  advisorName: string
  /** ISO date. */
  relationshipSince: string
  riskProfile: RiskProfile
  /** Total assets, the client's whole estimated wealth. */
  estimatedWealth: number
  /** Assets the firm holds or manages. */
  aum: number
  liquidity: number
  loans: number
  netWorth: number
  health: RelationshipHealth
  lastContact: { date: string; type: InteractionType } | null
  daysSinceContact: number | null
  /** ISO date of the next booked meeting, where one is. */
  nextMeeting: string | null
  /** The three highest-ranked signals; the count says how many there are. */
  signals: readonly Signal[]
  signalCount: number
  highPrioritySignals: number
  openCommitments: number
  overdueCommitments: number
  activeOpportunities: number
  opportunityValue: number
  nextBestAction: NextBestAction | null
  flags: ClientFlags
  /** Events other than meetings within the next 30 days. */
  eventsWithin30Days: number
}

export interface ClientDirectoryMetrics {
  totalClients: number
  totalAum: number
  estimatedWealth: number
  needingAttention: number
  /** Meetings booked within the next 30 days. */
  upcomingMeetings: number
  openCommitments: number
  overdueCommitments: number
  activeOpportunities: number
  opportunityValue: number
}

export interface ClientDirectory {
  rows: readonly ClientDirectoryRow[]
  metrics: ClientDirectoryMetrics
  /** ISO date every derivation used. */
  today: string
  /** ISO timestamp. */
  generatedAt: string
  method: 'rule-based-v1'
}

const MEETING_WINDOW_DAYS = 30

export async function clientDirectory(
  context: AdvisoryContext,
): Promise<ClientDirectory> {
  const { repositories } = context
  const clients = await repositories.clients.list()
  const rows: ClientDirectoryRow[] = []

  for (const client of [...clients].sort((a, b) =>
    a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0,
  )) {
    const facts = await assembleClientFacts(context, client.id)
    if (!facts) continue
    const advisor = await repositories.clients.advisorById(client.primaryAdvisorId)
    const health = relationshipHealth(facts)
    const signals = signalsFor(facts, health)
    const contact = lastContact(facts)
    const meeting = nextMeeting(facts)
    const open = openCommitments(facts)
    const overdue = overdueCommitments(facts)
    const liveOpportunities = facts.opportunities.filter(
      (o) => !['won', 'lost'].includes(o.status),
    )

    rows.push({
      id: client.id,
      displayName: client.displayName,
      segment: client.segment,
      advisorName: advisor?.displayName ?? client.primaryAdvisorId,
      relationshipSince: client.relationshipSince,
      riskProfile: client.riskProfile,
      estimatedWealth: facts.balanceSheet.totalAssets,
      aum: facts.balanceSheet.assetsWithBank,
      liquidity: facts.balanceSheet.liquidity,
      loans: facts.balanceSheet.totalLiabilities,
      netWorth: facts.balanceSheet.netWorth,
      health,
      lastContact: contact ? { date: contact.date, type: contact.type } : null,
      daysSinceContact: daysSinceContact(facts),
      nextMeeting: meeting?.occursOn ?? null,
      signals: signals.slice(0, 3),
      signalCount: signals.length,
      highPrioritySignals: signals.filter((s) => s.priority === 'high').length,
      openCommitments: open.length,
      overdueCommitments: overdue.length,
      activeOpportunities: liveOpportunities.length,
      opportunityValue: openOpportunityValue(facts.opportunities),
      nextBestAction: nextBestAction(facts, signals),
      flags: clientFlags(facts, signals, health),
      eventsWithin30Days: upcomingEvents(facts).filter(
        (e) => e.type !== 'client-meeting' && daysBetween(facts.today, e.occursOn) <= 30,
      ).length,
    })
  }

  const today = todayOf(context)
  const metrics: ClientDirectoryMetrics = {
    totalClients: rows.length,
    totalAum: rows.reduce((sum, r) => sum + r.aum, 0),
    estimatedWealth: rows.reduce((sum, r) => sum + r.estimatedWealth, 0),
    needingAttention: rows.filter((r) => r.flags.needsAttention).length,
    upcomingMeetings: rows.filter(
      (r) =>
        r.nextMeeting !== null &&
        daysBetween(today, r.nextMeeting) <= MEETING_WINDOW_DAYS,
    ).length,
    openCommitments: rows.reduce((sum, r) => sum + r.openCommitments, 0),
    overdueCommitments: rows.reduce((sum, r) => sum + r.overdueCommitments, 0),
    activeOpportunities: rows.reduce((sum, r) => sum + r.activeOpportunities, 0),
    opportunityValue: rows.reduce((sum, r) => sum + r.opportunityValue, 0),
  }

  return {
    rows,
    metrics,
    today,
    generatedAt: context.clock.isoNow(),
    method: 'rule-based-v1',
  }
}
