/**
 * The invariants the database enforces itself.
 *
 * The dividing line these tests police: the database prevents CORRUPTION, the
 * domain decides POLICY. Nothing here re-implements whether a gate passes or
 * whether a thesis is eligible — those live in one place, in the domain. What
 * is here is the set of writes that would make the record untrue no matter
 * what any application believed at the time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { mkdtempSync, copyFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTestDatabase, type TestDatabase } from './testDatabase'
import { migrate } from './migrations'
import { toDevilsAdvocate } from './mapping'
import type { ChallengeRow, ReviewRow } from './rows'

let db: TestDatabase
let sql: Client

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  sql = db.owner
})
afterAll(async () => {
  await db.drop()
})

/* ------------------------------------------------------------- fixtures */

let unique = 0
const id = (prefix: string) => `${prefix}-${++unique}`

async function insertCase(
  overrides: Partial<{
    id: string
    tenant: string
    version: number
    owner: string
    stage: string
    closedAt: string | null
  }> = {},
) {
  const caseId = overrides.id ?? id('case')
  await sql.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at, closed_at)
     VALUES ($1, $2, $3, $4, 'macro', 'regime', 'Policy regime',
             'Is the policy path mispriced?', $5, now(), $6)`,
    [
      caseId,
      overrides.tenant ?? 'system',
      overrides.version ?? 1,
      overrides.owner ?? 'research-director',
      overrides.stage ?? 'intake',
      overrides.closedAt ?? null,
    ],
  )
  return caseId
}

async function insertEvidenceSet(client: Client = sql) {
  const setId = id('set')
  await client.query(
    `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
     VALUES ($1, now(), 'corr', '{"kind":"empty"}'::jsonb)`,
    [setId],
  )
  return setId
}

async function insertRevision(
  caseId: string,
  overrides: Partial<{
    revisionId: string
    thesisId: string
    number: number
    supersedes: string | null
    lifecycle: string
    reason: string | null
  }> = {},
) {
  const revisionId = overrides.revisionId ?? id('rev')
  await sql.query(
    `INSERT INTO analysis.thesis_revisions
       (revision_id, thesis_id, revision_number, supersedes_revision_id, case_id,
        statement, position, lifecycle, invalidation_criteria, implications,
        proposed_by_department_id, proposed_by_employee_id, proposed_at,
        revision_reason, revision_cause)
     VALUES ($1, $2, $3, $4, $5, 'The policy path is mispriced', 'buy', $6,
             'The curve reprices above 4%', '{}', 'global-macro', 'macro-head',
             now(), $7,
             CASE WHEN $3::int = 1 THEN 'initial-proposal' ELSE 'correction' END)`,
    [
      revisionId,
      overrides.thesisId ?? id('thesis'),
      overrides.number ?? 1,
      overrides.supersedes ?? null,
      caseId,
      overrides.lifecycle ?? 'proposed',
      overrides.reason ?? null,
    ],
  )
  return revisionId
}

/**
 * A registered playbook entry and a provenance row.
 *
 * Both became foreign keys on `runs` in 0015: a run says which step of which
 * workflow version produced the work, and which code stored it. Shared here so
 * every raw-SQL run fixture gets the same honest provenance.
 */
let executionSeeded = false
/** `client` defaults to the suite's database; the migration test passes its own. */
async function seedExecutionRefs(client: Client = sql) {
  if (client === sql && executionSeeded) return
  await client.query(
    `INSERT INTO analysis.playbooks (id, case_kind, name)
     VALUES ('schema-test', 'macro', 'Schema test playbook')
     ON CONFLICT (id) DO NOTHING`,
  )
  await client.query(
    `INSERT INTO analysis.playbook_versions (playbook_id, version, content_hash)
     VALUES ('schema-test', '1', 'hash')
     ON CONFLICT DO NOTHING`,
  )
  await client.query(
    `INSERT INTO analysis.playbook_entries
       (playbook_id, version, entry_key, department_id, brief, requirement, priority)
     VALUES ('schema-test', '1', 'entry', 'global-macro', 'Regime read', 'required', 5)
     ON CONFLICT DO NOTHING`,
  )
  await client.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ('schema-test-prov', 'postgres', 'v', 'test', 'catalog', '0015',
             '4', '2', now())
     ON CONFLICT (id) DO NOTHING`,
  )
  executionSeeded = true
}

