/**
 * Sentinel's rules, planted and asserted: each anchor with the case that
 * fires it, the collisions the review named, the dedupe that makes one
 * priority per client, the resolutions that come from the facts, and the
 * silence a healthy relationship earns.
 */

import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import type { ClientFacts } from './intelligence'
import type {
  Commitment,
  ContextFact,
  ImportantEvent,
  Interaction,
  Opportunity,
  Provenance,
} from './relationship'
import {
  comparePriorities,
  prioritiseClient,
  SENTINEL_THRESHOLDS,
  statusOf,
  type SentinelDisposition,
} from './sentinel'
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
  dateOfBirth: '1970-09-26',
  riskProfile: 4,
  preferredChannel: 'phone',
  annualIncome: null,
  currency: 'SEK',
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

const interaction = (
  date: string,
  type: Interaction['type'] = 'meeting',
  topics: Interaction['topics'] = [],
): Interaction => ({
  id: `i-${date}-${type}`,
  clientId: 'c1',
  type,
  date,
  advisorId: 'adv-martin',
  source: 'advisor',
  importance: 'normal',
  title: type,
  noteText: 'note',
  topics,
  keyPoints: [],
  provenance: provenance(date),
})

const commitment = (
  id: string,
  dueDate: string | null,
  status: Commitment['status'] = 'open',
): Commitment => ({
  id,
  clientId: 'c1',
  title: `Löfte ${id}`,
  createdAt: '2026-09-01',
  dueDate,
  status,
  priority: 'medium',
  ownerAdvisorId: 'adv-martin',
  completedAt: status === 'done' ? TODAY : null,
  provenance: provenance('2026-09-01'),
})

const event = (
  id: string,
  type: ImportantEvent['type'],
  date: string,
  extra: Partial<ImportantEvent> = {},
): ImportantEvent => ({
  id,
  clientId: 'c1',
  type,
  title: `Händelse ${id}`,
  date,
  recurring: type === 'birthday' ? 'yearly' : 'none',
  importance: 'normal',
  notes: '',
  reminderRules: [],
  status: 'upcoming',
  provenance: provenance('2026-09-01'),
  ...extra,
})

const concern = (id: string, sourceDate: string): ContextFact => ({
  id,
  clientId: 'c1',
  category: 'concern',
  statement: 'Orolig över energiexponeringen',
  status: 'active',
  statusAt: sourceDate,
  provenance: provenance(sourceDate),
})

const opportunity = (id: string, expectedDate: string | null): Opportunity => ({
  id,
  clientId: 'c1',
  type: 'investment',
  title: `Möjlighet ${id}`,
  potentialValue: 2_000_000,
  probabilityPercent: 50,
  status: 'identified',
  basis: '',
  nextAction: '',
  ownerAdvisorId: 'adv-martin',
  expectedDate,
  provenance: provenance('2026-09-01'),
})

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
    value: 400_000,
    valuedAt: TODAY,
    source: 'bank',
    withBank: true,
  },
]

const portfolioWith = (equitiesCurrent: number): Portfolio => ({
  id: 'p1',
  clientId: 'c1',
  valuedAt: TODAY,
  source: 'synthetic',
  totalValue: 10_000_000,
  benchmarkName: 'B',
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
})

/** A quiet, healthy relationship: spoke ten days ago, nothing due, nothing booked. */
const quiet = (overrides: Partial<ClientFacts> = {}): ClientFacts => ({
  client,
  balanceSheet: balanceSheetOf(assets, []),
  portfolio: portfolioWith(61),
  goals: [],
  interactions: [interaction('2026-09-13')],
  contextFacts: [],
  commitments: [],
  events: [],
  opportunities: [],
  liabilities: [],
  today: TODAY,
  ...overrides,
})

describe('a healthy client with nothing relevant', () => {
  it('has no priority at all', () => {
    expect(prioritiseClient(quiet())).toBeNull()
  })

  it('an opportunity with no near date does not become a reason to call', () => {
    expect(
      prioritiseClient(quiet({ opportunities: [opportunity('o1', '2027-06-01')] })),
    ).toBeNull()
    expect(
      prioritiseClient(quiet({ opportunities: [opportunity('o2', null)] })),
    ).toBeNull()
  })

  it('a timely opportunity stands alone, low and watched', () => {
    const p = prioritiseClient(
      quiet({ opportunities: [opportunity('o1', '2026-10-20')] }),
    )
    expect(p).toMatchObject({
      theme: 'opportunity',
      severity: 'low',
      horizon: 'watch',
      dueAt: '2026-10-20',
    })
  })
})

