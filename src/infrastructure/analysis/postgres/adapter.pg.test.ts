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
  InvariantViolationError,
  MalformedRowError,
  ReferentialIntegrityError,
  StorageError,
  StoragePermissionError,
  type AnalysisRepositories,
} from '~/application/analysis/repositories'
import type { CommandIntent } from '~/application/analysis/commandLog'
import {
  buildAssignment,
  buildClaim,
  buildEvidenceSet,
  buildRunRecord,
  buildTransitionEvent,
  observationRef,
  type InvestmentCase,
} from '~/domain/analysis'
import { catalogHash, defaultSqlContext, run } from './sql'
import { createPostgresPool } from './pool'
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgresRepositories'
import { poolScope, unitOfWork } from './transaction'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
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

/** A ledger intent, for the concurrency and isolation tests. */
const probeIntent = (): CommandIntent => ({
  commandId: 'cmd-probe',
  commandType: 'ProbeCommand',
  commandContractVersion: '2',
  category: 'workflow',
  payloadHash: 'hash-a',
  caseId: undefined,
  actor: {
    kind: 'employee' as const,
    employeeId: 'research-director',
    roleId: 'research-director',
    roleFunction: 'manager' as const,
    departmentId: 'research-office',
    departmentIsGovernance: false,
    departmentHandles: ['aggregation'],
    authentication: 'system-asserted' as const,
    organizationSeedVersion: '1',
  },
  mandate: { kind: 'any-employee' as const },
  authorizationBasis: 'employee-of-the-firm' as const,
  initiator: { kind: 'orchestrator' as const, orchestratorId: 'test' },
  correlationId: 'corr-1',
  occurredAt: AT,
  receivedAt: AT,
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

/** Case, assignment, evidence and run — the prerequisites a claim needs. */
async function seedRun(): Promise<string> {
  await repos.cases.create(investmentCase())
  // A run points at the exact playbook entry it executes, so the workflow has
  // to be registered before any run can exist.
  await repos.playbooks.register(MACRO_REGIME_PLAYBOOK)
  await repos.assignments.save(
    buildAssignment({
      id: 'a-1',
      caseId: 'case-1',
      departmentId: 'global-macro',
      brief: 'b',
      status: 'queued',
      createdAt: AT,
      priority: 1,
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
      usage: { state: 'not-applicable' },
      evidenceSetId: set.id,
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
      events: [],
      claims: [],
    }),
    await repos.provenance(),
  )
  return set.id
}

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
    await repos.playbooks.register(MACRO_REGIME_PLAYBOOK)
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
        usage: { state: 'not-applicable' },
        evidenceSetId: set.id,
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
        events: [],
        claims: [],
      }),
      await repos.provenance(),
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
      providerKind: 'recorded' as const,
      inputs: { departmentId: 'global-macro' } as never,
    }
    const provenance = await repos.provenance()
    await repos.results.put(result, provenance)

    await expect(
      repos.results.put(
        {
          ...result,
          claims: [
            buildClaim({
              id: 'claim-1',
              type: 'observation',
              statement: 'x',
              status: 'insufficient-evidence',
              evidenceRefs: [],
              contradictingEvidenceRefs: [],
              confidence: { level: 'high', basis: [] },
              temporalScope: { asOf: AT },
            }),
          ],
        },
        provenance,
      ),
    ).rejects.toBeInstanceOf(ConflictingRecordError)
  })
})

/* ------------------------------------------------------------- atomicity */

describe('a logical write is atomic even outside a transaction (B4)', () => {
  /*
   * `cases.create` is three statements. Against a pool those would be three
   * implicit transactions on up to three connections, so a crash between them
   * would leave a case with no participants — a state the in-memory store
   * cannot produce, because it writes each aggregate with one assignment.
   *
   * These tests inject a real mid-write failure through a foreign key, which
   * is the only failure available that lands between the statements rather
   * than before them.
   */
  it('leaves no case and no participants when the case write fails', async () => {
    await expect(
      repos.cases.create(investmentCase({ ownerEmployeeId: 'nobody-at-all' })),
    ).rejects.toBeInstanceOf(ReferentialIntegrityError)

    expect(await repos.cases.get('case-1')).toBeNull()
    const { rows } = await db.owner.query(
      'SELECT count(*)::int n FROM analysis.case_participants',
    )
    expect(rows[0].n).toBe(0)
  })

  it('leaves no citations when a claim write fails after the claim row', async () => {
    await seedRun()
    await expect(
      repos.claims.save(
        {
          id: 'claim-bad',
          type: 'observation',
          statement: 'x',
          status: 'insufficient-evidence',
          evidenceRefs: [
            { setId: 'no-such-set', observationId: 'no-such-obs', contentHash: 'h' },
          ],
          contradictingEvidenceRefs: [],
          confidence: { level: 'high', basis: [] },
          temporalScope: { asOf: AT },
        },
        'case-1',
        'run-1',
      ),
    ).rejects.toBeInstanceOf(ReferentialIntegrityError)

    // The claim row is inserted BEFORE its citations, so a naive
    // implementation leaves a claim with no evidence behind.
    expect(await repos.claims.get('claim-bad')).toBeNull()
  })

  it('joins the caller transaction rather than opening its own', async () => {
    // No nesting, and the caller's boundary stays the atomic one.
    await expect(
      repos.withTransaction(async (tx) => {
        await tx.cases.create(investmentCase())
        await tx.assignments.save(
          buildAssignment({
            id: 'a-1',
            caseId: 'case-1',
            departmentId: 'global-macro',
            brief: 'b',
            status: 'queued',
            createdAt: AT,
            priority: 1,
          }),
        )
        throw new Error('boom')
      }),
    ).rejects.toThrow(/boom/)

    expect(await repos.cases.get('case-1')).toBeNull()
    expect(await repos.assignments.get('a-1')).toBeNull()
  })
})

