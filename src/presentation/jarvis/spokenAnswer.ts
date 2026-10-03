/**
 * What JARVIS says aloud, from the same structured answer the screen shows.
 *
 * Voice and text are modalities of one answer. The screen renders every
 * section with its nature and its evidence; the voice says one to four
 * sentences: the figure that was asked for first, the facts before the
 * assessment, numbers as a person says them — "42 miljoner", not "42,0
 * MSEK" — dates as "den 2 oktober", never a section name, never an id.
 * When there is more, the voice says how much and offers the rest; "ta
 * resten också" is answered from the same answer (followUp.ts).
 */

import type {
  AdvisoryIntentKind,
  FigureKind,
  JarvisAnswer,
  JarvisItem,
  JarvisSection,
} from '~/application/jarvis/answer'
import { SPOKEN_LEAD_ITEMS } from '~/application/jarvis/followUp'
import {
  advisorQuestionText,
  clientQuestionText,
  focusReasonText,
  marketHeadline,
  marketRelevanceLines,
  objectiveText,
  riskText,
  strategyObservationText,
} from '~/presentation/advisory/meetingCockpitText'
import { priorityTitle, whyNow } from '~/presentation/advisory/sentinelText'
import { signalText } from '~/presentation/advisory/intelligenceText'
import { episodeHeadline } from '~/presentation/advisory/marketImpactText'
import { HEALTH_BAND_LABEL, INTERACTION_LABEL } from '~/presentation/advisory/text'
import {
  DEPTH_LABEL,
  readinessReasonText,
  readinessSummary,
} from '~/presentation/documents/meetingPackText'
import { itemText, noteText } from './advisoryAnswerText'

export interface JarvisSpokenAnswer {
  /** The sentences, joined; what the voice reads. */
  say: string
  sentences: readonly string[]
  /** Items of the answer the speech covered, in reading order. */
  covered: number
  /** Items the speech left for "ta resten också". */
  remaining: number
  method: 'spoken-answer-v1'
}

/* ------------------------------------------------------- spoken formatting */

const MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
]

/** "den 2 oktober" — a date as it is said. */
export function spokenDate(iso: string): string {
  const day = Number(iso.slice(8, 10))
  const month = MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''
  return `den ${day} ${month}`
}

/** "42 miljoner", "22,5 miljoner", "750 tusen", "1 miljon". */
export function spokenAmount(sek: number): string {
  const abs = Math.abs(sek)
  const sign = sek < 0 ? 'minus ' : ''
  if (abs >= 1_000_000) {
    const m = Math.round((abs / 1_000_000) * 10) / 10
    const text = m.toLocaleString('sv-SE', { maximumFractionDigits: 1 })
    return `${sign}${text} ${m === 1 ? 'miljon' : 'miljoner'}`
  }
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} tusen`
  return `${sign}${Math.round(abs)} kronor`
}

export function spokenPercent(value: number, fractionDigits = 0): string {
  return `${value.toLocaleString('sv-SE', { maximumFractionDigits: fractionDigits })} procent`
}

export function spokenSignedPercent(value: number): string {
  const text = Math.abs(value).toLocaleString('sv-SE', { maximumFractionDigits: 1 })
  return value >= 0 ? `upp ${text} procent` : `ned ${text} procent`
}

export function spokenDays(days: number): string {
  if (days === 0) return 'i dag'
  if (days === 1) return 'i morgon'
  if (days === -1) return 'i går'
  return days > 0 ? `om ${days} dagar` : `för ${Math.abs(days)} dagar sedan`
}

/** "Anna och Per Dahlqvist" — an ampersand is not said. */
export function spokenName(name: string): string {
  return name.replace(/\s*&\s*/g, ' och ')
}

const cap = (text: string): string =>
  text ? text[0]!.toUpperCase() + text.slice(1) : text
const sentence = (text: string): string => {
  const t = text.trim()
  return /[.!?…]$/.test(t) ? t : `${t}.`
}
const joinWith = (word: string, parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} ${word} ${parts[parts.length - 1]}`
const joinAnd = (parts: readonly string[]): string => joinWith('och', parts)
const joinOr = (parts: readonly string[]): string => joinWith('eller', parts)

