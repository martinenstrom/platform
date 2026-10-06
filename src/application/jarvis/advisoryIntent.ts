/**
 * What a line asks of the relationship record, recognised without a model.
 *
 * Tier 0 for the advisory scopes: a deterministic recogniser over the way a
 * Swedish Private Banker asks — "vad ska jag ta upp på mötet", "vad
 * pratade vi om sist", "vad har jag lovat", "varför är de prioriterade" —
 * and the English she may fall into. The scope narrows the family: on a
 * client the line is about that client; in an office it is about the
 * office's book; on the whole book, the whole book. A line that names
 * another client is answered about that client, and the screen does not
 * move.
 *
 * The interface is the point: a model may later classify intent here
 * without touching the evidence services behind each kind (TD-105).
 */

import type { AdvisoryIntentKind } from './answer'
import type { JarvisContext, JarvisScope } from './context'

export interface NamedClient {
  id: string
  displayName: string
}

export type FigureEmphasis = 'total-wealth' | 'aum' | 'net-worth' | 'liquidity' | 'debt'

export interface NamedOffice {
  id: string
  displayName: string
}

/** The period a book question names: "i år", "den här månaden", "i veckan". The answer turns it into a date. */
export type BookPeriod = 'year' | 'month' | 'week'

export interface AdvisoryIntent {
  kind: AdvisoryIntentKind
  /** A client the line named, resolved against the register; absent when the screen's subject is meant. */
  namedClient?: NamedClient
  /** A name that fits several clients; the answer asks which one. */
  ambiguous?: readonly NamedClient[]
  /** The figure a figures line asked for first. */
  emphasis?: FigureEmphasis
  /** "Utveckla punkt två": which item of the last answer, 1-based. */
  itemIndex?: number
  /** A book question's period, where the line named one. */
  period?: BookPeriod
  /** An office the line named, resolved against the register — "från Strandvägen", "till Arbetargatan". */
  office?: NamedOffice
  /** Whether the named office is where something moved to or from; absent when the line did not say. */
  direction?: 'to' | 'from'
  method: 'advisory-intent-v1'
}

/* Word boundaries that know Swedish letters; see marketIntent.ts. */
const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'
const L = '\\p{L}*'
const cue = (alternatives: readonly string[]): RegExp =>
  new RegExp(`${B}(?:${alternatives.join('|')})${E}`, 'iu')

/* ------------------------------------------------------- client families */

