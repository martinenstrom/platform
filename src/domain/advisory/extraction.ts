/**
 * What JARVIS understood from an advisor's note — deterministic, in Phase 1.
 *
 * The advisor writes a few natural sentences; this reads them for the things
 * the relationship record keeps — the kind of interaction, a concern, a
 * promise with a due date, an event with a date, the next meeting, the
 * topics — and proposes each as an item the advisor confirms, edits or
 * removes. Nothing proposed is a fact until confirmed; every item carries
 * the words it rests on.
 *
 * Swedish first, English alongside, by lexicon and pattern rather than by a
 * model: the same note always produces the same items, and a test can plant
 * a sentence and assert what came out. A model may later propose items
 * through the same `ExtractedItem` shape; the confirmation step does not
 * change.
 */

import { addDays, isoWeekday } from './dates'
import type {
  Confidence,
  ContextCategory,
  DiscussionTopic,
  EventType,
  ExtractedItem,
  InteractionType,
} from './relationship'

/**
 * What the record already holds for the client, so a note can move it: the
 * open promises a note may say were kept, the active concerns a note may
 * say have eased. Nothing is matched that is not here, and nothing here is
 * proposed without words in the note that speak of it.
 */
export interface ExtractionRecord {
  openCommitments: readonly { id: string; title: string }[]
  activeConcerns: readonly { id: string; statement: string }[]
}

export interface ExtractionInput {
  text: string
  /** ISO date the interaction happened; relative dates resolve against it. */
  interactionDate: string
  record?: ExtractionRecord
}

export interface ExtractionResult {
  interactionType: InteractionType
  topics: readonly DiscussionTopic[]
  items: readonly ExtractedItem[]
}

/* ---------------------------------------------------------------- lexicon */

const MONTHS: readonly { names: readonly string[]; month: number }[] = [
  { names: ['januari', 'january', 'jan'], month: 1 },
  { names: ['februari', 'february', 'feb'], month: 2 },
  { names: ['mars', 'march', 'mar'], month: 3 },
  { names: ['april', 'apr'], month: 4 },
  { names: ['maj', 'may'], month: 5 },
  { names: ['juni', 'june', 'jun'], month: 6 },
  { names: ['juli', 'july', 'jul'], month: 7 },
  { names: ['augusti', 'august', 'aug'], month: 8 },
  { names: ['september', 'sep', 'sept'], month: 9 },
  { names: ['oktober', 'october', 'okt', 'oct'], month: 10 },
  { names: ['november', 'nov'], month: 11 },
  { names: ['december', 'dec'], month: 12 },
]

const WEEKDAYS: readonly { names: readonly string[]; day: number }[] = [
  { names: ['måndag', 'monday'], day: 1 },
  { names: ['tisdag', 'tuesday'], day: 2 },
  { names: ['onsdag', 'wednesday'], day: 3 },
  { names: ['torsdag', 'thursday'], day: 4 },
  { names: ['fredag', 'friday'], day: 5 },
  { names: ['lördag', 'saturday'], day: 6 },
  { names: ['söndag', 'sunday'], day: 7 },
]

/*
 * Word starts, not word boundaries.
 *
 * `\b` in a JavaScript regex is ASCII-only: it sees a boundary on either
 * side of "å", "ä" and "ö", so `\blån\b` never matched "bolånet" and
 * `\benergi\b` never matched "energiallokeringen". Swedish inflects and
 * compounds; the lexicon therefore matches a stem at the start of a word
 * (nothing letter-like before it, `\p{L}` under the `u` flag) and lets the
 * word continue. A stem that must not continue says so with `(?!\p{L})`.
 * A stem allowed inside a compound ("energiallokering") is listed bare.
 */
const NOT_LETTER_BEFORE = '(?<!\\p{L})'
const END = '(?!\\p{L})'

/** A pattern that matches any of the stems at the start of a word. */
function lexicon(...stems: readonly string[]): RegExp {
  return new RegExp(`${NOT_LETTER_BEFORE}(?:${stems.join('|')})`, 'iu')
}

/** A pattern from raw fragments, for stems that may sit inside a compound. */
function fragments(...parts: readonly string[]): RegExp {
  return new RegExp(parts.join('|'), 'iu')
}