describe('promises', () => {
  it('an overdue promise is critical, today, and named after the most overdue', () => {
    const p = prioritiseClient(
      quiet({
        commitments: [
          commitment('c-late', '2026-09-20'),
          commitment('c-later', '2026-09-10'),
        ],
      }),
    )
    expect(p).toMatchObject({
      theme: 'overdue-commitment',
      severity: 'critical',
      horizon: 'today',
      dueAt: '2026-09-10',
    })
    expect(p?.primary).toMatchObject({
      kind: 'overdue-commitment',
      commitmentId: 'c-later',
      daysOverdue: 13,
    })
    expect(p?.sourceIds).toEqual(['c-late', 'c-later'])
  })

  it('a promise due today or tomorrow is critical; within a week high and upcoming; later, nothing', () => {
    expect(
      prioritiseClient(quiet({ commitments: [commitment('c', TODAY)] })),
    ).toMatchObject({ theme: 'commitment-due', severity: 'critical', horizon: 'today' })
    expect(
      prioritiseClient(quiet({ commitments: [commitment('c', '2026-09-24')] })),
    ).toMatchObject({ theme: 'commitment-due', severity: 'critical' })
    expect(
      prioritiseClient(quiet({ commitments: [commitment('c', '2026-09-28')] })),
    ).toMatchObject({ theme: 'commitment-due', severity: 'high', horizon: 'upcoming' })
    expect(
      prioritiseClient(quiet({ commitments: [commitment('c', '2026-10-20')] })),
    ).toBeNull()
  })

  it('a completed promise stops generating urgency', () => {
    expect(
      prioritiseClient(quiet({ commitments: [commitment('c', '2026-09-10', 'done')] })),
    ).toBeNull()
  })
})

describe('meetings', () => {
  const meeting = (daysAhead: number) =>
    event('m', 'client-meeting', addDays(TODAY, daysAhead))

  it('a meeting tomorrow is today’s work; with an unresolved concern it is critical', () => {
    expect(prioritiseClient(quiet({ events: [meeting(1)] }))).toMatchObject({
      theme: 'meeting-imminent',
      severity: 'high',
      horizon: 'today',
    })
    expect(
      prioritiseClient(
        quiet({ events: [meeting(1)], contextFacts: [concern('f', '2026-09-12')] }),
      ),
    ).toMatchObject({ theme: 'meeting-imminent', severity: 'critical' })
  })

  it('a meeting in ten days with nothing to prepare is normal and upcoming', () => {
    expect(prioritiseClient(quiet({ events: [meeting(10)] }))).toMatchObject({
      theme: 'meeting-preparation',
      severity: 'normal',
      horizon: 'upcoming',
    })
  })

  it('a meeting within a week with an open promise is high and today', () => {
    expect(
      prioritiseClient(
        quiet({ events: [meeting(5)], commitments: [commitment('c', '2026-10-20')] }),
      ),
    ).toMatchObject({ theme: 'meeting-preparation', severity: 'high', horizon: 'today' })
  })

  it('a passed meeting no longer anchors anything', () => {
    expect(prioritiseClient(quiet({ events: [meeting(-1)] }))).toBeNull()
  })
})

