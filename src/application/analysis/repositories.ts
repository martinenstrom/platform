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
  CaseReconsideration,
  CioReturn,
  CioSubmission,
  ComplianceReview,
  DevilsAdvocateReview,
  DurableObservation,
  EvidenceAssembly,
  EvidenceSet,
  InvestmentCase,
  InvestmentThesis,
  ManagerAggregation,
  ObservationSeriesQuery,
  RequirementResolution,
  RiskReview,
  TransitionEvent,
  VerificationReview,
} from '~/domain/analysis'
import type { ResultStore } from './resultStore'
import type { CommandLog } from './commandLog'
import type { CasePlaybook } from './playbooks'

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
  /**
   * Content address of every coordinate below.
   *
   * Two runtimes with identical coordinates share one provenance row by
   * construction, which is what keeps the ledger from repeating six columns on
   * every command.
   */
  provenanceId: string
  adapterId: string
  /**
   * DERIVED from the coordinates, not hand-maintained.
   *
   * A constant somebody has to remember to bump is only as good as the
   * remembering. `buildId` covers the mapping code, `queryCatalogHash` covers
   * the SQL, and together they cover what a hand-written version claimed to.
   */
  adapterVersion: string
  /** Git commit, injected at build. `dev` locally. */
  buildId: string
  /** Hash over every statement the adapter can issue. Null when it issues none. */
  queryCatalogHash: string | null
  /** Highest applied migration, and its checksum. Null for a store without one. */
  schemaVersion: string | null
  schemaChecksum: string | null
  /** Which version of the analysis domain contracts was active. */
  domainContractVersion: string
  /** Which version of the command contract was active. */
  commandContractVersion: string
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
  /**
   * Idempotent on `id`.
   *
   * Takes provenance because a run carries a FK to it: execution provenance
   * says what produced the analysis, storage provenance says what wrote the
   * row, and a run row is not legible without both.
   */
  save(run: AgentRunRecord, provenance: StorageProvenance): Promise<AgentRunRecord>
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
 * Work an agent produced that no human has accepted.
 *
 * **Deliberately not the claims repository.** Generated work is operational
 * until a person accepts it, and the separation is what makes non-citability
 * structural: every citation in the institution — `contests`, `evidenceRefs`,
 * an aggregation disposition, a challenge subject — is a foreign key into
 * `analysis.claims`, and nothing produced is in it. Citing unaccepted work
 * therefore fails at the database rather than at a filter somebody remembered.
 *
 * Claims cross this boundary **unchanged**. Acceptance moves the same claim,
 * with the same id and the same content, into institutional storage; there is
 * no second canonicalisation and no second content hash. A claim that hashed
 * differently depending on which side of acceptance it was read from would not
 * be content-addressed at all.
 *
 * Rejected work stays here, readable, for as long as the run does.
 */
export interface ProducedClaimRepository {
  /**
   * Records what a run produced. Idempotent on `runId`; one run produces one
   * set of claims, and a second write with different content throws
   * `ConflictingRecordError`.
   */
  record(runId: string, caseId: string, claims: readonly AgentClaim[]): Promise<void>
  /** Ordered by `id`, like the institutional repository it mirrors. */
  listForRun(runId: string): Promise<AgentClaim[]>
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
   * The next position for one (case, revision, kind).
   *
   * Read-then-increment, and safe because the store's uniqueness constraint on
   * `(case, revision, kind, sequence)` is what protects it: two commands racing
   * for the same position cannot both commit, so the loser fails rather than
   * quietly taking a place that is already claimed. Locking instead would
   * serialise Verification against the Devil's Advocate, which is the
   * concurrency the firm needs most.
   */
  nextSequence(input: {
    caseId: string
    revisionId: string
    kind: 'verification' | 'devils-advocate' | 'compliance' | 'risk'
  }): Promise<number>

  /**
   * One verdict by its id, for a command replay.
   *
   * A replay returns what the original command produced, and the ledger carries
   * only the result reference — so the store has to be able to find a review
   * without being told which case or which discipline it belongs to.
   */
  get(
    reviewId: string,
  ): Promise<
    VerificationReview | DevilsAdvocateReview | ComplianceReview | RiskReview | null
  >

