/**
 * The rules, read against planted facts.
 *
 * Every rule is asserted with the case that fires it and the near miss that
 * must not: an overdue promise and a promise due tomorrow, a drift of 7
 * points and one of 3, silence of 61 days and of 59. The score is asserted
 * to the point, from the drivers the function names, so the number can be
 * added up by hand.
 */

import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import {
  clientFlags,
  INTELLIGENCE_THRESHOLDS,
  nextBestAction,
  relationshipHealth,
  remindersDue,
  signalsFor,
  upcomingEvents,
  type ClientFacts,
} from './intelligence'
import type { Commitment, ImportantEvent, Interaction, Provenance } from './relationship'
import { balanceSheetOf, type Asset } from './wealth'
import type { Portfolio } from './portfolio'

const TODAY = '2026-09-23'

const client: Client = {
  id: 'c1',
  householdId: 'h1',
  officeId: 'o1',
  displayName: 'Test Klient',
  segment: 'private-banking',
  relationshipSince: '2020-01-01',
  primaryAdvisorId: 'adv-martin',
  dateOfBirth: '1970-10-01',
  riskProfile: 4,
  preferredChannel: 'phone',
  annualIncome: null,
  currency: 'SEK',
  lifecycle: { status: 'active', since: '2020-01-01', closure: null },
}

const provenance: Provenance = {
  origin: 'advisor',
  sourceInteractionId: null,
  sourceText: null,
  sourceDate: TODAY,
  createdAt: `${TODAY}T09:00:00.000Z`,
  createdBy: 'adv-martin',
  confidence: 'high',
  confirmedByAdvisor: true,
  confirmedAt: null,
}

function interaction(
  date: string,
  type: Interaction['type'] = 'meeting',
  amount?: number,
): Interaction {
  return {
    id: `i-${date}-${type}`,
    clientId: 'c1',
    type,
    date,
    advisorId: 'adv-martin',
    source: 'advisor',
    importance: 'normal',
    title: type,
    noteText: 'note',
    topics: [],
    keyPoints: [],
    amount,
    provenance,
  }
}

function commitment(
  dueDate: string | null,
  status: Commitment['status'] = 'open',
): Commitment {
  return {
    id: `co-${dueDate}`,
    clientId: 'c1',
    title: 'Skicka förslag',
    createdAt: '2026-09-01',
    dueDate,
    status,
    priority: 'medium',
    ownerAdvisorId: 'adv-martin',
    completedAt: null,
    provenance,
  }
}

function event(
  type: ImportantEvent['type'],
  date: string,
  recurring: ImportantEvent['recurring'] = 'none',
): ImportantEvent {
  return {
    id: `ev-${type}-${date}`,
    clientId: 'c1',
    type,
    title: type,
    date,
    recurring,
    importance: 'normal',
    notes: '',
    reminderRules: [{ daysBefore: 7 }],
    status: 'upcoming',
    provenance,
  }
}

const assets: Asset[] = [
  {
    id: 'a1',
    clientId: 'c1',
    kind: 'investment-portfolio',
    title: 'Portfölj',
    value: 10_000_000,
    valuedAt: TODAY,
    source: 'bank',
    withBank: true,
    portfolioId: 'p1',
  },
  {
    id: 'a2',
    clientId: 'c1',
    kind: 'cash',
    title: 'Kassa',
    value: 500_000,
    valuedAt: TODAY,
    source: 'bank',
    withBank: true,
  },
]

function portfolioWith(equitiesCurrent: number): Portfolio {
  return {
    id: 'p1',
    clientId: 'c1',
    valuedAt: TODAY,
    source: 'synthetic',
    totalValue: 10_000_000,
    benchmarkName: 'Bench',
    allocation: [
      { assetClass: 'equities', strategicPercent: 60, currentPercent: equitiesCurrent },
      {
        assetClass: 'fixed-income',
        strategicPercent: 40,
        currentPercent: 100 - equitiesCurrent,
      },
    ],
    holdings: [],
    performance: [],
    performanceYtdPercent: 0,
  }
}

