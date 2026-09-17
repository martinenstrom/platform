/**
 * The person speaks human; JARVIS translates into the firm's structure.
 *
 * Ruled 2026-09-17, after a conversation in which the person said, in five
 * different ways, that the committee could start on why gold was up — and
 * was asked five times for a thesis, a scope and a formal approval. The
 * firm had no door for the opening position (TD-88), so every confirmation
 * became an amendment and nothing began. The door now exists (`begin`, host
 * contract v4); what this module decides is what the person meant, from
 * their words alone, so that the door is walked through on their behalf:
 *
 *   - **kind**: a commission that asks WHY or WHAT DRIVES is an explanation
 *     the firm can start on at once; one that asks WHAT TO DO WITH CAPITAL
 *     is a position, and the firm needs the person's own view — or their
 *     word that it may be examined openly — which is the one question JARVIS
 *     may ask.
 *   - **focus**: what the person said the desks should weigh, in their own
 *     words, or the standing default when they said nothing.
 *   - **confirmation**: "kör", "de kan börja", "ja", "precis" count. The
 *     person is never made to repeat an intent in more formal language.
 *
 * Deterministic, like the market recogniser: words in, a decision out, no
 * model between them. Judgement about the market stays with the router;
 * this only reads the shape of an instruction.
 */

import type { CommissionKind, HostOpening } from '~/application/analysis/hostContract'

const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'
const words = (alternatives: readonly string[]) => new RegExp(`${B}(?:${alternatives.join('|')})${E}`, 'iu')

/** Capital judgement: the person is asking what to do, not what is happening. */
const POSITION_CUE = words([
  'borde',
  'bör',
  'ska (?:jag|vi)',
  'skall (?:jag|vi)',
  'köpa',
  'sälja',
  'minska',
  'öka',
  'dra ner',
  'positionera',
  'exponering(?:en)?',
  'allokering(?:en)?',
  'vikta',
  'övervikt(?:a)?',
  'undervikt(?:a)?',
  'attraktiv(?:t)?',
  'portfölj(?:en)?',
  'should (?:i|we)',
  'buy',
  'sell',
  'reduce',
  'increase',
])

/** The standing focus for an explanation nobody narrowed: what moves a price, in the firm's own three words. */
export const DEFAULT_FOCUS: readonly string[] = ['makro', 'flöden', 'specifika händelser']

/** What a person names when they say what the desks should look at, in canonical Swedish. */
const FOCUS_TERMS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'makro', pattern: words(['makro\\p{L}*', 'macro\\p{L}*']) },
  { label: 'flöden', pattern: words(['flöden', 'flödena', 'flödes\\p{L}*', 'flows?']) },
  { label: 'specifika händelser', pattern: words(['händelse\\p{L}*', 'events?', 'nyhet\\p{L}*']) },
  { label: 'värdering', pattern: words(['värdering\\p{L}*', 'valuations?']) },
  { label: 'räntor', pattern: words(['räntor(?:na)?', 'räntan', 'räntel\\p{L}*', 'rates', 'yields?']) },
  { label: 'dollarn', pattern: words(['dollarn', 'dollar', 'usd']) },
  { label: 'geopolitik', pattern: words(['geopolitik\\p{L}*', 'geopolitic\\p{L}*']) },
  { label: 'centralbanker', pattern: words(['centralbank\\p{L}*', 'fed', 'ecb', 'riksbanken', 'central banks?']) },
  { label: 'positionering', pattern: words(['positionering\\p{L}*', 'positioning']) },
  { label: 'teknisk bild', pattern: words(['teknisk\\p{L}*', 'technical\\p{L}*']) },
  { label: 'vinster', pattern: words(['vinst\\p{L}*', 'earnings']) },
]

/** A word of agreement, or an instruction to go ahead — one or several — and nothing else of substance. */
const CONFIRMATION_WORDS = [
    'ja(?:pp|visst)?',
    'jo',
    'okej',
    'ok',
    'absolut',
    'visst',
    'precis',
    'exakt',
    'bra',
    'kör(?: på)?(?: det)?',
    'kör igång',
    'sätt igång',
    'starta',
    'gå vidare',
    'de kan (?:börja|gå vidare|sätta igång|starta|köra)',
    'låt dem (?:börja|köra)',
    'gör det',
    'det är (?:precis )?vad jag menar',
    'det stämmer',
    'klartecken',
    'godkänt',
    'go ahead',
    'yes',
    'yep',
    'exactly',
    "that'?s what i mean",
    'they can start',
    'start',
    'do it',
]
const CONFIRMATION_FILLERS = ['tack', 'då', 'nu', 'gärna', 'please', 'so', 'bara', 'och']
const SEP = '[\\s,.!–—-]'
const CONFIRMATION = new RegExp(
  `^${SEP}*(?:${CONFIRMATION_WORDS.join('|')})(?:${SEP}+(?:${[...CONFIRMATION_WORDS, ...CONFIRMATION_FILLERS].join('|')}))*${SEP}*$`,
  'iu',
)