/* ----------------------------------------------------------------- render */

export function spokenAnswerOf(answer: JarvisAnswer): JarvisSpokenAnswer {
  const built = render(answer)
  const sentences = built.sentences.map(sentence).filter((s) => s.length > 1)
  return {
    say: sentences.join(' '),
    sentences,
    covered: built.covered,
    remaining: built.remaining,
    method: 'spoken-answer-v1',
  }
}

interface Built {
  sentences: string[]
  covered: number
  remaining: number
}

const all = (answer: JarvisAnswer): readonly JarvisItem[] =>
  answer.sections.flatMap((s) => s.items)
const first = (answer: JarvisAnswer, key: JarvisSection['key']): JarvisItem | undefined =>
  answer.sections.find((s) => s.key === key)?.items[0]
const itemsOf = (
  answer: JarvisAnswer,
  key: JarvisSection['key'],
): readonly JarvisItem[] => answer.sections.find((s) => s.key === key)?.items ?? []
const noteOf = (answer: JarvisAnswer): string | null => {
  const note = all(answer).find((i) => i.kind === 'note')
  return note && note.kind === 'note' ? noteText(note.note) : null
}

function render(answer: JarvisAnswer): Built {
  const items = all(answer)
  const done = (sentences: string[], covered = items.length): Built => ({
    sentences,
    covered: Math.min(covered, items.length),
    remaining: Math.max(0, items.length - Math.min(covered, items.length)),
  })
  const note = noteOf(answer)
  const name = spokenName(answer.about.label)

  switch (answer.intent) {
    case 'KEY_FIGURES':
      return done(figuresSpeech(answer), items.length)
    case 'CLIENT_SUMMARY':
      return done(summarySpeech(answer, name))
    case 'NEXT_MEETING': {
      const event = first(answer, 'upcoming')
      if (!event || event.kind !== 'event') return done([note ?? 'Inget möte är bokat'])
      return done([
        `Ni har ett möte ${spokenDate(event.occursOn)}, ${spokenDays(event.daysAhead)}${event.event.title ? `: ${event.event.title.toLowerCase()}` : ''}`,
      ])
    }
    case 'OPEN_COMMITMENTS': {
      const open = itemsOf(answer, 'promises').filter((i) => i.kind === 'commitment')
      if (open.length === 0) return done([note ?? 'Inga öppna åtaganden'])
      const lead = open
        .slice(0, 2)
        .map((i) => (i.kind === 'commitment' ? commitmentSpeech(i) : ''))
      return done(
        [
          open.length === 1
            ? `Du har ett öppet åtagande: ${lead[0]}`
            : `Du har ${open.length} öppna åtaganden. ${cap(lead.join('. '))}`,
        ],
        Math.min(open.length, 2),
      )
    }
    case 'LAST_INTERACTION': {
      const interaction = first(answer, 'discussed')
      if (!interaction || interaction.kind !== 'interaction')
        return done([note ?? 'Ingen kontakt är dokumenterad'])
      const i = interaction.interaction
      const point = i.keyPoints[0] ? ` ${cap(i.keyPoints[0])}` : ''
      return done(
        [
          `Senaste kontakten var ${spokenDate(i.date)}: ${INTERACTION_LABEL[i.type].toLowerCase()}, ${i.title.toLowerCase()}.${point}`,
        ],
        2,
      )
    }
    case 'MEETING_PREP':
      return done(meetingPrepSpeech(answer), SPOKEN_LEAD_ITEMS)
    case 'CHANGES_SINCE_LAST_MEETING': {
      const changes = itemsOf(answer, 'since-last').filter((i) => i.kind === 'change')
      if (changes.length === 0)
        return done([note ?? 'Få väsentliga förändringar sedan senaste mötet'])
      const phrases = changes
        .slice(0, SPOKEN_LEAD_ITEMS)
        .map((i) => (i.kind === 'change' ? changeSpeech(i, answer) : ''))
        .filter(Boolean)
      return done(
        [
          `Sedan senaste mötet: ${joinAnd(phrases)}`,
          ...(changes.length > SPOKEN_LEAD_ITEMS
            ? [
                `Det finns ${changes.length - SPOKEN_LEAD_ITEMS} till; säg till så tar jag resten`,
              ]
            : []),
        ],
        SPOKEN_LEAD_ITEMS,
      )
    }
    case 'WHY_PRIORITY': {
      const entry = first(answer, 'why-now')
      if (!entry || entry.kind !== 'sentinel-entry')
        return done([note ?? 'Klienten är inte prioriterad just nu'])
      return done([priorityTitle(entry.entry), whyNow(entry.entry.priority)], 2)
    }
    case 'RISKS': {
      const risks = itemsOf(answer, 'risks')
      if (risks.length === 0) return done([note ?? 'Inget att flagga'])
      const lines = risks
        .slice(0, SPOKEN_LEAD_ITEMS)
        .map((r) =>
          r.kind === 'risk'
            ? riskText(r.risk)
            : itemText(r, answer.titles, answer.today).text,
        )
      return done(
        [`Glöm inte: ${joinAnd(lines.map((l) => l.replace(/\.$/, '')))}`],
        SPOKEN_LEAD_ITEMS,
      )
    }
    case 'QUESTIONS_TO_ASK': {
      const qs = itemsOf(answer, 'questions-to-ask').filter(
        (i) => i.kind === 'advisor-question',
      )
      if (qs.length === 0) return done([note ?? 'Inga frågor att föreslå'])
      const ORD = ['Första', 'Andra', 'Tredje']
      return done(
        qs
          .slice(0, 3)
          .map(
            (q, i) =>
              `${ORD[i]}: ${q.kind === 'advisor-question' ? advisorQuestionText(q.question) : ''}`,
          ),
        3,
      )
    }
    case 'CLIENT_QUESTIONS': {
      const qs = itemsOf(answer, 'client-may-ask').filter(
        (i) => i.kind === 'client-question',
      )
      if (qs.length === 0)
        return done([note ?? 'Inget i registret pekar på en fråga från klienten'])
      const lines = qs
        .slice(0, 3)
        .map((q) =>
          q.kind === 'client-question'
            ? clientQuestionText(q.question).replace(/\?$/, '')
            : '',
        )
      return done([`De kan fråga: ${joinAnd(lines)}`], 3)
    }
    case 'MARKET_RELEVANCE': {
      const m = itemsOf(answer, 'market').filter((i) => i.kind === 'market')
      if (m.length === 0)
        return done([note ?? 'Inga klientrelevanta marknadsrörelser i fönstret'])
      const lead = m[0]!
      if (lead.kind !== 'market') return done([])
      return done(
        [
          `${marketHeadline(lead.item)}`,
          marketRelevanceLines(lead.item).why,
          ...(m.length > 1
            ? [
                `${m.length - 1} ${m.length - 1 === 1 ? 'rörelse till' : 'rörelser till'} är relevanta`,
              ]
            : []),
        ],
        1,
      )
    }
    case 'FINANCING': {
      const loans = itemsOf(answer, 'financing').filter((i) => i.kind === 'liability')
      if (loans.length === 0) return done([note ?? 'Inga lån är registrerade'])
      const total = loans.reduce(
        (s, l) => s + (l.kind === 'liability' ? l.liability.outstandingBalance : 0),
        0,
      )
      const soonest = loans
        .filter((l) => l.kind === 'liability' && l.daysToMaturity !== null)
        .sort((a, b) =>
          a.kind === 'liability' && b.kind === 'liability'
            ? (a.daysToMaturity ?? 0) - (b.daysToMaturity ?? 0)
            : 0,
        )[0]
      return done(
        [
          `${loans.length === 1 ? 'Ett lån' : `${loans.length} lån`} på ${spokenAmount(total)} totalt`,
          ...(soonest && soonest.kind === 'liability' && soonest.liability.maturityDate
            ? [
                `${soonest.liability.title} förfaller ${spokenDate(soonest.liability.maturityDate)}, ${spokenDays(soonest.daysToMaturity ?? 0)}`,
              ]
            : []),
        ],
        2,
      )
    }
    case 'GOALS': {
      const goals = itemsOf(answer, 'goals').filter((i) => i.kind === 'goal')
      if (goals.length === 0) return done([note ?? 'Inga mål är registrerade'])
      return done(
        [
          `${goals.length === 1 ? 'Ett mål' : `${goals.length} mål`}: ${joinAnd(goals.slice(0, 3).map((g) => (g.kind === 'goal' ? g.goal.title.toLowerCase() : '')))}`,
        ],
        3,
      )
    }
    case 'OPPORTUNITIES': {
      const ops = itemsOf(answer, 'opportunities')
      if (ops.length === 0) return done([note ?? 'Inga aktiva möjligheter'])
      return done(
        [
          `${ops.length === 1 ? 'En möjlighet' : `${ops.length} möjligheter`}: ${joinAnd(ops.slice(0, 3).map((o) => itemText(o, answer.titles, answer.today).text.replace(/\.$/, '')))}`,
        ],
        3,
      )
    }
    case 'OFFICE_PRIORITIES':
    case 'OFFICE_MEETINGS':
    case 'OFFICE_OVERDUE':
    case 'OFFICE_OPPORTUNITIES':
    case 'DIRECTORY_CALL_TODAY':
    case 'DIRECTORY_MEETINGS':
    case 'DIRECTORY_OVERDUE':
    case 'DIRECTORY_EXTERNAL_ASSETS':
    case 'SENTINEL_TODAY':
      return done(bookSpeech(answer, note), SPOKEN_LEAD_ITEMS)
    case 'MARKET_IMPACT_CLIENTS': {
      const episodes = all(answer).filter((i) => i.kind === 'episode')
      if (episodes.length === 0)
        return done([note ?? 'Ingen klient berörs meningsfullt av dagens rörelser'])
      const affected = all(answer).filter((i) => i.kind === 'affected-client')
      return done(
        [
          joinAnd(
            episodes
              .slice(0, 2)
              .map((e) => (e.kind === 'episode' ? episodeHeadline(e.episode) : '')),
          ),
          ...(affected.length > 0
            ? [
                `Berörda: ${joinAnd(affected.slice(0, 3).map((a) => (a.kind === 'affected-client' ? spokenName(a.affected.client.displayName) : '')))}`,
              ]
            : []),
        ],
        Math.min(items.length, 5),
      )
    }
    case 'GENERAL_CLIENT_QUERY': {
      const hits = itemsOf(answer, 'memory').filter((i) => i.kind === 'memory-hit')
      if (hits.length === 0)
        return done([`Jag hittar ingen dokumenterad uppgift om det för ${name}`])
      return done(
        hits.slice(0, 2).map((h) => itemText(h, answer.titles, answer.today).text),
        2,
      )
    }
    case 'MEETING_PACK_FULL':
    case 'MEETING_PACK_EXECUTIVE':
    case 'MEETING_PACK_PPTX':
    case 'MEETING_PACK_PDF':
    case 'MEETING_PACK_UPDATE':
      return done(packSpeech(answer))
    case 'FOLLOW_UP_MORE': {
      if (items.length === 0 || note) return done([note ?? 'Det finns inget mer att ta'])
      const lines = items
        .slice(0, 6)
        .map((i) => itemText(i, answer.titles, answer.today).text.replace(/\.$/, ''))
      return done(
        [
          `Resten: ${joinAnd(lines)}`,
          ...(items.length > 6 ? [`och ${items.length - 6} till`] : []),
        ],
        6,
      )
    }
    case 'FOLLOW_UP_ITEM': {
      const item = items[0]
      if (!item || item.kind === 'note')
        return done([note ?? 'Den punkten finns inte i det senaste svaret'])
      const t = itemText(item, answer.titles, answer.today)
      return done([t.text, ...(t.detail ? [t.detail] : [])], 1)
    }
    case 'FOLLOW_UP_EVIDENCE': {
      if (note) return done([note])
      if (answer.sources.length === 0)
        return done(['Det bygger på det som saknas i registret, inte på en post'])
      const labels = answer.sources.slice(0, 5).map((s) => s.label)
      return done([
        `Det bygger på ${answer.sources.length === 1 ? 'en post' : `${answer.sources.length} poster`} i registret: ${joinAnd(labels)}`,
        ...(answer.sources.length > 5 ? [`och ${answer.sources.length - 5} till`] : []),
      ])
    }
    case 'CLARIFY_CLIENT': {
      const clarify = first(answer, 'clarify')
      if (!clarify || clarify.kind !== 'clarify-client')
        return done(['Vilken klient menar du?'])
      return done([
        `Menar du ${joinOr(clarify.candidates.map((c) => spokenName(c.displayName)))}?`,
      ])
    }
    default:
      return done(fallbackSpeech(answer, note), SPOKEN_LEAD_ITEMS)
  }
}