  /**
   * All ordered by `sequence`, then `at`, then `byEmployeeId`, then `revisionId`.
   *
   * Sequence leads because it is the only total order. The revision is part of
   * the tie-break because it is part of the identity: one reviewer can record
   * verdicts on two competing revisions at the same instant, and without it the
   * order of those two would be arbitrary.
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
  /**
   * The sets the institution holds, most recently assembled first:
   * `assembledAt` descending, then `id` descending.
   *
   * An evidence set carries no case, deliberately — it is content-addressed and
   * reusable, so the same observations assembled twice are one set that several
   * cases may reason over. Commissioning therefore needs to offer what the firm
   * actually holds, which is a question no per-case lookup can answer.
   */
  list(limit: number): Promise<EvidenceSet[]>
  save(set: EvidenceSet): Promise<EvidenceSet>
}

/**
 * The assembly acts — who declared a body of evidence fit for analysis, by what
 * rule, and against what the institution knew at the time.
 *
 * Append-only, keyed on the act rather than on the set. A set is
 * content-addressed on its membership, so two selections that happen to select
 * the same observations are one artifact reached by two acts; keying this on
 * the set id would force one act to overwrite the other. See
 * `domain/analysis/evidenceAssembly.ts`.
 */
export interface EvidenceAssemblyRepository {
  /**
   * Records one assembly. **Idempotent on `assemblyId`**, which is derived from
   * the command id — so a retry addresses the same record rather than filing a
   * second act nobody performed.
   */
  record(
    assembly: EvidenceAssembly,
    provenance: StorageProvenance,
  ): Promise<EvidenceAssembly>

  /** One act. `null` when the firm never recorded it. */
  get(assemblyId: string): Promise<EvidenceAssembly | null>

  /**
   * Every act that produced this set, most recent first.
   *
   * Plural by construction and empty for a pre-C3 set — which is the honest
   * answer for a set nobody assembled through this act. Nothing manufactures
   * one.
   */
  forSet(evidenceSetId: string): Promise<EvidenceAssembly[]>

  /** The most recent acts, newest first: `assembledAt` then `assemblyId`. */
  list(limit: number): Promise<EvidenceAssembly[]>
}

/**
 * Durable observations — the facts the institution has acquired.
 *
 * Independent of every evidence set, deliberately. Acquiring an observation and
 * declaring a body of evidence fit for analysis are two different institutional
 * acts (`phase-c3-evidence-gate.md` §0.3), and this port serves only the first.
 * Nothing here assembles, selects or judges.
 *
 * **Append-only, keyed on `(id, contentHash)`.** A revision is a second record
 * against the same observation id, not a replacement — so both versions stay
 * readable and the firm can still answer what it believed before the revision
 * arrived.
 */
export interface ObservationRepository {
  /**
   * Records observations the firm has acquired, and reports what was new.
   *
   * **Idempotent on `(ref.id, ref.contentHash)`, which IS the idempotency key.**
   * Re-ingesting a figure the source has not revised is a no-op: the natural key
   * plus the content already identify the version exactly, so a separate token
   * would be a second answer to a question the identity already settles.
   *
   * A record whose content differs is a REVISION and is stored beside the
   * original — never over it. Nothing in this port can overwrite a published
   * value, because a store that could would be unable to say what the firm knew
   * last month.
   *
   * Returns the observations that were newly recorded. An empty result means
   * every one was already held, which is the normal outcome of a re-poll and
   * must not be reported as a failure.
   */
  record(
    observations: readonly DurableObservation[],
    provenance: StorageProvenance,
  ): Promise<readonly DurableObservation[]>

  /** One exact version. `null` when the firm never held it. */
  get(observationId: string, contentHash: string): Promise<DurableObservation | null>

  /**
   * Every version of one observation, oldest first by `recordedAt` then
   * `contentHash`. The revision history of a single fact.
   */
  versions(observationId: string): Promise<DurableObservation[]>

  /**
   * A series: individually identifiable observations sharing a natural-key
   * prefix, ordered by `referencePeriod` ascending then `contentHash`.
   *
   * **One record per reference period**, resolved by `knownAt` — the latest
   * version the firm held at that instant, or the latest it holds now. A period
   * the firm learned about only after `knownAt` is absent rather than
   * back-dated.
   *
   * Never returns a stored aggregate. See `ObservationSeriesQuery`.
   */
  series(query: ObservationSeriesQuery): Promise<DurableObservation[]>
}

