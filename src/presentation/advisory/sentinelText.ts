/**
 * Sentinel, as the advisor reads it: why this client, why now, what the
 * data says, what to prepare — in Swedish, once, from the typed priority.
 *
 * Every sentence quotes the numbers its driver carries; the preparation
 * supports the advisor's judgement and never makes the financial decision
 * ("bedöm om…", never "lös lånet").
 */

import type {
  HealthDriverKind,
  SentinelDriver,
  SentinelHorizon,
  SentinelPriority,
  SentinelSeverity,
  SentinelTheme,
} from '~/domain/advisory'
import type { SentinelEntry } from '~/application/advisory/sentinel'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  formatPoints,
} from './format'
import { DIRECTNESS_LABEL, marketMoveText, RELEVANCE_LABEL } from './marketImpactText'
import {
  ASSET_CLASS_LABEL,
  EVENT_LABEL,
  HEALTH_BAND_LABEL,
  OPPORTUNITY_TYPE_LABEL,
} from './text'

/**
 * A health driver named without its count: the Sentinel driver carries the
 * kinds behind the band, and the counts live on the health object itself.
 */
const HEALTH_DRIVER_SHORT: Record<HealthDriverKind, string> = {
  'recent-contact': 'kontakt nyligen',
  'recent-meeting': 'möte nyligen',
  'no-overdue-commitments': 'inga försenade åtaganden',
  'next-meeting-booked': 'nästa möte bokat',
  'no-open-concerns': 'ingen aktiv oro',
  'overdue-commitments': 'försenade åtaganden',
  'contact-lapsed': 'lång tid utan kontakt',
  'open-concerns': 'aktiv oro',
  'recent-large-withdrawal': 'stort uttag nyligen',
  'open-complaint': 'klagomål',
  'fee-sensitive': 'avgiftskänslig',
  'goal-behind': 'mål efter plan',
}

export const SEVERITY_LABEL: Record<SentinelSeverity, string> = {
  critical: 'Kritisk',
  high: 'Hög',
  normal: 'Normal',
  low: 'Låg',
}

export const HORIZON_LABEL: Record<SentinelHorizon, string> = {
  today: 'Agera i dag',
  upcoming: 'Kommande',
  watch: 'Bevaka',
}

export const THEME_LABEL: Record<SentinelTheme, string> = {
  'overdue-commitment': 'Försenat åtagande',
  'commitment-due': 'Åtagande förfaller',
  'meeting-imminent': 'Möte nära',
  'meeting-preparation': 'Förbered mötet',
  'event-approaching': 'Händelse närmar sig',
  'relationship-risk': 'Relationsrisk',
  'contact-silence': 'Ingen kontakt',
  concern: 'Obesvarad oro',
  portfolio: 'Portfölj',
  birthday: 'Födelsedag',
  'stale-valuation': 'Föråldrad värdering',
  opportunity: 'Möjlighet',
  'market-impact': 'Marknadspåverkan',
}

/** "förstärkt av marknadsläget" — the chip beside a priority a market impact lifted. */
export const STRENGTHENED_BY_MARKET = 'förstärkt av marknadsläget'

const has = <K extends SentinelDriver['kind']>(priority: SentinelPriority, kind: K) =>
  priority.drivers.find((d): d is Extract<SentinelDriver, { kind: K }> => d.kind === kind)

const financingEvent = (priority: SentinelPriority) =>
  priority.drivers.find(
    (d): d is Extract<SentinelDriver, { kind: 'event' }> =>
      d.kind === 'event' &&
      (d.eventType === 'mortgage-refinancing' || d.eventType === 'loan-maturity'),
  )

function dayWord(daysAhead: number): string {
  return daysAhead === 0
    ? 'i dag'
    : daysAhead === 1
      ? 'i morgon'
      : `om ${daysAhead} dagar`
}