const INTERACTION_LEXICON: readonly { type: InteractionType; pattern: RegExp }[] = [
  {
    type: 'meeting',
    pattern: lexicon(
      'möte',
      'träffa',
      'sågs',
      'lunch',
      'met (the )?client',
      'meeting',
      'sat down',
    ),
  },
  {
    type: 'phone',
    pattern: lexicon(
      'ringde',
      'ringa',
      'samtal',
      'telefon',
      'phone',
      'called',
      `call${END}`,
    ),
  },
  { type: 'teams', pattern: lexicon('teams', 'videomöte', 'video call', 'zoom') },
  { type: 'email', pattern: lexicon('mail', 'mejl', 'e-post', 'email', 'skrev till') },
  {
    type: 'financing-discussion',
    pattern: lexicon(
      'bolån',
      'lån(?!g)',
      'finansiering',
      'kredit',
      'mortgage',
      'loan',
      'financing',
      'credit',
    ),
  },
  {
    type: 'portfolio-discussion',
    pattern: fragments(
      'allokering',
      `${NOT_LETTER_BEFORE}(?:portfölj|innehav|portfolio|allocation|holdings)`,
    ),
  },
]

const TOPIC_LEXICON: readonly { topic: DiscussionTopic; pattern: RegExp }[] = [
  {
    topic: 'portfolio-performance',
    pattern: lexicon(
      'utveckling',
      'avkastning',
      'resultat',
      'performance',
      `returns?${END}`,
    ),
  },
  {
    topic: 'allocation',
    pattern: fragments(
      'allokering',
      `${NOT_LETTER_BEFORE}(?:fördelning|vikt(?!ig)|allocation|weight)`,
    ),
  },
  {
    topic: 'energy-exposure',
    pattern: lexicon('energi', 'energy', 'olj[ae]', `oil${END}`),
  },
  {
    topic: 'financing',
    pattern: lexicon(
      'bolån',
      'lån(?!g)',
      'finansier',
      'refinansier',
      'omsätt',
      'kredit',
      'mortgage',
      'loan',
      'financ',
      'refinanc',
    ),
  },
  {
    topic: 'investment-alternatives',
    pattern: lexicon(
      'alternativ',
      'jämförelse',
      'fond',
      `index${END}`,
      'alternative',
      'comparison',
      'fund(?!ament)',
    ),
  },
  { topic: 'fees', pattern: lexicon('avgift', 'kostnad', 'courtage', `fees?${END}`) },
  { topic: 'pension', pattern: lexicon('pension', 'retire') },
  {
    topic: 'property',
    /* "fastighet" may sit inside a compound: "Uppsalafastigheten", "hyresfastighet". */
    pattern: fragments(
      'fastighet',
      `${NOT_LETTER_BEFORE}(?:bostad|hus(?!h)|lägenhet|sommarstuga|fjällstuga|villa|property|house|apartment)`,
    ),
  },
  {
    topic: 'liquidity',
    pattern: lexicon('likvid', 'kassa', 'kontant', 'liquidity', 'cash'),
  },
  { topic: 'risk', pattern: lexicon('risk', 'volatil', 'drawdown', 'nedgång') },
  {
    topic: 'market-volatility',
    pattern: lexicon('marknad', 'börs', 'volatilitet', 'market', 'volatility'),
  },
  {
    topic: 'family',
    pattern: lexicon(
      'barn',
      'dotter',
      `son${END}`,
      'sonen',
      `fru${END}`,
      'hustru',
      `make${END}`,
      `maka${END}`,
      'familj',
      'children',
      'daughter',
      'wife',
      'husband',
      'family',
    ),
  },
  {
    topic: 'company',
    pattern: lexicon('bolag', 'företag', 'firma', 'company', 'business'),
  },
  { topic: 'tax', pattern: lexicon('skatt', 'deklaration', 'tax(?!i)') },
  { topic: 'insurance', pattern: lexicon('försäkring', 'insurance') },
  {
    topic: 'succession',
    pattern: lexicon(
      'generationsskifte',
      `arv${END}`,
      'arvet',
      'arvskifte',
      'testamente',
      'succession',
      'inheritance',
      'estate',
    ),
  },
]

