/**
 * The composition root, and restart durability.
 *
 * Two things are being proved. That the runtime refuses to start in every way
 * it can be misconfigured — loudly, at construction, with no mode where it
 * appears to work while storing nothing. And that a command survives the
 * process: the harness here is what every later stage reuses to show that no
 * state, ordering or eligibility depends on memory.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AnalysisConfigurationError,
  createAnalysisContainer,
  SchemaVersionMismatchError,
  type AnalysisContainer,
} from './container'
import { OrganizationNotSeededError } from '~/application/analysis/organizationReader'
import { runCommand } from '~/application/analysis/commands/runCommand'
import type { CommandDefinition } from '~/application/analysis/commands/definition'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import type { InvestmentCase } from '~/domain/analysis'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './postgres/testDatabase'
import { migrate } from './postgres/migrations'

const AT = '2026-07-28T09:00:00.000Z'
const clock = {
  isoNow: () => AT,
  epochMs: () => Date.parse(AT),
  now: () => new Date(AT),
}

let db: TestDatabase
let appUrl: string
const opened: AnalysisContainer[] = []

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
}, 180_000)

afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close().catch(() => {})))
})

async function build(over: Record<string, unknown> = {}) {
  const container = await createAnalysisContainer({
    connectionString: appUrl,
    buildId: 'test-build',
    clock,
    ...over,
  })
  opened.push(container)
  return container
}

/* ------------------------------------------------------------- the probe */

interface ProbeInput {
  caseId: string
  question: string
}

const probe: CommandDefinition<ProbeInput, InvestmentCase> = {
  type: 'ProbeCommand',
  versionPolicy: 'refuses-expected-version',
  reasonPolicy: 'optional',
  category: 'workflow',
  mandate: () => ({ kind: 'any-employee' }),
  scope: (input) => ({ caseId: input.caseId }),
  payload: (input) => ({ question: input.question }),
  async execute(repositories, _context, input) {
    const created = await repositories.cases.create({
      id: input.caseId,
      version: 1,
      subject: { kind: 'macro', ref: 'regime', displayName: 'Policy regime' },
      question: input.question,
      stage: 'intake',
      openedAt: AT,
      ownerEmployeeId: 'research-director',
      participatingDepartmentIds: ['research-office'],
      transitions: [],
    })
    return { value: created, resultKind: 'case', resultRef: created.id }
  },
  async rehydrate(repositories, resultRef) {
    return (await repositories.cases.get(resultRef))!
  },
}

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-restart-1',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'test' },
  occurredAt: AT,
  ...over,
})

/* --------------------------------------------------------------- refusals */

describe('the runtime refuses to start when it cannot do its job', () => {
  it('refuses without a connection string', async () => {
    // No fallback to memory. A system that "works" while storing nothing is
    // worse than one that will not start.
    await expect(
      createAnalysisContainer({ connectionString: undefined, clock }),
    ).rejects.toBeInstanceOf(AnalysisConfigurationError)
  })

  it('refuses when the schema is older than the build expects', async () => {
    await expect(build({ expectedSchemaVersion: '9999' })).rejects.toBeInstanceOf(
      SchemaVersionMismatchError,
    )
  })

  it('names both versions so the mismatch is actionable', async () => {
    await expect(build({ expectedSchemaVersion: '9999' })).rejects.toThrow(
      /expects schema version 9999.*is at 0024/s,
    )
  })

  it('refuses when the organization is not seeded', async () => {
    // Commands resolve their actors against it, so there is nothing to start.
    const bare = await createTestDatabase()
    try {
      await migrate(bare.owner)
      await bare.owner.query('DELETE FROM analysis.organizations')
      const url = await bare.loginUrlFor(APP_ROLE)

      await expect(
        createAnalysisContainer({ connectionString: url, clock }),
      ).rejects.toBeInstanceOf(OrganizationNotSeededError)
    } finally {
      await bare.drop()
    }
  }, 60_000)

  it('releases the pool when construction fails', async () => {
    // A container that failed to build owns nothing, and a refused startup must
    // not leak connections.
    await expect(build({ expectedSchemaVersion: '9999' })).rejects.toThrow()

    const { rows } = await db.owner.query(
      `SELECT count(*)::int n FROM pg_stat_activity
       WHERE application_name = 'finos-analysis' AND datname = $1`,
      [db.name],
    )
    expect(rows[0].n).toBe(0)
  })
})

/* ------------------------------------------------------------ provenance */

