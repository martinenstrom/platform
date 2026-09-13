/**
 * Rows into domain values.
 *
 * Two rules, and both are about not trusting the database more than any other
 * input.
 *
 * **Everything goes through the domain builders.** A row that has been edited
 * by hand, restored from an older backup, or written by a previous version of
 * this code is exactly when validation matters most — so `buildAssignment`,
 * `buildClaim`, `buildRunRecord` and the rest run on the way out, and a row
 * that cannot produce a valid domain value raises `MalformedRowError` instead
 * of entering the application as something plausible.
 *
 * **Everything is sealed.** `jsonb` arrives as freshly allocated mutable
 * objects, and the invariant established in stage 0 is that no mutable
 * structure reaches application code. `seal` is the same function the
 * in-memory adapter uses, so both stores return deeply frozen aggregates and
 * the parity suite can assert immutability the same way against either.
 */

import {
  CASE_STAGES,
  buildAssignment,
  buildChallenge,
  buildRequirementResolution,
  buildClaim,
  buildProducedSynthesis,
  buildVerificationCandidate,
  buildDevilsAdvocateCandidate,
  buildPeerExaminationCandidate,
  type GovernanceCandidateBasis,
  type ProducedVerificationReview,
  type ProducedDevilsAdvocateReview,
  type ProducedPeerExamination,
  type ProposedChallenge,
  type VerificationStatus,
  buildEvidenceSet,
  buildObservation,
  buildManagerAggregation,
  buildRunRecord,
  buildThesis,
  buildTransitionEvent,
  PROVIDER_KINDS,
  type AgentClaim,
  type AgentRunRecord,
  type Assignment,
  type CaseTransition,
  type Challenge,
  type ChallengeStatus,
  type ChallengerKind,
  type ComplianceReview,
  type DevilsAdvocateReview,
  type PeerExaminationReview,
  type DurableObservation,
  type EvidenceItem,
  type EvidenceRef,
  type AggregationInput,
  type ClaimDispositionRecord,
  type DisagreementMateriality,
  type CostBudget,
  type DeadlineBudget,
  type EvidenceAssembly,
  type EvidenceSet,
  type ExecutionBudget,
  type ExecutionIdentity,
  type TokenBudget,
  type InvestmentImplication,
  type ManagerAggregation,
  type ProducedSynthesis,
  type ProposedClaimDisposition,
  type ProposedOptionalInput,
  type OptionalInputRecord,
  type ProviderKind,
  type RunMoneyCost,
  type RunUsage,
  type RequirementResolution,
  type RoleFunction,
  type ContributionRejectionCode,
  type RunFailureCategory,
  type InvestmentCase,
  type InvestmentThesis,
  type ReviewScope,
  type RiskReview,
  type RunEvent,
  type TransitionEvent,
  type FindingValue,
  type RiskFinding,
  type VerificationFinding,
  type VerificationReview,
} from '~/domain/analysis'
import { MalformedRowError } from '~/application/analysis/repositories'
import type { StoredResult } from '~/application/analysis/resultStore'
import { seal } from '../seal'
import type {
  AgentResultRow,
  AggregationClaimDispositionRow,
  AggregationInputRow,
  AggregationOptionalInputRow,
  AggregationRow,
  AssignmentRow,
  CaseRow,
  ChallengeEvidenceRow,
  ChallengeRow,
  ClaimEvidenceRow,
  ClaimRow,
  ProducedSynthesisRow,
  ProducedVerificationReviewRow,
  ProducedDevilsAdvocateReviewRow,
  ProducedPeerExaminationRow,
  EvidenceItemRow,
  EvidenceAssemblyRow,
  ObservationRow,
  EvidenceSetRow,
  RequirementResolutionRow,
  ReviewRow,
  RunEventRow,
  RunRow,
  ThesisRevisionRow,
  TransitionEventRow,
  VerificationFindingRow,
  RiskFindingRow,
  RiskLimitRow,
  VerificationClaimReviewedRow,
} from './rows'
import { asCanonicalValue } from '~/domain/shared/canonicalValue'

/** Wraps a builder so a domain rejection is reported as a malformed row. */
function build<T>(record: string, operation: string, make: () => T): T {
  try {
    return make()
  } catch (error) {
    throw new MalformedRowError(
      record,
      error instanceof Error ? error.message : String(error),
      operation,
    )
  }
}

/** Drops keys whose value is null, so optional domain fields stay absent. */
function present<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && item !== undefined) out[key] = item
  }
  return out as T
}

function expectArray(value: unknown, record: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MalformedRowError(record, `${field} is not an array`, record)
  }
  return value
}

/* ------------------------------------------------------------------ cases */

/*
 * From the domain, never a copy. A second list here is a second definition of
 * what stages exist, and it drifted: it refused `decided` for as long as the
 * domain had one.
 */
const KNOWN_CASE_STAGES: ReadonlySet<string> = new Set<string>(CASE_STAGES)

/**
 * A case, with its participants and its movement history.
 *
 * `transitions` is projected from `transition_events`, not stored on the case:
 * two copies of the same history are two things that can disagree, and the
 * events table is the one with append-only permissions behind it.
 */
