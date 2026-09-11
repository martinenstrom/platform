/**
 * The Research Office synthesis candidate, against real PostgreSQL.
 *
 * The in-memory suite proves the rules. This proves the STORAGE — and the
 * distinction has cost this stage two migrations already: schema existence does
 * not prove runtime writability, and a column the runtime cannot write fails at
 * the first real command with every suite green behind it.
 *
 * So everything here runs as the application role, through production commands,
 * against the migrated schema:
 *
 *   - `produced_syntheses` accepts a candidate and reads it back attesting
 *     itself;
 *   - `aggregations.synthesis_run_id` records which candidate became the
 *     position, and `manager_agent_principal_id` records who stood behind it;
 *   - `thesis_revisions.proposed_by_agent_principal_id` does the same for the
 *     revision, with the employee column left null rather than filled with the
 *     human Research Director;
 *   - the stale-candidate refusal holds when the accepted work moves.
 *
 * The organisation comes from the seed, not from a fixture: the Research Office
 * agent is authorised here only because migration 0046 granted its role the
 * department-analysis capability, which is the property worth proving.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import { startRuntime, type Runtime } from './macroFlowHarness'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { recordContribution } from '~/application/analysis/commands/recordContribution'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import {
  deriveAssignmentId,
  deriveClaimId,
  deriveRevisionId,
  deriveRunId,
} from '~/application/analysis/commands/eventIdentity'
import { MACRO_REGIME_PLAYBOOK_V5 } from '~/application/analysis/macroPlaybook'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { buildEvidenceSet, synthesisHashMatches } from '~/domain/analysis'
import type { AgentClaim, SynthesisArtifact } from '~/domain/analysis'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import type { CommandDeps } from '~/application/analysis/commands/runCommand'

let db: TestDatabase
let runtime: Runtime
let deps: CommandDeps

const AT = '2026-09-07T09:00:00.000Z'
const OFFICE_AGENT = 'research-office-agent'

const asAgent = { kind: 'institutional-agent' as const, agentPrincipalId: OFFICE_AGENT }

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  runtime = await startRuntime(await db.loginUrlFor(APP_ROLE))
  deps = await runtime.container.commandDeps()
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
  correlationId: 'office-synthesis',
  actor,
  initiator: { kind: 'orchestrator', orchestratorId: 'office-synthesis-suite' },
  occurredAt: AT,
  ...over,
})

const committed = async (result: { outcome: string }, step: string) => {
  if (result.outcome !== 'committed') {
    throw new Error(`${step} did not commit: ${JSON.stringify(result)}`)
  }
  return result
}

const DECLARATION = {
  providerId: 'stub',
  providerVersion: '1',
  providerKind: 'stub' as const,
  agentContractVersion: '0',
  outputSchemaVersion: '0',
  identity: { kind: 'scenario' as const, scenarioId: 'success', stubVersion: '1' },
  budget: resolveExecutionBudget('stub', { firmCeiling: { deadlineMs: 30_000 } }),
}

const claim = (id: string, statement: string): AgentClaim =>
  ({
    id,
    type: 'observation',
    statement,
    evidenceRefs: [],
    contradictingEvidenceRefs: [],
    confidence: {
      level: 'insufficient',
      basis: ['suite contribution; no evidence was examined'],
      cappedBy: 'no-evidence',
    },
    temporalScope: { asOf: AT },
    status: 'insufficient-evidence',
  }) as AgentClaim

/* -------------------------------------------------------------- the case */

interface Seeded {
  caseId: string
  revisionId: string
  macroRunId: string
  macroClaimId: string
  ratesRunId: string
  ratesClaimId: string
  evidenceSetId: string
}

let seeded: Seeded
let caseCounter = 0

/**
 * A case with the two required desks accepted, and the office untouched.
 *
 * The specialist contributions are made by their human heads, which is the
 * point of the setup: what is being proved is the OFFICE acting for itself, and
 * the work it reconciles has to have arrived the ordinary way.
 */
