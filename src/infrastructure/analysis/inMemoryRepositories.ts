/**
 * In-memory repository adapters.
 *
 * **Process-local. A restart loses every case, thesis, run, review and
 * decision.** Acceptable for a deterministic runtime prototype with no live
 * agents; not acceptable for real analysis, user-owned work or production.
 * Durable storage is a hard gate before Phase C.
 *
 * After the durable cutover this adapter stays, in two roles: the fast unit-test
 * store, and the **reference implementation of the transaction and ordering
 * semantics** the PostgreSQL adapter must match. Read verification compares the
 * two, so anything sloppy here becomes a false divergence there.
 *
 * Three behaviours are therefore implemented carefully rather than incidentally:
 *
 * **Transactions.** `withTransaction` snapshots every store, runs the callback
 * against scoped repositories, and restores the snapshot if anything throws.
 * Scoped repositories are invalidated when the callback resolves, so one
 * captured and called later fails loudly instead of writing outside its
 * transaction.
 *
 * **Deterministic ordering.** Every list method sorts explicitly, ending in a
 * unique tie-breaker. Insertion order is never relied on — PostgreSQL will not
 * reproduce it.
 *
 * **Idempotency.** Creates return the stored record, event append dedupes on
 * id, reviews dedupe on their natural key, results and decisions are
 * write-once.
 */

import {
  DOMAIN_CONTRACT_VERSION,
  playbookAssignmentIdentity,
  reviewIdentity,
  type AgentClaim,
  type AgentRunRecord,
  type Assignment,
  type CaseDecision,
  type CaseTransition,
  type ComplianceReview,
  type DevilsAdvocateReview,
  type EvidenceSet,
  type InvestmentCase,
  type InvestmentThesis,
  type RunEvent,
  type ReviewAttribution,
  type ReviewScope,
  type RiskReview,
  type TransitionEvent,
  type VerificationReview,
} from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  ConflictingRecordError,
  DuplicateRecordError,
  MalformedRowError,
  TransactionClosedError,
  type AnalysisRepositories,
  type AssignmentRepository,
  type CaseRepository,
  type ClaimRepository,
  type DecisionRepository,
  type EventRepository,
  type EvidenceRepository,
  type IdempotencyRecord,
  type IdempotencyStore,
  type ReviewRepository,
  type RunRepository,
  type ThesisRepository,
  type TransactionalAnalysisRepositories,
} from '~/application/analysis/repositories'
import type { ResultStore, StoredResult } from '~/application/analysis/resultStore'
import {
  claimSemanticKey,
  decisionSemanticKey,
  evidenceSetSemanticKey,
  resultSemanticKey,
  runEventIdentity,
  runEventSemanticKey,
  transitionEventSemanticKey,
} from '~/application/analysis/writeOnce'
import { seal } from './seal'

/* ------------------------------------------------------------------- state */

/**
 * All mutable state in one object, so a transaction can snapshot and restore it
 * without every repository knowing it is inside one.
 */
interface Store {
  cases: Map<string, InvestmentCase>
  theses: Map<string, InvestmentThesis>
  assignments: Map<string, Assignment>
  runs: Map<string, AgentRunRecord>
  runEvents: RunEvent[]
  claims: Map<string, { claim: AgentClaim; caseId: string; runId: string }>
  verifications: VerificationReview[]
  challenges: DevilsAdvocateReview[]
  compliance: ComplianceReview[]
  risk: RiskReview[]
  events: TransitionEvent[]
  evidence: Map<string, EvidenceSet>
  decisions: Map<string, CaseDecision>
  results: Map<string, StoredResult>
  idempotency: Map<string, IdempotencyRecord>
}

function emptyStore(): Store {
  return {
    cases: new Map(),
    theses: new Map(),
    assignments: new Map(),
    runs: new Map(),
    runEvents: [],
    claims: new Map(),
    verifications: [],
    challenges: [],
    compliance: [],
    risk: [],
    events: [],
    evidence: new Map(),
    decisions: new Map(),
    results: new Map(),
    idempotency: new Map(),
  }
}