const MEETING_PREP = cue([
  '(?:inför|innan|före|till) (?:mötet|möte|samtalet)',
  'ta upp',
  `förbered${L}`,
  'vad (?:ska|bör|borde) jag (?:säga|prata om|diskutera)',
  'mötesplan',
  'agenda',
  'prepare',
  'before the meeting',
  'bring up',
  'think about',
  'talk about',
  'brief me',
  'briefa mig',
])
const NEXT_MEETING = cue([
  'när (?:ses|träffas|möts|sågs) vi',
  'när (?:är|blir|har vi|har jag) (?:mötet|nästa möte|nästa träff)',
  'nästa möte',
  'när träffar jag (?:dem|dom|honom|henne|hen|kunden|klienten)',
  'when (?:do|are) we meet(?:ing)?',
  'when is the (?:next )?meeting',
  'next meeting',
])
const LAST_INTERACTION = cue([
  '(?:pratade|diskuterade|tog upp|gick|talade) (?:vi|ni|jag)(?: igenom)?(?: om)? (?:sist|senast|förra gången)',
  'senaste (?:mötet|samtalet|kontakten|gången)',
  'förra (?:mötet|samtalet|gången)',
  'vad hände (?:sist|senast)',
  'sist vi (?:sågs|pratade|träffades|talades)',
  'last time',
  'last meeting',
  'last conversation',
  'discuss(?:ed)? last',
])
/** What the client said about something: the relationship memory's, never a summary of the last meeting. */
const SAID = cue([
  '(?:sa|sade|nämnde|tyckte|uttryckte) (?:de|dom|kunden|klienten|hon|han|hen)',
  'vad sa',
  'what did (?:they|she|he|the client) say',
  'said',
  'mention\\p{L}*',
])
const COMMITMENTS = cue([
  `lova${L}`,
  `löfte${L}`,
  `åtagande${L}`,
  `promis${L}`,
  `commit${L}`,
  'inte (?:gjort|slutfört|klart|hunnit|levererat)',
  'unfinished',
  'not (?:done|finished|delivered)',
  'owe',
])
const CHANGES = cue([
  `förändr${L}`,
  `ändra${L}`,
  'hänt sedan',
  'sedan (?:sist|senast|förra)',
  'since (?:last|then)',
  'changed',
  'what happened',
])
const WHY_PRIORITY = cue([
  `prioriter${L}`,
  'varför (?:är|ligger|står) (?:de|dom|den|kunden|klienten|hon|han|hen)',
  `priorit${L}`,
  'sentinel',
])
const MARKET = cue([
  `marknad${L}`,
  `market${L}`,
  `ränt${L}`,
  `börs${L}`,
  `kurs${L}`,
  `rörelse${L}`,
  `exponer${L}`,
  'rates',
  'stocks',
])
const FINANCING = cue([
  `lån${L}`,
  `bolån${L}`,
  `finansier${L}`,
  `omläggning${L}`,
  'läggs om',
  `förfall${L}`,
  `refinanc${L}`,
  `loan${L}`,
  `mortgage${L}`,
  `maturit${L}`,
  `belåning${L}`,
])
const GOALS = cue([`mål${L}`, 'målet', `goal${L}`, 'planen', 'planerna'])
const OPPORTUNITIES = cue([
  `möjlighet${L}`,
  `opportunit${L}`,
  `potential${L}`,
  'utforska',
])
const RISKS = cue([
  `risk${L}`,
  'glöm inte',
  'inte glömma',
  `fallgrop${L}`,
  'forget',
  `varning${L}`,
  `warning${L}`,
  'akta',
])
const QUESTIONS_TO_ASK = cue([
  'frågor (?:bör|ska|borde|kan) jag ställa',
  'fråga (?:kunden|klienten|dem|dom|henne|honom)',
  'bör jag fråga',
  'ska jag fråga',
  'questions (?:should|to|do) i ask',
  'what (?:should|do) i ask',
])
const CLIENT_QUESTIONS = cue([
  '(?:kommer|kan|lär|brukar) (?:de|dom|kunden|klienten|hon|han|hen)(?: sannolikt| troligen)? fråga',
  'vad frågar (?:de|dom|kunden|klienten)',
  'sannolikt fråga',
  'likely (?:to )?ask',
  'what (?:will|might|could) they ask',
  'their questions',
])
const KEY_FIGURES = cue([
  `siffr${L}`,
  `nyckeltal${L}`,
  `${L}förmögenhet${L}`,
  'hur mycket (?:har|äger|är|finns)',
  'hur rik',
  `figures`,
  `numbers`,
  'net worth',
  'how (?:much|rich|wealthy)',
  'aum',
  `tillgång${L}`,
  `skulder${L}`,
  `likviditet${L}`,
  'hos oss',
  'hos banken',
  'under förvaltning',
])
/** Which figure a figures line asks for first; the spoken answer leads with it. */
const EMPHASIS: readonly { cue: RegExp; figure: FigureEmphasis }[] = [
  {
    cue: cue(['hos oss', 'hos banken', 'under förvaltning', 'aum', 'förvaltar vi']),
    figure: 'aum',
  },
  { cue: cue([`netto${L}`, 'net worth']), figure: 'net-worth' },
  { cue: cue([`likvid${L}`, `kassa${L}`, `kontant${L}`, 'cash']), figure: 'liquidity' },
  { cue: cue([`skuld${L}`, 'debt']), figure: 'debt' },
  {
    cue: cue([
      `total${L}`,
      'hur rik',
      'hur mycket (?:har|äger)',
      'how (?:much|rich|wealthy)',
    ]),
    figure: 'total-wealth',
  },
]
function emphasisOf(line: string): FigureEmphasis | undefined {
  return EMPHASIS.find((entry) => entry.cue.test(line))?.figure
}
const CLIENT_SUMMARY = cue([
  '30 sekunder',
  '30 seconds',
  `kortfattat`,
  `sammanfatt${L}`,
  `överblick${L}`,
  `översikt${L}`,
  'viktigast',
  'vad (?:bör|ska|borde|behöver) jag (?:veta|känna till|ha koll på)',
  'ge mig (?:kunden|klienten|dem|dom)',
  'vem är (?:kunden|klienten|de|dom)',
  `summar${L}`,
  'most important',
  'key things',
  'in short',
  'briefly',
  'who (?:is|are) (?:this|the) client',
  'what matters',
])
const UNFINISHED = cue([
  'inte (?:slutfört|gjort|klart|hunnit)',
  'kvar att göra',
  'unfinished',
  'outstanding',
])

