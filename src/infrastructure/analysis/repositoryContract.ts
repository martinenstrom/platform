/**
 * The repository contract, as executable tests.
 *
 * One body of behavioural tests, run against the in-memory reference and
 * against PostgreSQL. Two separate suites would drift semantically — slowly,
 * and in exactly the places nobody thought to check — and stage 4 compares the
 * two stores for real, so a difference discovered here is a difference
 * discovered cheaply.
 *
 * **No assertion in this file branches on which adapter is running.** The
 * `options` argument carries setup differences only: PostgreSQL needs its
 * foreign keys satisfied, where the in-memory store needs nothing. If a
 * behavioural assertion ever needs a branch, that is a divergence and it gets
 * resolved rather than accommodated.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildAssignment,
  buildClaim,
  buildEvidenceSet,
  buildRunRecord,
  buildThesis,
  buildTransitionEvent,
  observationRef,
  type AgentClaim,
  type CaseDecision,
  type EvidenceSet,
  type InvestmentCase,
  type InvestmentThesis,
  type TransitionEvent,
  type VerificationReview,
} from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  TransactionClosedError,
  type AnalysisRepositories,
  type CaseRepository,
} from '~/application/analysis/repositories'
import type { StoredResult } from '~/application/analysis/resultStore'
import { isDeeplyFrozen } from './seal'

export interface ContractFixtures {
  /** Employees and departments the schema requires to exist. */
  ownerEmployeeId: string
  departmentId: string
  governanceDepartmentId: string
  governanceEmployeeId: string
}

export interface ContractOptions {
  /** A fresh, empty store for each test. */
  create: () => Promise<AnalysisRepositories>
  /** Released after each test. */
  destroy?: (repositories: AnalysisRepositories) => Promise<void>
  fixtures: ContractFixtures
}

const AT = '2026-07-28T09:00:00.000Z'
const LATER = '2026-07-28T11:00:00.000Z'

