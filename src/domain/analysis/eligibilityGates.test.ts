/**
 * The gate report, and the separation it depends on.
 *
 * Materiality is a **fact** recorded when the manager aggregated. Whether that
 * materiality blocks is a **policy judgement** made later, at submission, under
 * whichever policy version applied. Policies change; facts do not.
 *
 * The exit test at the bottom is the one that proves the architecture rather
 * than the code: one unchanged basis, two policies, two different verdicts.
 */

import { describe, expect, it } from 'vitest'
import { disagreementBlocksEligibility } from './aggregation'
import { evaluateEligibilityGates } from './eligibilityGates'
import { eligibilityBasis } from './decisionFixtures'
import { eligibilityPolicy } from './eligibilityPolicy'
import type { BasisContent } from './basisCanonical'
import type { EligibilityGateCode } from './eligibilityGates'

const basis = (over: Parameters<typeof eligibilityBasis>[0] = {}): BasisContent => {
  const { manifest: _ignored, ...rest } = eligibilityBasis(over)
  return rest
}

const V1 = eligibilityPolicy('1')

/** A firm that draws the line lower. Constructed, not registered: the evaluator
 * takes a policy, so a threshold can be exercised without teaching the
 * registry a version nobody has decided to adopt. */
const STRICTER = {
  ...V1,
  version: 'strict',
  disagreementBlocksAtOrAbove: 'material' as const,
}

const gate = (
  report: ReturnType<typeof evaluateEligibilityGates>,
  code: EligibilityGateCode,
) => report.gates.find((entry) => entry.code === code)!

describe('the threshold comes from the policy, not from the code', () => {
  it('blocks only decision-critical when that is the threshold', () => {
    expect(disagreementBlocksEligibility('non-material', 'decision-critical')).toBe(false)
    expect(disagreementBlocksEligibility('material', 'decision-critical')).toBe(false)
    expect(disagreementBlocksEligibility('decision-critical', 'decision-critical')).toBe(
      true,
    )
  })

  it('blocks material and above when the threshold is material', () => {
    expect(disagreementBlocksEligibility('non-material', 'material')).toBe(false)
    expect(disagreementBlocksEligibility('material', 'material')).toBe(true)
    expect(disagreementBlocksEligibility('decision-critical', 'material')).toBe(true)
  })

  it('never blocks non-material under any threshold', () => {
    for (const threshold of ['non-material', 'material', 'decision-critical'] as const) {
      expect(disagreementBlocksEligibility('non-material', threshold), threshold).toBe(
        threshold === 'non-material',
      )
    }
  })
})

describe('the report covers every gate, passed as well as failed', () => {
  it('reports all five gates whatever the verdict', () => {
    const report = evaluateEligibilityGates(basis(), V1)
    expect(report.gates.map((entry) => entry.code).sort()).toEqual([
      'CHALLENGE_UNRESOLVED',
      'DISAGREEMENT_BLOCKING',
      'REQUIRED_WORK_INCOMPLETE',
      'RISK_UNRESOLVED',
      'VERIFICATION_INCOMPLETE',
    ])
  })

  it('names the policy version it applied', () => {
    const report = evaluateEligibilityGates(basis(), V1)
    expect(report.policyVersion).toBe('1')
  })

  it('states the threshold in the disagreement reason', () => {
    /*
     * The reason must name the rule actually applied. A refusal that cannot say
     * which policy produced it is not reproducible later.
     */
    const report = evaluateEligibilityGates(
      basis({
        materialDisagreements: [{ claimId: 'c-1', materiality: 'decision-critical' }],
      }),
      V1,
    )
    const disagreement = gate(report, 'DISAGREEMENT_BLOCKING')
    expect(disagreement.status).toBe('failed')
    expect(disagreement.detail).toContain('decision-critical')
    expect(disagreement.detail).toContain('policy 1')
  })

  it('keeps not-applicable distinct from passed', () => {
    // A gate that never ran and a gate that cleared are different facts about
    // the firm's process.
    const report = evaluateEligibilityGates(
      basis({ riskRequirement: 'not-required' }),
      V1,
    )
    expect(gate(report, 'RISK_UNRESOLVED').status).toBe('not-applicable')
    expect(gate(report, 'VERIFICATION_INCOMPLETE').status).toBe('passed')
  })

  it('fails an unresolved risk requirement rather than passing it', () => {
    // Three-state: "unresolved" is not "not required". Nobody has yet decided
    // whether Risk must look.
    const report = evaluateEligibilityGates(basis({ riskRequirement: 'unresolved' }), V1)
    expect(gate(report, 'RISK_UNRESOLVED').status).toBe('failed')
    expect(report.eligible).toBe(false)
    expect(report.failed).toContain('RISK_UNRESOLVED')
  })

  it('reports every failure, not the first', () => {
    const report = evaluateEligibilityGates(
      basis({
        verification: null,
        riskRequirement: 'unresolved',
        materialDisagreements: [{ claimId: 'c-1', materiality: 'decision-critical' }],
      }),
      V1,
    )
    expect(report.failed.length).toBeGreaterThanOrEqual(3)
    expect(report.eligible).toBe(false)
  })
})

