/**
 * The PostgreSQL adapter.
 *
 * Another implementation of the approved contracts, not a redesign of them.
 * Where SQL offered an easier behaviour than the in-memory reference, the
 * reference won — stage 4 compares the two, and a divergence introduced here
 * for convenience is a divergence that has to be explained there.
 *
 * **Not wired into anything.** No route, no server function and no composition
 * root constructs this, and a fitness rule asserts it. Wiring belongs to stage
 * 3 (dual write) and stage 5 (read switch).
 */

import {
  assertRepositoriesComplete,
  type AnalysisRepositories,
  type StorageProvenance,
  type TransactionalAnalysisRepositories,
} from '~/application/analysis/repositories'
import { DOMAIN_CONTRACT_VERSION } from '~/domain/analysis'
import { COMMAND_CONTRACT_VERSION } from '~/application/analysis/commands/envelope'
import type {
  StorageLogger,
  StorageMetrics,
} from '~/application/analysis/storageObservability'
import {
  DEFAULT_SLOW_QUERY_MS,
  noopStorageLogger,
} from '~/application/analysis/storageObservability'
import { noopMetrics } from '~/application/shared/metrics'
import {
  AMENDMENT_SQL,
  CASE_SQL,
  THESIS_SQL,
  createCaseAmendmentRepository,
  createCaseRepository,
  createThesisRepository,
} from './caseRepositories'
import {
  EVIDENCE_SQL,
  RESULT_SQL,
  createEvidenceRepository,
  createResultStore,
} from './evidenceRepositories'
import { createObservationRepository, OBSERVATION_SQL } from './observationRepositories'
import { createEvidenceAssemblyRepository, ASSEMBLY_SQL } from './assemblyRepositories'
import { AGGREGATION_SQL, createAggregationRepository } from './aggregationRepositories'
import { COMMAND_SQL, createCommandLog } from './commandLog'
import {
  PLAYBOOK_SQL,
  REQUIREMENT_SQL,
  createPlaybookRepository,
  createRequirementRepository,
} from './playbookRepositories'
import {
  EVENT_SQL,
  REVIEW_SQL,
  createEventRepository,
  createReviewRepository,
} from './governanceRepositories'
import { createPostgresPool, recordPoolGauges, type PostgresPoolOptions } from './pool'
import {
  catalog,
  catalogHash,
  defaultSqlContext,
  one,
  registerCatalogues,
  type Queryable,
  type SqlContext,
} from './sql'
import { buildProvenance, PROVENANCE_SQL } from './provenance'
import { poolScope, runInTransaction, type Scope } from './transaction'
import {
  ASSIGNMENT_SQL,
  CLAIM_SQL,
  PRODUCED_CLAIM_SQL,
  PRODUCED_SYNTHESIS_SQL,
  PRODUCED_VERIFICATION_SQL,
  PRODUCED_DEVILS_ADVOCATE_SQL,
  PRODUCED_PEER_EXAMINATION_SQL,
  RUN_SQL,
  createAssignmentRepository,
  createClaimRepository,
  createProducedClaimRepository,
  createProducedSynthesisRepository,
  createProducedVerificationRepository,
  createProducedDevilsAdvocateRepository,
  createProducedPeerExaminationRepository,
  createRunRepository,
} from './workRepositories'
import {
  SUBMISSION_READ_SQL,
  SUBMISSION_WRITE_SQL,
  RETURN_READ_SQL,
  RETURN_WRITE_SQL,
  createSubmissionRepository,
} from './submissionRepositories'
import {
  DECISION_READ_SQL,
  DECISION_HYDRATE_SQL,
  DECISION_WRITE_SQL,
  SUPERSESSION_SQL,
  createDecisionRepository,
} from './decisionRepositories'
import { CONSTRAINT_SQL } from './deferredConstraints'
import { ORGANIZATION_SQL } from './organizationReader'

/**
 * Identifies the implementation. The VERSION is derived, not written here —
 * see `deriveAdapterVersion`.
 */
const ADAPTER_ID = 'postgres'

/**
 * The container's own statement.
 *
 * In a catalogue like every other, because "every statement the adapter can
 * issue" is the definition the hash relies on — and a fitness rule enforces it
 * rather than leaving it to memory.
 */
const CONTAINER_SQL = catalog({
  schemaVersion: `SELECT version, checksum FROM analysis.schema_migrations
                  ORDER BY version DESC LIMIT 1`,
})

