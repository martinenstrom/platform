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
  type OfficeId,
  type RelationshipHealth,
  type RiskProfile,
  type Signal,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import { directoryMetricsOf, officeBooksOf, type OfficeBook } from './officeBook'
import { todayOf, type AdvisoryContext } from './ports'

export interface ClientDirectoryRow {
  id: string
  displayName: string
  segment: ClientSegment
  advisorName: string
  /** The office the relationship originates from, and how a surface names it. */
  officeId: OfficeId
  officeName: string
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
  /** The book office by office, in the register's order; the same rows summed per office. */
  offices: readonly OfficeBook[]
  /** ISO date every derivation used. */
  today: string
  /** ISO timestamp. */
  generatedAt: string
  method: 'rule-based-v1'
}

export async function clientDirectory(
  context: AdvisoryContext,
): Promise<ClientDirectory> {
  const { repositories } = context
  const [clients, offices] = await Promise.all([
    repositories.clients.list(),
    repositories.clients.offices(),
  ])
  const officeNames = new Map(offices.map((o) => [o.id, o.displayName]))
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
      officeId: client.officeId,
      officeName: officeNames.get(client.officeId) ?? client.officeId,
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

  return {
    rows,
    metrics: directoryMetricsOf(rows, today),
    offices: officeBooksOf(offices, rows, today),
    today,
    generatedAt: context.clock.isoNow(),
    method: 'rule-based-v1',
  }
}
