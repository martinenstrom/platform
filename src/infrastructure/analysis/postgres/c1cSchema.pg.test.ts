/**
 * What migration 0015 makes impossible.
 *
 * Three guarantees, each one a thing the application alone cannot promise:
 * a run always says what produced it, a stopped run says why in a bounded
 * vocabulary, and one assignment never carries two live runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let sql: Client

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  sql = db.owner

  await sql.query(
    `INSERT INTO analysis.playbooks (id, case_kind, name)
     VALUES ('c1c', 'macro', 'C1C test playbook') ON CONFLICT (id) DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_versions (playbook_id, version, content_hash)
     VALUES ('c1c', '1', 'hash') ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_entries
       (playbook_id, version, entry_key, department_id, brief, requirement, priority)
     VALUES ('c1c', '1', 'entry', 'global-macro', 'Regime read', 'required', 5)
     ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ('c1c-prov', 'postgres', 'v', 'test', 'catalog', '0015', '4', '2', now())
     ON CONFLICT (id) DO NOTHING`,
  )
}, 180_000)

afterAll(async () => {
  await db?.drop()
})

let unique = 0
const id = (prefix: string) => `${prefix}-${++unique}`

async function insertCase() {
  const caseId = id('case')
  await sql.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at)
     VALUES ($1, 'system', 1, 'research-director', 'macro', 'regime',
             'Regime', 'Is it mispriced?', 'research', now())`,
    [caseId],
  )
  return caseId
}

async function insertAssignment(caseId: string) {
  const assignmentId = id('assignment')
  await sql.query(
    `INSERT INTO analysis.assignments
       (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
     VALUES ($1, $2, 'system', 'global-macro', 'Regime read', 'queued', 5, now())`,
    [assignmentId, caseId],
  )
  return assignmentId
}

async function insertEvidenceSet() {
  const setId = id('set')
  await sql.query(
    `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
     VALUES ($1, now(), 'corr', '{"kind":"empty"}'::jsonb)`,
    [setId],
  )
  return setId
}

async function insertRun(
  caseId: string,
  assignmentId: string,
  over: Partial<{
    state: string
    providerKind: string | null
    entryKey: string
    failure: string | null
    identityKind: string
    usageState: string
  }> = {},
) {
  const runId = id('run')
  const setId = await insertEvidenceSet()
  const failure = over.failure === undefined ? null : over.failure
  await sql.query(
    `INSERT INTO analysis.runs
       (id, case_id, tenant_id, assignment_id, department_id, employee_id, state,
        agent_contract_version, output_schema_version,
        identity_kind, prompt_id, prompt_version,
        prompt_content_hash, model_id, model_provider, model_parameters_hash,
        scenario_id, stub_version, identity_unavailable_reason,
        usage_state, evidence_set_id, started_at, completed_at,
        failure_category, failure_retryable, failure_attempt, failed_at,
        playbook_id, playbook_version, playbook_entry_key,
        provider_id, provider_version, provider_kind, missing_optional_inputs,
        provenance_id)
     VALUES ($1, $2, 'system', $3, 'global-macro', 'macro-head', $4,
             '1', '1', $9::text,
             CASE WHEN $9::text = 'model' THEN 'p' END,
             CASE WHEN $9::text = 'model' THEN '1' END,
             CASE WHEN $9::text = 'model' THEN 'ph' END,
             CASE WHEN $9::text = 'model' THEN 'm' END,
             CASE WHEN $9::text = 'model' THEN 'anthropic' END,
             CASE WHEN $9::text = 'model' THEN 'mh' END,
             CASE WHEN $9::text = 'scenario' THEN 'success' END,
             CASE WHEN $9::text = 'scenario' THEN '1' END,
             CASE WHEN $9::text = 'unavailable' THEN 'not-captured-by-recording' END,
             $10::text, $5, now(),
             CASE WHEN $4::text = 'completed' THEN now() ELSE NULL END,
             $6::text,
             CASE WHEN $6::text IS NULL THEN NULL ELSE true END,
             CASE WHEN $6::text IS NULL THEN NULL ELSE 1 END,
             CASE WHEN $6::text IS NULL THEN NULL ELSE now() END,
             'c1c', '1', $7,
             'recorded-provider', '1', $8::text, '{}', 'c1c-prov')`,
    [
      runId,
      caseId,
      assignmentId,
      over.state ?? 'running',
      setId,
      failure,
      over.entryKey ?? 'entry',
      over.providerKind === undefined ? 'recorded' : over.providerKind,
      over.identityKind ?? 'model',
      over.usageState ?? 'not-applicable',
    ],
  )
  return runId
}

/* --------------------------------------------------- execution provenance */

describe('a run’s execution provenance', () => {
  it('records what produced the work and under which workflow', async () => {
    const caseId = await insertCase()
    const runId = await insertRun(caseId, await insertAssignment(caseId))

    const { rows } = await sql.query(
      `SELECT playbook_id, playbook_version, playbook_entry_key,
              provider_id, provider_version, provider_kind
       FROM analysis.runs WHERE id = $1`,
      [runId],
    )
    expect(rows[0]).toMatchObject({
      playbook_id: 'c1c',
      playbook_version: '1',
      playbook_entry_key: 'entry',
      provider_kind: 'recorded',
    })
  })

  it('cannot exist without saying what produced it', async () => {
    const caseId = await insertCase()
    // A run with no provider kind could be presented as live institutional
    // work, which is the failure this column exists to prevent.
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { providerKind: null }),
    ).rejects.toThrow(/provider_kind/)
  })

  it('refuses a provider kind outside the three', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { providerKind: 'real-ish' }),
    ).rejects.toThrow(/runs_provider_kind_known/)
  })

  it('refuses an entry that does not belong to the version it claims', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { entryKey: 'invented' }),
    ).rejects.toThrow(/runs_playbook_entry_fkey/)
  })
})