export function toCase(
  row: CaseRow,
  participants: readonly string[],
  transitions: readonly TransitionEventRow[],
): InvestmentCase {
  if (!KNOWN_CASE_STAGES.has(row.stage)) {
    throw new MalformedRowError('case', `unknown stage "${row.stage}"`, 'cases')
  }

  const movements = transitions.map((event) => {
    if (!event.actor_employee_id || !event.actor_department_id) {
      /*
       * Refused rather than filled with an empty string. A department acts
       * through a person, and an empty employee id reads as an employee rather
       * than as the absence of one. Migration 0012 enforces this at write time;
       * this is the read half, for rows written before it existed.
       */
      throw new MalformedRowError(
        'case transition',
        `event "${event.event_id}" moves the case but names no actor`,
        'cases.get',
      )
    }
    return present({
      caseId: event.case_id,
      from: event.from_state as InvestmentCase['stage'],
      to: event.to_state as InvestmentCase['stage'],
      at: event.occurred_at,
      byEmployeeId: event.actor_employee_id,
      byDepartmentId: event.actor_department_id,
      reason: event.reason,
    }) as unknown as CaseTransition
  })

  return seal(
    present({
      id: row.id,
      version: row.version,
      subject: {
        kind: row.subject_kind,
        ref: row.subject_ref,
        displayName: row.subject_display_name,
      },
      question: row.question,
      stage: row.stage as InvestmentCase['stage'],
      openedAt: row.opened_at,
      ownerEmployeeId: row.owner_employee_id,
      participatingDepartmentIds: [...participants],
      transitions: movements,
      closedAt: row.closed_at,
      playbookId: row.playbook_id,
      playbookVersion: row.playbook_version,
    }) as InvestmentCase,
    'cases',
  )
}

/* --------------------------------------------------------------- theses */

export function toThesis(
  row: ThesisRevisionRow,
  links: readonly { claim_id: string; relation: string }[],
): InvestmentThesis {
  const of = (relation: string) =>
    links.filter((link) => link.relation === relation).map((link) => link.claim_id)

  return seal(
    build('thesis revision', 'theses', () =>
      buildThesis(
        present({
          thesisId: row.thesis_id,
          revisionId: row.revision_id,
          revisionNumber: row.revision_number,
          supersedesRevisionId: row.supersedes_revision_id,
          revisedAt: row.revised_at,
          revisionReason: row.revision_reason,
          revisionCause: row.revision_cause as InvestmentThesis['revisionCause'],
          caseId: row.case_id,
          statement: row.statement,
          position: row.position,
          proposedByDepartmentId: row.proposed_by_department_id,
          proposedByEmployeeId: row.proposed_by_employee_id,
          proposedByAgentPrincipalId: row.proposed_by_agent_principal_id,
          proposedAt: row.proposed_at,
          implications: row.implications as InvestmentThesis['implications'],
          supportingClaimIds: of('supporting'),
          opposingClaimIds: of('opposing'),
          citedByClaimIds: of('cites'),
          lifecycle: row.lifecycle,
          aggregationId: row.aggregation_id,
          invalidationCriteria: row.invalidation_criteria,
          horizon: row.horizon,
        }) as InvestmentThesis,
      ),
    ),
    'theses',
  )
}

/* ----------------------------------------------------------- assignments */

export function toAssignment(row: AssignmentRow): Assignment {
  const waitingOn =
    row.waiting_on_kind === 'assignment'
      ? { kind: 'assignment' as const, assignmentId: row.waiting_on_assignment_id! }
      : row.waiting_on_kind === 'evidence'
        ? { kind: 'evidence' as const, evidenceSought: row.waiting_on_description! }
        : null

  return seal(
    build('assignment', 'assignments', () =>
      buildAssignment(
        present({
          id: row.id,
          caseId: row.case_id,
          playbookEntryKey: row.playbook_entry_key,
          departmentId: row.department_id,
          assigneeEmployeeId: row.assignee_employee_id ?? undefined,
          assigneeAgentPrincipalId: row.assignee_agent_principal_id ?? undefined,
          brief: row.brief,
          status: row.status,
          createdAt: row.created_at,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          waitingOn,
          returnedReason: row.returned_reason,
          priority: row.priority,
        }) as Assignment,
      ),
    ),
    'assignments',
  )
}

/* ---------------------------------------------------------------- claims */

function toEvidenceRefs(
  rows: readonly ClaimEvidenceRow[],
  stance: string,
): EvidenceRef[] {
  return rows
    .filter((row) => row.stance === stance)
    .map((row) => ({
      setId: row.evidence_set_id,
      observationId: row.observation_id,
      contentHash: row.content_hash,
    }))
}

/**
 * A stored Research Office synthesis candidate.
 *
 * Rebuilt through `buildProducedSynthesis`, which recomputes the content hash
 * from the row's own artifact and basis. The stored digest is then compared
 * against it: a candidate that no longer hashes to what it says it does is a
 * malformed row, not a candidate with an interesting hash. Corruption-evident,
 * not tamper-proof — see `synthesisHashMatches`.
 */
export function toProducedSynthesis(row: ProducedSynthesisRow): ProducedSynthesis {
  const candidate = build('produced synthesis', 'produced_syntheses', () =>
    buildProducedSynthesis({
      runId: row.run_id,
      artifact: {
        statement: row.statement,
        position: row.position,
        rationale: row.rationale,
        invalidationCriteria: row.invalidation_criteria,
        ...(row.horizon === null ? {} : { horizon: row.horizon }),
        implications: expectArray(
          row.implications,
          'produced synthesis',
          'implications',
        ) as InvestmentImplication[],
        inputRunIds: expectArray(
          row.input_run_ids,
          'produced synthesis',
          'input_run_ids',
        ) as string[],
        dispositions: expectArray(
          row.dispositions,
          'produced synthesis',
          'dispositions',
        ) as ProposedClaimDisposition[],
        optionalInputs: expectArray(
          row.optional_inputs,
          'produced synthesis',
          'optional_inputs',
        ) as ProposedOptionalInput[],
      },
      basis: {
        caseId: row.case_id,
        sourceRevisionId: row.source_revision_id,
        playbookId: row.playbook_id,
        playbookVersion: row.playbook_version,
        observedCompletedRunIds: expectArray(
          row.observed_completed_run_ids,
          'produced synthesis',
          'observed_completed_run_ids',
        ) as string[],
      },
      producedAt: row.produced_at,
    }),
  )

  if (
    candidate.contentHash !== row.content_hash ||
    candidate.canonicalizationVersion !== row.canonicalization_version
  ) {
    throw new MalformedRowError(
      'produced synthesis',
      `stored digest ${row.content_hash} (v${row.canonicalization_version}) does ` +
        `not match the candidate it is stored with`,
      'produced_syntheses',
    )
  }
  return seal(candidate, 'produced_syntheses')
}

