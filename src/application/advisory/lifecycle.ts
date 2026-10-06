/**
 * The relationship lifecycle as acts on the record: a client is created,
 * activated, moved, handed to another advisor, edited, closed and brought
 * back; what a closure would leave open is read before it happens; how far
 * an onboarding has come is counted; the book's history is listed.
 *
 * Every act is one unit of work — the client, its office stretches, the
 * records it touches and the lifecycle event land together or not at all —
 * and every identity is minted by the record. Nothing is deleted: a closed
 * relationship keeps its dossier, its memory and its history; the event
 * says what happened and when.
 */

import {
  closureReview,
  contributesToActiveBook,
  onboardingOverview,
  similarClients,
  transition,
  type AdvisorId,
  type Asset,
  type Client,
  type ClientId,
  type ClientSegment,
  type ClosureReason,
  type ClosureReview,
  type CommunicationChannel,
  type GoalKind,
  type ImportantEvent,
  type LifecycleEvent,
  type LifecycleEventKind,
  type LifecycleStatus,
  type OfficeId,
  type OnboardingOverview,
  type Provenance,
  type RiskProfile,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import { todayOf, type AdvisoryContext } from './ports'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u

/* ---------------------------------------------------------- similarity */

export interface SimilarRelationship {
  id: ClientId
  displayName: string
  status: LifecycleStatus
  officeName: string
  /** ISO date the relationship ended, where it did. */
  closedOn: string | null
}

/** Relationships whose name is close to the one being added: a warning the surface shows, never a block. */
export async function similarRelationships(
  context: AdvisoryContext,
  displayName: string,
): Promise<readonly SimilarRelationship[]> {
  const { repositories } = context
  const [clients, offices] = await Promise.all([
    repositories.clients.list(),
    repositories.clients.offices(),
  ])
  const officeNames = new Map(offices.map((o) => [o.id, o.displayName]))
  return similarClients(displayName, clients).map((client) => ({
    id: client.id,
    displayName: client.displayName,
    status: client.lifecycle.status,
    officeName: officeNames.get(client.officeId) ?? client.officeId,
    closedOn: client.lifecycle.closure?.effectiveDate ?? null,
  }))
}

/* -------------------------------------------------------------- create */

export interface CreateClientInput {
  displayName: string
  /** The household's name where it differs from the client's; the client's otherwise. */
  householdName?: string | null
  segment: ClientSegment
  officeId: OfficeId
  advisorId: AdvisorId
  /** ISO date the Private Banking relationship began. */
  relationshipSince: string
  status: 'onboarding' | 'active'
  dateOfBirth?: string | null
  riskProfile?: RiskProfile | null
  preferredChannel?: CommunicationChannel
  annualIncome?: number | null
  /** What is known of the finances at the start — each figure recorded as the client's own statement, dated today. */
  initialFinancial?: {
    aum?: number | null
    totalWealth?: number | null
    liquidity?: number | null
    externalAssets?: number | null
    debt?: {
      amount: number
      ratePercent: number
      interestType: 'fixed' | 'variable'
    } | null
  }
  initialContext?: {
    goal?: { kind: GoalKind; title: string } | null
    /** ISO date of the first booked meeting. */
    nextMeeting?: string | null
    importantEvent?: { title: string; date: string } | null
    concern?: string | null
    note?: string | null
  }
  /** Create although a similar relationship exists. */
  acknowledgeSimilar?: boolean
  by: AdvisorId
}

export type CreateClientResult =
  | { ok: true; clientId: ClientId; similar: readonly SimilarRelationship[] }
  | { ok: false; code: 'INVALID'; field: string }
  | { ok: false; code: 'OFFICE_NOT_FOUND' | 'OFFICE_ARCHIVED' | 'ADVISOR_NOT_FOUND' }
  | { ok: false; code: 'SIMILAR_EXISTS'; similar: readonly SimilarRelationship[] }

export async function createClient(
  context: AdvisoryContext,
  input: CreateClientInput,
): Promise<CreateClientResult> {
  const { repositories } = context
  const today = todayOf(context)
  const displayName = input.displayName.trim()
  if (displayName.length < 2) return { ok: false, code: 'INVALID', field: 'displayName' }
  if (!ISO_DATE.test(input.relationshipSince))
    return { ok: false, code: 'INVALID', field: 'relationshipSince' }
  if (input.dateOfBirth && !ISO_DATE.test(input.dateOfBirth))
    return { ok: false, code: 'INVALID', field: 'dateOfBirth' }
  if (
    input.initialContext?.nextMeeting &&
    !ISO_DATE.test(input.initialContext.nextMeeting)
  )
    return { ok: false, code: 'INVALID', field: 'nextMeeting' }
  if (
    input.initialContext?.importantEvent &&
    !ISO_DATE.test(input.initialContext.importantEvent.date)
  )
    return { ok: false, code: 'INVALID', field: 'importantEvent' }
  const office = await repositories.clients.officeById(input.officeId)
  if (!office) return { ok: false, code: 'OFFICE_NOT_FOUND' }
  if (office.status !== 'active') return { ok: false, code: 'OFFICE_ARCHIVED' }
  if (!(await repositories.clients.advisorById(input.advisorId)))
    return { ok: false, code: 'ADVISOR_NOT_FOUND' }
  const similar = await similarRelationships(context, displayName)
  if (similar.length > 0 && !input.acknowledgeSimilar)
    return { ok: false, code: 'SIMILAR_EXISTS', similar }

  const clientId = await repositories.transaction(async () => {
    const id = await repositories.ids.mint('client')
    const householdId = await repositories.ids.mint('household')
    const memberId = await repositories.ids.mint('member')
    const stated: Provenance = {
      origin: 'advisor',
      sourceInteractionId: null,
      sourceText: null,
      sourceDate: today,
      createdAt: context.clock.isoNow(),
      createdBy: input.by,
      confidence: 'high',
      confirmedByAdvisor: true,
      confirmedAt: context.clock.isoNow(),
    }
    const client: Client = {
      id,
      householdId,
      officeId: input.officeId,
      displayName,
      segment: input.segment,
      relationshipSince: input.relationshipSince,
      primaryAdvisorId: input.advisorId,
      dateOfBirth: input.dateOfBirth ?? null,
      riskProfile: input.riskProfile ?? null,
      preferredChannel: input.preferredChannel ?? 'email',
      annualIncome: input.annualIncome ?? null,
      currency: 'SEK',
      lifecycle: { status: input.status, since: input.relationshipSince, closure: null },
    }
    await repositories.clients.saveHousehold({
      id: householdId,
      displayName: input.householdName?.trim() || displayName,
      members: [
        {
          id: memberId,
          householdId,
          role: 'client',
          displayName,
          clientId: id,
          ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
        },
      ],
    })
    await repositories.clients.addClient(client)
    await repositories.lifecycle.addOfficeHistory({
      id: await repositories.ids.mint('stretch'),
      clientId: id,
      officeId: input.officeId,
      from: input.relationshipSince,
      to: null,
    })

    const financial = input.initialFinancial ?? {}
    const asset = async (
      kind: Asset['kind'],
      title: string,
      value: number,
      withBank: boolean,
    ) =>
      repositories.wealth.addAsset({
        id: await repositories.ids.mint('asset'),
        clientId: id,
        kind,
        title,
        value,
        valuedAt: today,
        source: 'client-stated',
        withBank,
      })
    let accounted = 0
    if (financial.aum && financial.aum > 0) {
      await asset('other-financial', 'Hos banken (initial uppgift)', financial.aum, true)
      accounted += financial.aum
    }
    if (financial.liquidity && financial.liquidity > 0) {
      await asset('cash', 'Likvida medel (initial uppgift)', financial.liquidity, false)
      accounted += financial.liquidity
    }
    if (financial.externalAssets && financial.externalAssets > 0) {
      await asset(
        'other',
        'Externa tillgångar (initial uppgift)',
        financial.externalAssets,
        false,
      )
      accounted += financial.externalAssets
    }
    if (financial.totalWealth && financial.totalWealth > accounted) {
      await asset(
        'other',
        'Övrig förmögenhet (initial uppgift)',
        financial.totalWealth - accounted,
        false,
      )
    }
    if (financial.debt && financial.debt.amount > 0) {
      await repositories.wealth.addLiability({
        id: await repositories.ids.mint('liability'),
        clientId: id,
        kind: 'other-loan',
        title: 'Skulder (initial uppgift)',
        outstandingBalance: financial.debt.amount,
        interestType: financial.debt.interestType,
        ratePercent: financial.debt.ratePercent,
        maturityDate: null,
        nextReviewDate: null,
        withBank: false,
        valuedAt: today,
      })
    }

    const initial = input.initialContext ?? {}
    if (initial.goal) {
      await repositories.goals.addGoal({
        id: await repositories.ids.mint('goal'),
        clientId: id,
        kind: initial.goal.kind,
        title: initial.goal.title,
        targetAmount: null,
        targetDate: null,
        priority: 'primary',
        progressPercent: 0,
        associatedAssetIds: [],
        status: 'not-started',
        notes: '',
        assessedAt: today,
      })
    }
    const event = async (type: ImportantEvent['type'], title: string, date: string) =>
      repositories.events.addEvent({
        id: await repositories.ids.mint('event'),
        clientId: id,
        type,
        title,
        date,
        recurring: 'none',
        importance: 'normal',
        notes: '',
        reminderRules: [{ daysBefore: 7 }],
        status: 'upcoming',
        provenance: stated,
      })
    if (initial.nextMeeting)
      await event('client-meeting', 'Första möte', initial.nextMeeting)
    if (initial.importantEvent)
      await event('custom', initial.importantEvent.title, initial.importantEvent.date)
    if (initial.concern?.trim()) {
      await repositories.context.addFact({
        id: await repositories.ids.mint('fact'),
        clientId: id,
        category: 'concern',
        statement: initial.concern.trim(),
        status: 'active',
        statusAt: today,
        provenance: stated,
      })
    }
    if (initial.note?.trim()) {
      await repositories.interactions.addInteraction({
        id: await repositories.ids.mint('interaction'),
        clientId: id,
        type: 'internal-note',
        date: today,
        advisorId: input.by,
        source: 'advisor',
        importance: 'normal',
        title: 'Inledande notering',
        noteText: initial.note.trim(),
        topics: [],
        keyPoints: [],
        provenance: stated,
      })
    }

    await recordEvent(context, {
      subject: 'client',
      subjectId: id,
      kind: 'CLIENT_CREATED',
      effectiveDate: input.relationshipSince,
      by: input.by,
      detail: {
        status: input.status,
        officeId: input.officeId,
        advisorId: input.advisorId,
        similar: similar.length,
      },
      note: null,
    })
    return id
  })
  return { ok: true, clientId, similar }
}

/* ------------------------------------------------------------- activate */

export interface ActivateClientInput {
  clientId: ClientId
  /** ISO date; today when omitted. */
  effectiveDate?: string
  by: AdvisorId
}

export type LifecycleActResult =
  | { ok: true; client: Client; event: LifecycleEvent }
  | {
      ok: false
      code:
        | 'NOT_FOUND'
        | 'NOT_ALLOWED'
        | 'INVALID'
        | 'OFFICE_NOT_FOUND'
        | 'OFFICE_ARCHIVED'
        | 'ADVISOR_NOT_FOUND'
    }

export async function activateClient(
  context: AdvisoryContext,
  input: ActivateClientInput,
): Promise<LifecycleActResult> {
  const { repositories } = context
  const client = await repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }
  const next = transition(client.lifecycle.status, 'activate')
  if (!next) return { ok: false, code: 'NOT_ALLOWED' }
  const effectiveDate = input.effectiveDate ?? todayOf(context)
  if (!ISO_DATE.test(effectiveDate)) return { ok: false, code: 'INVALID' }
  return repositories.transaction(async () => {
    const updated: Client = {
      ...client,
      lifecycle: { status: next, since: effectiveDate, closure: null },
    }
    await repositories.clients.saveClient(updated)
    const event = await recordEvent(context, {
      subject: 'client',
      subjectId: client.id,
      kind: 'CLIENT_ACTIVATED',
      effectiveDate,
      by: input.by,
      detail: { officeId: client.officeId, advisorId: client.primaryAdvisorId },
      note: null,
    })
    return { ok: true, client: updated, event }
  })
}

