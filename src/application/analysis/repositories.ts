/**
 * Repository ports.
 *
 * Defined here, implemented in `infrastructure/analysis`. The application layer
 * never sees a driver type — no pool, no client, no SQL. `withTransaction` is
 * the whole of the abstraction.
 *
 * ## Optimistic concurrency
 *
 * `cases.save` takes the version the caller read. Two departments finishing at
 * the same moment both computed their change against version 12; the second
 * write is rejected rather than silently overwriting the first, and the caller
 * re-reads and retries.
 *
 * A global lock would also prevent the lost update, and would serialise the
 * entire organization to protect one case. Only the case row is a concurrency
 * unit — assignments, runs, claims and events are independently keyed or
 * append-only.
 *
 * ## Deterministic ordering
 *
 * **Every method returning a list defines its ordering explicitly**, and each
 * order ends in a unique tie-breaker. Nothing may rely on insertion order,
 * primary-key coincidence, physical row order or planner behaviour: the
 * in-memory adapter would return one thing and PostgreSQL another, and the
 * read-verification stage exists precisely to catch that. The guarantee is
 * stated on each method so both adapters implement the same one.
 */

import type {
  AgentClaim,
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
import type { ResultStore } from './resultStore'

/**
 * PHASE B LIMITATION, recorded where an implementer will see it.
 *
 * The only adapter today is in-memory and process-local. On restart every case,
 * thesis, run, review and decision is gone. Acceptable for a deterministic
 * runtime prototype with no live agents; not acceptable for real analysis,
 * user-owned work or production.
 *
 * Durable storage is a hard gate before AI Phase C. It does not depend on
 * authentication: a system-level durable repository can exist before users do.
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

/**
 * Thrown when a transaction-scoped repository is used after its transaction
 * has closed.
 *
 * The failure this prevents is quiet and severe: a repository captured inside
 * `withTransaction` and called afterwards would run against a connection that
 * has been committed, rolled back, or handed to someone else entirely. Failing
 * loudly is the only safe behaviour.
 */
export class TransactionClosedError extends Error {
  constructor(operation: string) {
    super(
      `"${operation}" was called after its transaction closed. Repositories ` +
        `obtained inside withTransaction must not escape the callback.`,
    )
    this.name = 'TransactionClosedError'
  }
}

/**
 * Everything else a store can fail with.
 *
 * Declared on the PORT rather than in the PostgreSQL adapter, for one reason:
 * the semantic-parity suite runs the same tests against both stores, and it can
 * only assert on an error both are able to throw. An adapter-local taxonomy
 * would make "the in-memory store rejects this too" untestable.
 *
 * ## What these never carry
 *
 * No SQL, no query parameters, no connection string, and none of PostgreSQL's
 * `detail` field — which is populated with the offending key VALUES, so a
 * unique violation would otherwise reproduce a case id or a content hash in a
 * message headed for a log. What they do carry: the operation, the constraint
 * or record name, and a correlation id where one is in scope. Bounded, and
 * enough to find the occurrence in the event log where the detail belongs.
 */
export class StorageError extends Error {
  readonly operation: string
  readonly correlationId?: string

  constructor(message: string, operation: string, correlationId?: string) {
    super(message)
    this.name = 'StorageError'
    this.operation = operation
    this.correlationId = correlationId
  }
}

/**
 * The same key already holds DIFFERENT content.
 *
 * Distinct from a benign replay, which returns the stored record. Write-once
 * records are keyed on everything that can change their content, so a
 * collision with different content means something upstream is wrong — and
 * silently returning the existing row would hide it for as long as anyone
 * cared to look.
 */
export class ConflictingRecordError extends StorageError {
  constructor(
    readonly record: string,
    readonly key: string,
    operation: string,
    correlationId?: string,
  ) {
    super(
      `${record} "${key}" already exists with different content. A write-once ` +
        `record is keyed on everything that determines it, so this is a real ` +
        `disagreement rather than a retry.`,
      operation,
      correlationId,
    )
    this.name = 'ConflictingRecordError'
  }
}

/** A uniqueness constraint rejected the write. Named by constraint, not value. */
export class DuplicateRecordError extends StorageError {
  constructor(
    readonly constraint: string,
    operation: string,
    correlationId?: string,
  ) {
    super(
      `"${operation}" violated uniqueness constraint "${constraint}"`,
      operation,
      correlationId,
    )
    this.name = 'DuplicateRecordError'
  }
}

/** A referenced row does not exist. */
export class ReferentialIntegrityError extends StorageError {
  constructor(
    readonly constraint: string,
    operation: string,
    correlationId?: string,
  ) {
    super(
      `"${operation}" referenced a record that does not exist (${constraint})`,
      operation,
      correlationId,
    )
    this.name = 'ReferentialIntegrityError'
  }
}

/** A CHECK or a domain rule the store enforces rejected the write. */
export class InvariantViolationError extends StorageError {
  constructor(
    readonly constraint: string,
    operation: string,
    correlationId?: string,
  ) {
    super(`"${operation}" violated invariant "${constraint}"`, operation, correlationId)
    this.name = 'InvariantViolationError'
  }
}

/** An append-only or sealed record was asked to change. */
export class ImmutableRecordError extends StorageError {
  constructor(
    readonly record: string,
    operation: string,
    correlationId?: string,
  ) {
    super(
      `${record} is immutable. Append a correcting record rather than editing it.`,
      operation,
      correlationId,
    )
    this.name = 'ImmutableRecordError'
  }
}

/**
 * A stored record could not be mapped back into a valid domain value.
 *
 * The one error that indicates the STORE is wrong rather than the caller. A
 * row edited by hand, restored from an incompatible backup, or written by an
 * older version of this code fails here rather than entering the domain as a
 * plausible-looking value.
 */
export class MalformedRowError extends StorageError {
  constructor(
    readonly record: string,
    readonly why: string,
    operation: string,
    correlationId?: string,
  ) {
    super(`Stored ${record} is not valid: ${why}`, operation, correlationId)
    this.name = 'MalformedRowError'
  }
}

/**
 * Transient, and safe to retry: raised BEFORE commit, so nothing was written.
 *
 * The adapter does not retry on its own. It labels the failure and lets the
 * command layer decide, because the command is what knows whether it can be
 * re-derived.
 */
export class RetryableStorageError extends StorageError {
  constructor(
    readonly reason: 'serialization-failure' | 'deadlock',
    operation: string,
    correlationId?: string,
  ) {
    super(
      `"${operation}" failed with a transient ${reason} and wrote nothing. Safe to retry.`,
      operation,
      correlationId,
    )
    this.name = 'RetryableStorageError'
  }
}

/**
 * The commit was sent and its outcome is unknown.
 *
 * **Deliberately not retryable.** The transaction may or may not have
 * committed, and only the caller knows whether its command carries an
 * idempotency identity. A blanket retry of one that does not would produce a
 * second assignment, a second run, or a second decision — and a duplicate
 * decision is a second valid-looking institutional record, which is worse than
 * a failed request.
 */
export class AmbiguousCommitError extends StorageError {
  constructor(operation: string, correlationId?: string) {
    super(
      `The commit for "${operation}" was sent and its outcome is unknown. Do not ` +
        `retry unless the command has an idempotency key; re-read to establish ` +
        `what happened.`,
      operation,
      correlationId,
    )
    this.name = 'AmbiguousCommitError'
  }
}

export class StoragePermissionError extends StorageError {
  constructor(operation: string, correlationId?: string) {
    super(
      `"${operation}" was refused by the database. The runtime role does not ` +
        `hold the privilege this statement requires.`,
      operation,
      correlationId,
    )
    this.name = 'StoragePermissionError'
  }
}

export class StorageUnavailableError extends StorageError {
  constructor(operation: string, correlationId?: string) {
    super(`The database was unreachable during "${operation}"`, operation, correlationId)
    this.name = 'StorageUnavailableError'
  }
}

/* --------------------------------------------------------------- provenance */

/**
 * Which storage implementation produced a piece of analysis.
 *
 * An analysis is already traceable to its evidence, prompt, model, output
 * schema and agent contract. It has not been traceable to the code that read
 * and wrote it — so "why does this decision cite an evidence set that looks
 * wrong" could not be split into "the analysis was wrong" and "the storage
 * layer was wrong at the time". Only the first was answerable.
 *
 * `queryCatalogHash` is the coordinate that had to be decided now rather than
 * later: it is computable only if every statement lives in one enumerable
 * place, which is a structural property of the adapter and a whole-adapter
 * refactor to retrofit.
 *
 * Recording this alongside results needs columns on `runs` and `agent_results`
 * and only becomes meaningful when a real agent writes a real result. See
 * TD-24.
 */
export interface StorageProvenance {
  adapterId: string
  /** Bumped by hand when the adapter's behaviour changes. */
  adapterVersion: string
  /** Hash over every statement the adapter can issue. Null when it issues none. */
  queryCatalogHash: string | null
  /** Highest applied migration, and its checksum. Null for a store without one. */
  schemaVersion: string | null
  schemaChecksum: string | null
  /** Which version of the analysis domain contracts was active. */
  domainContractVersion: string
}

/* ------------------------------------------------------------- repositories */

export interface CaseRepository {
  get(caseId: string): Promise<InvestmentCase | null>
  /** Ordered by `openedAt` descending, then `id` ascending. */
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
  /** Ordered by `thesisId`, then `revisionNumber` ascending. */
  listForCase(caseId: string): Promise<InvestmentThesis[]>
  /** Idempotent on `revisionId`. */
  save(revision: InvestmentThesis): Promise<InvestmentThesis>
}

export interface AssignmentRepository {
  get(assignmentId: string): Promise<Assignment | null>
  /** Ordered by `priority` descending, then `createdAt`, then `id`. */
  listForCase(caseId: string): Promise<Assignment[]>
  /** Same ordering as `listForCase`. */
  listForDepartment(departmentId: string): Promise<Assignment[]>
  /** Idempotent on `id`. */
  save(assignment: Assignment): Promise<Assignment>
}

export interface RunRepository {
  get(runId: string): Promise<AgentRunRecord | null>
  /** Ordered by `startedAt`, then `id`. */
  listForCase(caseId: string): Promise<AgentRunRecord[]>
  /** Idempotent on `id`. */
  save(run: AgentRunRecord): Promise<AgentRunRecord>
}

/**
 * Claims, stored beside their run rather than inside it.
 *
 * A claim is cited by theses, contested by challenges and verified
 * individually, so it needs its own identity and its own lookups — embedding
 * it in the run record would make "which claims did verification review"
 * a scan.
 */
export interface ClaimRepository {
  get(claimId: string): Promise<AgentClaim | null>
  /** Ordered by `id`. */
  listForRun(runId: string): Promise<AgentClaim[]>
  /** Ordered by `id`. */
  listForCase(caseId: string): Promise<AgentClaim[]>
  /** Idempotent on `id`. Claims are write-once. */
  save(claim: AgentClaim, caseId: string, runId: string): Promise<AgentClaim>
}

/**
 * Reviews for a case — both the case-wide ones and every revision-scoped one.
 *
 * There is deliberately no `…ForRevision` method. Matching a review to a
 * revision is a domain rule (`reviewApplies`), and a second implementation of
 * it in a repository is where a lineage-scoped match would quietly reappear.
 * The store returns what exists; the domain decides what it speaks to.
 */
export interface ReviewRepository {
  /**
   * All ordered by `at`, then `byEmployeeId`, then `revisionId`.
   *
   * The revision is part of the tie-break because it is part of the identity:
   * one reviewer can record verdicts on two competing revisions at the same
   * instant, and without it the order of those two would be arbitrary.
   */
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
  /** Ordered by `occurredAt`, then `eventId`. */
  listForCase(caseId: string): Promise<TransitionEvent[]>
  /** Most recent first: `occurredAt` descending, then `eventId` descending. */
  recent(limit: number): Promise<TransitionEvent[]>
}

/** Content-addressed. An evidence set is immutable, so writes never conflict. */
export interface EvidenceRepository {
  get(setId: string): Promise<EvidenceSet | null>
  save(set: EvidenceSet): Promise<EvidenceSet>
}

export interface DecisionRepository {
  getForCase(caseId: string): Promise<CaseDecision | null>
  /** Ordered by `decidedAt` descending, then `caseId`. */
  list(limit: number): Promise<CaseDecision[]>
  /**
   * Idempotent on `caseId`: a case has at most one decision, and a committed
   * decision is immutable. A correction appends a new superseding decision
   * rather than rewriting this one.
   */
  save(decision: CaseDecision): Promise<CaseDecision>
}

/* -------------------------------------------------------------- idempotency */

export interface IdempotencyRecord {
  key: string
  commandType: string
  /** The id of whatever the command produced, so a replay can return it. */
  resultRef: string
  createdAt: string
}

/**
 * Explicit idempotency, for the commands whose identity is not derivable.
 *
 * Most operations need none: an assignment id follows from
 * `(caseId, playbookEntryKey)`, an event carries its own id, a result is
 * keyed by content hash. Keys exist for the three where two calls are
 * indistinguishable from one retried call — opening a case, starting a run,
 * recording a review — and for the decision, where a duplicate would be a
 * second valid-looking institutional record.
 *
 * The record and its effect **must commit in the same transaction**, or there
 * is a window in which the key exists without the effect it guards.
 */
export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>
  /**
   * Reserves a key. Returns the existing record when the key is already held,
   * which is how a replay returns the original result instead of doing work.
   */
  reserve(record: IdempotencyRecord): Promise<IdempotencyRecord>
}