/**
 * The basis every governance candidate row carries, read back once.
 *
 * Shared because the three acts are produced against the same kind of
 * institutional state. Three copies would be three chances for one of them to
 * stop reading the revision, which is the member the whole stale check rests on.
 */
function toGovernanceBasis(
  row: ProducedVerificationReviewRow | ProducedDevilsAdvocateReviewRow,
  act: string,
): GovernanceCandidateBasis {
  return {
    caseId: row.case_id,
    thesisId: row.thesis_id,
    sourceRevisionId: row.source_revision_id,
    playbookId: row.playbook_id,
    playbookVersion: row.playbook_version,
    playbookEntryKey: row.playbook_entry_key,
    observedClaimIds: expectArray(
      row.observed_claim_ids,
      act,
      'observed_claim_ids',
    ) as string[],
  }
}

/**
 * A stored digest that does not attest its own row is a refusal, not a warning.
 *
 * The same rule `toProducedSynthesis` applies: reading a candidate whose hash
 * disagrees with its contents would hand a filing command something the record
 * cannot vouch for, and the filing command is the last place that could catch
 * it.
 */
function assertCandidateDigest(
  computed: { contentHash: string; canonicalizationVersion: string },
  row: { content_hash: string; canonicalization_version: string },
  act: string,
  table: string,
): void {
  if (
    computed.contentHash !== row.content_hash ||
    computed.canonicalizationVersion !== row.canonicalization_version
  ) {
    throw new MalformedRowError(
      act,
      `stored digest ${row.content_hash} (v${row.canonicalization_version}) does ` +
        `not match the candidate it is stored with`,
      table,
    )
  }
}

export function toProducedVerificationReview(
  row: ProducedVerificationReviewRow,
): ProducedVerificationReview {
  const candidate = build(
    'produced verification review',
    'produced_verification_reviews',
    () =>
      buildVerificationCandidate({
        runId: row.run_id,
        artifact: {
          status: row.status as VerificationStatus,
          findings: expectArray(
            row.findings,
            'produced verification review',
            'findings',
          ) as VerificationFinding[],
          claimsReviewed: expectArray(
            row.claims_reviewed,
            'produced verification review',
            'claims_reviewed',
          ) as string[],
        },
        basis: toGovernanceBasis(row, 'produced verification review'),
        producedAt: row.produced_at,
      }),
  )
  assertCandidateDigest(
    candidate,
    row,
    'produced verification review',
    'produced_verification_reviews',
  )
  return seal(candidate, 'produced_verification_reviews')
}

export function toProducedDevilsAdvocateReview(
  row: ProducedDevilsAdvocateReviewRow,
): ProducedDevilsAdvocateReview {
  const candidate = build(
    "produced devil's advocate review",
    'produced_devils_advocate_reviews',
    () =>
      buildDevilsAdvocateCandidate({
        runId: row.run_id,
        artifact: {
          challenges: expectArray(
            row.challenges,
            "produced devil's advocate review",
            'challenges',
          ) as ProposedChallenge[],
        },
        basis: toGovernanceBasis(row, "produced devil's advocate review"),
        producedAt: row.produced_at,
      }),
  )
  assertCandidateDigest(
    candidate,
    row,
    "produced devil's advocate review",
    'produced_devils_advocate_reviews',
  )
  return seal(candidate, 'produced_devils_advocate_reviews')
}

export function toProducedPeerExamination(
  row: ProducedPeerExaminationRow,
): ProducedPeerExamination {
  const candidate = build('produced peer examination', 'produced_peer_examinations', () =>
    buildPeerExaminationCandidate({
      runId: row.run_id,
      artifact: {
        challenges: expectArray(
          row.challenges,
          'produced peer examination',
          'challenges',
        ) as ProposedChallenge[],
      },
      basis: {
        ...toGovernanceBasis(row, 'produced peer examination'),
        examinedDepartmentId: row.examined_department_id,
      },
      producedAt: row.produced_at,
    }),
  )
  assertCandidateDigest(
    candidate,
    row,
    'produced peer examination',
    'produced_peer_examinations',
  )
  return seal(candidate, 'produced_peer_examinations')
}

export function toClaim(
  row: ClaimRow,
  evidence: readonly ClaimEvidenceRow[],
): AgentClaim {
  return seal(
    build('claim', 'claims', () =>
      buildClaim(
        present({
          id: row.id,
          type: row.type,
          statement: row.statement,
          status: row.status,
          evidenceRefs: toEvidenceRefs(evidence, 'supporting'),
          contradictingEvidenceRefs: toEvidenceRefs(evidence, 'contradicting'),
          confidence: present({
            level: row.confidence_level,
            basis: expectArray(row.confidence_basis, 'claim', 'confidence_basis'),
            cappedBy: row.confidence_capped_by,
          }),
          temporalScope: present({
            asOf: row.temporal_as_of,
            horizon: row.temporal_horizon,
          }),
          contests: row.contests_claim_id,
          supportsThesisId: row.supports_thesis_id,
          opposesThesisId: row.opposes_thesis_id,
          attribution: row.causal_attribution,
        }) as unknown as AgentClaim,
      ),
    ),
    'claims',
  )
}

/* ------------------------------------------------------------------ runs */

export function toRunEvent(row: RunEventRow): RunEvent {
  return present({
    runId: row.run_id,
    at: row.at,
    state: row.state,
    reason: row.reason,
  }) as RunEvent
}

/**
 * Rebuilds the execution identity, refusing a row that cannot make one.
 *
 * The database enforces the same shapes through CHECK constraints; this is the
 * second wall. A row edited by hand into `identity_kind = 'model'` with no
 * model columns fails here rather than entering the domain as a run that
 * claims a model nobody can name.
 */
