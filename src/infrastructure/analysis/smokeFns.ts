/**
 * The C2-1 smoke proof: one controlled live run, through the served runtime.
 *
 * **This is a code change, not infrastructure.** It exists only for the proof,
 * but that describes its purpose rather than its category, and a new surface
 * classified as infrastructure is a new surface that skipped review.
 *
 * What it is: the smallest adapter that lets the served application initiate
 * an existing command sequence. What it is NOT, deliberately — a new workflow,
 * a new domain path, an alternative orchestration, or any part of Agent
 * Headquarters. Every step below is a command that already existed, called in
 * the order `macroFlowHarness` already proves, through the same container the
 * request path uses.
 *
 * It is reachable only if someone asks for it by URL, it is guarded by an
 * explicit opt-in, and it costs money when it runs.
 */

import { createServerFn } from '@tanstack/react-start'
import {
  buildEvidenceSet,
  observationRef,
  type AgentClaim,
  type EvidenceItem,
  type ExecutionBudget,
  type ExecutionIdentity,
  type RunUsage,
  type ClaimConfidence,
} from '~/domain/analysis'
import { buildProvenance } from '~/domain/shared/provenance'
import { systemClock } from '~/domain/shared/clock'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { deriveAssignmentId } from '~/application/analysis/commands/eventIdentity'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import { runPlaybook } from '~/application/analysis/orchestrator'
import { createLiveContributionProvider } from './providers/live'
import { createAnalysisContainer, type AnalysisContainer } from './container'

/**
 * Strict, and small on purpose. One live call against a real account: enough
 * to answer a one-sentence brief over one observation, and not enough to run
 * up a bill if something loops.
 */
const SMOKE_BUDGET = {
  tokens: 8_000,
  cost: { costMinorUnits: 100, currency: 'USD' },
  deadlineMs: 60_000,
}

/*
 * The current Opus. Bare id, no date suffix — the first attempt invented
 * `claude-opus-4-5-20251101` and the provider answered 404, which the client
 * correctly mapped to `provider-error`.
 */
const MODEL = 'claude-opus-5'
const DEPARTMENT = 'global-macro'
const ENTRY_KEY = 'macro-analysis'

export type SmokeResult =
  | { state: 'refused'; why: string }
  | {
      state: 'done'
      caseId: string
      runId: string
      runState: string
      /** What the provider reported, as the record kept it. */
      usage: RunUsage
      /** What the firm authorized, read back from the run. */
      budget: ExecutionBudget
      /** The model that actually answered, from the run's identity. */
      model: ExecutionIdentity
      producedClaimIds: readonly string[]
      institutionalClaimIds: readonly string[]
      citable: boolean
      claims: readonly { statement: string; confidence: ClaimConfidence }[]
    }

/** One real observation, so the model has something it can legitimately cite. */
function observation(): EvidenceItem {
  const observedAt = '2026-08-15T00:00:00.000Z'
  const value = {
    yieldPercent: '2.41',
    changeBasisPoints: null,
    observationDate: '2026-08-15',
  }
  return {
    ref: observationRef(
      {
        subjectKind: 'series',
        subject: 'de10y',
        kind: 'yield',
        observedAt,
        sourceId: 'ecb',
      },
      value,
    ),
    value,
    provenance: buildProvenance({
      asOf: observedAt,
      nowMs: Date.now(),
      quality: 'official-daily',
      source: { providerId: 'ecb', providerName: 'ECB', trust: 'central-bank' },
    }),
  }
}

/**
 * Runs the proof.
 *
 * Its own container rather than the request-path singleton in `serverFns`, for
 * one reason: this must fail loudly and immediately when it is not configured,
 * where the request path deliberately caches and retries. Same factory, same
 * connection string, same non-owner role.
 */
