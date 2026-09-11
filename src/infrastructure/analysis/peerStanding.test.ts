/**
 * Workflow standing and eligibility are separate answers, and must stay separate.
 *
 * The defect this file exists to prevent, reproduced once and now fixed: a
 * policy-v2 case with every control function recorded and no peer examination
 * showed **all steps complete, no blockers, and "submit for CIO decision"** as
 * the next act — while recorded eligibility refused CIO submission because
 * `PEER_SCRUTINY_ABSENT` had failed. The domain was telling the user to perform
 * an act the production command would reject.
 *
 * ## The two questions, and why neither may answer the other
 *
 *   Standing     what institutional work does this case owe, under the
 *                workflow it actually instantiated?
 *   Eligibility  does this revision satisfy the policy a submission names?
 *
 * Standing therefore reads the case's **assignments** — persisted work the firm
 * allocated — and never an eligibility policy. For an unsubmitted case no
 * policy has been chosen yet, so any policy standing consulted would be a guess
 * presented as a fact.
 *
 * The tests are structural. They assert `CaseStep` and `InstitutionalAct`
 * values, never Swedish wording, so a copy change cannot break them and a
 * semantic change cannot slip past them.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { recordPeerExamination } from '~/application/analysis/commands/recordPeerExamination'
import { recordDevilsAdvocateReview } from '~/application/analysis/commands/recordDevilsAdvocateReview'
import { recordVerificationReview } from '~/application/analysis/commands/recordVerificationReview'
import { recordRiskReview } from '~/application/analysis/commands/recordRiskReview'
import { resolveConditionalRequirement } from '~/application/analysis/commands/resolveConditionalRequirement'
import {
  MACRO_REGIME_PLAYBOOK_V4,
  MACRO_REGIME_PLAYBOOK_V5,
} from '~/application/analysis/macroPlaybook'
import { caseOverview } from '~/application/analysis/caseOverview'
import { assembleEligibilityBasis } from '~/application/analysis/assembleEligibilityBasis'
import { caseStanding, eligibilityPolicy, type CaseStep } from '~/domain/analysis'
import type { ChallengeSubmission } from '~/application/analysis/reviewRecording'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import { AT, LATER, EVIDENCE_SET_ID, contributionFor } from './aggregationHarness'

const organization = TEST_ORGANIZATION
const V2 = eligibilityPolicy('2')

let repositories: AnalysisRepositories
let deps: CommandDeps

const env = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'c',
  correlationId: 'corr',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

const must = (result: { outcome: string }, what: string) => {
  if (result.outcome !== 'committed') {
    throw new Error(`${what}: ${JSON.stringify(result)}`)
  }
}

/**
 * A case taken to "synthesised and submitted for review", on a chosen playbook.
 *
 * Everything through production commands. The playbook is a parameter because
 * the whole point is that a workflow WITHOUT a peer assignment owes no peer
 * examination — which cannot be shown by configuring the standing directly.
 */