function toExecutionIdentity(row: RunRow): ExecutionIdentity {
  switch (row.identity_kind) {
    case 'model':
      if (!row.prompt_id || !row.model_id) {
        throw new MalformedRowError(
          'run',
          'identity_kind is "model" without a prompt and a model',
          'runs.get',
        )
      }
      return {
        kind: 'model',
        prompt: {
          id: row.prompt_id,
          version: row.prompt_version!,
          contentHash: row.prompt_content_hash!,
        },
        model: {
          id: row.model_id,
          provider: row.model_provider!,
          parameters: (row.model_parameters ?? {}) as Record<string, string>,
          parametersHash: row.model_parameters_hash!,
        },
      }
    case 'scenario':
      if (!row.scenario_id || !row.stub_version) {
        throw new MalformedRowError(
          'run',
          'identity_kind is "scenario" without a scenario and a stub version',
          'runs.get',
        )
      }
      return {
        kind: 'scenario',
        scenarioId: row.scenario_id,
        stubVersion: row.stub_version,
      }
    case 'unavailable':
      if (row.identity_unavailable_reason !== 'not-captured-by-recording') {
        throw new MalformedRowError(
          'run',
          `identity_kind is "unavailable" with reason ` +
            `"${row.identity_unavailable_reason}"`,
          'runs.get',
        )
      }
      return {
        kind: 'unavailable',
        reason: 'not-captured-by-recording',
        recordingId: row.recording_id ?? '',
      }
    default:
      throw new MalformedRowError(
        'run',
        `unknown identity_kind "${row.identity_kind}"`,
        'runs.get',
      )
  }
}

/**
 * Rebuilds what the run consumed.
 *
 * `measured` requires every part of the measurement, so a half-written cost
 * cannot read as a complete one — and a missing state cannot quietly become
 * "free", which is what a bare nullable column did.
 */
/**
 * Money, read separately from tokens.
 *
 * A row whose cost state is missing while tokens were counted is malformed
 * rather than quietly `not-reported` — silence about the question is not the
 * same as the question having been asked and unanswered, and 0029's CHECK
 * makes such a row unwritable in the first place.
 */
function toRunMoneyCost(row: RunRow): RunMoneyCost {
  switch (row.usage_cost_state) {
    case 'not-reported':
      return { state: 'not-reported' }
    case 'measured':
      if (row.cost_minor_units === null || row.currency === null) {
        throw new MalformedRowError(
          'run',
          'usage_cost_state is "measured" but carries no amount',
          'runs.get',
        )
      }
      return {
        state: 'measured',
        costMinorUnits: row.cost_minor_units,
        currency: row.currency,
      }
    default:
      throw new MalformedRowError(
        'run',
        `unknown usage_cost_state "${row.usage_cost_state}"`,
        'runs.get',
      )
  }
}

function toRunUsage(row: RunRow): RunUsage {
  switch (row.usage_state) {
    case 'not-applicable':
      return { state: 'not-applicable' }
    case 'not-reported':
      return { state: 'not-reported' }
    case 'measured': {
      if (row.input_tokens === null || row.output_tokens === null) {
        throw new MalformedRowError(
          'run',
          'usage_state is "measured" but the tokens are not',
          'runs.get',
        )
      }
      return {
        state: 'measured',
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cost: toRunMoneyCost(row),
      }
    }
    default:
      throw new MalformedRowError(
        'run',
        `unknown usage_state "${row.usage_state}"`,
        'runs.get',
      )
  }
}

/**
 * Rebuilds what the run was authorized to spend.
 *
 * Each dimension is read on its own, and a `limit` without its value is a
 * malformed row rather than a silently unbounded one — the failure mode the
 * three-state design exists to prevent, so it must not be reintroduced at the
 * boundary that reads the columns back.
 */
function toBudgetDimension<T>(
  kind: string,
  limit: () => T | null,
  column: string,
): T | { kind: 'not-applicable' } | { kind: 'not-measured' } {
  switch (kind) {
    case 'not-applicable':
      return { kind: 'not-applicable' }
    case 'not-measured':
      return { kind: 'not-measured' }
    case 'limit': {
      const value = limit()
      if (value === null) {
        throw new MalformedRowError(
          'run',
          `${column} is "limit" but carries no value`,
          'runs.get',
        )
      }
      return value
    }
    default:
      throw new MalformedRowError('run', `unknown ${column} "${kind}"`, 'runs.get')
  }
}

function toExecutionBudget(row: RunRow): ExecutionBudget {
  const tokens = toBudgetDimension<TokenBudget>(
    row.budget_tokens_kind,
    () =>
      row.budget_tokens === null ? null : { kind: 'limit', tokens: row.budget_tokens },
    'budget_tokens_kind',
  )
  const cost = toBudgetDimension<CostBudget>(
    row.budget_cost_kind,
    () =>
      row.budget_cost_minor_units === null || row.budget_currency === null
        ? null
        : {
            kind: 'limit',
            costMinorUnits: row.budget_cost_minor_units,
            currency: row.budget_currency,
          },
    'budget_cost_kind',
  )
  const deadline = toBudgetDimension<DeadlineBudget>(
    row.budget_deadline_kind,
    () =>
      row.budget_deadline_ms === null
        ? null
        : { kind: 'limit', deadlineMs: row.budget_deadline_ms },
    'budget_deadline_kind',
  )

  return { tokens, cost, deadline }
}

