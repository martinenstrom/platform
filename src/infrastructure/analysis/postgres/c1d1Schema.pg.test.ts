/**
 * What migration 0020 makes impossible.
 *
 * The decision record answers "what did the firm commit to, on what basis, and
 * who is accountable" years after everyone involved has moved on. These are the
 * shapes that would let it answer plausibly and wrongly: an outcome whose
 * relations disagree with it, a considered revision nobody submitted, two live
 * decisions on one case, a supersession that loops, a threshold with no unit —
 * and a compliance verdict nobody issued.
 *
 * Several of the rules span rows, so they are deferred constraint triggers.
 * Those are asserted **at COMMIT**, which is where they fire: a test that only
 * inserted would pass while the rule did nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  APP_ROLE,
  createTestDatabase,
  isPermissionDenied,
  type TestDatabase,
} from './testDatabase'

let db: TestDatabase
let sql: Client
let app: Client

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  sql = db.owner
  app = await db.connectAs(APP_ROLE)

  await sql.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ('c1d1-prov', 'postgres', 'v', 'test', 'catalog', '0020', '8', '2', now())
     ON CONFLICT (id) DO NOTHING`,
  )
}, 300_000)

afterAll(async () => {
  await app?.end().catch(() => {})
  await db?.drop()
})

let unique = 0
const id = (prefix: string) => `${prefix}-${++unique}`

/* -------------------------------------------------------------- fixtures */

interface Seeded {
  caseId: string
  thesisId: string
  revisionA: string
  revisionB: string
  submissionA: string
  submissionB: string
}

