/**
 * A case with real contributions on it, ready to be aggregated.
 *
 * Building one takes four commands per desk, so it lives here rather than
 * three times over in the C1C-3 suites. Everything goes through the real
 * command path — no repository writes — because an aggregation test that
 * seeded its inputs by hand would be aggregating work the institution never
 * accepted, which is the one thing the command refuses.
 *
 * Not a `.test.ts` file: it defines no tests.
 */

import type { AgentClaim, Organization } from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  deriveAssignmentId,
  deriveClaimId,
  deriveRevisionId,
  deriveRunId,
} from '~/application/analysis/commands/eventIdentity'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { recordContribution } from '~/application/analysis/commands/recordContribution'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import { EMPLOYEE_BY_DEPARTMENT } from './testOrganization'

export const AT = '2026-07-30T09:00:00.000Z'
export const LATER = '2026-07-30T11:00:00.000Z'
export const EVIDENCE_SET_ID = 'set-agg'

export interface Seeded {
  caseId: string
  thesisId: string
  revisionId: string
  macroRunId: string
  macroClaimId: string
  quantRunId: string
  quantClaimId: string
  aggregationRunId: string
  aggregationClaimId: string
}

const envelopeFor = (
  commandId: string,
  employeeId: string,
  over: Partial<CommandEnvelope> = {},
): CommandEnvelope => ({
  commandId,
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: AT,
  ...over,
})

/** One claim, admissible and deliberately unsupported: nothing was examined. */
function claimFor(id: string, statement: string, opposesThesisId?: string): AgentClaim {
  return {
    id,
    type: 'observation',
    statement,
    evidenceRefs: [],
    contradictingEvidenceRefs: [],
    confidence: {
      level: 'insufficient',
      basis: ['test contribution; no evidence was examined'],
      cappedBy: 'no-evidence',
    },
    temporalScope: { asOf: AT },
    status: 'insufficient-evidence',
    ...(opposesThesisId ? { opposesThesisId } : {}),
  } as AgentClaim
}

const DECLARATION = {
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
  /*
   * Resolved through the real path rather than hand-built, so the harness
   * exercises what production does: a stub consumes nothing external, so
   * tokens and cost come back `not-applicable` while the deadline still binds.
   */
  budget: resolveExecutionBudget('stub', { firmCeiling: { deadlineMs: 30_000 } }),
}

/**
 * Starts and completes one desk's contribution.
 *
 * Returns the run and claim ids the firm gave them — derived, not the
 * provider's own names.
 */
export async function contributionFor(
  _repositories: AnalysisRepositories,
  deps: CommandDeps,
  organization: Organization,
  args: {
    caseId: string
    entryKey: string
    departmentId: string
    commandPrefix: string
    /** Present when the claim argues against the lineage. */
    opposesThesisId?: string
    statement?: string
    instantiateCommandId?: string
  },
): Promise<{ runId: string; claimId: string }> {
  const assignmentId = deriveAssignmentId(
    args.instantiateCommandId ?? `${args.caseId}-inst`,
    args.entryKey,
  )
  const employeeId = EMPLOYEE_BY_DEPARTMENT[args.departmentId]!

  await runCommand(
    startAgentRun(organization),
    {
      caseId: args.caseId,
      assignmentId,
      departmentId: args.departmentId,
      evidenceSetId: EVIDENCE_SET_ID,
      ...DECLARATION,
    },
    envelopeFor(`${args.commandPrefix}-start`, employeeId),
    deps,
  )

  const runId = deriveRunId(`${args.commandPrefix}-start`, assignmentId)
  const providerClaimId = `${args.entryKey}-claim`

  const recorded = await runCommand(
    recordContribution(organization),
    {
      caseId: args.caseId,
      runId,
      departmentId: args.departmentId,
      claims: [
        claimFor(
          providerClaimId,
          args.statement ?? `${args.departmentId} reports on the regime`,
          args.opposesThesisId,
        ),
      ],
      observedStates: ['running'],
      usage: { state: 'not-applicable' },
    },
    envelopeFor(`${args.commandPrefix}-record`, employeeId),
    deps,
  )

  /*
   * Recording produces work; it does not make it institutional. A person
   * accepts, and only then do the claims reach the case.
   *
   * The harness does this because the tests below are about what the
   * institution does with accepted work. That every provider kind traverses
   * acceptance — recorded and stub included — is the point: an acceptance step
   * only live work went through would be untested by every test here.
   *
   * Some callers deliberately drive this helper into a state where no run
   * exists, to prove the institution refuses work it never commissioned.
   * Recording fails there, as it always has, and there is nothing to accept —
   * so acceptance is skipped rather than asserted, leaving those callers seeing
   * exactly what they saw before acceptance existed.
   */
  if (recorded.outcome !== 'committed') {
    return {
      runId,
      claimId: deriveClaimId(`${args.commandPrefix}-record`, providerClaimId),
    }
  }

  const accepted = await runCommand(
    acceptContribution(organization),
    {
      caseId: args.caseId,
      runId,
      departmentId: args.departmentId,
    },
    envelopeFor(`${args.commandPrefix}-accept`, employeeId),
    deps,
  )
  if (accepted.outcome !== 'committed') {
    throw new Error(`acceptance failed: ${JSON.stringify(accepted)}`)
  }

  return {
    runId,
    claimId: deriveClaimId(`${args.commandPrefix}-record`, providerClaimId),
  }
}

