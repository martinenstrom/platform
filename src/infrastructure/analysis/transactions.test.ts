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
  TransactionClosedError,
  type AnalysisRepositories,
  type CaseRepository,
  type TransactionalAnalysisRepositories,
} from '~/application/analysis/repositories'
import { createInMemoryRepositories } from './inMemoryRepositories'

const NOW = '2026-07-28T09:00:00.000Z'

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
      await tx.idempotency.reserve({
        key: 'open:case-1',
        commandType: 'open-case',
        resultRef: 'case-1',
        createdAt: NOW,
      })
    })

    expect(await repos.cases.get('case-1')).not.toBeNull()
    expect(await repos.assignments.listForCase('case-1')).toHaveLength(2)
    expect(await repos.events.listForCase('case-1')).toHaveLength(1)
    expect(await repos.idempotency.get('open:case-1')).not.toBeNull()
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
    expect(await repos.idempotency.get('open:case-1')).toBeNull()
  })

  it('rolls back a partial decision', async () => {
    // A CaseDecision is among the highest-value records. A half-written one
    // must never become visible.
    await repos.cases.create(investmentCase())
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.decisions.save({
          caseId: 'case-1',
          aggregateVersion: 3,
          decidedAt: NOW,
          decidedByEmployeeId: 'cio',
          selectedRevisionId: 'rev-1',
          notSelectedRevisionIds: [],
          rejectedRevisionIds: [],
          evidenceSetId: 'set-1',
          governance: {
            verification: 'verified',
            unresolvedChallengeCount: 0,
            compliance: 'approved',
            risk: 'accepted',
          },
          rationale: 'x',
          unresolvedDissent: [],
          reconsiderationTriggers: [],
        })
        throw new Error('decision event failed to append')
      }),
    ).rejects.toThrow()

    expect(await repos.decisions.getForCase('case-1')).toBeNull()
  })

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

/* ------------------------------------------------------------ idempotency */

describe('idempotency', () => {
  it('returns the original record for a replayed key', async () => {
    const first = await repos.idempotency.reserve({
      key: 'open:case-1',
      commandType: 'open-case',
      resultRef: 'case-1',
      createdAt: NOW,
    })
    const replay = await repos.idempotency.reserve({
      key: 'open:case-1',
      commandType: 'open-case',
      resultRef: 'case-DIFFERENT',
      createdAt: '2026-07-28T10:00:00.000Z',
    })
    // The replay learns what the first call produced rather than producing a
    // second effect.
    expect(replay.resultRef).toBe(first.resultRef)
  })

  it('commits the key and its effect together', async () => {
    await repos.withTransaction(async (tx) => {
      await tx.idempotency.reserve({
        key: 'open:case-1',
        commandType: 'open-case',
        resultRef: 'case-1',
        createdAt: NOW,
      })
      await tx.cases.create(investmentCase())
    })
    expect(await repos.idempotency.get('open:case-1')).not.toBeNull()
    expect(await repos.cases.get('case-1')).not.toBeNull()
  })

  it('leaves no key behind when the effect fails', async () => {
    // Otherwise a retry would find the key, assume the work was done, and
    // return a reference to a case that does not exist.
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.idempotency.reserve({
          key: 'open:case-1',
          commandType: 'open-case',
          resultRef: 'case-1',
          createdAt: NOW,
        })
        throw new Error('case creation failed')
      }),
    ).rejects.toThrow()

    expect(await repos.idempotency.get('open:case-1')).toBeNull()
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

  it('is write-once', async () => {
    await repos.claims.save(claim, 'case-1', 'run-1')
    const replay = await repos.claims.save(
      { ...claim, statement: 'changed' },
      'case-1',
      'run-1',
    )
    // A cited claim must not change underneath the citation.
    expect(replay.statement).toBe('The ECB has held since June.')
  })
})
