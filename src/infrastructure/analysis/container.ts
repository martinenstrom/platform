/**
 * The analysis composition root.
 *
 * **PostgreSQL is the only runtime store.** There is no in-memory fallback and
 * no partially configured mode: a system that "works" while storing nothing is
 * worse than one that refuses to start, because the first is discovered later
 * and by someone else.
 *
 * The in-memory adapter remains the unit-test reference and the semantic parity
 * oracle. A test may construct it explicitly; this root will not select it.
 */

import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgres/postgresRepositories'
import { createOrganizationReader } from './postgres/organizationReader'
import { ensureProvenance } from './postgres/provenance'
import { defaultSqlContext } from './postgres/sql'
import { loadMigrations } from './postgres/migrations'
import {
  createLiveContributionProvider,
  LIVE_MAX_OUTPUT_TOKENS,
  LIVE_MODEL_ID,
} from './providers/live'
import {
  createLiveSynthesisProvider,
  LIVE_SYNTHESIS_MAX_OUTPUT_TOKENS,
} from './providers/liveSynthesis'
import type { OrganizationReader } from '~/application/analysis/organizationReader'
import type { StorageProvenance } from '~/application/analysis/repositories'
import type { CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  createFinancialOsSystem,
  type FinancialOsSystem,
} from '~/application/analysis/domainSystem'
import type {
  StorageLogger,
  StorageMetrics,
} from '~/application/analysis/storageObservability'
import type { Clock } from '~/domain/shared/clock'

export interface AnalysisContainerOptions {
  /** Required. Read from the environment, never logged. */
  connectionString?: string
  /** Git commit, injected at build. `dev` locally. */
  buildId?: string
  tenantId?: string
  clock: Clock
  metrics?: StorageMetrics
  logger?: StorageLogger
  /**
   * The schema version this build expects.
   *
   * Defaults to the highest migration on disk, so a runtime deployed against
   * an older database refuses rather than failing later on a missing column.
   */
  expectedSchemaVersion?: string
}

export interface AnalysisContainer {
  repositories: PostgresRepositories
  organization: OrganizationReader
  provenance: StorageProvenance
  /** Everything `runCommand` needs, assembled once. */
  commandDeps(): Promise<CommandDeps>
  /**
   * Financial OS as a host sees it.
   *
   * The seam for the system above this one: a host constructs the container
   * and takes the port, never the repositories. Same runtime, same commands,
   * same ledger — the port adds no way into the firm that the product lacks.
   */
  domainSystem(): FinancialOsSystem
  close(): Promise<void>
}

export class AnalysisConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalysisConfigurationError'
  }
}

export class SchemaVersionMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super(
      `This build expects schema version ${expected}; the database is at ` +
        `${actual ?? 'no version at all'}. Run the migrations as the schema ` +
        `owner — the runtime holds no grant to.`,
    )
    this.name = 'SchemaVersionMismatchError'
  }
}

/**
 * Builds the runtime.
 *
 * Every refusal happens here, at construction, and loudly. Nothing degrades
 * into a working-looking state.
 */
export async function createAnalysisContainer(
  options: AnalysisContainerOptions,
): Promise<AnalysisContainer> {
  if (!options.connectionString) {
    throw new AnalysisConfigurationError(
      'No database connection string. The analysis runtime stores every ' +
        'institutional record in PostgreSQL and has no in-memory fallback; ' +
        'starting without one would acknowledge work it cannot keep.',
    )
  }

  const tenantId = options.tenantId ?? 'system'
  const repositories = await createPostgresRepositories({
    connectionString: options.connectionString,
    buildId: options.buildId ?? 'dev',
    tenantId,
    ...(options.metrics ? { metrics: options.metrics } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  })

  try {
    const provenance = await repositories.provenance()

    const expected =
      options.expectedSchemaVersion ??
      (await loadMigrations()).at(-1)?.version ??
      provenance.schemaVersion
    if (provenance.schemaVersion !== expected) {
      throw new SchemaVersionMismatchError(
        expected ?? 'unknown',
        provenance.schemaVersion,
      )
    }

    const context = defaultSqlContext({
      ...(options.metrics ? { metrics: options.metrics } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
    })
    const organization = createOrganizationReader(repositories.sql, context, tenantId)

    // Throws `OrganizationNotSeededError` when the firm is missing: commands
    // resolve their actors against it, so there is nothing to start without.
    // Loaded here rather than lazily, so a missing organization is a refusal to
    // start rather than a failure on the first command.
    await organization.load()

    await ensureProvenance(repositories.sql, context, provenance, options.clock.isoNow())

    const commandDeps = async (): Promise<CommandDeps> => {
      const current = await organization.load()
      return {
        repositories,
        organization: current.organization,
        organizationSeedVersion: current.seedVersion,
        provenance,
        now: () => options.clock.isoNow(),
      }
    }

    return {
      repositories,
      organization,
      provenance,
      commandDeps,

      domainSystem: () =>
        createFinancialOsSystem({
          repositories,
          commandDeps,
          now: () => options.clock.isoNow(),
          /*
           * The firm may be advanced on the person's word (host `begin`).
           * The provider is the live one the product commissions with, built
           * only when a credential exists; without one every desk is withheld
           * as `no-provider`, and the person is told so rather than promised.
           */
          advance: {
            provider: () => {
              const apiKey = process.env.ANTHROPIC_API_KEY
              if (!apiKey) return null
              const live = createLiveContributionProvider({
                apiKey,
                model: LIVE_MODEL_ID,
                maxTokens: LIVE_MAX_OUTPUT_TOKENS,
                loadEvidenceSet: (id) => repositories.evidence.get(id),
              })
              /*
               * The orchestrator records an unclassified throw as
               * `provider-error` and keeps nothing of the message — correct
               * for the record, blind for whoever must find out why. The
               * message goes to the server log here, on the way through.
               */
              return {
                ...live,
                contribute: async (request) => {
                  try {
                    return await live.contribute(request)
                  } catch (error) {
                    const why = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
                    console.error(`[analysis] [begin] provider failed for ${request.departmentId}: ${why.slice(0, 400)}`)
                    throw error
                  }
                },
              }
            },
            synthesisProvider: (loadContext) => {
              const apiKey = process.env.ANTHROPIC_API_KEY
              if (!apiKey) return null
              return createLiveSynthesisProvider({
                apiKey,
                model: LIVE_MODEL_ID,
                maxTokens: LIVE_SYNTHESIS_MAX_OUTPUT_TOKENS,
                loadContext,
              })
            },
            log: (line) => console.log(`[analysis] ${line}`),
          },
        }),

      close: () => repositories.close(),
    }
  } catch (error) {
    /*
     * A container that failed to build owns nothing. Releasing the pool here
     * keeps a refused startup from leaking connections — and a failure to
     * release is attached to the original error rather than replacing it,
     * because what the caller needs to know is why startup was refused.
     */
    await repositories.close().catch((cleanup: unknown) => {
      ;(error as { cleanupError?: unknown }).cleanupError = cleanup
    })
    throw error
  }
}
