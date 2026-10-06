/**
 * The meeting baseline and the changes since it, planted and asserted:
 * what a snapshot captures, each change category against its threshold
 * with the near miss that stays silent, the record-based fallback without
 * a baseline, and the quiet client the cockpit must be comfortable with.
 */

import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { addDays } from './dates'
import type { Goal } from './goals'
import type { ClientFacts } from './intelligence'
import {
  changesSince,
  fewChanges,
  MEETING_CHANGE_THRESHOLDS,
  snapshotOf,
  type MeetingSnapshot,
} from './meetingSnapshot'
import type { Holding, Portfolio } from './portfolio'
import type {
  Commitment,
  ContextFact,
  ImportantEvent,
  Interaction,
  Provenance,
} from './relationship'
import { balanceSheetOf, type Asset, type Liability } from './wealth'

const TODAY = '2026-09-23'
const MEETING_DAY = addDays(TODAY, -30)

const client: Client = {
  id: 'c1',
  householdId: 'h1',
  officeId: 'o1',
  displayName: 'Test Klient',
  segment: 'private-banking',
  relationshipSince: '2020-01-01',
  primaryAdvisorId: 'adv-martin',
  dateOfBirth: '1970-05-26',
  riskProfile: 4,
  preferredChannel: 'phone',
  annualIncome: null,
  currency: 'SEK',
  lifecycle: { status: 'active', since: '2020-01-01', closure: null },
}

const provenance = (sourceDate = TODAY): Provenance => ({
  origin: 'advisor',
  sourceInteractionId: null,
  sourceText: null,
  sourceDate,
  createdAt: `${sourceDate}T09:00:00.000Z`,
  createdBy: 'adv-martin',
  confidence: 'high',
  confirmedByAdvisor: true,
  confirmedAt: null,
})

const asset = (
  id: string,
  kind: Asset['kind'],
  value: number,
  withBank = true,
): Asset => ({
  id,
  clientId: 'c1',
  kind,
  title: id,
  value,
  valuedAt: TODAY,
  source: withBank ? 'bank' : 'client-stated',
  withBank,
  ...(kind === 'investment-portfolio' ? { portfolioId: 'p1' } : {}),
})

const holding = (
  id: string,
  weightPercent: number,
  assetClass: Holding['assetClass'] = 'equities',
): Holding => ({
  id,
  portfolioId: 'p1',
  name: id,
  assetClass,
  marketValue: weightPercent * 100_000,
  weightPercent,
  performanceYtdPercent: 0,
  role: 'core-equity',
  currency: 'SEK',
  region: 'global',
  sector: 'multi',
})

const portfolio = (equities: number, totalValue = 10_000_000): Portfolio => ({
  id: 'p1',
  clientId: 'c1',
  valuedAt: TODAY,
  source: 'synthetic',
  totalValue,
  benchmarkName: 'B',
  allocation: [
    { assetClass: 'equities', strategicPercent: 60, currentPercent: equities },
    { assetClass: 'fixed-income', strategicPercent: 35, currentPercent: 95 - equities },
    { assetClass: 'cash', strategicPercent: 5, currentPercent: 5 },
  ],
  holdings: [holding('h-eq', equities), holding('h-fi', 95 - equities, 'fixed-income')],
  performance: [],
  performanceYtdPercent: 0,
})

const loan = (
  id: string,
  balance: number,
  maturityInDays: number | null = null,
): Liability => ({
  id,
  clientId: 'c1',
  kind: 'mortgage',
  title: id,
  outstandingBalance: balance,
  interestType: 'fixed',
  ratePercent: 3.5,
  maturityDate: maturityInDays === null ? null : addDays(TODAY, maturityInDays),
  nextReviewDate: null,
  withBank: true,
  valuedAt: TODAY,
})

const goal = (id: string, status: Goal['status'], progressPercent: number): Goal => ({
  id,
  clientId: 'c1',
  kind: 'long-term-growth',
  title: id,
  targetAmount: null,
  targetDate: null,
  priority: 'primary',
  progressPercent,
  associatedAssetIds: [],
  status,
  notes: '',
  assessedAt: TODAY,
})

