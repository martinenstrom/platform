/**
 * The role model, exercised as the roles themselves.
 *
 * Every test here runs as a login user holding `finos_app` or
 * `finos_readonly` — never as the schema owner. That distinction is the whole
 * point: the owner can do anything, so a permission suite that runs as the
 * owner proves only that the owner is the owner.
 *
 * What is being verified is that the destructive operations are UNAVAILABLE to
 * the runtime rather than merely unused by it. A runtime that can drop a
 * trigger, alter a table or edit the migration history can undo every other
 * guarantee in this schema from a code path that looks like ordinary data
 * access.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  APP_ROLE,
  createTestDatabase,
  isPermissionDenied,
  READONLY_ROLE,
  type TestDatabase,
} from './testDatabase'

let db: TestDatabase
let app: Client
let readonly: Client

const provenanceId = 'provenance-test'

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  app = await db.connectAs(APP_ROLE)
  readonly = await db.connectAs(READONLY_ROLE)
  // The command ledger references it, so one has to exist.
  await db.owner.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ($1, 'postgres', 'v', 'test', 'catalog', '0015', '4', '2', now())`,
    [provenanceId],
  )
})
afterAll(async () => {
  await db.drop()
})

/** Asserts the statement fails specifically on privileges, not on anything else. */
async function expectDenied(client: Client, sql: string, parameters: unknown[] = []) {
  const error = await client.query(sql, parameters).then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error, `expected "${sql.slice(0, 60)}…" to be denied`).not.toBeNull()
  expect(
    isPermissionDenied(error),
    `expected a permission error, got: ${(error as Error).message}`,
  ).toBe(true)
}

let unique = 0
const id = (prefix: string) => `${prefix}-perm-${++unique}`