/* ------------------------------------------------------- bounded failures */

describe('a stopped run', () => {
  it('accepts a category from the closed vocabulary', async () => {
    const caseId = await insertCase()
    const runId = await insertRun(caseId, await insertAssignment(caseId), {
      state: 'failed',
      failure: 'provider-timeout',
    })

    const { rows } = await sql.query(
      `SELECT failure_category, failure_retryable, failure_attempt
       FROM analysis.runs WHERE id = $1`,
      [runId],
    )
    expect(rows[0]).toMatchObject({
      failure_category: 'provider-timeout',
      failure_retryable: true,
      failure_attempt: 1,
    })
  })

  it('refuses a category nobody approved', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), {
        state: 'failed',
        failure: 'the model got confused and said something odd',
      }),
    ).rejects.toThrow(/runs_failure_category_known/)
  })

  it('refuses a failed run with no category at all', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), {
        state: 'failed',
        failure: null,
      }),
    ).rejects.toThrow(/runs_stalled_with_category/)
  })

  it('refuses a completed run that also claims to have failed', async () => {
    const caseId = await insertCase()
    // Two answers about one run is worse than none.
    await expect(
      insertRun(caseId, await insertAssignment(caseId), {
        state: 'completed',
        failure: 'provider-error',
      }),
    ).rejects.toThrow(/runs_progress_without_failure/)
  })

  it('has no column for raw provider text', async () => {
    const { rows } = await sql.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'analysis' AND table_name = 'runs'
         AND column_name = 'failure_reason'`,
    )
    // The free-text field is gone, not merely unused.
    expect(rows).toEqual([])
  })
})

/* --------------------------------------------------------- one active run */

describe('one assignment, one live run', () => {
  it('refuses a second non-terminal run on the same assignment', async () => {
    const caseId = await insertCase()
    const assignmentId = await insertAssignment(caseId)
    await insertRun(caseId, assignmentId, { state: 'running' })

    await expect(insertRun(caseId, assignmentId, { state: 'running' })).rejects.toThrow(
      /runs_one_active_per_assignment/,
    )
  })

  it('permits a retry once the first run has settled', async () => {
    const caseId = await insertCase()
    const assignmentId = await insertAssignment(caseId)
    await insertRun(caseId, assignmentId, {
      state: 'failed',
      failure: 'provider-timeout',
    })

    // The department may try again; the failed run stays as history.
    const second = await insertRun(caseId, assignmentId, { state: 'running' })
    expect(second).toBeTruthy()
  })

  it('permits many settled runs on one assignment', async () => {
    const caseId = await insertCase()
    const assignmentId = await insertAssignment(caseId)
    await insertRun(caseId, assignmentId, { state: 'failed', failure: 'provider-error' })
    await insertRun(caseId, assignmentId, {
      state: 'timed-out',
      failure: 'provider-timeout',
    })
    await insertRun(caseId, assignmentId, { state: 'completed' })

    const { rows } = await sql.query(
      `SELECT count(*)::int n FROM analysis.runs WHERE assignment_id = $1`,
      [assignmentId],
    )
    expect(rows[0]!.n).toBe(3)
  })
})

/* ------------------------------------------------------------- assignments */

describe('an assignment that failed', () => {
  it('is a state of its own, distinct from cancelled', async () => {
    const caseId = await insertCase()
    const assignmentId = await insertAssignment(caseId)

    await sql.query(`UPDATE analysis.assignments SET status = 'failed' WHERE id = $1`, [
      assignmentId,
    ])
    const { rows } = await sql.query(
      `SELECT status FROM analysis.assignments WHERE id = $1`,
      [assignmentId],
    )
    expect(rows[0]!.status).toBe('failed')
  })

  it('still refuses a status nobody approved', async () => {
    const caseId = await insertCase()
    const assignmentId = await insertAssignment(caseId)
    await expect(
      sql.query(`UPDATE analysis.assignments SET status = 'confused' WHERE id = $1`, [
        assignmentId,
      ]),
    ).rejects.toThrow(/assignments_status_known/)
  })
})

/* ---------------------------------------------------------------- grants */

describe('what the runtime may change on a run', () => {
  it('may move the failure fields but not what produced the work', async () => {
    const { rows } = await sql.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_schema = 'analysis' AND table_name = 'runs'
         AND grantee = $1 AND privilege_type = 'UPDATE'
       ORDER BY column_name`,
      [APP_ROLE],
    )
    const updatable = rows.map((r) => r.column_name)

    expect(updatable).toContain('failure_category')
    expect(updatable).toContain('state')
    // Execution provenance is written once, with the run.
    expect(updatable).not.toContain('provider_kind')
    expect(updatable).not.toContain('provider_id')
    expect(updatable).not.toContain('playbook_id')
    expect(updatable).not.toContain('provenance_id')
  })
})
