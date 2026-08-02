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
  CASE_SQL,
  THESIS_SQL,
  createCaseRepository,
  createThesisRepository,
} from './caseRepositories'
import {
  EVIDENCE_SQL,
  RESULT_SQL,
  createEvidenceRepository,
  createResultStore,
} from './evidenceRepositories'
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
  type Queryable,
  type SqlContext,
} from './sql'
import { buildProvenance, PROVENANCE_SQL } from './provenance'
import { poolScope, runInTransaction, type Scope } from './transaction'
import {
  ASSIGNMENT_SQL,
  CLAIM_SQL,
  RUN_SQL,
  createAssignmentRepository,
  createClaimRepository,
  createRunRepository,
} from './workRepositories'

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

/** Every statement the adapter can issue, for `queryCatalogHash`. See D-S20. */
const CATALOGS = [
  CONTAINER_SQL,
  COMMAND_SQL,
  PROVENANCE_SQL,
  CASE_SQL,
  THESIS_SQL,
  ASSIGNMENT_SQL,
  RUN_SQL,
  CLAIM_SQL,
  EVIDENCE_SQL,
  RESULT_SQL,
  COMMAND_SQL,
  REVIEW_SQL,
  EVENT_SQL,
  PLAYBOOK_SQL,
  REQUIREMENT_SQL,
  AGGREGATION_SQL,
]

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

export function createPostgresRepositories(
  options: PostgresRepositoriesOptions,
): PostgresRepositories {
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
    theses: createThesisRepository(scope, context),
    assignments: createAssignmentRepository(scope, context, tenantId),
    runs: createRunRepository(scope, context, tenantId),
    claims: createClaimRepository(scope, context, tenantId),
    reviews: createReviewRepository(scope, context, tenantId),
    events: createEventRepository(scope, context, tenantId),
    evidence: createEvidenceRepository(scope, context),
    results: createResultStore(scope, context),
    commands: createCommandLog(scope, context, tenantId),
    playbooks: createPlaybookRepository(scope, context),
    requirements: createRequirementRepository(scope, context, tenantId),
    aggregations: createAggregationRepository(scope, context, tenantId),
  })

  /*
   * Reads and writes outside a transaction run against the pool — one
   * statement, one implicit transaction. A multi-statement read that needs a
   * consistent snapshot must use `withTransaction`.
   */
  const ambient = repositoriesFor(poolScope(pool, (p) => recordPoolGauges(p, metrics)))

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

    async close() {
      await pool.end()
    },
  }
}
