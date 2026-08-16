/**
 * The deterministic Macro workflow, against PostgreSQL, across a restart.
 *
 * Two things this file exists to make possible, and neither is a convenience.
 *
 * **A canonical institutional projection.** Comparing two runtimes by row
 * counts or by a top-level boolean would pass while the record underneath had
 * quietly changed meaning — a review attached to the wrong revision, a blocker
 * pointing at a different claim, a Risk resolution reloaded under the wrong
 * rule version. `institutionalState` reads everything the firm would be held to
 * and normalises it into one ordered structure, with the volatile fields named
 * and excluded rather than filtered by hope.
 *
 * **A restart boundary that is actually a boundary.** `restart` closes the
 * pool, proves the old runtime is dead by requiring a read through it to
 * fail, drops every reference, and builds a new container that can only have
 * come by its state from the database. Retaining a repository, a pool or a
 * domain object across that line would make the whole exercise a test of
 * JavaScript's garbage collector.
 */

import { expect } from 'vitest'
import {
  createAnalysisContainer,
  type AnalysisContainer,
} from '~/infrastructure/analysis/container'
import { runCommand } from '~/application/analysis/commands/runCommand'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { recordContribution } from '~/application/analysis/commands/recordContribution'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { failAgentRun } from '~/application/analysis/commands/failAgentRun'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { resolveConditionalRequirement } from '~/application/analysis/commands/resolveConditionalRequirement'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { recordVerificationReview } from '~/application/analysis/commands/recordVerificationReview'
import { recordDevilsAdvocateReview } from '~/application/analysis/commands/recordDevilsAdvocateReview'
import { recordRiskReview } from '~/application/analysis/commands/recordRiskReview'
import { submitForCioDecision } from '~/application/analysis/commands/submitForCioDecision'
import { recordCaseDecision } from '~/application/analysis/commands/recordCaseDecision'
import { returnFromCioReview } from '~/application/analysis/commands/returnFromCioReview'
import { reopenForReconsideration } from '~/application/analysis/commands/reopenForReconsideration'
import { revisionEligibility } from '~/application/analysis/eligibility'
import {
  deriveAggregationId,
  deriveRevisionId,
} from '~/application/analysis/commands/eventIdentity'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import { buildEvidenceSet } from '~/domain/analysis'
import type { AgentClaim, InvestmentImplication } from '~/domain/analysis'
import { eligibilityPolicy } from '~/domain/analysis'

export const AT = '2026-08-01T09:00:00.000Z'
export const LATER = '2026-08-01T11:00:00.000Z'
export const LATEST = '2026-08-01T13:00:00.000Z'
/*
 * A deferral waits for something. These are days later, not minutes, because
 * that is what a reconsideration is: the firm stopped, a condition was met, and
 * it looked again. Fixtures sharing one timestamp would make the decision
 * history order fall back to identifiers, which is not the order anything
 * happened in.
 */
export const AFTER_DEFERRAL = '2026-08-14T09:00:00.000Z'
export const AFTER_RECONSIDERATION = '2026-08-14T11:00:00.000Z'

export const CLOCK = {
  isoNow: () => AT,
  epochMs: () => Date.parse(AT),
  now: () => new Date(AT),
}

/* ------------------------------------------------------- the restart boundary */

export interface Runtime {
  container: AnalysisContainer
  /** Incremented on each restart, so a projection can name which runtime read it. */
  generation: number
}

export async function startRuntime(
  connectionString: string,
  generation = 1,
): Promise<Runtime> {
  const container = await createAnalysisContainer({
    connectionString,
    buildId: `macro-flow-${generation}`,
    clock: CLOCK,
  })
  return { container, generation }
}

/**
 * Destroys a runtime and builds a new one that shares nothing with it.
 *
 * The assertion in the middle is the proof, and it is deliberately a read that
 * MUST fail: if any repository state had survived in process memory, the read
 * would be served from it and succeed. A closed pool cannot answer, so success
 * here would mean the restart never happened.
 */
export async function restart(
  runtime: Runtime,
  connectionString: string,
): Promise<Runtime> {
  const dying = runtime.container
  const caseRepository = dying.repositories.cases

  await dying.close()

  let refused = false
  try {
    await caseRepository.get('any-case-at-all')
  } catch {
    refused = true
  }
  expect(
    refused,
    'the old runtime answered a read after its pool was closed — either the ' +
      'pool is still open or a repository is serving from process memory, and ' +
      'either way this is not a restart',
  ).toBe(true)

  /*
   * Every reference the caller could still reach is dropped by returning a new
   * object rather than mutating this one: nothing in the new runtime is
   * assembled from anything in the old, including the organization cache, which
   * lives inside `createOrganizationReader` and is therefore per-container.
   */
  return startRuntime(connectionString, runtime.generation + 1)
}

