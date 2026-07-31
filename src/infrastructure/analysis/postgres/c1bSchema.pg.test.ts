/**
 * What migration 0014 makes impossible.
 *
 * Same dividing line as the rest of the schema suite: the database prevents
 * CORRUPTION, the domain decides POLICY. Nothing here re-implements the
 * conditional Risk rule. What is here is the set of writes that would make the
 * record untrue no matter what any application believed at the time — a
 * governance gate re-decided after the fact, a case moved onto a different
 * workflow than the one its assignments came from, a command filed under an
 * authority it never had.
 *
 * Run against real PostgreSQL as the owner, and — where the point is a grant —
 * as the runtime role.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let sql: Client
let app: Client

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  sql = db.owner
  app = await db.connectAs(APP_ROLE)
}, 180_000)

afterAll(async () => {
  await app?.end().catch(() => {})
  await db?.drop()
})

let unique = 0
const id = (prefix: string) => `${prefix}-${++unique}`

/* ------------------------------------------------------------- fixtures */

async function insertProvenance() {
  const provenanceId = id('prov')
  await sql.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ($1, 'postgres', 'v', 'test', 'catalog', '0015', '4', '2', now())`,
    [provenanceId],
  )
  return provenanceId
}

async function insertCase(stage = 'intake') {
  const caseId = id('case')
  await sql.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at)
     VALUES ($1, 'system', 1, 'research-director', 'macro-regime', 'ecb',
             'ECB path', 'Does the ECB cut?', $2, now())`,
    [caseId, stage],
  )
  return caseId
}

async function insertRevision(caseId: string) {
  const revisionId = id('rev')
  await sql.query(
    `INSERT INTO analysis.thesis_revisions
       (revision_id, thesis_id, revision_number, case_id, statement, position,
        lifecycle, invalidation_criteria, implications,
        proposed_by_department_id, proposed_by_employee_id, proposed_at,
        revision_cause)
     VALUES ($1, $2, 1, $3, 'The ECB holds', 'hold', 'proposed',
             'Core inflation below 2%', '{}', 'global-macro', 'macro-head', now(),
             'initial-proposal')`,
    [revisionId, id('thesis'), caseId],
  )
  return revisionId
}

async function insertPlaybookVersion(
  playbookId: string,
  version: string,
  contentHash: string,
) {
  await sql.query(
    `INSERT INTO analysis.playbooks (id, case_kind, name) VALUES ($1, 'macro-regime', $1)
     ON CONFLICT (id) DO NOTHING`,
    [playbookId],
  )
  await sql.query(
    `INSERT INTO analysis.playbook_versions (playbook_id, version, content_hash)
     VALUES ($1, $2, $3)`,
    [playbookId, version, contentHash],
  )
}

async function insertResolution(
  caseId: string,
  revisionId: string,
  over: Partial<{ entryKey: string; state: string; reason: string }> = {},
) {
  const provenanceId = await insertProvenance()
  await sql.query(
    `INSERT INTO analysis.requirement_resolutions
       (case_id, tenant_id, playbook_entry_key, revision_id, state,
        rule_id, rule_version, reason, input_hash, evaluated_at,
        evaluated_by_employee_id, evaluated_by_role_id, evaluated_by_role_function,
        evaluated_by_department_id, evaluated_by_department_is_governance,
        evaluated_by_department_handles, evaluated_by_authentication,
        organization_seed_version, provenance_id)
     VALUES ($1, 'system', $2, $3, $4, 'risk-review-when-implementable', '1', $5,
             'hash-of-implications', now(), 'research-director', 'research-director', 'manager',
             'research-office', false, ARRAY['aggregation'], 'system-asserted',
             '1', $6)`,
    [
      caseId,
      over.entryKey ?? 'risk-review',
      revisionId,
      over.state ?? 'required',
      over.reason ?? 'The revision declares implementation implications.',
      provenanceId,
    ],
  )
}

/* ------------------------------------------------- requirement resolutions */

