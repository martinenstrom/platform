/**
 * Daily Command on the synthetic book, on the frozen clock: the ranked
 * actions follow Sentinel; one action per client; a former client is
 * never there, an onboarding one stands apart; a kept promise and a fresh
 * call change the book; a meeting today is prepared; a financing is
 * time-sensitive; the market's episodes reach the clients they touch and
 * no further; an office narrows everything; and a window of time is used
 * by rank, with what it cannot hold named.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MarketObservation } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { completeCommitment } from './completeCommitment'
import { confirmClientUpdate } from './confirmClientUpdate'
import { callBrief, changesSince, dailyCommand } from './dailyCommand'
import { closeClient, createClient } from './lifecycle'
import type { AdvisoryContext } from './ports'
import { recordClientUpdate } from './recordClientUpdate'

const TODAY = '2026-09-23'
const NOW = `${TODAY}T08:30:00.000Z`

const obs = (
  symbol: string,
  category: MarketObservation['category'],
  change: number,
  tags: MarketObservation['tags'] = {},
  reference?: number,
): MarketObservation => ({
  symbol,
  category,
  label: symbol,
  value: 100,
  change,
  changeUnit: category === 'rates' ? 'bp' : 'percent',
  ...(reference === undefined ? {} : { reference }),
  observedAt: NOW,
  source: 'test',
  quality: 'live',
  tags,
})

const ENERGY_DOWN: MarketObservation[] = [
  obs('sector:energy', 'sectors', -8.0, { sector: 'energy' }, 0.4),
  obs('cmd:brent', 'commodities', -6.0, { commodityClass: 'energy' }),
]

function contextAt(market: readonly MarketObservation[] | null = null): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(NOW),
    ...(market
      ? {
          market: {
            scenario: 'test',
            async observe() {
              return market
            },
          },
        }
      : {}),
  }
}

const ids = (actions: readonly { clientId: string }[]) => actions.map((a) => a.clientId)

describe('the ranked book', () => {
  it('follows Sentinel: the overdue promises first, one action per client, nothing for a quiet one', async () => {
    const view = await dailyCommand(contextAt())
    const all = [...view.now, ...view.week, ...view.watch]
    /* Sentinel's order within each horizon, as sentinel.test records it; one action per client. */
    expect(new Set(ids(all)).size).toBe(all.length)
    expect(view.now.map((a) => [a.clientId, a.actionType, a.band])).toEqual([
      ['cl-berglund', 'FOLLOW_UP_COMMITMENT', 'high'],
      ['cl-grahn', 'FOLLOW_UP_COMMITMENT', 'high'],
      ['cl-dahlqvist', 'FOLLOW_UP_COMMITMENT', 'high'],
      ['cl-ceder', 'PREPARE_MEETING', 'high'],
    ])
    /* Forsell's silence is this week's work, in the medium band; Henrik's meeting in ten days is watched. */
    expect(view.week.map((a) => [a.clientId, a.actionType, a.band])).toEqual([
      ['cl-forsell', 'CALL_CLIENT', 'medium'],
    ])
    expect(view.watch.map((a) => [a.clientId, a.actionType, a.band])).toEqual([
      ['cl-alvarsson', 'PREPARE_MEETING', 'high'],
    ])
    /* Ekstrand, met eight days ago with nothing due, is quiet — no card, no alert. */
    expect(ids(all)).not.toContain('cl-ekstrand')
    expect(view.quiet).toBe(1)
    expect(view.pulse).toMatchObject({
      activeClients: 7,
      actNow: 4,
      overdueCommitments: 4,
      meetingsThisWeek: 2,
    })
    expect(view.onboarding).toEqual([])
    /* An overdue promise outranks a low-value, non-urgent signal: no silence stands among the promises. */
    expect(view.now.map((a) => a.clientId)).not.toContain('cl-forsell')
  })

  it('carries every reason with its sources, consolidated into one action', async () => {
    const view = await dailyCommand(contextAt())
    const dahlqvist = view.now.find((a) => a.clientId === 'cl-dahlqvist')!
    expect(dahlqvist.reasons.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['overdue-commitment', 'meeting', 'event', 'concern']),
    )
    expect(dahlqvist.signals).toEqual(expect.arrayContaining(['overdue-commitment', 'meeting', 'financing', 'concern']))
    expect(dahlqvist.sourceIds.length).toBeGreaterThan(2)
    expect(dahlqvist.commitmentId).toBe('co-dah-1')
    expect(dahlqvist.meetingId).toBe('ev-dah-meeting')
    for (const action of [...view.now, ...view.week, ...view.watch]) {
      expect(action.reasons.length).toBeGreaterThan(0)
      expect(action.sourceIds.length).toBeGreaterThan(0)
    }
  })

  it('lists the week’s meetings with their readiness and the overdue promises by age', async () => {
    const view = await dailyCommand(contextAt())
    expect(view.meetings.map((m) => [m.clientId, m.daysAhead])).toEqual([
      ['cl-dahlqvist', 3],
      ['cl-ceder', 6],
    ])
    for (const m of view.meetings) expect(['REDO', 'GRANSKA', 'BLOCKERAD']).toContain(m.readiness)
    expect(view.overdue[0]).toMatchObject({ clientId: 'cl-grahn', commitmentId: 'co-gra-1', daysOverdue: 33 })
    expect(view.overdue.map((o) => [o.commitmentId, o.daysOverdue])).toEqual([
      ['co-gra-1', 33],
      ['co-ber-1', 30],
      ['co-ber-2', 20],
      ['co-dah-1', 6],
    ])
  })
})