/** A case with two competing revisions, each with its own CIO submission. */
async function seed(): Promise<Seeded> {
  const caseId = id('case')
  const thesisId = id('thesis')
  const revisionA = id('rev')
  const revisionB = id('rev')

  await sql.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at)
     VALUES ($1, 'system', 1, 'research-director', 'macro', 'regime',
             'Regime', 'Is it mispriced?', 'decision', now())`,
    [caseId],
  )

  for (const [revisionId, number] of [
    [revisionA, 1],
    [revisionB, 2],
  ] as const) {
    await sql.query(
      `INSERT INTO analysis.thesis_revisions
         (revision_id, thesis_id, revision_number, supersedes_revision_id, case_id,
          statement, position, lifecycle, invalidation_criteria, implications,
          proposed_by_department_id, proposed_by_employee_id, proposed_at,
          revision_cause)
       VALUES ($1, $2, $3, NULL, $4, 's', 'hold', 'verified', 'i', '{}',
               'research-office', 'research-director', now(), 'initial-proposal')`,
      [revisionId, `${thesisId}-${number}`, 1, caseId],
    )
  }

  const submissionA = await submit(caseId, `${thesisId}-1`, revisionA)
  const submissionB = await submit(caseId, `${thesisId}-2`, revisionB)
  return { caseId, thesisId, revisionA, revisionB, submissionA, submissionB }
}

async function submit(
  caseId: string,
  thesisId: string,
  revisionId: string,
  policy = '1',
): Promise<string> {
  const submissionId = id('sub')
  await sql.query(
    `INSERT INTO analysis.cio_submissions
       (id, case_id, tenant_id, thesis_id, revision_id, submitted_by_department_id,
        submitted_by_employee_id, submitted_at, case_version, state,
        eligibility_policy_version, risk_requirement, storage_provenance_id,
        evaluated_at, manifest_algorithm, manifest_canon_version, manifest_digest)
     VALUES ($1, $2, 'system', $3, $4, 'research-office', 'research-director',
             now(), 1, 'pending', $5, 'not-required', 'c1d1-prov', now(),
             -- Synthetic: this seed never hydrates through the mapper, so the
             -- witness is never verified. It satisfies the real CHECKs.
             'sha256', '1', '0000000000000000000000000000000000000000000000000000000000000000')`,
    [submissionId, caseId, thesisId, revisionId, policy],
  )
  return submissionId
}

const ACTOR = `'role-cio', 'executive', 'executive', false, '{}', '1',
               'system-asserted', 'chief-decision'`

/** Writes a decision and its relations inside one transaction. */
async function decide(
  seeded: Seeded,
  outcome: 'selected' | 'deferred' | 'declined',
  relations: ReadonlyArray<[revision: string, submission: string, relation: string]>,
  options: {
    decisionId?: string
    selectedRevisionId?: string | null
    supersedes?: string
    triggers?: number
    client?: Client
  } = {},
): Promise<string> {
  const client = options.client ?? sql
  const decisionId = options.decisionId ?? id('dec')

  await client.query('BEGIN')
  try {
    if (options.supersedes) {
      // The prior decision leaves the partial index BEFORE its successor
      // enters it, which the deferred foreign key is what permits.
      await client.query(
        `UPDATE analysis.case_decisions SET superseded_by_decision_id = $2
         WHERE decision_id = $1`,
        [options.supersedes, decisionId],
      )
    }
    await client.query(
      `INSERT INTO analysis.case_decisions
         (decision_id, case_id, tenant_id, aggregate_version, decided_at,
          decided_by_employee_id, outcome_kind, selected_revision_id,
          supersedes_decision_id, evidence_set_id, rationale,
          decided_by_role_id, decided_by_role_function, decided_by_department_id,
          decided_by_department_is_governance, decided_by_department_handles,
          organization_seed_version, authentication, authorization_basis)
       VALUES ($1, $2, 'system', 1, now(), 'cio', $3, $4, $5, $6, 'because',
               ${ACTOR})`,
      [
        decisionId,
        seeded.caseId,
        outcome,
        options.selectedRevisionId ?? null,
        options.supersedes ?? null,
        await evidenceSet(),
      ],
    )
    for (const [revisionId, submissionId, relation] of relations) {
      await client.query(
        `INSERT INTO analysis.decision_submissions
           (decision_id, submission_id, case_id, revision_id, relation)
         VALUES ($1, $2, $3, $4, $5)`,
        [decisionId, submissionId, seeded.caseId, revisionId, relation],
      )
    }
    for (let index = 0; index < (options.triggers ?? 0); index += 1) {
      await client.query(
        `INSERT INTO analysis.decision_reconsideration_triggers
           (id, decision_id, ordinal, condition_type, subject_kind, subject_ref,
            comparator, qualitative_condition, rationale,
            created_by_employee_id, created_at, policy_version)
         VALUES ($1, $2, $3, 'policy-change', 'policy-rate', 'ecb', 'changes',
                 'the ECB abandons forward guidance', 'it would break the path',
                 'cio', now(), '1')`,
        [id('trg'), decisionId, index],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
  return decisionId
}

let evidenceSeeded: string | null = null
async function evidenceSet(): Promise<string> {
  if (evidenceSeeded) return evidenceSeeded
  evidenceSeeded = id('set')
  await sql.query(
    `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
     VALUES ($1, now(), 'corr', '{"kind":"empty"}'::jsonb)`,
    [evidenceSeeded],
  )
  return evidenceSeeded
}

/* ------------------------------------------------------ outcome semantics */

describe('the outcome and its relations must agree', () => {
  it('accepts a selected decision that dispositions every considered revision', async () => {
    const s = await seed()
    const decisionId = await decide(
      s,
      'selected',
      [
        [s.revisionA, s.submissionA, 'selected'],
        [s.revisionB, s.submissionB, 'not-selected'],
      ],
      { selectedRevisionId: s.revisionA },
    )
    const stored = await sql.query(
      `SELECT count(*) FROM analysis.decision_submissions WHERE decision_id = $1`,
      [decisionId],
    )
    expect(Number(stored.rows[0].count)).toBe(2)
  })

  it('refuses a selected decision that leaves a considered revision undisposed', async () => {
    const s = await seed()
    /*
     * Both revisions considered, only one dispositioned. The insert succeeds;
     * COMMIT is where the rule lives, because until then the decision may still
     * be about to gain its second relation.
     */
    await expect(
      decide(s, 'selected', [[s.revisionA, s.submissionA, 'selected']], {
        selectedRevisionId: s.revisionA,
        // A second submission exists for this case and is not related, which is
        // legitimate — the failure below is the missing not-selected row for a
        // revision the decision DID consider.
      }).then(async () => {
        const another = await seed()
        await decide(
          another,
          'selected',
          [
            [another.revisionA, another.submissionA, 'considered'],
            [another.revisionB, another.submissionB, 'not-selected'],
          ],
          { selectedRevisionId: another.revisionA },
        )
      }),
    ).rejects.toThrow(/decision_outcome/)
  })

  it('refuses a selected decision with no selected relation', async () => {
    const s = await seed()
    await expect(
      decide(s, 'selected', [[s.revisionA, s.submissionA, 'not-selected']], {
        selectedRevisionId: s.revisionA,
      }),
    ).rejects.toThrow(/decision_outcome/)
  })

  it('refuses a decision that considers nothing', async () => {
    const s = await seed()
    await expect(decide(s, 'declined', [], { selectedRevisionId: null })).rejects.toThrow(
      /considers nothing/,
    )
  })

  it('accepts a deferral with a reconsideration condition', async () => {
    const s = await seed()
    const decisionId = await decide(
      s,
      'deferred',
      [
        [s.revisionA, s.submissionA, 'considered'],
        [s.revisionB, s.submissionB, 'considered'],
      ],
      { triggers: 1 },
    )
    expect(decisionId).toMatch(/^dec-/)
  })

  it('refuses a deferral with no condition that would end the wait', async () => {
    const s = await seed()
    await expect(
      decide(s, 'deferred', [[s.revisionA, s.submissionA, 'considered']]),
    ).rejects.toThrow(/no condition/)
  })

  it('refuses a deferral that selects or declines', async () => {
    const s = await seed()
    await expect(
      decide(s, 'deferred', [[s.revisionA, s.submissionA, 'declined']], {
        triggers: 1,
      }),
    ).rejects.toThrow(/selects or declines/)
  })

  it('accepts a decline that accounts for every considered revision', async () => {
    const s = await seed()
    const decisionId = await decide(s, 'declined', [
      [s.revisionA, s.submissionA, 'declined'],
      [s.revisionB, s.submissionB, 'declined'],
    ])
    expect(decisionId).toMatch(/^dec-/)
  })

  it('refuses a decline that leaves a considered revision without a disposition', async () => {
    const s = await seed()
    await expect(
      decide(s, 'declined', [
        [s.revisionA, s.submissionA, 'declined'],
        [s.revisionB, s.submissionB, 'considered'],
      ]),
    ).rejects.toThrow(/without a disposition/)
  })

  it('refuses a selected outcome that names no revision', async () => {
    const s = await seed()
    await expect(
      decide(s, 'selected', [[s.revisionA, s.submissionA, 'selected']]),
    ).rejects.toThrow(/case_decisions_selected_names_revision/)
  })

  it('refuses a deferral that names a selected revision', async () => {
    const s = await seed()
    await expect(
      decide(s, 'deferred', [[s.revisionA, s.submissionA, 'considered']], {
        selectedRevisionId: s.revisionA,
        triggers: 1,
      }),
    ).rejects.toThrow(/case_decisions_deferred_names_no_revision/)
  })
})

/* ------------------------------------------------ the submission relation */

describe('every considered revision was formally submitted', () => {
  it('refuses a submission belonging to another case', async () => {
    const mine = await seed()
    const other = await seed()
    await expect(
      decide(mine, 'declined', [[mine.revisionA, other.submissionA, 'declined']]),
    ).rejects.toThrow(/decision_submissions_submission_id_case_id_fkey|foreign key/)
  })

  it('refuses a submission that targets a different revision', async () => {
    const s = await seed()
    await expect(
      decide(s, 'declined', [[s.revisionB, s.submissionA, 'declined']]),
    ).rejects.toThrow(/foreign key/)
  })

  it('cannot record two relations for one revision', async () => {
    const s = await seed()
    await expect(
      decide(s, 'declined', [
        [s.revisionA, s.submissionA, 'declined'],
        [s.revisionA, s.submissionA, 'considered'],
      ]),
    ).rejects.toThrow(/decision_submissions_pkey|duplicate key/)
  })

  it('cannot record two selected relations', async () => {
    const s = await seed()
    await expect(
      decide(
        s,
        'selected',
        [
          [s.revisionA, s.submissionA, 'selected'],
          [s.revisionB, s.submissionB, 'selected'],
        ],
        { selectedRevisionId: s.revisionA },
      ),
    ).rejects.toThrow(/decision_submissions_one_selected|duplicate key/)
  })
})

/* -------------------------------------------------------- supersession */

describe('supersession', () => {
  it('replaces the live decision atomically, leaving exactly one', async () => {
    const s = await seed()
    const first = await decide(s, 'declined', [
      [s.revisionA, s.submissionA, 'declined'],
      [s.revisionB, s.submissionB, 'declined'],
    ])
    const second = await decide(
      s,
      'selected',
      [
        [s.revisionA, s.submissionA, 'selected'],
        [s.revisionB, s.submissionB, 'not-selected'],
      ],
      { selectedRevisionId: s.revisionA, supersedes: first },
    )

    const live = await sql.query(
      `SELECT decision_id FROM analysis.case_decisions
       WHERE case_id = $1 AND superseded_by_decision_id IS NULL`,
      [s.caseId],
    )
    expect(live.rows.map((r) => r.decision_id)).toEqual([second])

    // The superseded decision is preserved, not edited.
    const prior = await sql.query(
      `SELECT outcome_kind, superseded_by_decision_id FROM analysis.case_decisions
       WHERE decision_id = $1`,
      [first],
    )
    expect(prior.rows[0]).toMatchObject({
      outcome_kind: 'declined',
      superseded_by_decision_id: second,
    })
  })

  it('leaves the original live when the superseding transaction rolls back', async () => {
    const s = await seed()
    const first = await decide(s, 'declined', [
      [s.revisionA, s.submissionA, 'declined'],
      [s.revisionB, s.submissionB, 'declined'],
    ])

    await expect(
      // Selected outcome with no selected relation: fails at COMMIT, after the
      // UPDATE that removed the first decision from the live index.
      decide(s, 'selected', [[s.revisionA, s.submissionA, 'not-selected']], {
        selectedRevisionId: s.revisionA,
        supersedes: first,
      }),
    ).rejects.toThrow()

    const live = await sql.query(
      `SELECT decision_id FROM analysis.case_decisions
       WHERE case_id = $1 AND superseded_by_decision_id IS NULL`,
      [s.caseId],
    )
    expect(live.rows.map((r) => r.decision_id)).toEqual([first])
  })

  it('refuses a supersession target that does not exist, at commit', async () => {
    const s = await seed()
    await expect(
      decide(s, 'declined', [[s.revisionA, s.submissionA, 'declined']], {
        supersedes: 'no-such-decision',
      }),
    ).rejects.toThrow(/case_decisions_supersedes_fk|foreign key/)
  })

  it('refuses a decision that supersedes itself', async () => {
    const s = await seed()
    const decisionId = id('dec')
    await expect(
      decide(s, 'declined', [[s.revisionA, s.submissionA, 'declined']], {
        decisionId,
        supersedes: decisionId,
      }),
    ).rejects.toThrow(/supersedes_not_self|supersession_cycle/)
  })

  it('refuses a supersession across cases', async () => {
    const mine = await seed()
    const other = await seed()
    const theirs = await decide(other, 'declined', [
      [other.revisionA, other.submissionA, 'declined'],
      [other.revisionB, other.submissionB, 'declined'],
    ])
    await expect(
      decide(mine, 'declined', [[mine.revisionA, mine.submissionA, 'declined']], {
        supersedes: theirs,
      }),
    ).rejects.toThrow(/foreign key|case_decisions_supersedes_fk/)
  })

  it('cannot form a cycle, because the link is immutable once written', async () => {
    /*
     * Three things would have to fail together. The immutability guard refuses
     * any change to `supersedes_decision_id` after insert, so a ring cannot be
     * closed later; the deferred foreign key refuses a predecessor that does
     * not exist, so it cannot be closed at insert; and the cycle trigger is
     * behind both. This asserts the first, which is the one that fires.
     */
    const s = await seed()
    const first = await decide(s, 'declined', [
      [s.revisionA, s.submissionA, 'declined'],
      [s.revisionB, s.submissionB, 'declined'],
    ])
    const second = await decide(
      s,
      'declined',
      [
        [s.revisionA, s.submissionA, 'declined'],
        [s.revisionB, s.submissionB, 'declined'],
      ],
      { supersedes: first },
    )
    await expect(
      sql.query(
        `UPDATE analysis.case_decisions SET supersedes_decision_id = $2
         WHERE decision_id = $1`,
        [first, second],
      ),
    ).rejects.toThrow(/is committed and cannot be/)

    // And the chain is still what it was.
    const chain = await sql.query(
      `SELECT supersedes_decision_id FROM analysis.case_decisions
       WHERE decision_id = $1`,
      [first],
    )
    expect(chain.rows[0].supersedes_decision_id).toBeNull()
  })
})

/* ------------------------------------------------------------- triggers */

describe('reconsideration triggers', () => {
  const insertTrigger = async (decisionId: string, over: Record<string, unknown>) =>
    sql.query(
      `INSERT INTO analysis.decision_reconsideration_triggers
         (id, decision_id, ordinal, condition_type, subject_kind, subject_ref,
          comparator, threshold_amount, threshold_unit, qualitative_condition,
          rationale, created_by_employee_id, created_at, policy_version)
       VALUES ($1, $2, $3, $4, 'series', 'cpi', $5, $6, $7, $8, 'because', 'cio',
               now(), $9)`,
      [
        id('trg'),
        decisionId,
        over.ordinal ?? 90 + (unique % 9),
        'conditionType' in over ? over.conditionType : 'quantitative-threshold',
        'comparator' in over ? over.comparator : 'above',
        'amount' in over ? over.amount : '3',
        'unit' in over ? over.unit : 'percent',
        'qualitative' in over ? over.qualitative : null,
        over.policyVersion ?? '1',
      ],
    )

  const deferred = async () => {
    const s = await seed()
    return decide(s, 'deferred', [[s.revisionA, s.submissionA, 'considered']], {
      triggers: 1,
    })
  }

  it('refuses a quantitative condition with no unit', async () => {
    /*
     * Three percent, three index points and three basis points are different
     * conditions. Without the unit the trigger reads as precise and is not.
     */
    const decisionId = await deferred()
    await expect(insertTrigger(decisionId, { unit: null })).rejects.toThrow(
      /triggers_quantitative_complete/,
    )
  })

  it('refuses a quantitative condition with no threshold', async () => {
    const decisionId = await deferred()
    await expect(
      insertTrigger(decisionId, { amount: null, comparator: 'changes' }),
    ).rejects.toThrow(/triggers_quantitative_complete/)
  })

  it('refuses a condition nothing could ever evaluate', async () => {
    const decisionId = await deferred()
    await expect(
      insertTrigger(decisionId, {
        conditionType: 'policy-change',
        comparator: null,
        amount: null,
        unit: null,
        qualitative: null,
      }),
    ).rejects.toThrow(/triggers_evaluable/)
  })

  it('stores each trigger’s own policy version', async () => {
    const decisionId = await deferred()
    await insertTrigger(decisionId, { ordinal: 50, policyVersion: '1' })
    const stored = await sql.query(
      `SELECT policy_version FROM analysis.decision_reconsideration_triggers
       WHERE decision_id = $1 ORDER BY ordinal`,
      [decisionId],
    )
    // Every row carries one; none inherits from a sibling.
    expect(stored.rows.every((row) => row.policy_version === '1')).toBe(true)
    expect(stored.rows.length).toBeGreaterThan(1)
  })

  it('has no active column for anything to flip', async () => {
    const columns = await sql.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'analysis'
         AND table_name = 'decision_reconsideration_triggers'`,
    )
    expect(columns.rows.map((r) => r.column_name)).not.toContain('active')
  })
})

