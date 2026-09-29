/**
 * Market-to-Client — which clients should care about what happened in
 * markets, why, and what the advisor should prepare.
 *
 * The chain: MARKET OBSERVATION → MARKET EVENT (material, deduplicated,
 * expiring) → CLIENT EXPOSURE (what the record actually holds) → CLIENT
 * RELEVANCE (exposure × context) → a Sentinel driver. Every step is
 * deterministic, every threshold is stated once below, and every impact
 * keeps the ids of the records it rests on.
 *
 * A market move is not a client alert. An impact exists only where a
 * material move meets a recorded exposure or a recorded context; a client
 * whose record says nothing relevant stays quiet, and the product is
 * comfortable saying so.
 *
 * Nothing here recommends a trade. An interpretation is typed as an
 * interpretation, never as a fact, and the preparation it suggests is the
 * advisor's to judge.
 */

import { daysBetween } from './dates'
import { nextMeeting, openConcerns, type ClientFacts } from './intelligence'
import {
  allocationDeviations,
  type AssetClass,
  type Holding,
  type Region,
  type Sector,
} from './portfolio'
import type { InterestType, LiabilityKind } from './wealth'

/* ------------------------------------------------------------ observations */

export type MarketCategory =
  'rates' | 'equities' | 'sectors' | 'fx' | 'commodities' | 'risk-appetite'

/** How the observation relates to the market — the freshness the UI must disclose. */
export type MarketQuality = 'live' | 'delayed' | 'official-daily' | 'stale' | 'fixture'

/** What a market series did, as the market pipeline reported it. Numeric, typed, provenance kept. */
export interface MarketObservation {
  symbol: string
  category: MarketCategory
  label: string
  value: number
  /** Rates: basis points. Equities, sectors, FX, commodities: percent. Risk appetite: score points vs the neutral 50. `null` when the source gave no comparable prior. */
  change: number | null
  changeUnit: 'bp' | 'percent' | 'points'
  /** For a sector: the broad index change the sector is measured against. */
  reference?: number | null
  /** ISO timestamp the source observed the value. */
  observedAt: string
  source: string
  quality: MarketQuality
  tags: {
    currency?: string
    sector?: Sector
    region?: Region
    tenorMonths?: number
    commodityClass?: 'energy' | 'metal'
  }
}

/* ------------------------------------------------------------- materiality */

/** One category's lines: where an event opens, where it stays open, where it is major, how long it lasts unobserved. */
export interface MaterialityRule {
  enter: number
  exit: number
  major: number
  unit: 'bp' | 'percent' | 'points'
  expiryHours: number
}

/**
 * The policy boundary. Event detection and client relevance read a policy,
 * never the constants: a volatility-scaled or regime-aware policy later
 * replaces `MATERIALITY` behind this type without touching either.
 */
export type MaterialityPolicy = Readonly<Record<MarketCategory, MaterialityRule>>

/**
 * When a move becomes eligible for client analysis, stated once — V1's
 * fixed lines.
 *
 * `enter` opens an event; `exit` keeps an open event alive until the move
 * has faded below it (hysteresis, so a move oscillating around the line does
 * not open and close all day); `major` marks the move as severe. Expiry is
 * the horizon after the last observation beyond which the event stops
 * contributing to current urgency — not the point at which it is forgotten.
 */
export const MATERIALITY: MaterialityPolicy = Object.freeze({
  rates: { enter: 10, exit: 6, major: 20, unit: 'bp', expiryHours: 72 },
  equities: { enter: 1.5, exit: 1.0, major: 3, unit: 'percent', expiryHours: 24 },
  /** Relative to the broad index, so a sector moving with the market is not an event of its own. */
  sectors: { enter: 2, exit: 1.2, major: 4, unit: 'percent', expiryHours: 24 },
  fx: { enter: 1.0, exit: 0.6, major: 2, unit: 'percent', expiryHours: 48 },
  commodities: { enter: 3, exit: 2, major: 6, unit: 'percent', expiryHours: 48 },
  /** Distance below the neutral 50 at which the regime is risk-off. */
  'risk-appetite': { enter: 20, exit: 12, major: 30, unit: 'points', expiryHours: 24 },
})

/* ------------------------------------------------------------------ events */

export type MarketMetric =
  | 'yield-change'
  | 'index-change'
  | 'sector-relative-change'
  | 'fx-change'
  | 'commodity-change'
  | 'risk-appetite-regime'

export type MarketSeverity = 'notable' | 'major'