const meeting = (date: string): Interaction => ({
  id: `in-${date}`,
  clientId: 'c1',
  type: 'meeting',
  date,
  advisorId: 'adv-martin',
  source: 'advisor',
  importance: 'normal',
  title: 'Möte',
  noteText: 'note',
  topics: [],
  keyPoints: [],
  provenance: provenance(date),
})

const commitment = (
  id: string,
  createdAt: string,
  dueDate: string | null,
  status: Commitment['status'] = 'open',
  completedAt: string | null = null,
): Commitment => ({
  id,
  clientId: 'c1',
  title: id,
  createdAt,
  dueDate,
  status,
  priority: 'medium',
  ownerAdvisorId: 'adv-martin',
  completedAt,
  provenance: provenance(createdAt),
})

const event = (
  id: string,
  type: ImportantEvent['type'],
  date: string,
  sourceDate: string,
  liabilityId?: string,
): ImportantEvent => ({
  id,
  clientId: 'c1',
  type,
  title: id,
  date,
  recurring: 'none',
  importance: 'normal',
  notes: '',
  reminderRules: [],
  status: 'upcoming',
  ...(liabilityId ? { liabilityId } : {}),
  provenance: provenance(sourceDate),
})

const fact = (
  id: string,
  category: ContextFact['category'],
  statement: string,
  sourceDate: string,
): ContextFact => ({
  id,
  clientId: 'c1',
  category,
  statement,
  status: 'active',
  statusAt: sourceDate,
  provenance: provenance(sourceDate),
})

const facts = (
  overrides: Partial<ClientFacts> & { assets?: Asset[] } = {},
): ClientFacts => {
  const assets = overrides.assets ?? [
    asset('a-portfolio', 'investment-portfolio', 10_000_000),
    asset('a-cash', 'cash', 1_000_000),
  ]
  const liabilities = overrides.liabilities ?? []
  return {
    client,
    balanceSheet: balanceSheetOf(assets, liabilities),
    portfolio: portfolio(60),
    goals: [goal('g1', 'on-track', 50)],
    interactions: [meeting(MEETING_DAY)],
    contextFacts: [],
    commitments: [],
    events: [],
    opportunities: [],
    liabilities,
    today: TODAY,
    ...overrides,
  }
}

/** The baseline captured at the meeting, from the state as it stood then. */
const baseline = (then: ClientFacts): MeetingSnapshot =>
  snapshotOf(
    { ...then, today: MEETING_DAY },
    `in-${MEETING_DAY}`,
    MEETING_DAY,
    `${MEETING_DAY}T16:00:00.000Z`,
  )

describe('the snapshot', () => {
  it('captures the structured state around the meeting, nothing from the UI', () => {
    const then = facts({
      liabilities: [loan('l1', 5_000_000, 90)],
      commitments: [commitment('c-open', MEETING_DAY, addDays(TODAY, 10))],
      events: [
        event('e-refi', 'mortgage-refinancing', addDays(TODAY, 90), MEETING_DAY, 'l1'),
      ],
      contextFacts: [
        fact('cf-1', 'concern', 'Orolig över energiexponeringen', MEETING_DAY),
      ],
    })
    const snapshot = baseline(then)
    expect(snapshot).toMatchObject({
      id: `snap-in-${MEETING_DAY}`,
      meetingDate: MEETING_DAY,
      financial: {
        totalAssets: 11_000_000,
        totalLiabilities: 5_000_000,
        liquidity: 1_000_000,
      },
      portfolio: { totalValue: 10_000_000 },
      loans: [{ id: 'l1', outstandingBalance: 5_000_000, interestType: 'fixed' }],
      goals: [{ id: 'g1', status: 'on-track', progressPercent: 50 }],
      openCommitmentIds: ['c-open'],
      importantEventIds: ['e-refi'],
      activeConcernIds: ['cf-1'],
      method: 'meeting-snapshot-v1',
    })
    expect(snapshot.allocation?.find((a) => a.assetClass === 'equities')).toEqual({
      assetClass: 'equities',
      currentPercent: 60,
      strategicPercent: 60,
    })
    expect(snapshot.relationship.healthScore).toBeGreaterThan(0)
  })
})

