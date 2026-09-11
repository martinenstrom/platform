/**
 * Submissions, returns and decisions, between the domain and the relational shape.
 *
 * Pure structural transforms — no client, no statement, no hydration. The
 * repositories that issue queries arrive in B2; these are the functions they
 * will use, written and tested first because of what depends on them.
 *
 * ## Why the round trip is load-bearing
 *
 * Write-once conflict detection in this adapter is read-back-and-compare: the
 * store reads the record it already holds, maps it to the domain, and compares
 * semantic keys. There is no content-hash column. So a mapper that drops a
 * field, reorders a collection or turns an absent key into an explicit `null`
 * makes the round trip lossy — and a **benign replay** then computes a
 * different key and raises `ConflictingRecordError`. A correct retry would be
 * reported as an institutional disagreement, and only under retry, which is
 * when the system is already having a bad day.
 *
 * `decisionMapping.test.ts` asserts identity across every optional field and
 * every outcome kind for exactly this reason.
 *
 * ## Absent is not null
 *
 * The domain uses optional properties where the database uses nullable columns.
 * These are not the same thing, and `canonicalJson` — which the semantic keys
 * are built from — treats them differently. Every `toDomain` below omits the
 * key rather than writing `undefined`, so a record that went in without a
 * `claimId` comes back without one.
 */

import {
  DISAGREEMENT_MATERIALITIES,
  type DisagreementMateriality,
} from '~/domain/analysis'
import {
  verifyBasisManifest,
  type EligibilityBasisManifest,
  relationsOf,
  type ActorSnapshot,
  type BasisContent,
  type CaseDecision,
  type CioDecisionOutcome,
  type CaseReconsideration,
  type CioReturn,
  type CioSubmission,
  type DisclosedDissent,
  type EligibilityBasis,
  type EvidenceRef,
  type ReconsiderationTrigger,
  type ReturnConcern,
} from '~/domain/analysis'
import { MalformedRowError } from '~/application/analysis/repositories'
import type {
  CaseDecisionRow,
  CaseReconsiderationRow,
  CioSubmissionRow,
  DecisionDissentEvidenceRow,
  DecisionDissentRow,
  DecisionRowSet,
  DecisionSubmissionRow,
  DecisionTriggerRow,
  ReconsiderationFiredTriggerRow,
  ReturnRowSet,
  SubmissionDisagreementRow,
  SubmissionEvidenceRow,
  SubmissionOpenChallengeRow,
  SubmissionPeerExaminationRow,
  SubmissionRequiredWorkRow,
  SubmissionRowSet,
} from './rows'

/* ----------------------------------------------------------------- helpers */

/**
 * Byte order, which is what `COLLATE "C"` gives.
 *
 * `Array.prototype.sort` without a comparator sorts by UTF-16 code unit, which
 * happens to agree; `localeCompare` does not, and would put `case-b` before
 * `case_a` under some locales and after under others. Stated explicitly so the
 * in-memory reference and PostgreSQL cannot drift apart on a machine with a
 * different default.
 */
export const byteOrder = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

/** Adds a key only when the value is present. Keeps absent distinct from null. */
function optional<T>(key: string, value: T | null | undefined): Record<string, T> {
  return value === null || value === undefined ? {} : { [key]: value }
}

/*
 * Declared rather than assigned to a const: TypeScript only narrows control
 * flow after a `never`-returning call when it can see the declaration, so the
 * arrow form leaves every check below un-narrowed and the compiler complains
 * about the very fields the check just proved.
 */
function malformed(record: string, why: string, operation: string): never {
  throw new MalformedRowError(record, why, operation)
}

/* -------------------------------------------------------------- the actor */

/**
 * An actor snapshot, from the columns that mirror it.
 *
 * `departmentHandles` is canonically sorted at construction — in `authorize` —
 * so both directions here preserve the order they are given rather than
 * imposing one. Re-sorting on read would hide a store that had lost the order.
 */
