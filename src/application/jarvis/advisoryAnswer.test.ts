/**
 * JARVIS answers about the record, from the seed on the frozen clock: Anna &
 * Per's meeting, what was said last, what is owed; Henrik's priority; the
 * office, the book, Sentinel, Marknadspåverkan; a named other client; what
 * is not documented; a client with no history, no meeting, no priority.
 * Every item is grounded, and the answer names its sources.
 */

import { describe, expect, it } from 'vitest'
import { client360 } from '~/application/advisory/client360'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { answerPlainText } from '~/presentation/jarvis/advisoryAnswerText'
import { answerAdvisoryLine } from './advisoryAnswer'
import { advisoryTurn } from './advisoryTurn'
import type { JarvisAnswer } from './answer'
import { resolveJarvisContext } from './context'

const TODAY = '2026-09-23'

function contextAt(seed = syntheticClients(TODAY)): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(seed),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

const DAHLQVIST = resolveJarvisContext('/clients/cl-dahlqvist')

async function answerOn(
  route: string,
  text: string,
  context = contextAt(),
): Promise<JarvisAnswer> {
  const turn = await answerAdvisoryLine(context, resolveJarvisContext(route), text)
  if (!turn) throw new Error(`no answer for "${text}" on ${route}`)
  return turn.answer
}

const sectionKeys = (answer: JarvisAnswer) => answer.sections.map((s) => s.key)
const items = (answer: JarvisAnswer, key: string) =>
  answer.sections.find((s) => s.key === key)?.items ?? []

describe('Anna & Per, on their own page, without their name', () => {
  it('prepares the meeting from the cockpit: focus, what to bring up, what is owed', async () => {
    const answer = await answerOn('/clients/cl-dahlqvist', 'Vad ska jag ta upp på mötet?')
    expect(answer.intent).toBe('MEETING_PREP')
    expect(answer.about).toMatchObject({
      kind: 'client',
      label: 'Anna & Per Dahlqvist',
      switched: false,
    })
    expect(sectionKeys(answer)).toEqual(
      expect.arrayContaining(['focus', 'bring-up', 'promises']),
    )
    const text = answerPlainText(answer)
    /* Grounded items only: the open financing proposal, the bridge loan, the concern. */
    expect(text).toMatch(/finansiering/i)
    expect(text).toMatch(/brygglån/i)
    expect(items(answer, 'promises').some((i) => i.kind === 'promise')).toBe(true)
    expect(answer.sources.map((s) => s.type)).toEqual(
      expect.arrayContaining(['commitment']),
    )
    expect(answer.actions).toEqual(
      expect.arrayContaining([
        { kind: 'open-meeting-prep', href: '/clients/cl-dahlqvist/meeting-prep' },
      ]),
    )
    expect(answer.method).toBe('advisory-rules-v1')
  })

  it('reads the latest confirmed conversation from the record, never inventing what was said', async () => {
    const context = contextAt()
    const view = (await client360(context, 'cl-dahlqvist'))!
    const answer = await answerOn(
      '/clients/cl-dahlqvist',
      'Vad pratade vi om sist?',
      context,
    )
    expect(answer.intent).toBe('LAST_INTERACTION')
    const [first] = items(answer, 'discussed')
    expect(first?.kind).toBe('interaction')
    if (first?.kind !== 'interaction') throw new Error('no interaction')
    const expected = view.interactions.find((i) =>
      [
        'meeting',
        'phone',
        'email',
        'teams',
        'portfolio-discussion',
        'financing-discussion',
        'follow-up',
        'complaint',
        'investment-proposal',
      ].includes(i.type),
    )!
    expect(first.interaction.id).toBe(expected.id)
    expect(answer.sources.map((s) => s.id)).toContain(expected.id)
    /* Every further line rests on that interaction, or on a record that names it as its source. */
    for (const section of answer.sections)
      for (const item of section.items) expect(item.sourceIds.length).toBeGreaterThan(0)
  })

  it('lists the open promises, the overdue one first', async () => {
    const answer = await answerOn('/clients/cl-dahlqvist', 'Vad har jag lovat?')
    expect(answer.intent).toBe('OPEN_COMMITMENTS')
    const promises = items(answer, 'promises')
    expect(promises.length).toBeGreaterThan(0)
    expect(promises[0]).toMatchObject({ kind: 'commitment', overdue: true })
    expect(answerPlainText(answer)).toMatch(/finansieringsförslag/i)
  })

  it('answers the client’s figures with the valuation date, and the summary in one screen', async () => {
    const figures = await answerOn(
      '/clients/cl-dahlqvist',
      'Vilka siffror behöver jag kunna?',
    )
    expect(figures.intent).toBe('KEY_FIGURES')
    expect(
      items(figures, 'figures').map((i) => (i.kind === 'figure' ? i.figure : '')),
    ).toEqual(
      expect.arrayContaining([
        'total-wealth',
        'aum',
        'debt',
        'net-worth',
        'property-share',
      ]),
    )
    const summary = await answerOn(
      '/clients/cl-dahlqvist',
      'Ge mig kunden på 30 sekunder.',
    )
    expect(summary.intent).toBe('CLIENT_SUMMARY')
    expect(sectionKeys(summary)).toEqual(
      expect.arrayContaining(['figures', 'relationship']),
    )
    expect(answerPlainText(summary)).toMatch(/Relationshälsa \d+\/100/)
  })

  it('says so when nothing is documented, at low confidence, rather than improvising', async () => {
    const answer = await answerOn('/clients/cl-dahlqvist', 'Vad sa de om konst?')
    expect(answer.intent).toBe('GENERAL_CLIENT_QUERY')
    expect(items(answer, 'memory')).toEqual([
      { kind: 'note', note: 'nothing-documented', nature: 'fact', sourceIds: [] },
    ])
    expect(answer.confidence).toBe('low')
    expect(answerPlainText(answer)).toContain(
      'Jag hittar inget dokumenterat om detta i klienthistoriken.',
    )
  })
})