/* ----------------------------------------------------------------- move */

export interface MoveClientOfficeInput {
  clientId: ClientId
  toOfficeId: OfficeId
  effectiveDate?: string
  note?: string | null
  by: AdvisorId
}

export async function moveClientOffice(
  context: AdvisoryContext,
  input: MoveClientOfficeInput,
): Promise<LifecycleActResult> {
  const { repositories } = context
  const client = await repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }
  if (client.lifecycle.status === 'former') return { ok: false, code: 'NOT_ALLOWED' }
  const office = await repositories.clients.officeById(input.toOfficeId)
  if (!office) return { ok: false, code: 'OFFICE_NOT_FOUND' }
  if (office.status !== 'active') return { ok: false, code: 'OFFICE_ARCHIVED' }
  if (office.id === client.officeId) return { ok: false, code: 'NOT_ALLOWED' }
  const effectiveDate = input.effectiveDate ?? todayOf(context)
  if (!ISO_DATE.test(effectiveDate)) return { ok: false, code: 'INVALID' }
  return repositories.transaction(async () => {
    await closeCurrentStretch(context, client.id, effectiveDate)
    await repositories.lifecycle.addOfficeHistory({
      id: await repositories.ids.mint('stretch'),
      clientId: client.id,
      officeId: office.id,
      from: effectiveDate,
      to: null,
    })
    const updated: Client = { ...client, officeId: office.id }
    await repositories.clients.saveClient(updated)
    const event = await recordEvent(context, {
      subject: 'client',
      subjectId: client.id,
      kind: 'CLIENT_MOVED_OFFICE',
      effectiveDate,
      by: input.by,
      detail: { fromOfficeId: client.officeId, toOfficeId: office.id },
      note: input.note?.trim() || null,
    })
    return { ok: true, client: updated, event }
  })
}