function toActor(
  row: {
    employee_id: string
    role_id: string | null
    role_function: string | null
    department_id: string | null
    department_is_governance: boolean | null
    department_handles: string[]
    authentication: string
    organization_seed_version: string
  },
  operation: string,
): ActorSnapshot {
  if (row.authentication !== 'system-asserted') {
    malformed(
      'Actor snapshot',
      `authentication is "${row.authentication}"; only system-asserted exists ` +
        `while TD-8 is open, so this record claims a check the runtime never made`,
      operation,
    )
  }
  return {
    kind: 'employee',
    employeeId: row.employee_id,
    agentPrincipalId: null,
    roleId: row.role_id,
    roleFunction: row.role_function as ActorSnapshot['roleFunction'],
    departmentId: row.department_id,
    departmentIsGovernance: row.department_is_governance,
    departmentHandles: [...row.department_handles],
    authentication: 'system-asserted',
    organizationSeedVersion: row.organization_seed_version,
  }
}

/* ------------------------------------------------------------ submissions */

export function submissionToRows(submission: CioSubmission): SubmissionRowSet {
  const basis = submission.basis
  return {
    submission: {
      id: submission.id,
      case_id: submission.caseId,
      // Filled by the repository, which owns the tenant. Placeholder here keeps
      // the mapper pure and the round-trip test independent of deployment.
      tenant_id: '',
      thesis_id: submission.thesisId,
      revision_id: submission.revisionId,
      submitted_by_department_id: submission.submittedByDepartmentId,
      submitted_by_employee_id: submission.submittedByEmployeeId,
      submitted_at: submission.submittedAt,
      case_version: submission.caseVersion,
      state: submission.state,

      eligibility_policy_version: basis.eligibilityPolicyVersion,
      aggregation_id: basis.aggregationId,
      verification_review_id: basis.verification?.reviewId ?? null,
      verification_sequence: basis.verification?.sequence ?? null,
      verification_status: basis.verification?.status ?? null,
      devils_advocate_review_id: basis.devilsAdvocate?.reviewId ?? null,
      devils_advocate_sequence: basis.devilsAdvocate?.sequence ?? null,
      risk_review_id: basis.risk?.reviewId ?? null,
      risk_sequence: basis.risk?.sequence ?? null,
      risk_status: basis.risk?.status ?? null,
      risk_requirement: basis.riskRequirement,
      risk_rule_id: basis.riskRuleId,
      risk_rule_version: basis.riskRuleVersion,
      storage_provenance_id: basis.storageProvenanceId,
      evaluated_at: basis.evaluatedAt,
      /*
       * The witness travels with the root row, written once and never updated
       * -- the role holds SELECT and INSERT on this table and no UPDATE, so the
       * runtime cannot rewrite a digest even if the code tried.
       */
      manifest_algorithm: basis.manifest.algorithm,
      manifest_canon_version: String(basis.manifest.canonicalizationVersion),
      manifest_digest: basis.manifest.digest,
    },
    requiredWork: basis.requiredWork.map((work) => ({
      submission_id: submission.id,
      playbook_entry_key: work.playbookEntryKey,
      run_id: work.runId,
    })),
    disagreements: basis.materialDisagreements.map((disagreement) => ({
      submission_id: submission.id,
      claim_id: disagreement.claimId,
      materiality: disagreement.materiality,
    })),
    evidence: basis.evidenceSetIds.map((evidenceSetId) => ({
      submission_id: submission.id,
      evidence_set_id: evidenceSetId,
    })),
    openChallenges: (basis.devilsAdvocate?.openChallenges ?? []).map((challenge) => ({
      submission_id: submission.id,
      challenge_id: challenge.challengeId,
      materiality: challenge.materiality,
    })),
    peerExaminations: basis.peerScrutiny.map((examination) => ({
      submission_id: submission.id,
      review_id: examination.reviewId,
      sequence: examination.sequence,
      by_department_id: examination.byDepartmentId,
      examined_department_id: examination.examinedDepartmentId,
    })),
    /*
     * Flattened across examinations for storage and regrouped by `review_id` on
     * read. The composite foreign key is what makes that regrouping safe: an
     * objection cannot name an examination this submission did not record.
     */
    peerChallenges: basis.peerScrutiny.flatMap((examination) =>
      examination.openChallenges.map((challenge) => ({
        submission_id: submission.id,
        review_id: examination.reviewId,
        challenge_id: challenge.challengeId,
        materiality: challenge.materiality,
      })),
    ),
  }
}

