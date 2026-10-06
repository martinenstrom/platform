/**
 * Meeting Cockpit — what the advisor needs to know for THIS meeting,
 * derived by rule from what the record already holds: the client's facts,
 * the relationship health and signals, the changes since the last meeting,
 * the client-relevant market history, and the client's one Sentinel
 * priority. Nothing here is written by a model; every item carries the ids
 * of the records it rests on, and a question is a possible question,
 * never a prediction.
 *
 * Client 360 answers "what do we know about this client?". This module
 * answers "what do I need for the meeting?" — so everything is filtered
 * through meeting relevance, and the product is comfortable saying there
 * is little to report.
 */

import { daysBetween } from './dates'
import type { Goal } from './goals'
import {
  INTELLIGENCE_THRESHOLDS,
  openCommitments,
  openConcerns,
  overdueCommitments,
  upcomingEvents,
  type ClientFacts,
  type RelationshipHealth,
  type Signal,
} from './intelligence'
import type { ClientMarketImpact, CloseReason } from './marketToClient'
import { concernTopicsOf, type ConcernTopic } from './marketToClient'
import { allocationDeviations, type AssetClass } from './portfolio'
import type { MeetingChanges, MeetingSnapshot } from './meetingSnapshot'
import type {
  Commitment,
  ContextCategory,
  ContextFact,
  EventType,
  ImportantEvent,
} from './relationship'
import type { SentinelPriority } from './sentinel'
import type { Asset, Liability } from './wealth'
import type { ClientSegment, CommunicationChannel, RiskProfile } from './client'
import type { HealthBand } from './intelligence'

/* ------------------------------------------------------------------- input */

/** One client-relevant market change in the window, as the application hands it over. */
export interface MeetingMarketItem {
  impact: ClientMarketImpact
  status: 'active' | 'closed'
  closedAt: string | null
  closeReason: CloseReason | null
}

export type UpcomingEvent = ImportantEvent & { occursOn: string }

export interface CockpitInput {
  facts: ClientFacts
  assets: readonly Asset[]
  health: RelationshipHealth
  signals: readonly Signal[]
  changes: MeetingChanges
  snapshot: MeetingSnapshot | null
  market: readonly MeetingMarketItem[]
  sentinel: SentinelPriority | null
  /** The scheduled meeting being prepared; null when the advisor prepares an unscheduled call or review. */
  meeting: UpcomingEvent | null
}

/* -------------------------------------------------------------- thresholds */

/** Every horizon and limit the cockpit reasons with, stated once. */
export const COCKPIT_THRESHOLDS = Object.freeze({
  /** Days ahead within which a financing event is the meeting's business. */
  financingFocusDays: 90,
  /** Days ahead within which a financing event is listed at all. */
  financingListDays: 180,
  /** Days ahead within which a liquidity event is the meeting's business. */
  liquidityEventDays: 120,
  /** Days ahead within which a refinancing may prompt the client's question. */
  clientQuestionFinancingDays: 120,
  /** Days back within which a financing discussion counts as held. */
  financingDiscussedDays: 60,
  /** Days back within which a complaint must not be forgotten. */
  complaintDays: 180,
  /** Days ahead within which a family date must not be forgotten. */
  familyEventDays: 30,
  /** A valuation older than this is stale. */
  staleValuationDays: 180,
  /** An external figure older than this should be verified. */
  externalUpdateDays: 90,
  /** A managed portfolio valued longer ago than this should be verified. */
  portfolioStaleDays: 30,
  /** Non-bank assets above this are worth a question. */
  externalAssetsAmount: 1_000_000,
  /** Variable-rate debt above this is worth a question. */
  variableDebtAmount: 2_000_000,
  /** Without a scheduled meeting, a promise due within this many days is "due before the meeting". */
  unscheduledDueDays: 14,
  maxClientQuestions: 5,
  maxAdvisorQuestions: 5,
  maxOpportunities: 5,
  maxRisks: 3,
  maxDataQuality: 4,
  maxObjectives: 4,
  maxMaterials: 5,
  maxContext: 7,
  maxMarket: 5,
})

/* ------------------------------------------------------------------- focus */

export type FocusKind =
  | 'relationship-risk'
  | 'refinancing'
  | 'loan-maturity'
  | 'liquidity-event'
  | 'strategy-drift'
  | 'concern-with-market'
  | 'concern'
  | 'excess-liquidity'
  | 'goal-at-risk'
  | 'next-generation'
  | 'overdue-promise'
  | 'follow-up'

/** One thing the meeting could be about, with the numbers and records behind it. */
export interface FocusTopic {
  kind: FocusKind
  /** Ordering only. */
  weight: number
  sourceIds: readonly string[]
  assetClass?: AssetClass
  points?: number
  strategicPercent?: number
  currentPercent?: number
  amount?: number
  daysAhead?: number
  date?: string
  /** The record's own words: a concern, an event title, a goal title, a promise. */
  label?: string
  band?: HealthBand
}

export interface MeetingFocus {
  primary: FocusTopic
  /** At most two, the next most important. */
  supporting: readonly FocusTopic[]
  method: 'meeting-focus-v1'
}

/* ------------------------------------------------------------------- brief */

export type BriefItem =
  | { kind: 'segment'; segment: ClientSegment; sourceIds: readonly string[] }
  | { kind: 'relationship-since'; since: string; sourceIds: readonly string[] }
  | { kind: 'total-wealth'; amount: number; sourceIds: readonly string[] }
  | { kind: 'aum'; amount: number; sourceIds: readonly string[] }
  | { kind: 'risk-profile'; profile: RiskProfile | null; sourceIds: readonly string[] }
  | { kind: 'primary-goal'; goalId: string; title: string; sourceIds: readonly string[] }
  | {
      kind: 'known-concern'
      contextFactId: string
      statement: string
      sourceIds: readonly string[]
    }
  | { kind: 'channel'; channel: CommunicationChannel; sourceIds: readonly string[] }
  | { kind: 'health'; band: HealthBand; score: number; sourceIds: readonly string[] }

/* ---------------------------------------------------------------- promises */

export type PromiseBucket = 'overdue' | 'due-before-meeting' | 'later' | 'completed-since'

export interface PromiseView {
  commitment: Commitment
  bucket: PromiseBucket
  daysToDue: number | null
}

/* ----------------------------------------------------------------- context */

export type ContextReason =
  | 'concern'
  | 'objective'
  | 'behaviour'
  | 'preference'
  | 'business'
  | 'family'
  | 'communication'

