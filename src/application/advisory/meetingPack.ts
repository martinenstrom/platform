/**
 * The Meeting Pack — one typed read model that every output format is
 * produced from: the screen's Executive Brief, the PDF briefing book and
 * the editable PowerPoint. Nothing here derives a fact of its own. The
 * pack is the Meeting Cockpit and Client 360 arranged for a document:
 * the same focus, the same changes against the same baseline, the same
 * promises, questions, financing and market history, with the record ids
 * every item rests on. A renderer that consumed anything else would be a
 * second source of truth.
 *
 *   EXISTING RECORD → application services → Meeting Cockpit → MeetingPack
 *                                                  → screen / PDF / PowerPoint
 *
 * What the pack adds is deliberate and stated: the readiness gate (typed
 * reasons, three states, no score), the executive summary and the top
 * priorities (a selection over cockpit items, never new prose), the next
 * steps (open promises plus proposed objectives, marked proposed), the
 * outline (which slides the record justifies), the provenance and a
 * content fingerprint so a regenerated pack gets a new version only when
 * the record moved.
 */

import {
  COCKPIT_THRESHOLDS,
  daysBetween,
  fewChanges,
  type AdvisorQuestion,
  type AgendaItem,
  type Asset,
  type BriefItem,
  type ClientQuestion,
  type ClientSegment,
  type Commitment,
  type CommunicationChannel,
  type ContextFact,
  type ContextItem,
  type DataQualityItem,
  type FinancingItem,
  type FocusTopic,
  type Goal,
  type Holding,
  type Interaction,
  type InteractionType,
  type Liability,
  type MarketContextItem,
  type MaterialItem,
  type MeetingChange,
  type MeetingChanges,
  type MeetingFocus,
  type ObjectiveItem,
  type OpportunityToExplore,
  type Portfolio,
  type PromiseView,
  type RelationshipHealth,
  type RiskItem,
  type RiskProfile,
  type StrategyStatus,
  type WealthBucket,
  type AllocationDeviation,
} from '~/domain/advisory'
import { client360, type Client360, type UpcomingEvent } from './client360'
import { meetingCockpit, type MeetingCockpit } from './meetingCockpit'
import type { AdvisoryContext } from './ports'
import type { SentinelEntry } from './sentinel'
import { fallbackSource, sourceIndex, titlesOf, type RecordSource } from './sources'

/* --------------------------------------------------------------- vocabulary */

export type MeetingPackDepth = 'executive' | 'full'

/** Who a pack is for. V1 generates INTERNAL_ADVISOR only; see meetingPackPolicy.ts. */
export type MeetingPackAudience = 'INTERNAL_ADVISOR' | 'FUTURE_CLIENT'

export type ReadinessState = 'REDO' | 'GRANSKA' | 'BLOCKERAD'

export type ReadinessReasonKind =
  | 'stale-valuation'
  | 'external-not-updated'
  | 'portfolio-stale'
  | 'no-portfolio'
  | 'pension-unknown'
  | 'loan-rate-unverified'
  | 'no-baseline'
  | 'no-scheduled-meeting'
  | 'no-valued-assets'

export interface ReadinessReason {
  kind: ReadinessReasonKind
  /** `block` only where generation would materially misrepresent the client. */
  severity: 'review' | 'block'
  sourceIds: readonly string[]
  label?: string
  date?: string
  daysOld?: number
}

export interface PackReadiness {
  state: ReadinessState
  reasons: readonly ReadinessReason[]
  method: 'pack-readiness-v1'
}

/** The pack's every horizon and limit, stated once. */
export const PACK_THRESHOLDS = Object.freeze({
  /** A loan whose figures are older than this should have its rate verified before it is quoted. */
  loanRateVerifiedDays: 90,
  /** Important events within this many days belong in the pack. */
  importantEventDays: 180,
  maxImportantEvents: 6,
  maxTimeline: 8,
  maxCommitmentHistory: 10,
  maxTopHoldings: 5,
  /** Largest holding, percent, at which concentration is stated. */
  concentrationPercent: 20,
  maxNextSteps: 8,
  maxExecutivePoints: 5,
  maxPriorities: 3,
})