/* -------------------------------------------------------------- advisor */

export interface ChangeClientAdvisorInput {
  clientId: ClientId
  advisorId: AdvisorId
  effectiveDate?: string
  note?: string | null
  by: AdvisorId
}

export async function changeClientAdvisor(
  context: AdvisoryContext,
  input: ChangeClientAdvisorInput,
): Promise<LifecycleActResult> {
  const { repositories } = context
  const client = await repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }
  if (client.lifecycle.status === 'former') return { ok: false, code: 'NOT_ALLOWED' }
  if (!(await repositories.clients.advisorById(input.advisorId)))
    return { ok: false, code: 'ADVISOR_NOT_FOUND' }
  if (input.advisorId === client.primaryAdvisorId)
    return { ok: false, code: 'NOT_ALLOWED' }
  const effectiveDate = input.effectiveDate ?? todayOf(context)
  if (!ISO_DATE.test(effectiveDate)) return { ok: false, code: 'INVALID' }
  return repositories.transaction(async () => {
    const updated: Client = { ...client, primaryAdvisorId: input.advisorId }
    await repositories.clients.saveClient(updated)
    const event = await recordEvent(context, {
      subject: 'client',
      subjectId: client.id,
      kind: 'CLIENT_ADVISOR_CHANGED',
      effectiveDate,
      by: input.by,
      detail: { fromAdvisorId: client.primaryAdvisorId, toAdvisorId: input.advisorId },
      note: input.note?.trim() || null,
    })
    return { ok: true, client: updated, event }
  })
}

