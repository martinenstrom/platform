/**
 * P4: one autonomous institutional desk, end to end, against the real provider.
 *
 * Proves that a named Financial OS specialist can perform its own desk's acts —
 * start a run, call the model, record the candidate contribution, and adopt it
 * into institutional storage — with **no human acceptance click and no employee
 * impersonation anywhere in the chain**.
 *
 *   npm run dev:prove-agent -- --case <caseId> --evidence <evidenceSetId>
 *
 * The two acts are separate, so the chain can stop between them. If it does —
 * the provider paid, the contribution recorded, the desk not yet having adopted
 * it — resume rather than commission a second paid run:
 *
 *   npm run dev:prove-agent -- --case <caseId> --evidence <evidenceSetId> \
 *     --adopt <runId>
 *
 * What it must NOT do, and does not:
 *
 *   - act as a human employee;
 *   - act as the orchestrator (the orchestrator is the initiator, never the
 *     actor);
 *   - merge recording and acceptance into one write;
 *   - manufacture institutional state with SQL.
 *
 * Every act goes through the production command path and is authorized by the
 * ordinary mandate engine. If the agent were not entitled to act, the
 * institution would refuse it here exactly as it refuses anybody else.
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { commissionAnalysis } from '../src/application/analysis/commissionAnalysis.ts'
import { runCommand } from '../src/application/analysis/commands/runCommand.ts'
import { acceptContribution } from '../src/application/analysis/commands/acceptContribution.ts'
import {
  createLiveContributionProvider,
  LIVE_MAX_OUTPUT_TOKENS,
  LIVE_MODEL_ID,
} from '../src/infrastructure/analysis/providers/live.ts'
import { systemClock } from '../src/domain/shared/clock.ts'
import type { AssertedActor } from '../src/domain/analysis/index.ts'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function refuse(why: string): never {
  console.error(`\n  ${why}\n`)
  process.exit(1)
}

const caseId = option('case') ?? refuse('--case is required')
const evidenceSetId = option('evidence') ?? refuse('--evidence is required')
const principal = option('principal') ?? 'global-macro-agent'
const departmentId = option('department') ?? 'global-macro'
const entryKey = option('entry') ?? 'macro-analysis'
/**
 * Adopt a run that already exists, instead of commissioning a new one.
 *
 * Earned by a concrete failure, not added for symmetry. The two acts below are
 * separate on purpose, and this script once crashed between them — after the
 * provider had been paid and the contribution recorded, but before the desk
 * adopted it. Without a way back in, that run is stranded: commissioning again
 * derives a fresh identity from the prior-run count, so it produces a SECOND
 * paid run and leaves the first sitting in `awaiting-acceptance` forever.
 *
 * This resumes the chain rather than restarting it. It issues exactly the
 * second act, as the same desk, through the same command — it cannot create a
 * run, and it cannot accept one the institution would refuse.
 */
const adoptRunId = option('adopt')

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) refuse('ANALYSIS_DATABASE_URL is not configured.')
/* Adoption calls no provider, so it needs no key. Commissioning does. */
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey && !adoptRunId) {
  refuse('ANTHROPIC_API_KEY is not configured. A live proof needs a real provider.')
}

/** The desk acts as itself. Not as a person, not as the runner. */
const actingPrincipal: AssertedActor = {
  kind: 'institutional-agent',
  agentPrincipalId: principal,
}

const container = await createAnalysisContainer({
  connectionString,
  buildId: 'dev-prove-agent',
  clock: systemClock,
})

const started = Date.now()

try {
  const deps = await container.commandDeps()

  console.log(`\n  Case         ${caseId}`)
  console.log(`  Desk         ${departmentId} · ${entryKey}`)
  console.log(`  Principal    ${principal} (institutional-agent)`)
  console.log(`  Evidence     ${evidenceSetId}`)

  let runId: string

  if (adoptRunId) {
    /*
     * Resuming. The run must already exist, belong to this case and this desk,
     * and still be waiting — anything else is a different run than the one the
     * operator believes they are adopting, and is refused rather than guessed.
     */
    console.log(`\n  Resuming: adopting an existing run, calling no provider…`)
    const existing = await container.repositories.runs.get(adoptRunId)
    if (!existing) refuse(`No run "${adoptRunId}".`)
    if (existing.caseId !== caseId) {
      refuse(`Run "${adoptRunId}" belongs to case "${existing.caseId}".`)
    }
    if (existing.departmentId !== departmentId) {
      refuse(`Run "${adoptRunId}" belongs to the ${existing.departmentId} desk.`)
    }
    if (existing.state !== 'awaiting-acceptance') {
      refuse(`Run "${adoptRunId}" is "${existing.state}", not awaiting acceptance.`)
    }
    runId = adoptRunId
    console.log(`  Run          ${runId}`)
    console.log(`  Provider     (already paid; not called again)`)
  } else {
    console.log(`\n  Commissioning the desk as itself…`)

    const dispatched = Date.now()
    const result = await commissionAnalysis({
      repositories: container.repositories,
      deps,
      provider: createLiveContributionProvider({
        apiKey: apiKey!,
        model: LIVE_MODEL_ID,
        maxTokens: LIVE_MAX_OUTPUT_TOKENS,
        loadEvidenceSet: (id) => container.repositories.evidence.get(id),
      }),
      caseId,
      departmentId,
      entryKey,
      evidenceSetId,
      actingPrincipal,
      now: () => new Date(systemClock.isoNow()),
    })
    const produced = Date.now()

    console.log(`  → ${result.outcome}`)
    if (result.outcome !== 'ran') {
      console.log(`  ${JSON.stringify(result, null, 1)}`)
      refuse('The desk was not commissioned. Nothing was accepted.')
    }

    runId = result.runId
    console.log(`  Run          ${runId}`)
    console.log(`  State        ${result.state}`)
    console.log(`  Provider     ${(produced - dispatched) / 1000}s`)

    /*
     * `ran` is not `succeeded`. A live desk that timed out or overran its
     * authorization produced a run and no claims, and adopting that would
     * adopt an empty contribution.
     */
    if (result.state !== 'awaiting-acceptance') {
      refuse(
        `The run is "${result.state}"` +
          (result.failureCategory ? ` (${result.failureCategory})` : '') +
          '. There is nothing to adopt.',
      )
    }
  }

  /* ------------------------------------------------------- the second act */
  /*
   * Acceptance is a SEPARATE institutional act and stays one. The desk adopts
   * its own candidate work as its recorded position — which is not human
   * review, and is not a side effect of the provider returning.
   */
  console.log(`\n  The desk adopts its own contribution…`)
  const accepted = await runCommand(
    acceptContribution(deps.organization),
    { caseId, runId, departmentId },
    {
      commandId: `agent-accept-${runId}`,
      correlationId: caseId,
      actor: actingPrincipal,
      /* Dispatched by the runner; performed by the desk. */
      initiator: { kind: 'orchestrator', orchestratorId: 'dev-prove-agent' },
      occurredAt: systemClock.isoNow(),
    },
    deps,
  )
  const done = Date.now()

  console.log(`  → ${accepted.outcome}`)
  if (accepted.outcome !== 'committed') {
    console.log(`  ${JSON.stringify(accepted, null, 1)}`)
    refuse('The contribution was not adopted.')
  }

  console.log(`\n  Total        ${(done - started) / 1000}s`)
  console.log(`  Accepted with no human click and no employee impersonation.\n`)
} finally {
  await container.close()
}