const CONVERSATION_TYPES: readonly InteractionType[] = [
  'meeting',
  'phone',
  'email',
  'teams',
  'portfolio-discussion',
  'financing-discussion',
  'follow-up',
  'complaint',
  'investment-proposal',
]

/* ------------------------------------------------------------------- items */

interface Grounded {
  sourceIds: readonly string[]
}

/** Why the meeting matters, in typed points the presentation phrases. */
export type ExecutivePoint =
  | (Grounded & { kind: 'focus'; focus: MeetingFocus })
  | (Grounded & { kind: 'change'; change: MeetingChange })
  | (Grounded & { kind: 'promise'; view: PromiseView })
  | (Grounded & { kind: 'financing'; item: FinancingItem })
  | (Grounded & { kind: 'market'; item: MarketContextItem })
  | (Grounded & { kind: 'concern'; fact: ContextFact })
  | (Grounded & { kind: 'health'; health: RelationshipHealth })
  | (Grounded & { kind: 'quiet' })

export type PriorityItem =
  | (Grounded & { kind: 'focus-topic'; topic: FocusTopic })
  | (Grounded & { kind: 'promise'; view: PromiseView })
  | (Grounded & { kind: 'objective'; objective: ObjectiveItem })

export type NextStepStatus = 'open' | 'overdue' | 'proposed'
export type NextStepOwner = 'advisor' | 'client' | 'both'

/** An action after the meeting: an open promise as it stands, or a proposal to confirm. */
export type NextStep = Grounded & {
  owner: NextStepOwner
  date: string | null
  status: NextStepStatus
} & (
    | { kind: 'commitment'; view: PromiseView }
    | { kind: 'objective'; objective: ObjectiveItem }
    | { kind: 'material'; material: MaterialItem }
  )

export type PackSlideKind =
  | 'executive'
  | 'glance'
  | 'since-last'
  | 'wealth'
  | 'portfolio'
  | 'financing'
  | 'market'
  | 'relationship'
  | 'questions'
  | 'plan'
  | 'next-steps'
  | 'appendix-holdings'
  | 'appendix-loans'
  | 'appendix-timeline'
  | 'appendix-commitments'
  | 'appendix-market'
  | 'appendix-baseline'
  | 'appendix-data-quality'
  | 'appendix-sources'

export interface PackOutline {
  core: readonly PackSlideKind[]
  appendix: readonly PackSlideKind[]
}

/* -------------------------------------------------------------------- pack */