const requiredWorkOrder = (
  left: SubmissionRequiredWorkRow,
  right: SubmissionRequiredWorkRow,
) => byteOrder(left.playbook_entry_key, right.playbook_entry_key)

const disagreementOrder = (
  left: SubmissionDisagreementRow,
  right: SubmissionDisagreementRow,
) => byteOrder(left.claim_id, right.claim_id)

const evidenceOrder = (left: SubmissionEvidenceRow, right: SubmissionEvidenceRow) =>
  byteOrder(left.evidence_set_id, right.evidence_set_id)

/** By examining desk, which is the order the basis and the digest use. */
const peerExaminationOrder = (
  left: SubmissionPeerExaminationRow,
  right: SubmissionPeerExaminationRow,
) => byteOrder(left.by_department_id, right.by_department_id)

/**
 * A stored materiality, or a malformed row.
 *
 * The column has a CHECK behind it, so a value outside the domain means the
 * row was written by something that bypassed it. Refused on read rather than
 * widened into the domain type -- a basis carrying a materiality the firm does
 * not define cannot be evaluated against any threshold.
 */
function asMateriality(
  value: string,
  challengeId: string,
  operation: string,
): DisagreementMateriality {
  if (!(DISAGREEMENT_MATERIALITIES as readonly string[]).includes(value)) {
    malformed(
      'CIO submission',
      `gives challenge "${challengeId}" a materiality the firm does not define`,
      operation,
    )
  }
  return value as DisagreementMateriality
}

const challengeOrder = (
  left: SubmissionOpenChallengeRow,
  right: SubmissionOpenChallengeRow,
) => byteOrder(left.challenge_id, right.challenge_id)

export function submissionFromRows(
  rows: SubmissionRowSet,
  operation = 'submissions.get',
): CioSubmission {
  const row = rows.submission

  if (row.state !== 'pending' && row.state !== 'decided' && row.state !== 'returned') {
    malformed(
      'CIO submission',
      `state "${row.state}" is not a submission state`,
      operation,
    )
  }
  if (row.risk_requirement === 'unresolved') {
    /*
     * A stored `unresolved` means the Risk gate was bypassed. The CHECK in 0020
     * makes it unreachable through the runtime, so a row holding it was edited
     * by hand or restored from an incompatible backup.
     */
    malformed(
      'CIO submission',
      `Risk requirement is unresolved, so this row records a submission made ` +
        `before the gate was answered`,
      operation,
    )
  }

  const verification =
    row.verification_review_id === null
      ? null
      : {
          reviewId: row.verification_review_id,
          sequence:
            row.verification_sequence ??
            malformed(
              'CIO submission',
              'names a verification review with no sequence',
              operation,
            ),
          status: row.verification_status as NonNullable<
            EligibilityBasis['verification']
          >['status'],
        }

  const devilsAdvocate =
    row.devils_advocate_review_id === null
      ? null
      : {
          reviewId: row.devils_advocate_review_id,
          sequence:
            row.devils_advocate_sequence ??
            malformed(
              'CIO submission',
              "names a Devil's Advocate review with no sequence",
              operation,
            ),
          openChallenges: [...rows.openChallenges].sort(challengeOrder).map((entry) => ({
            challengeId: entry.challenge_id,
            materiality: asMateriality(entry.materiality, entry.challenge_id, operation),
          })),
        }

  const risk =
    row.risk_review_id === null
      ? null
      : {
          reviewId: row.risk_review_id,
          sequence:
            row.risk_sequence ??
            malformed(
              'CIO submission',
              'names a Risk review with no sequence',
              operation,
            ),
          status: row.risk_status as NonNullable<EligibilityBasis['risk']>['status'],
        }

  const content: BasisContent = {
    revisionId: row.revision_id,
    thesisId: row.thesis_id,
    aggregationId: row.aggregation_id,
    eligibilityPolicyVersion: row.eligibility_policy_version,
    /*
     * Reconstructed empty because a valid submission structurally guarantees
     * emptiness — the repository refuses to store one with blockers, so there
     * is nothing a column could have held. This is not a default papering over
     * a dropped field; see `validateCioSubmission`.
     */
    blockers: [],
    verification,
    devilsAdvocate,
    /*
     * Regrouped by the examination that raised them. The composite foreign key
     * guarantees every peer challenge names an examination this submission
     * recorded, so an objection cannot end up attributed to a desk that never
     * filed it — and an examination with no rows here is a desk that read the
     * argument and raised nothing, which is the finding the gate reads.
     */
    peerScrutiny: [...rows.peerExaminations]
      .sort(peerExaminationOrder)
      .map((examination) => ({
        reviewId: examination.review_id,
        sequence: examination.sequence,
        byDepartmentId: examination.by_department_id,
        examinedDepartmentId: examination.examined_department_id,
        openChallenges: rows.peerChallenges
          .filter((challenge) => challenge.review_id === examination.review_id)
          .slice()
          .sort((a, b) => byteOrder(a.challenge_id, b.challenge_id))
          .map((challenge) => ({
            challengeId: challenge.challenge_id,
            materiality: asMateriality(
              challenge.materiality,
              challenge.challenge_id,
              operation,
            ),
          })),
      })),
    risk,
    riskRequirement: row.risk_requirement as EligibilityBasis['riskRequirement'],
    riskRuleId: row.risk_rule_id,
    riskRuleVersion: row.risk_rule_version,
    requiredWork: [...rows.requiredWork].sort(requiredWorkOrder).map((work) => ({
      playbookEntryKey: work.playbook_entry_key,
      runId: work.run_id,
    })),
    materialDisagreements: [...rows.disagreements].sort(disagreementOrder).map((row) => ({
      claimId: row.claim_id,
      materiality:
        row.materiality as EligibilityBasis['materialDisagreements'][number]['materiality'],
    })),
    evidenceSetIds: [...rows.evidence]
      .sort(evidenceOrder)
      .map((row) => row.evidence_set_id),
    storageProvenanceId: row.storage_provenance_id,
    evaluatedAt: row.evaluated_at,
  }

  return {
    id: row.id,
    caseId: row.case_id,
    thesisId: row.thesis_id,
    revisionId: row.revision_id,
    submittedByDepartmentId: row.submitted_by_department_id,
    submittedByEmployeeId: row.submitted_by_employee_id,
    submittedAt: row.submitted_at,
    caseVersion: row.case_version,
    state: row.state,
    basis: {
      ...content,
      manifest: verifiedManifest(row, content),
    },
  }
}