async function caseThroughSynthesis(
  caseId: string,
  playbook: typeof MACRO_REGIME_PLAYBOOK_V5,
) {
  const thesisId = `${caseId}-thesis`
  const inst = `${caseId}-inst`
  const thesisCmd = `${caseId}-thesis-cmd`
  const version = async () => (await repositories.cases.get(caseId))!.version

  await repositories.evidence.save({
    id: EVIDENCE_SET_ID,
    assembledAt: AT,
    correlationId: 'corr',
    items: [],
    disagreements: [],
    revisions: [],
    coTemporality: { publication: { kind: 'empty' }, reference: { kind: 'empty' } },
  })

  must(
    await runCommand(
      openInvestmentCase(organization),
      {
        caseId,
        subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB' },
        question: 'Why did the long end move?',
        ownerEmployeeId: 'research-director',
        /* Deliberately NOT research-office first. See the ownership test. */
        participatingDepartmentIds: ['research-office'],
      },
      env({ commandId: `${caseId}-open` }),
      deps,
    ),
    'open',
  )
  must(
    await runCommand(
      instantiatePlaybook(organization),
      {
        caseId,
        playbookId: playbook.id,
        playbookVersion: playbook.version,
        onBehalfOfDepartmentId: 'research-office',
      },
      env({ commandId: inst, expectedVersion: 1 }),
      deps,
    ),
    'instantiate',
  )
  must(
    await runCommand(
      proposeThesis(organization),
      {
        caseId,
        thesisId,
        proposedByDepartmentId: 'research-office',
        statement: 'Growth repricing.',
        position: 'hold',
        implications: ['position-sizing'],
        invalidationCriteria: 'A real-rate decomposition.',
      },
      env({ commandId: thesisCmd }),
      deps,
    ),
    'thesis',
  )

  const desks = [
    { entryKey: 'macro-analysis', departmentId: 'global-macro' },
    ...(playbook.entries.some((entry) => entry.key === 'rates-analysis')
      ? [{ entryKey: 'rates-analysis', departmentId: 'rates' }]
      : []),
    { entryKey: 'aggregation', departmentId: 'research-office' },
  ]
  const produced: { runId: string; claimId: string }[] = []
  for (const desk of desks) {
    produced.push(
      await contributionFor(repositories, deps, organization, {
        caseId,
        entryKey: desk.entryKey,
        departmentId: desk.departmentId,
        commandPrefix: `${caseId}-${desk.departmentId}`,
        instantiateCommandId: inst,
      }),
    )
  }

  must(
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId,
        sourceRevisionId: deriveRevisionId(thesisCmd, thesisId),
        departmentId: 'research-office',
        inputRunIds: produced.map((entry) => entry.runId),
        dispositions: produced.map((entry) => ({
          claimId: entry.claimId,
          disposition: 'adopted-supporting' as const,
        })),
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation' as const,
            materiallyRelevant: false,
          },
        ],
        rationale: 'The desks agree on direction.',
        statement: 'Growth repricing.',
        position: 'hold',
        implications: ['position-sizing'],
        invalidationCriteria: 'A real-rate decomposition.',
      },
      env({ commandId: `${caseId}-agg` }),
      deps,
    ),
    'aggregate',
  )

  const revisionId = deriveRevisionId(`${caseId}-agg`, thesisId)
  must(
    await runCommand(
      submitForVerification(organization),
      { caseId, revisionId, submittedByDepartmentId: 'research-office' },
      env({ commandId: `${caseId}-submit`, expectedVersion: await version() }),
      deps,
    ),
    'submit for verification',
  )
  return { caseId, thesisId, revisionId, macroClaimId: produced[0]!.claimId }
}

/** Every control function, so peer scrutiny is the only thing outstanding. */
async function allGovernance(seed: Awaited<ReturnType<typeof caseThroughSynthesis>>) {
  const { caseId, thesisId, revisionId, macroClaimId } = seed
  must(
    await runCommand(
      recordDevilsAdvocateReview(organization),
      {
        caseId,
        thesisId,
        revisionId,
        byDepartmentId: 'devils-advocate',
        challenges: [
          {
            contests: macroClaimId,
            kind: 'fragile-assumption',
            argument: 'Rests on one print.',
            counterEvidence: [],
            wouldBeResolvedBy: 'A second print.',
            materiality: 'non-material',
          },
        ],
      },
      env({
        commandId: `${caseId}-da`,
        actor: { kind: 'employee', employeeId: 'devils-advocate-head' },
      }),
      deps,
    ),
    'devils advocate',
  )
  must(
    await runCommand(
      recordVerificationReview(organization),
      {
        caseId,
        thesisId,
        revisionId,
        byDepartmentId: 'verification',
        status: 'verified',
        findings: [],
        claimsReviewed: [macroClaimId],
      },
      env({
        commandId: `${caseId}-verify`,
        actor: { kind: 'employee', employeeId: 'verification-head' },
      }),
      deps,
    ),
    'verification',
  )
  must(
    await runCommand(
      resolveConditionalRequirement(organization),
      {
        caseId,
        playbookEntryKey: 'risk-review',
        revisionId,
        departmentId: 'risk',
        discipline: 'risk',
      },
      env({
        commandId: `${caseId}-rr`,
        actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
        reason: 'Sizing implication.',
      }),
      deps,
    ),
    'risk requirement',
  )
  must(
    await runCommand(
      recordRiskReview(organization),
      {
        caseId,
        thesisId,
        revisionId,
        byDepartmentId: 'risk',
        status: 'accepted',
        findings: [],
      },
      env({
        commandId: `${caseId}-risk`,
        actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
      }),
      deps,
    ),
    'risk',
  )
}

