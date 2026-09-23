/**
 * What JARVIS says of a verdict that demands corrections, and of dissent
 * against an earlier revision (TD-99, ruled 2026-09-22). Every number and
 * name comes from the contract; the sentences are the presence's.
 */

import { describe, expect, it } from 'vitest'
import type { CommitteeConclusion, HostResult, InstitutionalAnswer } from '~/application/analysis/hostContract'
import { answerLines, phrase } from './hostStateText'

const context = {
  reference: { system: 'financial-os', kind: 'case', id: 'case-1', provenanceId: 'p' } as const,
  question: 'Varför är guld upp idag?',
  subject: 'Guld',
  surfaces: { boardroom: '/cases/case-1', record: '/cases/case-1/underlag' },
  activity: {
    stage: 'review' as const,
    desks: [
      { id: 'rates', name: 'Rates', isGovernance: false },
      { id: 'global-macro', name: 'Global Macro', isGovernance: false },
    ],
    outstanding: [],
    inFlight: 0,
    expired: 0,
    awaitingAdoption: 0,
    failed: 0,
  },
  amendments: { count: 0, latestAt: null, workPredates: false },
}

const office = { id: 'research-office', name: 'Research Office', isGovernance: false }
const macro = { id: 'global-macro', name: 'Global Macro', isGovernance: false }
const rates = { id: 'rates', name: 'Rates', isGovernance: false }

describe('a verdict that demands corrections says whose, how many, and whether the firm corrects on its own', () => {
  it('names the findings and their owners while the automatic round is still available', () => {
    const result: HostResult = {
      ...context,
      state: 'blocked',
      block: {
        reason: 'verification-correction-required',
        owner: office,
        corrections: {
          reviewId: 'rvw-1',
          revisionNumber: 2,
          blockingFindings: 3,
          owners: [macro, rates],
          roundsTaken: 0,
          automaticRoundAvailable: true,
        },
      },
    }
    expect(phrase(result).detail).toBe(
      'Faktagranskningen är gjord och kräver rättelser innan kommittén kan avsluta. Ligger hos Research Office. ' +
        '3 brister att rätta hos Global Macro, Rates i revision 2.',
    )
  })

  it('says the firm stops when its one automatic round is spent', () => {
    const result: HostResult = {
      ...context,
      state: 'blocked',
      block: {
        reason: 'verification-correction-required',
        owner: office,
        corrections: {
          reviewId: 'rvw-2',
          revisionNumber: 3,
          blockingFindings: 1,
          owners: [rates],
          roundsTaken: 1,
          automaticRoundAvailable: false,
        },
      },
    }
    expect(phrase(result).detail).toBe(
      'Faktagranskningen är gjord och kräver rättelser innan kommittén kan avsluta. Ligger hos Research Office. ' +
        'En brist att rätta hos Rates i revision 3. En rättelserunda är redan gjord; firman rättar inte igen på egen hand.',
    )
  })

  it('says that the evidence was judged insufficient, which demands nothing of anyone', () => {
    const result: HostResult = {
      ...context,
      state: 'blocked',
      block: { reason: 'verification-insufficient-evidence', owner: { id: 'verification', name: 'Verification', isGovernance: true } },
    }
    expect(phrase(result).detail).toBe(
      'Faktagranskningen är gjord och bedömer underlaget som otillräckligt för en slutsats. Ligger hos Verification.',
    )
  })

  it('says nothing extra when the block carries no verdict detail', () => {
    const result: HostResult = {
      ...context,
      state: 'blocked',
      block: { reason: 'verification-correction-required', owner: null },
    }
    expect(phrase(result).detail).toBe(
      'Faktagranskningen är gjord och kräver rättelser innan kommittén kan avsluta.',
    )
  })
})

describe('dissent against an earlier revision is said as history beside the explanation', () => {
  const objection = (revisionId: string, renewed: boolean, challengeId: string) => ({
    challengeId,
    contests: 'claim-1',
    argument: 'Realräntan förklarar inte hela rörelsen.',
    materiality: 'material' as const,
    outcome: 'open' as const,
    counterEvidenceCount: 0,
    reviewId: `rvw-${revisionId}`,
    byDepartmentId: 'devils-advocate',
    revisionId,
    raisedAs: 'devils-advocate' as const,
    superseded: false,
    renewed,
  })

  const explanation = (priorDissent: CommitteeConclusion['priorDissent']): InstitutionalAnswer => ({
    kind: 'committee-conclusion',
    inquiry: 'explanation',
    thesis: {
      revisionId: 'rev-3',
      statement: 'Guldets uppgång drivs främst av lägre realräntor.',
      position: 'explain',
      invalidationCriteria: 'Faller om realräntorna stiger utan att guldet faller.',
      implications: [],
      proposedByDepartmentId: 'research-office',
    },
    synthesisedBy: office,
    scrutiny: { verification: 'verified', risk: null, peerExaminations: 1, devilsAdvocateReviews: 1 },
    dissent: [],
    materialDissentCount: 0,
    priorDissent,
  })

  it('counts the prior objections and how many the same function renewed', () => {
    const lines = answerLines(explanation([objection('rev-2', true, 'ch-1'), objection('rev-2', false, 'ch-2')]))
    expect(lines[lines.length - 1]).toBe(
      '2 tidigare invändningar mot en tidigare revision finns kvar på protokollet; en förnyades mot den rättade versionen.',
    )
  })

  it('says one prior objection in the singular, and that none was renewed', () => {
    const lines = answerLines(explanation([objection('rev-2', false, 'ch-1')]))
    expect(lines[lines.length - 1]).toBe(
      'En tidigare invändning mot en tidigare revision finns kvar på protokollet; ingen förnyades mot den rättade versionen.',
    )
  })

  it('adds no line for a lineage that was never corrected', () => {
    const lines = answerLines(explanation([]))
    expect(lines).toEqual([
      'Kommitténs förklaring: Guldets uppgång drivs främst av lägre realräntor.',
      'Osäkerhet: Faller om realräntorna stiger utan att guldet faller.',
      'Ingen invändning kvarstår.',
    ])
  })
})
