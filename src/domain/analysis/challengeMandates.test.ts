/**
 * Whose objections block, and the two evaluators that must never disagree.
 *
 * A challenge is ONE institutional object. The Devil's Advocate and a peer desk
 * raise it under different mandates, and the mandate is carried on the challenge
 * rather than expressed by putting it in a different gate — so
 * `CHALLENGE_UNRESOLVED` answers "does a blocking objection remain" whoever
 * raised it, and `PEER_SCRUTINY_ABSENT` answers the separate question of whether
 * anyone qualified looked.
 *
 * Two failures these tests are built against:
 *
 * 1. **Retroactive policy.** A version-1 decision re-read under a rule that did
 *    not exist when it was taken. The mandates are declared per policy version
 *    precisely so the evaluator never has to know that version 1 is old.
 *
 * 2. **Two evaluators, two answers.** `evaluateGate` shows a manager whether a
 *    revision is ready; `evaluateEligibilityGates` decides the submission. If
 *    they read different challenges, work looks ready right up to the moment it
 *    is refused.
 */

import { describe, expect, it } from 'vitest'
import {
  buildChallenge,
  evaluateEligibilityGates,
  evaluateGate,
  eligibilityPolicy,
  type Challenge,
  type DevilsAdvocateReview,
  type EligibilityGateCode,
  type PeerExaminationReview,
} from './index'
import { eligibilityBasis } from './decisionFixtures'
import type { BasisContent } from './basisCanonical'

const V1 = eligibilityPolicy('1')
const V2 = eligibilityPolicy('2')

/* ------------------------------------------------------------ the material */

const DA_REVIEW_ID = 'rev-da-1'
const PEER_REVIEW_ID = 'rev-peer-1'

const challenge = (over: Partial<Challenge> = {}): Challenge =>
  buildChallenge({
    id: 'ch-da',
    challengerKind: 'devils-advocate',
    byDepartmentId: 'devils-advocate',
    contests: 'claim-1',
    kind: 'contradicting-evidence',
    argument: 'The order book says otherwise.',
    counterEvidence: [{ setId: 's', observationId: 'o', contentHash: 'h' }],
    materiality: 'material',
    ...over,
  })

/** A peer's objection: same object, different mandate and different desk. */
const peerChallenge = (over: Partial<Challenge> = {}): Challenge =>
  challenge({
    id: 'ch-peer',
    challengerKind: 'peer',
    byDepartmentId: 'rates',
    argument: 'The move is a real-rate repricing, not a growth repricing.',
    ...over,
  })

const daReview = (
  challenges: Challenge[],
  outcomes: Record<string, 'open' | 'resolved'> = {},
): DevilsAdvocateReview => ({
  scope: 'case',
  caseId: 'case-1',
  reviewId: DA_REVIEW_ID,
  sequence: 1,
  byEmployeeId: 'da-head',
  byDepartmentId: 'devils-advocate',
  at: '2026-07-27T10:05:00.000Z',
  challenges,
  outcomes,
})

const examination = (
  challenges: Challenge[],
  outcomes: Record<string, 'open' | 'resolved'> = {},
): PeerExaminationReview => ({
  scope: 'case',
  caseId: 'case-1',
  reviewId: PEER_REVIEW_ID,
  sequence: 1,
  byEmployeeId: 'rates-head',
  byDepartmentId: 'rates',
  examinedDepartmentId: 'global-macro',
  at: '2026-07-27T10:10:00.000Z',
  challenges,
  outcomes,
})

/** The same facts as a persisted basis, for the other evaluator. */
const basisWith = (over: Partial<BasisContent> = {}): BasisContent => {
  const { manifest: _ignored, ...rest } = eligibilityBasis({
    devilsAdvocate: { reviewId: DA_REVIEW_ID, sequence: 1, openChallenges: [] },
    peerScrutiny: [],
    materialDisagreements: [],
    ...over,
  })
  return rest
}

const openPeerObjection = [
  {
    reviewId: PEER_REVIEW_ID,
    sequence: 1,
    byDepartmentId: 'rates',
    examinedDepartmentId: 'global-macro',
    openChallenges: [{ challengeId: 'ch-peer', materiality: 'material' as const }],
  },
]

const gateOf = (report: ReturnType<typeof evaluateEligibilityGates>, code: EligibilityGateCode) =>
  report.gates.find((entry) => entry.code === code)!

/* ================================================== what each policy declares */

