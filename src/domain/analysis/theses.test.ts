/**
 * Theses, revisions, the orthogonal blocker model, and the CIO decision.
 *
 * The two groups that matter most: revision lineage, which is what makes the
 * history auditable; and the separation of lifecycle from blockers, which is
 * what stops a thesis reaching the CIO on a clean lifecycle while a material
 * objection is still open.
 */

import { describe, expect, it } from 'vitest'
import {
  acceptsContributions,
  buildAssignment,
  buildDecision,
  buildThesis,
  canTransitionThesis,
  currentRevision,
  evaluateThesisEligibility,
  evaluateRevisionGates,
  hasCompetingTheses,
  reviseThesis,
  thesisIsSealed,
  thesisLineage,
  type Assignment,
  type Blocker,
  type CaseDecision,
  type DecisionContext,
  type InvestmentThesis,
  type VerificationReview,
} from './index'

const thesis = (over: Partial<InvestmentThesis> = {}): InvestmentThesis =>
  buildThesis({
    thesisId: 'th-buy',
    revisionId: 'rev-1',
    revisionNumber: 1,
    caseId: 'case-1',
    statement: 'Novo Nordisk is undervalued on 2027 earnings power.',
    position: 'buy',
    proposedByDepartmentId: 'equity-research',
    proposedByEmployeeId: 'equity-analyst',
    proposedAt: '2026-07-27T09:00:00.000Z',
    supportingClaimIds: ['claim-1'],
    opposingClaimIds: [],
    citedByClaimIds: [],
    lifecycle: 'proposed',
    invalidationCriteria: 'GLP-1 pricing falls more than 20 % in the US.',
    horizon: '12-24M',
    ...over,
  })

/* ------------------------------------------------------------------ basics */

describe('a case holds competing theses, not one conclusion', () => {
  it('requires a thesis to say how it could be wrong', () => {
    expect(() => thesis({ invalidationCriteria: '  ' })).toThrow(/cannot be wrong/)
  })

  it('cannot be verified with nothing supporting it', () => {
    expect(() => thesis({ lifecycle: 'verified', supportingClaimIds: [] })).toThrow(
      /no supporting claims/,
    )
  })

  it('keeps opposing claims attached to the thesis they oppose', () => {
    expect(thesis({ opposingClaimIds: ['claim-9'] }).opposingClaimIds).toEqual([
      'claim-9',
    ])
  })

  it('recognises competing positions across lineages', () => {
    const sell = thesis({ thesisId: 'th-sell', revisionId: 'rev-s1', position: 'sell' })
    expect(hasCompetingTheses([thesis(), sell])).toBe(true)
  })

  it('does not mistake two revisions of one thesis for disagreement', () => {
    const second = thesis({
      revisionId: 'rev-2',
      revisionNumber: 2,
      supersedesRevisionId: 'rev-1',
      revisionReason: 'new filing',
    })
    expect(hasCompetingTheses([thesis({ lifecycle: 'superseded' }), second])).toBe(false)
  })

  it('supports a non-directional position for a macro case', () => {
    // Buy/hold/sell is the equity vocabulary, not the model's.
    expect(thesis({ position: 'ecb-cuts-before-q2' }).position).toBe('ecb-cuts-before-q2')
  })
})

/* --------------------------------------------------------------- revisions */

