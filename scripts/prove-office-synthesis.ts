/**
 * P4.5b: one autonomous Research Office synthesis, end to end, against a real
 * model — with the candidate boundary intact.
 *
 * The chain the ruling requires, and every link is a production command:
 *
 *   accepted specialist work
 *     → StartAgentRun            (the office acts as itself)
 *     → real model call
 *     → RecordContribution       (claims AND synthesis candidate, one write)
 *     → AcceptContribution       (the office adopts its own claims)
 *     → AggregateManagerConclusion(synthesisFromRunId)
 *     → aggregation + thesis revision
 *
 *   npm run dev:prove-synthesis -- --case <caseId> --evidence <evidenceSetId>
 *
 * What it must NOT do, and does not:
 *
 *   - supply any synthesis prose of its own on the agent path — the command
 *     refuses text beside a candidate reference, so there is nowhere to put it;
 *   - act as a human employee, or as the orchestrator;
 *   - manufacture institutional state with SQL;
 *   - attribute the office's position to the human Research Director.
 *
 * It prints the whole provenance chain, so `model artifact → persisted
 * candidate → institutional synthesis` is traceable by id and digest rather
 * than by matching prose.
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { commissionAnalysis } from '../src/application/analysis/commissionAnalysis.ts'
import { runCommand } from '../src/application/analysis/commands/runCommand.ts'
import { acceptContribution } from '../src/application/analysis/commands/acceptContribution.ts'
import { aggregateManagerConclusion } from '../src/application/analysis/commands/aggregateManagerConclusion.ts'
import { synthesisContext } from '../src/application/analysis/synthesisContext.ts'
import { requirePlaybook } from '../src/application/analysis/playbookRegistry.ts'
import {
  createLiveSynthesisProvider,
  LIVE_SYNTHESIS_MAX_OUTPUT_TOKENS,
} from '../src/infrastructure/analysis/providers/liveSynthesis.ts'
import { LIVE_MODEL_ID } from '../src/infrastructure/analysis/providers/live.ts'
import { systemClock } from '../src/domain/shared/clock.ts'
import { synthesisHashMatches } from '../src/domain/analysis/index.ts'
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
const principal = option('principal') ?? 'research-office-agent'
const departmentId = option('department') ?? 'research-office'
const entryKey = option('entry') ?? 'aggregation'

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) refuse('ANALYSIS_DATABASE_URL is not configured.')
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  refuse('ANTHROPIC_API_KEY is not configured. A live proof needs a real provider.')
}

/** The office acts as itself. Not as the Research Director, not as the runner. */
const actingPrincipal: AssertedActor = {
  kind: 'institutional-agent',
  agentPrincipalId: principal,
}

const container = await createAnalysisContainer({
  connectionString,
  buildId: 'dev-prove-synthesis',
  clock: systemClock,
})

const started = Date.now()