describe('lifecycle', () => {
  it('never shows a former client, and keeps an onboarding one apart with what to complete', async () => {
    const context = contextAt()
    await closeClient(context, { clientId: 'cl-berglund', reason: 'COMPETITOR', by: 'adv-martin' })
    const created = await createClient(context, {
      displayName: 'Ny Relation',
      segment: 'private-banking',
      officeId: 'of-strandvagen',
      advisorId: 'adv-martin',
      relationshipSince: TODAY,
      status: 'onboarding',
      by: 'adv-martin',
    })
    if (!created.ok) throw new Error(created.code)
    const view = await dailyCommand(context)
    const all = [...view.now, ...view.week, ...view.watch]
    expect(ids(all)).not.toContain('cl-berglund')
    expect(ids(all)).not.toContain(created.clientId)
    expect(view.onboarding.map((a) => [a.clientId, a.actionType, a.completeness])).toEqual([
      [created.clientId, 'DATA_COMPLETION', 'insufficient'],
    ])
    expect(view.gaps.find((g) => g.clientId === created.clientId)?.gaps).toEqual([
      'no-contact-recorded',
      'no-risk-profile',
      'no-financial-overview',
      'no-meeting-booked',
    ])
    expect(view.pulse.activeClients).toBe(6)
  })
})

