/**
 * What only PostgreSQL can be asked.
 *
 * In addition to the shared contract suite, never instead of it. These are the
 * behaviours that exist because the store is a real database: error mapping by
 * SQLSTATE, the permission model, timestamp fidelity through `to_char`,
 * concurrent idempotent reserves from two real connections, and the integrity
 * checks the adapter performs on what it reads back.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ConflictingRecordError,
  MalformedRowError,
  ReferentialIntegrityError,
  StorageError,
  StoragePermissionError,
  type AnalysisRepositories,
} from '~/application/analysis/repositories'
import {
  buildAssignment,
  buildEvidenceSet,
  buildRunRecord,
  buildTransitionEvent,
  observationRef,
  type InvestmentCase,
} from '~/domain/analysis'
import { catalogHash } from './sql'
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgresRepositories'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let appUrl: string
let repos: PostgresRepositories
const opened: PostgresRepositories[] = []

const AT = '2026-07-28T09:00:00.000Z'

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
  repos = createPostgresRepositories({ connectionString: appUrl })
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

const evidenceSet = (value = 4.1) =>
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
        provenance: { source: { providerId: 'treasury' } } as never,
      },
    ],
    assembledAt: AT,
    correlationId: 'corr-1',
  })

/* ------------------------------------------------------------- error map */

describe('database failures map onto the port taxonomy', () => {
  it('maps a missing reference to ReferentialIntegrityError', async () => {
    await expect(
      repos.cases.create(investmentCase({ ownerEmployeeId: 'nobody' })),
    ).rejects.toBeInstanceOf(ReferentialIntegrityError)
  })

  it('names the constraint, not the offending value', async () => {
    /*
     * PostgreSQL puts the failing key VALUES in `error.detail` — a case id, a
     * content hash, a thesis id. The adapter drops it: this message is headed
     * for a log, and a log is what gets pasted into an issue.
     */
    const error = await repos.cases
      .create(investmentCase({ id: 'case-secret-1', ownerEmployeeId: 'nobody' }))
      .then(
        () => null,
        (caught: unknown) => caught as StorageError,
      )

    expect(error!.message).toMatch(/runs?_?|cases_owner_employee_id_fkey/)
    expect(error!.message).not.toContain('case-secret-1')
    expect(error!.message).not.toContain('INSERT')
    expect(error!.message).not.toContain('nobody')
  })

  it('carries the operation that failed', async () => {
    const error = await repos.cases
      .create(investmentCase({ ownerEmployeeId: 'nobody' }))
      .then(
        () => null,
        (caught: unknown) => caught as StorageError,
      )

    expect(error!.operation).toBe('cases.create')
  })

  it('maps a permission failure to StoragePermissionError', async () => {
    // The runtime holds no UPDATE grant on reviews at all.
    const owner = db.owner
    await owner.query(
      `INSERT INTO analysis.tenants (id, name) VALUES ('t2', 'Second')
       ON CONFLICT DO NOTHING`,
    )

    const app = await db.connectAs(APP_ROLE)
    const denied = await app
      .query(`UPDATE analysis.reviews SET status = 'verified'`)
      .then(
        () => null,
        (caught: unknown) => caught,
      )
    expect((denied as { code?: string }).code).toBe('42501')

    // And through the adapter's own mapping.
    const { mapDatabaseError } = await import('./sql')
    expect(mapDatabaseError(denied, 'reviews.saveVerification')).toBeInstanceOf(
      StoragePermissionError,
    )
  })
})

/* --------------------------------------------------------- timestamps */