/* ----------------------------------------------------------------- edit */

export interface EditClientInput {
  clientId: ClientId
  displayName?: string
  segment?: ClientSegment
  relationshipSince?: string
  dateOfBirth?: string | null
  riskProfile?: RiskProfile | null
  preferredChannel?: CommunicationChannel
  annualIncome?: number | null
  by: AdvisorId
}

export async function editClient(
  context: AdvisoryContext,
  input: EditClientInput,
): Promise<LifecycleActResult> {
  const { repositories } = context
  const client = await repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }
  if (input.displayName !== undefined && input.displayName.trim().length < 2)
    return { ok: false, code: 'INVALID' }
  if (input.relationshipSince !== undefined && !ISO_DATE.test(input.relationshipSince))
    return { ok: false, code: 'INVALID' }
  if (input.dateOfBirth && !ISO_DATE.test(input.dateOfBirth))
    return { ok: false, code: 'INVALID' }
  const changed: string[] = []
  const updated: Client = { ...client }
  if (
    input.displayName !== undefined &&
    input.displayName.trim() !== client.displayName
  ) {
    updated.displayName = input.displayName.trim()
    changed.push('displayName')
  }
  if (input.segment !== undefined && input.segment !== client.segment) {
    updated.segment = input.segment
    changed.push('segment')
  }
  if (
    input.relationshipSince !== undefined &&
    input.relationshipSince !== client.relationshipSince
  ) {
    updated.relationshipSince = input.relationshipSince
    changed.push('relationshipSince')
  }
  if (input.dateOfBirth !== undefined && input.dateOfBirth !== client.dateOfBirth) {
    updated.dateOfBirth = input.dateOfBirth
    changed.push('dateOfBirth')
  }
  if (input.riskProfile !== undefined && input.riskProfile !== client.riskProfile) {
    updated.riskProfile = input.riskProfile
    changed.push('riskProfile')
  }
  if (
    input.preferredChannel !== undefined &&
    input.preferredChannel !== client.preferredChannel
  ) {
    updated.preferredChannel = input.preferredChannel
    changed.push('preferredChannel')
  }
  if (input.annualIncome !== undefined && input.annualIncome !== client.annualIncome) {
    updated.annualIncome = input.annualIncome
    changed.push('annualIncome')
  }
  if (changed.length === 0) return { ok: false, code: 'NOT_ALLOWED' }
  return repositories.transaction(async () => {
    await repositories.clients.saveClient(updated)
    if (changed.includes('displayName')) {
      const household = await repositories.clients.householdById(client.householdId)
      if (household) {
        await repositories.clients.saveHousehold({
          ...household,
          displayName:
            household.displayName === client.displayName
              ? updated.displayName
              : household.displayName,
          members: household.members.map((m) =>
            m.clientId === client.id ? { ...m, displayName: updated.displayName } : m,
          ),
        })
      }
    }
    const event = await recordEvent(context, {
      subject: 'client',
      subjectId: client.id,
      kind: 'CLIENT_UPDATED',
      effectiveDate: todayOf(context),
      by: input.by,
      detail: { fields: changed.join(',') },
      note: null,
    })
    return { ok: true, client: updated, event }
  })
}

