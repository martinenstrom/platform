/**
 * Daily Command, as the advisor reads it: the action named, the band and
 * the horizon as words, the reasons as Sentinel already phrases them, the
 * objective of the conversation, the time it takes, and what the record
 * lacks — in Swedish, once. Never a score.
 */

import type {
  DailyAction,
  DailyActionType,
  DailyBand,
  DailyCompleteness,
  DailyGap,
  DailyHorizon,
  DailyObjective,
  DailySignal,
  DailyTime,
} from '~/domain/advisory'
import type {
  DailyMarketClient,
  DailyMarketItem,
  DailyPulse,
  MarketSuggestedAction,
} from '~/application/advisory/dailyCommand'
import { formatDayMonth, formatDaysFromToday, formatLongDate } from './format'
import { marketFactText, RELEVANCE_LABEL } from './marketImpactText'
import { driverText } from './sentinelText'

export const ACTION_TYPE_LABEL: Record<DailyActionType, string> = {
  CALL_CLIENT: 'Ring klienten',
  PREPARE_MEETING: 'Förbered mötet',
  FOLLOW_UP_COMMITMENT: 'Följ upp löftet',
  FINANCING_REVIEW: 'Gå igenom finansieringen',
  MARKET_REASSURANCE: 'Marknadssamtal',
  PORTFOLIO_REVIEW: 'Portföljgenomgång',
  RELATIONSHIP_CHECK_IN: 'Personlig avstämning',
  IMPORTANT_EVENT: 'Viktig händelse',
  DATA_COMPLETION: 'Komplettera klientprofilen',
}

/** The action as a short imperative, for a chip or a button. */
export const ACTION_TYPE_SHORT: Record<DailyActionType, string> = {
  CALL_CLIENT: 'RING',
  PREPARE_MEETING: 'FÖRBERED MÖTE',
  FOLLOW_UP_COMMITMENT: 'FÖLJ UPP LÖFTE',
  FINANCING_REVIEW: 'FINANSIERING',
  MARKET_REASSURANCE: 'MARKNADSSAMTAL',
  PORTFOLIO_REVIEW: 'PORTFÖLJ',
  RELATIONSHIP_CHECK_IN: 'AVSTÄMNING',
  IMPORTANT_EVENT: 'HÄNDELSE',
  DATA_COMPLETION: 'KOMPLETTERA PROFIL',
}

export const BAND_LABEL: Record<DailyBand, string> = {
  high: 'HÖG',
  medium: 'MEDEL',
  watch: 'BEVAKA',
}

export const HORIZON_LABEL: Record<DailyHorizon, string> = {
  now: 'NU',
  week: 'DENNA VECKA',
  watch: 'BEVAKA',
}

export const HORIZON_SENTENCE: Record<DailyHorizon, string> = {
  now: 'Kräver dig nu',
  week: 'Den här veckan',
  watch: 'Att bevaka',
}

export const OBJECTIVE_TEXT: Record<DailyObjective, string> = {
  'deliver-promise': 'Leverera det som lovats och återkoppla om varför det dröjt.',
  're-anchor-strategy': 'Förankra strategin på nytt mot den oro som uttryckts.',
  'prepare-meeting': 'Komma förberedd till mötet med underlaget klart.',
  'financing-plan': 'Enas om en plan för finansieringen innan förfallet.',
  'reassure-exposure': 'Gå igenom hur rörelsen berör exponeringen och lugna.',
  'personal-check-in': 'En personlig avstämning – hur det står till, vad som är nytt.',
  'address-concern': 'Adressera den oro som finns registrerad.',
  'review-portfolio': 'Gå igenom portföljen mot strategin.',
  'plan-event': 'Planera inför händelsen tillsammans med klienten.',
  'complete-profile': 'Komplettera det som saknas i klientprofilen.',
}

export const SIGNAL_LABEL: Record<DailySignal, string> = {
  'overdue-commitment': 'Försenat löfte',
  commitment: 'Öppet löfte',
  meeting: 'Möte',
  financing: 'Finansiering',
  event: 'Händelse',
  market: 'Marknad',
  concern: 'Oro',
  silence: 'Tystnad',
  health: 'Relationshälsa',
  portfolio: 'Portfölj',
  'data-gap': 'Data saknas',
}

