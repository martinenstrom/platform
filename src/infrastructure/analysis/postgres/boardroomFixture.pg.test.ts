/**
 * The Boardroom, proved against a real debate in a real database.
 *
 * A case is driven through the whole v5 workflow with production commands
 * against PostgreSQL — two independent analyses, a synthesis, a peer objection
 * that blocks the case, its settlement, the three control functions, and the
 * CIO submission — then read back through `caseOverview`, the same application
 * read path the route uses, and projected by `boardroomTimeline`.
 *
 * Nothing here constructs a timeline, a basis or an eligibility verdict. If the
 * Boardroom can show the debate, it is because the institution recorded one.
 *
 * The captured overview is written to disk for the jsdom render suite, so the
 * pixels are provable against records the firm actually produced rather than
 * against an object somebody typed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import { AT, LATER, LATEST, startRuntime, type Runtime } from './macroFlowHarness'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { recordContribution } from '~/application/analysis/commands/recordContribution'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { recordPeerExamination } from '~/application/analysis/commands/recordPeerExamination'
import { recordDevilsAdvocateReview } from '~/application/analysis/commands/recordDevilsAdvocateReview'
import { recordVerificationReview } from '~/application/analysis/commands/recordVerificationReview'
import { recordRiskReview } from '~/application/analysis/commands/recordRiskReview'
import { resolveConditionalRequirement } from '~/application/analysis/commands/resolveConditionalRequirement'
import { submitForCioDecision } from '~/application/analysis/commands/submitForCioDecision'
import { MACRO_REGIME_PLAYBOOK_V5 } from '~/application/analysis/macroPlaybook'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { caseOverview } from '~/application/analysis/caseOverview'
import { boardroomTimeline } from '~/application/analysis/boardroomTimeline'
import { buildEvidenceSet, citeFrom, observationRef } from '~/domain/analysis'
import { buildProvenance } from '~/domain/shared/provenance'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures')
const CASE = 'boardroom-debate'
const THESIS = `${CASE}-thesis`
const INST = `${CASE}-inst`
const THESIS_CMD = `${CASE}-thesis-cmd`
/** The settlement comes after the objection; a review's identity includes when. */
const SETTLED_AT = '2026-08-01T14:00:00.000Z'

let db: TestDatabase
let runtime: Runtime
let built: Awaited<ReturnType<typeof driveTheDebate>>

const EMPLOYEE: Readonly<Record<string, string>> = {
  'global-macro': 'macro-head',
  rates: 'rates-head',
  'research-office': 'research-director',
  verification: 'verification-head',
  'devils-advocate': 'devils-advocate-head',
  risk: 'chief-risk-officer',
}

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  runtime = await startRuntime(await db.loginUrlFor(APP_ROLE))
  built = await driveTheDebate()
}, 300_000)

afterAll(async () => {
  await runtime?.container.close()
  await db?.drop()
})

