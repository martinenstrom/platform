/**
 * The three governance candidate stores, against real PostgreSQL.
 *
 * The domain suite proves the contracts. This proves the STORAGE — and the
 * distinction has cost this repository two migrations already: schema existence
 * does not prove runtime writability, and a column the runtime cannot write
 * fails at the first real command with every suite green behind it. So the
 * three checks the `db/README` demands are all made here, as the application
 * role, against the migrated schema:
 *
 *   1. DDL — the shape is what the domain means, proved by a round trip;
 *   2. privileges — `SELECT` and `INSERT` are granted and `UPDATE` is not;
 *   3. runtime — the real adapter writes and reads the new surface.
 *
 * What this deliberately does NOT prove is that the right ACT produced the
 * candidate. A candidate table's foreign key is to a run, and nothing in the
 * schema says a verification candidate must come from the verification entry —
 * that is the filing command's rule, and it is proved where it lives. Here the
 * runs are ordinary ones, because what is under test is the store.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import { startRuntime, type Runtime } from './macroFlowHarness'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import {
  deriveAssignmentId,
  deriveRunId,
} from '~/application/analysis/commands/eventIdentity'
import { MACRO_REGIME_PLAYBOOK_V6 } from '~/application/analysis/macroPlaybook'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { ConflictingRecordError } from '~/application/analysis/repositories'
import {
  buildDevilsAdvocateCandidate,
  buildEvidenceSet,
  buildPeerExaminationCandidate,
  buildVerificationCandidate,
  devilsAdvocateCandidateHashMatches,
  peerExaminationCandidateHashMatches,
  verificationCandidateHashMatches,
  type GovernanceCandidateBasis,
} from '~/domain/analysis'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import type { CommandDeps } from '~/application/analysis/commands/runCommand'

let db: TestDatabase
let runtime: Runtime
let deps: CommandDeps

const AT = '2026-09-12T09:00:00.000Z'
const CASE_ID = 'gov-candidates'
const THESIS_ID = `${CASE_ID}-thesis`

let revisionId: string
let runIds: string[] = []

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  runtime = await startRuntime(await db.loginUrlFor(APP_ROLE))
  deps = await runtime.container.commandDeps()
  await seed()
}, 300_000)

afterAll(async () => {
  await runtime?.container.close().catch(() => {})
  await db?.drop()
})

const envelope = (
  commandId: string,
  actor: CommandEnvelope['actor'],
  over: Partial<CommandEnvelope> = {},
): CommandEnvelope => ({
  commandId,
  correlationId: CASE_ID,
  actor,
  initiator: { kind: 'orchestrator', orchestratorId: 'governance-candidate-suite' },
  occurredAt: AT,
  ...over,
})

const asDirector = { kind: 'employee' as const, employeeId: 'research-director' }

const committed = async (result: { outcome: string }, step: string) => {
  if (result.outcome !== 'committed') {
    throw new Error(`${step} did not commit: ${JSON.stringify(result)}`)
  }
  return result
}

/**
 * A case, a revision and three runs — the foreign keys the stores require.
 *
 * Every row arrives through a production command. Nothing is inserted by hand:
 * a store proved against fabricated parents proves the fabrication.
 */
