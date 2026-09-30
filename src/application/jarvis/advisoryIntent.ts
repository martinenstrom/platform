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

export interface AdvisoryIntent {
  kind: AdvisoryIntentKind
  /** A client the line named, resolved against the register; absent when the screen's subject is meant. */
  namedClient?: NamedClient
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
  `förmögenhet${L}`,
  'hur mycket (?:har|äger|är)',
  'hur rik',
  `figures`,
  `numbers`,
  'net worth',
  'how (?:much|rich|wealthy)',
  'aum',
  `tillgång${L}`,
  `skulder${L}`,
  `likviditet${L}`,
])
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
  const words = text.match(/\p{Lu}\p{Ll}+/gu) ?? []
  const names = words.filter((word, index) => !(index === 0 && COMMON_STARTS.has(word)))
  if (names.length === 0) return null
  const candidates = clients.filter((client) => {
    const parts = client.displayName.split(/[\s&]+/).filter(Boolean)
    return names.some((name) => parts.includes(name))
  })
  if (candidates.length !== 1) return null
  const only = candidates[0]!
  /* Every capitalised word that is a name must belong to this client. */
  const parts = new Set(only.displayName.split(/[\s&]+/).filter(Boolean))
  const foreign = names.filter((name) => !parts.has(name) && looksLikeName(name, clients))
  return foreign.length === 0 ? only : null
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
): AdvisoryIntent | null {
  const line = text.trim()
  if (!line || line.length > MAX_LINE) return null
  const named = resolveNamedClient(line, clients)
  const done = (kind: AdvisoryIntentKind): AdvisoryIntent => ({
    kind,
    ...(named ? { namedClient: named } : {}),
    method: 'advisory-intent-v1',
  })

  /* A named client makes any line a client question, from any scope. */
  if (named || IS_CLIENT_SCOPE(context.scope)) {
    const client = clientIntent(line)
    if (client) return done(client)
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
