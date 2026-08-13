/**
 * What makes two write-once records the same record.
 *
 * The Stage 2 review found the two adapters disagreeing here: PostgreSQL threw
 * `ConflictingRecordError` for a claim whose statement had changed, and the
 * in-memory store — the authoritative one for reads until stage 5 — returned
 * the stored claim and said nothing. The rule had been implemented once and
 * approved twice.
 *
 * So the rule lives here, in one place, and both adapters call it:
 *
 *   identical semantic content  ->  return the stored record
 *   same identity, different    ->  ConflictingRecordError
 *
 * ## Why a normalized key rather than deep equality
 *
 * PostgreSQL returns collections in the order its `ORDER BY` specifies, which
 * is rarely the order the caller passed. Comparing the two directly would
 * report a conflict every time a caller listed two evidence refs in the other
 * order — a false alarm on a path whose whole purpose is to distinguish a
 * replay from a fault. Each key therefore sorts its collections before
 * hashing, so the comparison is about content and not about sequence.
 *
 * Fields that are genuinely incidental are excluded and said to be excluded.
 */

import type {
  AgentClaim,
  CaseDecision,
  CaseReconsideration,
  CioReturn,
  CioSubmission,
  EvidenceSet,
  ManagerAggregation,
  RequirementResolution,
  RunEvent,
  TransitionEvent,
} from '~/domain/analysis'
import type { StoredResult } from './resultStore'
import {
  asCanonicalValue,
  canonicalValueString,
  utf8ByteOrder,
} from '~/domain/shared/canonicalValue'

/**
 * Canonical-value v1 ordering, stated rather than defaulted.
 *
 * `Array.prototype.sort` with no comparator orders by UTF-16 code unit, which
 * is a different rule from the one the encoder uses and agrees with it only up
 * to the astral plane. A semantic key must not depend on which of the two a
 * reader assumed.
 */
/**
 * Encode a domain record that TypeScript cannot prove is canonical.
 *
 * Used point-free over collections of interface-typed records. `asCanonicalValue`
 * validates and throws, so nothing unchecked reaches the encoder.
 */
const asCanonicalValueString = (value: unknown) =>
  canonicalValueString(asCanonicalValue(value))

const sorted = (values: readonly string[]) => [...values].sort(utf8ByteOrder)

/**
 * A claim, minus nothing.
 *
 * Everything about a claim is semantic: its statement, its confidence, what it
 * cites and what it contests. A claim is cited by theses and contested by
 * challenges, so a change to any of it changes what those citations mean.
 */
export function claimSemanticKey(claim: AgentClaim): string {
  return asCanonicalValueString({
    id: claim.id,
    type: claim.type,
    statement: claim.statement,
    status: claim.status,
    confidence: {
      level: claim.confidence.level,
      cappedBy: claim.confidence.cappedBy ?? null,
      basis: sorted(claim.confidence.basis),
    },
    temporalScope: claim.temporalScope,
    contests: claim.contests ?? null,
    supportsThesisId: claim.supportsThesisId ?? null,
    opposesThesisId: claim.opposesThesisId ?? null,
    attribution: claim.type === 'causal' ? claim.attribution : null,
    evidence: sorted(
      claim.evidenceRefs.map(
        (ref) => `${ref.setId}|${ref.observationId}|${ref.contentHash}`,
      ),
    ),
    contradicting: sorted(
      claim.contradictingEvidenceRefs.map(
        (ref) => `${ref.setId}|${ref.observationId}|${ref.contentHash}`,
      ),
    ),
  })
}

/**
 * An evidence set, **including its payloads**.
 *
 * The set's id hashes `[observationId, contentHash]` per item — its
 * composition — so two sets sharing an id necessarily cite the same
 * observations at the same content hashes. It does **not** cover the stored
 * values, so a set whose payloads differ can still present the same id. That
 * gap was recorded as TD-25; comparing payloads here closes it on the write
 * path, where a mismatch means one of the two writers is wrong.
 *
 * `assembledAt` and `correlationId` are excluded: the same evidence assembled
 * twice by two resolution runs is the same evidence.
 */