describe('Henrik, and a named other client', () => {
  it('explains the Sentinel priority with its drivers and the preparation', async () => {
    const answer = await answerOn('/clients/cl-alvarsson', 'Varför är de prioriterade?')
    expect(answer.intent).toBe('WHY_PRIORITY')
    expect(sectionKeys(answer)).toEqual(['why-now', 'drivers', 'preparation'])
    expect(items(answer, 'why-now')[0]?.nature).toBe('assessment')
    expect(items(answer, 'drivers').every((i) => i.nature === 'fact')).toBe(true)
    expect(items(answer, 'preparation')[0]?.nature).toBe('suggestion')
    expect(answerPlainText(answer)).toMatch(/finansiering/i)
  })

  it('answers about Henrik from Anna & Per’s page, says so, and offers the door', async () => {
    const context = contextAt()
    const turn = await answerAdvisoryLine(
      context,
      DAHLQVIST,
      'Vad är viktigast med Henrik just nu?',
    )
    expect(turn?.intent.namedClient?.id).toBe('cl-alvarsson')
    expect(turn?.answer.about).toMatchObject({
      label: 'Henrik Alvarsson',
      switched: true,
      href: '/clients/cl-alvarsson',
    })
    expect(turn?.answer.actions).toEqual(
      expect.arrayContaining([{ kind: 'open-client', href: '/clients/cl-alvarsson' }]),
    )
    /* The screen's context is untouched: the answer's scope is still the client page's. */
    expect(turn?.context.clientId).toBe('cl-dahlqvist')
  })
})

describe('the quiet client, no meeting, no history', () => {
  it('says the quiet client has no priority, and a client without promises has none', async () => {
    const why = await answerOn('/clients/cl-ekstrand', 'Varför är han prioriterad?')
    expect(items(why, 'why-now')).toEqual([
      { kind: 'note', note: 'no-priority', nature: 'fact', sourceIds: [] },
    ])
    const seed = syntheticClients(TODAY)
    const context = contextAt({
      ...seed,
      commitments: seed.commitments.filter((c) => c.clientId !== 'cl-ekstrand'),
    })
    const owed = await answerOn('/clients/cl-ekstrand', 'Vad har jag lovat?', context)
    expect(items(owed, 'promises')[0]).toMatchObject({
      kind: 'note',
      note: 'no-open-commitments',
    })
  })

  it('says a client without a booked meeting has none', async () => {
    const summary = await answerOn(
      '/clients/cl-berglund',
      'Ge mig kunden på 30 sekunder.',
    )
    expect(
      items(summary, 'relationship').some(
        (i) => i.kind === 'note' && i.note === 'no-upcoming-meeting',
      ),
    ).toBe(true)
  })

  it('says a client with no recorded conversation has none', async () => {
    const seed = syntheticClients(TODAY)
    const context = contextAt({
      ...seed,
      interactions: seed.interactions.filter((i) => i.clientId !== 'cl-ekstrand'),
    })
    const answer = await answerOn(
      '/clients/cl-ekstrand',
      'Vad pratade vi om sist?',
      context,
    )
    expect(items(answer, 'discussed')).toEqual([
      { kind: 'note', note: 'no-recorded-contact', nature: 'fact', sourceIds: [] },
    ])
  })
})