export const GAP_LABEL: Record<DailyGap, string> = {
  'no-contact-recorded': 'Ingen kontakt registrerad',
  'no-risk-profile': 'Riskprofil saknas',
  'no-financial-overview': 'Ekonomisk översikt: DATA SAKNAS',
  'no-meeting-booked': 'Inget möte bokat',
}

export const COMPLETENESS_LABEL: Record<DailyCompleteness, string> = {
  full: 'Komplett underlag',
  partial: 'Delvis underlag',
  insufficient: 'Otillräckligt underlag',
}

export const SUGGESTED_ACTION_LABEL: Record<MarketSuggestedAction, string> = {
  'proactive-call': 'Ring proaktivt',
  'raise-at-meeting': 'Ta upp på mötet',
  monitor: 'Bevaka',
}

/** "15–20 min". */
export function timeText(time: DailyTime): string {
  return time.minMinutes === time.maxMinutes
    ? `${time.minMinutes} min`
    : `${time.minMinutes}–${time.maxMinutes} min`
}

/** "15 till 20 minuter", as it is said. */
export function spokenTime(time: DailyTime): string {
  return time.minMinutes === time.maxMinutes
    ? `${time.minMinutes} minuter`
    : `${time.minMinutes} till ${time.maxMinutes} minuter`
}

/** The headline of an action: what to do, named for the client. */
export function actionHeadline(action: DailyAction): string {
  const first = action.clientName.split(/[\s&]+/)[0] ?? action.clientName
  switch (action.actionType) {
    case 'CALL_CLIENT':
      return `Ring ${first}`
    case 'PREPARE_MEETING':
      return action.nextMeeting
        ? `Förbered mötet med ${first} ${formatDayMonth(action.nextMeeting)}`
        : `Förbered mötet med ${first}`
    case 'FOLLOW_UP_COMMITMENT':
      return `Följ upp löftet till ${first}`
    case 'FINANCING_REVIEW':
      return `Gå igenom finansieringen med ${first}`
    case 'MARKET_REASSURANCE':
      return `Ring ${first} om marknadsläget`
    case 'PORTFOLIO_REVIEW':
      return `Portföljgenomgång med ${first}`
    case 'RELATIONSHIP_CHECK_IN':
      return `Hör av dig till ${first}`
    case 'IMPORTANT_EVENT':
      return `Planera inför händelsen med ${first}`
    case 'DATA_COMPLETION':
      return `Komplettera profilen för ${first}`
  }
}

/** VARFÖR NU — the primary reason, in Sentinel's words; empty for a data-completion action. */
export function actionWhyNow(action: DailyAction): string {
  const primary = action.reasons[0]
  if (primary) return driverText(primary)
  return action.gaps.length > 0
    ? `Underlaget är ${COMPLETENESS_LABEL[action.completeness].toLowerCase()}: ${action.gaps.map((g) => GAP_LABEL[g].toLowerCase()).join(', ')}.`
    : ''
}

/** Every reason as a sentence, primary first. */
export function actionReasons(action: DailyAction): string[] {
  return action.reasons.map(driverText)
}

/** "Senaste kontakt 21 jul · Nästa möte 3 okt · Inget möte bokat". */
export function actionContextLine(action: DailyAction, today: string): string {
  const parts: string[] = []
  if (action.lastContact) {
    const days = daysBetweenIso(action.lastContact.date, today)
    parts.push(
      `Senaste kontakt ${formatDayMonth(action.lastContact.date)}${days > 0 ? ` (${formatDaysFromToday(-days)})` : ''}`,
    )
  } else parts.push('Ingen kontakt registrerad')
  parts.push(
    action.nextMeeting ? `Nästa möte ${formatDayMonth(action.nextMeeting)}` : 'Inget möte bokat',
  )
  return parts.join(' · ')
}