describe('changes since the baseline, against the thresholds', () => {
  it('shows an allocation move at the line and stays silent one point below it', () => {
    const then = facts()
    const snapshot = baseline(then)
    const moved = changesSince(snapshot, facts({ portfolio: portfolio(62) }))
    expect(moved.changes.filter((c) => c.kind === 'allocation')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetClass: 'equities',
          before: 60,
          after: 62,
          points: 2,
        }),
      ]),
    )
    const trivial = changesSince(snapshot, facts({ portfolio: portfolio(61) }))
    expect(trivial.changes.some((c) => c.kind === 'allocation')).toBe(false)
    expect(MEETING_CHANGE_THRESHOLDS.allocationPoints).toBe(2)
  })

  it('portfolio value, liquidity and wealth each need their own threshold', () => {
    const snapshot = baseline(facts())
    const grown = changesSince(snapshot, facts({ portfolio: portfolio(60, 10_140_000) }))
    expect(grown.changes.find((c) => c.kind === 'portfolio-value')).toMatchObject({
      percent: 1.4,
    })
    const flat = changesSince(snapshot, facts({ portfolio: portfolio(60, 10_050_000) }))
    expect(flat.changes.some((c) => c.kind === 'portfolio-value')).toBe(false)

    /* Liquidity needs both the percent and the amount: +20 % of a small balance is not a change. */
    const moreCash = changesSince(
      snapshot,
      facts({
        assets: [
          asset('a-portfolio', 'investment-portfolio', 10_000_000),
          asset('a-cash', 'cash', 1_300_000),
        ],
      }),
    )
    expect(moreCash.changes.find((c) => c.kind === 'liquidity')).toMatchObject({
      before: 1_000_000,
      after: 1_300_000,
    })
    const smallCash = changesSince(
      snapshot,
      facts({
        assets: [
          asset('a-portfolio', 'investment-portfolio', 10_000_000),
          asset('a-cash', 'cash', 1_150_000),
        ],
      }),
    )
    expect(smallCash.changes.some((c) => c.kind === 'liquidity')).toBe(false)

    const richer = changesSince(
      snapshot,
      facts({
        assets: [
          asset('a-portfolio', 'investment-portfolio', 10_000_000),
          asset('a-cash', 'cash', 1_000_000),
          asset('a-house', 'property', 500_000, false),
        ],
      }),
    )
    expect(richer.changes.find((c) => c.kind === 'wealth')).toMatchObject({
      percent: 4.5,
    })
  })

  it('loans: new, closed, and a balance move above the line', () => {
    const snapshot = baseline(
      facts({ liabilities: [loan('l1', 5_000_000), loan('l2', 1_000_000)] }),
    )
    const now = changesSince(
      snapshot,
      facts({ liabilities: [loan('l1', 4_500_000), loan('l3', 2_000_000)] }),
    )
    expect(
      now.changes
        .filter((c) => c.category === 'financing')
        .map((c) => c.kind)
        .sort(),
    ).toEqual(['loan-balance', 'loan-closed', 'loan-new'])
    const steady = changesSince(
      snapshot,
      facts({ liabilities: [loan('l1', 4_900_000), loan('l2', 1_000_000)] }),
    )
    expect(steady.changes.some((c) => c.category === 'financing')).toBe(false)
  })

  it('a financing event that came within the horizon since the meeting is a change; one already inside is not', () => {
    const snapshot = baseline(facts())
    const approaching = changesSince(
      snapshot,
      facts({
        events: [
          event('e-refi', 'mortgage-refinancing', addDays(TODAY, 53), MEETING_DAY),
        ],
      }),
    )
    expect(
      approaching.changes.find((c) => c.kind === 'financing-approaching'),
    ).toMatchObject({
      eventId: 'e-refi',
      daysAhead: 53,
    })
    const alreadyClose = changesSince(
      snapshot,
      facts({
        events: [
          event('e-refi', 'mortgage-refinancing', addDays(TODAY, 20), MEETING_DAY),
        ],
      }),
    )
    expect(alreadyClose.changes.some((c) => c.kind === 'financing-approaching')).toBe(
      false,
    )
  })

  it('goals, health, promises, events and concerns', () => {
    const then = facts({
      goals: [goal('g1', 'on-track', 50), goal('g2', 'on-track', 40)],
      commitments: [
        commitment('c-old', MEETING_DAY, addDays(TODAY, -5)),
        commitment('c-done', MEETING_DAY, null),
      ],
    })
    const snapshot = baseline(then)
    const now = changesSince(
      snapshot,
      facts({
        goals: [goal('g1', 'behind', 50), goal('g2', 'on-track', 46)],
        commitments: [
          commitment('c-old', MEETING_DAY, addDays(TODAY, -5)),
          commitment('c-new', addDays(TODAY, -10), addDays(TODAY, 20)),
          commitment('c-done', MEETING_DAY, null, 'done', addDays(TODAY, -3)),
        ],
        events: [
          event('e-sale', 'company-sale', addDays(TODAY, 100), addDays(TODAY, -10)),
        ],
        contextFacts: [
          fact('cf-new', 'concern', 'Orolig för räntan', addDays(TODAY, -10)),
          fact('cf-obj', 'objective', 'Vill ha likviditet', addDays(TODAY, -10)),
          fact('cf-old', 'preference', 'Föredrar telefon', addDays(TODAY, -100)),
        ],
        interactions: [
          meeting(MEETING_DAY),
          { ...meeting(addDays(TODAY, -10)), id: 'in-call', type: 'phone' },
        ],
      }),
    )
    const kinds = now.changes.map((c) => c.kind)
    expect(kinds).toEqual(
      expect.arrayContaining([
        'goal-status',
        'goal-progress',
        'health',
        'contacts',
        'commitments',
        'event-new',
        'concern-new',
        'context-new',
      ]),
    )
    expect(now.changes.find((c) => c.kind === 'commitments')).toMatchObject({
      createdIds: ['c-new'],
      completedIds: ['c-done'],
      overdueIds: ['c-old'],
    })
    /* The old preference predates the meeting and is not a change. */
    expect(
      now.changes.some((c) => c.kind === 'context-new' && c.contextFactId === 'cf-old'),
    ).toBe(false)
  })
})

