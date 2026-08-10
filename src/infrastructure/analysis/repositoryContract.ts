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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildAssignment,
  buildClaim,
  buildEvidenceSet,
  buildRunRecord,
  buildThesis,
  buildTransitionEvent,
  modelOf,
  observationRef,
  type AgentClaim,
  type EvidenceSet,
  type InvestmentCase,
  type InvestmentThesis,
  type TransitionEvent,
  type VerificationReview,
} from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  ConflictingRecordError,
  DuplicateRecordError,
  TransactionClosedError,
  type AnalysisRepositories,
  type CaseRepository,
  type StorageProvenance,
} from '~/application/analysis/repositories'
import type { StoredResult } from '~/application/analysis/resultStore'
import {
  CommandPayloadConflictError,
  type CommandIntent,
} from '~/application/analysis/commandLog'
import {
  RISK_REVIEW_WHEN_IMPLEMENTABLE,
  requirementStatusFor,
  type ActorSnapshot,
  type RequirementResolution,
} from '~/domain/analysis'
import { playbookContentHash, type CasePlaybook } from '~/application/analysis/playbooks'
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
    /** This store's provenance, for the records that carry a foreign key to it. */
    let prov: StorageProvenance
    const f = options.fixtures

    beforeEach(async () => {
      repos = await options.create()
      prov = await repos.provenance()
    })

    /*
     * Released after every test, not at the end of the file.
     *
     * `destroy` was declared and never called: each test's pool stayed open
     * until `afterAll`, and the suite only passed because pools open
     * connections lazily. Adding the C1B cases pushed it past
     * `max_connections`, which is the good version of this bug — the bad
     * version is a production leak nobody notices until traffic arrives.
     */
    afterEach(async () => {
      await options.destroy?.(repos)
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
        // Only revision 1 is an initial proposal, and revision 1 is nothing
        // else — so the default follows the number the fixture asks for.
        revisionCause:
          (over.revisionNumber ?? 1) === 1 ? 'initial-proposal' : 'correction',
        caseId: 'case-1',
        implications: [],
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

    /*
     * The observation value is a canonical decimal STRING, as production now
     * supplies. A fractional double is refused by the canonical-value model, so
     * the fixture carries what `evidenceRefs` converts a quote into.
     */
    const evidenceSet = (value = '4.1'): EvidenceSet =>
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
              /*
               * The yield projection, complete. It was `{ value }` -- the QUOTE
               * projection's field -- under a `yield` kind. `unit` stays in the
               * stored payload as metadata outside the projection, which is what
               * proves extra fields are ignored.
               */
              {
                yieldPercent: value,
                changeBasisPoints: null,
                observationDate: '2026-07-28',
              },
            ),
            value: {
              yieldPercent: value,
              changeBasisPoints: null,
              observationDate: '2026-07-28',
              unit: 'percent',
            },
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
        assignmentId: `a-${runId}`,
        departmentId: f.departmentId,
        employeeId: f.ownerEmployeeId,
        agentContractVersion: '1',
        outputSchemaVersion: '1',
        usage: { state: 'not-applicable' },
        evidenceSetId: setId,
        state: 'running',
        execution: {
          playbookId: 'contract-playbook',
          playbookVersion: '1',
          playbookEntryKey: 'primary',
          providerId: 'recorded-provider',
          providerVersion: '1',
          providerKind: 'recorded',
          identity: {
            kind: 'model',
            prompt: { id: 'p', version: '1', contentHash: 'ph' },
            model: {
              id: 'm',
              provider: 'anthropic',
              // Round-tripped through jsonb, so a parameter that changes the
              // output has to survive the trip intact.
              parameters: { temperature: 0 },
              parametersHash: 'mh',
            },
          },
        },
        missingOptionalInputs: [],
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
        reviewId: `v-${target === 'case' ? 'case' : target.revisionId}`,
        sequence: 1,
        byEmployeeId: f.governanceEmployeeId,
        byDepartmentId: f.governanceDepartmentId,
        at: AT,
        status: 'verified',
        findings: [],
        claimsReviewed: [],
        ...over,
      }) as VerificationReview

    /** A real actor, for events that move a case. Never an empty string. */
    const actor = {
      actorEmployeeId: f.ownerEmployeeId,
      actorDepartmentId: f.departmentId,
    }

    const storedResult = (): StoredResult => ({
      key: 'result-1',
      claims: [],
      storedAt: AT,
      providerKind: 'recorded',
      inputs: {
        evidenceSetId: 'set-1',
        caseId: 'case-1',
        executionIdentity: 'model|p|1|ph|anthropic|m|mh',
        agentContractVersion: '1',
        outputSchemaVersion: '1',
        canonicalizationVersion: '1',
        agentImplementationVersion: '1',
        departmentId: f.departmentId,
      },
    })

    /**
     * The workflow the contract's runs execute.
     *
     * Hoisted so `seedCase` can register it: a run carries a foreign key to
     * its playbook entry, because execution provenance names the exact step of
     * the exact workflow version that produced the work.
     */
    const contractPlaybook = (over: Partial<CasePlaybook> = {}): CasePlaybook => ({
      id: 'contract-playbook',
      version: '1',
      caseKind: 'macro',
      name: 'Contract playbook',
      entries: [
        {
          key: 'primary',
          departmentId: f.departmentId,
          brief: 'Primary analysis',
          blockedBy: [],
          optionalInputs: [],
          requirement: 'required',
          priority: 10,
        },
        {
          key: 'supporting',
          departmentId: f.departmentId,
          brief: 'Supporting analysis',
          blockedBy: [],
          optionalInputs: ['primary'],
          requirement: 'optional',
          priority: 5,
        },
        {
          key: 'gate',
          departmentId: f.governanceDepartmentId,
          brief: 'Governance gate',
          blockedBy: ['primary'],
          optionalInputs: ['supporting'],
          requirement: 'conditional',
          conditionalRule: {
            ruleId: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleId,
            ruleVersion: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleVersion,
          },
          priority: 1,
        },
      ],
      ...over,
    })

    /**
     * Saves a run together with the assignment it belongs to.
     *
     * At most one non-terminal run may exist per assignment, so fixtures that
     * write several runs need several assignments. That is not a test
     * concession — a second live run on one assignment would mean a department
     * doing the same piece of work twice.
     */
    async function saveRun(
      runId: string,
      setId: string,
      over: Record<string, unknown> = {},
    ) {
      await repos.assignments.save(assignment(`a-${runId}`))
      return repos.runs.save(run(runId, setId, over), prov)
    }

    async function seedCase(): Promise<{ setId: string; observationId: string }> {
      await repos.cases.create(investmentCase())
      await repos.theses.save(thesis())
      await repos.assignments.save(assignment('a-1'))
      await repos.playbooks.register(contractPlaybook())
      const set = await repos.evidence.save(evidenceSet())
      await saveRun('run-1', set.id)
      return { setId: set.id, observationId: set.items[0]!.ref.id }
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
            waitingOn: { kind: 'evidence', evidenceSought: 'the September print' },
          }),
        )

        const stored = await repos.assignments.get('a-1')
        expect(stored?.status).toBe('waiting')
        expect(stored?.waitingOn).toEqual({
          kind: 'evidence',
          evidenceSought: 'the September print',
        })
      })

      it('round-trips a run with its events and claims', async () => {
        const { setId } = await seedCase()
        await repos.claims.save(claim('claim-1'), 'case-1', 'run-1')

        const stored = await repos.runs.get('run-1')
        expect(stored?.evidenceSetId).toBe(setId)
        expect(modelOf(stored!.execution.identity)?.parameters).toEqual({
          temperature: 0,
        })
        expect(stored?.events.map((entry) => entry.state)).toEqual(['running'])
        expect(stored?.claims.map((entry) => entry.id)).toEqual(['claim-1'])
      })

      it('round-trips an evidence set, contents and all', async () => {
        const set = evidenceSet()
        await repos.evidence.save(set)

        const stored = await repos.evidence.get(set.id)
        expect(stored?.id).toBe(set.id)
        expect(stored?.items).toHaveLength(1)
        expect(stored?.items[0]!.value).toEqual({
          yieldPercent: '4.1',
          changeBasisPoints: null,
          observationDate: '2026-07-28',
          unit: 'percent',
        })
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
        await saveRun('run-b', setId, { startedAt: LATER })
        await saveRun('run-a', setId, { startedAt: LATER })

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

    describe('the command ledger', () => {
      const intent = (over: Partial<CommandIntent> = {}): CommandIntent => ({
        commandId: 'cmd-1',
        commandType: 'ProbeCommand',
        commandContractVersion: '2',
        category: 'workflow',
        payloadHash: 'hash-a',
        actor: {
          kind: 'employee',
          employeeId: f.ownerEmployeeId,
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
        occurredAt: AT,
        receivedAt: AT,
        ...over,
      })

      const provenance = async () => repos.provenance()

      it('returns null for a command that never reached the ledger', async () => {
        expect(await repos.commands.find('never')).toBeNull()
      })

      it('records intent and an outcome together', async () => {
        await repos.commands.record(intent(), await provenance())
        await repos.commands.appendOutcome(
          'cmd-1',
          { state: 'committed', resultKind: 'case', resultRef: 'case-1', recordedAt: AT },
          await provenance(),
        )

        const entry = await repos.commands.find('cmd-1')
        expect(entry?.intent.commandType).toBe('ProbeCommand')
        expect(entry?.intent.actor.employeeId).toBe(f.ownerEmployeeId)
        expect(entry?.outcomes).toHaveLength(1)
        expect(entry?.outcomes[0]).toMatchObject({
          state: 'committed',
          resultRef: 'case-1',
        })
      })

      it('is idempotent on an identical replay of intent', async () => {
        await repos.commands.record(intent(), await provenance())
        await repos.commands.record(intent(), await provenance())

        expect((await repos.commands.find('cmd-1'))?.intent.payloadHash).toBe('hash-a')
      })

      it('refuses one command id carrying two different payloads', async () => {
        // A command id identifies one request. Reusing it for a different one
        // is not a retry, and returning the earlier result would answer a
        // question nobody asked.
        await repos.commands.record(intent(), await provenance())
        await expect(
          repos.commands.record(intent({ payloadHash: 'hash-b' }), await provenance()),
        ).rejects.toBeInstanceOf(CommandPayloadConflictError)
      })

      it('keeps an unresolved outcome when a later one settles it', async () => {
        // How long the answer was unknown is itself part of the record.
        await repos.commands.record(intent(), await provenance())
        await repos.commands.appendOutcome(
          'cmd-1',
          { state: 'unresolved', resolutionReference: 'probe', recordedAt: AT },
          await provenance(),
        )
        await repos.commands.appendOutcome(
          'cmd-1',
          {
            state: 'committed',
            resultKind: 'case',
            resultRef: 'case-1',
            recordedAt: LATER,
          },
          await provenance(),
        )

        const entry = await repos.commands.find('cmd-1')
        expect(entry?.outcomes.map((outcome) => outcome.state)).toEqual([
          'unresolved',
          'committed',
        ])
      })

      it('refuses a second outcome once one is terminal', async () => {
        await repos.commands.record(intent(), await provenance())
        await repos.commands.appendOutcome(
          'cmd-1',
          { state: 'rejected', reasonCode: 'not-authorised', recordedAt: AT },
          await provenance(),
        )

        await expect(
          repos.commands.appendOutcome(
            'cmd-1',
            {
              state: 'committed',
              resultKind: 'case',
              resultRef: 'case-1',
              recordedAt: LATER,
            },
            await provenance(),
          ),
        ).rejects.toThrow()
      })

      it('commits the ledger entry and its effect together', async () => {
        await repos.withTransaction(async (tx) => {
          await tx.cases.create(investmentCase())
          await tx.commands.record(intent({ caseId: 'case-1' }), await provenance())
          await tx.commands.appendOutcome(
            'cmd-1',
            {
              state: 'committed',
              resultKind: 'case',
              resultRef: 'case-1',
              recordedAt: AT,
            },
            await provenance(),
          )
        })

        expect(await repos.commands.find('cmd-1')).not.toBeNull()
        expect(await repos.cases.get('case-1')).not.toBeNull()
      })

      it('leaves no ledger entry behind when the effect fails', async () => {
        await expect(
          repos.withTransaction(async (tx) => {
            await tx.commands.record(intent(), await provenance())
            throw new Error('boom')
          }),
        ).rejects.toThrow()

        expect(await repos.commands.find('cmd-1')).toBeNull()
      })

      it('carries the actor snapshot rather than a bare reference', async () => {
        // The snapshot is what survives a later reorganization: a command must
        // keep showing the authority it actually ran under.
        await repos.commands.record(intent(), await provenance())

        const stored = (await repos.commands.find('cmd-1'))!.intent.actor
        expect(stored.roleId).toBe('research-director')
        expect(stored.departmentId).toBe('research-office')
        expect(stored.authentication).toBe('system-asserted')
        expect(stored.organizationSeedVersion).toBe('1')
      })

      it('keeps the initiator distinct from the accountable actor', async () => {
        await repos.commands.record(intent(), await provenance())

        const entry = (await repos.commands.find('cmd-1'))!
        expect(entry.intent.initiator).toEqual({
          kind: 'orchestrator',
          orchestratorId: 'test',
        })
        expect(entry.intent.actor.employeeId).toBe(f.ownerEmployeeId)
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
        const first = await repos.evidence.save(evidenceSet('4.1'))
        const second = await repos.evidence.save(evidenceSet('4.2'))
        expect(first.id).not.toBe(second.id)
      })

      it('keeps the first stored result', async () => {
        const result: StoredResult = {
          key: 'result-1',
          claims: [],
          storedAt: AT,
          providerKind: 'recorded',
          inputs: {
            evidenceSetId: 'set-1',
            caseId: 'case-1',
            executionIdentity: 'model|p|1|ph|anthropic|m|mh',
            agentContractVersion: '1',
            outputSchemaVersion: '1',
            canonicalizationVersion: '1',
            agentImplementationVersion: '1',
            departmentId: f.departmentId,
          },
        }
        await repos.results.put(result, await repos.provenance())
        const replay = await repos.results.put(result, await repos.provenance())

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
          reviewId: 'v-rev-1-second',
          sequence: 2,
          at: LATER,
          status: 'correction-required',
          reason: 'A later check found the CPI series had been revised.',
          supersedesReviewId: submission.reviewId,
        } as VerificationReview)

        const both = await repos.reviews.verificationsForCase('case-1')
        expect(both).toHaveLength(2)
        // Ordered by sequence, so "the current verdict" is a function of the
        // data rather than of two equal timestamps.
        expect(both.map((review) => review.sequence)).toEqual([1, 2])
        expect(both.at(-1)!.supersedesReviewId).toBe(submission.reviewId)
      })

      it('keeps the four control functions apart', async () => {
        await repos.cases.create(investmentCase())
        await repos.reviews.saveVerification(verification('case'))
        await repos.reviews.saveCompliance({
          scope: 'case',
          caseId: 'case-1',
          reviewId: 'c-case',
          sequence: 1,
          byEmployeeId: f.governanceEmployeeId,
          byDepartmentId: f.governanceDepartmentId,
          at: AT,
          status: 'approved',
          findings: [],
        })
        await repos.reviews.saveRisk({
          scope: 'case',
          caseId: 'case-1',
          reviewId: 'r-case',
          sequence: 1,
          byEmployeeId: f.governanceEmployeeId,
          byDepartmentId: f.governanceDepartmentId,
          at: AT,
          status: 'accepted',
          findings: [{ kind: 'downside', detail: 'duration', severity: 'material' }],
        })

        expect(await repos.reviews.verificationsForCase('case-1')).toHaveLength(1)
        expect(await repos.reviews.complianceForCase('case-1')).toHaveLength(1)
        expect(await repos.reviews.riskForCase('case-1')).toHaveLength(1)
        expect(
          (await repos.reviews.riskForCase('case-1'))[0]!.findings.map((x) => x.kind),
        ).toEqual(['downside'])
      })
    })

    /* ----------------------------------------------------------- decisions */

    /*
     * The decision contract moves to C1D-1B, with the repository it tests.
     * Migration 0020 restructures `case_decisions` and the C1D-1 review
     * removed the fabricated governance snapshot, so these tests described a
     * shape that no longer exists — keeping them would have meant asserting
     * the old record was still correct.
     */

    describe('null is not the same as absent (B1)', () => {
      it('keeps fromState present and null on a creation event', async () => {
        await repos.cases.create(investmentCase())
        await repos.events.append(event('e-1', { fromState: null, toState: 'intake' }))

        const stored = (await repos.events.listForCase('case-1'))[0]!
        // Both halves matter. `undefined` reads as "we do not know", and null
        // is the recorded fact that there was no previous state.
        expect(stored.fromState).toBeNull()
        expect('fromState' in stored).toBe(true)
      })

      /*
       * Decision coverage moves to C1D-1B with the repository it tests. The
       * shape it asserted no longer exists: migration 0020 restructures
       * `case_decisions`, and the C1D-1 review removed the governance
       * snapshot whose compliance field had to be invented.
       */
      it('refuses a stored result whose claims changed under the same key', async () => {
        await seedCase()
        const base = storedResult()
        const provenance = await repos.provenance()
        await repos.results.put(base, provenance)
        await expect(
          repos.results.put({ ...base, claims: [claim('claim-x')] }, provenance),
        ).rejects.toBeInstanceOf(ConflictingRecordError)
      })

      it('refuses an event whose facts changed under the same id', async () => {
        // Append-only: the same id carrying different facts is a rewrite of
        // history attempted through the one door meant to refuse it.
        await repos.cases.create(investmentCase())
        await repos.events.append(
          event('e-1', { fromState: 'intake', toState: 'research', ...actor }),
        )
        await expect(
          repos.events.append(
            event('e-1', { fromState: 'intake', toState: 'aggregation', ...actor }),
          ),
        ).rejects.toBeInstanceOf(ConflictingRecordError)
      })

      it('accepts an identical event replay', async () => {
        await repos.cases.create(investmentCase())
        const replayed = event('e-1', {
          fromState: 'intake',
          toState: 'research',
          ...actor,
        })
        await repos.events.append(replayed)
        await repos.events.append(replayed)
        expect(await repos.events.listForCase('case-1')).toHaveLength(1)
      })
    })

    describe('run events accumulate (B3)', () => {
      it('does not erase earlier events when a later save carries fewer', async () => {
        const { setId } = await seedCase()
        await saveRun('run-2', setId, {
          events: [{ runId: 'run-2', at: AT, state: 'queued' }],
        })
        await saveRun('run-2', setId, {
          events: [{ runId: 'run-2', at: LATER, state: 'running' }],
        })

        const stored = await repos.runs.get('run-2')
        expect(stored!.events.map((entry) => entry.state)).toEqual(['queued', 'running'])
      })

      it('is idempotent for an identical event', async () => {
        const { setId } = await seedCase()
        const events = [{ runId: 'run-3', at: AT, state: 'queued' as const }]
        await saveRun('run-3', setId, { events })
        await saveRun('run-3', setId, { events })

        expect((await repos.runs.get('run-3'))!.events).toHaveLength(1)
      })

      it('refuses the same instant and state recorded with a different reason', async () => {
        const { setId } = await seedCase()
        await saveRun('run-4', setId, {
          events: [{ runId: 'run-4', at: AT, state: 'queued', reason: 'first' }],
        })
        await expect(
          saveRun('run-4', setId, {
            events: [{ runId: 'run-4', at: AT, state: 'queued', reason: 'second' }],
          }),
        ).rejects.toBeInstanceOf(ConflictingRecordError)
      })
    })

    /*
     * B4 — atomicity of a multi-statement write — is asserted in
     * `adapter.pg.test.ts` rather than here.
     *
     * Not an exemption: the property is real and tested. It is simply not
     * SHARED. The in-memory store writes each aggregate with a single map
     * assignment, so it has no partial state to leave behind and no foreign
     * key to fail on halfway. Only the adapter that decomposes one logical
     * write into several statements can be asked whether those statements are
     * atomic, and forcing a shared version would mean branching an assertion
     * on which store was running.
     *
     * What IS shared is the observable guarantee both stores make: a failed
     * `withTransaction` leaves nothing behind, asserted above.
     */

    describe('reads are one coherent snapshot (H1)', () => {
      it('never returns a case assembled from two different moments', async () => {
        /*
         * A case and its participants are separate statements. Read outside a
         * transaction on a pool they could observe different moments and
         * assemble a state that never existed.
         */
        await repos.cases.create(investmentCase())
        const reads = await Promise.all([
          repos.cases.get('case-1'),
          repos.cases.get('case-1'),
          repos.cases.get('case-1'),
        ])
        for (const value of reads) {
          expect(value!.participatingDepartmentIds).toEqual([f.departmentId])
        }
      })
    })

    describe('a verification citation keeps its content hash (H2)', () => {
      it('round-trips the exact evidence reference', async () => {
        const { setId, observationId } = await seedCase()
        await repos.claims.save(claim('claim-1'), 'case-1', 'run-1')
        await repos.reviews.saveVerification(
          verification('case', {
            status: 'correction-required',
            findings: [
              {
                kind: 'revised-evidence',
                claimId: 'claim-1',
                detail: 'the yield moved after this was cited',
                blocking: true,
                severity: 'critical',
                correctionRequired: 'Re-cite against the current observation.',
                citedContentHash: 'the-hash-at-citation',
                evidence: { setId, observationId, contentHash: 'the-hash-at-citation' },
              },
            ],
          }),
        )

        const stored = (await repos.reviews.verificationsForCase('case-1'))[0]!
        // An empty hash would make revision undetectable, which is the one
        // thing the hash exists for.
        expect(stored.findings[0]!.evidence).toEqual({
          setId,
          observationId,
          contentHash: 'the-hash-at-citation',
        })
      })
    })

    describe('actors are never invented (H3)', () => {
      it('refuses to construct a case movement that names no actor', () => {
        /*
         * Refused at the earliest point rather than papered over at the latest.
         * The adapter used to fill a missing actor with an empty string, which
         * reads as an employee; the domain now declines to build the event at
         * all, migration 0012's CHECK backs it, and the mappers raise
         * `MalformedRowError` for rows that predate both.
         */
        expect(() => event('e-1', { fromState: 'intake', toState: 'research' })).toThrow(
          /names no actor/,
        )
      })

      it('does not treat a creation event as a movement', async () => {
        // A creation has no previous state, so it is not a transition — and
        // `CaseTransition.from` is required, so including it would mean
        // inventing a stage the case was never in.
        await repos.cases.create(investmentCase())
        await repos.events.append(event('e-1', { fromState: null, toState: 'intake' }))

        expect((await repos.cases.get('case-1'))!.transitions).toEqual([])
        expect(await repos.events.listForCase('case-1')).toHaveLength(1)
      })
    })

    describe('playbook assignment identity (H5)', () => {
      it('refuses a second assignment for the same case and playbook entry', async () => {
        await repos.cases.create(investmentCase())
        await repos.assignments.save(
          assignment('a-macro', { playbookEntryKey: 'macro-analysis' }),
        )
        await expect(
          repos.assignments.save(
            assignment('a-macro-again', { playbookEntryKey: 'macro-analysis' }),
          ),
        ).rejects.toBeInstanceOf(DuplicateRecordError)
      })

      it('permits several ad-hoc assignments on one case', async () => {
        await repos.cases.create(investmentCase())
        await repos.assignments.save(assignment('a-1'))
        await repos.assignments.save(assignment('a-2'))
        expect(await repos.assignments.listForCase('case-1')).toHaveLength(2)
      })

      it('round-trips the playbook entry key', async () => {
        await repos.cases.create(investmentCase())
        await repos.assignments.save(
          assignment('a-macro', { playbookEntryKey: 'macro-analysis' }),
        )
        expect((await repos.assignments.get('a-macro'))!.playbookEntryKey).toBe(
          'macro-analysis',
        )
      })

      it('lets the same entry key be reused on a different case', async () => {
        await repos.cases.create(investmentCase())
        await repos.cases.create(investmentCase({ id: 'case-2' }))
        await repos.assignments.save(
          assignment('a-1', { playbookEntryKey: 'macro-analysis' }),
        )
        await expect(
          repos.assignments.save(
            assignment('a-2', { caseId: 'case-2', playbookEntryKey: 'macro-analysis' }),
          ),
        ).resolves.toBeDefined()
      })
    })

    /*
     * The decision contract moves to C1D-1B, with the repository it tests.
     * Migration 0020 restructures `case_decisions` and the C1D-1 review
     * removed the fabricated governance snapshot, so these tests described a
     * shape that no longer exists — keeping them would have meant asserting
     * the old record was still correct.
     */

    describe('playbook versions', () => {
      const playbook = contractPlaybook

      it('round-trips entries, both edge kinds and the rule reference', async () => {
        await repos.playbooks.register(playbook())
        const stored = await repos.playbooks.get('contract-playbook', '1')

        expect(stored).not.toBeNull()
        const gate = stored!.entries.find((e) => e.key === 'gate')!
        expect(gate.blockedBy).toEqual(['primary'])
        expect(gate.optionalInputs).toEqual(['supporting'])
        expect(gate.requirement).toBe('conditional')
        expect(gate.conditionalRule?.ruleVersion).toBe('1')
      })

      it('orders entries by priority descending, then key', async () => {
        await repos.playbooks.register(playbook())
        const stored = await repos.playbooks.get('contract-playbook', '1')
        expect(stored!.entries.map((e) => e.key)).toEqual([
          'primary',
          'supporting',
          'gate',
        ])
      })

      it('returns the stored version on an identical re-registration', async () => {
        const first = await repos.playbooks.register(playbook())
        const second = await repos.playbooks.register(playbook())
        expect(playbookContentHash(second)).toBe(playbookContentHash(first))
      })

      it('refuses one version carrying two different workflows', async () => {
        await repos.playbooks.register(playbook())
        const edited = playbook({
          entries: playbook().entries.filter((e) => e.key !== 'gate'),
        })
        await expect(repos.playbooks.register(edited)).rejects.toBeInstanceOf(
          ConflictingRecordError,
        )
      })

      it('keeps two versions of one playbook side by side', async () => {
        await repos.playbooks.register(playbook())
        await repos.playbooks.register(playbook({ version: '2' }))

        expect(await repos.playbooks.get('contract-playbook', '1')).not.toBeNull()
        expect(await repos.playbooks.get('contract-playbook', '2')).not.toBeNull()
      })

      it('returns null for a version that was never registered', async () => {
        expect(await repos.playbooks.get('contract-playbook', '9')).toBeNull()
      })

      it('returns deeply frozen playbooks', async () => {
        await repos.playbooks.register(playbook())
        const stored = await repos.playbooks.get('contract-playbook', '1')
        expect(isDeeplyFrozen(stored)).toBe(true)
      })
    })

    /* ----------------------------------------------- requirement resolutions */

    describe('requirement resolutions', () => {
      const evaluator = (): ActorSnapshot => ({
        kind: 'employee',
        employeeId: f.governanceEmployeeId,
        roleId: 'governance-role',
        roleFunction: 'governance',
        departmentId: f.governanceDepartmentId,
        departmentIsGovernance: true,
        departmentHandles: ['verification'],
        authentication: 'system-asserted',
        organizationSeedVersion: 'seed',
      })

      const resolution = (
        over: Partial<RequirementResolution> = {},
      ): RequirementResolution => ({
        caseId: 'case-1',
        playbookEntryKey: 'gate',
        revisionId: 'rev-1',
        state: 'required',
        ruleId: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleId,
        ruleVersion: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleVersion,
        reason: 'The revision declares implementation implications.',
        inputHash: 'hash-of-the-normalized-implications',
        evaluatedAt: AT,
        evaluatedBy: evaluator(),
        ...over,
      })

      beforeEach(async () => {
        await repos.cases.create(investmentCase())
        await repos.theses.save(thesis())
      })

      it('stores a resolution scoped to an exact revision', async () => {
        const provenance = await repos.provenance()
        await repos.requirements.save(resolution(), provenance)

        const stored = await repos.requirements.listForCase('case-1')
        expect(stored).toHaveLength(1)
        expect(stored[0]!.revisionId).toBe('rev-1')
        expect(stored[0]!.state).toBe('required')
        expect(stored[0]!.evaluatedBy.employeeId).toBe(f.governanceEmployeeId)
      })

      it('records not-required explicitly rather than as an absence', async () => {
        const provenance = await repos.provenance()
        await repos.requirements.save(resolution({ state: 'not-required' }), provenance)

        const stored = await repos.requirements.listForCase('case-1')
        expect(stored[0]!.state).toBe('not-required')
        // A recorded no and an absence are different facts, and stay different.
        expect(requirementStatusFor('gate', 'rev-1', stored).state).toBe('not-required')
        expect(requirementStatusFor('other', 'rev-1', stored).state).toBe('unresolved')
      })

      it('replays an identical evaluation recorded at a different instant', async () => {
        const provenance = await repos.provenance()
        await repos.requirements.save(resolution(), provenance)
        await repos.requirements.save(resolution({ evaluatedAt: LATER }), provenance)
        expect(await repos.requirements.listForCase('case-1')).toHaveLength(1)
      })

      it('refuses a contradictory second evaluation of the same revision', async () => {
        const provenance = await repos.provenance()
        await repos.requirements.save(resolution(), provenance)
        await expect(
          repos.requirements.save(resolution({ state: 'not-required' }), provenance),
        ).rejects.toBeInstanceOf(ConflictingRecordError)
      })

      it('orders by entry key, then revision', async () => {
        const provenance = await repos.provenance()
        await repos.theses.save(
          thesis({
            revisionId: 'rev-2',
            revisionNumber: 2,
            supersedesRevisionId: 'rev-1',
            revisionReason: 'new evidence',
          }),
        )
        await repos.requirements.save(resolution({ revisionId: 'rev-2' }), provenance)
        await repos.requirements.save(resolution(), provenance)
        await repos.requirements.save(
          resolution({ playbookEntryKey: 'a-gate' }),
          provenance,
        )

        const stored = await repos.requirements.listForCase('case-1')
        expect(stored.map((r) => r.playbookEntryKey + '|' + r.revisionId)).toEqual([
          'a-gate|rev-1',
          'gate|rev-1',
          'gate|rev-2',
        ])
      })

      it('returns deeply frozen resolutions', async () => {
        const provenance = await repos.provenance()
        await repos.requirements.save(resolution(), provenance)
        const stored = await repos.requirements.listForCase('case-1')
        expect(isDeeplyFrozen(stored[0])).toBe(true)
      })
    })

    describe('methods survive being destructured', () => {
      it('works when a repository method is taken as a value', async () => {
        // The adapters must not differ in whether `this` is required.
        const { create } = repos.cases
        const { get } = repos.cases
        await create(investmentCase())
        expect((await get('case-1'))!.id).toBe('case-1')
      })
    })

    describe('provenance', () => {
      it('reports which implementation and which domain contract', async () => {
        /*
         * A literal, deliberately, and a second one independent of the pin in
         * `domainContractVersion.test.ts`. That pin proves the constant was
         * advanced on purpose; this proves both adapters actually *report* the
         * advanced value through provenance. Parity alone would not: the drift
         * that left this at '6' for two phases passed a parity assertion the
         * whole time, because both adapters read the same wrong constant.
         */
        const provenance = await repos.provenance()
        expect(provenance.adapterId).toBeTruthy()
        expect(provenance.adapterVersion).toBeTruthy()
        expect(provenance.domainContractVersion).toBe('11')
      })
    })
  })
}
