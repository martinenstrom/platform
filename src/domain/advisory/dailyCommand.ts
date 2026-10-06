/**
 * Daily Command — what the advisor should do next, read from the priorities
 * the record already carries.
 *
 * ## Not a second Sentinel
 *
 * Sentinel names each client's one priority: the theme, the severity, the
 * horizon, every driver, the sources. Daily Command does not re-derive any
 * of that. It translates a priority into an *action* the advisor performs —
 * a call, a meeting to prepare, a promise to deliver, a financing to review
 * — with the reasons beneath it, an objective for the conversation and a
 * realistic time window, and it ranks the book by Sentinel's own order. A
 * client without a Sentinel priority has no action; a client with one has
 * exactly one. Multiple facts consolidate into that one action as evidence,
 * never into several alerts.
 *
 * ## Explainable, never precise
 *
 * The advisor sees a band — HÖG, MEDEL, BEVAKA — and a horizon — NU, DENNA
 * VECKA, BEVAKA — and the reasons as sentences. Sentinel's score orders the
 * queue and is never shown. Time estimates are stated per action type as a
 * range an advisor would recognise, not computed.
 *
 * ## Time-aware
 *
 * "I have 30 minutes" is answered by fitting actions into the window in rank
 * order: the highest-ranked action that fits comes first, a second where
 * time remains, and anything skipped is named with the time it needs — so
 * the top priority is never silently dropped and never silently squeezed.
 */

import type { ClientSegment } from './client'
import { daysBetween } from './dates'
import type { HealthBand } from './intelligence'
import type { InteractionType } from './relationship'
import {
  comparePriorities,
  type SentinelDriver,
  type SentinelHorizon,
  type SentinelPriority,
  type SentinelSeverity,
  type SentinelTheme,
} from './sentinel'

/* ---------------------------------------------------------------- shapes */

export type DailyActionType =
  | 'CALL_CLIENT'
  | 'PREPARE_MEETING'
  | 'FOLLOW_UP_COMMITMENT'
  | 'FINANCING_REVIEW'
  | 'MARKET_REASSURANCE'
  | 'PORTFOLIO_REVIEW'
  | 'RELATIONSHIP_CHECK_IN'
  | 'IMPORTANT_EVENT'
  | 'DATA_COMPLETION'

/** HÖG · MEDEL · BEVAKA, as the advisor reads them. */
export type DailyBand = 'high' | 'medium' | 'watch'

/** NU/IDAG · DENNA VECKA · BEVAKA. */
export type DailyHorizon = 'now' | 'week' | 'watch'

/** What the conversation or the work should achieve; the sentence is presentation's. */
export type DailyObjective =
  | 'deliver-promise'
  | 're-anchor-strategy'
  | 'prepare-meeting'
  | 'financing-plan'
  | 'reassure-exposure'
  | 'personal-check-in'
  | 'address-concern'
  | 'review-portfolio'
  | 'plan-event'
  | 'complete-profile'

/** A compact signal chip; at most a few per action, derived from the reasons. */
export type DailySignal =
  | 'overdue-commitment'
  | 'commitment'
  | 'meeting'
  | 'financing'
  | 'event'
  | 'market'
  | 'concern'
  | 'silence'
  | 'health'
  | 'portfolio'
  | 'data-gap'

/** How much of the relationship the record actually holds, for the confidence of an action. */
export type DailyCompleteness = 'full' | 'partial' | 'insufficient'

export interface DailyTime {
  minMinutes: number
  maxMinutes: number
}

export interface DailyAction {
  /** `${clientId}:${actionType}`. */
  id: string
  clientId: string
  clientName: string
  segment: ClientSegment
  officeId: string
  officeName: string
  actionType: DailyActionType
  band: DailyBand
  horizon: DailyHorizon
  objective: DailyObjective
  time: DailyTime
  /** The Sentinel priority the action translates; null for a data-completion action. */
  priorityId: string | null
  theme: SentinelTheme | null
  severity: SentinelSeverity | null
  /** Every reason, primary first, exactly as Sentinel recorded it. */
  reasons: readonly SentinelDriver[]
  signals: readonly DailySignal[]
  /** ISO date the action is about, where it has one. */
  dueAt: string | null
  meetingId: string | null
  commitmentId: string | null
  marketEventId: string | null
  completeness: DailyCompleteness
  /** What is missing when completeness is not full. */
  gaps: readonly DailyGap[]
  /** Every record id the action rests on. */
  sourceIds: readonly string[]
  lastContact: { date: string; type: InteractionType } | null
  nextMeeting: string | null
  health: HealthBand
  aum: number
  /** Ordering only. Never shown. */
  score: number
  method: 'daily-command-v1'
}

export type DailyGap =
  | 'no-contact-recorded'
  | 'no-risk-profile'
  | 'no-financial-overview'
  | 'no-meeting-booked'

