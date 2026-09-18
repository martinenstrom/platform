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
  buildObservation,
  type EvidenceAssembly,
  observationRefV1,
  buildRunRecord,
  budgetOverruns,
  NON_CONSUMING_BUDGET,
  buildThesis,
  buildProducedSynthesis,
  synthesisHashMatches,
  buildTransitionEvent,
  modelOf,
  observationRef,
  type AgentClaim,
  type CaseAmendment,
  type EvidenceSet,
  type InvestmentCase,
  type InvestmentThesis,
  type SynthesisArtifact,
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
                /* The payload's own observation date, as `yieldRef` supplies it. */
                referencePeriod: '2026-07-28',
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
        budget: NON_CONSUMING_BUDGET,
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

      it('round-trips both key generations, and keeps them distinguishable', async () => {
        /*
         * Gate §0.1, executed at the storage layer: a v1 record stays a valid
         * historical institutional record and must remain resolvable AS v1.
         *
         * Both halves are load-bearing. `buildEvidenceSet` verifies every item
         * by recomputing its id under the row's own generation, so a store that
         * dropped `key_generation` or `reference_period` would rehydrate a v2
         * item as an unverifiable one and this would fail on the set id — which
         * is exactly the failure a silent column would otherwise hide until a
         * citation stopped resolving in production.
         */
        const historical = buildEvidenceSet({
          items: [
            {
              ref: observationRefV1(
                {
                  subjectKind: 'series',
                  subject: 'US10Y',
                  kind: 'yield',
                  observedAt: AT,
                  sourceId: 'treasury',
                },
                {
                  yieldPercent: '4.0',
                  changeBasisPoints: null,
                  observationDate: '2026-07-28',
                },
              ),
              value: {
                yieldPercent: '4.0',
                changeBasisPoints: null,
                observationDate: '2026-07-28',
              },
              provenance: { source: { providerId: 'treasury' }, quality: 'ok' } as never,
            },
          ],
          assembledAt: AT,
          correlationId: 'corr-v1',
        })

        await repos.evidence.save(historical)
        const readBack = await repos.evidence.get(historical.id)

        expect(readBack?.id).toBe(historical.id)
        expect(readBack?.items[0]!.ref.keyGeneration).toBe(1)
        expect(readBack?.items[0]!.ref.referencePeriod).toBeUndefined()

        const current = await repos.evidence.get(
          (await repos.evidence.save(evidenceSet())).id,
        )
        expect(current?.items[0]!.ref.keyGeneration).toBe(2)
        expect(current?.items[0]!.ref.referencePeriod).toBe('2026-07-28')
      })
    })

    /* -------------------------------------------------------------- order */

    /* ---------------------------------------------------------- amendments */

    describe('what the person added to a case', () => {
      const amendment = (over: Partial<CaseAmendment> = {}): CaseAmendment => ({
        id: 'am-1',
        caseId: 'case-1',
        text: 'Ta hänsyn till dollarn också.',
        byEmployeeId: f.ownerEmployeeId,
        byDepartmentId: f.departmentId,
        at: AT,
        caseVersion: 1,
        ...over,
      })

      it('returns an empty list, never null, for a case with no additions', async () => {
        expect(await repos.amendments.listForCase('missing')).toEqual([])
      })

      it('returns null for an addition that does not exist, and the addition by its id once it does', async () => {
        expect(await repos.amendments.get('missing')).toBeNull()
        await repos.cases.create(investmentCase())
        await repos.amendments.append(amendment())
        expect(await repos.amendments.get('am-1')).toEqual(amendment())
      })

      it('round-trips an addition beside the case, leaving the question untouched', async () => {
        await repos.cases.create(investmentCase())
        const stored = await repos.amendments.append(amendment())
        expect(stored).toEqual(amendment())
        expect(await repos.amendments.listForCase('case-1')).toEqual([amendment()])
        expect((await repos.cases.get('case-1'))?.question).toBe(
          'Is the market pricing the policy path correctly?',
        )
      })

      it('is idempotent on append — a replay returns what was stored, and never rewords it', async () => {
        await repos.cases.create(investmentCase())
        await repos.amendments.append(amendment())
        const replayed = await repos.amendments.append(amendment({ text: 'reworded' }))
        expect(replayed.text).toBe('Ta hänsyn till dollarn också.')
        expect(await repos.amendments.listForCase('case-1')).toHaveLength(1)
      })

      it('lists additions by when they were made, then id', async () => {
        await repos.cases.create(investmentCase())
        await repos.amendments.append(amendment({ id: 'am-b', at: LATER }))
        await repos.amendments.append(amendment({ id: 'am-c', at: AT }))
        await repos.amendments.append(amendment({ id: 'am-a', at: AT }))
        expect((await repos.amendments.listForCase('case-1')).map((a) => a.id)).toEqual([
          'am-a',
          'am-c',
          'am-b',
        ])
      })

      it('freezes what it reads', async () => {
        await repos.cases.create(investmentCase())
        await repos.amendments.append(amendment())
        for (const stored of await repos.amendments.listForCase('case-1')) {
          expect(isDeeplyFrozen(stored)).toBe(true)
        }
      })
    })

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

    describe('durable observations', () => {
      /**
       * A Treasury par yield, as ingestion produces one.
       *
       * `published` is when the source put it out; `learned` is when the firm
       * ingested it. Kept separate in every case below, because collapsing them
       * is what makes "what did we know in March" unanswerable.
       */
      const yieldAt = (args: {
        period: string
        percent: string
        published: string
        learned: string
        subject?: string
      }) => {
        const value = {
          yieldPercent: args.percent,
          changeBasisPoints: null,
          observationDate: args.period,
        }
        return buildObservation({
          ref: observationRef(
            {
              subjectKind: 'instrument',
              subject: args.subject ?? 'rate:us10y',
              kind: 'yield',
              observedAt: args.published,
              referencePeriod: args.period,
              sourceId: 'treasury',
              seriesId: 'BC_10YEAR',
              methodology: 'par-yield',
            },
            value,
          ),
          value,
          provenance: { source: { providerId: 'treasury' }, quality: 'ok' } as never,
          recordedAt: args.learned,
          correlationId: 'ingest-1',
        })
      }

      const series = (from = '2026-08-10', to = '2026-08-20', knownAt?: string) =>
        repos.observations.series({
          subject: 'rate:us10y',
          kind: 'yield',
          sourceId: 'treasury',
          from,
          to,
          ...(knownAt === undefined ? {} : { knownAt }),
        })

      it('records an observation and reads it back by its exact version', async () => {
        const observation = yieldAt({
          period: '2026-08-14',
          percent: '4.10',
          published: '2026-08-14T20:00:00.000Z',
          learned: '2026-08-15T06:00:00.000Z',
        })
        const recorded = await repos.observations.record([observation], prov)
        expect(recorded).toHaveLength(1)

        const stored = await repos.observations.get(
          observation.ref.id,
          observation.ref.contentHash,
        )
        expect(stored?.ref.id).toBe(observation.ref.id)
        expect(stored?.ref.referencePeriod).toBe('2026-08-14')
        expect(stored?.ref.keyGeneration).toBe(2)
        expect(stored?.recordedAt).toBe('2026-08-15T06:00:00.000Z')
        expect(stored?.value).toEqual({
          yieldPercent: '4.10',
          changeBasisPoints: null,
          observationDate: '2026-08-14',
        })
      })

      it('is idempotent on re-ingesting an unchanged figure', async () => {
        /*
         * The property the whole ingestion act rests on. Polling the Treasury
         * daily re-reads the same month page, so almost every observation it
         * offers is already held — and that has to be a no-op reporting nothing
         * new, not a conflict and not a duplicate.
         */
        const observation = yieldAt({
          period: '2026-08-14',
          percent: '4.10',
          published: '2026-08-14T20:00:00.000Z',
          learned: '2026-08-15T06:00:00.000Z',
        })
        expect(await repos.observations.record([observation], prov)).toHaveLength(1)

        const relearned = { ...observation, recordedAt: '2026-08-16T06:00:00.000Z' }
        expect(await repos.observations.record([relearned], prov)).toHaveLength(0)

        const versions = await repos.observations.versions(observation.ref.id)
        expect(versions).toHaveLength(1)
        /* The first learning stands. A re-poll does not restate when we learned. */
        expect(versions[0]!.recordedAt).toBe('2026-08-15T06:00:00.000Z')
      })

      it('keeps a revision beside the original rather than over it', async () => {
        const original = yieldAt({
          period: '2026-08-14',
          percent: '4.10',
          published: '2026-08-14T20:00:00.000Z',
          learned: '2026-08-15T06:00:00.000Z',
        })
        const revised = yieldAt({
          period: '2026-08-14',
          percent: '4.12',
          published: '2026-08-17T20:00:00.000Z',
          learned: '2026-08-18T06:00:00.000Z',
        })

        await repos.observations.record([original], prov)
        await repos.observations.record([revised], prov)

        /* Same fact, two versions — which is what v2's key makes expressible. */
        expect(revised.ref.id).toBe(original.ref.id)
        expect(revised.ref.contentHash).not.toBe(original.ref.contentHash)

        const versions = await repos.observations.versions(original.ref.id)
        expect(versions).toHaveLength(2)
        expect(versions.map((entry) => entry.recordedAt)).toEqual([
          '2026-08-15T06:00:00.000Z',
          '2026-08-18T06:00:00.000Z',
        ])
        /* The superseded value is still readable, exactly as published. */
        expect(
          (await repos.observations.get(original.ref.id, original.ref.contentHash))
            ?.value,
        ).toEqual({
          yieldPercent: '4.10',
          changeBasisPoints: null,
          observationDate: '2026-08-14',
        })
      })

      it('returns a series of individually citable observations, one per period', async () => {
        await repos.observations.record(
          [
            yieldAt({
              period: '2026-08-12',
              percent: '4.05',
              published: '2026-08-12T20:00:00.000Z',
              learned: '2026-08-13T06:00:00.000Z',
            }),
            yieldAt({
              period: '2026-08-13',
              percent: '4.08',
              published: '2026-08-13T20:00:00.000Z',
              learned: '2026-08-14T06:00:00.000Z',
            }),
            yieldAt({
              period: '2026-08-14',
              percent: '4.10',
              published: '2026-08-14T20:00:00.000Z',
              learned: '2026-08-15T06:00:00.000Z',
            }),
          ],
          prov,
        )

        const points = await series()
        expect(points.map((point) => point.ref.referencePeriod)).toEqual([
          '2026-08-12',
          '2026-08-13',
          '2026-08-14',
        ])
        /*
         * Every element carries its own reference and content hash. That is the
         * difference between a series-as-query and a stored Series aggregate: a
         * claim cites the 13 August print, not "the series".
         */
        const ids = new Set(points.map((point) => point.ref.id))
        expect(ids.size).toBe(3)
        for (const point of points) expect(point.ref.contentHash).toMatch(/^[0-9a-f]+$/)
      })

      it('bounds a series by reference period, not by when it was learned', async () => {
        await repos.observations.record(
          [
            yieldAt({
              period: '2026-08-09',
              percent: '4.00',
              published: '2026-08-09T20:00:00.000Z',
              learned: '2026-08-10T06:00:00.000Z',
            }),
            yieldAt({
              period: '2026-08-14',
              percent: '4.10',
              published: '2026-08-14T20:00:00.000Z',
              learned: '2026-08-15T06:00:00.000Z',
            }),
            yieldAt({
              period: '2026-08-21',
              percent: '4.20',
              published: '2026-08-21T20:00:00.000Z',
              learned: '2026-08-22T06:00:00.000Z',
            }),
          ],
          prov,
        )

        expect((await series()).map((point) => point.ref.referencePeriod)).toEqual([
          '2026-08-14',
        ])
      })

      it('reports the latest version of a revised period by default', async () => {
        await repos.observations.record(
          [
            yieldAt({
              period: '2026-08-14',
              percent: '4.10',
              published: '2026-08-14T20:00:00.000Z',
              learned: '2026-08-15T06:00:00.000Z',
            }),
            yieldAt({
              period: '2026-08-14',
              percent: '4.12',
              published: '2026-08-17T20:00:00.000Z',
              learned: '2026-08-18T06:00:00.000Z',
            }),
          ],
          prov,
        )

        const points = await series()
        expect(points).toHaveLength(1)
        expect((points[0]!.value as { yieldPercent: string }).yieldPercent).toBe('4.12')
      })

      it('reads the series as the institution knew it at an earlier moment', async () => {
        /*
         * The bitemporal question, and the reason `recordedAt` is stored.
         *
         * A decision taken on 16 August rested on 4.10, because that is what the
         * firm held. Judging it against 4.12 — a figure that did not exist yet —
         * would be judging it against evidence it could not have had.
         */
        await repos.observations.record(
          [
            yieldAt({
              period: '2026-08-14',
              percent: '4.10',
              published: '2026-08-14T20:00:00.000Z',
              learned: '2026-08-15T06:00:00.000Z',
            }),
            yieldAt({
              period: '2026-08-14',
              percent: '4.12',
              published: '2026-08-17T20:00:00.000Z',
              learned: '2026-08-18T06:00:00.000Z',
            }),
          ],
          prov,
        )

        const asKnownThen = await series(
          '2026-08-10',
          '2026-08-20',
          '2026-08-16T00:00:00.000Z',
        )
        expect(asKnownThen).toHaveLength(1)
        expect((asKnownThen[0]!.value as { yieldPercent: string }).yieldPercent).toBe(
          '4.10',
        )

        /* Before the firm knew anything at all, the series is empty. */
        expect(
          await series('2026-08-10', '2026-08-20', '2026-08-01T00:00:00.000Z'),
        ).toHaveLength(0)
      })

      it('does not mix two subjects into one series', async () => {
        await repos.observations.record(
          [
            yieldAt({
              period: '2026-08-14',
              percent: '4.10',
              published: '2026-08-14T20:00:00.000Z',
              learned: '2026-08-15T06:00:00.000Z',
            }),
            yieldAt({
              period: '2026-08-14',
              percent: '3.90',
              published: '2026-08-14T20:00:00.000Z',
              learned: '2026-08-15T06:00:00.000Z',
              subject: 'rate:us2y',
            }),
          ],
          prov,
        )

        const points = await series()
        expect(points).toHaveLength(1)
        expect(points[0]!.ref.subject).toBe('rate:us10y')
      })

      it('refuses an observation whose value does not match its reference', async () => {
        /*
         * The planted violation. A store that accepted this would hold a record
         * no citation could ever be checked against — and would accept it
         * silently, which is the failure worth refusing loudly.
         */
        const sound = yieldAt({
          period: '2026-08-14',
          percent: '4.10',
          published: '2026-08-14T20:00:00.000Z',
          learned: '2026-08-15T06:00:00.000Z',
        })
        expect(() =>
          buildObservation({
            ...sound,
            value: {
              yieldPercent: '9.99',
              changeBasisPoints: null,
              observationDate: '2026-08-14',
            },
          }),
        ).toThrow(/not admissible/)
      })
    })

    /* ------------------------------------------------- the assembly acts */

    describe('the assembly acts', () => {
      /**
       * One recorded act, pointing at a set the store actually holds.
       *
       * The set is saved first, deliberately: the foreign key in migration
       * `0033` is real, and an act pointing at a set the firm does not hold
       * would be a record of nothing.
       */
      const act = (over: Partial<EvidenceAssembly> = {}): EvidenceAssembly => ({
        assemblyId: 'asm-1',
        evidenceSetId: evidenceSet().id,
        selection: {
          ruleId: 'sovereign-yield-curve@1',
          subjectFamily: 'us-par-curve',
          from: '2026-08-01',
          to: '2026-08-31',
          knownAt: '2026-08-20T09:00:00.000Z',
        },
        selectedSubjects: ['rate:us2y', 'rate:us10y'],
        observationCount: 2,
        derivedCount: 1,
        assembledAt: '2026-08-20T09:00:00.000Z',
        actorEmployeeId: 'research-director',
        onBehalfOfDepartmentId: 'research-office',
        correlationId: 'corr-1',
        ...over,
      })

      it('records the act, the rule, the window and the knowledge time', async () => {
        await repos.evidence.save(evidenceSet())
        const recorded = await repos.assemblies.record(act(), prov)

        expect(recorded.selection.ruleId).toBe('sovereign-yield-curve@1')
        expect(recorded.selection.subjectFamily).toBe('us-par-curve')
        expect(recorded.selection.from).toBe('2026-08-01')
        expect(recorded.selection.to).toBe('2026-08-31')
        expect(recorded.selection.knownAt).toBe('2026-08-20T09:00:00.000Z')
        expect(recorded.selectedSubjects).toEqual(['rate:us2y', 'rate:us10y'])
        expect(recorded.actorEmployeeId).toBe('research-director')
        expect(recorded.onBehalfOfDepartmentId).toBe('research-office')

        expect(await repos.assemblies.get('asm-1')).toEqual(recorded)
      })

      it('returns null for an act the firm never recorded', async () => {
        expect(await repos.assemblies.get('asm-missing')).toBeNull()
      })

      it('replays the same act rather than filing a second one', async () => {
        await repos.evidence.save(evidenceSet())
        await repos.assemblies.record(act(), prov)
        const replay = await repos.assemblies.record(act(), prov)

        expect(replay.assemblyId).toBe('asm-1')
        expect(await repos.assemblies.list(10)).toHaveLength(1)
      })

      it('refuses a DIFFERENT act filed under the same identity', async () => {
        /*
         * The planted violation. Two judgements under one command id is a real
         * disagreement rather than a retry, and returning the stored one
         * silently would hide which of the two the firm actually acted on.
         */
        await repos.evidence.save(evidenceSet())
        await repos.assemblies.record(act(), prov)
        await expect(
          repos.assemblies.record(
            act({ selection: { ...act().selection, to: '2026-09-30' } }),
            prov,
          ),
        ).rejects.toThrow(ConflictingRecordError)
      })

      it('reaches one set from every act that produced it, newest first', async () => {
        await repos.evidence.save(evidenceSet())
        await repos.assemblies.record(act(), prov)
        await repos.assemblies.record(
          act({ assemblyId: 'asm-2', assembledAt: '2026-08-21T09:00:00.000Z' }),
          prov,
        )

        const acts = await repos.assemblies.forSet(evidenceSet().id)
        expect(acts.map((a) => a.assemblyId)).toEqual(['asm-2', 'asm-1'])
        /* A set nobody assembled through the act is reached by none. */
        expect(await repos.assemblies.forSet('no-such-set')).toEqual([])
      })

      it('lists the most recent acts, newest first and bounded', async () => {
        await repos.evidence.save(evidenceSet())
        await repos.assemblies.record(act(), prov)
        await repos.assemblies.record(
          act({ assemblyId: 'asm-2', assembledAt: '2026-08-21T09:00:00.000Z' }),
          prov,
        )

        expect((await repos.assemblies.list(10)).map((a) => a.assemblyId)).toEqual([
          'asm-2',
          'asm-1',
        ])
        expect(await repos.assemblies.list(1)).toHaveLength(1)
      })
    })

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

    /* ------------------------------------------------------- produced work */

    /**
     * Work an agent produced that no human has accepted.
     *
     * Kept apart from the claims store on purpose: every citation in the
     * institution resolves against `claims`, so work that is not in it cannot
     * be cited. In PostgreSQL that is a foreign key; in memory it is the same
     * absence. Both are checked here, against the same expectations, because
     * the contract is the authority and neither adapter defines this alone.
     */
    describe('produced claims are stored apart from the record', () => {
      it('reads back what a run produced', async () => {
        await seedCase()
        await repos.producedClaims.record('run-1', 'case-1', [claim('p-2'), claim('p-1')])

        const produced = await repos.producedClaims.listForRun('run-1')
        // Ordered by id, like the institutional repository it mirrors.
        expect(produced.map((c) => c.id)).toEqual(['p-1', 'p-2'])
      })

      it('keeps produced work out of the institutional store', async () => {
        await seedCase()
        await repos.producedClaims.record('run-1', 'case-1', [claim('p-1')])

        /*
         * The assertion the whole separation exists for. Producing work must
         * not make it findable where citations look.
         */
        expect(await repos.claims.get('p-1')).toBeNull()
        expect(await repos.claims.listForCase('case-1')).toEqual([])
        expect(await repos.claims.listForRun('run-1')).toEqual([])
      })

      it('accepts the identical set again as the replay it is', async () => {
        await seedCase()
        await repos.producedClaims.record('run-1', 'case-1', [claim('p-1')])
        await repos.producedClaims.record('run-1', 'case-1', [claim('p-1')])

        expect(await repos.producedClaims.listForRun('run-1')).toHaveLength(1)
      })

      it('refuses a second, different account of what the agent returned', async () => {
        await seedCase()
        await repos.producedClaims.record('run-1', 'case-1', [claim('p-1')])

        await expect(
          repos.producedClaims.record('run-1', 'case-1', [
            claim('p-1', { statement: 'Something else entirely' }),
          ]),
        ).rejects.toThrow(ConflictingRecordError)
      })

      it('is empty for a run that produced nothing', async () => {
        await seedCase()
        expect(await repos.producedClaims.listForRun('run-1')).toEqual([])
      })

      it('refuses to record an empty production', async () => {
        await seedCase()
        /*
         * "The agent returned nothing" and "the agent was never asked" must not
         * be the same row.
         */
        await expect(repos.producedClaims.record('run-1', 'case-1', [])).rejects.toThrow()
      })
    })

    /* ------------------------------------------------ produced synthesis */

    /**
     * The Research Office's synthesis before anybody adopted it.
     *
     * The other half of the produced-work boundary, and held to the same rule:
     * nothing in the institution can reach it except the aggregation that
     * adopted it. Both adapters are checked against the same expectations,
     * because the contract is the authority and a store that agreed with itself
     * in memory and disagreed in PostgreSQL would be discovered by a live run.
     */
    describe('a produced synthesis is stored apart from the record', () => {
      const artifact = (over: Partial<SynthesisArtifact> = {}): SynthesisArtifact => ({
        statement: 'The policy path is mispriced',
        position: 'buy',
        rationale: 'The desks agree on direction.',
        invalidationCriteria: 'The curve reprices above 4%',
        implications: ['portfolio-risk'],
        inputRunIds: ['run-1'],
        dispositions: [{ claimId: 'c-1', disposition: 'adopted-supporting' }],
        optionalInputs: [
          {
            playbookEntryKey: 'optional-step',
            availability: 'unavailable-at-aggregation',
            materiallyRelevant: false,
            explanation: 'Nobody contributed it.',
          },
        ],
        ...over,
      })

      const candidate = (over: Partial<SynthesisArtifact> = {}) =>
        buildProducedSynthesis({
          runId: 'run-1',
          artifact: artifact(over),
          basis: {
            caseId: 'case-1',
            sourceRevisionId: 'rev-1',
            playbookId: 'contract-playbook',
            playbookVersion: '1',
            observedCompletedRunIds: ['run-earlier'],
          },
          producedAt: AT,
        })

      it('reads back exactly what was produced', async () => {
        await seedCase()
        const written = candidate()
        await repos.producedSyntheses.record(written)

        const stored = await repos.producedSyntheses.get('run-1')
        expect(stored).not.toBeNull()
        expect(stored!.artifact).toEqual(written.artifact)
        expect(stored!.basis).toEqual(written.basis)
        expect(stored!.contentHash).toBe(written.contentHash)
        /* And it still attests itself after the round trip. */
        expect(synthesisHashMatches(stored!)).toBe(true)
      })

      it('keeps an absent horizon absent rather than null', async () => {
        await seedCase()
        await repos.producedSyntheses.record(candidate())
        const stored = await repos.producedSyntheses.get('run-1')
        expect('horizon' in stored!.artifact).toBe(false)
      })

      it('round-trips a stated horizon', async () => {
        await seedCase()
        const written = candidate({ horizon: 'two quarters' })
        await repos.producedSyntheses.record(written)
        expect((await repos.producedSyntheses.get('run-1'))!.artifact.horizon).toBe(
          'two quarters',
        )
      })

      it('is null for a run that produced no synthesis', async () => {
        await seedCase()
        expect(await repos.producedSyntheses.get('run-1')).toBeNull()
      })

      it('accepts the identical candidate again as the replay it is', async () => {
        await seedCase()
        await repos.producedSyntheses.record(candidate())
        await repos.producedSyntheses.record(candidate())
        expect(await repos.producedSyntheses.get('run-1')).not.toBeNull()
      })

      it('refuses a second, different synthesis for the same run', async () => {
        await seedCase()
        await repos.producedSyntheses.record(candidate())

        /*
         * One run, one synthesis. A second one is not a retry — it is two
         * accounts of what the model concluded, and answering either silently
         * would settle that by luck.
         */
        await expect(
          repos.producedSyntheses.record(
            candidate({ statement: 'Something else entirely' }),
          ),
        ).rejects.toThrow(ConflictingRecordError)

        expect((await repos.producedSyntheses.get('run-1'))!.artifact.statement).toBe(
          'The policy path is mispriced',
        )
      })
    })

    /* ---------------------------------------------------------- rejection */

    describe('a run a person declined', () => {
      it('round-trips the rejection beside the run, not folded into failure', async () => {
        await seedCase()
        const stored = await repos.runs.save(
          run('run-1', (await repos.evidence.save(evidenceSet())).id, {
            state: 'rejected',
            completedAt: AT,
            rejection: {
              code: 'unsupported-by-evidence',
              detail: 'The claim outruns what the evidence shows.',
              rejectedByEmployeeId: f.ownerEmployeeId,
              rejectedAt: AT,
            },
          }),
          prov,
        )

        expect(stored.rejection).toEqual({
          code: 'unsupported-by-evidence',
          detail: 'The claim outruns what the evidence shows.',
          rejectedByEmployeeId: f.ownerEmployeeId,
          rejectedAt: AT,
        })
        /* A rejected run produced work; it did not fail. */
        expect(stored.failure).toBeUndefined()

        const read = await repos.runs.get('run-1')
        expect(read!.rejection).toEqual(stored.rejection)
        expect(read!.state).toBe('rejected')
      })

      it('carries no rejection on a run nobody declined', async () => {
        const { setId } = await seedCase()
        const read = await repos.runs.get('run-1')
        expect(read!.rejection).toBeUndefined()
        expect(setId).toBeTruthy()
      })

      it('frees the assignment for another attempt', async () => {
        /*
         * `rejected` is terminal, so it releases the one-active-run slot. If it
         * did not, the first rejection would be permanent: the desk could never
         * be asked again, because the store would refuse the second run. The
         * domain agrees — `isRunTerminal('rejected')` is true — and this is
         * where the two are checked against each other.
         */
        const { setId } = await seedCase()
        await repos.runs.save(
          run('run-1', setId, {
            state: 'rejected',
            completedAt: AT,
            rejection: {
              code: 'insufficient-analysis',
              detail: 'Went in the right direction and did not go far enough.',
              rejectedByEmployeeId: f.ownerEmployeeId,
              rejectedAt: AT,
            },
          }),
          prov,
        )

        const retry = await repos.runs.save(
          run('run-2', setId, { assignmentId: 'a-run-1' }),
          prov,
        )
        expect(retry.state).toBe('running')
        expect(retry.assignmentId).toBe('a-run-1')
      })

      it('still refuses a second run while the first awaits a person', async () => {
        /*
         * The near miss. `awaiting-acceptance` has NOT settled — somebody has
         * to act — so the slot stays taken and a second contribution against
         * the same assignment is refused.
         */
        const { setId } = await seedCase()
        await repos.runs.save(run('run-1', setId, { state: 'awaiting-acceptance' }), prov)

        await expect(
          repos.runs.save(run('run-2', setId, { assignmentId: 'a-run-1' }), prov),
        ).rejects.toThrow()
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

    describe('tokens and money are measured independently', () => {
      /*
       * The correction the live path earned. `measured` used to require all
       * four numbers together, which left the one combination a real model
       * provider produces — tokens counted, price unknown — unsayable, and
       * made a token budget unenforceable against the only producer that
       * spends tokens.
       */
      /** A live run refuses to start unbounded, so it carries a real budget. */
      const LIVE_BUDGET = {
        tokens: { kind: 'limit' as const, tokens: 40_000 },
        cost: { kind: 'limit' as const, costMinorUnits: 5_000, currency: 'USD' },
        deadline: { kind: 'limit' as const, deadlineMs: 30_000 },
      }

      it('round-trips tokens measured with the cost unreported', async () => {
        const { setId } = await seedCase()
        await saveRun('run-tokens-only', setId, {
          budget: LIVE_BUDGET,
          usage: {
            state: 'measured',
            inputTokens: 1_200,
            outputTokens: 300,
            cost: { state: 'not-reported' },
          },
          execution: { ...run('x', setId).execution, providerKind: 'live' },
        })

        expect((await repos.runs.get('run-tokens-only'))!.usage).toEqual({
          state: 'measured',
          inputTokens: 1_200,
          outputTokens: 300,
          cost: { state: 'not-reported' },
        })
      })

      it('keeps a measured zero distinct from an unknown cost', async () => {
        /*
         * The distinction 0017 was written to protect, carried through the
         * split. Zero is a provider saying the call was free; not-reported is
         * a provider saying nothing. Two different rows, two different facts.
         */
        const { setId } = await seedCase()
        const free = {
          state: 'measured' as const,
          inputTokens: 1,
          outputTokens: 1,
          cost: { state: 'measured' as const, costMinorUnits: 0, currency: 'USD' },
        }
        const unknown = {
          state: 'measured' as const,
          inputTokens: 1,
          outputTokens: 1,
          cost: { state: 'not-reported' as const },
        }

        await saveRun('run-free', setId, {
          budget: LIVE_BUDGET,
          usage: free,
          execution: { ...run('x', setId).execution, providerKind: 'live' },
        })
        await saveRun('run-unknown', setId, {
          budget: LIVE_BUDGET,
          usage: unknown,
          execution: { ...run('x', setId).execution, providerKind: 'live' },
        })

        const storedFree = (await repos.runs.get('run-free'))!.usage
        const storedUnknown = (await repos.runs.get('run-unknown'))!.usage
        expect(storedFree).toEqual(free)
        expect(storedUnknown).toEqual(unknown)
        expect(storedFree).not.toEqual(storedUnknown)
      })

      it('keeps the measurement on a run that was REFUSED for spending it', async () => {
        /*
         * The C3 Stage C defect, as a contract case rather than a comment.
         *
         * A run refused by `budgetOverruns` reaches that verdict only because
         * the provider reported measured usage — so the firm holds the number
         * at the moment it refuses. It used to discard it, and the record could
         * then say THAT a run exceeded its budget but never BY HOW MUCH, which
         * is the one measurement needed to decide what the limit should be.
         *
         * Both stores are held to keeping it, and the run is still a failure:
         * recording spend is not accepting it.
         */
        const { setId } = await seedCase()
        const overran = {
          state: 'measured' as const,
          inputTokens: 9_100,
          outputTokens: 3_400,
          cost: { state: 'not-reported' as const },
        }
        await saveRun('run-overran', setId, {
          state: 'failed',
          budget: { ...LIVE_BUDGET, tokens: { kind: 'limit' as const, tokens: 12_000 } },
          usage: overran,
          failure: {
            category: 'budget-exhausted',
            retryable: false,
            attempt: 1,
            at: '2026-08-19T21:07:41.075Z',
          },
          execution: { ...run('x', setId).execution, providerKind: 'live' },
        })

        const stored = (await repos.runs.get('run-overran'))!
        /* Every question the failed record now has to answer. */
        expect(stored.usage).toEqual(overran)
        expect(stored.budget.tokens).toEqual({ kind: 'limit', tokens: 12_000 })
        expect(stored.failure?.category).toBe('budget-exhausted')
        expect(stored.state).toBe('failed')
        /* And the one it must keep answering the same way. */
        expect(await repos.producedClaims.listForRun('run-overran')).toEqual([])
      })

      it('enforces a token limit even when the cost is unknown', () => {
        /*
         * The semantic point of the whole change, asserted over the domain
         * function both adapters feed. Tying token enforcement to a known
         * price would have left the limit permanently unenforceable against a
         * provider that reports tokens and no money.
         */
        const budget = {
          tokens: { kind: 'limit' as const, tokens: 1_000 },
          cost: { kind: 'limit' as const, costMinorUnits: 5_000, currency: 'USD' },
          deadline: { kind: 'not-measured' as const },
        }
        expect(
          budgetOverruns(budget, {
            state: 'measured',
            inputTokens: 900,
            outputTokens: 200,
            cost: { state: 'not-reported' },
          }),
        ).toEqual(['tokens'])
      })

      it('neither trips nor satisfies a money limit when the cost is unknown', () => {
        // Silence is not evidence either way. Treating it as zero would let
        // unpriced spend pass; treating it as infinite would fail every
        // honest live run.
        const budget = {
          tokens: { kind: 'not-applicable' as const },
          cost: { kind: 'limit' as const, costMinorUnits: 10, currency: 'USD' },
          deadline: { kind: 'not-measured' as const },
        }
        expect(
          budgetOverruns(budget, {
            state: 'measured',
            inputTokens: 1,
            outputTokens: 1,
            cost: { state: 'not-reported' },
          }),
        ).toEqual([])
        // The same budget IS enforced once a price actually arrives.
        expect(
          budgetOverruns(budget, {
            state: 'measured',
            inputTokens: 1,
            outputTokens: 1,
            cost: { state: 'measured', costMinorUnits: 11, currency: 'USD' },
          }),
        ).toEqual(['cost'])
      })
    })

    describe('what a run was authorized to spend', () => {
      /*
       * The budget is a three-state union per dimension, and both stores have
       * to round-trip all three identically. The failure this guards against
       * is the one the design exists to prevent: an adapter that collapses
       * "cannot spend this" and "nobody decided" into one absent value, which
       * is what a nullable column did before.
       */
      it('round-trips a bounded live budget with its currency intact', async () => {
        const { setId } = await seedCase()
        const budget = {
          tokens: { kind: 'limit' as const, tokens: 40_000 },
          cost: { kind: 'limit' as const, costMinorUnits: 5_000, currency: 'USD' },
          deadline: { kind: 'limit' as const, deadlineMs: 30_000 },
        }
        await saveRun('run-budget', setId, {
          budget,
          // A live call always consumed something, measured or not.
          usage: { state: 'not-reported' },
          execution: { ...run('x', setId).execution, providerKind: 'live' },
        })

        expect((await repos.runs.get('run-budget'))!.budget).toEqual(budget)
      })

      it('keeps not-applicable distinct from not-measured across a round trip', async () => {
        const { setId } = await seedCase()
        await saveRun('run-cannot', setId, {
          budget: {
            tokens: { kind: 'not-applicable' },
            cost: { kind: 'not-applicable' },
            deadline: { kind: 'not-measured' },
          },
        })

        const stored = (await repos.runs.get('run-cannot'))!.budget
        // Three states in, three states out. A store that wrote NULL for both
        // absences would return the same value for two different facts.
        expect(stored.cost).toEqual({ kind: 'not-applicable' })
        expect(stored.deadline).toEqual({ kind: 'not-measured' })
        expect(stored.cost).not.toEqual(stored.deadline)
      })

      it('does not rewrite the authorization when the run is saved again', async () => {
        /*
         * Write-once, like identity and provider. A later save carrying a
         * different budget must not change what the firm authorized — that
         * number is a fact about the moment the run started, and a store that
         * let it drift would make every historical limit unreliable.
         */
        const { setId } = await seedCase()
        const authorized = {
          tokens: { kind: 'not-applicable' as const },
          cost: { kind: 'not-applicable' as const },
          deadline: { kind: 'limit' as const, deadlineMs: 30_000 },
        }
        await saveRun('run-fixed', setId, { budget: authorized })

        const stored = (await repos.runs.get('run-fixed'))!
        await repos.runs.save(
          buildRunRecord({
            ...stored,
            budget: { ...authorized, deadline: { kind: 'limit', deadlineMs: 999_999 } },
          }),
          prov,
        )

        expect((await repos.runs.get('run-fixed'))!.budget.deadline).toEqual({
          kind: 'limit',
          deadlineMs: 30_000,
        })
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

      it('records a case movement by a department’s own principal, and reads it back as that principal’s (G1)', async () => {
        /*
         * Measured on the first live gold loop after G1 (2026-09-18): the
         * Research Office's principal submitted its revision — a movement —
         * and the PostgreSQL read side then refused the stored event as
         * naming no actor, because the agent column was written and never
         * read back. Both stores now read what 0042 stores.
         */
        await repos.cases.create(investmentCase())
        await repos.events.append(
          event('e-1', {
            fromState: 'intake',
            toState: 'research',
            actorAgentPrincipalId: 'research-office-agent',
            actorDepartmentId: 'research-office',
          }),
        )
        expect((await repos.cases.get('case-1'))!.transitions).toEqual([
          expect.objectContaining({
            from: 'intake',
            to: 'research',
            byEmployeeId: null,
            byAgentPrincipalId: 'research-office-agent',
            byDepartmentId: 'research-office',
          }),
        ])
        expect((await repos.events.listForCase('case-1'))[0]).toMatchObject({
          actorAgentPrincipalId: 'research-office-agent',
        })
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
        agentPrincipalId: null,
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