/**
 * Registered playbook versions.
 *
 * Append-only by design and by grant. A version a case has pinned can never be
 * edited, so improving a workflow means registering a new version beside the
 * old one and leaving cases in flight on the one they started under.
 */
export interface PlaybookRepository {
  /**
   * Registers a version, or returns the identical one already registered.
   *
   * Idempotent on `(id, version)` **when the content matches**. The same
   * version carrying different entries throws `ConflictingRecordError`: a
   * deployment that edited a playbook without bumping its version would
   * otherwise give two cases different workflows under one name, and only the
   * order they started in would say which.
   */
  register(playbook: CasePlaybook): Promise<CasePlaybook>
  /** Entries ordered by `priority` descending, then `key`. */
  get(playbookId: string, version: string): Promise<CasePlaybook | null>
}

/**
 * Recorded evaluations of conditional playbook entries.
 *
 * Write-once and revision-scoped. Absence means *not yet evaluated*; an
 * explicit `not-required` row means the firm looked and decided. See
 * `domain/analysis/requirements` for why this is stored rather than
 * recomputed on read.
 */
export interface RequirementRepository {
  /**
   * Idempotent on `(caseId, playbookEntryKey, revisionId)`.
   *
   * A deterministic rule cannot legitimately produce two answers for one
   * triple, so a second write with different content is a real disagreement
   * and throws `ConflictingRecordError`.
   */
  save(
    resolution: RequirementResolution,
    provenance: StorageProvenance,
  ): Promise<RequirementResolution>
  /** Ordered by `playbookEntryKey`, then `revisionId`. */
  listForCase(caseId: string): Promise<RequirementResolution[]>
}

/**
 * Manager aggregations — how a conclusion was reached.
 *
 * Write-once and append-only by design and by grant. An aggregation is a
 * judgement at a moment; a changed judgement is a new aggregation producing a
 * new revision, for the same reason a changed thesis is a new revision.
 */
export interface AggregationRepository {
  get(aggregationId: string): Promise<ManagerAggregation | null>
  /** The one that produced a revision, where a manager produced it. */
  forRevision(revisionId: string): Promise<ManagerAggregation | null>
  /** Ordered by `aggregatedAt`, then `id`. */
  listForCase(caseId: string): Promise<ManagerAggregation[]>
  /**
   * Idempotent on `id`. A second write with different content throws
   * `ConflictingRecordError`: a synthesis nobody can reproduce is worse than a
   * failed write.
   */
  save(
    aggregation: ManagerAggregation,
    provenance: StorageProvenance,
  ): Promise<ManagerAggregation>
}

/* ------------------------------------------------- CIO submissions and returns */

/**
 * The two states a submission can settle into.
 *
 * Named rather than inlined so `settle` cannot be handed `'pending'` and
 * quietly un-settle a queue item that has already been decided.
 */
export type SettledSubmissionState = 'decided' | 'returned'

/**
 * Material entering CIO consideration, and material leaving it for more work.
 *
 * One port because they are one aggregate: a return has no independent
 * existence — it always settles exactly one submission, and the only thing it
 * can do is move that submission to `returned`.
 *
 * **A return is not a decision.** It says the material was not ready to be
 * decided, which is a different institutional statement from deciding to wait.
 * Every method here is typed to exactly one record family: there is no
 * `save(record)` taking a union, because sharing a port boundary must not make
 * the three families look interchangeable.
 */
export interface SubmissionRepository {
  get(submissionId: string): Promise<CioSubmission | null>
  /** Ordered by `submittedAt`, then `id`. */
  listForCase(caseId: string): Promise<CioSubmission[]>
  /**
   * Every submission targeting one exact revision, oldest first.
   *
   * Named on the port rather than left as a filter over `listForCase` because
   * two commands need it — C1D-1C to refuse a second pending submission for a
   * revision, C1D-1D to prove each considered revision has exactly one — and a
   * lookup reimplemented twice is a rule that can diverge.
   */
  applicableForRevision(revisionId: string): Promise<CioSubmission[]>
  /** The CIO queue: everything still `pending`, oldest first. A queue is FIFO. */
  pending(limit?: number): Promise<CioSubmission[]>
  /**
   * Idempotent on `id`. Write-once except for `state`.
   *
   * Refuses a submission carrying eligibility blockers. A submission is a
   * statement that the revision was eligible, so one that was not is not a
   * submission the firm can make — and the basis has nowhere to record them,
   * which would make storing it a record claiming the firm found none.
   */
  save(submission: CioSubmission): Promise<CioSubmission>
  /**
   * Settles submissions in one act.
   *
   * Takes a list because a decision settles every submission it considered, and
   * one round trip per submission is the N+1 this adapter has already had to
   * remove once. Settling an already-settled submission to a DIFFERENT state
   * fails: `decided` and `returned` describe different institutional histories.
   */
  settle(submissionIds: readonly string[], state: SettledSubmissionState): Promise<void>