export interface MeetingPack {
  audience: MeetingPackAudience
  depth: MeetingPackDepth
  identity: {
    clientId: string
    clientName: string
    /** Only when it names more than the client does. */
    householdName: string | null
    officeId: string | null
    officeName: string | null
    advisorName: string | null
    segment: ClientSegment
    relationshipSince: string
    riskProfile: RiskProfile | null
    preferredChannel: CommunicationChannel
  }
  meeting: {
    eventId: string | null
    title: string | null
    /** ISO date, when a meeting is booked. */
    date: string | null
    daysAhead: number | null
    mode: 'scheduled' | 'unscheduled'
    notes: string | null
    lastMeeting: { id: string; date: string; title: string; type: InteractionType } | null
  }
  /** ISO timestamp the pack was built. */
  generatedAt: string
  /** ISO date the derivations used. */
  dataAsOf: string
  provenance: {
    portfolioValuedAt: string | null
    oldestValuationAt: string | null
    /** The newest market observation the pack rests on. */
    marketDataAsOf: string | null
    baseline: { id: string; meetingDate: string; capturedAt: string } | null
    marketWindowStart: string
    sourceCount: number
  }
  readiness: PackReadiness
  outline: PackOutline
  meetingFocus: MeetingFocus
  executiveSummary: readonly ExecutivePoint[]
  topPriorities: readonly PriorityItem[]
  dontForget: RiskItem | null
  clientSnapshot: {
    brief: readonly BriefItem[]
    totalAssets: number
    assetsWithBank: number
    netWorth: number
    liquidity: number
    totalLiabilities: number
    shareOfWalletPercent: number
    externalAssets: number
    riskProfile: RiskProfile | null
    primaryGoal: Goal | null
    /** The next dated event that is not the meeting itself. */
    nextEvent: UpcomingEvent | null
  }
  relationshipHealth: RelationshipHealth
  relationshipContext: readonly ContextItem[]
  changesSinceLastMeeting: MeetingChanges
  wealth: {
    buckets: readonly WealthBucket[]
    /** Largest first. */
    assets: readonly Asset[]
    liabilities: readonly Liability[]
    totalAssets: number
    totalLiabilities: number
    netWorth: number
    assetsWithBank: number
    externalAssets: number
    oldestValuationAt: string | null
  }
  portfolio: {
    portfolio: Portfolio | null
    deviations: readonly AllocationDeviation[]
    /** Heaviest first. */
    topHoldings: readonly Holding[]
    largestHoldingPercent: number | null
    concentrated: boolean
  }
  strategy: StrategyStatus
  liquidity: {
    amount: number
    shareOfFinancialPercent: number
    strategicCashPercent: number | null
    excess: { amount: number; sharePercent: number } | null
  }
  financing: readonly FinancingItem[]
  commitments: readonly PromiseView[]
  importantEvents: readonly UpcomingEvent[]
  clientConcerns: readonly ContextFact[]
  goals: readonly Goal[]
  marketContext: readonly MarketContextItem[]
  sentinelContext: SentinelEntry | null
  possibleClientQuestions: readonly ClientQuestion[]
  advisorQuestions: readonly AdvisorQuestion[]
  opportunities: readonly OpportunityToExplore[]
  risks: readonly RiskItem[]
  dataQuality: readonly DataQualityItem[]
  meetingObjectives: readonly ObjectiveItem[]
  agenda: readonly AgendaItem[]
  materialsToPrepare: readonly MaterialItem[]
  nextSteps: readonly NextStep[]
  appendix: {
    holdings: readonly Holding[]
    loans: readonly Liability[]
    /** Conversations, newest first. */
    timeline: readonly Interaction[]
    /** Newest first. */
    commitmentHistory: readonly Commitment[]
    marketEpisodes: readonly MarketContextItem[]
    baseline: MeetingChanges['baseline']
    gaps: MeetingChanges['gaps']
    dataQuality: readonly DataQualityItem[]
  }
  sources: readonly RecordSource[]
  /** Display titles for every record id the items point at. */
  titles: Readonly<Record<string, string>>
  /** Stable over the record's content; a new version only when this changes. */
  fingerprint: string
  method: 'meeting-pack-v1'
}

/* ----------------------------------------------------------------- reading */

export async function meetingPack(
  context: AdvisoryContext,
  clientId: string,
  depth: MeetingPackDepth = 'full',
): Promise<MeetingPack | null> {
  const [view, cockpit] = await Promise.all([
    client360(context, clientId),
    meetingCockpit(context, clientId),
  ])
  if (!view || !cockpit) return null
  return assemble(view, cockpit, depth, context.clock.isoNow())
}

