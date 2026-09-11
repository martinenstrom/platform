/**
 * Stage 0 — transaction-capable repository ports.
 *
 * Two groups carry the weight. The **atomicity** tests prove a failed case
 * creation leaves nothing visible, which is what removes any need for
 * compensating deletion. The **lifetime** tests deliberately smuggle a
 * transaction-scoped repository out of its callback and call it afterwards;
 * that must fail loudly rather than write against a connection that has been
 * committed, rolled back or handed to someone else.
 *
 * The ordering tests exist for a different reason: this adapter is the
 * reference implementation the PostgreSQL one must match, and read
 * verification compares them. Anything relying on insertion order here becomes
 * a false divergence there.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildAssignment,
  buildTransitionEvent,
  type InvestmentCase,
} from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  ConflictingRecordError,
  TransactionClosedError,
  type AnalysisRepositories,
  type CaseRepository,
  type TransactionalAnalysisRepositories,
} from '~/application/analysis/repositories'
import {
  CommandPayloadConflictError,
  type CommandIntent,
} from '~/application/analysis/commandLog'
import { createInMemoryRepositories } from './inMemoryRepositories'

const NOW = '2026-07-28T09:00:00.000Z'

/**
 * A ledger intent, for tests that only need one to exist.
 *
 * The command foundation builds these properly; here they are fixtures.
 */
const commandIntent = (over: Partial<CommandIntent> = {}): CommandIntent => ({
  commandId: 'cmd-1',
  commandType: 'ProbeCommand',
  commandContractVersion: '2',
  category: 'workflow',
  payloadHash: 'hash-a',
  actor: {
    kind: 'employee',
    employeeId: 'research-director',
    agentPrincipalId: null,
    roleId: 'research-director',
    roleFunction: 'manager',
    departmentId: 'research-office',
    departmentIsGovernance: false,
    departmentHandles: ['aggregation'],
    authentication: 'system-asserted',
    organizationSeedVersion: '1',
  },
  mandate: { kind: 'any-employee' },
  authorizationBasis: 'employee-of-the-firm',
  initiator: { kind: 'orchestrator', orchestratorId: 'test' },
  correlationId: 'corr-1',
  occurredAt: NOW,
  receivedAt: NOW,
  ...over,
})

const committed = (resultRef: string) =>
  ({ state: 'committed', resultKind: 'case', resultRef, recordedAt: NOW }) as const

const investmentCase = (over: Partial<InvestmentCase> = {}): InvestmentCase => ({
  id: 'case-1',
  version: 1,
  subject: { kind: 'macro', ref: 'regime', displayName: 'Policy regime' },
  question: 'Is the market pricing the policy path correctly?',
  stage: 'intake',
  openedAt: NOW,
  ownerEmployeeId: 'research-director',
  participatingDepartmentIds: ['global-macro'],
  transitions: [],
  ...over,
})

const assignment = (id: string, over: Partial<ReturnType<typeof buildAssignment>> = {}) =>
  buildAssignment({
    id,
    caseId: 'case-1',
    departmentId: 'global-macro',
    brief: 'Regime read',
    status: 'queued',
    createdAt: NOW,
    priority: 5,
    ...over,
  })

const event = (id: string, at = NOW) =>
  buildTransitionEvent({
    eventId: id,
    subject: 'case',
    caseId: 'case-1',
    fromState: null,
    toState: 'intake',
    occurredAt: at,
    correlationId: 'corr-1',
    aggregateVersion: 1,
  })

let repos: AnalysisRepositories
beforeEach(() => {
  repos = createInMemoryRepositories()
})

/* -------------------------------------------------------------- atomicity */