describe('combining related facts into one priority', () => {
  it('meeting + refinancing + open promise become one financing preparation with three drivers', () => {
    const p = prioritiseClient(
      quiet({
        events: [
          event('m', 'client-meeting', addDays(TODAY, 10)),
          event('r', 'mortgage-refinancing', addDays(TODAY, 53), { liabilityId: 'l1' }),
        ],
        commitments: [commitment('c', addDays(TODAY, 25))],
        liabilities: [
          {
            id: 'l1',
            clientId: 'c1',
            kind: 'mortgage',
            title: 'Bolån',
            outstandingBalance: 6_500_000,
            interestType: 'fixed',
            ratePercent: 3.45,
            maturityDate: addDays(TODAY, 53),
            nextReviewDate: null,
            withBank: true,
            valuedAt: TODAY,
          },
        ],
        interactions: [interaction('2026-09-13', 'meeting', ['financing'])],
      }),
    )
    expect(p).toMatchObject({
      theme: 'meeting-preparation',
      severity: 'high',
      horizon: 'upcoming',
    })
    expect(p?.drivers.map((d) => d.kind)).toEqual(['meeting', 'event', 'open-commitment'])
    expect(p?.drivers[1]).toMatchObject({
      kind: 'event',
      eventType: 'mortgage-refinancing',
      amount: 6_500_000,
      material: true,
    })
  })

  it('names the financing as undiscussed when no recent conversation covered it', () => {
    const p = prioritiseClient(
      quiet({
        events: [event('r', 'mortgage-refinancing', addDays(TODAY, 20))],
        interactions: [interaction('2026-09-13', 'phone', ['fees'])],
      }),
    )
    expect(p).toMatchObject({ theme: 'event-approaching', severity: 'normal' })
    expect(p?.drivers.some((d) => d.kind === 'undiscussed')).toBe(true)
  })

  it('overdue promise + meeting tomorrow: the promise wins, the meeting is a driver', () => {
    const p = prioritiseClient(
      quiet({
        commitments: [commitment('c', '2026-09-15')],
        events: [event('m', 'client-meeting', '2026-09-24')],
      }),
    )
    expect(p?.theme).toBe('overdue-commitment')
    expect(p?.drivers.map((d) => d.kind)).toEqual(['overdue-commitment', 'meeting'])
  })

  it('birthday + overdue promise: one priority, and the birthday is evidence, not an item', () => {
    const p = prioritiseClient(
      quiet({
        commitments: [commitment('c', '2026-09-15')],
        events: [event('b', 'birthday', '1970-09-26')],
      }),
    )
    expect(p?.theme).toBe('overdue-commitment')
    expect(p?.drivers.map((d) => d.kind)).toEqual(['overdue-commitment', 'birthday'])
  })

  it('opportunity + urgent promise: the promise wins; a far opportunity is not even evidence', () => {
    const near = prioritiseClient(
      quiet({
        commitments: [commitment('c', TODAY)],
        opportunities: [opportunity('o', '2026-10-01')],
      }),
    )
    expect(near?.theme).toBe('commitment-due')
    expect(near?.drivers.map((d) => d.kind)).toContain('opportunity')
    const far = prioritiseClient(
      quiet({
        commitments: [commitment('c', TODAY)],
        opportunities: [opportunity('o', '2027-05-01')],
      }),
    )
    expect(far?.drivers.map((d) => d.kind)).not.toContain('opportunity')
  })

  it('long silence + concern is a relationship risk, today', () => {
    const p = prioritiseClient(
      quiet({
        interactions: [interaction('2026-06-01')],
        contextFacts: [concern('f', '2026-06-01')],
      }),
    )
    expect(p).toMatchObject({
      theme: 'relationship-risk',
      severity: 'high',
      horizon: 'today',
    })
    expect(p?.drivers.map((d) => d.kind)).toEqual(['silence', 'concern', 'health'])
  })
})

describe('silence, events, portfolio and birthdays', () => {
  it(`silence ranks by the documented thresholds (${SENTINEL_THRESHOLDS.silenceWatchDays}/${SENTINEL_THRESHOLDS.silenceContactDays}/${SENTINEL_THRESHOLDS.silenceRiskDays})`, () => {
    expect(
      prioritiseClient(quiet({ interactions: [interaction(addDays(TODAY, -29))] })),
    ).toBeNull()
    expect(
      prioritiseClient(quiet({ interactions: [interaction(addDays(TODAY, -45))] })),
    ).toMatchObject({ theme: 'contact-silence', severity: 'low', horizon: 'watch' })
    expect(
      prioritiseClient(quiet({ interactions: [interaction(addDays(TODAY, -70))] })),
    ).toMatchObject({ theme: 'contact-silence', severity: 'normal', horizon: 'upcoming' })
    expect(
      prioritiseClient(quiet({ interactions: [interaction(addDays(TODAY, -95))] })),
    ).toMatchObject({ theme: 'relationship-risk', severity: 'high', horizon: 'today' })
  })

  it('recent contact removes the silence', () => {
    /* Newest first, as the record is read. */
    expect(
      prioritiseClient(
        quiet({
          interactions: [
            interaction(addDays(TODAY, -2), 'phone'),
            interaction(addDays(TODAY, -95)),
          ],
        }),
      ),
    ).toBeNull()
  })

  it('a refinancing in 14 days outranks a birthday in 14 days, and 90 days out is a watch', () => {
    expect(
      prioritiseClient(
        quiet({
          events: [
            event('r', 'mortgage-refinancing', addDays(TODAY, 14)),
            event('b', 'birthday', '1970-10-07'),
          ],
        }),
      ),
    ).toMatchObject({ theme: 'event-approaching', severity: 'high' })
    expect(
      prioritiseClient(
        quiet({ events: [event('r', 'mortgage-refinancing', addDays(TODAY, 90))] }),
      ),
    ).toMatchObject({ theme: 'event-approaching', severity: 'low', horizon: 'watch' })
    expect(
      prioritiseClient(
        quiet({ events: [event('r', 'mortgage-refinancing', addDays(TODAY, 91))] }),
      ),
    ).toBeNull()
  })

  it('a birthday within a week is a low relationship prompt', () => {
    expect(
      prioritiseClient(quiet({ events: [event('b', 'birthday', '1970-09-26')] })),
    ).toMatchObject({
      theme: 'birthday',
      severity: 'low',
      horizon: 'upcoming',
      dueAt: '2026-09-26',
    })
    expect(
      prioritiseClient(quiet({ events: [event('b', 'birthday', '1970-10-15')] })),
    ).toBeNull()
  })

  it('drift is a watch until the portfolio returns within its mandate', () => {
    expect(prioritiseClient(quiet({ portfolio: portfolioWith(68) }))).toMatchObject({
      theme: 'portfolio',
      severity: 'normal',
      horizon: 'watch',
    })
    expect(prioritiseClient(quiet({ portfolio: portfolioWith(63) }))).toBeNull()
  })

  it('a stale valuation matters only before a review', () => {
    const stale: Asset[] = [
      {
        id: 'a3',
        clientId: 'c1',
        kind: 'property',
        title: 'Villa',
        value: 10_000_000,
        valuedAt: '2025-01-01',
        source: 'estimate',
        withBank: false,
      },
    ]
    expect(
      prioritiseClient(
        quiet({ balanceSheet: balanceSheetOf([...assets, ...stale], []) }),
      ),
    ).toBeNull()
    const p = prioritiseClient(
      quiet({
        balanceSheet: balanceSheetOf([...assets, ...stale], []),
        events: [event('a', 'annual-review', addDays(TODAY, 20))],
      }),
    )
    expect(p?.drivers.some((d) => d.kind === 'stale-valuation')).toBe(true)
    expect(p?.theme).toBe('event-approaching')
  })
})