/** The headline: what to do, named by the theme and the driver mix. */
export function priorityTitle(entry: SentinelEntry): string {
  const { priority, client } = entry
  const p = priority.primary
  switch (priority.theme) {
    case 'overdue-commitment': {
      const meeting = has(priority, 'meeting')
      return meeting
        ? `Försenat åtagande inför mötet ${formatDayMonth(meeting.date)}`
        : 'Försenat åtagande'
    }
    case 'commitment-due':
      return p.kind === 'commitment-due'
        ? `Åtagande förfaller ${dayWord(p.daysAhead)}`
        : 'Åtagande förfaller'
    case 'meeting-imminent':
      return p.kind === 'meeting' ? `Möte ${dayWord(p.daysAhead)}` : 'Möte nära'
    case 'meeting-preparation': {
      const when = p.kind === 'meeting' ? ` inför mötet ${formatDayMonth(p.date)}` : ''
      if (financingEvent(priority) || has(priority, 'undiscussed'))
        return `Förbered finansieringsdiskussionen${when}`
      if (has(priority, 'excess-cash')) return `Bedöm likviditeten${when}`
      if (has(priority, 'concern')) return `Adressera oron${when}`
      if (has(priority, 'allocation-drift')) return `Gå igenom allokeringen${when}`
      if (has(priority, 'open-commitment') || has(priority, 'commitment-due'))
        return `Slutför åtagandet${when}`
      return `Förbered mötet${when.replace(' inför mötet', '')}`
    }
    case 'event-approaching':
      return p.kind === 'event'
        ? `${EVENT_LABEL[p.eventType]} ${dayWord(p.daysAhead)}`
        : 'Händelse närmar sig'
    case 'relationship-risk':
      return p.kind === 'silence'
        ? `Ingen kontakt på ${p.days} dagar`
        : p.kind === 'complaint'
          ? 'Klagomål att följa upp'
          : 'Relationen behöver kontakt'
    case 'contact-silence':
      return p.kind === 'silence' ? `Ingen kontakt på ${p.days} dagar` : 'Ingen kontakt'
    case 'concern':
      return 'Obesvarad oro'
    case 'portfolio':
      return p.kind === 'excess-cash'
        ? 'Överskottslikviditet'
        : p.kind === 'allocation-drift'
          ? `Avvikelse från strategi, ${ASSET_CLASS_LABEL[p.assetClass].toLowerCase()}`
          : 'Portföljen avviker'
    case 'birthday':
      return p.kind === 'birthday'
        ? `${client.displayName.split(' ')[0]} fyller ${p.turning} ${dayWord(p.daysAhead)}`
        : 'Födelsedag'
    case 'stale-valuation':
      return 'Föråldrad värdering inför genomgången'
    case 'opportunity':
      return p.kind === 'opportunity' ? p.title : 'Möjlighet'
    case 'market-impact':
      return p.kind === 'market'
        ? `Marknadspåverkan: ${marketMoveText(p)}`
        : 'Marknadspåverkan'
  }
}

