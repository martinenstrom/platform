/**
 * The briefing reads forward from the last meeting and names a topic for
 * every fact that deserves one.
 */

import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import type { ClientFacts } from './intelligence'
import { meetingPreparation } from './meetingPrep'
import type { Provenance } from './relationship'
import { balanceSheetOf } from './wealth'

const TODAY = '2026-09-23'
const provenance = (sourceDate: string): Provenance => ({
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

const client: Client = {
  id: 'c1',
  householdId: 'h1',
  officeId: 'o1',
  displayName: 'Test',
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

const facts: ClientFacts = {
  client,
  balanceSheet: balanceSheetOf([], []),
  portfolio: {
    id: 'p1',
    clientId: 'c1',
    valuedAt: TODAY,
    source: 'synthetic',
    totalValue: 1,
    benchmarkName: 'B',
    allocation: [
      { assetClass: 'equities', strategicPercent: 60, currentPercent: 67 },
      { assetClass: 'fixed-income', strategicPercent: 40, currentPercent: 33 },
    ],
    holdings: [],
    performance: [],
    performanceYtdPercent: 0,
  },
  goals: [],
  interactions: [
    {
      id: 'i3',
      clientId: 'c1',
      type: 'phone',
      date: '2026-09-20',
      advisorId: 'adv-martin',
      source: 'client',
      importance: 'normal',
      title: 'Samtal',
      noteText: 'x',
      topics: [],
      keyPoints: [],
      provenance: provenance('2026-09-20'),
    },
    {
      id: 'i2',
      clientId: 'c1',
      type: 'meeting',
      date: '2026-09-12',
      advisorId: 'adv-martin',
      source: 'advisor',
      importance: 'high',
      title: 'Möte',
      noteText: 'x',
      topics: [],
      keyPoints: ['Punkt'],
      provenance: provenance('2026-09-12'),
    },
    {
      id: 'i1',
      clientId: 'c1',
      type: 'email',
      date: '2026-09-01',
      advisorId: 'adv-martin',
      source: 'client',
      importance: 'low',
      title: 'Mejl',
      noteText: 'x',
      topics: [],
      keyPoints: [],
      provenance: provenance('2026-09-01'),
    },
  ],
  contextFacts: [
    {
      id: 'f1',
      clientId: 'c1',
      category: 'concern',
      statement: 'Orolig över energi',
      status: 'active',
      statusAt: '2026-09-12',
      provenance: provenance('2026-09-12'),
    },
    {
      id: 'f2',
      clientId: 'c1',
      category: 'preference',
      statement: 'Vill ha telefon',
      status: 'active',
      statusAt: '2026-09-20',
      provenance: provenance('2026-09-20'),
    },
  ],
  commitments: [
    {
      id: 'co1',
      clientId: 'c1',
      title: 'Ta fram jämförelse',
      createdAt: '2026-09-12',
      dueDate: '2026-09-20',
      status: 'open',
      priority: 'high',
      ownerAdvisorId: 'adv-martin',
      completedAt: null,
      provenance: provenance('2026-09-12'),
    },
  ],
  events: [
    {
      id: 'e1',
      clientId: 'c1',
      type: 'client-meeting',
      title: 'Nästa möte',
      date: '2026-10-03',
      recurring: 'none',
      importance: 'normal',
      notes: '',
      reminderRules: [],
      status: 'upcoming',
      provenance: provenance('2026-09-12'),
    },
    {
      id: 'e2',
      clientId: 'c1',
      type: 'mortgage-refinancing',
      title: 'Omsättning',
      date: '2026-11-15',
      recurring: 'none',
      importance: 'high',
      notes: '',
      reminderRules: [],
      status: 'upcoming',
      provenance: provenance('2026-09-12'),
    },
    {
      id: 'e3',
      clientId: 'c1',
      type: 'annual-review',
      title: 'Årsgenomgång',
      date: '2027-03-01',
      recurring: 'none',
      importance: 'normal',
      notes: '',
      reminderRules: [],
      status: 'upcoming',
      provenance: provenance('2026-09-12'),
    },
  ],
  opportunities: [],
  liabilities: [],
  today: TODAY,
}

describe('meetingPreparation', () => {
  const prep = meetingPreparation(facts)

  it('prepares for the booked meeting from the last one', () => {
    expect(prep.meeting?.id).toBe('e1')
    expect(prep.lastMeeting?.id).toBe('i2')
  })

  it('reads forward from the last meeting only', () => {
    expect(prep.changesSince.map((i) => i.id)).toEqual(['i3'])
    expect(prep.factsSince.map((f) => f.id)).toEqual(['f2'])
  })

  it('carries the overdue promise, the near events and the drift', () => {
    expect(prep.overdueCommitments.map((c) => c.id)).toEqual(['co1'])
    expect(prep.upcomingEvents.map((e) => e.id)).toEqual(['e2'])
    expect(prep.portfolioDeviations[0]).toMatchObject({
      assetClass: 'equities',
      deviationPoints: 7,
    })
  })

  it('suggests one topic per fact that deserves one, in a stable order', () => {
    expect(prep.suggestedTopics.map((t) => t.kind)).toEqual([
      'open-commitment',
      'client-concern',
      'allocation-drift',
      'allocation-drift',
      'upcoming-event',
    ])
    expect(prep.suggestedTopics[0]).toMatchObject({
      referenceId: 'co1',
      reference: 'Ta fram jämförelse',
    })
  })

  it('names its method and date', () => {
    expect(prep).toMatchObject({ preparedFor: TODAY, method: 'rule-based-v1' })
  })
})
