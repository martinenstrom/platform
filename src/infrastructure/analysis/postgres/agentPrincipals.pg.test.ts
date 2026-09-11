/**
 * The exactly-one-accountable-principal invariant, in the database.
 *
 * TypeScript can be bypassed by a migration, a repair script, a future adapter
 * or a hand-written statement. The rule that an institutional act has exactly
 * one accountable principal — a human employee or a named agent, never both and
 * never neither — is therefore enforced where nothing can route around it.
 *
 * These are the cases the ruling names: employee only, agent only, both,
 * neither, and a foreign key to a principal that does not exist.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let sql: Client
let app: Client

const RUN_COLUMNS = `
  id, case_id, tenant_id, assignment_id, department_id, state,
  agent_contract_version, output_schema_version, identity_kind,
  scenario_id, stub_version,
  usage_state, started_at,
  playbook_id, playbook_version, playbook_entry_key,
  provider_id, provider_version, provider_kind, missing_optional_inputs,
  provenance_id, evidence_set_id,
  budget_tokens_kind, budget_cost_kind, budget_deadline_kind
`

const RUN_VALUES = `
  'run-x', 'case-1', 'system', 'assignment-1', 'global-macro', 'running',
  '1', '1', 'scenario',
  'success', '1',
  'not-applicable', now(),
  'c1c', '1', 'entry',
  'stub-provider', '1', 'stub', '{}',
  'prov-1', 'set-1',
  'not-applicable', 'not-applicable', 'not-measured'
`

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  sql = db.owner
  app = await db.connectAs(APP_ROLE)
}, 180_000)

afterAll(async () => {
  await app?.end()
  await db?.drop()
})

beforeEach(async () => {
  await sql.query('DELETE FROM analysis.runs')
  await sql.query('DELETE FROM analysis.evidence_sets')
  await sql.query('DELETE FROM analysis.assignments')
  await sql.query('DELETE FROM analysis.cases')
  await sql.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ('prov-1', 'postgres', 'v', 'test', 'catalog', '0041', '6', '2', now())
     ON CONFLICT (id) DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
     VALUES ('set-1', now(), 'c', '{}') ON CONFLICT (id) DO NOTHING`,
  )
  /* A run pins a registered playbook entry; the FK chain is real. */
  await sql.query(
    `INSERT INTO analysis.playbooks (id, name, case_kind)
     VALUES ('c1c', 'Test playbook', 'macro-regime') ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_versions (playbook_id, version, created_at, content_hash)
     VALUES ('c1c', '1', now(), 'hash') ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_entries
       (playbook_id, version, entry_key, department_id, brief, priority, requirement)
     VALUES ('c1c', '1', 'entry', 'global-macro', 'Regime read', 100, 'required')
     ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at)
     VALUES ('case-1', 'system', 1, 'research-director', 'macro-regime', 'ecb',
             'ECB', 'Why?', 'research', now())`,
  )
  await sql.query(
    `INSERT INTO analysis.assignments
       (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
     VALUES ('assignment-1', 'case-1', 'system', 'global-macro', 'Regime read',
             'queued', 5, now())`,
  )
})