/** Drives the whole v5 chain. Every act is a production command. */
async function driveTheDebate() {
  const deps = await runtime.container.commandDeps()
  const repositories = runtime.container.repositories
  const organization = deps.organization

  const env = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
    commandId: 'c',
    correlationId: 'boardroom',
    actor: { kind: 'employee', employeeId: 'research-director' },
    initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
    occurredAt: LATER,
    ...over,
  })
  const must = async (result: { outcome: string }, step: string) => {
    if (result.outcome !== 'committed') {
      throw new Error(`${step} did not commit: ${JSON.stringify(result)}`)
    }
    return result
  }
  const version = async () => (await repositories.cases.get(CASE))!.version

  /*
   * A real observation for the desks to cite.
   *
   * Not an empty set: a supported claim with nothing behind it is refused by
   * the domain — correctly — and a Boardroom showing claims that rest on
   * nothing would prove only that the page renders an empty list. The
   * examination and the objection below are about what this number supports.
   */
  const observedAt = '2026-07-31T00:00:00.000Z'
  const value = {
    yieldPercent: '2.41',
    changeBasisPoints: null,
    observationDate: '2026-07-31',
  }
  const evidenceSet = buildEvidenceSet({
    items: [
      {
        ref: observationRef(
          {
            subjectKind: 'series',
            subject: 'de10y',
            kind: 'yield',
            observedAt,
            referencePeriod: value.observationDate,
            sourceId: 'ecb',
          },
          value,
        ),
        value,
        provenance: buildProvenance({
          asOf: observedAt,
          nowMs: Date.parse(AT),
          quality: 'official-daily',
          source: { providerId: 'ecb', providerName: 'ECB', trust: 'central-bank' },
        }),
      },
    ],
    assembledAt: AT,
    correlationId: 'boardroom',
  })
  await repositories.evidence.save(evidenceSet)

  await must(
    await runCommand(
      openInvestmentCase(organization),
      {
        caseId: CASE,
        subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
        question: 'Why did the long end move?',
        ownerEmployeeId: 'research-director',
        participatingDepartmentIds: ['research-office'],
      },
      env({ commandId: `${CASE}-open` }),
      deps,
    ),
    'open',
  )
  await must(
    await runCommand(
      instantiatePlaybook(organization),
      {
        caseId: CASE,
        playbookId: MACRO_REGIME_PLAYBOOK_V5.id,
        playbookVersion: MACRO_REGIME_PLAYBOOK_V5.version,
        onBehalfOfDepartmentId: 'research-office',
      },
      env({ commandId: INST, expectedVersion: 1 }),
      deps,
    ),
    'instantiate v5',
  )
  await must(
    await runCommand(
      proposeThesis(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        proposedByDepartmentId: 'research-office',
        statement: 'The long-end move is a growth repricing.',
        position: 'hold',
        implications: ['position-sizing'],
        invalidationCriteria: 'A real-rate decomposition showing otherwise.',
      },
      env({ commandId: THESIS_CMD }),
      deps,
    ),
    'thesis',
  )

  /** One desk's contribution: start, record, accept. */
  const contribute = async (
    entryKey: string,
    departmentId: string,
    statement: string,
  ) => {
    const employeeId = EMPLOYEE[departmentId]!
    const prefix = `${CASE}-${departmentId}`
    const assignmentId = (
      await repositories.assignments.listForCase(CASE)
    ).find((a) => a.playbookEntryKey === entryKey)!.id

    await must(
      await runCommand(
        startAgentRun(organization),
        {
          caseId: CASE,
          assignmentId,
          departmentId,
          providerId: 'recorded-desk',
          providerVersion: '1',
          providerKind: 'recorded' as const,
          agentContractVersion: '1',
          outputSchemaVersion: '1',
          identity: {
            kind: 'model' as const,
            prompt: { id: 'brief', version: '1', contentHash: 'ph' },
            model: {
              id: 'sonnet',
              provider: 'anthropic',
              parameters: {},
              parametersHash: 'mh',
            },
          },
          evidenceSetId: evidenceSet.id,
          budget: resolveExecutionBudget('recorded', {
            firmCeiling: { deadlineMs: 30_000 },
          }),
        },
        env({ commandId: `${prefix}-start`, actor: { kind: 'employee', employeeId } }),
        deps,
      ),
      `${entryKey} start`,
    )

    const runId = (await repositories.runs.listForCase(CASE)).find(
      (run) => run.assignmentId === assignmentId,
    )!.id

    await must(
      await runCommand(
        recordContribution(organization),
        {
          caseId: CASE,
          runId,
          departmentId,
          claims: [
            {
              /* The provider's own name for it. The command derives the id the
               * firm stores, so a caller cannot choose an institutional id. */
              id: `${entryKey}-claim`,
              type: 'causal' as const,
              statement,
              status: 'supported' as const,
              confidence: { level: 'moderate' as const, basis: [] },
              temporalScope: { asOf: AT },
              /* Cited from the set the run reasoned over, so the citation can
               * be checked rather than merely asserted. */
              evidenceRefs: [citeFrom(evidenceSet, evidenceSet.items[0]!.ref)],
              contradictingEvidenceRefs: [],
              /* A causal claim must say how it is justified; an inference has
               * to name its reasoning rather than assert a mechanism. */
              attribution: {
                kind: 'hedged-inference' as const,
                reasoning: 'Inferred from the shape of the move, not established.',
              },
            },
          ],
          observedStates: ['running' as const],
          usage: { state: 'not-applicable' as const },
        },
        env({ commandId: `${prefix}-record`, actor: { kind: 'employee', employeeId } }),
        deps,
      ),
      `${entryKey} record`,
    )
    await must(
      await runCommand(
        acceptContribution(organization),
        { caseId: CASE, runId, departmentId },
        env({ commandId: `${prefix}-accept`, actor: { kind: 'employee', employeeId } }),
        deps,
      ),
      `${entryKey} accept`,
    )

    const claimId = (await repositories.claims.listForRun(runId))[0]!.id
    return { runId, claimId }
  }

  /* Two desks, neither having read the other. */
  const macro = await contribute(
    'macro-analysis',
    'global-macro',
    'The long-end move reflects stronger growth expectations.',
  )
  const rates = await contribute(
    'rates-analysis',
    'rates',
    'The long-end move is a real-rate repricing, not a growth repricing.',
  )
  const office = await contribute(
    'aggregation',
    'research-office',
    'The two desk readings are reconcilable only in part.',
  )

  await must(
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: CASE,
        sourceRevisionId: deriveRevisionId(THESIS_CMD, THESIS),
        departmentId: 'research-office',
        inputRunIds: [macro.runId, rates.runId, office.runId],
        dispositions: [
          { claimId: macro.claimId, disposition: 'adopted-supporting' as const },
          { claimId: office.claimId, disposition: 'adopted-supporting' as const },
          {
            claimId: rates.claimId,
            disposition: 'retained-unresolved' as const,
            materiality: 'material' as const,
            explanation:
              'Both readings fit the nominal path; nothing available separates them.',
          },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation' as const,
            materiallyRelevant: false,
          },
        ],
        rationale: 'Both desks are retained; the growth reading leads on balance.',
        statement: 'The long-end move is predominantly a growth repricing.',
        position: 'hold',
        implications: ['position-sizing'],
        invalidationCriteria: 'A real-rate decomposition showing otherwise.',
      },
      env({ commandId: `${CASE}-agg` }),
      deps,
    ),
    'aggregate',
  )
  const revisionId = deriveRevisionId(`${CASE}-agg`, THESIS)

  await must(
    await runCommand(
      submitForVerification(organization),
      { caseId: CASE, revisionId, submittedByDepartmentId: 'research-office' },
      env({ commandId: `${CASE}-submit`, expectedVersion: await version() }),
      deps,
    ),
    'submit for verification',
  )

  const objection = {
    contests: macro.claimId,
    kind: 'fragile-assumption' as const,
    argument: 'The growth attribution assumes the real-rate component was unchanged.',
    counterEvidence: [],
    wouldBeResolvedBy: 'A nominal/real decomposition over the same window.',
    materiality: 'material' as const,
  }

  const objecting = await must(
    await runCommand(
      recordPeerExamination(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        revisionId,
        byDepartmentId: 'rates',
        examinedDepartmentId: 'global-macro',
        challenges: [objection],
      },
      env({
        commandId: `${CASE}-peer`,
        actor: { kind: 'employee', employeeId: 'rates-head' },
      }),
      deps,
    ),
    'peer objection',
  )

  /* The state the CIO must not be able to reach. Captured before settlement. */
  const blocked = (await caseOverview({
    repositories,
    organization,
    caseId: CASE,
    now: LATER,
  }))!

  const settled = await must(
    await runCommand(
      recordPeerExamination(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        revisionId,
        byDepartmentId: 'rates',
        examinedDepartmentId: 'global-macro',
        supersedesReviewId: (objecting as { resultRef?: string }).resultRef!,
        challenges: [
          { ...objection, outcome: 'resolved' as const, resolvedBy: 'research-director' },
        ],
      },
      env({
        commandId: `${CASE}-peer-2`,
        occurredAt: SETTLED_AT,
        actor: { kind: 'employee', employeeId: 'rates-head' },
      }),
      deps,
    ),
    'peer settlement',
  )

  await must(
    await runCommand(
      recordDevilsAdvocateReview(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        revisionId,
        byDepartmentId: 'devils-advocate',
        challenges: [
          {
            contests: macro.claimId,
            kind: 'fragile-assumption' as const,
            argument: 'The growth reading rests on one print.',
            counterEvidence: [],
            wouldBeResolvedBy: 'A second independent print.',
            materiality: 'non-material' as const,
          },
        ],
      },
      env({
        commandId: `${CASE}-da`,
        occurredAt: SETTLED_AT,
        actor: { kind: 'employee', employeeId: 'devils-advocate-head' },
      }),
      deps,
    ),
    'devils advocate',
  )
  await must(
    await runCommand(
      recordVerificationReview(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        revisionId,
        byDepartmentId: 'verification',
        status: 'verified' as const,
        findings: [],
        claimsReviewed: [macro.claimId, rates.claimId],
      },
      env({
        commandId: `${CASE}-verify`,
        occurredAt: SETTLED_AT,
        actor: { kind: 'employee', employeeId: 'verification-head' },
      }),
      deps,
    ),
    'verification',
  )
  await must(
    await runCommand(
      resolveConditionalRequirement(organization),
      {
        caseId: CASE,
        playbookEntryKey: 'risk-review',
        revisionId,
        departmentId: 'risk',
        discipline: 'risk',
      },
      env({
        commandId: `${CASE}-rr`,
        occurredAt: SETTLED_AT,
        actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
        reason: 'The thesis carries a sizing implication, so Risk must look.',
      }),
      deps,
    ),
    'risk requirement',
  )
  await must(
    await runCommand(
      recordRiskReview(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        revisionId,
        byDepartmentId: 'risk',
        status: 'accepted' as const,
        findings: [],
      },
      env({
        commandId: `${CASE}-risk`,
        occurredAt: SETTLED_AT,
        actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
      }),
      deps,
    ),
    'risk review',
  )

  const submission = await must(
    await runCommand(
      submitForCioDecision(organization),
      {
        caseId: CASE,
        thesisId: THESIS,
        revisionId,
        submittedByDepartmentId: 'research-office',
        eligibilityPolicyVersion: '2',
      },
      env({
        commandId: `${CASE}-cio`,
        occurredAt: LATEST,
        expectedVersion: await version(),
      }),
      deps,
    ),
    'submit to CIO',
  )

  const final = (await caseOverview({
    repositories,
    organization,
    caseId: CASE,
    now: LATEST,
  }))!

  return {
    blocked,
    final,
    revisionId,
    macroClaimId: macro.claimId,
    ratesClaimId: rates.claimId,
    objectingReviewId: (objecting as { resultRef?: string }).resultRef!,
    settledReviewId: (settled as { resultRef?: string }).resultRef!,
    submissionId: (submission as { resultRef?: string }).resultRef!,
  }
}