/**
 * The stored witness, checked against the basis that came back with it.
 *
 * This is the read half of TD-58 and the reason the column exists. Hydration
 * used to **recompute** the manifest and return it, which agreed with itself by
 * construction and detected nothing -- a deleted child row produced a smaller
 * basis, a matching digest, and a submission that looked more eligible than it
 * was.
 *
 * Now the digest is read, the canonical input is reconstructed from the
 * hydrated basis, and the two are compared. A mismatch is a **refusal**: the row
 * is left exactly as found and nothing is normalised into agreement.
 *
 * An algorithm or canonicalisation version this build does not implement is
 * also a refusal, never a best-effort recomputation under a different shape. A
 * row written by a newer build is not corrupt; this reader is old, and saying
 * so is the difference between a useful error and a misleading one.
 */
function verifiedManifest(
  row: CioSubmissionRow,
  content: BasisContent,
): EligibilityBasisManifest {
  const stored = {
    algorithm: row.manifest_algorithm,
    canonicalizationVersion: Number(row.manifest_canon_version),
    digest: row.manifest_digest,
  } as EligibilityBasisManifest

  const mismatch = verifyBasisManifest(
    { submissionId: row.id, caseId: row.case_id },
    content,
    stored,
  )

  if (mismatch !== null) {
    throw new MalformedRowError(
      'cio submission',
      `stored eligibility-basis manifest does not describe the basis that was ` +
        `hydrated with it (${mismatch}) -- the basis may have gained or lost a ` +
        `child row since it was written`,
      'submissions',
    )
  }

  return stored
}

/* ---------------------------------------------------------------- returns */

