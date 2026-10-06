/**
 * JARVIS answers about the day, from the seed on the frozen clock: who needs
 * the advisor, the best use of thirty and of fifteen minutes, who can wait,
 * what changed since yesterday, the week's meetings, the overdue promises,
 * the financing ahead, one office's day, a why for a named client, and the
 * brief for a call — every item grounded, the sources named, the spoken
 * form a few sentences, and nothing of the record leaving the process.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completeCommitment } from '~/application/advisory/completeCommitment'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { answerPlainText } from '~/presentation/jarvis/advisoryAnswerText'
import { spokenAnswerOf } from '~/presentation/jarvis/spokenAnswer'
import { answerAdvisoryLine } from './advisoryAnswer'
import type { JarvisAnswer, JarvisItem } from './answer'
import { resolveJarvisContext } from './context'
import { sinceDateOf } from './dailyAnswer'
import { RECORD_SCOPES } from './research/firewall'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T08:30:00.000Z`),
  }
}

async function answerOn(route: string, text: string, context = contextAt()): Promise<JarvisAnswer> {
  const turn = await answerAdvisoryLine(context, resolveJarvisContext(route), text)
  if (!turn) throw new Error(`no answer for "${text}" on ${route}`)
  return turn.answer
}

const items = (answer: JarvisAnswer, key: string) =>
  answer.sections.find((s) => s.key === key)?.items ?? []
const actions = (answer: JarvisAnswer, key: string) =>
  items(answer, key).filter(
    (i): i is Extract<JarvisItem, { kind: 'daily-action' }> => i.kind === 'daily-action',
  )
const grounded = (answer: JarvisAnswer) => {
  for (const section of answer.sections)
    for (const item of section.items)
      if (item.kind !== 'note') expect(item.sourceIds.length, item.kind).toBeGreaterThan(0)
}

describe('who needs me', () => {
  it('answers on Idag with the ranked book in three horizons, every action grounded in Sentinel’s records', async () => {
    const answer = await answerOn('/today', 'Vem behöver mig idag?')
    expect(answer.intent).toBe('DAILY_PRIORITIES')
    expect(answer.about).toMatchObject({ kind: 'daily', label: 'Idag', href: '/today' })
    expect(actions(answer, 'now').map((a) => a.action.clientId)).toEqual([
      'cl-berglund',
      'cl-grahn',
      'cl-dahlqvist',
      'cl-ceder',
    ])
    expect(actions(answer, 'this-week').map((a) => a.action.clientId)).toEqual(['cl-forsell'])
    expect(actions(answer, 'can-wait').map((a) => a.action.clientId)).toEqual(['cl-alvarsson'])
    grounded(answer)
    /* The evidence is the record's: the priority, and the promise it rests on, by its own title. */
    expect(answer.sources.map((s) => s.type)).toEqual(
      expect.arrayContaining(['sentinel-priority', 'commitment']),
    )
    expect(answer.sources.find((s) => s.id === 'co-ber-1')?.label).toBeTruthy()
    expect(answer.actions).toContainEqual({ kind: 'open-today', href: '/today' })
    const text = answerPlainText(answer)
    expect(text).toMatch(/Vem som behöver dig i dag/)
    expect(text).toMatch(/Margareta Berglund · Följ upp löftet/)
    expect(text).toMatch(/HÖG · NU · 20–30 min/)
    /* Never a score. */
    expect(text).not.toMatch(/\d{3,}\s*(?:poäng|points)/i)
    const spoken = spokenAnswerOf(answer)
    expect(spoken.say).toMatch(/^6 relationer kräver din uppmärksamhet, 4 av dem nu\./)
    expect(spoken.say).toMatch(/Först Margareta Berglund: följ upp löftet/)
    expect(spoken.remaining).toBeGreaterThan(0)
  })

  it('answers the same question from the market, the day being the record’s wherever it is asked', async () => {
    const answer = await answerOn('/', 'Vem behöver mig idag?')
    expect(answer.intent).toBe('DAILY_PRIORITIES')
    expect(actions(answer, 'now')[0]?.action.clientId).toBe('cl-berglund')
  })

  it('narrows to the office the line names', async () => {
    const answer = await answerOn('/today', 'Vilka på Strandvägen behöver mig?')
    expect(answer.intent).toBe('DAILY_PRIORITIES')
    expect(answer.about).toMatchObject({ kind: 'office', id: 'of-strandvagen', label: 'Strandvägen' })
    const all = ['now', 'this-week', 'can-wait'].flatMap((key) => actions(answer, key))
    expect(all.map((a) => a.action.clientId)).toEqual(['cl-berglund', 'cl-alvarsson'])
    expect(answer.actions).toContainEqual({ kind: 'open-office', href: '/clients/office/of-strandvagen' })
    expect(answerPlainText(answer)).toMatch(/^Strandvägen: vem som behöver dig i dag/)
  })
})

