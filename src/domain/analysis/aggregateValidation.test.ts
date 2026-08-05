/**
 * The validators refuse what they claim to refuse.
 *
 * A validator is a rule that only ever runs against valid input in practice,
 * which is the same shape of problem the fitness harness exists for: "no
 * problems found" is the only answer it can give whether the check works or
 * not. So each rule is exercised with something that breaks it, and the
 * assertion is on the CODE rather than the sentence — the wording is allowed to
 * improve without a test failing.
 */

import { describe, expect, it } from 'vitest'
import {
  InvalidAggregateError,
  assertCaseDecisionWellFormed,
  validateCaseDecision,
  validateCioReturn,
  validateCioSubmission,
  validateReconsiderationTrigger,
} from './aggregateValidation'
import {
  cioReturn,
  cioSubmission,
  declinedDecision,
  deferredDecision,
  disclosedDissent,
  eligibilityBasis,
  qualitativeTrigger,
  quantitativeTrigger,
  selectedDecision,
} from './decisionFixtures'

const codes = (problems: readonly { code: string }[]) => problems.map((p) => p.code)

describe('a valid aggregate has no problems', () => {
  it('accepts the fixtures', () => {
    expect(validateCioSubmission(cioSubmission())).toEqual([])
    expect(validateCioReturn(cioReturn())).toEqual([])
    expect(validateCaseDecision(selectedDecision())).toEqual([])
    expect(validateCaseDecision(deferredDecision())).toEqual([])
    expect(validateCaseDecision(declinedDecision())).toEqual([])
    expect(validateReconsiderationTrigger(quantitativeTrigger())).toEqual([])
    expect(validateReconsiderationTrigger(qualitativeTrigger())).toEqual([])
  })
})

describe('submissions', () => {
  it('refuses any blocker at all', () => {
    const problems = validateCioSubmission(
      cioSubmission({
        basis: eligibilityBasis({
          blockers: [{ kind: 'verification-missing', severity: 'blocks-decision' }],
        }),
      }),
    )
    expect(codes(problems)).toContain('submission-blockers-present')
  })

  it('refuses a basis describing a different revision', () => {
    const submission = cioSubmission()
    const problems = validateCioSubmission({
      ...submission,
      basis: { ...submission.basis, revisionId: 'rev-other' },
    })
    expect(codes(problems)).toContain('submission-basis-revision-mismatch')
  })

  it('refuses an unresolved Risk requirement', () => {
    expect(
      codes(
        validateCioSubmission(
          cioSubmission({ basis: eligibilityBasis({ riskRequirement: 'unresolved' }) }),
        ),
      ),
    ).toContain('submission-risk-unresolved')
  })

  it('refuses a required Risk review that is not named', () => {
    expect(
      codes(
        validateCioSubmission(
          cioSubmission({
            basis: eligibilityBasis({ riskRequirement: 'required', risk: null }),
          }),
        ),
      ),
    ).toContain('submission-risk-review-missing')
  })

  it('refuses a decision-critical disagreement, which blocks eligibility', () => {
    expect(
      codes(
        validateCioSubmission(
          cioSubmission({
            basis: eligibilityBasis({
              materialDisagreements: [
                { claimId: 'claim-1', materiality: 'decision-critical' },
              ],
            }),
          }),
        ),
      ),
    ).toContain('submission-decision-critical-disagreement')
  })

  it('refuses a basis with no policy version or provenance', () => {
    const problems = validateCioSubmission(
      cioSubmission({
        basis: eligibilityBasis({
          eligibilityPolicyVersion: '  ',
          storageProvenanceId: '',
        }),
      }),
    )
    expect(codes(problems)).toEqual(
      expect.arrayContaining([
        'submission-no-policy-version',
        'submission-no-provenance',
      ]),
    )
  })
})

describe('returns', () => {
  it('refuses a return with no reason', () => {
    expect(codes(validateCioReturn(cioReturn({ reason: '  ' })))).toContain(
      'return-no-reason',
    )
  })

  it('refuses a return with no authorization basis', () => {
    expect(codes(validateCioReturn(cioReturn({ authorizationBasis: '' })))).toContain(
      'return-no-authorization',
    )
  })

  it('refuses a concern that names no subject or states no detail', () => {
    const problems = validateCioReturn(
      cioReturn({
        concerns: [
          { concernKind: 'vague', subjectKind: 'claim', subjectId: '', detail: '  ' },
        ],
      }),
    )
    expect(codes(problems)).toEqual(
      expect.arrayContaining(['return-concern-no-detail', 'return-concern-no-subject']),
    )
  })
})

describe('triggers', () => {
  it('refuses a quantitative threshold with no unit', () => {
    expect(
      codes(
        validateReconsiderationTrigger(
          quantitativeTrigger({ threshold: { amount: '3.5', unit: ' ' } }),
        ),
      ),
    ).toContain('trigger-threshold-no-unit')
  })

  it('refuses a quantitative trigger with no threshold at all', () => {
    expect(
      codes(
        validateReconsiderationTrigger(quantitativeTrigger({ threshold: undefined })),
      ),
    ).toContain('trigger-threshold-missing')
  })

  it('refuses a condition nothing could ever evaluate', () => {
    expect(
      codes(
        validateReconsiderationTrigger(
          qualitativeTrigger({ qualitativeCondition: undefined }),
        ),
      ),
    ).toContain('trigger-unevaluable')
  })

  it('refuses a comparison against nothing', () => {
    expect(
      codes(
        validateReconsiderationTrigger(
          qualitativeTrigger({ comparator: 'above', threshold: undefined }),
        ),
      ),
    ).toContain('trigger-comparison-without-threshold')
  })

  it('allows `changes`, which needs no threshold', () => {
    expect(
      validateReconsiderationTrigger(
        qualitativeTrigger({ comparator: 'changes', threshold: undefined }),
      ),
    ).toEqual([])
  })
})