export function returnToRows(cioReturn: CioReturn): ReturnRowSet {
  const actor = cioReturn.returnedBy
  return {
    cioReturn: {
      id: cioReturn.id,
      submission_id: cioReturn.submissionId,
      case_id: cioReturn.caseId,
      tenant_id: '',
      revision_id: cioReturn.revisionId,
      returned_at: cioReturn.returnedAt,
      returned_by_employee_id:
        actor.employeeId ??
        malformed(
          'CIO return',
          'was returned by an actor with no employee id',
          'returns.save',
        ),
      returned_by_role_id: actor.roleId,
      returned_by_role_function: actor.roleFunction,
      returned_by_department_id: actor.departmentId,
      returned_by_department_is_governance: actor.departmentIsGovernance,
      returned_by_department_handles: [...actor.departmentHandles],
      organization_seed_version: actor.organizationSeedVersion,
      authentication: actor.authentication,
      authorization_basis: cioReturn.authorizationBasis,
      returned_for: cioReturn.returnedFor,
      reason: cioReturn.reason,
      case_version: cioReturn.caseVersion,
    },
    concerns: cioReturn.concerns.map((concern, ordinal) => ({
      return_id: cioReturn.id,
      ordinal,
      concern_kind: concern.concernKind,
      subject_kind: concern.subjectKind,
      subject_id: concern.subjectId,
      detail: concern.detail,
    })),
  }
}

export function returnFromRows(rows: ReturnRowSet, operation = 'returns.get'): CioReturn {
  const row = rows.cioReturn
  return {
    id: row.id,
    submissionId: row.submission_id,
    caseId: row.case_id,
    revisionId: row.revision_id,
    returnedAt: row.returned_at,
    returnedBy: toActor(
      {
        employee_id: row.returned_by_employee_id,
        role_id: row.returned_by_role_id,
        role_function: row.returned_by_role_function,
        department_id: row.returned_by_department_id,
        department_is_governance: row.returned_by_department_is_governance,
        department_handles: row.returned_by_department_handles,
        authentication: row.authentication,
        organization_seed_version: row.organization_seed_version,
      },
      operation,
    ),
    authorizationBasis: row.authorization_basis,
    returnedFor: row.returned_for as CioReturn['returnedFor'],
    reason: row.reason,
    caseVersion: row.case_version,
    concerns: byOrdinal(rows.concerns).map((concern): ReturnConcern => ({
      concernKind: concern.concern_kind,
      subjectKind: concern.subject_kind as ReturnConcern['subjectKind'],
      subjectId: concern.subject_id,
      detail: concern.detail,
    })),
  }
}

/* -------------------------------------------------------------- decisions */

/** `ordinal` is the stored order, and it IS the meaning — never re-sorted by content. */
const byOrdinal = <T extends { ordinal: number }>(rows: readonly T[]): T[] =>
  [...rows].sort((left, right) => left.ordinal - right.ordinal)