/* --------------------------------------------------------------- mapping */

/** Every time range Daily Command states, once. */
export const DAILY_TIME: Readonly<Record<DailyActionType, DailyTime>> = Object.freeze({
  CALL_CLIENT: { minMinutes: 15, maxMinutes: 20 },
  PREPARE_MEETING: { minMinutes: 30, maxMinutes: 45 },
  FOLLOW_UP_COMMITMENT: { minMinutes: 20, maxMinutes: 30 },
  FINANCING_REVIEW: { minMinutes: 20, maxMinutes: 30 },
  MARKET_REASSURANCE: { minMinutes: 10, maxMinutes: 15 },
  PORTFOLIO_REVIEW: { minMinutes: 30, maxMinutes: 45 },
  RELATIONSHIP_CHECK_IN: { minMinutes: 10, maxMinutes: 15 },
  IMPORTANT_EVENT: { minMinutes: 15, maxMinutes: 25 },
  DATA_COMPLETION: { minMinutes: 10, maxMinutes: 15 },
})

const FINANCING_EVENTS = new Set(['mortgage-refinancing', 'loan-maturity'])

function has(priority: SentinelPriority, kind: SentinelDriver['kind']): boolean {
  return priority.drivers.some((d) => d.kind === kind)
}

function financingEvent(priority: SentinelPriority): boolean {
  return priority.drivers.some(
    (d) => d.kind === 'event' && d.material && FINANCING_EVENTS.has(d.eventType),
  )
}

/** The action a Sentinel theme calls for — the theme decides, the drivers refine. */
export function actionTypeOf(priority: SentinelPriority): DailyActionType {
  const p = priority.primary
  switch (priority.theme) {
    case 'overdue-commitment':
    case 'commitment-due':
      return 'FOLLOW_UP_COMMITMENT'
    case 'meeting-imminent':
    case 'meeting-preparation':
      return 'PREPARE_MEETING'
    case 'event-approaching':
      return p.kind === 'event' && FINANCING_EVENTS.has(p.eventType)
        ? 'FINANCING_REVIEW'
        : 'IMPORTANT_EVENT'
    case 'relationship-risk':
    case 'contact-silence':
      return has(priority, 'market') && has(priority, 'concern')
        ? 'MARKET_REASSURANCE'
        : 'CALL_CLIENT'
    case 'concern':
      return has(priority, 'market') ? 'MARKET_REASSURANCE' : 'CALL_CLIENT'
    case 'market-impact':
      return 'MARKET_REASSURANCE'
    case 'portfolio':
    case 'stale-valuation':
      return 'PORTFOLIO_REVIEW'
    case 'birthday':
    case 'opportunity':
      return 'RELATIONSHIP_CHECK_IN'
  }
}

/** What the action should achieve, from the type and what else the priority carries. */
export function objectiveOf(priority: SentinelPriority, actionType: DailyActionType): DailyObjective {
  switch (actionType) {
    case 'FOLLOW_UP_COMMITMENT':
      return 'deliver-promise'
    case 'PREPARE_MEETING':
      return financingEvent(priority) || has(priority, 'undiscussed')
        ? 'financing-plan'
        : 'prepare-meeting'
    case 'FINANCING_REVIEW':
      return 'financing-plan'
    case 'MARKET_REASSURANCE':
      return 'reassure-exposure'
    case 'CALL_CLIENT':
      return has(priority, 'concern')
        ? has(priority, 'open-commitment') || has(priority, 'commitment-due')
          ? 're-anchor-strategy'
          : 'address-concern'
        : 'personal-check-in'
    case 'PORTFOLIO_REVIEW':
      return 'review-portfolio'
    case 'IMPORTANT_EVENT':
      return 'plan-event'
    case 'RELATIONSHIP_CHECK_IN':
      return 'personal-check-in'
    case 'DATA_COMPLETION':
      return 'complete-profile'
  }
}

export function dailyBandOf(severity: SentinelSeverity): DailyBand {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'high'
    case 'normal':
      return 'medium'
    case 'low':
      return 'watch'
  }
}

/** NU for today's work; DENNA VECKA when upcoming and due within seven days or undated; BEVAKA otherwise. */
export function horizonOf(
  horizon: SentinelHorizon,
  dueAt: string | null,
  today: string,
): DailyHorizon {
  if (horizon === 'today') return 'now'
  if (horizon === 'watch') return 'watch'
  if (dueAt === null) return 'week'
  return daysBetween(today, dueAt) <= 7 ? 'week' : 'watch'
}

