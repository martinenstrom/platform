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
  buildObservation,
  buildRunRecord,
  NON_CONSUMING_BUDGET,
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
import { toDevilsAdvocate } from './mapping'
import { buildChallenge, type Challenge, type ChallengeStatus } from '~/domain/analysis'
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
  repos = await createPostgresRepositories({ connectionString: appUrl })
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
    agentPrincipalId: null,
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

/*
 * A canonical decimal STRING, as production supplies after TD-61: a fractional
 * double is refused by the canonical-value model, and `EvidenceItem.value` is
 * an identity input.
 */
const evidenceSet = (value = '4.1') =>
  buildEvidenceSet({
    items: [
      {
        ref: observationRef(
          {
            subjectKind: 'series',
            subject: 'US10Y',
            kind: 'yield',
            observedAt: AT,
            referencePeriod: '2026-07-28',
            sourceId: 'treasury',
          },
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
      budget: NON_CONSUMING_BUDGET,
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

describe('evidence links to observations rather than copying them', () => {
  /** The same yield, as an observation and as an evidence item over it. */
  const linkable = () => {
    const value = {
      yieldPercent: '4.10',
      changeBasisPoints: null,
      observationDate: '2026-08-14',
    }
    const ref = observationRef(
      {
        subjectKind: 'instrument',
        subject: 'rate:us10y',
        kind: 'yield',
        observedAt: '2026-08-14T20:00:00.000Z',
        referencePeriod: '2026-08-14',
        sourceId: 'treasury',
        seriesId: 'BC_10YEAR',
        methodology: 'par-yield',
      },
      value,
    )
    const provenance = {
      source: { providerId: 'treasury' },
      quality: 'official-daily',
    } as never
    return {
      observation: buildObservation({
        ref,
        value,
        provenance,
        recordedAt: '2026-08-15T06:00:00.000Z',
        correlationId: 'ingest-1',
      }),
      item: { ref, value, provenance },
    }
  }

  it('stores no payload on an item whose observation the firm holds', async () => {
    /*
     * Gate §0.3b: one institutional truth for what an observation said. The row
     * carries membership and the link; `analysis.observations` carries the fact.
     */
    const { observation, item } = linkable()
    await repos.observations.record([observation], await repos.provenance())
    const set = await repos.evidence.save(
      buildEvidenceSet({ items: [item], assembledAt: AT, correlationId: 'c' }),
    )

    const rows = await db.owner.query(
      `SELECT links_observation, value, provenance FROM analysis.evidence_items
       WHERE evidence_set_id = $1`,
      [set.id],
    )
    expect(rows.rows[0].links_observation).toBe(true)
    expect(rows.rows[0].value).toBeNull()
    expect(rows.rows[0].provenance).toBeNull()
  })

  it('reads the linked payload back through the observation store', async () => {
    const { observation, item } = linkable()
    await repos.observations.record([observation], await repos.provenance())
    const saved = await repos.evidence.save(
      buildEvidenceSet({ items: [item], assembledAt: AT, correlationId: 'c' }),
    )

    const read = await repos.evidence.get(saved.id)
    expect(read?.items[0]!.value).toEqual({
      yieldPercent: '4.10',
      changeBasisPoints: null,
      observationDate: '2026-08-14',
    })
    expect(read?.items[0]!.ref.referencePeriod).toBe('2026-08-14')
  })

  it('keeps its own payload when the firm holds no such observation', async () => {
    /*
     * The closed legacy shape. Nothing is fabricated for a set assembled from
     * observations the store never held — §0.3b forbids inventing the linkage,
     * and this is what "forward only" looks like at the row level.
     */
    const { item } = linkable()
    const set = await repos.evidence.save(
      buildEvidenceSet({ items: [item], assembledAt: AT, correlationId: 'c' }),
    )

    const rows = await db.owner.query(
      `SELECT links_observation, value FROM analysis.evidence_items
       WHERE evidence_set_id = $1`,
      [set.id],
    )
    expect(rows.rows[0].links_observation).toBe(false)
    expect(rows.rows[0].value).not.toBeNull()
    expect((await repos.evidence.get(set.id))?.items[0]!.value).toEqual(item.value)
  })

  it('refuses a linked item whose observation has gone missing', async () => {
    /*
     * The planted violation. A set that quietly returned fewer facts than it
     * was assembled from would let a claim's basis shrink with nothing saying
     * so — so a broken link is refused by name rather than hydrated as an item
     * with no payload.
     */
    const { observation, item } = linkable()
    await repos.observations.record([observation], await repos.provenance())
    const set = await repos.evidence.save(
      buildEvidenceSet({ items: [item], assembledAt: AT, correlationId: 'c' }),
    )

    await db.owner.query(`DELETE FROM analysis.observations WHERE observation_id = $1`, [
      observation.ref.id,
    ])

    await expect(repos.evidence.get(set.id)).rejects.toBeInstanceOf(MalformedRowError)
  })
})

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
        budget: NON_CONSUMING_BUDGET,
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
    const first = await createPostgresRepositories({ connectionString: appUrl })
    const second = await createPostgresRepositories({ connectionString: appUrl })
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
    const other = await createPostgresRepositories({ connectionString: appUrl })
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
    const other = await createPostgresRepositories({ connectionString: appUrl })
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
    expect(provenance.schemaVersion).toBe('0053')
    expect(provenance.schemaChecksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes the query catalogue', async () => {
    const provenance = await repos.provenance()
    expect(provenance.queryCatalogHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the catalogue hash when a statement changes', () => {
    // The coordinate's whole purpose: "which SQL produced this analysis".
    expect(catalogHash([{ name: 'c', statements: { get: 'SELECT 1' } }])).not.toBe(
      catalogHash([{ name: 'c', statements: { get: 'SELECT 2' } }]),
    )
  })

  it('ignores whitespace, so reformatting is not a new catalogue', () => {
    expect(catalogHash([{ name: 'c', statements: { get: 'SELECT  1\n  FROM t' } }])).toBe(
      catalogHash([{ name: 'c', statements: { get: 'SELECT 1 FROM t' } }]),
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

/* ======================================= challenge provenance, end to end = */

/**
 * The PRODUCTION read path, which a raw-SQL test cannot exercise.
 *
 * `schema.pg.test.ts` proves the mapper and the constraints, but it reloads
 * with `SELECT *` — so it saw columns the repository's own query never asked
 * for, and it passed while every command flow was failing.
 *
 * That was Defect 2: `REVIEW_SQL.challenges` lists its columns explicitly and
 * had not been widened, so `challenger_kind` arrived as `undefined` and the
 * fail-closed mapper refused to reconstruct the act. The data was written
 * correctly and persisted correctly the whole time; it was simply never read.
 *
 * These go through `saveDevilsAdvocate` -> repository SELECT -> mapping, which
 * is the path the product uses.
 */
describe('challenge provenance survives the production read path', () => {
  /** A case, a run and one claim for challenges to contest. */
  async function seedClaim(): Promise<string> {
    await seedRun()
    await repos.claims.save(
      {
        id: 'claim-1',
        type: 'causal',
        statement: 'Long yields reflect stronger growth expectations',
        /* A causal claim must say on what basis. Ours is our own reading. */
        attribution: {
          kind: 'hedged-inference',
          reasoning: 'Read from the curve and activity data together.',
        },
        /*
         * `insufficient-evidence`: the domain refuses a `supported` claim with
         * nothing behind it, and this fixture exists to be CONTESTED, not to be
         * well-evidenced. Its status is irrelevant to challenge provenance.
         */
        status: 'insufficient-evidence',
        evidenceRefs: [],
        contradictingEvidenceRefs: [],
        confidence: { level: 'moderate', basis: [] },
        temporalScope: { asOf: AT },
      },
      'case-1',
      'run-1',
    )
    return 'claim-1'
  }

  const challengeOf = (over: Partial<Challenge> = {}): Challenge =>
    buildChallenge({
      id: 'chl-1',
      challengerKind: 'devils-advocate',
      byDepartmentId: 'devils-advocate',
      contests: 'claim-1',
      kind: 'fragile-assumption',
      argument: 'The attribution assumes growth rather than real-rate repricing',
      counterEvidence: [],
      wouldBeResolvedBy: 'A decomposition of the move',
      materiality: 'material',
      ...over,
    })

  const reviewOf = (challenge: Challenge, outcome: ChallengeStatus = 'open') => ({
    reviewId: 'rvw-1',
    scope: 'case' as const,
    caseId: 'case-1',
    byEmployeeId: 'devils-advocate-head',
    byDepartmentId: 'devils-advocate',
    at: AT,
    sequence: 1,
    challenges: [challenge],
    outcomes: { [challenge.id]: outcome },
  })

  async function reload(): Promise<Challenge> {
    const reviews = await repos.reviews.challengesForCase('case-1')
    return reviews[0]!.challenges[0]!
  }

  it('round-trips a Devil’s Advocate mandate through the repository', async () => {
    await seedClaim()
    await repos.reviews.saveDevilsAdvocate(reviewOf(challengeOf()))

    const challenge = await reload()
    expect(challenge.challengerKind).toBe('devils-advocate')
    expect(challenge.byDepartmentId).toBe('devils-advocate')
  })

  it('round-trips a peer mandate through the repository', async () => {
    /*
     * The case the fail-closed mapper protects. Under a default this would have
     * reloaded as `devils-advocate` and reported that a conclusion had been
     * challenged by the control function rather than by a desk that knows the
     * subject.
     */
    await seedClaim()
    await repos.reviews.saveDevilsAdvocate(
      reviewOf(
        challengeOf({ challengerKind: 'peer', byDepartmentId: 'quant-technical' }),
      ),
    )

    const challenge = await reload()
    expect(challenge.challengerKind).toBe('peer')
    expect(challenge.byDepartmentId).toBe('quant-technical')
  })

  it('leaves every pre-existing field exactly as it was', async () => {
    /*
     * The Half A invariant: a challenge gaining explicit provenance must
     * otherwise be observationally identical to the same challenge before it.
     */
    await seedClaim()
    const original = challengeOf()
    await repos.reviews.saveDevilsAdvocate(reviewOf(original, 'open'))

    const challenge = await reload()
    expect(challenge.id).toBe(original.id)
    expect(challenge.contests).toBe(original.contests)
    expect(challenge.kind).toBe(original.kind)
    expect(challenge.argument).toBe(original.argument)
    expect(challenge.materiality).toBe(original.materiality)
    expect(challenge.wouldBeResolvedBy).toBe(original.wouldBeResolvedBy)
    expect(challenge.counterEvidence).toEqual(original.counterEvidence)
  })

  it('carries the outcome and its resolver through unchanged', async () => {
    await seedClaim()
    const resolved = challengeOf({ resolvedBy: 'research-director' })
    await repos.reviews.saveDevilsAdvocate(reviewOf(resolved, 'resolved'))

    const reviews = await repos.reviews.challengesForCase('case-1')
    const review = reviews[0]!
    expect(review.outcomes[resolved.id]).toBe('resolved')
    expect(review.challenges[0]!.resolvedBy).toBe('research-director')
  })

  it('refuses to reconstruct a challenge whose mandate did not come back', async () => {
    /*
     * Defect 2 reproduced at the boundary where it happened.
     *
     * NULL is not the failure mode and cannot be: the column is NOT NULL since
     * 0034, so the database will not hold one. What actually happened was a
     * SELECT that never asked for the column, which reaches the mapper as
     * `undefined` — a row projection missing a field, not a row with a null in
     * it.
     *
     * So this feeds the mapper exactly that: the row as the old query returned
     * it. If it ever reconstructs a challenge instead of throwing, the mapper
     * has acquired a default and every peer challenge read through an
     * incomplete projection would silently become a Devil's Advocate one.
     */
    await seedClaim()
    await repos.reviews.saveDevilsAdvocate(reviewOf(challengeOf()))

    const { rows } = await db.owner.query(
      `SELECT id, review_id, contests_claim_id, contests_thesis_id, kind,
              argument, would_be_resolved_by, outcome, materiality, resolved_by
       FROM analysis.challenges WHERE id = 'chl-1'`,
    )
    const reviewRows = await db.owner.query(
      `SELECT * FROM analysis.reviews WHERE id = 'rvw-1'`,
    )
    const reviewRow = reviewRows.rows[0]
    const rawAt = reviewRow.at as unknown
    expect(() =>
      toDevilsAdvocate(
        { ...reviewRow, at: rawAt instanceof Date ? rawAt.toISOString() : reviewRow.at },
        rows,
        [],
      ),
    ).toThrow(/not a known mandate/)
  })
})