describe('the record moves, the book re-ranks', () => {
  it('a kept promise removes its reason and the client leaves the immediate queue', async () => {
    const context = contextAt()
    const before = await dailyCommand(context)
    expect(before.now[0]?.clientId).toBe('cl-berglund')
    await completeCommitment(context, 'co-ber-1')
    await completeCommitment(context, 'co-ber-2')
    const after = await dailyCommand(context)
    expect(after.now.map((a) => a.clientId)).not.toContain('cl-berglund')
    const berglund = [...after.week, ...after.watch].find((a) => a.clientId === 'cl-berglund')
    expect(berglund?.actionType).not.toBe('FOLLOW_UP_COMMITMENT')
    expect(berglund?.reasons.some((r) => r.kind === 'overdue-commitment')).toBe(false)
    expect(after.pulse.overdueCommitments).toBe(before.pulse.overdueCommitments - 2)
  })

  it('a fresh call resets the silence: Ceder is prepared for his meeting, no longer silent', async () => {
    const context = contextAt()
    const before = await dailyCommand(context)
    const ceder = before.now.find((a) => a.clientId === 'cl-ceder')!
    expect(ceder.reasons.some((r) => r.kind === 'silence')).toBe(true)
    const recorded = await recordClientUpdate(context, {
      clientId: 'cl-ceder',
      noteText: 'Ringde Johan inför kvartalsavstämningen. Han är nöjd med portföljen.',
    })
    if (!recorded.ok) throw new Error(recorded.code)
    const confirmed = await confirmClientUpdate(context, {
      candidateId: recorded.candidate.id,
      decisions: recorded.candidate.items.map((item) => ({ itemId: item.id, decision: 'confirm' as const })),
    })
    expect(confirmed.ok).toBe(true)
    const after = await dailyCommand(context)
    const cederAfter = [...after.now, ...after.week, ...after.watch].find((a) => a.clientId === 'cl-ceder')!
    expect(cederAfter.reasons.some((r) => r.kind === 'silence')).toBe(false)
    expect(cederAfter.lastContact?.date).toBe(TODAY)
    expect(after.changes.contactsRecorded.map((c) => c.clientId)).toContain('cl-ceder')
  })

  it('a meeting today is prepared now; a financing in a fortnight is a time-sensitive review', async () => {
    const context = contextAt()
    const event = (await context.repositories.events.eventsOf('cl-forsell')).find((e) => e.id === 'ev-for-meeting')!
    await context.repositories.events.saveEvent({ ...event, date: TODAY })
    const created = await createClient(context, {
      displayName: 'Finn Finansiering',
      segment: 'private-banking',
      officeId: 'of-arbetargatan',
      advisorId: 'adv-martin',
      relationshipSince: '2020-01-01',
      status: 'active',
      initialContext: { importantEvent: { title: 'Omsättning av bolånet', date: '2026-10-05' } },
      by: 'adv-martin',
    })
    if (!created.ok) throw new Error(created.code)
    const financing = await context.repositories.events.eventsOf(created.clientId)
    await context.repositories.events.saveEvent({ ...financing[0]!, type: 'mortgage-refinancing' })
    const view = await dailyCommand(context)
    const forsell = view.now.find((a) => a.clientId === 'cl-forsell')!
    expect(forsell.actionType).toBe('PREPARE_MEETING')
    expect(forsell.meetingId).toBe('ev-for-meeting')
    expect(view.meetings[0]).toMatchObject({ clientId: 'cl-forsell', daysAhead: 0 })
    const finn = [...view.now, ...view.week, ...view.watch].find((a) => a.clientId === created.clientId)!
    expect(finn).toMatchObject({ actionType: 'FINANCING_REVIEW', band: 'high', dueAt: '2026-10-05', objective: 'financing-plan' })
    expect(view.pulse.upcomingFinancing).toBe(1)
  })
})

describe('the market reaches the clients it touches', () => {
  it('an energy move becomes evidence under Henrik’s action and a Market → Client item with him first', async () => {
    const context = contextAt(ENERGY_DOWN)
    const view = await dailyCommand(context)
    const alvarsson = [...view.now, ...view.week, ...view.watch].find((a) => a.clientId === 'cl-alvarsson')!
    expect(alvarsson.reasons.some((r) => r.kind === 'market')).toBe(true)
    expect(alvarsson.signals).toContain('market')
    expect(view.market.length).toBeGreaterThan(0)
    const item = view.market[0]!
    expect(item.direction).toBe('down')
    expect(item.clients[0]).toMatchObject({ clientId: 'cl-alvarsson', concernMatched: true })
    expect(['proactive-call', 'raise-at-meeting']).toContain(item.clients[0]!.suggestedAction)
    expect(view.pulse.affectedByMarket).toBeGreaterThan(0)
    expect(view.freshness.marketEvents).toBeGreaterThan(0)
  })

  it('reads the market from the local observation source only — nothing of a client leaves the process', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/application/advisory/dailyCommand.ts'), 'utf8')
    expect(source).not.toMatch(/jarvis\/research|publicSearch|fetch\(/)
  })
})

describe('an office', () => {
  it('narrows every list to the office’s own clients', async () => {
    const view = await dailyCommand(contextAt(), { officeId: 'of-strandvagen' })
    expect(view.office?.displayName).toBe('Strandvägen')
    for (const a of [...view.now, ...view.week, ...view.watch]) expect(a.officeId).toBe('of-strandvagen')
    expect(ids([...view.now, ...view.week, ...view.watch])).toEqual(['cl-berglund', 'cl-alvarsson'])
    expect(view.pulse.activeClients).toBe(3)
    for (const o of view.overdue) expect(['cl-berglund', 'cl-alvarsson', 'cl-ekstrand']).toContain(o.clientId)
  })
})

