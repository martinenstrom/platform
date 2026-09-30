/**
 * The Meeting Cockpit over the synthetic seed on the frozen clock: the
 * rich client, the client with overdue promises, the quiet conservative
 * client, the client with a liquidity event, the client without a baseline;
 * the market history since the meeting including an expired event that
 * boosts nothing; the meeting-scoped questions; and the flow meeting A →
 * confirmed → baseline captured → meeting B shows the change.
 */

import { describe, expect, it } from 'vitest'
import type { MarketCategory, MarketObservation } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { completeCommitment } from './completeCommitment'
import { confirmClientUpdate } from './confirmClientUpdate'
import { askBeforeMeeting, meetingCockpit } from './meetingCockpit'
import type { AdvisoryContext } from './ports'
import { recordClientUpdate } from './recordClientUpdate'

const TODAY = '2026-09-23'
const NOW = `${TODAY}T07:30:00.000Z`

const obs = (
  symbol: string,
  category: MarketCategory,
  change: number,
  tags: MarketObservation['tags'] = {},
  extra: Partial<MarketObservation> = {},
): MarketObservation => ({
  symbol,
  category,
  label: symbol,
  value: category === 'risk-appetite' ? 50 + change : 100,
  change,
  changeUnit:
    category === 'rates' ? 'bp' : category === 'risk-appetite' ? 'points' : 'percent',
  observedAt: NOW,
  source: 'test',
  quality: 'live',
  tags,
  ...extra,
})

const ENERGY_DOWN = [
  obs('sector:energy', 'sectors', -4.5, { sector: 'energy' }, { reference: 0.41 }),
  obs('cmd:brent', 'commodities', -5.2, { commodityClass: 'energy' }),
]
const SELLOFF = [
  obs('idx:nasdaq100', 'equities', -3.2, { region: 'us' }),
  obs('idx:sp500', 'equities', -2.4, { region: 'us' }),
]

type TestContext = AdvisoryContext & {
  setMarket(next: readonly MarketObservation[]): void
  setNow(iso: string): void
}

function contextWith(observations: readonly MarketObservation[] = []): TestContext {
  let current = observations
  const context: TestContext = {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(NOW),
    market: {
      scenario: null,
      async observe() {
        return current
      },
    },
    setMarket(next) {
      current = next
    },
    setNow(iso) {
      context.clock = new FakeClock(iso)
    },
  }
  return context
}