/** One evolving market episode: the same key keeps its identity and first-seen time while its values update. */
export interface MarketEvent {
  /** `${category}:${symbol}:daily` — the deduplication key and the id. */
  id: string
  category: MarketCategory
  symbol: string
  label: string
  metric: MarketMetric
  currentValue: number
  previousValue: number | null
  /** Signed, in `changeUnit`. For a sector: the move relative to the broad index. */
  change: number
  changeUnit: 'bp' | 'percent' | 'points'
  direction: 'up' | 'down'
  magnitude: number
  severity: MarketSeverity
  horizon: 'daily'
  observedAt: string
  source: string
  quality: MarketQuality
  /** The largest signed move seen during the episode, and when — what history quotes after the move has faded. */
  peakChange: number
  peakAt: string
  /** The lines this event was judged against, kept on the event so an explanation quotes the policy that applied. */
  thresholds: { enter: number; exit: number; major: number }
  /** ISO timestamps: when the episode opened, when it was last updated, when it lapses. */
  firstSeenAt: string
  updatedAt: string
  expiresAt: string
  tags: MarketObservation['tags']
}

export type CloseReason = 'faded' | 'expired'

/**
 * An episode that ended: the event as it last stood, with when and why it
 * closed. History, never urgency — it answers "what happened since the last
 * meeting" and contributes nothing to a current priority.
 */
export interface ClosedMarketEvent extends MarketEvent {
  /** `${id}@${firstSeenAt}`: the same key can open again later as a new episode. */
  recordId: string
  closedAt: string
  closeReason: CloseReason
}

/** What the ledger holds: the open episodes and the ones that ended. */
export interface MarketLedgerState {
  active: readonly MarketEvent[]
  history: readonly ClosedMarketEvent[]
}

export const EMPTY_MARKET_LEDGER: MarketLedgerState = Object.freeze({
  active: [],
  history: [],
})

/** How long a closed episode stays queryable. */
export const HISTORY_RETENTION_DAYS = 180

const METRIC: Record<MarketCategory, MarketMetric> = {
  rates: 'yield-change',
  equities: 'index-change',
  sectors: 'sector-relative-change',
  fx: 'fx-change',
  commodities: 'commodity-change',
  'risk-appetite': 'risk-appetite-regime',
}

/** The signed move an observation is judged on: relative for a sector, distance below neutral for risk appetite. */
export function effectiveChange(observation: MarketObservation): number | null {
  if (observation.change === null) return null
  if (observation.category === 'sectors') {
    return observation.reference === null || observation.reference === undefined
      ? observation.change
      : observation.change - observation.reference
  }
  if (observation.category === 'risk-appetite') return observation.value - 50
  return observation.change
}

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString()
}

function eventFrom(
  observation: MarketObservation,
  change: number,
  now: string,
  existing: MarketEvent | null,
  rule: MaterialityRule,
): MarketEvent {
  const magnitude = Math.abs(change)
  const rounded = Math.round(change * 100) / 100
  const peakHeld = existing !== null && Math.abs(existing.peakChange) >= magnitude
  return {
    id: `${observation.category}:${observation.symbol}:daily`,
    category: observation.category,
    symbol: observation.symbol,
    label: observation.label,
    metric: METRIC[observation.category],
    currentValue: observation.value,
    previousValue:
      observation.category === 'risk-appetite' || observation.change === null
        ? null
        : observation.changeUnit === 'bp'
          ? Math.round((observation.value - observation.change / 100) * 10000) / 10000
          : Math.round((observation.value / (1 + observation.change / 100)) * 10000) /
            10000,
    change: rounded,
    changeUnit: observation.changeUnit,
    direction: change >= 0 ? 'up' : 'down',
    magnitude: Math.round(magnitude * 100) / 100,
    severity: magnitude >= rule.major ? 'major' : 'notable',
    horizon: 'daily',
    observedAt: observation.observedAt,
    source: observation.source,
    quality: observation.quality,
    peakChange: peakHeld ? existing.peakChange : rounded,
    peakAt: peakHeld ? existing.peakAt : observation.observedAt,
    thresholds: { enter: rule.enter, exit: rule.exit, major: rule.major },
    firstSeenAt: existing?.firstSeenAt ?? now,
    updatedAt: now,
    expiresAt: addHours(observation.observedAt, rule.expiryHours),
    tags: observation.tags,
  }
}

/**
 * The active events after this read: opened where a move crosses `enter`,
 * kept while it stays above `exit`, updated in place, dropped when it fades
 * or its observation expires. Risk appetite opens only on the risk-off side:
 * a calm market is not an event.
 */
