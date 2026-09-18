/**
 * Measures what each control function would read for a real case, in the
 * provider's own tokens, before any budget is written.
 *
 * The ruling of 2026-09-17 (third): measure the actual governance contexts
 * first, then set the macro-regime v7 budgets from the measurement. This
 * renders the three governance prompts — verification, challenge, peer
 * examination — from the record of a case that holds an aggregated
 * revision, and asks Anthropic's token counter how large each is. It calls
 * no model, writes nothing, and spends nothing but the count.
 *
 *   npm run dev:measure-governance -- --case <caseId>
 *
 * Without --case, the newest case whose current revision was produced by an
 * aggregation is measured.
 */

import { createAnalysisContainer } from '../src/infrastructure/analysis/container.ts'
import { governanceContext, type GovernanceKind } from '../src/application/analysis/governanceContext.ts'
import {
  renderGovernanceSystemPrompt,
  renderGovernanceUserPrompt,
} from '../src/infrastructure/analysis/providers/liveGovernance.ts'
import { LIVE_MODEL_ID } from '../src/infrastructure/analysis/providers/live.ts'
import {
  createLiveGovernanceProvider,
  LIVE_GOVERNANCE_MAX_OUTPUT_TOKENS,
} from '../src/infrastructure/analysis/providers/liveGovernance.ts'
import { claimsInScopeOf } from '../src/application/analysis/reviewRecording.ts'
import { resolveExecutionBudget } from '../src/application/analysis/executionBudget.ts'
import {
  buildDevilsAdvocateCandidate,
  buildPeerExaminationCandidate,
  buildVerificationCandidate,
} from '../src/domain/analysis/index.ts'
import type { ContributionRequest } from '../src/application/analysis/contributionPort.ts'
import { requirePlaybook } from '../src/application/analysis/playbookRegistry.ts'
import { systemClock } from '../src/domain/shared/clock.ts'

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

const connectionString = process.env.ANALYSIS_DATABASE_URL
if (!connectionString) refuse('ANALYSIS_DATABASE_URL is not configured. Run this through `npm run`.')
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) refuse('ANTHROPIC_API_KEY is not configured. Counting tokens needs the provider.')

const container = await createAnalysisContainer({
  connectionString,
  buildId: 'dev-measure-governance',
  clock: systemClock,
})

