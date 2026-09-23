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
  accountableReviewer,
  DOMAIN_CONTRACT_VERSION,
  playbookAssignmentIdentity,
  reviewIdentity,
  subjectKey,
  validateReturnReferences,
  validateSubmissionReferences,
  validateCaseDecision,
  validateCaseReconsideration,
  validateCioReturn,
  validateCioSubmission,
  type ReviewOrder,
  type AgentClaim,
  type AgentRunRecord,
  type Assignment,
  type CaseDecision,
  type CaseTransition,
  type ReferencedGovernance,
  type ReferencedSubjects,
  type CaseReconsideration,
  type CioReturn,
  type CioSubmission,
  type ComplianceReview,
  type DevilsAdvocateReview,
  type PeerExaminationReview,
  sameAssemblyAct,
  type DurableObservation,
  type EvidenceAssembly,
  type EvidenceSet,
  type CaseAmendment,
  type InvestmentCase,
  type InvestmentThesis,
  isRunTerminal,
  type ManagerAggregation,
  type ProducedSynthesis,
  type ProducedVerificationReview,
  type ProducedDevilsAdvocateReview,
  type ProducedPeerExamination,
  type RequirementResolution,
  type RunEvent,
  type ReviewAttribution,
  type ReviewScope,
  type RiskReview,
  type TransitionEvent,
  type VerificationReview,
} from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  ImmutableRecordError,
  InvariantViolationError,
  ReferentialIntegrityError,
  type DecisionRepository,
  type SubmissionRepository,
  ConflictingRecordError,
  DuplicateRecordError,
  MalformedRowError,
  TransactionClosedError,
  type AggregationRepository,
  type AnalysisRepositories,
  type AssignmentRepository,
  type CaseAmendmentRepository,
  type CaseRepository,
  type ClaimRepository,
  type ProducedClaimRepository,
  type ProducedSynthesisRepository,
  type EventRepository,
  type EvidenceRepository,
  type EvidenceAssemblyRepository,
  type ObservationRepository,
  type PlaybookRepository,
  type RequirementRepository,
  type ReviewRepository,
  type RunRepository,
  type ThesisRepository,
  type TransactionalAnalysisRepositories,
} from '~/application/analysis/repositories'
import type { ResultStore, StoredResult } from '~/application/analysis/resultStore'
import {
  CommandPayloadConflictError,
  type CommandIntent,
  type CommandLog,
  type CommandOutcome,
} from '~/application/analysis/commandLog'
import {
  caseReconsiderationSemanticKey,
  cioReturnSemanticKey,
  cioSubmissionSemanticKey,
  claimSemanticKey,
  decisionSemanticKey,
  evidenceSetSemanticKey,
  managerAggregationSemanticKey,
  producedClaimsSemanticKey,
  requirementResolutionIdentity,
  requirementResolutionSemanticKey,
  resultSemanticKey,
  runEventIdentity,
  runEventSemanticKey,
  transitionEventSemanticKey,
} from '~/application/analysis/writeOnce'
import { playbookContentHash, type CasePlaybook } from '~/application/analysis/playbooks'
import { COMMAND_CONTRACT_VERSION } from '~/application/analysis/commands/envelope'
import { seal } from './seal'

/* ------------------------------------------------------------------- state */

/**
 * All mutable state in one object, so a transaction can snapshot and restore it
 * without every repository knowing it is inside one.
 */
interface Store {
  cases: Map<string, InvestmentCase>
  /** What the person added after opening. Append-only, like the events. */
  amendments: Map<string, CaseAmendment>
  theses: Map<string, InvestmentThesis>
  assignments: Map<string, Assignment>
  runs: Map<string, AgentRunRecord>
  runEvents: RunEvent[]
  claims: Map<string, { claim: AgentClaim; caseId: string; runId: string }>
  producedClaims: Map<string, { caseId: string; claims: readonly AgentClaim[] }>
  /** Keyed on the producing run. One run, one synthesis. */
  producedSyntheses: Map<string, ProducedSynthesis>
  /*
   * Unfiled governance control acts, three stores for the reason the ports
   * state: the invariants differ, and one store could hold all three only by
   * dropping them. Keyed on the producing run — one run, one candidate.
   */
  producedVerifications: Map<string, ProducedVerificationReview>
  producedChallenges: Map<string, ProducedDevilsAdvocateReview>
  producedPeerExaminations: Map<string, ProducedPeerExamination>
  verifications: VerificationReview[]
  challenges: DevilsAdvocateReview[]
  /* Kept apart from `challenges` for the reason the port states: a peer
   * examination that raised nothing is a record, and merging the two lists
   * would erase it. */
  peerExaminations: PeerExaminationReview[]
  compliance: ComplianceReview[]
  risk: RiskReview[]
  events: TransitionEvent[]
  evidence: Map<string, EvidenceSet>
  /** Keyed `${observationId}|${contentHash}`: a revision is a second entry. */
  observations: Map<string, DurableObservation>
  /** Keyed on the act, not on the set. See `domain/analysis/evidenceAssembly`. */
  assemblies: Map<string, EvidenceAssembly>
  results: Map<string, StoredResult>
  commands: Map<string, { intent: CommandIntent; outcomes: CommandOutcome[] }>
  playbooks: Map<string, CasePlaybook>
  requirements: Map<string, RequirementResolution>
  aggregations: Map<string, ManagerAggregation>
  submissions: Map<string, CioSubmission>
  returns: Map<string, CioReturn>
  reconsiderations: Map<string, CaseReconsideration>
  decisions: Map<string, CaseDecision>
  /**
   * Which decision superseded which.
   *
   * Kept beside the decisions rather than on them because a decision does not
   * carry its own successor: it is set after the fact, by the correction, and a
   * field for it on the aggregate would be a mutable hole in an immutable
   * record. PostgreSQL stores it as the one updatable column on the row for
   * exactly the same reason.
   */
  supersededBy: Map<string, string>
}

