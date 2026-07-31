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
import { createTestDatabase, type TestDatabase } from './testDatabase'

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

async function insertEvidenceSet() {
  const setId = id('set')
  await sql.query(
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
async function seedExecutionRefs() {
  if (executionSeeded) return
  await sql.query(
    `INSERT INTO analysis.playbooks (id, case_kind, name)
     VALUES ('schema-test', 'macro', 'Schema test playbook')
     ON CONFLICT (id) DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_versions (playbook_id, version, content_hash)
     VALUES ('schema-test', '1', 'hash')
     ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_entries
       (playbook_id, version, entry_key, department_id, brief, requirement, priority)
     VALUES ('schema-test', '1', 'entry', 'global-macro', 'Regime read', 'required', 5)
     ON CONFLICT DO NOTHING`,
  )
  await sql.query(
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

async function insertRun(caseId: string) {
  const assignmentId = id('assignment')
  await sql.query(
    `INSERT INTO analysis.assignments
       (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
     VALUES ($1, $2, 'system', 'global-macro', 'Regime read', 'queued', 5, now())`,
    [assignmentId, caseId],
  )
  const runId = id('run')
  await seedExecutionRefs()
  await sql.query(
    `INSERT INTO analysis.runs
       (id, case_id, tenant_id, assignment_id, department_id, employee_id, state,
        agent_contract_version, output_schema_version,
        identity_kind, prompt_id, prompt_version,
        prompt_content_hash, model_id, model_provider, model_parameters_hash,
        usage_state, evidence_set_id, started_at,
        playbook_id, playbook_version, playbook_entry_key,
        provider_id, provider_version, provider_kind, missing_optional_inputs,
        provenance_id)
     VALUES ($1, $2, 'system', $3, 'global-macro', 'macro-head', 'running',
             '1', '1', 'model', 'p', '1', 'ph', 'm', 'anthropic', 'mh',
             'not-applicable', $4, now(),
             'schema-test', '1', 'entry',
             'recorded-provider', '1', 'recorded', '{}', 'schema-test-prov')`,
    [runId, caseId, assignmentId, await insertEvidenceSet()],
  )
  return { assignmentId, runId }
}

async function insertClaim(caseId: string, runId: string) {
  const claimId = id('claim')
  await sql.query(
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
           (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, status)
         VALUES ($1, 'verification', 'case', 'no-such-case', 'system', 'verification-head',
                 'verification', now(), 'verified')`,
        [id('review')],
      ),
    ).rejects.toThrow(/violates foreign key/)
  })

  it('refuses a compliance status on a risk review', async () => {
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, status)
         VALUES ($1, 'risk', 'case', $2, 'system', 'chief-risk-officer', 'risk', now(), 'approved')`,
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
           (id, kind, scope, case_id, tenant_id, thesis_id, by_employee_id, by_department_id, at, status)
         VALUES ($1, 'verification', 'case', $2, 'system', NULL, 'verification-head',
                 'verification', $3, 'verified')`,
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
         (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at)
       VALUES ($1, 'devils-advocate', 'case', $2, 'system', 'devils-advocate-head',
               'devils-advocate', now())`,
      [reviewId, caseId],
    )

    await sql.query('BEGIN')
    await sql.query(
      `INSERT INTO analysis.challenges (id, review_id, contests_claim_id, kind, argument)
       VALUES ($1, $2, $3, 'contradicting-evidence', 'The number is wrong')`,
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
         (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at)
       VALUES ($1, 'devils-advocate', 'case', $2, 'system', 'devils-advocate-head',
               'devils-advocate', now())`,
      [reviewId, caseId],
    )
    await expect(
      sql.query(
        `INSERT INTO analysis.challenges (id, review_id, contests_claim_id, kind, argument)
         VALUES ($1, $2, $3, 'fragile-assumption', 'This assumes no fiscal shock')`,
        [id('challenge'), reviewId, claimId],
      ),
    ).resolves.toBeDefined()
  })

  it('refuses a verification finding against a claim that does not exist', async () => {
    const caseId = await insertCase()
    const reviewId = id('review')
    await sql.query(
      `INSERT INTO analysis.reviews
         (id, kind, scope, case_id, tenant_id, by_employee_id, by_department_id, at, status)
       VALUES ($1, 'verification', 'case', $2, 'system', 'verification-head', 'verification',
               now(), 'correction-required')`,
      [reviewId, caseId],
    )
    await expect(
      sql.query(
        `INSERT INTO analysis.verification_findings
           (id, review_id, kind, claim_id, detail, blocking)
         VALUES ($1, $2, 'value-mismatch', 'no-such-claim', 'wrong', true)`,
        [id('finding'), reviewId],
      ),
    ).rejects.toThrow(/violates foreign key/)
  })
})

/* -------------------------------------------------------------- decisions */

describe('the decision record', () => {
  async function insertDecision(caseId: string, revisionId: string) {
    await sql.query(
      `INSERT INTO analysis.case_decisions
         (case_id, tenant_id, aggregate_version, decided_at, decided_by_employee_id,
          selected_revision_id, evidence_set_id, rationale, governance)
       VALUES ($1, 'system', 3, now(), 'cio', $2, $3, 'The policy path is mispriced',
               '{"verification":"verified"}'::jsonb)`,
      [caseId, revisionId, await insertEvidenceSet()],
    )
  }

  it('refuses a second decision on the same case', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await insertDecision(caseId, revisionId)
    await expect(insertDecision(caseId, revisionId)).rejects.toThrow(/duplicate key/)
  })

  it('refuses an update to a committed decision', async () => {
    // Of everything in the schema, this is where a quiet edit would be least
    // detectable and most damaging.
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await insertDecision(caseId, revisionId)

    await expect(
      sql.query(
        `UPDATE analysis.case_decisions SET rationale = 'Something else' WHERE case_id = $1`,
        [caseId],
      ),
    ).rejects.toThrow(/committed and cannot be update/)
  })

  it('refuses a delete of a committed decision', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await insertDecision(caseId, revisionId)

    await expect(
      sql.query('DELETE FROM analysis.case_decisions WHERE case_id = $1', [caseId]),
    ).rejects.toThrow(/committed and cannot be delete/)
  })

  it('refuses a blank rationale', async () => {
    const caseId = await insertCase()
    const revisionId = await insertRevision(caseId)
    await expect(
      sql.query(
        `INSERT INTO analysis.case_decisions
           (case_id, tenant_id, aggregate_version, decided_at, decided_by_employee_id,
            selected_revision_id, evidence_set_id, rationale, governance)
         VALUES ($1, 'system', 1, now(), 'cio', $2, $3, '   ', '{}'::jsonb)`,
        [caseId, revisionId, await insertEvidenceSet()],
      ),
    ).rejects.toThrow(/case_decisions_rationale_not_blank/)
  })

  it('refuses a decision selecting a revision that does not exist', async () => {
    const caseId = await insertCase()
    await expect(
      sql.query(
        `INSERT INTO analysis.case_decisions
           (case_id, tenant_id, aggregate_version, decided_at, decided_by_employee_id,
            selected_revision_id, evidence_set_id, rationale, governance)
         VALUES ($1, 'system', 1, now(), 'cio', 'no-such-revision', $2, 'r', '{}'::jsonb)`,
        [caseId, await insertEvidenceSet()],
      ),
    ).rejects.toThrow(/violates foreign key/)
  })

  it('has nowhere to record a second selected revision', async () => {
    // Migration 0012 removed the `selected` relation entirely: the selected
    // revision lives in one place, the column a foreign key already protects.
    const caseId = await insertCase()
    const first = await insertRevision(caseId)
    await insertDecision(caseId, first)

    await expect(
      sql.query(
        `INSERT INTO analysis.decision_revisions (case_id, revision_id, relation)
         VALUES ($1, $2, 'selected')`,
        [caseId, first],
      ),
    ).rejects.toThrow(/decision_revisions_relation_known/)
  })

  it('refuses to list the selected revision as an alternative to itself', async () => {
    const caseId = await insertCase()
    const selected = await insertRevision(caseId)
    await insertDecision(caseId, selected)

    await sql.query('BEGIN')
    await sql.query(
      `INSERT INTO analysis.decision_revisions (case_id, revision_id, relation)
       VALUES ($1, $2, 'not-selected')`,
      [caseId, selected],
    )
    await expect(sql.query('COMMIT')).rejects.toThrow(/selected revision/)
    await sql.query('ROLLBACK').catch(() => {})
  })
})

/* ------------------------------------------------- events, results, keys */

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