export function reconcileMarketEvents(
  ledger: readonly MarketEvent[],
  observations: readonly MarketObservation[],
  now: string,
  policy: MaterialityPolicy = MATERIALITY,
): MarketEvent[] {
  const byId = new Map(ledger.map((event) => [event.id, event]))
  const active: MarketEvent[] = []
  const seen = new Set<string>()

  for (const observation of observations) {
    const change = effectiveChange(observation)
    if (change === null) continue
    if (observation.category === 'risk-appetite' && change >= 0) continue
    const rule = policy[observation.category]
    const id = `${observation.category}:${observation.symbol}:daily`
    /* An expired entry is no episode: the enter line applies and the first-seen time starts afresh. */
    const remembered = byId.get(id)
    const existing = remembered && remembered.expiresAt > now ? remembered : null
    const magnitude = Math.abs(change)
    const threshold = existing ? rule.exit : rule.enter
    seen.add(id)
    if (magnitude < threshold) continue
    active.push(eventFrom(observation, change, now, existing, rule))
  }

  /* An event whose series was not observed this read survives until it expires. */
  for (const event of ledger) {
    if (seen.has(event.id)) continue
    if (event.expiresAt > now) active.push(event)
  }

  return active
    .filter((event) => event.expiresAt > now)
    .sort(
      (a, b) =>
        b.magnitude / b.thresholds.enter - a.magnitude / a.thresholds.enter ||
        (a.id < b.id ? -1 : 1),
    )
}

/**
 * The ledger after this read: the active events reconciled as above, and
 * every episode that ended — faded below `exit`, or expired unobserved —
 * moved to history with when and why. Expiry means the event stops
 * contributing to current urgency; it never means the system forgets it.
 * History is pruned after `HISTORY_RETENTION_DAYS`.
 */
export function reconcileMarketLedger(
  state: MarketLedgerState,
  observations: readonly MarketObservation[],
  now: string,
  policy: MaterialityPolicy = MATERIALITY,
): MarketLedgerState {
  const active = reconcileMarketEvents(state.active, observations, now, policy)
  /* The same key re-opened after expiry is a new episode: the old one closes by first-seen time, not by id. */
  const survives = new Set(active.map((e) => `${e.id}@${e.firstSeenAt}`))
  const closed: ClosedMarketEvent[] = state.active
    .filter((e) => !survives.has(`${e.id}@${e.firstSeenAt}`))
    .map((e) => ({
      ...e,
      recordId: `${e.id}@${e.firstSeenAt}`,
      closedAt: now,
      closeReason: e.expiresAt <= now ? 'expired' : 'faded',
    }))
  const cutoff = addHours(now, -HISTORY_RETENTION_DAYS * 24)
  const history = [...state.history, ...closed]
    .filter((h) => h.closedAt > cutoff)
    .sort((a, b) =>
      a.closedAt > b.closedAt
        ? -1
        : a.closedAt < b.closedAt
          ? 1
          : a.recordId < b.recordId
            ? -1
            : 1,
    )
  return { active, history }
}

/** One event with the status the ledger gives it. */
export type MarketEventStatus =
  | { status: 'active'; event: MarketEvent }
  | { status: 'closed'; event: ClosedMarketEvent }

/**
 * Every episode that opened on or after `since` — an ISO date or timestamp —
 * whether it is still open or already closed, newest first. What a meeting
 * briefing reads to answer "what happened since the last meeting" without
 * needing the moves to be current.
 */
export function marketEventsSince(
  state: MarketLedgerState,
  since: string,
): MarketEventStatus[] {
  const opened = (event: MarketEvent) => event.firstSeenAt >= since
  const all: MarketEventStatus[] = [
    ...state.active.filter(opened).map((event) => ({ status: 'active' as const, event })),
    ...state.history
      .filter(opened)
      .map((event) => ({ status: 'closed' as const, event })),
  ]
  return all.sort((a, b) =>
    a.event.firstSeenAt > b.event.firstSeenAt
      ? -1
      : a.event.firstSeenAt < b.event.firstSeenAt
        ? 1
        : a.event.id < b.event.id
          ? -1
          : 1,
  )
}

/* ---------------------------------------------------------------- exposure */

export type ConcernTopic = 'rates' | 'equities' | 'energy' | 'fx' | 'drawdown' | 'fees'

export interface LoanExposure {
  id: string
  kind: LiabilityKind
  balance: number
  interestType: InterestType
  maturityDate: string | null
  daysToMaturity: number | null
}