function emptyStore(): Store {
  return {
    cases: new Map(),
    amendments: new Map(),
    theses: new Map(),
    assignments: new Map(),
    runs: new Map(),
    runEvents: [],
    claims: new Map(),
    producedClaims: new Map(),
    producedSyntheses: new Map(),
    producedVerifications: new Map(),
    producedChallenges: new Map(),
    producedPeerExaminations: new Map(),
    verifications: [],
    challenges: [],
    peerExaminations: [],
    compliance: [],
    risk: [],
    events: [],
    evidence: new Map(),
    observations: new Map(),
    assemblies: new Map(),
    results: new Map(),
    commands: new Map(),
    playbooks: new Map(),
    requirements: new Map(),
    aggregations: new Map(),
    submissions: new Map(),
    returns: new Map(),
    reconsiderations: new Map(),
    decisions: new Map(),
    supersededBy: new Map(),
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
    amendments: new Map(store.amendments),
    theses: new Map(store.theses),
    assignments: new Map(store.assignments),
    runs: new Map(store.runs),
    runEvents: [...store.runEvents],
    claims: new Map(store.claims),
    producedClaims: new Map(store.producedClaims),
    producedSyntheses: new Map(store.producedSyntheses),
    producedVerifications: new Map(store.producedVerifications),
    producedChallenges: new Map(store.producedChallenges),
    producedPeerExaminations: new Map(store.producedPeerExaminations),
    verifications: [...store.verifications],
    challenges: [...store.challenges],
    peerExaminations: [...store.peerExaminations],
    compliance: [...store.compliance],
    risk: [...store.risk],
    events: [...store.events],
    evidence: new Map(store.evidence),
    observations: new Map(store.observations),
    assemblies: new Map(store.assemblies),
    results: new Map(store.results),
    commands: new Map(store.commands),
    playbooks: new Map(store.playbooks),
    requirements: new Map(store.requirements),
    aggregations: new Map(store.aggregations),
    submissions: new Map(store.submissions),
    returns: new Map(store.returns),
    reconsiderations: new Map(store.reconsiderations),
    decisions: new Map(store.decisions),
    supersededBy: new Map(store.supersededBy),
  }
}

function restore(target: Store, from: Store): void {
  target.cases = from.cases
  target.amendments = from.amendments
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
  target.results = from.results
  target.commands = from.commands
  target.playbooks = from.playbooks
  target.requirements = from.requirements
  target.aggregations = from.aggregations
  target.submissions = from.submissions
  target.returns = from.returns
  target.decisions = from.decisions
  target.supersededBy = from.supersededBy
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
      if ((!event.actorEmployeeId && !event.actorAgentPrincipalId) || !event.actorDepartmentId) {
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
        byEmployeeId: event.actorEmployeeId ?? null,
        ...(event.actorAgentPrincipalId && !event.actorEmployeeId
          ? { byAgentPrincipalId: event.actorAgentPrincipalId }
          : {}),
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
      /*
       * Versions only advance — the PostgreSQL adapter's rule, held here too
       * since 2026-09-23: a submission that moved nothing saved an unchanged
       * case, this store accepted it, and the live record refused it (run 17).
       * Parity findings become shared rules, not one-store fixes.
       */
      if (stored && investmentCase.version <= stored.version) {
        throw new ImmutableRecordError(
          `Case "${investmentCase.id}" cannot move from version ${stored.version} to ${investmentCase.version} — versions only advance`,
          'cases.save',
        )
      }
      store.cases.set(investmentCase.id, investmentCase)
      return investmentCase
    },
  }
}

function amendmentRepository(store: Store, scope: Scope): CaseAmendmentRepository {
  return {
    async append(amendment) {
      guard(scope, 'amendments.append')
      seal(amendment, 'amendments')
      /* Idempotent on id, as `cases.create` is: a replay returns what was stored. */
      const existing = store.amendments.get(amendment.id)
      if (existing) return existing
      store.amendments.set(amendment.id, amendment)
      return amendment
    },
    async get(amendmentId) {
      guard(scope, 'amendments.get')
      return store.amendments.get(amendmentId) ?? null
    },
    async listForCase(caseId) {
      guard(scope, 'amendments.listForCase')
      return [...store.amendments.values()]
        .filter((amendment) => amendment.caseId === caseId)
        .sort((a, b) => byString(a.at, b.at) || byString(a.id, b.id))
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

      /*
       * At most one unsettled run per assignment, which PostgreSQL has enforced
       * with a partial unique index since migration 0015 and this store did
       * not. A second live run on one assignment is a department doing the same
       * piece of work twice.
       *
       * Terminal is the domain's `isRunTerminal`, so both stores draw the line
       * in the same place: a `rejected` run has settled and frees the slot for
       * another attempt, while an `awaiting-acceptance` one has not — somebody
       * still has to act on it.
       */
      if (!isRunTerminal(record.state)) {
        const active = [...store.runs.values()].find(
          (candidate) =>
            candidate.id !== record.id &&
            candidate.assignmentId === record.assignmentId &&
            !isRunTerminal(candidate.state),
        )
        if (active) {
          throw new ConflictingRecordError('Run', record.assignmentId, 'runs.save')
        }
      }

      /*
       * A re-save revises what happened, never what was authorized.
       *
       * PostgreSQL says this structurally: `RUN_SQL.save` lists only state,
       * obsolete, completion, failure, rejection and usage in its
       * `DO UPDATE SET`, so identity, provider, evidence and budget keep the
       * values they were written with — and migration 0028 grants no UPDATE on
       * the budget columns at all. This store replaced the whole record, so the
       * same second save silently rewrote what the firm had authorized.
       *
       * Surfaced by a shared contract case rather than fixed in one adapter:
       * neither store defines these semantics, the contract does.
       */
      const previous = store.runs.get(record.id)
      const stored = previous
        ? Object.freeze({
            ...record,
            budget: previous.budget,
            evidenceSetId: previous.evidenceSetId,
            startedAt: previous.startedAt,
            execution: previous.execution,
          })
        : record
      store.runs.set(record.id, stored)

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
      // What the store holds, not what the caller offered. PostgreSQL reads
      // the row back after writing for the same reason: a save must not report
      // a value the store declined to take.
      return hydrateRun(store, stored)
    },
  }
}

/**
 * Produced work, kept apart from the institutional record on purpose.
 *
 * See `ProducedClaimRepository`: the separation is what makes non-citability
 * structural rather than remembered.
 */
function producedClaimRepository(store: Store, scope: Scope): ProducedClaimRepository {
  return {
    async record(runId, caseId, claims) {
      guard(scope, 'producedClaims.record')
      if (claims.length === 0) {
        throw new InvariantViolationError(
          'produced-claims-empty',
          'producedClaims.record',
        )
      }
      const existing = store.producedClaims.get(runId)
      if (existing) {
        /*
         * One run produces one set. A second write with different content is a
         * disagreement about what the agent returned, not a retry — compared by
         * the shared rule so both adapters answer that identically.
         */
        if (
          producedClaimsSemanticKey(existing.claims) !== producedClaimsSemanticKey(claims)
        ) {
          throw new ConflictingRecordError(
            'Produced claims',
            runId,
            'producedClaims.record',
          )
        }
        return
      }
      store.producedClaims.set(runId, {
        caseId,
        claims: Object.freeze([...claims].map((claim) => seal(claim, 'producedClaims'))),
      })
    },

    async listForRun(runId) {
      guard(scope, 'producedClaims.listForRun')
      const found = store.producedClaims.get(runId)
      return found ? [...found.claims].sort((a, b) => byString(a.id, b.id)) : []
    },
  }
}