/* ------------------------------------------------------------ by intent */

const FIGURE_ORDER: readonly FigureKind[] = [
  'total-wealth',
  'net-worth',
  'aum',
  'liquidity',
  'debt',
]

function figuresSpeech(answer: JarvisAnswer): string[] {
  const figures = itemsOf(answer, 'figures').filter((i) => i.kind === 'figure')
  const get = (kind: FigureKind) =>
    figures.find((f) => f.kind === 'figure' && f.figure === kind)
  const amount = (kind: FigureKind): string | null => {
    const f = get(kind)
    return f && f.kind === 'figure' ? spokenAmount(f.amount) : null
  }
  const total = amount('total-wealth')
  const net = amount('net-worth')
  const aum = amount('aum')
  const liquidity = amount('liquidity')
  const debt = amount('debt')
  const emphasis = answer.emphasis ?? 'total-wealth'
  const sentences: string[] = []
  switch (emphasis) {
    case 'aum':
      if (aum)
        sentences.push(
          `${cap(aum)} hos oss${total ? `, av ${total} i total förmögenhet` : ''}`,
        )
      break
    case 'net-worth':
      if (net)
        sentences.push(
          `Nettoförmögenheten är ${net}${total && debt ? `: ${total} i tillgångar och ${debt} i skulder` : ''}`,
        )
      break
    case 'liquidity':
      if (liquidity) sentences.push(`${cap(liquidity)} i likvida medel`)
      break
    case 'debt':
      if (debt) sentences.push(`${cap(debt)} i skulder`)
      break
    default:
      if (total) sentences.push(`${cap(total)} i total förmögenhet`)
      if (net && aum)
        sentences.push(`Nettoförmögenheten är ${net} och vi har ${aum} hos oss`)
      else if (aum) sentences.push(`Vi har ${aum} hos oss`)
  }
  if (sentences.length === 0) {
    let added = 0
    for (const kind of FIGURE_ORDER) {
      const a = amount(kind)
      if (!a) continue
      sentences.push(`${cap(a)} ${FIGURE_PHRASE[kind]}`)
      added += 1
      if (added === 2) break
    }
  }
  const stale = get('total-wealth')
  if (
    stale &&
    stale.kind === 'figure' &&
    stale.asOf &&
    daysOld(stale.asOf, answer.today) >= 180
  ) {
    sentences.push(`Äldsta värderingen är från ${spokenDate(stale.asOf)}`)
  }
  return sentences.length > 0 ? sentences : ['Jag hittar inga siffror för klienten']
}

