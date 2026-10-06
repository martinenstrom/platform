/**
 * Daily Command — the advisor-facing orchestration over everything the
 * record already judges: Sentinel's one priority per client, Market-to-
 * Client's episodes, the Meeting Pack's readiness, Client Memory and the
 * lifecycle feed — composed into what the advisor should do next, who can
 * wait, what changed, and the best use of a window of time.
 *
 * Nothing is derived here that another service already derives: the
 * priorities come from `sentinelBrief`, the market from `marketImpactBrief`,
 * the readiness from `meetingPack`, the history from `lifecycleFeed`. This
 * module only translates, filters by office and lifecycle, and composes.
 * The ranking is Sentinel's; the time fit is the domain's. No model is
 * consulted for any of it, and no client datum leaves the process.
 */

import {
  bestUseOfTime,
  compareDailyActions,
  dailyActionOf,
  dataCompletionAction,
  daysBetween,
  lastContact,
  nextMeeting,
  openCommitments,
  openConcerns,
  overdueCommitments,
  relationshipHealth,
  type BestUseOfTime,
  type ClientFacts,
  type ClientSegment,
  type Commitment,
  type ContextFact,
  type DailyAction,
  type DailyClientContext,
  type DailyGap,
  type HealthBand,
  type ImportantEvent,
  type Interaction,
  type MarketEvent,
  type Relevance,
  type SentinelPriority,
  completenessOf,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import { lifecycleFeed, type LifecycleFeedEntry } from './lifecycle'
import { marketImpactBrief, marketLedger, type MarketImpactBrief } from './marketImpact'
import type { MarketEpisode } from './marketEpisodes'
import { meetingCockpit, type MeetingCockpit } from './meetingCockpit'
import { meetingPack, type ReadinessState } from './meetingPack'
import { todayOf, type AdvisoryContext } from './ports'
import { sentinelBrief, type SentinelEntry } from './sentinel'

/* ---------------------------------------------------------------- shapes */

export interface DailyPulse {
  activeClients: number
  /** Clients whose action is in the high band. */
  needAttention: number
  /** Actions whose horizon is now. */
  actNow: number
  meetingsThisWeek: number
  overdueCommitments: number
  /** Active clients with no contact for more than sixty days. */
  silentOver60: number
  /** Financing events (refinancing, maturity) within thirty days. */
  upcomingFinancing: number
  /** Clients at medium or high relevance to an open market episode. */
  affectedByMarket: number
}

export interface DailyMeeting {
  clientId: string
  clientName: string
  officeName: string
  eventId: string
  title: string
  date: string
  daysAhead: number
  /** The Meeting Pack's readiness, where a pack can be read; null when the record cannot carry one. */
  readiness: ReadinessState | null
  /** The client's action, where one is. */
  actionId: string | null
}

export type MarketSuggestedAction = 'proactive-call' | 'raise-at-meeting' | 'monitor'

export interface DailyMarketClient {
  clientId: string
  clientName: string
  relevance: Relevance
  /** The client voiced a concern the episode speaks to. */
  concernMatched: boolean
  /** A meeting within fourteen days where the move belongs on the agenda. */
  meetingSoon: boolean
  suggestedAction: MarketSuggestedAction
  sourceIds: readonly string[]
}

export interface DailyMarketItem {
  episodeId: string
  kind: MarketEpisode['kind']
  direction: 'up' | 'down'
  severity: 'notable' | 'major'
  /** The most material event of the episode: the fact the headline states. */
  lead: MarketEvent
  events: number
  meaningful: number
  high: number
  /** The clients at medium or high relevance, most relevant first. */
  clients: readonly DailyMarketClient[]
  observedAt: string
}

export interface DailyOverdue {
  clientId: string
  clientName: string
  commitmentId: string
  title: string
  dueDate: string
  daysOverdue: number
}

/** A financing event ahead — a refinancing, a maturity — with the loan it concerns where the record names one. */
export interface DailyFinancing {
  clientId: string
  clientName: string
  eventId: string
  eventType: string
  title: string
  date: string
  daysAhead: number
  liabilityId: string | null
  amount: number | null
}

export interface DailyGapItem {
  clientId: string
  clientName: string
  lifecycle: 'active' | 'onboarding'
  gaps: readonly DailyGap[]
}

export interface ChangedClient {
  clientId: string
  clientName: string
  /** The record id the change rests on. */
  sourceId: string
  label: string
  date: string
}

/** What moved in the book since a date — read from the record, never from a remembered snapshot. */
export interface DailyChanges {
  since: string
  newlyOverdue: readonly ChangedClient[]
  completedCommitments: readonly ChangedClient[]
  meetingsBooked: readonly ChangedClient[]
  contactsRecorded: readonly ChangedClient[]
  concernsRaised: readonly ChangedClient[]
  concernsEased: readonly ChangedClient[]
  /** Market episodes that opened since, with how many clients each touches meaningfully. */
  marketOpened: readonly { eventId: string; label: string; meaningful: number; firstSeenAt: string }[]
  lifecycle: readonly LifecycleFeedEntry[]
  total: number
}

export interface DailyTimeWindow {
  minutes: number
  fit: BestUseOfTime
}

export interface DailyCommandView {
  today: string
  generatedAt: string
  /** Hour of the advisor's day, for the greeting; the clock's. */
  hour: number
  advisor: { id: string; displayName: string }
  office: { id: string; displayName: string } | null
  /** The active offices, for narrowing the day to one. */
  offices: readonly { id: string; displayName: string }[]
  pulse: DailyPulse
  now: readonly DailyAction[]
  week: readonly DailyAction[]
  watch: readonly DailyAction[]
  /** Relationships still being taken in: what to complete, never ranked among the book. */
  onboarding: readonly DailyAction[]
  /** Active clients whose record calls for nothing today. */
  quiet: number
  /** Priorities the advisor set aside — snoozed or dismissed — not in the queue. */
  setAside: number
  timeWindows: readonly DailyTimeWindow[]
  meetings: readonly DailyMeeting[]
  market: readonly DailyMarketItem[]
  overdue: readonly DailyOverdue[]
  /** Financing events within ninety days, soonest first; the pulse counts the ones within thirty. */
  financing: readonly DailyFinancing[]
  gaps: readonly DailyGapItem[]
  changes: DailyChanges
  freshness: { marketObservedAt: string | null; scenario: string | null; marketEvents: number }
  method: 'daily-command-v1'
}

export interface DailyCommandOptions {
  officeId?: string
  /** ISO date the "what changed" window starts; yesterday when omitted. */
  since?: string
}

export const TIME_WINDOWS: readonly number[] = [15, 30, 60]
const FINANCING_TYPES = new Set(['mortgage-refinancing', 'loan-maturity'])
const SILENT_DAYS = 60
const FINANCING_DAYS = 30
const FINANCING_HORIZON_DAYS = 90
const MEETING_WEEK_DAYS = 7
const MEETING_SOON_DAYS = 14

/* ------------------------------------------------------------------ view */

export async function dailyCommand(
  context: AdvisoryContext,
  options: DailyCommandOptions = {},
): Promise<DailyCommandView> {
  const { repositories } = context
  const today = todayOf(context)
  const since = options.since ?? addDays(today, -1)
  const [brief, market, clients, offices, advisors] = await Promise.all([
    sentinelBrief(context),
    marketImpactBrief(context),
    repositories.clients.list(),
    repositories.clients.offices(),
    repositories.clients.advisors(),
  ])
  const officeName = new Map(offices.map((o) => [o.id, o.displayName]))
  const inOffice = (officeId: string) => !options.officeId || officeId === options.officeId
  const office = options.officeId
    ? (offices.find((o) => o.id === options.officeId) ?? null)
    : null

  /* The ranked book: one action per client with a priority the advisor has not set aside. */
  const priorities = new Map<string, SentinelPriority>()
  const actions: DailyAction[] = []
  const meetings: DailyMeeting[] = []
  const overdue: DailyOverdue[] = []
  const financing: DailyFinancing[] = []
  const gaps: DailyGapItem[] = []
  const pulse: DailyPulse = {
    activeClients: 0,
    needAttention: 0,
    actNow: 0,
    meetingsThisWeek: 0,
    overdueCommitments: 0,
    silentOver60: 0,
    upcomingFinancing: 0,
    affectedByMarket: 0,
  }
  const byClient = new Map(brief.entries.map((e) => [e.client.id, e]))
  const affected = new Set<string>()
  for (const episode of market.episodes)
    for (const c of episode.affected)
      if (c.relevance !== 'low') affected.add(c.client.id)

  for (const client of clients) {
    if (client.lifecycle.status === 'former') continue
    if (!inOffice(client.officeId)) continue
    const facts = await assembleClientFacts(context, client.id)
    if (!facts) continue
    const summary = summaryOf(facts)
    const health = relationshipHealth(facts)
    const contact = lastContact(facts)
    const meeting = nextMeeting(facts)
    const clientContext: DailyClientContext = {
      id: client.id,
      displayName: client.displayName,
      segment: client.segment,
      officeId: client.officeId,
      officeName: officeName.get(client.officeId) ?? client.officeId,
      lastContact: contact ? { date: contact.date, type: contact.type } : null,
      nextMeeting: meeting?.occursOn ?? null,
      health: health.band,
      aum: facts.balanceSheet.assetsWithBank,
      summary,
    }
    const { completeness, gaps: clientGaps } = completenessOf(summary)

    if (client.lifecycle.status === 'onboarding') {
      actions.push(dataCompletionAction(clientContext))
      if (clientGaps.length > 0)
        gaps.push({ clientId: client.id, clientName: client.displayName, lifecycle: 'onboarding', gaps: clientGaps })
      continue
    }

    pulse.activeClients += 1
    if (affected.has(client.id)) pulse.affectedByMarket += 1
    const silence = contact ? daysBetween(contact.date, today) : null
    if (silence !== null && silence > SILENT_DAYS) pulse.silentOver60 += 1
    for (const c of overdueCommitments(facts)) {
      pulse.overdueCommitments += 1
      overdue.push({
        clientId: client.id,
        clientName: client.displayName,
        commitmentId: c.id,
        title: c.title,
        dueDate: c.dueDate!,
        daysOverdue: daysBetween(c.dueDate!, today),
      })
    }
    for (const e of facts.events) {
      if (e.status !== 'upcoming' || !FINANCING_TYPES.has(e.type)) continue
      const ahead = daysBetween(today, e.date)
      if (ahead < 0 || ahead > FINANCING_HORIZON_DAYS) continue
      if (ahead <= FINANCING_DAYS) pulse.upcomingFinancing += 1
      const liability = e.liabilityId
        ? facts.liabilities.find((l) => l.id === e.liabilityId)
        : undefined
      financing.push({
        clientId: client.id,
        clientName: client.displayName,
        eventId: e.id,
        eventType: e.type,
        title: e.title,
        date: e.date,
        daysAhead: ahead,
        liabilityId: e.liabilityId ?? null,
        amount: liability?.outstandingBalance ?? null,
      })
    }
    if (completeness === 'insufficient')
      gaps.push({ clientId: client.id, clientName: client.displayName, lifecycle: 'active', gaps: clientGaps })

    const entry = byClient.get(client.id)
    const action =
      entry && (entry.status === 'active' || entry.status === 'reviewed')
        ? dailyActionOf(entry.priority, clientContext, today)
        : null
    if (entry) priorities.set(entry.priority.id, entry.priority)
    if (action) actions.push(action)

    if (meeting && daysBetween(today, meeting.occursOn) <= MEETING_WEEK_DAYS) {
      pulse.meetingsThisWeek += 1
      let readiness: ReadinessState | null = null
      try {
        readiness = (await meetingPack(context, client.id, 'executive'))?.readiness.state ?? null
      } catch {
        readiness = null
      }
      meetings.push({
        clientId: client.id,
        clientName: client.displayName,
        officeName: clientContext.officeName,
        eventId: meeting.id,
        title: meeting.title,
        date: meeting.occursOn,
        daysAhead: daysBetween(today, meeting.occursOn),
        readiness,
        actionId: action?.id ?? null,
      })
    }
  }

  const ranked = actions
    .filter((a) => a.actionType !== 'DATA_COMPLETION')
    .sort((a, b) => compareDailyActions(a, b, priorities))
  const now = ranked.filter((a) => a.horizon === 'now')
  const week = ranked.filter((a) => a.horizon === 'week')
  const watch = ranked.filter((a) => a.horizon === 'watch')
  pulse.needAttention = ranked.filter((a) => a.band === 'high').length
  pulse.actNow = now.length
  meetings.sort((a, b) => a.date.localeCompare(b.date) || a.clientName.localeCompare(b.clientName, 'sv'))
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue || a.clientName.localeCompare(b.clientName, 'sv'))
  financing.sort((a, b) => a.daysAhead - b.daysAhead || a.clientName.localeCompare(b.clientName, 'sv'))

  const advisorId = clients[0]?.primaryAdvisorId ?? advisors[0]?.id ?? ''
  const advisor = advisors.find((a) => a.id === advisorId) ?? advisors[0] ?? { id: advisorId, displayName: advisorId }
  const setAside = brief.entries.filter(
    (e) =>
      (e.status === 'snoozed' || e.status === 'dismissed') && inOffice(e.client.office?.id ?? ''),
  ).length
  const quiet = pulse.activeClients - ranked.length

  return {
    today,
    generatedAt: context.clock.isoNow(),
    hour: context.clock.now().getHours(),
    advisor: { id: advisor.id, displayName: advisor.displayName },
    office: office ? { id: office.id, displayName: office.displayName } : null,
    offices: offices
      .filter((o) => o.archivedAt === null)
      .map((o) => ({ id: o.id, displayName: o.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv')),
    pulse,
    now,
    week,
    watch,
    onboarding: actions.filter((a) => a.actionType === 'DATA_COMPLETION'),
    quiet,
    setAside,
    timeWindows: TIME_WINDOWS.map((minutes) => ({
      minutes,
      fit: bestUseOfTime([...now, ...week], minutes),
    })),
    meetings,
    market: marketItemsOf(market, byClient, inOffice, today),
    overdue,
    financing,
    gaps,
    changes: await changesSince(context, since, options.officeId),
    freshness: {
      marketObservedAt: market.observedAt,
      scenario: market.scenario,
      marketEvents: market.events.length,
    },
    method: 'daily-command-v1',
  }
}

/* ------------------------------------------------------------- the market */

function marketItemsOf(
  market: MarketImpactBrief,
  entries: ReadonlyMap<string, SentinelEntry>,
  inOffice: (officeId: string) => boolean,
  today: string,
): DailyMarketItem[] {
  const items: DailyMarketItem[] = []
  for (const episode of market.episodes) {
    const clients: DailyMarketClient[] = []
    for (const c of episode.affected) {
      if (c.relevance === 'low') continue
      const entry = entries.get(c.client.id)
      if (entry && !inOffice(entry.client.office?.id ?? '')) continue
      const concernMatched = c.impacts.some((i) =>
        i.reasons.some((r) => r.kind === 'related-concern' || r.kind === 'drawdown-sensitivity'),
      )
      const meetingSoon =
        entry?.client.nextMeeting !== null &&
        entry?.client.nextMeeting !== undefined &&
        daysBetween(today, entry.client.nextMeeting) <= MEETING_SOON_DAYS
      clients.push({
        clientId: c.client.id,
        clientName: c.client.displayName,
        relevance: c.relevance,
        concernMatched,
        meetingSoon,
        suggestedAction:
          c.relevance === 'high' && (concernMatched || !meetingSoon)
            ? 'proactive-call'
            : meetingSoon
              ? 'raise-at-meeting'
              : 'monitor',
        sourceIds: c.impacts.flatMap((i) => i.sourceIds),
      })
    }
    if (clients.length === 0) continue
    const lead = episode.events[0]!.event
    items.push({
      episodeId: episode.id,
      kind: episode.kind,
      direction: episode.direction,
      severity: episode.severity,
      lead,
      events: episode.events.length,
      meaningful: clients.length,
      high: clients.filter((c) => c.relevance === 'high').length,
      clients,
      observedAt: episode.observedAt,
    })
  }
  return items
}

/* ----------------------------------------------------------- what changed */

export async function changesSince(
  context: AdvisoryContext,
  since: string,
  officeId?: string,
): Promise<DailyChanges> {
  const { repositories } = context
  const today = todayOf(context)
  const clients = (await repositories.clients.list()).filter(
    (c) => c.lifecycle.status !== 'former' && (!officeId || c.officeId === officeId),
  )
  const newlyOverdue: ChangedClient[] = []
  const completedCommitments: ChangedClient[] = []
  const meetingsBooked: ChangedClient[] = []
  const contactsRecorded: ChangedClient[] = []
  const concernsRaised: ChangedClient[] = []
  const concernsEased: ChangedClient[] = []
  const after = (iso: string | null | undefined) => iso !== null && iso !== undefined && iso.slice(0, 10) > since
  for (const client of clients) {
    const facts = await assembleClientFacts(context, client.id)
    if (!facts) continue
    const changed = (sourceId: string, label: string, date: string): ChangedClient => ({
      clientId: client.id,
      clientName: client.displayName,
      sourceId,
      label,
      date,
    })
    for (const c of facts.commitments) {
      if (c.status === 'open' && c.dueDate && c.dueDate > since && c.dueDate < today)
        newlyOverdue.push(changed(c.id, c.title, c.dueDate))
      if (c.status === 'done' && after(c.completedAt))
        completedCommitments.push(changed(c.id, c.title, c.completedAt!))
    }
    for (const e of facts.events) {
      if (e.type === 'client-meeting' && e.status === 'upcoming' && after(e.provenance.createdAt))
        meetingsBooked.push(changed(e.id, e.title, e.date))
    }
    for (const i of facts.interactions) {
      if (i.date > since && isContact(i)) contactsRecorded.push(changed(i.id, i.title, i.date))
    }
    for (const f of facts.contextFacts) {
      if (f.category !== 'concern') continue
      if (f.status === 'active' && after(f.provenance.createdAt))
        concernsRaised.push(changed(f.id, f.statement, f.statusAt))
      if (f.status === 'resolved' && f.statusAt > since)
        concernsEased.push(changed(f.id, f.statement, f.statusAt))
    }
  }
  const ledger = await marketLedger(context)
  const brief = await marketImpactBrief(context)
  const marketOpened = ledger.active
    .filter((e) => e.firstSeenAt.slice(0, 10) > since)
    .map((e) => ({
      eventId: e.id,
      label: e.label,
      meaningful: brief.events.find((entry) => entry.event.id === e.id)?.meaningful ?? 0,
      firstSeenAt: e.firstSeenAt,
    }))
  const lifecycle = await lifecycleFeed(context, {
    since: addDays(since, 1),
    ...(officeId ? { officeId } : {}),
  })
  return {
    since,
    newlyOverdue,
    completedCommitments,
    meetingsBooked,
    contactsRecorded,
    concernsRaised,
    concernsEased,
    marketOpened,
    lifecycle,
    total:
      newlyOverdue.length +
      completedCommitments.length +
      meetingsBooked.length +
      contactsRecorded.length +
      concernsRaised.length +
      concernsEased.length +
      marketOpened.length +
      lifecycle.length,
  }
}

/* ------------------------------------------------------------- call brief */

export interface CallBrief {
  client: {
    id: string
    displayName: string
    segment: ClientSegment
    officeId: string
    officeName: string | null
  }
  /** The action the call serves, where the record calls for one. */
  action: DailyAction | null
  /** The reasons, primary first — "why call now". */
  whyNow: DailyAction['reasons']
  lastInteraction: Interaction | null
  /** Active concerns and the latest context the record holds. */
  concerns: readonly ContextFact[]
  openCommitments: readonly (Commitment & { overdue: boolean; daysToDue: number | null })[]
  /** The client-relevant market changes the cockpit would raise, medium and high relevance. */
  market: MeetingCockpit['market']
  /** Three questions, from the cockpit's own rules. */
  questions: MeetingCockpit['advisorQuestions']
  clientMayAsk: MeetingCockpit['clientQuestions']
  watchOut: MeetingCockpit['risks']
  objective: DailyAction['objective']
  time: DailyAction['time']
  nextMeeting: ImportantEvent | null
  health: HealthBand
  titles: Readonly<Record<string, string>>
  today: string
  generatedAt: string
  method: 'call-brief-v1'
}

/** Everything for a call, compact: not a pack, a page. */
export async function callBrief(
  context: AdvisoryContext,
  clientId: string,
): Promise<CallBrief | null> {
  const [facts, cockpit] = await Promise.all([
    assembleClientFacts(context, clientId),
    meetingCockpit(context, clientId),
  ])
  if (!facts || !cockpit) return null
  const today = todayOf(context)
  const office = cockpit.identity.office
  const contact = lastContact(facts)
  const meeting = nextMeeting(facts)
  const summary = summaryOf(facts)
  const action = cockpit.sentinel
    ? dailyActionOf(
        cockpit.sentinel,
        {
          id: facts.client.id,
          displayName: facts.client.displayName,
          segment: facts.client.segment,
          officeId: facts.client.officeId,
          officeName: office?.displayName ?? facts.client.officeId,
          lastContact: contact ? { date: contact.date, type: contact.type } : null,
          nextMeeting: meeting?.occursOn ?? null,
          health: cockpit.health.band,
          aum: facts.balanceSheet.assetsWithBank,
          summary,
        },
        today,
      )
    : null
  return {
    client: {
      id: facts.client.id,
      displayName: facts.client.displayName,
      segment: facts.client.segment,
      officeId: facts.client.officeId,
      officeName: office?.displayName ?? null,
    },
    action,
    whyNow: action?.reasons ?? [],
    lastInteraction: contact,
    concerns: openConcerns(facts),
    openCommitments: openCommitments(facts).map((c) => ({
      ...c,
      overdue: c.dueDate !== null && daysBetween(c.dueDate, today) > 0,
      daysToDue: c.dueDate === null ? null : daysBetween(today, c.dueDate),
    })),
    market: cockpit.market,
    questions: cockpit.advisorQuestions.slice(0, 3),
    clientMayAsk: cockpit.clientQuestions.slice(0, 3),
    watchOut: cockpit.risks,
    objective: action?.objective ?? 'personal-check-in',
    time: action?.time ?? { minMinutes: 10, maxMinutes: 15 },
    nextMeeting: meeting,
    health: cockpit.health.band,
    titles: cockpit.titles,
    today,
    generatedAt: context.clock.isoNow(),
    method: 'call-brief-v1',
  }
}

/* --------------------------------------------------------------- helpers */

function summaryOf(facts: ClientFacts) {
  return {
    hasContact: lastContact(facts) !== null,
    hasRiskProfile: facts.client.riskProfile !== null,
    hasFinancialOverview: facts.balanceSheet.totalAssets > 0,
    hasMeetingBooked: nextMeeting(facts) !== null,
  }
}

const CONTACT_TYPES = new Set([
  'meeting',
  'phone',
  'email',
  'teams',
  'portfolio-discussion',
  'financing-discussion',
  'follow-up',
])
function isContact(i: Interaction): boolean {
  return CONTACT_TYPES.has(i.type)
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