async function insertRun(caseId: string, client: Client = sql) {
  const assignmentId = id('assignment')
  await client.query(
    `INSERT INTO analysis.assignments
       (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
     VALUES ($1, $2, 'system', 'global-macro', 'Regime read', 'queued', 5, now())`,
    [assignmentId, caseId],
  )
  const runId = id('run')
  await seedExecutionRefs(client)
  await client.query(
    `INSERT INTO analysis.runs
       (id, case_id, tenant_id, assignment_id, department_id, employee_id, state,
        agent_contract_version, output_schema_version,
        identity_kind, prompt_id, prompt_version,
        prompt_content_hash, model_id, model_provider, model_parameters_hash,
        usage_state, evidence_set_id, started_at,
        playbook_id, playbook_version, playbook_entry_key,
        provider_id, provider_version, provider_kind, missing_optional_inputs,
        provenance_id,
        budget_tokens_kind, budget_cost_kind, budget_deadline_kind)
     VALUES ($1, $2, 'system', $3, 'global-macro', 'macro-head', 'running',
             '1', '1', 'model', 'p', '1', 'ph', 'm', 'anthropic', 'mh',
             'not-applicable', $4, now(),
             'schema-test', '1', 'entry',
             'recorded-provider', '1', 'recorded', '{}', 'schema-test-prov',
             -- Recorded work cannot spend tokens or money; no deadline was set.
             'not-applicable', 'not-applicable', 'not-measured')`,
    [runId, caseId, assignmentId, await insertEvidenceSet(client)],
  )
  return { assignmentId, runId }
}

async function insertClaim(caseId: string, runId: string, client: Client = sql) {
  const claimId = id('claim')
  await client.query(
    `INSERT INTO analysis.claims
       (id, case_id, tenant_id, run_id, type, statement, status,
        confidence_level, temporal_as_of)
     VALUES ($1, $2, 'system', $3, 'observation', 'The 10y is at 4.1%',
             'supported', 'high', now())`,
    [claimId, caseId, runId],
  )
  return claimId
}

/* ---------------------------------------------------- organization identity */

describe('the organization', () => {
  it('refuses a duplicate department identifier', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.departments (id, tenant_id, name, manager_employee_id, is_governance)
         VALUES ('global-macro', 'system', 'Duplicate', 'macro-head', false)`,
      ),
    ).rejects.toThrow(/duplicate key|already exists/i)
  })

  it('refuses a department managed by someone in another department', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.departments (id, tenant_id, name, manager_employee_id, is_governance)
         VALUES ('credit-research', 'system', 'Credit Research', 'macro-head', false)`,
      ),
    ).rejects.toThrow(/belongs to department/)
  })

  it('accepts a department the codebase has never heard of', async () => {
    // The practical test of the whole design: a new asset class is data.
    await sql.query('BEGIN')
    await sql.query(
      `INSERT INTO analysis.departments (id, tenant_id, name, manager_employee_id, is_governance)
       VALUES ('esg-research', 'system', 'ESG Research', 'esg-head', false)`,
    )
    await sql.query(
      `INSERT INTO analysis.employees (id, display_name, role_id, department_id, reports_to, seniority)
       VALUES ('esg-head', 'Head of ESG', 'head-of-macro', 'esg-research', 'cio', 'head')`,
    )
    await sql.query(
      `INSERT INTO analysis.department_handles (department_id, discipline)
       VALUES ('esg-research', 'esg')`,
    )
    await expect(sql.query('COMMIT')).resolves.toBeDefined()
  })

  it('refuses an employee reporting to someone who does not exist', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.employees (id, display_name, role_id, department_id, reports_to, seniority)
         VALUES ('ghost', 'Ghost', 'head-of-macro', 'global-macro', 'nobody', 'analyst')`,
      ),
    ).rejects.toThrow(/violates foreign key/)
  })

  it('refuses an employee reporting to themselves', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.employees (id, display_name, role_id, department_id, reports_to, seniority)
         VALUES ('loop', 'Loop', 'head-of-macro', 'global-macro', 'loop', 'analyst')`,
      ),
    ).rejects.toThrow(/employees_no_self_report/)
  })

  it('refuses a specialist that can block publication', async () => {
    // A desk cannot grant itself a veto.
    await expect(
      sql.query(
        `INSERT INTO analysis.roles (id, title, function, can_block_publication)
         VALUES ('rogue', 'Rogue Analyst', 'specialist', true)`,
      ),
    ).rejects.toThrow(/roles_only_governance_blocks/)
  })

  it('refuses a governance role that cannot block publication', async () => {
    // One that cannot block is advisory, not a control function.
    await expect(
      sql.query(
        `INSERT INTO analysis.roles (id, title, function, can_block_publication)
         VALUES ('toothless', 'Advisory Reviewer', 'governance', false)`,
      ),
    ).rejects.toThrow(/roles_only_governance_blocks/)
  })

  it('seeds the four control functions as governance departments', async () => {
    const { rows } = await sql.query<{ id: string }>(
      `SELECT id FROM analysis.departments WHERE is_governance ORDER BY id`,
    )
    expect(rows.map((r) => r.id)).toEqual([
      'compliance',
      'devils-advocate',
      'risk',
      'verification',
    ])
  })

  it('has every governance department reporting to the chief', async () => {
    // Independence: a control inside the reporting line of what it reviews is
    // not a control.
    const { rows } = await sql.query<{ id: string; reports_to: string }>(
      `SELECT e.id, e.reports_to
       FROM analysis.employees e
       JOIN analysis.departments d ON d.manager_employee_id = e.id
       WHERE d.is_governance`,
    )
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row.reports_to).toBe('cio')
  })
})