export interface ContextItem {
  fact: ContextFact
  reason: ContextReason
}

/* ---------------------------------------------------------------- strategy */

export interface StrategyRow {
  assetClass: AssetClass
  strategicPercent: number
  currentPercent: number
  deviationPoints: number
  meaningful: boolean
}

export type StrategyObservation =
  | {
      kind: 'allocation-deviation'
      assetClass: AssetClass
      points: number
      strategicPercent: number
      currentPercent: number
      sourceIds: readonly string[]
    }
  | {
      kind: 'excess-liquidity'
      amount: number
      sharePercent: number
      sourceIds: readonly string[]
    }
  | { kind: 'goal-behind'; goalId: string; title: string; sourceIds: readonly string[] }

export interface StrategyStatus {
  rows: readonly StrategyRow[]
  liquidity: {
    amount: number
    shareOfFinancialPercent: number
    strategicCashPercent: number | null
  }
  riskProfile: RiskProfile | null
  goalsAffected: readonly Goal[]
  observations: readonly StrategyObservation[]
  /** True when the client has no managed portfolio to compare. */
  noPortfolio: boolean
}

/* --------------------------------------------------------------- financing */

export type FinancingQuestionKind =
  'flexibility-vs-certainty' | 'variable-rate-sensitivity' | 'maturity-plan'

export interface FinancingItem {
  loan: Liability | null
  event: UpcomingEvent | null
  daysAhead: number | null
  /** Days since the last recorded financing discussion; null when none is recorded. */
  discussedDaysAgo: number | null
  questionKind: FinancingQuestionKind
  sourceIds: readonly string[]
}

/* ------------------------------------------------------------------ market */

export type MarketDiscussionKind =
  'explain-thesis' | 'explain-rates' | 'explain-holding-role' | 'explain-currency'

export interface MarketContextItem {
  item: MeetingMarketItem
  discussionKind: MarketDiscussionKind
  /**
   * What the relevance verdict is measured against. `active`: the open move
   * against today's record. `current-recorded`: a closed move judged against
   * the client's current recorded exposure — never a claim about exposure at
   * the historical moment.
   */
  exposureBasis: 'active' | 'current-recorded'
  /** The allocation the baseline snapshot recorded, when the move opened after it. */
  baselineAllocation: readonly { assetClass: AssetClass; percent: number }[] | null
  sourceIds: readonly string[]
}

/* --------------------------------------------------------------- questions */

export type ClientQuestionKind =
  | 'fee'
  | 'energy-holding'
  | 'mortgage'
  | 'reduce-risk'
  | 'cash'
  | 'proceeds'
  | 'performance'
  | 'pension'
  | 'gifts'

export type QuestionConfidence = 'high' | 'medium'

export interface ClientQuestion {
  kind: ClientQuestionKind
  confidence: QuestionConfidence
  /** What the question is grounded in: the kind of record and its id. */
  triggers: readonly { kind: string; id: string | null }[]
  sourceIds: readonly string[]
  /** The record's own words or figure, where the question quotes one. */
  label?: string
  amount?: number
  date?: string
}

export type AdvisorQuestionKind =
  | 'liquidity-intention'
  | 'retirement-timeline'
  | 'refinancing-view'
  | 'concern-nature'
  | 'external-assets'
  | 'proceeds-plan'
  | 'next-generation'
  | 'goal-priority'
  | 'risk-intention'
  | 'valuation-update'
  | 'general'

export interface AdvisorQuestion {
  kind: AdvisorQuestionKind
  sourceIds: readonly string[]
  label?: string
  topic?: ConcernTopic
  date?: string
  amount?: number
  assetClass?: AssetClass
  points?: number
}

/* ----------------------------------------------------------- opportunities */

export type OpportunityKind =
  | 'external-assets'
  | 'excess-liquidity'
  | 'proceeds'
  | 'financing'
  | 'pension'
  | 'family-wealth'
  | 'next-generation'

export interface OpportunityToExplore {
  kind: OpportunityKind
  amount?: number
  date?: string
  /** Titles of the records the item rests on, in their own words. */
  evidence: readonly string[]
  sourceIds: readonly string[]
}

/* ------------------------------------------------------------------- risks */

export type RiskKind =
  | 'overdue-promise'
  | 'complaint'
  | 'fee-sensitivity'
  | 'family-event'
  | 'stale-valuation'
  | 'missing-data'

export interface RiskItem {
  kind: RiskKind
  sourceIds: readonly string[]
  label?: string
  date?: string
  daysOld?: number
  daysAhead?: number
}

/* ------------------------------------------------------------ data quality */

export type DataQualityKind =
  | 'stale-valuation'
  | 'external-not-updated'
  | 'pension-unknown'
  | 'portfolio-stale'
  | 'no-portfolio'

export interface DataQualityItem {
  kind: DataQualityKind
  sourceIds: readonly string[]
  label?: string
  valuedAt?: string
  daysOld?: number
}

/* ---------------------------------------------- agenda, objectives, materials */

export type AgendaKind =
  | 'follow-up'
  | 'strategy'
  | 'concern-market'
  | 'financing'
  | 'liquidity'
  | 'proceeds'
  | 'opportunities'
  | 'promises'
  | 'next-steps'

export interface AgendaItem {
  id: string
  kind: AgendaKind
  sourceIds: readonly string[]
  label?: string
}

export type ObjectiveKind =
  | 'confirm-risk'
  | 'clarify-liquidity'
  | 'agree-refinancing-step'
  | 'close-commitment'
  | 'address-concern'
  | 'plan-proceeds'
  | 'confirm-goal'
  | 'agree-next-step'

export interface ObjectiveItem {
  kind: ObjectiveKind
  sourceIds: readonly string[]
  label?: string
}

export type MaterialKind =
  | 'portfolio-comparison'
  | 'mortgage-alternatives'
  | 'cash-deployment-illustration'
  | 'pension-overview'
  | 'valuation-request'
  | 'fee-overview'
  | 'financing-proposal'
  | 'family-structure-outline'

export interface MaterialItem {
  kind: MaterialKind
  sourceIds: readonly string[]
  label?: string
}

/* -------------------------------------------------------------------- core */