describe('the mandates are declared, not decided in the evaluator', () => {
  it('version 1 weighs the Devil’s Advocate alone', () => {
    expect(V1.challengeMandates).toEqual(['devils-advocate'])
  })

  it('version 2 weighs both mandates', () => {
    expect(V2.challengeMandates).toEqual(['devils-advocate', 'peer'])
  })

  it('changes nothing else between the two versions', () => {
    /*
     * The claim the version note makes, asserted. If v2 also moved a threshold,
     * a difference in outcome could not be attributed to peer scrutiny.
     */
    expect(V2.challengeBlocksAtOrAbove).toBe(V1.challengeBlocksAtOrAbove)
    expect(V2.disagreementBlocksAtOrAbove).toBe(V1.disagreementBlocksAtOrAbove)
    expect(V2.verificationAccepts).toEqual(V1.verificationAccepts)
    expect(V2.unresolvedConditionalBlocks).toBe(V1.unresolvedConditionalBlocks)
    expect(V2.risk).toBe(V1.risk)
  })

  it('keeps requiring a Devil’s Advocate review under version 2', () => {
    /* A peer examining does not discharge an obligation on another mandate. */
    expect(V2.devilsAdvocate).toBe('required')
  })
})

/* ============================================ the state Half B exists to reach */

describe('a peer examined, and its material objection is still open', () => {
  const basis = basisWith({
    eligibilityPolicyVersion: '2',
    peerScrutiny: openPeerObjection,
  })
  const report = evaluateEligibilityGates(basis, V2)

  it('records that scrutiny happened', () => {
    expect(gateOf(report, 'PEER_SCRUTINY_ABSENT').status).toBe('passed')
  })

  it('blocks on the unresolved objection', () => {
    expect(gateOf(report, 'CHALLENGE_UNRESOLVED').status).toBe('failed')
  })

  it('names the desk that raised it', () => {
    expect(gateOf(report, 'CHALLENGE_UNRESOLVED').detail).toContain('rates')
  })

  it('leaves the submission ineligible', () => {
    expect(report.eligible).toBe(false)
    expect(report.failed).toContain('CHALLENGE_UNRESOLVED')
  })
})

/* ------------------------------------------------------ examined, no objection */

describe('a peer examined and raised nothing', () => {
  const basis = basisWith({
    eligibilityPolicyVersion: '2',
    peerScrutiny: [
      {
        reviewId: PEER_REVIEW_ID,
        sequence: 1,
        byDepartmentId: 'rates',
        examinedDepartmentId: 'global-macro',
        openChallenges: [],
      },
    ],
  })
  const report = evaluateEligibilityGates(basis, V2)

  it('satisfies peer scrutiny', () => {
    expect(gateOf(report, 'PEER_SCRUTINY_ABSENT').status).toBe('passed')
  })

  it('contributes nothing to the challenge gate', () => {
    /*
     * Not a pass it earned and not agreement it manufactured. With no Devil's
     * Advocate objections either, the challenge gate passes because nothing is
     * open — the examination added no objection and no absolution.
     */
    const challengeGate = gateOf(report, 'CHALLENGE_UNRESOLVED')
    expect(challengeGate.status).toBe('passed')
    expect(challengeGate.detail).not.toContain('rates')
  })

  it('does not settle a Devil’s Advocate objection that is still open', () => {
    const withDa = evaluateEligibilityGates(
      basisWith({
        eligibilityPolicyVersion: '2',
        devilsAdvocate: {
          reviewId: DA_REVIEW_ID,
          sequence: 1,
          openChallenges: [{ challengeId: 'ch-da', materiality: 'material' }],
        },
        peerScrutiny: [
          {
            reviewId: PEER_REVIEW_ID,
            sequence: 1,
            byDepartmentId: 'rates',
            examinedDepartmentId: 'global-macro',
            openChallenges: [],
          },
        ],
      }),
      V2,
    )
    expect(gateOf(withDa, 'CHALLENGE_UNRESOLVED').status).toBe('failed')
  })
})

/* ------------------------------------------------------------ once resolved */

describe('a peer objection that was resolved', () => {
  it('no longer blocks', () => {
    /*
     * `openChallenges` is what the basis carries, and a resolved objection has
     * left it. The objection itself remains in the review record — durable and
     * inspectable — which is what `unresolvedPeerChallenges` filters over.
     */
    const report = evaluateEligibilityGates(
      basisWith({
        eligibilityPolicyVersion: '2',
        peerScrutiny: [
          {
            reviewId: PEER_REVIEW_ID,
            sequence: 1,
            byDepartmentId: 'rates',
            examinedDepartmentId: 'global-macro',
            openChallenges: [],
          },
        ],
      }),
      V2,
    )
    expect(gateOf(report, 'CHALLENGE_UNRESOLVED').status).toBe('passed')
    expect(gateOf(report, 'PEER_SCRUTINY_ABSENT').status).toBe('passed')
  })

  it('is still in the institutional record', () => {
    /*
     * The examination keeps the challenge; only the OPEN list drops it. A
     * resolved objection that vanished would erase the fact that a desk once
     * disagreed, which is most of what the debate record is for.
     */
    const resolved = examination([peerChallenge({ resolvedBy: 'research-director' })], {
      'ch-peer': 'resolved',
    })
    expect(resolved.challenges).toHaveLength(1)
    expect(resolved.outcomes['ch-peer']).toBe('resolved')
  })
})

