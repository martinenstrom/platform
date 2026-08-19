/**
 * Row shapes, exactly as the queries project them.
 *
 * **These types never leave this directory.** A row is a transport detail: it
 * has snake_case names, nullable columns where the domain has optional fields,
 * and `unknown` where the domain has a union. Letting one escape would put the
 * database's shape into the application layer, which is the coupling the ports
 * exist to prevent — and a fitness rule asserts it does not happen.
 *
 * Every timestamp is `string`, because every query projects timestamps through
 * `ts()` rather than letting the driver parse them into a `Date`. Every jsonb
 * column is `unknown`: it is validated on the way into the domain, not trusted
 * because it came from our own database.
 */

export interface CaseRow {
  id: string
  tenant_id: string
  version: number
  owner_employee_id: string
  subject_kind: string
  subject_ref: string
  subject_display_name: string
  question: string
  stage: string
  playbook_id: string | null
  playbook_version: string | null
  opened_at: string
  closed_at: string | null
}

export interface CaseParticipantRow {
  case_id: string
  department_id: string
}

export interface ThesisRevisionRow {
  revision_id: string
  thesis_id: string
  revision_number: number
  supersedes_revision_id: string | null
  case_id: string
  statement: string
  position: string
  lifecycle: string
  invalidation_criteria: string
  horizon: string | null
  implications: string[]
  proposed_by_department_id: string
  proposed_by_employee_id: string
  proposed_at: string
  revised_at: string | null
  revision_reason: string | null
  /** The bounded category beside the reason. */
  revision_cause: string
  /** The managerial synthesis that produced it, where one did. */
  aggregation_id: string | null
}

export interface ThesisClaimLinkRow {
  revision_id: string
  claim_id: string
  relation: string
}

export interface AssignmentRow {
  id: string
  case_id: string
  tenant_id: string
  department_id: string
  assignee_employee_id: string | null
  playbook_entry_key: string | null
  brief: string
  status: string
  priority: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  waiting_on_kind: string | null
  waiting_on_assignment_id: string | null
  waiting_on_description: string | null
  returned_reason: string | null
}

export interface RunRow {
  id: string
  case_id: string
  tenant_id: string
  assignment_id: string
  department_id: string
  employee_id: string
  revision_id: string | null
  state: string
  obsolete: boolean
  agent_contract_version: string
  /** 'model' | 'unavailable' | 'scenario'. Decides which columns below apply. */
  identity_kind: string
  output_schema_version: string
  // Present only for `identity_kind = 'model'` — nothing else has a model.
  prompt_id: string | null
  prompt_version: string | null
  prompt_content_hash: string | null
  model_id: string | null
  model_provider: string | null
  model_parameters_hash: string | null
  model_parameters: unknown
  // Present only for `identity_kind = 'scenario'`.
  scenario_id: string | null
  stub_version: string | null
  // Present only for `identity_kind = 'unavailable'`.
  identity_unavailable_reason: string | null
  recording_id: string | null
  evidence_set_id: string
  started_at: string
  completed_at: string | null
  failure_category: string | null
  failure_retryable: boolean | null
  failure_attempt: number | null
  failed_at: string | null
  /** Present only for `state = 'rejected'`, and then all four are. */
  rejection_code: string | null
  rejection_detail: string | null
  rejected_by_employee_id: string | null
  rejected_at: string | null
  playbook_id: string
  playbook_version: string
  playbook_entry_key: string
  provider_id: string
  provider_version: string
  provider_kind: string
  missing_optional_inputs: string[]
  /** 'not-applicable' | 'not-reported' | 'measured'. Tokens, not money. */
  usage_state: string
  /** 'measured' | 'not-reported', and NULL when no tokens were counted. */
  usage_cost_state: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_minor_units: number | null
  currency: string | null
  /**
   * What the run was authorized to spend, as against what it did.
   *
   * Each `*_kind` is 'limit' | 'not-applicable' | 'not-measured'. Write-once:
   * set when the run starts and absent from the upsert's `DO UPDATE SET`.
   */
  budget_tokens_kind: string
  budget_tokens: number | null
  budget_cost_kind: string
  budget_cost_minor_units: number | null
  budget_currency: string | null
  budget_deadline_kind: string
  budget_deadline_ms: number | null
}

export interface RunEventRow {
  run_id: string
  at: string
  state: string
  reason: string | null
}

export interface ClaimRow {
  id: string
  case_id: string
  tenant_id: string
  run_id: string
  type: string
  statement: string
  status: string
  confidence_level: string
  confidence_capped_by: string | null
  confidence_basis: unknown
  temporal_as_of: string
  temporal_horizon: string | null
  contests_claim_id: string | null
  supports_thesis_id: string | null
  opposes_thesis_id: string | null
  causal_attribution: unknown
}

