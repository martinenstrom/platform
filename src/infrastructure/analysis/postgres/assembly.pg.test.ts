/**
 * The governed assembly act, end to end against PostgreSQL.
 *
 * The in-memory suite proves the behaviour of the act. This proves the things
 * only a real database can: migration `0033`'s foreign key and check
 * constraints, the `text[]` column, the append-only grant, and — the property
 * C3 §0.3b turns on — that the set's items are stored as **links** into
 * `analysis.observations` rather than as a second copy of what an observation
 * said.
 *
 * The privilege half is asserted rather than assumed: the application role is
 * granted SELECT and INSERT on `evidence_assemblies` and nothing else, so a
 * recorded judgement cannot be edited afterwards by any statement the
 * application is able to issue.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import { createAnalysisContainer, type AnalysisContainer } from '../container'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { assembleEvidenceSet } from '~/application/analysis/commands/assembleEvidenceSet'
import { ingestYields } from '~/application/analysis/ingestObservations'
import { DERIVED_SOURCE_ID } from '~/application/analysis/deriveObservations'
import { buildYield, isoCurrency, type CanonicalSymbol } from '~/domain/market'
import { buildProvenance } from '~/domain/shared/provenance'

const AT = '2026-08-20T09:00:00.000Z'
const USD = isoCurrency('USD')

const CLOCK = {
  isoNow: () => AT,
  epochMs: () => Date.parse(AT),
  now: () => new Date(AT),
}

let db: TestDatabase
let appUrl: string
let container: AnalysisContainer
let owner: Client

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
  container = await createAnalysisContainer({
    connectionString: appUrl,
    buildId: 'assembly-pg',
    clock: CLOCK,
  })
  owner = db.owner
}, 300_000)

afterAll(async () => {
  await container?.close().catch(() => {})
  await db?.drop()
})

beforeEach(async () => {
  await db.truncateAnalysisData()
})

const parYield = (args: {
  symbol: string
  seriesId: string
  maturity: '2Y' | '10Y'
  observationDate: string
  percent: number
}) =>
  buildYield({
    symbol: args.symbol as CanonicalSymbol,
    countryCode: 'US',
    currency: USD,
    maturity: args.maturity,
    seriesId: args.seriesId,
    methodology: 'par-yield',
    observationDate: args.observationDate,
    yieldPercent: args.percent,
    provenance: buildProvenance({
      asOf: `${args.observationDate}T00:00:00.000Z`,
      nowMs: Date.parse(AT),
      asOfPrecision: 'date',
      sourceDate: args.observationDate,
      quality: 'official-daily',
      source: {
        providerId: 'treasury',
        providerName: 'U.S. Department of the Treasury',
        trust: 'issuer',
      },
    }),
  })

async function ingestCurve(observationDate: string, two: number, ten: number) {
  return ingestYields({
    repositories: container.repositories,
    yields: [
      parYield({
        symbol: 'rate:us2y',
        seriesId: 'BC_2YEAR',
        maturity: '2Y',
        observationDate,
        percent: two,
      }),
      parYield({
        symbol: 'rate:us10y',
        seriesId: 'BC_10YEAR',
        maturity: '10Y',
        observationDate,
        percent: ten,
      }),
    ],
    recordedAt: '2026-08-15T00:00:00.000Z',
    correlationId: 'ingest-pg',
  })
}

async function assemble(commandId = 'cmd-assemble-pg') {
  const deps = await container.commandDeps()
  return runCommand(
    assembleEvidenceSet(deps.organization),
    {
      selection: {
        ruleId: 'sovereign-yield-curve@1',
        subjectFamily: 'us-par-curve',
        from: '2026-08-01',
        to: '2026-08-31',
      },
      onBehalfOfDepartmentId: 'research-office',
    },
    {
      commandId,
      correlationId: commandId,
      actor: { kind: 'employee', employeeId: 'research-director' },
      initiator: { kind: 'employee', employeeId: 'research-director' },
      occurredAt: AT,
    },
    deps,
  )
}

describe('assembling from the observation store, durably', () => {
  it('records the act, the set and the derivation in one transaction', async () => {
    await ingestCurve('2026-08-14', 3.9, 4.1)

    const result = await assemble()
    expect(result.outcome).toBe('committed')
    if (result.outcome !== 'committed') return

    const assembly = result.value
    expect(assembly.observationCount).toBe(2)
    expect(assembly.derivedCount).toBe(1)

    const stored = await container.repositories.assemblies.get(assembly.assemblyId)
    expect(stored).toEqual(assembly)

    const set = await container.repositories.evidence.get(assembly.evidenceSetId)
    expect(set!.items).toHaveLength(3)
    const slope = set!.items.find((item) => item.ref.sourceId === DERIVED_SOURCE_ID)!
    expect((slope.value as { slopeBasisPoints: string }).slopeBasisPoints).toBe('20')
  })

  it('stores the set as LINKS into the observation store, not as a second copy', async () => {
    /*
     * §0.3b, in the table. A linked row carries no payload of its own and reads
     * it through `analysis.observations`, so there is one institutional truth
     * for what an observation said. Every member of a C3-assembled set links,
     * because the assembly selected them from the store.
     */
    await ingestCurve('2026-08-14', 3.9, 4.1)
    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')

    const { rows } = await owner.query<{
      links_observation: boolean
      value: unknown
      provenance: unknown
    }>(
      `SELECT links_observation, value, provenance
       FROM analysis.evidence_items WHERE evidence_set_id = $1`,
      [result.value.evidenceSetId],
    )
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.links_observation).toBe(true)
      expect(row.value).toBeNull()
      expect(row.provenance).toBeNull()
    }
  })

  it('writes the selection relationally, so a reviewer can read the rule', async () => {
    await ingestCurve('2026-08-14', 3.9, 4.1)
    const result = await assemble()
    if (result.outcome !== 'committed') throw new Error('did not commit')

    const { rows } = await owner.query<{
      rule_id: string
      subject_family: string
      window_from: string
      window_to: string
      selected_subjects: string[]
      actor_employee_id: string
      on_behalf_of_department_id: string
      observation_count: number
      derived_count: number
    }>(`SELECT * FROM analysis.evidence_assemblies`)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.rule_id).toBe('sovereign-yield-curve@1')
    expect(rows[0]!.subject_family).toBe('us-par-curve')
    expect(rows[0]!.window_from).toBe('2026-08-01')
    expect(rows[0]!.window_to).toBe('2026-08-31')
    expect(rows[0]!.selected_subjects).toContain('rate:us10y')
    expect(rows[0]!.actor_employee_id).toBe('research-director')
    expect(rows[0]!.on_behalf_of_department_id).toBe('research-office')
    expect(rows[0]!.observation_count).toBe(2)
    expect(rows[0]!.derived_count).toBe(1)
  })

  it('leaves nothing behind when it refuses', async () => {
    /* No observations held: the act refuses, and the transaction rolls back. */
    const result = await assemble()
    expect(result.outcome).toBe('rejected')

    const sets = await owner.query('SELECT 1 FROM analysis.evidence_sets')
    const acts = await owner.query('SELECT 1 FROM analysis.evidence_assemblies')
    expect(sets.rowCount).toBe(0)
    expect(acts.rowCount).toBe(0)
  })
})

describe('the record of a judgement cannot be edited afterwards', () => {
  it('grants the application SELECT and INSERT only', async () => {
    const { rows } = await owner.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'analysis'
         AND table_name = 'evidence_assemblies'
         AND grantee = $1
       ORDER BY privilege_type`,
      [APP_ROLE],
    )
    expect(rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT'])
  })

  it('refuses an act pointing at a set the firm does not hold', async () => {
    /*
     * The foreign key, planted. An assembly whose set is not stored is a record
     * of nothing, and the table says so rather than accepting it.
     */
    await expect(
      owner.query(
        `INSERT INTO analysis.evidence_assemblies
           (assembly_id, evidence_set_id, rule_id, subject_family, window_from,
            window_to, known_at, selected_subjects, observation_count,
            derived_count, assembled_at, actor_employee_id,
            on_behalf_of_department_id, correlation_id, provenance_id)
         SELECT 'asm-x', 'no-such-set', 'r@1', 'f', '2026-08-01', '2026-08-31',
                now(), ARRAY['a'], 1, 0, now(), 'e', 'd', 'c', id
         FROM analysis.storage_provenance LIMIT 1`,
      ),
    ).rejects.toThrow(/violates foreign key constraint/)
  })
})