/* ================================================= version 1 is not disturbed */

describe('version 1 replay stays Devil’s-Advocate-only', () => {
  /*
   * The same stored basis, carrying a material peer objection, under each
   * policy. Nothing about the record differs between the two evaluations.
   */
  const persisted = basisWith({ peerScrutiny: openPeerObjection })

  it('ignores the peer objection under version 1', () => {
    const report = evaluateEligibilityGates(persisted, V1)
    expect(gateOf(report, 'CHALLENGE_UNRESOLVED').status).toBe('passed')
  })

  it('blocks on the identical fact under version 2', () => {
    const underV2 = { ...persisted, eligibilityPolicyVersion: '2' }
    expect(gateOf(evaluateEligibilityGates(underV2, V2), 'CHALLENGE_UNRESOLVED').status).toBe(
      'failed',
    )
  })

  it('reports peer scrutiny as a question version 1 did not ask', () => {
    /* `not-applicable`, never `passed`: version 1 did not clear peer scrutiny,
     * it never considered it. */
    const report = evaluateEligibilityGates(persisted, V1)
    expect(gateOf(report, 'PEER_SCRUTINY_ABSENT').status).toBe('not-applicable')
  })

  it('leaves a version-1 refusal reading exactly as it always did', () => {
    /*
     * No mention of desks or mandates in a Devil's-Advocate-only refusal. A
     * reader of a version-1 record must see no trace of a distinction that did
     * not apply to it.
     */
    const report = evaluateEligibilityGates(
      basisWith({
        devilsAdvocate: {
          reviewId: DA_REVIEW_ID,
          sequence: 1,
          openChallenges: [{ challengeId: 'ch-da', materiality: 'material' }],
        },
      }),
      V1,
    )
    const detail = gateOf(report, 'CHALLENGE_UNRESOLVED').detail
    expect(detail).toBe('1 of 1 open challenge(s) block at or above "material"')
  })
})

/* ================================================ the two evaluators agree */

describe('the pre-submission view and the submission gate agree', () => {
  /*
   * The failure this prevents: a manager sees a revision as ready, submits it,
   * and the gate refuses. Both evaluators call `blockingUnderMandates`, so the
   * only way they can differ is by being handed different facts.
   */
  const riskSettled = { riskRequirement: 'not-required' } as const
  const verification = {
    scope: 'case' as const,
    caseId: 'case-1',
    reviewId: 'rev-v-1',
    sequence: 1,
    byEmployeeId: 'fact-head',
    byDepartmentId: 'verification',
    at: '2026-07-27T10:00:00.000Z',
    status: 'verified' as const,
    findings: [],
    claimsReviewed: ['claim-1'],
  }

  const viewOf = (policy: typeof V1) =>
    evaluateGate({
      ...riskSettled,
      verification,
      devilsAdvocate: daReview([]),
      peerExaminations: [examination([peerChallenge()])],
      challengeBlocksAtOrAbove: policy.challengeBlocksAtOrAbove,
      challengeMandates: policy.challengeMandates,
    })

  const gateReportOf = (policy: typeof V1, version: string) =>
    evaluateEligibilityGates(
      basisWith({ eligibilityPolicyVersion: version, peerScrutiny: openPeerObjection }),
      policy,
    )

  it('both block the open peer objection under version 2', () => {
    const view = viewOf(V2)
    const report = gateReportOf(V2, '2')

    expect(view.passed).toBe(false)
    expect(view.blockers.some((b) => b.kind === 'unresolved-material-challenge')).toBe(true)
    expect(gateOf(report, 'CHALLENGE_UNRESOLVED').status).toBe('failed')
  })

  it('both ignore it under version 1', () => {
    const view = viewOf(V1)
    const report = gateReportOf(V1, '1')

    expect(view.blockers.some((b) => b.kind === 'unresolved-material-challenge')).toBe(
      false,
    )
    expect(gateOf(report, 'CHALLENGE_UNRESOLVED').status).toBe('passed')
  })

  it('attributes the blocker to the desk that raised it, not to the Devil’s Advocate', () => {
    /*
     * The blocker used to take its department from the Devil's Advocate review
     * unconditionally. A peer's objection reported under the control function's
     * name would send the CIO to the wrong desk to have it settled.
     */
    const view = viewOf(V2)
    const blocker = view.blockers.find(
      (b): b is Extract<typeof b, { kind: 'unresolved-material-challenge' }> =>
        b.kind === 'unresolved-material-challenge',
    )!
    expect(blocker.owningDepartmentId).toBe('rates')
    expect(blocker.reviewId).toBe(PEER_REVIEW_ID)
    expect(blocker.challengeId).toBe('ch-peer')
  })
})
