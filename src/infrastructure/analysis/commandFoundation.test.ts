/**
 * The command foundation, driven by a probe.
 *
 * `ProbeCommand` exists only here. Shipping a real workflow command to exercise
 * the foundation would put a workflow decision inside a foundation stage, and
 * the first real command deserves its own gate.
 *
 * What is being proved: the four outcomes stay distinct, intent and outcome
 * commit with the effect, a refusal is durable without the effect it refused,
 * an identical replay returns the original, and a reused id carrying a
 * different payload fails loudly.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { buildRole, type InvestmentCase, type Organization } from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { StorageError } from '~/application/analysis/repositories'
import { reject, type CommandEnvelope } from '~/application/analysis/commands/envelope'
import type { CommandDefinition } from '~/application/analysis/commands/definition'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { createInMemoryRepositories } from './inMemoryRepositories'

const AT = '2026-07-28T09:00:00.000Z'

/* ------------------------------------------------------------ organization */

const organization: Organization = {
  id: 'firm',
  name: 'Firm',
  chiefEmployeeId: 'cio',
  roles: [
    buildRole({
      id: 'chief-investment-officer',
      title: 'CIO',
      function: 'executive',
      responsibilities: [],
      canBlockPublication: false,
    }),
    buildRole({
      id: 'research-director',
      title: 'Research Director',
      function: 'manager',
      responsibilities: [],
      canBlockPublication: false,
    }),
  ],
  departments: [
    {
      id: 'executive',
      name: 'Executive',
      managerEmployeeId: 'cio',
      handles: [],
      isGovernance: false,
    },
    {
      id: 'research-office',
      name: 'Research Office',
      managerEmployeeId: 'research-director',
      handles: ['aggregation'],
      isGovernance: false,
    },
  ],
  teams: [],
  employees: [
    {
      id: 'cio',
      displayName: 'CIO',
      roleId: 'chief-investment-officer',
      departmentId: 'executive',
      seniority: 'chief',
    },
    {
      id: 'research-director',
      displayName: 'Research Director',
      roleId: 'research-director',
      departmentId: 'research-office',
      reportsTo: 'cio',
      seniority: 'head',
    },
  ],
}

/* -------------------------------------------------------------- the probe */

interface ProbeInput {
  caseId: string
  question: string
  /** Makes the body reject, for the rejection path. */
  refuse?: boolean
  /** Makes the body fail operationally, for the failure path. */
  explode?: boolean
}

const investmentCase = (input: ProbeInput): InvestmentCase => ({
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

const probe: CommandDefinition<ProbeInput, InvestmentCase> = {
  type: 'ProbeCommand',
  versionPolicy: 'refuses-expected-version',
  mandate: () => ({ kind: 'any-employee' }),
  scope: (input) => ({ caseId: input.caseId }),
  payload: (input) => ({ question: input.question }),
  async execute(repositories, _context, input) {
    if (input.refuse) reject('illegal-prior-state', 'the probe was asked to refuse')
    if (input.explode) throw new StorageError('the probe exploded', 'ProbeCommand')

    const created = await repositories.cases.create(investmentCase(input))
    return { value: created, resultKind: 'case', resultRef: created.id }
  },
  async rehydrate(repositories, resultRef) {
    return (await repositories.cases.get(resultRef))!
  },
}

/** A version-guarded probe, for the `expectedVersion` policy tests. */
const guardedProbe: CommandDefinition<ProbeInput, InvestmentCase> = {
  ...probe,
  type: 'GuardedProbeCommand',
  versionPolicy: 'requires-expected-version',
}

/* ---------------------------------------------------------------- harness */

let repos: AnalysisRepositories
let deps: CommandDeps

beforeEach(async () => {
  repos = createInMemoryRepositories()
  deps = {
    repositories: repos,
    organization,
    organizationSeedVersion: '1',
    provenance: await repos.provenance(),
    now: () => AT,
  }
})

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-1',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'test' },
  occurredAt: AT,
  ...over,
})

const input: ProbeInput = { caseId: 'case-1', question: 'Is the path mispriced?' }

/* ------------------------------------------------------------- committed */