async function countTokens(system: string, user: string): Promise<number> {
  const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: LIVE_MODEL_ID, system, messages: [{ role: 'user', content: user }] }),
  })
  if (!response.ok) refuse(`count_tokens answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const body = (await response.json()) as { input_tokens?: number }
  if (typeof body.input_tokens !== 'number') refuse('count_tokens answered without input_tokens')
  return body.input_tokens
}

try {
  const { repositories } = container
  let caseId = option('case')
  if (!caseId) {
    const cases = await repositories.cases.list()
    for (const candidate of [...cases].sort((a, b) => b.openedAt.localeCompare(a.openedAt))) {
      const revisions = await repositories.theses.listForCase(candidate.id)
      if (revisions.some((revision) => revision.lifecycle !== 'superseded' && revision.aggregationId)) {
        caseId = candidate.id
        break
      }
    }
  }
  if (!caseId) refuse('No case with an aggregated revision to measure against.')
  const investmentCase = await repositories.cases.get(caseId)
  if (!investmentCase) refuse(`No case "${caseId}".`)
  const revisions = await repositories.theses.listForCase(caseId)
  const revision = revisions.find((candidate) => candidate.lifecycle !== 'superseded' && candidate.aggregationId)
  if (!revision) refuse(`Case "${caseId}" has no aggregated current revision.`)
  const playbook =
    investmentCase.playbookId && investmentCase.playbookVersion
      ? requirePlaybook(investmentCase.playbookId, investmentCase.playbookVersion)
      : null

  /*
   * --call <kind>: one real provider call for that control function against
   * this revision, timed, its usage printed, and its candidate judged by the
   * same domain builders the firm files with. Spends one call; writes nothing.
   */
  const call = option('call') as GovernanceKind | undefined
  if (call) {
    const entryKey = call === 'verification' ? 'verification' : call === 'devils-advocate' ? 'challenge' : 'peer-examination'
    const departmentId = call === 'verification' ? 'verification' : call === 'devils-advocate' ? 'devils-advocate' : 'rates'
    const entry = playbook?.entries.find((candidate) => candidate.key === entryKey)
    const provider = createLiveGovernanceProvider({
      kind: call,
      apiKey,
      model: LIVE_MODEL_ID,
      maxTokens: LIVE_GOVERNANCE_MAX_OUTPUT_TOKENS,
      loadContext: async () => governanceContext({ repositories, kind: call, caseId: caseId!, question: investmentCase.question, revision }),
    })
    const request: ContributionRequest = {
      caseId,
      assignmentId: 'measure',
      departmentId,
      accountablePrincipalId: `${departmentId}-agent`,
      revisionId: revision.revisionId,
      brief: entry?.brief ?? '',
      evidenceSetId: 'measure',
      inputs: {},
      budget: resolveExecutionBudget('live', { ...(entry?.budget ? { proposed: entry.budget } : {}), firmCeiling: {} }),
      signal: AbortSignal.timeout(900_000),
    }
    console.log(`\n  Calling ${call} on ${caseId} r${revision.revisionNumber} (${LIVE_MODEL_ID}, cap ${LIVE_GOVERNANCE_MAX_OUTPUT_TOKENS})…`)
    const started = Date.now()
    try {
      const result = await provider.contribute(request)
      const ms = Date.now() - started
      const usage = result.usage.state === 'measured' ? `${result.usage.inputTokens} in / ${result.usage.outputTokens} out` : result.usage.state
      console.log(`  answered in ${ms} ms · tokens ${usage}`)
      const inScope = await claimsInScopeOf(repositories as never, revision)
      const basis = {
        caseId,
        thesisId: revision.thesisId,
        sourceRevisionId: revision.revisionId,
        playbookId: investmentCase.playbookId!,
        playbookVersion: investmentCase.playbookVersion!,
        playbookEntryKey: entryKey,
        observedClaimIds: [...inScope].sort(),
      }
      const producedAt = new Date().toISOString()
      const governance = result.governance!
      try {
        if (governance.kind === 'verification') {
          buildVerificationCandidate({ runId: 'measure', artifact: governance.artifact, basis, producedAt })
          console.log(`  candidate VALID · status ${governance.artifact.status} · findings ${governance.artifact.findings.length} · claimsReviewed ${governance.artifact.claimsReviewed.length}`)
          for (const finding of governance.artifact.findings) console.log(`    - ${finding.kind} · ${finding.severity}${finding.blocking ? ' · blocking' : ''} · ${finding.claimId}`)
        } else if (governance.kind === 'devils-advocate') {
          buildDevilsAdvocateCandidate({ runId: 'measure', artifact: governance.artifact, basis, producedAt })
          console.log(`  candidate VALID · challenges ${governance.artifact.challenges.length}`)
          for (const c of governance.artifact.challenges) console.log(`    - ${c.kind} · ${c.materiality} · ${c.contests}`)
        } else {
          buildPeerExaminationCandidate({ runId: 'measure', artifact: governance.artifact, basis: { ...basis, examinedDepartmentId: governance.examinedDepartmentId }, producedAt })
          console.log(`  candidate VALID · challenges ${governance.artifact.challenges.length}`)
        }
      } catch (error) {
        console.log(`  candidate REFUSED by the domain: ${error instanceof Error ? error.message : String(error)}`)
      }
    } catch (error) {
      console.log(`  call FAILED after ${Date.now() - started} ms: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
    }
    await container.close()
    process.exit(0)
  }

  console.log(`\n  Case         ${caseId}`)
  console.log(`  Revision     ${revision.revisionId} (r${revision.revisionNumber}), ${revision.position}`)
  console.log(`  Model        ${LIVE_MODEL_ID}\n`)
  console.log('  | control            | claims | cites | system tokens | user tokens | input total |')
  console.log('  | --- | --- | --- | --- | --- | --- |')
  for (const kind of ['verification', 'devils-advocate', 'peer-examination'] as GovernanceKind[]) {
    const context = await governanceContext({ repositories, kind, caseId, question: investmentCase.question, revision })
    if (!context) refuse(`No governance context for ${kind}.`)
    const entryKey = kind === 'verification' ? 'verification' : kind === 'devils-advocate' ? 'challenge' : 'peer-examination'
    const brief = playbook?.entries.find((entry) => entry.key === entryKey)?.brief ?? ''
    const system = renderGovernanceSystemPrompt(kind)
    const user = `${renderGovernanceUserPrompt(context)}\n\nBrief:\n${brief}`
    const systemTokens = await countTokens(system, 'x')
    const total = await countTokens(system, user)
    const cites = context.claims.reduce((sum, claim) => sum + claim.cites.length, 0)
    console.log(`  | ${kind.padEnd(18)} | ${String(context.claims.length).padStart(6)} | ${String(cites).padStart(5)} | ${String(systemTokens).padStart(13)} | ${String(total - systemTokens).padStart(11)} | ${String(total).padStart(11)} |`)
  }
  console.log('')
} finally {
  await container.close()
}