/**
 * Shallow copy of every collection.
 *
 * Shallow is sufficient because a stored value cannot be mutated in place, only
 * replaced — so restoring the collections restores the state exactly.
 *
 * That is an enforced property rather than a hoped-for one: every write goes
 * through `seal`, which deep-freezes what it stores and refuses anything it
 * cannot make immutable. The domain builders freeze only their top level, so
 * relying on them here would have left the rollback resting on a convention
 * future domain code could break silently. See `seal.ts`.
 */
function snapshot(store: Store): Store {
  return {
    cases: new Map(store.cases),
    theses: new Map(store.theses),
    assignments: new Map(store.assignments),
    runs: new Map(store.runs),
    runEvents: [...store.runEvents],
    claims: new Map(store.claims),
    verifications: [...store.verifications],
    challenges: [...store.challenges],
    compliance: [...store.compliance],
    risk: [...store.risk],
    events: [...store.events],
    evidence: new Map(store.evidence),
    decisions: new Map(store.decisions),
    results: new Map(store.results),
    idempotency: new Map(store.idempotency),
  }
}

function restore(target: Store, from: Store): void {
  target.cases = from.cases
  target.theses = from.theses
  target.assignments = from.assignments
  target.runs = from.runs
  target.runEvents = from.runEvents
  target.claims = from.claims
  target.verifications = from.verifications
  target.challenges = from.challenges
  target.compliance = from.compliance
  target.risk = from.risk
  target.events = from.events
  target.evidence = from.evidence
  target.decisions = from.decisions
  target.results = from.results
  target.idempotency = from.idempotency
}

/** A transaction's liveness, shared by every repository scoped to it. */
interface Scope {
  open: boolean
}

const ALWAYS_OPEN: Scope = { open: true }

function guard(scope: Scope, operation: string): void {
  if (!scope.open) throw new TransactionClosedError(operation)
}

/* ------------------------------------------------------------ orderings */

/**
 * Byte order, not locale order.
 *
 * `localeCompare` sorts by the runtime's collation; PostgreSQL sorts by the
 * database's. They disagree on non-ASCII — `å` sorts after `z` in Swedish and
 * between `a` and `b` elsewhere — and the two stores are compared against each
 * other in stage 4.
 *
 * Every ordering column in the adapter carries `COLLATE "C"`, and this is the
 * matching comparator. Ids are kebab-case ASCII today, so this changes nothing
 * observable; it removes a class of environment-dependent divergence that
 * would otherwise be found late and diagnosed slowly.
 */
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/* ------------------------------------------------------- repository builders */

/**
 * `transitions` is a PROJECTION of the event log, not stored on the case.
 *
 * Migration 0003 made the same call for the same reason: two copies of one
 * history are two things that can disagree, and the event log is the one with
 * append-only permissions behind it. Storing the array verbatim here would
 * also have been an in-memory-only behaviour — PostgreSQL derives it, so a
 * case written with transitions and no events would round-trip differently in
 * the two stores, and stage 4 would report a divergence that is really a
 * modelling mistake.
 *
 * A case's movement history is therefore written through `events.append`.
 */
function projectTransitions(store: Store, caseId: string): CaseTransition[] {
  return store.events
    .filter(
      (event) =>
        event.subject === 'case' &&
        event.caseId === caseId &&
        // A creation event has no previous state, so it is not a MOVEMENT.
        // `CaseTransition.from` is required, and inventing one to fill it would
        // put a stage the case was never in into its history.
        event.fromState !== null,
    )
    .sort(
      (a, b) => byString(a.occurredAt, b.occurredAt) || byString(a.eventId, b.eventId),
    )
    .map((event) => {
      if (!event.actorEmployeeId || !event.actorDepartmentId) {
        /*
         * Refused rather than filled with an empty string. A department acts
         * through a person, and an empty employee id reads as an employee.
         * Migration 0012 enforces this at write time; this is the read half.
         */
        throw new MalformedRowError(
          'case transition',
          `event "${event.eventId}" moves the case but names no actor`,
          'cases.get',
        )
      }
      return Object.freeze({
        caseId: event.caseId,
        from: event.fromState as CaseTransition['from'],
        to: event.toState as CaseTransition['to'],
        at: event.occurredAt,
        byEmployeeId: event.actorEmployeeId,
        byDepartmentId: event.actorDepartmentId,
        ...(event.reason ? { reason: event.reason } : {}),
      })
    })
}