describe('without a baseline', () => {
  it('compares only what the record itself dates, and says no baseline exists', () => {
    const now = changesSince(
      null,
      facts({
        portfolio: portfolio(70),
        commitments: [commitment('c-new', addDays(TODAY, -10), addDays(TODAY, 20))],
      }),
    )
    expect(now.baseline).toBeNull()
    expect(now.gaps).toEqual(['no-baseline'])
    expect(now.since).toBe(MEETING_DAY)
    expect(now.changes.some((c) => c.kind === 'allocation')).toBe(false)
    expect(now.changes.find((c) => c.kind === 'commitments')).toMatchObject({
      createdIds: ['c-new'],
    })
  })

  it('without a recorded meeting either, the window is thirty days and both gaps are named', () => {
    const now = changesSince(null, facts({ interactions: [] }))
    expect(now.gaps).toEqual(['no-baseline', 'no-recorded-meeting'])
    expect(now.since).toBe(addDays(TODAY, -30))
  })
})

describe('the quiet client', () => {
  it('has few changes when nothing crossed a threshold', () => {
    const then = facts()
    const now = changesSince(
      baseline(then),
      facts({ portfolio: portfolio(61, 10_050_000) }),
    )
    expect(fewChanges(now)).toBe(true)
    expect(now.changes).toEqual([])
  })
})