describe('a window of time', () => {
  it('is used by rank: fifteen minutes takes the first action that fits and names the promises it defers', async () => {
    const view = await dailyCommand(contextAt())
    const fifteen = view.timeWindows.find((w) => w.minutes === 15)!.fit
    /* The three promises need twenty minutes each; the first fit is Ceder’s meeting? No — that needs thirty. */
    expect(fifteen.skipped.map((a) => a.clientId)).toEqual(expect.arrayContaining(['cl-berglund', 'cl-grahn', 'cl-dahlqvist', 'cl-ceder']))
    const thirty = view.timeWindows.find((w) => w.minutes === 30)!.fit
    expect(thirty.best?.action.clientId).toBe('cl-berglund')
    expect(thirty.best?.remainingMinutes).toBe(10)
    const sixty = view.timeWindows.find((w) => w.minutes === 60)!.fit
    expect(sixty.best?.action.clientId).toBe('cl-berglund')
    expect(sixty.second?.action.clientId).toBe('cl-grahn')
  })
})

describe('what changed, and the call brief', () => {
  it('reads changes from the record, never from a remembered page', async () => {
    const context = contextAt()
    const nothing = await changesSince(context, '2026-09-22')
    expect(nothing.total).toBe(0)
    await completeCommitment(context, 'co-dah-1')
    const recorded = await recordClientUpdate(context, {
      clientId: 'cl-alvarsson',
      noteText: 'Ringde Henrik. Vi bokade möte 28 oktober.',
    })
    if (!recorded.ok) throw new Error(recorded.code)
    await confirmClientUpdate(context, {
      candidateId: recorded.candidate.id,
      decisions: recorded.candidate.items.map((item) => ({ itemId: item.id, decision: 'confirm' as const })),
    })
    const changes = await changesSince(context, '2026-09-22')
    expect(changes.completedCommitments.map((c) => c.sourceId)).toEqual(['co-dah-1'])
    expect(changes.meetingsBooked.map((c) => [c.clientId, c.date])).toEqual([['cl-alvarsson', '2026-10-28']])
    expect(changes.contactsRecorded.map((c) => c.clientId)).toEqual(['cl-alvarsson'])
    expect(changes.total).toBe(3)
  })

  it('briefs a call from the record: reasons, last contact, concern, promises, three questions, an objective', async () => {
    const brief = await callBrief(contextAt(), 'cl-alvarsson')
    expect(brief).not.toBeNull()
    expect(brief!.action?.actionType).toBe('PREPARE_MEETING')
    expect(brief!.whyNow.length).toBeGreaterThan(0)
    expect(brief!.lastInteraction?.id).toBe('in-alv-3')
    expect(brief!.concerns.map((c) => c.id)).toEqual(['cf-alv-1'])
    expect(brief!.openCommitments.map((c) => c.id)).toEqual(['co-alv-1', 'co-alv-2'])
    expect(brief!.questions.length).toBeGreaterThan(0)
    expect(brief!.questions.length).toBeLessThanOrEqual(3)
    expect(brief!.objective).toBeDefined()
    expect(brief!.time.minMinutes).toBeGreaterThan(0)
    for (const q of brief!.questions) expect(q.sourceIds.length).toBeGreaterThan(0)
    expect(await callBrief(contextAt(), 'cl-nobody')).toBeNull()
  })
})