/* --------------------------------------------------------------- the workflow */

const envelope = (
  commandId: string,
  employeeId: string,
  over: Partial<CommandEnvelope> = {},
): CommandEnvelope => ({
  commandId,
  correlationId: 'macro-flow',
  actor: { kind: 'employee', employeeId },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: AT,
  ...over,
})

const claim = (id: string, statement: string, opposesThesisId?: string): AgentClaim =>
  ({
    id,
    type: 'observation',
    statement,
    evidenceRefs: [],
    contradictingEvidenceRefs: [],
    confidence: {
      level: 'insufficient',
      basis: ['deterministic fixture; no evidence was examined'],
      cappedBy: 'no-evidence',
    },
    temporalScope: { asOf: AT },
    status: 'insufficient-evidence',
    ...(opposesThesisId ? { opposesThesisId } : {}),
  }) as AgentClaim

const DECLARATION = {
  providerId: 'stub',
  providerVersion: '1',
  providerKind: 'stub' as const,
  agentContractVersion: '0',
  outputSchemaVersion: '0',
  identity: { kind: 'scenario' as const, scenarioId: 'success', stubVersion: '1' },
}

export interface MacroCase {
  caseId: string
  thesisId: string
  /** The desk's original proposal. */
  proposedRevisionId: string
  /** The manager's synthesis — the one governance reads. */
  revisionId: string
  aggregationId: string
  macroClaimId: string
  quantClaimId: string | null
  aggregationClaimId: string
  evidenceSetId: string
}

/** Defaults to an implementable position, so the Risk rule has something to read. */
const implicationsOf = (options: { implications?: readonly InvestmentImplication[] }) => [
  ...(options.implications ?? (['position-sizing'] as const)),
]

export interface MacroOptions {
  caseId: string
  /** `complete` accepts the optional Quant work, `fail` records a failed run. */
  quant?: 'complete' | 'omit' | 'fail'
  /** The manager retains this claim as an unresolved disagreement. */
  decisionCriticalDisagreement?: boolean
  implications?: readonly InvestmentImplication[]
}