const COMMITMENT_PATTERN = lexicon(
  'lovade',
  'lovar',
  'lovat',
  'jag ska',
  'vi ska',
  'återkomm',
  'skicka',
  'tar? fram',
  'förbered',
  'kollar',
  'fixar',
  'ordnar',
  'promised',
  'promise',
  'will send',
  'will return',
  'return with',
  'will prepare',
  'prepare',
  'send over',
)
/**
 * A promise kept, in the past tense: the note says the thing was gone
 * through, sent, delivered, presented. "Ska skicka" and "går igenom" are
 * not kept promises; "skickade" and "gick igenom" are.
 */
const COMPLETION_PATTERN = lexicon(
  'gick igenom',
  'gått igenom',
  'gick vi igenom',
  'skickade',
  'har skickat',
  'skickat över',
  'levererade',
  'har levererat',
  'presenterade',
  'visade',
  'lämnade över',
  'överlämnade',
  'genomförde',
  'är (?:nu )?klar',
  'är (?:nu )?klart',
  'blev klar',
  'är löst',
  'löste',
  'went through',
  'walked (?:him|her|them) through',
  'delivered',
  `sent${END}`,
  'presented',
  'handed over',
  'is (?:now )?done',
  'completed',
)
/**
 * A concern that has eased: calmer, no longer worried, reassured. Checked
 * before the concern lexicon, because "inte längre orolig" contains "orolig".
 */
const EASED_PATTERN = lexicon(
  'lugnare',
  'inte längre orolig',
  'inte orolig längre',
  'mindre orolig',
  'inte lika orolig',
  'känner sig trygg',
  'tryggare',
  'oron har (?:lagt sig|minskat|släppt)',
  'släppt oron',
  'är nöjd',
  'nöjd nu',
  'calmer',
  'less worried',
  'no longer worried',
  'not worried any ?more',
  'reassured',
  'at ease',
  'comfortable now',
)
const CONCERN_PATTERN = lexicon(
  'orolig',
  'oroad',
  `oro${END}`,
  'oron',
  'bekymr',
  'nervös',
  'missnöjd',
  'tveksam',
  'stressad',
  'irriterad',
  'besviken',
  'frustrerad',
  'skeptisk',
  `rädd${END}`,
  'ängslig',
  'osäker',
  'upprörd',
  'concern',
  'worri',
  'worry',
  'nervous',
  'uneasy',
  'unhappy',
  'upset',
  'frustrated',
  'disappointed',
  'anxious',
)
const PREFERENCE_PATTERN = lexicon(
  'föredrar',
  'vill inte',
  'vill helst',
  'hellre',
  'undvik',
  'prefer',
  'does not want',
  "doesn't want",
  `rather${END}`,
  'avoid',
)
const OBJECTIVE_PATTERN = lexicon(
  'planerar',
  'målet',
  `mål${END}`,
  'vill ha',
  'vill kunna',
  'siktar',
  'ambition',
  'plans? to',
  'wants? to',
  'aims? to',
  'goal',
)
const FAMILY_PATTERN = lexicon(
  'dotter',
  'sonen',
  `son${END}`,
  'barnen',
  `barn${END}`,
  `fru${END}`,
  'hustru',
  `make${END}`,
  `maka${END}`,
  'sambo',
  'familj',
  'daughter',
  'children',
  'wife',
  'husband',
  'partner',
  'family',
)
const BUSINESS_PATTERN = lexicon(
  'bolag',
  'företag',
  'firma',
  'verksamhet',
  'company',
  'business',
  `firm${END}`,
)
const NEXT_MEETING_PATTERN = lexicon(
  'nästa (?:möte|kvartalsmöte|genomgång|träff|avstämning|halvårsgenomgång)',
  'nytt möte',
  'ny (?:träff|genomgång|avstämning)',
  'möte(t)? (är )?(in)?bokat',
  'boka\\p{L}*',
  'träffas',
  'ses igen',
  'kvartalsmöte',
  'next meeting',
  'meeting (is )?booked',
  'booked a meeting',
  'scheduled',
)

/**
 * A sentence that opens with the advisor's own promise verb is a promise
 * before it is anything else — "Lovade skicka jämförelsen och boka ny
 * genomgång i december" is a commitment, not a booked meeting.
 */