export function toRun(
  row: RunRow,
  events: readonly RunEventRow[],
  claims: readonly AgentClaim[],
): AgentRunRecord {
  const identity = toExecutionIdentity(row)
  const usage = toRunUsage(row)
  const budget = toExecutionBudget(row)

  return seal(
    build('run', 'runs', () =>
      buildRunRecord(
        present({
          id: row.id,
          caseId: row.case_id,
          assignmentId: row.assignment_id,
          departmentId: row.department_id,
          employeeId: row.employee_id ?? undefined,
          agentPrincipalId: row.agent_principal_id ?? undefined,
          agentContractVersion: row.agent_contract_version,
          outputSchemaVersion: row.output_schema_version,
          evidenceSetId: row.evidence_set_id,
          state: row.state,
          revisionId: row.revision_id,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          events: events.map(toRunEvent),
          claims: [...claims],
          budget,
          usage,
          ...(row.failure_category
            ? {
                failure: {
                  category: row.failure_category as RunFailureCategory,
                  retryable: row.failure_retryable!,
                  attempt: row.failure_attempt!,
                  at: row.failed_at!,
                },
              }
            : {}),
          /*
           * Beside the failure, never folded into it. A run the firm declined
           * and a run that fell over answer different questions, and
           * `runs_rejection_complete` makes the three companion columns present
           * exactly when the code is.
           */
          ...(row.rejection_code
            ? {
                rejection: {
                  code: row.rejection_code as ContributionRejectionCode,
                  detail: row.rejection_detail!,
                  /* Exactly one, and absent is absent — never a null id. */
                  ...(row.rejected_by_employee_id
                    ? { rejectedByEmployeeId: row.rejected_by_employee_id }
                    : {}),
                  ...(row.rejected_by_agent_principal_id
                    ? {
                        rejectedByAgentPrincipalId: row.rejected_by_agent_principal_id,
                      }
                    : {}),
                  rejectedAt: row.rejected_at!,
                },
              }
            : {}),
          missingOptionalInputs: row.missing_optional_inputs ?? [],
          execution: {
            playbookId: row.playbook_id,
            playbookVersion: row.playbook_version,
            playbookEntryKey: row.playbook_entry_key,
            providerId: row.provider_id,
            providerVersion: row.provider_version,
            providerKind: row.provider_kind as ProviderKind,
            identity,
          },
          obsolete: row.obsolete ? true : null,
        }) as unknown as AgentRunRecord,
      ),
    ),
    'runs',
  )
}

/* -------------------------------------------------------------- evidence */

/**
 * Rebuilds an evidence set and **verifies its own id**.
 *
 * The id is a content hash, so recomputing it turns every read into an
 * integrity check on the one record whose entire purpose is "this is exactly
 * what the agent reasoned over". A mismatch means the stored items are not the
 * items the id was computed from, which no amount of downstream care can
 * recover from.
 *
 * The stored `co_temporality` and `disagreements` columns are derived caches
 * for queries that do not hydrate items; the recomputed values are
 * authoritative.
 */
/**
 * A stored observation row, back into a domain record.
 *
 * `buildObservation` verifies the reference against the value under the row's
 * OWN key generation before the record exists — the same check
 * `buildEvidenceSet` applies to an item. A row whose payload no longer matches
 * its hash is refused loudly here rather than entering the domain as a
 * plausible-looking value, which is the one thing an observation store must
 * never do: every citation in the institution resolves against these.
 */
export function toObservation(row: ObservationRow): DurableObservation {
  return build('observation', 'observations', () =>
    buildObservation({
      ref: present({
        id: row.observation_id,
        contentHash: row.content_hash,
        keyGeneration: row.key_generation,
        subjectKind: row.subject_kind,
        subject: row.subject,
        kind: row.kind,
        sourceId: row.source_id,
        seriesId: row.series_id,
        methodology: row.methodology,
        referencePeriod: row.reference_period,
        observedAt: row.observed_at,
      }) as DurableObservation['ref'],
      /* Validated on the way out, not trusted. See `toEvidenceSet`. */
      value: asCanonicalValue(row.value),
      provenance: row.provenance as DurableObservation['provenance'],
      recordedAt: row.recorded_at,
      correlationId: row.correlation_id,
    }),
  )
}

/**
 * A stored assembly act, back into a domain record.
 *
 * Nothing is verified here beyond shape, and deliberately: an assembly is a
 * record of what a person did, not a content-addressed artifact. The set it
 * points at verifies its own id on read, which is where that check belongs.
 */
export function toEvidenceAssembly(row: EvidenceAssemblyRow): EvidenceAssembly {
  return build('evidence assembly', 'assemblies', () => ({
    assemblyId: row.assembly_id,
    evidenceSetId: row.evidence_set_id,
    selection: {
      ruleId: row.rule_id,
      subjectFamily: row.subject_family,
      from: row.window_from,
      to: row.window_to,
      knownAt: row.known_at,
    },
    selectedSubjects: row.selected_subjects,
    observationCount: row.observation_count,
    derivedCount: row.derived_count,
    assembledAt: row.assembled_at,
    actorEmployeeId: row.actor_employee_id,
    onBehalfOfDepartmentId: row.on_behalf_of_department_id,
    correlationId: row.correlation_id,
  }))
}