/**
 * Every statement this build can issue while serving the analysis runtime.
 *
 * The question a catalogue must answer is not which file constructs the
 * statement -- it is whether this build can issue it in production. So
 * `ORGANIZATION_SQL` is here even though `container.ts` constructs the reader
 * that uses it: it runs against this pool, on every start, and a provenance
 * hash that omitted it would describe a build that cannot read the firm.
 *
 * Registration is validated at module load. `COMMAND_SQL` was listed twice for
 * two phases and nothing noticed, so a duplicate is now a refusal rather than
 * a silently different hash. See D-S20.
 *
 * Excluded, deliberately: migrations, test setup, fixture seeding and anything
 * that cannot run in production -- `testDatabase.ts`, `schemaFingerprint.ts`,
 * `macroFlowHarness.ts` and every `*.pg.test.ts`.
 */
const CATALOGS = registerCatalogues([
  { name: 'container', statements: CONTAINER_SQL },
  { name: 'command', statements: COMMAND_SQL },
  { name: 'provenance', statements: PROVENANCE_SQL },
  { name: 'organization', statements: ORGANIZATION_SQL },
  { name: 'case', statements: CASE_SQL },
  { name: 'amendment', statements: AMENDMENT_SQL },
  { name: 'thesis', statements: THESIS_SQL },
  { name: 'assignment', statements: ASSIGNMENT_SQL },
  { name: 'run', statements: RUN_SQL },
  { name: 'claim', statements: CLAIM_SQL },
  { name: 'producedClaim', statements: PRODUCED_CLAIM_SQL },
  { name: 'producedSynthesis', statements: PRODUCED_SYNTHESIS_SQL },
  { name: 'producedVerification', statements: PRODUCED_VERIFICATION_SQL },
  { name: 'producedDevilsAdvocate', statements: PRODUCED_DEVILS_ADVOCATE_SQL },
  { name: 'producedPeerExamination', statements: PRODUCED_PEER_EXAMINATION_SQL },
  { name: 'evidence', statements: EVIDENCE_SQL },
  { name: 'observations', statements: OBSERVATION_SQL },
  { name: 'assemblies', statements: ASSEMBLY_SQL },
  { name: 'result', statements: RESULT_SQL },
  { name: 'review', statements: REVIEW_SQL },
  { name: 'event', statements: EVENT_SQL },
  { name: 'playbook', statements: PLAYBOOK_SQL },
  { name: 'requirement', statements: REQUIREMENT_SQL },
  { name: 'aggregation', statements: AGGREGATION_SQL },
  { name: 'submissionRead', statements: SUBMISSION_READ_SQL },
  { name: 'submissionWrite', statements: SUBMISSION_WRITE_SQL },
  { name: 'returnRead', statements: RETURN_READ_SQL },
  { name: 'returnWrite', statements: RETURN_WRITE_SQL },
  { name: 'decisionRead', statements: DECISION_READ_SQL },
  { name: 'decisionHydrate', statements: DECISION_HYDRATE_SQL },
  { name: 'decisionWrite', statements: DECISION_WRITE_SQL },
  { name: 'supersession', statements: SUPERSESSION_SQL },
  { name: 'constraintControl', statements: CONSTRAINT_SQL },
])

/** The registry, for the membership tests. Read-only by construction. */
export const PRODUCTION_CATALOGUES = CATALOGS

export interface PostgresRepositoriesOptions extends PostgresPoolOptions {
  metrics?: StorageMetrics
  logger?: StorageLogger
  slowQueryMs?: number
  /**
   * Which tenant this adapter writes.
   *
   * The domain has no tenant — an `InvestmentCase` describes a question, not an
   * owner organization — while the schema requires one on every institutional
   * record so that authentication is additive rather than a migration of every
   * populated table. Until users exist there is exactly one tenant, and this is
   * the seam where that changes.
   */
  tenantId?: string
  /** Git commit, injected at build. `dev` locally. */
  buildId?: string
}

/**
 * A repository container that owns a resource.
 *
 * `AnalysisRepositories` deliberately has no `close`: an in-memory store has
 * nothing to release, and putting a lifecycle method on the port would make
 * every consumer responsible for one. Infrastructure that owns a pool declares
 * it here, and only whoever constructed it needs to know.
 */
export interface ClosableRepositories extends AnalysisRepositories {
  /** Drains the pool. Nothing else may be called afterwards. */
  close(): Promise<void>
}

export interface PostgresRepositories extends ClosableRepositories {
  /**
   * A query surface for infrastructure that is not a repository.
   *
   * The organization reader and the provenance writer need one, and neither is
   * a repository — the organization is read-only reference data and provenance
   * describes the runtime rather than the analysis. Deliberately not on the
   * port: nothing in the application layer may reach it.
   */
  readonly sql: Queryable
}

/**
 * Builds the adapter, or fails having released everything it opened.
 *
 * **Asynchronous, deliberately.** A pool exists before the container can be
 * validated, so a refusal has to close it — and `pool.end()` returns a promise.
 * A synchronous factory could only launch that cleanup in the background and
 * hope, which for durable infrastructure is not good enough: repeated refused
 * constructions would accumulate connections nobody is waiting on.
 */