/** What the record actually holds — never inferred beyond the recorded holdings, loans and facts. */
export interface ClientExposure {
  clientId: string
  aum: number
  totalAssets: number
  /** Percent of the managed portfolio, current and strategic, per asset class. */
  assetClassShare: Record<AssetClass, number>
  strategicShare: Record<AssetClass, number>
  /** Current minus strategic, percentage points. */
  equityDeviationPoints: number
  /** Percent of the managed portfolio in holdings tagged with the sector. */
  sectorShare: Partial<Record<Sector, number>>
  /** Percent of the managed portfolio in holdings denominated in the currency. */
  currencyShare: Partial<Record<string, number>>
  regionShare: Partial<Record<Region, number>>
  /** The largest single holding, percent of the portfolio. */
  largestHoldingPercent: number
  /** Cash as a share of financial assets, percent. */
  cashShareOfFinancialPercent: number
  loans: readonly LoanExposure[]
  /** Days to the nearest fixed-rate maturity or refinancing, where one is recorded. */
  refinancingWithinDays: number | null
  variableRateDebt: number
  /** Topics the client's active concerns speak to, with the fact ids behind them. */
  concerns: readonly { topic: ConcernTopic; contextFactId: string; statement: string }[]
  /** A recorded behaviour of discomfort in drawdowns, with the fact id. */
  drawdownSensitivity: { contextFactId: string; statement: string } | null
  daysToNextMeeting: number | null
  nextMeetingEventId: string | null
  holdingIds: readonly string[]
}

const CONCERN_LEXICON: readonly { topic: ConcernTopic; pattern: RegExp }[] = [
  { topic: 'energy', pattern: /energi|olj|oil|energy/iu },
  { topic: 'rates', pattern: /ränt|bolån|lån|refinans|rate|mortgage|loan/iu },
  { topic: 'fx', pattern: /valuta|dollar|usd|euro|kron|currency/iu },
  {
    topic: 'drawdown',
    pattern: /nedgång|drawdown|svängning|volatil|fall|förlust|risk/iu,
  },
  { topic: 'fees', pattern: /avgift|fee/iu },
  { topic: 'equities', pattern: /aktie|equit|börs|allokering/iu },
]

/** The topics a statement speaks to, in lexicon order. Deterministic; a statement may carry several. */
export function concernTopicsOf(statement: string): ConcernTopic[] {
  return CONCERN_LEXICON.filter((entry) => entry.pattern.test(statement)).map(
    (entry) => entry.topic,
  )
}

const ASSET_CLASSES: readonly AssetClass[] = [
  'equities',
  'fixed-income',
  'alternatives',
  'cash',
]

export function exposureOf(facts: ClientFacts): ClientExposure {
  const portfolio = facts.portfolio
  const holdings: readonly Holding[] = portfolio?.holdings ?? []
  const assetClassShare = Object.fromEntries(ASSET_CLASSES.map((c) => [c, 0])) as Record<
    AssetClass,
    number
  >
  const strategicShare = Object.fromEntries(ASSET_CLASSES.map((c) => [c, 0])) as Record<
    AssetClass,
    number
  >
  for (const slice of portfolio?.allocation ?? []) {
    assetClassShare[slice.assetClass] = slice.currentPercent
    strategicShare[slice.assetClass] = slice.strategicPercent
  }
  const sectorShare: Partial<Record<Sector, number>> = {}
  const currencyShare: Partial<Record<string, number>> = {}
  const regionShare: Partial<Record<Region, number>> = {}
  for (const holding of holdings) {
    sectorShare[holding.sector] =
      Math.round(((sectorShare[holding.sector] ?? 0) + holding.weightPercent) * 10) / 10
    currencyShare[holding.currency] =
      Math.round(((currencyShare[holding.currency] ?? 0) + holding.weightPercent) * 10) /
      10
    regionShare[holding.region] =
      Math.round(((regionShare[holding.region] ?? 0) + holding.weightPercent) * 10) / 10
  }
  const equity = portfolio
    ? (allocationDeviations(portfolio).find((d) => d.assetClass === 'equities')
        ?.deviationPoints ?? 0)
    : 0

  const financial = facts.balanceSheet.buckets
    .filter((b) =>
      ['investment-portfolio', 'cash', 'pension', 'other-financial'].includes(b.kind),
    )
    .reduce((sum, b) => sum + b.value, 0)

  const loans: LoanExposure[] = facts.liabilities.map((l) => ({
    id: l.id,
    kind: l.kind,
    balance: l.outstandingBalance,
    interestType: l.interestType,
    maturityDate: l.maturityDate,
    daysToMaturity:
      l.maturityDate === null ? null : daysBetween(facts.today, l.maturityDate),
  }))
  const refinancing = loans
    .map((l) => l.daysToMaturity)
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b)[0]

  const concerns = openConcerns(facts).flatMap((fact) =>
    concernTopicsOf(fact.statement).map((topic) => ({
      topic,
      contextFactId: fact.id,
      statement: fact.statement,
    })),
  )
  const behaviour = facts.contextFacts.find(
    (f) =>
      f.status === 'active' &&
      f.category === 'behaviour' &&
      /nedgång|drawdown|svängning|volatil/iu.test(f.statement),
  )
  const meeting = nextMeeting(facts)

  return {
    clientId: facts.client.id,
    aum: facts.balanceSheet.assetsWithBank,
    totalAssets: facts.balanceSheet.totalAssets,
    assetClassShare,
    strategicShare,
    equityDeviationPoints: equity,
    sectorShare,
    currencyShare,
    regionShare,
    largestHoldingPercent: holdings.reduce((max, h) => Math.max(max, h.weightPercent), 0),
    cashShareOfFinancialPercent:
      financial === 0 ? 0 : Math.round((facts.balanceSheet.liquidity / financial) * 100),
    loans,
    refinancingWithinDays: refinancing ?? null,
    variableRateDebt: loans
      .filter((l) => l.interestType === 'variable')
      .reduce((sum, l) => sum + l.balance, 0),
    concerns,
    drawdownSensitivity: behaviour
      ? { contextFactId: behaviour.id, statement: behaviour.statement }
      : null,
    daysToNextMeeting: meeting ? daysBetween(facts.today, meeting.occursOn) : null,
    nextMeetingEventId: meeting?.id ?? null,
    holdingIds: holdings.map((h) => h.id),
  }
}