/** The pack over views already read — the same composition, for a caller that holds them. */
export function assemble(
  view: Client360,
  cockpit: MeetingCockpit,
  depth: MeetingPackDepth,
  generatedAt: string,
): MeetingPack {
  const today = view.today
  const t = PACK_THRESHOLDS
  const { balanceSheet } = view
  const meetingEvent = cockpit.meeting.event
  const meetingDate = meetingEvent?.occursOn ?? null

  const readiness = readinessOf(view, cockpit)
  const executiveSummary = executiveSummaryOf(view, cockpit)
  const topPriorities = prioritiesOf(cockpit)
  const dontForget = dontForgetOf(cockpit, topPriorities)

  const concerns = view.contextFacts.filter(
    (f) => f.category === 'concern' && f.status === 'active',
  )
  const importantEvents = view.upcomingEvents
    .filter((e) => e.type !== 'client-meeting' && e.daysAhead <= t.importantEventDays)
    .slice(0, t.maxImportantEvents)
  const holdings = view.portfolio
    ? [...view.portfolio.holdings].sort((a, b) => b.weightPercent - a.weightPercent)
    : []
  const largest = holdings[0]?.weightPercent ?? null
  const excess = view.signals.find(
    (s): s is Extract<(typeof view.signals)[number], { kind: 'excess-cash' }> =>
      s.kind === 'excess-cash',
  )
  const primaryGoal =
    view.goals.find((g) => g.priority === 'primary') ?? view.goals[0] ?? null

  const nextSteps: NextStep[] = [
    ...cockpit.promises
      .filter((p) => p.bucket !== 'completed-since')
      .map<NextStep>((p) => ({
        kind: 'commitment',
        view: p,
        owner: 'advisor',
        date: p.commitment.dueDate,
        status: p.bucket === 'overdue' ? 'overdue' : 'open',
        sourceIds: [p.commitment.id],
      })),
    ...cockpit.objectives.map<NextStep>((objective) => ({
      kind: 'objective',
      objective,
      owner: 'both',
      date: meetingDate,
      status: 'proposed',
      sourceIds: objective.sourceIds,
    })),
    ...cockpit.materials.map<NextStep>((material) => ({
      kind: 'material',
      material,
      owner: 'advisor',
      date: meetingDate,
      status: 'proposed',
      sourceIds: material.sourceIds,
    })),
  ].slice(0, t.maxNextSteps)

  const timeline = view.interactions
    .filter((i) => CONVERSATION_TYPES.includes(i.type))
    .slice(0, t.maxTimeline)
  const commitmentHistory = view.commitments.slice(0, t.maxCommitmentHistory)

  const marketDataAsOf =
    cockpit.market
      .map((m) => m.item.impact.event.observedAt)
      .sort()
      .at(-1) ?? null

  /* Sources: the cockpit's, plus the records the pack shows on its own. */
  const index = sourceIndex(view)
  const ids = new Set<string>(cockpit.sources)
  for (const e of importantEvents) ids.add(e.id)
  for (const g of view.goals) ids.add(g.id)
  for (const l of view.liabilities) ids.add(l.id)
  for (const h of holdings.slice(0, t.maxTopHoldings)) ids.add(h.id)
  for (const i of timeline) ids.add(i.id)
  for (const c of commitmentHistory) ids.add(c.id)
  for (const a of view.assets) ids.add(a.id)
  const sources: RecordSource[] = []
  for (const id of ids) {
    const source = index.get(id) ?? fallbackSource(id)
    if (source) sources.push(source)
  }

  const pack: Omit<MeetingPack, 'fingerprint' | 'outline'> = {
    audience: 'INTERNAL_ADVISOR',
    depth,
    identity: {
      clientId: view.client.id,
      clientName: view.client.displayName,
      householdName:
        view.household && view.household.displayName !== view.client.displayName
          ? view.household.displayName
          : null,
      officeId: view.office?.id ?? null,
      officeName: view.office?.displayName ?? null,
      advisorName: view.advisor?.displayName ?? null,
      segment: view.client.segment,
      relationshipSince: view.client.relationshipSince,
      riskProfile: view.client.riskProfile,
      preferredChannel: view.client.preferredChannel,
    },
    meeting: {
      eventId: meetingEvent?.id ?? null,
      title: meetingEvent?.title ?? null,
      date: meetingDate,
      daysAhead: cockpit.meeting.daysAhead,
      mode: cockpit.meeting.mode,
      notes: meetingEvent?.notes ? meetingEvent.notes : null,
      lastMeeting: cockpit.lastMeeting
        ? {
            id: cockpit.lastMeeting.id,
            date: cockpit.lastMeeting.date,
            title: cockpit.lastMeeting.title,
            type: cockpit.lastMeeting.type,
          }
        : null,
    },
    generatedAt,
    dataAsOf: today,
    provenance: {
      portfolioValuedAt: view.portfolio?.valuedAt ?? null,
      oldestValuationAt: balanceSheet.oldestValuationAt,
      marketDataAsOf,
      baseline: cockpit.baseline,
      marketWindowStart: cockpit.marketWindowStart,
      sourceCount: sources.length,
    },
    readiness,
    meetingFocus: cockpit.focus,
    executiveSummary,
    topPriorities,
    dontForget,
    clientSnapshot: {
      brief: cockpit.brief,
      totalAssets: balanceSheet.totalAssets,
      assetsWithBank: balanceSheet.assetsWithBank,
      netWorth: balanceSheet.netWorth,
      liquidity: balanceSheet.liquidity,
      totalLiabilities: balanceSheet.totalLiabilities,
      shareOfWalletPercent: balanceSheet.shareOfWalletPercent,
      externalAssets: balanceSheet.totalAssets - balanceSheet.assetsWithBank,
      riskProfile: view.client.riskProfile,
      primaryGoal,
      nextEvent: importantEvents[0] ?? null,
    },
    relationshipHealth: view.health,
    relationshipContext: cockpit.context,
    changesSinceLastMeeting: cockpit.changes,
    wealth: {
      buckets: balanceSheet.buckets,
      assets: [...view.assets].sort((a, b) => b.value - a.value),
      liabilities: view.liabilities,
      totalAssets: balanceSheet.totalAssets,
      totalLiabilities: balanceSheet.totalLiabilities,
      netWorth: balanceSheet.netWorth,
      assetsWithBank: balanceSheet.assetsWithBank,
      externalAssets: balanceSheet.totalAssets - balanceSheet.assetsWithBank,
      oldestValuationAt: balanceSheet.oldestValuationAt,
    },
    portfolio: {
      portfolio: view.portfolio,
      deviations: view.deviations,
      topHoldings: holdings.slice(0, t.maxTopHoldings),
      largestHoldingPercent: largest,
      concentrated: largest !== null && largest >= t.concentrationPercent,
    },
    strategy: cockpit.strategy,
    liquidity: {
      amount: cockpit.strategy.liquidity.amount,
      shareOfFinancialPercent: cockpit.strategy.liquidity.shareOfFinancialPercent,
      strategicCashPercent: cockpit.strategy.liquidity.strategicCashPercent,
      excess: excess
        ? { amount: excess.amount, sharePercent: excess.sharePercent }
        : null,
    },
    financing: cockpit.financing,
    commitments: cockpit.promises,
    importantEvents,
    clientConcerns: concerns,
    goals: view.goals,
    marketContext: cockpit.market,
    sentinelContext: cockpit.sentinelEntry,
    possibleClientQuestions: cockpit.clientQuestions,
    advisorQuestions: cockpit.advisorQuestions,
    opportunities: cockpit.opportunities,
    risks: cockpit.risks,
    dataQuality: cockpit.dataQuality,
    meetingObjectives: cockpit.objectives,
    agenda: cockpit.agenda,
    materialsToPrepare: cockpit.materials,
    nextSteps,
    appendix: {
      holdings,
      loans: view.liabilities,
      timeline,
      commitmentHistory,
      marketEpisodes: cockpit.market,
      baseline: cockpit.changes.baseline,
      gaps: cockpit.changes.gaps,
      dataQuality: cockpit.dataQuality,
    },
    sources,
    titles: { ...titlesOf(view), ...cockpit.titles },
    method: 'meeting-pack-v1',
  }
  const outline = outlineOf(pack, depth)
  return { ...pack, outline, fingerprint: fingerprintOf({ ...pack, outline }) }
}