describe('revision lineage', () => {
  const first = thesis({ lifecycle: 'awaiting-verification' })

  it('mints the next revision and supersedes the current one', () => {
    const { superseded, revision } = reviseThesis(
      first,
      { statement: 'Undervalued, but only on the 2028 ramp.' },
      { revisionId: 'rev-2', reason: 'Q2 filing contradicted the margin path', at: 'T2' },
    )
    expect(superseded.lifecycle).toBe('superseded')
    expect(revision.revisionNumber).toBe(2)
    expect(revision.supersedesRevisionId).toBe('rev-1')
    expect(revision.thesisId).toBe(first.thesisId)
  })

  it('resets the new revision to unreviewed and uncited', () => {
    // It is a different argument. Nobody has reviewed it and nothing cites it.
    const { revision } = reviseThesis(
      thesis({ lifecycle: 'verified', citedByClaimIds: ['claim-7'] }),
      {},
      { revisionId: 'rev-2', reason: 'new evidence', at: 'T2' },
    )
    expect(revision.lifecycle).toBe('under-analysis')
    expect(revision.citedByClaimIds).toEqual([])
  })

  it('refuses to revise a historical revision', () => {
    expect(() =>
      reviseThesis(
        thesis({ lifecycle: 'superseded' }),
        {},
        {
          revisionId: 'rev-3',
          reason: 'x',
          at: 'T3',
        },
      ),
    ).toThrow(/already superseded/)
  })

  it('requires a reason', () => {
    expect(() =>
      reviseThesis(first, {}, { revisionId: 'rev-2', reason: '  ', at: 'T2' }),
    ).toThrow(/requires a reason/)
  })

  it('refuses a revision that does not say what it supersedes', () => {
    expect(() =>
      thesis({ revisionId: 'rev-2', revisionNumber: 2, revisionReason: 'x' }),
    ).toThrow(/does not say what it supersedes/)
  })

  it('refuses a first revision that supersedes something', () => {
    expect(() => thesis({ supersedesRevisionId: 'rev-0' })).toThrow(/cannot supersede/)
  })

  it('orders a valid lineage', () => {
    const r1 = thesis({ lifecycle: 'superseded' })
    const r2 = thesis({
      revisionId: 'rev-2',
      revisionNumber: 2,
      supersedesRevisionId: 'rev-1',
      revisionReason: 'x',
    })
    expect(thesisLineage([r2, r1], 'th-buy').map((r) => r.revisionNumber)).toEqual([1, 2])
  })

  it('rejects a lineage with a gap', () => {
    const r3 = thesis({
      revisionId: 'rev-3',
      revisionNumber: 3,
      supersedesRevisionId: 'rev-2',
      revisionReason: 'x',
    })
    expect(() => thesisLineage([thesis(), r3], 'th-buy')).toThrow(/gap at revision 2/)
  })

  it('rejects a broken supersedes chain', () => {
    const r2 = thesis({
      revisionId: 'rev-2',
      revisionNumber: 2,
      supersedesRevisionId: 'rev-elsewhere',
      revisionReason: 'x',
    })
    expect(() => thesisLineage([thesis(), r2], 'th-buy')).toThrow(/supersedes/)
  })

  it('finds the live revision', () => {
    const r1 = thesis({ lifecycle: 'superseded' })
    const r2 = thesis({
      revisionId: 'rev-2',
      revisionNumber: 2,
      supersedesRevisionId: 'rev-1',
      revisionReason: 'x',
    })
    expect(currentRevision([r1, r2], 'th-buy')?.revisionId).toBe('rev-2')
  })
})

describe('sealing', () => {
  it('leaves a revision editable while it is still on the desk', () => {
    expect(thesisIsSealed(thesis({ lifecycle: 'under-analysis' }))).toBe(false)
  })

  it('seals it once it leaves the desk', () => {
    expect(thesisIsSealed(thesis({ lifecycle: 'awaiting-verification' }))).toBe(true)
  })

  it('seals it once anything cites it', () => {
    // Editing a revision a claim points at would silently change what was cited.
    expect(
      thesisIsSealed(thesis({ lifecycle: 'under-analysis', citedByClaimIds: ['c1'] })),
    ).toBe(true)
  })

  it('stops accepting contributions once it leaves analysis', () => {
    expect(acceptsContributions(thesis({ lifecycle: 'under-analysis' }))).toBe(true)
    expect(acceptsContributions(thesis({ lifecycle: 'superseded' }))).toBe(false)
    expect(acceptsContributions(thesis({ lifecycle: 'verified' }))).toBe(false)
  })
})

/* ---------------------------------------------------- lifecycle vs blockers */