/** Steps 4–11: a case with a manager-aggregated revision, ready for governance. */
export async function runMacroToAggregation(
  runtime: Runtime,
  options: MacroOptions,
): Promise<MacroCase> {
  const { caseId } = options
  const deps = await runtime.container.commandDeps()
  const repositories = runtime.container.repositories
  const thesisId = `${caseId}-thesis`
  /*
   * Content-addressed, so the id is a hash of what is in it and cannot be
   * chosen. Every case here assembles the same empty set and therefore shares
   * one — which is what content addressing means, not a collision.
   */
  const evidenceSet = buildEvidenceSet({
    items: [],
    assembledAt: AT,
    correlationId: 'macro-flow',
  })
  const evidenceSetId = evidenceSet.id
  await repositories.evidence.save(evidenceSet)

  const expect2 = async (result: { outcome: string }, step: string) => {
    if (result.outcome !== 'committed') {
      throw new Error(`${step} did not commit: ${JSON.stringify(result)}`)
    }
    return result
  }

  await expect2(
    await runCommand(
      openInvestmentCase(deps.organization),
      {
        caseId,
        subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
        question: 'Does the ECB cut before Q2?',
        ownerEmployeeId: 'research-director',
        participatingDepartmentIds: ['research-office'],
      },
      envelope(`${caseId}-open`, 'research-director'),
      deps,
    ),
    'OpenInvestmentCase',
  )

  const version = async () => (await repositories.cases.get(caseId))!.version

  await expect2(
    await runCommand(
      instantiatePlaybook(deps.organization),
      {
        caseId,
        playbookId: MACRO_REGIME_PLAYBOOK.id,
        playbookVersion: MACRO_REGIME_PLAYBOOK.version,
        onBehalfOfDepartmentId: 'research-office',
      },
      envelope(`${caseId}-playbook`, 'research-director', {
        expectedVersion: await version(),
      }),
      deps,
    ),
    'InstantiatePlaybook',
  )

  await expect2(
    await runCommand(
      proposeThesis(deps.organization),
      {
        caseId,
        thesisId,
        statement: 'The ECB holds through Q1 and cuts in June.',
        position: 'hold',
        proposedByDepartmentId: 'research-office',
        implications: implicationsOf(options),
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope(`${caseId}-propose`, 'research-director'),
      deps,
    ),
    'ProposeThesis',
  )
  const proposedRevisionId = deriveRevisionId(`${caseId}-propose`, thesisId)

  /** Starts and completes one desk's contribution; returns the stored claim id. */
  const contribute = async (
    entryKey: string,
    departmentId: string,
    employeeId: string,
    claims: AgentClaim[],
  ) => {
    const assignments = await repositories.assignments.listForCase(caseId)
    const assignment = assignments.find((a) => a.playbookEntryKey === entryKey)!
    const startId = `${caseId}-${entryKey}-start`

    await expect2(
      await runCommand(
        startAgentRun(deps.organization),
        {
          caseId,
          assignmentId: assignment.id,
          departmentId,
          evidenceSetId,
          ...DECLARATION,
        },
        envelope(startId, employeeId),
        deps,
      ),
      `StartAgentRun(${entryKey})`,
    )

    const runId = (await repositories.runs.listForCase(caseId)).find(
      (run) => run.assignmentId === assignment.id && run.state === 'running',
    )!.id

    await expect2(
      await runCommand(
        recordContribution(deps.organization),
        {
          caseId,
          runId,
          departmentId,
          claims,
          observedStates: ['running'],
          usage: { state: 'not-applicable' },
        },
        envelope(`${caseId}-${entryKey}-record`, employeeId),
        deps,
      ),
      `RecordContribution(${entryKey})`,
    )

    /*
     * Recording produces work; a person makes it institutional. Until this act
     * the claims sit in the produced-claim store and satisfy nothing — so a
     * flow that stopped at recording would have every downstream gate below
     * blocking on work that exists and was never judged.
     *
     * Every provider kind traverses acceptance, recorded ones included. That is
     * the point: an acceptance step only live work went through would be
     * exercised by none of these scenarios.
     */
    await expect2(
      await runCommand(
        acceptContribution(deps.organization),
        { caseId, runId, departmentId },
        envelope(`${caseId}-${entryKey}-accept`, employeeId),
        deps,
      ),
      `AcceptContribution(${entryKey})`,
    )

    const stored = await repositories.runs.get(runId)
    return { runId, claimIds: stored!.claims.map((c) => c.id) }
  }

  const macro = await contribute('macro-analysis', 'global-macro', 'macro-head', [
    claim('macro-1', 'Policy rates stay restrictive through Q1.'),
  ])

  let quant: { runId: string; claimIds: string[] } | null = null
  if (options.quant === 'complete') {
    quant = await contribute('quant-validation', 'quant-technical', 'quant-head', [
      claim('quant-1', 'The forward curve prices a cut two months earlier.', thesisId),
    ])
  } else if (options.quant === 'fail') {
    const assignments = await repositories.assignments.listForCase(caseId)
    const assignment = assignments.find((a) => a.playbookEntryKey === 'quant-validation')!
    await expect2(
      await runCommand(
        startAgentRun(deps.organization),
        {
          caseId,
          assignmentId: assignment.id,
          departmentId: 'quant-technical',
          evidenceSetId,
          ...DECLARATION,
        },
        envelope(`${caseId}-quant-start`, 'quant-head'),
        deps,
      ),
      'StartAgentRun(quant, to be failed)',
    )
    const runId = (await repositories.runs.listForCase(caseId)).find(
      (run) => run.assignmentId === assignment.id && run.state === 'running',
    )!.id
    await expect2(
      await runCommand(
        failAgentRun(deps.organization),
        {
          caseId,
          runId,
          departmentId: 'quant-technical',
          category: 'provider-timeout',
          retryable: true,
          attempt: 1,
        },
        envelope(`${caseId}-quant-fail`, 'quant-head', {
          reason: 'The quant desk timed out; the optional input did not arrive.',
        }),
        deps,
      ),
      'FailAgentRun(quant)',
    )
  }

  const office = await contribute('aggregation', 'research-office', 'research-director', [
    claim('office-1', 'The two desks disagree only about timing.'),
  ])

  const aggregateCommandId = `${caseId}-aggregate`
  await expect2(
    await runCommand(
      aggregateManagerConclusion(deps.organization),
      {
        caseId,
        sourceRevisionId: proposedRevisionId,
        departmentId: 'research-office',
        inputRunIds: [macro.runId, ...(quant ? [quant.runId] : []), office.runId],
        dispositions: [
          { claimId: macro.claimIds[0]!, disposition: 'adopted-supporting' },
          ...(quant
            ? [
                options.decisionCriticalDisagreement
                  ? {
                      claimId: quant.claimIds[0]!,
                      disposition: 'retained-unresolved' as const,
                      materiality: 'decision-critical' as const,
                      explanation:
                        'The desks cannot reconcile the timing, and the timing is the position.',
                    }
                  : {
                      claimId: quant.claimIds[0]!,
                      disposition: 'adopted-opposing' as const,
                    },
              ]
            : []),
          { claimId: office.claimIds[0]!, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: quant ? 'received-and-used' : 'unavailable-at-aggregation',
            ...(quant ? { scope: 'in-scope' as const } : {}),
            materiallyRelevant: Boolean(quant),
            ...(quant
              ? {}
              : { explanation: 'The quant desk did not contribute for this case.' }),
          },
        ],
        rationale: 'Macro and the office agree on direction; quant disagrees on timing.',
        statement: 'The ECB holds through Q2 and cuts in September.',
        position: 'hold',
        implications: implicationsOf(options),
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope(aggregateCommandId, 'research-director', { occurredAt: LATER }),
      deps,
    ),
    'AggregateManagerConclusion',
  )

  return {
    caseId,
    thesisId,
    proposedRevisionId,
    revisionId: deriveRevisionId(aggregateCommandId, thesisId),
    aggregationId: deriveAggregationId(aggregateCommandId, proposedRevisionId),
    macroClaimId: macro.claimIds[0]!,
    quantClaimId: quant?.claimIds[0] ?? null,
    aggregationClaimId: office.claimIds[0]!,
    evidenceSetId,
  }
}

/* ---------------------------------------------------------- governance steps */

export async function resolveRisk(runtime: Runtime, macro: MacroCase, suffix = '') {
  const deps = await runtime.container.commandDeps()
  return runCommand(
    resolveConditionalRequirement(deps.organization),
    {
      caseId: macro.caseId,
      playbookEntryKey: 'risk-review',
      revisionId: macro.revisionId,
      departmentId: 'risk',
      discipline: 'risk',
    },
    envelope(`${macro.caseId}-risk-req${suffix}`, 'chief-risk-officer', {
      occurredAt: LATER,
      reason: 'Deterministic rule over the declared implications.',
    }),
    deps,
  )
}

export async function submit(runtime: Runtime, macro: MacroCase, suffix = '') {
  const deps = await runtime.container.commandDeps()
  const version = (await runtime.container.repositories.cases.get(macro.caseId))!.version
  return runCommand(
    submitForVerification(deps.organization),
    {
      caseId: macro.caseId,
      revisionId: macro.revisionId,
      submittedByDepartmentId: 'research-office',
    },
    envelope(`${macro.caseId}-submit${suffix}`, 'research-director', {
      occurredAt: LATER,
      expectedVersion: version,
    }),
    deps,
  )
}

export async function verify(
  runtime: Runtime,
  macro: MacroCase,
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
  suffix = '',
) {
  const deps = await runtime.container.commandDeps()
  return runCommand(
    recordVerificationReview(deps.organization),
    {
      caseId: macro.caseId,
      thesisId: macro.thesisId,
      revisionId: macro.revisionId,
      byDepartmentId: 'verification',
      status: 'verified',
      findings: [],
      claimsReviewed: [macro.macroClaimId, macro.aggregationClaimId],
      ...over,
    },
    envelope(`${macro.caseId}-verify${suffix}`, 'verification-head', {
      occurredAt: LATER,
      ...env,
    }),
    deps,
  )
}

export async function challenge(
  runtime: Runtime,
  macro: MacroCase,
  over: Record<string, unknown> = {},
  suffix = '',
) {
  const deps = await runtime.container.commandDeps()
  return runCommand(
    recordDevilsAdvocateReview(deps.organization),
    {
      caseId: macro.caseId,
      thesisId: macro.thesisId,
      revisionId: macro.revisionId,
      byDepartmentId: 'devils-advocate',
      challenges: [
        {
          contests: macro.macroClaimId,
          kind: 'fragile-assumption',
          argument: 'The path assumes no fiscal impulse.',
          counterEvidence: [],
          wouldBeResolvedBy: 'A fiscal impulse estimate for the next two quarters.',
          materiality: 'material',
        },
      ],
      ...over,
    },
    envelope(`${macro.caseId}-challenge${suffix}`, 'devils-advocate-head', {
      occurredAt: LATER,
    }),
    deps,
  )
}

export async function riskReview(
  runtime: Runtime,
  macro: MacroCase,
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
  suffix = '',
) {
  const deps = await runtime.container.commandDeps()
  return runCommand(
    recordRiskReview(deps.organization),
    {
      caseId: macro.caseId,
      thesisId: macro.thesisId,
      revisionId: macro.revisionId,
      byDepartmentId: 'risk',
      status: 'accepted',
      findings: [],
      ...over,
    },
    envelope(`${macro.caseId}-risk${suffix}`, 'chief-risk-officer', {
      occurredAt: LATER,
      ...env,
    }),
    deps,
  )
}

/* ------------------------------------------------- the institutional projection */

/**
 * Fields regenerated on every read, and therefore excluded by name.
 *
 * Named rather than filtered by a heuristic: a snapshot comparison that dropped
 * "anything that looks like a timestamp" would also drop `occurredAt`, which is
 * exactly the field a restart must preserve.
 */
export const VOLATILE_FIELDS = ['evaluatedAt', 'provenanceId', 'buildId'] as const

export interface InstitutionalState {
  case: unknown
  theses: unknown
  aggregations: unknown
  assignments: unknown
  runs: unknown
  claims: unknown
  requirements: unknown
  reviews: unknown
  events: unknown
  commands: unknown
  eligibility: unknown
  storageProvenance: unknown
}

/** Sorts an array of objects by a stable key, so ordering is never incidental. */
const by = <T>(items: readonly T[], key: (item: T) => string) =>
  [...items].sort((a, b) => key(a).localeCompare(key(b)))

/**
 * Everything the firm would be held to, in one comparable structure.
 *
 * Read through the repositories rather than through raw SQL, so what is
 * compared is what the application would act on — a projection assembled from
 * columns could agree while the mapping that turns them into domain records had
 * changed meaning.
 */
export async function institutionalState(
  runtime: Runtime,
  macro: MacroCase,
  commandIds: readonly string[],
): Promise<InstitutionalState> {
  const repositories = runtime.container.repositories
  const { caseId } = macro

  const investmentCase = (await repositories.cases.get(caseId))!
  const theses = await repositories.theses.listForCase(caseId)
  const assignments = await repositories.assignments.listForCase(caseId)
  const runs = await repositories.runs.listForCase(caseId)
  const claims = await repositories.claims.listForCase(caseId)
  const requirements = await repositories.requirements.listForCase(caseId)
  const verifications = await repositories.reviews.verificationsForCase(caseId)
  const challenges = await repositories.reviews.challengesForCase(caseId)
  const risks = await repositories.reviews.riskForCase(caseId)
  const events = await repositories.events.listForCase(caseId)
  const eligibility = await revisionEligibility(
    repositories,
    caseId,
    LATEST,
    eligibilityPolicy('1'),
  )

  const aggregations = []
  for (const thesis of theses) {
    if (!thesis.aggregationId) continue
    const found = await repositories.aggregations.get(thesis.aggregationId)
    if (found) aggregations.push(found)
  }

  const ledger = []
  for (const commandId of commandIds) {
    const entry = await repositories.commands.find(commandId)
    ledger.push({
      commandId,
      commandType: entry?.intent.commandType ?? null,
      category: entry?.intent.category ?? null,
      mandate: entry?.intent.mandate ?? null,
      payloadHash: entry?.intent.payloadHash ?? null,
      outcomes: (entry?.outcomes ?? []).map((outcome) => ({
        state: outcome.state,
        ...('resultKind' in outcome
          ? { resultKind: outcome.resultKind, resultRef: outcome.resultRef }
          : {}),
        ...('reasonCode' in outcome ? { reasonCode: outcome.reasonCode } : {}),
      })),
    })
  }

  return {
    case: {
      id: investmentCase.id,
      version: investmentCase.version,
      stage: investmentCase.stage,
      playbookId: investmentCase.playbookId,
      playbookVersion: investmentCase.playbookVersion,
      participants: [...investmentCase.participatingDepartmentIds].sort(),
      transitions: investmentCase.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        at: t.at,
        by: t.byEmployeeId,
      })),
    },

    theses: by(theses, (t) => t.revisionId).map((thesis) => ({
      thesisId: thesis.thesisId,
      revisionId: thesis.revisionId,
      revisionNumber: thesis.revisionNumber,
      revisionCause: thesis.revisionCause,
      supersedesRevisionId: thesis.supersedesRevisionId ?? null,
      aggregationId: thesis.aggregationId ?? null,
      lifecycle: thesis.lifecycle,
      statement: thesis.statement,
      position: thesis.position,
      implications: [...thesis.implications].sort(),
      supporting: [...thesis.supportingClaimIds].sort(),
      opposing: [...thesis.opposingClaimIds].sort(),
    })),

    aggregations: by(aggregations, (a) => a.id).map((aggregation) => ({
      id: aggregation.id,
      sourceRevisionId: aggregation.sourceRevisionId,
      producedRevisionId: aggregation.producedRevisionId,
      managerEmployeeId: aggregation.managerEmployeeId,
      departmentId: aggregation.departmentId,
      inputs: by(aggregation.inputs, (i) => i.runId).map((input) => ({
        runId: input.runId,
        playbookEntryKey: input.playbookEntryKey,
        requirementLevel: input.requirementLevel,
      })),
      dispositions: by(aggregation.dispositions, (d) => d.claimId).map((d) => ({
        claimId: d.claimId,
        runId: d.runId,
        disposition: d.disposition,
        materiality: d.materiality ?? null,
        escalationRequired: d.escalationRequired ?? null,
        explanation: d.explanation ?? null,
      })),
      optionalInputs: by(aggregation.optionalInputs, (o) => o.playbookEntryKey).map(
        (input) => ({
          playbookEntryKey: input.playbookEntryKey,
          availability: input.availability,
          materiallyRelevant: input.materiallyRelevant,
          scope: input.scope ?? null,
        }),
      ),
    })),

    assignments: by(assignments, (a) => a.id).map((assignment) => ({
      playbookEntryKey: assignment.playbookEntryKey ?? null,
      departmentId: assignment.departmentId,
      status: assignment.status,
    })),

    runs: by(runs, (r) => r.id).map((run) => ({
      id: run.id,
      assignmentId: run.assignmentId,
      state: run.state,
      claims: [...run.claims.map((c) => c.id)].sort(),
      // Execution provenance: what produced the work, not what stored it.
      execution: {
        playbookEntryKey: run.execution.playbookEntryKey,
        providerId: run.execution.providerId,
        providerVersion: run.execution.providerVersion,
        providerKind: run.execution.providerKind,
        identity: run.execution.identity,
      },
      usage: run.usage,
      failure: run.failure ?? null,
    })),

    claims: by(claims, (c) => c.id).map((claim) => ({
      id: claim.id,
      type: claim.type,
      status: claim.status,
      opposesThesisId: claim.opposesThesisId ?? null,
      evidenceRefs: by(claim.evidenceRefs, (r) => r.observationId).map((ref) => ({
        setId: ref.setId,
        observationId: ref.observationId,
        contentHash: ref.contentHash,
      })),
    })),

    requirements: by(requirements, (r) => `${r.revisionId}|${r.playbookEntryKey}`).map(
      (resolution) => ({
        playbookEntryKey: resolution.playbookEntryKey,
        revisionId: resolution.revisionId,
        state: resolution.state,
        ruleId: resolution.ruleId,
        ruleVersion: resolution.ruleVersion,
        inputHash: resolution.inputHash,
        evaluatedBy: resolution.evaluatedBy,
      }),
    ),

    reviews: {
      verification: by(verifications, (r) => r.reviewId).map((review) => ({
        reviewId: review.reviewId,
        sequence: review.sequence,
        supersedesReviewId: review.supersedesReviewId ?? null,
        revisionId: review.scope === 'thesis-revision' ? review.revisionId : null,
        byDepartmentId: review.byDepartmentId,
        byEmployeeId: review.byEmployeeId,
        at: review.at,
        status: review.status,
        reason: review.reason ?? null,
        claimsReviewed: [...review.claimsReviewed].sort(),
        findings: by(review.findings, (f) => `${f.claimId}|${f.kind}`).map((finding) => ({
          kind: finding.kind,
          claimId: finding.claimId,
          blocking: finding.blocking,
          severity: finding.severity,
          expected: finding.expected ?? null,
          observed: finding.observed ?? null,
          methodology: finding.methodology ?? null,
          correctionRequired: finding.correctionRequired ?? null,
          citedContentHash: finding.citedContentHash ?? null,
          evidence: finding.evidence ?? null,
        })),
      })),
      devilsAdvocate: by(challenges, (r) => r.reviewId).map((review) => ({
        reviewId: review.reviewId,
        sequence: review.sequence,
        revisionId: review.scope === 'thesis-revision' ? review.revisionId : null,
        byDepartmentId: review.byDepartmentId,
        challenges: by(review.challenges, (c) => c.id).map((c) => ({
          id: c.id,
          contests: c.contests,
          kind: c.kind,
          materiality: c.materiality,
          wouldBeResolvedBy: c.wouldBeResolvedBy ?? null,
          resolvedBy: c.resolvedBy ?? null,
          outcome: review.outcomes[c.id] ?? 'open',
          counterEvidence: by(c.counterEvidence, (r) => r.observationId),
        })),
      })),
      risk: by(risks, (r) => r.reviewId).map((review) => ({
        reviewId: review.reviewId,
        sequence: review.sequence,
        revisionId: review.scope === 'thesis-revision' ? review.revisionId : null,
        byDepartmentId: review.byDepartmentId,
        status: review.status,
        reason: review.reason ?? null,
        findings: by(review.findings, (f) => `${f.kind}|${f.detail}`),
        limits: review.limits ? [...review.limits] : null,
      })),
    },

    /* Ordering is the assertion: events are the case's history. */
    events: events.map((event) => ({
      eventId: event.eventId,
      subject: event.subject,
      thesisId: event.thesisId ?? null,
      revisionId: event.revisionId ?? null,
      assignmentId: event.assignmentId ?? null,
      runId: event.runId ?? null,
      reviewId: event.reviewId ?? null,
      fromState: event.fromState,
      toState: event.toState,
      occurredAt: event.occurredAt,
      aggregateVersion: event.aggregateVersion,
    })),

    commands: ledger,

    eligibility: by(eligibility, (e) => e.revisionId).map((entry) => ({
      revisionId: entry.revisionId,
      thesisId: entry.thesisId,
      eligibleForDecision: entry.eligibility.eligibleForDecision,
      canProgress: entry.eligibility.canProgress,
      lifecycle: entry.eligibility.lifecycle,
      riskRequirement: entry.riskRequirement,
      riskRuleVersion: entry.riskRuleVersion,
      reviewsRead: entry.reviewsRead,
      // Structured blockers, ordered by kind then by whatever they point at.
      blockedBy: by(entry.eligibility.blockedBy, (b) => JSON.stringify(b)),
      // `evaluatedAt` is deliberately absent: it is projection time.
    })),

    /*
     * Storage provenance minus the fields that MUST differ across a restart.
     * `provenanceId` and `buildId` identify the runtime that did the reading;
     * the schema and contract versions identify what it read against, and those
     * are what a reload has to agree about.
     */
    storageProvenance: {
      adapterId: runtime.container.provenance.adapterId,
      schemaVersion: runtime.container.provenance.schemaVersion,
      schemaChecksum: runtime.container.provenance.schemaChecksum,
      queryCatalogHash: runtime.container.provenance.queryCatalogHash,
      domainContractVersion: runtime.container.provenance.domainContractVersion,
      commandContractVersion: runtime.container.provenance.commandContractVersion,
    },
  }
}

