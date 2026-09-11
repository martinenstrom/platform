/**
 * Half B, end to end: two analytical desks actually disagreeing.
 *
 * Every act below goes through a PRODUCTION command. Nothing constructs an
 * eligibility basis by hand, and nothing writes a review the workflow could
 * have produced — because a proof assembled from the answers is not a proof.
 * Test setup is confined to what a firm's environment supplies rather than
 * decides: an evidence set, and recorded provider runs standing in for models.
 *
 * The chain, in the order the institution performs it:
 *
 *   macro-analysis          Global Macro forms its own view
 *   rates-analysis          Rates forms its own view, having read neither
 *   aggregation             Research Office synthesises both
 *   submitForVerification   the revision becomes reviewable
 *   peer-examination        Rates reads the synthesis and objects
 *   supersede               Macro answers; Rates records the objection settled
 *   devils-advocate         the control function files its own objection
 *   verification / risk     the remaining gates
 *   submitForCioDecision    the basis the CIO decides on
 *
 * The negative states matter more than the happy path, and each is proved
 * INDEPENDENTLY rather than inferred from the end: a gate that passes at the
 * end tells you nothing about whether it was ever capable of failing.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  deriveAssignmentId,
  deriveRevisionId,
} from '~/application/analysis/commands/eventIdentity'
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
import { submitForCioDecision } from '~/application/analysis/commands/submitForCioDecision'
import { MACRO_REGIME_PLAYBOOK_V5 } from '~/application/analysis/macroPlaybook'
import { assembleEligibilityBasis } from '~/application/analysis/assembleEligibilityBasis'
import { eligibilityPolicy, type EligibilityGateCode } from '~/domain/analysis'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import { AT, LATER, EVIDENCE_SET_ID, contributionFor } from './aggregationHarness'

const organization = TEST_ORGANIZATION
const V1 = eligibilityPolicy('1')
const V2 = eligibilityPolicy('2')

/**
 * The answer comes after the objection.
 *
 * A review's identity includes WHEN it was recorded, so a re-review at the same
 * instant as the one it supersedes is the same institutional act and is
 * deduplicated — which is correct, and which is why the settlement below
 * carries its own timestamp rather than reusing the objection's.
 */
const AFTER = '2026-07-30T13:00:00.000Z'

const CASE = 'case-debate'
const THESIS = `${CASE}-thesis`
const INSTANTIATE = `${CASE}-inst`
const THESIS_CMD = `${CASE}-thesis-cmd`
/** `proposeThesis` mints a REVISION of the lineage; the thesis id is not one. */
const FIRST_REVISION = deriveRevisionId(THESIS_CMD, THESIS)

let repositories: AnalysisRepositories
let deps: CommandDeps

/** Every id the institution minted, in the order it minted them. */
let trail: { act: string; id: string; by: string }[]
const record = (act: string, id: string, by: string) => {
  trail.push({ act, id, by })
  return id
}

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-x',
  correlationId: 'corr-debate',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

const committed = (result: { outcome: string; resultRef?: string }, what: string) => {
  if (result.outcome !== 'committed') {
    throw new Error(`${what} did not commit: ${JSON.stringify(result)}`)
  }
  return result.resultRef!
}

const caseVersion = async () => (await repositories.cases.get(CASE))!.version

/* ------------------------------------------------------------ the workflow */

/** Setup, not institutional action: the environment a firm's desks run in. */
async function seedEnvironment() {
  await repositories.evidence.save({
    id: EVIDENCE_SET_ID,
    assembledAt: AT,
    correlationId: 'corr-debate',
    items: [],
    disagreements: [],
    revisions: [],
    coTemporality: { publication: { kind: 'empty' }, reference: { kind: 'empty' } },
  })

  committed(
    await runCommand(
      openInvestmentCase(organization),
      {
        caseId: CASE,
        subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
        question: 'Why did the long end move?',
        ownerEmployeeId: 'research-director',
        participatingDepartmentIds: ['research-office'],
      },
      envelope({ commandId: `${CASE}-open` }),
      deps,
    ),
    'openInvestmentCase',
  )

  committed(
    await runCommand(
      instantiatePlaybook(organization),
      {
        caseId: CASE,
        playbookId: MACRO_REGIME_PLAYBOOK_V5.id,
        playbookVersion: MACRO_REGIME_PLAYBOOK_V5.version,
        onBehalfOfDepartmentId: 'research-office',
      },
      envelope({ commandId: INSTANTIATE, expectedVersion: 1 }),
      deps,
    ),
    'instantiatePlaybook v5',
  )

  committed(
    await runCommand(
      proposeThesis(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        proposedByDepartmentId: 'research-office',
        statement: 'The long-end move is a growth repricing.',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'A real-rate decomposition showing the move is real.',
      },
      /* Proposing a thesis does not move case-level state, so it carries no
       * expected version — the command refuses one rather than offering
       * concurrency protection it does not provide. */
      envelope({ commandId: THESIS_CMD }),
      deps,
    ),
    'proposeThesis',
  )
}