describe('timestamps survive the round trip exactly', () => {
  it('returns the same ISO string that was written', async () => {
    // `timestamptz` holds microseconds and the driver would parse it into a
    // JS Date holding milliseconds. Every read projects through `to_char`.
    await repos.cases.create(investmentCase({ openedAt: '2026-03-01T13:45:12.345Z' }))
    expect((await repos.cases.get('case-1'))?.openedAt).toBe('2026-03-01T13:45:12.345Z')
  })

  it('normalizes an offset to UTC without shifting the instant', async () => {
    await repos.cases.create(
      investmentCase({ openedAt: '2026-03-01T15:45:12.345+02:00' }),
    )
    expect((await repos.cases.get('case-1'))?.openedAt).toBe('2026-03-01T13:45:12.345Z')
  })

  it('keeps ordering consistent with the stored instant', async () => {
    await repos.cases.create(
      investmentCase({ id: 'case-early', openedAt: '2026-03-01T13:45:12.345Z' }),
    )
    await repos.cases.create(
      investmentCase({ id: 'case-late', openedAt: '2026-03-01T13:45:12.346Z' }),
    )
    expect((await repos.cases.list()).map((entry) => entry.id)).toEqual([
      'case-late',
      'case-early',
    ])
  })
})

/* ------------------------------------------------------------- integrity */

describe('what the adapter checks on the way out', () => {
  it('refuses an evidence set whose composition does not match its id', async () => {
    /*
     * The id hashes `[observationId, contentHash]` for every item, so
     * recomputing it detects an item added, removed, or pointing at different
     * content than it did when the set was assembled.
     *
     * What it does NOT detect is a payload edited without its `contentHash`
     * being updated to match — the set-level hash covers the COMPOSITION, not
     * the payloads. Verifying each item's hash against its value on every read
     * would catch that too; it is not done here because jsonb round-tripping
     * could make a legitimate value hash differently and break reads that are
     * fine. Recorded as TD-25.
     */
    const set = await repos.evidence.save(evidenceSet())
    await db.owner.query(
      `UPDATE analysis.evidence_items SET content_hash = 'tampered'
       WHERE evidence_set_id = $1`,
      [set.id],
    )

    await expect(repos.evidence.get(set.id)).rejects.toBeInstanceOf(MalformedRowError)
  })

  it('refuses a stored row the domain would reject', async () => {
    /*
     * A claim marked contested with nothing contradicting it. The schema has
     * no CHECK for that — it is a domain rule, and it holds on the way OUT of
     * the database too, because a row edited by hand or written by an older
     * version of this code is exactly when validation matters most.
     */
    await repos.cases.create(investmentCase())
    await repos.assignments.save(
      buildAssignment({
        id: 'a-1',
        caseId: 'case-1',
        departmentId: 'global-macro',
        brief: 'Regime read',
        status: 'queued',
        createdAt: AT,
        priority: 5,
      }),
    )
    const set = await repos.evidence.save(evidenceSet())
    await repos.runs.save(
      buildRunRecord({
        id: 'run-1',
        caseId: 'case-1',
        assignmentId: 'a-1',
        departmentId: 'global-macro',
        employeeId: 'macro-head',
        agentContractVersion: '1',
        outputSchemaVersion: '1',
        prompt: { id: 'p', version: '1', contentHash: 'ph' },
        model: { id: 'm', provider: 'anthropic', parameters: {}, parametersHash: 'mh' },
        evidenceSetId: set.id,
        state: 'running',
        startedAt: AT,
        events: [],
        claims: [],
      }),
    )

    await db.owner.query(
      `INSERT INTO analysis.claims
         (id, case_id, tenant_id, run_id, type, statement, status,
          confidence_level, temporal_as_of)
       VALUES ('claim-bad', 'case-1', 'system', 'run-1', 'observation',
               'The 10y is at 4.1%', 'contested', 'high', now())`,
    )

    await expect(repos.claims.get('claim-bad')).rejects.toBeInstanceOf(MalformedRowError)
  })

  it('refuses a differing result under a key that is already held', async () => {
    const result = {
      key: 'result-1',
      claims: [],
      storedAt: AT,
      inputs: { departmentId: 'global-macro' } as never,
    }
    await repos.results.put(result)

    await expect(
      repos.results.put({
        ...result,
        claims: [{ id: 'claim-1' }] as never,
      }),
    ).rejects.toBeInstanceOf(ConflictingRecordError)
  })
})

/* ---------------------------------------------------------- concurrency */