/** The chips: one per distinct kind of reason, in reason order, at most five. */
export function signalsOf(drivers: readonly SentinelDriver[]): DailySignal[] {
  const out: DailySignal[] = []
  const push = (s: DailySignal) => {
    if (!out.includes(s)) out.push(s)
  }
  for (const d of drivers) {
    switch (d.kind) {
      case 'overdue-commitment':
        push('overdue-commitment')
        break
      case 'commitment-due':
      case 'open-commitment':
        push('commitment')
        break
      case 'meeting':
        push('meeting')
        break
      case 'event':
        push(FINANCING_EVENTS.has(d.eventType) ? 'financing' : 'event')
        break
      case 'undiscussed':
        push('financing')
        break
      case 'market':
        push('market')
        break
      case 'concern':
        push('concern')
        break
      case 'silence':
        push('silence')
        break
      case 'health':
      case 'complaint':
      case 'large-withdrawal':
        push('health')
        break
      case 'allocation-drift':
      case 'excess-cash':
      case 'stale-valuation':
        push('portfolio')
        break
      case 'opportunity':
      case 'birthday':
        break
    }
  }
  return out.slice(0, 5)
}

/* ------------------------------------------------------------ completeness */

export interface RelationshipFactsSummary {
  hasContact: boolean
  hasRiskProfile: boolean
  hasFinancialOverview: boolean
  hasMeetingBooked: boolean
}

export function completenessOf(summary: RelationshipFactsSummary): {
  completeness: DailyCompleteness
  gaps: DailyGap[]
} {
  const gaps: DailyGap[] = []
  if (!summary.hasContact) gaps.push('no-contact-recorded')
  if (!summary.hasRiskProfile) gaps.push('no-risk-profile')
  if (!summary.hasFinancialOverview) gaps.push('no-financial-overview')
  if (!summary.hasMeetingBooked) gaps.push('no-meeting-booked')
  const completeness: DailyCompleteness =
    !summary.hasContact && !summary.hasFinancialOverview
      ? 'insufficient'
      : gaps.length === 0
        ? 'full'
        : 'partial'
  return { completeness, gaps }
}

/* --------------------------------------------------------------- building */

export interface DailyClientContext {
  id: string
  displayName: string
  segment: ClientSegment
  officeId: string
  officeName: string
  lastContact: { date: string; type: InteractionType } | null
  nextMeeting: string | null
  health: HealthBand
  aum: number
  summary: RelationshipFactsSummary
}

/** One priority, as the one action it calls for. */
export function dailyActionOf(
  priority: SentinelPriority,
  client: DailyClientContext,
  today: string,
): DailyAction {
  const actionType = actionTypeOf(priority)
  const { completeness, gaps } = completenessOf(client.summary)
  const meeting = priority.drivers.find((d) => d.kind === 'meeting')
  const commitment = priority.drivers.find(
    (d) =>
      d.kind === 'overdue-commitment' || d.kind === 'commitment-due' || d.kind === 'open-commitment',
  )
  const market = priority.drivers.find((d) => d.kind === 'market')
  return {
    id: `${client.id}:${actionType}`,
    clientId: client.id,
    clientName: client.displayName,
    segment: client.segment,
    officeId: client.officeId,
    officeName: client.officeName,
    actionType,
    band: dailyBandOf(priority.severity),
    horizon: horizonOf(priority.horizon, priority.dueAt, today),
    objective: objectiveOf(priority, actionType),
    time: DAILY_TIME[actionType],
    priorityId: priority.id,
    theme: priority.theme,
    severity: priority.severity,
    reasons: priority.drivers,
    signals: signalsOf(priority.drivers),
    dueAt: priority.dueAt,
    meetingId: meeting && meeting.kind === 'meeting' ? meeting.eventId : null,
    commitmentId:
      commitment &&
      (commitment.kind === 'overdue-commitment' ||
        commitment.kind === 'commitment-due' ||
        commitment.kind === 'open-commitment')
        ? commitment.commitmentId
        : null,
    marketEventId: market && market.kind === 'market' ? market.eventId : null,
    completeness,
    gaps,
    sourceIds: priority.sourceIds,
    lastContact: client.lastContact,
    nextMeeting: client.nextMeeting,
    health: client.health,
    aum: client.aum,
    score: priority.score,
    method: 'daily-command-v1',
  }
}

/** A relationship the record cannot yet judge: the action is to complete what is known. */
export function dataCompletionAction(client: DailyClientContext): DailyAction {
  const { completeness, gaps } = completenessOf(client.summary)
  return {
    id: `${client.id}:DATA_COMPLETION`,
    clientId: client.id,
    clientName: client.displayName,
    segment: client.segment,
    officeId: client.officeId,
    officeName: client.officeName,
    actionType: 'DATA_COMPLETION',
    band: 'watch',
    horizon: 'watch',
    objective: 'complete-profile',
    time: DAILY_TIME.DATA_COMPLETION,
    priorityId: null,
    theme: null,
    severity: null,
    reasons: [],
    signals: ['data-gap'],
    dueAt: null,
    meetingId: null,
    commitmentId: null,
    marketEventId: null,
    completeness,
    gaps,
    sourceIds: [],
    lastContact: client.lastContact,
    nextMeeting: client.nextMeeting,
    health: client.health,
    aum: client.aum,
    score: 0,
    method: 'daily-command-v1',
  }
}