describe('ordering and dispositions', () => {
  it('orders by severity, then horizon, then score', () => {
    const critical = prioritiseClient(
      quiet({ commitments: [commitment('c', '2026-09-10')] }),
    )!
    const high = prioritiseClient(
      quiet({ interactions: [interaction(addDays(TODAY, -95))] }),
    )!
    const low = prioritiseClient(
      quiet({ events: [event('b', 'birthday', '1970-09-26')] }),
    )!
    expect([low, high, critical].sort(comparePriorities).map((p) => p.theme)).toEqual([
      'overdue-commitment',
      'relationship-risk',
      'birthday',
    ])
  })

  it('a snooze holds until its date; a dismissal holds while the facts hold', () => {
    const p = prioritiseClient(quiet({ commitments: [commitment('c', '2026-09-10')] }))!
    const snoozed: SentinelDisposition = {
      priorityId: p.id,
      clientId: 'c1',
      status: 'snoozed',
      fingerprint: p.fingerprint,
      at: `${TODAY}T08:00:00.000Z`,
      by: 'adv-martin',
      until: '2026-09-25',
      reason: null,
    }
    expect(statusOf(p, [snoozed], TODAY)).toBe('snoozed')
    expect(statusOf(p, [snoozed], '2026-09-25')).toBe('active')

    const dismissed: SentinelDisposition = {
      ...snoozed,
      status: 'dismissed',
      until: null,
    }
    expect(statusOf(p, [dismissed], TODAY)).toBe('dismissed')
    const changed = prioritiseClient(
      quiet({
        commitments: [commitment('c', '2026-09-10'), commitment('c2', '2026-09-12')],
      }),
    )!
    expect(changed.fingerprint).not.toBe(p.fingerprint)
    expect(statusOf(changed, [dismissed], TODAY)).toBe('active')
  })

  it('reviewed is a marker, and the newest disposition wins', () => {
    const p = prioritiseClient(quiet({ commitments: [commitment('c', '2026-09-10')] }))!
    const reviewed: SentinelDisposition = {
      priorityId: p.id,
      clientId: 'c1',
      status: 'reviewed',
      fingerprint: p.fingerprint,
      at: `${TODAY}T08:00:00.000Z`,
      by: 'adv-martin',
      until: null,
      reason: null,
    }
    const dismissedLater: SentinelDisposition = {
      ...reviewed,
      status: 'dismissed',
      at: `${TODAY}T09:00:00.000Z`,
    }
    expect(statusOf(p, [reviewed], TODAY)).toBe('reviewed')
    expect(statusOf(p, [reviewed, dismissedLater], TODAY)).toBe('dismissed')
  })
})

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
