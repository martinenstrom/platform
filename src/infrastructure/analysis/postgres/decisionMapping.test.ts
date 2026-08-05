/**
 * The mapping loses nothing.
 *
 * This is the most consequential property in C1D-1B and the one that fails
 * most quietly. Write-once conflict detection is read-back-and-compare: the
 * store reads what it holds, maps it to the domain, and compares semantic keys.
 * So a mapper that drops a field, reorders a collection or turns an absent key
 * into an explicit `null` makes a **benign replay** compute a different key —
 * and a correct retry gets reported as an institutional disagreement. Under
 * retry, which is when the system is already having a bad day.
 *
 * Asserting on the semantic key rather than on deep equality is deliberate: the
 * key is what the repositories actually compare, so it is the property that
 * matters. Deep equality would also fail on differences the key forgives, and
 * would pass on a key that had quietly stopped covering a field.
 */

import { describe, expect, it } from 'vitest'
import {
  cioReturnSemanticKey,
  cioSubmissionSemanticKey,
  decisionSemanticKey,
} from '~/application/analysis/writeOnce'
import { MalformedRowError } from '~/application/analysis/repositories'
import {
  decisionFromRows,
  decisionToRows,
  returnFromRows,
  returnToRows,
  submissionFromRows,
  submissionToRows,
} from './decisionMapping'
import {
  cioReturn,
  cioSubmission,
  claimIdFor,
  declinedDecision,
  deferredDecision,
  disclosedDissent,
  eligibilityBasis,
  evidenceRefsFor,
  qualitativeTrigger,
  quantitativeTrigger,
  riskIdFor,
  selectedDecision,
  verificationIdFor,
} from '~/domain/analysis/decisionFixtures'

const roundTripSubmission = (submission = cioSubmission()) =>
  submissionFromRows(submissionToRows(submission))

const roundTripDecision = (decision = selectedDecision()) =>
  decisionFromRows(decisionToRows(decision))

describe('a submission survives the round trip', () => {
  it('keeps its semantic identity', () => {
    const original = cioSubmission()
    expect(cioSubmissionSemanticKey(roundTripSubmission(original))).toBe(
      cioSubmissionSemanticKey(original),
    )
  })

  it('reconstructs blockers as an explicit empty array', () => {
    // Not a default papering over a dropped field: a valid submission has none,
    // and the repositories refuse one that does.
    expect(roundTripSubmission().basis.blockers).toEqual([])
  })

  it('keeps every optional review reference', () => {
    const basis = roundTripSubmission().basis
    expect(basis.verification).toEqual({
      reviewId: verificationIdFor('rev-1'),
      sequence: 1,
      status: 'verified',
    })
    expect(basis.risk).toEqual({
      reviewId: riskIdFor('rev-1'),
      sequence: 1,
      status: 'accepted',
    })
    // Byte order on read, whatever order the caller listed them in.
    expect(basis.devilsAdvocate?.openChallengeIds).toEqual([
      'challenge-a-rev-1',
      'challenge-b-rev-1',
    ])
  })

  it('keeps a basis with every optional field absent', () => {
    const sparse = cioSubmission({
      basis: eligibilityBasis({
        aggregationId: null,
        verification: null,
        devilsAdvocate: null,
        risk: null,
        riskRequirement: 'not-required',
        riskRuleId: null,
        riskRuleVersion: null,
        requiredWork: [],
        materialDisagreements: [],
        evidenceSetIds: [],
      }),
    })
    expect(cioSubmissionSemanticKey(roundTripSubmission(sparse))).toBe(
      cioSubmissionSemanticKey(sparse),
    )
    expect(roundTripSubmission(sparse).basis.verification).toBeNull()
  })

  it('keeps required work and disagreements individually', () => {
    const basis = roundTripSubmission().basis
    expect(basis.requiredWork).toEqual([
      { playbookEntryKey: 'credit-check', runId: 'run-2-rev-1' },
      { playbookEntryKey: 'macro-scan', runId: 'run-1-rev-1' },
    ])
    expect(basis.materialDisagreements).toEqual([
      { claimId: 'claim-rev-1', materiality: 'material' },
    ])
  })

  it('preserves the eligibility policy version', () => {
    expect(roundTripSubmission().basis.eligibilityPolicyVersion).toBe('1')
  })

  it('refuses a row whose Risk requirement was never resolved', () => {
    const rows = submissionToRows(cioSubmission())
    const tampered = {
      ...rows,
      submission: { ...rows.submission, risk_requirement: 'unresolved' },
    }
    expect(() => submissionFromRows(tampered)).toThrow(MalformedRowError)
  })

  it('refuses a row naming a review with no sequence', () => {
    const rows = submissionToRows(cioSubmission())
    const tampered = {
      ...rows,
      submission: { ...rows.submission, verification_sequence: null },
    }
    expect(() => submissionFromRows(tampered)).toThrow(MalformedRowError)
  })
})