describe('Henrik — the rich cockpit', () => {
  it('names one focus, compares against the September baseline, and grounds every question', async () => {
    const cockpit = (await meetingCockpit(contextWith(ENERGY_DOWN), 'cl-alvarsson'))!
    expect(cockpit.meeting).toMatchObject({ mode: 'scheduled', daysAhead: 10 })
    expect(cockpit.baseline).toMatchObject({
      id: 'snap-in-alv-3',
      meetingDate: '2026-09-12',
    })

    expect(cockpit.focus.primary.kind).toBe('refinancing')
    expect(cockpit.focus.supporting.map((t) => t.kind)).toEqual([
      'concern-with-market',
      'strategy-drift',
    ])

    const kinds = cockpit.changes.changes.map((c) => c.kind)
    expect(kinds).toEqual(
      expect.arrayContaining([
        'portfolio-value',
        'allocation',
        'liquidity',
        'wealth',
        'financing-approaching',
      ]),
    )
    expect(
      cockpit.changes.changes.find(
        (c) => c.kind === 'allocation' && c.assetClass === 'equities',
      ),
    ).toMatchObject({
      before: 65,
      after: 67,
    })
    expect(cockpit.changes.changes.find((c) => c.kind === 'liquidity')).toMatchObject({
      before: 5_900_000,
      after: 6_800_000,
    })
    expect(
      cockpit.changes.changes.find((c) => c.kind === 'financing-approaching'),
    ).toMatchObject({
      eventId: 'ev-alv-refi',
      daysAhead: 53,
    })
    /* Promises made at the meeting are in the baseline, so nothing was "created since". */
    expect(cockpit.changes.changes.some((c) => c.kind === 'commitments')).toBe(false)

    expect(
      cockpit.market.map((m) => [m.item.impact.event.symbol, m.exposureBasis]),
    ).toEqual([
      ['sector:energy', 'active'],
      ['cmd:brent', 'active'],
    ])

    expect(cockpit.clientQuestions.map((q) => [q.kind, q.confidence])).toEqual(
      expect.arrayContaining([
        ['energy-holding', 'high'],
        ['mortgage', 'high'],
        ['cash', 'medium'],
      ]),
    )
    const energy = cockpit.clientQuestions.find((q) => q.kind === 'energy-holding')!
    expect(energy.triggers.map((t) => t.kind)).toEqual([
      'concern',
      'market-event',
      'holding',
    ])
    expect(energy.sourceIds).toContain('cf-alv-1')

    expect(cockpit.advisorQuestions.map((q) => q.kind)).toEqual(
      expect.arrayContaining([
        'liquidity-intention',
        'refinancing-view',
        'concern-nature',
        'external-assets',
      ]),
    )
    expect(
      cockpit.advisorQuestions.find((q) => q.kind === 'concern-nature'),
    ).toMatchObject({
      topic: 'energy',
      sourceIds: ['cf-alv-1'],
    })
    expect(cockpit.advisorQuestions.length).toBeLessThanOrEqual(5)

    expect(cockpit.opportunities.find((o) => o.kind === 'external-assets')).toMatchObject(
      {
        amount: 30_600_000,
      },
    )
    expect(cockpit.risks.map((r) => r.kind)).toContain('stale-valuation')
    expect(cockpit.dataQuality.find((d) => d.kind === 'stale-valuation')).toMatchObject({
      label: 'Alvarsson Holding AB',
      daysOld: 200,
    })
    expect(cockpit.agenda.map((a) => a.kind)).toEqual([
      'follow-up',
      'strategy',
      'concern-market',
      'financing',
      'liquidity',
      'promises',
      'opportunities',
      'next-steps',
    ])
    expect(cockpit.objectives.map((o) => o.kind)).toEqual([
      'confirm-risk',
      'clarify-liquidity',
      'agree-refinancing-step',
      'close-commitment',
    ])
    expect(cockpit.materials.map((m) => m.kind)).toEqual(
      expect.arrayContaining([
        'portfolio-comparison',
        'mortgage-alternatives',
        'cash-deployment-illustration',
        'valuation-request',
      ]),
    )
    expect(cockpit.promises.map((p) => [p.commitment.id, p.bucket])).toEqual([
      ['co-alv-1', 'due-before-meeting'],
      ['co-alv-2', 'later'],
    ])
    expect(cockpit.sentinelEntry?.priority.theme).toBe('meeting-preparation')
    expect(cockpit.sources).toContain('cf-alv-1')
    expect(cockpit.titles['co-alv-1']).toBe(
      'Ta fram jämförelse av två alternativ till energifonden',
    )
  })

  it('never lists the same question, opportunity or agenda item twice', async () => {
    const cockpit = (await meetingCockpit(contextWith(ENERGY_DOWN), 'cl-alvarsson'))!
    const unique = (xs: readonly string[]) => new Set(xs).size === xs.length
    expect(unique(cockpit.clientQuestions.map((q) => q.kind))).toBe(true)
    expect(unique(cockpit.advisorQuestions.map((q) => q.kind))).toBe(true)
    expect(unique(cockpit.opportunities.map((o) => o.kind))).toBe(true)
    expect(unique(cockpit.agenda.map((a) => a.id))).toBe(true)
    expect(unique(cockpit.materials.map((m) => m.kind))).toBe(true)
  })
})

describe('Margareta — overdue promises and a strained relationship', () => {
  it('leads with the relationship, lists the overdue promises first, and prepares for the fee question', async () => {
    const cockpit = (await meetingCockpit(contextWith(), 'cl-berglund'))!
    expect(cockpit.meeting.mode).toBe('unscheduled')
    expect(cockpit.focus.primary.kind).toBe('relationship-risk')
    expect(
      cockpit.promises.filter((p) => p.bucket === 'overdue').map((p) => p.commitment.id),
    ).toEqual(['co-ber-1', 'co-ber-2'])
    expect(cockpit.risks[0]).toMatchObject({
      kind: 'overdue-promise',
      label: 'Återkomma med pensionsanalys',
    })
    expect(cockpit.changes.changes.find((c) => c.kind === 'health')).toMatchObject({
      before: 68,
      after: 45,
    })
    expect(cockpit.changes.changes.find((c) => c.kind === 'commitments')).toMatchObject({
      overdueIds: ['co-ber-1', 'co-ber-2'],
    })
    expect(cockpit.changes.changes.find((c) => c.kind === 'goal-status')).toMatchObject({
      goalId: 'go-ber-2',
      after: 'at-risk',
    })
    expect(cockpit.clientQuestions.find((q) => q.kind === 'fee')).toMatchObject({
      confidence: 'high',
    })
    expect(cockpit.clientQuestions.map((q) => q.kind)).toEqual(
      expect.arrayContaining(['pension', 'gifts']),
    )
    expect(cockpit.materials.map((m) => m.kind)).toEqual(
      expect.arrayContaining(['pension-overview', 'fee-overview']),
    )
  })
})