/* ------------------------------------------------------------ the CIO desk */

/**
 * Puts the current revision in front of the CIO.
 *
 * A desk act under `thesis-owner`, which is why the actor is the research
 * director and not the CIO: asking for a decision and making one are different
 * authorities, and a harness that used the CIO for both would hide that.
 */
export async function submitToCio(runtime: Runtime, macro: MacroCase, suffix = '') {
  const deps = await runtime.container.commandDeps()
  const version = (await runtime.container.repositories.cases.get(macro.caseId))!.version
  return runCommand(
    submitForCioDecision(deps.organization),
    {
      caseId: macro.caseId,
      thesisId: macro.thesisId,
      revisionId: macro.revisionId,
      submittedByDepartmentId: 'research-office',
      eligibilityPolicyVersion: '1',
    },
    envelope(`${macro.caseId}-cio-submit${suffix}`, 'research-director', {
      occurredAt: LATEST,
      expectedVersion: version,
    }),
    deps,
  )
}

/** The CIO deciding. Defaults to selecting the position. */
export async function decide(
  runtime: Runtime,
  macro: MacroCase,
  submissionIds: readonly string[],
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
  suffix = '',
) {
  const deps = await runtime.container.commandDeps()
  const version = (await runtime.container.repositories.cases.get(macro.caseId))!.version
  return runCommand(
    recordCaseDecision(deps.organization),
    {
      caseId: macro.caseId,
      submissionIds,
      outcome: {
        kind: 'selected',
        selectedRevisionId: macro.revisionId,
        consideredRevisionIds: [macro.revisionId],
      },
      evidenceSetId: macro.evidenceSetId,
      rationale: 'The regime call is supported and the risk is sized.',
      authorizationBasis: 'chief-investment-officer',
      ...over,
    },
    envelope(`${macro.caseId}-cio-decide${suffix}`, 'cio', {
      occurredAt: LATEST,
      expectedVersion: version,
      reason: 'Committing the firm to the position.',
      ...env,
    }),
    deps,
  )
}