const examine = (
  seed: Awaited<ReturnType<typeof caseThroughSynthesis>>,
  challenges: readonly ChallengeSubmission[] = [],
  commandId = `${seed.caseId}-peer`,
) =>
  runCommand(
    recordPeerExamination(organization),
    {
      caseId: seed.caseId,
      thesisId: seed.thesisId,
      revisionId: seed.revisionId,
      byDepartmentId: 'rates',
      examinedDepartmentId: 'global-macro',
      challenges,
    },
    env({ commandId, actor: { kind: 'employee', employeeId: 'rates-head' } }),
    deps,
  )

const stepOf = async (caseId: string, step: CaseStep) => {
  const overview = (await caseOverview({
    repositories,
    organization,
    caseId,
    now: LATER,
  }))!
  return {
    status: overview.standing.steps.find((entry) => entry.step === step)!.status,
    nextAct: overview.standing.nextAct,
  }
}

const gatesFor = async (seed: Awaited<ReturnType<typeof caseThroughSynthesis>>) => {
  const assembled = (await assembleEligibilityBasis({
    repositories,
    caseId: seed.caseId,
    revisionId: seed.revisionId,
    submissionId: `sub-${seed.caseId}`,
    policy: V2,
    provenance: await repositories.provenance(),
    now: LATER,
  }))!
  return assembled.gates
}

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

/* ================================================ the defect, and its fix == */

describe('a workflow that owes peer scrutiny and has not had it', () => {
  it('shows the peer step outstanding and does not point at the CIO', async () => {
    /*
     * THE regression. Before the correction this reported every step complete
     * and `submit-for-cio-decision` — an act `submitForCioDecision` refuses.
     */
    const seed = await caseThroughSynthesis('case-owed', MACRO_REGIME_PLAYBOOK_V5)
    await allGovernance(seed)

    const { status, nextAct } = await stepOf('case-owed', 'peer-examination')
    expect(status).toBe('outstanding')
    expect(nextAct.act).not.toBe('submit-for-cio-decision')
    expect(nextAct.act).toBe('record-peer-examination')
  })

  it('never recommends CIO submission while eligibility refuses it for that reason', async () => {
    /*
     * The invariant stated directly, over both models at once. Standing may
     * lag eligibility or lead it, but it must not name the one act the
     * authoritative gate is refusing.
     */
    const seed = await caseThroughSynthesis('case-invariant', MACRO_REGIME_PLAYBOOK_V5)
    await allGovernance(seed)

    const gates = await gatesFor(seed)
    const peerGate = gates.gates.find((gate) => gate.code === 'PEER_SCRUTINY_ABSENT')!
    const { nextAct } = await stepOf('case-invariant', 'peer-examination')

    expect(peerGate.status).toBe('failed')
    expect(nextAct.act).not.toBe('submit-for-cio-decision')
  })
})

describe('a workflow that owes peer scrutiny and has had it', () => {
  it('shows the peer step complete', async () => {
    const seed = await caseThroughSynthesis('case-done', MACRO_REGIME_PLAYBOOK_V5)
    must(await examine(seed), 'peer examination')
    await allGovernance(seed)

    const { status } = await stepOf('case-done', 'peer-examination')
    expect(status).toBe('complete')
  })

  it('completes the step even while a material objection is still open', async () => {
    /*
     * The distinction the ruling insisted on: a completed examination is not
     * settled objections. The desk did the work; the objection it produced is
     * the challenge gate's business, under the policy in force.
     */
    const seed = await caseThroughSynthesis('case-open-obj', MACRO_REGIME_PLAYBOOK_V5)
    must(
      await examine(seed, [
        {
          contests: seed.macroClaimId,
          kind: 'fragile-assumption',
          argument: 'The attribution assumes the real-rate component was unchanged.',
          counterEvidence: [],
          wouldBeResolvedBy: 'A nominal/real decomposition.',
          materiality: 'material',
        },
      ]),
      'peer examination with objection',
    )
    await allGovernance(seed)

    const { status } = await stepOf('case-open-obj', 'peer-examination')
    const gates = await gatesFor(seed)

    expect(status).toBe('complete')
    expect(
      gates.gates.find((gate) => gate.code === 'PEER_SCRUTINY_ABSENT')!.status,
    ).toBe('passed')
    /* Complete work, and still blocked — by the other gate, for its own reason. */
    expect(gates.gates.find((gate) => gate.code === 'CHALLENGE_UNRESOLVED')!.status).toBe(
      'failed',
    )
    expect(gates.eligible).toBe(false)
  })
})