describe('an accountable act names exactly one principal', () => {
  it('accepts an employee alone', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.runs (${RUN_COLUMNS}, employee_id)
         VALUES (${RUN_VALUES}, 'macro-head')`,
      ),
    ).resolves.toBeDefined()
  })

  it('accepts an agent principal alone', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.runs (${RUN_COLUMNS}, agent_principal_id)
         VALUES (${RUN_VALUES}, 'global-macro-agent')`,
      ),
    ).resolves.toBeDefined()
  })

  it('refuses both a human and an agent', async () => {
    /*
     * The dangerous one. Two accountable principals would let a reader pick
     * whichever suited them, and the record would support both readings.
     */
    await expect(
      sql.query(
        `INSERT INTO analysis.runs (${RUN_COLUMNS}, employee_id, agent_principal_id)
         VALUES (${RUN_VALUES}, 'macro-head', 'global-macro-agent')`,
      ),
    ).rejects.toThrow(/runs_one_accountable_principal/)
  })

  it('refuses neither', async () => {
    await expect(
      sql.query(`INSERT INTO analysis.runs (${RUN_COLUMNS}) VALUES (${RUN_VALUES})`),
    ).rejects.toThrow(/runs_one_accountable_principal/)
  })

  it('refuses an agent principal the firm does not hold', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.runs (${RUN_COLUMNS}, agent_principal_id)
         VALUES (${RUN_VALUES}, 'ghost-agent')`,
      ),
    ).rejects.toThrow(/foreign key|fkey/i)
  })
})

/**
 * Who declined an agent's work, when that "who" is not a person.
 *
 * The repair migration 0044 made. P4 widened `RejectContribution` to the
 * accountable institutional principal, and the storage contract still required
 * an employee — so an agent declining a contribution failed at the foreign key,
 * unreached by any suite because P4's live proof exercised acceptance only.
 */
describe('a rejection names exactly one declining principal', () => {
  const REJECTED = `
    rejection_code, rejection_detail, rejected_at, state
  `
  const REASON = `'insufficient-analysis', 'It stopped short.', now(), 'rejected'`

  /* `runs.state` is inside RUN_VALUES, so a rejected run needs its own pair. */
  const rejectedRun = (principal: string) =>
    `INSERT INTO analysis.runs (
       id, case_id, tenant_id, assignment_id, department_id,
       agent_contract_version, output_schema_version, identity_kind,
       scenario_id, stub_version, usage_state, started_at,
       playbook_id, playbook_version, playbook_entry_key,
       provider_id, provider_version, provider_kind, missing_optional_inputs,
       provenance_id, evidence_set_id,
       budget_tokens_kind, budget_cost_kind, budget_deadline_kind,
       employee_id, ${REJECTED}${principal ? `, ${principal}` : ''})
     VALUES (
       'run-r', 'case-1', 'system', 'assignment-1', 'global-macro',
       '1', '1', 'scenario',
       'success', '1', 'not-applicable', now(),
       'c1c', '1', 'entry',
       'stub-provider', '1', 'stub', '{}',
       'prov-1', 'set-1',
       'not-applicable', 'not-applicable', 'not-measured',
       'macro-head', ${REASON}${principal ? `, '${principalValue(principal)}'` : ''})`

  function principalValue(column: string): string {
    return column === 'rejected_by_employee_id' ? 'macro-head' : 'global-macro-agent'
  }

  it('accepts an agent as the decliner', async () => {
    /* The exact case that failed at the foreign key before 0044. */
    await expect(
      sql.query(rejectedRun('rejected_by_agent_principal_id')),
    ).resolves.toBeDefined()
  })

  it('accepts an employee as the decliner', async () => {
    await expect(sql.query(rejectedRun('rejected_by_employee_id'))).resolves.toBeDefined()
  })

  it('refuses a rejection with no decliner', async () => {
    await expect(sql.query(rejectedRun(''))).rejects.toThrow(
      /runs_rejected_by_one_principal/,
    )
  })

  it('refuses a decliner on a run nobody declined', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.runs (${RUN_COLUMNS}, employee_id,
           rejected_by_agent_principal_id)
         VALUES (${RUN_VALUES}, 'macro-head', 'global-macro-agent')`,
      ),
    ).rejects.toThrow(/runs_rejected_by_one_principal/)
  })

  it('refuses a decliner the firm does not hold', async () => {
    await expect(
      sql.query(
        rejectedRun('rejected_by_agent_principal_id').replace(
          "'global-macro-agent'",
          "'ghost-agent'",
        ),
      ),
    ).rejects.toThrow(/foreign key|fkey/i)
  })

  it('lets the runtime write the new column', async () => {
    /*
     * Schema existence does not prove runtime writability. `UPDATE` on
     * `analysis.runs` is column-level, so the column being there and the CHECK
     * allowing the value prove nothing until the grant is checked as the
     * runtime role — which is what 0043 had to be written to learn.
     */
    await sql.query(rejectedRun('rejected_by_agent_principal_id'))
    await expect(
      app.query(
        `UPDATE analysis.runs SET rejected_by_agent_principal_id = 'global-macro-agent'
         WHERE id = 'run-r'`,
      ),
    ).resolves.toBeDefined()
  })
})

