/**
 * Submissions, returns and decisions to test with.
 *
 * Shared by the mapping round-trip tests and the repository contract suite so
 * both are exercising the same shapes. Every builder takes an override object
 * and fills a complete, valid record — a fixture that is minimal by default
 * would let a mapper drop an optional field and still pass, which is the exact
 * failure the round-trip tests exist to catch.
 */

import type {
  ActorSnapshot,
  CaseDecision,
  CioReturn,
  CioSubmission,
  DisclosedDissent,
  EligibilityBasis,
  ReconsiderationTrigger,
} from './index'

export const DECIDED_AT = '2026-07-28T13:00:00.000Z'
export const SUBMITTED_AT = '2026-07-28T09:00:00.000Z'

export function cioActor(over: Partial<ActorSnapshot> = {}): ActorSnapshot {
  return {
    kind: 'employee',
    employeeId: 'cio',
    roleId: 'role-cio',
    roleFunction: 'executive',
    departmentId: 'executive',
    departmentIsGovernance: false,
    // Canonically sorted where the snapshot is built, so the fixture is too.
    departmentHandles: ['chief-decision', 'strategy'],
    authentication: 'system-asserted',
    organizationSeedVersion: '1',
    ...over,
  }
}

/**
 * A fully populated eligibility basis.
 *
 * Every optional field present, because a mapper that silently drops one would
 * pass against a sparse fixture. `blockers` is empty and must stay empty — a
 * valid submission has none, and the repositories refuse one that does.
 */
export function eligibilityBasis(over: Partial<EligibilityBasis> = {}): EligibilityBasis {
  return {
    revisionId: 'rev-1',
    thesisId: 'thesis-1',
    aggregationId: 'agg-1',
    eligibilityPolicyVersion: '1',
    blockers: [],
    verification: { reviewId: 'review-v1', sequence: 1, status: 'verified' },
    devilsAdvocate: {
      reviewId: 'review-d1',
      sequence: 1,
      openChallengeIds: ['challenge-b', 'challenge-a'],
    },
    risk: { reviewId: 'review-r1', sequence: 1, status: 'accepted' },
    riskRequirement: 'required',
    riskRuleId: 'risk-rule-1',
    riskRuleVersion: '1',
    requiredWork: [
      { playbookEntryKey: 'macro-scan', runId: 'run-1' },
      { playbookEntryKey: 'credit-check', runId: 'run-2' },
    ],
    materialDisagreements: [{ claimId: 'claim-1', materiality: 'material' }],
    evidenceSetIds: ['set-2', 'set-1'],
    storageProvenanceId: 'prov-1',
    evaluatedAt: '2026-07-28T08:59:00.000Z',
    ...over,
  }
}

export function cioSubmission(over: Partial<CioSubmission> = {}): CioSubmission {
  const revisionId = over.revisionId ?? 'rev-1'
  return {
    id: 'sub-1',
    caseId: 'case-1',
    thesisId: 'thesis-1',
    revisionId,
    submittedByDepartmentId: 'research-office',
    submittedByEmployeeId: 'research-director',
    submittedAt: SUBMITTED_AT,
    caseVersion: 3,
    state: 'pending',
    basis: eligibilityBasis({ revisionId, thesisId: over.thesisId ?? 'thesis-1' }),
    ...over,
  }
}

export function cioReturn(over: Partial<CioReturn> = {}): CioReturn {
  return {
    id: 'ret-1',
    submissionId: 'sub-1',
    caseId: 'case-1',
    revisionId: 'rev-1',
    returnedAt: '2026-07-28T12:00:00.000Z',
    returnedBy: cioActor(),
    authorizationBasis: 'mandate:chief-decision',
    returnedFor: 'insufficient-evidence',
    reason: 'The inflation path rests on one observation.',
    caseVersion: 3,
    concerns: [
      {
        concernKind: 'evidence-thin',
        subjectKind: 'claim',
        subjectId: 'claim-1',
        detail: 'One print is not a trend.',
      },
      {
        concernKind: 'alternative-missing',
        subjectKind: 'revision',
        subjectId: 'rev-1',
        detail: 'No downside case was put forward.',
      },
    ],
    ...over,
  }
}

