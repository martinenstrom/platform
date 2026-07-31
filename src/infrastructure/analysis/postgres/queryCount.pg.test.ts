/**
 * How many statements each operation issues, asserted rather than assumed.
 *
 * The property that matters is not the absolute number — it is that the number
 * does **not grow with the data**. An operation that issues one statement per
 * child row is survivable at 400 cases a year and stops being survivable
 * without anyone noticing, which is exactly the kind of regression a load test
 * finds six months late and a counter finds immediately.
 *
 * The Stage 2 report claimed "N+1 is acceptable nowhere in this adapter". That
 * was true of reads and false of writes: evidence items, claim citations,
 * decision revisions, run events and verification findings were each one round
 * trip per row. This file is what makes the claim checkable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildAssignment,
  buildClaim,
  buildEvidenceSet,
  buildRunRecord,
  observationRef,
  type InvestmentCase,
} from '~/domain/analysis'
import type { StorageMetrics } from '~/application/analysis/storageObservability'
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgresRepositories'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let appUrl: string
let repos: PostgresRepositories
const opened: PostgresRepositories[] = []
const AT = '2026-07-28T09:00:00.000Z'

/** Counts one entry per executed statement, by port method. */
const counts = new Map<string, number>()
const counting: StorageMetrics = {
  increment: () => {},
  gauge: () => {},
  observe: (name, _value, labels) => {
    if (name !== 'analysis.db.query.latency_ms') return
    const operation = String(labels?.operation ?? 'unknown')
    counts.set(operation, (counts.get(operation) ?? 0) + 1)
  },
}

const statementsFor = (operation: string) => counts.get(operation) ?? 0

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
}, 180_000)

afterAll(async () => {
  await Promise.all(opened.map((entry) => entry.close().catch(() => {})))
  await db?.drop()
})

beforeEach(async () => {
  await db.truncateAnalysisData()
  counts.clear()
  repos = createPostgresRepositories({ connectionString: appUrl, metrics: counting })
  /*
   * A run carries a foreign key to its playbook entry from 0015, so the
   * workflow it executes has to exist. Registered before counting starts, so
   * it does not distort the statement counts these tests police.
   */
  await repos.playbooks.register(MACRO_REGIME_PLAYBOOK)
  counts.clear()
  opened.push(repos)
})

const investmentCase = (over: Partial<InvestmentCase> = {}): InvestmentCase => ({
  id: 'case-1',
  version: 1,
  subject: { kind: 'macro', ref: 'regime', displayName: 'Policy regime' },
  question: 'Is the policy path mispriced?',
  stage: 'intake',
  openedAt: AT,
  ownerEmployeeId: 'research-director',
  participatingDepartmentIds: ['global-macro'],
  transitions: [],
  ...over,
})

const evidenceSet = (items: number) =>
  buildEvidenceSet({
    items: Array.from({ length: items }, (_, index) => ({
      ref: observationRef(
        {
          subjectKind: 'series',
          subject: `X${index}`,
          kind: 'yield',
          observedAt: AT,
          sourceId: 'treasury',
        },
        { value: index },
      ),
      value: { value: index },
      provenance: {} as never,
    })),
    assembledAt: AT,
    correlationId: 'corr-1',
  })

const assignment = () =>
  buildAssignment({
    id: 'a-1',
    caseId: 'case-1',
    departmentId: 'global-macro',
    brief: 'Regime read',
    status: 'queued',
    createdAt: AT,
    priority: 5,
  })

const runWith = (setId: string, events: number) =>
  buildRunRecord({
    id: 'run-1',
    caseId: 'case-1',
    assignmentId: 'a-1',
    departmentId: 'global-macro',
    employeeId: 'macro-head',
    agentContractVersion: '1',
    outputSchemaVersion: '1',
    usage: { state: 'not-applicable' },
    evidenceSetId: setId,
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
    state: 'running',
    startedAt: AT,
    events: Array.from({ length: events }, (_, index) => ({
      runId: 'run-1',
      at: new Date(Date.parse(AT) + index * 1000).toISOString(),
      state: 'running' as const,
    })),
    claims: [],
  })

