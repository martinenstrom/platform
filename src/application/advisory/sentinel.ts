/**
 * The morning brief — every client's one priority, ranked, with the facts
 * a row needs beside it, and the advisor's dispositions applied.
 *
 * Derived on every read from the same facts Client 360 shows: a completed
 * promise, a passed meeting or a fresh call changes the brief because it
 * changed the record. The only thing Sentinel writes is a disposition —
 * reviewed, snoozed until a date, dismissed — bound to the priority's
 * fingerprint, so a dismissal lapses when the facts move.
 */

import {
  assessClient,
  comparePriorities,
  daysBetween,
  isIsoDate,
  lastContact,
  nextMeeting,
  prioritiseClient,
  relationshipHealth,
  signalsFor,
  statusOf,
  type ClientSegment,
  type DispositionStatus,
  type InteractionType,
  type PriorityStatus,
  type RelationshipHealth,
  type SentinelDisposition,
  type SentinelPriority,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import { activeMarketEvents } from './marketImpact'
import { todayOf, type AdvisoryContext } from './ports'

export interface SentinelClient {
  id: string
  displayName: string
  segment: ClientSegment
  advisorName: string
  /** The office the relationship originates from, for grouping the queue; null when the register does not know it. */
  office: { id: string; displayName: string } | null
  aum: number
  totalWealth: number
  health: RelationshipHealth
  lastContact: { date: string; type: InteractionType } | null
  /** ISO date of the next booked meeting, where one is. */
  nextMeeting: string | null
}

export interface SentinelEntry {
  priority: SentinelPriority
  status: PriorityStatus
  /** The disposition that decides the status today, where one does. */
  disposition: SentinelDisposition | null
  client: SentinelClient
}

export interface SentinelMetrics {
  /** Active priorities of critical or high severity. */
  clientsNeedingAttention: number
  /** Active priorities whose horizon is today. */
  actToday: number
  /** Clients with a meeting within seven days. */
  meetingsWithin7Days: number
  /** Overdue promises across every client. */
  overdueCommitments: number
  /** Active relationship-risk priorities. */
  relationshipRisks: number
  /** Timely opportunities carried by active priorities. */
  opportunities: number
  /** Clients whose record calls for nothing. */
  quietClients: number
  /** Priorities the advisor has set aside for now. */
  snoozed: number
}

export interface SentinelBrief {
  /** Every client's priority, ranked; every status included. */
  entries: readonly SentinelEntry[]
  /** Clients with no priority at all, by name. */
  quiet: readonly { id: string; displayName: string }[]
  metrics: SentinelMetrics
  today: string
  generatedAt: string
  method: 'sentinel-v1'
}

/** The disposition that decides the status, newest first among the ones that still apply. */
function decidingDisposition(
  priority: SentinelPriority,
  dispositions: readonly SentinelDisposition[],
  status: PriorityStatus,
): SentinelDisposition | null {
  if (status === 'active') return null
  return (
    [...dispositions]
      .filter((d) => d.priorityId === priority.id && d.status === status)
      .sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null
  )
}

export async function sentinelBrief(context: AdvisoryContext): Promise<SentinelBrief> {
  const { repositories } = context
  const today = todayOf(context)
  const clients = await repositories.clients.list()
  const dispositions = await repositories.sentinel.dispositions()
  const offices = new Map((await repositories.clients.offices()).map((o) => [o.id, o]))
  /* The market, once for the whole brief: the same events every client is judged against. */
  const events = await activeMarketEvents(context)
  const entries: SentinelEntry[] = []
  const quiet: { id: string; displayName: string }[] = []
  let meetingsWithin7Days = 0
  let overdueCommitments = 0

  for (const client of clients) {
    const facts = await assembleClientFacts(context, client.id)
    if (!facts) continue
    const health = relationshipHealth(facts)
    const signals = signalsFor(facts, health)
    const meeting = nextMeeting(facts)
    if (meeting && daysBetween(today, meeting.occursOn) <= 7) meetingsWithin7Days += 1
    overdueCommitments += facts.commitments.filter(
      (c) =>
        c.status === 'open' && c.dueDate !== null && daysBetween(c.dueDate, today) > 0,
    ).length

    const priority = prioritiseClient(facts, health, signals, assessClient(events, facts))
    if (!priority) {
      quiet.push({ id: client.id, displayName: client.displayName })
      continue
    }
    const status = statusOf(priority, dispositions, today)
    const advisor = await repositories.clients.advisorById(client.primaryAdvisorId)
    const contact = lastContact(facts)
    const office = offices.get(client.officeId)
    entries.push({
      priority,
      status,
      disposition: decidingDisposition(priority, dispositions, status),
      client: {
        id: client.id,
        displayName: client.displayName,
        segment: client.segment,
        advisorName: advisor?.displayName ?? client.primaryAdvisorId,
        office: office ? { id: office.id, displayName: office.displayName } : null,
        aum: facts.balanceSheet.assetsWithBank,
        totalWealth: facts.balanceSheet.totalAssets,
        health,
        lastContact: contact ? { date: contact.date, type: contact.type } : null,
        nextMeeting: meeting?.occursOn ?? null,
      },
    })
  }

  entries.sort(
    (a, b) =>
      comparePriorities(a.priority, b.priority) ||
      a.client.displayName.localeCompare(b.client.displayName, 'sv'),
  )
  quiet.sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'))

  const active = entries.filter((e) => e.status === 'active' || e.status === 'reviewed')
  const metrics: SentinelMetrics = {
    clientsNeedingAttention: active.filter(
      (e) => e.priority.severity === 'critical' || e.priority.severity === 'high',
    ).length,
    actToday: active.filter((e) => e.priority.horizon === 'today').length,
    meetingsWithin7Days,
    overdueCommitments,
    relationshipRisks: active.filter(
      (e) =>
        e.priority.theme === 'relationship-risk' ||
        e.priority.drivers.some((d) => d.kind === 'health' && d.band === 'at-risk'),
    ).length,
    opportunities: active.reduce(
      (sum, e) => sum + e.priority.drivers.filter((d) => d.kind === 'opportunity').length,
      0,
    ),
    quietClients: quiet.length,
    snoozed: entries.filter((e) => e.status === 'snoozed').length,
  }

  return {
    entries,
    quiet,
    metrics,
    today,
    generatedAt: context.clock.isoNow(),
    method: 'sentinel-v1',
  }
}

export interface DisposeInput {
  priorityId: string
  status: DispositionStatus
  /** ISO date a snooze ends; required for a snooze. */
  until?: string | null
  reason?: string | null
}

export type DisposeResult =
  | { ok: true; status: PriorityStatus; disposition: SentinelDisposition }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_UNTIL' }

/**
 * The advisor's word on a priority. The priority is re-derived first, so a
 * decision is always about what the record says now, and the disposition
 * carries that fingerprint.
 */
export async function disposePriority(
  context: AdvisoryContext,
  input: DisposeInput,
): Promise<DisposeResult> {
  const { repositories } = context
  const today = todayOf(context)
  const [clientId] = input.priorityId.split(':')
  if (!clientId) return { ok: false, code: 'NOT_FOUND' }
  const facts = await assembleClientFacts(context, clientId)
  if (!facts) return { ok: false, code: 'NOT_FOUND' }
  /* Re-derived against the same market the brief saw, so a market-anchored or market-lifted priority is found as shown. */
  const events = await activeMarketEvents(context)
  const health = relationshipHealth(facts)
  const priority = prioritiseClient(
    facts,
    health,
    signalsFor(facts, health),
    assessClient(events, facts),
  )
  if (!priority || priority.id !== input.priorityId)
    return { ok: false, code: 'NOT_FOUND' }

  let until: string | null = null
  if (input.status === 'snoozed') {
    if (!input.until || !isIsoDate(input.until) || daysBetween(today, input.until) <= 0) {
      return { ok: false, code: 'INVALID_UNTIL' }
    }
    until = input.until
  }

  const disposition: SentinelDisposition = {
    priorityId: priority.id,
    clientId: priority.clientId,
    status: input.status,
    fingerprint: priority.fingerprint,
    at: context.clock.isoNow(),
    by: facts.client.primaryAdvisorId,
    until,
    reason: input.reason?.trim() ? input.reason.trim() : null,
  }
  await repositories.sentinel.addDisposition(disposition)
  const dispositions = await repositories.sentinel.dispositions()
  return { ok: true, status: statusOf(priority, dispositions, today), disposition }
}