describe('two real connections', () => {
  it('reserves an idempotency key exactly once', async () => {
    /*
     * The pattern is INSERT … ON CONFLICT DO NOTHING then SELECT, which is
     * correct only under READ COMMITTED: the loser blocks on the unique index,
     * inserts nothing, and its next statement takes a fresh snapshot that can
     * see the winner's committed row. Under REPEATABLE READ it would find
     * nothing and have to fail a command that is supposed to succeed.
     */
    const other = createPostgresRepositories({ connectionString: appUrl })
    opened.push(other)

    const record = {
      key: 'open:case-1',
      commandType: 'open-case',
      resultRef: 'case-1',
      createdAt: AT,
    }
    const [first, second] = await Promise.all([
      repos.idempotency.reserve(record),
      other.idempotency.reserve({ ...record, resultRef: 'case-2' }),
    ])

    expect(first.resultRef).toBe(second.resultRef)
    const { rows } = await db.owner.query(
      'SELECT count(*)::int n FROM analysis.idempotency_keys',
    )
    expect(rows[0].n).toBe(1)
  })

  it('lets exactly one of two concurrent version updates win', async () => {
    const other = createPostgresRepositories({ connectionString: appUrl })
    opened.push(other)

    await repos.cases.create(investmentCase())
    const loaded = (await repos.cases.get('case-1'))!

    const outcomes = await Promise.allSettled([
      repos.cases.save({ ...loaded, version: 2, stage: 'research' }, 1),
      other.cases.save({ ...loaded, version: 2, stage: 'blocked' }, 1),
    ])

    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((entry) => entry.status === 'rejected')).toHaveLength(1)
  })
})

/* --------------------------------------------------------- append-only */

describe('the event repository', () => {
  it('exposes no way to change history', () => {
    // Three independent barriers: no port method, no statement in the
    // catalogue, and no grant. This asserts the first two.
    expect(Object.keys(repos.events).sort()).toEqual(['append', 'listForCase', 'recent'])
  })

  it('keeps the first version of an event that is appended twice', async () => {
    await repos.cases.create(investmentCase())
    const event = buildTransitionEvent({
      eventId: 'e-1',
      subject: 'case',
      caseId: 'case-1',
      fromState: null,
      toState: 'intake',
      occurredAt: AT,
      correlationId: 'corr-1',
      aggregateVersion: 1,
    })

    await repos.events.append(event)
    await repos.events.append({ ...event, toState: 'research' })

    const stored = await repos.events.listForCase('case-1')
    expect(stored).toHaveLength(1)
    expect(stored[0]!.toState).toBe('intake')
  })
})

/* ---------------------------------------------------------- provenance */

describe('storage provenance', () => {
  it('reports the schema version it is actually running against', async () => {
    const provenance = await repos.provenance()
    expect(provenance.adapterId).toBe('postgres')
    expect(provenance.schemaVersion).toBe('0011')
    expect(provenance.schemaChecksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes the query catalogue', async () => {
    const provenance = await repos.provenance()
    expect(provenance.queryCatalogHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the catalogue hash when a statement changes', () => {
    // The coordinate's whole purpose: "which SQL produced this analysis".
    expect(catalogHash([{ get: 'SELECT 1' }])).not.toBe(
      catalogHash([{ get: 'SELECT 2' }]),
    )
  })

  it('ignores whitespace, so reformatting is not a new catalogue', () => {
    expect(catalogHash([{ get: 'SELECT  1\n  FROM t' }])).toBe(
      catalogHash([{ get: 'SELECT 1 FROM t' }]),
    )
  })

  it('differs from the in-memory adapter’s provenance', async () => {
    const { createInMemoryRepositories } = await import('../inMemoryRepositories')
    const memory: AnalysisRepositories = createInMemoryRepositories()

    const fromMemory = await memory.provenance()
    const fromPostgres = await repos.provenance()

    expect(fromMemory.adapterId).toBe('in-memory')
    expect(fromMemory.queryCatalogHash).toBeNull()
    expect(fromPostgres.queryCatalogHash).not.toBeNull()
    // The one coordinate they must agree on.
    expect(fromMemory.domainContractVersion).toBe(fromPostgres.domainContractVersion)
  })
})
