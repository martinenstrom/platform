/**
 * Revision-scoped governance.
 *
 * The defect this closes, stated once: a review scoped to a thesis LINEAGE
 * says nothing about which argument was actually examined. Revision 1 gets
 * verified, revision 2 supersedes it, and a consumer reading "verification
 * approved thesis-1" treats revision 2 as approved — an argument the verifier
 * never saw, carrying a governance record that looks like due process.
 *
 * Every test here is a way that could happen.
 */

import { describe, expect, it } from 'vitest'
import {
  buildChallenge,
  buildDecision,
  evaluateRevisionEligibility,
  evaluateRevisionGates,
  isRevisionScoped,
  reviewApplies,
  reviewIdentity,
  type CaseDecision,
  type ComplianceReview,
  type DevilsAdvocateReview,
  type RiskReview,
  type VerificationReview,
} from './index'

const AT = '2026-07-28T10:00:00.000Z'
const CASE = 'case-1'

const rev1 = { thesisId: 'th-buy', revisionId: 'buy-r1' }
const rev2 = { thesisId: 'th-buy', revisionId: 'buy-r2' }

const verification = (
  target: { thesisId: string; revisionId: string } | 'case',
  over: Partial<VerificationReview> = {},
): VerificationReview =>
  ({
    ...(target === 'case'
      ? { scope: 'case', caseId: CASE }
      : { scope: 'thesis-revision', caseId: CASE, ...target }),
    byEmployeeId: 'verification-head',
    byDepartmentId: 'verification',
    at: AT,
    status: 'verified',
    findings: [],
    claimsReviewed: ['claim-1'],
    ...over,
  }) as VerificationReview

const challengeReview = (target: {
  thesisId: string
  revisionId: string
}): DevilsAdvocateReview => ({
  scope: 'thesis-revision',
  caseId: CASE,
  ...target,
  byEmployeeId: 'devils-advocate-head',
  byDepartmentId: 'devils-advocate',
  at: AT,
  challenges: [
    buildChallenge({
      id: 'ch-1',
      contests: 'claim-1',
      kind: 'fragile-assumption',
      argument: 'The margin path assumes no competitive entry.',
      counterEvidence: [],
    }),
  ],
  outcomes: {},
})

/* ------------------------------------------------------------- the model */

describe('a review is exactly one of two shapes', () => {
  it('narrows to a revision only when it is revision-scoped', () => {
    const caseWide = verification('case')
    const scoped = verification(rev1)

    expect(isRevisionScoped(caseWide)).toBe(false)
    expect(isRevisionScoped(scoped)).toBe(true)
    if (isRevisionScoped(scoped)) expect(scoped.revisionId).toBe('buy-r1')
  })

  it('cannot express a thesis-revision review without a revision', () => {
    // @ts-expect-error a thesis-revision review must carry thesisId and revisionId
    const incomplete: VerificationReview = {
      scope: 'thesis-revision',
      caseId: CASE,
      byEmployeeId: 'verification-head',
      byDepartmentId: 'verification',
      at: AT,
      status: 'verified',
      findings: [],
      claimsReviewed: [],
    }
    expect(incomplete).toBeDefined()
  })

  it('cannot express a case-wide review carrying a hidden revision', () => {
    /*
     * Worth a test of its own rather than trusting the union shape.
     * TypeScript's excess-property check accepts a property present on any arm
     * of the target union, so omitting `revisionId` from the case-wide arm was
     * not enough — it is declared `?: never`, and this is what proves it.
     */
    // @ts-expect-error a case-wide review has no revision to carry
    const smuggled: ComplianceReview = {
      scope: 'case',
      caseId: CASE,
      revisionId: 'buy-r1',
      byEmployeeId: 'compliance-head',
      byDepartmentId: 'compliance',
      at: AT,
      status: 'approved',
      findings: [],
    }
    expect(smuggled).toBeDefined()
  })
})

