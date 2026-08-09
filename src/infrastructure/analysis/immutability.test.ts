/**
 * The invariant the in-memory rollback rests on.
 *
 * `withTransaction` restores a **shallow** snapshot of the store's collections.
 * That is correct only while a stored value cannot be mutated in place — a
 * mutation would survive the rollback, because restoring the maps restores
 * which objects are in them and not what those objects contain.
 *
 * Stage 0 documented that. These tests make it mechanical, because the domain
 * builders freeze only their top level and `InvestmentCase` has no builder at
 * all: relying on them would leave the rollback resting on a convention that a
 * future domain change could break without a single test noticing.
 *
 * The last group is the important one. It writes entities that no builder has
 * touched — plain literals with nested objects and arrays — which is exactly
 * what "future domain code forgets to freeze" looks like.
 */

import { describe, expect, it } from 'vitest'
import {
  buildAssignment,
  buildChallenge,
  buildClaim,
  buildEvidenceSet,
  buildRunRecord,
  buildThesis,
  buildTransitionEvent,
  observationRef,
  type AgentClaim,
  type AgentRunRecord,
  type ComplianceReview,
  type DevilsAdvocateReview,
  type EvidenceSet,
  type InvestmentCase,
  type InvestmentThesis,
  type RiskReview,
  type TransitionEvent,
  type VerificationReview,
} from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { StoredResult } from '~/application/analysis/resultStore'
import { modelOf } from '~/domain/analysis'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { isDeeplyFrozen, MutableValueError, seal } from './seal'

const NOW = '2026-07-28T09:00:00.000Z'
const provenance = { source: { providerId: 'x' }, quality: 'ok' } as never

/* ------------------------------------------------------------------ fixtures */

const investmentCase = (over: Partial<InvestmentCase> = {}): InvestmentCase => ({
  id: 'case-1',
  version: 1,
  // Nested object and two arrays, none of which any builder freezes.
  subject: { kind: 'macro', ref: 'regime', displayName: 'Policy regime' },
  question: 'Is the market pricing the policy path correctly?',
  stage: 'intake',
  openedAt: NOW,
  ownerEmployeeId: 'research-director',
  participatingDepartmentIds: ['global-macro'],
  transitions: [
    {
      caseId: 'case-1',
      from: 'intake',
      to: 'research',
      at: NOW,
      byEmployeeId: 'research-director',
      byDepartmentId: 'research-office',
    },
  ],
  ...over,
})

const thesis = (): InvestmentThesis =>
  buildThesis({
    thesisId: 'thesis-1',
    revisionId: 'rev-1',
    revisionNumber: 1,
    revisionCause: 'initial-proposal',
    caseId: 'case-1',
    implications: [],
    statement: 'The policy path is mispriced',
    position: 'buy',
    proposedByDepartmentId: 'global-macro',
    proposedByEmployeeId: 'macro-head',
    proposedAt: NOW,
    supportingClaimIds: ['claim-1'],
    opposingClaimIds: [],
    citedByClaimIds: [],
    lifecycle: 'proposed',
    invalidationCriteria: 'The curve reprices above 4%',
  })

/** `waitingOn` is a nested object that `buildAssignment` does not freeze. */
const assignment = () =>
  buildAssignment({
    id: 'a-1',
    caseId: 'case-1',
    departmentId: 'global-macro',
    brief: 'Regime read',
    status: 'waiting',
    waitingOn: { kind: 'evidence', evidenceSought: 'the September print' },
    createdAt: NOW,
    priority: 5,
  })

/** `confidence` and `temporalScope` are nested objects `buildClaim` leaves open. */
const claim = (): AgentClaim =>
  buildClaim({
    id: 'claim-1',
    type: 'observation',
    statement: 'The 10y is at 4.1%',
    evidenceRefs: [{ setId: 'set-1', observationId: 'obs-1', contentHash: 'h1' }],
    contradictingEvidenceRefs: [],
    confidence: { level: 'high', basis: ['single authoritative source'] },
    temporalScope: { asOf: NOW },
    status: 'supported',
  })