function withTransitions(store: Store, investmentCase: InvestmentCase): InvestmentCase {
  return Object.freeze({
    ...investmentCase,
    transitions: Object.freeze(projectTransitions(store, investmentCase.id)),
  })
}

function caseRepository(store: Store, scope: Scope): CaseRepository {
  return {
    async get(caseId) {
      guard(scope, 'cases.get')
      const stored = store.cases.get(caseId)
      return stored ? withTransitions(store, stored) : null
    },
    async list() {
      guard(scope, 'cases.list')
      return [...store.cases.values()]
        .sort((a, b) => byString(b.openedAt, a.openedAt) || byString(a.id, b.id))
        .map((investmentCase) => withTransitions(store, investmentCase))
    },
    async create(investmentCase) {
      guard(scope, 'cases.create')
      seal(investmentCase, 'cases')
      const existing = store.cases.get(investmentCase.id)
      if (existing) return existing
      store.cases.set(investmentCase.id, investmentCase)
      return investmentCase
    },
    async save(investmentCase, expectedVersion) {
      guard(scope, 'cases.save')
      seal(investmentCase, 'cases')
      const stored = store.cases.get(investmentCase.id)
      if (stored && stored.version !== expectedVersion) {
        throw new ConcurrencyConflictError(
          investmentCase.id,
          expectedVersion,
          stored.version,
        )
      }
      store.cases.set(investmentCase.id, investmentCase)
      return investmentCase
    },
  }
}