/* ------------------------------------------------- the conversation's own */

const FOLLOW_UP_MORE = cue([
  'ta resten',
  'resten (?:också|med)',
  'resten',
  'fortsätt',
  'de (?:andra|övriga)',
  'the rest',
  'go on',
  'continue',
])
const FOLLOW_UP_EVIDENCE = cue([
  'vad bygger du (?:det|detta|den|dem) på',
  'varför säger du (?:det|så|detta)',
  'vad (?:är|har du för) underlag',
  `underlag${L} för det`,
  `källa${L}`,
  'what is (?:that|this) based on',
  'why do you say',
  'your sources',
])
const ORDINALS: Record<string, number> = {
  '1': 1,
  ett: 1,
  första: 1,
  one: 1,
  first: 1,
  '2': 2,
  två: 2,
  andra: 2,
  two: 2,
  second: 2,
  '3': 3,
  tre: 3,
  tredje: 3,
  three: 3,
  third: 3,
  '4': 4,
  fyra: 4,
  fjärde: 4,
  four: 4,
  fourth: 4,
  '5': 5,
  fem: 5,
  femte: 5,
  five: 5,
  fifth: 5,
  '6': 6,
  sex: 6,
  sjätte: 6,
  six: 6,
  sixth: 6,
}
const FOLLOW_UP_ITEM =
  /(?:utveckla|berätta mer om|mer om|elaborate on|expand on|tell me more about)\s+(?:punkt\s+|den\s+|point\s+|item\s+|number\s+)?(\d|ett|två|tre|fyra|fem|sex|första|andra|tredje|fjärde|femte|sjätte|one|two|three|four|five|six|first|second|third|fourth|fifth|sixth)(?![\p{L}\p{N}])|(?:^|\s)punkt\s+(\d|ett|två|tre|fyra|fem|sex)(?![\p{L}\p{N}])/iu

function followUpItemIndex(line: string): number | null {
  const match = FOLLOW_UP_ITEM.exec(line)
  if (!match) return null
  const word = (match[1] ?? match[2] ?? '').toLowerCase()
  return ORDINALS[word] ?? null
}

/* ---------------------------------------------------------- the pack */

const PACK = cue([
  `mötesunderlag${L}`,
  `underlag${L} (?:inför|till|för) (?:mötet|möte)`,
  'pack',
  'meeting pack',
  'powerpoint',
  `powerpoint${L}`,
  'pptx',
  `presentation${L}`,
  'slides',
  'executive',
  'briefing',
  'pdf',
  `pdf${L}`,
  'deck',
])
const PACK_PDF = cue(['pdf', `pdf${L}`])
const PACK_PPTX = cue([
  'powerpoint',
  `powerpoint${L}`,
  'pptx',
  `presentation${L}`,
  'slides',
  'deck',
])
const PACK_EXECUTIVE = cue([
  'executive',
  'fem ?slides',
  'five slides',
  `kort${L} (?:version|underlag|variant)`,
  'brief',
])
const PACK_UPDATE = cue([`uppdatera${L}`, 'update', 'regenerera', 'gör om', 'refresh'])

