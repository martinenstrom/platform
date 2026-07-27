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
  buildAssignment,
  buildChallenge,
  buildClaim,
  buildEvidenceSet,
  buildRunRecord,
  buildThesis,
  buildTransitionEvent,
  type AgentClaim,
  type AgentRunRecord,
  type Assignment,
  type CaseDecision,
  type CaseTransition,
  type Challenge,
  type ChallengeStatus,
  type ComplianceReview,
  type DevilsAdvocateReview,
  type EvidenceItem,
  type EvidenceRef,
  type EvidenceSet,
  type InvestmentCase,
  type InvestmentThesis,
  type ReviewScope,
  type RiskReview,
  type RunEvent,
  type TransitionEvent,
  type VerificationFinding,
  type VerificationReview,
} from '~/domain/analysis'
import { MalformedRowError } from '~/application/analysis/repositories'
import type { StoredResult } from '~/application/analysis/resultStore'
import { seal } from '../seal'
import type {
  AgentResultRow,
  AssignmentRow,
  CaseRow,
  ChallengeEvidenceRow,
  ChallengeRow,
  ClaimEvidenceRow,
  ClaimRow,
  DecisionRevisionRow,
  DecisionRow,
  EvidenceItemRow,
  EvidenceSetRow,
  ReviewRow,
  RunEventRow,
  RunRow,
  ThesisRevisionRow,
  TransitionEventRow,
  VerificationFindingRow,
} from './rows'

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