/** "Margareta Berglund · Följ upp löftet" — one line for a list. */
export function actionLine(action: DailyAction): string {
  return `${action.clientName} · ${ACTION_TYPE_LABEL[action.actionType]}`
}

/** "HÖG · NU · 20–30 min · Du lovade …" — the detail under a list line. */
export function actionDetail(action: DailyAction): string {
  const why = actionWhyNow(action)
  return `${BAND_LABEL[action.band]} · ${HORIZON_LABEL[action.horizon]} · ${timeText(action.time)}${why ? ` · ${why}` : ''}`
}

/** "6 relationer kräver din uppmärksamhet", "1 relation kräver din uppmärksamhet", "Ingen relation kräver dig just nu". */
export function attentionHeadline(count: number): string {
  if (count === 0) return 'Ingen relation kräver dig just nu'
  if (count === 1) return '1 relation kräver din uppmärksamhet'
  return `${count} relationer kräver din uppmärksamhet`
}

/** The greeting for the hour of the day, with the advisor's first name. */
export function greeting(hour: number, displayName: string): string {
  const first = displayName.split(/\s+/)[0] ?? displayName
  const word = hour < 10 ? 'God morgon' : hour < 18 ? 'God eftermiddag' : 'God kväll'
  return `${word}, ${first}`
}

/** Book Pulse, as the few lines that help the day — never a dashboard of everything. */
export function pulseLines(pulse: DailyPulse): { label: string; value: string }[] {
  return [
    { label: 'Agera nu', value: String(pulse.actNow) },
    { label: 'Möten inom 7 dagar', value: String(pulse.meetingsThisWeek) },
    { label: 'Försenade åtaganden', value: String(pulse.overdueCommitments) },
    { label: 'Tysta över 60 dagar', value: String(pulse.silentOver60) },
    { label: 'Finansiering inom 30 dagar', value: String(pulse.upcomingFinancing) },
    { label: 'Berörda av marknaden', value: String(pulse.affectedByMarket) },
  ]
}

/* ---------------------------------------------------------- market → client */

/** FAKTA — the move itself, as Market-to-Client states it. */
export function marketItemFact(item: DailyMarketItem): string {
  return marketFactText(item.lead)
}

/** KLIENTRELEVANS — one client's relevance and why, without a causal claim. */
export function marketClientRelevance(client: DailyMarketClient): string {
  const parts = [`${RELEVANCE_LABEL[client.relevance]} relevans`]
  if (client.concernMatched) parts.push('har uttryckt oro som rörelsen berör')
  if (client.meetingSoon) parts.push('möte inom 14 dagar')
  return parts.join(' · ')
}

/** FÖRESLAGEN ÅTGÄRD — what the advisor may do; the contact is always the advisor's decision. */
export function marketClientAction(client: DailyMarketClient): string {
  return SUGGESTED_ACTION_LABEL[client.suggestedAction]
}

/** "Energy −8,0 % · 2 klienter berörs, 1 med hög relevans". */
export function marketItemCounts(item: DailyMarketItem): string {
  const clients = item.meaningful === 1 ? '1 klient berörs' : `${item.meaningful} klienter berörs`
  return item.high > 0
    ? `${clients}, ${item.high} med hög relevans`
    : clients
}

/* ------------------------------------------------------------ what changed */

/** "sedan i går", "sedan i fredags (19 sep)", "sedan 22 sep". */
export function sinceText(since: string, today: string): string {
  const days = daysBetweenIso(since, today)
  if (days === 1) return 'sedan i går'
  const weekday = new Date(`${since}T00:00:00.000Z`).getUTCDay()
  const name = WEEKDAY_SINCE[weekday]
  return days <= 7 && name ? `${name} (${formatDayMonth(since)})` : `sedan ${formatLongDate(since)}`
}

const WEEKDAY_SINCE: Record<number, string> = {
  0: 'sedan i söndags',
  1: 'sedan i måndags',
  2: 'sedan i tisdags',
  3: 'sedan i onsdags',
  4: 'sedan i torsdags',
  5: 'sedan i fredags',
  6: 'sedan i lördags',
}

function daysBetweenIso(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}