/* --------------------------------------------------------------- readiness */

const CRITICAL_RISKS: readonly RiskItem['kind'][] = [
  'overdue-promise',
  'complaint',
  'family-event',
  'fee-sensitivity',
]

/** Three states from typed reasons; a block only where the record cannot carry a pack. */
export function readinessOf(view: Client360, cockpit: MeetingCockpit): PackReadiness {
  const reasons: ReadinessReason[] = []
  const today = view.today
  if (view.assets.length === 0 || view.balanceSheet.totalAssets <= 0) {
    reasons.push({ kind: 'no-valued-assets', severity: 'block', sourceIds: [] })
  }
  for (const d of cockpit.dataQuality) {
    reasons.push({
      kind: d.kind,
      severity: 'review',
      sourceIds: d.sourceIds,
      ...(d.label ? { label: d.label } : {}),
      ...(d.valuedAt ? { date: d.valuedAt } : {}),
      ...(d.daysOld !== undefined ? { daysOld: d.daysOld } : {}),
    })
  }
  const seenLoans = new Set<string>()
  for (const f of cockpit.financing) {
    const loan = f.loan
    if (!loan || seenLoans.has(loan.id)) continue
    seenLoans.add(loan.id)
    const daysOld = daysBetween(loan.valuedAt, today)
    if (daysOld >= PACK_THRESHOLDS.loanRateVerifiedDays) {
      reasons.push({
        kind: 'loan-rate-unverified',
        severity: 'review',
        sourceIds: [loan.id],
        label: loan.title,
        date: loan.valuedAt,
        daysOld,
      })
    }
  }
  if (cockpit.changes.gaps.includes('no-baseline')) {
    reasons.push({ kind: 'no-baseline', severity: 'review', sourceIds: [] })
  }
  if (cockpit.meeting.mode === 'unscheduled') {
    reasons.push({ kind: 'no-scheduled-meeting', severity: 'review', sourceIds: [] })
  }
  const state: ReadinessState = reasons.some((r) => r.severity === 'block')
    ? 'BLOCKERAD'
    : reasons.length > 0
      ? 'GRANSKA'
      : 'REDO'
  return { state, reasons, method: 'pack-readiness-v1' }
}