describe('a window of time', () => {
  it('fits thirty minutes with the top promise and names what is left, by rank and never by AUM', async () => {
    const answer = await answerOn('/today', 'Jag har 30 minuter. Vem borde jag ringa?')
    expect(answer.intent).toBe('DAILY_TIME_WINDOW')
    expect(answer.window).toEqual({ minutes: 30 })
    const best = actions(answer, 'best-use')
    expect(best[0]).toMatchObject({
      nature: 'suggestion',
      action: { clientId: 'cl-berglund', actionType: 'FOLLOW_UP_COMMITMENT' },
      fit: { remainingMinutes: 10 },
    })
    expect(best).toHaveLength(1)
    expect(items(answer, 'deferred')).toEqual([])
    grounded(answer)
    const spoken = spokenAnswerOf(answer)
    expect(spoken.say).toMatch(/^Med 30 minuter: följ upp löftet till Margareta Berglund, 20 till 30 minuter\./)
    expect(spoken.say).toMatch(/Du lovade/)
    expect(answerPlainText(answer)).toMatch(/Bästa användningen av 30 minuter/)
  })

  it('skips the promises fifteen minutes cannot hold, says so, and offers the call that fits', async () => {
    const answer = await answerOn('/sentinel', 'Jag har 15 minuter. Vem borde jag ringa?')
    expect(answer.intent).toBe('DAILY_TIME_WINDOW')
    const best = actions(answer, 'best-use')
    expect(best[0]?.action).toMatchObject({ clientId: 'cl-forsell', actionType: 'CALL_CLIENT' })
    expect(actions(answer, 'deferred').map((a) => a.action.clientId)).toEqual([
      'cl-berglund',
      'cl-grahn',
      'cl-dahlqvist',
      'cl-ceder',
    ])
    const spoken = spokenAnswerOf(answer)
    expect(spoken.say).toMatch(/Det räcker inte för Margareta Berglund, Lars Grahn och Anna och Per Dahlqvist, som behöver mer tid/)
  })

  it('says when nothing fits', async () => {
    const answer = await answerOn('/today', 'Jag har 5 minuter, vad hinner jag?')
    expect(items(answer, 'best-use')[0]).toMatchObject({ kind: 'note', note: 'nothing-fits' })
    expect(spokenAnswerOf(answer).say).toMatch(/Ingen åtgärd ryms/)
  })
})