export interface ClaimEvidenceRow {
  claim_id: string
  evidence_set_id: string
  observation_id: string
  content_hash: string
  stance: string
}

export interface EvidenceSetRow {
  id: string
  assembled_at: string
  correlation_id: string
  co_temporality: unknown
  disagreements: unknown
}

export interface EvidenceItemRow {
  evidence_set_id: string
  observation_id: string
  subject_kind: string
  subject: string
  kind: string
  observed_at: string
  source_id: string
  series_id: string | null
  methodology: string | null
  /** Which key rule minted `observation_id`. 1 for every pre-C3 row. */
  key_generation: number
  /** The period described. NULL exactly when `key_generation` is 1. */
  reference_period: string | null
  content_hash: string
  /** True when the payload lives in `analysis.observations`. See migration 0032. */
  links_observation: boolean
  /** NULL on a linked row; the join supplies it. Present on a legacy row. */
  value: unknown
  provenance: unknown
}

export interface EvidenceAssemblyRow {
  assembly_id: string
  evidence_set_id: string
  rule_id: string
  subject_family: string
  window_from: string
  window_to: string
  known_at: string
  selected_subjects: string[]
  observation_count: number
  derived_count: number
  assembled_at: string
  actor_employee_id: string
  on_behalf_of_department_id: string
  correlation_id: string
}

export interface ObservationRow {
  observation_id: string
  content_hash: string
  key_generation: number
  subject_kind: string
  subject: string
  kind: string
  source_id: string
  series_id: string | null
  methodology: string | null
  reference_period: string | null
  observed_at: string
  recorded_at: string
  correlation_id: string
  value: unknown
  provenance: unknown
}

export interface ReviewRow {
  id: string
  kind: string
  scope: string
  case_id: string
  tenant_id: string
  thesis_id: string | null
  revision_id: string | null
  by_employee_id: string
  by_department_id: string
  at: string
  status: string | null
  detail: unknown
  sequence: number
  supersedes_review_id: string | null
  reason: string | null
}

export interface VerificationFindingRow {
  id: string
  review_id: string
  kind: string
  claim_id: string
  detail: string
  blocking: boolean
  evidence_set_id: string | null
  observation_id: string | null
  content_hash: string | null
  severity: string
  expected_amount: string | null
  expected_unit: string | null
  expected_currency: string | null
  observed_amount: string | null
  observed_unit: string | null
  observed_currency: string | null
  methodology: string | null
  correction_required: string | null
  cited_content_hash: string | null
}

export interface VerificationClaimReviewedRow {
  review_id: string
  claim_id: string
}

export interface RiskFindingRow {
  review_id: string
  ordinal: number
  kind: string
  detail: string
  severity: string
  implication: string | null
  mitigated_by: string | null
}

export interface RiskLimitRow {
  review_id: string
  ordinal: number
  limit_text: string
}

export interface ChallengeRow {
  id: string
  review_id: string
  contests_claim_id: string
  contests_thesis_id: string | null
  kind: string
  argument: string
  would_be_resolved_by: string | null
  outcome: string
  materiality: string
  resolved_by: string | null
}

export interface ChallengeEvidenceRow {
  challenge_id: string
  evidence_set_id: string
  observation_id: string
  content_hash: string
}

/* ------------------------------------------------------------- submissions */

/**
 * A revision put in front of the CIO, with its eligibility basis inline.
 *
 * The basis is columns rather than a document, and the four child tables below
 * carry its collections. `blockers` has no column here and never will: a
 * submission exists only where eligibility held, so the array is empty on every
 * submission that can legitimately be stored, and the emptiness is a domain
 * invariant rather than something the row shape records. See the C1D-1B plan §5.
 */
export interface CioSubmissionRow {
  id: string
  case_id: string
  tenant_id: string
  thesis_id: string
  revision_id: string
  submitted_by_department_id: string
  submitted_by_employee_id: string
  submitted_at: string
  case_version: number
  state: string

  eligibility_policy_version: string
  aggregation_id: string | null
  verification_review_id: string | null
  verification_sequence: number | null
  verification_status: string | null
  devils_advocate_review_id: string | null
  devils_advocate_sequence: number | null
  risk_review_id: string | null
  risk_sequence: number | null
  risk_status: string | null
  risk_requirement: string
  risk_rule_id: string | null
  risk_rule_version: string | null
  storage_provenance_id: string
  /**
   * The eligibility-basis witness, as three columns rather than a document.
   *
   * A field inside a JSON blob is a field nothing can constrain; as columns the
   * algorithm, the canonicalisation version and the digest shape are all held
   * by CHECKs. Migration 0022.
   */
  manifest_algorithm: string
  manifest_canon_version: string
  manifest_digest: string
  evaluated_at: string
}