/** `prompt`, `model` and `model.parameters` are all nested. */
const run = (): AgentRunRecord =>
  buildRunRecord({
    id: 'run-1',
    caseId: 'case-1',
    assignmentId: 'a-1',
    departmentId: 'global-macro',
    employeeId: 'macro-head',
    agentContractVersion: '1',
    outputSchemaVersion: '1',
    usage: { state: 'not-applicable' },
    evidenceSetId: 'set-1',
    state: 'running',
    execution: {
      playbookId: 'macro-regime',
      playbookVersion: '1',
      playbookEntryKey: 'macro-analysis',
      providerId: 'recorded-macro',
      providerVersion: '1',
      providerKind: 'recorded',
      identity: {
        kind: 'model',
        prompt: { id: 'p', version: '1', contentHash: 'ph' },
        model: {
          id: 'm',
          provider: 'anthropic',
          parameters: {},
          parametersHash: 'mh',
        },
      },
    },
    missingOptionalInputs: [],

    startedAt: NOW,
    events: [{ runId: 'run-1', at: NOW, state: 'running' }],
    claims: [],
  })

const evidenceSet = (): EvidenceSet =>
  buildEvidenceSet({
    items: [
      {
        ref: observationRef(
          {
            subjectKind: 'series',
            subject: 'US10Y',
            kind: 'yield',
            observedAt: NOW,
            sourceId: 'treasury',
          },
          {
            yieldPercent: '4.1',
            changeBasisPoints: null,
            observationDate: '2026-07-28',
          },
        ),
        value: {
          yieldPercent: '4.1',
          changeBasisPoints: null,
          observationDate: '2026-07-28',
          unit: 'percent',
        },
        provenance,
      },
    ],
    assembledAt: NOW,
    correlationId: 'corr-1',
  })

const verification = (): VerificationReview => ({
  scope: 'thesis-revision',
  caseId: 'case-1',
  thesisId: 'thesis-1',
  revisionId: 'rev-1',
  reviewId: 'review-verification-1',
  sequence: 1,
  byEmployeeId: 'verifier',
  byDepartmentId: 'verification',
  at: NOW,
  status: 'verified',
  findings: [
    {
      kind: 'stale-evidence',
      claimId: 'claim-1',
      detail: 'two days old',
      severity: 'advisory',
      citedContentHash: 'hash-as-cited',
      blocking: false,
    },
  ],
  claimsReviewed: ['claim-1'],
})

const challenge = (): DevilsAdvocateReview => ({
  scope: 'thesis-revision',
  caseId: 'case-1',
  thesisId: 'thesis-1',
  revisionId: 'rev-1',
  reviewId: 'review-da-1',
  sequence: 1,
  byEmployeeId: 'advocate',
  byDepartmentId: 'devils-advocate',
  at: NOW,
  challenges: [
    buildChallenge({
      id: 'ch-1',
      contests: 'claim-1',
      kind: 'fragile-assumption',
      argument: 'The regime read assumes no fiscal shock',
      counterEvidence: [],
      materiality: 'material',
      wouldBeResolvedBy: 'A fiscal impulse estimate for the next two quarters.',
    }),
  ],
  outcomes: { 'ch-1': 'open' },
})

// Case-wide: publication compliance concerns the whole report.
const compliance = (): ComplianceReview => ({
  scope: 'case',
  caseId: 'case-1',
  reviewId: 'review-compliance-1',
  sequence: 1,
  byEmployeeId: 'compliance-head',
  byDepartmentId: 'compliance',
  at: NOW,
  status: 'approved',
  findings: [{ rule: 'disclosure', detail: 'disclosure present' }],
})

const risk = (): RiskReview => ({
  scope: 'thesis-revision',
  caseId: 'case-1',
  thesisId: 'thesis-1',
  revisionId: 'rev-1',
  reviewId: 'review-risk-1',
  sequence: 1,
  byEmployeeId: 'cro',
  byDepartmentId: 'risk',
  at: NOW,
  status: 'accepted-with-limits',
  findings: [{ kind: 'downside', detail: 'duration exposure', severity: 'material' }],
  limits: ['no more than 2% of NAV'],
})

const event = (id = 'e-1'): TransitionEvent =>
  buildTransitionEvent({
    eventId: id,
    subject: 'case',
    caseId: 'case-1',
    fromState: null,
    toState: 'intake',
    occurredAt: NOW,
    correlationId: 'corr-1',
    aggregateVersion: 1,
  })

const result = (): StoredResult => ({
  key: 'result-1',
  claims: [claim()],
  storedAt: NOW,
  providerKind: 'recorded',
  inputs: {
    evidenceSetId: 'set-1',
    caseId: 'case-1',
    executionIdentity: 'model|p|1|ph|anthropic|m|mh',
    agentContractVersion: '1',
    outputSchemaVersion: '1',
    canonicalizationVersion: '1',
    agentImplementationVersion: '1',
    departmentId: 'global-macro',
  },
})