/** The CIO sending the work back instead. */
export async function returnToDesk(
  runtime: Runtime,
  macro: MacroCase,
  submissionId: string,
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
  suffix = '',
) {
  const deps = await runtime.container.commandDeps()
  const version = (await runtime.container.repositories.cases.get(macro.caseId))!.version
  return runCommand(
    returnFromCioReview(deps.organization),
    {
      caseId: macro.caseId,
      submissionId,
      returnedFor: 'insufficient-evidence',
      authorizationBasis: 'chief-investment-officer',
      concerns: [
        {
          concernKind: 'evidence-thin',
          subjectKind: 'claim',
          subjectId: macro.macroClaimId,
          detail: 'One source for the central rate path.',
        },
      ],
      ...over,
    },
    envelope(`${macro.caseId}-cio-return${suffix}`, 'cio', {
      occurredAt: LATEST,
      expectedVersion: version,
      reason: 'The central claim rests on a single source.',
      ...env,
    }),
    deps,
  )
}

/* ------------------------------------------------------- reconsideration */

/**
 * The trigger a deferral names, and that later ends the wait.
 *
 * The id is scoped to the case. Trigger ids are a primary key across the whole
 * table, so a fixed one would collide the moment two cases were deferred — as
 * it did, and the schema said so immediately.
 */