  /** Idempotent on `id`. Records the return and settles its submission. */
  recordReturn(cioReturn: CioReturn): Promise<CioReturn>
  getReturn(returnId: string): Promise<CioReturn | null>
  /** Ordered by `returnedAt`, then `id`. */
  returnsForCase(caseId: string): Promise<CioReturn[]>
  /** Same ordering, for one exact revision. */
  returnsForRevision(revisionId: string): Promise<CioReturn[]>

  /**
   * Records the CIO reopening a deferred case, with the submission it created.
   *
   * Idempotent on `id`; a second write with different content throws
   * `ConflictingRecordError`. The submission must already exist — the reopening
   * explains a request for a decision, and one that referred to no request
   * would explain nothing.
   *
   * A cited trigger must belong to the decision being reconsidered. Both stores
   * enforce it; PostgreSQL does so with a composite foreign key, so it is a
   * fact the database holds rather than a rule the application remembers.
   */
  recordReconsideration(
    reconsideration: CaseReconsideration,
  ): Promise<CaseReconsideration>
  getReconsideration(reconsiderationId: string): Promise<CaseReconsideration | null>
  /** Ordered by `reopenedAt`, then `id`, so the history reads as it happened. */
  reconsiderationsForCase(caseId: string): Promise<CaseReconsideration[]>
}

/* ---------------------------------------------------------------- decisions */

/**
 * Completed institutional CIO outcomes.
 *
 * Two reading semantics, neither hiding anything. The floor shows live
 * decisions; the case timeline and every audit read show the complete history
 * including superseded records. Nothing is deleted and nothing is hidden from
 * audit — the distinction is which question is being asked.
 *
 * There is deliberately no `update` and no `delete`. A committed decision is
 * immutable; a correction appends a decision naming its predecessor. The one
 * field that moves is the supersession link, and it moves only as part of
 * writing the successor.
 */
export interface DecisionRepository {
  /**
   * One decision by its id, for a command replay.
   *
   * The ledger carries only `resultRef: decisionId`, so the store has to find a
   * decision without being told which case it belongs to.
   */
  get(decisionId: string): Promise<CaseDecision | null>
  /** The LIVE decision — the one not superseded. Null where none exists. */
  getForCase(caseId: string): Promise<CaseDecision | null>
  /** Every decision for the case, oldest first: `decidedAt`, then `decisionId`. */
  historyForCase(caseId: string): Promise<CaseDecision[]>
  /** Live decisions only, newest first: `decidedAt` desc, then `decisionId` desc. */
  listRecent(limit: number): Promise<CaseDecision[]>
  /**
   * Writes a decision, performing its supersession in the same act.
   *
   * Idempotent on `decisionId`; a second write with different content throws
   * `ConflictingRecordError`. Where the decision names a predecessor, that
   * predecessor is marked superseded and the successor inserted together —
   * there is no separate `supersede()`, because one a caller could invoke
   * without inserting the successor is a way to leave a case with no live
   * decision.
   *
   * Refuses: an aggregate the domain validator rejects; a predecessor that does
   * not exist, belongs to another case, or has already been superseded.
   */
  save(decision: CaseDecision): Promise<CaseDecision>
}

/* --------------------------------------------------------- command ledger */

/*
 * `IdempotencyStore` lived here until Phase C1A. It described a thirty-day
 * operational cache and could not answer what Phase C needs: what was asked,
 * by whom, under what authority, against what version, and what came of it.
 *
 * The replacement is `CommandLog` in `./commandLog`, which separates immutable
 * intent from append-only outcomes. Duplicate PREVENTION was never this
 * table's job anyway — the unique constraints do that — so nothing is lost by
 * the change.
 */

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
  producedClaims: ProducedClaimRepository
  reviews: ReviewRepository
  events: EventRepository
  evidence: EvidenceRepository
  assemblies: EvidenceAssemblyRepository
  observations: ObservationRepository
  results: ResultStore
  commands: CommandLog
  playbooks: PlaybookRepository
  requirements: RequirementRepository
  aggregations: AggregationRepository
  submissions: SubmissionRepository
  decisions: DecisionRepository

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