export interface MeetingCockpitCore {
  focus: MeetingFocus
  brief: readonly BriefItem[]
  promises: readonly PromiseView[]
  context: readonly ContextItem[]
  strategy: StrategyStatus
  financing: readonly FinancingItem[]
  market: readonly MarketContextItem[]
  sentinel: SentinelPriority | null
  clientQuestions: readonly ClientQuestion[]
  advisorQuestions: readonly AdvisorQuestion[]
  opportunities: readonly OpportunityToExplore[]
  risks: readonly RiskItem[]
  dataQuality: readonly DataQualityItem[]
  agenda: readonly AgendaItem[]
  objectives: readonly ObjectiveItem[]
  materials: readonly MaterialItem[]
  /** Every record id any item rests on, sorted. */
  sources: readonly string[]
  method: 'meeting-cockpit-v1'
}

const FINANCING_EVENTS: readonly EventType[] = ['mortgage-refinancing', 'loan-maturity']
const LIQUIDITY_EVENTS: readonly EventType[] = [
  'company-sale',
  'liquidity-event',
  'planned-withdrawal',
  'property-completion',
]
const FEE_PATTERN = /avgift|fee|villkor|pris/iu
const LIQUIDITY_PATTERN = /likvid|kassa|reserv|cash/iu
const RETIREMENT_PATTERN = /pension|retire/iu
const LIQUIDITY_GOALS = new Set(['liquidity-reserve'])

function financialAssets(facts: ClientFacts): number {
  return facts.balanceSheet.buckets
    .filter((b) =>
      ['investment-portfolio', 'cash', 'pension', 'other-financial'].includes(b.kind),
    )
    .reduce((sum, b) => sum + b.value, 0)
}

/* ----------------------------------------------------------------- focus */

function focusTopics(
  input: CockpitInput,
  dataQuality: readonly DataQualityItem[],
): FocusTopic[] {
  const { facts, health, signals, market } = input
  const t = COCKPIT_THRESHOLDS
  const topics: FocusTopic[] = []
  const events = upcomingEvents(facts)

  if (health.band === 'at-risk') {
    topics.push({
      kind: 'relationship-risk',
      weight: 85,
      sourceIds: [],
      band: health.band,
    })
  }
  for (const e of events) {
    const daysAhead = daysBetween(facts.today, e.occursOn)
    if (FINANCING_EVENTS.includes(e.type) && daysAhead <= t.financingFocusDays) {
      const loan = facts.liabilities.find((l) => l.id === e.liabilityId)
      topics.push({
        kind: e.type === 'mortgage-refinancing' ? 'refinancing' : 'loan-maturity',
        weight: 80,
        sourceIds: [e.id, ...(e.liabilityId ? [e.liabilityId] : [])],
        daysAhead,
        date: e.occursOn,
        amount: loan?.outstandingBalance,
        label: e.title,
      })
    }
    if (LIQUIDITY_EVENTS.includes(e.type) && daysAhead <= t.liquidityEventDays) {
      topics.push({
        kind: 'liquidity-event',
        weight: 75,
        sourceIds: [e.id],
        daysAhead,
        date: e.occursOn,
        label: e.title,
      })
    }
  }
  const drift = signals.find(
    (s): s is Extract<Signal, { kind: 'allocation-drift' }> =>
      s.kind === 'allocation-drift' && s.assetClass === 'equities',
  )
  if (drift) {
    topics.push({
      kind: 'strategy-drift',
      weight: 70,
      sourceIds: facts.portfolio ? [facts.portfolio.id] : [],
      assetClass: drift.assetClass,
      points: drift.deviationPoints,
      strategicPercent: drift.strategicPercent,
      currentPercent: drift.currentPercent,
    })
  }
  const concern = openConcerns(facts)[0]
  if (concern) {
    const withMarket = market.some((m) =>
      m.impact.reasons.some(
        (r) => r.kind === 'related-concern' && r.contextFactId === concern.id,
      ),
    )
    topics.push({
      kind: withMarket ? 'concern-with-market' : 'concern',
      weight: withMarket ? 75 : 65,
      sourceIds: [concern.id],
      label: concern.statement,
    })
  }
  const cash = signals.find(
    (s): s is Extract<Signal, { kind: 'excess-cash' }> => s.kind === 'excess-cash',
  )
  if (cash) {
    topics.push({
      kind: 'excess-liquidity',
      weight: 60,
      sourceIds: [],
      amount: cash.amount,
    })
  }
  const goalAtRisk = facts.goals.find(
    (g) => g.status === 'at-risk' || g.status === 'behind',
  )
  if (goalAtRisk) {
    topics.push({
      kind: 'goal-at-risk',
      weight: 55,
      sourceIds: [goalAtRisk.id],
      label: goalAtRisk.title,
    })
  }
  const nextGen =
    facts.opportunities.find(
      (o) =>
        (o.type === 'next-generation' || o.type === 'family-wealth') &&
        !['won', 'lost'].includes(o.status),
    ) ?? null
  const genGoal = facts.goals.find((g) => g.kind === 'generational-wealth') ?? null
  if (nextGen || genGoal) {
    topics.push({
      kind: 'next-generation',
      weight: 50,
      sourceIds: [nextGen?.id, genGoal?.id].filter((id): id is string => !!id),
      label: nextGen?.title ?? genGoal?.title,
    })
  }
  const overdue = overdueCommitments(facts)[0]
  if (overdue) {
    topics.push({
      kind: 'overdue-promise',
      weight: 45,
      sourceIds: [overdue.id],
      label: overdue.title,
      date: overdue.dueDate ?? undefined,
    })
  }
  topics.push({ kind: 'follow-up', weight: 10, sourceIds: [] })
  void dataQuality
  return topics.sort((a, b) => b.weight - a.weight || (a.kind < b.kind ? -1 : 1))
}

/* ----------------------------------------------------------------- rules */

