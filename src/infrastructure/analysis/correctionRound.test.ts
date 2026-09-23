/**
 * The correction round, act by act (TD-99, ruled 2026-09-22).
 *
 * Verification files `correction-required` on revision 2. The office that
 * owns the revision returns each defective claim to the desk that produced it
 * — the ownership is read off the record, never chosen — and its own
 * synthesis; the desk corrects; the office synthesises revision 3 as a
 * CORRECTION with explicit lineage; the verdict on revision 2 stays on the
 * record as history and stands for nothing on revision 3, so fresh governance
 * is owed before any conclusion. Neither Verification nor the host corrects
 * anything.
 *
 * Deterministic, through the commands a person would perform; the loop that
 * performs them on its own is proven in `hostGovernanceLoop.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { correctionRoundsTaken, type VerificationFinding } from '~/domain/analysis'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { recordVerificationReview } from '~/application/analysis/commands/recordVerificationReview'
import { returnForCorrection } from '~/application/analysis/commands/returnForCorrection'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { caseOverview } from '~/application/analysis/caseOverview'
import { standingForCase } from '~/application/analysis/caseStandingFor'
import { committeeConclusionReady, productStateFor } from '~/application/analysis/hostGateway'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import { AT, LATER, contributionFor, seedAggregatableCase, type Seeded } from './aggregationHarness'
import { MACRO_REGIME_PLAYBOOK_V8 } from '~/application/analysis/macroPlaybook'

const organization = TEST_ORGANIZATION
let repositories: AnalysisRepositories
let deps: CommandDeps

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-x',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'test' },
  occurredAt: LATER,
  ...over,
})

const committed = <T>(result: { outcome: string } & Record<string, unknown>, what: string): T => {
  if (result.outcome !== 'committed') throw new Error(`${what}: ${JSON.stringify(result)}`)
  return result.value as T
}

const caseVersion = async (caseId: string) => (await repositories.cases.get(caseId))!.version

const assignmentFor = async (caseId: string, entryKey: string) =>
  (await repositories.assignments.listForCase(caseId)).find((a) => a.playbookEntryKey === entryKey)!

const finding = (claimId: string, over: Partial<VerificationFinding> = {}): VerificationFinding => ({
  kind: 'value-mismatch',
  claimId,
  detail: 'the claim states 12 bp where the cited observation shows 4 bp',
  severity: 'material',
  blocking: true,
  correctionRequired: 'restate the move from the cited observation, or withdraw the figure',
  ...over,
})

/** Revision 2, synthesised by the office onto the seeded desks' work and put before the control functions. */
async function submitted(seeded: Seeded, commandId: string) {
  committed(
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: seeded.caseId,
        sourceRevisionId: seeded.revisionId,
        departmentId: 'research-office',
        inputRunIds: [seeded.macroRunId, seeded.ratesRunId!, seeded.quantRunId, seeded.aggregationRunId],
        dispositions: [
          { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
          { claimId: seeded.ratesClaimId!, disposition: 'adopted-supporting' },
          { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
          { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          { playbookEntryKey: 'quant-validation', availability: 'received-and-used', scope: 'in-scope', materiallyRelevant: true },
        ],
        rationale: 'The desks agree on the driver and differ on its weight.',
        statement: 'Gold rose on lower real yields.',
        position: 'explain',
        implications: [],
        invalidationCriteria: 'Falls if real yields rise without gold falling.',
      },
      envelope({ commandId }),
      deps,
    ),
    'AggregateManagerConclusion',
  )
  const revisionId = deriveRevisionId(commandId, seeded.thesisId)
  committed(
    await runCommand(
      submitForVerification(organization),
      { caseId: seeded.caseId, revisionId, submittedByDepartmentId: 'research-office' },
      envelope({ commandId: `${commandId}-submit`, expectedVersion: await caseVersion(seeded.caseId) }),
      deps,
    ),
    'SubmitForVerification',
  )
  return revisionId
}

/** Verification's verdict on a revision, filed directly by its head. */
async function verdict(
  seeded: Seeded,
  revisionId: string,
  status: 'correction-required' | 'verified' | 'insufficient-evidence',
  findings: readonly VerificationFinding[],
  claimsReviewed: readonly string[],
  commandId: string,
) {
  return committed<{ reviewId: string }>(
    await runCommand(
      recordVerificationReview(organization),
      { caseId: seeded.caseId, thesisId: seeded.thesisId, revisionId, byDepartmentId: 'verification', status, findings, claimsReviewed },
      envelope({ commandId, actor: { kind: 'employee', employeeId: 'verification-head' } }),
      deps,
    ),
    'RecordVerificationReview',
  ).reviewId
}

const returned = (seeded: Seeded, revisionId: string, verificationReviewId: string, over: Partial<CommandEnvelope> = {}, by = 'research-office') =>
  runCommand(
    returnForCorrection(organization),
    { caseId: seeded.caseId, revisionId, verificationReviewId, returnedByDepartmentId: by },
    envelope({
      commandId: `return-${revisionId}`,
      actor: { kind: 'institutional-agent', agentPrincipalId: 'research-office-agent' },
      ...over,
    }),
    deps,
  )

const standing = async (caseId: string) =>
  standingForCase({ repositories, organization, investmentCase: (await repositories.cases.get(caseId))!, now: LATER })
const overview = async (caseId: string) => (await caseOverview({ repositories, organization, caseId, now: LATER }))!

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
})