export function evidenceSetSemanticKey(set: EvidenceSet): string {
  return asCanonicalValueString({
    id: set.id,
    items: [...set.items]
      .map((item) =>
        asCanonicalValueString({
          id: item.ref.id,
          contentHash: item.ref.contentHash,
          value: item.value,
        }),
      )
      .sort(utf8ByteOrder),
  })
}

/**
 * A stored agent result.
 *
 * `storedAt` is excluded — when it was written is not what it says. `inputs`
 * is included even though the key is derived from it: a mismatch there means
 * the key derivation and the recorded inputs disagree, which is worth hearing
 * about immediately.
 */
export function resultSemanticKey(result: StoredResult): string {
  return asCanonicalValueString({
    key: result.key,
    claims: result.claims.map(claimSemanticKey).sort(utf8ByteOrder),
    // Part of the identity, not a label on it: the same key holding a fixture
    // replay and a live contribution is a real disagreement about what the
    // firm knows, and returning either one silently would settle it by luck.
    providerKind: result.providerKind,
    inputs: result.inputs,
  })
}

/**
 * A manager aggregation. All of it.
 *
 * Every field is semantic: the input scope, the disposition of each claim, the
 * materiality of each disagreement and the rationale are the record. Two
 * aggregations under one id differing anywhere are two different accounts of
 * how the firm reached a position, and returning either one silently would
 * settle that by luck.
 */
export function managerAggregationSemanticKey(aggregation: ManagerAggregation): string {
  return asCanonicalValueString({
    id: aggregation.id,
    caseId: aggregation.caseId,
    thesisId: aggregation.thesisId,
    sourceRevisionId: aggregation.sourceRevisionId,
    producedRevisionId: aggregation.producedRevisionId,
    managerEmployeeId: aggregation.managerEmployeeId,
    departmentId: aggregation.departmentId,
    aggregatedAt: aggregation.aggregatedAt,
    rationale: aggregation.rationale,
    inputs: [...aggregation.inputs]
      .map((input) => asCanonicalValueString(input))
      .sort(utf8ByteOrder),
    dispositions: [...aggregation.dispositions]
      .map((record) => asCanonicalValueString(record))
      .sort(utf8ByteOrder),
    optionalInputs: [...aggregation.optionalInputs]
      .map((record) => asCanonicalValueString(record))
      .sort(utf8ByteOrder),
  })
}

/**
 * A committed decision. All of it — this is the record that matters most.
 *
 * Keyed on the decision's content rather than its id, so a retry storing the
 * same decision is idempotent and a *different* decision under the same derived
 * id is two decisions wearing one name and fails. `supersedesDecisionId` is
 * part of it: a correction is a different institutional act from the decision
 * it corrects, even where everything else about them matches.
 */
export function decisionSemanticKey(decision: CaseDecision): string {
  return asCanonicalValueString({
    caseId: decision.caseId,
    aggregateVersion: decision.aggregateVersion,
    decidedAt: decision.decidedAt,
    decidedByEmployeeId: decision.decidedByEmployeeId,
    outcome: asCanonicalValueString({
      kind: decision.outcome.kind,
      selectedRevisionId:
        decision.outcome.kind === 'selected' ? decision.outcome.selectedRevisionId : null,
      considered: sorted(decision.outcome.consideredRevisionIds),
      declined:
        decision.outcome.kind === 'declined'
          ? sorted(decision.outcome.declinedRevisionIds)
          : [],
    }),
    submissionIds: sorted(decision.submissionIds),
    evidenceSetId: decision.evidenceSetId,
    rationale: decision.rationale,
    /*
     * Each dissent's EVIDENCE is canonicalised too, not just the dissent list.
     *
     * `decision_dissent_evidence` has no ordinal — its key is the reference
     * itself — so the store cannot preserve the order the caller passed and a
     * read has to impose one. Hashing the caller's order would make every
     * benign replay of a decision whose dissent cites two observations compute
     * a different key and be reported as a conflicting decision.
     */
    unresolvedDissent: sorted(
      decision.unresolvedDissent.map((dissent) =>
        asCanonicalValueString({
          ...dissent,
          evidence: dissent.evidence
            ? [...dissent.evidence].map(asCanonicalValueString).sort(utf8ByteOrder)
            : null,
        }),
      ),
    ),
    reconsiderationTriggers: sorted(
      decision.reconsiderationTriggers.map(asCanonicalValueString),
    ),
    supersedesDecisionId: decision.supersedesDecisionId ?? null,
  })
}