/* --------------------------------------------------------------- selection */

const CHANGE_ORDER: readonly MeetingChange['kind'][] = [
  'financing-approaching',
  'portfolio-value',
  'allocation',
  'liquidity',
  'wealth',
  'loan-new',
  'loan-closed',
  'loan-balance',
  'health',
  'concern-new',
  'goal-status',
  'goal-progress',
  'event-new',
  'commitments',
  'context-new',
  'contacts',
]

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.some((id) => b.includes(id))
}

function executiveSummaryOf(view: Client360, cockpit: MeetingCockpit): ExecutivePoint[] {
  const points: ExecutivePoint[] = [
    { kind: 'focus', focus: cockpit.focus, sourceIds: cockpit.focus.primary.sourceIds },
  ]
  const covered = (ids: readonly string[]) =>
    points.some((p) => overlaps(p.sourceIds, ids))
  const promise =
    cockpit.promises.find((p) => p.bucket === 'overdue') ??
    cockpit.promises.find((p) => p.bucket === 'due-before-meeting')
  if (promise) {
    points.push({ kind: 'promise', view: promise, sourceIds: [promise.commitment.id] })
  }
  const financing = cockpit.financing.find(
    (f) => f.daysAhead !== null && f.daysAhead <= COCKPIT_THRESHOLDS.financingFocusDays,
  )
  if (financing && !covered(financing.sourceIds)) {
    points.push({ kind: 'financing', item: financing, sourceIds: financing.sourceIds })
  }
  const change = [...cockpit.changes.changes]
    .filter((c) => c.kind !== 'contacts')
    .sort((a, b) => CHANGE_ORDER.indexOf(a.kind) - CHANGE_ORDER.indexOf(b.kind))[0]
  if (change && !covered(change.sourceIds)) {
    points.push({ kind: 'change', change, sourceIds: change.sourceIds })
  }
  const market =
    cockpit.market.find((m) => m.item.impact.relevance === 'high') ?? cockpit.market[0]
  if (market) points.push({ kind: 'market', item: market, sourceIds: market.sourceIds })
  const concern = view.contextFacts.find(
    (f) => f.category === 'concern' && f.status === 'active',
  )
  if (concern && !covered([concern.id])) {
    points.push({ kind: 'concern', fact: concern, sourceIds: [concern.id] })
  }
  if (view.health.band === 'at-risk' || view.health.band === 'watch') {
    points.push({ kind: 'health', health: view.health, sourceIds: [] })
  }
  if (points.length === 1 && cockpit.focus.primary.kind === 'follow-up') {
    points.push({ kind: 'quiet', sourceIds: [] })
  }
  return points.slice(0, PACK_THRESHOLDS.maxExecutivePoints)
}

function prioritiesOf(cockpit: MeetingCockpit): PriorityItem[] {
  const candidates: PriorityItem[] = []
  const topic = (x: FocusTopic): PriorityItem | null =>
    x.kind === 'follow-up'
      ? null
      : { kind: 'focus-topic', topic: x, sourceIds: x.sourceIds }
  const primary = topic(cockpit.focus.primary)
  if (primary) candidates.push(primary)
  const overdue = cockpit.promises.find((p) => p.bucket === 'overdue')
  if (overdue) {
    candidates.push({
      kind: 'promise',
      view: overdue,
      sourceIds: [overdue.commitment.id],
    })
  }
  for (const x of cockpit.focus.supporting) {
    const item = topic(x)
    if (item) candidates.push(item)
  }
  for (const objective of cockpit.objectives) {
    candidates.push({ kind: 'objective', objective, sourceIds: objective.sourceIds })
  }
  const picked: PriorityItem[] = []
  for (const candidate of candidates) {
    if (picked.length >= PACK_THRESHOLDS.maxPriorities) break
    const same = picked.some(
      (p) =>
        (candidate.sourceIds.length > 0 && overlaps(p.sourceIds, candidate.sourceIds)) ||
        (p.kind === 'objective' &&
          candidate.kind === 'objective' &&
          p.objective.kind === candidate.objective.kind),
    )
    if (!same) picked.push(candidate)
  }
  return picked
}