describe('Ingrid — the quiet conservative client', () => {
  it('is comfortable saying there is little to report', async () => {
    const cockpit = (await meetingCockpit(contextWith(), 'cl-forsell'))!
    expect(cockpit.changes.changes).toEqual([])
    expect(cockpit.market).toEqual([])
    expect(cockpit.clientQuestions).toEqual([])
    expect(cockpit.strategy.observations).toEqual([])
    expect(cockpit.financing).toEqual([])
    expect(cockpit.focus.primary.kind).toBe('next-generation')
    expect(cockpit.advisorQuestions.map((q) => q.kind)).toEqual(
      expect.arrayContaining([
        'retirement-timeline',
        'external-assets',
        'next-generation',
      ]),
    )
    expect(cockpit.opportunities.map((o) => o.kind)).toContain('next-generation')
    expect(cockpit.risks.map((r) => r.kind)).toContain('family-event')
  })
})

describe('the Dahlqvists — a maturing bridge loan and a long time since the baseline', () => {
  it('shows the new loan, the new concern, the new promise and the maturity as the focus', async () => {
    const cockpit = (await meetingCockpit(contextWith(), 'cl-dahlqvist'))!
    expect(cockpit.focus.primary.kind).toBe('loan-maturity')
    const kinds = cockpit.changes.changes.map((c) => c.kind)
    expect(kinds).toEqual(
      expect.arrayContaining([
        'loan-new',
        'concern-new',
        'event-new',
        'commitments',
        'health',
        'financing-approaching',
        'goal-status',
      ]),
    )
    expect(cockpit.changes.changes.find((c) => c.kind === 'loan-new')).toMatchObject({
      loanId: 'li-dah-bridge',
    })
    expect(cockpit.financing[0]).toMatchObject({
      questionKind: 'maturity-plan',
      daysAhead: 45,
    })
    expect(cockpit.financing[0]!.discussedDaysAgo).toBe(20)
    expect(cockpit.materials.map((m) => m.kind)).toContain('financing-proposal')
  })
})

describe('Johan — no recorded meeting, no baseline, a liquidity event ahead', () => {
  it('says plainly that no baseline exists and still prepares the proceeds conversation', async () => {
    const cockpit = (await meetingCockpit(contextWith(), 'cl-ceder'))!
    expect(cockpit.baseline).toBeNull()
    expect(cockpit.changes.gaps).toEqual(['no-baseline', 'no-recorded-meeting'])
    expect(cockpit.changes.since).toBe('2026-08-24')
    expect(cockpit.changes.changes.some((c) => c.kind === 'allocation')).toBe(false)
    expect(cockpit.clientQuestions.map((q) => q.kind)).toContain('proceeds')
    expect(cockpit.advisorQuestions.map((q) => q.kind)).toContain('proceeds-plan')
    expect(cockpit.opportunities.map((o) => o.kind)).toContain('proceeds')
    expect(cockpit.objectives.map((o) => o.kind)).toContain('plan-proceeds')
  })
})

describe('market history in the cockpit', () => {
  it('lists an expired move as history judged against current exposure, while Sentinel no longer counts it', async () => {
    const context = contextWith(SELLOFF)
    const during = (await meetingCockpit(context, 'cl-ekstrand'))!
    expect(during.sentinelEntry?.priority.theme).toBe('market-impact')
    expect(during.market[0]).toMatchObject({ exposureBasis: 'active' })

    context.setNow('2026-09-24T13:30:00.000Z')
    context.setMarket([])
    const after = (await meetingCockpit(context, 'cl-ekstrand'))!
    expect(after.sentinelEntry).toBeNull()
    const nasdaq = after.market.find(
      (m) => m.item.impact.event.symbol === 'idx:nasdaq100',
    )!
    expect(nasdaq.item).toMatchObject({ status: 'closed', closeReason: 'expired' })
    expect(nasdaq.exposureBasis).toBe('current-recorded')
    /* Ekstrand's baseline was captured before the move opened, so it can be quoted beside it. */
    expect(nasdaq.baselineAllocation).toEqual([
      { assetClass: 'equities', percent: 72 },
      { assetClass: 'fixed-income', percent: 13 },
    ])
    expect(nasdaq.discussionKind).toBe('explain-thesis')
    expect(after.clientQuestions.map((q) => q.kind)).toContain('performance')
  })
})

