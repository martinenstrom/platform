/**
 * States the firm's opening position on a case.
 *
 * The act a person performs before any desk contributes: a hypothesis for the
 * firm to argue with, not a conclusion. Every later revision supersedes this
 * one, and the aggregation the Research Office produces is minted onto it.
 *
 *   npm run dev:propose-thesis -- --case dev-123 --as research-director \
 *     --statement "The ECB holds through Q2." --position hold \
 *     --invalidation "Core inflation prints below 2.0% for two months."
 *
 * ## Nothing is defaulted
 *
 * `--as` has no default, and neither does the content. A script that filled in
 * an employee id would book an institutional act to somebody who never
 * performed it, and one that filled in a statement would put words the firm
 * never chose into its own record. Both are refused rather than guessed —
 * which is the whole reason this exists as a script a person invokes rather
 * than as a step inside an automated chain.
 *
 * The actor's authentication is `system-asserted`: no real authentication has
 * occurred, and the ledger says so.
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { runCommand } from '../src/application/analysis/commands/runCommand.ts'
import { proposeThesis } from '../src/application/analysis/commands/proposeThesis.ts'
import { deriveRevisionId } from '../src/application/analysis/commands/eventIdentity.ts'
import { systemClock } from '../src/domain/shared/clock.ts'
import type { InvestmentImplication, ThesisPosition } from '../src/domain/analysis/index.ts'

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
const employeeId =
  option('as') ??
  refuse(
    '--as is required, and has no default. Proposing the firm’s opening ' +
      'position is an institutional act; it is booked to whoever performed it.',
  )
const statement = option('statement') ?? refuse('--statement is required')
const position = (option('position') ?? refuse('--position is required')) as ThesisPosition
const invalidationCriteria =
  option('invalidation') ??
  refuse(
    '--invalidation is required. A thesis that cannot be wrong is a preference, ' +
      'not an investment case.',
  )
const departmentId = option('department') ?? 'research-office'
const thesisId = option('thesis') ?? `${caseId}-thesis`
const implications = (option('implications') ?? 'position-sizing')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean) as InvestmentImplication[]

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) refuse('ANALYSIS_DATABASE_URL is not configured.')

const container = await createAnalysisContainer({
  connectionString,
  buildId: 'dev-propose-thesis',
  clock: systemClock,
})

try {
  const deps = await container.commandDeps()

  const commandId = `${caseId}-propose`
  const result = await runCommand(
    proposeThesis(deps.organization),
    {
      caseId,
      thesisId,
      statement,
      position,
      proposedByDepartmentId: departmentId,
      implications,
      invalidationCriteria,
    },
    {
      commandId,
      correlationId: caseId,
      actor: { kind: 'employee', employeeId },
      /* A person at a terminal, not a scheduler. */
      initiator: { kind: 'employee', employeeId },
      occurredAt: systemClock.isoNow(),
    },
    deps,
  )

  console.log(`\n  → ${result.outcome}`)
  if (result.outcome !== 'committed') {
    console.log(`  ${JSON.stringify(result, null, 1)}`)
    refuse('The thesis was not proposed.')
  }

  console.log(`  Thesis       ${thesisId}`)
  console.log(`  Revision     ${deriveRevisionId(commandId, thesisId)}`)
  console.log(`  Proposed by  ${employeeId} · ${departmentId}\n`)
} finally {
  await container.close()
}