describe('the exit test: one fact, two policies, two verdicts', () => {
  /*
   * The proof that historical fact and later policy judgement are genuinely
   * separated.
   *
   * The SAME persisted basis -- a single material disagreement, recorded once
   * and never edited -- passes under a policy whose threshold is
   * decision-critical and fails under one whose threshold is material.
   *
   * Nothing about the stored record differs between the two evaluations. If a
   * blocking judgement were still persisted, this could not be true: the record
   * would carry one verdict forever, fixed by whichever policy happened to be
   * in force when it was written.
   */
  const persisted = basis({
    materialDisagreements: [{ claimId: 'claim-1', materiality: 'material' }],
  })

  it('passes under a decision-critical threshold', () => {
    expect(V1.disagreementBlocksAtOrAbove).toBe('decision-critical')
    expect(
      gate(evaluateEligibilityGates(persisted, V1), 'DISAGREEMENT_BLOCKING').status,
    ).toBe('passed')
  })

  it('blocks under a material threshold, from the identical stored fact', () => {
    /*
     * Only the POLICY changes. The basis object handed to both calls is the
     * same reference -- not a copy with a field altered -- so nothing about the
     * recorded fact can differ between them.
     */
    const strictBasis = { ...persisted, eligibilityPolicyVersion: STRICTER.version }

    const lenient = evaluateEligibilityGates(persisted, V1)
    const strict = evaluateEligibilityGates(strictBasis, STRICTER)

    expect(gate(lenient, 'DISAGREEMENT_BLOCKING').status).toBe('passed')
    expect(gate(strict, 'DISAGREEMENT_BLOCKING').status).toBe('failed')
    /*
     * Asserted on the GATE rather than on overall eligibility: the fixture
     * fails other gates too, so the verdict as a whole is unchanged. The
     * disagreement gate is the one the threshold governs, and it is the one
     * that must move.
     */
    expect(lenient.failed).not.toContain('DISAGREEMENT_BLOCKING')
    expect(strict.failed).toContain('DISAGREEMENT_BLOCKING')

    // The fact itself never moved.
    expect(persisted.materialDisagreements).toEqual([
      { claimId: 'claim-1', materiality: 'material' },
    ])
  })

  it('names the policy that produced each verdict', () => {
    // A verdict that cannot say which policy produced it is not reproducible.
    expect(evaluateEligibilityGates(persisted, V1).policyVersion).toBe('1')
    expect(
      evaluateEligibilityGates(
        { ...persisted, eligibilityPolicyVersion: STRICTER.version },
        STRICTER,
      ).policyVersion,
    ).toBe('strict')
  })

  it('refuses to judge a basis under a policy it did not cite', () => {
    // The record names the policy the submission selected; evaluating it under
    // another would produce a verdict the record cannot explain.
    expect(() => evaluateEligibilityGates(persisted, STRICTER)).toThrow(/cites/)
  })

  it('hydrates a historical fact without knowing any policy', () => {
    /*
     * Reading a stored disagreement requires no eligibility policy at all --
     * which is what makes it historical rather than provisional. Only the
     * judgement needs one.
     */
    expect(persisted.materialDisagreements[0]!.materiality).toBe('material')
    expect(persisted).not.toHaveProperty('blocksEligibility')
  })
})