const FIGURE_PHRASE: Record<FigureKind, string> = {
  'total-wealth': 'i total förmögenhet',
  aum: 'hos oss',
  'external-assets': 'utanför banken',
  debt: 'i skulder',
  'net-worth': 'i nettoförmögenhet',
  liquidity: 'i likvida medel',
  'property-share': 'i fastigheter',
  'portfolio-value': 'i portföljen',
  'portfolio-ytd': 'i år',
  'opportunity-value': 'i möjligheter',
}

function daysOld(iso: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(iso)) / 86_400_000)
}

function summarySpeech(answer: JarvisAnswer, name: string): string[] {
  const figures = itemsOf(answer, 'figures').filter((i) => i.kind === 'figure')
  const total = figures.find((f) => f.kind === 'figure' && f.figure === 'total-wealth')
  const aum = figures.find((f) => f.kind === 'figure' && f.figure === 'aum')
  const health = first(answer, 'relationship')
  const issue = first(answer, 'issue')
  const meeting = itemsOf(answer, 'relationship').find((i) => i.kind === 'event')
  const sentences: string[] = []
  sentences.push(
    `${name}${total && total.kind === 'figure' ? `: ${spokenAmount(total.amount)} i total förmögenhet` : ''}${aum && aum.kind === 'figure' ? `, ${spokenAmount(aum.amount)} hos oss` : ''}`,
  )
  if (health && health.kind === 'health') {
    sentences.push(`Relationen är ${HEALTH_BAND_LABEL[health.health.band].toLowerCase()}`)
  }
  if (issue && issue.kind === 'sentinel-entry')
    sentences.push(
      `Det viktigaste just nu: ${priorityTitle(issue.entry).replace(/\.$/, '')}`,
    )
  else if (issue && issue.kind === 'signal')
    sentences.push(
      `Det viktigaste just nu: ${signalText(issue.signal).action.replace(/\.$/, '')}`,
    )
  if (meeting && meeting.kind === 'event')
    sentences.push(`Nästa möte ${spokenDate(meeting.occursOn)}`)
  return sentences.slice(0, 4)
}