async function seedCase(): Promise<Seeded> {
  caseCounter += 1
  const caseId = `office-synth-${caseCounter}`
  const thesisId = `${caseId}-thesis`
  const repositories = runtime.container.repositories

  const evidenceSet = buildEvidenceSet({
    items: [],
    assembledAt: AT,
    correlationId: 'office-synthesis',
  })
  await repositories.evidence.save(evidenceSet)

  await committed(
    await runCommand(
      openInvestmentCase(deps.organization),
      {
        caseId,
        subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
        question: 'Does the ECB cut before Q2?',
        ownerEmployeeId: 'research-director',
        participatingDepartmentIds: ['research-office'],
      },
      envelope(`${caseId}-open`, { kind: 'employee', employeeId: 'research-director' }),
      deps,
    ),
    'OpenInvestmentCase',
  )

  await committed(
    await runCommand(
      instantiatePlaybook(deps.organization),
      {
        caseId,
        playbookId: MACRO_REGIME_PLAYBOOK_V5.id,
        playbookVersion: MACRO_REGIME_PLAYBOOK_V5.version,
        onBehalfOfDepartmentId: 'research-office',
      },
      envelope(
        `${caseId}-playbook`,
        { kind: 'employee', employeeId: 'research-director' },
        { expectedVersion: (await repositories.cases.get(caseId))!.version },
      ),
      deps,
    ),
    'InstantiatePlaybook',
  )

  await committed(
    await runCommand(
      proposeThesis(deps.organization),
      {
        caseId,
        thesisId,
        statement: 'The ECB holds through Q1 and cuts in June.',
        position: 'hold',
        proposedByDepartmentId: 'research-office',
        implications: ['position-sizing'],
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope(`${caseId}-propose`, {
        kind: 'employee',
        employeeId: 'research-director',
      }),
      deps,
    ),
    'ProposeThesis',
  )

  const contribute = async (
    entryKey: string,
    departmentId: string,
    employeeId: string,
    statement: string,
  ) => {
    const actor = { kind: 'employee' as const, employeeId }
    const assignmentId = deriveAssignmentId(`${caseId}-playbook`, entryKey)
    const startId = `${caseId}-${entryKey}-start`

    await committed(
      await runCommand(
        startAgentRun(deps.organization),
        {
          caseId,
          assignmentId,
          departmentId,
          evidenceSetId: evidenceSet.id,
          ...DECLARATION,
        },
        envelope(startId, actor),
        deps,
      ),
      `StartAgentRun(${entryKey})`,
    )
    const runId = deriveRunId(startId, assignmentId)
    const recordId = `${caseId}-${entryKey}-record`

    await committed(
      await runCommand(
        recordContribution(deps.organization),
        {
          caseId,
          runId,
          departmentId,
          claims: [claim(`${entryKey}-1`, statement)],
          observedStates: ['running'],
          usage: { state: 'not-applicable' },
        },
        envelope(recordId, actor),
        deps,
      ),
      `RecordContribution(${entryKey})`,
    )
    await committed(
      await runCommand(
        acceptContribution(deps.organization),
        { caseId, runId, departmentId },
        envelope(`${caseId}-${entryKey}-accept`, actor),
        deps,
      ),
      `AcceptContribution(${entryKey})`,
    )
    return { runId, claimId: deriveClaimId(recordId, `${entryKey}-1`) }
  }

  const macro = await contribute(
    'macro-analysis',
    'global-macro',
    'macro-head',
    'Policy stays restrictive into the summer',
  )
  const rates = await contribute(
    'rates-analysis',
    'rates',
    'rates-head',
    'The curve prices the first cut in June',
  )

  return {
    caseId,
    revisionId: deriveRevisionId(`${caseId}-propose`, thesisId),
    macroRunId: macro.runId,
    macroClaimId: macro.claimId,
    ratesRunId: rates.runId,
    ratesClaimId: rates.claimId,
    evidenceSetId: evidenceSet.id,
  }
}

beforeEach(async () => {
  seeded = await seedCase()
})

/* ------------------------------------------------------------ the office */

const officeAssignmentId = () =>
  deriveAssignmentId(`${seeded.caseId}-playbook`, 'aggregation')
const officeStartId = () => `${seeded.caseId}-office-start`
const officeRunId = () => deriveRunId(officeStartId(), officeAssignmentId())

const artifact = (): SynthesisArtifact => ({
  statement: 'The ECB holds through Q1 and cuts in June, with the curve agreeing.',
  position: 'hold',
  rationale: 'Macro and Rates agree on the path; neither contradicts the other.',
  invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
  implications: ['position-sizing'],
  inputRunIds: [seeded.macroRunId, seeded.ratesRunId],
  dispositions: [
    { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
    { claimId: seeded.ratesClaimId, disposition: 'adopted-supporting' },
  ],
  optionalInputs: [
    {
      playbookEntryKey: 'quant-validation',
      availability: 'unavailable-at-aggregation',
      materiallyRelevant: false,
      explanation: 'The quant desk did not contribute for this case.',
    },
  ],
})

/** The office's run: started, produced with a synthesis, and accepted. */
async function officeProduces(synthesis: SynthesisArtifact | null = artifact()) {
  await committed(
    await runCommand(
      startAgentRun(deps.organization),
      {
        caseId: seeded.caseId,
        assignmentId: officeAssignmentId(),
        departmentId: 'research-office',
        evidenceSetId: seeded.evidenceSetId,
        revisionId: seeded.revisionId,
        ...DECLARATION,
      },
      envelope(officeStartId(), asAgent),
      deps,
    ),
    'StartAgentRun(office)',
  )

  const recordId = `${seeded.caseId}-office-record`
  const recorded = await runCommand(
    recordContribution(deps.organization),
    {
      caseId: seeded.caseId,
      runId: officeRunId(),
      departmentId: 'research-office',
      claims: [claim('office-1', 'The two desks agree on direction and on timing')],
      observedStates: ['running'],
      usage: { state: 'not-applicable' },
      ...(synthesis ? { synthesis } : {}),
    },
    envelope(recordId, asAgent),
    deps,
  )
  await committed(recorded, 'RecordContribution(office)')

  await committed(
    await runCommand(
      acceptContribution(deps.organization),
      {
        caseId: seeded.caseId,
        runId: officeRunId(),
        departmentId: 'research-office',
      },
      envelope(`${seeded.caseId}-office-accept`, asAgent),
      deps,
    ),
    'AcceptContribution(office)',
  )
}

const adopt = (commandId = `${seeded.caseId}-adopt`) =>
  runCommand(
    aggregateManagerConclusion(deps.organization),
    {
      caseId: seeded.caseId,
      sourceRevisionId: seeded.revisionId,
      departmentId: 'research-office',
      synthesisFromRunId: officeRunId(),
    },
    envelope(commandId, asAgent),
    deps,
  )

/* ------------------------------------------------------------- the tests */

describe('the candidate survives the round trip', () => {
  it('stores and reads back a synthesis that attests itself', async () => {
    await officeProduces()

    const candidate = await runtime.container.repositories.producedSyntheses.get(
      officeRunId(),
    )
    expect(candidate).not.toBeNull()
    /*
     * The digest is recomputed from the row on the way out and compared with
     * the stored one. A candidate that no longer hashes to its own contents is
     * a malformed row, not a candidate with an interesting hash.
     */
    expect(synthesisHashMatches(candidate!)).toBe(true)
    expect(candidate!.artifact).toEqual(artifact())
    expect(candidate!.basis.sourceRevisionId).toBe(seeded.revisionId)
    expect(candidate!.basis.playbookId).toBe(MACRO_REGIME_PLAYBOOK_V5.id)
    /*
     * The producing run is outside its own basis: it was still running when
     * the candidate was written, and counting it would make every candidate
     * stale against itself.
     */
    expect([...candidate!.basis.observedCompletedRunIds].sort()).toEqual(
      [seeded.macroRunId, seeded.ratesRunId].sort(),
    )
  })

  it('leaves a contribution without one absent rather than empty', async () => {
    await officeProduces(null)
    expect(
      await runtime.container.repositories.producedSyntheses.get(officeRunId()),
    ).toBeNull()
  })
})

describe('adoption writes what the schema promised it could', () => {
  it('records the agent principal and the candidate it adopted', async () => {
    await officeProduces()
    const candidate = await runtime.container.repositories.producedSyntheses.get(
      officeRunId(),
    )

    const adopted = await adopt()
    await committed(adopted, 'AggregateManagerConclusion')

    const revisionId = (adopted as { value: { revisionId: string } }).value.revisionId
    const revision = await runtime.container.repositories.theses.get(revisionId)
    const aggregation = await runtime.container.repositories.aggregations.get(
      revision!.aggregationId!,
    )

    /*
     * The join that closes the trace. Not "the prose matches" — the aggregation
     * names the run whose candidate it adopted, and the candidate still hashes
     * to its own contents.
     */
    expect(aggregation!.synthesisRunId).toBe(officeRunId())
    expect(revision!.statement).toBe(candidate!.artifact.statement)
    expect(synthesisHashMatches(candidate!)).toBe(true)

    /*
     * The agent columns migration 0040 added, written for the first time by a
     * production command. Schema existence proved nothing until this line ran.
     */
    expect(aggregation!.managerAgentPrincipalId).toBe(OFFICE_AGENT)
    expect(aggregation!.managerEmployeeId).toBeUndefined()
    expect(revision!.proposedByAgentPrincipalId).toBe(OFFICE_AGENT)
    expect(revision!.proposedByEmployeeId).toBeUndefined()
  })

  it('is authorised by the granted capability and not by the org chart', async () => {
    /*
     * The Research Office agent is not the department's manager — the org chart
     * names a person — so it holds this authority only because migration 0046
     * granted its role the department-analysis capability. The ledger says
     * which authority was exercised.
     */
    await officeProduces()
    await committed(await adopt(), 'AggregateManagerConclusion')

    const entry = await runtime.container.repositories.commands.find(
      `${seeded.caseId}-adopt`,
    )
    expect(entry!.intent.authorizationBasis).toBe('holds-department-analysis-mandate')
    expect(entry!.intent.actor.agentPrincipalId).toBe(OFFICE_AGENT)
    expect(entry!.intent.actor.employeeId).toBeNull()
  })
})

describe('the database refuses a synthesis with no candidate behind it', () => {
  it('will not let an agent aggregation exist without one', async () => {
    /*
     * The command already refuses it. This is the same rule where a migration,
     * a repair script or a hand-written statement cannot route around it — an
     * agent aggregation with no candidate would mean model output reached
     * `thesis_revisions` without crossing the boundary at all.
     */
    await officeProduces()
    await committed(await adopt(), 'AggregateManagerConclusion')

    await expect(
      db.owner.query(
        `UPDATE analysis.aggregations SET synthesis_run_id = NULL
         WHERE manager_agent_principal_id IS NOT NULL`,
      ),
    ).rejects.toThrow(/aggregations_agent_adopts_a_candidate/)
  })

  it('will not let a human aggregation claim one', async () => {
    await officeProduces()
    await committed(await adopt(), 'AggregateManagerConclusion')

    await expect(
      db.owner.query(
        `UPDATE analysis.aggregations
         SET manager_agent_principal_id = NULL, manager_employee_id = 'research-director'
         WHERE manager_agent_principal_id IS NOT NULL`,
      ),
    ).rejects.toThrow(/aggregations_agent_adopts_a_candidate/)
  })
})

describe('a candidate produced against work the firm has moved past', () => {
  it('is refused, and no revision is written', async () => {
    await officeProduces()

    const before = await runtime.container.repositories.theses.listForCase(
      seeded.caseId,
    )

    /* An optional desk contributes after the office concluded without it. */
    const assignmentId = deriveAssignmentId(
      `${seeded.caseId}-playbook`,
      'quant-validation',
    )
    const startId = `${seeded.caseId}-quant-start`
    const actor = { kind: 'employee' as const, employeeId: 'quant-head' }
    await committed(
      await runCommand(
        startAgentRun(deps.organization),
        {
          caseId: seeded.caseId,
          assignmentId,
          departmentId: 'quant-technical',
          evidenceSetId: seeded.evidenceSetId,
          ...DECLARATION,
        },
        envelope(startId, actor),
        deps,
      ),
      'StartAgentRun(quant)',
    )
    const quantRunId = deriveRunId(startId, assignmentId)
    await committed(
      await runCommand(
        recordContribution(deps.organization),
        {
          caseId: seeded.caseId,
          runId: quantRunId,
          departmentId: 'quant-technical',
          claims: [claim('quant-1', 'The indicators moved after the office concluded')],
          observedStates: ['running'],
          usage: { state: 'not-applicable' },
        },
        envelope(`${seeded.caseId}-quant-record`, actor),
        deps,
      ),
      'RecordContribution(quant)',
    )
    await committed(
      await runCommand(
        acceptContribution(deps.organization),
        { caseId: seeded.caseId, runId: quantRunId, departmentId: 'quant-technical' },
        envelope(`${seeded.caseId}-quant-accept`, actor),
        deps,
      ),
      'AcceptContribution(quant)',
    )

    const refused = await adopt()
    expect(refused).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
    expect((refused as { rejection: { detail: string } }).rejection.detail).toContain(
      quantRunId,
    )

    const after = await runtime.container.repositories.theses.listForCase(seeded.caseId)
    expect(after.length).toBe(before.length)
  })
})