/* ---------------------------------------------------------------- close */

/** What a closure would leave open, read before the advisor decides. */
export async function closureReviewOf(
  context: AdvisoryContext,
  clientId: ClientId,
): Promise<ClosureReview | null> {
  const facts = await assembleClientFacts(context, clientId)
  return facts ? closureReview(facts) : null
}

export interface CloseClientInput {
  clientId: ClientId
  effectiveDate?: string
  reason: ClosureReason
  note?: string | null
  by: AdvisorId
}

/**
 * The relationship ends. Open promises and upcoming events are cancelled —
 * nothing a former client is owed can be delivered — and counted on the
 * event; opportunities, goals, memory, history and documents stay exactly
 * as they were. The client's office stretch closes on the effective date.
 */
export async function closeClient(
  context: AdvisoryContext,
  input: CloseClientInput,
): Promise<LifecycleActResult> {
  const { repositories } = context
  const client = await repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }
  const next = transition(client.lifecycle.status, 'close')
  if (!next) return { ok: false, code: 'NOT_ALLOWED' }
  const effectiveDate = input.effectiveDate ?? todayOf(context)
  if (!ISO_DATE.test(effectiveDate)) return { ok: false, code: 'INVALID' }
  const review = (await closureReviewOf(context, client.id))!
  return repositories.transaction(async () => {
    const now = context.clock.isoNow()
    for (const commitment of await repositories.commitments.commitmentsOf(client.id)) {
      if (commitment.status === 'open')
        await repositories.commitments.saveCommitment({
          ...commitment,
          status: 'cancelled',
          completedAt: null,
        })
    }
    for (const event of await repositories.events.eventsOf(client.id)) {
      if (event.status === 'upcoming' && event.date >= effectiveDate)
        await repositories.events.saveEvent({ ...event, status: 'cancelled' })
    }
    await closeCurrentStretch(context, client.id, effectiveDate)
    const updated: Client = {
      ...client,
      lifecycle: {
        status: next,
        since: effectiveDate,
        closure: {
          effectiveDate,
          reason: input.reason,
          note: input.note?.trim() || null,
        },
      },
    }
    await repositories.clients.saveClient(updated)
    const event = await recordEvent(context, {
      subject: 'client',
      subjectId: client.id,
      kind: 'CLIENT_CLOSED',
      effectiveDate,
      by: input.by,
      detail: {
        reason: input.reason,
        officeId: client.officeId,
        advisorId: client.primaryAdvisorId,
        cancelledCommitments: review.openCommitments,
        cancelledMeetings: review.bookedMeetings,
        cancelledEvents: review.futureFinancingEvents + review.futureImportantEvents,
        openOpportunities: review.openOpportunities,
        recordedAt: now,
      },
      note: input.note?.trim() || null,
    })
    return { ok: true, client: updated, event }
  })
}