const PROMISE_OPENING =
  /^(jag |vi )?(lovade|lovat|lovar|ska|återkom\p{L}*|skicka\p{L}*|tar? fram|förbered\p{L}*|kollar|fixar|ordnar|promised|will|send|prepare|i'll)\b/iu

const EVENT_LEXICON: readonly { type: EventType; pattern: RegExp }[] = [
  {
    type: 'mortgage-refinancing',
    pattern: fragments(
      `${NOT_LETTER_BEFORE}(?:bolån|lånet|räntan|bindningstid).*${NOT_LETTER_BEFORE}(?:omsätt|refinansier|förfaller|löper ut|villkorsändr|lägg\\p{L}* om|lagt om|bind\\p{L}* om)`,
      `${NOT_LETTER_BEFORE}(?:omsätt|refinansier|lägg\\p{L}* om).*${NOT_LETTER_BEFORE}(?:bolån|lån(?!g))`,
      `${NOT_LETTER_BEFORE}refinanc`,
    ),
  },
  {
    type: 'loan-maturity',
    /* Compounds included: "brygglånet förfaller", "byggkrediten löper ut". */
    pattern: fragments(
      `\\p{L}*(?:lån(?!g)|kredit)\\p{L}*.*${NOT_LETTER_BEFORE}(?:förfaller|löper ut|matur)`,
      `${NOT_LETTER_BEFORE}loan.*${NOT_LETTER_BEFORE}matur`,
    ),
  },
  {
    type: 'liquidity-event',
    pattern: fragments(
      `${NOT_LETTER_BEFORE}(?:option|program|bonus|utdelning|tilläggsköpeskilling|earn-?out).*${NOT_LETTER_BEFORE}(?:löser ut|löses ut|faller ut|betalas ut|utbetal|vest)`,
      `${NOT_LETTER_BEFORE}(?:likviditetshändelse|liquidity event)`,
    ),
  },
  {
    type: 'company-sale',
    pattern: lexicon(
      'sälj\\p{L}* bolaget',
      'försäljning\\p{L}* av bolaget',
      'bolagsförsäljning',
      `exit${END}`,
      'sell\\p{L}* the company',
      'company sale',
    ),
  },
  {
    type: 'property-completion',
    pattern: lexicon('tillträde', 'tillträder', 'completion', 'completes on'),
  },
  {
    type: 'property-purchase',
    pattern: lexicon(
      'köp\\p{L}* (?:hus|lägenhet|fastighet|bostad|sommarstuga)',
      'property purchase',
      'buy\\p{L}* (?:a )?(?:house|apartment|property)',
    ),
  },
  {
    type: 'pension-event',
    pattern: lexicon('går i pension', 'pensioner', `retires?${END}`, 'retirement date'),
  },
  {
    type: 'planned-withdrawal',
    pattern: lexicon('uttag', 'ta ut', 'kapitalanrop', 'capital call', 'withdraw'),
  },
  {
    type: 'tax-deadline',
    pattern: lexicon(
      'deklaration',
      'skatt\\p{L}* (?:ska|skall) betalas',
      'tax (?:return|deadline|payment)',
    ),
  },
  {
    /*
     * A family member's day, named by its subject: "Sagas 10-årsdag",
     * "Dottern tar studenten". Listed before the client's own birthday so a
     * child's birthday never becomes the client's.
     */
    type: 'family-event',
    pattern: fragments(
      `^(?:\\p{L}+s|dottern|sonen|barnen|frun|hustrun|maken|makan|sambon|barnbarnen?)\\b.*${NOT_LETTER_BEFORE}(?:\\d+-årsdag|årsdag|födelsedag|bröllop|student|examen|dop${END}|konfirmation)`,
    ),
  },
  {
    type: 'birthday',
    pattern: lexicon(
      'fyller (?:\\d+ )?år',
      'fyller \\d+',
      'födelsedag',
      'birthday',
      'turns \\d+',
    ),
  },
  {
    type: 'annual-review',
    pattern: lexicon('årsgenomgång', 'årlig genomgång', 'annual review'),
  },
  {
    type: 'investment-maturity',
    pattern: fragments(
      `${NOT_LETTER_BEFORE}(?:obligation|placering|deposit).*${NOT_LETTER_BEFORE}(?:förfaller|löper ut|matur)`,
    ),
  },
]

/* ------------------------------------------------------------------ dates */

/**
 * A date read from a sentence. `precision` says how much of it the words
 * actually carried: "15 nov" names a day; "v.43" a week; "i mars" a month.
 * A week or a month is resolved to its first day so the record has a date,
 * and the item that carries it is proposed with low confidence, so the
 * advisor confirms or corrects the day rather than inheriting one JARVIS
 * invented.
 */
export interface DateHit {
  date: string
  text: string
  precision: 'day' | 'week' | 'month'
}

/** Monday of ISO week `week` in `year`: 4 January is always in week 1. */
function isoWeekMonday(year: number, week: number): string {
  const january4 = `${year}-01-04`
  const mondayOfWeek1 = addDays(january4, 1 - isoWeekday(january4))
  return addDays(mondayOfWeek1, (week - 1) * 7)
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** The year a month/day belongs to, given the interaction date: this year unless already passed. */
function resolveYear(
  month: number,
  day: number,
  interactionDate: string,
  explicitYear: number | null,
): string {
  const year = Number(interactionDate.slice(0, 4))
  if (explicitYear !== null) return `${explicitYear}-${pad(month)}-${pad(day)}`
  const candidate = `${year}-${pad(month)}-${pad(day)}`
  return candidate < interactionDate ? `${year + 1}-${pad(month)}-${pad(day)}` : candidate
}

/** Every explicit or relative date in a sentence, in order of appearance. */
export function datesIn(sentence: string, interactionDate: string): readonly DateHit[] {
  const hits: DateHit[] = []
  const lower = sentence.toLowerCase()

  /* "14 november", "14 november 2026", "den 3 dec", "November 14", "Nov 14th" */
  const monthNames = MONTHS.flatMap((m) => m.names).join('|')
  const dayMonth = new RegExp(
    `\\b(\\d{1,2})(?::a|:e)?\\s+(${monthNames})\\b(?:\\s+(\\d{4}))?`,
    'g',
  )
  /** The character spans already claimed by a day-level hit, so a month-only reading cannot double them. */
  const claimed: [number, number][] = []
  const day = (date: string, m: RegExpMatchArray) => {
    claimed.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
    hits.push({ date, text: m[0], precision: 'day' })
  }
  for (const m of lower.matchAll(dayMonth)) {
    const month = MONTHS.find((entry) => entry.names.includes(m[2]!))!.month
    day(resolveYear(month, Number(m[1]), interactionDate, m[3] ? Number(m[3]) : null), m)
  }
  const monthDay = new RegExp(
    `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`,
    'g',
  )
  for (const m of lower.matchAll(monthDay)) {
    const month = MONTHS.find((entry) => entry.names.includes(m[1]!))!.month
    day(resolveYear(month, Number(m[2]), interactionDate, m[3] ? Number(m[3]) : null), m)
  }
  /* ISO dates and "14/11" */
  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    day(`${m[1]}-${m[2]}-${m[3]}`, m)
  for (const m of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    day(resolveYear(Number(m[2]), Number(m[1]), interactionDate, null), m)
  }
  /* "på fredag", "on Friday", "nästa fredag", "next Friday" → the next such weekday after the interaction */
  const weekdayNames = WEEKDAYS.flatMap((w) => w.names).join('|')
  for (const m of lower.matchAll(
    new RegExp(`\\b(på|on|nästa|next|i|this)?\\s?(${weekdayNames})(en)?\\b`, 'g'),
  )) {
    const target = WEEKDAYS.find((w) => w.names.includes(m[2]!))!.day
    const current = isoWeekday(interactionDate)
    let ahead = target - current
    if (ahead <= 0) ahead += 7
    if (/nästa|next/.test(m[1] ?? '') && ahead < 7) ahead += 7
    hits.push({
      date: addDays(interactionDate, ahead),
      text: m[0].trim(),
      precision: 'day',
    })
  }
  /* "i morgon", "tomorrow", "om två veckor", "inom 3 dagar", "in 3 days" */
  if (/\b(i ?morgon|tomorrow)\b/.test(lower))
    hits.push({ date: addDays(interactionDate, 1), text: 'i morgon', precision: 'day' })
  /* "nästa vecka", "nästa månad": a period, not a day — resolved to its start, low precision. */
  if (/\bnästa vecka\b|\bnext week\b/.test(lower)) {
    const monday = addDays(interactionDate, 8 - isoWeekday(interactionDate))
    hits.push({ date: monday, text: 'nästa vecka', precision: 'week' })
  }
  if (/\bnästa månad\b|\bnext month\b/.test(lower)) {
    const year = Number(interactionDate.slice(0, 4))
    const month = Number(interactionDate.slice(5, 7))
    const first = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`
    hits.push({ date: first, text: 'nästa månad', precision: 'month' })
  }
  /* "v.43", "v 43", "vecka 43" → the Monday of that ISO week, this year or next. */
  for (const m of lower.matchAll(/\b(?:v\.?\s?|vecka\s+|week\s+)(\d{1,2})\b/g)) {
    const week = Number(m[1])
    if (week < 1 || week > 53) continue
    const year = Number(interactionDate.slice(0, 4))
    const candidate = isoWeekMonday(year, week)
    hits.push({
      date: candidate < interactionDate ? isoWeekMonday(year + 1, week) : candidate,
      text: m[0],
      precision: 'week',
    })
  }
  /* "i mars", "till hösten" is not a date; "in March" is a month → its first day, low precision. */
  for (const m of lower.matchAll(
    new RegExp(`\\b(?:i|in|till|until|by|during)\\s+(${monthNames})\\b`, 'g'),
  )) {
    const start = m.index ?? 0
    if (claimed.some(([from, to]) => start < to && start + m[0].length > from)) continue
    const month = MONTHS.find((entry) => entry.names.includes(m[1]!))!.month
    hits.push({
      date: resolveYear(month, 1, interactionDate, null),
      text: m[0],
      precision: 'month',
    })
  }
  const NUMBER_WORDS: Record<string, number> = {
    en: 1,
    ett: 1,
    två: 2,
    tre: 3,
    fyra: 4,
    fem: 5,
    sex: 6,
    sju: 7,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
  }
  for (const m of lower.matchAll(
    /\b(om|inom|in|within)\s+(\d+|en|ett|två|tre|fyra|fem|sex|sju|one|two|three|four|five|six)\s+(dag(ar)?|veck(a|or)|månad(er)?|days?|weeks?|months?)\b/g,
  )) {
    const count = Number(m[2]) || NUMBER_WORDS[m[2]!] || 0
    const unit = m[3]!
    const days = /dag|day/.test(unit)
      ? count
      : /veck|week/.test(unit)
        ? count * 7
        : count * 30
    hits.push({ date: addDays(interactionDate, days), text: m[0], precision: 'day' })
  }
  return hits
}

/* -------------------------------------------------------------- sentences */

/**
 * Sentences, split at a full stop that ends one — not at the full stop of
 * "ev.", "ca.", "kl." or "t.ex.", which an advisor types mid-sentence.
 */
function sentencesOf(text: string): readonly string[] {
  return text
    .split(
      /(?<=[.!?])(?<!\b(?:ev|ca|kl|t\.ex|bl\.a|dvs|osv|ang|pga|m\.m|st|nr|tel|resp|ev\.t)\.)\s+|\n+/iu,
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

/** The promise as a task: the sentence with its leading "I promised to" and its date removed. */
function commitmentTitle(sentence: string, dates: readonly DateHit[]): string {
  let title = sentence
    .replace(/^(jag |vi )?(lovade|lovat|lovar|ska|kommer att|har lovat)( att)?\s+/i, '')
    .replace(/^(i |we )?(promised|promise|will|have promised|i'll)( to)?\s+/i, '')
    .replace(/[.!?]+$/, '')
  for (const hit of dates) {
    title = title.replace(
      new RegExp(
        `\\s*(senast|till|före|innan|by|before|on|på)?\\s*${hit.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      ),
      '',
    )
  }
  title = title
    .replace(/^(att|to)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return capitalise(title)
}

function eventTitle(sentence: string): string {
  return capitalise(sentence.replace(/[.!?]+$/, '').trim())
}

/* ------------------------------------------------------ record matching */

/**
 * Words that say nothing about which promise or concern a sentence means:
 * the people, the verbs of delivery, and the words of worry themselves —
 * "orolig" is in every concern and names none of them.
 */
const NOISE = new Set([
  'kunden',
  'klienten',
  'henne',
  'honom',
  'igenom',
  'gick',
  'gått',
  'skickade',
  'skickat',
  'lovade',
  'lovat',
  'också',
  'även',
  'sedan',
  'efter',
  'innan',
  'längre',
  'mötet',
  'möte',
  'samtalet',
  'under',
  'orolig',
  'oroad',
  'bekymrad',
  'nervös',
  'missnöjd',
  'tveksam',
  'stressad',
  'besviken',
  'frustrerad',
  'skeptisk',
  'osäker',
  'upprörd',
  'with',
  'through',
  'client',
  'about',
  'their',
  'which',
  'worried',
  'concerned',
  'nervous',
  'unhappy',
])

/** A Swedish word reduced to a stem a compound or an inflection still starts with. */
function stemOf(word: string): string {
  let stem = word
  for (const suffix of ['erna', 'arna', 'orna', 'ernas', 'arnas', 'en', 'et', 'ar', 'er', 'or', 'na', 's', 't']) {
    if (stem.length - suffix.length >= 5 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length)
      break
    }
  }
  return stem
}

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}{5,}/gu) ?? []).filter((w) => !NOISE.has(w))
}