describe('decisions', () => {
  it('refuses a decision with no rationale, evidence or authority', () => {
    const problems = validateCaseDecision(
      selectedDecision({ rationale: ' ', evidenceSetId: '', authorizationBasis: '' }),
    )
    expect(codes(problems)).toEqual(
      expect.arrayContaining([
        'decision-no-rationale',
        'decision-no-evidence',
        'decision-no-authorization',
      ]),
    )
  })

  it('refuses a decision that considers nothing', () => {
    expect(
      codes(
        validateCaseDecision(
          selectedDecision({
            outcome: {
              kind: 'selected',
              selectedRevisionId: 'rev-1',
              consideredRevisionIds: [],
            },
            submissionIds: [],
          }),
        ),
      ),
    ).toContain('decision-considers-nothing')
  })

  it('refuses a revision named twice', () => {
    expect(
      codes(
        validateCaseDecision(
          selectedDecision({
            outcome: {
              kind: 'selected',
              selectedRevisionId: 'rev-1',
              consideredRevisionIds: ['rev-1', 'rev-1'],
            },
          }),
        ),
      ),
    ).toContain('decision-duplicate-considered')
  })

  it('refuses selecting something that was never considered', () => {
    expect(
      codes(
        validateCaseDecision(
          selectedDecision({
            outcome: {
              kind: 'selected',
              selectedRevisionId: 'rev-9',
              consideredRevisionIds: ['rev-1', 'rev-2'],
            },
          }),
        ),
      ),
    ).toContain('decision-selected-not-considered')
  })

  it('refuses a deferral with no condition that would end the wait', () => {
    expect(
      codes(validateCaseDecision(deferredDecision({ reconsiderationTriggers: [] }))),
    ).toContain('decision-deferral-without-condition')
  })

  it('refuses a decline leaving a considered revision unaccounted for', () => {
    expect(
      codes(
        validateCaseDecision(
          declinedDecision({
            outcome: {
              kind: 'declined',
              declinedRevisionIds: ['rev-1'],
              consideredRevisionIds: ['rev-1', 'rev-2'],
            },
          }),
        ),
      ),
    ).toContain('decision-decline-incomplete')
  })

  it('refuses a submission count that does not match the revisions', () => {
    expect(
      codes(validateCaseDecision(selectedDecision({ submissionIds: ['sub-1'] }))),
    ).toContain('decision-submission-count')
  })

  it('refuses one submission referenced twice', () => {
    expect(
      codes(
        validateCaseDecision(selectedDecision({ submissionIds: ['sub-1', 'sub-1'] })),
      ),
    ).toContain('decision-duplicate-submission')
  })

  it('refuses unacknowledged material dissent', () => {
    expect(
      codes(
        validateCaseDecision(
          selectedDecision({
            unresolvedDissent: [disclosedDissent({ acknowledgement: undefined })],
          }),
        ),
      ),
    ).toContain('dissent-unacknowledged')
  })

  it('allows non-material dissent with no acknowledgement', () => {
    expect(
      validateCaseDecision(
        selectedDecision({
          unresolvedDissent: [
            disclosedDissent({ materiality: 'non-material', acknowledgement: undefined }),
          ],
        }),
      ),
    ).toEqual([])
  })

  it('refuses dissent about a revision the decision never considered', () => {
    expect(
      codes(
        validateCaseDecision(
          selectedDecision({
            unresolvedDissent: [disclosedDissent({ revisionId: 'rev-elsewhere' })],
          }),
        ),
      ),
    ).toContain('dissent-revision-not-considered')
  })

  it('refuses two triggers under one id', () => {
    expect(
      codes(
        validateCaseDecision(
          selectedDecision({
            reconsiderationTriggers: [quantitativeTrigger(), quantitativeTrigger()],
          }),
        ),
      ),
    ).toContain('decision-duplicate-trigger')
  })

  it('carries a trigger problem up to the decision', () => {
    expect(
      codes(
        validateCaseDecision(
          selectedDecision({
            reconsiderationTriggers: [quantitativeTrigger({ threshold: undefined })],
          }),
        ),
      ),
    ).toContain('trigger-threshold-missing')
  })

  it('refuses a decision that supersedes itself', () => {
    expect(
      codes(validateCaseDecision(selectedDecision({ supersedesDecisionId: 'dec-1' }))),
    ).toContain('decision-supersedes-itself')
  })
})

describe('the assert wrappers', () => {
  it('throw carrying the first problem code', () => {
    try {
      assertCaseDecisionWellFormed(selectedDecision({ rationale: '' }))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidAggregateError)
      expect((error as InvalidAggregateError).code).toBe('decision-no-rationale')
    }
  })

  it('report every problem, not just the first', () => {
    const problems = validateCaseDecision(
      selectedDecision({ rationale: '', evidenceSetId: '' }),
    )
    expect(problems.length).toBeGreaterThan(1)
  })
})