/* --------------------------------------------------------------- ordering */

const BAND_RANK: Record<DailyBand, number> = { high: 0, medium: 1, watch: 2 }
const HORIZON_RANK: Record<DailyHorizon, number> = { now: 0, week: 1, watch: 2 }

/**
 * Queue order: Sentinel's own order where both actions translate a
 * priority; a data-completion action after every priority; names last. A
 * larger relationship never outranks a more urgent one — the size of the
 * relationship is not in the order at all.
 */
export function compareDailyActions(
  a: DailyAction,
  b: DailyAction,
  priorities: ReadonlyMap<string, SentinelPriority>,
): number {
  const pa = a.priorityId ? priorities.get(a.priorityId) : undefined
  const pb = b.priorityId ? priorities.get(b.priorityId) : undefined
  if (pa && pb) return comparePriorities(pa, pb) || a.clientName.localeCompare(b.clientName, 'sv')
  if (pa) return -1
  if (pb) return 1
  return (
    BAND_RANK[a.band] - BAND_RANK[b.band] ||
    HORIZON_RANK[a.horizon] - HORIZON_RANK[b.horizon] ||
    a.clientName.localeCompare(b.clientName, 'sv')
  )
}

/* ------------------------------------------------------------- time-aware */

export interface TimeWindowFit {
  /** The action, and the time it would take within the window. */
  action: DailyAction
  /** Minutes left in the window after this action at its shortest. */
  remainingMinutes: number
}

export interface BestUseOfTime {
  availableMinutes: number
  /** The highest-ranked action that fits the window; null when none does. */
  best: TimeWindowFit | null
  /** The next action that fits the time left after the best one. */
  second: TimeWindowFit | null
  /** Ranked actions that could not fit the window, with the time they need — never silently dropped. */
  skipped: readonly DailyAction[]
  /** The rest that would fit the whole window, in rank order, after the two offered. */
  alsoFits: readonly DailyAction[]
  method: 'daily-command-v1'
}

/**
 * Fit the ranked actions into a window. Rank is respected: the first action
 * whose shortest estimate fits is the best use; a second is offered only
 * where the remainder still holds it. A higher-ranked action the window
 * cannot hold is listed as skipped, with its time, so the advisor sees what
 * they are deferring rather than losing it.
 */
export function bestUseOfTime(
  ranked: readonly DailyAction[],
  availableMinutes: number,
): BestUseOfTime {
  const skipped: DailyAction[] = []
  let best: TimeWindowFit | null = null
  let second: TimeWindowFit | null = null
  const alsoFits: DailyAction[] = []
  for (const action of ranked) {
    const needs = action.time.minMinutes
    if (!best) {
      if (needs <= availableMinutes) {
        best = { action, remainingMinutes: availableMinutes - needs }
      } else {
        skipped.push(action)
      }
      continue
    }
    if (!second) {
      if (needs <= best.remainingMinutes) {
        second = { action, remainingMinutes: best.remainingMinutes - needs }
        continue
      }
      if (needs <= availableMinutes) alsoFits.push(action)
      else skipped.push(action)
      continue
    }
    if (needs <= availableMinutes) alsoFits.push(action)
    else skipped.push(action)
  }
  return {
    availableMinutes,
    best,
    second,
    skipped,
    alsoFits,
    method: 'daily-command-v1',
  }
}

/** "Jag har 30 minuter": the minutes a line names, or null. */
export function minutesIn(text: string): number | null {
  const lower = text.toLowerCase()
  const hours = /\b(\d+(?:[.,]\d+)?|en|ett|två|tre|an|one|two|three)\s*(?:timm\p{L}*|h(?:our)?s?\b)/u.exec(lower)
  const minutes = /(\d+)\s*(?:min\p{L}*)/u.exec(lower)
  const words: Record<string, number> = { en: 1, ett: 1, två: 2, tre: 3, an: 1, one: 1, two: 2, three: 3 }
  let total = 0
  if (hours) total += (Number(hours[1]!.replace(',', '.')) || words[hours[1]!] || 0) * 60
  if (minutes) total += Number(minutes[1])
  if (total === 0 && /\b(?:en halvtimme|halvtimma|half an hour)\b/u.test(lower)) total = 30
  if (total === 0 && /\b(?:en kvart|kvart)\b/u.test(lower)) total = 15
  return total > 0 ? Math.round(total) : null
}