describe('who can wait, what is booked, what is owed, what is ahead', () => {
  it('names the week and the watch list as what can wait', async () => {
    const answer = await answerOn('/today', 'Vilka kan vänta?')
    expect(answer.intent).toBe('DAILY_CAN_WAIT')
    expect(actions(answer, 'this-week').map((a) => a.action.clientId)).toEqual(['cl-forsell'])
    expect(actions(answer, 'can-wait').map((a) => a.action.clientId)).toEqual(['cl-alvarsson'])
    expect(spokenAnswerOf(answer).say).toMatch(/^2 relationer kan vänta\./)
  })

  it('lists the week’s meetings with their readiness', async () => {
    const answer = await answerOn('/today', 'Vilka möten har jag den här veckan?')
    expect(answer.intent).toBe('DAILY_MEETINGS')
    const meetings = items(answer, 'meetings')
    expect(meetings.map((m) => (m.kind === 'daily-meeting' ? m.meeting.clientId : m.kind))).toEqual([
      'cl-dahlqvist',
      'cl-ceder',
    ])
    expect(answer.sources.map((s) => s.id)).toEqual(expect.arrayContaining(['ev-dah-meeting', 'ev-ced-meeting']))
    expect(answerPlainText(answer)).toMatch(/om 3 dagar/)
    expect(spokenAnswerOf(answer).say).toMatch(/^2 möten: Anna och Per Dahlqvist om 3 dagar/)
  })

  it('lists the overdue promises, the oldest first', async () => {
    const answer = await answerOn('/today', 'Vilka löften är försenade?')
    expect(answer.intent).toBe('DAILY_OVERDUE')
    const overdue = items(answer, 'overdue')
    expect(overdue.map((o) => (o.kind === 'daily-overdue' ? o.overdue.commitmentId : o.kind))).toEqual([
      'co-gra-1',
      'co-ber-1',
      'co-ber-2',
      'co-dah-1',
    ])
    grounded(answer)
    expect(spokenAnswerOf(answer).say).toMatch(/^4 försenade åtaganden: Lars Grahn/)
  })

  it('lists the financing ahead within ninety days, the soonest first, with the loan’s amount', async () => {
    const answer = await answerOn('/today', 'Vilka har finansiering som förfaller snart?')
    expect(answer.intent).toBe('DAILY_FINANCING')
    const rows = items(answer, 'financing').filter(
      (i): i is Extract<JarvisItem, { kind: 'daily-financing' }> => i.kind === 'daily-financing',
    )
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]?.financing).toMatchObject({ clientId: 'cl-grahn', eventId: 'ev-gra-refi', daysAhead: 38 })
    for (let i = 1; i < rows.length; i += 1)
      expect(rows[i]!.financing.daysAhead).toBeGreaterThanOrEqual(rows[i - 1]!.financing.daysAhead)
    for (const row of rows) expect(row.financing.daysAhead).toBeLessThanOrEqual(90)
    grounded(answer)
    expect(answerPlainText(answer)).toMatch(/MSEK/)
  })
})

describe('what changed', () => {
  it('counts from the day the line names', () => {
    expect(sinceDateOf('yesterday', '2026-09-23')).toBe('2026-09-22')
    expect(sinceDateOf(undefined, '2026-09-23')).toBe('2026-09-22')
    /* 2026-09-23 is a Wednesday. */
    expect(sinceDateOf('friday', '2026-09-23')).toBe('2026-09-18')
    expect(sinceDateOf('monday', '2026-09-23')).toBe('2026-09-21')
    expect(sinceDateOf('week', '2026-09-23')).toBe('2026-09-21')
    /* On a Friday, "sedan i fredags" is the Friday before. */
    expect(sinceDateOf('friday', '2026-09-25')).toBe('2026-09-18')
  })

  it('reads the changes from the record, never from a remembered page', async () => {
    const context = contextAt()
    const nothing = await answerOn('/today', 'Vad har förändrats sedan igår?', context)
    expect(nothing.intent).toBe('DAILY_CHANGES')
    expect(nothing.since).toBe('2026-09-22')
    expect(items(nothing, 'changes')[0]).toMatchObject({ kind: 'note', note: 'no-changes-since' })
    expect(answerPlainText(nothing)).toMatch(/Förändringar sedan i går/)
    await completeCommitment(context, 'co-dah-1')
    const changed = await answerOn('/today', 'Vad har förändrats sedan igår?', context)
    expect(items(changed, 'changes')).toEqual([
      expect.objectContaining({
        kind: 'changed-client',
        change: 'completed-commitment',
        clientId: 'cl-dahlqvist',
        sourceIds: ['co-dah-1', 'cl-dahlqvist'],
      }),
    ])
    expect(spokenAnswerOf(changed).say).toMatch(/^Sedan i går: Anna och Per Dahlqvist, löfte levererat\./)
  })
})

