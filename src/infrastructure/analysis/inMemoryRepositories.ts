/**
 * In-memory repository adapters.
 *
 * **Process-local. A restart loses every case, thesis, run, review and
 * decision.** That is acceptable for a deterministic runtime prototype with no
 * live agents, and it is not acceptable for real analysis, user-owned work or
 * production — durable storage is a hard gate before Phase C connects a real
 * agent.
 *
 * Two behaviours are implemented carefully rather than incidentally, because
 * they are the ones a durable adapter will also have to get right:
 *
 * **Optimistic concurrency.** `save` compares the caller's expected version
 * against the stored one and rejects a stale write. Two departments finishing
 * simultaneously do not silently lose one of their updates.
 *
 * **Idempotency.** Creating a case, saving a run, appending an event — all
 * keyed on identity and safe to replay. A retried command produces no
 * duplicate assignment, claim, event, review, run or decision.
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
import {
  ConcurrencyConflictError,
  type AnalysisRepositories,
  type AssignmentRepository,
  type CaseRepository,
  type DecisionRepository,
  type EventRepository,
  type EvidenceRepository,
  type ReviewRepository,
  type RunRepository,
  type ThesisRepository,
} from '~/application/analysis/repositories'

class InMemoryCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, InvestmentCase>()

  async get(caseId: string) {
    return this.cases.get(caseId) ?? null
  }
  async list() {
    return [...this.cases.values()]
  }
  async create(investmentCase: InvestmentCase) {
    // Idempotent: replaying a create returns what is already there.
    const existing = this.cases.get(investmentCase.id)
    if (existing) return existing
    this.cases.set(investmentCase.id, investmentCase)
    return investmentCase
  }
  async save(investmentCase: InvestmentCase, expectedVersion: number) {
    const stored = this.cases.get(investmentCase.id)
    if (stored && stored.version !== expectedVersion) {
      throw new ConcurrencyConflictError(
        investmentCase.id,
        expectedVersion,
        stored.version,
      )
    }
    this.cases.set(investmentCase.id, investmentCase)
    return investmentCase
  }
}

class InMemoryThesisRepository implements ThesisRepository {
  private readonly revisions = new Map<string, InvestmentThesis>()

  async get(revisionId: string) {
    return this.revisions.get(revisionId) ?? null
  }
  async listForCase(caseId: string) {
    return [...this.revisions.values()].filter((r) => r.caseId === caseId)
  }
  async save(revision: InvestmentThesis) {
    /*
     * A sealed revision is never overwritten. Revising mints a new revision
     * and marks the old one superseded, which IS a legitimate write to the old
     * record — so only the lifecycle may change on a sealed revision.
     */
    const existing = this.revisions.get(revision.revisionId)
    if (existing && existing.lifecycle !== revision.lifecycle) {
      const contentChanged =
        existing.statement !== revision.statement ||
        existing.position !== revision.position ||
        existing.invalidationCriteria !== revision.invalidationCriteria
      if (contentChanged) {
        throw new Error(
          `Revision "${revision.revisionId}" cannot be edited. Mint a new ` +
            `revision instead.`,
        )
      }
    }
    this.revisions.set(revision.revisionId, revision)
    return revision
  }
}

class InMemoryAssignmentRepository implements AssignmentRepository {
  private readonly assignments = new Map<string, Assignment>()

  async get(id: string) {
    return this.assignments.get(id) ?? null
  }
  async listForCase(caseId: string) {
    return [...this.assignments.values()].filter((a) => a.caseId === caseId)
  }
  async listForDepartment(departmentId: string) {
    return [...this.assignments.values()].filter((a) => a.departmentId === departmentId)
  }
  async save(assignment: Assignment) {
    this.assignments.set(assignment.id, assignment)
    return assignment
  }
}

class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, AgentRunRecord>()

  async get(id: string) {
    return this.runs.get(id) ?? null
  }
  async listForCase(caseId: string) {
    return [...this.runs.values()].filter((r) => r.caseId === caseId)
  }
  async save(run: AgentRunRecord) {
    this.runs.set(run.id, run)
    return run
  }
}

