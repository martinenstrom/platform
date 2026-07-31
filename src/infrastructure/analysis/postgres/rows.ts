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
  playbook_id: string
  playbook_version: string
  playbook_entry_key: string
  provider_id: string
  provider_version: string
  provider_kind: string
  missing_optional_inputs: string[]
  /** 'not-applicable' | 'not-reported' | 'measured'. */
  usage_state: string
  input_tokens: number | null
  output_tokens: number | null
  cost_minor_units: number | null
  currency: string | null
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
  content_hash: string
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
}

export interface ChallengeEvidenceRow {
  challenge_id: string
  evidence_set_id: string
  observation_id: string
  content_hash: string
}

export interface DecisionRow {
  case_id: string
  tenant_id: string
  aggregate_version: number
  decided_at: string
  decided_by_employee_id: string
  selected_revision_id: string | null
  evidence_set_id: string
  rationale: string
  governance: unknown
  unresolved_dissent: unknown
  reconsideration_triggers: unknown
}

export interface DecisionRevisionRow {
  case_id: string
  revision_id: string
  relation: string
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
  blocks_eligibility: boolean | null
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