describe('asking before the meeting', () => {
  it('routes each kind of question to the cockpit, and what the client said to the memory', async () => {
    const context = contextWith(ENERGY_DOWN)
    const ask = (question: string) =>
      askBeforeMeeting(context, { clientId: 'cl-alvarsson', question })
    const promises = await ask('Vad har jag inte gjort?')
    expect(promises.ok && promises.answer.kind).toBe('promises')
    const changes = await ask('Vad har förändrats sedan senaste mötet?')
    expect(changes.ok && changes.answer.kind).toBe('changes')
    const market = await ask('Vilka marknadsrörelser bör jag kunna förklara?')
    expect(
      market.ok && market.answer.kind === 'market' && market.answer.market.length,
    ).toBe(2)
    const agenda = await ask('Varför står finansieringen på agendan?')
    expect(agenda.ok && agenda.answer.kind).toBe('agenda')
    const said = await ask('Vad sa klienten om energi senast?')
    expect(said.ok && said.answer.kind === 'memory' && said.answer.answer.topic).toBe(
      'energi',
    )
    expect(await ask('   ')).toEqual({ ok: false, code: 'EMPTY_QUESTION' })
  })
})

describe('meeting A → baseline → meeting B', () => {
  it('captures the baseline when a meeting is confirmed, and the next preparation compares against it', async () => {
    const context = contextWith()
    const before = (await meetingCockpit(context, 'cl-alvarsson'))!
    expect(before.baseline?.meetingDate).toBe('2026-09-12')

    const recorded = await recordClientUpdate(context, {
      clientId: 'cl-alvarsson',
      noteText:
        'Träffade Henrik i dag. Vi gick igenom energiexponeringen. Jag lovade att skicka jämförelsen på fredag.',
      interactionType: 'meeting',
    })
    expect(recorded.ok).toBe(true)
    if (!recorded.ok) return
    const confirmed = await confirmClientUpdate(context, {
      candidateId: recorded.candidate.id,
      decisions: recorded.candidate.items.map((item) => ({
        itemId: item.id,
        decision: 'confirm',
      })),
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return

    const snapshot = await context.repositories.meetingSnapshots.latestFor('cl-alvarsson')
    expect(snapshot).toMatchObject({
      id: `snap-${confirmed.interactionId}`,
      meetingDate: TODAY,
      portfolio: { totalValue: 14_200_000 },
    })
    expect(
      snapshot!.allocation?.find((a) => a.assetClass === 'equities')?.currentPercent,
    ).toBe(67)

    /* Right after the meeting: the new baseline, and nothing changed yet. */
    const afterMeeting = (await meetingCockpit(context, 'cl-alvarsson'))!
    expect(afterMeeting.baseline?.meetingDate).toBe(TODAY)
    expect(afterMeeting.lastMeeting?.id).toBe(confirmed.interactionId)
    expect(afterMeeting.changes.changes.filter((c) => c.kind !== 'contacts')).toEqual([])

    /* The record moves on: a promise is kept. Meeting B sees exactly that. */
    expect(await completeCommitment(context, 'co-alv-1')).toEqual({ ok: true })
    const meetingB = (await meetingCockpit(context, 'cl-alvarsson'))!
    expect(meetingB.changes.changes.find((c) => c.kind === 'commitments')).toMatchObject({
      completedIds: ['co-alv-1'],
      createdIds: [],
    })
    expect(meetingB.promises.find((p) => p.commitment.id === 'co-alv-1')?.bucket).toBe(
      'completed-since',
    )
  })

  it('a confirmed call is not a meeting and leaves the baseline alone', async () => {
    const context = contextWith()
    const recorded = await recordClientUpdate(context, {
      clientId: 'cl-alvarsson',
      noteText: 'Ringde Henrik om räntan.',
      interactionType: 'phone',
    })
    if (!recorded.ok) throw new Error('record failed')
    await confirmClientUpdate(context, {
      candidateId: recorded.candidate.id,
      decisions: [],
    })
    const snapshot = await context.repositories.meetingSnapshots.latestFor('cl-alvarsson')
    expect(snapshot?.id).toBe('snap-in-alv-3')
  })
})