export function describeRepositoryContract(name: string, options: ContractOptions): void {
  describe(`repository contract — ${name}`, () => {
    let repos: AnalysisRepositories
    const f = options.fixtures

    beforeEach(async () => {
      repos = await options.create()
    })

    /* ------------------------------------------------------------ fixtures */

    const investmentCase = (over: Partial<InvestmentCase> = {}): InvestmentCase => ({
      id: 'case-1',
      version: 1,
      subject: { kind: 'macro', ref: 'regime', displayName: 'Policy regime' },
      question: 'Is the market pricing the policy path correctly?',
      stage: 'intake',
      openedAt: AT,
      ownerEmployeeId: f.ownerEmployeeId,
      participatingDepartmentIds: [f.departmentId],
      transitions: [],
      ...over,
    })

    const thesis = (over: Partial<InvestmentThesis> = {}): InvestmentThesis =>
      buildThesis({
        thesisId: 'th-buy',
        revisionId: 'rev-1',
        revisionNumber: 1,
        caseId: 'case-1',
        statement: 'The policy path is mispriced',
        position: 'buy',
        proposedByDepartmentId: f.departmentId,
        proposedByEmployeeId: f.ownerEmployeeId,
        proposedAt: AT,
        supportingClaimIds: [],
        opposingClaimIds: [],
        citedByClaimIds: [],
        lifecycle: 'proposed',
        invalidationCriteria: 'The curve reprices above 4%',
        ...over,
      })

    const assignment = (assignmentId: string, over: Record<string, unknown> = {}) =>
      buildAssignment({
        id: assignmentId,
        caseId: 'case-1',
        departmentId: f.departmentId,
        brief: 'Regime read',
        status: 'queued',
        createdAt: AT,
        priority: 5,
        ...over,
      } as Parameters<typeof buildAssignment>[0])

    const evidenceSet = (value = 4.1): EvidenceSet =>
      buildEvidenceSet({
        items: [
          {
            ref: observationRef(
              {
                subjectKind: 'series',
                subject: 'US10Y',
                kind: 'yield',
                observedAt: AT,
                sourceId: 'treasury',
              },
              { value },
            ),
            value: { value, unit: 'percent' },
            provenance: { source: { providerId: 'treasury' }, quality: 'ok' } as never,
          },
        ],
        assembledAt: AT,
        correlationId: 'corr-1',
      })

    const run = (runId: string, setId: string, over: Record<string, unknown> = {}) =>
      buildRunRecord({
        id: runId,
        caseId: 'case-1',
        assignmentId: 'a-1',
        departmentId: f.departmentId,
        employeeId: f.ownerEmployeeId,
        agentContractVersion: '1',
        outputSchemaVersion: '1',
        prompt: { id: 'p', version: '1', contentHash: 'ph' },
        model: {
          id: 'm',
          provider: 'anthropic',
          parameters: { temperature: 0 },
          parametersHash: 'mh',
        },
        evidenceSetId: setId,
        state: 'running',
        startedAt: AT,
        events: [{ runId, at: AT, state: 'running' }],
        claims: [],
        ...over,
      } as Parameters<typeof buildRunRecord>[0])

    const claim = (claimId: string, over: Record<string, unknown> = {}): AgentClaim =>
      buildClaim({
        id: claimId,
        type: 'observation',
        statement: 'The 10y is at 4.1%',
        evidenceRefs: [],
        contradictingEvidenceRefs: [],
        confidence: { level: 'high', basis: ['single authoritative source'] },
        temporalScope: { asOf: AT },
        status: 'insufficient-evidence',
        ...over,
      } as Parameters<typeof buildClaim>[0])

    const event = (
      eventId: string,
      over: Partial<TransitionEvent> = {},
    ): TransitionEvent =>
      buildTransitionEvent({
        eventId,
        subject: 'case',
        caseId: 'case-1',
        fromState: null,
        toState: 'intake',
        occurredAt: AT,
        correlationId: 'corr-1',
        aggregateVersion: 1,
        ...over,
      })

    const verification = (
      target: { thesisId: string; revisionId: string } | 'case',
      over: Record<string, unknown> = {},
    ): VerificationReview =>
      ({
        ...(target === 'case'
          ? { scope: 'case', caseId: 'case-1' }
          : { scope: 'thesis-revision', caseId: 'case-1', ...target }),
        byEmployeeId: f.governanceEmployeeId,
        byDepartmentId: f.governanceDepartmentId,
        at: AT,
        status: 'verified',
        findings: [],
        claimsReviewed: [],
        ...over,
      }) as VerificationReview

    /** Case, thesis, assignment, run and evidence — the usual prerequisites. */
    async function seedCase(): Promise<{ setId: string }> {
      await repos.cases.create(investmentCase())
      await repos.theses.save(thesis())
      await repos.assignments.save(assignment('a-1'))
      const set = await repos.evidence.save(evidenceSet())
      await repos.runs.save(run('run-1', set.id))
      return { setId: set.id }
    }

    /* --------------------------------------------------------- create/get */

    describe('create, get and list', () => {
      it('returns null for a case that does not exist', async () => {
        expect(await repos.cases.get('missing')).toBeNull()
      })

      it('returns an empty list, never null, when there is nothing', async () => {
        expect(await repos.cases.list()).toEqual([])
        expect(await repos.theses.listForCase('missing')).toEqual([])
        expect(await repos.assignments.listForCase('missing')).toEqual([])
        expect(await repos.runs.listForCase('missing')).toEqual([])
        expect(await repos.claims.listForCase('missing')).toEqual([])
        expect(await repos.events.listForCase('missing')).toEqual([])
        expect(await repos.reviews.verificationsForCase('missing')).toEqual([])
        expect(await repos.decisions.list(10)).toEqual([])
      })

      it('round-trips a case', async () => {
        await repos.cases.create(investmentCase())
        const stored = await repos.cases.get('case-1')

        expect(stored?.id).toBe('case-1')
        expect(stored?.version).toBe(1)
        expect(stored?.subject).toEqual({
          kind: 'macro',
          ref: 'regime',
          displayName: 'Policy regime',
        })
        expect(stored?.question).toBe('Is the market pricing the policy path correctly?')
        expect(stored?.openedAt).toBe(AT)
        expect(stored?.participatingDepartmentIds).toEqual([f.departmentId])
      })

      it('is idempotent on create — a replay returns the existing case', async () => {
        await repos.cases.create(investmentCase())
        const replayed = await repos.cases.create(
          investmentCase({ question: 'A different question' }),
        )
        expect(replayed.question).toBe('Is the market pricing the policy path correctly?')
      })

      it('projects case transitions from the event log', async () => {
        // The movement history is written through `events.append`, not stored
        // on the case: two copies of one history can disagree.
        await repos.cases.create(investmentCase())
        await repos.events.append(
          event('e-1', {
            fromState: 'intake',
            toState: 'research',
            actorEmployeeId: f.ownerEmployeeId,
            actorDepartmentId: f.departmentId,
            occurredAt: LATER,
            aggregateVersion: 2,
          }),
        )

        const stored = await repos.cases.get('case-1')
        expect(stored?.transitions).toHaveLength(1)
        expect(stored?.transitions[0]).toMatchObject({
          from: 'intake',
          to: 'research',
          at: LATER,
          byEmployeeId: f.ownerEmployeeId,
        })
      })

      it('round-trips a thesis revision with its claim links', async () => {
        // Prerequisites in dependency order. PostgreSQL enforces them; the
        // in-memory store does not, which is exactly why the shared suite has
        // to satisfy the stricter one.
        await seedCase()
        await repos.claims.save(claim('claim-1'), 'case-1', 'run-1')
        await repos.theses.save(thesis({ supportingClaimIds: ['claim-1'] }))

        const stored = await repos.theses.get('rev-1')
        expect(stored?.supportingClaimIds).toEqual(['claim-1'])
        expect(stored?.invalidationCriteria).toBe('The curve reprices above 4%')
      })

      it('round-trips an assignment, including what it is waiting on', async () => {
        await repos.cases.create(investmentCase())
        await repos.assignments.save(
          assignment('a-1', {
            status: 'waiting',
            waitingOn: { kind: 'evidence', description: 'the September print' },
          }),
        )

        const stored = await repos.assignments.get('a-1')
        expect(stored?.status).toBe('waiting')
        expect(stored?.waitingOn).toEqual({
          kind: 'evidence',
          description: 'the September print',
        })
      })

      it('round-trips a run with its events and claims', async () => {
        const { setId } = await seedCase()
        await repos.claims.save(claim('claim-1'), 'case-1', 'run-1')

        const stored = await repos.runs.get('run-1')
        expect(stored?.evidenceSetId).toBe(setId)
        expect(stored?.model.parameters).toEqual({ temperature: 0 })
        expect(stored?.events.map((entry) => entry.state)).toEqual(['running'])
        expect(stored?.claims.map((entry) => entry.id)).toEqual(['claim-1'])
      })

      it('round-trips an evidence set, contents and all', async () => {
        const set = evidenceSet()
        await repos.evidence.save(set)

        const stored = await repos.evidence.get(set.id)
        expect(stored?.id).toBe(set.id)
        expect(stored?.items).toHaveLength(1)
        expect(stored?.items[0]!.value).toEqual({ value: 4.1, unit: 'percent' })
        expect(stored?.assembledAt).toBe(AT)
      })
    })

    /* -------------------------------------------------------------- order */

    describe('deterministic ordering', () => {
      it('lists cases by openedAt descending, then id', async () => {
        await repos.cases.create(investmentCase({ id: 'case-b', openedAt: AT }))
        await repos.cases.create(investmentCase({ id: 'case-a', openedAt: AT }))
        await repos.cases.create(investmentCase({ id: 'case-c', openedAt: LATER }))

        expect((await repos.cases.list()).map((entry) => entry.id)).toEqual([
          'case-c',
          'case-a',
          'case-b',
        ])
      })

      it('lists thesis revisions by thesisId, then revisionNumber', async () => {
        await repos.cases.create(investmentCase())
        // Saved out of listing order but in lineage order: a revision cannot
        // supersede one that does not exist yet.
        await repos.theses.save(thesis({ thesisId: 'th-sell', revisionId: 'sell-1' }))
        await repos.theses.save(thesis({ thesisId: 'th-buy', revisionId: 'buy-1' }))
        await repos.theses.save(
          thesis({
            thesisId: 'th-buy',
            revisionId: 'buy-2',
            revisionNumber: 2,
            supersedesRevisionId: 'buy-1',
            revisionReason: 'new data',
          }),
        )

        expect(
          (await repos.theses.listForCase('case-1')).map((entry) => entry.revisionId),
        ).toEqual(['buy-1', 'buy-2', 'sell-1'])
      })

      it('lists assignments by priority descending, then createdAt, then id', async () => {
        await repos.cases.create(investmentCase())
        await repos.assignments.save(assignment('a-low', { priority: 1 }))
        await repos.assignments.save(assignment('a-high', { priority: 9 }))
        await repos.assignments.save(assignment('a-mid-b', { priority: 5 }))
        await repos.assignments.save(assignment('a-mid-a', { priority: 5 }))

        expect(
          (await repos.assignments.listForCase('case-1')).map((entry) => entry.id),
        ).toEqual(['a-high', 'a-mid-a', 'a-mid-b', 'a-low'])
      })

      it('lists runs by startedAt, then id', async () => {
        const { setId } = await seedCase()
        await repos.runs.save(run('run-b', setId, { startedAt: LATER }))
        await repos.runs.save(run('run-a', setId, { startedAt: LATER }))

        expect((await repos.runs.listForCase('case-1')).map((entry) => entry.id)).toEqual(
          ['run-1', 'run-a', 'run-b'],
        )
      })

      it('lists claims by id', async () => {
        await seedCase()
        await repos.claims.save(claim('claim-c'), 'case-1', 'run-1')
        await repos.claims.save(claim('claim-a'), 'case-1', 'run-1')
        await repos.claims.save(claim('claim-b'), 'case-1', 'run-1')

        expect((await repos.claims.listForRun('run-1')).map((c) => c.id)).toEqual([
          'claim-a',
          'claim-b',
          'claim-c',
        ])
        expect((await repos.claims.listForCase('case-1')).map((c) => c.id)).toEqual([
          'claim-a',
          'claim-b',
          'claim-c',
        ])
      })

      it('lists events by occurredAt, then eventId', async () => {
        await repos.cases.create(investmentCase())
        await repos.events.append(event('e-b', { occurredAt: LATER }))
        await repos.events.append(event('e-a', { occurredAt: LATER }))
        await repos.events.append(event('e-first', { occurredAt: AT }))

        expect(
          (await repos.events.listForCase('case-1')).map((entry) => entry.eventId),
        ).toEqual(['e-first', 'e-a', 'e-b'])
      })

      it('lists recent events newest first, with a stable tie-break', async () => {
        await repos.cases.create(investmentCase())
        await repos.events.append(event('e-a', { occurredAt: LATER }))
        await repos.events.append(event('e-b', { occurredAt: LATER }))
        await repos.events.append(event('e-first', { occurredAt: AT }))

        expect((await repos.events.recent(2)).map((entry) => entry.eventId)).toEqual([
          'e-b',
          'e-a',
        ])
      })

      it('orders reviews by at, then reviewer, then revision', async () => {
        await repos.cases.create(investmentCase())
        await repos.theses.save(thesis({ revisionId: 'rev-b' }))
        await repos.theses.save(
          thesis({ thesisId: 'th-a', revisionId: 'rev-a', revisionNumber: 1 }),
        )

        await repos.reviews.saveVerification(
          verification({ thesisId: 'th-buy', revisionId: 'rev-b' }),
        )
        await repos.reviews.saveVerification(
          verification({ thesisId: 'th-a', revisionId: 'rev-a' }),
        )
        await repos.reviews.saveVerification(verification('case'))

        const stored = await repos.reviews.verificationsForCase('case-1')
        expect(
          stored.map((entry) =>
            entry.scope === 'thesis-revision' ? entry.revisionId : '(case)',
          ),
        ).toEqual(['(case)', 'rev-a', 'rev-b'])
      })

      it('is independent of insertion order', async () => {
        await repos.cases.create(investmentCase({ id: 'case-a' }))
        await repos.cases.create(investmentCase({ id: 'case-b' }))
        const forward = (await repos.cases.list()).map((entry) => entry.id)

        const second = await options.create()
        await second.cases.create(investmentCase({ id: 'case-b' }))
        await second.cases.create(investmentCase({ id: 'case-a' }))
        const backward = (await second.cases.list()).map((entry) => entry.id)
        await options.destroy?.(second)

        expect(forward).toEqual(backward)
      })
    })

    /* --------------------------------------------------------- immutability */

    describe('reads are deeply immutable', () => {
      it('freezes everything reachable from a stored aggregate', async () => {
        await seedCase()
        await repos.claims.save(claim('claim-1'), 'case-1', 'run-1')
        await repos.events.append(event('e-1'))
        await repos.reviews.saveVerification(verification('case'))

        for (const [label, value] of [
          ['case', await repos.cases.get('case-1')],
          ['thesis', await repos.theses.get('rev-1')],
          ['assignment', await repos.assignments.get('a-1')],
          ['run', await repos.runs.get('run-1')],
          ['claim', await repos.claims.get('claim-1')],
          ['event', (await repos.events.listForCase('case-1'))[0]],
          ['review', (await repos.reviews.verificationsForCase('case-1'))[0]],
        ] as const) {
          expect(value, `${label} was not stored`).toBeTruthy()
          expect(isDeeplyFrozen(value), `${label} is not deeply frozen`).toBe(true)
        }
      })
    })

    /* -------------------------------------------------------- transactions */

    describe('transactions', () => {
      it('commits everything together', async () => {
        await repos.withTransaction(async (tx) => {
          await tx.cases.create(investmentCase())
          await tx.assignments.save(assignment('a-1'))
          await tx.events.append(event('e-1'))
        })

        expect(await repos.cases.get('case-1')).not.toBeNull()
        expect(await repos.assignments.listForCase('case-1')).toHaveLength(1)
        expect(await repos.events.listForCase('case-1')).toHaveLength(1)
      })

      it('rolls everything back when the callback throws', async () => {
        await expect(
          repos.withTransaction(async (tx) => {
            await tx.cases.create(investmentCase())
            await tx.assignments.save(assignment('a-1'))
            throw new Error('the department does not exist')
          }),
        ).rejects.toThrow(/does not exist/)

        expect(await repos.cases.get('case-1')).toBeNull()
        expect(await repos.assignments.listForCase('case-1')).toEqual([])
      })

      it('preserves state committed before a failing transaction', async () => {
        await repos.cases.create(investmentCase())
        await expect(
          repos.withTransaction(async (tx) => {
            await tx.assignments.save(assignment('a-1'))
            throw new Error('boom')
          }),
        ).rejects.toThrow()

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

      it('refuses a scoped repository used after commit', async () => {
        let escaped: CaseRepository | null = null
        await repos.withTransaction(async (tx) => {
          escaped = tx.cases
          await tx.cases.create(investmentCase())
        })

        await expect(escaped!.get('case-1')).rejects.toBeInstanceOf(
          TransactionClosedError,
        )
      })

      it('refuses a scoped repository used after rollback', async () => {
        let escaped: CaseRepository | null = null
        await expect(
          repos.withTransaction(async (tx) => {
            escaped = tx.cases
            throw new Error('boom')
          }),
        ).rejects.toThrow()

        await expect(escaped!.get('case-1')).rejects.toBeInstanceOf(
          TransactionClosedError,
        )
      })

      it('refuses a late WRITE, which would land outside any transaction', async () => {
        let escaped: CaseRepository | null = null
        await repos.withTransaction(async (tx) => {
          escaped = tx.cases
        })

        await expect(escaped!.create(investmentCase())).rejects.toBeInstanceOf(
          TransactionClosedError,
        )
        expect(await repos.cases.get('case-1')).toBeNull()
      })

      it('names the operation that was called too late', async () => {
        let escaped: CaseRepository | null = null
        await repos.withTransaction(async (tx) => {
          escaped = tx.cases
        })
        await expect(escaped!.list()).rejects.toThrow(/cases\.list/)
      })

      it('leaves the outer repositories usable afterwards', async () => {
        await repos.withTransaction(async (tx) => {
          await tx.cases.create(investmentCase())
        })
        expect(await repos.cases.get('case-1')).not.toBeNull()
      })
    })

    /* ------------------------------------------------- optimistic concurrency */

    describe('optimistic concurrency', () => {
      it('accepts a write against the version that was read', async () => {
        await repos.cases.create(investmentCase())
        const loaded = (await repos.cases.get('case-1'))!

        const saved = await repos.cases.save(
          { ...loaded, version: 2, stage: 'research' },
          loaded.version,
        )
        expect(saved.version).toBe(2)
      })

      it('rejects a second writer holding a stale version', async () => {
        await repos.cases.create(investmentCase())
        const first = (await repos.cases.get('case-1'))!
        const second = (await repos.cases.get('case-1'))!

        await repos.cases.save({ ...first, version: 2, stage: 'research' }, first.version)

        await expect(
          repos.cases.save({ ...second, version: 2, stage: 'blocked' }, second.version),
        ).rejects.toBeInstanceOf(ConcurrencyConflictError)
      })

      it('does not lose the first writer’s update', async () => {
        await repos.cases.create(investmentCase())
        const stale = (await repos.cases.get('case-1'))!
        await repos.cases.save({ ...stale, version: 2, stage: 'research' }, 1)

        await expect(
          repos.cases.save({ ...stale, version: 2, stage: 'withdrawn' }, 1),
        ).rejects.toThrow()

        expect((await repos.cases.get('case-1'))?.stage).toBe('research')
      })

      it('succeeds after a re-read', async () => {
        await repos.cases.create(investmentCase())
        const stale = (await repos.cases.get('case-1'))!
        await repos.cases.save({ ...stale, version: 2, stage: 'research' }, 1)

        const reloaded = (await repos.cases.get('case-1'))!
        const saved = await repos.cases.save(
          { ...reloaded, version: 3, stage: 'aggregation' },
          reloaded.version,
        )
        expect(saved.version).toBe(3)
      })

      it('reports the version it found', async () => {
        await repos.cases.create(investmentCase())
        const stale = (await repos.cases.get('case-1'))!
        await repos.cases.save({ ...stale, version: 2, stage: 'research' }, 1)

        await expect(
          repos.cases.save({ ...stale, version: 2, stage: 'blocked' }, 1),
        ).rejects.toThrow(/expected version 1, found 2/)
      })

      it('does not serialize unrelated append-only writes', async () => {
        // Appends to different cases must not contend with each other.
        await repos.cases.create(investmentCase({ id: 'case-a' }))
        await repos.cases.create(investmentCase({ id: 'case-b' }))

        await Promise.all([
          repos.events.append(event('e-a', { caseId: 'case-a' })),
          repos.events.append(event('e-b', { caseId: 'case-b' })),
        ])

        expect(await repos.events.listForCase('case-a')).toHaveLength(1)
        expect(await repos.events.listForCase('case-b')).toHaveLength(1)
      })
    })

    /* --------------------------------------------------------- idempotency */

    describe('idempotency', () => {
      it('returns the original record when a key is replayed', async () => {
        const first = await repos.idempotency.reserve({
          key: 'open:case-1',
          commandType: 'open-case',
          resultRef: 'case-1',
          createdAt: AT,
        })
        const replay = await repos.idempotency.reserve({
          key: 'open:case-1',
          commandType: 'open-case',
          resultRef: 'case-2',
          createdAt: LATER,
        })

        expect(replay.resultRef).toBe('case-1')
        expect(replay.createdAt).toBe(first.createdAt)
      })

      it('commits the key and its effect together', async () => {
        await repos.withTransaction(async (tx) => {
          await tx.cases.create(investmentCase())
          await tx.idempotency.reserve({
            key: 'open:case-1',
            commandType: 'open-case',
            resultRef: 'case-1',
            createdAt: AT,
          })
        })

        expect(await repos.idempotency.get('open:case-1')).not.toBeNull()
        expect(await repos.cases.get('case-1')).not.toBeNull()
      })

      it('leaves no key behind when the effect fails', async () => {
        await expect(
          repos.withTransaction(async (tx) => {
            await tx.idempotency.reserve({
              key: 'open:case-1',
              commandType: 'open-case',
              resultRef: 'case-1',
              createdAt: AT,
            })
            throw new Error('boom')
          }),
        ).rejects.toThrow()

        expect(await repos.idempotency.get('open:case-1')).toBeNull()
      })

      it('returns null for a key nobody reserved', async () => {
        expect(await repos.idempotency.get('never')).toBeNull()
      })
    })

    /* ------------------------------------------------- write-once records */

    describe('write-once records', () => {
      it('keeps the first claim when the same id is written twice', async () => {
        await seedCase()
        await repos.claims.save(claim('claim-1'), 'case-1', 'run-1')
        const replay = await repos.claims.save(claim('claim-1'), 'case-1', 'run-1')

        expect(replay.id).toBe('claim-1')
        expect(await repos.claims.listForRun('run-1')).toHaveLength(1)
      })

      it('deduplicates an evidence set by its content address', async () => {
        const set = evidenceSet()
        await repos.evidence.save(set)
        const again = await repos.evidence.save(evidenceSet())

        expect(again.id).toBe(set.id)
        expect(again.items).toHaveLength(1)
      })

      it('gives different evidence a different id', async () => {
        const first = await repos.evidence.save(evidenceSet(4.1))
        const second = await repos.evidence.save(evidenceSet(4.2))
        expect(first.id).not.toBe(second.id)
      })

      it('keeps the first stored result', async () => {
        const result: StoredResult = {
          key: 'result-1',
          claims: [],
          storedAt: AT,
          inputs: {
            evidenceSetId: 'set-1',
            promptId: 'p',
            promptVersion: '1',
            promptContentHash: 'ph',
            modelId: 'm',
            modelParametersHash: 'mh',
            agentContractVersion: '1',
            outputSchemaVersion: '1',
            canonicalizationVersion: '1',
            agentImplementationVersion: '1',
            departmentId: f.departmentId,
          },
        }
        await repos.results.put(result)
        const replay = await repos.results.put(result)

        expect(replay.key).toBe('result-1')
        expect(replay.storedAt).toBe(AT)
      })

      it('appends an event once, however many times it is replayed', async () => {
        await repos.cases.create(investmentCase())
        await repos.events.append(event('e-1'))
        await repos.events.append(event('e-1'))

        expect(await repos.events.listForCase('case-1')).toHaveLength(1)
      })
    })

    /* -------------------------------------------- revision-scoped governance */

    describe('revision-scoped governance', () => {
      async function twoRevisions() {
        await repos.cases.create(investmentCase())
        await repos.theses.save(thesis({ revisionId: 'rev-1' }))
        await repos.theses.save(
          thesis({
            revisionId: 'rev-2',
            revisionNumber: 2,
            supersedesRevisionId: 'rev-1',
            revisionReason: 'new evidence',
          }),
        )
      }

      it('keeps a review attached to the exact revision reviewed', async () => {
        await twoRevisions()
        await repos.reviews.saveVerification(
          verification({ thesisId: 'th-buy', revisionId: 'rev-1' }),
        )

        const stored = await repos.reviews.verificationsForCase('case-1')
        expect(stored).toHaveLength(1)
        expect(stored[0]!.scope).toBe('thesis-revision')
        expect(
          stored[0]!.scope === 'thesis-revision' ? stored[0]!.revisionId : null,
        ).toBe('rev-1')
      })

      it('stores a case-wide review with no revision at all', async () => {
        await repos.cases.create(investmentCase())
        await repos.reviews.saveVerification(verification('case'))

        const stored = await repos.reviews.verificationsForCase('case-1')
        expect(stored[0]!.scope).toBe('case')
        expect(stored[0]).not.toHaveProperty('revisionId')
      })

      it('does not collapse verdicts on two revisions into one', async () => {
        await twoRevisions()
        await repos.reviews.saveVerification(
          verification({ thesisId: 'th-buy', revisionId: 'rev-1' }),
        )
        await repos.reviews.saveVerification(
          verification({ thesisId: 'th-buy', revisionId: 'rev-2' }),
        )

        expect(await repos.reviews.verificationsForCase('case-1')).toHaveLength(2)
      })

      it('returns the original review when a submission is replayed', async () => {
        await twoRevisions()
        const submission = verification({ thesisId: 'th-buy', revisionId: 'rev-1' })
        await repos.reviews.saveVerification(submission)
        await repos.reviews.saveVerification({
          ...submission,
          status: 'correction-required',
        } as VerificationReview)

        const stored = await repos.reviews.verificationsForCase('case-1')
        expect(stored).toHaveLength(1)
        expect(stored[0]!.status).toBe('verified')
      })

      it('records a genuine re-review as a second review', async () => {
        await twoRevisions()
        const submission = verification({ thesisId: 'th-buy', revisionId: 'rev-1' })
        await repos.reviews.saveVerification(submission)
        await repos.reviews.saveVerification({
          ...submission,
          at: LATER,
          status: 'correction-required',
        } as VerificationReview)

        expect(await repos.reviews.verificationsForCase('case-1')).toHaveLength(2)
      })

      it('keeps the four control functions apart', async () => {
        await repos.cases.create(investmentCase())
        await repos.reviews.saveVerification(verification('case'))
        await repos.reviews.saveCompliance({
          scope: 'case',
          caseId: 'case-1',
          byEmployeeId: f.governanceEmployeeId,
          byDepartmentId: f.governanceDepartmentId,
          at: AT,
          status: 'approved',
          findings: [],
        })
        await repos.reviews.saveRisk({
          scope: 'case',
          caseId: 'case-1',
          byEmployeeId: f.governanceEmployeeId,
          byDepartmentId: f.governanceDepartmentId,
          at: AT,
          status: 'accepted',
          concerns: ['duration'],
        })

        expect(await repos.reviews.verificationsForCase('case-1')).toHaveLength(1)
        expect(await repos.reviews.complianceForCase('case-1')).toHaveLength(1)
        expect(await repos.reviews.riskForCase('case-1')).toHaveLength(1)
        expect((await repos.reviews.riskForCase('case-1'))[0]!.concerns).toEqual([
          'duration',
        ])
      })
    })

    /* ----------------------------------------------------------- decisions */

    describe('decisions', () => {
      const decision = (over: Partial<CaseDecision> = {}): CaseDecision => ({
        caseId: 'case-1',
        aggregateVersion: 3,
        decidedAt: AT,
        decidedByEmployeeId: f.ownerEmployeeId,
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
        rationale: 'The policy path is mispriced',
        unresolvedDissent: ['the advocate still disputes the fiscal assumption'],
        reconsiderationTriggers: ['a fiscal package above 1% of GDP'],
        ...over,
      })

      async function decidable() {
        const { setId } = await seedCase()
        await repos.theses.save(
          thesis({
            thesisId: 'th-sell',
            revisionId: 'rev-sell',
            position: 'sell',
          }),
        )
        return setId
      }

      it('references the exact revision selected', async () => {
        const setId = await decidable()
        await repos.decisions.save(
          decision({ evidenceSetId: setId, notSelectedRevisionIds: ['rev-sell'] }),
        )

        const stored = await repos.decisions.getForCase('case-1')
        expect(stored?.selectedRevisionId).toBe('rev-1')
        expect(stored?.notSelectedRevisionIds).toEqual(['rev-sell'])
        expect(stored?.unresolvedDissent).toEqual([
          'the advocate still disputes the fiscal assumption',
        ])
      })

      it('keeps the first decision when the same case is decided twice', async () => {
        const setId = await decidable()
        await repos.decisions.save(decision({ evidenceSetId: setId }))
        const replay = await repos.decisions.save(decision({ evidenceSetId: setId }))

        expect(replay.rationale).toBe('The policy path is mispriced')
        expect(await repos.decisions.list(10)).toHaveLength(1)
      })

      it('lists decisions newest first', async () => {
        const setId = await decidable()
        await repos.cases.create(investmentCase({ id: 'case-2' }))
        await repos.decisions.save(decision({ evidenceSetId: setId }))
        await repos.decisions.save(
          decision({
            caseId: 'case-2',
            evidenceSetId: setId,
            selectedRevisionId: null,
            decidedAt: LATER,
          }),
        )

        expect((await repos.decisions.list(10)).map((entry) => entry.caseId)).toEqual([
          'case-2',
          'case-1',
        ])
      })

      it('returns null when a case has not been decided', async () => {
        expect(await repos.decisions.getForCase('case-1')).toBeNull()
      })
    })

    /* ---------------------------------------------------------- provenance */

    describe('provenance', () => {
      it('reports which implementation and which domain contract', async () => {
        const provenance = await repos.provenance()
        expect(provenance.adapterId).toBeTruthy()
        expect(provenance.adapterVersion).toBeTruthy()
        expect(provenance.domainContractVersion).toBe('2')
      })
    })
  })
}