describe('a recorded requirement resolution', () => {
  it('cannot be updated after the fact', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await insertResolution(caseId, revisionId)

    // Re-deciding a gate in place would rewrite what a past decision was
    // made against.
    await expect(
      sql.query(
        `UPDATE analysis.requirement_resolutions SET state = 'not-required'
         WHERE case_id = $1 AND revision_id = $2`,
        [caseId, revisionId],
      ),
    ).rejects.toThrow(/write-once/)
  })

  it('cannot be deleted', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await insertResolution(caseId, revisionId)

    await expect(
      sql.query(`DELETE FROM analysis.requirement_resolutions WHERE case_id = $1`, [
        caseId,
      ]),
    ).rejects.toThrow(/write-once/)
  })

  it('refuses a blank reason', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)

    await expect(insertResolution(caseId, revisionId, { reason: '   ' })).rejects.toThrow(
      /requirement_resolutions_reason_not_blank/,
    )
  })

  it('refuses a state outside the two evaluated ones', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)

    // `unresolved` is derived from ABSENCE. A row claiming it would make
    // "not yet evaluated" and "evaluated as pending" indistinguishable.
    await expect(
      insertResolution(caseId, revisionId, { state: 'unresolved' }),
    ).rejects.toThrow(/requirement_resolutions_state_known/)
  })

  it('holds at most one resolution per entry per exact revision', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await insertResolution(caseId, revisionId)

    await expect(insertResolution(caseId, revisionId)).rejects.toThrow(
      /requirement_resolutions_pkey/,
    )
  })

  it('lets a second revision carry its own resolution', async () => {
    const caseId = await insertCase()
    const first = await insertRevision(caseId)
    const second = await insertRevision(caseId)

    await insertResolution(caseId, first, { state: 'not-required' })
    await insertResolution(caseId, second, { state: 'required' })

    const { rows } = await sql.query(
      `SELECT state FROM analysis.requirement_resolutions
       WHERE case_id = $1 ORDER BY revision_id`,
      [caseId],
    )
    expect(rows).toHaveLength(2)
  })

  it('refuses a revision that does not exist', async () => {
    const caseId = await insertCase()
    await expect(insertResolution(caseId, 'rev-that-never-was')).rejects.toThrow(
      /requirement_resolutions_revision_id_fkey/,
    )
  })

  it('never describes its evaluator as an authenticated user', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    const provenanceId = await insertProvenance()

    await expect(
      sql.query(
        `INSERT INTO analysis.requirement_resolutions
           (case_id, tenant_id, playbook_entry_key, revision_id, state,
            rule_id, rule_version, reason, input_hash, evaluated_at,
            evaluated_by_employee_id, evaluated_by_role_id,
            evaluated_by_role_function, evaluated_by_department_id,
            evaluated_by_department_is_governance,
            evaluated_by_department_handles, evaluated_by_authentication,
            organization_seed_version, provenance_id)
         VALUES ($1, 'system', 'risk-review', $2, 'required', 'r', '1', 'why',
                 'hash', now(), 'research-director', 'research-director', 'manager',
                 'research-office', false, ARRAY['aggregation'], 'authenticated',
                 '1', $3)`,
        [caseId, revisionId, provenanceId],
      ),
    ).rejects.toThrow(/requirement_resolutions_authentication_known/)
  })

  it('gives the runtime insert and select, and nothing else', async () => {
    const { rows } = await sql.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'requirement_resolutions' AND grantee = $1
       ORDER BY privilege_type`,
      [APP_ROLE],
    )
    expect(rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT'])
  })
})

/* -------------------------------------------------------- the command ledger */

describe('the command ledger after 0014', () => {
  async function insertCommand(
    over: Partial<{
      category: string | null
      reason: string | null
      mandate: string
    }> = {},
  ) {
    const provenanceId = await insertProvenance()
    const commandId = id('cmd')
    await sql.query(
      `INSERT INTO analysis.commands
         (command_id, tenant_id, command_type, command_contract_version,
          category, reason, payload_hash, actor_kind, actor_employee_id,
          actor_role_id, actor_role_function, actor_department_id,
          actor_department_is_governance, actor_department_handles,
          actor_authentication, organization_seed_version, mandate_kind,
          mandate_discipline, authorization_basis, initiator_kind, initiator_id,
          correlation_id, occurred_at, received_at, provenance_id)
       VALUES ($1, 'system', 'ProbeCommand', '2', $2, $3, 'hash', 'employee',
               'research-director', 'research-director', 'manager',
               'research-office', false, ARRAY['aggregation'], 'system-asserted',
               '1', $4, $5, 'employee-of-the-firm', 'employee',
               'research-director', 'corr', now(), now(), $6)`,
      [
        commandId,
        over.category === undefined ? 'workflow' : over.category,
        over.reason === undefined ? null : over.reason,
        over.mandate ?? 'any-employee',
        over.mandate === 'governance-verdict' ? 'verification' : null,
        provenanceId,
      ],
    )
    return commandId
  }

  it('stores a reason and a category', async () => {
    const commandId = await insertCommand({ reason: 'Board asked for a policy view' })
    const { rows } = await sql.query(
      `SELECT reason, category FROM analysis.commands WHERE command_id = $1`,
      [commandId],
    )
    expect(rows[0]).toMatchObject({
      reason: 'Board asked for a policy view',
      category: 'workflow',
    })
  })

  it('refuses a blank reason', async () => {
    // A required explanation must not be satisfiable by the space bar.
    await expect(insertCommand({ reason: '   ' })).rejects.toThrow(
      /commands_reason_not_blank/,
    )
  })

  it('refuses a category outside the five', async () => {
    await expect(insertCommand({ category: 'vibes' })).rejects.toThrow(
      /commands_category_known/,
    )
  })

  it('refuses ordinary workflow filed as governance', async () => {
    await expect(
      insertCommand({ category: 'governance', mandate: 'any-employee' }),
    ).rejects.toThrow(/commands_category_matches_mandate/)
  })

  it('refuses a governance verdict filed as workflow', async () => {
    await expect(
      insertCommand({ category: 'workflow', mandate: 'governance-verdict' }),
    ).rejects.toThrow(/commands_category_matches_mandate/)
  })

  it('accepts a governance verdict filed as governance', async () => {
    const commandId = await insertCommand({
      category: 'governance',
      mandate: 'governance-verdict',
    })
    expect(commandId).toBeTruthy()
  })

  it('refuses a chief decision filed as anything else', async () => {
    await expect(
      insertCommand({ category: 'workflow', mandate: 'chief-decision' }),
    ).rejects.toThrow(/commands_category_matches_mandate/)
  })

  it('still refuses any edit to a recorded command', async () => {
    const commandId = await insertCommand({ reason: 'original reason' })
    await expect(
      sql.query(
        `UPDATE analysis.commands SET reason = 'rewritten' WHERE command_id = $1`,
        [commandId],
      ),
    ).rejects.toThrow(/cannot be update/)
  })
})

/* ------------------------------------------------------- the playbook pin */

describe('a case pinned to a playbook version', () => {
  /*
   * Pinning always rides along with a stage move, because a pre-existing
   * trigger requires `version` to advance on any update to a case. That is the
   * right coupling and it was already there: a case cannot acquire a workflow
   * without the aggregate version that its assignment events are stamped with
   * moving too.
   */
  const pin = (caseId: string, playbookId: string, version: string, next: number) =>
    app.query(
      `UPDATE analysis.cases
          SET playbook_id = $2, playbook_version = $3, version = $4
        WHERE id = $1`,
      [caseId, playbookId, version, next],
    )

  it('can be pinned once by the runtime role', async () => {
    const caseId = await insertCase()
    await insertPlaybookVersion('pin-once', '1', 'hash-1')

    await pin(caseId, 'pin-once', '1', 2)

    const { rows } = await sql.query(
      `SELECT playbook_id, playbook_version FROM analysis.cases WHERE id = $1`,
      [caseId],
    )
    expect(rows[0]).toMatchObject({ playbook_id: 'pin-once', playbook_version: '1' })
  })

  it('cannot be moved to another version afterwards', async () => {
    const caseId = await insertCase()
    await insertPlaybookVersion('pin-twice', '1', 'hash-1')
    await insertPlaybookVersion('pin-twice', '2', 'hash-2')

    await pin(caseId, 'pin-twice', '1', 2)

    // Its assignments came from v1; moving the case would rewrite where they
    // came from.
    await expect(pin(caseId, 'pin-twice', '2', 3)).rejects.toThrow(
      /runs to completion on the version/,
    )
  })

  it('cannot be moved to a different playbook either', async () => {
    const caseId = await insertCase()
    await insertPlaybookVersion('pin-a', '1', 'hash-a')
    await insertPlaybookVersion('pin-b', '1', 'hash-b')

    await pin(caseId, 'pin-a', '1', 2)
    await expect(pin(caseId, 'pin-b', '1', 3)).rejects.toThrow(
      /runs to completion on the version/,
    )
  })

  it('tolerates a later write repeating the same pin', async () => {
    const caseId = await insertCase()
    await insertPlaybookVersion('pin-same', '1', 'hash-1')

    await pin(caseId, 'pin-same', '1', 2)
    // A subsequent stage move carries the unchanged pin with it, and must not
    // be mistaken for a re-pin.
    await expect(pin(caseId, 'pin-same', '1', 3)).resolves.toBeTruthy()
  })

  it('still refuses to let the runtime rewrite the question', async () => {
    const caseId = await insertCase()
    await expect(
      app.query(`UPDATE analysis.cases SET question = 'something else' WHERE id = $1`, [
        caseId,
      ]),
    ).rejects.toThrow(/permission denied/)
  })
})

/* --------------------------------------------------------- playbook shape */

describe('playbook entries after 0014', () => {
  async function insertEntry(
    version: string,
    over: Partial<{ requirement: string; ruleId: string | null }> = {},
  ) {
    await insertPlaybookVersion('shape', version, `hash-${version}`)
    await sql.query(
      `INSERT INTO analysis.playbook_entries
         (playbook_id, version, entry_key, department_id, brief, requirement,
          priority, conditional_rule_id, conditional_rule_version)
       VALUES ('shape', $1, 'entry', 'global-macro', 'Do the work', $2, 1, $3, $4)`,
      [
        version,
        over.requirement ?? 'required',
        over.ruleId === undefined ? null : over.ruleId,
        over.ruleId === undefined || over.ruleId === null ? null : '1',
      ],
    )
  }

  it('accepts the three requirement levels', async () => {
    await insertEntry('r1', { requirement: 'required' })
    await insertEntry('r2', { requirement: 'optional' })
    await insertEntry('r3', {
      requirement: 'conditional',
      ruleId: 'risk-review-when-implementable',
    })

    const { rows } = await sql.query(
      `SELECT DISTINCT requirement FROM analysis.playbook_entries
       WHERE playbook_id = 'shape' ORDER BY requirement`,
    )
    expect(rows.map((r) => r.requirement)).toEqual([
      'conditional',
      'optional',
      'required',
    ])
  })

  it('refuses a fourth requirement level', async () => {
    await expect(insertEntry('r4', { requirement: 'maybe' })).rejects.toThrow(
      /playbook_entries_requirement_known/,
    )
  })

  it('refuses a conditional entry with no rule', async () => {
    await expect(insertEntry('r5', { requirement: 'conditional' })).rejects.toThrow(
      /playbook_entries_conditional_names_rule/,
    )
  })

  it('refuses a required entry that names one', async () => {
    await expect(
      insertEntry('r6', { requirement: 'required', ruleId: 'some-rule' }),
    ).rejects.toThrow(/playbook_entries_conditional_names_rule/)
  })

  it('records each dependency as exactly one kind', async () => {
    await insertPlaybookVersion('edges', '1', 'hash-edges')
    for (const key of ['a', 'b']) {
      await sql.query(
        `INSERT INTO analysis.playbook_entries
           (playbook_id, version, entry_key, department_id, brief, requirement, priority)
         VALUES ('edges', '1', $1, 'global-macro', 'work', 'required', 1)`,
        [key],
      )
    }
    await sql.query(
      `INSERT INTO analysis.playbook_entry_dependencies
         (playbook_id, version, entry_key, depends_on, kind)
       VALUES ('edges', '1', 'b', 'a', 'blocking')`,
    )

    // The primary key spans the pair, so the same edge cannot also be optional.
    await expect(
      sql.query(
        `INSERT INTO analysis.playbook_entry_dependencies
           (playbook_id, version, entry_key, depends_on, kind)
         VALUES ('edges', '1', 'b', 'a', 'optional-input')`,
      ),
    ).rejects.toThrow(/playbook_entry_dependencies_pkey/)
  })

  it('refuses an edge kind it does not recognise', async () => {
    await insertPlaybookVersion('edges2', '1', 'hash-edges2')
    for (const key of ['a', 'b']) {
      await sql.query(
        `INSERT INTO analysis.playbook_entries
           (playbook_id, version, entry_key, department_id, brief, requirement, priority)
         VALUES ('edges2', '1', $1, 'global-macro', 'work', 'required', 1)`,
        [key],
      )
    }
    await expect(
      sql.query(
        `INSERT INTO analysis.playbook_entry_dependencies
           (playbook_id, version, entry_key, depends_on, kind)
         VALUES ('edges2', '1', 'b', 'a', 'sort-of')`,
      ),
    ).rejects.toThrow(/playbook_entry_dependency_kind_known/)
  })

  it('requires every registered version to carry a content hash', async () => {
    await sql.query(
      `INSERT INTO analysis.playbooks (id, case_kind, name) VALUES ('nohash', 'k', 'n')
       ON CONFLICT (id) DO NOTHING`,
    )
    await expect(
      sql.query(
        `INSERT INTO analysis.playbook_versions (playbook_id, version)
         VALUES ('nohash', '1')`,
      ),
    ).rejects.toThrow(/content_hash/)
  })
})

/* ------------------------------------------------------ thesis implications */

describe('a thesis revision’s declared implications', () => {
  it('round-trips a declared set', async () => {
    const caseId = await insertCase()
    const revisionId = id('rev')
    await sql.query(
      `INSERT INTO analysis.thesis_revisions
         (revision_id, thesis_id, revision_number, case_id, statement, position,
          lifecycle, invalidation_criteria, implications,
          proposed_by_department_id, proposed_by_employee_id, proposed_at,
            revision_cause)
       VALUES ($1, $2, 1, $3, 's', 'buy', 'proposed', 'crit',
               ARRAY['hedging','position-sizing'], 'global-macro', 'macro-head', now(), 'initial-proposal')`,
      [revisionId, id('thesis'), caseId],
    )

    const { rows } = await sql.query(
      `SELECT implications FROM analysis.thesis_revisions WHERE revision_id = $1`,
      [revisionId],
    )
    expect(rows[0]!.implications).toEqual(['hedging', 'position-sizing'])
  })

  it('refuses an implication outside the closed vocabulary', async () => {
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, case_id, statement, position,
            lifecycle, invalidation_criteria, implications,
            proposed_by_department_id, proposed_by_employee_id, proposed_at,
            revision_cause)
         VALUES ($1, $2, 1, $3, 's', 'buy', 'proposed', 'crit',
                 ARRAY['vibes'], 'global-macro', 'macro-head', now(), 'initial-proposal')`,
        [id('rev'), id('thesis'), caseId],
      ),
    ).rejects.toThrow(/thesis_revisions_implications_known/)
  })

  it('has no default, so a writer must state it', async () => {
    const caseId = await insertCase()
    // An empty declaration is a decision. A missing one must not look like it.
    await expect(
      sql.query(
        `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, case_id, statement, position,
            lifecycle, invalidation_criteria,
            proposed_by_department_id, proposed_by_employee_id, proposed_at)
         VALUES ($1, $2, 1, $3, 's', 'buy', 'proposed', 'crit',
                 'global-macro', 'macro-head', now())`,
        [id('rev'), id('thesis'), caseId],
      ),
    ).rejects.toThrow(/implications/)
  })
})
