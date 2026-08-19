/**
 * Submissions, returns and decisions to test with.
 *
 * Shared by the mapping round-trip tests and the repository contract suite so
 * both are exercising the same shapes. Every builder takes an override object
 * and fills a complete, valid record — a fixture that is minimal by default
 * would let a mapper drop an optional field and still pass, which is the exact
 * failure the round-trip tests exist to catch.
 */

import { buildBasisManifest, buildEvidenceSet, observationRef } from './index'
import type { BasisContent } from './basisManifest'
import type { DisagreementMateriality } from './aggregation'
import type { CaseReconsideration } from './decisions'
import type {
  ActorSnapshot,
  CaseDecision,
  CioReturn,
  CioSubmission,
  DisclosedDissent,
  EligibilityBasis,
  EvidenceSet,
  ReconsiderationTrigger,
} from './index'

/**
 * The storage provenance the seeded records were written under.
 *
 * A provenance id is content-addressed from the adapter's own coordinates, so
 * it cannot be written down here — the in-memory store and PostgreSQL derive
 * different ones, and hard-coding either would make a fixture that only works
 * against one adapter. The seed publishes what its adapter reported.
 */
let seededProvenanceId = 'prov-1'
export const setSeededProvenanceId = (id: string) => {
  seededProvenanceId = id
}
export const getSeededProvenanceId = () => seededProvenanceId

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
/**
 * Governance artifact ids, derived from the revision they belong to.
 *
 * Derived rather than fixed, because the repositories now verify that every
 * cited review, aggregation and challenge belongs to the exact revision. A
 * fixture with one shared `review-v1` would either fail everywhere or force the
 * check to be weakened — and citing another revision's verdict is precisely the
 * failure the check exists to catch, so the fixtures have to be able to express
 * both the right case and the wrong one.
 */
export const verificationIdFor = (revisionId: string) => `review-v-${revisionId}`
export const devilsAdvocateIdFor = (revisionId: string) => `review-d-${revisionId}`
export const riskIdFor = (revisionId: string) => `review-r-${revisionId}`
export const aggregationIdFor = (revisionId: string) => `agg-${revisionId}`
export const challengeIdsFor = (revisionId: string) =>
  [`challenge-b-${revisionId}`, `challenge-a-${revisionId}`] as const
export const runIdsFor = (revisionId: string) =>
  [`run-1-${revisionId}`, `run-2-${revisionId}`] as const
export const claimIdFor = (revisionId: string) => `claim-${revisionId}`

/**
 * The evidence sets the seed creates, built here so both sides agree on the ids.
 *
 * An evidence set id is content-addressed, so it cannot be chosen — it falls out
 * of the observations. Building them in one place and deriving the ids from the
 * built objects is what lets a fixture cite a set the seed will actually have
 * created, without either side hard-coding a hash.
 */
export function evidenceSetsFor(revisionId: string): readonly EvidenceSet[] {
  return [1, 2].map((n) =>
    buildEvidenceSet({
      items: [
        {
          ref: observationRef(
            {
              subjectKind: 'series',
              subject: `US${n}0Y`,
              kind: 'yield',
              observedAt: '2026-07-28T08:00:00.000Z',
              /* The payload's own observation date, as `yieldRef` supplies it. */
              referencePeriod: '2026-07-28',
              sourceId: 'treasury',
            },
            /*
             * The yield projection, complete. It used to be `{ value: n }` --
             * the QUOTE projection's field, under a `yield` kind, with the
             * number never converted to a canonical decimal. Nothing verified
             * the relationship, so nothing noticed.
             */
            {
              yieldPercent: String(n),
              changeBasisPoints: null,
              observationDate: '2026-07-28',
            },
          ),
          value: {
            yieldPercent: String(n),
            changeBasisPoints: null,
            observationDate: '2026-07-28',
          },
        },
      ],
      assembledAt: '2026-07-28T08:00:00.000Z',
      correlationId: `seed-${revisionId}`,
    } as never),
  )
}

export const evidenceSetIdsFor = (revisionId: string) =>
  evidenceSetsFor(revisionId).map((set) => set.id)

/**
 * References into the seeded sets, for dissent that cites its evidence.
 *
 * `decision_dissent_evidence` carries a composite foreign key to
 * `evidence_items (evidence_set_id, observation_id)`, so a fixture citing an
 * invented observation is a fixture that only works against the in-memory
 * store.
 */
export function evidenceRefsFor(revisionId: string) {
  return evidenceSetsFor(revisionId).map((set) => ({
    setId: set.id,
    observationId: set.items[0]!.ref.id,
    contentHash: set.items[0]!.ref.contentHash,
  }))
}