describe('a return survives the round trip', () => {
  it('keeps its semantic identity', () => {
    const original = cioReturn()
    expect(cioReturnSemanticKey(returnFromRows(returnToRows(original)))).toBe(
      cioReturnSemanticKey(original),
    )
  })

  it('keeps its concerns in order', () => {
    /*
     * Order is meaning here, unlike an evidence list: a return listing the same
     * concerns in a different order is a different instruction to whoever picks
     * the work up.
     */
    const mapped = returnFromRows(returnToRows(cioReturn()))
    expect(mapped.concerns.map((concern) => concern.subjectId)).toEqual([
      claimIdFor('rev-1'),
      'rev-1',
    ])
  })

  it('canonicalises the actor snapshot without reordering its handles', () => {
    const mapped = returnFromRows(returnToRows(cioReturn()))
    expect(mapped.returnedBy.departmentHandles).toEqual(['chief-decision', 'strategy'])
    expect(mapped.returnedBy.authentication).toBe('system-asserted')
  })

  it('refuses an actor claiming an authentication the runtime cannot perform', () => {
    const rows = returnToRows(cioReturn())
    const tampered = {
      ...rows,
      cioReturn: { ...rows.cioReturn, authentication: 'authenticated' },
    }
    expect(() => returnFromRows(tampered)).toThrow(MalformedRowError)
  })
})

