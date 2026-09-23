/**
 * The three sentences that must never be the same, and the tables behind them.
 */

import { describe, expect, it } from 'vitest'
import type { HostResult, InstitutionalAnswer } from '~/application/analysis/hostContract'
import { amendmentLine, answerLines, phrase } from './hostStateText'

const context = {
  reference: {
    system: 'financial-os',
    kind: 'case',
    id: 'case-1',
    provenanceId: 'p',
  } as const,
  question: 'Är Nvidia köpvärd?',
  subject: 'Nvidia',
  surfaces: { boardroom: '/cases/case-1', record: '/cases/case-1/underlag' },
  activity: {
    stage: 'research' as const,
    desks: [
      { id: 'rates', name: 'Rates', isGovernance: false },
      { id: 'global-macro', name: 'Global Macro', isGovernance: false },
    ],
    outstanding: [],
    inFlight: 1,
    expired: 0,
    awaitingAdoption: 0,
    failed: 0,
  },
  amendments: { count: 0, latestAt: null, workPredates: false },
}

describe('a verification that demands corrections is not one nobody did (2026-09-22)', () => {
  it('says the fact-check was done and what it wants', () => {
    const result: HostResult = {
      ...context,
      state: 'blocked',
      block: {
        reason: 'verification-correction-required',
        owner: { id: 'verification', name: 'Verification', isGovernance: true },
      },
    }
    expect(phrase(result).detail).toBe(
      'Faktagranskningen är gjord och kräver rättelser innan kommittén kan avsluta. Ligger hos Verification.',
    )
  })
})

describe('work, no way forward, and your decision are three sentences', () => {
  const working: HostResult = { ...context, state: 'working' }
  const blocked: HostResult = {
    ...context,
    state: 'blocked',
    block: {
      reason: 'verification-required',
      owner: { id: 'verification', name: 'Verification', isGovernance: true },
    },
  }
  const decision: HostResult = {
    ...context,
    state: 'needs-decision',
    decision: { reason: 'institutional-initialization-required' },
  }

  it('says three different things', () => {
    const headlines = [working, blocked, decision].map(
      (result) => phrase(result).headline,
    )
    expect(new Set(headlines).size).toBe(3)
    expect(phrase(working).headline).toBe('Jag kollar på det.')
    expect(phrase(blocked).headline).toBe('Analysen kan inte fortsätta just nu.')
    /* The opening is the one question JARVIS may ask, in human words; never a thesis, a scope or an approval. */
    expect(phrase(decision).headline).toBe('En sak innan de sätter igång.')
    expect(phrase(decision).detail).toBe(
      'Vill du att de utgår från din egen syn — och vad är huvudskälet — eller prövar frågan helt öppet?',
    )
    for (const word of ['tes', 'omfattning', 'godkänn', 'formell', 'systemet']) {
      expect(`${phrase(decision).headline} ${phrase(decision).detail}`.toLowerCase()).not.toContain(word)
    }
  })

  it('names the desks while working, and the owner while blocked', () => {
    expect(phrase(working).detail).toContain('Rates · Global Macro')
    expect(phrase(blocked).detail).toContain('Faktagranskningen')
    expect(phrase(blocked).detail).toContain('Verification')
  })

  it('never promises a return when blocked or asking', () => {
    for (const result of [blocked, decision]) {
      expect(phrase(result).headline).not.toMatch(/återkommer|kollar/)
    }
  })

  it('tells a committee conclusion from a CIO decision', () => {
    const committee: HostResult = {
      ...context,
      state: 'answer-ready',
      kind: 'committee-conclusion',
    }
    const cio: HostResult = { ...context, state: 'answer-ready', kind: 'cio-decision' }
    expect(phrase(committee).detail).toContain('Kommitténs slutsats')
    expect(phrase(cio).detail).toContain('CIO-beslutet')
  })

  it('says when a failure can be resumed', () => {
    const failed: HostResult = {
      state: 'failed',
      reason: 'convening-incomplete',
      reference: context.reference,
      resumable: true,
    }
    expect(phrase(failed).detail).toContain('återuppta')
    const noOperator: HostResult = {
      state: 'failed',
      reason: 'operator-unresolved',
      code: 'NOT_CONFIGURED',
    }
    expect(phrase(noOperator).detail).toContain('Ingen operatör')
    expect(phrase(noOperator).detail).toContain('NOT_CONFIGURED')
  })
})