describe('lifecycle and governance are orthogonal', () => {
  const challenge: Blocker = {
    kind: 'unresolved-challenge',
    detail: 'The margin assumption ignores competitive entry.',
    owningDepartmentId: 'devils-advocate',
    severity: 'blocks-decision',
  }

  it('has no `challenged` lifecycle state', () => {
    // A challenge is a condition, not a workflow position. As a state it would
    // overwrite whichever position the thesis was actually in.
    expect(canTransitionThesis('under-analysis', 'awaiting-verification')).toBe(true)
    // @ts-expect-error `challenged` is not a lifecycle state
    expect(canTransitionThesis('under-analysis', 'challenged')).toBe(false)
  })

  it('keeps a verified thesis from the CIO while a challenge is open', () => {
    // The rule the whole separation exists for.
    const eligibility = evaluateThesisEligibility('th-buy', 'rev-1', {
      lifecycle: 'verified',
      blockers: [challenge],
      missingRequiredContributions: [],
    })
    expect(eligibility.lifecycle).toBe('verified')
    expect(eligibility.eligibleForDecision).toBe(false)
    expect(eligibility.blockedBy).toHaveLength(1)
  })

  it('lets a verified, unblocked thesis reach the CIO', () => {
    const eligibility = evaluateThesisEligibility('th-buy', 'rev-1', {
      lifecycle: 'verified',
      blockers: [],
      missingRequiredContributions: [],
    })
    expect(eligibility.eligibleForDecision).toBe(true)
  })

  it('records a thesis as challenged AND under analysis at once', () => {
    const eligibility = evaluateThesisEligibility('th-buy', 'rev-1', {
      lifecycle: 'under-analysis',
      blockers: [challenge],
      missingRequiredContributions: [],
    })
    // Both facts survive, which a single enum could not express.
    expect(eligibility.lifecycle).toBe('under-analysis')
    expect(eligibility.canProgress).toBe(true)
    expect(eligibility.blockedBy[0]?.kind).toBe('unresolved-challenge')
  })

  it('turns a missing required contribution into a blocker', () => {
    const eligibility = evaluateThesisEligibility('th-buy', 'rev-1', {
      lifecycle: 'verified',
      blockers: [],
      missingRequiredContributions: ['risk'],
    })
    expect(eligibility.eligibleForDecision).toBe(false)
    expect(eligibility.blockedBy[0]?.kind).toBe('missing-required-contribution')
  })

  it('separates blocking a decision from blocking publication', () => {
    const eligibility = evaluateThesisEligibility('th-buy', 'rev-1', {
      lifecycle: 'verified',
      blockers: [
        {
          kind: 'compliance-block',
          detail: 'disclaimer missing',
          severity: 'blocks-publication',
        },
      ],
      missingRequiredContributions: [],
    })
    // A compliance wording issue does not stop the CIO forming a view.
    expect(eligibility.eligibleForDecision).toBe(true)
    expect(eligibility.eligibleForPublication).toBe(false)
  })
})

describe('governance runs per revision', () => {
  const revisionVerification = (
    thesisId: string,
    revisionId: string,
    status: VerificationReview['status'],
  ): VerificationReview => ({
    scope: 'thesis-revision',
    caseId: 'case-1',
    thesisId,
    revisionId,
    byEmployeeId: 'fact-head',
    byDepartmentId: 'verification',
    at: '2026-07-27T10:00:00.000Z',
    status,
    findings: [],
    claimsReviewed: [],
  })

  const caseVerification = (
    status: VerificationReview['status'],
  ): VerificationReview => ({
    scope: 'case',
    caseId: 'case-1',
    byEmployeeId: 'fact-head',
    byDepartmentId: 'verification',
    at: '2026-07-27T10:00:00.000Z',
    status,
    findings: [],
    claimsReviewed: [],
  })

  const buy = { thesisId: 'th-buy', revisionId: 'buy-r1' }
  const sell = { thesisId: 'th-sell', revisionId: 'sell-r1' }

  it('clears one revision while blocking another', () => {
    const results = evaluateRevisionGates([buy, sell], 'case-1', {
      verification: [
        revisionVerification('th-buy', 'buy-r1', 'verified'),
        revisionVerification('th-sell', 'sell-r1', 'correction-required'),
      ],
    })
    expect(results.find((r) => r.revisionId === 'buy-r1')?.passed).toBe(true)
    expect(results.find((r) => r.revisionId === 'sell-r1')?.passed).toBe(false)
  })

  it('applies a case-wide review to every revision', () => {
    const results = evaluateRevisionGates([buy, sell], 'case-1', {
      verification: [caseVerification('verified')],
    })
    expect(results.every((r) => r.passed)).toBe(true)
  })

  it('blocks a revision nobody verified', () => {
    const results = evaluateRevisionGates([buy, sell], 'case-1', {
      verification: [revisionVerification('th-buy', 'buy-r1', 'verified')],
    })
    expect(results.find((r) => r.revisionId === 'sell-r1')?.passed).toBe(false)
  })

  it('does not let a review of revision 1 clear revision 2', () => {
    // TD-21, as a test. The verifier read revision 1; revision 2 is a
    // different argument and has been reviewed by nobody.
    const results = evaluateRevisionGates(
      [{ thesisId: 'th-buy', revisionId: 'buy-r2' }],
      'case-1',
      { verification: [revisionVerification('th-buy', 'buy-r1', 'verified')] },
    )
    expect(results[0]!.passed).toBe(false)
    expect(results[0]!.blockers.join(' ')).toMatch(/verification has not been performed/)
  })

  it('ignores a review belonging to another case', () => {
    const results = evaluateRevisionGates([buy], 'case-2', {
      verification: [revisionVerification('th-buy', 'buy-r1', 'verified')],
    })
    expect(results[0]!.passed).toBe(false)
  })
})