function thesisRepository(store: Store, scope: Scope): ThesisRepository {
  return {
    async get(revisionId) {
      guard(scope, 'theses.get')
      return store.theses.get(revisionId) ?? null
    },
    async listForCase(caseId) {
      guard(scope, 'theses.listForCase')
      return [...store.theses.values()]
        .filter((r) => r.caseId === caseId)
        .sort(
          (a, b) =>
            byString(a.thesisId, b.thesisId) || a.revisionNumber - b.revisionNumber,
        )
    },
    async save(revision) {
      guard(scope, 'theses.save')
      seal(revision, 'theses')
      /*
       * A sealed revision is never rewritten. Marking one superseded IS a
       * legitimate write to an old record, so only the lifecycle may move.
       */
      const existing = store.theses.get(revision.revisionId)
      if (existing) {
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
      store.theses.set(revision.revisionId, revision)
      return revision
    },
  }
}

const byAssignment = (a: Assignment, b: Assignment) =>
  b.priority - a.priority || byString(a.createdAt, b.createdAt) || byString(a.id, b.id)

function assignmentRepository(store: Store, scope: Scope): AssignmentRepository {
  return {
    async get(id) {
      guard(scope, 'assignments.get')
      return store.assignments.get(id) ?? null
    },
    async listForCase(caseId) {
      guard(scope, 'assignments.listForCase')
      return [...store.assignments.values()]
        .filter((a) => a.caseId === caseId)
        .sort(byAssignment)
    },
    async listForDepartment(departmentId) {
      guard(scope, 'assignments.listForDepartment')
      return [...store.assignments.values()]
        .filter((a) => a.departmentId === departmentId)
        .sort(byAssignment)
    },
    async save(assignment) {
      guard(scope, 'assignments.save')
      seal(assignment, 'assignments')

      /*
       * One assignment per case per playbook entry. A retried open-case command
       * must not give a department the same work twice — and until
       * `playbookEntryKey` existed on the domain type the unique index in the
       * schema could never fire, so this rule was enforced nowhere at all.
       *
       * Ad-hoc assignments carry no key, and several on one case are fine.
       */
      const identity = playbookAssignmentIdentity(assignment)
      if (identity) {
        const clash = [...store.assignments.values()].find(
          (candidate) =>
            candidate.id !== assignment.id &&
            playbookAssignmentIdentity(candidate) === identity,
        )
        if (clash) {
          throw new DuplicateRecordError(
            'assignments_case_playbook_entry_unique',
            'assignments.save',
          )
        }
      }

      store.assignments.set(assignment.id, assignment)
      return assignment
    },
  }
}

/**
 * `claims` is hydrated from the claim store, not read off the run record.
 *
 * Claims live in their own repository because they are cited, contested and
 * verified individually. Returning the array the run was saved with would make
 * this store the only one where a claim written through `claims.save` is
 * invisible on its run — PostgreSQL joins them back, so the two would disagree
 * on the same aggregate.
 */
function hydrateRun(store: Store, record: AgentRunRecord): AgentRunRecord {
  return Object.freeze({
    ...record,
    /*
     * Both collections come from their own stores rather than off the record.
     * Claims live in their own repository; run events are append-only, so a
     * later save carrying fewer of them does not erase what was recorded.
     * Returning the record's own arrays would make this the only store where
     * that erasure is possible.
     */
    events: Object.freeze(
      store.runEvents
        .filter((event) => event.runId === record.id)
        .sort((a, b) => byString(a.at, b.at) || byString(a.state, b.state)),
    ),
    claims: Object.freeze(
      [...store.claims.values()]
        .filter((entry) => entry.runId === record.id)
        .map((entry) => entry.claim)
        .sort((a, b) => byString(a.id, b.id)),
    ),
  })
}

function runRepository(store: Store, scope: Scope): RunRepository {
  return {
    async get(id) {
      guard(scope, 'runs.get')
      const stored = store.runs.get(id)
      return stored ? hydrateRun(store, stored) : null
    },
    async listForCase(caseId) {
      guard(scope, 'runs.listForCase')
      return [...store.runs.values()]
        .filter((r) => r.caseId === caseId)
        .sort((a, b) => byString(a.startedAt, b.startedAt) || byString(a.id, b.id))
        .map((record) => hydrateRun(store, record))
    },
    async save(record) {
      guard(scope, 'runs.save')
      seal(record, 'runs')
      store.runs.set(record.id, record)

      for (const event of record.events) {
        const identity = runEventIdentity(event)
        const existing = store.runEvents.find(
          (candidate) => runEventIdentity(candidate) === identity,
        )
        if (existing) {
          // Same instant, same state, a different reason: a disagreement about
          // what happened rather than a retry of the same write.
          if (runEventSemanticKey(existing) !== runEventSemanticKey(event)) {
            throw new ConflictingRecordError('Run event', identity, 'runs.save')
          }
          continue
        }
        store.runEvents.push(event)
      }
      return hydrateRun(store, record)
    },
  }
}

function claimRepository(store: Store, scope: Scope): ClaimRepository {
  return {
    async get(claimId) {
      guard(scope, 'claims.get')
      return store.claims.get(claimId)?.claim ?? null
    },
    async listForRun(runId) {
      guard(scope, 'claims.listForRun')
      return [...store.claims.values()]
        .filter((entry) => entry.runId === runId)
        .map((entry) => entry.claim)
        .sort((a, b) => byString(a.id, b.id))
    },
    async listForCase(caseId) {
      guard(scope, 'claims.listForCase')
      return [...store.claims.values()]
        .filter((entry) => entry.caseId === caseId)
        .map((entry) => entry.claim)
        .sort((a, b) => byString(a.id, b.id))
    },
    async save(claim, caseId, runId) {
      guard(scope, 'claims.save')
      seal(claim, 'claims')
      // Write-once: a claim that has been cited must not change underneath it.
      const existing = store.claims.get(claim.id)
      if (existing) {
        if (claimSemanticKey(existing.claim) !== claimSemanticKey(claim)) {
          throw new ConflictingRecordError('Claim', claim.id, 'claims.save')
        }
        return existing.claim
      }
      store.claims.set(claim.id, { claim, caseId, runId })
      return claim
    },
  }
}

/**
 * Reviews dedupe on their natural key, so a replayed submission does not
 * double-count in the gate.
 *
 * The key comes from `reviewIdentity` in the domain rather than being spelled
 * out here, because PostgreSQL's unique index mirrors the same definition. Two
 * stores that dedupe *approximately* the same way would diverge exactly where
 * it matters least visibly — and the key includes the full scope, so a retry
 * cannot collide with a review of a different revision.
 */
const sameReview = (
  kind: Parameters<typeof reviewIdentity>[0],
  a: ReviewScope & ReviewAttribution,
  b: ReviewScope & ReviewAttribution,
) => reviewIdentity(kind, a) === reviewIdentity(kind, b)

/**
 * `at`, then `byEmployeeId`, then `revisionId`.
 *
 * The revision is the final tie-break because one reviewer can record verdicts
 * on two competing revisions at the same instant. Case-wide reviews sort as
 * the empty string, which places them first among ties — a fixed position
 * rather than an arbitrary one.
 */
const byReview = <T extends ReviewScope & ReviewAttribution>(a: T, b: T) =>
  byString(a.at, b.at) ||
  byString(a.byEmployeeId, b.byEmployeeId) ||
  byString(
    a.scope === 'thesis-revision' ? a.revisionId : '',
    b.scope === 'thesis-revision' ? b.revisionId : '',
  )

function reviewRepository(store: Store, scope: Scope): ReviewRepository {
  const list = <T extends ReviewScope & ReviewAttribution>(
    all: T[],
    caseId: string,
    operation: string,
  ) => {
    guard(scope, operation)
    return all.filter((r) => r.caseId === caseId).sort(byReview)
  }

  return {
    async verificationsForCase(caseId) {
      return list(store.verifications, caseId, 'reviews.verificationsForCase')
    },
    async challengesForCase(caseId) {
      return list(store.challenges, caseId, 'reviews.challengesForCase')
    },
    async complianceForCase(caseId) {
      return list(store.compliance, caseId, 'reviews.complianceForCase')
    },
    async riskForCase(caseId) {
      return list(store.risk, caseId, 'reviews.riskForCase')
    },
    async saveVerification(review) {
      guard(scope, 'reviews.saveVerification')
      seal(review, 'reviews.verification')
      if (!store.verifications.some((r) => sameReview('verification', r, review))) {
        store.verifications.push(review)
      }
    },
    async saveDevilsAdvocate(review) {
      guard(scope, 'reviews.saveDevilsAdvocate')
      seal(review, 'reviews.devilsAdvocate')
      if (!store.challenges.some((r) => sameReview('devils-advocate', r, review))) {
        store.challenges.push(review)
      }
    },
    async saveCompliance(review) {
      guard(scope, 'reviews.saveCompliance')
      seal(review, 'reviews.compliance')
      if (!store.compliance.some((r) => sameReview('compliance', r, review))) {
        store.compliance.push(review)
      }
    },
    async saveRisk(review) {
      guard(scope, 'reviews.saveRisk')
      seal(review, 'reviews.risk')
      if (!store.risk.some((r) => sameReview('risk', r, review))) store.risk.push(review)
    },
  }
}

function eventRepository(store: Store, scope: Scope): EventRepository {
  return {
    async append(event) {
      guard(scope, 'events.append')
      seal(event, 'events')
      const existing = store.events.find((e) => e.eventId === event.eventId)
      if (existing) {
        // Append-only: the same id carrying different facts is a rewrite of
        // history attempted through the one door meant to refuse it.
        if (transitionEventSemanticKey(existing) !== transitionEventSemanticKey(event)) {
          throw new ConflictingRecordError(
            'Transition event',
            event.eventId,
            'events.append',
          )
        }
        return
      }
      store.events.push(event)
    },
    async listForCase(caseId) {
      guard(scope, 'events.listForCase')
      return store.events
        .filter((e) => e.caseId === caseId)
        .sort(
          (a, b) =>
            byString(a.occurredAt, b.occurredAt) || byString(a.eventId, b.eventId),
        )
    },
    async recent(limit) {
      guard(scope, 'events.recent')
      return [...store.events]
        .sort(
          (a, b) =>
            byString(b.occurredAt, a.occurredAt) || byString(b.eventId, a.eventId),
        )
        .slice(0, limit)
    },
  }
}

function evidenceRepository(store: Store, scope: Scope): EvidenceRepository {
  return {
    async get(setId) {
      guard(scope, 'evidence.get')
      return store.evidence.get(setId) ?? null
    },
    async save(set) {
      guard(scope, 'evidence.save')
      seal(set, 'evidence')
      // Content-addressed and immutable: an existing id already holds this
      // exact content, so a re-save is a no-op rather than a conflict.
      const existing = store.evidence.get(set.id)
      if (existing) {
        /*
         * The id hashes the set's COMPOSITION, not its payloads, so two sets
         * can share an id and hold different values. Comparing the payloads is
         * what makes that detectable on the write path.
         */
        if (evidenceSetSemanticKey(existing) !== evidenceSetSemanticKey(set)) {
          throw new ConflictingRecordError('Evidence set', set.id, 'evidence.save')
        }
        return existing
      }
      store.evidence.set(set.id, set)
      return set
    },
  }
}

function decisionRepository(store: Store, scope: Scope): DecisionRepository {
  return {
    async getForCase(caseId) {
      guard(scope, 'decisions.getForCase')
      return store.decisions.get(caseId) ?? null
    },
    async list(limit) {
      guard(scope, 'decisions.list')
      return [...store.decisions.values()]
        .sort(
          (a, b) => byString(b.decidedAt, a.decidedAt) || byString(a.caseId, b.caseId),
        )
        .slice(0, limit)
    },
    async save(decision) {
      guard(scope, 'decisions.save')
      seal(decision, 'decisions')
      // One per case, and immutable once committed. A correction appends a new
      // superseding decision rather than rewriting a communicated one.
      const existing = store.decisions.get(decision.caseId)
      if (existing) {
        if (decisionSemanticKey(existing) !== decisionSemanticKey(decision)) {
          throw new ConflictingRecordError(
            'Case decision',
            decision.caseId,
            'decisions.save',
          )
        }
        return existing
      }
      store.decisions.set(decision.caseId, decision)
      return decision
    },
  }
}

function resultStore(store: Store, scope: Scope): ResultStore {
  return {
    async get(key) {
      guard(scope, 'results.get')
      return store.results.get(key) ?? null
    },
    async put(result) {
      guard(scope, 'results.put')
      seal(result, 'results')
      // Write-once. The key covers every semantic input, so a differing result
      // under the same key means something is wrong; overwriting would hide it.
      const existing = store.results.get(result.key)
      if (existing) {
        if (resultSemanticKey(existing) !== resultSemanticKey(result)) {
          throw new ConflictingRecordError('Agent result', result.key, 'results.put')
        }
        return existing
      }
      store.results.set(result.key, result)
      return result
    },
  }
}

function idempotencyStore(store: Store, scope: Scope): IdempotencyStore {
  return {
    async get(key) {
      guard(scope, 'idempotency.get')
      return store.idempotency.get(key) ?? null
    },
    async reserve(record) {
      guard(scope, 'idempotency.reserve')
      seal(record, 'idempotency')
      // A held key returns its original record, which is how a replay returns
      // the first result instead of producing a second effect.
      const existing = store.idempotency.get(record.key)
      if (existing) return existing
      store.idempotency.set(record.key, record)
      return record
    },
  }
}

function repositoriesFor(store: Store, scope: Scope): TransactionalAnalysisRepositories {
  return {
    cases: caseRepository(store, scope),
    theses: thesisRepository(store, scope),
    assignments: assignmentRepository(store, scope),
    runs: runRepository(store, scope),
    claims: claimRepository(store, scope),
    reviews: reviewRepository(store, scope),
    events: eventRepository(store, scope),
    evidence: evidenceRepository(store, scope),
    decisions: decisionRepository(store, scope),
    results: resultStore(store, scope),
    idempotency: idempotencyStore(store, scope),
  }
}

/**
 * Bumped when this adapter's observable behaviour changes.
 *
 * History:
 *   1  stage 0 — transactions, deterministic ordering
 *   2  stage 1.5 — reviews dedupe on the full scope
 */
const ADAPTER_VERSION = '2'

export function createInMemoryRepositories(): AnalysisRepositories {
  const store = emptyStore()

  return {
    ...repositoriesFor(store, ALWAYS_OPEN),

    async provenance() {
      /*
       * Null rather than a placeholder for the SQL and schema coordinates.
       * This store issues no statements and has no migration history, and
       * inventing values for them would make a provenance record claim a
       * lineage that does not exist.
       */
      return {
        adapterId: 'in-memory',
        adapterVersion: ADAPTER_VERSION,
        queryCatalogHash: null,
        schemaVersion: null,
        schemaChecksum: null,
        domainContractVersion: DOMAIN_CONTRACT_VERSION,
      }
    },

    async withTransaction(operation) {
      const before = snapshot(store)
      const scope: Scope = { open: true }

      try {
        const result = await operation(repositoriesFor(store, scope))
        /*
         * Closed only after the callback resolves, and before returning. A
         * repository captured inside and called later hits `TransactionClosedError`
         * rather than writing outside the transaction it thought it was in.
         */
        scope.open = false
        return result
      } catch (error) {
        scope.open = false
        restore(store, before)
        throw error
      }
    },
  }
}