/** A line that asks for the pack itself: which depth, which format, or a refresh. */
function packIntent(line: string): AdvisoryIntentKind | null {
  if (!PACK.test(line)) return null
  if (PACK_UPDATE.test(line)) return 'MEETING_PACK_UPDATE'
  if (PACK_PDF.test(line)) return 'MEETING_PACK_PDF'
  if (PACK_EXECUTIVE.test(line)) return 'MEETING_PACK_EXECUTIVE'
  if (PACK_PPTX.test(line)) return 'MEETING_PACK_PPTX'
  return 'MEETING_PACK_FULL'
}

/* ------------------------------------------------------- book families */

const NEEDS_ME = cue([
  'behöver (?:mig|min uppmärksamhet|hjälp|kontakt)',
  `prioriter${L}`,
  'ringa',
  'kontakta',
  'agera',
  'who needs',
  'call',
  'attention',
  'vem (?:bör|ska|borde) jag',
  'börja med',
  'var (?:ska|bör|borde) jag börja',
  'start with',
  'where (?:do|should) i start',
])
const MEETINGS = cue([`möte${L}`, `meeting${L}`, 'träffa'])
const OVERDUE = cue([
  `försenad${L}`,
  `lova${L}`,
  `löfte${L}`,
  `åtagande${L}`,
  'overdue',
  `promis${L}`,
  `commit${L}`,
])
const EXTERNAL_ASSETS = cue([
  `extern${L}`,
  'utanför banken',
  'andra bank',
  'annan bank',
  'hos andra',
  'external',
  'elsewhere',
])
const AFFECTED = cue([
  `berör${L}`,
  `påverk${L}`,
  `klient${L}`,
  `kund${L}`,
  `exponer${L}`,
  'affected',
  'who',
  'vem',
  'vilka',
])

const IS_CLIENT_SCOPE = (scope: JarvisScope) => scope === 'CLIENT' || scope === 'MEETING'

/* ------------------------------------------------------- the book's life */

/** A word that makes a line about the book rather than the client on screen. */
const BOOK_WORD = cue([
  `klient${L}`,
  `kund${L}`,
  `relation${L}`,
  `client${L}`,
  `pb-?bok${L}`,
  `bok${L}`,
  'registret',
])
const BOOK_NEW = cue([
  'nya? (?:klienter|kunder|relationer|pb-?relationer)',
  `nytillkom${L}`,
  'tillkommit',
  '(?:skapat|lagt till|tagit in|registrerat) (?:nya )?(?:klienter|kunder|relationer)',
  'new (?:clients|relationships)',
  'who (?:is|are) new',
])
const BOOK_ONBOARDING = cue([
  `onboarding${L}`,
  'under uppstart',
  'inte (?:är )?aktiverade',
  `ännu inte aktiv${L}`,
  'being onboarded',
  'not yet active',
])
const BOOK_FORMER = cue([
  'tidigare (?:klienter|kunder|relationer|pb-?relationer)',
  `(?:klienter|kunder|relationer)(?: som)? (?:har )?(?:lämna${L}|slutade|slutat|avsluta${L}|gick|gått|försvann|försvunnit)`,
  'lämnade (?:oss|banken|mig)',
  'avslutade (?:relationer|klienter|kunder|pb-?relationer)',
  'former clients',
  '(?:clients|relationships)(?: that| who| which)? left',
  'who left',
  'lost clients',
])
const BOOK_MOVED = cue([
  `(?:vilka|vem|klienter|kunder|relationer|who|clients)(?: som)? (?:har |blev |blivit )?flytta${L}`,
  `flytta${L} (?:till|från|mellan)`,
  'bytt(?:e)? kontor',
  'moved (?:to|from|between|office)',
  'who moved',
  'transferred',
])
const BOOK_REACTIVATED = cue([
  `återaktiver${L}`,
  'kommit tillbaka',
  'kom tillbaka',
  'tillbaka som (?:klient|kund)',
  `reactivat${L}`,
  'came back',
  'returned as clients?',
])
const BOOK_CHANGES = cue([
  `(?:ändra|förändra|hänt|hände|händer|händelser|changed|happened)${L} (?:i|med) (?:min |vår |den |the |my )?(?:pb-?bok${L}|klientbok${L}|bok${L}|register${L}|book)`,
  `(?:pb-?bok|klientbok|bok)${L} (?:förändring|händelse|historik)${L}`,
  'what changed in (?:my |the )?book',
  'book changes',
  `livscykel${L}`,
])

