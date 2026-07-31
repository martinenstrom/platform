/**
 * What migrations 0016 and 0017 make impossible.
 *
 * Three guarantees the application alone cannot promise: a run cannot present
 * an execution identity its producer could not have, it cannot report spending
 * it could not have done, and the claim vocabulary the database accepts is
 * exactly the one the domain can produce.
 *
 * The third had already drifted. `trend` and `risk` are claim types the domain
 * has had since Phase A and the database refused; `refuted` and `withdrawn`
 * were statuses the database allowed and no code could write. Nothing had
 * written a claim yet, so nobody had found out — `RecordContribution` is the
 * first writer, and it would have found out as a rejected macro contribution.
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

  await sql.query(
    `INSERT INTO analysis.playbooks (id, case_kind, name)
     VALUES ('c1c2', 'macro', 'C1C-2 test playbook') ON CONFLICT (id) DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_versions (playbook_id, version, content_hash)
     VALUES ('c1c2', '1', 'hash') ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_entries
       (playbook_id, version, entry_key, department_id, brief, requirement, priority)
     VALUES ('c1c2', '1', 'entry', 'global-macro', 'Regime read', 'required', 5)
     ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ('c1c2-prov', 'postgres', 'v', 'test', 'catalog', '0017', '5', '2',
             now())
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
    `INSERT INTO analysis.evidence_sets
       (id, assembled_at, correlation_id, co_temporality)
     VALUES ($1, now(), 'corr', '{"kind":"empty"}'::jsonb)`,
    [setId],
  )
  return setId
}

interface RunOverrides {
  providerKind: string
  identityKind: string
  usageState: string
  measured: boolean
}

/**
 * One run, with the identity and usage columns under test parameterized.
 *
 * The identity columns are filled from `identity_kind` rather than passed
 * independently, so a test names the shape it wants and cannot accidentally
 * assert on a half-built one.
 */
async function insertRun(
  caseId: string,
  assignmentId: string,
  over: Partial<RunOverrides> = {},
) {
  const runId = id('run')
  const setId = await insertEvidenceSet()
  await sql.query(
    `INSERT INTO analysis.runs
       (id, case_id, tenant_id, assignment_id, department_id, employee_id, state,
        agent_contract_version, output_schema_version,
        identity_kind, prompt_id, prompt_version, prompt_content_hash,
        model_id, model_provider, model_parameters_hash,
        scenario_id, stub_version, identity_unavailable_reason, recording_id,
        usage_state, input_tokens, output_tokens, cost_minor_units, currency,
        evidence_set_id, started_at,
        playbook_id, playbook_version, playbook_entry_key,
        provider_id, provider_version, provider_kind, missing_optional_inputs,
        provenance_id)
     VALUES ($1, $2, 'system', $3, 'global-macro', 'macro-head', 'running',
             '1', '1', $4::text,
             CASE WHEN $4::text = 'model' THEN 'p' END,
             CASE WHEN $4::text = 'model' THEN '1' END,
             CASE WHEN $4::text = 'model' THEN 'ph' END,
             CASE WHEN $4::text = 'model' THEN 'm' END,
             CASE WHEN $4::text = 'model' THEN 'anthropic' END,
             CASE WHEN $4::text = 'model' THEN 'mh' END,
             CASE WHEN $4::text = 'scenario' THEN 'success' END,
             CASE WHEN $4::text = 'scenario' THEN '1' END,
             CASE WHEN $4::text = 'unavailable'
                  THEN 'not-captured-by-recording' END,
             CASE WHEN $4::text = 'unavailable' THEN 'rec-1' END,
             $5::text,
             CASE WHEN $6::boolean THEN 0 END,
             CASE WHEN $6::boolean THEN 0 END,
             CASE WHEN $6::boolean THEN 0 END,
             CASE WHEN $6::boolean THEN 'USD' END,
             $7, now(),
             'c1c2', '1', 'entry',
             'test-provider', '1', $8::text, '{}', 'c1c2-prov')`,
    [
      runId,
      caseId,
      assignmentId,
      over.identityKind ?? 'model',
      over.usageState ?? 'not-applicable',
      over.measured ?? false,
      setId,
      over.providerKind ?? 'recorded',
    ],
  )
  return runId
}

/* ------------------------------------------------------- execution identity */