describe('reviewApplies', () => {
  it('matches a revision-scoped review to exactly one revision', () => {
    const review = verification(rev1)
    expect(reviewApplies(review, { caseId: CASE, revisionId: 'buy-r1' })).toBe(true)
    expect(reviewApplies(review, { caseId: CASE, revisionId: 'buy-r2' })).toBe(false)
  })

  it('applies a case-wide review to every revision of its case', () => {
    const review = verification('case')
    expect(reviewApplies(review, { caseId: CASE, revisionId: 'buy-r1' })).toBe(true)
    expect(reviewApplies(review, { caseId: CASE, revisionId: 'sell-r9' })).toBe(true)
  })

  it('never crosses a case boundary', () => {
    expect(
      reviewApplies(verification('case'), { caseId: 'other', revisionId: 'x' }),
    ).toBe(false)
  })
})

/* --------------------------------------------- what supersession does NOT do */

describe('a superseding revision inherits nothing', () => {
  it('does not treat verification of revision 1 as verification of revision 2', () => {
    const gates = evaluateRevisionGates([rev2], CASE, {
      verification: [verification(rev1)],
    })
    expect(gates[0]!.passed).toBe(false)
    expect(gates[0]!.blockers.join(' ')).toMatch(/verification has not been performed/)
  })

  it('keeps revision 1 verified as a historical record', () => {
    // The old verdict remains true about the argument it examined.
    const gates = evaluateRevisionGates([rev1, rev2], CASE, {
      verification: [verification(rev1)],
    })
    expect(gates.find((g) => g.revisionId === 'buy-r1')?.passed).toBe(true)
    expect(gates.find((g) => g.revisionId === 'buy-r2')?.passed).toBe(false)
  })

  it('does not let a challenge against revision 1 block revision 2', () => {
    // Symmetry matters as much as the approval case: an inherited objection
    // would block work nobody has actually objected to, and the record would
    // show a challenge against an argument that was never made.
    const gates = evaluateRevisionGates([rev1, rev2], CASE, {
      verification: [verification(rev1), verification(rev2)],
      devilsAdvocate: [challengeReview(rev1)],
    })
    expect(gates.find((g) => g.revisionId === 'buy-r1')?.blockers.join(' ')).toMatch(
      /unresolved challenge/,
    )
    expect(gates.find((g) => g.revisionId === 'buy-r2')?.passed).toBe(true)
  })

  it('does not let a challenge against revision 1 approve revision 2 either', () => {
    // A resolved challenge on the old revision is not clearance for the new one.
    const resolved: DevilsAdvocateReview = {
      ...challengeReview(rev1),
      outcomes: { 'ch-1': 'resolved' },
    }
    const gates = evaluateRevisionGates([rev2], CASE, { devilsAdvocate: [resolved] })
    expect(gates[0]!.passed).toBe(false)
  })

  it('keeps a risk review attached to the exact revision reviewed', () => {
    const risk: RiskReview = {
      scope: 'thesis-revision',
      caseId: CASE,
      ...rev1,
      byEmployeeId: 'chief-risk-officer',
      byDepartmentId: 'risk',
      at: AT,
      status: 'rejected',
      concerns: ['duration exposure'],
    }
    const gates = evaluateRevisionGates([rev1, rev2], CASE, {
      verification: [verification(rev1), verification(rev2)],
      risk: [risk],
    })
    expect(gates.find((g) => g.revisionId === 'buy-r1')?.passed).toBe(false)
    expect(gates.find((g) => g.revisionId === 'buy-r2')?.passed).toBe(true)
  })

  it('lets a case-wide compliance review exist with no revision at all', () => {
    // Publication compliance concerns the language of the whole report.
    const compliance: ComplianceReview = {
      scope: 'case',
      caseId: CASE,
      byEmployeeId: 'compliance-head',
      byDepartmentId: 'compliance',
      at: AT,
      status: 'rejected',
      findings: [{ rule: 'disclosure', detail: 'no risk disclosure' }],
    }
    const gates = evaluateRevisionGates([rev1, rev2], CASE, {
      verification: [verification(rev1), verification(rev2)],
      compliance: [compliance],
    })
    expect(gates.every((g) => g.blockers.join(' ').includes('compliance'))).toBe(true)
  })

  it('reads the latest verdict when a control function re-reviews', () => {
    const gates = evaluateRevisionGates([rev1], CASE, {
      verification: [
        verification(rev1, { at: '2026-07-28T09:00:00.000Z', status: 'verified' }),
        verification(rev1, {
          at: '2026-07-28T11:00:00.000Z',
          status: 'correction-required',
        }),
      ],
    })
    // Changing its mind is a new review; the gate reads the current one and
    // the record keeps both.
    expect(gates[0]!.passed).toBe(false)
  })
})