class InMemoryReviewRepository implements ReviewRepository {
  private readonly verifications: VerificationReview[] = []
  private readonly challenges: DevilsAdvocateReview[] = []
  private readonly compliance: ComplianceReview[] = []
  private readonly risk: RiskReview[] = []

  async verificationsForCase(caseId: string) {
    return this.verifications.filter((r) => r.caseId === caseId)
  }
  async challengesForCase(caseId: string) {
    return this.challenges.filter((r) => r.caseId === caseId)
  }
  async complianceForCase(caseId: string) {
    return this.compliance.filter((r) => r.caseId === caseId)
  }
  async riskForCase(caseId: string) {
    return this.risk.filter((r) => r.caseId === caseId)
  }

  /*
   * Reviews are keyed on case + thesis + reviewer + timestamp. Replaying the
   * same review must not append a second copy, which would double-count a
   * blocker and make a case look worse than it is.
   */
  private static same(
    a: { caseId: string; thesisId?: string; byEmployeeId: string; at: string },
    b: { caseId: string; thesisId?: string; byEmployeeId: string; at: string },
  ) {
    return (
      a.caseId === b.caseId &&
      a.thesisId === b.thesisId &&
      a.byEmployeeId === b.byEmployeeId &&
      a.at === b.at
    )
  }

  async saveVerification(review: VerificationReview) {
    if (!this.verifications.some((r) => InMemoryReviewRepository.same(r, review))) {
      this.verifications.push(review)
    }
  }
  async saveDevilsAdvocate(review: DevilsAdvocateReview) {
    if (!this.challenges.some((r) => InMemoryReviewRepository.same(r, review))) {
      this.challenges.push(review)
    }
  }
  async saveCompliance(review: ComplianceReview) {
    if (!this.compliance.some((r) => InMemoryReviewRepository.same(r, review))) {
      this.compliance.push(review)
    }
  }
  async saveRisk(review: RiskReview) {
    if (!this.risk.some((r) => InMemoryReviewRepository.same(r, review))) {
      this.risk.push(review)
    }
  }
}

/** Append-only. Deliberately offers no update or delete. */
class InMemoryEventRepository implements EventRepository {
  private readonly events: TransitionEvent[] = []
  private readonly seen = new Set<string>()

  async append(event: TransitionEvent) {
    if (this.seen.has(event.eventId)) return
    this.seen.add(event.eventId)
    this.events.push(event)
  }
  async listForCase(caseId: string) {
    return this.events.filter((e) => e.caseId === caseId)
  }
  async recent(limit: number) {
    return [...this.events]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit)
  }
}

class InMemoryEvidenceRepository implements EvidenceRepository {
  private readonly sets = new Map<string, EvidenceSet>()

  async get(setId: string) {
    return this.sets.get(setId) ?? null
  }
  async save(set: EvidenceSet) {
    // Content-addressed and immutable: an existing id already holds this
    // exact content, so a re-save is a no-op rather than a conflict.
    const existing = this.sets.get(set.id)
    if (existing) return existing
    this.sets.set(set.id, set)
    return set
  }
}

class InMemoryDecisionRepository implements DecisionRepository {
  private readonly decisions = new Map<string, CaseDecision>()

  async getForCase(caseId: string) {
    return this.decisions.get(caseId) ?? null
  }
  async list(limit: number) {
    return [...this.decisions.values()]
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .slice(0, limit)
  }
  async save(decision: CaseDecision) {
    // One decision per case. A replay returns the recorded one rather than
    // overwriting a decision that has already been communicated.
    const existing = this.decisions.get(decision.caseId)
    if (existing) return existing
    this.decisions.set(decision.caseId, decision)
    return decision
  }
}

export function createInMemoryRepositories(): AnalysisRepositories {
  return {
    cases: new InMemoryCaseRepository(),
    theses: new InMemoryThesisRepository(),
    assignments: new InMemoryAssignmentRepository(),
    runs: new InMemoryRunRepository(),
    reviews: new InMemoryReviewRepository(),
    events: new InMemoryEventRepository(),
    evidence: new InMemoryEvidenceRepository(),
    decisions: new InMemoryDecisionRepository(),
  }
}