/**
 * The Research Office's unadopted synthesis, kept apart for the same reason.
 *
 * See `ProducedSynthesisRepository`. Model output is operational until an
 * accountable principal adopts it, and the separation is what stops a synthesis
 * reaching `thesis_revisions` without one.
 */
function producedSynthesisRepository(
  store: Store,
  scope: Scope,
): ProducedSynthesisRepository {
  return {
    async record(candidate) {
      guard(scope, 'producedSyntheses.record')
      const existing = store.producedSyntheses.get(candidate.runId)
      if (existing) {
        /*
         * One run produces one synthesis. The content hash already covers the
         * artifact AND the basis, so comparing it answers "is this the same
         * candidate" exactly — a retry matches, a second different synthesis
         * does not.
         */
        if (existing.contentHash !== candidate.contentHash) {
          throw new ConflictingRecordError(
            'Produced synthesis',
            candidate.runId,
            'producedSyntheses.record',
          )
        }
        return
      }
      store.producedSyntheses.set(candidate.runId, seal(candidate, 'producedSyntheses'))
    },

    async get(runId) {
      guard(scope, 'producedSyntheses.get')
      return store.producedSyntheses.get(runId) ?? null
    },
  }
}

/**
 * An unfiled governance candidate store.
 *
 * One factory for the three, because their BEHAVIOUR is genuinely identical —
 * record idempotently on the producing run, read back by it — and three copies
 * of that would be three chances for one of them to stop comparing the content
 * hash. What differs between the acts is their content and their invariants,
 * and those live in the domain builders and in the database constraints, which
 * is where the three are kept apart.
 */