describe('aggregate creation is atomic', () => {
  it('commits the whole workflow together', async () => {
    await repos.withTransaction(async (tx) => {
      await tx.cases.create(investmentCase())
      await tx.assignments.save(assignment('a-macro'))
      await tx.assignments.save(assignment('a-verify', { departmentId: 'verification' }))
      await tx.events.append(event('e1'))
      await tx.commands.record(commandIntent(), await repos.provenance())
    })

    expect(await repos.cases.get('case-1')).not.toBeNull()
    expect(await repos.assignments.listForCase('case-1')).toHaveLength(2)
    expect(await repos.events.listForCase('case-1')).toHaveLength(1)
    expect(await repos.commands.find('cmd-1')).not.toBeNull()
  })

  it('leaves none of the workflow visible when a later write fails', async () => {
    // The reason compensating deletion is unnecessary: the transaction simply
    // never happened.
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.cases.create(investmentCase())
        await tx.assignments.save(assignment('a-macro'))
        await tx.events.append(event('e1'))
        throw new Error('verification department does not exist')
      }),
    ).rejects.toThrow(/does not exist/)

    expect(await repos.cases.get('case-1')).toBeNull()
    expect(await repos.assignments.listForCase('case-1')).toEqual([])
    expect(await repos.events.listForCase('case-1')).toEqual([])
    expect(await repos.commands.find('cmd-1')).toBeNull()
  })

  /*
   * Decision coverage moves to C1D-1B with the repository it tests. The
   * shape it asserted no longer exists: migration 0020 restructures
   * `case_decisions`, and the C1D-1 review removed the governance
   * snapshot whose compliance field had to be invented.
   */

  it('preserves state committed before the failing transaction', async () => {
    await repos.cases.create(investmentCase())
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.assignments.save(assignment('a1'))
        throw new Error('boom')
      }),
    ).rejects.toThrow()

    // The rollback restores the snapshot, not an empty store.
    expect(await repos.cases.get('case-1')).not.toBeNull()
    expect(await repos.assignments.listForCase('case-1')).toEqual([])
  })

  it('returns the callback result only after the transaction closes', async () => {
    const result = await repos.withTransaction(async (tx) => {
      await tx.cases.create(investmentCase())
      return 'committed'
    })
    expect(result).toBe('committed')
  })

  it('propagates a concurrency conflict and rolls back with it', async () => {
    await repos.cases.create(investmentCase())
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.assignments.save(assignment('a1'))
        await tx.cases.save(investmentCase({ version: 2 }), 99)
        return 'never'
      }),
    ).rejects.toBeInstanceOf(ConcurrencyConflictError)

    expect(await repos.assignments.listForCase('case-1')).toEqual([])
  })
})

/* ------------------------------------------------------- transaction lifetime */

describe('transaction-scoped repositories cannot escape', () => {
  it('fails when a scoped repository is used after commit', async () => {
    let escaped: CaseRepository | null = null
    await repos.withTransaction(async (tx) => {
      escaped = tx.cases
      await tx.cases.create(investmentCase())
    })

    // Calling it now would run against a connection that has been committed.
    await expect(escaped!.get('case-1')).rejects.toBeInstanceOf(TransactionClosedError)
  })

  it('fails when a scoped repository is used after rollback', async () => {
    let escaped: CaseRepository | null = null
    await expect(
      repos.withTransaction(async (tx) => {
        escaped = tx.cases
        throw new Error('boom')
      }),
    ).rejects.toThrow()

    await expect(escaped!.get('case-1')).rejects.toBeInstanceOf(TransactionClosedError)
  })

  it('fails on a scoped WRITE after the transaction closed', async () => {
    // The dangerous direction: a late write would land outside any transaction.
    let escaped: TransactionalAnalysisRepositories | null = null
    await repos.withTransaction(async (tx) => {
      escaped = tx
    })

    await expect(escaped!.assignments.save(assignment('late'))).rejects.toBeInstanceOf(
      TransactionClosedError,
    )
    expect(await repos.assignments.listForCase('case-1')).toEqual([])
  })

  it('names the operation that was called too late', async () => {
    let escaped: TransactionalAnalysisRepositories | null = null
    await repos.withTransaction(async (tx) => {
      escaped = tx
    })
    await expect(escaped!.events.append(event('e-late'))).rejects.toThrow(
      /events\.append.*after its transaction closed/s,
    )
  })

  it('makes a nested transaction impossible to express', async () => {
    await repos.withTransaction(async (tx) => {
      // @ts-expect-error TransactionalAnalysisRepositories omits withTransaction
      expect(tx.withTransaction).toBeUndefined()
    })
  })

  it('leaves the outer repositories usable after a transaction', async () => {
    await repos.withTransaction(async (tx) => {
      await tx.cases.create(investmentCase())
    })
    // Only the scoped ones close. The container itself keeps working.
    expect(await repos.cases.get('case-1')).not.toBeNull()
  })
})

/* --------------------------------------------------------------- ordering */