/**
 * Explanation or position, from the question's own words.
 *
 * "Varför är guld upp idag?" and "ta reda på vad som driver oljan" are
 * explanations however they are phrased; "borde jag minska USA?" is a
 * position however it is phrased. The cue decides, not the subject.
 */
export function commissionKind(question: string): CommissionKind {
  return POSITION_CUE.test(question) ? 'position' : 'explanation'
}

/** The focus the person named, in the order they named it; empty when they named none. */
export function focusFrom(text: string): string[] {
  const found: { label: string; at: number }[] = []
  for (const term of FOCUS_TERMS) {
    const match = term.pattern.exec(text)
    if (match && match.index !== undefined) found.push({ label: term.label, at: match.index })
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.label)
}

/** True for a line that agrees or says go ahead and adds nothing the firm needs to record. */
export function isConfirmation(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > 80) return false
  return CONFIRMATION.test(trimmed)
}

/** True when the line names a focus and nothing else — "Makro, flöden och specifika händelser." */
export function isFocusOnly(text: string): boolean {
  if (focusFrom(text).length === 0) return false
  let rest = text
  for (const term of FOCUS_TERMS) rest = rest.replace(new RegExp(term.pattern.source, 'giu'), ' ')
  rest = rest.replace(
    /(?<![\p{L}])(?:och|samt|plus|eller|även|också|and|på|i|med|fokus\p{L}*|framför allt|främst|gärna|tack|specifika|särskilda|enskilda|specific|any|de|det|den|viktigaste|viktiga)(?![\p{L}])/giu,
    ' ',
  )
  return rest.replace(/[^\p{L}\p{N}]+/gu, '').length <= 2
}

/** "Pröva den öppet", "utan egen syn", "helt förutsättningslöst": leave to examine without a view. */
const OPEN_EXAMINATION =
  /pröva(?:s)?(?: den| det| frågan| tesen)?(?: helt)? (?:öppet|oberoende|förutsättningslöst|neutralt)|(?:helt|prövas) öppet|utan (?:en )?(?:förutbestämd |egen )?(?:position|syn|åsikt|uppfattning)|ingen egen (?:syn|åsikt|uppfattning)|(?:examine|test|look at) it openly|without (?:a|my) view|open[- ]?minded/iu

export function isOpenExamination(text: string): boolean {
  return OPEN_EXAMINATION.test(text)
}

/**
 * The opening the person meant, from the firm's question and their words.
 *
 * The question decides the kind. An explanation opens on the question with
 * the focus the person named — in the answer, in the question, or the
 * standing default. A position opens on the person's view when their words
 * carry one, and openly when they only confirmed or only named a focus.
 */
export function openingFromWords(question: string, words: string | null, focus: readonly string[] = []): HostOpening {
  const said = words?.trim() ?? ''
  const named = focus.length > 0 ? [...focus] : focusFrom(said)
  if (commissionKind(question) === 'explanation') {
    const chosen = named.length > 0 ? named : focusFrom(question)
    return { kind: 'explanation', focus: chosen.length > 0 ? chosen : [...DEFAULT_FOCUS] }
  }
  const isView = said.length > 0 && !isConfirmation(said) && !isFocusOnly(said) && !isOpenExamination(said)
  return {
    kind: 'position',
    focus: named,
    view: isView ? { statement: said, position: positionFrom(said) } : null,
  }
}

/**
 * The person's view, as a position word the firm's record understands.
 *
 * Read off the verbs a person uses about capital; `open` when they gave no
 * direction — the firm then examines the question without a predetermined
 * position, which is what "pröva den öppet" and a bare "kör" both mean.
 */
export function positionFrom(text: string): string {
  const t = text.toLowerCase()
  if (/(?<![\p{L}])(?:sälj\p{L}*|avyttra|gå ur|sell)(?![\p{L}])/iu.test(t)) return 'sell'
  if (/(?<![\p{L}])(?:minska|dra ner|reducera|skala ner|reduce|underweight|undervikt\p{L}*|negativ\p{L}*|bearish|för dyr\p{L}*)(?![\p{L}])/iu.test(t)) return 'reduce'
  if (/(?<![\p{L}])(?:undvik\p{L}*|avoid|håll\p{L}* (?:mig|oss) borta)(?![\p{L}])/iu.test(t)) return 'avoid'
  if (/(?<![\p{L}])(?:köp\p{L}*|buy|gå in)(?![\p{L}])/iu.test(t)) return 'buy'
  if (/(?<![\p{L}])(?:öka|övervikt\p{L}*|accumulate|overweight|positiv\p{L}*|bullish|billig\p{L}*)(?![\p{L}])/iu.test(t)) return 'accumulate'
  if (/(?<![\p{L}])(?:behåll\p{L}*|hold|ligg\p{L}* kvar|kvar)(?![\p{L}])/iu.test(t)) return 'hold'
  return 'open'
}