/** One driver, as a sentence with its numbers. */
export function driverText(driver: SentinelDriver): string {
  switch (driver.kind) {
    case 'overdue-commitment':
      return `Du lovade "${driver.title}" – förfallet ${formatLongDate(driver.dueDate)}, ${driver.daysOverdue} ${driver.daysOverdue === 1 ? 'dag' : 'dagar'} sedan.`
    case 'commitment-due':
      return `Du lovade "${driver.title}" – förfaller ${dayWord(driver.daysAhead)} (${formatLongDate(driver.dueDate)}).`
    case 'open-commitment':
      return driver.dueDate
        ? `Öppet åtagande: "${driver.title}", senast ${formatLongDate(driver.dueDate)}.`
        : `Öppet åtagande: "${driver.title}".`
    case 'meeting':
      return `Möte ${dayWord(driver.daysAhead)}, ${formatLongDate(driver.date)}: ${driver.title}.`
    case 'event':
      return `${EVENT_LABEL[driver.eventType]} ${dayWord(driver.daysAhead)} (${formatLongDate(driver.date)})${
        driver.amount !== null ? `, ${formatMsek(driver.amount)}` : ''
      }: ${driver.title}.`
    case 'concern':
      return `Klienten har uttryckt oro (${formatLongDate(driver.sourceDate)}): ${driver.statement}.`
    case 'silence':
      return driver.lastDate
        ? `Ingen kontakt på ${driver.days} dagar; senast ${formatLongDate(driver.lastDate)}.`
        : `Ingen kontakt registrerad på ${driver.days} dagar.`
    case 'health':
      return `Relationshälsa ${driver.score}/100, ${HEALTH_BAND_LABEL[driver.band].toLowerCase()}: ${driver.negativeDrivers
        .map((kind) => HEALTH_DRIVER_SHORT[kind])
        .join(', ')}.`
    case 'allocation-drift':
      return `${ASSET_CLASS_LABEL[driver.assetClass]} ${formatPoints(driver.deviationPoints)} mot strategisk allokering (${driver.currentPercent} % mot ${driver.strategicPercent} %).`
    case 'excess-cash':
      return `${formatMsek(driver.amount)} i likvida medel, motsvarande ${driver.sharePercent} % av finansiella tillgångar.`
    case 'opportunity':
      return `Möjlighet: ${driver.title} (${OPPORTUNITY_TYPE_LABEL[driver.type].toLowerCase()}), ${formatMsek(driver.potentialValue)}${
        driver.expectedDate ? `, förväntas ${formatLongDate(driver.expectedDate)}` : ''
      }.`
    case 'stale-valuation':
      return `Äldsta värderingen är från ${formatLongDate(driver.valuedAt)}, ${driver.daysOld} dagar gammal, inför en genomgång.`
    case 'birthday':
      return `Fyller ${driver.turning} ${dayWord(driver.daysAhead)} (${formatLongDate(driver.date)}).`
    case 'large-withdrawal':
      return `Stort uttag ${formatMsek(driver.amount)} den ${formatLongDate(driver.date)}.`
    case 'complaint':
      return `Klagomål registrerat ${formatLongDate(driver.date)}.`
    case 'undiscussed':
      return driver.sinceDays === null
        ? 'Ingen finansieringsdiskussion finns registrerad.'
        : `Finansiering diskuterades senast för ${driver.sinceDays} dagar sedan.`
    case 'market':
      return `Marknad: ${marketMoveText(driver)} – ${RELEVANCE_LABEL[driver.relevance].toLowerCase()} relevans, ${DIRECTNESS_LABEL[driver.directness].toLowerCase()}.`
  }
}

/** VARFÖR NU — the primary driver, in one line. */
export function whyNow(priority: SentinelPriority): string {
  return driverText(priority.primary)
}

/** VARFÖR DET SPELAR ROLL — the facts beside the primary one, at most three. */
export function whyItMatters(entry: SentinelEntry): string {
  const { priority, client } = entry
  const others = priority.drivers.slice(1, 4).map(driverText)
  if (others.length > 0) return others.join(' ')
  switch (priority.theme) {
    case 'overdue-commitment':
    case 'commitment-due':
      return 'Ett löfte till en klient får aldrig glömmas bort.'
    case 'meeting-imminent':
    case 'meeting-preparation':
      return `Relationen omfattar ${formatMsek(client.aum)} hos banken av ${formatMsek(client.totalWealth)}.`
    case 'relationship-risk':
    case 'contact-silence':
      return `Relationshälsa ${client.health.score}/100, ${HEALTH_BAND_LABEL[client.health.band].toLowerCase()}.`
    case 'birthday':
      return 'Ett personligt tillfälle att höra av sig.'
    default:
      return `Relationen omfattar ${formatMsek(client.aum)} hos banken.`
  }
}