/* ------------------------------------------------------ tenant and owner */

describe('tenant and owner', () => {
  it('refuses a case with no owner', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.cases
           (id, tenant_id, version, subject_kind, subject_ref, subject_display_name,
            question, stage, opened_at)
         VALUES ('ownerless', 'system', 1, 'macro', 'r', 'd', 'q', 'intake', now())`,
      ),
    ).rejects.toThrow(/owner_employee_id.*null|null value/i)
  })

  it('refuses a case with no tenant', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.cases
           (id, version, owner_employee_id, subject_kind, subject_ref,
            subject_display_name, question, stage, opened_at)
         VALUES ('tenantless', 1, 'cio', 'macro', 'r', 'd', 'q', 'intake', now())`,
      ),
    ).rejects.toThrow(/tenant_id.*null|null value/i)
  })

  it('refuses a case whose tenant does not exist', async () => {
    await expect(insertCase({ tenant: 'not-a-tenant' })).rejects.toThrow(
      /violates foreign key/,
    )
  })

  it('refuses a child record claiming a different tenant from its case', async () => {
    // The composite foreign key: a denormalized tenant that could disagree
    // with its case would be worse than no tenant column at all.
    const caseId = await insertCase()
    await sql.query(`INSERT INTO analysis.tenants (id, name) VALUES ('other', 'Other')`)

    await expect(
      sql.query(
        `INSERT INTO analysis.assignments
           (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
         VALUES ($1, $2, 'other', 'global-macro', 'b', 'queued', 1, now())`,
        [id('assignment'), caseId],
      ),
    ).rejects.toThrow(/violates foreign key/)
  })

  it('refuses a case closed while still open, and an open case with a closing time', async () => {
    await expect(insertCase({ stage: 'published', closedAt: null })).rejects.toThrow(
      /cases_closed_iff_terminal/,
    )
    await expect(
      insertCase({ stage: 'research', closedAt: new Date().toISOString() }),
    ).rejects.toThrow(/cases_closed_iff_terminal/)
  })
})

/* ----------------------------------------------------------- case version */

describe('case versions only advance', () => {
  it('accepts an advancing version', async () => {
    const caseId = await insertCase({ version: 1 })
    await sql.query('UPDATE analysis.cases SET version = 2, stage = $2 WHERE id = $1', [
      caseId,
      'research',
    ])
    const { rows } = await sql.query('SELECT version FROM analysis.cases WHERE id = $1', [
      caseId,
    ])
    expect(rows[0].version).toBe(2)
  })

  it('refuses a version moving backwards', async () => {
    // Optimistic concurrency compares the version the caller read. A lower
    // version makes every later comparison wrong and silently reopens the race.
    const caseId = await insertCase({ version: 5 })
    await expect(
      sql.query('UPDATE analysis.cases SET version = 4 WHERE id = $1', [caseId]),
    ).rejects.toThrow(/versions only advance/)
  })

  it('refuses a version standing still', async () => {
    const caseId = await insertCase({ version: 5 })
    await expect(
      sql.query('UPDATE analysis.cases SET version = 5, stage = $2 WHERE id = $1', [
        caseId,
        'research',
      ]),
    ).rejects.toThrow(/versions only advance/)
  })
})

/* -------------------------------------------------------- thesis lineage */