/* ----------------------------------------------------------- reactivate */

export interface ReactivateClientInput {
  clientId: ClientId
  officeId: OfficeId
  advisorId: AdvisorId
  effectiveDate?: string
  note?: string | null
  by: AdvisorId
}

/** The relationship returns: the same client, the same dossier, a new stretch — the closure stays in the history. */
export async function reactivateClient(
  context: AdvisoryContext,
  input: ReactivateClientInput,
): Promise<LifecycleActResult> {
  const { repositories } = context
  const client = await repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }
  const next = transition(client.lifecycle.status, 'reactivate')
  if (!next) return { ok: false, code: 'NOT_ALLOWED' }
  const office = await repositories.clients.officeById(input.officeId)
  if (!office) return { ok: false, code: 'OFFICE_NOT_FOUND' }
  if (office.status !== 'active') return { ok: false, code: 'OFFICE_ARCHIVED' }
  if (!(await repositories.clients.advisorById(input.advisorId)))
    return { ok: false, code: 'ADVISOR_NOT_FOUND' }
  const effectiveDate = input.effectiveDate ?? todayOf(context)
  if (!ISO_DATE.test(effectiveDate)) return { ok: false, code: 'INVALID' }
  return repositories.transaction(async () => {
    await repositories.lifecycle.addOfficeHistory({
      id: await repositories.ids.mint('stretch'),
      clientId: client.id,
      officeId: office.id,
      from: effectiveDate,
      to: null,
    })
    const updated: Client = {
      ...client,
      officeId: office.id,
      primaryAdvisorId: input.advisorId,
      lifecycle: { status: next, since: effectiveDate, closure: null },
    }
    await repositories.clients.saveClient(updated)
    const event = await recordEvent(context, {
      subject: 'client',
      subjectId: client.id,
      kind: 'CLIENT_REACTIVATED',
      effectiveDate,
      by: input.by,
      detail: {
        officeId: office.id,
        advisorId: input.advisorId,
        previousClosureDate: client.lifecycle.closure?.effectiveDate ?? null,
        previousClosureReason: client.lifecycle.closure?.reason ?? null,
      },
      note: input.note?.trim() || null,
    })
    return { ok: true, client: updated, event }
  })
}