function commitmentSpeech(item: Extract<JarvisItem, { kind: 'commitment' }>): string {
  const c = item.commitment
  const when =
    item.overdue && item.daysToDue !== null
      ? `försenat ${Math.abs(item.daysToDue)} dagar`
      : c.dueDate
        ? `senast ${spokenDate(c.dueDate)}`
        : 'utan datum'
  return `${c.title.toLowerCase()}, ${when}`
}

const FOCUS_NOUN: Record<string, string> = {
  'relationship-risk': 'relationen',
  refinancing: 'finansieringen',
  'loan-maturity': 'finansieringen',
  'liquidity-event': 'den kommande likviden',
  'strategy-drift': 'risknivån i portföljen',
  'concern-with-market': 'den oro de uttryckt',
  concern: 'den oro de uttryckt',
  'excess-liquidity': 'likviditeten',
  'goal-at-risk': 'målet',
  'next-generation': 'nästa generation',
  'overdue-promise': 'det försenade åtagandet',
  'follow-up': 'uppföljningen',
}

/** Facts first, in the record's words; the assessment last, as "jag tycker". */
function meetingPrepSpeech(answer: JarvisAnswer): string[] {
  const focus = first(answer, 'focus')
  const topics = itemsOf(answer, 'bring-up').filter((i) => i.kind === 'focus-topic')
  const promises = itemsOf(answer, 'promises').filter((i) => i.kind === 'promise')
  const facts: string[] = []
  const overdue =
    promises.find((p) => p.kind === 'promise' && p.view.bucket === 'overdue') ??
    promises[0]
  if (overdue && overdue.kind === 'promise') {
    const c = overdue.view.commitment
    facts.push(
      `${cap(c.title.toLowerCase())} är fortfarande ${overdue.view.bucket === 'overdue' ? 'öppet och försenat' : 'öppet'}`,
    )
  }
  for (const topic of topics) {
    if (topic.kind !== 'focus-topic') continue
    const t = topic.topic
    if ((t.kind === 'loan-maturity' || t.kind === 'refinancing') && t.date) {
      facts.push(
        `${(t.label ?? 'lånet').replace(/\s+förfaller$/iu, '')} ${t.kind === 'refinancing' ? 'läggs om' : 'förfaller'} ${spokenDate(t.date)}`,
      )
    } else if ((t.kind === 'concern' || t.kind === 'concern-with-market') && t.label) {
      facts.push(`De har uttryckt oro: ${t.label.toLowerCase()}`)
    } else if (t.kind === 'strategy-drift') {
      facts.push(focusReasonText(t))
    }
    if (facts.length >= 3) break
  }
  const assessment =
    focus && focus.kind === 'focus'
      ? `Därför tycker jag att ${FOCUS_NOUN[focus.focus.primary.kind] ?? 'det'} bör vara mötets huvudpunkt`
      : null
  const sentences = facts.length > 0 ? [...facts.slice(0, 3)] : []
  if (assessment) sentences.push(assessment)
  return sentences.length > 0
    ? sentences
    : ['Inget i registret kallar på en särskild förberedelse']
}