describe('thesis lineage', () => {
  it('refuses two revisions with the same number in one lineage', async () => {
    const caseId = await insertCase()
    const thesisId = id('thesis')
    await insertRevision(caseId, { thesisId, number: 1 })
    await expect(insertRevision(caseId, { thesisId, number: 1 })).rejects.toThrow(
      /thesis_revisions_number_unique/,
    )
  })

  it('refuses a duplicate revision identity', async () => {
    const caseId = await insertCase()
    const revisionId = id('rev')
    await insertRevision(caseId, { revisionId })
    await expect(insertRevision(caseId, { revisionId })).rejects.toThrow(/duplicate key/)
  })

  it('refuses revision 1 that supersedes something', async () => {
    const caseId = await insertCase()
    const first = await insertRevision(caseId)
    await expect(
      insertRevision(caseId, { number: 1, supersedes: first }),
    ).rejects.toThrow(/thesis_revisions_lineage_links/)
  })

  it('refuses revision 2 that supersedes nothing — a lineage with a hole', async () => {
    const caseId = await insertCase()
    const thesisId = id('thesis')
    await insertRevision(caseId, { thesisId, number: 1 })
    await expect(
      insertRevision(caseId, {
        thesisId,
        number: 2,
        supersedes: null,
        reason: 'new data',
      }),
    ).rejects.toThrow(/thesis_revisions_lineage_links/)
  })

  it('refuses a revision after the first that gives no reason', async () => {
    const caseId = await insertCase()
    const thesisId = id('thesis')
    const first = await insertRevision(caseId, { thesisId, number: 1 })
    await expect(
      insertRevision(caseId, { thesisId, number: 2, supersedes: first, reason: '  ' }),
    ).rejects.toThrow(/thesis_revisions_reason_after_first/)
  })

  it('refuses a thesis with no invalidation criteria', async () => {
    // A thesis that cannot be wrong is a preference.
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, case_id, statement, position,
            lifecycle, invalidation_criteria, implications,
            proposed_by_department_id, proposed_by_employee_id, proposed_at,
            revision_cause)
         VALUES ($1, $2, 1, $3, 's', 'buy', 'proposed', '   ', '{}',
                 'global-macro', 'macro-head', now(), 'initial-proposal')`,
        [id('rev'), id('thesis'), caseId],
      ),
    ).rejects.toThrow(/thesis_revisions_invalidation_not_blank/)
  })
})

/* --------------------------------------------------- revision immutability */

describe('a sealed thesis revision', () => {
  it('permits its lifecycle to move', async () => {
    // Marking a revision superseded is a legitimate write to an old row.
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await sql.query(
      `UPDATE analysis.thesis_revisions SET lifecycle = 'superseded' WHERE revision_id = $1`,
      [revisionId],
    )
    const { rows } = await sql.query(
      'SELECT lifecycle FROM analysis.thesis_revisions WHERE revision_id = $1',
      [revisionId],
    )
    expect(rows[0].lifecycle).toBe('superseded')
  })

  it('refuses an edit to its statement', async () => {
    // The reason the whole revision design exists: a review reviewed a
    // specific argument, and an editable argument makes its reviews
    // meaningless.
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await expect(
      sql.query(
        `UPDATE analysis.thesis_revisions SET statement = 'Something else' WHERE revision_id = $1`,
        [revisionId],
      ),
    ).rejects.toThrow(/is sealed/)
  })

  it('refuses an edit to its position and to its invalidation criteria', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await expect(
      sql.query(
        `UPDATE analysis.thesis_revisions SET position = 'sell' WHERE revision_id = $1`,
        [revisionId],
      ),
    ).rejects.toThrow(/is sealed/)
    await expect(
      sql.query(
        `UPDATE analysis.thesis_revisions SET invalidation_criteria = 'nothing' WHERE revision_id = $1`,
        [revisionId],
      ),
    ).rejects.toThrow(/is sealed/)
  })
})

/* ------------------------------------------------------------ assignments */

describe('assignments', () => {
  it('refuses two assignments for the same case and playbook entry', async () => {
    // A retried "open case" command must not give a department the same work
    // twice.
    const caseId = await insertCase()
    await sql.query(
      `INSERT INTO analysis.assignments
         (id, case_id, tenant_id, department_id, playbook_entry_key, brief, status, priority, created_at)
       VALUES ($1, $2, 'system', 'global-macro', 'macro-analysis', 'b', 'queued', 5, now())`,
      [id('assignment'), caseId],
    )
    await expect(
      sql.query(
        `INSERT INTO analysis.assignments
           (id, case_id, tenant_id, department_id, playbook_entry_key, brief, status, priority, created_at)
         VALUES ($1, $2, 'system', 'global-macro', 'macro-analysis', 'b', 'queued', 5, now())`,
        [id('assignment'), caseId],
      ),
    ).rejects.toThrow(/assignments_case_playbook_entry_unique/)
  })

  it('permits several ad-hoc assignments on one case', async () => {
    const caseId = await insertCase()
    for (let i = 0; i < 2; i++) {
      await sql.query(
        `INSERT INTO analysis.assignments
           (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
         VALUES ($1, $2, 'system', 'risk', 'ad hoc', 'queued', 1, now())`,
        [id('assignment'), caseId],
      )
    }
    const { rows } = await sql.query(
      'SELECT count(*)::int n FROM analysis.assignments WHERE case_id = $1',
      [caseId],
    )
    expect(rows[0].n).toBe(2)
  })

  it('refuses a waiting assignment that does not say on what', async () => {
    // An unexplained wait is indistinguishable from a stall.
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.assignments
           (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
         VALUES ($1, $2, 'system', 'global-macro', 'b', 'waiting', 1, now())`,
        [id('assignment'), caseId],
      ),
    ).rejects.toThrow(/assignments_waiting_says_on_what/)
  })

  it('refuses a returned assignment with no reason', async () => {
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.assignments
           (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
         VALUES ($1, $2, 'system', 'global-macro', 'b', 'returned', 1, now())`,
        [id('assignment'), caseId],
      ),
    ).rejects.toThrow(/assignments_returned_with_reason/)
  })
})

/* ----------------------------------------------------------------- claims */

describe('claims', () => {
  it('refuses a causal claim with no attribution', async () => {
    // An agent may quote, cite, or hedge — it may not assert a mechanism as
    // established fact.
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    await expect(
      sql.query(
        `INSERT INTO analysis.claims
           (id, case_id, tenant_id, run_id, type, statement, status, confidence_level, temporal_as_of)
         VALUES ($1, $2, 'system', $3, 'causal', 'Rates fell because of the ECB',
                 'supported', 'high', now())`,
        [id('claim'), caseId, runId],
      ),
    ).rejects.toThrow(/claims_causal_has_attribution/)
  })

  it('refuses a forecast with no horizon', async () => {
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    await expect(
      sql.query(
        `INSERT INTO analysis.claims
           (id, case_id, tenant_id, run_id, type, statement, status, confidence_level, temporal_as_of)
         VALUES ($1, $2, 'system', $3, 'forecast', 'Rates fall', 'supported', 'low', now())`,
        [id('claim'), caseId, runId],
      ),
    ).rejects.toThrow(/claims_horizon_where_required/)
  })

  it('refuses a citation of an observation the evidence set never contained', async () => {
    // A dangling citation is the Fact Checker's primary finding, and it should
    // not be possible to record one in the first place.
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const setId = await insertEvidenceSet()

    await expect(
      sql.query(
        `INSERT INTO analysis.claim_evidence
           (claim_id, evidence_set_id, observation_id, content_hash, stance)
         VALUES ($1, $2, 'never-in-this-set', 'h', 'supporting')`,
        [claimId, setId],
      ),
    ).rejects.toThrow(/violates foreign key/)
  })
})

/* ------------------------------------------------------------- governance */

describe('governance records', () => {
  it('refuses a review whose case does not exist', async () => {
    await expect(
      sql.query(
        `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, status, sequence)
         VALUES ($1, 'verification', 'case', 'no-such-case', 'system', 'verification-head',
                 'verification', now(), 'verified', 1)`,
        [id('review')],
      ),
    ).rejects.toThrow(/violates foreign key/)
  })

  it('refuses a compliance status on a risk review', async () => {
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, status, sequence)
         VALUES ($1, 'risk', 'case', $2, 'system', 'chief-risk-officer', 'risk', now(), 'approved', 1)`,
        [id('review'), caseId],
      ),
    ).rejects.toThrow(/reviews_status_matches_kind/)
  })

  it('refuses the same verdict recorded twice', async () => {
    // Recording a review twice would double-count it in the gate.
    const caseId = await insertCase()
    const at = new Date().toISOString()
    const insert = (reviewId: string) =>
      sql.query(
        `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, thesis_id, by_employee_id, by_department_id, at, status, sequence)
         VALUES ($1, 'verification', 'case', $2, 'system', NULL, 'verification-head',
                 'verification', $3, 'verified', 1)`,
        [reviewId, caseId, at],
      )

    await insert(id('review'))
    // NULLS NOT DISTINCT: two case-wide verdicts from one reviewer at one
    // instant are a replay, not two opinions.
    await expect(insert(id('review'))).rejects.toThrow(/reviews_natural_key_unique/)
  })

  it('refuses a challenge that cites no counter-evidence', async () => {
    // The Devil's Advocate argues from evidence. Disagreement alone is not a
    // finding.
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const reviewId = id('review')
    await sql.query(
      `INSERT INTO analysis.reviews
         (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, sequence)
       VALUES ($1, 'devils-advocate', 'case', $2, 'system', 'devils-advocate-head',
               'devils-advocate', now(), 1)`,
      [reviewId, caseId],
    )

    await sql.query('BEGIN')
    await sql.query(
      /* Provenance is NOT NULL since 0034; the columns are incidental here. */
      `INSERT INTO analysis.challenges (id, review_id, contests_claim_id, kind, argument, materiality,
                                        challenger_kind, by_department_id)
       VALUES ($1, $2, $3, 'contradicting-evidence', 'The number is wrong', 'material',
               'devils-advocate', 'devils-advocate')`,
      [id('challenge'), reviewId, claimId],
    )
    await expect(sql.query('COMMIT')).rejects.toThrow(/cites no counter-evidence/)
    await sql.query('ROLLBACK').catch(() => {})
  })

  it('permits a challenge to the reasoning without counter-evidence', async () => {
    // `fragile-assumption` and `overconfidence` contest the reasoning rather
    // than the facts, and legitimately cite nothing.
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const reviewId = id('review')
    await sql.query(
      `INSERT INTO analysis.reviews
         (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, sequence)
       VALUES ($1, 'devils-advocate', 'case', $2, 'system', 'devils-advocate-head',
               'devils-advocate', now(), 1)`,
      [reviewId, caseId],
    )
    await expect(
      sql.query(
        `INSERT INTO analysis.challenges (id, review_id, contests_claim_id, kind, argument, materiality,
                                          would_be_resolved_by, challenger_kind, by_department_id)
         VALUES ($1, $2, $3, 'fragile-assumption', 'This assumes no fiscal shock', 'material',
                 'A fiscal impulse estimate', 'devils-advocate', 'devils-advocate')`,
        [id('challenge'), reviewId, claimId],
      ),
    ).resolves.toBeDefined()
  })

  it('refuses a verification finding against a claim that does not exist', async () => {
    const caseId = await insertCase()
    const reviewId = id('review')
    await sql.query(
      `INSERT INTO analysis.reviews
         (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, status, sequence)
       VALUES ($1, 'verification', 'case', $2, 'system', 'verification-head', 'verification',
               now(), 'correction-required', 1)`,
      [reviewId, caseId],
    )
    await expect(
      sql.query(
        `INSERT INTO analysis.verification_findings
           (id, review_id, kind, claim_id, detail, blocking, severity,
            correction_required)
         VALUES ($1, $2, 'value-mismatch', 'no-such-claim', 'wrong', true,
                 'critical', 'restate the number')`,
        [id('finding'), reviewId],
      ),
    ).rejects.toThrow(/violates foreign key/)
  })
})