/** REKOMMENDERAD FÖRBEREDELSE — what to consider, never the decision. */
export function preparation(priority: SentinelPriority): string {
  const p = priority.primary
  switch (priority.theme) {
    case 'overdue-commitment':
      return p.kind === 'overdue-commitment'
        ? `Slutför "${p.title}" och återkoppla till klienten om varför det dröjt.`
        : 'Slutför det försenade åtagandet och återkoppla.'
    case 'commitment-due':
      return p.kind === 'commitment-due'
        ? `Slutför "${p.title}" i tid.`
        : 'Slutför åtagandet i tid.'
    case 'meeting-imminent':
      return has(priority, 'concern')
        ? 'Gå igenom klientens oro och öppna åtaganden innan mötet.'
        : 'Stäm av öppna åtaganden och underlaget innan mötet.'
    case 'meeting-preparation': {
      if (financingEvent(priority) || has(priority, 'undiscussed'))
        return 'Gå igenom finansieringen och alternativen inför mötet.'
      if (has(priority, 'excess-cash'))
        return 'Bedöm om likviditeten fortfarande är avsiktlig inför mötet.'
      if (has(priority, 'concern'))
        return 'Förbered ett svar på klientens oro inför mötet.'
      if (has(priority, 'allocation-drift'))
        return 'Ta med allokeringen mot strategin till mötet.'
      if (has(priority, 'open-commitment') || has(priority, 'commitment-due'))
        return 'Slutför det utlovade så att det kan presenteras på mötet.'
      return 'Förbered mötet med underlaget från Klient 360.'
    }
    case 'event-approaching':
      if (
        p.kind === 'event' &&
        (p.eventType === 'mortgage-refinancing' || p.eventType === 'loan-maturity')
      )
        return 'Se över den aktuella finansieringen och vad som behöver vara klart före förfallet.'
      if (
        p.kind === 'event' &&
        (p.eventType === 'liquidity-event' ||
          p.eventType === 'company-sale' ||
          p.eventType === 'planned-withdrawal')
      )
        return 'Bedöm hur likviditeten bör hanteras när händelsen inträffar.'
      if (p.kind === 'event' && p.eventType === 'annual-review')
        return 'Förbered årsgenomgången med aktuellt underlag.'
      return 'Bedöm vad händelsen kräver av relationen.'
    case 'relationship-risk':
      return has(priority, 'concern')
        ? 'Kontakta klienten och adressera den oro som finns registrerad.'
        : 'Kontakta klienten för en personlig avstämning.'
    case 'contact-silence':
      return 'Ring klienten för en kort avstämning.'
    case 'concern':
      return 'Återkom till klienten om den oro som uttryckts.'
    case 'portfolio':
      return p.kind === 'excess-cash'
        ? 'Pröva om överskottslikviditeten fortfarande är avsiktlig.'
        : 'Pröva om avvikelsen från strategin är avsiktlig.'
    case 'birthday':
      return 'Personlig hälsning.'
    case 'stale-valuation':
      return 'Uppdatera värderingen före genomgången.'
    case 'opportunity':
      return 'Bedöm om tidpunkten är rätt att ta upp möjligheten.'
    case 'market-impact':
      return has(priority, 'concern')
        ? 'Gå igenom hur rörelsen berör klientens exponering och förbered ett svar på den oro som finns registrerad.'
        : 'Gå igenom hur rörelsen berör klientens exponering och förbered ett samtalsunderlag – kontakten är rådgivarens beslut.'
  }
}

/** "Senaste mötet 13 sep · Nästa möte 4 okt" — the context line under a brief entry. */
export function contextLine(entry: SentinelEntry): string {
  const parts: string[] = []
  if (entry.client.lastContact)
    parts.push(`Senaste kontakt ${formatDayMonth(entry.client.lastContact.date)}`)
  parts.push(
    entry.client.nextMeeting
      ? `Nästa möte ${formatDayMonth(entry.client.nextMeeting)}`
      : 'Inget möte bokat',
  )
  return parts.join(' · ')
}

/** "i dag", "om 3 dagar", or the date — for the due column. */
export function dueText(priority: SentinelPriority, today: string): string {
  if (!priority.dueAt) return '—'
  const ahead = daysBetweenIso(today, priority.dueAt)
  if (ahead < 0)
    return `${formatDayMonth(priority.dueAt)} · ${formatDaysFromToday(ahead)}`
  return `${formatDayMonth(priority.dueAt)} · ${formatDaysFromToday(ahead)}`
}

function daysBetweenIso(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  )
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  )
  return Math.round((b - a) / 86_400_000)
}

/** The one-line summary under the greeting. */
export function briefingLine(metrics: {
  clientsNeedingAttention: number
  meetingsWithin7Days: number
  overdueCommitments: number
}): string[] {
  const lines = [
    metrics.clientsNeedingAttention === 1
      ? '1 klient behöver din uppmärksamhet i dag'
      : `${metrics.clientsNeedingAttention} klienter behöver din uppmärksamhet i dag`,
    metrics.meetingsWithin7Days === 1
      ? '1 möte kommande 7 dagar'
      : `${metrics.meetingsWithin7Days} möten kommande 7 dagar`,
  ]
  if (metrics.overdueCommitments > 0) {
    lines.push(
      metrics.overdueCommitments === 1
        ? '1 försenat åtagande'
        : `${metrics.overdueCommitments} försenade åtaganden`,
    )
  }
  return lines
}