function producedGovernanceRepository<T extends { runId: string; contentHash: string }>(
  candidates: Map<string, T>,
  scope: Scope,
  label: string,
): { record(candidate: T): Promise<void>; get(runId: string): Promise<T | null> } {
  return {
    async record(candidate) {
      guard(scope, `${label}.record`)
      const existing = candidates.get(candidate.runId)
      if (existing) {
        /*
         * One run produces one candidate. The content hash covers the artifact
         * AND the basis, so comparing it answers "is this the same candidate"
         * exactly — a retry matches, a second different verdict does not.
         */
        if (existing.contentHash !== candidate.contentHash) {
          throw new ConflictingRecordError(label, candidate.runId, `${label}.record`)
        }
        return
      }
      candidates.set(candidate.runId, seal(candidate, label))
    },

    async get(runId) {
      guard(scope, `${label}.get`)
      return candidates.get(runId) ?? null
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
 * `sequence`, then `at`, then `byEmployeeId`, then `revisionId`.
 *
 * Sequence leads because it is the only total order — `at` alone left two
 * verdicts recorded in the same millisecond in an arbitrary order. The revision
 * is the final tie-break because one reviewer can record verdicts on two
 * competing revisions at the same instant. Case-wide reviews sort as the empty
 * string, which places them first among ties: a fixed position rather than an
 * arbitrary one.
 */
const byReview = <T extends ReviewScope & ReviewAttribution & ReviewOrder>(a: T, b: T) =>
  a.sequence - b.sequence ||
  byString(a.at, b.at) ||
  /*
   * The accountable principal, whichever kind filed it. Ordering on the
   * employee alone would sort every agent-filed verdict as the same blank and
   * hand ties back to insertion order — the arbitrariness `sequence` exists to
   * remove.
   */
  byString(accountableReviewer(a), accountableReviewer(b)) ||
  byString(
    a.scope === 'thesis-revision' ? a.revisionId : '',
    b.scope === 'thesis-revision' ? b.revisionId : '',
  )

function reviewRepository(store: Store, scope: Scope): ReviewRepository {
  const list = <T extends ReviewScope & ReviewAttribution & ReviewOrder>(
    all: T[],
    caseId: string,
    operation: string,
  ) => {
    guard(scope, operation)
    return all.filter((r) => r.caseId === caseId).sort(byReview)
  }

  /** Mirrors the PostgreSQL adapter's `max(sequence) + 1` for one triple. */
  const allocated = (
    all: ReadonlyArray<ReviewScope & ReviewOrder>,
    caseId: string,
    revisionId: string,
  ) =>
    all
      .filter(
        (review) =>
          review.caseId === caseId &&
          review.scope === 'thesis-revision' &&
          review.revisionId === revisionId,
      )
      .reduce((highest, review) => Math.max(highest, review.sequence), 0) + 1

  return {
    async nextSequence({ caseId, revisionId, kind }) {
      guard(scope, 'reviews.nextSequence')
      const all =
        kind === 'verification'
          ? store.verifications
          : kind === 'devils-advocate'
            ? store.challenges
            : kind === 'peer-examination'
              ? store.peerExaminations
              : kind === 'compliance'
                ? store.compliance
                : store.risk
      return allocated(all, caseId, revisionId)
    },
    async get(reviewId) {
      guard(scope, 'reviews.get')
      return (
        [
          ...store.verifications,
          ...store.challenges,
          ...store.peerExaminations,
          ...store.compliance,
          ...store.risk,
        ].find((review) => review.reviewId === reviewId) ?? null
      )
    },
    async verificationsForCase(caseId) {
      return list(store.verifications, caseId, 'reviews.verificationsForCase')
    },
    async challengesForCase(caseId) {
      return list(store.challenges, caseId, 'reviews.challengesForCase')
    },
    async peerExaminationsForCase(caseId) {
      return list(store.peerExaminations, caseId, 'reviews.peerExaminationsForCase')
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
    async savePeerExamination(review) {
      guard(scope, 'reviews.savePeerExamination')
      seal(review, 'reviews.peerExamination')
      if (
        !store.peerExaminations.some((r) => sameReview('peer-examination', r, review))
      ) {
        store.peerExaminations.push(review)
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
    async list(limit) {
      guard(scope, 'evidence.list')
      /* Newest first, with the id as a total tie-break. Mirrors the SQL. */
      return [...store.evidence.values()]
        .sort(
          (a, b) =>
            b.assembledAt.localeCompare(a.assembledAt) ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        )
        .slice(0, limit)
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

/**
 * Durable observations, in memory.
 *
 * Keyed on `(observationId, contentHash)` exactly as the SQL primary key is, so
 * a revision is a second entry rather than a replacement here too. Nothing in
 * this repository can overwrite a stored version — the map key includes the
 * content, so a differing value simply cannot land on an existing entry.
 */
function observationRepository(store: Store, scope: Scope): ObservationRepository {
  const keyOf = (observationId: string, contentHash: string) =>
    `${observationId}|${contentHash}`

  /** Ascending by reference period, then content hash. Mirrors the SQL. */
  const byPeriod = (a: DurableObservation, b: DurableObservation) =>
    byString(a.ref.referencePeriod ?? '', b.ref.referencePeriod ?? '') ||
    byString(a.ref.contentHash, b.ref.contentHash)

  /**
   * Whether `candidate` is the version to report for its period.
   *
   * Later knowledge wins. The content hash is the tie-break rather than a
   * preference: two versions recorded in the same instant have no natural
   * order, and an arbitrary one would let the two adapters disagree about a
   * series — which is exactly what the parity suite exists to catch.
   */
  const supersedes = (candidate: DurableObservation, held: DurableObservation) =>
    candidate.recordedAt > held.recordedAt ||
    (candidate.recordedAt === held.recordedAt &&
      candidate.ref.contentHash > held.ref.contentHash)

  return {
    async record(observations) {
      guard(scope, 'observations.record')
      const recorded: DurableObservation[] = []
      for (const observation of observations) {
        const key = keyOf(observation.ref.id, observation.ref.contentHash)
        /*
         * Already held. The idempotency the ingestion act depends on: a re-poll
         * that finds nothing revised records nothing and reports nothing new,
         * which is a normal outcome rather than a failure.
         */
        if (store.observations.has(key)) continue
        seal(observation, 'observation')
        store.observations.set(key, observation)
        recorded.push(observation)
      }
      return recorded
    },

    async get(observationId, contentHash) {
      guard(scope, 'observations.get')
      return store.observations.get(keyOf(observationId, contentHash)) ?? null
    },

    async versions(observationId) {
      guard(scope, 'observations.versions')
      return [...store.observations.values()]
        .filter((observation) => observation.ref.id === observationId)
        .sort(
          (a, b) =>
            byString(a.recordedAt, b.recordedAt) ||
            byString(a.ref.contentHash, b.ref.contentHash),
        )
    },

    async series(query) {
      guard(scope, 'observations.series')
      const matching = [...store.observations.values()].filter((observation) => {
        const ref = observation.ref
        if (ref.subject !== query.subject) return false
        if (ref.kind !== query.kind) return false
        if (ref.sourceId !== query.sourceId) return false
        if (query.seriesId !== undefined && ref.seriesId !== query.seriesId) return false
        if (query.methodology !== undefined && ref.methodology !== query.methodology) {
          return false
        }
        const period = ref.referencePeriod
        /*
         * A v1 record describes no period, so it cannot be placed on a series
         * axis at all. Excluded rather than guessed at — see gate §0.1.
         */
        if (period === undefined) return false
        if (period < query.from || period > query.to) return false
        /* Learned after the moment being asked about: not yet known. */
        if (query.knownAt !== undefined && observation.recordedAt > query.knownAt) {
          return false
        }
        return true
      })

      /*
       * One record per reference period: the latest version the firm held at
       * `knownAt`, or the latest it holds now. Later knowledge wins, with the
       * content hash as the total tie-break so two versions recorded in the
       * same instant still order identically in both adapters.
       */
      const latest = new Map<string, DurableObservation>()
      for (const observation of matching) {
        const period = observation.ref.referencePeriod!
        const held = latest.get(period)
        if (!held || supersedes(observation, held)) latest.set(period, observation)
      }
      return [...latest.values()].sort(byPeriod)
    },
  }
}

/**
 * The assembly acts, in memory.
 *
 * Keyed on `assemblyId` exactly as the SQL primary key is. Write-once with a
 * content comparison, because two different acts under one command id is a real
 * disagreement rather than a retry — the same rule `results.put` follows.
 */
function assemblyRepository(store: Store, scope: Scope): EvidenceAssemblyRepository {
  /** Newest first, `assemblyId` descending as the total tie-break. */
  const newestFirst = (a: EvidenceAssembly, b: EvidenceAssembly) =>
    byString(b.assembledAt, a.assembledAt) || byString(b.assemblyId, a.assemblyId)

  return {
    async record(assembly, _provenance) {
      guard(scope, 'assemblies.record')
      const existing = store.assemblies.get(assembly.assemblyId)
      if (existing) {
        if (!sameAssemblyAct(existing, assembly)) {
          throw new ConflictingRecordError(
            'Evidence assembly',
            assembly.assemblyId,
            'assemblies.record',
            assembly.correlationId,
          )
        }
        return existing
      }
      seal(assembly, 'assemblies')
      store.assemblies.set(assembly.assemblyId, assembly)
      return assembly
    },

    async get(assemblyId) {
      guard(scope, 'assemblies.get')
      return store.assemblies.get(assemblyId) ?? null
    },

    async forSet(evidenceSetId) {
      guard(scope, 'assemblies.forSet')
      return [...store.assemblies.values()]
        .filter((assembly) => assembly.evidenceSetId === evidenceSetId)
        .sort(newestFirst)
    },

    async list(limit) {
      guard(scope, 'assemblies.list')
      return [...store.assemblies.values()].sort(newestFirst).slice(0, limit)
    },
  }
}

function resultStore(store: Store, scope: Scope): ResultStore {
  return {
    async get(key) {
      guard(scope, 'results.get')
      return store.results.get(key) ?? null
    },
    // Provenance is a PostgreSQL foreign key; this store has no rows to point
    // at, and inventing a table to hold one would be modelling the adapter.
    async put(result, _provenance) {
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

/**
 * The command ledger.
 *
 * Intent is immutable and outcomes are append-only, matching the schema: a
 * command that was unresolved and is later confirmed gains a second outcome
 * rather than having its first overwritten.
 *
 * The entry is stored as one frozen object per command, so a snapshot restore
 * puts back exactly the outcomes that existed at the time.
 */
function commandLog(store: Store, scope: Scope): CommandLog {
  return {
    async find(commandId) {
      guard(scope, 'commands.find')
      const entry = store.commands.get(commandId)
      return entry ? { intent: entry.intent, outcomes: [...entry.outcomes] } : null
    },

    async record(intent) {
      guard(scope, 'commands.record')
      seal(intent, 'commands')

      const existing = store.commands.get(intent.commandId)
      if (existing) {
        // One command id identifies one request. Reusing it for a different
        // payload is not a retry, and returning the earlier result would
        // answer a question nobody asked.
        if (existing.intent.payloadHash !== intent.payloadHash) {
          throw new CommandPayloadConflictError(
            intent.commandId,
            existing.intent.payloadHash,
            intent.payloadHash,
          )
        }
        return existing.intent
      }

      store.commands.set(intent.commandId, { intent, outcomes: [] })
      return intent
    },

    async appendOutcome(commandId, outcome) {
      guard(scope, 'commands.appendOutcome')
      seal(outcome, 'commands.outcome')

      const entry = store.commands.get(commandId)
      if (!entry) {
        throw new MalformedRowError(
          'command outcome',
          `no command "${commandId}" to append an outcome to`,
          'commands.appendOutcome',
        )
      }

      /*
       * Only `unresolved` may be followed by anything. A rejected command did
       * not happen, a failed one wrote nothing, a committed one has its
       * result — a later outcome would be a second answer to a settled
       * question.
       */
      const settled = entry.outcomes.find((candidate) => candidate.state !== 'unresolved')
      if (settled) {
        throw new ConflictingRecordError(
          `Command "${commandId}" is already ${settled.state}, which is terminal, and`,
          commandId,
          'commands.appendOutcome',
        )
      }

      store.commands.set(commandId, {
        intent: entry.intent,
        outcomes: [...entry.outcomes, outcome],
      })
    },
  }
}

/**
 * Registered playbook versions.
 *
 * Keyed on `(id, version)` and compared by content hash, so registering "v1"
 * twice with different entries conflicts rather than silently giving two cases
 * different workflows under one name.
 */
function playbookRepository(store: Store, scope: Scope): PlaybookRepository {
  const key = (id: string, version: string) => `${id}|${version}`

  return {
    async register(playbook) {
      guard(scope, 'playbooks.register')
      seal(playbook, 'playbooks')

      const existing = store.playbooks.get(key(playbook.id, playbook.version))
      if (existing) {
        if (playbookContentHash(existing) !== playbookContentHash(playbook)) {
          throw new ConflictingRecordError(
            'Playbook version',
            key(playbook.id, playbook.version),
            'playbooks.register',
          )
        }
        return existing
      }

      store.playbooks.set(key(playbook.id, playbook.version), playbook)
      return playbook
    },

    async get(playbookId, version) {
      guard(scope, 'playbooks.get')
      const found = store.playbooks.get(key(playbookId, version))
      if (!found) return null
      /*
       * Sorted into the order PostgreSQL returns — priority descending, then
       * key — and re-sealed. Sorting allocates a fresh array and a fresh
       * wrapper, and an unsealed one would breach the invariant that no
       * mutable structure reaches application code. The parity suite found
       * this rather than a reviewer.
       */
      return seal(
        {
          ...found,
          entries: [...found.entries].sort(
            (a, b) => b.priority - a.priority || byString(a.key, b.key),
          ),
        },
        'playbooks',
      )
    },
  }
}

/**
 * Recorded evaluations of conditional entries.
 *
 * Write-once on `(caseId, entryKey, revisionId)`. The semantic key excludes
 * `evaluatedAt`, so a replay of the same evaluation is a replay rather than a
 * disagreement — see `writeOnce.ts`.
 */
function requirementRepository(store: Store, scope: Scope): RequirementRepository {
  return {
    async save(resolution) {
      guard(scope, 'requirements.save')
      seal(resolution, 'requirements')

      const identity = requirementResolutionIdentity(resolution)
      const existing = store.requirements.get(identity)
      if (existing) {
        if (
          requirementResolutionSemanticKey(existing) !==
          requirementResolutionSemanticKey(resolution)
        ) {
          throw new ConflictingRecordError(
            'Requirement resolution',
            identity,
            'requirements.save',
          )
        }
        return existing
      }

      store.requirements.set(identity, resolution)
      return resolution
    },

    async listForCase(caseId) {
      guard(scope, 'requirements.listForCase')
      return [...store.requirements.values()]
        .filter((resolution) => resolution.caseId === caseId)
        .sort(
          (a, b) =>
            byString(a.playbookEntryKey, b.playbookEntryKey) ||
            byString(a.revisionId, b.revisionId),
        )
    },
  }
}

function repositoriesFor(store: Store, scope: Scope): TransactionalAnalysisRepositories {
  return {
    cases: caseRepository(store, scope),
    amendments: amendmentRepository(store, scope),
    theses: thesisRepository(store, scope),
    assignments: assignmentRepository(store, scope),
    runs: runRepository(store, scope),
    claims: claimRepository(store, scope),
    producedClaims: producedClaimRepository(store, scope),
    producedSyntheses: producedSynthesisRepository(store, scope),
    producedVerifications: producedGovernanceRepository(
      store.producedVerifications,
      scope,
      'producedVerifications',
    ),
    producedChallenges: producedGovernanceRepository(
      store.producedChallenges,
      scope,
      'producedChallenges',
    ),
    producedPeerExaminations: producedGovernanceRepository(
      store.producedPeerExaminations,
      scope,
      'producedPeerExaminations',
    ),
    reviews: reviewRepository(store, scope),
    events: eventRepository(store, scope),
    evidence: evidenceRepository(store, scope),
    observations: observationRepository(store, scope),
    assemblies: assemblyRepository(store, scope),
    results: resultStore(store, scope),
    commands: commandLog(store, scope),
    playbooks: playbookRepository(store, scope),
    requirements: requirementRepository(store, scope),
    aggregations: aggregationRepository(store, scope),
    submissions: submissionRepository(store, scope),
    decisions: decisionRepository(store, scope),
  }
}

/**
 * Manager aggregations.
 *
 * Write-once on `id`, which derives from the command — so a replay returns the
 * stored synthesis and a genuinely different one under the same id is a
 * disagreement rather than an overwrite.
 */
function aggregationRepository(store: Store, scope: Scope): AggregationRepository {
  return {
    async get(aggregationId) {
      guard(scope, 'aggregations.get')
      return store.aggregations.get(aggregationId) ?? null
    },

    async forRevision(revisionId) {
      guard(scope, 'aggregations.forRevision')
      return (
        [...store.aggregations.values()].find(
          (aggregation) => aggregation.producedRevisionId === revisionId,
        ) ?? null
      )
    },

    async listForCase(caseId) {
      guard(scope, 'aggregations.listForCase')
      return [...store.aggregations.values()]
        .filter((aggregation) => aggregation.caseId === caseId)
        .sort((a, b) => byString(a.aggregatedAt, b.aggregatedAt) || byString(a.id, b.id))
    },

    async save(aggregation, _provenance) {
      guard(scope, 'aggregations.save')
      seal(aggregation, 'aggregations')

      const existing = store.aggregations.get(aggregation.id)
      if (existing) {
        if (
          managerAggregationSemanticKey(existing) !==
          managerAggregationSemanticKey(aggregation)
        ) {
          throw new ConflictingRecordError(
            'Manager aggregation',
            aggregation.id,
            'aggregations.save',
          )
        }
        return existing
      }

      store.aggregations.set(aggregation.id, aggregation)
      return aggregation
    },
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
        provenanceId: `in-memory:${ADAPTER_VERSION}:${DOMAIN_CONTRACT_VERSION}:${COMMAND_CONTRACT_VERSION}`,
        adapterId: 'in-memory',
        adapterVersion: ADAPTER_VERSION,
        buildId: 'in-memory',
        queryCatalogHash: null,
        schemaVersion: null,
        schemaChecksum: null,
        domainContractVersion: DOMAIN_CONTRACT_VERSION,
        commandContractVersion: COMMAND_CONTRACT_VERSION,
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

/**
 * What the store knows about the artifacts a submission cites.
 *
 * Assembled from the maps this adapter already holds. PostgreSQL assembles the
 * same shape from joins; the RULE that consumes it is shared, which is the
 * point — a repository must not depend on every future caller getting the
 * reference ownership right, and it must not have its own opinion about it
 * either.
 */
function governanceFacts(store: Store): ReferencedGovernance {
  const reviews = new Map<
    string,
    {
      caseId: string
      revisionId: string | null
      kind: string
      challengeIds: readonly string[]
    }
  >()

  const record = (
    kind: string,
    list: ReadonlyArray<{
      reviewId: string
      caseId: string
      scope: string
      revisionId?: string
      challenges?: ReadonlyArray<{ id: string }>
    }>,
  ) => {
    for (const review of list) {
      reviews.set(review.reviewId, {
        caseId: review.caseId,
        // A case-wide review applies to every revision of its case; only a
        // revision-scoped one names an exact argument.
        revisionId:
          review.scope === 'thesis-revision' ? (review.revisionId ?? null) : null,
        kind,
        challengeIds: (review.challenges ?? []).map((challenge) => challenge.id),
      })
    }
  }

  record('verification', store.verifications as never)
  record('devils-advocate', store.challenges as never)
  record('compliance', store.compliance as never)
  record('risk', store.risk as never)

  return {
    reviews,
    aggregations: new Map(
      [...store.aggregations.values()].map((aggregation) => [
        aggregation.id,
        {
          caseId: aggregation.caseId,
          producedRevisionId: aggregation.producedRevisionId,
        },
      ]),
    ),
    runs: new Map(
      [...store.runs.values()].map((run) => [run.id, { caseId: run.caseId }]),
    ),
    claims: new Map(
      [...store.claims.values()].map((entry) => [
        entry.claim.id,
        { caseId: entry.caseId },
      ]),
    ),
  }
}

/**
 * The things a return's concerns can point at, and who owns them.
 *
 * One flat map keyed `kind:id`, because the concern already says which kind it
 * means and the ownership question is the same for all of them. Evidence sets
 * are absent deliberately: content-addressed, owned by no case.
 */
function returnSubjects(store: Store): ReferencedSubjects {
  const byKindAndId = new Map<string, { caseId: string; revisionId: string | null }>()

  const facts = governanceFacts(store)
  for (const [reviewId, review] of facts.reviews) {
    byKindAndId.set(subjectKey('review', reviewId), {
      caseId: review.caseId,
      revisionId: review.revisionId,
    })
    byKindAndId.set(subjectKey('finding', reviewId), {
      caseId: review.caseId,
      revisionId: review.revisionId,
    })
    for (const challengeId of review.challengeIds) {
      byKindAndId.set(subjectKey('challenge', challengeId), {
        caseId: review.caseId,
        revisionId: review.revisionId,
      })
    }
  }
  for (const [id, aggregation] of facts.aggregations) {
    byKindAndId.set(subjectKey('aggregation', id), {
      caseId: aggregation.caseId,
      revisionId: aggregation.producedRevisionId,
    })
  }
  for (const [id, claim] of facts.claims) {
    byKindAndId.set(subjectKey('claim', id), { caseId: claim.caseId, revisionId: null })
  }
  for (const revision of store.theses.values()) {
    byKindAndId.set(subjectKey('revision', revision.revisionId), {
      caseId: revision.caseId,
      revisionId: revision.revisionId,
    })
  }

  return { byKindAndId }
}

/* --------------------------------------------- CIO submissions and returns */

/**
 * Material entering CIO consideration, and material leaving it for more work.
 *
 * Write-once except for `state`, which is the one thing about a submission the
 * institution changes: it stops being a queue item when the CIO acts on it.
 */
function submissionRepository(store: Store, scope: Scope): SubmissionRepository {
  /**
   * A stored submission, re-checked on the way out.
   *
   * A reference that was valid when written can stop being valid — nothing in
   * this store prevents a review being replaced. Reading it back as a valid
   * submission would launder that into the record, so hydration refuses it the
   * same way the write did, and with the store's own error class.
   */
  const hydrated = (submission: CioSubmission, operation: string): CioSubmission => {
    const problems = validateSubmissionReferences(submission, governanceFacts(store))
    if (problems.length > 0) {
      throw new MalformedRowError('CIO submission', problems[0]!.code, operation)
    }
    return submission
  }

  const bySubmittedAt = (a: CioSubmission, b: CioSubmission) =>
    byString(a.submittedAt, b.submittedAt) || byString(a.id, b.id)

  const byReturnedAt = (a: CioReturn, b: CioReturn) =>
    byString(a.returnedAt, b.returnedAt) || byString(a.id, b.id)

  /**
   * A stored return, re-checked on the way out.
   *
   * Same reasoning as `hydrated` for submissions: a reference valid when
   * written can stop being valid, and reading it back as a valid return would
   * launder that into the record.
   */
  const hydratedReturn = (cioReturn: CioReturn, operation: string): CioReturn => {
    const problems = [
      ...validateCioReturn(cioReturn),
      ...validateReturnReferences(cioReturn, returnSubjects(store)),
    ]
    if (problems.length > 0) {
      throw new MalformedRowError('CIO return', problems[0]!.code, operation)
    }
    return cioReturn
  }

  return {
    async get(submissionId) {
      guard(scope, 'submissions.get')
      const stored = store.submissions.get(submissionId)
      return stored ? hydrated(stored, 'submissions.get') : null
    },

    async listForCase(caseId) {
      guard(scope, 'submissions.listForCase')
      return [...store.submissions.values()]
        .filter((submission) => submission.caseId === caseId)
        .sort(bySubmittedAt)
    },

    async applicableForRevision(revisionId) {
      guard(scope, 'submissions.applicableForRevision')
      return [...store.submissions.values()]
        .filter((submission) => submission.revisionId === revisionId)
        .sort(bySubmittedAt)
    },

    async pending(limit) {
      guard(scope, 'submissions.pending')
      const queue = [...store.submissions.values()]
        .filter((submission) => submission.state === 'pending')
        .sort(bySubmittedAt)
      return limit === undefined ? queue : queue.slice(0, limit)
    },

    async save(submission) {
      guard(scope, 'submissions.save')

      /*
       * The shared domain validator, not a second opinion written here. It is
       * what refuses a submission carrying eligibility blockers — the invariant
       * with no column and therefore no database backstop.
       */
      const problems = [
        ...validateCioSubmission(submission),
        ...validateSubmissionReferences(submission, governanceFacts(store)),
      ]
      if (problems.length > 0) {
        throw new InvariantViolationError(problems[0]!.code, 'submissions.save')
      }

      const existing = store.submissions.get(submission.id)
      if (existing) {
        if (cioSubmissionSemanticKey(existing) !== cioSubmissionSemanticKey(submission)) {
          throw new ConflictingRecordError(
            'CIO submission',
            submission.id,
            'submissions.save',
          )
        }
        return existing
      }

      const stored = seal(submission, `CIO submission ${submission.id}`)
      store.submissions.set(submission.id, stored)
      return stored
    },

    async settle(submissionIds, state) {
      guard(scope, 'submissions.settle')
      for (const submissionId of submissionIds) {
        const existing = store.submissions.get(submissionId)
        if (!existing) {
          throw new ReferentialIntegrityError(
            'cio_submissions_exists',
            'submissions.settle',
          )
        }
        if (existing.state === state) continue
        /*
         * `decided` and `returned` describe different institutional histories.
         * Moving between them would rewrite what happened to the queue item.
         */
        if (existing.state !== 'pending') {
          throw new InvariantViolationError(
            'submission-already-settled',
            'submissions.settle',
          )
        }
        store.submissions.set(
          submissionId,
          seal({ ...existing, state }, `CIO submission ${submissionId}`),
        )
      }
    },

    async recordReturn(cioReturn) {
      guard(scope, 'returns.recordReturn')

      const problems = [
        ...validateCioReturn(cioReturn),
        ...validateReturnReferences(cioReturn, returnSubjects(store)),
      ]
      if (problems.length > 0) {
        throw new InvariantViolationError(problems[0]!.code, 'returns.recordReturn')
      }

      const existing = store.returns.get(cioReturn.id)
      if (existing) {
        if (cioReturnSemanticKey(existing) !== cioReturnSemanticKey(cioReturn)) {
          throw new ConflictingRecordError(
            'CIO return',
            cioReturn.id,
            'returns.recordReturn',
          )
        }
        return existing
      }

      const submission = store.submissions.get(cioReturn.submissionId)
      if (!submission) {
        throw new ReferentialIntegrityError(
          'cio_returns_submission_fk',
          'returns.recordReturn',
        )
      }
      if (submission.caseId !== cioReturn.caseId) {
        throw new InvariantViolationError(
          'return-submission-case',
          'returns.recordReturn',
        )
      }

      const stored = seal(cioReturn, `CIO return ${cioReturn.id}`)
      store.returns.set(cioReturn.id, stored)
      if (submission.state === 'pending') {
        store.submissions.set(
          submission.id,
          seal(
            { ...submission, state: 'returned' as const },
            `CIO submission ${submission.id}`,
          ),
        )
      }
      return stored
    },

    async getReturn(returnId) {
      guard(scope, 'returns.getReturn')
      const stored = store.returns.get(returnId)
      return stored ? hydratedReturn(stored, 'returns.getReturn') : null
    },

    async returnsForCase(caseId) {
      guard(scope, 'returns.returnsForCase')
      return [...store.returns.values()]
        .filter((entry) => entry.caseId === caseId)
        .sort(byReturnedAt)
    },

    async recordReconsideration(reconsideration) {
      guard(scope, 'returns.recordReconsideration')

      const problems = validateCaseReconsideration(reconsideration)
      if (problems.length > 0) {
        throw new InvariantViolationError(
          problems[0]!.code,
          'returns.recordReconsideration',
        )
      }

      const existing = store.reconsiderations.get(reconsideration.id)
      if (existing) {
        if (
          caseReconsiderationSemanticKey(existing) !==
          caseReconsiderationSemanticKey(reconsideration)
        ) {
          throw new ConflictingRecordError(
            'case reconsideration',
            reconsideration.id,
            'returns.recordReconsideration',
          )
        }
        return existing
      }

      const submission = store.submissions.get(reconsideration.submissionId)
      if (!submission) {
        throw new ReferentialIntegrityError(
          'case_reconsiderations_submission_fk',
          'returns.recordReconsideration',
        )
      }

      /*
       * One reopening per submission, which PostgreSQL holds as a unique
       * constraint. Without it here the reference store would accept a state
       * the real one refuses, and the two would disagree about what the firm
       * permits -- an adapter must not define its own accidental semantics.
       */
      for (const other of store.reconsiderations.values()) {
        if (other.submissionId === reconsideration.submissionId) {
          throw new DuplicateRecordError(
            'case_reconsiderations_submission_unique',
            'returns.recordReconsideration',
          )
        }
      }

      const deferral = store.decisions.get(reconsideration.reconsidersDecisionId)
      if (!deferral) {
        throw new ReferentialIntegrityError(
          'case_reconsiderations_decision_fk',
          'returns.recordReconsideration',
        )
      }

      /*
       * A cited trigger must belong to the decision being reconsidered.
       * PostgreSQL holds this as a composite foreign key; the reference store
       * has to check it, or the two adapters would disagree about which
       * reopenings the firm permits.
       */
      const owned = new Set(deferral.reconsiderationTriggers.map((entry) => entry.id))
      for (const fired of reconsideration.firedTriggers) {
        if (!owned.has(fired.triggerId)) {
          throw new ReferentialIntegrityError(
            'case_reconsideration_fired_triggers_trigger_fk',
            'returns.recordReconsideration',
          )
        }
      }

      const stored = seal(reconsideration, `case reconsideration ${reconsideration.id}`)
      store.reconsiderations.set(reconsideration.id, stored)
      return stored
    },

    async getReconsideration(reconsiderationId) {
      guard(scope, 'returns.getReconsideration')
      return store.reconsiderations.get(reconsiderationId) ?? null
    },

    async reconsiderationsForCase(caseId) {
      guard(scope, 'returns.reconsiderationsForCase')
      return [...store.reconsiderations.values()]
        .filter((entry) => entry.caseId === caseId)
        .sort((a, b) =>
          a.reopenedAt === b.reopenedAt
            ? a.id.localeCompare(b.id)
            : a.reopenedAt.localeCompare(b.reopenedAt),
        )
    },

    async returnsForRevision(revisionId) {
      guard(scope, 'returns.returnsForRevision')
      return [...store.returns.values()]
        .filter((entry) => entry.revisionId === revisionId)
        .sort(byReturnedAt)
    },
  }
}

/* ------------------------------------------------------------- decisions */

/**
 * Completed institutional CIO outcomes.
 *
 * Live versus historical is derived from the supersession map rather than from
 * a stored flag, which is the shape PostgreSQL takes too: `superseded_by IS
 * NULL`. A flag would be a lifecycle no command owns.
 */
function decisionRepository(store: Store, scope: Scope): DecisionRepository {
  const liveFor = (caseId: string) =>
    [...store.decisions.values()].find(
      (decision) =>
        decision.caseId === caseId && !store.supersededBy.has(decision.decisionId),
    ) ?? null

  return {
    async get(decisionId) {
      guard(scope, 'decisions.get')
      return store.decisions.get(decisionId) ?? null
    },

    async getForCase(caseId) {
      guard(scope, 'decisions.getForCase')
      return liveFor(caseId)
    },

    async historyForCase(caseId) {
      guard(scope, 'decisions.historyForCase')
      return [...store.decisions.values()]
        .filter((decision) => decision.caseId === caseId)
        .sort(
          (a, b) =>
            byString(a.decidedAt, b.decidedAt) || byString(a.decisionId, b.decisionId),
        )
    },

    async listRecent(limit) {
      guard(scope, 'decisions.listRecent')
      return [...store.decisions.values()]
        .filter((decision) => !store.supersededBy.has(decision.decisionId))
        .sort(
          (a, b) =>
            byString(b.decidedAt, a.decidedAt) || byString(b.decisionId, a.decisionId),
        )
        .slice(0, limit)
    },

    async save(decision) {
      guard(scope, 'decisions.save')

      /*
       * The shared validator again. Not re-implemented here, and not skipped
       * because "the command already checked" — the port is reachable without
       * a command, and PostgreSQL's triggers will refuse the same aggregate.
       */
      const problems = validateCaseDecision(decision)
      if (problems.length > 0) {
        throw new InvariantViolationError(problems[0]!.code, 'decisions.save')
      }

      const existing = store.decisions.get(decision.decisionId)
      if (existing) {
        if (decisionSemanticKey(existing) !== decisionSemanticKey(decision)) {
          throw new ConflictingRecordError(
            'Case decision',
            decision.decisionId,
            'decisions.save',
          )
        }
        return existing
      }

      const predecessorId = decision.supersedesDecisionId
      const predecessorSubmissions = new Set(
        predecessorId === undefined
          ? []
          : (store.decisions.get(predecessorId)?.submissionIds ?? []),
      )

      for (const submissionId of decision.submissionIds) {
        const submission = store.submissions.get(submissionId)
        if (!submission) {
          throw new ReferentialIntegrityError(
            'decision_submissions_submission_fk',
            'decisions.save',
          )
        }
        if (submission.caseId !== decision.caseId) {
          throw new InvariantViolationError('decision-submission-case', 'decisions.save')
        }
        /*
         * A settled submission is not rejected for being settled -- a
         * correction reuses the basis it corrects. What has to be true is that
         * the reuse is real: the predecessor must actually have referenced it.
         */
        if (
          submission.state !== 'pending' &&
          predecessorId !== undefined &&
          !predecessorSubmissions.has(submissionId)
        ) {
          throw new InvariantViolationError(
            'decision-submission-not-reusable',
            'decisions.save',
          )
        }
      }

      if (predecessorId !== undefined) {
        const predecessor = store.decisions.get(predecessorId)
        if (!predecessor) {
          throw new ReferentialIntegrityError(
            'case_decisions_supersedes_fk',
            'decisions.save',
          )
        }
        if (predecessor.caseId !== decision.caseId) {
          /*
           * A decision on one case cannot correct a decision on another. A
           * composite foreign key expresses this in PostgreSQL; nothing in
           * memory would notice, which is exactly why it is checked here.
           */
          throw new InvariantViolationError(
            'decision-supersedes-other-case',
            'decisions.save',
          )
        }
        if (store.supersededBy.has(predecessorId)) {
          throw new ConcurrencyConflictError(
            decision.caseId,
            decision.aggregateVersion,
            decision.aggregateVersion,
          )
        }
      } else if (liveFor(decision.caseId) !== null) {
        throw new DuplicateRecordError(
          'case_decisions_one_live_per_case',
          'decisions.save',
        )
      }

      /*
       * A reconsideration trigger id is unique across every decision, not just
       * within one: `decision_reconsideration_triggers.id` is the primary key.
       * A superseding decision therefore mints its OWN conditions rather than
       * restating its predecessor's under the same ids -- which is also why
       * triggers have no lineage across decisions (TD-52).
       */
      const mintedTriggerIds = new Set(
        [...store.decisions.values()].flatMap((stored) =>
          stored.reconsiderationTriggers.map((trigger) => trigger.id),
        ),
      )
      for (const trigger of decision.reconsiderationTriggers) {
        if (mintedTriggerIds.has(trigger.id)) {
          throw new DuplicateRecordError(
            'decision_reconsideration_triggers_pkey',
            'decisions.save',
          )
        }
      }

      const stored = seal(decision, `Case decision ${decision.decisionId}`)
      /*
       * Both writes together. A supersession that recorded the link without
       * inserting the successor would leave the case with no live decision —
       * which is why there is no separate `supersede()` on the port.
       */
      if (predecessorId !== undefined) {
        store.supersededBy.set(predecessorId, decision.decisionId)
      }
      store.decisions.set(decision.decisionId, stored)
      return stored
    },
  }
}