/* ---------------------------------------------------------------- decision */

describe('the CIO decision', () => {
  const eligible: DecisionContext = {
    eligibility: [
      {
        revisionId: 'rev-1',
        lifecycle: 'verified',
        eligibleForDecision: true,
        blockedBy: [],
      },
    ],
  }

  const decision = (
    over: Partial<CaseDecision> = {},
    context: DecisionContext = eligible,
  ): CaseDecision =>
    buildDecision(
      {
        caseId: 'case-1',
        aggregateVersion: 7,
        decidedAt: '2026-07-27T16:00:00.000Z',
        decidedByEmployeeId: 'cio',
        selectedRevisionId: 'rev-1',
        notSelectedRevisionIds: ['rev-s1'],
        rejectedRevisionIds: [],
        evidenceSetId: 'set-1',
        governance: {
          verification: 'verified',
          unresolvedChallengeCount: 0,
          compliance: 'approved',
          risk: 'accepted',
        },
        rationale: 'Risk-adjusted upside is adequate at this weight.',
        unresolvedDissent: ['Risk flagged concentration in healthcare.'],
        reconsiderationTriggers: ['US pricing legislation advances'],
        ...over,
      },
      context,
    )

  it('references the exact revision, not just the thesis', () => {
    expect(decision().selectedRevisionId).toBe('rev-1')
  })

  it('records what was not chosen and the dissent decided against', () => {
    const result = decision()
    expect(result.notSelectedRevisionIds).toEqual(['rev-s1'])
    expect(result.unresolvedDissent).toHaveLength(1)
  })

  it('records what would reopen the case', () => {
    expect(decision().reconsiderationTriggers).toEqual([
      'US pricing legislation advances',
    ])
  })

  it('pins the aggregate version it was decided against', () => {
    expect(decision().aggregateVersion).toBe(7)
  })

  it('refuses a superseded revision', () => {
    expect(() =>
      decision(
        {},
        {
          eligibility: [
            {
              revisionId: 'rev-1',
              lifecycle: 'superseded',
              eligibleForDecision: false,
              blockedBy: [],
            },
          ],
        },
      ),
    ).toThrow(/was superseded/)
  })

  it('refuses an unverified revision', () => {
    expect(() =>
      decision(
        {},
        {
          eligibility: [
            {
              revisionId: 'rev-1',
              lifecycle: 'under-analysis',
              eligibleForDecision: false,
              blockedBy: [],
            },
          ],
        },
      ),
    ).toThrow(/not eligible for decision/)
  })

  it('refuses a revision with an unresolved blocker, naming it', () => {
    expect(() =>
      decision(
        {},
        {
          eligibility: [
            {
              revisionId: 'rev-1',
              lifecycle: 'verified',
              eligibleForDecision: false,
              blockedBy: [{ kind: 'unresolved-challenge', detail: 'x' }],
            },
          ],
        },
      ),
    ).toThrow(/unresolved-challenge/)
  })

  it('refuses a decision with no evidence reference', () => {
    expect(() => decision({ evidenceSetId: '' })).toThrow(/cites no evidence set/)
  })

  it('requires a rationale', () => {
    expect(() => decision({ rationale: '   ' })).toThrow(/no rationale/)
  })

  it('allows the CIO to take no position', () => {
    expect(decision({ selectedRevisionId: null }).selectedRevisionId).toBeNull()
  })
})

describe('departments never work for themselves', () => {
  it('binds every assignment to a case', () => {
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