/* --------------------------------------------------------------- relevance */

/** Exposure sizes at which a pathway counts, stated once. Percent of the managed portfolio unless said otherwise. */
export const EXPOSURE_THRESHOLDS = Object.freeze({
  /** Fixed income share at which a yield move is a direct exposure. */
  fixedIncomeShare: 15,
  /** Equity share at which a broad index move is a direct exposure. */
  equityShare: 40,
  /** Regional share at which a regional index is the relevant one. */
  regionShare: 10,
  /** Sector share at which a sector move is a direct exposure. */
  sectorShare: 5,
  /** Currency share at which an FX move is a direct exposure. */
  currencyShare: 10,
  /** Deviation from strategy, percentage points, at which context applies. */
  deviationPoints: 5,
  /** Days within which a meeting is context. */
  meetingDays: 14,
  /** Days within which a refinancing is context for a rates move. */
  refinancingDays: 90,
  /** Variable-rate debt, currency units, at which a rates move is context. */
  variableDebt: 2_000_000,
  /** Equity share at which a risk-off regime is context. */
  riskOffEquityShare: 60,
  /** Largest holding, percent, at which concentration is context. */
  concentration: 20,
})

export type Relevance = 'high' | 'medium' | 'low'
/** A relevance that may honestly be absent: no recorded exposure, or nothing to talk about. */
export type RelevanceOrNone = Relevance | 'none'
export type Directness = 'direct' | 'contextual'

/** One reason a client is relevant to an event, with the number it rests on and the records behind it. */
export type ImpactReason =
  | {
      kind: 'fixed-income-duration'
      sharePercent: number
      directness: 'direct'
      sourceIds: readonly string[]
    }
  | {
      kind: 'equity-allocation'
      sharePercent: number
      region: Region | null
      regionSharePercent: number | null
      directness: 'direct'
      sourceIds: readonly string[]
    }
  | {
      kind: 'sector-holding'
      sector: Sector
      sharePercent: number
      directness: 'direct'
      sourceIds: readonly string[]
    }
  | {
      kind: 'currency-holding'
      currency: string
      sharePercent: number
      directness: 'direct'
      sourceIds: readonly string[]
    }
  | {
      kind: 'commodity-theme'
      sector: Sector
      sharePercent: number
      directness: 'direct'
      sourceIds: readonly string[]
    }
  | {
      kind: 'strategy-deviation'
      deviationPoints: number
      strategicPercent: number
      currentPercent: number
      directness: 'contextual'
      sourceIds: readonly string[]
    }
  | {
      kind: 'refinancing-approaching'
      daysToMaturity: number
      loanId: string
      balance: number
      directness: 'contextual'
      sourceIds: readonly string[]
    }
  | {
      kind: 'variable-rate-debt'
      balance: number
      directness: 'contextual'
      sourceIds: readonly string[]
    }
  | {
      kind: 'related-concern'
      topic: ConcernTopic
      contextFactId: string
      statement: string
      directness: 'contextual'
      sourceIds: readonly string[]
    }
  | {
      kind: 'drawdown-sensitivity'
      contextFactId: string
      statement: string
      directness: 'contextual'
      sourceIds: readonly string[]
    }
  | {
      kind: 'meeting-approaching'
      daysAhead: number
      eventId: string
      directness: 'contextual'
      sourceIds: readonly string[]
    }
  | {
      kind: 'concentration'
      largestHoldingPercent: number
      directness: 'contextual'
      sourceIds: readonly string[]
    }

