/**
 * What the voice says from the same answer the screen shows: numbers and
 * dates as a person says them, the figure that was asked for first, facts
 * before the assessment, one to four sentences, the rest offered rather
 * than read, no id and no section name — and the right words when a fact
 * is missing or a name is ambiguous.
 */

import { describe, expect, it } from 'vitest'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { answerAdvisoryLine } from '~/application/jarvis/advisoryAnswer'
import type { JarvisAnswer } from '~/application/jarvis/answer'
import { resolveJarvisContext } from '~/application/jarvis/context'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import {
  spokenAmount,
  spokenAnswerOf,
  spokenDate,
  spokenDays,
  spokenName,
} from './spokenAnswer'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

async function answerOn(
  route: string,
  text: string,
  previous: JarvisAnswer | null = null,
): Promise<JarvisAnswer> {
  const turn = await answerAdvisoryLine(
    contextAt(),
    resolveJarvisContext(route),
    text,
    previous,
  )
  if (!turn) throw new Error(`no answer for "${text}" on ${route}`)
  return turn.answer
}

const sentencesOf = (say: string) => say.split(/(?<=[.!?])\s+/).filter(Boolean)

describe('spoken formatting', () => {
  it('says amounts, dates, days and names as a person does', () => {
    expect(spokenAmount(42_000_000)).toBe('42 miljoner')
    expect(spokenAmount(22_500_000)).toBe('22,5 miljoner')
    expect(spokenAmount(4_900_000)).toBe('4,9 miljoner')
    expect(spokenAmount(1_000_000)).toBe('1 miljon')
    expect(spokenAmount(750_000)).toBe('750 tusen')
    expect(spokenAmount(-6_500_000)).toBe('minus 6,5 miljoner')
    expect(spokenDate('2026-10-02')).toBe('den 2 oktober')
    expect(spokenDays(3)).toBe('om 3 dagar')
    expect(spokenDays(0)).toBe('i dag')
    expect(spokenName('Anna & Per Dahlqvist')).toBe('Anna och Per Dahlqvist')
  })
})

describe('Anna & Per, spoken', () => {
  it('answers the wealth question with the total first, then net worth and what we hold', async () => {
    const spoken = spokenAnswerOf(
      await answerOn('/clients/cl-dahlqvist', 'Vad har de i totalförmögenhet?'),
    )
    expect(spoken.say).toBe(
      '42 miljoner i total förmögenhet. Nettoförmögenheten är 22,5 miljoner och vi har 4,9 miljoner hos oss.',
    )
    expect(spoken.sentences.length).toBeLessThanOrEqual(4)
    expect(spoken.say).not.toMatch(/MSEK|cl-|Siffror/)
  })

  it('leads with what we hold when that is what was asked', async () => {
    const spoken = spokenAnswerOf(
      await answerOn('/clients/cl-dahlqvist', 'Och hur mycket har vi hos oss?'),
    )
    expect(spoken.say).toBe('4,9 miljoner hos oss, av 42 miljoner i total förmögenhet.')
  })

  it('says when the meeting is, and what is owed', async () => {
    const meeting = spokenAnswerOf(await answerOn('/clients/cl-dahlqvist', 'När ses vi?'))
    expect(meeting.say).toMatch(/^Ni har ett möte den 26 september, om 3 dagar/)
    const owed = spokenAnswerOf(
      await answerOn('/clients/cl-dahlqvist', 'Vad har jag lovat dem?'),
    )
    expect(owed.say).toMatch(
      /^Du har ett öppet åtagande: skicka samlat finansieringsförslag, försenat \d+ dagar\.$/,
    )
  })

  it('prepares the meeting as facts, then one assessment, in at most four sentences', async () => {
    const spoken = spokenAnswerOf(
      await answerOn(
        '/clients/cl-dahlqvist/meeting-prep',
        'Vad ska jag ta upp på mötet?',
      ),
    )
    const sentences = sentencesOf(spoken.say)
    expect(sentences.length).toBeGreaterThanOrEqual(2)
    expect(sentences.length).toBeLessThanOrEqual(4)
    expect(spoken.say).toMatch(/finansieringsförslag/i)
    expect(spoken.say).toMatch(/förfaller den \d+ \w+/)
    expect(sentences[sentences.length - 1]).toMatch(
      /^Därför tycker jag att finansieringen bör vara mötets huvudpunkt/,
    )
    expect(spoken.say).not.toMatch(/HUVUDFOKUS|DU LOVADE|Bedömning/)
    expect(spoken.remaining).toBeGreaterThan(0)
  })

  it('reads the cockpit questions the same way the screen shows them, in speech', async () => {
    const forget = spokenAnswerOf(
      await answerOn('/clients/cl-dahlqvist/meeting-prep', 'Vad får jag inte glömma?'),
    )
    expect(forget.say).toMatch(/^Glöm inte: /)
    const ask = spokenAnswerOf(
      await answerOn(
        '/clients/cl-dahlqvist/meeting-prep',
        'Vilka tre frågor ska jag ställa?',
      ),
    )
    expect(ask.say).toMatch(/^Första: /)
    const theirs = spokenAnswerOf(
      await answerOn(
        '/clients/cl-dahlqvist/meeting-prep',
        'Vad kommer de sannolikt fråga?',
      ),
    )
    expect(theirs.say).toMatch(/^De kan fråga: /)
    const figures = spokenAnswerOf(
      await answerOn(
        '/clients/cl-dahlqvist/meeting-prep',
        'Vilka siffror behöver jag kunna?',
      ),
    )
    expect(figures.say).toMatch(/miljoner/)
    const changes = spokenAnswerOf(
      await answerOn('/clients/cl-dahlqvist/meeting-prep', 'Vad har hänt sedan sist?'),
    )
    expect(changes.say).toMatch(/^Sedan senaste mötet: /)
  })

  it('says a missing fact is missing, with the client’s name, and never guesses', async () => {
    const spoken = spokenAnswerOf(
      await answerOn('/clients/cl-dahlqvist', 'Vad sa de om konst?'),
    )
    expect(spoken.say).toBe(
      'Jag hittar ingen dokumenterad uppgift om det för Anna och Per Dahlqvist.',
    )
  })

  it('states the pack’s readiness and that it opens the preview', async () => {
    const spoken = spokenAnswerOf(
      await answerOn('/clients/cl-dahlqvist/meeting-prep', 'Prepare full pack.'),
    )
    expect(spoken.say).toMatch(
      /^Absolut\. Fullt mötesunderlag är redo: \d+ kärnbilder och \d+ bilagor\. Jag öppnar förhandsgranskningen\.$/,
    )
    const review = spokenAnswerOf(
      await answerOn('/clients/cl-alvarsson', 'Skapa mötesunderlaget.'),
    )
    expect(review.say).toMatch(/kan genereras, men .* innan mötet\./)
    expect(review.say).toMatch(/Jag öppnar förhandsgranskningen/)
  })
})