export function decisionToRows(decision: CaseDecision): DecisionRowSet {
  const actor = decision.decidedBy
  const outcome = decision.outcome

  /*
   * The relation of each considered revision comes from `relationsOf` and from
   * nowhere else. Computing it here — a ternary on the outcome kind — is how
   * the stored rows and the domain would end up disagreeing about what
   * "not-selected" means. Fitness rule 13 will assert this in B3.
   */
  const relations = relationsOf(outcome)

  /*
   * A revision's submission is found by position: `submissionIds` is parallel
   * to `consideredRevisionIds`, which the validator guarantees are the same
   * length and which the commands construct together.
   */
  const submissionFor = new Map<string, string>()
  outcome.consideredRevisionIds.forEach((revisionId, index) => {
    const submissionId = decision.submissionIds[index]
    if (submissionId !== undefined) submissionFor.set(revisionId, submissionId)
  })

  return {
    decision: {
      decision_id: decision.decisionId,
      case_id: decision.caseId,
      tenant_id: '',
      aggregate_version: decision.aggregateVersion,
      decided_at: decision.decidedAt,
      decided_by_employee_id: decision.decidedByEmployeeId,
      outcome_kind: outcome.kind,
      selected_revision_id:
        outcome.kind === 'selected' ? outcome.selectedRevisionId : null,
      supersedes_decision_id: decision.supersedesDecisionId ?? null,
      // Set by the successor's write, never by this decision's own.
      superseded_by_decision_id: null,
      evidence_set_id: decision.evidenceSetId,
      rationale: decision.rationale,
      decided_by_role_id: actor.roleId,
      decided_by_role_function: actor.roleFunction,
      decided_by_department_id: actor.departmentId,
      decided_by_department_is_governance: actor.departmentIsGovernance,
      decided_by_department_handles: [...actor.departmentHandles],
      organization_seed_version: actor.organizationSeedVersion,
      authentication: actor.authentication,
      authorization_basis: decision.authorizationBasis,
    },
    submissions: relations.map((relation): DecisionSubmissionRow => ({
      decision_id: decision.decisionId,
      submission_id:
        submissionFor.get(relation.revisionId) ??
        malformed(
          'Case decision',
          `revision "${relation.revisionId}" was considered with no submission`,
          'decisions.save',
        ),
      case_id: decision.caseId,
      revision_id: relation.revisionId,
      relation: relation.relation,
    })),
    dissent: decision.unresolvedDissent.map((dissent, ordinal): DecisionDissentRow => ({
      decision_id: decision.decisionId,
      ordinal,
      source: dissent.source,
      source_id: dissent.sourceId,
      revision_id: dissent.revisionId,
      claim_id: dissent.claimId ?? null,
      materiality: dissent.materiality,
      raised_by_employee_id: dissent.raisedByEmployeeId ?? null,
      raised_by_department_id: dissent.raisedByDepartmentId ?? null,
      rationale: dissent.rationale,
      why_not_blocking: dissent.whyNotBlocking,
      acknowledgement: dissent.acknowledgement ?? null,
      disposition: dissent.dispositionAtDecision,
    })),
    dissentEvidence: decision.unresolvedDissent.flatMap((dissent, ordinal) =>
      (dissent.evidence ?? []).map((reference): DecisionDissentEvidenceRow => ({
        decision_id: decision.decisionId,
        ordinal,
        evidence_set_id: reference.setId,
        observation_id: reference.observationId,
        content_hash: reference.contentHash,
      })),
    ),
    triggers: decision.reconsiderationTriggers.map(
      (trigger, ordinal): DecisionTriggerRow => ({
        id: trigger.id,
        decision_id: decision.decisionId,
        ordinal,
        condition_type: trigger.conditionType,
        subject_kind: trigger.subject.kind,
        subject_ref: trigger.subject.ref,
        comparator: trigger.comparator ?? null,
        threshold_amount: trigger.threshold?.amount ?? null,
        threshold_unit: trigger.threshold?.unit ?? null,
        threshold_currency: trigger.threshold?.currency ?? null,
        qualitative_condition: trigger.qualitativeCondition ?? null,
        expected_source: trigger.expectedSource ?? null,
        rationale: trigger.rationale,
        created_by_employee_id: trigger.createdByEmployeeId,
        created_at: trigger.createdAt,
        /** Per row. Never taken from a sibling. */
        policy_version: trigger.policyVersion,
      }),
    ),
  }
}

function outcomeFromRows(
  row: CaseDecisionRow,
  submissions: readonly DecisionSubmissionRow[],
  operation: string,
): CioDecisionOutcome {
  /*
   * Considered order is the stored relation order, byte-sorted on revision, so
   * two stores holding the same decision produce the same array.
   */
  const ordered = [...submissions].sort((left, right) =>
    byteOrder(left.revision_id, right.revision_id),
  )
  const considered = ordered.map((entry) => entry.revision_id)

  if (row.outcome_kind === 'selected') {
    const selected = ordered.find((entry) => entry.relation === 'selected')
    if (!selected) {
      malformed(
        'Case decision',
        'is selected and no revision holds the selected relation',
        operation,
      )
    }
    if (
      row.selected_revision_id !== null &&
      row.selected_revision_id !== selected!.revision_id
    ) {
      malformed(
        'Case decision',
        `names "${row.selected_revision_id}" as selected while the relations ` +
          `select "${selected!.revision_id}"`,
        operation,
      )
    }
    return {
      kind: 'selected',
      selectedRevisionId: selected!.revision_id,
      consideredRevisionIds: considered,
    }
  }

  if (row.outcome_kind === 'declined') {
    return {
      kind: 'declined',
      declinedRevisionIds: ordered
        .filter((entry) => entry.relation === 'declined')
        .map((entry) => entry.revision_id),
      consideredRevisionIds: considered,
    }
  }

  if (row.outcome_kind === 'deferred') {
    /*
     * A deferral selects nothing by definition, so the relations are not
     * consulted here.
     *
     * **Stated limitation.** That means this mapper does NOT independently
     * detect a `deferred` row whose relations contain a `selected` — it builds
     * the considered set and ignores the rest. The database is authoritative
     * for that state: a CHECK ties `outcome_kind` to `selected_revision_id` and
     * `decision_outcome_guard` refuses the relation set at COMMIT, and the
     * runtime cannot bypass either.
     *
     * A future storage-import, disaster-recovery or forensic tool that can
     * write past those constraints must validate the full relational outcome
     * itself before accepting the data. It cannot rely on hydration to notice.
     */
    return { kind: 'deferred', consideredRevisionIds: considered }
  }

  return malformed(
    'Case decision',
    `outcome kind "${row.outcome_kind}" is not one the firm can record`,
    operation,
  )
}