export interface SubmissionRequiredWorkRow {
  submission_id: string
  playbook_entry_key: string
  run_id: string
}

export interface SubmissionDisagreementRow {
  submission_id: string
  claim_id: string
  materiality: string
}

export interface SubmissionEvidenceRow {
  submission_id: string
  evidence_set_id: string
}

export interface SubmissionOpenChallengeRow {
  submission_id: string
  challenge_id: string
  /**
   * The weight the Devil's Advocate gave it, stored as a fact.
   *
   * Not "does it block": that is the gate's answer under the policy in force,
   * and a stored conclusion would be wrong the moment the policy changed.
   */
  materiality: string
}

/* ----------------------------------------------------------------- returns */

/**
 * The CIO sending work back.
 *
 * Not a decision, and deliberately not stored through the decision repository:
 * the material was not ready to be decided, which is a different statement from
 * deciding to wait.
 */
export interface CioReturnRow {
  id: string
  submission_id: string
  case_id: string
  tenant_id: string
  revision_id: string
  returned_at: string
  returned_by_employee_id: string
  returned_by_role_id: string | null
  returned_by_role_function: string | null
  returned_by_department_id: string | null
  returned_by_department_is_governance: boolean | null
  returned_by_department_handles: string[]
  organization_seed_version: string
  authentication: string
  authorization_basis: string
  returned_for: string
  reason: string
  case_version: number
}

export interface CioReturnConcernRow {
  return_id: string
  ordinal: number
  concern_kind: string
  subject_kind: string
  subject_id: string
  detail: string
}

/* --------------------------------------------------------------- decisions */

/**
 * A completed institutional CIO outcome, keyed on the decision.
 *
 * Migration 0020 moved the key off `case_id`: a case holds a decision, then a
 * correction superseding it, then a later reconsideration, and keying on the
 * case forced the second to overwrite the first. At most one LIVE decision per
 * case survives as a partial unique index, which is the property that mattered.
 *
 * The eligibility basis is deliberately absent — it lives on the submission,
 * and a decision reaches it through `decision_submissions`.
 */
export interface CaseDecisionRow {
  decision_id: string
  case_id: string
  tenant_id: string
  aggregate_version: number
  decided_at: string
  decided_by_employee_id: string
  outcome_kind: string
  selected_revision_id: string | null
  supersedes_decision_id: string | null
  superseded_by_decision_id: string | null
  evidence_set_id: string
  rationale: string

  decided_by_role_id: string | null
  decided_by_role_function: string | null
  decided_by_department_id: string | null
  decided_by_department_is_governance: boolean | null
  decided_by_department_handles: string[]
  /*
   * Not nullable, unlike the four above. The role and department of an actor
   * can legitimately be unknown; how the runtime authenticated them and under
   * what authority it let them decide cannot — a decision with no recorded
   * authorization basis is the record failing at the one thing it is for.
   */
  organization_seed_version: string
  authentication: string
  authorization_basis: string
}

/**
 * One considered revision and what the decision did about it.
 *
 * Replaces `decision_revisions`, which said less: this row names the submission
 * as well, so the record can answer whether the ALTERNATIVES were eligible when
 * they were passed over.
 */
export interface DecisionSubmissionRow {
  decision_id: string
  submission_id: string
  case_id: string
  revision_id: string
  relation: string
}

export interface DecisionDissentRow {
  decision_id: string
  ordinal: number
  source: string
  source_id: string
  revision_id: string
  claim_id: string | null
  materiality: string
  raised_by_employee_id: string | null
  raised_by_department_id: string | null
  rationale: string
  why_not_blocking: string
  acknowledgement: string | null
  disposition: string
}

export interface DecisionDissentEvidenceRow {
  decision_id: string
  ordinal: number
  evidence_set_id: string
  observation_id: string
  content_hash: string
}

export interface DecisionTriggerRow {
  id: string
  decision_id: string
  ordinal: number
  condition_type: string
  subject_kind: string
  subject_ref: string
  comparator: string | null
  threshold_amount: string | null
  threshold_unit: string | null
  threshold_currency: string | null
  qualitative_condition: string | null
  expected_source: string | null
  rationale: string
  created_by_employee_id: string
  created_at: string
  /** Per row, never inherited from a sibling. */
  policy_version: string
}

/* ------------------------------------------------------- mapper input sets */

/**
 * Every row of one aggregate, as hydration receives them.
 *
 * The shape exists so a mapper takes ONE argument that either is or is not
 * complete, rather than five positional arrays a caller can pass in the wrong
 * order — two of the decision's children are `(decision_id, ordinal)`-keyed and
 * would swap silently.
 *
 * Children arrive already filtered to their parent. A list read queries each
 * child table once with `= ANY($1)` and groups in memory; it never issues one
 * query per parent.
 */