describe('what a run may claim produced it', () => {
  it('lets a recorded run keep the model its artifact captured', async () => {
    /*
     * A recording replays a contribution a real model produced, and that model
     * is the true one. Overwriting it with a placeholder would destroy the
     * provenance the recording exists for; `provider_kind` is what keeps the
     * replay distinguishable from live work.
     */
    const caseId = await insertCase()
    const runId = await insertRun(caseId, await insertAssignment(caseId))

    const { rows } = await sql.query(
      `SELECT identity_kind, model_provider FROM analysis.runs WHERE id = $1`,
      [runId],
    )
    expect(rows[0]).toEqual({ identity_kind: 'model', model_provider: 'anthropic' })
  })

  it('lets a recording say it does not know what produced it', async () => {
    const caseId = await insertCase()
    const runId = await insertRun(caseId, await insertAssignment(caseId), {
      identityKind: 'unavailable',
    })

    const { rows } = await sql.query(
      `SELECT identity_unavailable_reason, model_id FROM analysis.runs WHERE id = $1`,
      [runId],
    )
    // Stated, not filled in: "we do not know" and "there was nothing to know"
    // are different facts about a contribution.
    expect(rows[0]).toEqual({
      identity_unavailable_reason: 'not-captured-by-recording',
      model_id: null,
    })
  })

  it('refuses a stub that presents a model', async () => {
    /*
     * The failure TD-32 existed for. A placeholder in a column named
     * `model_provider` is a real model identity to every reader downstream,
     * and after 0017 a stub has nowhere to put one.
     */
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), {
        providerKind: 'stub',
        identityKind: 'model',
      }),
    ).rejects.toThrow(/runs_identity_matches_provider/)
  })

  it('refuses a scenario from a recorded provider', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), {
        providerKind: 'recorded',
        identityKind: 'scenario',
      }),
    ).rejects.toThrow(/runs_identity_matches_provider/)
  })

  it('refuses a live run whose model is unknown', async () => {
    // A live provider knows its prompt and model before it sends anything.
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), {
        providerKind: 'live',
        identityKind: 'unavailable',
        usageState: 'not-reported',
      }),
    ).rejects.toThrow(/runs_identity_matches_provider/)
  })

  it('refuses an identity kind outside the three', async () => {
    /*
     * Matched on the shared prefix rather than one constraint name: an
     * unrecognised identity kind violates BOTH the vocabulary rule and the
     * per-provider rule, and PostgreSQL does not specify which CHECK it
     * evaluates first. Asserting a single name here would be a test whose
     * result depended on constraint evaluation order.
     */
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { identityKind: 'vibes' }),
    ).rejects.toThrow(/runs_identity/)
  })

  it('leaves the provider vocabulary as the one rule about provider kinds', async () => {
    /*
     * An unknown provider kind must trip exactly one constraint. The identity
     * and usage rules are implications per kind rather than disjunctions over
     * all three, so an unrecognised value does not also violate them —
     * otherwise which error surfaced would depend on the order PostgreSQL
     * happened to evaluate constraints in, which is not specified.
     */
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { providerKind: 'real-ish' }),
    ).rejects.toThrow(/runs_provider_kind_known/)
  })
})

/* ------------------------------------------------------------- what it cost */

