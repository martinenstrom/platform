/**
 * Investment theses, per-thesis governance, and the CIO decision.
 *
 * The workflow these contracts exist for: a case asks a question, departments
 * propose competing answers, governance examines each one separately, and the
 * CIO chooses between them with the losing arguments still on the table.
 */

import { describe, expect, it } from 'vitest'
import {
  buildAssignment,
  buildDecision,
  buildThesis,
  evaluateThesisGates,
  hasCompetingTheses,
  type Assignment,
  type CaseDecision,
  type InvestmentThesis,
  type VerificationReview,
} from './index'

const thesis = (over: Partial<InvestmentThesis> = {}): InvestmentThesis =>
  buildThesis({
    id: 'th-buy',
    caseId: 'case-1',
    statement: 'Novo Nordisk is undervalued on 2027 earnings power.',
    position: 'buy',
    proposedByDepartmentId: 'equity-research',
    proposedByEmployeeId: 'equity-analyst',
    proposedAt: '2026-07-27T09:00:00.000Z',
    supportingClaimIds: ['claim-1'],
    opposingClaimIds: [],
    status: 'proposed',
    invalidationCriteria: 'GLP-1 pricing falls more than 20 % in the US.',
    horizon: '12-24M',
    ...over,
  })

describe('a case holds competing theses, not one conclusion', () => {
  it('requires a thesis to say how it could be wrong', () => {
    // A thesis that cannot be falsified is a preference.
    expect(() => thesis({ invalidationCriteria: '  ' })).toThrow(/cannot be wrong/)
  })

  it('cannot clear governance with nothing supporting it', () => {
    expect(() => thesis({ status: 'cleared', supportingClaimIds: [] })).toThrow(
      /no supporting claims/,
    )
  })

  it('keeps opposing claims attached to the thesis they oppose', () => {
    // A thesis listing only its supporting evidence is a pitch, not a case.
    expect(thesis({ opposingClaimIds: ['claim-9'] }).opposingClaimIds).toEqual([
      'claim-9',
    ])
  })

  it('recognises genuinely competing positions', () => {
    expect(
      hasCompetingTheses([thesis(), thesis({ id: 'th-sell', position: 'sell' })]),
    ).toBe(true)
    expect(hasCompetingTheses([thesis()])).toBe(false)
  })

  it('stops counting a rejected thesis as competition', () => {
    const sell = thesis({ id: 'th-sell', position: 'sell', status: 'rejected' })
    expect(hasCompetingTheses([thesis(), sell])).toBe(false)
  })

  it('lets the Devil’s Advocate propose one rather than only object', () => {
    // Proposing a competing thesis is a different act from challenging a
    // claim, and the model has room for both.
    const counter = thesis({
      id: 'th-da',
      position: 'sell',
      proposedByDepartmentId: 'devils-advocate',
      proposedByEmployeeId: 'da-head',
      statement: 'Consensus is extrapolating a peak-cycle margin.',
      invalidationCriteria: 'Gross margin holds above 84 % for two more quarters.',
    })
    expect(counter.proposedByDepartmentId).toBe('devils-advocate')
  })

  it('supports a non-directional position for a macro case', () => {
    // Buy/hold/sell is the equity vocabulary, not the model's.
    const macro = thesis({
      id: 'th-ecb',
      position: 'ecb-cuts-before-q2',
      statement: 'The ECB cuts before Q2.',
      invalidationCriteria: 'Core inflation re-accelerates above 3 %.',
    })
    expect(macro.position).toBe('ecb-cuts-before-q2')
  })
})