/* ------------------------------------------------- policy and actor shape */

describe('the eligibility policy is a registry, not a label', () => {
  it('refuses a submission citing a policy version that does not exist', async () => {
    const s = await seed()
    await expect(submit(s.caseId, `${s.thesisId}-1`, s.revisionA, '99')).rejects.toThrow(
      /eligibility_policy_version_fkey|foreign key/,
    )
  })

  it('records version 1 with Compliance outside the gate, not cleared by it', async () => {
    const policy = await sql.query(
      `SELECT * FROM analysis.eligibility_policies WHERE version = '1'`,
    )
    expect(policy.rows[0]).toMatchObject({
      verification: 'required',
      devils_advocate: 'required',
      risk: 'conditional-by-resolution',
      // The distinction the whole registry exists for: nobody decided review
      // was unnecessary, the question was not in scope.
      compliance: 'outside-policy-scope',
      domain_contract_version: '8',
    })
  })

  it('has no compliance verdict column on any decision table', async () => {
    const columns = await sql.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'analysis'
         AND table_name IN ('case_decisions', 'decision_submissions',
                            'decision_dissent', 'cio_submissions')
         AND column_name LIKE '%compliance%'`,
    )
    expect(columns.rows).toEqual([])
  })

  it('does not duplicate the eligibility basis onto the decision', async () => {
    // The basis lives on the submission. Copying it would be a second source of
    // truth bought for read convenience, which is what a join is for.
    const columns = await sql.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'analysis' AND table_name = 'case_decisions'`,
    )
    const names = columns.rows.map((r) => r.column_name)
    for (const basisColumn of [
      'eligibility_policy_version',
      'verification_review_id',
      'devils_advocate_review_id',
      'risk_review_id',
      'risk_requirement',
      'evaluated_at',
    ]) {
      expect(names).not.toContain(basisColumn)
    }
  })
})