/** Writes one of everything, so a test can assert over the whole surface. */
async function writeEverything(repos: AnalysisRepositories): Promise<void> {
  await repos.cases.create(investmentCase())
  await repos.theses.save(thesis())
  await repos.assignments.save(assignment())
  await repos.runs.save(run(), await repos.provenance())
  await repos.claims.save(claim(), 'case-1', 'run-1')
  await repos.evidence.save(evidenceSet())
  await repos.reviews.saveVerification(verification())
  await repos.reviews.saveDevilsAdvocate(challenge())
  await repos.reviews.saveCompliance(compliance())
  await repos.reviews.saveRisk(risk())
  await repos.events.append(event())
  await repos.results.put(result(), await repos.provenance())
  await repos.commands.record(
    {
      commandId: 'cmd-1',
      commandType: 'ProbeCommand',
      commandContractVersion: '2',
      category: 'workflow',
      payloadHash: 'hash-a',
      actor: {
        kind: 'employee',
        employeeId: 'research-director',
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
    },
    await repos.provenance(),
  )
}

/** Everything the store holds, read back through the ports. */
async function readEverything(repos: AnalysisRepositories) {
  return {
    cases: await repos.cases.list(),
    theses: await repos.theses.listForCase('case-1'),
    assignments: await repos.assignments.listForCase('case-1'),
    runs: await repos.runs.listForCase('case-1'),
    claims: await repos.claims.listForCase('case-1'),
    evidence: await repos.evidence.get(evidenceSet().id),
    verifications: await repos.reviews.verificationsForCase('case-1'),
    challenges: await repos.reviews.challengesForCase('case-1'),
    compliance: await repos.reviews.complianceForCase('case-1'),
    risk: await repos.reviews.riskForCase('case-1'),
    events: await repos.events.listForCase('case-1'),
    result: await repos.results.get('result-1'),
    command: (await repos.commands.find('cmd-1'))?.intent ?? null,
  }
}

/* ------------------------------------------------- every entity is sealed */

describe('every entity the repositories accept is deeply frozen', () => {
  it('freezes everything reachable from every stored aggregate', async () => {
    const repos = createInMemoryRepositories()
    await writeEverything(repos)

    const stored = await readEverything(repos)
    for (const [name, value] of Object.entries(stored)) {
      /*
       * The entities, not the containers. A list method returns a fresh array
       * each call — deliberately mutable, since it belongs to the caller and
       * nothing in the store points at it.
       */
      const entities = Array.isArray(value) ? value : [value]
      expect(entities.length, `${name} wrote nothing`).toBeGreaterThan(0)
      for (const entity of entities) {
        expect(isDeeplyFrozen(entity), `${name} is not deeply frozen`).toBe(true)
      }
    }
  })

  it('freezes the caller’s object, not a copy of it', async () => {
    // Sealing a clone would leave the caller holding a mutable reference to
    // something the store believes is immutable — the precise hazard.
    const repos = createInMemoryRepositories()
    const mine = investmentCase()
    await repos.cases.create(mine)

    expect(Object.isFrozen(mine)).toBe(true)
    /*
     * Equality, not identity — and `transitions` empty, because it is a
     * projection of the event log rather than a stored field. This fixture
     * carries a transition and appends no event, so nothing comes back.
     *
     * Object identity was an in-memory-only property that was never part of
     * the port contract, and PostgreSQL could not honour it in any case.
     */
    expect(await repos.cases.get('case-1')).toEqual({ ...mine, transitions: [] })
  })
})

/* ---------------------------------------------- mutation after insertion */

describe('a stored entity cannot be mutated after insertion', () => {
  it('refuses a top-level write through a retained reference', async () => {
    const repos = createInMemoryRepositories()
    const mine = investmentCase()
    await repos.cases.create(mine)

    expect(() => {
      ;(mine as { stage: string }).stage = 'published'
    }).toThrow(TypeError)
    expect((await repos.cases.get('case-1'))?.stage).toBe('intake')
  })

  it('refuses a write to a nested object through a retained reference', async () => {
    const repos = createInMemoryRepositories()
    const mine = investmentCase()
    await repos.cases.create(mine)

    expect(() => {
      ;(mine.subject as { ref: string }).ref = 'something-else'
    }).toThrow(TypeError)
    expect((await repos.cases.get('case-1'))?.subject.ref).toBe('regime')
  })

  it('refuses a push to a nested array through a retained reference', async () => {
    const repos = createInMemoryRepositories()
    const mine = investmentCase()
    await repos.cases.create(mine)

    expect(() => {
      ;(mine.participatingDepartmentIds as string[]).push('risk')
    }).toThrow(TypeError)
    expect((await repos.cases.get('case-1'))?.participatingDepartmentIds).toHaveLength(1)
  })

  it('refuses a write to an object inside a nested array', async () => {
    // Two levels down, and past an array: what a shallow freeze always misses.
    const repos = createInMemoryRepositories()
    const mine = investmentCase()
    await repos.cases.create(mine)

    expect(() => {
      ;(mine.transitions[0] as { to: string }).to = 'published'
    }).toThrow(TypeError)
  })

  it('refuses a write inside an assignment’s waitingOn', async () => {
    // `buildAssignment` freezes the assignment and not this.
    const repos = createInMemoryRepositories()
    const mine = assignment()
    await repos.assignments.save(mine)

    expect(() => {
      ;(mine.waitingOn as { evidenceSought: string }).evidenceSought = 'something else'
    }).toThrow(TypeError)
  })

  it('refuses a write inside a claim’s confidence', async () => {
    // `buildClaim` freezes the claim and its two evidence arrays, not this.
    const repos = createInMemoryRepositories()
    const mine = claim()
    await repos.claims.save(mine, 'case-1', 'run-1')

    expect(() => {
      ;(mine.confidence as { level: string }).level = 'insufficient'
    }).toThrow(TypeError)
  })

  it('refuses a write inside a run’s model parameters', async () => {
    // Three levels down: run → model → parameters.
    const repos = createInMemoryRepositories()
    const mine = run()
    await repos.runs.save(mine, await repos.provenance())

    expect(() => {
      ;(
        modelOf(mine.execution.identity)!.parameters as Record<string, number>
      ).temperature = 1
    }).toThrow(TypeError)
  })

  /*
   * Decision immutability moves to C1D-1B with the repository. The governance
   * snapshot it probed was removed in the C1D-1 review.
   */

  it('refuses a write inside a verification finding', async () => {
    const repos = createInMemoryRepositories()
    const mine = verification()
    await repos.reviews.saveVerification(mine)

    expect(() => {
      ;(mine.findings[0] as { blocking: boolean }).blocking = true
    }).toThrow(TypeError)
  })

  it('refuses a write inside a stored evidence item', async () => {
    const repos = createInMemoryRepositories()
    const mine = evidenceSet()
    await repos.evidence.save(mine)

    expect(() => {
      ;(mine.items[0]!.value as { value: number }).value = 9.9
    }).toThrow(TypeError)
  })
})

/* -------------------------------------------------------------- rollback */

describe('a failed transaction restores the exact prior logical state', () => {
  it('restores every collection, compared by value and not by count', async () => {
    const repos = createInMemoryRepositories()
    await writeEverything(repos)
    const before = await readEverything(repos)

    await expect(
      repos.withTransaction(async (tx) => {
        await tx.cases.save(investmentCase({ version: 2, stage: 'research' }), 1)
        await tx.assignments.save(
          buildAssignment({
            id: 'a-2',
            caseId: 'case-1',
            departmentId: 'risk',
            brief: 'Downside',
            status: 'queued',
            createdAt: NOW,
            priority: 1,
          }),
        )
        await tx.events.append(event('e-2'))
        throw new Error('the risk department does not exist')
      }),
    ).rejects.toThrow(/does not exist/)

    // Deep equality across the whole surface: a mutation that survived the
    // rollback would show up here even though the row counts matched.
    expect(await readEverything(repos)).toEqual(before)
  })

  it('cannot be defeated by mutating an entity written inside the transaction', async () => {
    /*
     * The scenario the shallow snapshot is theoretically vulnerable to: a
     * command holds a reference to an entity it stored, mutates it after the
     * write, and the transaction then fails. Sealing makes the mutation
     * impossible, so the rollback has nothing to miss.
     */
    const repos = createInMemoryRepositories()
    await repos.cases.create(investmentCase())
    const before = await repos.cases.get('case-1')

    await expect(
      repos.withTransaction(async (tx) => {
        const updated = investmentCase({ version: 2, stage: 'research' })
        await tx.cases.save(updated, 1)
        expect(() => {
          ;(updated.subject as { displayName: string }).displayName = 'Rewritten'
        }).toThrow(TypeError)
        throw new Error('boom')
      }),
    ).rejects.toThrow()

    // Equality rather than identity, for the same reason as above: the case is
    // reassembled on read, so the test asserts the state, not the object.
    expect(await repos.cases.get('case-1')).toEqual(before)
    expect((await repos.cases.get('case-1'))?.subject.displayName).toBe('Policy regime')
  })
})

/* -------------------------------------------- entities no builder touched */

describe('an entity no builder froze is normalized, not trusted', () => {
  it('freezes a case assembled as a bare literal', async () => {
    // `InvestmentCase` has no builder. This is what every case write looks
    // like today, and it arrives entirely unfrozen.
    const repos = createInMemoryRepositories()
    const bare = investmentCase()
    expect(Object.isFrozen(bare)).toBe(false)

    await repos.cases.create(bare)
    expect(isDeeplyFrozen(bare)).toBe(true)
  })

  it('freezes a field a future domain change might add', async () => {
    // Stands in for tomorrow's nested field that nobody remembered to freeze.
    const repos = createInMemoryRepositories()
    const withNewField = investmentCase({
      subject: {
        kind: 'macro',
        ref: 'regime',
        displayName: 'Policy regime',
        // @ts-expect-error deliberately not part of CaseSubject
        tags: [{ id: 'rates', weight: 1 }],
      },
    })

    await repos.cases.create(withNewField)
    expect(isDeeplyFrozen(withNewField)).toBe(true)
  })
})

/* --------------------------------------------------------- what is refused */

describe('values that cannot be made immutable are refused', () => {
  it('refuses a Map, which Object.freeze does not protect', async () => {
    // The failure mode this rules out: `freeze` returns happily, `.set()`
    // still works, and the rollback silently stops being correct.
    const repos = createInMemoryRepositories()
    const withMap = investmentCase({
      // @ts-expect-error deliberately not part of CaseSubject
      subject: { kind: 'macro', ref: 'r', displayName: 'd', lookup: new Map() },
    })

    await expect(repos.cases.create(withMap)).rejects.toBeInstanceOf(MutableValueError)
  })

  it('refuses a Set', async () => {
    const repos = createInMemoryRepositories()
    const withSet = investmentCase({
      // @ts-expect-error deliberately not part of CaseSubject
      participatingDepartmentIds: new Set(['global-macro']),
    })

    await expect(repos.cases.create(withSet)).rejects.toBeInstanceOf(MutableValueError)
  })

  it('refuses a Date, whose setTime survives freezing', async () => {
    const repos = createInMemoryRepositories()
    const withDate = investmentCase({
      // @ts-expect-error openedAt is an ISO string
      openedAt: new Date(NOW),
    })

    await expect(repos.cases.create(withDate)).rejects.toBeInstanceOf(MutableValueError)
  })

  it('names the path so the offending field is identifiable', async () => {
    const repos = createInMemoryRepositories()
    const withMap = investmentCase({
      // @ts-expect-error deliberately not part of CaseSubject
      subject: { kind: 'macro', ref: 'r', displayName: 'd', lookup: new Map() },
    })

    await expect(repos.cases.create(withMap)).rejects.toThrow(/cases\.subject\.lookup/)
  })

  it('leaves nothing behind when a write is refused', async () => {
    const repos = createInMemoryRepositories()
    const withMap = investmentCase({
      // @ts-expect-error deliberately not part of CaseSubject
      subject: { kind: 'macro', ref: 'r', displayName: 'd', lookup: new Map() },
    })

    await expect(repos.cases.create(withMap)).rejects.toThrow()
    expect(await repos.cases.get('case-1')).toBeNull()
  })
})

/* ---------------------------------------------------------------- seal itself */

describe('seal', () => {
  it('survives a cyclic graph', () => {
    const node: Record<string, unknown> = { id: 'a' }
    node.self = node
    expect(() => seal(node, 'x')).not.toThrow()
    expect(Object.isFrozen(node)).toBe(true)
  })

  it('is idempotent and cheap on re-writes', async () => {
    const repos = createInMemoryRepositories()
    const mine = investmentCase()
    await repos.cases.create(mine)
    await repos.cases.save(investmentCase({ id: 'case-2' }), 0)
    // A second write of an already sealed aggregate must not throw.
    await expect(repos.cases.create(mine)).resolves.toBe(mine)
  })

  it('reports a shallowly frozen object as not deeply frozen', () => {
    // Guards the guard: if `isDeeplyFrozen` were itself shallow, every
    // assertion above would pass vacuously.
    const shallow = Object.freeze({ nested: { mutable: true } })
    expect(Object.isFrozen(shallow)).toBe(true)
    expect(isDeeplyFrozen(shallow)).toBe(false)
  })
})