/** The two independent analyses. Neither desk reads the other. */
async function bothDesksAnalyse() {
  const macro = await contributionFor(repositories, deps, organization, {
    caseId: CASE,
    entryKey: 'macro-analysis',
    departmentId: 'global-macro',
    commandPrefix: `${CASE}-macro`,
    instantiateCommandId: INSTANTIATE,
    statement: 'The long-end move reflects stronger growth expectations.',
  })
  record('macro claim', macro.claimId, 'global-macro')

  const rates = await contributionFor(repositories, deps, organization, {
    caseId: CASE,
    entryKey: 'rates-analysis',
    departmentId: 'rates',
    commandPrefix: `${CASE}-rates`,
    instantiateCommandId: INSTANTIATE,
    statement: 'The long-end move is a real-rate repricing, not a growth repricing.',
  })
  record('rates claim', rates.claimId, 'rates')

  return { macro, rates }
}

/** The manager reconciles both desks into one revision. */
async function synthesise(macro: { runId: string; claimId: string }, rates: { runId: string; claimId: string }) {
  /*
   * The Research Office's own contribution under the `aggregation` entry.
   *
   * Synthesis is work the playbook assigns, not a privilege of the manager
   * role: `submitForVerification` refuses a revision whose required upstream
   * work was never accepted. The manager contributes, the contribution is
   * accepted, and only then is there finished work to reconcile.
   */
  const office = await contributionFor(repositories, deps, organization, {
    caseId: CASE,
    entryKey: 'aggregation',
    departmentId: 'research-office',
    commandPrefix: `${CASE}-office`,
    instantiateCommandId: INSTANTIATE,
    statement: 'The two desk readings are reconcilable only in part.',
  })
  record('research-office claim', office.claimId, 'research-office')

  const aggregation = await runCommand(
    aggregateManagerConclusion(organization),
    {
      caseId: CASE,
      sourceRevisionId: FIRST_REVISION,
      departmentId: 'research-office',
      inputRunIds: [macro.runId, rates.runId, office.runId],
      dispositions: [
        { claimId: macro.claimId, disposition: 'adopted-supporting' },
        { claimId: office.claimId, disposition: 'adopted-supporting' },
        {
          claimId: rates.claimId,
          /*
           * `retained-unresolved`, not `adopted-opposing`: the manager took a
           * view and could NOT reconcile the two readings. Materiality belongs
           * to unresolved disagreement — an adopted claim is one the manager
           * settled, and the command refuses materiality on it.
           *
           * `material` and not `decision-critical`, so this disagreement is
           * recorded and visible without blocking. What blocks below is the
           * peer's OBJECTION, which is a different institutional act.
           */
          disposition: 'retained-unresolved',
          materiality: 'material',
          /* Required: a disagreement the record cannot explain is a
           * disagreement nobody can review. */
          explanation:
            'Both readings fit the nominal path; nothing available separates ' +
            'them, so the Rates view is retained rather than dismissed.',
        },
      ],
      optionalInputs: [
        {
          /* Quant did not run. An input with no run says nothing about its
           * scope — claiming one would describe work nobody did. */
          playbookEntryKey: 'quant-validation',
          availability: 'unavailable-at-aggregation',
          /* Whether its absence mattered is the manager's judgement, and is
           * required whether or not the input arrived. */
          materiallyRelevant: false,
        },
      ],
      rationale: 'Both desks are retained; the growth reading leads on balance.',
      statement: 'The long-end move is predominantly a growth repricing.',
      position: 'hold',
      /* Implementable, so the conditional Risk rule resolves to `required` and
       * the Risk gate is actually exercised rather than skipped. */
      implications: ['position-sizing'],
      invalidationCriteria: 'A real-rate decomposition showing otherwise.',
    },
    envelope({ commandId: `${CASE}-agg` }),
    deps,
  )
  committed(aggregation, 'aggregateManagerConclusion')

  const revisionId = deriveRevisionId(`${CASE}-agg`, THESIS)
  record('synthesised revision', revisionId, 'research-office')

  committed(
    await runCommand(
      submitForVerification(organization),
      {
        caseId: CASE,
        revisionId,
        submittedByDepartmentId: 'research-office',
      },
      envelope({ commandId: `${CASE}-submit`, expectedVersion: await caseVersion() }),
      deps,
    ),
    'submitForVerification',
  )
  return revisionId
}