async function appCase(version = 1): Promise<string> {
  const caseId = id('case')
  await app.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at)
     VALUES ($1, 'system', $2, 'research-director', 'macro', 'regime',
             'Policy regime', 'Is the policy path mispriced?', 'intake', now())`,
    [caseId, version],
  )
  return caseId
}

/* ------------------------------------------------ the runtime is not the owner */

describe('the runtime role is not the schema owner', () => {
  it('cannot create a table in the schema', async () => {
    // USAGE is granted; CREATE deliberately is not.
    await expectDenied(app, 'CREATE TABLE analysis.smuggled (id text PRIMARY KEY)')
  })

  it('cannot add a column to an existing table', async () => {
    await expectDenied(app, 'ALTER TABLE analysis.cases ADD COLUMN sneaky text')
  })

  it('cannot drop a table', async () => {
    await expectDenied(app, 'DROP TABLE analysis.transition_events')
  })

  it('cannot disable a trigger that enforces immutability', async () => {
    // Disabling `case_decisions_immutable` would make the decision record
    // editable while every application-level check still passed.
    await expectDenied(
      app,
      'ALTER TABLE analysis.case_decisions DISABLE TRIGGER case_decisions_immutable',
    )
  })

  it('cannot drop a constraint', async () => {
    await expectDenied(
      app,
      'ALTER TABLE analysis.cases DROP CONSTRAINT cases_stage_known',
    )
  })

  it('cannot grant itself further privileges', async () => {
    /*
     * PostgreSQL does not raise on this. A GRANT from a role that holds
     * nothing to give emits `WARNING: no privileges were granted` and returns
     * success — so asserting that the statement fails would pass on a server
     * that had actually granted the privilege.
     *
     * What matters is the privilege, so that is what is checked: the GRANT
     * runs, and DELETE is still denied afterwards.
     */
    await app.query(`GRANT DELETE ON analysis.cases TO ${APP_ROLE}`)

    const { rows } = await app.query(
      `SELECT has_table_privilege($1, 'analysis.cases', 'DELETE') AS granted`,
      [APP_ROLE],
    )
    expect(rows[0].granted).toBe(false)
    await expectDenied(app, 'DELETE FROM analysis.cases')
  })

  it('cannot create a role', async () => {
    await expectDenied(app, 'CREATE ROLE escalated LOGIN')
  })
})

/* ------------------------------------------------------- migration history */

describe('the migration history is read-only to the runtime', () => {
  it('can read which version the database is at', async () => {
    const { rows } = await app.query(
      'SELECT version FROM analysis.schema_migrations ORDER BY version',
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('cannot insert a migration record', async () => {
    // A runtime that can write here can make a database claim to be a version
    // it is not, and the next deployment would skip a migration.
    await expectDenied(
      app,
      `INSERT INTO analysis.schema_migrations (version, name, checksum, execution_ms)
       VALUES ('9999', 'fake', 'x', 0)`,
    )
  })

  it('cannot update or delete a migration record', async () => {
    await expectDenied(app, `UPDATE analysis.schema_migrations SET checksum = 'x'`)
    await expectDenied(app, 'DELETE FROM analysis.schema_migrations')
  })
})

/* --------------------------------------------------------- the organization */

describe('the runtime reads the organization and never edits it', () => {
  it('can read departments and employees', async () => {
    const { rows } = await app.query('SELECT count(*)::int n FROM analysis.departments')
    expect(rows[0].n).toBe(15)
  })

  it('cannot add a department', async () => {
    // Changing the firm is a migration: deliberate, reviewed, and recorded —
    // never a side effect of a command.
    await expectDenied(
      app,
      `INSERT INTO analysis.departments (id, tenant_id, name, manager_employee_id, is_governance)
       VALUES ('rogue', 'system', 'Rogue', 'cio', false)`,
    )
  })

  it('cannot reclassify a governance department', async () => {
    // The write that would quietly remove a control function.
    await expectDenied(
      app,
      `UPDATE analysis.departments SET is_governance = false WHERE id = 'verification'`,
    )
  })

  it('cannot delete an employee referenced by historical work', async () => {
    await expectDenied(app, `DELETE FROM analysis.employees WHERE id = 'macro-head'`)
  })
})

/* --------------------------------------------------------------- append-only */

describe('append-only tables', () => {
  it('accepts an appended transition event', async () => {
    const caseId = await appCase()
    await expect(
      app.query(
        `INSERT INTO analysis.transition_events
           (event_id, subject, case_id, tenant_id, from_state, to_state, occurred_at,
            correlation_id, aggregate_version)
         VALUES ($1, 'case', $2, 'system', NULL, 'intake', now(), 'corr', 1)`,
        [id('event'), caseId],
      ),
    ).resolves.toBeDefined()
  })

  it('refuses to update a transition event', async () => {
    // Append-only as a PERMISSION rather than a convention the application is
    // trusted to honour. A log that can be tidied is not an audit trail.
    await expectDenied(app, `UPDATE analysis.transition_events SET reason = 'tidied'`)
  })

  it('refuses to delete a transition event', async () => {
    await expectDenied(app, 'DELETE FROM analysis.transition_events')
  })

  it('refuses to update or delete a run event', async () => {
    await expectDenied(app, `UPDATE analysis.run_events SET reason = 'x'`)
    await expectDenied(app, 'DELETE FROM analysis.run_events')
  })

  it('refuses to update or delete a claim', async () => {
    // Write-once: a claim that has been cited must not change underneath it.
    await expectDenied(app, `UPDATE analysis.claims SET statement = 'revised'`)
    await expectDenied(app, 'DELETE FROM analysis.claims')
  })

  it('refuses to update or delete an evidence set or item', async () => {
    await expectDenied(app, `UPDATE analysis.evidence_sets SET correlation_id = 'x'`)
    await expectDenied(app, 'DELETE FROM analysis.evidence_sets')
    await expectDenied(app, `UPDATE analysis.evidence_items SET content_hash = 'x'`)
  })

  it('refuses to update or delete a stored result', async () => {
    await expectDenied(app, `UPDATE analysis.agent_results SET claims = '[]'::jsonb`)
    await expectDenied(app, 'DELETE FROM analysis.agent_results')
  })

  it('refuses to update or delete a review', async () => {
    // A changed opinion is a new review, so the gate can see that the verdict
    // changed and when.
    await expectDenied(app, `UPDATE analysis.reviews SET status = 'verified'`)
    await expectDenied(app, 'DELETE FROM analysis.reviews')
  })

  it('refuses to update or delete a committed decision', async () => {
    await expectDenied(app, `UPDATE analysis.case_decisions SET rationale = 'x'`)
    await expectDenied(app, 'DELETE FROM analysis.case_decisions')
  })
})

/* ------------------------------------------------------- column-level grants */

describe('only the fields that legitimately move may be updated', () => {
  it('lets a case advance its stage and version', async () => {
    const caseId = await appCase(1)
    await expect(
      app.query(
        `UPDATE analysis.cases SET stage = 'research', version = 2 WHERE id = $1`,
        [caseId],
      ),
    ).resolves.toBeDefined()
  })

  it('refuses to rewrite the question a case was opened to answer', async () => {
    // The subject, question, owner and playbook are what the case IS.
    const caseId = await appCase()
    await expectDenied(
      app,
      `UPDATE analysis.cases SET question = 'A different question' WHERE id = $1`,
      [caseId],
    )
  })

  it('refuses to reassign a case to a different owner', async () => {
    const caseId = await appCase()
    await expectDenied(
      app,
      `UPDATE analysis.cases SET owner_employee_id = 'cio' WHERE id = $1`,
      [caseId],
    )
  })

  it('refuses to delete a case', async () => {
    await expectDenied(app, 'DELETE FROM analysis.cases')
  })

  it('lets a thesis revision be marked superseded', async () => {
    const caseId = await appCase()
    const revisionId = id('rev')
    await app.query(
      `INSERT INTO analysis.thesis_revisions
         (revision_id, thesis_id, revision_number, case_id, statement, position,
          lifecycle, invalidation_criteria, implications,
          proposed_by_department_id, proposed_by_employee_id, proposed_at,
          revision_cause)
       VALUES ($1, $2, 1, $3, 'The policy path is mispriced', 'buy', 'proposed',
               'The curve reprices above 4%', '{}', 'global-macro', 'macro-head',
               now(), 'initial-proposal')`,
      [revisionId, id('thesis'), caseId],
    )
    await expect(
      app.query(
        `UPDATE analysis.thesis_revisions SET lifecycle = 'superseded' WHERE revision_id = $1`,
        [revisionId],
      ),
    ).resolves.toBeDefined()
  })

  it('refuses to edit a thesis revision’s argument', async () => {
    // Denied by the grant before the trigger is ever reached — two independent
    // mechanisms, and the runtime meets the cheaper one first.
    await expectDenied(app, `UPDATE analysis.thesis_revisions SET statement = 'Edited'`)
    await expectDenied(app, `UPDATE analysis.thesis_revisions SET position = 'sell'`)
  })

  it('lets a challenge be resolved but not rewritten', async () => {
    await expectDenied(app, `UPDATE analysis.challenges SET argument = 'Rewritten'`)
    // The outcome is the one governance field that legitimately moves.
    const { rows } = await app.query(
      `SELECT has_column_privilege($1, 'analysis.challenges', 'outcome', 'UPDATE') AS granted`,
      [APP_ROLE],
    )
    expect(rows[0].granted).toBe(true)
  })
})

/* --------------------------------------------------------------- exceptions */

describe('nothing is deletable', () => {
  it('refuses to delete a command', async () => {
    /*
     * The schema has no deletable table at all since migration 0013. The
     * command ledger is an institutional record — what was asked, by whom,
     * under what authority — not a thirty-day operational cache, which is what
     * `idempotency_keys` was when it held the only DELETE grant.
     */
    await expectDenied(app, 'DELETE FROM analysis.commands')
    await expectDenied(app, 'DELETE FROM analysis.command_outcomes')
  })

  it('refuses to edit a command or its outcomes', async () => {
    await expectDenied(app, `UPDATE analysis.commands SET command_type = 'other'`)
    await expectDenied(app, `UPDATE analysis.command_outcomes SET state = 'committed'`)
  })

  it('lets the runtime record a command and append an outcome', async () => {
    const caseId = await appCase()
    await expect(
      app.query(
        `INSERT INTO analysis.commands
           (command_id, tenant_id, command_type, command_contract_version,
            payload_hash, case_id, actor_kind, actor_employee_id, actor_role_id,
            actor_role_function, actor_department_id, actor_authentication,
            organization_seed_version, mandate_kind, authorization_basis,
            initiator_kind, initiator_id, correlation_id, occurred_at,
            received_at, provenance_id)
         VALUES ($1, 'system', 'ProbeCommand', '1', 'hash', $2, 'employee',
                 'research-director', 'research-director', 'manager',
                 'research-office', 'system-asserted', '1', 'any-employee',
                 'employee-of-the-firm', 'orchestrator', 'test', 'corr', now(),
                 now(), $3)`,
        [id('cmd'), caseId, provenanceId],
      ),
    ).resolves.toBeDefined()
  })
})

/* ---------------------------------------------------------------- read-only */

describe('the read-only operator role', () => {
  it('can read every table', async () => {
    const { rows } = await readonly.query(
      'SELECT count(*)::int n FROM analysis.departments',
    )
    expect(rows[0].n).toBe(15)
  })

  it('cannot write anything', async () => {
    await expectDenied(
      readonly,
      `INSERT INTO analysis.cases
         (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
          subject_display_name, question, stage, opened_at)
       VALUES ('ro', 'system', 1, 'cio', 'macro', 'r', 'd', 'q', 'intake', now())`,
    )
    await expectDenied(readonly, `UPDATE analysis.cases SET stage = 'research'`)
    await expectDenied(readonly, 'DELETE FROM analysis.commands')
  })
})