describe('a committed command', () => {
  it('returns the value and the result reference', async () => {
    const result = await runCommand(probe, input, envelope(), deps)

    expect(result.outcome).toBe('committed')
    if (result.outcome !== 'committed') return
    expect(result.value.id).toBe('case-1')
    expect(result.resultKind).toBe('case')
    expect(result.resultRef).toBe('case-1')
  })

  it('records intent and outcome with the effect', async () => {
    await runCommand(probe, input, envelope(), deps)

    const entry = await repos.commands.find('cmd-1')
    expect(entry?.intent.commandType).toBe('ProbeCommand')
    expect(entry?.outcomes).toEqual([
      { state: 'committed', resultKind: 'case', resultRef: 'case-1', recordedAt: AT },
    ])
    expect(await repos.cases.get('case-1')).not.toBeNull()
  })

  it('snapshots the actor as the organization described them', async () => {
    await runCommand(probe, input, envelope(), deps)

    const actor = (await repos.commands.find('cmd-1'))!.intent.actor
    expect(actor).toMatchObject({
      kind: 'employee',
      employeeId: 'research-director',
      roleId: 'research-director',
      departmentId: 'research-office',
      authentication: 'system-asserted',
      organizationSeedVersion: '1',
    })
  })

  it('keeps the initiator distinct from the accountable actor', async () => {
    // The orchestrator decided the step was due. It did not do the work.
    await runCommand(probe, input, envelope(), deps)

    const intent = (await repos.commands.find('cmd-1'))!.intent
    expect(intent.initiator).toEqual({ kind: 'orchestrator', orchestratorId: 'test' })
    expect(intent.actor.employeeId).toBe('research-director')
  })

  it('records why it was allowed', async () => {
    await runCommand(probe, input, envelope(), deps)
    expect((await repos.commands.find('cmd-1'))!.intent.authorizationBasis).toBe(
      'employee-of-the-firm',
    )
  })
})

/* --------------------------------------------------------------- replay */

describe('replaying a command id', () => {
  it('returns the original outcome without executing again', async () => {
    await runCommand(probe, input, envelope(), deps)
    await repos.cases.save(
      { ...(await repos.cases.get('case-1'))!, version: 2, stage: 'research' },
      1,
    )

    const replay = await runCommand(probe, input, envelope(), deps)
    expect(replay.outcome).toBe('committed')
    if (replay.outcome !== 'committed') return
    // Re-read, not re-executed: the case is at the version the replay found.
    expect(replay.value.stage).toBe('research')
  })

  it('refuses one command id carrying a different payload', async () => {
    await runCommand(probe, input, envelope(), deps)

    const conflicting = await runCommand(
      probe,
      { ...input, question: 'A different question' },
      envelope(),
      deps,
    )
    expect(conflicting.outcome).toBe('rejected')
    if (conflicting.outcome !== 'rejected') return
    expect(conflicting.rejection.code).toBe('payload-conflict')
  })

  it('treats the same payload under a new id as a new command', async () => {
    await runCommand(probe, input, envelope(), deps)
    const second = await runCommand(
      probe,
      { ...input, caseId: 'case-2' },
      envelope({ commandId: 'cmd-2' }),
      deps,
    )
    expect(second.outcome).toBe('committed')
  })
})

/* ------------------------------------------------------------- rejected */

