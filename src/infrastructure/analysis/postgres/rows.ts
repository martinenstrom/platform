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
  proposed_by_department_id: string
  proposed_by_employee_id: string
  proposed_at: string
  revised_at: string | null
  revision_reason: string | null
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
  output_schema_version: string
  prompt_id: string
  prompt_version: string
  prompt_content_hash: string
  model_id: string
  model_provider: string
  model_parameters_hash: string
  model_parameters: unknown
  evidence_set_id: string
  started_at: string
  completed_at: string | null
  failure_reason: string | null
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
}

export interface IdempotencyKeyRow {
  key: string
  command_type: string
  result_ref: string
  created_at: string
}