describe('follow-ups and continuity', () => {
  it('offers the rest, takes it on request, expands one item, and names the evidence', async () => {
    const prep = await answerOn('/clients/cl-dahlqvist/meeting-prep', 'Förbered mig.')
    const spoken = spokenAnswerOf(prep)
    expect(spoken.remaining).toBeGreaterThan(0)
    const rest = await answerOn(
      '/clients/cl-dahlqvist/meeting-prep',
      'Ta resten också.',
      prep,
    )
    expect(rest.intent).toBe('FOLLOW_UP_MORE')
    expect(rest.continues).toBe('MEETING_PREP')
    expect(spokenAnswerOf(rest).say).toMatch(/^Resten: /)
    const second = await answerOn(
      '/clients/cl-dahlqvist/meeting-prep',
      'Utveckla punkt två.',
      prep,
    )
    expect(second.intent).toBe('FOLLOW_UP_ITEM')
    expect(second.sections.flatMap((s) => s.items).length).toBe(1)
    expect(spokenAnswerOf(second).sentences.length).toBeGreaterThanOrEqual(1)
    const why = await answerOn(
      '/clients/cl-dahlqvist/meeting-prep',
      'Vad bygger du det på?',
      prep,
    )
    expect(why.intent).toBe('FOLLOW_UP_EVIDENCE')
    expect(why.sources).toEqual(prep.sources)
    expect(spokenAnswerOf(why).say).toMatch(/^Det bygger på \d+ poster i registret: /)
    expect(spokenAnswerOf(why).say).not.toMatch(/\bcm-|\bin-|\bev-/)
  })

  it('does not continue an answer about another client after the route moved', async () => {
    const prep = await answerOn('/clients/cl-dahlqvist/meeting-prep', 'Förbered mig.')
    const moved = await answerOn('/clients/cl-alvarsson', 'Ta resten också.', prep)
    expect(moved.intent).toBe('FOLLOW_UP_MORE')
    expect(spokenAnswerOf(moved).say).toBe(
      'Det finns inget mer att ta från det senaste svaret.',
    )
  })

  it('asks which client when a first name fits two', async () => {
    const seed = syntheticClients(TODAY)
    const twin = {
      ...seed.clients[0]!,
      id: 'cl-alvarsson-2',
      displayName: 'Henrik Lindqvist',
    }
    const context: AdvisoryContext = {
      repositories: createSyntheticAdvisoryRepositories({
        ...seed,
        clients: [...seed.clients, twin],
      }),
      clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
    }
    const turn = await answerAdvisoryLine(
      context,
      resolveJarvisContext('/clients/cl-dahlqvist'),
      'Vad är viktigast för Henrik?',
    )
    expect(turn?.answer.intent).toBe('CLARIFY_CLIENT')
    expect(spokenAnswerOf(turn!.answer).say).toBe(
      'Menar du Henrik Alvarsson eller Henrik Lindqvist?',
    )
  })
})