describe('a rejected command', () => {
  it('is not a failure', async () => {
    const result = await runCommand(probe, { ...input, refuse: true }, envelope(), deps)

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('illegal-prior-state')
  })

  it('is recorded durably, without the effect it refused', async () => {
    await runCommand(probe, { ...input, refuse: true }, envelope(), deps)

    const entry = await repos.commands.find('cmd-1')
    expect(entry?.outcomes).toEqual([
      { state: 'rejected', reasonCode: 'illegal-prior-state', recordedAt: AT },
    ])
    // The forbidden effect did not come with the record of the refusal.
    expect(await repos.cases.get('case-1')).toBeNull()
  })

  it('refuses an actor the organization has never heard of', async () => {
    const result = await runCommand(
      probe,
      input,
      envelope({ actor: { kind: 'employee', employeeId: 'impostor' } }),
      deps,
    )

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('unknown-actor')
    // Nothing is written against an employee who is not one.
    expect(result.durablyRecorded).toBe(false)
    expect(await repos.commands.find('cmd-1')).toBeNull()
  })

  it('refuses a system actor for an institutional act', async () => {
    const chiefOnly: CommandDefinition<ProbeInput, InvestmentCase> = {
      ...probe,
      type: 'ChiefProbeCommand',
      mandate: () => ({ kind: 'chief-decision' }),
    }

    const result = await runCommand(
      chiefOnly,
      input,
      envelope({ actor: { kind: 'system', systemId: 'scheduler', reason: 'sweep' } }),
      deps,
    )
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('not-authorised')
  })

  it('refuses an employee without the mandate', async () => {
    const chiefOnly: CommandDefinition<ProbeInput, InvestmentCase> = {
      ...probe,
      type: 'ChiefProbeCommand',
      mandate: () => ({ kind: 'chief-decision' }),
    }

    const result = await runCommand(chiefOnly, input, envelope(), deps)
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.code).toBe('not-authorised')
    expect(result.durablyRecorded).toBe(true)
  })
})

/* --------------------------------------------------------------- failed */

describe('a failed command', () => {
  it('is distinguishable from a rejection', async () => {
    const result = await runCommand(probe, { ...input, explode: true }, envelope(), deps)

    expect(result.outcome).toBe('failed')
    if (result.outcome !== 'failed') return
    expect(result.error).toBeInstanceOf(StorageError)
  })

  it('records the failure when the store is reachable', async () => {
    await runCommand(probe, { ...input, explode: true }, envelope(), deps)

    const entry = await repos.commands.find('cmd-1')
    expect(entry?.outcomes[0]).toMatchObject({ state: 'failed' })
    expect(await repos.cases.get('case-1')).toBeNull()
  })

  it('says so when the failure could not be recorded', async () => {
    /*
     * The honest boundary: a store cannot be the durable record of the fact
     * that it could not be reached. When the ledger write also fails, the
     * caller is told the outcome was not recorded rather than being given a
     * guarantee nobody can honour.
     */
    const unreachable: AnalysisRepositories = {
      ...repos,
      withTransaction: async () => {
        throw new StorageError('the database is unreachable', 'withTransaction')
      },
    }

    const result = await runCommand(probe, input, envelope(), {
      ...deps,
      repositories: unreachable,
    })

    expect(result.outcome).toBe('failed')
    if (result.outcome !== 'failed') return
    expect(result.durablyRecorded).toBe(false)
  })
})

/* ------------------------------------------------------ version declaration */

describe('the expectedVersion declaration', () => {
  it('refuses a guarded command that omits it', async () => {
    const result = await runCommand(guardedProbe, input, envelope(), deps)

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.detail).toMatch(/requires an expected version/)
  })

  it('refuses an unguarded command that supplies it', async () => {
    // Ignoring a stray version would offer concurrency protection that does
    // not exist.
    const result = await runCommand(probe, input, envelope({ expectedVersion: 1 }), deps)

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') return
    expect(result.rejection.detail).toMatch(/must not carry an expected version/)
  })

  it('accepts a guarded command that supplies it', async () => {
    const result = await runCommand(
      guardedProbe,
      input,
      envelope({ expectedVersion: 1 }),
      deps,
    )
    expect(result.outcome).toBe('committed')
  })
})

/* ---------------------------------------------------------- payload identity */

describe('payload identity', () => {
  it('ignores delivery detail that does not change the request', async () => {
    // A retry from a different correlation is the same request.
    await runCommand(probe, input, envelope(), deps)
    const replay = await runCommand(
      probe,
      input,
      envelope({ correlationId: 'corr-2', initiator: { kind: 'system', systemId: 'x' } }),
      deps,
    )
    expect(replay.outcome).toBe('committed')
  })

  it('covers the accountable actor', async () => {
    // The same request by a different person is a different request.
    await runCommand(probe, input, envelope(), deps)
    const other = await runCommand(
      probe,
      input,
      envelope({ actor: { kind: 'employee', employeeId: 'cio' } }),
      deps,
    )

    expect(other.outcome).toBe('rejected')
    if (other.outcome !== 'rejected') return
    expect(other.rejection.code).toBe('payload-conflict')
  })
})