describe('one client', () => {
  it('explains a named client’s priority from the day', async () => {
    const answer = await answerOn('/today', 'Varför Berglund?')
    expect(answer.intent).toBe('WHY_PRIORITY')
    expect(answer.about).toMatchObject({ kind: 'client', id: 'cl-berglund', switched: true })
    expect(items(answer, 'why-now')[0]?.kind).toBe('sentinel-entry')
    expect(items(answer, 'drivers').length).toBeGreaterThan(0)
  })

  it('briefs a call: why now, last contact, concern, promises, three questions, the objective, the door', async () => {
    const answer = await answerOn('/today', 'Förbered samtal med Henrik')
    expect(answer.intent).toBe('PREPARE_CALL')
    expect(answer.about).toMatchObject({ kind: 'client', id: 'cl-alvarsson', label: 'Henrik Alvarsson' })
    const why = items(answer, 'why-now')
    expect(why[0]).toMatchObject({ kind: 'daily-action', action: { actionType: 'PREPARE_MEETING' } })
    expect(why.slice(1).every((i) => i.kind === 'sentinel-driver')).toBe(true)
    expect(items(answer, 'discussed')[0]).toMatchObject({ kind: 'interaction', interaction: { id: 'in-alv-3' } })
    expect(items(answer, 'concerns').map((i) => (i.kind === 'context-fact' ? i.fact.id : i.kind))).toEqual(['cf-alv-1'])
    expect(items(answer, 'promises').map((i) => (i.kind === 'commitment' ? i.commitment.id : i.kind))).toEqual([
      'co-alv-1',
      'co-alv-2',
    ])
    expect(items(answer, 'questions-to-ask').length).toBeGreaterThan(0)
    expect(items(answer, 'questions-to-ask').length).toBeLessThanOrEqual(3)
    expect(items(answer, 'next-step')[0]).toMatchObject({ kind: 'daily-objective', nature: 'suggestion' })
    expect(answer.actions).toContainEqual({ kind: 'prepare-call', href: '/today/call/cl-alvarsson' })
    grounded(answer)
    expect(answer.sources.map((s) => s.id)).toEqual(expect.arrayContaining(['cf-alv-1', 'co-alv-1', 'in-alv-3']))
    const text = answerPlainText(answer)
    expect(text).toMatch(/^Inför samtalet med Henrik Alvarsson/)
    expect(text).toMatch(/Beräknad tid 30–45 min/)
    /* No scripted sales language: the suggestion is the objective, in the product's words. */
    expect(text).not.toMatch(/sälj|erbjud|produkt/i)
    const spoken = spokenAnswerOf(answer)
    expect(spoken.say).toMatch(/^Inför samtalet med Henrik Alvarsson: förbered mötet\./)
    expect(spoken.say).toMatch(/Målet: /)
    expect(spoken.say).toMatch(/Fråga först: /)
  })

  it('briefs a call for the client on screen, and says when nothing calls for one', async () => {
    const onPage = await answerOn('/clients/cl-berglund', 'Förbered samtalet')
    expect(onPage.intent).toBe('PREPARE_CALL')
    expect(onPage.about).toMatchObject({ id: 'cl-berglund', switched: false })
    const quiet = await answerOn('/today', 'Förbered samtal med Ekstrand')
    expect(quiet.intent).toBe('PREPARE_CALL')
    expect(items(quiet, 'why-now')[0]).toMatchObject({ kind: 'note', note: 'no-call-reason' })
    expect(quiet.confidence).toBe('medium')
    expect(spokenAnswerOf(quiet).say).toMatch(/Inget i registret kallar på ett samtal/)
  })
})

describe('privacy', () => {
  it('answers the day from the record alone — Idag is a record scope, and the composer reaches no public provider', () => {
    expect(RECORD_SCOPES).toContain('DAILY')
    for (const file of ['src/application/jarvis/dailyAnswer.ts', 'src/application/advisory/dailyCommand.ts']) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(source, file).not.toMatch(/research|publicSearch|fetch\(|openai|anthropic/i)
    }
  })
})