function changeSpeech(
  item: Extract<JarvisItem, { kind: 'change' }>,
  answer: JarvisAnswer,
): string {
  const c = item.change
  const title = (id: string) => (answer.titles[id] ?? '').toLowerCase()
  switch (c.kind) {
    case 'portfolio-value':
      return `portföljvärdet ${spokenSignedPercent(c.percent)}`
    case 'allocation':
      return `${c.assetClass === 'equities' ? 'aktieandelen' : c.assetClass === 'fixed-income' ? 'ränteandelen' : c.assetClass === 'cash' ? 'likviditetsandelen' : 'alternativa placeringar'} från ${c.before} till ${c.after} procent`
    case 'liquidity':
      return `likviditeten från ${spokenAmount(c.before)} till ${spokenAmount(c.after)}`
    case 'wealth':
      return `förmögenheten ${spokenSignedPercent(c.percent)}`
    case 'loan-new':
      return `ett nytt lån, ${title(c.loanId)}`
    case 'loan-closed':
      return `ett löst lån, ${title(c.loanId)}`
    case 'loan-balance':
      return `${title(c.loanId)} från ${spokenAmount(c.before)} till ${spokenAmount(c.after)}`
    case 'financing-approaching':
      return `${title(c.eventId) || 'en finansieringshändelse'} inom ${c.daysAhead} dagar`
    case 'goal-status':
      return `målet ${title(c.goalId)} har ändrat status`
    case 'goal-progress':
      return `målet ${title(c.goalId)} till ${c.after} procent`
    case 'health':
      return `relationshälsan från ${c.before} till ${c.after}`
    case 'contacts':
      return `${c.interactionIds.length} kontakter`
    case 'commitments':
      return c.overdueIds.length > 0
        ? `${c.overdueIds.length} ${c.overdueIds.length === 1 ? 'försenat åtagande' : 'försenade åtaganden'}`
        : `${c.createdIds.length} nya åtaganden`
    case 'event-new':
      return `en ny händelse, ${title(c.eventId)}`
    case 'concern-new':
      return `en ny oro: ${c.statement.toLowerCase()}`
    case 'context-new':
      return `nytt om klienten: ${c.statement.toLowerCase()}`
  }
}