describe('the closed loop: signal → call → note → confirmed structure → re-rank', () => {
  const confirmAll = async (context: AdvisoryContext, clientId: string, noteText: string) => {
    const recorded = await recordClientUpdate(context, { clientId, noteText })
    if (!recorded.ok) throw new Error(recorded.code)
    const confirmed = await confirmClientUpdate(context, {
      candidateId: recorded.candidate.id,
      decisions: recorded.candidate.items.map((item) => ({ itemId: item.id, decision: 'confirm' as const })),
    })
    if (!confirmed.ok) throw new Error(confirmed.code)
    return { candidate: recorded.candidate, confirmed }
  }

  it('Margareta: the first priority, a call, the promises kept in the note — and she leaves the NU queue', async () => {
    const context = contextAt()
    const before = await dailyCommand(context)
    expect(before.now[0]).toMatchObject({ clientId: 'cl-berglund', actionType: 'FOLLOW_UP_COMMITMENT' })
    const brief = await callBrief(context, 'cl-berglund')
    expect(brief?.openCommitments.map((c) => c.id)).toEqual(['co-ber-1', 'co-ber-2'])

    const { candidate, confirmed } = await confirmAll(
      context,
      'cl-berglund',
      'Pratade med Margareta. Gick igenom pensionsanalysen och avgiftsförslaget. Hon är nöjd. Vi bokade möte 28 oktober.',
    )
    expect(candidate.items.filter((i) => i.kind === 'commitment-completed').map((i) => i.commitmentId)).toEqual([
      'co-ber-1',
      'co-ber-2',
    ])
    expect(confirmed.created).toMatchObject({ completedCommitments: 2, events: 1 })
    /* The note is kept as written; the promises are closed on the day of the call, their provenance untouched. */
    const interactions = await context.repositories.interactions.interactionsOf('cl-berglund')
    expect(interactions[0]?.noteText).toMatch(/^Pratade med Margareta/)
    const kept = await context.repositories.commitments.commitmentById('co-ber-1')
    expect(kept).toMatchObject({ status: 'done', completedAt: TODAY, provenance: { sourceInteractionId: 'in-ber-2' } })

    const after = await dailyCommand(context)
    expect(after.now.map((a) => a.clientId)).not.toContain('cl-berglund')
    const berglund = [...after.now, ...after.week, ...after.watch].find((a) => a.clientId === 'cl-berglund')
    expect(berglund?.reasons.some((r) => r.kind === 'overdue-commitment' || r.kind === 'silence')).not.toBe(true)
    expect(after.now[0]?.clientId).toBe('cl-grahn')
    expect(after.pulse.overdueCommitments).toBe(before.pulse.overdueCommitments - 2)
    expect(after.changes.completedCommitments.map((c) => c.sourceId)).toEqual(['co-ber-1', 'co-ber-2'])
    expect(after.changes.meetingsBooked).toHaveLength(1)
  })

  it('Henrik: the demo note eases the concern, books the meeting, and the market reason leaves his action', async () => {
    const context = contextAt(ENERGY_DOWN)
    const before = [...(await dailyCommand(context)).now, ...(await dailyCommand(context)).week, ...(await dailyCommand(context)).watch].find(
      (a) => a.clientId === 'cl-alvarsson',
    )!
    expect(before.reasons.some((r) => r.kind === 'concern')).toBe(true)
    expect(before.reasons.some((r) => r.kind === 'market')).toBe(true)

    const { candidate, confirmed } = await confirmAll(
      context,
      'cl-alvarsson',
      'Pratade med kunden. Han är lugnare, ligger kvar och vi bokade möte 28 oktober. Vi går även igenom bolånet.',
    )
    expect(candidate.items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['concern-eased', 'next-meeting', 'discussion-topics']),
    )
    expect(confirmed.created).toMatchObject({ easedConcerns: 1, events: 1, contextFacts: 0 })
    const facts = await context.repositories.context.factsOf('cl-alvarsson')
    expect(facts.find((f) => f.id === 'cf-alv-1')).toMatchObject({ status: 'resolved', statusAt: TODAY })

    const after = await dailyCommand(context)
    const henrik = [...after.now, ...after.week, ...after.watch].find((a) => a.clientId === 'cl-alvarsson')
    expect(henrik?.reasons.some((r) => r.kind === 'concern')).not.toBe(true)
    expect(after.changes.concernsEased.map((c) => c.sourceId)).toEqual(['cf-alv-1'])
    expect(after.changes.contactsRecorded.map((c) => c.clientId)).toEqual(['cl-alvarsson'])
    expect(after.changes.meetingsBooked.map((c) => c.clientId)).toEqual(['cl-alvarsson'])
  })
})