/** The book question a line asks, the more specific act ahead of the broader one. */
function bookIntent(line: string): AdvisoryIntentKind | null {
  if (BOOK_REACTIVATED.test(line)) return 'BOOK_REACTIVATED'
  if (BOOK_MOVED.test(line)) return 'BOOK_MOVED'
  if (BOOK_FORMER.test(line)) return 'BOOK_FORMER'
  if (BOOK_ONBOARDING.test(line)) return 'BOOK_ONBOARDING'
  if (BOOK_NEW.test(line)) return 'BOOK_NEW_CLIENTS'
  if (BOOK_CHANGES.test(line)) return 'BOOK_CHANGES'
  return null
}

const PERIODS: readonly { cue: RegExp; period: BookPeriod }[] = [
  {
    cue: cue(['i år', 'det här året', 'detta år', 'hittills i år', 'this year', 'year to date']),
    period: 'year',
  },
  {
    cue: cue(['den här månaden', 'denna månad', 'i månaden', 'this month']),
    period: 'month',
  },
  {
    cue: cue(['den här veckan', 'denna vecka', 'i veckan', 'this week']),
    period: 'week',
  },
]

function periodOf(line: string): BookPeriod | undefined {
  return PERIODS.find((entry) => entry.cue.test(line))?.period
}

/** Lower case, without diacritics: "Strandvägen" and "strandvagen" are one office. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
}

/**
 * The office a line names, and whether the line says something moved to
 * it or from it. The longest matching name wins, so "Strandvägen Norra"
 * is not read as "Strandvägen"; a name that matches nothing names nobody.
 */
