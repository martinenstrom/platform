/**
 * A researched answer in Swedish, twice: the text the presence shows and
 * the spoken form. Advisor-quality, never a list of links: the platform's
 * own numbers first where the question is about a move, then the claims
 * the evidence carries in authority order, a named disagreement where the
 * sources differ, and an honest sentence where support is weak or the web
 * could not be reached. The sources themselves travel on the card.
 */

import type { ClaimFigure } from '~/application/jarvis/research/evidence'
import type { ResearchAnswer } from '~/application/jarvis/research/researchAnswer'
import { marketAnswerSpeech } from './marketAnswerText'

export const RESEARCH_UNAVAILABLE =
  'Jag kan läsa den interna marknadsdatan, men extern research är inte tillgänglig just nu.'
export const RESEARCH_UNAVAILABLE_NO_DATA =
  'Extern research är inte tillgänglig just nu, och den interna marknadsdatan täcker inte frågan.'
export const NO_CATALYST =
  'Jag ser rörelsen, men hittar ingen tydligt verifierad katalysator ännu.'
export const NO_SUPPORT = 'Jag hittar inget verifierat underlag om det just nu.'

const SPOKEN_CLAIMS = { quick: 2, deep: 3 } as const

/** Swedish, by its letters or its small words; the provider's cited sentences are, a publisher's snippet usually is not. */
export function looksSwedish(text: string): boolean {
  return (
    /[åäö]/i.test(text) ||
    /(?<![\p{L}])(?:och|är|att|som|för|med|inte|den|det|efter|vilket)(?![\p{L}])/iu.test(
      text,
    )
  )
}

const unitWord = (unit: ClaimFigure['unit']): string =>
  unit === 'percent' ? 'procent' : unit === 'bp' ? 'baspunkter' : ''

const svNumber = (value: number): string =>
  new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(value)

/** "Källorna skiljer sig något; den officiella publiceringen (BLS) anger 3,4 procent." */
export function conflictSentences(answer: ResearchAnswer): string[] {
  return answer.result.conflicts.map((conflict) => {
    const preferred = answer.result.evidence.find(
      (item) => item.id === conflict.preferredEvidenceId,
    )
    const value = conflict.values.find(
      (entry) => entry.evidenceId === conflict.preferredEvidenceId,
    )
    const who =
      preferred?.sourceType === 'official'
        ? `den officiella publiceringen (${preferred.publisher})`
        : preferred
          ? `den mest tillförlitliga källan (${preferred.publisher})`
          : 'den mest tillförlitliga källan'
    return value
      ? `Källorna skiljer sig något; ${who} anger ${svNumber(value.value)} ${unitWord(value.unit)}.`.replace(
          /\s+\./,
          '.',
        )
      : `Källorna skiljer sig något; ${who} väger tyngst.`
  })
}

const factsOf = (answer: ResearchAnswer): string | null =>
  answer.marketFacts &&
  (answer.marketFacts.items.length > 0 || answer.marketFacts.rates.length > 0)
    ? marketAnswerSpeech(answer.marketFacts)
    : null

const dateShort = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('sv-SE', {
        timeZone: 'Europe/Stockholm',
        day: 'numeric',
        month: 'short',
      })
}

/** A sentence from an official or issuer source carries who said it and when: "Federal Reserve (16 sep.): …". */
const stamped = (
  answer: ResearchAnswer,
  entry: ResearchAnswer['support'][number],
): string => {
  const text = entry.claim.text.trim()
  const sentence = /[.!?…]$/.test(text) ? text : `${text}.`
  const source = answer.result.evidence.find((item) => item.id === entry.evidenceId)
  if (!source || source.authority > 2) return sentence
  const when = source.publishedAt ? dateShort(source.publishedAt) : ''
  return `${source.publisher}${when ? ` (${when})` : ''}: ${sentence}`
}

/**
 * The claims to state. Spoken, only sentences in the advisor's language
 * unless there are none; on screen, Swedish first and then the official
 * sentence in its own language, stamped with its source.
 */
const claimTexts = (
  answer: ResearchAnswer,
  limit: number,
  mode: 'text' | 'speech',
): string[] => {
  const entries = answer.support
  const swedish = entries.filter((entry) => looksSwedish(entry.claim.text))
  const other = entries.filter((entry) => !looksSwedish(entry.claim.text))
  const ordered =
    mode === 'speech' && swedish.length > 0 ? swedish : [...swedish, ...other]
  return ordered.slice(0, limit).map((entry) => stamped(answer, entry))
}

const weakSentence = (answer: ResearchAnswer): string | null => {
  if (answer.unavailable || answer.support.length > 0) return null
  const aboutAMove =
    answer.query.kind === 'MARKET_WHY' ||
    answer.query.kind === 'MARKET_DRIVERS' ||
    answer.query.kind === 'PRE_MARKET'
  return aboutAMove && factsOf(answer) ? NO_CATALYST : NO_SUPPORT
}

const unavailableSentence = (answer: ResearchAnswer): string | null =>
  !answer.unavailable
    ? null
    : factsOf(answer)
      ? RESEARCH_UNAVAILABLE
      : RESEARCH_UNAVAILABLE_NO_DATA

/** The private layer owns the client: the answer says so and points at the door, naming nothing of the record. */
const clientSentence = (answer: ResearchAnswer): string | null =>
  answer.clientReference
    ? `Vad det betyder för ${answer.clientReference.displayName} läser jag ur registret, inte från webben — öppna Marknadspåverkan för klienten.`
    : null

/** The full answer, as the presence shows it. The sources are on the card, not in the prose. */
export function researchAnswerText(answer: ResearchAnswer): string {
  const sentences: string[] = []
  const facts = factsOf(answer)
  if (facts) sentences.push(facts)
  const unavailable = unavailableSentence(answer)
  if (unavailable) sentences.push(unavailable)
  else {
    sentences.push(...claimTexts(answer, answer.support.length, 'text'))
    sentences.push(...conflictSentences(answer))
    const weak = weakSentence(answer)
    if (weak) sentences.push(weak)
  }
  const client = clientSentence(answer)
  if (client) sentences.push(client)
  return sentences.join(' ')
}

/** The spoken answer: the numbers, two or three claims, the disagreement if any, and how many sources stand behind it. */
export function researchAnswerSpeech(answer: ResearchAnswer): string {
  const sentences: string[] = []
  const facts = factsOf(answer)
  if (facts) sentences.push(facts)
  const unavailable = unavailableSentence(answer)
  if (unavailable) sentences.push(unavailable)
  else {
    sentences.push(...claimTexts(answer, SPOKEN_CLAIMS[answer.query.depth], 'speech'))
    sentences.push(...conflictSentences(answer).slice(0, 1))
    const weak = weakSentence(answer)
    if (weak) sentences.push(weak)
    const count = answer.result.evidence.filter((item) => item.claims.length > 0).length
    if (count > 0) {
      const lead = answer.result.evidence
        .filter((item) => item.claims.length > 0)
        .sort((a, b) => a.authority - b.authority)[0]!
      sentences.push(
        `Underlag: ${count === 1 ? 'en källa' : `${svNumber(count)} källor`}, främst ${lead.publisher}.`,
      )
    }
  }
  const client = clientSentence(answer)
  if (client) sentences.push(client)
  return sentences.join(' ')
}