/** True when a word of the sentence starts with a stem of the record's words, or the other way round. */
function sharesStem(sentence: string, recordText: string): boolean {
  const stems = contentWords(recordText).map(stemOf).filter((s) => s.length >= 5)
  const words = contentWords(sentence)
  return stems.some((stem) => words.some((w) => w.startsWith(stem) || stem.startsWith(stemOf(w))))
}

/* -------------------------------------------------------------- extraction */

export function extractFromNote(input: ExtractionInput): ExtractionResult {
  const sentences = sentencesOf(input.text)
  const lower = input.text.toLowerCase()
  const items: ExtractedItem[] = []
  let counter = 0
  const next = (
    kind: ExtractedItem['kind'],
    rest: Omit<ExtractedItem, 'id' | 'kind'>,
  ): ExtractedItem => ({ id: `item-${++counter}`, kind, ...rest })

  const interactionType: InteractionType =
    INTERACTION_LEXICON.find((entry) => entry.pattern.test(lower))?.type ??
    'internal-note'
  const topics: DiscussionTopic[] = TOPIC_LEXICON.filter((entry) =>
    entry.pattern.test(lower),
  ).map((entry) => entry.topic)

  items.push(
    next('interaction', {
      title: sentences[0]?.slice(0, 120) ?? input.text.slice(0, 120),
      sourceText: sentences[0] ?? input.text,
      confidence: interactionType === 'internal-note' ? 'low' : 'high',
      date: input.interactionDate,
      interactionType,
      topics,
    }),
  )

  const keyPointCandidates: string[] = []
  const record = input.record ?? { openCommitments: [], activeConcerns: [] }
  const completedIds = new Set<string>()
  const easedIds = new Set<string>()
  for (const sentence of sentences) {
    const dates = datesIn(sentence, input.interactionDate)
    const first = dates[0] ?? null
    const firstDate = first?.date ?? null
    /* A day is a fact; a week or a month is a reading the advisor must confirm. */
    const dateConfidence: Confidence =
      first === null ? 'medium' : first.precision === 'day' ? 'high' : 'low'
    let classified = false

    /*
     * The record moves before anything is added to it. A past-tense delivery
     * that names an open promise closes it; a sentence that says the client
     * is calmer eases an active concern — the one the sentence speaks of, or
     * the only one there is. Each is proposed once, at medium confidence,
     * for the advisor to confirm; never on a sentence that is itself a promise.
     */
    const promiseSentence =
      PROMISE_OPENING.test(sentence) ||
      (COMMITMENT_PATTERN.test(sentence) && /\b(jag|vi|i|we)\b/i.test(sentence))
    if (!promiseSentence && COMPLETION_PATTERN.test(sentence)) {
      for (const commitment of record.openCommitments) {
        if (completedIds.has(commitment.id) || !sharesStem(sentence, commitment.title)) continue
        completedIds.add(commitment.id)
        items.push(
          next('commitment-completed', {
            title: commitment.title,
            sourceText: sentence,
            confidence: 'medium',
            date: input.interactionDate,
            commitmentId: commitment.id,
          }),
        )
        classified = true
      }
    }
    if (EASED_PATTERN.test(sentence)) {
      const candidates = record.activeConcerns.filter((c) => !easedIds.has(c.id))
      const named = candidates.filter((c) => sharesStem(sentence, c.statement))
      const eased = named[0] ?? (candidates.length === 1 ? candidates[0] : undefined)
      if (eased) {
        easedIds.add(eased.id)
        items.push(
          next('concern-eased', {
            title: eased.statement,
            sourceText: sentence,
            confidence: named[0] ? 'medium' : 'low',
            date: input.interactionDate,
            contextFactId: eased.id,
          }),
        )
      }
      classified = true
    }

    /*
     * A promise first. "Lovade skicka jämförelsen och boka ny genomgång i
     * december" mentions a booking, but the sentence is the advisor's
     * promise; only a sentence that is not one is read as a booked meeting.
     */
    const opensWithPromise = PROMISE_OPENING.test(sentence)
    const isAdvisorPromise =
      COMMITMENT_PATTERN.test(sentence) &&
      (opensWithPromise || /\b(jag|vi|i|we)\b/i.test(sentence))

    if (!opensWithPromise && NEXT_MEETING_PATTERN.test(sentence) && firstDate) {
      items.push(
        next('next-meeting', {
          title: eventTitle(sentence),
          sourceText: sentence,
          confidence: dateConfidence,
          date: firstDate,
          eventType: 'client-meeting',
        }),
      )
      classified = true
    }
    if (!classified) {
      const event = EVENT_LEXICON.find((entry) => entry.pattern.test(sentence))
      if (event && (firstDate || event.type === 'birthday')) {
        items.push(
          next('important-event', {
            title: eventTitle(sentence),
            sourceText: sentence,
            confidence: firstDate ? dateConfidence : 'medium',
            date: firstDate,
            eventType: event.type,
          }),
        )
        classified = true
      }
    }
    if (isAdvisorPromise && (opensWithPromise || !NEXT_MEETING_PATTERN.test(sentence))) {
      items.push(
        next('commitment', {
          title: commitmentTitle(sentence, dates),
          sourceText: sentence,
          confidence: firstDate ? dateConfidence : 'medium',
          date: firstDate,
          priority: firstDate ? 'high' : 'medium',
        }),
      )
      classified = true
    }
    if (CONCERN_PATTERN.test(sentence) && !EASED_PATTERN.test(sentence)) {
      items.push(
        next('concern', {
          title: eventTitle(sentence),
          sourceText: sentence,
          confidence: 'high',
          date: null,
          contextCategory: 'concern',
        }),
      )
      classified = true
    } else if (PREFERENCE_PATTERN.test(sentence)) {
      items.push(
        next('preference', {
          title: eventTitle(sentence),
          sourceText: sentence,
          confidence: 'medium',
          date: null,
          contextCategory: 'preference',
        }),
      )
      classified = true
    } else if (OBJECTIVE_PATTERN.test(sentence) && !classified) {
      items.push(
        next('objective', {
          title: eventTitle(sentence),
          sourceText: sentence,
          confidence: 'medium',
          date: null,
          contextCategory: 'objective',
        }),
      )
      classified = true
    }
    if (
      !classified &&
      FAMILY_PATTERN.test(sentence) &&
      !COMMITMENT_PATTERN.test(sentence)
    ) {
      items.push(
        next('family', {
          title: eventTitle(sentence),
          sourceText: sentence,
          confidence: 'low',
          date: null,
          contextCategory: 'family',
        }),
      )
      classified = true
    } else if (!classified && BUSINESS_PATTERN.test(sentence)) {
      items.push(
        next('business', {
          title: eventTitle(sentence),
          sourceText: sentence,
          confidence: 'low',
          date: null,
          contextCategory: 'business',
        }),
      )
      classified = true
    }
    if (!classified && sentence !== sentences[0] && sentence.split(' ').length >= 4)
      keyPointCandidates.push(sentence)
  }

  for (const sentence of keyPointCandidates.slice(0, 4)) {
    items.push(
      next('key-point', {
        title: eventTitle(sentence),
        sourceText: sentence,
        confidence: 'medium',
        date: null,
      }),
    )
  }
  if (topics.length > 0) {
    items.push(
      next('discussion-topics', {
        title: topics.join(', '),
        sourceText: input.text.slice(0, 160),
        confidence: 'medium',
        date: null,
        topics,
      }),
    )
  }

  return { interactionType, topics, items }
}

export type { Confidence, ContextCategory }