export function decisionFromRows(
  rows: DecisionRowSet,
  operation = 'decisions.get',
): CaseDecision {
  const row = rows.decision
  const outcome = outcomeFromRows(row, rows.submissions, operation)

  const evidenceByOrdinal = new Map<number, EvidenceRef[]>()
  for (const reference of rows.dissentEvidence) {
    const list = evidenceByOrdinal.get(reference.ordinal) ?? []
    list.push({
      setId: reference.evidence_set_id,
      observationId: reference.observation_id,
      contentHash: reference.content_hash,
    })
    evidenceByOrdinal.set(reference.ordinal, list)
  }

  const dissent = byOrdinal(rows.dissent).map((entry): DisclosedDissent => {
    const evidence = evidenceByOrdinal.get(entry.ordinal)
    return {
      source: entry.source as DisclosedDissent['source'],
      sourceId: entry.source_id,
      revisionId: entry.revision_id,
      ...optional('claimId', entry.claim_id),
      materiality: entry.materiality as DisclosedDissent['materiality'],
      ...optional('raisedByEmployeeId', entry.raised_by_employee_id),
      ...optional('raisedByDepartmentId', entry.raised_by_department_id),
      rationale: entry.rationale,
      ...optional(
        'evidence',
        evidence === undefined
          ? undefined
          : [...evidence].sort(
              (left, right) =>
                byteOrder(left.setId, right.setId) ||
                byteOrder(left.observationId, right.observationId),
            ),
      ),
      whyNotBlocking: entry.why_not_blocking as DisclosedDissent['whyNotBlocking'],
      ...optional('acknowledgement', entry.acknowledgement),
      dispositionAtDecision:
        entry.disposition as DisclosedDissent['dispositionAtDecision'],
    }
  })

  const triggers = byOrdinal(rows.triggers).map((entry): ReconsiderationTrigger => ({
    id: entry.id,
    conditionType: entry.condition_type as ReconsiderationTrigger['conditionType'],
    subject: {
      kind: entry.subject_kind as ReconsiderationTrigger['subject']['kind'],
      ref: entry.subject_ref,
    },
    ...optional('comparator', entry.comparator as ReconsiderationTrigger['comparator']),
    ...optional(
      'threshold',
      entry.threshold_amount === null
        ? undefined
        : {
            amount: entry.threshold_amount,
            unit: entry.threshold_unit ?? '',
            ...optional('currency', entry.threshold_currency),
          },
    ),
    ...optional('qualitativeCondition', entry.qualitative_condition),
    ...optional('expectedSource', entry.expected_source),
    rationale: entry.rationale,
    createdByEmployeeId: entry.created_by_employee_id,
    createdAt: entry.created_at,
    policyVersion: entry.policy_version,
  }))

  /*
   * Parallel to `consideredRevisionIds`, in the same order, so a round trip
   * through the rows produces the array the decision was written with.
   */
  const submissionById = new Map(
    rows.submissions.map((entry) => [entry.revision_id, entry.submission_id]),
  )

  return {
    decisionId: row.decision_id,
    caseId: row.case_id,
    aggregateVersion: row.aggregate_version,
    decidedAt: row.decided_at,
    decidedByEmployeeId: row.decided_by_employee_id,
    decidedBy: toActor(
      {
        employee_id: row.decided_by_employee_id,
        role_id: row.decided_by_role_id,
        role_function: row.decided_by_role_function,
        department_id: row.decided_by_department_id,
        department_is_governance: row.decided_by_department_is_governance,
        department_handles: row.decided_by_department_handles,
        authentication: row.authentication ?? '',
        organization_seed_version: row.organization_seed_version ?? '',
      },
      operation,
    ),
    authorizationBasis: row.authorization_basis ?? '',
    outcome,
    submissionIds: outcome.consideredRevisionIds.map(
      (revisionId) =>
        submissionById.get(revisionId) ??
        malformed(
          'Case decision',
          `considered revision "${revisionId}" has no submission row`,
          operation,
        ),
    ),
    evidenceSetId: row.evidence_set_id,
    rationale: row.rationale,
    unresolvedDissent: dissent,
    reconsiderationTriggers: triggers,
    ...optional('supersedesDecisionId', row.supersedes_decision_id),
  }
}