/* ----------------------------------------------------------- onboarding */

export async function onboardingOverviewOf(
  context: AdvisoryContext,
  clientId: ClientId,
): Promise<OnboardingOverview | null> {
  const facts = await assembleClientFacts(context, clientId)
  if (!facts) return null
  const household = await context.repositories.clients.householdById(
    facts.client.householdId,
  )
  return onboardingOverview(facts, household)
}

/* ---------------------------------------------------------------- feed */

export interface LifecycleFeedEntry {
  event: LifecycleEvent
  /** The client's or the office's name as it stands now. */
  subjectName: string
  /** The client's current office, where the subject is a client. */
  officeName: string | null
}

export interface LifecycleFeedFilter {
  /** ISO date; events with an effective date on or after it. */
  since?: string
  kinds?: readonly LifecycleEventKind[]
  /** Events whose subject is at, moved to or moved from this office. */
  officeId?: OfficeId
}

/** The book's history, newest first, with the names a reader needs beside each event. */
export async function lifecycleFeed(
  context: AdvisoryContext,
  filter: LifecycleFeedFilter = {},
): Promise<readonly LifecycleFeedEntry[]> {
  const { repositories } = context
  const [events, clients, offices] = await Promise.all([
    repositories.lifecycle.events(),
    repositories.clients.list(),
    repositories.clients.offices(),
  ])
  const clientById = new Map(clients.map((c) => [c.id, c]))
  const officeName = new Map(offices.map((o) => [o.id, o.displayName]))
  return events
    .filter((event) => !filter.since || event.effectiveDate >= filter.since)
    .filter((event) => !filter.kinds || filter.kinds.includes(event.kind))
    .filter((event) => {
      if (!filter.officeId) return true
      if (event.subject === 'office') return event.subjectId === filter.officeId
      const client = clientById.get(event.subjectId)
      return (
        client?.officeId === filter.officeId ||
        event.detail['officeId'] === filter.officeId ||
        event.detail['toOfficeId'] === filter.officeId ||
        event.detail['fromOfficeId'] === filter.officeId
      )
    })
    .map((event) => {
      const client =
        event.subject === 'client' ? clientById.get(event.subjectId) : undefined
      return {
        event,
        subjectName:
          event.subject === 'client'
            ? (client?.displayName ?? event.subjectId)
            : (officeName.get(event.subjectId) ?? event.subjectId),
        officeName: client ? (officeName.get(client.officeId) ?? client.officeId) : null,
      }
    })
}

/** The clients in one lifecycle book, with the facts its rows show. */
export function clientsInBook(
  clients: readonly Client[],
  book: LifecycleStatus,
): readonly Client[] {
  return clients.filter((client) => client.lifecycle.status === book)
}

export { contributesToActiveBook }

/* ------------------------------------------------------------- helpers */

async function closeCurrentStretch(
  context: AdvisoryContext,
  clientId: ClientId,
  to: string,
): Promise<void> {
  const { repositories } = context
  const current = (await repositories.lifecycle.officeHistoryOf(clientId)).find(
    (stretch) => stretch.to === null,
  )
  if (current) await repositories.lifecycle.saveOfficeHistory({ ...current, to })
}

export async function recordEvent(
  context: AdvisoryContext,
  event: Omit<LifecycleEvent, 'id' | 'at'>,
): Promise<LifecycleEvent> {
  const { repositories } = context
  const recorded: LifecycleEvent = {
    ...event,
    id: await repositories.ids.mint('lifecycle'),
    at: context.clock.isoNow(),
  }
  await repositories.lifecycle.addEvent(recorded)
  return recorded
}
