/**
 * The three sentences that must never be the same, and the tables behind them.
 */

import { describe, expect, it } from 'vitest'
import type { HostResult, InstitutionalAnswer } from '~/application/analysis/hostContract'
import { answerLines, phrase } from './hostStateText'

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
  },
}

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
    expect(phrase(decision).headline).toBe('Jag behöver ditt beslut på en sak.')
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
        },
      ],
      materialDissentCount: 1,
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