const examine = (
  revisionId: string,
  over: Record<string, unknown> = {},
  commandId = `${CASE}-peer`,
  occurredAt = LATER,
) =>
  runCommand(
    recordPeerExamination(organization),
    {
      caseId: CASE,
      thesisId: THESIS,
      revisionId,
      byDepartmentId: 'rates',
      examinedDepartmentId: 'global-macro',
      challenges: [],
      ...over,
    },
    envelope({
      commandId,
      occurredAt,
      actor: { kind: 'employee', employeeId: 'rates-head' },
    }),
    deps,
  )

const devilsAdvocate = (revisionId: string, contests: string) =>
  runCommand(
    recordDevilsAdvocateReview(organization),
    {
      caseId: CASE,
      thesisId: THESIS,
      revisionId,
      byDepartmentId: 'devils-advocate',
      challenges: [
        {
          contests,
          kind: 'fragile-assumption',
          argument: 'The growth reading rests on one print.',
          counterEvidence: [],
          wouldBeResolvedBy: 'A second independent print.',
          materiality: 'non-material',
        },
      ],
    },
    envelope({
      commandId: `${CASE}-da`,
      actor: { kind: 'employee', employeeId: 'devils-advocate-head' },
    }),
    deps,
  )

const verify = (revisionId: string, claimIds: string[]) =>
  runCommand(
    recordVerificationReview(organization),
    {
      caseId: CASE,
      thesisId: THESIS,
      revisionId,
      byDepartmentId: 'verification',
      status: 'verified',
      findings: [],
      claimsReviewed: claimIds,
    },
    envelope({
      commandId: `${CASE}-verify`,
      actor: { kind: 'employee', employeeId: 'verification-head' },
    }),
    deps,
  )

/** The gates, from a basis the application layer assembled from stored facts. */
async function gatesFor(revisionId: string, policy: typeof V1) {
  const assembled = await assembleEligibilityBasis({
    repositories,
    caseId: CASE,
    revisionId,
    submissionId: `sub-${revisionId}`,
    policy,
    provenance: await repositories.provenance(),
    now: LATER,
  })
  if (!assembled) throw new Error('no basis assembled')
  return assembled
}

const statusOf = (
  assembled: Awaited<ReturnType<typeof gatesFor>>,
  code: EligibilityGateCode,
) => assembled.gates.gates.find((gate) => gate.code === code)!.status

beforeEach(async () => {
  trail = []
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  await seedEnvironment()
})

/* ========================================== the independent analyses ====== */

describe('two desks reach their own views', () => {
  it('lets Rates analyse without waiting for Macro', async () => {
    /*
     * The v5 invariant, exercised rather than read off the playbook: the Rates
     * assignment is workable before any Macro contribution exists.
     */
    const rates = await contributionFor(repositories, deps, organization, {
      caseId: CASE,
      entryKey: 'rates-analysis',
      departmentId: 'rates',
      commandPrefix: `${CASE}-rates-solo`,
      instantiateCommandId: INSTANTIATE,
      statement: 'A real-rate repricing.',
    })
    const claim = await repositories.claims.get(rates.claimId)
    expect(claim).not.toBeNull()

    const macroRuns = (await repositories.runs.listForCase(CASE)).filter(
      (run) => run.departmentId === 'global-macro',
    )
    expect(macroRuns).toEqual([])
  })

  it('gives Rates its own assignment, distinct from its examination', async () => {
    const analysis = deriveAssignmentId(INSTANTIATE, 'rates-analysis')
    const examination = deriveAssignmentId(INSTANTIATE, 'peer-examination')
    expect(analysis).not.toBe(examination)

    const assignments = await repositories.assignments.listForCase(CASE)
    const forRates = assignments.filter((a) => a.departmentId === 'rates')
    expect(forRates.map((a) => a.playbookEntryKey).sort()).toEqual([
      'peer-examination',
      'rates-analysis',
    ])
  })
})