function bookSpeech(answer: JarvisAnswer, note: string | null): string[] {
  const rows = all(answer).filter(
    (i) => i.kind === 'client-row' || i.kind === 'sentinel-entry',
  )
  if (rows.length === 0) return [note ?? 'Ingen klient behöver dig just nu']
  const lines = rows.slice(0, SPOKEN_LEAD_ITEMS).map((row) => {
    if (row.kind === 'sentinel-entry')
      return `${spokenName(row.entry.client.displayName)}: ${priorityTitle(row.entry).replace(/\.$/, '').toLowerCase()}`
    if (row.kind === 'client-row') {
      const t = itemText(row, answer.titles, answer.today)
      return `${spokenName(row.row.displayName)}${t.detail ? `: ${t.detail.replace(/\.$/, '')}` : ''}`
    }
    return ''
  })
  const head =
    rows.length <= SPOKEN_LEAD_ITEMS
      ? `${rows.length === 1 ? 'En klient' : `${rows.length} klienter`}: ${joinAnd(lines)}`
      : `Jag ser ${rows.length} klienter. De ${SPOKEN_LEAD_ITEMS} viktigaste är ${joinAnd(lines)}`
  return [
    head,
    ...(rows.length > SPOKEN_LEAD_ITEMS ? ['Säg till så tar jag resten'] : []),
  ]
}