export interface ClientMarketImpact {
  /** `${clientId}|${eventId}`. */
  id: string
  clientId: string
  eventId: string
  event: MarketEvent
  /** The combined verdict that ranks the client and reaches Sentinel. */
  relevance: Relevance
  /** Ordering only; never shown. */
  relevanceScore: number
  /**
   * How much the recorded portfolio and financing are exposed to the move:
   * holdings, loans, strategy deviation, concentration. `none` when the
   * record shows no exposure — never inferred from a concern.
   */
  financialRelevance: RelevanceOrNone
  /**
   * How much the move belongs in the next conversation: the client raised
   * the theme, reacts to drawdowns, or has a meeting coming. A small holding
   * with a repeatedly voiced concern is low here and high there, and the two
   * are never relabelled as each other.
   */
  conversationRelevance: RelevanceOrNone
  /** Direct when at least one reason is a recorded holding; contextual otherwise. */
  directness: Directness
  reasons: readonly ImpactReason[]
  /** Every record id the impact rests on, sorted. */
  sourceIds: readonly string[]
  assessedAt: string
  method: 'market-to-client-v1'
}

/** Points a reason adds to the relevance score. Exposure size is bucketed; context is flat. */
function reasonPoints(reason: ImpactReason): number {
  switch (reason.kind) {
    case 'fixed-income-duration':
      return reason.sharePercent >= 50 ? 3 : reason.sharePercent >= 30 ? 2 : 1
    case 'equity-allocation':
      return reason.sharePercent >= 70 ? 3 : reason.sharePercent >= 55 ? 2 : 1
    case 'sector-holding':
    case 'commodity-theme':
      return reason.sharePercent >= 15 ? 3 : reason.sharePercent >= 10 ? 2 : 1
    case 'currency-holding':
      return reason.sharePercent >= 40 ? 3 : reason.sharePercent >= 25 ? 2 : 1
    case 'related-concern':
      return 3
    case 'refinancing-approaching':
      return reason.daysToMaturity <= 30 ? 3 : 2
    case 'strategy-deviation':
      return 2
    case 'variable-rate-debt':
      return 1
    case 'drawdown-sensitivity':
      return 2
    case 'meeting-approaching':
      return 1
    case 'concentration':
      return 1
  }
}

export function relevanceOf(score: number): Relevance {
  return score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low'
}

/** Context that speaks to the portfolio and its financing, as opposed to the conversation. */
const FINANCIAL_CONTEXT: ReadonlySet<ImpactReason['kind']> = new Set([
  'refinancing-approaching',
  'variable-rate-debt',
  'strategy-deviation',
  'concentration',
])

/** Context that speaks to the next conversation: what the client said, how they react, when you meet. */
const CONVERSATION_CONTEXT: ReadonlySet<ImpactReason['kind']> = new Set([
  'related-concern',
  'drawdown-sensitivity',
  'meeting-approaching',
])

export function financialRelevanceOf(score: number): RelevanceOrNone {
  return score <= 0 ? 'none' : score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low'
}

export function conversationRelevanceOf(score: number): RelevanceOrNone {
  return score <= 0 ? 'none' : score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low'
}

const INDEX_REGION: Record<string, Region | null> = {
  'idx:omxs30': 'sweden',
  'idx:sp500': 'us',
  'idx:nasdaq100': 'us',
  'idx:dax': 'europe',
  'idx:ftse100': 'europe',
  'idx:nikkei225': null,
}

/**
 * Whether, and why, one client is relevant to one event. Null when the record
 * shows neither an exposure nor a context the event speaks to.
 */