export function toEvidenceSet(
  row: EvidenceSetRow,
  items: readonly EvidenceItemRow[],
): EvidenceSet {
  const evidenceItems: EvidenceItem[] = items.map((item) => {
    /*
     * A linked row whose observation is not in the store — the LEFT JOIN in
     * `EVIDENCE_SQL.items` leaves the payload NULL.
     *
     * Refused by name rather than hydrated as an item with no payload. An
     * evidence set that quietly returned fewer facts than it was assembled from
     * would let a claim's basis shrink with nothing saying so, which is exactly
     * what a content-addressed set exists to make impossible.
     */
    if (item.links_observation && item.value === null) {
      throw new MalformedRowError(
        'evidence item',
        `"${item.observation_id}" links to an observation the store does not ` +
          `hold at content hash "${item.content_hash}"`,
        'evidence',
      )
    }

    return {
      ref: present({
        id: item.observation_id,
        subjectKind: item.subject_kind,
        subject: item.subject,
        kind: item.kind,
        observedAt: item.observed_at,
        sourceId: item.source_id,
        seriesId: item.series_id,
        methodology: item.methodology,
        /*
         * Read back rather than assumed. `buildEvidenceSet` verifies every item,
         * and verification recomputes the id under the row's OWN generation — so
         * hydrating a v1 row as v2, or the reverse, would report tampering on
         * data that is intact. The column is what makes the two readable together.
         */
        keyGeneration: item.key_generation,
        referencePeriod: item.reference_period,
        contentHash: item.content_hash,
      }) as EvidenceItem['ref'],
      /*
       * Validated on the way out of the database, not trusted.
       *
       * A stored payload is external data by the time it comes back: it was
       * written by some build, possibly an older one, and `EvidenceItem.value`
       * is an identity input. A row that is not canonical is refused loudly here
       * rather than producing a different semantic key further downstream.
       */
      value: asCanonicalValue(item.value),
      provenance: item.provenance as EvidenceItem['provenance'],
    }
  })

  const rebuilt = build('evidence set', 'evidence', () =>
    buildEvidenceSet({
      items: evidenceItems,
      assembledAt: row.assembled_at,
      correlationId: row.correlation_id,
    }),
  )

  if (rebuilt.id !== row.id) {
    throw new MalformedRowError(
      'evidence set',
      `stored id "${row.id}" does not match its contents, which hash to ` +
        `"${rebuilt.id}" — the set is not what its id says it is`,
      'evidence',
    )
  }
  return seal(rebuilt, 'evidence')
}

/* ------------------------------------------------------------ governance */

/** The scope union, reconstructed from the discriminator and its two columns. */
function toScope(row: ReviewRow): ReviewScope {
  if (row.scope === 'case') {
    return { scope: 'case', caseId: row.case_id }
  }
  if (row.scope !== 'thesis-revision') {
    throw new MalformedRowError('review', `unknown scope "${row.scope}"`, 'reviews')
  }
  if (!row.thesis_id || !row.revision_id) {
    throw new MalformedRowError(
      'review',
      'a thesis-revision review must name both a thesis and a revision',
      'reviews',
    )
  }
  return {
    scope: 'thesis-revision',
    caseId: row.case_id,
    thesisId: row.thesis_id,
    revisionId: row.revision_id,
  }
}

/**
 * Who filed the verdict, whichever kind of principal that was.
 *
 * `present` drops the absent one rather than carrying an explicit null, so a
 * human review reads back exactly as it always has and an agent's carries its
 * principal instead of an employee it never had.
 */
function attribution(row: ReviewRow) {
  return present({
    byEmployeeId: row.by_employee_id ?? undefined,
    byAgentPrincipalId: row.by_agent_principal_id ?? undefined,
    byDepartmentId: row.by_department_id,
    at: row.at,
  })
}

/** Identity and position — common to every verdict since 0019. */
function order(row: ReviewRow) {
  return present({
    reviewId: row.id,
    sequence: row.sequence,
    supersedesReviewId: row.supersedes_review_id,
    reason: row.reason,
    /*
     * Whichever candidate column this kind may carry. The database allows at
     * most one and only the one matching `kind`, so reading all three and
     * taking the first present cannot conflate two acts — and a review a person
     * authored has none of them, which reads back as absent.
     */
    filedFromCandidateRunId:
      row.verification_candidate_run_id ??
      row.devils_advocate_candidate_run_id ??
      row.peer_examination_candidate_run_id,
  })
}

/** A value only exists when it has an amount; unit and currency are optional. */
function findingValue(
  amount: string | null,
  unit: string | null,
  currency: string | null,
): FindingValue | null {
  if (amount === null) return null
  return present({ amount, unit, currency }) as FindingValue
}

export function toVerification(
  row: ReviewRow,
  findings: readonly VerificationFindingRow[],
  claimsReviewed: readonly VerificationClaimReviewedRow[],
): VerificationReview {
  return seal(
    {
      ...toScope(row),
      ...attribution(row),
      ...order(row),
      status: row.status as VerificationReview['status'],
      findings: findings.map(
        (finding) =>
          present({
            kind: finding.kind,
            claimId: finding.claim_id,
            detail: finding.detail,
            blocking: finding.blocking,
            severity: finding.severity,
            /*
             * All three parts, or no citation at all. The hash was previously
             * reconstructed as `''` because the column did not exist — which
             * fabricated data AND disabled the one thing the hash is for:
             * detecting that the evidence moved after somebody verified against
             * it. Migration 0012 added the column; 0012's CHECK keeps the three
             * parts together.
             */
            evidence:
              finding.evidence_set_id && finding.observation_id && finding.content_hash
                ? {
                    setId: finding.evidence_set_id,
                    observationId: finding.observation_id,
                    contentHash: finding.content_hash,
                  }
                : null,
            citedContentHash: finding.cited_content_hash,
            expected: findingValue(
              finding.expected_amount,
              finding.expected_unit,
              finding.expected_currency,
            ),
            observed: findingValue(
              finding.observed_amount,
              finding.observed_unit,
              finding.observed_currency,
            ),
            methodology: finding.methodology,
            correctionRequired: finding.correction_required,
          }) as VerificationFinding,
      ),
      // A row per claim, so an unchecked claim is visible as unchecked rather
      // than merely absent from a document nobody can query.
      claimsReviewed: claimsReviewed.map((entry) => entry.claim_id),
    } as VerificationReview,
    'reviews.verification',
  )
}

/**
 * The challenger mandate, or a refusal.
 *
 * A CHECK constraint already limits the column to the two known values, so this
 * is the second line of defence rather than the first — but a mapper that
 * coerced an unrecognised string into `devils-advocate` would convert a
 * database fault into a false statement about who scrutinised a conclusion,
 * which is the one thing the peer/Devil's-Advocate distinction exists to
 * prevent.
 */