describe('the office, the book, Sentinel and Marknadspåverkan', () => {
  it('answers the office about its own clients only', async () => {
    const answer = await answerOn(
      '/clients/office/of-strandvagen',
      'Vilka kunder här behöver mig?',
    )
    expect(answer.intent).toBe('OFFICE_PRIORITIES')
    expect(answer.about).toMatchObject({ kind: 'office', label: 'Strandvägen' })
    const rows = items(answer, 'clients')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.kind).toBe('client-row')
      if (row.kind === 'client-row') expect(row.row.officeId).toBe('of-strandvagen')
    }
    const meetings = await answerOn(
      '/clients/office/of-arbetargatan',
      'Vem har möte den här veckan?',
    )
    expect(meetings.intent).toBe('OFFICE_MEETINGS')
  })

  it('answers the whole book across offices', async () => {
    const overdue = await answerOn('/clients', 'Vilka löften är försenade?')
    expect(overdue.intent).toBe('DIRECTORY_OVERDUE')
    expect(
      items(overdue, 'overdue')
        .map((i) => (i.kind === 'client-row' ? i.row.id : ''))
        .sort(),
    ).toEqual(['cl-berglund', 'cl-dahlqvist', 'cl-grahn'])
    const external = await answerOn(
      '/clients?view=alla',
      'Vilka kunder har stora externa tillgångar?',
    )
    expect(external.intent).toBe('DIRECTORY_EXTERNAL_ASSETS')
    expect(items(external, 'clients')[0]?.kind).toBe('client-row')
    const today = await answerOn('/clients', 'Vem borde jag ringa idag?')
    expect(today.intent).toBe('DIRECTORY_CALL_TODAY')
    expect(items(today, 'clients')[0]?.kind).toBe('sentinel-entry')
  })

  it('answers Sentinel with today’s entries, and Marknadspåverkan with what touches somebody', async () => {
    const sentinel = await answerOn('/sentinel', 'Vem behöver mig idag?')
    expect(sentinel.intent).toBe('SENTINEL_TODAY')
    expect(items(sentinel, 'clients').every((i) => i.kind === 'sentinel-entry')).toBe(
      true,
    )
    /* No market source in this context: an honest empty answer, not an invented move. */
    const impact = await answerOn('/market-impact', 'Vilka klienter berörs?')
    expect(impact.intent).toBe('MARKET_IMPACT_CLIENTS')
    expect(items(impact, 'episodes')).toEqual([
      { kind: 'note', note: 'no-affected-clients', nature: 'fact', sourceIds: [] },
    ])
  })
})

describe('the typed door’s advisory tier', () => {
  it('answers with no model when the route makes the line the record’s, and stands aside otherwise', async () => {
    const context = contextAt()
    const advisory = () => Promise.resolve(context)
    const answered = await advisoryTurn(
      { text: 'Vad har jag lovat?', context: { route: '/clients/cl-dahlqvist' } },
      advisory,
    )
    expect(answered?.advisory.intent).toBe('OPEN_COMMITMENTS')
    expect(answered?.context.scope).toBe('CLIENT')
    /* A named instrument's state stays the market's fast path, even on a client. */
    expect(
      await advisoryTurn(
        { text: 'Hur gick S&P 500 idag?', context: { route: '/clients/cl-dahlqvist' } },
        advisory,
      ),
    ).toBeNull()
    /* Without a route there is no workspace, and the line goes to the router. */
    expect(await advisoryTurn({ text: 'Vad har jag lovat?' }, advisory)).toBeNull()
    /* The market landing page is not the record's. */
    expect(
      await advisoryTurn(
        { text: 'Vad ska jag ta upp på mötet?', context: { route: '/' } },
        advisory,
      ),
    ).toBeNull()
  })

  it('resolves the meeting once the cockpit has, inside the meeting', async () => {
    const context = contextAt()
    const turn = await advisoryTurn(
      {
        text: 'Vad ska jag ta upp på mötet?',
        context: { route: '/clients/cl-dahlqvist/meeting-prep' },
      },
      () => Promise.resolve(context),
    )
    expect(turn?.context.scope).toBe('MEETING')
    expect(turn?.advisory.about.kind).toBe('meeting')
    expect(turn?.advisory.about.meetingDate).toBeDefined()
    expect(turn?.context.meetingId).toBeDefined()
  })
})