/* ---------------------------------------------------------------- container */

/**
 * Everything a command needs, minus the ability to open another transaction.
 *
 * `withTransaction` is deliberately absent, so a nested transaction is a
 * compile error rather than a runtime surprise. No command in the runtime
 * needs savepoints.
 */
export type TransactionalAnalysisRepositories = Omit<
  AnalysisRepositories,
  'withTransaction' | 'provenance'
>

export interface AnalysisRepositories {
  cases: CaseRepository
  theses: ThesisRepository
  assignments: AssignmentRepository
  runs: RunRepository
  claims: ClaimRepository
  reviews: ReviewRepository
  events: EventRepository
  evidence: EvidenceRepository
  decisions: DecisionRepository
  results: ResultStore
  idempotency: IdempotencyStore

  /**
   * Runs `operation` inside one transaction.
   *
   * A transaction spans repositories — opening a case writes the case, its
   * assignments, its first thesis revision and their events — so the boundary
   * belongs on the container. A per-repository transaction could not express
   * it, and compensating deletion after a partial failure is not an acceptable
   * substitute when the database can simply guarantee atomicity.
   *
   * The repositories handed to the callback are transaction-scoped and stop
   * working the moment it resolves. The outer ones are not transactional and
   * must not be used inside.
   *
   * The callback throwing rolls everything back. A commit failure surfaces to
   * the caller — **no caller receives a success result before commit
   * succeeds.**
   */
  withTransaction<T>(
    operation: (repositories: TransactionalAnalysisRepositories) => Promise<T>,
  ): Promise<T>

  /**
   * Which implementation this is, and against which schema.
   *
   * Async because the schema version is a row in `schema_migrations`, and an
   * adapter that reported a compiled-in constant would report what the code
   * expects rather than what the database actually is.
   */
  provenance(): Promise<StorageProvenance>
}