export interface SubmissionRowSet {
  submission: CioSubmissionRow
  requiredWork: readonly SubmissionRequiredWorkRow[]
  disagreements: readonly SubmissionDisagreementRow[]
  evidence: readonly SubmissionEvidenceRow[]
  openChallenges: readonly SubmissionOpenChallengeRow[]
}

export interface ReturnRowSet {
  cioReturn: CioReturnRow
  concerns: readonly CioReturnConcernRow[]
}

export interface DecisionRowSet {
  decision: CaseDecisionRow
  submissions: readonly DecisionSubmissionRow[]
  dissent: readonly DecisionDissentRow[]
  dissentEvidence: readonly DecisionDissentEvidenceRow[]
  triggers: readonly DecisionTriggerRow[]
}

export interface TransitionEventRow {
  event_id: string
  subject: string
  case_id: string
  tenant_id: string
  thesis_id: string | null
  revision_id: string | null
  assignment_id: string | null
  run_id: string | null
  review_id: string | null
  challenge_id: string | null
  from_state: string | null
  to_state: string
  actor_employee_id: string | null
  actor_department_id: string | null
  reason: string | null
  occurred_at: string
  correlation_id: string
  causation_id: string | null
  aggregate_version: number
  corrects: string | null
}

export interface AgentResultRow {
  key: string
  claims: unknown
  stored_at: string
  inputs: unknown
  /** What decided the content, beside the provenance of what wrote the row. */
  provider_kind: string | null
}

/* ---------------------------------------------------------- aggregations */

export interface AggregationRow {
  id: string
  case_id: string
  thesis_id: string
  source_revision_id: string
  produced_revision_id: string
  manager_employee_id: string
  department_id: string
  rationale: string
  aggregated_at: string
}

export interface AggregationInputRow {
  aggregation_id: string
  run_id: string
  playbook_entry_key: string
  requirement_level: string
}

export interface AggregationClaimDispositionRow {
  aggregation_id: string
  claim_id: string
  run_id: string
  disposition: string
  explanation: string | null
  superseded_by_claim_id: string | null
  /** Present exactly for `retained-unresolved`. */
  materiality: string | null
  escalation_required: boolean | null
  downgraded_from: string | null
}

export interface AggregationOptionalInputRow {
  aggregation_id: string
  playbook_entry_key: string
  availability: string
  run_id: string | null
  scope: string | null
  materially_relevant: boolean
  explanation: string | null
}

export interface IdempotencyKeyRow {
  key: string
  command_type: string
  result_ref: string
  created_at: string
}

/* ------------------------------------------------------------- playbooks */

export interface PlaybookVersionRow {
  playbook_id: string
  version: string
  content_hash: string
  case_kind: string
  name: string
}

export interface PlaybookEntryRow {
  entry_key: string
  department_id: string
  brief: string
  requirement: string
  priority: number
  discipline_tag: string | null
  conditional_rule_id: string | null
  conditional_rule_version: string | null
}

export interface PlaybookEntryDependencyRow {
  entry_key: string
  depends_on: string
  kind: string
}

export interface RequirementResolutionRow {
  case_id: string
  playbook_entry_key: string
  revision_id: string
  state: string
  rule_id: string
  rule_version: string
  reason: string
  /** Hash of the normalized rule input, so the evaluation stays checkable. */
  input_hash: string
  evaluated_at: string
  evaluated_by_employee_id: string
  evaluated_by_role_id: string
  evaluated_by_role_function: string
  evaluated_by_department_id: string
  evaluated_by_department_is_governance: boolean
  evaluated_by_department_handles: string[]
  evaluated_by_authentication: string
  organization_seed_version: string
}

/* -------------------------------------------------------- reconsideration */

/** The CIO reopening a deferred case. Mirrors `CioReturnRow` field for field. */
export interface CaseReconsiderationRow {
  id: string
  case_id: string
  revision_id: string
  reconsiders_decision_id: string
  submission_id: string
  reopened_at: string
  reopened_by_employee_id: string
  reopened_by_role_id: string | null
  reopened_by_role_function: string | null
  reopened_by_department_id: string | null
  reopened_by_department_is_governance: boolean | null
  reopened_by_department_handles: string[]
  organization_seed_version: string
  authentication: string
  authorization_basis: string
  case_version: number
}

export interface ReconsiderationFiredTriggerRow {
  reconsideration_id: string
  ordinal: number
  trigger_id: string
  /**
   * Carried alongside the trigger id so the composite foreign key can check
   * that the trigger belongs to the decision being reconsidered. Redundant with
   * the parent row by design — the redundancy is what the database enforces on.
   */
  reconsiders_decision_id: string
  observation: string
}