describe('write paths do not scale with their children', () => {
  it('creates a case in a fixed number of statements', async () => {
    await repos.cases.create(investmentCase())
    const fewParticipants = statementsFor('cases.create')

    counts.clear()
    await repos.cases.create(
      investmentCase({
        id: 'case-2',
        participatingDepartmentIds: [
          'global-macro',
          'risk',
          'verification',
          'compliance',
          'devils-advocate',
        ],
      }),
    )
    expect(statementsFor('cases.create')).toBe(fewParticipants)
  })

  it('saves an evidence set in a fixed number of statements', async () => {
    await repos.evidence.save(evidenceSet(2))
    const small = statementsFor('evidence.save')

    counts.clear()
    await repos.evidence.save(evidenceSet(40))
    // Forty observations, not forty round trips.
    expect(statementsFor('evidence.save')).toBe(small)
  })

  it('saves a claim in a fixed number of statements however many it cites', async () => {
    const set = await repos.evidence.save(evidenceSet(40))
    await repos.cases.create(investmentCase())
    await repos.assignments.save(assignment())
    await repos.runs.save(runWith(set.id, 0), await repos.provenance())

    const cite = (id: string, count: number) =>
      buildClaim({
        id,
        type: 'observation',
        statement: 'The 10y is at 4.1%',
        status: 'insufficient-evidence',
        evidenceRefs: set.items.slice(0, count).map((item) => ({
          setId: set.id,
          observationId: item.ref.id,
          contentHash: item.ref.contentHash,
        })),
        contradictingEvidenceRefs: [],
        confidence: { level: 'high', basis: [] },
        temporalScope: { asOf: AT },
      })

    counts.clear()
    await repos.claims.save(cite('claim-few', 2), 'case-1', 'run-1')
    const few = statementsFor('claims.save')

    counts.clear()
    await repos.claims.save(cite('claim-many', 30), 'case-1', 'run-1')
    expect(statementsFor('claims.save')).toBe(few)
  })

  it('saves a run in a fixed number of statements however many events it carries', async () => {
    const set = await repos.evidence.save(evidenceSet(1))
    await repos.cases.create(investmentCase())
    await repos.assignments.save(assignment())

    counts.clear()
    await repos.runs.save(runWith(set.id, 1), await repos.provenance())
    const few = statementsFor('runs.save')

    counts.clear()
    await repos.runs.save(runWith(set.id, 25), await repos.provenance())
    // The conflict check reads the run's history once, not once per event.
    expect(statementsFor('runs.save')).toBe(few)
  })
})

describe('read paths do not scale with their results', () => {
  async function seedCases(count: number) {
    for (let index = 0; index < count; index++) {
      await repos.cases.create(investmentCase({ id: `case-${index}` }))
    }
  }

  it('lists cases in a fixed number of statements', async () => {
    await seedCases(1)
    counts.clear()
    await repos.cases.list()
    const one = statementsFor('cases.list')

    await seedCases(40)
    counts.clear()
    await repos.cases.list()
    // The property the headquarters read model depends on: one query for the
    // parents, one per child collection, assembled in memory.
    expect(statementsFor('cases.list')).toBe(one)
    expect(one).toBeLessThanOrEqual(3)
  })

  it('loads one case in three statements', async () => {
    await seedCases(1)
    counts.clear()
    await repos.cases.get('case-0')
    // Case, participants, transitions.
    expect(statementsFor('cases.get')).toBe(3)
  })

  it('loads one run in four statements', async () => {
    const set = await repos.evidence.save(evidenceSet(1))
    await repos.cases.create(investmentCase())
    await repos.assignments.save(assignment())
    await repos.runs.save(runWith(set.id, 3), await repos.provenance())
    await repos.claims.save(
      buildClaim({
        id: 'claim-1',
        type: 'observation',
        statement: 'The 10y is at 4.1%',
        status: 'insufficient-evidence',
        evidenceRefs: [],
        contradictingEvidenceRefs: [],
        confidence: { level: 'high', basis: [] },
        temporalScope: { asOf: AT },
      }),
      'case-1',
      'run-1',
    )

    counts.clear()
    await repos.runs.get('run-1')
    // Run, run events, claims, claim evidence.
    expect(statementsFor('runs.get')).toBe(4)
  })

  it('skips the citation query when a run has no claims', async () => {
    // Fewer statements when there is nothing to hydrate, never more.
    const set = await repos.evidence.save(evidenceSet(1))
    await repos.cases.create(investmentCase())
    await repos.assignments.save(assignment())
    await repos.runs.save(runWith(set.id, 1), await repos.provenance())

    counts.clear()
    await repos.runs.get('run-1')
    expect(statementsFor('runs.get')).toBe(3)
  })

  it('reads a single-statement operation in one statement', async () => {
    // These deliberately skip the transaction: wrapping a lone statement in
    // BEGIN/COMMIT triples its round trips to buy a snapshot it already has.
    await repos.cases.create(investmentCase())
    counts.clear()
    await repos.events.recent(10)
    expect(statementsFor('events.recent')).toBe(1)

    counts.clear()
    await repos.assignments.listForCase('case-1')
    expect(statementsFor('assignments.listForCase')).toBe(1)
  })
})