/**
 * A revision put in front of the CIO, and the basis on which it was.
 *
 * `state` is deliberately **excluded**. It is the one field a submission is
 * allowed to change — `pending` becomes `decided` or `returned` when the CIO
 * acts — so including it would make a settled submission conflict with its own
 * earlier self on every replay.
 *
 * `blockers` is excluded for the opposite reason: a valid submission has none,
 * the repositories refuse one that does, and there is nothing for the key to
 * distinguish. Including it would imply the field could vary.
 */
export function cioSubmissionSemanticKey(submission: CioSubmission): string {
  const basis = submission.basis
  return asCanonicalValueString({
    id: submission.id,
    caseId: submission.caseId,
    thesisId: submission.thesisId,
    revisionId: submission.revisionId,
    submittedByDepartmentId: submission.submittedByDepartmentId,
    submittedByEmployeeId: submission.submittedByEmployeeId,
    submittedAt: submission.submittedAt,
    caseVersion: submission.caseVersion,
    basis: asCanonicalValueString({
      revisionId: basis.revisionId,
      thesisId: basis.thesisId,
      aggregationId: basis.aggregationId,
      eligibilityPolicyVersion: basis.eligibilityPolicyVersion,
      verification: basis.verification
        ? asCanonicalValueString(basis.verification)
        : null,
      devilsAdvocate: basis.devilsAdvocate
        ? asCanonicalValueString({
            reviewId: basis.devilsAdvocate.reviewId,
            sequence: basis.devilsAdvocate.sequence,
            openChallenges: [...basis.devilsAdvocate.openChallenges]
              .sort((a, b) => (a.challengeId < b.challengeId ? -1 : 1))
              .map((c) => `${c.challengeId}:${c.materiality}`),
          })
        : null,
      risk: basis.risk ? asCanonicalValueString(basis.risk) : null,
      riskRequirement: basis.riskRequirement,
      riskRuleId: basis.riskRuleId,
      riskRuleVersion: basis.riskRuleVersion,
      requiredWork: sorted(basis.requiredWork.map(asCanonicalValueString)),
      materialDisagreements: sorted(
        basis.materialDisagreements.map(asCanonicalValueString),
      ),
      evidenceSetIds: sorted(basis.evidenceSetIds),
      storageProvenanceId: basis.storageProvenanceId,
      evaluatedAt: basis.evaluatedAt,
      /*
       * The witness is part of the identity. Two submissions whose bases differ
       * only in a way the digest notices must not replay as one another -- and
       * a caller presenting a changed digest for an unchanged basis is a
       * disagreement about what was attested, not a retry.
       */
      manifest: asCanonicalValueString(basis.manifest),
    }),
  })
}

/**
 * The CIO sending work back.
 *
 * All of it, including the concerns and their order: a return listing the same
 * concerns in a different order is a different instruction to whoever picks the
 * work up, so unlike an evidence list this collection is NOT sorted before
 * hashing.
 */