export async function createPostgresRepositories(
  options: PostgresRepositoriesOptions,
): Promise<PostgresRepositories> {
  const pool = createPostgresPool(options)
  const metrics = options.metrics ?? (noopMetrics as StorageMetrics)
  const tenantId = options.tenantId ?? 'system'

  const context: SqlContext = defaultSqlContext({
    metrics,
    logger: options.logger ?? noopStorageLogger,
    slowQueryMs: options.slowQueryMs ?? DEFAULT_SLOW_QUERY_MS,
  })

  const repositoriesFor = (scope: Scope): TransactionalAnalysisRepositories => ({
    cases: createCaseRepository(scope, context, tenantId),
    amendments: createCaseAmendmentRepository(scope, context, tenantId),
    theses: createThesisRepository(scope, context),
    assignments: createAssignmentRepository(scope, context, tenantId),
    runs: createRunRepository(scope, context, tenantId),
    claims: createClaimRepository(scope, context, tenantId),
    producedClaims: createProducedClaimRepository(scope, context, tenantId),
    producedSyntheses: createProducedSynthesisRepository(scope, context, tenantId),
    producedVerifications: createProducedVerificationRepository(scope, context, tenantId),
    producedChallenges: createProducedDevilsAdvocateRepository(scope, context, tenantId),
    producedPeerExaminations: createProducedPeerExaminationRepository(
      scope,
      context,
      tenantId,
    ),
    reviews: createReviewRepository(scope, context, tenantId),
    events: createEventRepository(scope, context, tenantId),
    evidence: createEvidenceRepository(scope, context),
    observations: createObservationRepository(scope, context),
    assemblies: createEvidenceAssemblyRepository(scope, context),
    results: createResultStore(scope, context),
    commands: createCommandLog(scope, context, tenantId),
    playbooks: createPlaybookRepository(scope, context),
    requirements: createRequirementRepository(scope, context, tenantId),
    aggregations: createAggregationRepository(scope, context, tenantId),
    submissions: createSubmissionRepository(scope, context, tenantId),
    decisions: createDecisionRepository(scope, context, tenantId),
  })

  /*
   * Reads and writes outside a transaction run against the pool — one
   * statement, one implicit transaction. A multi-statement read that needs a
   * consistent snapshot must use `withTransaction`.
   */
  const ambient = repositoriesFor(poolScope(pool, (p) => recordPoolGauges(p, metrics)))
  let closed = false

  /*
   * Before anything is handed out. A container missing a capability fails here
   * rather than on the first institutional command, and the pool it opened is
   * fully closed before the rejection surfaces.
   */
  try {
    assertRepositoriesComplete(ambient)
  } catch (error) {
    /*
     * Awaited, not launched. The construction error is what the caller needs,
     * so a cleanup failure is attached rather than thrown over it -- and
     * rather than swallowed, which would hide a pool that did not drain.
     */
    await pool.end().catch((cleanup: unknown) => {
      ;(error as { cleanupError?: unknown }).cleanupError = cleanup
    })
    throw error
  }

  return {
    ...ambient,
    sql: pool as unknown as Queryable,

    async withTransaction(operation) {
      recordPoolGauges(pool, metrics)
      return runInTransaction(pool, metrics, repositoriesFor, operation as never)
    },

    async provenance(): Promise<StorageProvenance> {
      /*
       * The schema version is READ, not assumed. An adapter reporting a
       * compiled-in constant would report what the code expects rather than
       * what the database actually is — which is the discrepancy the whole
       * coordinate exists to expose.
       */
      const row = await one<{ version: string; checksum: string }>(
        pool,
        context,
        'provenance',
        CONTAINER_SQL.schemaVersion,
      )

      return buildProvenance({
        adapterId: ADAPTER_ID,
        buildId: options.buildId ?? 'dev',
        queryCatalogHash: catalogHash(CATALOGS),
        schemaVersion: row?.version ?? 'unknown',
        schemaChecksum: row?.checksum ?? null,
        domainContractVersion: DOMAIN_CONTRACT_VERSION,
        commandContractVersion: COMMAND_CONTRACT_VERSION,
      })
    },

    /**
     * Drains the pool, once.
     *
     * `pg` throws "Called end on pool more than once", so an unguarded close
     * makes shutdown order matter: a container closed by both its owner and a
     * test teardown would fail the second time, and the failure would look like
     * a database problem rather than a lifecycle one. Closing something already
     * closed is not an error — it is the caller being careful.
     */
    async close() {
      if (closed) return
      closed = true
      await pool.end()
    },
  }
}