/* ------------------------------------------------------ container completeness */

/**
 * Every capability a durable container must actually implement.
 *
 * Not a list somebody remembers to update. Three mechanisms hold it to the
 * ports, and each catches what the others cannot:
 *
 * 1. **`satisfies` over a mapped type**, below: a port added to
 *    `TransactionalAnalysisRepositories` with no entry here is a compile error,
 *    and a method name that is not on its port is one too.
 * 2. **A parser test** (`src/test/repositoryCapabilities.test.ts`) reads the
 *    port interfaces out of this file and requires each entry to list exactly
 *    the methods the interface declares. `satisfies` cannot demand
 *    exhaustiveness, so a method added to a port and forgotten here would
 *    otherwise pass — that test is what catches it, by name.
 * 3. **`assertRepositoriesComplete`** refuses a concrete container that is
 *    missing one, at construction rather than on the first command.
 *
 * What none of them catch is a method that is present and throws a placeholder:
 * checking that would mean calling it, and calling `save` to see whether it
 * works would write. Fitness rule 14 covers that shape statically. The runtime
 * guard proves presence; it does not prove behaviour, and it should not be
 * described as if it did.
 */
export const ANALYSIS_REPOSITORY_CAPABILITIES = {
  cases: ['get', 'list', 'create', 'save'],
  theses: ['get', 'listForCase', 'save'],
  assignments: ['get', 'listForCase', 'listForDepartment', 'save'],
  runs: ['get', 'listForCase', 'save'],
  claims: ['get', 'listForRun', 'listForCase', 'save'],
  producedClaims: ['record', 'listForRun'],
  reviews: [
    'nextSequence',
    'get',
    'verificationsForCase',
    'challengesForCase',
    'complianceForCase',
    'riskForCase',
    'saveVerification',
    'saveDevilsAdvocate',
    'saveCompliance',
    'saveRisk',
  ],
  events: ['append', 'listForCase', 'recent'],
  evidence: ['get', 'list', 'save'],
  assemblies: ['record', 'get', 'forSet', 'list'],
  observations: ['record', 'get', 'versions', 'series'],
  results: ['get', 'put'],
  commands: ['find', 'record', 'appendOutcome'],
  playbooks: ['register', 'get'],
  requirements: ['save', 'listForCase'],
  aggregations: ['get', 'forRevision', 'listForCase', 'save'],
  submissions: [
    'get',
    'listForCase',
    'applicableForRevision',
    'pending',
    'save',
    'settle',
    'recordReturn',
    'getReturn',
    'returnsForCase',
    'returnsForRevision',
    'recordReconsideration',
    'getReconsideration',
    'reconsiderationsForCase',
  ],
  decisions: ['get', 'getForCase', 'historyForCase', 'listRecent', 'save'],
} as const satisfies {
  readonly [
    K in keyof TransactionalAnalysisRepositories
  ]: readonly (keyof TransactionalAnalysisRepositories[K])[]
}

/** Thrown when a container is handed out missing a capability. */
export class IncompleteRepositoriesError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(
      `The repository container is incomplete: ${missing.join(', ')}. A durable ` +
        `runtime that starts without a capability fails on the first command ` +
        `that needs it, which is the worst possible moment to find out.`,
    )
    this.name = 'IncompleteRepositoriesError'
  }
}

/**
 * Refuses a container that cannot do everything the ports promise.
 *
 * Presence only — **no method is invoked**. A write method called to see
 * whether it works would write, and this runs during construction.
 */
export function assertRepositoriesComplete(
  repositories: Partial<TransactionalAnalysisRepositories>,
): void {
  const missing: string[] = []

  for (const [port, methods] of Object.entries(ANALYSIS_REPOSITORY_CAPABILITIES)) {
    const implementation = (repositories as Record<string, unknown>)[port]
    if (implementation === null || typeof implementation !== 'object') {
      missing.push(port)
      continue
    }
    for (const method of methods as readonly string[]) {
      if (typeof (implementation as Record<string, unknown>)[method] !== 'function') {
        missing.push(`${port}.${method}`)
      }
    }
  }

  if (missing.length > 0) throw new IncompleteRepositoriesError(missing)
}