/* ================================================= the negative states ==== */

describe('the gates, each failure proved on its own', () => {
  let revisionId: string
  let macroClaimId: string

  beforeEach(async () => {
    const { macro, rates } = await bothDesksAnalyse()
    macroClaimId = macro.claimId
    revisionId = await synthesise(macro, rates)
  })

  it('blocks when nobody examined', async () => {
    const gates = await gatesFor(revisionId, V2)
    expect(statusOf(gates, 'PEER_SCRUTINY_ABSENT')).toBe('failed')
    expect(gates.basis.peerScrutiny).toEqual([])
  })

  it('still blocks when only the Devil’s Advocate has spoken', async () => {
    /*
     * The control function is not a peer. Its objection is scrutiny OF the
     * argument, not a second qualified reading of the subject, and no number
     * of them satisfies the question PEER_SCRUTINY_ABSENT asks.
     */
    committed(await devilsAdvocate(revisionId, macroClaimId), 'devils advocate')

    const gates = await gatesFor(revisionId, V2)
    expect(statusOf(gates, 'PEER_SCRUTINY_ABSENT')).toBe('failed')
    expect(gates.basis.devilsAdvocate).not.toBeNull()
  })

  it('leaves the Devil’s Advocate requirement incomplete when only a peer examined', async () => {
    /*
     * And the converse, which is the more tempting mistake: a desk that knows
     * the subject reading the argument does not discharge an obligation the
     * firm placed on a different mandate.
     */
    committed(await examine(revisionId), 'peer examination')

    const gates = await gatesFor(revisionId, V2)
    expect(statusOf(gates, 'PEER_SCRUTINY_ABSENT')).toBe('passed')
    expect(statusOf(gates, 'CHALLENGE_UNRESOLVED')).toBe('failed')
    expect(gates.basis.devilsAdvocate).toBeNull()
  })

  it('records a zero-challenge examination without manufacturing agreement', async () => {
    committed(await examine(revisionId), 'peer examination')
    committed(await devilsAdvocate(revisionId, macroClaimId), 'devils advocate')

    const gates = await gatesFor(revisionId, V2)
    expect(statusOf(gates, 'PEER_SCRUTINY_ABSENT')).toBe('passed')
    expect(gates.basis.peerScrutiny).toHaveLength(1)
    /* Examined, and raised nothing. Not agreement — an absence of objection. */
    expect(gates.basis.peerScrutiny[0]!.openChallenges).toEqual([])
    expect(gates.basis.peerScrutiny[0]!.byDepartmentId).toBe('rates')
    expect(gates.basis.peerScrutiny[0]!.examinedDepartmentId).toBe('global-macro')
  })

  it('passes scrutiny and blocks the challenge gate on an open material objection', async () => {
    /*
     * The state Half B exists to produce. A qualified desk examined the
     * argument — so scrutiny happened — and it still objects, so the CIO does
     * not see it yet. Two different questions, two different answers.
     */
    committed(
      await examine(revisionId, {
        challenges: [
          {
            contests: macroClaimId,
            kind: 'fragile-assumption',
            argument:
              'The growth attribution assumes the real-rate component was unchanged.',
            counterEvidence: [],
            wouldBeResolvedBy: 'A nominal/real decomposition over the same window.',
            materiality: 'material',
          },
        ],
      }),
      'peer examination with objection',
    )

    const gates = await gatesFor(revisionId, V2)
    expect(statusOf(gates, 'PEER_SCRUTINY_ABSENT')).toBe('passed')
    expect(statusOf(gates, 'CHALLENGE_UNRESOLVED')).toBe('failed')
    expect(gates.gates.eligible).toBe(false)
  })

  it('ignores the same peer objection under policy v1', async () => {
    /* Historical replay: v1 weighs the Devil's Advocate alone. */
    committed(
      await examine(revisionId, {
        challenges: [
          {
            contests: macroClaimId,
            kind: 'fragile-assumption',
            argument: 'The growth attribution assumes too much.',
            counterEvidence: [],
            wouldBeResolvedBy: 'A decomposition.',
            materiality: 'material',
          },
        ],
      }),
      'peer examination with objection',
    )

    const underV1 = await gatesFor(revisionId, V1)
    expect(statusOf(underV1, 'PEER_SCRUTINY_ABSENT')).toBe('not-applicable')
    expect(statusOf(underV1, 'CHALLENGE_UNRESOLVED')).toBe('failed')
    /* Failed because no DA review exists — not because of the peer. */
    expect(underV1.gates.gates.find((g) => g.code === 'CHALLENGE_UNRESOLVED')!.detail)
      .toContain("devil's advocate")
  })
})

