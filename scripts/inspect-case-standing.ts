/**
 * Reads one case's standing off the record — blockers, next act, whether the
 * committee's conclusion is ready — through the same derivations the host
 * uses. Writes nothing.
 *
 *   npx vite-node scripts/inspect-case-standing.ts -- --case <caseId>
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { caseOverview } from '../src/application/analysis/caseOverview.ts'
import { committeeConclusionReady } from '../src/application/analysis/hostGateway.ts'
import { systemClock } from '../src/domain/shared/clock.ts'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) throw new Error('ANALYSIS_DATABASE_URL is not configured. Run this through `npm run`.')
const caseId = option('case')
if (!caseId) throw new Error('--case <caseId> is required')

const container = await createAnalysisContainer({ connectionString, buildId: 'dev-inspect', clock: systemClock })
try {
  const deps = await container.commandDeps()
  const overview = await caseOverview({
    repositories: container.repositories,
    organization: deps.organization,
    caseId,
    now: systemClock.isoNow(),
  })
  if (!overview) throw new Error(`No case "${caseId}".`)
  console.log(`\n  ${caseId} · stage ${overview.investmentCase.stage}`)
  console.log(`  next act: ${overview.standing.nextAct.act} (${overview.standing.nextAct.owningDepartmentId ?? '–'})`)
  console.log(`  steps: ${overview.standing.steps.map((s) => `${s.step}=${s.status}`).join(' · ')}`)
  console.log(`  blockers: ${overview.standing.blockers.length === 0 ? 'none' : ''}`)
  for (const blocker of overview.standing.blockers) console.log(`    - ${JSON.stringify(blocker)}`)
  console.log(`  committee conclusion ready: ${committeeConclusionReady(overview)}`)
  for (const review of overview.verification) console.log(`  verification ${review.reviewId}: ${review.status} · findings ${review.findings.length} (blocking ${review.findings.filter((f) => f.blocking).length})`)
  for (const review of overview.devilsAdvocate) console.log(`  devil's advocate ${review.reviewId}: ${review.challenges.map((c) => `${c.kind}/${c.materiality}/${c.status}`).join(', ')}`)
  for (const review of overview.peerExaminations) console.log(`  peer ${review.reviewId}: ${review.challenges.length} challenge(s)`)
} finally {
  await container.close()
}