describe('what a run reports consuming', () => {
  it('records a replay as having consumed nothing', async () => {
    const caseId = await insertCase()
    const runId = await insertRun(caseId, await insertAssignment(caseId))

    const { rows } = await sql.query(
      `SELECT usage_state, cost_minor_units FROM analysis.runs WHERE id = $1`,
      [runId],
    )
    // `not-applicable`, not a null cost that reads as free.
    expect(rows[0]).toEqual({ usage_state: 'not-applicable', cost_minor_units: null })
  })

  it('refuses a stub that reports spend', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), {
        providerKind: 'stub',
        identityKind: 'scenario',
        usageState: 'measured',
        measured: true,
      }),
    ).rejects.toThrow(/runs_usage_matches_provider/)
  })

  it('refuses a replay claiming its cost went unreported', async () => {
    // It made no call. `not-reported` would claim it did and nobody looked.
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { usageState: 'not-reported' }),
    ).rejects.toThrow(/runs_usage_matches_provider/)
  })

  it('refuses a measurement with nothing measured', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { usageState: 'measured' }),
    ).rejects.toThrow(/runs_usage_measurement_complete/)
  })

  it('refuses amounts without the state that gives them meaning', async () => {
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { measured: true }),
    ).rejects.toThrow(/runs_usage_measurement_complete/)
  })

  it('accepts a measured zero as a measurement', async () => {
    /*
     * The line that needs enforcing. A provider reporting a free call is a
     * different fact from a provider that said nothing, and budget enforcement
     * in C2 has to be able to tell them apart.
     */
    const caseId = await insertCase()
    const runId = await insertRun(caseId, await insertAssignment(caseId), {
      usageState: 'measured',
      measured: true,
    })

    const { rows } = await sql.query(
      `SELECT usage_state, cost_minor_units FROM analysis.runs WHERE id = $1`,
      [runId],
    )
    expect(rows[0]).toEqual({ usage_state: 'measured', cost_minor_units: '0' })
  })

  it('refuses a usage state outside the three', async () => {
    // Shared prefix, for the same reason as the identity kind above: an
    // unrecognised state violates the vocabulary rule and the per-provider
    // rule together.
    const caseId = await insertCase()
    await expect(
      insertRun(caseId, await insertAssignment(caseId), { usageState: 'free' }),
    ).rejects.toThrow(/runs_usage/)
  })
})

/* -------------------------------------------------------- the claim vocabulary */

describe('the claim vocabulary the database accepts', () => {
  /** Exactly `ClaimType` in `domain/analysis/claims.ts`. */
  const DOMAIN_CLAIM_TYPES = [
    'observation',
    'comparison',
    'trend',
    'risk',
    'forecast',
    'causal',
    'recommendation',
    'counterclaim',
  ]

  /** Exactly `ClaimStatus` in the same module. */
  const DOMAIN_CLAIM_STATUSES = [
    'supported',
    'partially-supported',
    'contested',
    'insufficient-evidence',
  ]

  const insertClaim = async (over: { type?: string; status?: string } = {}) => {
    const caseId = await insertCase()
    const runId = await insertRun(caseId, await insertAssignment(caseId))
    const claimId = id('claim')
    const type = over.type ?? 'observation'
    await sql.query(
      `INSERT INTO analysis.claims
         (id, case_id, tenant_id, run_id, type, statement, status,
          confidence_level, confidence_basis, temporal_as_of, temporal_horizon,
          contests_claim_id, causal_attribution)
       VALUES ($1, $2, 'system', $3, $4::text, 'x', $5::text, 'low',
               '[]'::jsonb, now(),
               CASE WHEN $4::text IN ('forecast', 'recommendation') THEN '3m' END,
               NULL,
               CASE WHEN $4::text = 'causal'
                    THEN '{"kind":"hedged-inference"}'::jsonb END)`,
      [claimId, caseId, runId, type, over.status ?? 'insufficient-evidence'],
    )
    return claimId
  }

  it.each(DOMAIN_CLAIM_TYPES)('accepts the domain claim type %s', async (type) => {
    // A counterclaim's `contests` is checked by a separate constraint and is
    // not what this asserts; the vocabulary is.
    if (type === 'counterclaim') {
      await expect(insertClaim({ type })).rejects.toThrow(/counterclaim_contests/)
      return
    }
    await expect(insertClaim({ type })).resolves.toBeDefined()
  })

  it.each(DOMAIN_CLAIM_STATUSES)('accepts the domain claim status %s', async (status) => {
    await expect(insertClaim({ status })).resolves.toBeDefined()
  })

  it.each(['refuted', 'withdrawn', 'plausible'])(
    'refuses the status "%s", which the domain cannot express',
    async (status) => {
      /*
       * `refuted` and `withdrawn` were in the schema and in no code. A status
       * nothing can write is a promise to a reader that something else might —
       * and a claim is write-once, so contradiction is recorded by a
       * counterclaim rather than by editing the original into submission.
       */
      await expect(insertClaim({ status })).rejects.toThrow(/claims_status_known/)
    },
  )

  it('refuses a claim type the domain cannot express', async () => {
    await expect(insertClaim({ type: 'hunch' })).rejects.toThrow(/claims_type_known/)
  })
})
