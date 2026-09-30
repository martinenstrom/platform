/**
 * Meeting Cockpit, read once: everything the advisor needs for THIS
 * meeting, assembled from the same record Client 360 shows, the client's
 * one Sentinel priority, the meeting baseline and the client-relevant
 * market history — and handed to the surface as typed state. The surface
 * renders it and recomputes nothing.
 *
 * Two other doors live here: the meeting-scoped question, answered from
 * the same read model or, for what the client once said, from the
 * relationship memory; and the baseline capture that runs when a meeting
 * is confirmed, so the next preparation compares against what was known.
 */

import {
  assessClient,
  changesSince,
  daysBetween,
  lastContact,
  lastMeeting,
  meetingCockpitCore,
  nextMeeting,
  prioritiseClient,
  relationshipHealth,
  searchClientMemory,
  signalsFor,
  snapshotOf,
  type Advisor,
  type BalanceSheet,
  type Client,
  type ClientId,
  type Household,
  type Interaction,
  type MeetingChanges,
  type MeetingCockpitCore,
  type MeetingSnapshot,
  type MemoryAnswer,
  type Office,
  type RelationshipHealth,
  type UpcomingEvent,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import { marketChangesSince, marketLedger } from './marketImpact'
import { todayOf, type AdvisoryContext } from './ports'
import type { SentinelEntry } from './sentinel'

export interface MeetingCockpit extends MeetingCockpitCore {
  identity: {
    client: Client
    advisor: Advisor | null
    household: Household | null
    office: Office | null
  }
  meeting: {
    event: UpcomingEvent | null
    daysAhead: number | null
    /** Scheduled when a client meeting is booked; otherwise the advisor prepares a call or review. */
    mode: 'scheduled' | 'unscheduled'
  }
  lastMeeting: Interaction | null
  health: RelationshipHealth
  balanceSheet: BalanceSheet
  changes: MeetingChanges
  baseline: Pick<MeetingSnapshot, 'id' | 'meetingDate' | 'capturedAt'> | null
  /** The priority as the queue would show it, for the same words the queue uses; null when the record calls for nothing. */
  sentinelEntry: SentinelEntry | null
  /** ISO date the market window starts. */
  marketWindowStart: string
  /** Display titles for every record id the sections point at, so a source can be named. */
  titles: Readonly<Record<string, string>>
  today: string
  generatedAt: string
}

export async function meetingCockpit(
  context: AdvisoryContext,
  clientId: ClientId,
): Promise<MeetingCockpit | null> {
  const { repositories } = context
  const facts = await assembleClientFacts(context, clientId)
  if (!facts) return null
  const [assets, household, advisor, office, snapshot, ledger, dispositions] =
    await Promise.all([
      repositories.wealth.assetsOf(clientId),
      repositories.clients.householdById(facts.client.householdId),
      repositories.clients.advisorById(facts.client.primaryAdvisorId),
      repositories.clients.officeById(facts.client.officeId),
      repositories.meetingSnapshots.latestFor(clientId),
      marketLedger(context),
      repositories.sentinel.dispositions(),
    ])
  const health = relationshipHealth(facts)
  const signals = signalsFor(facts, health)
  const changes = changesSince(snapshot, facts)
  /* Only what the advisor should be ready to talk about: low relevance stays on Client 360. */
  const market = marketChangesSince(ledger, facts, changes.since).filter(
    (change) => change.impact.relevance !== 'low',
  )
  const sentinel = prioritiseClient(
    facts,
    health,
    signals,
    assessClient(ledger.active, facts),
  )
  const meeting = nextMeeting(facts)
  const core = meetingCockpitCore({
    facts,
    assets,
    health,
    signals,
    changes,
    snapshot,
    market,
    sentinel,
    meeting,
  })
  void dispositions

  const titles: Record<string, string> = {}
  for (const c of facts.commitments) titles[c.id] = c.title
  for (const e of facts.events) titles[e.id] = e.title
  for (const l of facts.liabilities) titles[l.id] = l.title
  for (const g of facts.goals) titles[g.id] = g.title
  for (const f of facts.contextFacts) titles[f.id] = f.statement
  for (const a of assets) titles[a.id] = a.title
  for (const i of facts.interactions) titles[i.id] = i.title
  for (const o of facts.opportunities) titles[o.id] = o.title
  if (facts.portfolio) titles[facts.portfolio.id] = 'Portföljen'
  if (snapshot) titles[snapshot.id] = `Baslinje ${snapshot.meetingDate}`
  for (const h of facts.portfolio?.holdings ?? []) titles[h.id] = h.name
  for (const m of market) titles[m.impact.eventId] = m.impact.event.label

  const contact = lastContact(facts)
  const sentinelEntry: SentinelEntry | null = sentinel
    ? {
        priority: sentinel,
        status: 'active',
        disposition: null,
        client: {
          id: facts.client.id,
          displayName: facts.client.displayName,
          segment: facts.client.segment,
          advisorName: advisor?.displayName ?? facts.client.primaryAdvisorId,
          office: office ? { id: office.id, displayName: office.displayName } : null,
          aum: facts.balanceSheet.assetsWithBank,
          totalWealth: facts.balanceSheet.totalAssets,
          health,
          lastContact: contact ? { date: contact.date, type: contact.type } : null,
          nextMeeting: meeting?.occursOn ?? null,
        },
      }
    : null

  return {
    ...core,
    identity: { client: facts.client, advisor, household, office },
    meeting: {
      event: meeting,
      daysAhead: meeting ? daysBetween(facts.today, meeting.occursOn) : null,
      mode: meeting ? 'scheduled' : 'unscheduled',
    },
    lastMeeting: lastMeeting(facts),
    health,
    balanceSheet: facts.balanceSheet,
    changes,
    baseline: snapshot
      ? {
          id: snapshot.id,
          meetingDate: snapshot.meetingDate,
          capturedAt: snapshot.capturedAt,
        }
      : null,
    sentinelEntry,
    marketWindowStart: changes.since,
    titles,
    today: facts.today,
    generatedAt: context.clock.isoNow(),
  }
}

/* ------------------------------------------------------------ the baseline */

/**
 * Capture the baseline for a recorded meeting from the record as it stands
 * now — after the meeting's own facts, promises and events were confirmed,
 * so the next preparation compares against what was known when the
 * meeting closed.
 */
export async function captureMeetingSnapshot(
  context: AdvisoryContext,
  clientId: ClientId,
  meetingInteractionId: string,
  meetingDate: string,
): Promise<MeetingSnapshot | null> {
  const facts = await assembleClientFacts(context, clientId)
  if (!facts) return null
  const snapshot = snapshotOf(
    facts,
    meetingInteractionId,
    meetingDate,
    context.clock.isoNow(),
  )
  await context.repositories.meetingSnapshots.save(snapshot)
  return snapshot
}

/* ------------------------------------------------------------- ask JARVIS */

export interface AskBeforeMeetingInput {
  clientId: string
  question: string
}

/** What the meeting-scoped question was read as asking for, answered from the cockpit or the memory. */
export type MeetingAnswer =
  | { kind: 'changes'; changes: MeetingChanges; market: MeetingCockpit['market'] }
  | { kind: 'promises'; promises: MeetingCockpit['promises'] }
  | { kind: 'market'; market: MeetingCockpit['market'] }
  | { kind: 'agenda'; agenda: MeetingCockpit['agenda']; focus: MeetingCockpit['focus'] }
  | { kind: 'memory'; answer: MemoryAnswer }

export type AskBeforeMeetingResult =
  | {
      ok: true
      answer: MeetingAnswer
      titles: MeetingCockpit['titles']
      askedAt: string
      method: 'meeting-rules-v1'
    }
  | { ok: false; code: 'NOT_FOUND' | 'EMPTY_QUESTION' }

const SAID = /\b(sa|sade|nämnde|tyckte|said|mention\w*)\b/iu
const PROMISES =
  /\b(lovat|lovade|löfte\w*|åtagande\w*|promis\w*|commit\w*)\b|inte (gjort|klart|slutfört|hunnit)/iu
const CHANGES =
  /\b(förändr\w*|ändrat\w*|hänt|changed|change|since)\b|sedan (sist|senast|förra|september|augusti)/iu
const MARKET = /\b(marknad\w*|market\w*|ränt\w*|börs\w*|kurs\w*|förklara)\b/iu
const AGENDA = /\b(agenda\w*|fokus|huvudfokus|handla om|dagordning)\b/iu

/**
 * A question before the meeting, answered without a model: what changed,
 * what is owed, what the market did, why something is on the agenda — from
 * the cockpit's own typed sections; and what the client said, from the
 * relationship memory.
 */
export async function askBeforeMeeting(
  context: AdvisoryContext,
  input: AskBeforeMeetingInput,
): Promise<AskBeforeMeetingResult> {
  const question = input.question.trim()
  if (question.length === 0) return { ok: false, code: 'EMPTY_QUESTION' }
  const cockpit = await meetingCockpit(context, input.clientId)
  if (!cockpit) return { ok: false, code: 'NOT_FOUND' }
  const askedAt = context.clock.isoNow()
  const done = (answer: MeetingAnswer): AskBeforeMeetingResult => ({
    ok: true,
    answer,
    titles: cockpit.titles,
    askedAt,
    method: 'meeting-rules-v1',
  })

  if (!SAID.test(question)) {
    if (PROMISES.test(question))
      return done({ kind: 'promises', promises: cockpit.promises })
    if (CHANGES.test(question)) {
      return done({ kind: 'changes', changes: cockpit.changes, market: cockpit.market })
    }
    if (MARKET.test(question)) return done({ kind: 'market', market: cockpit.market })
    if (AGENDA.test(question)) {
      return done({ kind: 'agenda', agenda: cockpit.agenda, focus: cockpit.focus })
    }
  }

  const { repositories } = context
  const [interactions, contextFacts, commitments, events, goals, portfolio, liabilities] =
    await Promise.all([
      repositories.interactions.interactionsOf(input.clientId),
      repositories.context.factsOf(input.clientId),
      repositories.commitments.commitmentsOf(input.clientId),
      repositories.events.eventsOf(input.clientId),
      repositories.goals.goalsOf(input.clientId),
      repositories.portfolios.portfolioOf(input.clientId),
      repositories.wealth.liabilitiesOf(input.clientId),
    ])
  const answer = searchClientMemory(question, {
    interactions,
    contextFacts,
    commitments,
    events,
    goals,
    holdings: portfolio?.holdings ?? [],
    liabilities,
    today: todayOf(context),
  })
  return done({ kind: 'memory', answer })
}