describe('a decision survives the round trip', () => {
  for (const [kind, build] of [
    ['selected', selectedDecision],
    ['deferred', deferredDecision],
    ['declined', declinedDecision],
  ] as const) {
    it(`keeps a ${kind} outcome's semantic identity`, () => {
      const original = build()
      expect(decisionSemanticKey(roundTripDecision(original))).toBe(
        decisionSemanticKey(original),
      )
    })
  }

  it('rebuilds the outcome from the relations, not from a nullable column', () => {
    const mapped = roundTripDecision()
    expect(mapped.outcome.kind).toBe('selected')
    expect(mapped.outcome).toMatchObject({ selectedRevisionId: 'rev-1' })
    expect(mapped.outcome.consideredRevisionIds).toEqual(['rev-1', 'rev-2'])
  })

  it('gives a declined outcome every considered revision', () => {
    const mapped = roundTripDecision(declinedDecision())
    expect(mapped.outcome).toMatchObject({
      kind: 'declined',
      declinedRevisionIds: ['rev-1', 'rev-2'],
    })
  })

  it('gives a deferred outcome no selection at all', () => {
    const mapped = roundTripDecision(deferredDecision())
    expect('selectedRevisionId' in mapped.outcome).toBe(false)
  })

  it('pairs each considered revision with its own submission', () => {
    const rows = decisionToRows(selectedDecision())
    expect(
      rows.submissions.map((row) => [row.revision_id, row.submission_id, row.relation]),
    ).toEqual([
      ['rev-1', 'sub-1', 'selected'],
      ['rev-2', 'sub-2', 'not-selected'],
    ])
  })

  it('keeps dissent evidence references exactly, in byte order', () => {
    /*
     * The fixture lists them reversed. `decision_dissent_evidence` has no
     * ordinal — its key IS the reference — so the store cannot preserve caller
     * order and the mapper imposes a deterministic one.
     */
    const mapped = roundTripDecision()
    const expected = [...evidenceRefsFor('rev-1')].sort((left, right) =>
      left.setId < right.setId ? -1 : left.setId > right.setId ? 1 : 0,
    )
    expect(mapped.unresolvedDissent[0]?.evidence).toEqual(expected)
  })

  it('keeps dissent order across more than one entry', () => {
    const decision = selectedDecision({
      unresolvedDissent: [
        disclosedDissent({ sourceId: 'challenge-z' }),
        disclosedDissent({ sourceId: 'challenge-a', revisionId: 'rev-2' }),
      ],
    })
    // Ordinal order, not content order: one entry would prove nothing.
    expect(
      roundTripDecision(decision).unresolvedDissent.map((entry) => entry.sourceId),
    ).toEqual(['challenge-z', 'challenge-a'])
  })

  it('keeps absent optional dissent fields absent, not null', () => {
    const decision = selectedDecision({
      unresolvedDissent: [
        {
          source: 'manager-disagreement',
          sourceId: 'agg-1',
          revisionId: 'rev-1',
          materiality: 'non-material',
          rationale: 'Minor.',
          whyNotBlocking: 'below-threshold',
          dispositionAtDecision: 'acknowledged',
        },
      ],
    })
    const mapped = roundTripDecision(decision)
    const dissent = mapped.unresolvedDissent[0]!
    expect('claimId' in dissent).toBe(false)
    expect('acknowledgement' in dissent).toBe(false)
    expect('evidence' in dissent).toBe(false)
    expect(decisionSemanticKey(mapped)).toBe(decisionSemanticKey(decision))
  })

  it('keeps each trigger policy version individually', () => {
    const decision = selectedDecision({
      reconsiderationTriggers: [
        quantitativeTrigger({ policyVersion: '1' }),
        qualitativeTrigger({ policyVersion: '2' }),
      ],
    })
    expect(
      roundTripDecision(decision).reconsiderationTriggers.map(
        (trigger) => trigger.policyVersion,
      ),
    ).toEqual(['1', '2'])
  })

  it('keeps both trigger flavours whole', () => {
    const [quantitative, qualitative] = roundTripDecision().reconsiderationTriggers
    expect(quantitative).toMatchObject({
      comparator: 'above',
      threshold: { amount: '3.5', unit: 'percent', currency: 'EUR' },
      expectedSource: 'eurostat',
    })
    expect('comparator' in qualitative!).toBe(false)
    expect('threshold' in qualitative!).toBe(false)
    expect(qualitative).toMatchObject({
      qualitativeCondition: 'The ECB abandons forward guidance.',
    })
  })

  it('keeps a supersession link, and keeps its absence absent', () => {
    const correction = selectedDecision({
      decisionId: 'dec-2',
      supersedesDecisionId: 'dec-1',
    })
    expect(roundTripDecision(correction).supersedesDecisionId).toBe('dec-1')
    expect('supersedesDecisionId' in roundTripDecision()).toBe(false)
  })

  it('never writes its own superseded_by', () => {
    // Set by the successor's write. A decision that recorded its own would be
    // claiming to know it had been corrected.
    expect(
      decisionToRows(selectedDecision()).decision.superseded_by_decision_id,
    ).toBeNull()
  })

  it('invents no Compliance state anywhere', () => {
    const rows = decisionToRows(selectedDecision())
    expect(JSON.stringify(rows)).not.toMatch(/compliance/i)
  })

  it('refuses rows whose selected relation disagrees with the column', () => {
    const rows = decisionToRows(selectedDecision())
    const tampered = {
      ...rows,
      decision: { ...rows.decision, selected_revision_id: 'rev-2' },
    }
    expect(() => decisionFromRows(tampered)).toThrow(MalformedRowError)
  })

  it('refuses a selected decision where nothing holds the selected relation', () => {
    const rows = decisionToRows(selectedDecision())
    const tampered = {
      ...rows,
      submissions: rows.submissions.map((row) => ({ ...row, relation: 'not-selected' })),
    }
    expect(() => decisionFromRows(tampered)).toThrow(MalformedRowError)
  })

  it('refuses an outcome kind the firm cannot record', () => {
    const rows = decisionToRows(selectedDecision())
    const tampered = { ...rows, decision: { ...rows.decision, outcome_kind: 'vetoed' } }
    expect(() => decisionFromRows(tampered)).toThrow(MalformedRowError)
  })
})