function facts(overrides: Partial<ClientFacts> = {}): ClientFacts {
  return {
    client,
    balanceSheet: balanceSheetOf(assets, []),
    portfolio: null,
    goals: [],
    interactions: [interaction('2026-09-12')],
    contextFacts: [],
    commitments: [],
    events: [event('client-meeting', '2026-10-03')],
    opportunities: [],
    liabilities: [],
    today: TODAY,
    ...overrides,
  }
}

describe('relationship health', () => {
  it('adds up from its drivers: a healthy relationship scores 100', () => {
    const health = relationshipHealth(facts())
    expect(health.drivers.map((d) => d.kind)).toEqual([
      'recent-contact',
      'recent-meeting',
      'no-overdue-commitments',
      'next-meeting-booked',
      'no-open-concerns',
    ])
    expect(health.score).toBe(100)
    expect(health.band).toBe('strong')
  })

  it('loses 10 for one overdue promise and the 5 it would otherwise earn', () => {
    const health = relationshipHealth(facts({ commitments: [commitment('2026-09-20')] }))
    expect(health.drivers.find((d) => d.kind === 'overdue-commitments')?.points).toBe(10)
    expect(
      health.drivers.find((d) => d.kind === 'no-overdue-commitments'),
    ).toBeUndefined()
    expect(health.score).toBe(85)
  })

  it('a promise due tomorrow is not overdue', () => {
    const health = relationshipHealth(facts({ commitments: [commitment('2026-09-24')] }))
    expect(health.drivers.find((d) => d.kind === 'overdue-commitments')).toBeUndefined()
    expect(health.score).toBe(100)
  })

  it('falls to at-risk after a long silence with an open concern', () => {
    const health = relationshipHealth(
      facts({
        interactions: [interaction('2026-05-01')],
        events: [],
        contextFacts: [
          {
            id: 'f1',
            clientId: 'c1',
            category: 'concern',
            statement: 'Orolig',
            status: 'active',
            statusAt: TODAY,
            provenance,
          },
        ],
      }),
    )
    /* 70 + 5 (no overdue) − 8 (concern) − 20 (lapsed) = 47 */
    expect(health.score).toBe(47)
    expect(health.band).toBe('at-risk')
  })
})