export function assessImpact(
  event: MarketEvent,
  exposure: ClientExposure,
  today: string,
): ClientMarketImpact | null {
  const t = EXPOSURE_THRESHOLDS
  const reasons: ImpactReason[] = []
  const down = event.direction === 'down'
  const concernsOn = (topic: ConcernTopic) =>
    exposure.concerns.filter((c) => c.topic === topic)
  const meeting = (): void => {
    if (
      exposure.daysToNextMeeting !== null &&
      exposure.daysToNextMeeting <= t.meetingDays &&
      exposure.nextMeetingEventId
    ) {
      reasons.push({
        kind: 'meeting-approaching',
        daysAhead: exposure.daysToNextMeeting,
        eventId: exposure.nextMeetingEventId,
        directness: 'contextual',
        sourceIds: [exposure.nextMeetingEventId],
      })
    }
  }
  const deviation = (): void => {
    if (Math.abs(exposure.equityDeviationPoints) >= t.deviationPoints) {
      reasons.push({
        kind: 'strategy-deviation',
        deviationPoints: exposure.equityDeviationPoints,
        strategicPercent: exposure.strategicShare.equities,
        currentPercent: exposure.assetClassShare.equities,
        directness: 'contextual',
        sourceIds: [],
      })
    }
  }
  const concern = (topic: ConcernTopic): void => {
    for (const c of concernsOn(topic)) {
      reasons.push({
        kind: 'related-concern',
        topic,
        contextFactId: c.contextFactId,
        statement: c.statement,
        directness: 'contextual',
        sourceIds: [c.contextFactId],
      })
    }
  }
  const drawdown = (): void => {
    if (down && exposure.drawdownSensitivity) {
      reasons.push({
        kind: 'drawdown-sensitivity',
        contextFactId: exposure.drawdownSensitivity.contextFactId,
        statement: exposure.drawdownSensitivity.statement,
        directness: 'contextual',
        sourceIds: [exposure.drawdownSensitivity.contextFactId],
      })
    }
  }

  switch (event.category) {
    case 'rates': {
      const fixedIncome = exposure.assetClassShare['fixed-income']
      if (fixedIncome >= t.fixedIncomeShare) {
        reasons.push({
          kind: 'fixed-income-duration',
          sharePercent: fixedIncome,
          directness: 'direct',
          sourceIds: exposure.holdingIds,
        })
      }
      /* A financing context follows the client's own currency: Swedish and European yields, not the US curve. */
      const europeanRates = event.tags.currency === 'SEK' || event.tags.currency === 'EUR'
      if (europeanRates) {
        const loan = exposure.loans
          .filter(
            (l) =>
              l.daysToMaturity !== null &&
              l.daysToMaturity >= 0 &&
              l.daysToMaturity <= t.refinancingDays,
          )
          .sort((a, b) => a.daysToMaturity! - b.daysToMaturity!)[0]
        if (loan) {
          reasons.push({
            kind: 'refinancing-approaching',
            daysToMaturity: loan.daysToMaturity!,
            loanId: loan.id,
            balance: loan.balance,
            directness: 'contextual',
            sourceIds: [loan.id],
          })
        } else if (exposure.variableRateDebt >= t.variableDebt) {
          reasons.push({
            kind: 'variable-rate-debt',
            balance: exposure.variableRateDebt,
            directness: 'contextual',
            sourceIds: exposure.loans
              .filter((l) => l.interestType === 'variable')
              .map((l) => l.id),
          })
        }
      }
      /* Rising long yields press on equity valuations: context only when the client is already outside strategy. */
      if (event.direction === 'up' && exposure.equityDeviationPoints >= t.deviationPoints)
        deviation()
      concern('rates')
      if (reasons.length > 0) meeting()
      break
    }
    case 'equities': {
      const share = exposure.assetClassShare.equities
      const region = INDEX_REGION[event.symbol] ?? null
      const regionShare = region ? (exposure.regionShare[region] ?? 0) : null
      const globalShare = exposure.regionShare.global ?? 0
      /* The index reaches the client through holdings in its region, or through global funds — and the reason says which. */
      const viaRegion =
        region !== null && regionShare !== null && regionShare >= t.regionShare
      const viaGlobal = region !== null && !viaRegion && globalShare >= t.regionShare
      if (share >= t.equityShare && (region === null || viaRegion || viaGlobal)) {
        reasons.push({
          kind: 'equity-allocation',
          sharePercent: share,
          region: viaRegion ? region : viaGlobal ? 'global' : null,
          regionSharePercent: viaRegion ? regionShare : viaGlobal ? globalShare : null,
          directness: 'direct',
          sourceIds: exposure.holdingIds,
        })
      }
      deviation()
      drawdown()
      concern('equities')
      if (down) concern('drawdown')
      if (exposure.largestHoldingPercent >= t.concentration && share >= t.equityShare) {
        reasons.push({
          kind: 'concentration',
          largestHoldingPercent: exposure.largestHoldingPercent,
          directness: 'contextual',
          sourceIds: [],
        })
      }
      if (reasons.length > 0) meeting()
      break
    }
    case 'sectors': {
      const sector = event.tags.sector
      const share = sector ? (exposure.sectorShare[sector] ?? 0) : 0
      if (sector && share >= t.sectorShare) {
        reasons.push({
          kind: 'sector-holding',
          sector,
          sharePercent: share,
          directness: 'direct',
          sourceIds: exposure.holdingIds,
        })
      }
      if (sector === 'energy') concern('energy')
      /* A concern without a holding is not an impact: the event does not touch the client. */
      if (!reasons.some((r) => r.directness === 'direct')) return null
      if (reasons.length > 0) meeting()
      break
    }
    case 'fx': {
      const currency = event.tags.currency
      const share = currency ? (exposure.currencyShare[currency] ?? 0) : 0
      if (currency && share >= t.currencyShare) {
        reasons.push({
          kind: 'currency-holding',
          currency,
          sharePercent: share,
          directness: 'direct',
          sourceIds: exposure.holdingIds,
        })
      }
      if (!reasons.some((r) => r.directness === 'direct')) return null
      concern('fx')
      meeting()
      break
    }
    case 'commodities': {
      if (event.tags.commodityClass !== 'energy') return null
      const share = exposure.sectorShare.energy ?? 0
      if (share >= t.sectorShare) {
        reasons.push({
          kind: 'commodity-theme',
          sector: 'energy',
          sharePercent: share,
          directness: 'direct',
          sourceIds: exposure.holdingIds,
        })
      }
      if (!reasons.some((r) => r.directness === 'direct')) return null
      concern('energy')
      meeting()
      break
    }
    case 'risk-appetite': {
      if (exposure.assetClassShare.equities >= t.riskOffEquityShare) {
        reasons.push({
          kind: 'equity-allocation',
          sharePercent: exposure.assetClassShare.equities,
          region: null,
          regionSharePercent: null,
          directness: 'direct',
          sourceIds: exposure.holdingIds,
        })
      }
      deviation()
      drawdown()
      concern('drawdown')
      if (reasons.length > 0) meeting()
      break
    }
  }

  if (reasons.length === 0) return null
  const direct = reasons.some((r) => r.directness === 'direct')
  /* Context alone never carries a broad index or a rates move on its own: something in the record has to be exposed, or a promise-grade context (refinancing, concern) must exist. */
  const contextualAnchors = reasons.filter(
    (r) =>
      r.kind === 'refinancing-approaching' ||
      r.kind === 'related-concern' ||
      r.kind === 'strategy-deviation' ||
      r.kind === 'drawdown-sensitivity' ||
      r.kind === 'variable-rate-debt',
  )
  if (!direct && contextualAnchors.length === 0) return null

  const materiality = event.severity === 'major' ? 2 : 1
  const exposurePoints = reasons
    .filter((r) => r.directness === 'direct')
    .reduce((sum, r) => sum + reasonPoints(r), 0)
  const contextPoints = reasons
    .filter((r) => r.directness === 'contextual')
    .reduce((sum, r) => sum + reasonPoints(r), 0)
  const score = materiality * Math.max(1, exposurePoints) + contextPoints
  /* The split: exposure and financing on one side, what the client said and when you meet on the other. Neither borrows from the other. */
  const financialScore =
    materiality * exposurePoints +
    reasons
      .filter((r) => FINANCIAL_CONTEXT.has(r.kind))
      .reduce((s, r) => s + reasonPoints(r), 0)
  const conversationScore =
    materiality *
    reasons
      .filter((r) => CONVERSATION_CONTEXT.has(r.kind))
      .reduce((s, r) => s + reasonPoints(r), 0)
  const sourceIds = [...new Set(reasons.flatMap((r) => r.sourceIds))].sort()

  return {
    id: `${exposure.clientId}|${event.id}`,
    clientId: exposure.clientId,
    eventId: event.id,
    event,
    relevance: relevanceOf(score),
    relevanceScore: score,
    financialRelevance: financialRelevanceOf(financialScore),
    conversationRelevance: conversationRelevanceOf(conversationScore),
    directness: direct ? 'direct' : 'contextual',
    reasons,
    sourceIds,
    assessedAt: today,
    method: 'market-to-client-v1',
  }
}

const RELEVANCE_RANK: Record<Relevance, number> = { high: 0, medium: 1, low: 2 }

export function compareImpacts(a: ClientMarketImpact, b: ClientMarketImpact): number {
  return (
    RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance] ||
    b.relevanceScore - a.relevanceScore ||
    (a.id < b.id ? -1 : 1)
  )
}

/** Every active event assessed against one client, most relevant first. */
export function assessClient(
  events: readonly MarketEvent[],
  facts: ClientFacts,
): ClientMarketImpact[] {
  const exposure = exposureOf(facts)
  return events
    .map((event) => assessImpact(event, exposure, facts.today))
    .filter((impact): impact is ClientMarketImpact => impact !== null)
    .sort(compareImpacts)
}