describe('every list method has a deterministic order', () => {
  it('orders assignments by priority, then creation, then id', async () => {
    // Deliberately saved in an order that insertion-order would preserve and
    // the contract must not.
    await repos.assignments.save(assignment('z-low', { priority: 1 }))
    await repos.assignments.save(assignment('a-high', { priority: 9 }))
    await repos.assignments.save(assignment('m-high', { priority: 9 }))

    expect((await repos.assignments.listForCase('case-1')).map((a) => a.id)).toEqual([
      'a-high',
      'm-high',
      'z-low',
    ])
  })

  it('orders events by occurrence, then event id', async () => {
    await repos.events.append(event('e-b', '2026-07-28T10:00:00.000Z'))
    await repos.events.append(event('e-a', '2026-07-28T09:00:00.000Z'))
    await repos.events.append(event('e-c', '2026-07-28T09:00:00.000Z'))

    expect((await repos.events.listForCase('case-1')).map((e) => e.eventId)).toEqual([
      'e-a',
      'e-c',
      'e-b',
    ])
  })

  it('orders recent events newest first with a stable tie-breaker', async () => {
    await repos.events.append(event('e-a', '2026-07-28T09:00:00.000Z'))
    await repos.events.append(event('e-c', '2026-07-28T09:00:00.000Z'))
    await repos.events.append(event('e-b', '2026-07-28T10:00:00.000Z'))

    expect((await repos.events.recent(3)).map((e) => e.eventId)).toEqual([
      'e-b',
      'e-c',
      'e-a',
    ])
  })

  it('orders cases newest first, then by id', async () => {
    await repos.cases.create(
      investmentCase({ id: 'b', openedAt: '2026-07-28T09:00:00.000Z' }),
    )
    await repos.cases.create(
      investmentCase({ id: 'a', openedAt: '2026-07-28T09:00:00.000Z' }),
    )
    await repos.cases.create(
      investmentCase({ id: 'c', openedAt: '2026-07-29T09:00:00.000Z' }),
    )

    expect((await repos.cases.list()).map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })

  it('does not depend on insertion order anywhere', async () => {
    // Same data, opposite insertion sequence, identical output.
    const forward = createInMemoryRepositories()
    const backward = createInMemoryRepositories()
    const ids = ['a1', 'a2', 'a3']

    for (const id of ids) await forward.assignments.save(assignment(id))
    for (const id of [...ids].reverse()) await backward.assignments.save(assignment(id))

    expect((await forward.assignments.listForCase('case-1')).map((a) => a.id)).toEqual(
      (await backward.assignments.listForCase('case-1')).map((a) => a.id),
    )
  })
})

/* --------------------------------------------------------- command ledger */

describe('the command ledger', () => {
  it('returns the original intent for a replayed command id', async () => {
    const first = await repos.commands.record(commandIntent(), await repos.provenance())
    const replay = await repos.commands.record(commandIntent(), await repos.provenance())
    // The replay learns what the first call recorded rather than producing a
    // second entry.
    expect(replay.payloadHash).toBe(first.payloadHash)
    expect((await repos.commands.find('cmd-1'))?.outcomes).toEqual([])
  })

  it('refuses one command id carrying two different payloads', async () => {
    await repos.commands.record(commandIntent(), await repos.provenance())
    await expect(
      repos.commands.record(
        commandIntent({ payloadHash: 'hash-b' }),
        await repos.provenance(),
      ),
    ).rejects.toBeInstanceOf(CommandPayloadConflictError)
  })

  it('commits the entry and its effect together', async () => {
    await repos.withTransaction(async (tx) => {
      await tx.cases.create(investmentCase())
      await tx.commands.record(
        commandIntent({ caseId: 'case-1' }),
        await repos.provenance(),
      )
      await tx.commands.appendOutcome(
        'cmd-1',
        committed('case-1'),
        await repos.provenance(),
      )
    })
    expect(await repos.commands.find('cmd-1')).not.toBeNull()
    expect(await repos.cases.get('case-1')).not.toBeNull()
  })

  it('leaves no entry behind when the effect fails', async () => {
    // Otherwise a retry would find the command, assume the work was done, and
    // return a reference to a case that does not exist.
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.commands.record(commandIntent(), await repos.provenance())
        throw new Error('the case could not be created')
      }),
    ).rejects.toThrow()
    expect(await repos.commands.find('cmd-1')).toBeNull()
  })
})

/* ----------------------------------------------------------------- claims */

describe('claims are stored beside their run', () => {
  const claim = {
    id: 'claim-1',
    type: 'observation' as const,
    statement: 'The ECB has held since June.',
    evidenceRefs: [{ setId: 's', observationId: 'o', contentHash: 'h' }],
    contradictingEvidenceRefs: [],
    confidence: { level: 'high' as const, basis: [] },
    temporalScope: { asOf: NOW },
    status: 'supported' as const,
  }

  it('finds claims by run and by case', async () => {
    await repos.claims.save(claim, 'case-1', 'run-1')
    expect(await repos.claims.listForRun('run-1')).toHaveLength(1)
    expect(await repos.claims.listForCase('case-1')).toHaveLength(1)
  })

  it('is write-once, and says so rather than swallowing the change', async () => {
    /*
     * A cited claim must not change underneath the citation — and the caller
     * must be TOLD, not quietly handed the old one. Returning the stored claim
     * silently was the Stage 2 divergence: PostgreSQL raised and the
     * authoritative in-memory store did not, so a dual write would have
     * disagreed about whether anything was wrong.
     */
    await repos.claims.save(claim, 'case-1', 'run-1')
    await expect(
      repos.claims.save({ ...claim, statement: 'changed' }, 'case-1', 'run-1'),
    ).rejects.toBeInstanceOf(ConflictingRecordError)

    expect((await repos.claims.get('claim-1'))?.statement).toBe(
      'The ECB has held since June.',
    )
  })

  it('accepts an identical replay', async () => {
    await repos.claims.save(claim, 'case-1', 'run-1')
    const replay = await repos.claims.save(claim, 'case-1', 'run-1')
    expect(replay.statement).toBe('The ECB has held since June.')
  })
})