function dontForgetOf(
  cockpit: MeetingCockpit,
  priorities: readonly PriorityItem[],
): RiskItem | null {
  return (
    cockpit.risks.find(
      (r) =>
        CRITICAL_RISKS.includes(r.kind) &&
        !priorities.some((p) => overlaps(p.sourceIds, r.sourceIds)),
    ) ?? null
  )
}

/* ----------------------------------------------------------------- outline */

/** The slides the record justifies, in meeting order; nothing is padded to a count. */
export function outlineOf(
  pack: Omit<MeetingPack, 'fingerprint' | 'outline'>,
  depth: MeetingPackDepth,
): PackOutline {
  const hasChanges =
    !fewChanges(pack.changesSinceLastMeeting) || pack.marketContext.length > 0
  const hasQuestions =
    pack.possibleClientQuestions.length > 0 || pack.advisorQuestions.length > 0
  if (depth === 'executive') {
    return {
      core: [
        'executive',
        'glance',
        ...(hasChanges ? (['since-last'] as const) : []),
        ...(hasQuestions ? (['questions'] as const) : []),
        'plan',
      ],
      appendix: [],
    }
  }
  const openPromises = pack.commitments.some((p) => p.bucket !== 'completed-since')
  const hasRelationship =
    openPromises ||
    pack.clientConcerns.length > 0 ||
    pack.importantEvents.length > 0 ||
    pack.goals.length > 0
  return {
    core: [
      'executive',
      'glance',
      ...(hasChanges ? (['since-last'] as const) : []),
      ...(pack.wealth.assets.length > 0 ? (['wealth'] as const) : []),
      ...(pack.portfolio.portfolio ? (['portfolio'] as const) : []),
      ...(pack.financing.length > 0 ? (['financing'] as const) : []),
      ...(pack.marketContext.length > 0 ? (['market'] as const) : []),
      ...(hasRelationship ? (['relationship'] as const) : []),
      ...(hasQuestions ? (['questions'] as const) : []),
      'plan',
      'next-steps',
    ],
    appendix: [
      ...(pack.appendix.holdings.length > 0 ? (['appendix-holdings'] as const) : []),
      ...(pack.appendix.loans.length > 0 ? (['appendix-loans'] as const) : []),
      ...(pack.appendix.timeline.length > 0 ? (['appendix-timeline'] as const) : []),
      ...(pack.appendix.commitmentHistory.length > 0
        ? (['appendix-commitments'] as const)
        : []),
      ...(pack.appendix.marketEpisodes.length > 0 ? (['appendix-market'] as const) : []),
      ...(pack.appendix.baseline ? (['appendix-baseline'] as const) : []),
      ...(pack.appendix.dataQuality.length > 0
        ? (['appendix-data-quality'] as const)
        : []),
      'appendix-sources',
    ],
  }
}

/* ------------------------------------------------------------- fingerprint */

/**
 * Keys that move without the record moving: when the pack was built, when
 * a verdict was assessed, when a market observation was last refreshed.
 * A market move's values are content; its timestamps are not.
 */
const VOLATILE_KEYS = new Set([
  'generatedAt',
  'assessedAt',
  'fingerprint',
  'observedAt',
  'updatedAt',
  'expiresAt',
  'peakAt',
  'marketDataAsOf',
])

/** A stable digest of the pack's content: FNV-1a over its JSON, twice, with volatile keys dropped. */
export function fingerprintOf(pack: object): string {
  const json = JSON.stringify(pack, (key, value: unknown) =>
    VOLATILE_KEYS.has(key) ? undefined : value,
  )
  return `${fnv1a(json, 0x811c9dc5)}${fnv1a(json, 0x01000193 ^ 0x811c9dc5)}`
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