async function execute(): Promise<SmokeResult> {
  if (process.env.C2_1_SMOKE !== 'yes') {
    return {
      state: 'refused',
      why: 'C2_1_SMOKE is not set to "yes". This spends real money, so it does not run by accident.',
    }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { state: 'refused', why: 'ANTHROPIC_API_KEY is not configured' }
  const connectionString = process.env.ANALYSIS_DATABASE_URL
  if (!connectionString) {
    return { state: 'refused', why: 'ANALYSIS_DATABASE_URL is not configured' }
  }

  let container: AnalysisContainer | null = null
  try {
    container = await createAnalysisContainer({
      connectionString,
      buildId: 'c2-1-smoke',
      clock: systemClock,
    })
    const deps = await container.commandDeps()
    const repositories = container.repositories

    /* ------------------------------------------------ the case and its evidence */

    const caseId = `c2-1-smoke-${Date.now()}`
    const evidence = buildEvidenceSet({
      items: [observation()],
      assembledAt: new Date().toISOString(),
      correlationId: caseId,
    })
    await repositories.evidence.save(evidence)

    const envelope = (commandId: string, over: Record<string, unknown> = {}) => ({
      commandId,
      correlationId: caseId,
      actor: { kind: 'employee' as const, employeeId: 'research-director' },
      initiator: { kind: 'employee' as const, employeeId: 'research-director' },
      occurredAt: new Date().toISOString(),
      ...over,
    })

    const committed = async (result: { outcome: string }, step: string) => {
      if (result.outcome !== 'committed') {
        throw new Error(`${step} did not commit: ${JSON.stringify(result)}`)
      }
    }

    committed(
      await runCommand(
        openInvestmentCase(deps.organization),
        {
          caseId,
          subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
          question: 'Where is the German 10y, and what does it show?',
          ownerEmployeeId: 'research-director',
          participatingDepartmentIds: ['research-office'],
        },
        envelope(`${caseId}-open`),
        deps,
      ),
      'OpenInvestmentCase',
    )

    const version = (await repositories.cases.get(caseId))!.version
    committed(
      await runCommand(
        instantiatePlaybook(deps.organization),
        {
          caseId,
          playbookId: MACRO_REGIME_PLAYBOOK.id,
          playbookVersion: MACRO_REGIME_PLAYBOOK.version,
          onBehalfOfDepartmentId: 'research-office',
        },
        envelope(`${caseId}-playbook`, { expectedVersion: version }),
        deps,
      ),
      'InstantiatePlaybook',
    )

    /* ------------------------------------------------------ commission live work */

    const provider = createLiveContributionProvider({
      apiKey,
      model: MODEL,
      /*
       * Thinking is ON by default on this model and shares `max_tokens` with
       * the response text, so a tight cap truncates the JSON mid-answer. The
       * run's token budget (8k) still bounds the whole call.
       */
      maxTokens: 4_096,
      loadEvidenceSet: (id) => repositories.evidence.get(id),
    })

    const outcome = await runPlaybook(
      MACRO_REGIME_PLAYBOOK,
      provider,
      {
        caseId,
        evidenceSetId: evidence.id,
        assignmentIdFor: (entryKey) => deriveAssignmentId(`${caseId}-playbook`, entryKey),
        /*
         * Resolved from the seeded organization rather than named here. A
         * hard-coded id is a second copy of who works where, and the first
         * attempt got it wrong: the run was refused `unknown-actor` before any
         * model was called.
         */
        employeeIdFor: (departmentId) => {
          const department = deps.organization.departments.find(
            (candidate) => candidate.id === departmentId,
          )
          if (!department) throw new Error(`no department "${departmentId}"`)
          return department.managerEmployeeId
        },
        commandIdFor: (entryKey, act) => `${caseId}-${entryKey}-${act}`,
        correlationId: caseId,
        orchestratorId: 'c2-1-smoke',
        now: () => new Date(),
        revisionIsCurrent: () => true,
      },
      {
        stageDeadlineMs: SMOKE_BUDGET.deadlineMs,
        maxConcurrency: 1,
        firmBudgetCeiling: SMOKE_BUDGET,
      },
      deps,
    )

    const macro = outcome.outcomes.find((stage) => stage.entryKey === ENTRY_KEY)
    if (!macro) throw new Error('the macro entry never ran')

    const runs = await repositories.runs.listForCase(caseId)
    const run = runs.find((candidate) => candidate.departmentId === DEPARTMENT)
    if (!run) {
      throw new Error(`no run was recorded: ${JSON.stringify(macro)}`)
    }
    if (run.state !== 'awaiting-acceptance') {
      throw new Error(
        `the run is ${run.state}, not awaiting-acceptance: ${JSON.stringify(macro)}`,
      )
    }

    const produced = await repositories.producedClaims.listForRun(run.id)

    /* ------------------------------------------ the human act, and what it moves */

    committed(
      await runCommand(
        acceptContribution(deps.organization),
        { caseId, runId: run.id, departmentId: DEPARTMENT },
        envelope(`${caseId}-accept`, {
          actor: { kind: 'employee' as const, employeeId: 'macro-head' },
          initiator: { kind: 'employee' as const, employeeId: 'macro-head' },
        }),
        deps,
      ),
      'AcceptContribution',
    )

    /*
     * Read back through the repository, not from anything still in memory. An
     * in-process object proves the code ran; only a read proves the institution
     * kept it.
     */
    const institutional = await repositories.claims.listForCase(caseId)
    const settled = (await repositories.runs.listForCase(caseId)).find(
      (candidate) => candidate.id === run.id,
    )!

    return {
      state: 'done',
      caseId,
      runId: run.id,
      runState: settled.state,
      usage: settled.usage,
      budget: settled.budget,
      model: settled.execution.identity,
      producedClaimIds: produced.map((claim: AgentClaim) => claim.id),
      institutionalClaimIds: institutional.map((claim: AgentClaim) => claim.id),
      /*
       * Citability is a database property here, not an opinion: a claim is
       * citable exactly when it is in `analysis.claims`, which is what every
       * foreign key in the institution resolves against.
       */
      citable: institutional.length > 0,
      claims: institutional.map((claim: AgentClaim) => ({
        statement: claim.statement,
        confidence: claim.confidence,
      })),
    }
  } finally {
    await container?.close().catch(() => {})
  }
}

export const c2SmokeProofFn = createServerFn({ method: 'POST' }).handler(execute)