export const triggerIdFor = (caseId: string) => `trg-${caseId}-fiscal-impulse`

export const deferralTrigger = (caseId: string, revisionId: string) => ({
  id: triggerIdFor(caseId),
  conditionType: 'date-or-event' as const,
  subject: { kind: 'thesis' as const, ref: revisionId },
  qualitativeCondition: 'The ECB publishes its June staff projections.',
  expectedSource: 'ECB staff macroeconomic projections',
  rationale: 'The path cannot be judged before the June projections land.',
  createdByEmployeeId: 'cio',
  createdAt: LATEST,
  policyVersion: '1',
})

/** The CIO choosing to wait, with a condition that would end the wait. */
export async function defer(
  runtime: Runtime,
  macro: MacroCase,
  submissionIds: readonly string[],
  over: Record<string, unknown> = {},
  suffix = '',
) {
  return decide(
    runtime,
    macro,
    submissionIds,
    {
      outcome: {
        kind: 'deferred',
        consideredRevisionIds: [macro.revisionId],
      },
      rationale: 'Sound material, but the June projections decide it.',
      reconsiderationTriggers: [deferralTrigger(macro.caseId, macro.revisionId)],
      ...over,
    },
    {},
    suffix,
  )
}

/** The CIO bringing it back once the condition is satisfied. */
export async function reopen(
  runtime: Runtime,
  macro: MacroCase,
  deferredDecisionId: string,
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
  suffix = '',
) {
  const deps = await runtime.container.commandDeps()
  const version = (await runtime.container.repositories.cases.get(macro.caseId))!.version
  return runCommand(
    reopenForReconsideration(deps.organization),
    {
      caseId: macro.caseId,
      deferredDecisionId,
      firedTriggers: [
        {
          triggerId: triggerIdFor(macro.caseId),
          observation: 'June projections published; fiscal impulse quantified.',
        },
      ],
      authorizationBasis: 'chief-investment-officer',
      eligibilityPolicyVersion: '1',
      ...over,
    },
    envelope(`${macro.caseId}-reopen${suffix}`, 'cio', {
      occurredAt: LATEST,
      expectedVersion: version,
      ...env,
    }),
    deps,
  )
}