export function eligibilityBasis(over: Partial<EligibilityBasis> = {}): EligibilityBasis {
  const revisionId = over.revisionId ?? 'rev-1'
  const content = {
    revisionId,
    thesisId: 'thesis-1',
    aggregationId: aggregationIdFor(revisionId),
    eligibilityPolicyVersion: '1',
    blockers: [],
    verification: {
      reviewId: verificationIdFor(revisionId),
      sequence: 1,
      status: 'verified',
    },
    devilsAdvocate: {
      reviewId: devilsAdvocateIdFor(revisionId),
      sequence: 1,
      /*
       * Deliberately mixed: the whole point of v2 is that materiality is a
       * fact the gate reads, so a fixture where every challenge weighs the
       * same would exercise the new shape without exercising the change.
       */
      openChallenges: challengeIdsFor(revisionId).map((challengeId, index) => ({
        challengeId,
        materiality: (index === 0
          ? 'non-material'
          : 'material') satisfies DisagreementMateriality,
      })),
    },
    risk: { reviewId: riskIdFor(revisionId), sequence: 1, status: 'accepted' },
    riskRequirement: 'required',
    riskRuleId: 'risk-rule-1',
    riskRuleVersion: '1',
    requiredWork: [
      { playbookEntryKey: 'macro-scan', runId: runIdsFor(revisionId)[0] },
      { playbookEntryKey: 'credit-check', runId: runIdsFor(revisionId)[1] },
    ],
    materialDisagreements: [{ claimId: claimIdFor(revisionId), materiality: 'material' }],
    evidenceSetIds: [...evidenceSetIdsFor(revisionId)].reverse(),
    storageProvenanceId: seededProvenanceId,
    evaluatedAt: '2026-07-28T08:59:00.000Z',
    ...over,
  }

  /*
   * Derived rather than fixed. A hard-coded digest would have to be updated by
   * hand every time a fixture field changed, and the version that was easiest
   * to update would be the one that stopped matching.
   */
  return {
    ...content,
    manifest: buildBasisManifest(
      { submissionId: 'sub-1', caseId: 'case-1' },
      content as BasisContent,
    ),
  } as EligibilityBasis
}

export function cioSubmission(over: Partial<CioSubmission> = {}): CioSubmission {
  const revisionId = over.revisionId ?? 'rev-1'
  const submission: CioSubmission = {
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

  /*
   * The manifest binds the submission identity, which the basis fixture cannot
   * know -- so it is rebuilt here for whatever id and case this submission
   * actually has.
   */
  return {
    ...submission,
    basis: {
      ...submission.basis,
      manifest: buildBasisManifest(
        { submissionId: submission.id, caseId: submission.caseId },
        submission.basis as BasisContent,
      ),
    },
  }
}

export function cioReturn(over: Partial<CioReturn> = {}): CioReturn {
  /*
   * Concern subjects follow the revision, because a concern must belong to the
   * revision its return is about. A fixed `rev-1` subject on a `rev-2` return
   * is the wrong-revision citation the rule exists to refuse.
   */
  const revisionId = over.revisionId ?? 'rev-1'
  return {
    id: 'ret-1',
    submissionId: 'sub-1',
    caseId: 'case-1',
    revisionId,
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
        // A real seeded claim: concern subjects must belong to the return's case.
        subjectId: claimIdFor(revisionId),
        detail: 'One print is not a trend.',
      },
      {
        concernKind: 'alternative-missing',
        subjectKind: 'revision',
        subjectId: revisionId,
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
    sourceId: 'challenge-a-rev-1',
    revisionId: 'rev-1',
    claimId: claimIdFor('rev-1'),
    materiality: 'material',
    // Real seeded ids: the dissent columns are foreign keys.
    raisedByEmployeeId: 'devils-advocate-head',
    raisedByDepartmentId: 'devils-advocate',
    rationale: 'The credit impulse argument was never answered.',
    // Reversed, so the round-trip test proves the mapper canonicalises an
    // order the store cannot preserve.
    evidence: [...evidenceRefsFor('rev-1')].reverse(),
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
    evidenceSetId: evidenceSetIdsFor('rev-1')[0]!,
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

/** A reopening of `deferredDecision`, citing the trigger that decision carries. */
export function caseReconsideration(
  over: Partial<CaseReconsideration> = {},
): CaseReconsideration {
  return {
    id: 'rec-1',
    caseId: 'case-1',
    revisionId: 'rev-1',
    reconsidersDecisionId: 'dec-deferred',
    submissionId: 'sub-1',
    reopenedAt: '2026-07-28T14:00:00.000Z',
    reopenedBy: cioActor(),
    reopenedByEmployeeId: 'cio',
    authorizationBasis: 'mandate:chief-decision',
    firedTriggers: [
      {
        /* , from , which the deferral carries. */
        triggerId: 'trg-1',
        observation: 'The June projections landed and quantified the impulse.',
      },
    ],
    caseVersion: 4,
    ...over,
  }
}