export function resolveNamedOffice(
  text: string,
  offices: readonly NamedOffice[],
): { office: NamedOffice; direction?: 'to' | 'from' } | null {
  const line = plain(text)
  const matches = offices
    .filter((office) => office.displayName.trim().length > 0)
    .filter((office) =>
      new RegExp(`${B}${escapeRegExp(plain(office.displayName))}${E}`, 'u').test(line),
    )
    .sort((a, b) => b.displayName.length - a.displayName.length)
  const office = matches[0]
  if (!office) return null
  const name = escapeRegExp(plain(office.displayName))
  if (new RegExp(`${B}(?:till|to)\\s+${name}${E}`, 'u').test(line))
    return { office, direction: 'to' }
  if (new RegExp(`${B}(?:från|fran|from)\\s+${name}${E}`, 'u').test(line))
    return { office, direction: 'from' }
  return { office }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/* --------------------------------------------------------- named clients */

/**
 * The client a line names, when exactly one client in the register carries
 * every capitalised name in the line — "Henrik", "Anna & Per", "Dahlqvist".
 * Nothing is guessed: a name that fits two clients names nobody.
 */
export function resolveNamedClient(
  text: string,
  clients: readonly NamedClient[],
): NamedClient | null {
  const resolved = resolveNamedClients(text, clients)
  return resolved.kind === 'one' ? resolved.client : null
}

export type NamedResolution =
  | { kind: 'none' }
  | { kind: 'one'; client: NamedClient }
  /** The name fits several clients; nobody is guessed, and the answer may ask. */
  | { kind: 'many'; candidates: readonly NamedClient[] }

/** The client a line names, or the clients a first name could mean. */
export function resolveNamedClients(
  text: string,
  clients: readonly NamedClient[],
): NamedResolution {
  const words = text.match(/\p{Lu}\p{Ll}+/gu) ?? []
  const names = words.filter((word, index) => !(index === 0 && COMMON_STARTS.has(word)))
  if (names.length === 0) return { kind: 'none' }
  const candidates = clients.filter((client) => {
    const parts = client.displayName.split(/[\s&]+/).filter(Boolean)
    return names.some((name) => parts.includes(name))
  })
  if (candidates.length === 0) return { kind: 'none' }
  if (candidates.length > 1) {
    /* Two names in the line that together fit exactly one client — "Henrik Alvarsson" — are not an ambiguity. */
    const exact = candidates.filter((client) => {
      const parts = new Set(client.displayName.split(/[\s&]+/).filter(Boolean))
      return names
        .filter((name) => looksLikeName(name, clients))
        .every((name) => parts.has(name))
    })
    if (exact.length === 1) return { kind: 'one', client: exact[0]! }
    return { kind: 'many', candidates }
  }
  const only = candidates[0]!
  /* Every capitalised word that is a name must belong to this client. */
  const parts = new Set(only.displayName.split(/[\s&]+/).filter(Boolean))
  const foreign = names.filter((name) => !parts.has(name) && looksLikeName(name, clients))
  return foreign.length === 0 ? { kind: 'one', client: only } : { kind: 'none' }
}

/** Sentence starts that are capitalised only because they start the sentence. */
const COMMON_STARTS = new Set([
  'Vad',
  'Vilka',
  'Vilken',
  'Vem',
  'Varför',
  'Hur',
  'När',
  'Och',
  'Ge',
  'Har',
  'Finns',
  'Är',
  'Kan',
  'Ska',
  'Bör',
  'What',
  'Which',
  'Who',
  'Why',
  'How',
  'When',
  'And',
  'Give',
  'Does',
  'Is',
  'Are',
  'Can',
  'Should',
  'Tell',
  'Berätta',
  'Visa',
  'Show',
  'Förbered',
  'Prepare',
  'Skapa',
  'Create',
  'Generate',
  'Generera',
  'Uppdatera',
  'Update',
])

function looksLikeName(word: string, clients: readonly NamedClient[]): boolean {
  return clients.some((client) => client.displayName.split(/[\s&]+/).includes(word))
}

/* ---------------------------------------------------------- recogniser */

const MAX_LINE = 300

/**
 * The intent of a line in its context, or null when the record cannot
 * answer it here and the line should go on to the one router.
 */
export function recognizeAdvisoryIntent(
  text: string,
  context: JarvisContext,
  clients: readonly NamedClient[] = [],
  offices: readonly NamedOffice[] = [],
): AdvisoryIntent | null {
  const line = text.trim()
  if (!line || line.length > MAX_LINE) return null
  const resolution = resolveNamedClients(line, clients)
  const named = resolution.kind === 'one' ? resolution.client : null
  const done = (kind: AdvisoryIntentKind): AdvisoryIntent => ({
    kind,
    ...(named ? { namedClient: named } : {}),
    method: 'advisory-intent-v1',
  })

  /* A first name two clients share names nobody; the answer asks which one. */
  if (resolution.kind === 'many') {
    return {
      kind: 'CLARIFY_CLIENT',
      ambiguous: resolution.candidates,
      method: 'advisory-intent-v1',
    }
  }

  /* The conversation's own continuations, wherever the advisor is. */
  if (FOLLOW_UP_EVIDENCE.test(line)) return done('FOLLOW_UP_EVIDENCE')
  const itemIndex = followUpItemIndex(line)
  if (itemIndex !== null) return { ...done('FOLLOW_UP_ITEM'), itemIndex }
  if (FOLLOW_UP_MORE.test(line) && line.length <= 40) return done('FOLLOW_UP_MORE')

  /*
   * The book's lifecycle — who came, who is being taken in, who left, who
   * moved, who came back, what changed — from wherever the advisor is. On a
   * client the line must speak of the book, not of the client on screen.
   */
  if (!named) {
    const book = bookIntent(line)
    if (book && (!IS_CLIENT_SCOPE(context.scope) || BOOK_WORD.test(line))) {
      const period = periodOf(line)
      const office = resolveNamedOffice(line, offices)
      return {
        ...done(book),
        ...(period ? { period } : {}),
        ...(office ? { office: office.office } : {}),
        ...(office?.direction ? { direction: office.direction } : {}),
      }
    }
  }

  /* A named client makes any line a client question, from any scope. */
  if (named || IS_CLIENT_SCOPE(context.scope)) {
    const client = clientIntent(line)
    if (client) {
      const emphasis =
        client === 'KEY_FIGURES' || client === 'CLIENT_SUMMARY'
          ? emphasisOf(line)
          : undefined
      return { ...done(client), ...(emphasis ? { emphasis } : {}) }
    }
    if (named) return done('CLIENT_SUMMARY')
    /* Nothing recognised on a client: the relationship memory answers, or says it cannot. */
    return done('GENERAL_CLIENT_QUERY')
  }

  switch (context.scope) {
    case 'OFFICE':
      if (OVERDUE.test(line)) return done('OFFICE_OVERDUE')
      if (MEETINGS.test(line)) return done('OFFICE_MEETINGS')
      if (OPPORTUNITIES.test(line)) return done('OFFICE_OPPORTUNITIES')
      if (NEEDS_ME.test(line)) return done('OFFICE_PRIORITIES')
      return null
    case 'CLIENT_DIRECTORY':
      if (EXTERNAL_ASSETS.test(line)) return done('DIRECTORY_EXTERNAL_ASSETS')
      if (OVERDUE.test(line)) return done('DIRECTORY_OVERDUE')
      if (MEETINGS.test(line)) return done('DIRECTORY_MEETINGS')
      if (NEEDS_ME.test(line)) return done('DIRECTORY_CALL_TODAY')
      return null
    case 'SENTINEL':
      if (
        NEEDS_ME.test(line) ||
        WHY_PRIORITY.test(line) ||
        /\b(?:idag|i dag|today)\b/iu.test(line)
      )
        return done('SENTINEL_TODAY')
      return null
    case 'MARKET_IMPACT':
      if (AFFECTED.test(line)) return done('MARKET_IMPACT_CLIENTS')
      return null
    default:
      return null
  }
}

/**
 * The client family, in the order that keeps the more specific cue ahead of
 * the broader one: what the client said is the memory's before anything;
 * the market's "sedan sist" is the market's before the changes'; "last
 * time" inside "what changed since last time" is the changes'.
 */
function clientIntent(line: string): AdvisoryIntentKind | null {
  if (SAID.test(line)) return 'GENERAL_CLIENT_QUERY'
  const pack = packIntent(line)
  if (pack) return pack
  if (NEXT_MEETING.test(line)) return 'NEXT_MEETING'
  if (CLIENT_QUESTIONS.test(line)) return 'CLIENT_QUESTIONS'
  if (QUESTIONS_TO_ASK.test(line)) return 'QUESTIONS_TO_ASK'
  if (WHY_PRIORITY.test(line)) return 'WHY_PRIORITY'
  if (MARKET.test(line)) return 'MARKET_RELEVANCE'
  if (CHANGES.test(line)) return 'CHANGES_SINCE_LAST_MEETING'
  if (LAST_INTERACTION.test(line)) return 'LAST_INTERACTION'
  if (MEETING_PREP.test(line)) return 'MEETING_PREP'
  if (UNFINISHED.test(line) || COMMITMENTS.test(line)) return 'OPEN_COMMITMENTS'
  if (FINANCING.test(line)) return 'FINANCING'
  if (RISKS.test(line)) return 'RISKS'
  if (OPPORTUNITIES.test(line)) return 'OPPORTUNITIES'
  if (GOALS.test(line)) return 'GOALS'
  if (CLIENT_SUMMARY.test(line)) return 'CLIENT_SUMMARY'
  if (KEY_FIGURES.test(line)) return 'KEY_FIGURES'
  return null
}