describe('a verdict that demands corrections', () => {
  it('makes the return the institution’s next act, owned by the office that synthesised — before the examinations still owed', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, organization, { openingPosition: 'explain', playbook: MACRO_REGIME_PLAYBOOK_V8 })
    const revision2 = await submitted(seeded, 'cmd-aggregate')
    await verdict(seeded, revision2, 'correction-required', [finding(seeded.macroClaimId)], [seeded.macroClaimId, seeded.ratesClaimId!, seeded.quantClaimId, seeded.aggregationClaimId], 'cmd-verify')

    const now = await standing(seeded.caseId)
    expect(now.nextAct).toEqual({ act: 'return-for-correction', owningDepartmentId: 'research-office' })
    expect(now.blockers.map((blocker) => blocker.kind)).toContain('verification-correction-required')
    /* The host says the same, with the verdict's numbers and the owner by provenance. */
    const state = productStateFor(await overview(seeded.caseId), LATER)
    expect(state).toMatchObject({
      state: 'blocked',
      block: {
        reason: 'verification-correction-required',
        owner: { id: 'research-office' },
        corrections: { revisionNumber: 2, blockingFindings: 1, owners: [{ id: 'global-macro' }], roundsTaken: 0, automaticRoundAvailable: true },
      },
    })
  })

  it('is not made by a verdict of insufficient evidence — that is the firm’s conclusion, not a defect to fix', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, organization, { openingPosition: 'explain', playbook: MACRO_REGIME_PLAYBOOK_V8 })
    const revision2 = await submitted(seeded, 'cmd-aggregate')
    const reviewId = await verdict(seeded, revision2, 'insufficient-evidence', [finding(seeded.macroClaimId)], [seeded.macroClaimId, seeded.ratesClaimId!, seeded.quantClaimId, seeded.aggregationClaimId], 'cmd-verify')

    expect((await standing(seeded.caseId)).nextAct.act).not.toBe('return-for-correction')
    const result = await returned(seeded, revision2, reviewId)
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'invariant-violated' } })
    if (result.outcome === 'rejected') expect(result.rejection.detail).toMatch(/insufficient-evidence, not correction-required/)
    expect((await assignmentFor(seeded.caseId, 'macro-analysis')).status).toBe('completed')
  })
})