try {
  const deps = await container.commandDeps()
  const repositories = container.repositories

  const investmentCase = await repositories.cases.get(caseId)
  if (!investmentCase) refuse(`No case "${caseId}".`)
  if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
    refuse(`Case "${caseId}" has no playbook.`)
  }
  const playbook = requirePlaybook(
    investmentCase.playbookId,
    investmentCase.playbookVersion,
  )

  /* The lineage's current revision — the argument being reconciled. */
  const revisions = await repositories.theses.listForCase(caseId)
  const current = revisions.find((revision) => revision.lifecycle !== 'superseded')
  if (!current) refuse(`Case "${caseId}" has no current thesis revision.`)

  console.log(`\n  Case         ${caseId}`)
  console.log(`  Desk         ${departmentId} · ${entryKey}`)
  console.log(`  Principal    ${principal} (institutional-agent)`)
  console.log(`  Revision     ${current.revisionId} (r${current.revisionNumber})`)
  console.log(`  Evidence     ${evidenceSetId}`)

  /* ------------------------------------------------------------ the model */

  console.log(`\n  Commissioning the synthesis as the office itself…`)

  const dispatched = Date.now()
  const result = await commissionAnalysis({
    repositories,
    deps,
    provider: createLiveSynthesisProvider({
      apiKey,
      model: LIVE_MODEL_ID,
      maxTokens: LIVE_SYNTHESIS_MAX_OUTPUT_TOKENS,
      /*
       * The facts, read off the record. The model supplies the judgement and
       * nothing else — it never sees a run id and could not name one if it
       * wanted to.
       */
      loadContext: async () => {
        const [assignments, runs, revisions] = await Promise.all([
          repositories.assignments.listForCase(caseId),
          repositories.runs.listForCase(caseId),
          repositories.theses.listForCase(caseId),
        ])
        return synthesisContext({
          caseId,
          question: investmentCase.question,
          inquiry: inquiryKindOf(revisions, current.thesisId),
          playbook,
          entryKey,
          revision: current,
          assignments,
          runs,
        })
      },
    }),
    caseId,
    departmentId,
    entryKey,
    evidenceSetId,
    actingPrincipal,
    revisionId: current.revisionId,
    now: () => new Date(systemClock.isoNow()),
  })
  const produced = Date.now()

  console.log(`  → ${result.outcome}`)
  if (result.outcome !== 'ran') {
    console.log(`  ${JSON.stringify(result, null, 1)}`)
    refuse('The office was not commissioned. Nothing was produced.')
  }

  const runId = result.runId
  console.log(`  Run          ${runId}`)
  console.log(`  Provider     ${(produced - dispatched) / 1000}s`)

  const candidate = await repositories.producedSyntheses.get(runId)
  if (!candidate) {
    refuse('The run produced no synthesis candidate. There is nothing to adopt.')
  }

  console.log(`\n  CANDIDATE (produced, not institutional)`)
  console.log(`  hash         ${candidate.contentHash}`)
  console.log(`  canon        v${candidate.canonicalizationVersion}`)
  console.log(`  self-attests ${synthesisHashMatches(candidate)}`)
  console.log(`  from rev     ${candidate.basis.sourceRevisionId}`)
  console.log(
    `  playbook     ${candidate.basis.playbookId}@${candidate.basis.playbookVersion}`,
  )
  console.log(`  input runs   ${candidate.artifact.inputRunIds.join(', ')}`)
  console.log(
    `  basis runs   ${candidate.basis.observedCompletedRunIds.join(', ') || '(none)'}`,
  )
  console.log(`  position     ${candidate.artifact.position}`)
  console.log(`  statement    ${candidate.artifact.statement}`)
  for (const record of candidate.artifact.dispositions) {
    console.log(
      `    ${record.claimId} → ${record.disposition}` +
        (record.materiality ? ` (${record.materiality})` : ''),
    )
  }
  for (const record of candidate.artifact.optionalInputs) {
    console.log(
      `    ${record.playbookEntryKey} → ${record.availability}` +
        `, material: ${record.materiallyRelevant}`,
    )
  }

  /* ------------------------------------------------- the office's own work */

  console.log(`\n  The office adopts its own findings…`)
  const accepted = await runCommand(
    acceptContribution(deps.organization),
    { caseId, runId, departmentId },
    {
      commandId: `office-accept-${runId}`,
      correlationId: caseId,
      actor: actingPrincipal,
      initiator: { kind: 'orchestrator', orchestratorId: 'dev-prove-synthesis' },
      occurredAt: systemClock.isoNow(),
    },
    deps,
  )
  console.log(`  → ${accepted.outcome}`)
  if (accepted.outcome !== 'committed') {
    console.log(`  ${JSON.stringify(accepted, null, 1)}`)
    refuse('The office contribution was not adopted.')
  }
  const officeRun = await repositories.runs.get(runId)
  console.log(`  claims       ${officeRun!.claims.map((c) => c.id).join(', ')}`)

  /* ------------------------------------------------------- the institution */

  /*
   * The adoption. The reference is the whole input: there is no field on this
   * path for prose, so what becomes the firm's position is the exact persisted
   * candidate and cannot be anything else.
   */
  console.log(`\n  The office institutionalises the candidate…`)
  const adoptCommandId = `office-adopt-${runId}`
  const adopted = await runCommand(
    aggregateManagerConclusion(deps.organization),
    {
      caseId,
      sourceRevisionId: current.revisionId,
      departmentId,
      synthesisFromRunId: runId,
    },
    {
      commandId: adoptCommandId,
      correlationId: caseId,
      actor: actingPrincipal,
      initiator: { kind: 'orchestrator', orchestratorId: 'dev-prove-synthesis' },
      occurredAt: systemClock.isoNow(),
    },
    deps,
  )
  const done = Date.now()

  console.log(`  → ${adopted.outcome}`)
  if (adopted.outcome !== 'committed') {
    console.log(`  ${JSON.stringify(adopted, null, 1)}`)
    refuse('The candidate was not institutionalised.')
  }

  const revisionId = (adopted.value as { revisionId: string }).revisionId
  const revision = await repositories.theses.get(revisionId)
  const aggregation = await repositories.aggregations.get(revision!.aggregationId!)

  console.log(`\n  INSTITUTIONAL`)
  console.log(`  aggregation  ${aggregation!.id}`)
  console.log(`  synthesis    ${aggregation!.synthesisRunId ?? '(none)'}`)
  console.log(`  manager      employee=${aggregation!.managerEmployeeId ?? '—'}`)
  console.log(`               agent=${aggregation!.managerAgentPrincipalId ?? '—'}`)
  console.log(`  revision     ${revision!.revisionId} (r${revision!.revisionNumber})`)
  console.log(`  proposed by  employee=${revision!.proposedByEmployeeId ?? '—'}`)
  console.log(`               agent=${revision!.proposedByAgentPrincipalId ?? '—'}`)
  console.log(`  statement    ${revision!.statement}`)
  console.log(`  position     ${revision!.position}`)

  /*
   * The trace, closed. Not "the prose matches" — the aggregation names the run
   * whose candidate it adopted, and that candidate still hashes to its own
   * contents.
   */
  const traced =
    aggregation!.synthesisRunId === runId &&
    revision!.statement === candidate.artifact.statement &&
    synthesisHashMatches(candidate)

  console.log(`\n  TRACE        ${traced ? 'closed' : 'BROKEN'}`)
  console.log(
    `  ${runId} → ${candidate.contentHash.slice(0, 16)}… → ${revision!.revisionId}`,
  )
  console.log(`\n  Total        ${(done - started) / 1000}s`)
  if (!traced) refuse('The chain does not close. Do not report this as a proof.')
  console.log(
    `  A model wrote it, the office adopted it, and no human typed a word of it.\n`,
  )
} finally {
  await container.close()
}