const CASE_STAGES = new Set([
  'intake',
  'research',
  'aggregation',
  'review',
  'returned',
  'blocked',
  'decision',
  'published',
  'withdrawn',
])

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
  if (!CASE_STAGES.has(row.stage)) {
    throw new MalformedRowError('case', `unknown stage "${row.stage}"`, 'cases')
  }

  const movements = transitions.map(
    (event) =>
      present({
        caseId: event.case_id,
        from: event.from_state as InvestmentCase['stage'],
        to: event.to_state as InvestmentCase['stage'],
        at: event.occurred_at,
        byEmployeeId: event.actor_employee_id ?? '',
        byDepartmentId: event.actor_department_id ?? '',
        reason: event.reason,
      }) as unknown as CaseTransition,
  )

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
          caseId: row.case_id,
          statement: row.statement,
          position: row.position,
          proposedByDepartmentId: row.proposed_by_department_id,
          proposedByEmployeeId: row.proposed_by_employee_id,
          proposedAt: row.proposed_at,
          supportingClaimIds: of('supporting'),
          opposingClaimIds: of('opposing'),
          citedByClaimIds: of('cites'),
          lifecycle: row.lifecycle,
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
        ? { kind: 'evidence' as const, description: row.waiting_on_description! }
        : null

  return seal(
    build('assignment', 'assignments', () =>
      buildAssignment(
        present({
          id: row.id,
          caseId: row.case_id,
          departmentId: row.department_id,
          assigneeEmployeeId: row.assignee_employee_id,
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

export function toRun(
  row: RunRow,
  events: readonly RunEventRow[],
  claims: readonly AgentClaim[],
): AgentRunRecord {
  const cost =
    row.cost_minor_units === null
      ? null
      : {
          inputTokens: row.input_tokens ?? 0,
          outputTokens: row.output_tokens ?? 0,
          costMinorUnits: row.cost_minor_units,
          currency: row.currency!,
        }

  return seal(
    build('run', 'runs', () =>
      buildRunRecord(
        present({
          id: row.id,
          caseId: row.case_id,
          assignmentId: row.assignment_id,
          departmentId: row.department_id,
          employeeId: row.employee_id,
          agentContractVersion: row.agent_contract_version,
          outputSchemaVersion: row.output_schema_version,
          prompt: {
            id: row.prompt_id,
            version: row.prompt_version,
            contentHash: row.prompt_content_hash,
          },
          model: {
            id: row.model_id,
            provider: row.model_provider,
            parameters: (row.model_parameters ?? {}) as Record<string, string>,
            parametersHash: row.model_parameters_hash,
          },
          evidenceSetId: row.evidence_set_id,
          state: row.state,
          revisionId: row.revision_id,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          events: events.map(toRunEvent),
          claims: [...claims],
          cost,
          failureReason: row.failure_reason,
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
export function toEvidenceSet(
  row: EvidenceSetRow,
  items: readonly EvidenceItemRow[],
): EvidenceSet {
  const evidenceItems: EvidenceItem[] = items.map((item) => ({
    ref: present({
      id: item.observation_id,
      subjectKind: item.subject_kind,
      subject: item.subject,
      kind: item.kind,
      observedAt: item.observed_at,
      sourceId: item.source_id,
      seriesId: item.series_id,
      methodology: item.methodology,
      contentHash: item.content_hash,
    }) as EvidenceItem['ref'],
    value: item.value,
    provenance: item.provenance as EvidenceItem['provenance'],
  }))

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

function attribution(row: ReviewRow) {
  return {
    byEmployeeId: row.by_employee_id,
    byDepartmentId: row.by_department_id,
    at: row.at,
  }
}

export function toVerification(
  row: ReviewRow,
  findings: readonly VerificationFindingRow[],
): VerificationReview {
  const detail = (row.detail ?? {}) as { claimsReviewed?: unknown }
  return seal(
    {
      ...toScope(row),
      ...attribution(row),
      status: row.status as VerificationReview['status'],
      findings: findings.map(
        (finding) =>
          present({
            kind: finding.kind,
            claimId: finding.claim_id,
            detail: finding.detail,
            blocking: finding.blocking,
            evidence:
              finding.evidence_set_id && finding.observation_id
                ? {
                    setId: finding.evidence_set_id,
                    observationId: finding.observation_id,
                    contentHash: '',
                  }
                : null,
          }) as VerificationFinding,
      ),
      claimsReviewed: Array.isArray(detail.claimsReviewed)
        ? (detail.claimsReviewed as string[])
        : [],
    } as VerificationReview,
    'reviews.verification',
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
          contests: challenge.contests_claim_id,
          contestsThesis: challenge.contests_thesis_id,
          kind: challenge.kind,
          argument: challenge.argument,
          wouldBeResolvedBy: challenge.would_be_resolved_by,
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
      challenges: built,
      outcomes,
    } as DevilsAdvocateReview,
    'reviews.devilsAdvocate',
  )
}

export function toCompliance(row: ReviewRow): ComplianceReview {
  const detail = (row.detail ?? {}) as { findings?: unknown }
  return seal(
    {
      ...toScope(row),
      ...attribution(row),
      status: row.status as ComplianceReview['status'],
      findings: Array.isArray(detail.findings)
        ? (detail.findings as ComplianceReview['findings'])
        : [],
    } as ComplianceReview,
    'reviews.compliance',
  )
}

export function toRisk(row: ReviewRow): RiskReview {
  const detail = (row.detail ?? {}) as { concerns?: unknown; limits?: unknown }
  return seal(
    present({
      ...toScope(row),
      ...attribution(row),
      status: row.status as RiskReview['status'],
      concerns: Array.isArray(detail.concerns) ? (detail.concerns as string[]) : [],
      limits: Array.isArray(detail.limits) ? (detail.limits as string[]) : null,
    }) as RiskReview,
    'reviews.risk',
  )
}

/* -------------------------------------------------------------- decisions */

export function toDecision(
  row: DecisionRow,
  revisions: readonly DecisionRevisionRow[],
): CaseDecision {
  const of = (relation: string) =>
    revisions
      .filter((entry) => entry.relation === relation)
      .map((entry) => entry.revision_id)

  return seal(
    {
      caseId: row.case_id,
      aggregateVersion: row.aggregate_version,
      decidedAt: row.decided_at,
      decidedByEmployeeId: row.decided_by_employee_id,
      selectedRevisionId: row.selected_revision_id,
      notSelectedRevisionIds: of('not-selected'),
      rejectedRevisionIds: of('rejected'),
      evidenceSetId: row.evidence_set_id,
      governance: row.governance as CaseDecision['governance'],
      rationale: row.rationale,
      unresolvedDissent: expectArray(
        row.unresolved_dissent,
        'decision',
        'unresolved_dissent',
      ),
      reconsiderationTriggers: expectArray(
        row.reconsideration_triggers,
        'decision',
        'reconsideration_triggers',
      ),
    } as CaseDecision,
    'decisions',
  )
}

/* ----------------------------------------------------------------- events */

export function toTransitionEvent(row: TransitionEventRow): TransitionEvent {
  return seal(
    build('transition event', 'events', () =>
      buildTransitionEvent(
        present({
          eventId: row.event_id,
          subject: row.subject,
          caseId: row.case_id,
          thesisId: row.thesis_id,
          revisionId: row.revision_id,
          assignmentId: row.assignment_id,
          runId: row.run_id,
          fromState: row.from_state,
          toState: row.to_state,
          actorEmployeeId: row.actor_employee_id,
          actorDepartmentId: row.actor_department_id,
          reason: row.reason,
          occurredAt: row.occurred_at,
          correlationId: row.correlation_id,
          causationId: row.causation_id,
          aggregateVersion: row.aggregate_version,
          corrects: row.corrects,
        }) as TransitionEvent,
      ),
    ),
    'events',
  )
}

/*
 * `fromState` is deliberately restored as null rather than dropped: null means
 * "there was no previous state", which is a fact about a creation event, and
 * `present()` would remove the key entirely.
 */

/* ---------------------------------------------------------------- results */

export function toStoredResult(row: AgentResultRow): StoredResult {
  return seal(
    {
      key: row.key,
      claims: expectArray(row.claims, 'agent result', 'claims'),
      storedAt: row.stored_at,
      inputs: row.inputs,
    } as StoredResult,
    'results',
  )
}