/**
 * A case with a thesis and up to three accepted contributions.
 *
 * The macro desk supports the thesis, the quant desk argues against it, and the
 * Research Office has contributed its own analysis — which is what makes the
 * manager's act a separate one from the desk's.
 */
export async function seedAggregatableCase(
  repositories: AnalysisRepositories,
  deps: CommandDeps,
  organization: Organization,
  options: {
    caseId?: string
    completeMacroRun?: boolean
    completeQuantRun?: boolean
    completeAggregationRun?: boolean
  } = {},
): Promise<Seeded> {
  const caseId = options.caseId ?? 'case-1'
  const thesisId = `${caseId}-thesis`
  const instantiateCommandId = `${caseId}-inst`

  await repositories.evidence.save({
    id: EVIDENCE_SET_ID,
    assembledAt: AT,
    correlationId: 'corr-1',
    items: [],
    disagreements: [],
    coTemporality: { kind: 'empty' },
  })

  await runCommand(
    openInvestmentCase(organization),
    {
      caseId,
      subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
      question: 'Does the ECB cut before Q2?',
      ownerEmployeeId: 'research-director',
      participatingDepartmentIds: ['research-office'],
    },
    envelopeFor(`${caseId}-open`, 'research-director'),
    deps,
  )

  await runCommand(
    instantiatePlaybook(organization),
    {
      caseId,
      playbookId: MACRO_REGIME_PLAYBOOK.id,
      playbookVersion: MACRO_REGIME_PLAYBOOK.version,
      onBehalfOfDepartmentId: 'research-office',
    },
    envelopeFor(instantiateCommandId, 'research-director', { expectedVersion: 1 }),
    deps,
  )

  await runCommand(
    proposeThesis(organization),
    {
      caseId,
      thesisId,
      statement: 'The ECB holds through Q2.',
      position: 'hold',
      invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      implications: [],
      proposedByDepartmentId: 'research-office',
    },
    envelopeFor(`${caseId}-thesis`, 'research-director'),
    deps,
  )

  const revisionId = deriveRevisionId(`${caseId}-thesis`, thesisId)

  const macro =
    options.completeMacroRun === false
      ? { runId: '', claimId: '' }
      : await contributionFor(repositories, deps, organization, {
          caseId,
          entryKey: 'macro-analysis',
          departmentId: 'global-macro',
          commandPrefix: `${caseId}-macro`,
          statement: 'Policy stays restrictive into the summer',
          instantiateCommandId,
        })

  const quant =
    options.completeQuantRun === false
      ? { runId: '', claimId: '' }
      : await contributionFor(repositories, deps, organization, {
          caseId,
          entryKey: 'quant-validation',
          departmentId: 'quant-technical',
          commandPrefix: `${caseId}-quant`,
          // Argues against the lineage, which is what makes scope selection
          // interesting: it cannot be left out.
          opposesThesisId: thesisId,
          statement: 'The regime indicators put the timing a quarter earlier',
          instantiateCommandId,
        })

  const aggregationRun =
    options.completeAggregationRun === false
      ? { runId: '', claimId: '' }
      : await contributionFor(repositories, deps, organization, {
          caseId,
          entryKey: 'aggregation',
          departmentId: 'research-office',
          commandPrefix: `${caseId}-agg`,
          statement: 'Reconciling the desks leaves the direction intact',
          instantiateCommandId,
        })

  return {
    caseId,
    thesisId,
    revisionId,
    macroRunId: macro.runId,
    macroClaimId: macro.claimId,
    quantRunId: quant.runId,
    quantClaimId: quant.claimId,
    aggregationRunId: aggregationRun.runId,
    aggregationClaimId: aggregationRun.claimId,
  }
}