/* ================================== the whole chain, act by act =========== */

describe('the audit trail the CIO decides on', () => {
  it('records every act, in order, with the objection that produced the revision', async () => {
    /*
     * One case, walked end to end through production commands. What matters is
     * not that it reaches `eligible` — it is that the record afterwards can be
     * read backwards: the submission names a basis, the basis names an
     * examination, the examination names a challenge, and the challenge names
     * the exact claim a desk disputed.
     */
    const { macro, rates } = await bothDesksAnalyse()
    const revisionId = await synthesise(macro, rates)

    /* ---- Rates examines the synthesis and objects to a specific claim ---- */

    /* Captured before any challenge exists, to compare against afterwards. */
    const macroConfidenceBefore = (await repositories.claims.get(macro.claimId))!
      .confidence

    const objection = committed(
      await examine(revisionId, {
        challenges: [
          {
            contests: macro.claimId,
            kind: 'fragile-assumption',
            argument:
              'The growth attribution assumes the real-rate component was unchanged.',
            counterEvidence: [],
            wouldBeResolvedBy: 'A nominal/real decomposition over the same window.',
            materiality: 'material',
          },
        ],
      }),
      'peer examination with objection',
    )
    record('peer examination (objecting)', objection, 'rates')

    const objecting = (await repositories.reviews.peerExaminationsForCase(CASE))[0]!
    const challengeId = objecting.challenges[0]!.id
    record('rates challenge', challengeId, 'rates')
    expect(objecting.challenges[0]!.contests).toBe(macro.claimId)
    expect(objecting.challenges[0]!.challengerKind).toBe('peer')

    /* Blocked, and blocked for the right reason. */
    const blocked = await gatesFor(revisionId, V2)
    expect(statusOf(blocked, 'PEER_SCRUTINY_ABSENT')).toBe('passed')
    expect(statusOf(blocked, 'CHALLENGE_UNRESOLVED')).toBe('failed')

    /* ---- Macro answers; Rates records the objection settled ------------- */

    /*
     * A re-review, superseding the first. `placeVerdict` enforces that it
     * speaks about the SAME revision and comes from the same department, so a
     * settlement cannot be recorded by a desk that did not raise the objection
     * or against an argument nobody examined.
     */
    const settled = committed(
      await examine(
        revisionId,
        {
          supersedesReviewId: objection,
          challenges: [
            {
              contests: macro.claimId,
              kind: 'fragile-assumption',
              argument:
                'The growth attribution assumes the real-rate component was unchanged.',
              counterEvidence: [],
              wouldBeResolvedBy: 'A nominal/real decomposition over the same window.',
              materiality: 'material',
              outcome: 'resolved',
              resolvedBy: 'research-director',
            },
          ],
        },
        `${CASE}-peer-2`,
        AFTER,
      ),
      'peer re-examination',
    )
    record('peer examination (settled)', settled, 'rates')

    /* ---- the remaining control functions -------------------------------- */

    const daReview = committed(
      await devilsAdvocate(revisionId, macro.claimId),
      'devils advocate',
    )
    record('devils advocate review', daReview, 'devils-advocate')

    const verification = committed(
      await verify(revisionId, [macro.claimId, rates.claimId]),
      'verification',
    )
    record('verification review', verification, 'verification')

    committed(
      await runCommand(
        resolveConditionalRequirement(organization),
        {
          caseId: CASE,
          playbookEntryKey: 'risk-review',
          revisionId,
          departmentId: 'risk',
          discipline: 'risk',
        },
        envelope({
          commandId: `${CASE}-risk-req`,
          actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
          /* Deciding whether a gate applies redirects institutional work, so
           * the command requires an account of why. */
          reason: 'The thesis carries a sizing implication, so Risk must look.',
        }),
        deps,
      ),
      'resolveConditionalRequirement',
    )

    const risk = committed(
      await runCommand(
        recordRiskReview(organization),
        {
          caseId: CASE,
          thesisId: THESIS,
          revisionId,
          byDepartmentId: 'risk',
          status: 'accepted',
          findings: [],
        },
        envelope({
          commandId: `${CASE}-risk`,
          actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
        }),
        deps,
      ),
      'risk review',
    )
    record('risk review', risk, 'risk')

    /* ---- and the submission the CIO would decide on --------------------- */

    const submission = committed(
      await runCommand(
        submitForCioDecision(organization),
        {
          caseId: CASE,
          thesisId: THESIS,
          revisionId,
          submittedByDepartmentId: 'research-office',
          eligibilityPolicyVersion: V2.version,
        },
        envelope({
          commandId: `${CASE}-cio`,
          expectedVersion: await caseVersion(),
        }),
        deps,
      ),
      'submitForCioDecision',
    )
    record('CIO submission', submission, 'research-office')

    /* ---------------------------------------------------- what it proves - */

    const stored = (await repositories.submissions.get(submission))!
    const basis = stored.basis

    /* The challenge gate can clear once the objection is settled. */
    expect(basis.peerScrutiny).toHaveLength(1)
    expect(basis.peerScrutiny[0]!.openChallenges).toEqual([])

    /*
     * And the objection is NOT erased. The settled examination still carries
     * the challenge, its materiality and who resolved it; the superseded
     * review is still readable beside it. Resolution means addressed.
     */
    const examinations = await repositories.reviews.peerExaminationsForCase(CASE)
    expect(examinations.map((e) => e.reviewId).sort()).toEqual(
      [objection, settled].sort(),
    )
    const current = examinations.find((e) => e.reviewId === settled)!
    expect(current.supersedesReviewId).toBe(objection)
    expect(current.challenges[0]!.contests).toBe(macro.claimId)
    expect(current.challenges[0]!.materiality).toBe('material')
    expect(current.challenges[0]!.resolvedBy).toBe('research-director')
    expect(current.outcomes[current.challenges[0]!.id]).toBe('resolved')

    /* The original Rates view survives the debate it started. */
    const ratesClaim = await repositories.claims.get(rates.claimId)
    expect(ratesClaim!.statement).toContain('real-rate repricing')

    /* The manager's unreconciled disagreement is in the basis the CIO reads. */
    expect(basis.materialDisagreements.map((d) => d.claimId)).toContain(rates.claimId)

    /*
     * And the debate moved no confidence.
     *
     * The Macro claim was challenged by a qualified peer and the objection was
     * settled. Its confidence is byte-identical to what it was when the desk
     * recorded it — surviving scrutiny is not evidence. The general rule and
     * the fixture-backed cases are proved in `epistemicLaundering.test.ts`;
     * this asserts it on the actual chain above.
     */
    const macroAfter = await repositories.claims.get(macro.claimId)
    expect(macroAfter!.confidence).toEqual(macroConfidenceBefore)

    /* The basis is v3 and was assembled, not asserted. */
    expect(basis.manifest.canonicalizationVersion).toBe(3)
    expect(basis.eligibilityPolicyVersion).toBe('2')

    /* ------------------------------------------- the trail, for the record */
    expect(trail.map((e) => e.act)).toEqual([
      'macro claim',
      'rates claim',
      'research-office claim',
      'synthesised revision',
      'peer examination (objecting)',
      'rates challenge',
      'peer examination (settled)',
      'devils advocate review',
      'verification review',
      'risk review',
      'CIO submission',
    ])
  })
})