async function seed(): Promise<void> {
  const repositories = runtime.container.repositories

  const evidenceSet = buildEvidenceSet({
    items: [],
    assembledAt: AT,
    correlationId: CASE_ID,
  })
  await repositories.evidence.save(evidenceSet)

  await committed(
    await runCommand(
      openInvestmentCase(deps.organization),
      {
        caseId: CASE_ID,
        subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
        question: 'Does the ECB cut before Q2?',
        ownerEmployeeId: 'research-director',
        participatingDepartmentIds: ['research-office'],
      },
      envelope(`${CASE_ID}-open`, asDirector),
      deps,
    ),
    'OpenInvestmentCase',
  )

  await committed(
    await runCommand(
      instantiatePlaybook(deps.organization),
      {
        caseId: CASE_ID,
        playbookId: MACRO_REGIME_PLAYBOOK_V6.id,
        playbookVersion: MACRO_REGIME_PLAYBOOK_V6.version,
        onBehalfOfDepartmentId: 'research-office',
      },
      envelope(`${CASE_ID}-playbook`, asDirector, {
        expectedVersion: (await repositories.cases.get(CASE_ID))!.version,
      }),
      deps,
    ),
    'InstantiatePlaybook',
  )

  await committed(
    await runCommand(
      proposeThesis(deps.organization),
      {
        caseId: CASE_ID,
        thesisId: THESIS_ID,
        statement: 'The ECB holds through Q2.',
        position: 'hold',
        proposedByDepartmentId: 'research-office',
        implications: ['position-sizing'],
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope(`${CASE_ID}-propose`, asDirector),
      deps,
    ),
    'ProposeThesis',
  )
  revisionId = (await repositories.theses.listForCase(CASE_ID))[0]!.revisionId

  /*
   * Three runs, because each store keys on one and a candidate is recorded once
   * per run. Three DIFFERENT entries, because only one run may be live per
   * assignment — and these three are the entries the playbook lets start with
   * nothing completed before them. The store does not care which desk produced
   * a run; the command that will care is not this one.
   */
  const desks = [
    ['macro-analysis', 'global-macro', 'macro-head'],
    ['rates-analysis', 'rates', 'rates-head'],
    ['quant-validation', 'quant-technical', 'quant-head'],
  ] as const

  for (const [entryKey, departmentId, employeeId] of desks) {
    const assignmentId = deriveAssignmentId(`${CASE_ID}-playbook`, entryKey)
    const startId = `${CASE_ID}-${entryKey}-start`
    await committed(
      await runCommand(
        startAgentRun(deps.organization),
        {
          caseId: CASE_ID,
          assignmentId,
          departmentId,
          evidenceSetId: evidenceSet.id,
          providerId: 'stub',
          providerVersion: '1',
          providerKind: 'stub' as const,
          agentContractVersion: '0',
          outputSchemaVersion: '0',
          identity: {
            kind: 'scenario' as const,
            scenarioId: 'success',
            stubVersion: '1',
          },
          budget: resolveExecutionBudget('stub', {
            firmCeiling: { deadlineMs: 30_000 },
          }),
        },
        envelope(startId, { kind: 'employee', employeeId }),
        deps,
      ),
      `StartAgentRun(${entryKey})`,
    )
    runIds.push(deriveRunId(startId, assignmentId))
  }
}

const basis = (
  over: Partial<GovernanceCandidateBasis> = {},
): GovernanceCandidateBasis => ({
  caseId: CASE_ID,
  thesisId: THESIS_ID,
  sourceRevisionId: revisionId,
  playbookId: MACRO_REGIME_PLAYBOOK_V6.id,
  playbookVersion: MACRO_REGIME_PLAYBOOK_V6.version,
  playbookEntryKey: 'verification',
  observedClaimIds: ['clm-a', 'clm-b'],
  ...over,
})

describe('a verification candidate survives the round trip', () => {
  it('stores a verdict and reads it back attesting itself', async () => {
    const store = runtime.container.repositories.producedVerifications
    const candidate = buildVerificationCandidate({
      runId: runIds[0]!,
      artifact: {
        status: 'verified-with-qualifications',
        findings: [
          {
            kind: 'unresolved-citation',
            claimId: 'clm-a',
            detail: 'The claim cites an observation the set does not hold.',
            blocking: true,
            severity: 'critical',
            correctionRequired: 'Cite an observation in the evidence set.',
          },
        ],
        claimsReviewed: ['clm-a', 'clm-b'],
      },
      basis: basis(),
      producedAt: AT,
    })

    await store.record(candidate)
    const read = (await store.get(runIds[0]!))!

    expect(read).not.toBeNull()
    expect(verificationCandidateHashMatches(read)).toBe(true)
    expect(read.contentHash).toBe(candidate.contentHash)
    expect(read.artifact.status).toBe('verified-with-qualifications')
    expect(read.artifact.findings).toHaveLength(1)
    expect(read.artifact.findings[0]!.correctionRequired).toBe(
      'Cite an observation in the evidence set.',
    )
    expect(read.basis.sourceRevisionId).toBe(revisionId)
    expect([...read.basis.observedClaimIds].sort()).toEqual(['clm-a', 'clm-b'])
  })

  it('is idempotent on the run, and refuses a different verdict for it', async () => {
    const store = runtime.container.repositories.producedVerifications
    const same = buildVerificationCandidate({
      runId: runIds[0]!,
      artifact: {
        status: 'verified-with-qualifications',
        findings: [
          {
            kind: 'unresolved-citation',
            claimId: 'clm-a',
            detail: 'The claim cites an observation the set does not hold.',
            blocking: true,
            severity: 'critical',
            correctionRequired: 'Cite an observation in the evidence set.',
          },
        ],
        claimsReviewed: ['clm-a', 'clm-b'],
      },
      basis: basis(),
      producedAt: AT,
    })
    /* A retry of the same work is not a second candidate. */
    await expect(store.record(same)).resolves.toBeUndefined()

    const different = buildVerificationCandidate({
      runId: runIds[0]!,
      artifact: { status: 'verified', findings: [], claimsReviewed: ['clm-a'] },
      basis: basis(),
      producedAt: AT,
    })
    await expect(store.record(different)).rejects.toBeInstanceOf(ConflictingRecordError)
  })
})

describe("a devil's advocate candidate survives the round trip", () => {
  it('stores objections and reads them back attesting themselves', async () => {
    const store = runtime.container.repositories.producedChallenges
    const candidate = buildDevilsAdvocateCandidate({
      runId: runIds[1]!,
      artifact: {
        challenges: [
          {
            contests: 'clm-a',
            kind: 'fragile-assumption',
            argument: 'The regime call rests on a decomposition nobody supplied.',
            counterEvidence: [],
            wouldBeResolvedBy: 'A published term-premium decomposition.',
            materiality: 'material',
          },
        ],
      },
      basis: basis({ playbookEntryKey: 'challenge' }),
      producedAt: AT,
    })

    await store.record(candidate)
    const read = (await store.get(runIds[1]!))!

    expect(devilsAdvocateCandidateHashMatches(read)).toBe(true)
    expect(read.artifact.challenges).toHaveLength(1)
    expect(read.artifact.challenges[0]!.materiality).toBe('material')
    /*
     * The three members a producer may not state are absent from what was
     * stored, because they are not on the proposal at all.
     */
    expect(read.artifact.challenges[0]).not.toHaveProperty('challengerKind')
    expect(read.artifact.challenges[0]).not.toHaveProperty('byDepartmentId')
    expect(read.artifact.challenges[0]).not.toHaveProperty('id')
  })
})

describe('a peer examination survives the round trip, objections or none', () => {
  it('stores an examination that raised nothing', async () => {
    const store = runtime.container.repositories.producedPeerExaminations
    const candidate = buildPeerExaminationCandidate({
      runId: runIds[2]!,
      artifact: { challenges: [] },
      basis: {
        ...basis({ playbookEntryKey: 'peer-examination' }),
        examinedDepartmentId: 'research-office',
      },
      producedAt: AT,
    })

    await store.record(candidate)
    const read = (await store.get(runIds[2]!))!

    expect(peerExaminationCandidateHashMatches(read)).toBe(true)
    /*
     * The database accepts it. A peer that looked and agreed performed the
     * scrutiny, and the table deliberately carries no non-empty check — unlike
     * the Devil's Advocate table beside it.
     */
    expect(read.artifact.challenges).toEqual([])
    expect(read.basis.examinedDepartmentId).toBe('research-office')
  })
})

describe('the stores are write-once at the privilege level', () => {
  /*
   * Step 2 of the `db/README` checklist, as the application role rather than as
   * the owner: the owner can do anything, so a permission test that runs as the
   * owner proves nothing at all.
   */
  const tables = [
    'produced_verification_reviews',
    'produced_devils_advocate_reviews',
    'produced_peer_examinations',
  ]

  for (const table of tables) {
    it(`grants SELECT on ${table} and refuses UPDATE`, async () => {
      const client = await db.connectAs(APP_ROLE)
      try {
        await expect(
          client.query(`SELECT count(*) FROM analysis.${table}`),
        ).resolves.toBeDefined()

        await expect(
          client.query(
            `UPDATE analysis.${table} SET content_hash = content_hash WHERE true`,
          ),
        ).rejects.toThrow(/permission denied/i)
      } finally {
        await client.end()
      }
    })

    it(`refuses DELETE on ${table}`, async () => {
      const client = await db.connectAs(APP_ROLE)
      try {
        await expect(
          client.query(`DELETE FROM analysis.${table} WHERE true`),
        ).rejects.toThrow(/permission denied/i)
      } finally {
        await client.end()
      }
    })
  }
})

describe('a review may cite only a candidate of its own kind', () => {
  /*
   * The constraint the three separate tables exist to make enforceable. Written
   * as SQL rather than through a command because no command populates the
   * back-link yet: this proves the database refuses the shape, which is what
   * the filing command will be relied upon not to produce.
   */
  it('refuses a verification review citing a devils-advocate candidate', async () => {
    await expect(
      db.owner.query(
        `INSERT INTO analysis.reviews
           (id, kind, case_id, tenant_id, scope, sequence, by_employee_id,
            by_department_id, at, devils_advocate_candidate_run_id)
         VALUES ('rev-bad', 'verification', $1, 'system', 'case', 1,
                 'verification-head', 'verification', now(), $2)`,
        [CASE_ID, runIds[1]],
      ),
    ).rejects.toThrow(/reviews_candidate_matches_kind/)
  })

  it('refuses a review citing two candidates at once', async () => {
    await expect(
      db.owner.query(
        `INSERT INTO analysis.reviews
           (id, kind, case_id, tenant_id, scope, sequence, by_employee_id,
            by_department_id, at, verification_candidate_run_id,
            devils_advocate_candidate_run_id)
         VALUES ('rev-bad-2', 'verification', $1, 'system', 'case', 1,
                 'verification-head', 'verification', now(), $2, $3)`,
        [CASE_ID, runIds[0], runIds[1]],
      ),
    ).rejects.toThrow(/reviews_candidate_matches_kind/)
  })
})