describe('the actor snapshot', () => {
  it('mirrors ActorSnapshot and invents no field', async () => {
    const columns = await sql.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'analysis' AND table_name = 'case_decisions'
         AND column_name LIKE 'decided_by%'`,
    )
    const names = columns.rows.map((r) => r.column_name).sort()
    expect(names).toEqual([
      'decided_by_department_handles',
      'decided_by_department_id',
      'decided_by_department_is_governance',
      'decided_by_employee_id',
      'decided_by_role_function',
      'decided_by_role_id',
    ])
    // `seniority` is not on the contract, so a column for it would be a field
    // nothing could ever fill honestly.
    expect(names).not.toContain('decided_by_seniority')
  })

  it('refuses handles the caller did not canonically sort', async () => {
    /*
     * Organization insertion order is not institutional meaning: two snapshots
     * listing the same disciplines differently describe the same authority, and
     * a restart comparison that disagreed about them would report a difference
     * that does not exist.
     */
    const s = await seed()
    await expect(
      sql.query(
        `INSERT INTO analysis.case_decisions
           (decision_id, case_id, tenant_id, aggregate_version, decided_at,
            decided_by_employee_id, outcome_kind, evidence_set_id, rationale,
            decided_by_role_id, decided_by_department_handles,
            organization_seed_version, authentication, authorization_basis)
         VALUES ($1, $2, 'system', 1, now(), 'cio', 'declined', $3, 'r',
                 'role-cio', ARRAY['rates','macro'], '1', 'system-asserted', 'x')`,
        [id('dec'), s.caseId, await evidenceSet()],
      ),
    ).rejects.toThrow(/handles_sorted/)
  })

  it('accepts them sorted', async () => {
    const s = await seed()
    await sql.query('BEGIN')
    const decisionId = id('dec')
    await sql.query(
      `INSERT INTO analysis.case_decisions
         (decision_id, case_id, tenant_id, aggregate_version, decided_at,
          decided_by_employee_id, outcome_kind, evidence_set_id, rationale,
          decided_by_role_id, decided_by_department_handles,
          organization_seed_version, authentication, authorization_basis)
       VALUES ($1, $2, 'system', 1, now(), 'cio', 'declined', $3, 'r',
               'role-cio', ARRAY['macro','rates'], '1', 'system-asserted', 'x')`,
      [decisionId, s.caseId, await evidenceSet()],
    )
    await sql.query(
      `INSERT INTO analysis.decision_submissions
         (decision_id, submission_id, case_id, revision_id, relation)
       VALUES ($1, $2, $3, $4, 'declined')`,
      [decisionId, s.submissionA, s.caseId, s.revisionA],
    )
    await sql.query(
      `INSERT INTO analysis.decision_submissions
         (decision_id, submission_id, case_id, revision_id, relation)
       VALUES ($1, $2, $3, $4, 'declined')`,
      [decisionId, s.submissionB, s.caseId, s.revisionB],
    )
    await expect(sql.query('COMMIT')).resolves.toBeDefined()
  })
})

/* ---------------------------------------------------- runtime permissions */

describe('the runtime cannot rewrite what it recorded', () => {
  let decisionId: string
  let seeded: Seeded

  beforeAll(async () => {
    seeded = await seed()
    decisionId = await decide(seeded, 'declined', [
      [seeded.revisionA, seeded.submissionA, 'declined'],
      [seeded.revisionB, seeded.submissionB, 'declined'],
    ])
  })

  const refused = async (statement: string, values: unknown[] = []) => {
    const error = await app.query(statement, values).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error, `"${statement.slice(0, 60)}" was permitted`).not.toBeNull()
    expect(isPermissionDenied(error)).toBe(true)
  }

  it('cannot update a decision', async () => {
    await refused(
      `UPDATE analysis.case_decisions SET rationale = 'edited' WHERE decision_id = $1`,
      [decisionId],
    )
  })

  it('cannot delete a decision', async () => {
    await refused(`DELETE FROM analysis.case_decisions WHERE decision_id = $1`, [
      decisionId,
    ])
  })

  it('cannot rewrite the actor snapshot', async () => {
    await refused(
      `UPDATE analysis.case_decisions SET decided_by_employee_id = 'macro-head'
       WHERE decision_id = $1`,
      [decisionId],
    )
  })

  it('cannot update or delete a decision-submission relation', async () => {
    await refused(
      `UPDATE analysis.decision_submissions SET relation = 'selected'
       WHERE decision_id = $1`,
      [decisionId],
    )
    await refused(`DELETE FROM analysis.decision_submissions WHERE decision_id = $1`, [
      decisionId,
    ])
  })

  it('cannot update or delete a reconsideration trigger', async () => {
    await refused(`UPDATE analysis.decision_reconsideration_triggers SET rationale = 'x'`)
    await refused(`DELETE FROM analysis.decision_reconsideration_triggers`)
  })

  it('cannot update or delete dissent', async () => {
    await refused(`UPDATE analysis.decision_dissent SET acknowledgement = 'x'`)
    await refused(`DELETE FROM analysis.decision_dissent`)
  })

  it('cannot add an eligibility policy version', async () => {
    // A policy the runtime could add is a gate the runtime could define for
    // itself.
    await refused(
      `INSERT INTO analysis.eligibility_policies VALUES
         ('99', 'invented', 'outside-policy-scope', 'outside-policy-scope',
          'outside-policy-scope', 'outside-policy-scope', 'material',
          'decision-critical', false, '8')`,
    )
  })

  it('cannot disable the outcome guard', async () => {
    await refused(
      `ALTER TABLE analysis.case_decisions DISABLE TRIGGER case_decisions_outcome_guard`,
    )
  })

  it('holds UPDATE on exactly one column of case_decisions', async () => {
    /*
     * Granted at column level, so the permission supersession needs cannot be
     * read as a general right to edit a decision. The narrowed immutability
     * guard is the second lock: even this column moves only from NULL to a
     * successor, and only once.
     */
    const granted = await sql.query(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_schema = 'analysis' AND table_name = 'case_decisions'
         AND grantee = $1 AND privilege_type = 'UPDATE'
       ORDER BY column_name`,
      [APP_ROLE],
    )
    expect(granted.rows.map((row) => row.column_name)).toEqual([
      'superseded_by_decision_id',
    ])
  })
})