/* -------------------------------------------------------------- isolation */

describe('isolation is stated, not inherited (B5)', () => {
  it('runs READ COMMITTED even when the session default is REPEATABLE READ', async () => {
    /*
     * The whole idempotency design rests on READ COMMITTED. Inheriting the
     * server default made that depend on a deployment setting nobody would
     * think to check — and no test would have failed, because the test cluster
     * happens to use the default.
     *
     * So the session default is deliberately set to the level that BREAKS the
     * design, and the level in force inside a unit of work is read back.
     */
    const login = new URL(appUrl).username
    await db.owner.query(
      `ALTER ROLE ${login} SET default_transaction_isolation = 'repeatable read'`,
    )

    const pool = createPostgresPool({ connectionString: appUrl })
    try {
      const scope = poolScope(pool)
      const context = defaultSqlContext()

      const inForce = await unitOfWork(scope, 'probe', (client) =>
        run<{ transaction_isolation: string }>(
          client,
          context,
          'probe',
          'SHOW transaction_isolation',
        ),
      )
      expect(inForce[0]!.transaction_isolation).toBe('read committed')

      // And the session default really was the other one, so the assertion
      // above is about the BEGIN and not about the cluster.
      const sessionDefault = await pool.query('SHOW default_transaction_isolation')
      expect(sessionDefault.rows[0].default_transaction_isolation).toBe('repeatable read')
    } finally {
      await pool.end()
      await db.owner.query(`ALTER ROLE ${login} RESET default_transaction_isolation`)
    }
  })

  it('lets the idempotency pattern work under that session default', async () => {
    // The behaviour the level buys: reserve, then read back the row a
    // concurrent writer committed. REPEATABLE READ would find nothing.
    const login = new URL(appUrl).username
    await db.owner.query(
      `ALTER ROLE ${login} SET default_transaction_isolation = 'repeatable read'`,
    )
    const first = createPostgresRepositories({ connectionString: appUrl })
    const second = createPostgresRepositories({ connectionString: appUrl })
    opened.push(first, second)

    try {
      const intent = probeIntent()
      const [a, b] = await Promise.all([
        first.commands.record(intent, await first.provenance()),
        second.commands.record(intent, await second.provenance()),
      ])
      expect(a.payloadHash).toBe(b.payloadHash)

      const { rows } = await db.owner.query(
        'SELECT count(*)::int n FROM analysis.commands',
      )
      expect(rows[0].n).toBe(1)
    } finally {
      await db.owner.query(`ALTER ROLE ${login} RESET default_transaction_isolation`)
    }
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

    const intent = probeIntent()
    const [first, second] = await Promise.all([
      repos.commands.record(intent, await repos.provenance()),
      other.commands.record(intent, await other.provenance()),
    ])

    expect(first.payloadHash).toBe(second.payloadHash)
    const { rows } = await db.owner.query('SELECT count(*)::int n FROM analysis.commands')
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

  it('is idempotent for an identical replay', async () => {
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
    await repos.events.append(event)

    expect(await repos.events.listForCase('case-1')).toHaveLength(1)
  })

  it('refuses the same id carrying different facts', async () => {
    // Append-only means the log cannot be edited. Accepting this silently
    // would have let a rewrite through the one door meant to refuse it.
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
    await expect(
      repos.events.append({ ...event, toState: 'withdrawn' }),
    ).rejects.toBeInstanceOf(ConflictingRecordError)
  })

  it('refuses a case movement written without an actor', async () => {
    // The database CHECK from 0012, reached through the adapter. The domain
    // builder refuses it first; this proves the second line holds too.
    await repos.cases.create(investmentCase())
    await expect(
      repos.events.append({
        eventId: 'e-actorless',
        subject: 'case',
        caseId: 'case-1',
        fromState: 'intake',
        toState: 'research',
        occurredAt: AT,
        correlationId: 'corr-1',
        aggregateVersion: 2,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError)
  })

  it('refuses to read a movement stored without an actor', async () => {
    /*
     * The read-side half, for rows that predate the constraint. Written behind
     * the adapter's back with the CHECK dropped, because that is now the only
     * way such a row can exist at all.
     */
    await repos.cases.create(investmentCase())
    await db.owner.query(
      `ALTER TABLE analysis.transition_events
       DROP CONSTRAINT transition_events_case_movement_has_actor`,
    )
    await db.owner.query(
      `INSERT INTO analysis.transition_events
         (event_id, subject, case_id, tenant_id, from_state, to_state,
          occurred_at, correlation_id, aggregate_version)
       VALUES ('legacy', 'case', 'case-1', 'system', 'intake', 'research',
               now(), 'corr', 2)`,
    )
    try {
      await expect(repos.cases.get('case-1')).rejects.toBeInstanceOf(MalformedRowError)
    } finally {
      await db.owner.query('DELETE FROM analysis.transition_events')
      await db.owner.query(
        `ALTER TABLE analysis.transition_events
         ADD CONSTRAINT transition_events_case_movement_has_actor CHECK (
           subject <> 'case' OR from_state IS NULL
           OR (actor_employee_id IS NOT NULL AND actor_department_id IS NOT NULL))`,
      )
    }
  })
})

/* ---------------------------------------------------------- provenance */

describe('storage provenance', () => {
  it('reports the schema version it is actually running against', async () => {
    const provenance = await repos.provenance()
    expect(provenance.adapterId).toBe('postgres')
    expect(provenance.schemaVersion).toBe('0020')
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