export function cioReturnSemanticKey(cioReturn: CioReturn): string {
  return asCanonicalValueString({
    id: cioReturn.id,
    submissionId: cioReturn.submissionId,
    caseId: cioReturn.caseId,
    revisionId: cioReturn.revisionId,
    returnedAt: cioReturn.returnedAt,
    returnedBy: asCanonicalValueString(cioReturn.returnedBy),
    authorizationBasis: cioReturn.authorizationBasis,
    returnedFor: cioReturn.returnedFor,
    reason: cioReturn.reason,
    caseVersion: cioReturn.caseVersion,
    concerns: cioReturn.concerns.map((concern) => asCanonicalValueString(concern)),
  })
}

/**
 * A reopening. Identity is `id`; everything else is content.
 *
 * Canonical, not `JSON.stringify`. Serialising two objects and comparing the
 * strings makes key ORDER part of the comparison, so a record hydrated from
 * PostgreSQL differed from the identical record handed in — and an idempotent
 * replay was refused as a conflict. The canonical form has one ordering by
 * construction, which is what it exists for.
 */
export function caseReconsiderationSemanticKey(
  reconsideration: CaseReconsideration,
): string {
  return asCanonicalValueString({
    id: reconsideration.id,
    caseId: reconsideration.caseId,
    revisionId: reconsideration.revisionId,
    reconsidersDecisionId: reconsideration.reconsidersDecisionId,
    submissionId: reconsideration.submissionId,
    reopenedAt: reconsideration.reopenedAt,
    reopenedBy: asCanonicalValueString(reconsideration.reopenedBy),
    reopenedByEmployeeId: reconsideration.reopenedByEmployeeId,
    authorizationBasis: reconsideration.authorizationBasis,
    caseVersion: reconsideration.caseVersion,
    /*
     * In the order cited, not sorted. The first condition the CIO named is the
     * one they led with, and reordering would make two different statements
     * about why the case came back compare equal.
     */
    firedTriggers: reconsideration.firedTriggers.map((fired) =>
      asCanonicalValueString(fired),
    ),
  })
}

/** An appended transition event. Identity is `eventId`; everything else is content. */
export function transitionEventSemanticKey(event: TransitionEvent): string {
  return asCanonicalValueString({ ...event })
}

/**
 * One recorded run state change.
 *
 * Identity is `(runId, at, state)` — a run cannot enter the same state at the
 * same instant twice, so a second one is a replay. `reason` is content: the
 * same transition recorded with a different reason is a disagreement, not a
 * retry.
 */
export function runEventIdentity(event: RunEvent): string {
  return `${event.runId}|${event.at}|${event.state}`
}

export function runEventSemanticKey(event: RunEvent): string {
  return asCanonicalValueString({
    runId: event.runId,
    at: event.at,
    state: event.state,
    reason: event.reason ?? null,
  })
}

/**
 * One evaluation of a conditional requirement.
 *
 * Identity is `(caseId, playbookEntryKey, revisionId)` — the exact revision,
 * never the lineage.
 *
 * `evaluatedAt` is **excluded**, and that exclusion is the interesting part. A
 * deterministic rule applied to a fixed revision produces one answer, so two
 * writes differing only in their timestamp are the same evaluation replayed
 * and must not conflict. Two writes differing in `state`, `reason`, the rule
 * version or the evaluator are a genuine disagreement about whether a
 * governance gate applied — which is exactly the thing that must never be
 * settled by whichever write happened to arrive second.
 */
export function requirementResolutionIdentity(resolution: RequirementResolution): string {
  return `${resolution.caseId}|${resolution.playbookEntryKey}|${resolution.revisionId}`
}

export function requirementResolutionSemanticKey(
  resolution: RequirementResolution,
): string {
  return asCanonicalValueString({
    caseId: resolution.caseId,
    playbookEntryKey: resolution.playbookEntryKey,
    revisionId: resolution.revisionId,
    state: resolution.state,
    ruleId: resolution.ruleId,
    ruleVersion: resolution.ruleVersion,
    reason: resolution.reason,
    evaluatedBy: resolution.evaluatedBy.employeeId,
  })
}