function packSpeech(answer: JarvisAnswer): string[] {
  const readiness = first(answer, 'readiness')
  const outline = first(answer, 'contents')
  const sentences: string[] = []
  const contents =
    outline && outline.kind === 'pack-outline'
      ? `${outline.core} ${outline.core === 1 ? 'kärnbild' : 'kärnbilder'}${outline.appendix > 0 ? ` och ${outline.appendix} bilagor` : ''}`
      : null
  const depth =
    outline && outline.kind === 'pack-outline'
      ? DEPTH_LABEL[outline.depth].toLowerCase()
      : 'underlaget'
  if (readiness && readiness.kind === 'pack-readiness') {
    const r = readiness.readiness
    if (r.state === 'REDO') {
      sentences.push(`Absolut. ${cap(depth)} är redo${contents ? `: ${contents}` : ''}`)
    } else if (r.state === 'GRANSKA') {
      sentences.push(
        `Absolut. ${cap(depth)} kan genereras, men ${readinessSummary(r).toLowerCase()} innan mötet`,
      )
    } else {
      const block = r.reasons.find((x) => x.severity === 'block')
      sentences.push(
        `${cap(depth)} är blockerat${block ? `: ${readinessReasonText(block).replace(/\.$/, '').toLowerCase()}` : ''}`,
      )
    }
  }
  if (answer.intent === 'MEETING_PACK_UPDATE') {
    const changes = itemsOf(answer, 'since-last').filter((i) => i.kind === 'change')
    sentences.push(
      changes.length === 0
        ? 'Få väsentliga förändringar sedan senaste mötet'
        : `Sedan sist: ${joinAnd(changes.slice(0, 3).map((c) => (c.kind === 'change' ? changeSpeech(c, answer) : '')))}`,
    )
  }
  sentences.push(
    answer.opens
      ? 'Jag öppnar förhandsgranskningen'
      : 'Förhandsgranskningen finns att öppna',
  )
  return sentences
}

function fallbackSpeech(answer: JarvisAnswer, note: string | null): string[] {
  const items = all(answer).filter((i) => i.kind !== 'note')
  if (items.length === 0) return [note ?? 'Inget att rapportera']
  const lines = items.slice(0, SPOKEN_LEAD_ITEMS).map((i) => {
    if (i.kind === 'strategy-observation')
      return strategyObservationText(i.observation).observation
    if (i.kind === 'objective') return objectiveText(i.objective)
    return itemText(i, answer.titles, answer.today).text
  })
  return [
    ...(items.length > SPOKEN_LEAD_ITEMS
      ? [`Jag ser ${items.length} saker. De ${SPOKEN_LEAD_ITEMS} viktigaste:`]
      : []),
    ...lines,
    ...(items.length > SPOKEN_LEAD_ITEMS ? ['Säg till så tar jag resten'] : []),
  ]
}

/** The answer's intents a voice may answer from the record; everything else is the model's. */
export const SPOKEN_INTENTS: ReadonlySet<AdvisoryIntentKind> =
  new Set<AdvisoryIntentKind>([
    'KEY_FIGURES',
    'CLIENT_SUMMARY',
    'NEXT_MEETING',
    'OPEN_COMMITMENTS',
    'LAST_INTERACTION',
    'MEETING_PREP',
    'CHANGES_SINCE_LAST_MEETING',
    'WHY_PRIORITY',
    'RISKS',
    'QUESTIONS_TO_ASK',
    'CLIENT_QUESTIONS',
    'MARKET_RELEVANCE',
    'FINANCING',
    'GOALS',
    'OPPORTUNITIES',
  ])