export function meetingCockpitCore(input: CockpitInput): MeetingCockpitCore {
  const { facts, assets, health, signals, changes, snapshot, market, sentinel, meeting } =
    input
  const t = COCKPIT_THRESHOLDS
  const today = facts.today
  const events = upcomingEvents(facts)
  const concerns = openConcerns(facts)
  const open = openCommitments(facts)
  const overdue = overdueCommitments(facts)

  /* Data quality first: it feeds the risks. */
  const dataQuality: DataQualityItem[] = []
  for (const asset of assets) {
    const daysOld = daysBetween(asset.valuedAt, today)
    if (
      (asset.kind === 'company-ownership' || asset.kind === 'other-financial') &&
      daysOld >= t.staleValuationDays
    ) {
      dataQuality.push({
        kind: 'stale-valuation',
        sourceIds: [asset.id],
        label: asset.title,
        valuedAt: asset.valuedAt,
        daysOld,
      })
    } else if (
      !asset.withBank &&
      asset.kind !== 'property' &&
      asset.source === 'client-stated' &&
      daysOld >= t.externalUpdateDays
    ) {
      dataQuality.push({
        kind: 'external-not-updated',
        sourceIds: [asset.id],
        label: asset.title,
        valuedAt: asset.valuedAt,
        daysOld,
      })
    }
  }
  if (!assets.some((a) => a.kind === 'pension')) {
    dataQuality.push({ kind: 'pension-unknown', sourceIds: [] })
  }
  if (!facts.portfolio) {
    dataQuality.push({ kind: 'no-portfolio', sourceIds: [] })
  } else if (daysBetween(facts.portfolio.valuedAt, today) >= t.portfolioStaleDays) {
    dataQuality.push({
      kind: 'portfolio-stale',
      sourceIds: [facts.portfolio.id],
      valuedAt: facts.portfolio.valuedAt,
      daysOld: daysBetween(facts.portfolio.valuedAt, today),
    })
  }
  const dataQualityShown = dataQuality.slice(0, t.maxDataQuality)

  /* Focus. */
  const topics = focusTopics(input, dataQualityShown)
  const focus: MeetingFocus = {
    primary: topics[0]!,
    supporting: topics.slice(1, 3).filter((x) => x.weight >= 40),
    method: 'meeting-focus-v1',
  }

  /* Brief. */
  const primaryGoal = facts.goals.find((g) => g.priority === 'primary') ?? facts.goals[0]
  const brief: BriefItem[] = [
    { kind: 'segment', segment: facts.client.segment, sourceIds: [facts.client.id] },
    {
      kind: 'relationship-since',
      since: facts.client.relationshipSince,
      sourceIds: [facts.client.id],
    },
    { kind: 'total-wealth', amount: facts.balanceSheet.totalAssets, sourceIds: [] },
    { kind: 'aum', amount: facts.balanceSheet.assetsWithBank, sourceIds: [] },
    {
      kind: 'risk-profile',
      profile: facts.client.riskProfile,
      sourceIds: [facts.client.id],
    },
  ]
  if (primaryGoal) {
    brief.push({
      kind: 'primary-goal',
      goalId: primaryGoal.id,
      title: primaryGoal.title,
      sourceIds: [primaryGoal.id],
    })
  }
  if (concerns[0]) {
    brief.push({
      kind: 'known-concern',
      contextFactId: concerns[0].id,
      statement: concerns[0].statement,
      sourceIds: [concerns[0].id],
    })
  }
  brief.push({
    kind: 'channel',
    channel: facts.client.preferredChannel,
    sourceIds: [facts.client.id],
  })
  brief.push({ kind: 'health', band: health.band, score: health.score, sourceIds: [] })

  /* Promises. */
  const dueLine = meeting ? meeting.occursOn : null
  const promises: PromiseView[] = [
    ...open.map((c) => {
      const daysToDue = c.dueDate === null ? null : daysBetween(today, c.dueDate)
      const bucket: PromiseBucket =
        daysToDue !== null && daysToDue < 0
          ? 'overdue'
          : c.dueDate !== null &&
              (dueLine
                ? c.dueDate <= dueLine
                : daysToDue !== null && daysToDue <= t.unscheduledDueDays)
            ? 'due-before-meeting'
            : 'later'
      return { commitment: c, bucket, daysToDue }
    }),
    ...facts.commitments
      .filter(
        (c) =>
          c.status === 'done' && c.completedAt !== null && c.completedAt >= changes.since,
      )
      .map((c) => ({
        commitment: c,
        bucket: 'completed-since' as const,
        daysToDue: null,
      })),
  ].sort(
    (a, b) =>
      BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
      (a.commitment.dueDate ?? '9999').localeCompare(b.commitment.dueDate ?? '9999') ||
      a.commitment.id.localeCompare(b.commitment.id),
  )

  /* Context relevant to this meeting. */
  const hasCompany = assets.some((a) => a.kind === 'company-ownership')
  const familyRelevant =
    facts.goals.some(
      (g) => g.kind === 'childrens-future' || g.kind === 'generational-wealth',
    ) ||
    facts.opportunities.some(
      (o) => o.type === 'next-generation' || o.type === 'family-wealth',
    )
  const contextItems: ContextItem[] = []
  const pushContext = (category: ContextCategory, reason: ContextReason) => {
    for (const f of facts.contextFacts) {
      if (f.status === 'active' && f.category === category)
        contextItems.push({ fact: f, reason })
    }
  }
  pushContext('concern', 'concern')
  pushContext('objective', 'objective')
  pushContext('behaviour', 'behaviour')
  pushContext('preference', 'preference')
  if (hasCompany) pushContext('business', 'business')
  if (familyRelevant) pushContext('family', 'family')
  const context = contextItems.slice(0, t.maxContext)

  /* Strategy. */
  const deviations = facts.portfolio ? allocationDeviations(facts.portfolio) : []
  const rows: StrategyRow[] = deviations.map((d) => ({
    assetClass: d.assetClass,
    strategicPercent: d.strategicPercent,
    currentPercent: d.currentPercent,
    deviationPoints: d.deviationPoints,
    meaningful: Math.abs(d.deviationPoints) >= INTELLIGENCE_THRESHOLDS.driftPoints,
  }))
  const financial = financialAssets(facts)
  const cashSignal = signals.find(
    (s): s is Extract<Signal, { kind: 'excess-cash' }> => s.kind === 'excess-cash',
  )
  const goalsAffected = facts.goals.filter(
    (g) => g.status === 'at-risk' || g.status === 'behind',
  )
  const observations: StrategyObservation[] = [
    ...rows
      .filter((r) => r.meaningful)
      .map<StrategyObservation>((r) => ({
        kind: 'allocation-deviation',
        assetClass: r.assetClass,
        points: r.deviationPoints,
        strategicPercent: r.strategicPercent,
        currentPercent: r.currentPercent,
        sourceIds: facts.portfolio ? [facts.portfolio.id] : [],
      })),
    ...(cashSignal
      ? [
          {
            kind: 'excess-liquidity' as const,
            amount: cashSignal.amount,
            sharePercent: cashSignal.sharePercent,
            sourceIds: [],
          },
        ]
      : []),
    ...goalsAffected.map<StrategyObservation>((g) => ({
      kind: 'goal-behind',
      goalId: g.id,
      title: g.title,
      sourceIds: [g.id],
    })),
  ]
  const strategy: StrategyStatus = {
    rows,
    liquidity: {
      amount: facts.balanceSheet.liquidity,
      shareOfFinancialPercent:
        financial === 0
          ? 0
          : Math.round((facts.balanceSheet.liquidity / financial) * 100),
      strategicCashPercent:
        facts.portfolio?.allocation.find((a) => a.assetClass === 'cash')
          ?.strategicPercent ?? null,
    },
    riskProfile: facts.client.riskProfile,
    goalsAffected,
    observations,
    noPortfolio: !facts.portfolio,
  }

  /* Financing. */
  const lastFinancingTalk = facts.interactions.find(
    (i) => i.type === 'financing-discussion' || i.topics.includes('financing'),
  )
  const discussedDaysAgo = lastFinancingTalk
    ? daysBetween(lastFinancingTalk.date, today)
    : null
  const financing: FinancingItem[] = []
  const coveredLoans = new Set<string>()
  for (const e of events) {
    if (!FINANCING_EVENTS.includes(e.type)) continue
    const daysAhead = daysBetween(today, e.occursOn)
    if (daysAhead > t.financingListDays) continue
    const loan = facts.liabilities.find((l) => l.id === e.liabilityId) ?? null
    if (loan) coveredLoans.add(loan.id)
    financing.push({
      loan,
      event: e,
      daysAhead,
      discussedDaysAgo,
      questionKind:
        e.type === 'loan-maturity' || loan?.kind === 'bridge-financing'
          ? 'maturity-plan'
          : 'flexibility-vs-certainty',
      sourceIds: [e.id, ...(loan ? [loan.id] : [])],
    })
  }
  for (const loan of facts.liabilities) {
    if (coveredLoans.has(loan.id)) continue
    const daysAhead = loan.maturityDate ? daysBetween(today, loan.maturityDate) : null
    if (daysAhead !== null && daysAhead >= 0 && daysAhead <= t.financingListDays) {
      financing.push({
        loan,
        event: null,
        daysAhead,
        discussedDaysAgo,
        questionKind:
          loan.kind === 'bridge-financing' ? 'maturity-plan' : 'flexibility-vs-certainty',
        sourceIds: [loan.id],
      })
    } else if (
      loan.interestType === 'variable' &&
      loan.outstandingBalance >= t.variableDebtAmount
    ) {
      financing.push({
        loan,
        event: null,
        daysAhead,
        discussedDaysAgo,
        questionKind: 'variable-rate-sensitivity',
        sourceIds: [loan.id],
      })
    }
  }
  financing.sort((a, b) => (a.daysAhead ?? 9999) - (b.daysAhead ?? 9999))

  /* Market context, filtered to this client already; the discussion point follows the category. */
  const marketItems: MarketContextItem[] = market.slice(0, t.maxMarket).map((m) => {
    const category = m.impact.event.category
    const discussionKind: MarketDiscussionKind =
      category === 'rates'
        ? 'explain-rates'
        : category === 'fx'
          ? 'explain-currency'
          : category === 'sectors' || category === 'commodities'
            ? 'explain-holding-role'
            : 'explain-thesis'
    const openedAfterBaseline =
      snapshot !== null && m.impact.event.firstSeenAt.slice(0, 10) >= snapshot.meetingDate
    return {
      item: m,
      discussionKind,
      exposureBasis: m.status === 'active' ? 'active' : 'current-recorded',
      baselineAllocation:
        openedAfterBaseline && snapshot?.allocation
          ? snapshot.allocation
              .filter(
                (a) => a.assetClass === 'equities' || a.assetClass === 'fixed-income',
              )
              .map((a) => ({ assetClass: a.assetClass, percent: a.currentPercent }))
          : null,
      sourceIds: [...m.impact.sourceIds, m.impact.eventId],
    }
  })

  /* Questions the client may ask. Grounded, labelled possible, never predicted. */
  const clientQuestions: ClientQuestion[] = []
  const feeFacts = facts.contextFacts.filter(
    (f) => f.status === 'active' && FEE_PATTERN.test(f.statement),
  )
  const feeDriver = health.drivers.find((d) => d.kind === 'fee-sensitive')
  if (feeFacts.length > 0 || feeDriver) {
    clientQuestions.push({
      kind: 'fee',
      confidence: feeFacts.length > 0 && feeDriver ? 'high' : 'medium',
      triggers: [
        ...feeFacts.map((f) => ({ kind: 'context-fact', id: f.id })),
        ...(feeDriver ? [{ kind: 'health-driver', id: null }] : []),
      ],
      sourceIds: feeFacts.map((f) => f.id),
      label: feeFacts[0]?.statement,
    })
  }
  const energyConcern = concerns.find((c) =>
    concernTopicsOf(c.statement).includes('energy'),
  )
  const energyMarket = market.find(
    (m) =>
      m.impact.event.tags.sector === 'energy' ||
      m.impact.event.tags.commodityClass === 'energy',
  )
  const energyHolding = (facts.portfolio?.holdings ?? []).find(
    (h) => h.sector === 'energy',
  )
  if (energyConcern && (energyMarket || energyHolding)) {
    clientQuestions.push({
      kind: 'energy-holding',
      confidence: energyMarket ? 'high' : 'medium',
      triggers: [
        { kind: 'concern', id: energyConcern.id },
        ...(energyMarket
          ? [{ kind: 'market-event', id: energyMarket.impact.eventId }]
          : []),
        ...(energyHolding ? [{ kind: 'holding', id: energyHolding.id }] : []),
      ],
      sourceIds: [
        energyConcern.id,
        ...(energyMarket ? [energyMarket.impact.eventId] : []),
        ...(energyHolding ? [energyHolding.id] : []),
      ],
      label: energyConcern.statement,
    })
  }
  const refinancing = financing.find(
    (f) =>
      f.daysAhead !== null &&
      f.daysAhead <= t.clientQuestionFinancingDays &&
      f.questionKind !== 'variable-rate-sensitivity',
  )
  if (refinancing) {
    clientQuestions.push({
      kind: 'mortgage',
      confidence: refinancing.event ? 'high' : 'medium',
      triggers: [
        ...(refinancing.event ? [{ kind: 'event', id: refinancing.event.id }] : []),
        ...(refinancing.loan ? [{ kind: 'loan', id: refinancing.loan.id }] : []),
      ],
      sourceIds: refinancing.sourceIds,
      date: refinancing.event?.occursOn ?? refinancing.loan?.maturityDate ?? undefined,
      amount: refinancing.loan?.outstandingBalance,
    })
  }
  const drawdownFact = facts.contextFacts.find(
    (f) =>
      f.status === 'active' &&
      (f.category === 'concern' || f.category === 'behaviour') &&
      concernTopicsOf(f.statement).includes('drawdown'),
  )
  const equityDown = market.find(
    (m) =>
      (m.impact.event.category === 'equities' ||
        m.impact.event.category === 'risk-appetite') &&
      m.impact.event.direction === 'down',
  )
  const equityDrift = rows.find((r) => r.assetClass === 'equities' && r.meaningful)
  if (drawdownFact && (equityDown || equityDrift)) {
    clientQuestions.push({
      kind: 'reduce-risk',
      confidence: equityDown ? 'high' : 'medium',
      triggers: [
        { kind: drawdownFact.category, id: drawdownFact.id },
        ...(equityDown ? [{ kind: 'market-event', id: equityDown.impact.eventId }] : []),
        ...(equityDrift && facts.portfolio
          ? [{ kind: 'portfolio', id: facts.portfolio.id }]
          : []),
      ],
      sourceIds: [drawdownFact.id, ...(equityDown ? [equityDown.impact.eventId] : [])],
      label: drawdownFact.statement,
    })
  }
  if (cashSignal) {
    clientQuestions.push({
      kind: 'cash',
      confidence: 'medium',
      triggers: [{ kind: 'signal', id: null }],
      sourceIds: [],
      amount: cashSignal.amount,
    })
  }
  const liquidityEvent = events.find(
    (e) => LIQUIDITY_EVENTS.includes(e.type) && daysBetween(today, e.occursOn) <= 240,
  )
  if (liquidityEvent) {
    clientQuestions.push({
      kind: 'proceeds',
      confidence: 'medium',
      triggers: [{ kind: 'event', id: liquidityEvent.id }],
      sourceIds: [liquidityEvent.id],
      label: liquidityEvent.title,
      date: liquidityEvent.occursOn,
    })
  }
  const valueDrop = changes.changes.find(
    (c): c is Extract<typeof c, { kind: 'portfolio-value' }> =>
      c.kind === 'portfolio-value' && c.percent < 0,
  )
  if (valueDrop || (equityDown && facts.portfolio)) {
    clientQuestions.push({
      kind: 'performance',
      confidence: valueDrop && equityDown ? 'high' : 'medium',
      triggers: [
        ...(valueDrop ? [{ kind: 'change', id: null }] : []),
        ...(equityDown ? [{ kind: 'market-event', id: equityDown.impact.eventId }] : []),
      ],
      sourceIds: [
        ...(valueDrop ? valueDrop.sourceIds : []),
        ...(equityDown ? [equityDown.impact.eventId] : []),
      ],
    })
  }
  const pensionEvent = events.find((e) => e.type === 'pension-event')
  const pensionGoal = facts.goals.find((g) => g.kind === 'retirement-income')
  const pensionPromise = open.find((c) => RETIREMENT_PATTERN.test(c.title))
  if (pensionEvent || (pensionGoal && pensionPromise)) {
    clientQuestions.push({
      kind: 'pension',
      confidence: pensionEvent ? 'high' : 'medium',
      triggers: [
        ...(pensionEvent ? [{ kind: 'event', id: pensionEvent.id }] : []),
        ...(pensionGoal ? [{ kind: 'goal', id: pensionGoal.id }] : []),
        ...(pensionPromise ? [{ kind: 'commitment', id: pensionPromise.id }] : []),
      ],
      sourceIds: [pensionEvent?.id, pensionGoal?.id, pensionPromise?.id].filter(
        (id): id is string => !!id,
      ),
    })
  }
  const giftGoal = facts.goals.find((g) => g.kind === 'generational-wealth')
  if (giftGoal) {
    clientQuestions.push({
      kind: 'gifts',
      confidence: 'medium',
      triggers: [{ kind: 'goal', id: giftGoal.id }],
      sourceIds: [giftGoal.id],
      label: giftGoal.title,
    })
  }
  const clientQuestionsShown = [...clientQuestions]
    .sort((a, b) =>
      a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1,
    )
    .slice(0, t.maxClientQuestions)

  /* Questions the advisor should ask. */
  const advisorQuestions: AdvisorQuestion[] = []
  const liquidityObjective = facts.contextFacts.find(
    (f) =>
      f.status === 'active' &&
      f.category === 'objective' &&
      LIQUIDITY_PATTERN.test(f.statement),
  )
  const liquidityGoal = facts.goals.find((g) => LIQUIDITY_GOALS.has(g.kind))
  if (liquidityObjective || (liquidityGoal && cashSignal)) {
    advisorQuestions.push({
      kind: 'liquidity-intention',
      sourceIds: [liquidityObjective?.id, liquidityGoal?.id].filter(
        (id): id is string => !!id,
      ),
      label: liquidityObjective?.statement ?? liquidityGoal?.title,
    })
  }
  const retirementGoal = facts.goals.find((g) => g.kind === 'retirement-income')
  if (retirementGoal || pensionEvent) {
    advisorQuestions.push({
      kind: 'retirement-timeline',
      sourceIds: [retirementGoal?.id, pensionEvent?.id].filter(
        (id): id is string => !!id,
      ),
      label: retirementGoal?.title ?? pensionEvent?.title,
    })
  }
  if (refinancing) {
    advisorQuestions.push({
      kind: 'refinancing-view',
      sourceIds: refinancing.sourceIds,
      date: refinancing.event?.occursOn ?? refinancing.loan?.maturityDate ?? undefined,
    })
  }
  for (const concern of concerns.slice(0, 1)) {
    const topics = concernTopicsOf(concern.statement)
    advisorQuestions.push({
      kind: 'concern-nature',
      sourceIds: [concern.id],
      label: concern.statement,
      topic: topics[0],
    })
  }
  const external = assets.filter((a) => !a.withBank)
  const externalTotal = external.reduce((sum, a) => sum + a.value, 0)
  if (externalTotal >= t.externalAssetsAmount) {
    advisorQuestions.push({
      kind: 'external-assets',
      sourceIds: external.map((a) => a.id),
      amount: externalTotal,
    })
  }
  if (liquidityEvent) {
    advisorQuestions.push({
      kind: 'proceeds-plan',
      sourceIds: [liquidityEvent.id],
      label: liquidityEvent.title,
      date: liquidityEvent.occursOn,
    })
  }
  const nextGenTopic = topics.find((x) => x.kind === 'next-generation')
  if (nextGenTopic) {
    advisorQuestions.push({
      kind: 'next-generation',
      sourceIds: nextGenTopic.sourceIds,
      label: nextGenTopic.label,
    })
  }
  for (const g of goalsAffected.slice(0, 1)) {
    advisorQuestions.push({ kind: 'goal-priority', sourceIds: [g.id], label: g.title })
  }
  if (equityDrift && facts.portfolio) {
    advisorQuestions.push({
      kind: 'risk-intention',
      sourceIds: [facts.portfolio.id],
      assetClass: 'equities',
      points: equityDrift.deviationPoints,
    })
  }
  const staleCompany = dataQuality.find((d) => d.kind === 'stale-valuation')
  if (staleCompany) {
    advisorQuestions.push({
      kind: 'valuation-update',
      sourceIds: staleCompany.sourceIds,
      label: staleCompany.label,
      date: staleCompany.valuedAt,
    })
  }
  if (advisorQuestions.length === 0)
    advisorQuestions.push({ kind: 'general', sourceIds: [] })
  const advisorQuestionsShown = advisorQuestions.slice(0, t.maxAdvisorQuestions)

  /* Opportunities to explore — client-first, restrained. */
  const opportunities: OpportunityToExplore[] = []
  const recordsOf = (types: readonly string[]) =>
    facts.opportunities.filter(
      (o) => types.includes(o.type) && !['won', 'lost'].includes(o.status),
    )
  if (externalTotal >= t.externalAssetsAmount) {
    const records = recordsOf(['external-asset-transfer'])
    opportunities.push({
      kind: 'external-assets',
      amount: externalTotal,
      evidence: [...external.map((a) => a.title), ...records.map((o) => o.title)],
      sourceIds: [...external.map((a) => a.id), ...records.map((o) => o.id)],
    })
  }
  if (cashSignal) {
    const records = recordsOf(['liquidity-deployment', 'investment'])
    opportunities.push({
      kind: 'excess-liquidity',
      amount: cashSignal.amount,
      evidence: records.map((o) => o.title),
      sourceIds: records.map((o) => o.id),
    })
  }
  if (liquidityEvent) {
    const records = recordsOf(['company-sale-proceeds', 'investment'])
    opportunities.push({
      kind: 'proceeds',
      date: liquidityEvent.occursOn,
      evidence: [liquidityEvent.title, ...records.map((o) => o.title)],
      sourceIds: [liquidityEvent.id, ...records.map((o) => o.id)],
    })
  }
  if (financing.length > 0) {
    const records = recordsOf(['financing', 'property-financing'])
    const first = financing[0]!
    opportunities.push({
      kind: 'financing',
      amount: first.loan?.outstandingBalance,
      date: first.event?.occursOn ?? first.loan?.maturityDate ?? undefined,
      evidence: [
        ...(first.event ? [first.event.title] : first.loan ? [first.loan.title] : []),
        ...records.map((o) => o.title),
      ],
      sourceIds: [...first.sourceIds, ...records.map((o) => o.id)],
    })
  }
  if (pensionGoal || pensionEvent || !assets.some((a) => a.kind === 'pension')) {
    const records = recordsOf(['pension'])
    if (pensionGoal || pensionEvent || records.length > 0) {
      opportunities.push({
        kind: 'pension',
        evidence: [
          pensionGoal?.title,
          pensionEvent?.title,
          ...records.map((o) => o.title),
        ].filter((x): x is string => !!x),
        sourceIds: [
          pensionGoal?.id,
          pensionEvent?.id,
          ...records.map((o) => o.id),
        ].filter((id): id is string => !!id),
      })
    }
  }
  const familyRecords = recordsOf(['family-wealth'])
  if (giftGoal || familyRecords.length > 0) {
    opportunities.push({
      kind: 'family-wealth',
      evidence: [giftGoal?.title, ...familyRecords.map((o) => o.title)].filter(
        (x): x is string => !!x,
      ),
      sourceIds: [giftGoal?.id, ...familyRecords.map((o) => o.id)].filter(
        (id): id is string => !!id,
      ),
    })
  }
  const nextGenRecords = recordsOf(['next-generation'])
  if (nextGenRecords.length > 0) {
    opportunities.push({
      kind: 'next-generation',
      evidence: nextGenRecords.map((o) => o.title),
      sourceIds: nextGenRecords.map((o) => o.id),
    })
  }
  const opportunitiesShown = opportunities.slice(0, t.maxOpportunities)

  /* Don't forget. */
  const risks: RiskItem[] = []
  for (const c of overdue.slice(0, 1)) {
    risks.push({
      kind: 'overdue-promise',
      sourceIds: [c.id],
      label: c.title,
      date: c.dueDate ?? undefined,
      daysOld: c.dueDate ? daysBetween(c.dueDate, today) : undefined,
    })
  }
  const complaint = facts.interactions.find(
    (i) => i.type === 'complaint' && daysBetween(i.date, today) <= t.complaintDays,
  )
  if (complaint) {
    risks.push({
      kind: 'complaint',
      sourceIds: [complaint.id],
      label: complaint.title,
      date: complaint.date,
    })
  }
  if (feeFacts[0] || feeDriver) {
    risks.push({
      kind: 'fee-sensitivity',
      sourceIds: feeFacts.map((f) => f.id),
      label: feeFacts[0]?.statement,
    })
  }
  const familyEvent = events.find(
    (e) =>
      (e.type === 'birthday' || e.type === 'family-event') &&
      daysBetween(today, e.occursOn) <= t.familyEventDays,
  )
  if (familyEvent) {
    risks.push({
      kind: 'family-event',
      sourceIds: [familyEvent.id],
      label: familyEvent.title,
      date: familyEvent.occursOn,
      daysAhead: daysBetween(today, familyEvent.occursOn),
    })
  }
  if (staleCompany) {
    risks.push({
      kind: 'stale-valuation',
      sourceIds: staleCompany.sourceIds,
      label: staleCompany.label,
      date: staleCompany.valuedAt,
      daysOld: staleCompany.daysOld,
    })
  }
  const missing = dataQualityShown.find(
    (d) => d.kind === 'pension-unknown' || d.kind === 'no-portfolio',
  )
  if (missing) {
    risks.push({
      kind: 'missing-data',
      sourceIds: missing.sourceIds,
      label: missing.kind,
    })
  }
  const risksShown = risks.slice(0, t.maxRisks)

  /* Agenda. */
  const agenda: AgendaItem[] = [{ id: 'follow-up', kind: 'follow-up', sourceIds: [] }]
  if (observations.some((o) => o.kind === 'allocation-deviation')) {
    agenda.push({
      id: 'strategy',
      kind: 'strategy',
      sourceIds: facts.portfolio ? [facts.portfolio.id] : [],
    })
  }
  if (concerns.length > 0 || marketItems.length > 0) {
    agenda.push({
      id: 'concern-market',
      kind: 'concern-market',
      sourceIds: [
        ...concerns.map((c) => c.id),
        ...marketItems.map((m) => m.item.impact.eventId),
      ],
      label: concerns[0]?.statement,
    })
  }
  if (financing.length > 0) {
    agenda.push({
      id: 'financing',
      kind: 'financing',
      sourceIds: financing[0]!.sourceIds,
      label: financing[0]!.event?.title ?? financing[0]!.loan?.title,
    })
  }
  if (cashSignal) agenda.push({ id: 'liquidity', kind: 'liquidity', sourceIds: [] })
  if (liquidityEvent) {
    agenda.push({
      id: 'proceeds',
      kind: 'proceeds',
      sourceIds: [liquidityEvent.id],
      label: liquidityEvent.title,
    })
  }
  if (promises.some((p) => p.bucket !== 'completed-since')) {
    agenda.push({
      id: 'promises',
      kind: 'promises',
      sourceIds: promises
        .filter((p) => p.bucket !== 'completed-since')
        .map((p) => p.commitment.id),
    })
  }
  if (
    opportunitiesShown.some(
      (o) => o.kind !== 'financing' && o.kind !== 'excess-liquidity',
    )
  ) {
    agenda.push({ id: 'opportunities', kind: 'opportunities', sourceIds: [] })
  }
  agenda.push({ id: 'next-steps', kind: 'next-steps', sourceIds: [] })

  /* Objectives, outcome oriented. */
  const objectives: ObjectiveItem[] = []
  if (equityDrift && facts.portfolio) {
    objectives.push({ kind: 'confirm-risk', sourceIds: [facts.portfolio.id] })
  }
  if (cashSignal) objectives.push({ kind: 'clarify-liquidity', sourceIds: [] })
  if (refinancing) {
    objectives.push({ kind: 'agree-refinancing-step', sourceIds: refinancing.sourceIds })
  }
  const promiseToClose = promises.find(
    (p) => p.bucket === 'overdue' || p.bucket === 'due-before-meeting',
  )
  if (promiseToClose) {
    objectives.push({
      kind: 'close-commitment',
      sourceIds: [promiseToClose.commitment.id],
      label: promiseToClose.commitment.title,
    })
  }
  if (concerns[0]) {
    objectives.push({
      kind: 'address-concern',
      sourceIds: [concerns[0].id],
      label: concerns[0].statement,
    })
  }
  if (liquidityEvent) {
    objectives.push({
      kind: 'plan-proceeds',
      sourceIds: [liquidityEvent.id],
      label: liquidityEvent.title,
    })
  }
  if (goalsAffected[0]) {
    objectives.push({
      kind: 'confirm-goal',
      sourceIds: [goalsAffected[0].id],
      label: goalsAffected[0].title,
    })
  }
  if (objectives.length === 0) objectives.push({ kind: 'agree-next-step', sourceIds: [] })
  const objectivesShown = objectives.slice(0, t.maxObjectives)

  /* Materials, only where a fact supports them. */
  const materials: MaterialItem[] = []
  const comparisonPromise = open.find((c) => /jämför|alternativ/iu.test(c.title))
  if (equityDrift || comparisonPromise) {
    materials.push({
      kind: 'portfolio-comparison',
      sourceIds: [comparisonPromise?.id, facts.portfolio?.id].filter(
        (id): id is string => !!id,
      ),
      label: comparisonPromise?.title,
    })
  }
  const mortgage = financing.find(
    (f) => f.questionKind === 'flexibility-vs-certainty' && f.daysAhead !== null,
  )
  if (mortgage)
    materials.push({ kind: 'mortgage-alternatives', sourceIds: mortgage.sourceIds })
  const bridge = financing.find((f) => f.questionKind === 'maturity-plan')
  if (bridge) materials.push({ kind: 'financing-proposal', sourceIds: bridge.sourceIds })
  if (cashSignal) materials.push({ kind: 'cash-deployment-illustration', sourceIds: [] })
  if (pensionGoal || pensionEvent || pensionPromise) {
    materials.push({
      kind: 'pension-overview',
      sourceIds: [pensionGoal?.id, pensionEvent?.id, pensionPromise?.id].filter(
        (id): id is string => !!id,
      ),
    })
  }
  if (staleCompany) {
    materials.push({
      kind: 'valuation-request',
      sourceIds: staleCompany.sourceIds,
      label: staleCompany.label,
    })
  }
  if (feeFacts[0] || feeDriver) {
    materials.push({ kind: 'fee-overview', sourceIds: feeFacts.map((f) => f.id) })
  }
  if (familyRecords.length > 0 || nextGenRecords.length > 0) {
    materials.push({
      kind: 'family-structure-outline',
      sourceIds: [...familyRecords, ...nextGenRecords].map((o) => o.id),
    })
  }
  const materialsShown = materials.slice(0, t.maxMaterials)

  /* Sources. */
  const sources = [
    ...new Set([
      ...topics.flatMap((x) => x.sourceIds),
      ...brief.flatMap((b) => b.sourceIds),
      ...promises.map((p) => p.commitment.id),
      ...context.map((c) => c.fact.id),
      ...observations.flatMap((o) => o.sourceIds),
      ...financing.flatMap((f) => f.sourceIds),
      ...marketItems.flatMap((m) => m.sourceIds),
      ...(sentinel ? sentinel.sourceIds : []),
      ...clientQuestionsShown.flatMap((q) => q.sourceIds),
      ...advisorQuestionsShown.flatMap((q) => q.sourceIds),
      ...opportunitiesShown.flatMap((o) => o.sourceIds),
      ...risksShown.flatMap((r) => r.sourceIds),
      ...dataQualityShown.flatMap((d) => d.sourceIds),
      ...changes.changes.flatMap((c) => c.sourceIds),
    ]),
  ].sort()

  return {
    focus,
    brief,
    promises,
    context,
    strategy,
    financing,
    market: marketItems,
    sentinel,
    clientQuestions: clientQuestionsShown,
    advisorQuestions: advisorQuestionsShown,
    opportunities: opportunitiesShown,
    risks: risksShown,
    dataQuality: dataQualityShown,
    agenda,
    objectives: objectivesShown,
    materials: materialsShown,
    sources,
    method: 'meeting-cockpit-v1',
  }
}

const BUCKET_ORDER: Record<PromiseBucket, number> = {
  overdue: 0,
  'due-before-meeting': 1,
  later: 2,
  'completed-since': 3,
}