describe('the return follows provenance', () => {
  it('sends the defective claim to the desk that produced it and returns the office’s own synthesis; untouched desks keep their work', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, organization, { openingPosition: 'explain', playbook: MACRO_REGIME_PLAYBOOK_V8 })
    const revision2 = await submitted(seeded, 'cmd-aggregate')
    const reviewId = await verdict(seeded, revision2, 'correction-required', [finding(seeded.macroClaimId)], [seeded.macroClaimId, seeded.ratesClaimId!, seeded.quantClaimId, seeded.aggregationClaimId], 'cmd-verify')

    const result = await returned(seeded, revision2, reviewId)
    const value = committed<{ returned: readonly { departmentId: string; runId: string; claimIds: readonly string[] }[]; synthesisAssignmentId: string }>(result, 'ReturnForCorrection')
    expect(value.returned).toEqual([
      { departmentId: 'global-macro', assignmentId: (await assignmentFor(seeded.caseId, 'macro-analysis')).id, runId: seeded.macroRunId, claimIds: [seeded.macroClaimId] },
    ])

    const macro = await assignmentFor(seeded.caseId, 'macro-analysis')
    expect(macro.status).toBe('returned')
    expect(macro.returnedReason).toContain(seeded.macroClaimId)
    expect(macro.returnedReason).toContain('restate the move from the cited observation')
    const office = await assignmentFor(seeded.caseId, 'aggregation')
    expect(office.status).toBe('returned')
    expect(office.id).toBe(value.synthesisAssignmentId)
    /* Still-valid work is reused, not redone. */
    expect((await assignmentFor(seeded.caseId, 'rates-analysis')).status).toBe('completed')
    expect((await assignmentFor(seeded.caseId, 'quant-validation')).status).toBe('completed')
    /* Revision 2 is not edited, and the verdict stays exactly as filed. */
    expect((await repositories.theses.get(revision2))!.lifecycle).toBe('awaiting-verification')
    expect((await repositories.reviews.verificationsForCase(seeded.caseId)).map((r) => [r.reviewId, r.status])).toEqual([[reviewId, 'correction-required']])
  })

  it('sends a defect the synthesis introduced to the Research Office alone', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, organization, { openingPosition: 'explain', playbook: MACRO_REGIME_PLAYBOOK_V8 })
    const revision2 = await submitted(seeded, 'cmd-aggregate')
    const reviewId = await verdict(seeded, revision2, 'correction-required', [finding(seeded.aggregationClaimId, { kind: 'unresolved-citation' })], [seeded.macroClaimId, seeded.ratesClaimId!, seeded.quantClaimId, seeded.aggregationClaimId], 'cmd-verify')

    const value = committed<{ returned: readonly { departmentId: string }[] }>(await returned(seeded, revision2, reviewId), 'ReturnForCorrection')
    expect(value.returned.map((entry) => entry.departmentId)).toEqual(['research-office'])
    expect((await assignmentFor(seeded.caseId, 'macro-analysis')).status).toBe('completed')
    expect((await assignmentFor(seeded.caseId, 'aggregation')).status).toBe('returned')
  })

  it('lets neither Verification nor another desk return the office’s work', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, organization, { openingPosition: 'explain', playbook: MACRO_REGIME_PLAYBOOK_V8 })
    const revision2 = await submitted(seeded, 'cmd-aggregate')
    const reviewId = await verdict(seeded, revision2, 'correction-required', [finding(seeded.macroClaimId)], [seeded.macroClaimId, seeded.ratesClaimId!, seeded.quantClaimId, seeded.aggregationClaimId], 'cmd-verify')

    const byVerification = await returned(seeded, revision2, reviewId, { commandId: 'return-by-verification', actor: { kind: 'institutional-agent', agentPrincipalId: 'verification-agent' } }, 'verification')
    expect(byVerification.outcome).toBe('rejected')
    const byMacro = await returned(seeded, revision2, reviewId, { commandId: 'return-by-macro', actor: { kind: 'employee', employeeId: 'macro-head' } }, 'global-macro')
    expect(byMacro.outcome).toBe('rejected')
    expect((await assignmentFor(seeded.caseId, 'macro-analysis')).status).toBe('completed')
  })
})