describe('the seeded principals', () => {
  it('reference real departments and roles', async () => {
    /* The join proves the FKs resolve, not merely that the strings look right. */
    const rows = await sql.query(
      `SELECT p.id FROM analysis.agent_principals p
       JOIN analysis.departments d ON d.id = p.department_id
       JOIN analysis.roles r ON r.id = p.role_id
       ORDER BY p.id`,
    )
    expect(rows.rows.map((row) => row.id)).toEqual([
      'global-macro-agent',
      'rates-agent',
      'research-office-agent',
    ])
  })

  it('grants department-analysis authority to one role and no other', async () => {
    /*
     * The whole point of an explicit capability. `head-of-macro` and
     * `head-of-rates` are manager-function roles held by agent principals, and
     * a rule that read the function rather than the grant would have handed
     * both of them authority over their own desks the moment it shipped.
     */
    const granted = await sql.query(
      `SELECT id FROM analysis.roles
       WHERE can_manage_department_analysis ORDER BY id`,
    )
    expect(granted.rows.map((row) => row.id)).toEqual(['research-director'])

    const managers = await sql.query(
      `SELECT id FROM analysis.roles
       WHERE function = 'manager' AND NOT can_manage_department_analysis
       ORDER BY id`,
    )
    expect(managers.rows.map((row) => row.id)).toContain('head-of-macro')
    expect(managers.rows.map((row) => row.id)).toContain('head-of-rates')
  })

  it('refuses the capability on a role that is not a manager', async () => {
    /* The same invariant `buildRole` enforces, so neither side can drift. */
    await expect(
      sql.query(
        `UPDATE analysis.roles SET can_manage_department_analysis = true
         WHERE id = 'chief-investment-officer'`,
      ),
    ).rejects.toThrow(/roles_department_analysis_is_management/)
    await expect(
      sql.query(
        `UPDATE analysis.roles SET can_manage_department_analysis = true
         WHERE id = 'head-of-verification'`,
      ),
    ).rejects.toThrow(/roles_department_analysis_is_management/)
  })

  it('is readable by the application login', async () => {
    /* Migration 0040 omitted the grants; 0041 added them. This is that fix. */
    const rows = await app.query('SELECT id FROM analysis.agent_principals')
    expect(rows.rows.length).toBeGreaterThan(0)
  })

  it('is not writable by the application login', async () => {
    /* The roster is migration-managed, exactly as employees are. */
    await expect(
      app.query(
        `INSERT INTO analysis.agent_principals (id, department_id, role_id, display_name)
         VALUES ('rogue', 'global-macro', 'head-of-macro', 'Rogue')`,
      ),
    ).rejects.toThrow()
  })
})

describe('the invariant reaches every accountable surface', () => {
  it('constrains all four act tables', async () => {
    const constraints = await sql.query(
      `SELECT conname FROM pg_constraint
       WHERE conname LIKE '%one_accountable_principal%'
       ORDER BY conname`,
    )
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      'aggregations_one_accountable_principal',
      'reviews_one_accountable_principal',
      'runs_one_accountable_principal',
      'thesis_revisions_one_accountable_principal',
    ])
  })

  it('allows an assignment with neither, because unassigned work is real', async () => {
    /*
     * Assignments carry AT MOST one, not exactly one. Queued work nobody has
     * picked up is a legitimate state and differs from an act with no
     * accountable principal.
     */
    const constraint = await sql.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'assignments_at_most_one_assignee'`,
    )
    expect(constraint.rows[0]!.def).toContain('<= 1')
  })
})