describe('governance runs per thesis', () => {
  const verification = (
    thesisId: string | undefined,
    status: VerificationReview['status'],
  ): VerificationReview => ({
    caseId: 'case-1',
    ...(thesisId ? { thesisId } : {}),
    byEmployeeId: 'fact-head',
    byDepartmentId: 'verification',
    at: '2026-07-27T10:00:00.000Z',
    status,
    findings: [],
    claimsReviewed: [],
  })

  it('clears one thesis while blocking another', () => {
    // Why the gate had to become per-thesis: one verdict would either hide the
    // blocked argument or suppress the sound one.
    const results = evaluateThesisGates(['th-buy', 'th-sell'], {
      verification: [
        verification('th-buy', 'verified'),
        verification('th-sell', 'correction-required'),
      ],
    })
    expect(results.find((r) => r.thesisId === 'th-buy')?.passed).toBe(true)
    expect(results.find((r) => r.thesisId === 'th-sell')?.passed).toBe(false)
  })

  it('applies a case-wide review to every thesis', () => {
    const results = evaluateThesisGates(['th-buy', 'th-sell'], {
      verification: [verification(undefined, 'verified')],
    })
    expect(results.every((r) => r.passed)).toBe(true)
  })

  it('blocks a thesis nobody verified', () => {
    const results = evaluateThesisGates(['th-buy', 'th-sell'], {
      verification: [verification('th-buy', 'verified')],
    })
    expect(results.find((r) => r.thesisId === 'th-sell')?.passed).toBe(false)
  })

  it('reports a verdict for every thesis, not just the contested ones', () => {
    const results = evaluateThesisGates(['a', 'b', 'c'], {})
    expect(results.map((r) => r.thesisId)).toEqual(['a', 'b', 'c'])
    expect(results.every((r) => !r.passed)).toBe(true)
  })
})

describe('the CIO decision', () => {
  const cleared = thesis({ status: 'cleared' })

  const decision = (over: Partial<CaseDecision> = {}): CaseDecision =>
    buildDecision(
      {
        caseId: 'case-1',
        decidedAt: '2026-07-27T16:00:00.000Z',
        decidedByEmployeeId: 'cio',
        selectedThesisId: 'th-buy',
        notSelectedThesisIds: ['th-sell'],
        rationale: 'Risk-adjusted upside is adequate at this weight.',
        acknowledgedDissent: ['Risk flagged concentration in healthcare.'],
        ...over,
      },
      [cleared],
    )

  it('records what was chosen and what was not', () => {
    const result = decision()
    expect(result.selectedThesisId).toBe('th-buy')
    expect(result.notSelectedThesisIds).toEqual(['th-sell'])
  })

  it('keeps the dissent the CIO decided against', () => {
    // An institution that forgets which arguments it rejected cannot learn
    // when they turn out to have been right.
    expect(decision().acknowledgedDissent).toHaveLength(1)
  })

  it('refuses to select a thesis that never cleared governance', () => {
    expect(() =>
      buildDecision(
        {
          caseId: 'case-1',
          decidedAt: '2026-07-27T16:00:00.000Z',
          decidedByEmployeeId: 'cio',
          selectedThesisId: 'th-buy',
          notSelectedThesisIds: [],
          rationale: 'Looks fine.',
          acknowledgedDissent: [],
        },
        [thesis({ status: 'challenged' })],
      ),
    ).toThrow(/has not cleared governance/)
  })

  it('allows the CIO to take no position', () => {
    expect(decision({ selectedThesisId: null }).selectedThesisId).toBeNull()
  })

  it('requires a rationale', () => {
    expect(() => decision({ rationale: '   ' })).toThrow(/no rationale/)
  })
})

describe('departments never work for themselves', () => {
  it('binds every assignment to a case', () => {
    /*
     * Structural, not conventional: `caseId` is required on both `Assignment`
     * and `AgentRunRecord`, so a department cannot record work that belongs to
     * nothing. Cases are the centre of the organization.
     */
    const assignment: Assignment = buildAssignment({
      id: 'a1',
      caseId: 'case-1',
      departmentId: 'macro',
      brief: 'Assess the policy backdrop',
      status: 'queued',
      createdAt: '2026-07-27T08:00:00.000Z',
      priority: 1,
    })
    expect(assignment.caseId).toBe('case-1')

    // @ts-expect-error an assignment cannot exist without a case
    const orphan: Assignment = { ...assignment, caseId: undefined }
    expect(orphan).toBeDefined()
  })
})