/* -------------------------------------------------------------- decisions */

/*
 * The decision-shape tests moved to `c1d1Schema.pg.test.ts` with the shape
 * itself. Migration 0020 restructured `case_decisions`: the key is the decision
 * rather than the case, an outcome kind is required, and the `governance`
 * document whose compliance field had to be invented is gone.
 */

describe('append-only and write-once records', () => {
  it('refuses an event that stalls without a reason', async () => {
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.transition_events
           (event_id, subject, case_id, tenant_id, from_state, to_state, occurred_at,
            correlation_id, aggregate_version)
         VALUES ($1, 'case', $2, 'system', 'review', 'blocked', now(), 'corr', 2)`,
        [id('event'), caseId],
      ),
      // Two CHECKs reject this row — no reason, and no actor. PostgreSQL
      // reports whichever it evaluates first, and which one speaks is not the
      // property under test.
    ).rejects.toThrow(/violates check constraint/)
  })

  it('refuses an event that corrects itself', async () => {
    const caseId = await insertCase()
    const eventId = id('event')
    await expect(
      sql.query(
        `INSERT INTO analysis.transition_events
           (event_id, subject, case_id, tenant_id, from_state, to_state, occurred_at,
            correlation_id, aggregate_version, corrects)
         VALUES ($1, 'case', $2, 'system', NULL, 'intake', now(), 'corr', 1, $1)`,
        [eventId, caseId],
      ),
    ).rejects.toThrow(/transition_events_not_correcting_itself/)
  })

  it('refuses a duplicate content-addressed result key', async () => {
    // A stored result names what produced it, so the fixture has to as well.
    await seedExecutionRefs()
    const key = id('result')
    const insert = () =>
      sql.query(
        `INSERT INTO analysis.agent_results
           (key, claims, stored_at, inputs, provider_kind, provenance_id)
         VALUES ($1, '[]'::jsonb, now(), '{}'::jsonb, 'recorded', $2)`,
        [key, 'schema-test-prov'],
      )
    await insert()
    await expect(insert()).rejects.toThrow(/duplicate key/)
  })

  it('deduplicates evidence sets by content address', async () => {
    // Two cases assembled from the same observations share one row.
    const setId = id('set')
    const insert = () =>
      sql.query(
        `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
         VALUES ($1, now(), 'corr', '{"kind":"empty"}'::jsonb)`,
        [setId],
      )
    await insert()
    await expect(insert()).rejects.toThrow(/duplicate key/)
  })
})

/* =================================================== challenge provenance = */

/**
 * Migration 0034 gave a challenge two new facts: under whose mandate it was
 * filed, and by which desk.
 *
 * Everything the Boardroom will read — was this conclusion challenged, and was
 * it challenged by someone who knows the subject — rests on those two columns,
 * so they have to survive a round trip exactly rather than approximately.
 *
 * These sit beside the other schema tests because they reuse the same
 * case -> assignment -> run -> claim seed chain. A second file would have meant
 * a second copy of a fixture that already exists.
 */

/**
 * The peer challenger, chosen from departments the firm actually has.
 *
 * `quant-technical` rather than `rates`: Half A proves that a GENERIC peer
 * challenge is durable, and it must not depend on an organisation change that
 * has not been ruled. The foreign key rejecting `rates` is the barrier working
 * — a department is a seat the firm holds, not a label that satisfies a
 * constraint.
 */
const PEER_DEPARTMENT = 'quant-technical'

async function seedReviewBy(caseId: string, departmentId: string) {
  const reviewId = id('review')
  await sql.query(
    `INSERT INTO analysis.reviews
       (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, sequence)
     VALUES ($1, 'devils-advocate', 'case', $2, 'system', 'devils-advocate-head', $3, now(), 1)`,
    [reviewId, caseId, departmentId],
  )
  return reviewId
}

async function insertProvenancedChallenge(args: {
  reviewId: string
  claimId: string
  challengerKind: string
  byDepartmentId: string
}) {
  const challengeId = id('challenge')
  await sql.query(
    `INSERT INTO analysis.challenges
       (id, review_id, contests_claim_id, kind, argument, materiality,
        would_be_resolved_by, outcome, challenger_kind, by_department_id)
     VALUES ($1, $2, $3, 'fragile-assumption',
             'The attribution assumes growth rather than real-rate repricing',
             'material', 'A decomposition of the move', 'open', $4, $5)`,
    [challengeId, args.reviewId, args.claimId, args.challengerKind, args.byDepartmentId],
  )
  return challengeId
}

/** Reads a challenge back the way the adapter does: row -> domain. */
async function reloadChallenge(reviewId: string, challengeId: string) {
  const reviews = await sql.query<ReviewRow>(
    `SELECT * FROM analysis.reviews WHERE id = $1`,
    [reviewId],
  )
  const rows = await sql.query<ChallengeRow>(
    `SELECT * FROM analysis.challenges WHERE id = $1`,
    [challengeId],
  )
  /*
   * `at` normalised to the ISO text the domain stores.
   *
   * The production pool registers per-pool type parsers that leave timestamps
   * as text; this suite's raw client does not, so `pg` hands back a `Date`.
   * `seal` then refuses it — correctly, because a mutable Date cannot be frozen
   * against in-place change. The mapper is right and the test client was wrong.
   */
  const row = reviews.rows[0]!
  /* Typed `string`; this client hands back a Date at runtime. */
  const rawAt = row.at as unknown
  const at = rawAt instanceof Date ? rawAt.toISOString() : row.at
  const review = toDevilsAdvocate({ ...row, at }, rows.rows, [])
  return review.challenges.find((c) => c.id === challengeId)!
}

describe('challenge provenance survives persistence', () => {
  it('round-trips a peer challenge filed by Rates', async () => {
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const reviewId = await seedReviewBy(caseId, PEER_DEPARTMENT)
    const challengeId = await insertProvenancedChallenge({
      reviewId,
      claimId,
      challengerKind: 'peer',
      byDepartmentId: PEER_DEPARTMENT,
    })

    const challenge = await reloadChallenge(reviewId, challengeId)
    expect(challenge.id).toBe(challengeId)
    expect(challenge.contests).toBe(claimId)
    expect(challenge.challengerKind).toBe('peer')
    expect(challenge.byDepartmentId).toBe(PEER_DEPARTMENT)
    expect(challenge.kind).toBe('fragile-assumption')
    expect(challenge.materiality).toBe('material')
    expect(challenge.wouldBeResolvedBy).toBe('A decomposition of the move')
  })

  it('keeps the two mandates distinguishable after reload', async () => {
    /*
     * The whole point of the distinction. If these reloaded identically the
     * firm could report that a conclusion "survived scrutiny" when only the
     * desk whose job is to object had objected.
     */
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const peerReview = await seedReviewBy(caseId, PEER_DEPARTMENT)
    const daReview = await seedReviewBy(caseId, 'devils-advocate')
    const peerId = await insertProvenancedChallenge({
      reviewId: peerReview,
      claimId,
      challengerKind: 'peer',
      byDepartmentId: PEER_DEPARTMENT,
    })
    const daId = await insertProvenancedChallenge({
      reviewId: daReview,
      claimId,
      challengerKind: 'devils-advocate',
      byDepartmentId: 'devils-advocate',
    })

    const peer = await reloadChallenge(peerReview, peerId)
    const devilsAdvocate = await reloadChallenge(daReview, daId)
    expect(peer.challengerKind).toBe('peer')
    expect(devilsAdvocate.challengerKind).toBe('devils-advocate')
    expect(peer.byDepartmentId).not.toBe(devilsAdvocate.byDepartmentId)
  })

  it('refuses an unknown challenger mandate', async () => {
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const reviewId = await seedReviewBy(caseId, PEER_DEPARTMENT)
    await expect(
      insertProvenancedChallenge({
        reviewId,
        claimId,
        challengerKind: 'referee',
        byDepartmentId: PEER_DEPARTMENT,
      }),
    ).rejects.toThrow(/challenges_challenger_kind_known/)
  })

  it('refuses a department the firm does not have', async () => {
    /*
     * Without the foreign key a misspelled desk would persist as a
     * valid-looking act, and the mapper would faithfully reconstruct an
     * objection from a department that does not exist.
     */
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const reviewId = await seedReviewBy(caseId, PEER_DEPARTMENT)
    await expect(
      insertProvenancedChallenge({
        reviewId,
        claimId,
        challengerKind: 'peer',
        byDepartmentId: 'rats-desk',
      }),
    ).rejects.toThrow(/challenges_by_department_fk/)
  })

  it('refuses a challenge carrying no provenance at all', async () => {
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const reviewId = await seedReviewBy(caseId, PEER_DEPARTMENT)
    await expect(
      sql.query(
        `INSERT INTO analysis.challenges
           (id, review_id, contests_claim_id, kind, argument, materiality, would_be_resolved_by)
         VALUES ($1, $2, $3, 'fragile-assumption', 'no provenance', 'material', 'x')`,
        [id('challenge'), reviewId, claimId],
      ),
    ).rejects.toThrow(/null value|not-null/i)
  })

  it('does not let a re-filed verdict rewrite who raised the objection', async () => {
    /*
     * Re-filing may settle an objection; it may never change who raised it or
     * under whose mandate. `saveChallenge`'s DO UPDATE set omits both columns,
     * and this is the behaviour that omission buys.
     */
    const caseId = await insertCase()
    const { runId } = await insertRun(caseId)
    const claimId = await insertClaim(caseId, runId)
    const reviewId = await seedReviewBy(caseId, PEER_DEPARTMENT)
    const challengeId = await insertProvenancedChallenge({
      reviewId,
      claimId,
      challengerKind: 'peer',
      byDepartmentId: PEER_DEPARTMENT,
    })
    await sql.query(
      /*
       * `resolved_by` is required once the outcome leaves 'open' — a
       * pre-existing invariant (`challenges_resolved_names_resolver`), and the
       * re-filed verdict here settles the objection, so it names a resolver.
       */
      `INSERT INTO analysis.challenges
         (id, review_id, contests_claim_id, kind, argument, materiality,
          would_be_resolved_by, outcome, resolved_by,
          challenger_kind, by_department_id)
       VALUES ($1, $2, $3, 'fragile-assumption', 'x', 'material', 'y', 'resolved',
               'devils-advocate-head', 'devils-advocate', 'devils-advocate')
       ON CONFLICT (id) DO UPDATE
         SET outcome = EXCLUDED.outcome, resolved_by = EXCLUDED.resolved_by`,
      [challengeId, reviewId, claimId],
    )
    const challenge = await reloadChallenge(reviewId, challengeId)
    /* Provenance is untouched by the re-filing... */
    expect(challenge.challengerKind).toBe('peer')
    expect(challenge.byDepartmentId).toBe(PEER_DEPARTMENT)
    /* ...while the settlement the re-filing carried did take effect. */
    expect(challenge.resolvedBy).toBe('devils-advocate-head')
  })
})

describe('migration 0034 backfills legacy rows from stored data', () => {
  it('reconstructs a pre-0034 challenge with the provenance its review recorded', async () => {
    /*
     * Migration-level verification rather than a claim about one.
     *
     * A second database is migrated to 0033 only, a legacy challenge is written
     * with exactly the insert the pre-0034 repository issued, and 0034 is then
     * applied. The backfill must read the parent review rather than write a
     * constant — which is the difference between restating an enforced
     * invariant and manufacturing provenance.
     */
    const legacy = await createTestDatabase()
    try {
      const source = resolve(process.cwd(), 'db/migrations')
      const upTo33 = mkdtempSync(join(tmpdir(), 'mig33-'))
      for (const file of readdirSync(source)) {
        if (file < '0034') copyFileSync(join(source, file), join(upTo33, file))
      }
      await migrate(legacy.owner, { directory: upTo33 })

      await legacy.owner.query(
        `INSERT INTO analysis.cases
           (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
            subject_display_name, question, stage, opened_at)
         VALUES ('legacy-case', 'system', 1, 'research-director', 'macro', 'regime',
                 'Policy regime', 'Is the policy path mispriced?', 'intake', now())`,
      )
      await legacy.owner.query(
        `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, sequence)
         VALUES ('legacy-review', 'devils-advocate', 'case', 'legacy-case', 'system',
                 'devils-advocate-head', 'devils-advocate', now(), 1)`,
      )
      /*
       * The challenge cites a claim, and a claim needs the run chain behind it.
       * Seeded against THIS database rather than the suite's, which is why the
       * helpers take a client.
       */
      await seedExecutionRefs(legacy.owner)
      const legacyRun = await insertRun('legacy-case', legacy.owner)
      const legacyClaim = await insertClaim('legacy-case', legacyRun.runId, legacy.owner)
      await legacy.owner.query(
        `INSERT INTO analysis.challenges
           (id, review_id, contests_claim_id, kind, argument, materiality, would_be_resolved_by)
         VALUES ('legacy-challenge', 'legacy-review', $1,
                 'fragile-assumption', 'legacy objection', 'material', 'evidence')`,
        [legacyClaim],
      )

      await migrate(legacy.owner, { directory: source })

      const rows = await legacy.owner.query<ChallengeRow>(
        `SELECT * FROM analysis.challenges WHERE id = 'legacy-challenge'`,
      )
      const reviews = await legacy.owner.query<ReviewRow>(
        `SELECT * FROM analysis.reviews WHERE id = 'legacy-review'`,
      )
      const legacyRow = reviews.rows[0]!
      const rawLegacyAt = legacyRow.at as unknown
      const legacyAt =
        rawLegacyAt instanceof Date ? rawLegacyAt.toISOString() : legacyRow.at
      const challenge = toDevilsAdvocate({ ...legacyRow, at: legacyAt }, rows.rows, [])
        .challenges[0]!

      expect(challenge.challengerKind).toBe('devils-advocate')
      expect(challenge.byDepartmentId).toBe('devils-advocate')
      /* And the act itself is untouched by the migration. */
      expect(challenge.id).toBe('legacy-challenge')
      expect(challenge.argument).toBe('legacy objection')
      expect(challenge.materiality).toBe('material')
    } finally {
      await legacy.drop()
    }
  }, 180_000)
})