describe('storage provenance', () => {
  it('is recorded and derived rather than hand-maintained', async () => {
    const container = await build()

    expect(container.provenance.buildId).toBe('test-build')
    expect(container.provenance.schemaVersion).toBe('0024')
    expect(container.provenance.commandContractVersion).toBe('2')
    // Derived: nobody types this, so it cannot drift from what it describes.
    expect(container.provenance.adapterVersion).toMatch(/^[0-9a-f]{16}$/)
    expect(container.provenance.provenanceId).toMatch(/^[0-9a-f]{64}$/)

    const { rows } = await db.owner.query(
      'SELECT build_id, command_contract_version FROM analysis.storage_provenance WHERE id = $1',
      [container.provenance.provenanceId],
    )
    expect(rows[0]).toMatchObject({
      build_id: 'test-build',
      command_contract_version: '2',
    })
  })

  it('changes when the build changes', async () => {
    const first = await build({ buildId: 'build-a' })
    const second = await build({ buildId: 'build-b' })

    expect(first.provenance.adapterVersion).not.toBe(second.provenance.adapterVersion)
    expect(first.provenance.provenanceId).not.toBe(second.provenance.provenanceId)
  })
})

/* -------------------------------------------------------------- the firm */

describe('the organization', () => {
  it('is loaded, validated and resolvable', async () => {
    const container = await build()
    const { organization, seedVersion } = await container.organization.load()

    expect(seedVersion).toBe('1')
    expect(organization.chiefEmployeeId).toBe('cio')
    expect(organization.departments).toHaveLength(15)
    expect(
      organization.departments.filter((department) => department.isGovernance),
    ).toHaveLength(4)
  })
})

/* -------------------------------------------------------- restart durability */

describe('a command survives the process', () => {
  it('is still there, with its ledger entry, after a restart', async () => {
    await db.truncateAnalysisData()

    const before = await build()
    const result = await runCommand(
      probe,
      { caseId: 'case-restart', question: 'Does this survive?' },
      envelope(),
      await before.commandDeps(),
    )
    expect(result.outcome).toBe('committed')
    await before.close()

    // A new container against the same database: a real process boundary as
    // far as the runtime is concerned.
    const after = await build()

    const stored = await after.repositories.cases.get('case-restart')
    expect(stored?.question).toBe('Does this survive?')

    const entry = await after.repositories.commands.find('cmd-restart-1')
    expect(entry?.intent.commandType).toBe('ProbeCommand')
    expect(entry?.intent.actor.employeeId).toBe('research-director')
    expect(entry?.outcomes[0]).toMatchObject({
      state: 'committed',
      resultRef: 'case-restart',
    })
  })

  it('replays to the original outcome across the restart', async () => {
    await db.truncateAnalysisData()

    const before = await build()
    await runCommand(
      probe,
      { caseId: 'case-replay', question: 'Original' },
      envelope({ commandId: 'cmd-replay' }),
      await before.commandDeps(),
    )
    await before.close()

    const after = await build()
    const replay = await runCommand(
      probe,
      { caseId: 'case-replay', question: 'Original' },
      envelope({ commandId: 'cmd-replay' }),
      await after.commandDeps(),
    )

    expect(replay.outcome).toBe('committed')
    if (replay.outcome !== 'committed') return
    expect(replay.value.question).toBe('Original')

    const { rows } = await db.owner.query(
      'SELECT count(*)::int n FROM analysis.commands WHERE command_id = $1',
      ['cmd-replay'],
    )
    expect(rows[0].n).toBe(1)
  })

  it('refuses a reused command id carrying a different payload, after restart', async () => {
    await db.truncateAnalysisData()

    const before = await build()
    await runCommand(
      probe,
      { caseId: 'case-conflict', question: 'Original' },
      envelope({ commandId: 'cmd-conflict' }),
      await before.commandDeps(),
    )
    await before.close()

    const after = await build()
    const conflicting = await runCommand(
      probe,
      { caseId: 'case-conflict', question: 'Something else' },
      envelope({ commandId: 'cmd-conflict' }),
      await after.commandDeps(),
    )

    expect(conflicting.outcome).toBe('rejected')
    if (conflicting.outcome !== 'rejected') return
    expect(conflicting.rejection.code).toBe('payload-conflict')
  })
})

/* ------------------------------------------------------ ledger immutability */

describe('the ledger cannot be rewritten', () => {
  it('refuses to edit a recorded command, even as the owner', async () => {
    await db.truncateAnalysisData()
    const container = await build()
    await runCommand(
      probe,
      { caseId: 'case-immutable', question: 'q' },
      envelope({ commandId: 'cmd-immutable' }),
      await container.commandDeps(),
    )

    // The runtime holds no UPDATE grant; the trigger covers everyone else.
    await expect(
      db.owner.query(
        `UPDATE analysis.commands SET command_type = 'Rewritten' WHERE command_id = $1`,
        ['cmd-immutable'],
      ),
    ).rejects.toThrow(/cannot be update/)
  })

  it('refuses a second outcome once one is terminal', async () => {
    await db.truncateAnalysisData()
    const container = await build()
    await runCommand(
      probe,
      { caseId: 'case-terminal', question: 'q' },
      envelope({ commandId: 'cmd-terminal' }),
      await container.commandDeps(),
    )

    await expect(
      container.repositories.commands.appendOutcome(
        'cmd-terminal',
        { state: 'rejected', reasonCode: 'not-authorised', recordedAt: AT },
        container.provenance,
      ),
    ).rejects.toThrow(/terminal/)
  })
})