/** Dissent with every optional field filled, including evidence. */
export function disclosedDissent(over: Partial<DisclosedDissent> = {}): DisclosedDissent {
  return {
    source: 'devils-advocate-challenge',
    sourceId: 'challenge-a',
    revisionId: 'rev-1',
    claimId: 'claim-1',
    materiality: 'material',
    raisedByEmployeeId: 'challenger',
    raisedByDepartmentId: 'research-office',
    rationale: 'The credit impulse argument was never answered.',
    evidence: [
      { setId: 'set-1', observationId: 'obs-2', contentHash: 'hash-2' },
      { setId: 'set-1', observationId: 'obs-1', contentHash: 'hash-1' },
    ],
    whyNotBlocking: 'below-threshold',
    acknowledgement: 'Weighed and accepted; the position is sized for it.',
    dispositionAtDecision: 'accepted-as-risk',
    ...over,
  }
}

export function quantitativeTrigger(
  over: Partial<ReconsiderationTrigger> = {},
): ReconsiderationTrigger {
  return {
    id: 'trg-1',
    conditionType: 'quantitative-threshold',
    subject: { kind: 'series', ref: 'cpi-yoy' },
    comparator: 'above',
    threshold: { amount: '3.5', unit: 'percent', currency: 'EUR' },
    expectedSource: 'eurostat',
    rationale: 'Above this the disinflation thesis stops holding.',
    createdByEmployeeId: 'cio',
    createdAt: DECIDED_AT,
    policyVersion: '1',
    ...over,
  }
}

/** The qualitative flavour: no comparator, a stated condition instead. */
export function qualitativeTrigger(
  over: Partial<ReconsiderationTrigger> = {},
): ReconsiderationTrigger {
  return {
    id: 'trg-2',
    conditionType: 'policy-change',
    subject: { kind: 'policy-rate', ref: 'ecb-depo' },
    qualitativeCondition: 'The ECB abandons forward guidance.',
    rationale: 'The path depends on guidance holding.',
    createdByEmployeeId: 'cio',
    createdAt: DECIDED_AT,
    // Deliberately different from its sibling: each trigger carries its own.
    policyVersion: '1',
    ...over,
  }
}

export function selectedDecision(over: Partial<CaseDecision> = {}): CaseDecision {
  return {
    decisionId: 'dec-1',
    caseId: 'case-1',
    aggregateVersion: 3,
    decidedAt: DECIDED_AT,
    decidedByEmployeeId: 'cio',
    decidedBy: cioActor(),
    authorizationBasis: 'mandate:chief-decision',
    outcome: {
      kind: 'selected',
      selectedRevisionId: 'rev-1',
      consideredRevisionIds: ['rev-1', 'rev-2'],
    },
    submissionIds: ['sub-1', 'sub-2'],
    evidenceSetId: 'set-1',
    rationale: 'The disinflation path is better evidenced than the alternative.',
    unresolvedDissent: [disclosedDissent()],
    reconsiderationTriggers: [quantitativeTrigger(), qualitativeTrigger()],
    ...over,
  }
}

export function deferredDecision(over: Partial<CaseDecision> = {}): CaseDecision {
  return selectedDecision({
    decisionId: 'dec-deferred',
    outcome: { kind: 'deferred', consideredRevisionIds: ['rev-1', 'rev-2'] },
    ...over,
  })
}

export function declinedDecision(over: Partial<CaseDecision> = {}): CaseDecision {
  return selectedDecision({
    decisionId: 'dec-declined',
    outcome: {
      kind: 'declined',
      declinedRevisionIds: ['rev-1', 'rev-2'],
      consideredRevisionIds: ['rev-1', 'rev-2'],
    },
    ...over,
  })
}
