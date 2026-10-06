/**
 * The presence's sense of place, in words: what JARVIS is looking at, the
 * questions worth asking there, and the few things it already knows about
 * the client on screen. Everything here is read from the context the route
 * resolved and the data the route already loaded — never a second read.
 */

import { daysBetween } from '~/domain/advisory'
import type { JarvisContext, JarvisScope } from '~/application/jarvis/context'
import { formatDayMonth } from '~/presentation/advisory/format'
import { initialsOf } from '~/presentation/advisory/portraits'

/** The names the loaded page carries for the context's subject. */
export interface ContextNames {
  clientName?: string
  officeName?: string
  meetingDate?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The subject's names from any loaded route data: a client's page, a cockpit, an office book. */
export function contextNamesOf(loaded: readonly unknown[]): ContextNames {
  const names: ContextNames = {}
  for (const data of loaded) {
    if (!isRecord(data) || data.ok !== true) continue
    const view = isRecord(data.view) ? data.view : null
    const cockpit = isRecord(data.cockpit) ? data.cockpit : null
    const book = isRecord(data.book) ? data.book : null
    const pack = isRecord(data.pack) ? data.pack : null
    const client = view && isRecord(view.client) ? view.client : null
    const identity = cockpit && isRecord(cockpit.identity) ? cockpit.identity : null
    const cockpitClient = identity && isRecord(identity.client) ? identity.client : null
    const meeting = cockpit && isRecord(cockpit.meeting) ? cockpit.meeting : null
    const meetingEvent = meeting && isRecord(meeting.event) ? meeting.event : null
    const nextMeeting = view && isRecord(view.nextMeeting) ? view.nextMeeting : null
    const office = book && isRecord(book.office) ? book.office : null
    const packIdentity = pack && isRecord(pack.identity) ? pack.identity : null
    const packMeeting = pack && isRecord(pack.meeting) ? pack.meeting : null
    if (client && typeof client.displayName === 'string')
      names.clientName = client.displayName
    if (cockpitClient && typeof cockpitClient.displayName === 'string')
      names.clientName = cockpitClient.displayName
    if (packIdentity && typeof packIdentity.clientName === 'string')
      names.clientName = packIdentity.clientName
    if (meetingEvent && typeof meetingEvent.occursOn === 'string')
      names.meetingDate = meetingEvent.occursOn
    else if (packMeeting && typeof packMeeting.date === 'string')
      names.meetingDate = packMeeting.date
    else if (nextMeeting && typeof nextMeeting.occursOn === 'string')
      names.meetingDate = nextMeeting.occursOn
    if (office && typeof office.displayName === 'string')
      names.officeName = office.displayName
  }
  return names
}

const SCOPE_LABEL: Record<JarvisScope, string> = {
  GLOBAL: 'Financial OS',
  MARKET: 'Marknaden',
  CLIENT_DIRECTORY: 'Klienter',
  OFFICE: 'Kontor',
  CLIENT: 'Klient',
  MEETING: 'Möte',
  SENTINEL: 'Sentinel',
  MARKET_IMPACT: 'Marknadspåverkan',
}

/** "Anna & Per Dahlqvist", "Anna & Per Dahlqvist · Möte 2 okt", "Strandvägen", "Klienter". */
export function contextLabel(context: JarvisContext, names: ContextNames): string {
  switch (context.scope) {
    case 'CLIENT':
      return names.clientName ?? SCOPE_LABEL.CLIENT
    case 'MEETING':
      return `${names.clientName ?? SCOPE_LABEL.CLIENT} · Möte${names.meetingDate ? ` ${formatDayMonth(names.meetingDate)}` : ''}`
    case 'OFFICE':
      return names.officeName ?? SCOPE_LABEL.OFFICE
    default:
      return SCOPE_LABEL[context.scope]
  }
}

/** The narrow strip's word for the context: initials for a client, a stub for a page. At most seven characters. */
export function contextChip(context: JarvisContext, names: ContextNames): string {
  switch (context.scope) {
    case 'CLIENT':
    case 'MEETING':
      return names.clientName ? initialsOf(names.clientName) : 'KLIENT'
    case 'OFFICE':
      return (names.officeName ?? 'KONTOR').slice(0, 7).toUpperCase()
    case 'CLIENT_DIRECTORY':
      return 'KLIENT.'
    case 'SENTINEL':
      return 'SENT.'
    case 'MARKET_IMPACT':
      return 'MARKN.'
    case 'MARKET':
      return 'MARKN.'
    case 'GLOBAL':
      return ''
  }
}

/** The questions worth one press in a scope. Three to five; none for a scope the record does not answer. */
export function quickActions(context: JarvisContext): readonly string[] {
  switch (context.scope) {
    case 'CLIENT':
      return [
        'Förbered mig inför mötet',
        'Vad pratade vi om sist?',
        'Vad har jag lovat?',
        'Vad har förändrats sedan sist?',
        'Vilka risker ser du?',
      ]
    case 'MEETING':
      return [
        'Vad kommer de sannolikt fråga om?',
        'Vad har jag inte slutfört?',
        'Vilka siffror behöver jag kunna?',
        'Vad hände i marknaden sedan sist?',
        'Vilka tre frågor bör jag ställa?',
      ]
    case 'OFFICE':
      return [
        'Vilka kunder här behöver mig?',
        'Vem har möte den här veckan?',
        'Vilka försenade åtaganden finns?',
        'Var finns störst möjlighet?',
        'Vilka är under onboarding?',
      ]
    case 'CLIENT_DIRECTORY':
      return [
        'Vem borde jag ringa idag?',
        'Vilka kunder har möte kommande vecka?',
        'Vilka löften är försenade?',
        'Vilka kunder har stora externa tillgångar?',
        'Vad ändrades i min PB-bok den här månaden?',
      ]
    case 'SENTINEL':
      return ['Vem behöver mig idag?']
    case 'MARKET_IMPACT':
      return ['Vilka klienter berörs mest?']
    default:
      return []
  }
}

/** What the empty conversation says in a scope. */
export function emptyHint(context: JarvisContext): string {
  switch (context.scope) {
    case 'CLIENT':
      return 'Fråga om klienten på skärmen — mötet, löftena, vad ni sa sist — eller ställ en marknadsfråga.'
    case 'MEETING':
      return 'Fråga inför mötet: vad de kan fråga, vad du inte slutfört, vilka siffror du behöver kunna.'
    case 'OFFICE':
      return 'Fråga om kontorets bok: vem som behöver dig, vem du möter, vad som är försenat, vilka som är nya eller under onboarding.'
    case 'CLIENT_DIRECTORY':
      return 'Fråga om hela boken: vem du borde ringa, vilka möten som kommer, vilka löften som är försenade, vad som ändrats i PB-boken.'
    case 'SENTINEL':
      return 'Fråga vem som behöver dig i dag.'
    case 'MARKET_IMPACT':
      return 'Fråga vilka klienter dagens rörelser berör.'
    default:
      return 'Ställ en investeringsfråga så låter jag investeringsteamet ta den.'
  }
}

/** The compose field's example line in a scope. */
export function composePlaceholder(context: JarvisContext): string {
  switch (context.scope) {
    case 'CLIENT':
    case 'MEETING':
      return 'Vad ska jag ta upp på mötet?'
    case 'OFFICE':
      return 'Vilka kunder här behöver mig?'
    case 'CLIENT_DIRECTORY':
      return 'Vem borde jag ringa idag?'
    default:
      return 'Hur ser amerikanska börsen ut idag?'
  }
}

/* ------------------------------------------------------------ JARVIS vet */

export interface KnownFact {
  key: string
  text: string
}

/**
 * The few things JARVIS already knows about the client on screen, from the
 * page's own loaded view: the next meeting, overdue promises, a loan
 * maturity, active concerns. Made available, never opened as a message.
 */
export function jarvisKnows(loaded: readonly unknown[]): KnownFact[] {
  for (const data of loaded) {
    if (!isRecord(data) || data.ok !== true || !isRecord(data.view)) continue
    const view = data.view
    const facts: KnownFact[] = []
    const today = typeof view.today === 'string' ? view.today : null
    const meeting = isRecord(view.nextMeeting) ? view.nextMeeting : null
    if (meeting && typeof meeting.daysAhead === 'number') {
      facts.push({
        key: 'meeting',
        text:
          meeting.daysAhead === 0
            ? 'Möte i dag'
            : meeting.daysAhead === 1
              ? 'Möte i morgon'
              : `Möte om ${meeting.daysAhead} dagar`,
      })
    }
    const commitments = Array.isArray(view.openCommitments) ? view.openCommitments : []
    const overdue = commitments.filter((c) => isRecord(c) && c.overdue === true).length
    if (overdue > 0)
      facts.push({
        key: 'overdue',
        text: overdue === 1 ? '1 försenat åtagande' : `${overdue} försenade åtaganden`,
      })
    else if (commitments.length > 0)
      facts.push({
        key: 'open',
        text:
          commitments.length === 1
            ? '1 öppet åtagande'
            : `${commitments.length} öppna åtaganden`,
      })
    const liabilities = Array.isArray(view.liabilities) ? view.liabilities : []
    const maturities = liabilities
      .filter(
        (l): l is Record<string, unknown> =>
          isRecord(l) && typeof l.maturityDate === 'string',
      )
      .map((l) => (today ? daysBetween(today, l.maturityDate as string) : null))
      .filter((d): d is number => d !== null && d >= 0)
      .sort((a, b) => a - b)
    if (maturities.length > 0)
      facts.push({ key: 'maturity', text: `Lån förfaller om ${maturities[0]} dagar` })
    const concerns = (Array.isArray(view.contextFacts) ? view.contextFacts : []).filter(
      (f) => isRecord(f) && f.category === 'concern' && f.status === 'active',
    ).length
    if (concerns > 0)
      facts.push({
        key: 'concern',
        text: concerns === 1 ? '1 aktiv oro' : `${concerns} aktiva orosmoment`,
      })
    return facts.slice(0, 4)
  }
  return []
}