/* ------------------------------------------------------------- the decision */

describe('the CIO decision', () => {
  const decision = (revisionId: string): CaseDecision => ({
    caseId: CASE,
    aggregateVersion: 4,
    decidedAt: AT,
    decidedByEmployeeId: 'cio',
    selectedRevisionId: revisionId,
    notSelectedRevisionIds: [],
    rejectedRevisionIds: [],
    evidenceSetId: 'set-1',
    governance: {
      verification: 'verified',
      unresolvedChallengeCount: 0,
      compliance: 'not-required',
      risk: 'not-required',
    },
    rationale: 'The policy path is mispriced',
    unresolvedDissent: [],
    reconsiderationTriggers: [],
  })

  const eligibility = (reviews: { verification: VerificationReview[] }) =>
    evaluateRevisionEligibility(
      [
        { ...rev1, lifecycle: 'verified' },
        { ...rev2, lifecycle: 'verified' },
      ],
      CASE,
      reviews,
    )

  it('refuses a revision whose only reviews belong to its predecessor', () => {
    // The whole point, at the place it would do the most damage: a decision
    // record naming an unreviewed argument, with a governance snapshot that
    // looks complete.
    expect(() =>
      buildDecision(decision('buy-r2'), {
        eligibility: eligibility({ verification: [verification(rev1)] }),
      }),
    ).toThrow(/not eligible for decision/)
  })

  it('accepts the revision that was actually reviewed', () => {
    expect(() =>
      buildDecision(decision('buy-r1'), {
        eligibility: eligibility({ verification: [verification(rev1)] }),
      }),
    ).not.toThrow()
  })

  it('accepts the new revision once it has been verified in its own right', () => {
    expect(() =>
      buildDecision(decision('buy-r2'), {
        eligibility: eligibility({
          verification: [verification(rev1), verification(rev2)],
        }),
      }),
    ).not.toThrow()
  })
})

/* ------------------------------------------------------------- idempotency */

describe('review identity', () => {
  it('separates two revisions reviewed by the same person at the same instant', () => {
    // Without the revision in the key, the second submission would be
    // discarded as a replay of the first.
    expect(reviewIdentity('verification', verification(rev1))).not.toBe(
      reviewIdentity('verification', verification(rev2)),
    )
  })

  it('separates a case-wide review from a revision-scoped one', () => {
    expect(reviewIdentity('verification', verification('case'))).not.toBe(
      reviewIdentity('verification', verification(rev1)),
    )
  })

  it('separates the four control functions', () => {
    const identities = new Set(
      (['verification', 'devils-advocate', 'compliance', 'risk'] as const).map((kind) =>
        reviewIdentity(kind, verification(rev1)),
      ),
    )
    expect(identities.size).toBe(4)
  })

  it('collides for a genuine replay of the same submission', () => {
    expect(reviewIdentity('verification', verification(rev1))).toBe(
      reviewIdentity('verification', verification(rev1)),
    )
  })

  it('separates two departments reviewing the same revision', () => {
    const risk = verification(rev1, {
      byDepartmentId: 'risk',
      byEmployeeId: 'chief-risk-officer',
    })
    expect(reviewIdentity('verification', risk)).not.toBe(
      reviewIdentity('verification', verification(rev1)),
    )
  })
})