describe('the successor revision', () => {
  it('is minted as a correction with explicit lineage; the old verdict is history; fresh governance is owed before any conclusion', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, organization, { openingPosition: 'explain', playbook: MACRO_REGIME_PLAYBOOK_V8 })
    const revision2 = await submitted(seeded, 'cmd-aggregate')
    const reviewId = await verdict(seeded, revision2, 'correction-required', [finding(seeded.macroClaimId)], [seeded.macroClaimId, seeded.ratesClaimId!, seeded.quantClaimId, seeded.aggregationClaimId], 'cmd-verify')
    committed(await returned(seeded, revision2, reviewId), 'ReturnForCorrection')

    /* Targeted correction work: Global Macro alone works again, on the returned assignment. */
    const corrected = await contributionFor(repositories, deps, organization, {
      caseId: seeded.caseId,
      entryKey: 'macro-analysis',
      departmentId: 'global-macro',
      commandPrefix: `${seeded.caseId}-macro-corrected`,
      statement: 'Real yields fell 4 bp, as the cited observation shows',
      /* Correction work is scoped to the revision Verification examined. */
      revisionId: revision2,
    })
    expect(corrected.runId).not.toBe(seeded.macroRunId)
    expect((await assignmentFor(seeded.caseId, 'macro-analysis')).status).toBe('completed')
    /* The replaced contribution is kept, marked obsolete; the corrected one stands. */
    expect((await repositories.runs.listForCase(seeded.caseId)).find((run) => run.id === seeded.macroRunId)!.obsolete).toBe(true)

    /* The office's own correction work: a fresh synthesis run on its returned assignment, scoped to the revision it corrects. */
    const resynthesis = await contributionFor(repositories, deps, organization, {
      caseId: seeded.caseId,
      entryKey: 'aggregation',
      departmentId: 'research-office',
      commandPrefix: `${seeded.caseId}-agg-corrected`,
      statement: 'The corrected figure leaves the direction intact',
      revisionId: revision2,
    })
    expect((await assignmentFor(seeded.caseId, 'aggregation')).status).toBe('completed')

    /* The office synthesises the successor onto the corrected work and the still-valid rest. */
    committed(
      await runCommand(
        aggregateManagerConclusion(organization),
        {
          caseId: seeded.caseId,
          sourceRevisionId: revision2,
          departmentId: 'research-office',
          inputRunIds: [corrected.runId, seeded.ratesRunId!, seeded.quantRunId, resynthesis.runId],
          dispositions: [
            { claimId: corrected.claimId, disposition: 'adopted-supporting' },
            { claimId: seeded.ratesClaimId!, disposition: 'adopted-supporting' },
            { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
            { claimId: resynthesis.claimId, disposition: 'adopted-supporting' },
          ],
          optionalInputs: [
            { playbookEntryKey: 'quant-validation', availability: 'received-and-used', scope: 'in-scope', materiallyRelevant: true },
          ],
          rationale: 'The corrected figure leaves the driver intact.',
          statement: 'Gold rose on lower real yields.',
          position: 'explain',
          implications: [],
          invalidationCriteria: 'Falls if real yields rise without gold falling.',
        },
        envelope({ commandId: 'cmd-aggregate-3' }),
        deps,
      ),
      'AggregateManagerConclusion (correction)',
    )
    const revision3 = deriveRevisionId('cmd-aggregate-3', seeded.thesisId)
    const lineage = await repositories.theses.listForCase(seeded.caseId)
    const third = lineage.find((revision) => revision.revisionId === revision3)!
    expect(third).toMatchObject({ revisionNumber: 3, revisionCause: 'correction', supersedesRevisionId: revision2, lifecycle: 'under-analysis' })
    expect(third.revisionReason).toContain(`Correction of revision 2 after Verification ${reviewId}`)
    expect(lineage.find((revision) => revision.revisionId === revision2)!.lifecycle).toBe('superseded')
    expect(correctionRoundsTaken(lineage, seeded.thesisId)).toBe(1)

    /* Stale governance fails closed: the verdict on revision 2 stands for nothing on revision 3. */
    const before = await standing(seeded.caseId)
    expect(before.nextAct.act).toBe('submit-for-verification')
    expect(before.steps.find((step) => step.step === 'verification')!.status).toBe('outstanding')
    expect(committeeConclusionReady(await overview(seeded.caseId))).toBe(false)

    committed(
      await runCommand(
        submitForVerification(organization),
        { caseId: seeded.caseId, revisionId: revision3, submittedByDepartmentId: 'research-office' },
        envelope({ commandId: 'cmd-submit-3', expectedVersion: await caseVersion(seeded.caseId) }),
        deps,
      ),
      'SubmitForVerification (successor)',
    )
    const after = await standing(seeded.caseId)
    expect(after.nextAct.act).not.toBe('return-for-correction')
    expect(after.blockers.map((blocker) => blocker.kind)).toContain('verification-missing')
    expect(after.blockers.map((blocker) => blocker.kind)).not.toContain('verification-correction-required')
    expect(committeeConclusionReady(await overview(seeded.caseId))).toBe(false)
    expect((await assignmentFor(seeded.caseId, 'verification')).status).toBe('active')
    /* History is preserved: the verdict on revision 2, as filed. */
    expect((await repositories.reviews.verificationsForCase(seeded.caseId)).map((r) => [r.status, r.scope === 'thesis-revision' ? r.revisionId : null])).toEqual([['correction-required', revision2]])

    /* The bound: a second verdict that demands corrections is the visible stop, still the office's act to make by hand. */
    await verdict(seeded, revision3, 'correction-required', [finding(corrected.claimId)], [corrected.claimId, seeded.ratesClaimId!, seeded.quantClaimId, resynthesis.claimId], 'cmd-verify-3')
    expect((await standing(seeded.caseId)).nextAct.act).toBe('return-for-correction')
    expect(productStateFor(await overview(seeded.caseId), LATER)).toMatchObject({
      state: 'blocked',
      block: {
        reason: 'verification-correction-required',
        corrections: { revisionNumber: 3, blockingFindings: 1, owners: [{ id: 'global-macro' }], roundsTaken: 1, automaticRoundAvailable: false },
      },
    })
  })
})
