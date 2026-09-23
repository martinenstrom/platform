/**
 * Correction ownership follows provenance, and the firm corrects on its own
 * once (TD-99, ruled 2026-09-22).
 *
 * A finding names a claim; the claim was produced by one accepted run; the
 * run belongs to a desk. Nothing here asks who should fix it — the record
 * already says whose it is.
 */

import { describe, expect, it } from 'vitest'
import type { AgentRunRecord } from './contributions'
import type { VerificationFinding, VerificationReview } from './review'
import type { InvestmentThesis } from './theses'
import {
  automaticCorrectionPermitted,
  correctionRoundsTaken,
  correctionsOwed,
  correctionsOwedBy,
  MAX_AUTOMATIC_CORRECTION_ROUNDS,
} from './index'

const run = (
  id: string,
  departmentId: string,
  claims: readonly { id: string; statement: string }[],
  over: Partial<AgentRunRecord> = {},
): AgentRunRecord =>
  ({
    id,
    caseId: 'case-1',
    assignmentId: `asg-${departmentId}`,
    departmentId,
    state: 'completed',
    claims: claims.map((claim) => ({ ...claim })),
    ...over,
  }) as unknown as AgentRunRecord

const finding = (claimId: string, over: Partial<VerificationFinding> = {}): VerificationFinding => ({
  kind: 'value-mismatch',
  claimId,
  detail: `${claimId} states a figure the cited observation does not show`,
  severity: 'material',
  blocking: true,
  correctionRequired: `restate ${claimId} from the observation, or withdraw it`,
  ...over,
})

const review = (findings: readonly VerificationFinding[]): VerificationReview =>
  ({
    reviewId: 'ver-1',
    caseId: 'case-1',
    scope: 'thesis-revision',
    thesisId: 'thesis-1',
    revisionId: 'rev-2',
    byDepartmentId: 'verification',
    status: 'correction-required',
    findings,
    claimsReviewed: findings.map((f) => f.claimId),
  }) as unknown as VerificationReview

const runs = [
  run('run-macro', 'global-macro', [{ id: 'c-macro-1', statement: 'Real yields fell 12 bp.' }]),
  run('run-rates', 'rates', [{ id: 'c-rates-1', statement: 'The curve bull-steepened.' }]),
  run('run-office', 'research-office', [{ id: 'c-office-1', statement: 'The desks agree on the driver.' }]),
]

describe('ownership follows provenance', () => {
  it('sends a defect in a specialist claim to the desk that produced it, with the claim as written', () => {
    const ownership = correctionsOwed(review([finding('c-macro-1')]), runs)
    expect(ownership.unattributed).toEqual([])
    expect(ownership.owed).toEqual([
      {
        departmentId: 'global-macro',
        assignmentId: 'asg-global-macro',
        runId: 'run-macro',
        findings: [
          expect.objectContaining({
            claimId: 'c-macro-1',
            statement: 'Real yields fell 12 bp.',
            kind: 'value-mismatch',
            correctionRequired: 'restate c-macro-1 from the observation, or withdraw it',
          }),
        ],
      },
    ])
  })

  it('sends a defect the synthesis introduced to the Research Office, not to a desk', () => {
    const ownership = correctionsOwed(review([finding('c-office-1')]), runs)
    expect(ownership.owed.map((owed) => owed.departmentId)).toEqual(['research-office'])
    expect(correctionsOwedBy(ownership, 'global-macro')).toEqual([])
  })

  it('sends a citation defect to the owner of the claim, whoever that is', () => {
    const ownership = correctionsOwed(
      review([finding('c-rates-1', { kind: 'unresolved-citation' }), finding('c-office-1', { kind: 'unresolved-citation' })]),
      runs,
    )
    expect(ownership.owed.map((owed) => [owed.departmentId, owed.findings.length])).toEqual([
      ['rates', 1],
      ['research-office', 1],
    ])
  })

  it('groups every finding on one run under its one owner', () => {
    const macro = run('run-macro', 'global-macro', [
      { id: 'c-macro-1', statement: 'a' },
      { id: 'c-macro-2', statement: 'b' },
    ])
    const ownership = correctionsOwed(review([finding('c-macro-1'), finding('c-macro-2')]), [macro])
    expect(ownership.owed).toHaveLength(1)
    expect(ownership.owed[0]!.findings.map((f) => f.claimId)).toEqual(['c-macro-1', 'c-macro-2'])
  })

  it('asks nothing of anyone for an advisory finding', () => {
    const ownership = correctionsOwed(review([finding('c-macro-1', { blocking: false, correctionRequired: undefined })]), runs)
    expect(ownership.owed).toEqual([])
    expect(ownership.unattributed).toEqual([])
  })

  it('never attributes a finding to work the firm did not accept', () => {
    /* The planted violation: the claim exists only on a run the desk never adopted, or nowhere. */
    const unadopted = run('run-x', 'global-macro', [{ id: 'c-x', statement: 'x' }], { state: 'awaiting-acceptance' })
    const ownership = correctionsOwed(review([finding('c-x'), finding('c-nowhere')]), [...runs, unadopted])
    expect(ownership.owed).toEqual([])
    expect(ownership.unattributed.map((f) => f.claimId)).toEqual(['c-x', 'c-nowhere'])
  })

  it('still attributes a finding to the run that produced the claim after that run was replaced', () => {
    /* Provenance does not move: the ownership reads the same before and after the correction is adopted. */
    const replaced = run('run-y', 'rates', [{ id: 'c-y', statement: 'y' }], { obsolete: true })
    const ownership = correctionsOwed(review([finding('c-y')]), [...runs, replaced])
    expect(ownership.owed.map((owed) => [owed.departmentId, owed.runId])).toEqual([['rates', 'run-y']])
    expect(ownership.unattributed).toEqual([])
  })
})

describe('the firm corrects on its own once', () => {
  const revision = (revisionNumber: number, revisionCause: InvestmentThesis['revisionCause'], thesisId = 'thesis-1') =>
    ({ thesisId, revisionId: `rev-${revisionNumber}`, revisionNumber, revisionCause }) as unknown as InvestmentThesis

  it('counts rounds off the lineage, one per successor minted as a correction', () => {
    expect(correctionRoundsTaken([revision(1, 'initial-proposal'), revision(2, 'manager-aggregation')])).toBe(0)
    expect(
      correctionRoundsTaken([revision(1, 'initial-proposal'), revision(2, 'manager-aggregation'), revision(3, 'correction')]),
    ).toBe(1)
  })

  it('counts only the lineage asked about', () => {
    expect(correctionRoundsTaken([revision(3, 'correction', 'other'), revision(2, 'manager-aggregation')], 'thesis-1')).toBe(0)
  })

  it('permits exactly the ruled number of automatic rounds, then stops', () => {
    expect(MAX_AUTOMATIC_CORRECTION_ROUNDS).toBe(1)
    expect(automaticCorrectionPermitted(0)).toBe(true)
    expect(automaticCorrectionPermitted(1)).toBe(false)
    expect(automaticCorrectionPermitted(2)).toBe(false)
  })
})
