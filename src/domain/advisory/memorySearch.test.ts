/**
 * Asking the relationship's memory — the question read into a kind, the
 * answer made of the records themselves. A planted question per kind, and
 * one that no kind claims.
 */

import { describe, expect, it } from 'vitest'
import { searchClientMemory, type ClientMemory } from './memorySearch'
import type { Provenance } from './relationship'

const provenance: Provenance = {
  origin: 'advisor',
  sourceInteractionId: null,
  sourceText: null,
  sourceDate: '2026-09-12',
  createdAt: '2026-09-12T09:00:00.000Z',
  createdBy: 'adv-martin',
  confidence: 'high',
  confirmedByAdvisor: true,
  confirmedAt: null,
}

const memory: ClientMemory = {
  today: '2026-09-23',
  interactions: [
    {
      id: 'i2',
      clientId: 'c',
      type: 'phone',
      date: '2026-09-18',
      advisorId: 'adv-martin',
      source: 'client',
      importance: 'normal',
      title: 'Fråga om avgifter',
      noteText: 'Klienten ringde och frågade om avgifterna på fonderna.',
      topics: ['fees'],
      keyPoints: [],
      provenance,
    },
    {
      id: 'i1',
      clientId: 'c',
      type: 'meeting',
      date: '2026-09-12',
      advisorId: 'adv-martin',
      source: 'advisor',
      importance: 'high',
      title: 'Portföljgenomgång',
      noteText: 'Orolig över energiexponeringen.',
      topics: ['energy-exposure'],
      keyPoints: [],
      provenance,
    },
  ],
  contextFacts: [
    {
      id: 'f1',
      clientId: 'c',
      category: 'concern',
      statement: 'Orolig över energiexponeringen',
      status: 'active',
      statusAt: '2026-09-12',
      provenance,
    },
  ],
  commitments: [
    {
      id: 'co1',
      clientId: 'c',
      title: 'Ta fram jämförelse',
      createdAt: '2026-09-12',
      dueDate: '2026-10-03',
      status: 'open',
      priority: 'high',
      ownerAdvisorId: 'adv-martin',
      completedAt: null,
      provenance,
    },
    {
      id: 'co0',
      clientId: 'c',
      title: 'Boka möte',
      createdAt: '2026-08-01',
      dueDate: '2026-08-10',
      status: 'done',
      priority: 'low',
      ownerAdvisorId: 'adv-martin',
      completedAt: '2026-08-05',
      provenance,
    },
  ],
  events: [
    {
      id: 'e1',
      clientId: 'c',
      type: 'mortgage-refinancing',
      title: 'Omsättning av bolånet',
      date: '2026-11-15',
      recurring: 'none',
      importance: 'high',
      notes: '',
      reminderRules: [],
      status: 'upcoming',
      provenance,
    },
    {
      id: 'e2',
      clientId: 'c',
      type: 'client-meeting',
      title: 'Möte',
      date: '2026-10-03',
      recurring: 'none',
      importance: 'normal',
      notes: '',
      reminderRules: [],
      status: 'upcoming',
      provenance,
    },
  ],
  goals: [],
  holdings: [],
  liabilities: [
    {
      id: 'l1',
      clientId: 'c',
      kind: 'mortgage',
      title: 'Bolån',
      outstandingBalance: 6_500_000,
      interestType: 'fixed',
      ratePercent: 3.45,
      maturityDate: '2026-11-15',
      nextReviewDate: null,
      withBank: true,
      valuedAt: '2026-09-22',
    },
  ],
}

describe('searchClientMemory', () => {
  it('"vad har jag lovat" lists only the open promises', () => {
    const answer = searchClientMemory('Vad har jag lovat?', memory)
    expect(answer.kind).toBe('commitments')
    expect(answer.hits.map((h) => h.id)).toEqual(['co1'])
  })

  it('"what is the client concerned about" returns the concern and the note that said it', () => {
    const answer = searchClientMemory(
      'What is the client currently concerned about?',
      memory,
    )
    expect(answer.kind).toBe('concerns')
    expect(answer.hits.map((h) => h.id)).toEqual(['f1', 'i1'])
  })

  it('"när förfaller bolånet" answers with the event and the loan', () => {
    const answer = searchClientMemory('När förfaller bolånet?', memory)
    expect(answer.kind).toBe('loan-maturity')
    expect(answer.hits.map((h) => h.id)).toEqual(['e1', 'l1'])
    expect(answer.hits[0]?.date).toBe('2026-11-15')
  })

  it('"when did we last discuss fees" is answered as a topic search', () => {
    const answer = searchClientMemory('När diskuterade vi avgifter senast?', memory)
    expect(answer.kind).toBe('topic')
    expect(answer.topic).toBe('avgifter')
    expect(answer.hits.map((h) => h.id)).toEqual(['i2'])
  })

  it('"what has changed since the last meeting" reads forward from the meeting', () => {
    const answer = searchClientMemory('Vad har hänt sedan förra mötet?', memory)
    expect(answer.kind).toBe('changes-since-last-meeting')
    expect(answer.hits.map((h) => h.id)).toEqual(['i2'])
  })

  it('an unrecognised question is answered with the latest records, and says so', () => {
    const answer = searchClientMemory('Hur är vädret?', memory)
    expect(answer.kind).toBe('unknown')
    expect(answer.method).toBe('lexicon-v1')
  })
})