describe('signals and their order', () => {
  it('an overdue promise outranks everything', () => {
    const f = facts({
      commitments: [commitment('2026-09-20')],
      portfolio: portfolioWith(68),
    })
    const signals = signalsFor(f)
    expect(signals[0]?.kind).toBe('overdue-commitment')
    expect(signals[0]?.priority).toBe('high')
    expect(nextBestAction(f)?.urgency).toBe(1)
    expect(nextBestAction(f)?.dueDate).toBe('2026-09-20')
  })

  it('a promise due within a week is due soon, not overdue', () => {
    const signals = signalsFor(
      facts({ commitments: [commitment('2026-09-26')], events: [] }),
    )
    expect(signals.map((s) => s.kind)).toContain('commitment-due-soon')
    expect(signals.map((s) => s.kind)).not.toContain('overdue-commitment')
  })

  it(`drift of ${INTELLIGENCE_THRESHOLDS.driftPoints} points is a signal; 3 points is not`, () => {
    expect(
      signalsFor(facts({ portfolio: portfolioWith(67) })).map((s) => s.kind),
    ).toContain('allocation-drift')
    expect(
      signalsFor(facts({ portfolio: portfolioWith(63) })).map((s) => s.kind),
    ).not.toContain('allocation-drift')
  })

  it('silence past the threshold is a signal; just under is not', () => {
    const lapsed = signalsFor(
      facts({ interactions: [interaction('2026-07-24')], events: [] }),
    )
    expect(lapsed.find((s) => s.kind === 'no-recent-contact')).toMatchObject({
      days: 61,
      priority: 'medium',
    })
    const fine = signalsFor(
      facts({ interactions: [interaction('2026-07-26')], events: [] }),
    )
    expect(fine.map((s) => s.kind)).not.toContain('no-recent-contact')
  })

  it('a refinancing within 60 days is a signal, with its date', () => {
    const signals = signalsFor(
      facts({ events: [event('mortgage-refinancing', '2026-11-15')] }),
    )
    expect(signals.find((s) => s.kind === 'refinancing-approaching')).toMatchObject({
      date: '2026-11-15',
      daysAhead: 53,
      priority: 'medium',
    })
    expect(
      signalsFor(facts({ events: [event('mortgage-refinancing', '2027-01-15')] })).map(
        (s) => s.kind,
      ),
    ).not.toContain('refinancing-approaching')
  })

  it('excess cash needs a growth goal or a large share', () => {
    const cashHeavy: Asset[] = [
      {
        id: 'a1',
        clientId: 'c1',
        kind: 'investment-portfolio',
        title: 'Portfölj',
        value: 10_000_000,
        valuedAt: TODAY,
        source: 'bank',
        withBank: true,
      },
      {
        id: 'a2',
        clientId: 'c1',
        kind: 'cash',
        title: 'Kassa',
        value: 2_000_000,
        valuedAt: TODAY,
        source: 'bank',
        withBank: true,
      },
    ]
    const withoutGoal = signalsFor(facts({ balanceSheet: balanceSheetOf(cashHeavy, []) }))
    expect(withoutGoal.map((s) => s.kind)).not.toContain('excess-cash')
    const withGoal = signalsFor(
      facts({
        balanceSheet: balanceSheetOf(cashHeavy, []),
        goals: [
          {
            id: 'g1',
            clientId: 'c1',
            kind: 'long-term-growth',
            title: 'Tillväxt',
            targetAmount: null,
            targetDate: null,
            priority: 'primary',
            progressPercent: 10,
            associatedAssetIds: [],
            status: 'on-track',
            notes: '',
            assessedAt: TODAY,
          },
        ],
      }),
    )
    expect(withGoal.find((s) => s.kind === 'excess-cash')).toMatchObject({
      amount: 2_000_000,
      sharePercent: 17,
    })
  })

  it('nothing to do means no next best action', () => {
    expect(nextBestAction(facts({ events: [] }))).toBeNull()
  })
})

describe('events and reminders', () => {
  it('a yearly birthday occurs next on its coming date', () => {
    const upcoming = upcomingEvents(
      facts({ events: [event('birthday', '1970-10-01', 'yearly')] }),
    )
    expect(upcoming[0]?.occursOn).toBe('2026-10-01')
  })

  it('reminders fall the stated days before, within the horizon', () => {
    const reminders = remindersDue(
      facts({
        events: [
          {
            ...event('mortgage-refinancing', '2026-10-20'),
            reminderRules: [{ daysBefore: 30 }, { daysBefore: 7 }],
          },
        ],
      }),
      30,
    )
    expect(reminders.map((r) => r.remindAt)).toEqual(
      ['2026-09-20', '2026-10-13'].filter((d) => d >= TODAY),
    )
  })
})

describe('list flags', () => {
  it('a strong relationship with nothing due raises no attention flag', () => {
    const f = facts({ events: [] })
    const health = relationshipHealth(f)
    const flags = clientFlags(f, signalsFor(f, health), health)
    expect(flags.needsAttention).toBe(false)
    expect(flags.openCommitment).toBe(false)
  })

  it('an overdue promise flags attention and the commitment filters', () => {
    const f = facts({ commitments: [commitment('2026-09-20')] })
    const health = relationshipHealth(f)
    const flags = clientFlags(f, signalsFor(f, health), health)
    expect(flags).toMatchObject({
      needsAttention: true,
      openCommitment: true,
      overdueCommitment: true,
    })
  })
})
