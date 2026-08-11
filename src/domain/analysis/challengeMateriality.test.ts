/**
 * Materiality is a fact. Blocking is a policy.
 *
 * The distinction this whole canonicalization version exists for, asserted the
 * only way that actually proves it: **one basis, unchanged, evaluated under two
 * policies, giving two verdicts.**
 *
 * If the gate had kept its own threshold — as it did, failing on any open
 * challenge regardless of weight — every assertion below would be impossible to
 * write. The basis would have to change to change the verdict, which is exactly
 * what "the implementation owns the threshold" looks like from the outside.
 */

import { describe, expect, it } from 'vitest'
import { evaluateEligibilityGates } from './eligibilityGates'
import { eligibilityPolicy, type EligibilityPolicy } from './eligibilityPolicy'
import { eligibilityBasis } from './decisionFixtures'
import type { BasisContent } from './basisManifest'

/**
 * A policy identical to v1 except for the challenge threshold.
 *
 * Built by overriding one field rather than by writing a second policy out in
 * full: the point is that ONLY the threshold differs, and a hand-written twin
 * could drift in some other field and quietly explain the verdict instead.
 */
const withChallengeThreshold = (
  threshold: EligibilityPolicy['challengeBlocksAtOrAbove'],
): EligibilityPolicy => ({
  ...eligibilityPolicy('1'),
  version: `1-challenge-${threshold}`,
  challengeBlocksAtOrAbove: threshold,
})

/** A decision-ready basis carrying exactly one open, non-material challenge. */
function basisWithNonMaterialOpenChallenge(policyVersion: string): BasisContent {
  const { manifest: _manifest, ...base } = eligibilityBasis()
  return {
    ...base,
    eligibilityPolicyVersion: policyVersion,
    devilsAdvocate: {
      reviewId: base.devilsAdvocate!.reviewId,
      sequence: base.devilsAdvocate!.sequence,
      openChallenges: [{ challengeId: 'challenge-a-rev-1', materiality: 'non-material' }],
    },
  }
}

const challengeGate = (basis: BasisContent, policy: EligibilityPolicy) =>
  evaluateEligibilityGates(basis, policy).gates.find(
    (gate) => gate.code === 'CHALLENGE_UNRESOLVED',
  )!

describe('one basis, two policies', () => {
  it('does not block under policy v1, and blocks under a stricter one', () => {
    /*
     * THE exit criterion. The same open, non-material challenge — the same
     * bytes, the same digest, no rewrite of anything — passes under the firm's
     * actual policy and fails under a stricter one.
     */
    const underV1 = basisWithNonMaterialOpenChallenge('1')
    expect(challengeGate(underV1, eligibilityPolicy('1')).status).toBe('passed')
    expect(evaluateEligibilityGates(underV1, eligibilityPolicy('1')).eligible).toBe(true)

    const strict = withChallengeThreshold('non-material')
    const underStrict = { ...underV1, eligibilityPolicyVersion: strict.version }
    expect(challengeGate(underStrict, strict).status).toBe('failed')
    expect(evaluateEligibilityGates(underStrict, strict).eligible).toBe(false)
  })

  it('changes verdict without changing one byte of the challenge record', () => {
    /*
     * The stronger form: the two evaluations read the SAME
     * `devilsAdvocate` object. Nothing about the recorded objection differs
     * between the passing case and the failing one — only the policy does.
     */
    const basis = basisWithNonMaterialOpenChallenge('1')
    const strict = withChallengeThreshold('non-material')

    const lenient = challengeGate(basis, eligibilityPolicy('1'))
    const severe = challengeGate(
      { ...basis, eligibilityPolicyVersion: strict.version },
      strict,
    )

    expect(lenient.status).toBe('passed')
    expect(severe.status).toBe('failed')
    /* Same fact, read twice. */
    expect(basis.devilsAdvocate!.openChallenges).toEqual([
      { challengeId: 'challenge-a-rev-1', materiality: 'non-material' },
    ])
  })

  it('keeps a non-material challenge visible rather than dropping it', () => {
    /*
     * Not blocking is not the same as not there. `challengeBlocks` says a
     * non-material objection "does not block, does not disappear, and is read
     * by the CIO alongside the thesis" — so the passing gate still counts it.
     */
    const basis = basisWithNonMaterialOpenChallenge('1')
    const gate = challengeGate(basis, eligibilityPolicy('1'))

    expect(gate.status).toBe('passed')
    expect(gate.detail).toContain('1 open challenge')
    expect(gate.detail).not.toContain('resolved')
  })

  it('blocks a material challenge under v1, and passes it under a looser policy', () => {
    /* The mirror image, so the pass above is not an artefact of one direction. */
    const { manifest: _m, ...base } = eligibilityBasis()
    const material: BasisContent = {
      ...base,
      devilsAdvocate: {
        reviewId: base.devilsAdvocate!.reviewId,
        sequence: base.devilsAdvocate!.sequence,
        openChallenges: [{ challengeId: 'challenge-a-rev-1', materiality: 'material' }],
      },
    }

    expect(challengeGate(material, eligibilityPolicy('1')).status).toBe('failed')

    const loose = withChallengeThreshold('decision-critical')
    expect(
      challengeGate({ ...material, eligibilityPolicyVersion: loose.version }, loose)
        .status,
    ).toBe('passed')
  })

  it('names the threshold it applied, not merely the count', () => {
    /*
     * A refusal that said "1 challenge open" would leave a desk unable to tell
     * whether the objection was too weighty or the policy too strict.
     */
    const { manifest: _m, ...base } = eligibilityBasis()
    const material: BasisContent = {
      ...base,
      devilsAdvocate: {
        reviewId: base.devilsAdvocate!.reviewId,
        sequence: base.devilsAdvocate!.sequence,
        openChallenges: [{ challengeId: 'challenge-a-rev-1', materiality: 'material' }],
      },
    }
    expect(challengeGate(material, eligibilityPolicy('1')).detail).toContain('"material"')
  })
})
