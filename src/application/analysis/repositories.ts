/**
 * Repository ports.
 *
 * Defined here, implemented in `infrastructure/analysis`. Phase B ships an
 * in-memory adapter only — see the limitation note below, which is deliberate
 * and load-bearing rather than an oversight.
 *
 * ## Optimistic concurrency
 *
 * `saveCase` takes the version the caller read. Two departments finishing at
 * the same moment both computed their change against version 12; the second
 * write must be rejected rather than silently overwriting the first. The
 * caller re-reads and retries.
 *
 * A global lock would also prevent the lost update, and would serialise the
 * entire organization to protect one case. Optimistic concurrency keeps
 * independent cases independent, which is what a firm running many cases at
 * once actually needs.
 */

import type {
  AgentRunRecord,
  Assignment,
  CaseDecision,
  ComplianceReview,
  DevilsAdvocateReview,
  EvidenceSet,
  InvestmentCase,
  InvestmentThesis,
  RiskReview,
  TransitionEvent,
  VerificationReview,
} from '~/domain/analysis'

/**
 * PHASE B LIMITATION, recorded where an implementer will see it.
 *
 * The only adapter is in-memory and process-local. On restart every case,
 * thesis, run, review and decision is gone. That is acceptable for a
 * deterministic runtime prototype with no live agents, and it is **not**
 * acceptable for real analysis, user-owned work or production.
 *
 * Durable storage is a hard gate before AI Phase C connects a real agent. It
 * does not depend on authentication: a system-level durable repository can
 * exist before users do. Authentication later adds ownership, access, tenancy
 * and permissions on top of it.
 */
export const PHASE_B_PERSISTENCE_IS_PROCESS_LOCAL = true

/** Thrown when a write loses an optimistic-concurrency race. */
export class ConcurrencyConflictError extends Error {
  constructor(
    readonly caseId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Case "${caseId}" has moved on: expected version ${expectedVersion}, ` +
        `found ${actualVersion}. Re-read and retry.`,
    )
    this.name = 'ConcurrencyConflictError'
  }
}

export interface CaseRepository {
  get(caseId: string): Promise<InvestmentCase | null>
  list(): Promise<InvestmentCase[]>
  /**
   * Creates a case. Idempotent on `id`: replaying the command returns the
   * existing case rather than throwing or duplicating.
   */
  create(investmentCase: InvestmentCase): Promise<InvestmentCase>
  /** Rejects the write when `expectedVersion` is not the stored version. */
  save(investmentCase: InvestmentCase, expectedVersion: number): Promise<InvestmentCase>
}

export interface ThesisRepository {
  get(revisionId: string): Promise<InvestmentThesis | null>
  listForCase(caseId: string): Promise<InvestmentThesis[]>
  /** Idempotent on `revisionId`. */
  save(revision: InvestmentThesis): Promise<InvestmentThesis>
}

export interface AssignmentRepository {
  get(assignmentId: string): Promise<Assignment | null>
  listForCase(caseId: string): Promise<Assignment[]>
  listForDepartment(departmentId: string): Promise<Assignment[]>
  /** Idempotent on `id`. */
  save(assignment: Assignment): Promise<Assignment>
}

export interface RunRepository {
  get(runId: string): Promise<AgentRunRecord | null>
  listForCase(caseId: string): Promise<AgentRunRecord[]>
  /** Idempotent on `id`. */
  save(run: AgentRunRecord): Promise<AgentRunRecord>
}

export interface ReviewRepository {
  verificationsForCase(caseId: string): Promise<VerificationReview[]>
  challengesForCase(caseId: string): Promise<DevilsAdvocateReview[]>
  complianceForCase(caseId: string): Promise<ComplianceReview[]>
  riskForCase(caseId: string): Promise<RiskReview[]>
  saveVerification(review: VerificationReview): Promise<void>
  saveDevilsAdvocate(review: DevilsAdvocateReview): Promise<void>
  saveCompliance(review: ComplianceReview): Promise<void>
  saveRisk(review: RiskReview): Promise<void>
}

/** Append-only. There is deliberately no update or delete. */
export interface EventRepository {
  append(event: TransitionEvent): Promise<void>
  listForCase(caseId: string): Promise<TransitionEvent[]>
  /** Most recent first, across every case. Feeds the activity projection. */
  recent(limit: number): Promise<TransitionEvent[]>
}

/** Content-addressed. An evidence set is immutable, so writes never conflict. */
export interface EvidenceRepository {
  get(setId: string): Promise<EvidenceSet | null>
  save(set: EvidenceSet): Promise<EvidenceSet>
}

export interface DecisionRepository {
  getForCase(caseId: string): Promise<CaseDecision | null>
  list(limit: number): Promise<CaseDecision[]>
  /** Idempotent on `caseId`: a case has at most one decision. */
  save(decision: CaseDecision): Promise<CaseDecision>
}

export interface AnalysisRepositories {
  cases: CaseRepository
  theses: ThesisRepository
  assignments: AssignmentRepository
  runs: RunRepository
  reviews: ReviewRepository
  events: EventRepository
  evidence: EvidenceRepository
  decisions: DecisionRepository
}