describe('a workflow that never assigned peer scrutiny', () => {
  it('reports the step not-applicable rather than outstanding', async () => {
    /*
     * A v4 case is not behind on work nobody asked it for. `not-applicable` and
     * `outstanding` are different institutional facts and the standing keeps
     * them apart.
     */
    const seed = await caseThroughSynthesis('case-v4', MACRO_REGIME_PLAYBOOK_V4)
    await allGovernance(seed)

    const { status, nextAct } = await stepOf('case-v4', 'peer-examination')
    expect(status).toBe('not-applicable')
    expect(nextAct.act).not.toBe('record-peer-examination')
  })

  /**
   * CONFIGURATION MISMATCH, recorded rather than solved.
   *
   * A case may run a workflow that assigned no peer examination and later be
   * evaluated under a policy that requires peer scrutiny. Both models are then
   * telling the truth about different questions: the case genuinely owes no
   * peer work, and the policy genuinely refuses the submission.
   *
   * Nothing today validates that a case's playbook and its submission policy
   * are compatible. That is a capability gap — recorded here because this is
   * where it is visible — and NOT a reason for either model to adopt the
   * other's rules. Fixing it means validating the pairing at submission, which
   * is a separate decision.
   */
  it('leaves standing and eligibility disagreeing when the pairing is incoherent', async () => {
    const seed = await caseThroughSynthesis('case-mismatch', MACRO_REGIME_PLAYBOOK_V4)
    await allGovernance(seed)

    const { status } = await stepOf('case-mismatch', 'peer-examination')
    const gates = await gatesFor(seed)

    /* Truthfully owes nothing... */
    expect(status).toBe('not-applicable')
    /* ...and is truthfully refused under a policy that requires it. */
    expect(
      gates.gates.find((gate) => gate.code === 'PEER_SCRUTINY_ABSENT')!.status,
    ).toBe('failed')
  })
})

/* ==================================================== submission ownership = */

describe('who owes the CIO submission', () => {
  /** The minimum standing input, so ownership can be tested without a case. */
  const standingWith = (participating: string[]) =>
    caseStanding({
      investmentCase: {
        id: 'case-1',
        stage: 'review',
        participatingDepartmentIds: participating,
      } as never,
      organization,
      hasThesis: true,
      hasAggregation: true,
      hasVerification: true,
      hasDevilsAdvocate: true,
      hasRisk: true,
      riskRequirement: 'not-required',
      peerScrutiny: { applicability: 'required', complete: true },
      submittingDepartmentId: 'research-office',
      hasSubmission: false,
      hasDecision: false,
      blockers: [],
    })

  it('names the desk that produced the revision', () => {
    expect(standingWith(['research-office']).nextAct).toEqual({
      act: 'submit-for-cio-decision',
      owningDepartmentId: 'research-office',
    })
  })

  it('does not change when the participating array is permuted', () => {
    /*
     * The defect: ownership came from `participatingDepartmentIds[0]`, so a
     * case listing the Devil's Advocate first reported the control function as
     * owing the submission. Array order is not an institutional fact.
     */
    const orders = [
      ['research-office', 'devils-advocate', 'global-macro'],
      ['devils-advocate', 'global-macro', 'research-office'],
      ['global-macro', 'research-office', 'devils-advocate'],
    ]
    for (const order of orders) {
      expect(standingWith(order).nextAct.owningDepartmentId, order.join(',')).toBe(
        'research-office',
      )
    }
  })
})