function challengerKindOf(row: ChallengeRow): ChallengerKind {
  if (row.challenger_kind === 'peer' || row.challenger_kind === 'devils-advocate') {
    return row.challenger_kind
  }
  throw new Error(
    `challenge ${row.id} carries challenger_kind ` +
      `${JSON.stringify(row.challenger_kind)}, which is not a known mandate. ` +
      `Refusing to reconstruct it as an institutional act.`,
  )
}

export function toDevilsAdvocate(
  row: ReviewRow,
  challenges: readonly ChallengeRow[],
  evidence: readonly ChallengeEvidenceRow[],
): DevilsAdvocateReview {
  const outcomes: Record<string, ChallengeStatus> = {}
  const built: Challenge[] = challenges.map((challenge) => {
    outcomes[challenge.id] = challenge.outcome as ChallengeStatus
    return build('challenge', 'reviews', () =>
      buildChallenge(
        present({
          id: challenge.id,
          /*
           * Read, never defaulted.
           *
           * Migration 0034 backfilled both columns from the parent review and
           * made them NOT NULL, so the database is the authority on a
           * challenge's provenance. A fallback here would quietly turn a row
           * the database should never have produced into a valid-looking
           * institutional act — and it would outlive the migration that made
           * it unnecessary.
           */
          challengerKind: challengerKindOf(challenge),
          byDepartmentId: challenge.by_department_id,
          contests: challenge.contests_claim_id,
          contestsThesis: challenge.contests_thesis_id,
          kind: challenge.kind,
          argument: challenge.argument,
          wouldBeResolvedBy: challenge.would_be_resolved_by,
          materiality: challenge.materiality,
          resolvedBy: challenge.resolved_by,
          counterEvidence: evidence
            .filter((item) => item.challenge_id === challenge.id)
            .map((item) => ({
              setId: item.evidence_set_id,
              observationId: item.observation_id,
              contentHash: item.content_hash,
            })),
        }) as Challenge,
      ),
    )
  })

  return seal(
    {
      ...toScope(row),
      ...attribution(row),
      ...order(row),
      challenges: built,
      outcomes,
    } as DevilsAdvocateReview,
    'reviews.devilsAdvocate',
  )
}

/**
 * A peer examination, reconstructed from the same challenge rows.
 *
 * It shares `toDevilsAdvocate`'s children deliberately — a challenge is a
 * challenge whichever mandate raised it, and Half A made that mandate explicit
 * on the row rather than implicit in which query found it. What differs is the
 * envelope: who examined, whom they examined, and the fact that an empty
 * challenge list is a finding rather than an empty review.
 */
export function toPeerExamination(
  row: ReviewRow,
  challenges: readonly ChallengeRow[],
  evidence: readonly ChallengeEvidenceRow[],
): PeerExaminationReview {
  const base = toDevilsAdvocate(row, challenges, evidence)
  return seal(
    {
      ...base,
      /*
       * Read, never inferred. A zero-challenge examination has no challenge to
       * derive the examined desk from, and that is exactly the case the
       * eligibility basis must tell apart from "nobody looked" — so a null here
       * is a row the database should not have produced, not a default to fill.
       */
      examinedDepartmentId: examinedDepartmentOf(row),
    } as PeerExaminationReview,
    'reviews.peerExamination',
  )
}

/** Fail closed, for the same reason as `challengerKindOf`. */
function examinedDepartmentOf(row: ReviewRow): string {
  const examined = row.examined_department_id
  if (typeof examined !== 'string' || examined.length === 0) {
    throw new Error(
      `Review ${row.id} is a peer examination with no examined department. ` +
        `Migration 0036 constrains this column to be present for this kind, so ` +
        `the row was written outside the schema or the SELECT omitted it.`,
    )
  }
  return examined
}

export function toCompliance(row: ReviewRow): ComplianceReview {
  // The one kind still carrying a document, and only because nothing records
  // a compliance review yet — see 0019 and TD-42.
  const detail = (row.detail ?? {}) as { findings?: unknown }
  return seal(
    {
      ...toScope(row),
      ...attribution(row),
      ...order(row),
      status: row.status as ComplianceReview['status'],
      findings: Array.isArray(detail.findings)
        ? (detail.findings as ComplianceReview['findings'])
        : [],
    } as ComplianceReview,
    'reviews.compliance',
  )
}

export function toRisk(
  row: ReviewRow,
  findings: readonly RiskFindingRow[],
  limits: readonly RiskLimitRow[],
): RiskReview {
  return seal(
    present({
      ...toScope(row),
      ...attribution(row),
      ...order(row),
      status: row.status as RiskReview['status'],
      findings: findings.map(
        (finding) =>
          present({
            kind: finding.kind,
            detail: finding.detail,
            severity: finding.severity,
            implication: finding.implication,
            mitigatedBy: finding.mitigated_by,
          }) as RiskFinding,
      ),
      limits: limits.length > 0 ? limits.map((entry) => entry.limit_text) : null,
    }) as RiskReview,
    'reviews.risk',
  )
}

/* -------------------------------------------------------------- decisions */

export function toTransitionEvent(row: TransitionEventRow): TransitionEvent {
  return seal(
    build('transition event', 'events', () =>
      buildTransitionEvent({
        /*
         * `fromState` is set AFTER `present()` rather than through it.
         *
         * `present` drops nulls so that an absent optional field stays absent —
         * but `fromState: null` is not an absent field. It is the recorded fact
         * that there was no previous state, which is what makes an event a
         * creation rather than a movement. Running it through `present` turned
         * `null` into `undefined`, and the in-memory store kept the null: a
         * silent divergence on every creation event, which the parity suite
         * passed straight over.
         */
        ...(present({
          eventId: row.event_id,
          subject: row.subject,
          caseId: row.case_id,
          thesisId: row.thesis_id,
          revisionId: row.revision_id,
          assignmentId: row.assignment_id,
          runId: row.run_id,
          reviewId: row.review_id,
          challengeId: row.challenge_id,
          toState: row.to_state,
          actorEmployeeId: row.actor_employee_id,
          actorDepartmentId: row.actor_department_id,
          reason: row.reason,
          occurredAt: row.occurred_at,
          correlationId: row.correlation_id,
          causationId: row.causation_id,
          aggregateVersion: row.aggregate_version,
          corrects: row.corrects,
        }) as Omit<TransitionEvent, 'fromState'>),
        fromState: row.from_state,
      }),
    ),
    'events',
  )
}