/* -------------------------------------------------------- reconsideration */

export function reconsiderationToRows(reconsideration: CaseReconsideration): {
  reconsideration: CaseReconsiderationRow
  firedTriggers: ReconsiderationFiredTriggerRow[]
} {
  const actor = reconsideration.reopenedBy
  return {
    reconsideration: {
      id: reconsideration.id,
      case_id: reconsideration.caseId,
      revision_id: reconsideration.revisionId,
      reconsiders_decision_id: reconsideration.reconsidersDecisionId,
      submission_id: reconsideration.submissionId,
      reopened_at: reconsideration.reopenedAt,
      reopened_by_employee_id:
        actor.employeeId ??
        malformed(
          'case reconsideration',
          'was reopened by an actor with no employee id',
          'returns.recordReconsideration',
        ),
      reopened_by_role_id: actor.roleId,
      reopened_by_role_function: actor.roleFunction,
      reopened_by_department_id: actor.departmentId,
      reopened_by_department_is_governance: actor.departmentIsGovernance,
      /* Sorted: organization insertion order is not institutional meaning. */
      reopened_by_department_handles: [...actor.departmentHandles].sort(),
      organization_seed_version: actor.organizationSeedVersion,
      authentication: actor.authentication,
      authorization_basis: reconsideration.authorizationBasis,
      case_version: reconsideration.caseVersion,
    },
    firedTriggers: reconsideration.firedTriggers.map((fired, ordinal) => ({
      reconsideration_id: reconsideration.id,
      ordinal,
      trigger_id: fired.triggerId,
      /* Carried so the composite key can check the trigger's owner. */
      reconsiders_decision_id: reconsideration.reconsidersDecisionId,
      observation: fired.observation,
    })),
  }
}

export function toCaseReconsideration(
  row: CaseReconsiderationRow,
  firedTriggers: readonly ReconsiderationFiredTriggerRow[],
  operation: string,
): CaseReconsideration {
  return {
    id: row.id,
    caseId: row.case_id,
    revisionId: row.revision_id,
    reconsidersDecisionId: row.reconsiders_decision_id,
    submissionId: row.submission_id,
    reopenedAt: row.reopened_at,
    reopenedBy: toActor(
      {
        employee_id: row.reopened_by_employee_id,
        role_id: row.reopened_by_role_id,
        role_function: row.reopened_by_role_function,
        department_id: row.reopened_by_department_id,
        department_is_governance: row.reopened_by_department_is_governance,
        department_handles: row.reopened_by_department_handles,
        authentication: row.authentication,
        organization_seed_version: row.organization_seed_version,
      },
      operation,
    ),
    reopenedByEmployeeId: row.reopened_by_employee_id,
    authorizationBasis: row.authorization_basis,
    /*
     * By ordinal, so the order the CIO cited the conditions in survives. It is
     * not alphabetical and should not be: the first condition named is the one
     * the CIO led with.
     */
    firedTriggers: byOrdinal(firedTriggers).map((fired) => ({
      triggerId: fired.trigger_id,
      observation: fired.observation,
    })),
    caseVersion: row.case_version,
  }
}