describe('the answer keeps its dissent', () => {
  const thesis = {
    revisionId: 'rev-2',
    statement: 'Kurvan prisar in en mjuklandning.',
    position: 'hold',
    invalidationCriteria: 'Realräntorna stiger över 2,5 %.',
    implications: [],
    proposedByDepartmentId: 'research-office',
  }

  it('names the conclusion, what would change it, and the open objections', () => {
    const answer: InstitutionalAnswer = {
      kind: 'committee-conclusion',
      inquiry: 'judgement',
      thesis,
      synthesisedBy: {
        id: 'research-office',
        name: 'Research Office',
        isGovernance: false,
      },
      scrutiny: {
        verification: 'verified',
        risk: 'accepted',
        peerExaminations: 1,
        devilsAdvocateReviews: 1,
      },
      dissent: [
        {
          challengeId: 'ch-1',
          contests: 'claim-1',
          argument: 'Värderingen tål inte högre realräntor.',
          materiality: 'material',
          outcome: 'open',
          counterEvidenceCount: 0,
          reviewId: 'rev-da',
          byDepartmentId: 'devils-advocate',
          raisedAs: 'devils-advocate',
          superseded: false,
          revisionId: null,
        },
      ],
      materialDissentCount: 1,
      priorDissent: [],
    }
    const lines = answerLines(answer)
    expect(lines[0]).toContain('hold')
    expect(lines[0]).toContain(thesis.statement)
    expect(lines.join('\n')).toContain(thesis.invalidationCriteria)
    expect(lines.join('\n')).toContain('En materiell invändning kvarstår.')
    expect(lines.join('\n')).toContain('Värderingen tål inte högre realräntor.')
  })

  it('reads a CIO decision with its outcome in words', () => {
    const answer: InstitutionalAnswer = {
      kind: 'cio-decision',
      decision: {
        decisionId: 'd-1',
        outcome: 'deferred',
        consideredRevisionIds: ['rev-2'],
        rationale: 'Vi väntar in nästa FOMC.',
        decidedAt: '2026-09-01T00:00:00.000Z',
        decidedByEmployeeId: 'cio',
        authorizationBasis: 'role:cio',
        evidenceSetId: 'set-1',
      },
      thesis: null,
      dissent: [],
      materialDissentCount: 0,
      reconsiderationTriggers: [
        { id: 't-1', conditionType: 'date-or-event', rationale: 'FOMC i november.' },
      ],
    }
    const lines = answerLines(answer)
    expect(lines[0]).toContain('bordlagt')
    expect(lines[0]).toContain('Vi väntar in nästa FOMC.')
    expect(lines.join('\n')).toContain('Ingen materiell invändning kvarstår.')
    expect(lines.join('\n')).toContain('1 villkor')
  })
})

describe('a closed case, and what the person added', () => {
  const AT = '2026-09-16T08:00:00.000Z'
  const closed = (kind: 'cancelled' | 'abandoned', reason: string | null): HostResult => ({
    ...context,
    state: 'closed',
    closure: {
      kind,
      reason,
      at: AT,
      byDesk: { id: 'research-office', name: 'Research Office', isGovernance: false },
    },
  })

  it('says the case is closed, and whether work was cut short or never begun', () => {
    expect(phrase(closed('cancelled', 'Behövs inte längre.')).headline).toBe('Ärendet är stängt.')
    expect(phrase(closed('cancelled', 'Behövs inte längre.')).detail).toBe(
      'Pågående arbete avbröts — Behövs inte längre. (Research Office)',
    )
    expect(phrase(closed('abandoned', null)).detail).toBe(
      'Lades ner innan något arbete gjorts (Research Office)',
    )
    /* Closed is a fourth sentence, not one of the three. */
    const working: HostResult = { ...context, state: 'working' }
    expect(phrase(closed('abandoned', null)).headline).not.toBe(phrase(working).headline)
    expect(phrase(closed('abandoned', null)).headline).not.toMatch(/återkommer|kollar/)
  })

  it('says nothing about additions where there are none, and the one fact where there are', () => {
    expect(amendmentLine({ ...context, state: 'working' })).toBeNull()
    expect(amendmentLine({ state: 'failed', reason: 'service-unavailable' })).toBeNull()
    const one: HostResult = {
      ...context,
      state: 'working',
      amendments: { count: 1, latestAt: AT, workPredates: false },
    }
    expect(amendmentLine(one)).toBe('Ett tillägg sedan ärendet öppnades.')
    const predated: HostResult = {
      ...context,
      state: 'blocked',
      block: { reason: 'verification-required', owner: null },
      amendments: { count: 2, latestAt: AT, workPredates: true },
    }
    expect(amendmentLine(predated)).toBe(
      '2 tillägg sedan ärendet öppnades; det arbete som redan gjorts tar inte hänsyn till det senaste.',
    )
  })

  it('says a settled case cannot be changed, and offers nothing', () => {
    const settled: HostResult = {
      state: 'failed',
      reason: 'case-settled',
      reference: context.reference,
    }
    expect(phrase(settled).detail).toBe('Ärendet är redan avslutat, så det går inte att ändra.')
    expect(phrase(settled).detail).not.toMatch(/återuppta|återkommer/)
  })
})