/* ---------------------------------------------------------------- results */

export function toStoredResult(row: AgentResultRow): StoredResult {
  /*
   * A result that cannot say what produced it does not enter the domain.
   *
   * The column is nullable because 0015 added it to a table that already
   * existed; nothing has ever written a row without it, and a null here means
   * a row was written by hand or by an older build. Reading it as though the
   * provider were merely unknown would let a fixture replay be reused as
   * analysis the firm stands behind.
   */
  if (!PROVIDER_KINDS.includes(row.provider_kind as ProviderKind)) {
    throw new MalformedRowError(
      'agent result',
      `provider_kind is "${row.provider_kind}"`,
      'results.get',
    )
  }
  return seal(
    {
      key: row.key,
      claims: expectArray(row.claims, 'agent result', 'claims'),
      storedAt: row.stored_at,
      providerKind: row.provider_kind as ProviderKind,
      inputs: row.inputs,
    } as StoredResult,
    'results',
  )
}

/* -------------------------------------------------------- aggregations */

/**
 * A manager aggregation and its three child collections.
 *
 * Everything goes through `buildManagerAggregation`, which re-checks the rules
 * the database also enforces — a row edited by hand into a shape the domain
 * refuses fails here rather than entering the application as a synthesis that
 * lost a claim.
 *
 * The claims in scope are reconstructed from the stored dispositions rather
 * than re-read from the runs: what the manager DID consider is what the record
 * says, and reading the runs now would let a late contribution change what a
 * committed aggregation claims to have covered.
 */
export function toManagerAggregation(
  row: AggregationRow,
  inputs: readonly AggregationInputRow[],
  dispositions: readonly AggregationClaimDispositionRow[],
  optionalInputs: readonly AggregationOptionalInputRow[],
): ManagerAggregation {
  const records: ClaimDispositionRecord[] = dispositions.map(
    (record) =>
      present({
        claimId: record.claim_id,
        runId: record.run_id,
        disposition: record.disposition as ClaimDispositionRecord['disposition'],
        explanation: record.explanation,
        supersededByClaimId: record.superseded_by_claim_id,
        materiality: record.materiality as DisagreementMateriality | null,
        escalationRequired: record.escalation_required,
        downgradedFrom: record.downgraded_from as DisagreementMateriality | null,
      }) as unknown as ClaimDispositionRecord,
  )

  return seal(
    build('manager aggregation', 'aggregations', () =>
      buildManagerAggregation(
        present({
          id: row.id,
          caseId: row.case_id,
          thesisId: row.thesis_id,
          sourceRevisionId: row.source_revision_id,
          producedRevisionId: row.produced_revision_id,
          /* Absent is absent: `present()` drops whichever column is null. */
          managerEmployeeId: row.manager_employee_id,
          managerAgentPrincipalId: row.manager_agent_principal_id,
          synthesisRunId: row.synthesis_run_id,
          departmentId: row.department_id,
          aggregatedAt: row.aggregated_at,
          rationale: row.rationale,
          inputs: inputs.map((input) => ({
            runId: input.run_id,
            playbookEntryKey: input.playbook_entry_key,
            requirementLevel:
              input.requirement_level as AggregationInput['requirementLevel'],
          })),
          dispositions: records,
          optionalInputs: optionalInputs.map(
            (record) =>
              present({
                playbookEntryKey: record.playbook_entry_key,
                availability: record.availability as OptionalInputRecord['availability'],
                runId: record.run_id,
                scope: record.scope as OptionalInputRecord['scope'] | null,
                materiallyRelevant: record.materially_relevant,
                explanation: record.explanation,
              }) as unknown as OptionalInputRecord,
          ),
        }) as unknown as ManagerAggregation,
        {
          claimsInScope: records.map((record) => ({
            claimId: record.claimId,
            runId: record.runId,
            /*
             * Not re-derived from the claim: a claim adopted as supporting
             * cannot have opposed the thesis, because the builder refused that
             * combination on the way in. Re-reading it would make a stored
             * aggregation unreadable if the claim were later cited elsewhere.
             */
            opposesThisThesis: false,
          })),
        },
      ),
    ),
    'aggregations',
  )
}

/* ------------------------------------------------ requirement resolutions */

/**
 * A recorded evaluation of a conditional playbook entry.
 *
 * Through `buildRequirementResolution`, not around it — a row with a blank
 * reason or a system evaluator fails here rather than entering the domain as a
 * plausible governance record.
 */
export function toRequirementResolution(
  row: RequirementResolutionRow,
): RequirementResolution {
  return seal(
    build('requirement resolution', 'requirements', () =>
      buildRequirementResolution({
        caseId: row.case_id,
        playbookEntryKey: row.playbook_entry_key,
        revisionId: row.revision_id,
        state: row.state as RequirementResolution['state'],
        ruleId: row.rule_id,
        ruleVersion: row.rule_version,
        reason: row.reason,
        inputHash: row.input_hash,
        evaluatedAt: row.evaluated_at,
        evaluatedBy: {
          kind: 'employee',
          employeeId: row.evaluated_by_employee_id,
          agentPrincipalId: null,
          roleId: row.evaluated_by_role_id,
          roleFunction: row.evaluated_by_role_function as RoleFunction,
          departmentId: row.evaluated_by_department_id,
          departmentIsGovernance: row.evaluated_by_department_is_governance,
          departmentHandles: row.evaluated_by_department_handles ?? [],
          authentication: 'system-asserted',
          organizationSeedVersion: row.organization_seed_version,
        },
      }),
    ),
    'requirements',
  )
}