/* ============================================================ the assertions */

describe('the Boardroom shows a debate the institution actually had', () => {
  it('shows both desks reaching their own conclusions', () => {
    const timeline = boardroomTimeline(built.final)
    const analyses = timeline.entries.filter(
      (entry) => entry.kind === 'analysis-recorded',
    )
    expect(analyses.map((entry) => entry.byDepartmentId).sort()).toEqual([
      'global-macro',
      'rates',
      'research-office',
    ])
    /* Each names the claims it produced, so the reader can read the position. */
    for (const entry of analyses) expect(entry.claimIds?.length).toBeGreaterThan(0)
  })

  it('names the desks as the organisation names them', () => {
    /* Rates has no persona and is still named — from the organisation. */
    const rates = built.final.departments.find((desk) => desk.id === 'rates')
    expect(rates).toMatchObject({ name: 'Rates', isGovernance: false })
  })

  it('shows the objection against the exact Macro claim', () => {
    const timeline = boardroomTimeline(built.final)
    const objections = timeline.entries
      .filter((entry) => entry.kind === 'peer-examination')
      .flatMap((entry) => entry.objections ?? [])
    expect(objections.some((o) => o.contests === built.macroClaimId)).toBe(true)
    expect(objections.every((o) => o.materiality === 'material')).toBe(true)
  })

  it('shows the case blocked while the objection was open', () => {
    /*
     * The state captured BEFORE settlement, from the read path the route uses.
     * Peer scrutiny passed — a desk examined — and the challenge gate refused.
     */
    const standing = built.blocked.standing
    expect(standing.steps.find((s) => s.step === 'peer-examination')!.status).toBe(
      'complete',
    )
    expect(standing.nextAct.act).not.toBe('submit-for-cio-decision')
  })

  it('keeps the original objection after it was settled', () => {
    const timeline = boardroomTimeline(built.final)
    const examinations = timeline.entries.filter(
      (entry) => entry.kind === 'peer-examination',
    )
    expect(examinations.map((entry) => entry.id).sort()).toEqual(
      [built.objectingReviewId, built.settledReviewId].sort(),
    )

    const superseded = examinations.find((entry) => entry.id === built.objectingReviewId)!
    const current = examinations.find((entry) => entry.id === built.settledReviewId)!
    expect(superseded.superseded).toBe(true)
    expect(current.supersedesReviewId).toBe(built.objectingReviewId)
    /* Settled, and still readable as a disagreement that was answered. */
    expect(current.objections![0]).toMatchObject({
      outcome: 'resolved',
      resolvedBy: 'research-director',
      materiality: 'material',
    })
  })

  it('separates the control functions from the desks', () => {
    const timeline = boardroomTimeline(built.final)
    const lanes = new Map(timeline.entries.map((entry) => [entry.id, entry.lane]))
    expect(lanes.get(built.settledReviewId)).toBe('analysis')
    for (const review of built.final.verification) {
      expect(lanes.get(review.reviewId)).toBe('governance')
    }
    for (const review of built.final.risk) expect(lanes.get(review.reviewId)).toBe('governance')
  })

  it('reaches the CIO only after the gates cleared, under policy 2', () => {
    const eligibility = built.final.eligibility
    expect(eligibility.kind).toBe('recorded')
    if (eligibility.kind !== 'recorded') return
    expect(eligibility.policyVersion).toBe('2')
    expect(eligibility.report.eligible).toBe(true)
    expect(
      eligibility.report.gates.find((gate) => gate.code === 'PEER_SCRUTINY_ABSENT')!
        .status,
    ).toBe('passed')

    const timeline = boardroomTimeline(built.final)
    expect(
      timeline.entries.some(
        (entry) => entry.kind === 'cio-submission' && entry.id === built.submissionId,
      ),
    ).toBe(true)
  })

  it('every entry resolves to a persisted institutional object', () => {
    /*
     * The rule the whole surface rests on. Nothing may appear on the floor that
     * the reader cannot follow back into the record.
     */
    const timeline = boardroomTimeline(built.final)
    const known = new Set<string>([
      ...built.final.runs.map((run) => run.id),
      ...built.final.aggregations.map((aggregation) => aggregation.id),
      ...built.final.peerExaminations.map((review) => review.reviewId),
      ...built.final.verification.map((review) => review.reviewId),
      ...built.final.devilsAdvocate.map((review) => review.reviewId),
      ...built.final.risk.map((review) => review.reviewId),
      ...built.final.submissions.map((submission) => submission.id),
      ...built.final.decisionHistory.map((decision) => decision.decisionId),
    ])
    expect(timeline.entries.length).toBeGreaterThan(0)
    for (const entry of timeline.entries) expect(known.has(entry.id), entry.id).toBe(true)
  })
})

/* ============================================================== the capture */

describe('the captured record the render suite draws', () => {
  it('writes the debate exactly as the read model produced it', () => {
    /*
     * Only `evaluatedAt`, `provenanceId` and `buildId` are scrubbed — they name
     * the process that happened to write the row. Ids, digests and timestamps
     * stay as recorded, because a fixture with tidied values would prove the
     * page renders tidy values.
     */
    const scrubbed = JSON.parse(
      JSON.stringify(built.final, (key, value) =>
        key === 'provenanceId' || key === 'buildId' || key === 'evaluatedAt'
          ? '<scrubbed>'
          : value,
      ),
    )
    const path = resolve(FIXTURES, 'boardroom.debate.json')
    const next = `${JSON.stringify(scrubbed, null, 2)}\n`
    const previous = readOrNull(path)

    if (previous !== next) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, next, 'utf8')
    }
    expect(previous === next, `${path} was regenerated; re-run the unit suite.`).toBe(
      true,
    )
  })
})

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
