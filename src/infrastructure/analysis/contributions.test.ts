/**
 * C1C-2: what a contribution has to be before it becomes a record.
 *
 * Most of this file is refusals, and that is the point. Proving that good
 * provider output is stored says very little; proving that bad provider output
 * is refused — and refused durably, with a code, rather than thrown away — is
 * what makes the claim "a recorded contribution goes through the same checks a
 * live one will" worth anything.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildClaim,
  buildEvidenceSet,
  citeFrom,
  observationRef,
  type AgentClaim,
  type EvidenceItem,
  type EvidenceRef,
  type EvidenceSet,
} from '~/domain/analysis'
import { buildProvenance, type Quality } from '~/domain/shared/provenance'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  deriveAssignmentId,
  deriveClaimId,
  deriveRevisionId,
  deriveRunId,
} from '~/application/analysis/commands/eventIdentity'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { recordContribution } from '~/application/analysis/commands/recordContribution'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { rejectContribution } from '~/application/analysis/commands/rejectContribution'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import { CANONICALIZATION_VERSION, resultKey } from '~/application/analysis/resultStore'
import { executionIdentityKey } from '~/domain/analysis'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'

const AT = '2026-07-29T09:00:00.000Z'
const LATER = '2026-07-29T11:00:00.000Z'
const organization = TEST_ORGANIZATION

/* ------------------------------------------------------------------ evidence */

/** One observation, with the provenance that decides whether it is real. */
/*
 * The value is a canonical decimal string, matching what `evidenceRefs`
 * produces from a provider quote. A fractional double is refused by the
 * canonical-value model, and `EvidenceItem.value` is an identity input.
 */
function item(subject: string, value: string, quality: Quality): EvidenceItem {
  return {
    ref: observationRef(
      {
        subjectKind: 'series',
        subject,
        kind: 'yield',
        observedAt: '2026-07-28T00:00:00.000Z',
        sourceId: quality === 'fixture' ? 'fixture' : 'ecb',
      },
      /*
       * A complete yield projection. The payload used to be the bare string
       * `value`, which is not an object and so has no projection at all --
       * a `yield` kind whose stored payload could never satisfy it.
       */
      { yieldPercent: value, changeBasisPoints: null, observationDate: '2026-07-28' },
    ),
    value: {
      yieldPercent: value,
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    },
    provenance: buildProvenance({
      asOf: '2026-07-28T00:00:00.000Z',
      nowMs: Date.parse(AT),
      quality,
      source: {
        providerId: quality === 'fixture' ? 'fixture' : 'ecb',
        providerName: quality === 'fixture' ? 'Fixture' : 'ECB',
        trust: quality === 'fixture' ? 'synthetic' : 'central-bank',
      },
    }),
  }
}

const REAL = item('de10y', '2.41', 'official-daily')
const INVENTED = item('made-up', '1.11', 'fixture')

const evidenceSet: EvidenceSet = buildEvidenceSet({
  items: [REAL, INVENTED],
  assembledAt: AT,
  correlationId: 'corr-1',
})

const cite = (of: EvidenceItem): EvidenceRef => citeFrom(evidenceSet, of.ref)

/* -------------------------------------------------------------------- claims */

const claim = (over: Partial<AgentClaim> = {}): AgentClaim =>
  ({
    id: 'c-1',
    type: 'observation',
    statement: 'The 10y sits at 2.41',
    evidenceRefs: [cite(REAL)],
    contradictingEvidenceRefs: [],
    confidence: {
      level: 'moderate',
      basis: ['bounded by the weakest evidence (moderate)'],
      cappedBy: 'weakest-evidence',
    },
    temporalScope: { asOf: AT },
    status: 'supported',
    ...over,
  }) as AgentClaim

/* ------------------------------------------------------------------ harness */

let repositories: AnalysisRepositories
let deps: CommandDeps
let assignmentId: string

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-1',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'employee', employeeId: 'research-director' },
  occurredAt: AT,
  ...over,
})

const RUN_DECLARATION = {
  providerId: 'recorded-macro',
  providerVersion: '2',
  providerKind: 'recorded' as const,
  agentContractVersion: '1',
  outputSchemaVersion: '1',
  identity: {
    kind: 'model' as const,
    prompt: { id: 'macro-brief', version: '1', contentHash: 'ph' },
    model: { id: 'sonnet', provider: 'anthropic', parameters: {}, parametersHash: 'mh' },
  },
}

async function seedRunningRun(): Promise<string> {
  await repositories.evidence.save(evidenceSet)

  await runCommand(
    openInvestmentCase(organization),
    {
      caseId: 'case-1',
      subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
      question: 'Does the ECB cut before Q2?',
      ownerEmployeeId: 'research-director',
      participatingDepartmentIds: ['research-office'],
    },
    envelope({ commandId: 'cmd-open' }),
    deps,
  )

  await runCommand(
    instantiatePlaybook(organization),
    {
      caseId: 'case-1',
      playbookId: MACRO_REGIME_PLAYBOOK.id,
      playbookVersion: MACRO_REGIME_PLAYBOOK.version,
      onBehalfOfDepartmentId: 'research-office',
    },
    envelope({ commandId: 'cmd-inst', expectedVersion: 1 }),
    deps,
  )

  assignmentId = deriveAssignmentId('cmd-inst', 'macro-analysis')

  await runCommand(
    startAgentRun(organization),
    {
      caseId: 'case-1',
      assignmentId,
      departmentId: 'global-macro',
      evidenceSetId: evidenceSet.id,
      ...RUN_DECLARATION,
    },
    envelope({
      commandId: 'cmd-run',
      actor: { kind: 'employee', employeeId: 'macro-analyst' },
      initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
    }),
    deps,
  )

  return deriveRunId('cmd-run', assignmentId)
}

let runId: string

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  runId = await seedRunningRun()
})

const record = (
  claims: readonly AgentClaim[],
  over: Record<string, unknown> = {},
  commandId = 'cmd-record',
) =>
  runCommand(
    recordContribution(organization),
    {
      caseId: 'case-1',
      runId,
      departmentId: 'global-macro',
      claims,
      observedStates: ['running'] as const,
      usage: { state: 'not-applicable' } as const,
      ...over,
    },
    envelope({
      commandId,
      occurredAt: LATER,
      actor: { kind: 'employee', employeeId: 'macro-analyst' },
      initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
    }),
    deps,
  )

/**
 * The human act that follows production.
 *
 * Separate from `record` on purpose: these are two institutional acts now, and
 * a helper that fused them would hide the boundary the tests below exist to
 * check.
 */
const accept = (commandId = 'cmd-accept') =>
  runCommand(
    acceptContribution(organization),
    { caseId: 'case-1', runId, departmentId: 'global-macro' },
    envelope({
      commandId,
      occurredAt: LATER,
      actor: { kind: 'employee', employeeId: 'macro-analyst' },
    }),
    deps,
  )

/** Produce, then accept — what the old single-act `record` used to do. */
const recordAndAccept = async (
  claims: readonly AgentClaim[],
  over: Record<string, unknown> = {},
  commandId = 'cmd-record',
) => {
  const produced = await record(claims, over, commandId)
  if (produced.outcome !== 'committed') return produced
  return accept(`${commandId}-accept`)
}

/* ------------------------------------------------------- the contribution */

describe('RecordContribution', () => {
  it('completes the run, the claims and the assignment once a human accepts', async () => {
    const result = await recordAndAccept([claim()])
    expect(result.outcome).toBe('committed')

    const run = await repositories.runs.get(runId)
    expect(run!.state).toBe('completed')
    expect(run!.completedAt).toBe(LATER)

    const stored = await repositories.claims.listForRun(runId)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.statement).toBe('The 10y sits at 2.41')

    const assignment = await repositories.assignments.get(assignmentId)
    expect(assignment?.status).toBe('completed')
    expect(assignment?.completedAt).toBe(LATER)
  })

  it('gives the claim an identity the firm derived, not one the provider chose', async () => {
    await recordAndAccept([claim()])
    const [stored] = await repositories.claims.listForRun(runId)

    // The provider called it `c-1`. Two cases replaying one fixture would then
    // both assert `c-1`, which is a collision or a silent merge.
    expect(stored!.id).toBe(deriveClaimId('cmd-record', 'c-1'))
    expect(stored!.id).not.toBe('c-1')
  })

  it('stores the immutable result, marked as the replay it is', async () => {
    await recordAndAccept([claim()])
    const run = await repositories.runs.get(runId)

    const stored = await repositories.results.get(
      resultKey({
        evidenceSetId: evidenceSet.id,
        caseId: 'case-1',
        executionIdentity: executionIdentityKey(run!.execution.identity),
        agentContractVersion: run!.agentContractVersion,
        outputSchemaVersion: run!.outputSchemaVersion,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        agentImplementationVersion: '2',
        playbookVersion: '1',
        departmentId: 'global-macro',
      }),
    )

    expect(stored).not.toBeNull()
    // Reused analysis is still analysis: a fixture replay must not be able to
    // be served back as work the firm stands behind.
    expect(stored!.providerKind).toBe('recorded')
  })

  it('records only the states the provider actually reported', async () => {
    await record([claim()], { observedStates: ['running'] })
    const run = await repositories.runs.get(runId)

    // `running` was already recorded when the run started; a second one would
    // be a transition to itself, which the activity feed would render as a
    // department starting work it was already doing.
    //
    // The log ends at `awaiting-acceptance` — the state the run actually
    // reached. Completion is appended by `AcceptContribution`, when it is true.
    expect(run!.events.map((e) => e.state)).toEqual(['running', 'awaiting-acceptance'])
  })

  it('refuses a provider that reports having completed', async () => {
    /*
     * The activity feed renders run events directly. A provider able to report
     * `completed` could therefore put "the macro desk finished" on the
     * headquarters floor for work no human has read — the one claim this whole
     * boundary exists to withhold.
     */
    const outcome = await record([claim()], {
      observedStates: ['running', 'completed'],
    })

    expect(outcome.outcome).toBe('rejected')
    const run = await repositories.runs.get(runId)
    // Refused, and nothing recorded: not the state, and not the work.
    expect(run!.state).toBe('running')
    expect(await repositories.producedClaims.listForRun(runId)).toEqual([])
  })

  it('refuses a provider that reports an outcome only the firm can settle', async () => {
    /* `failed` is `FailAgentRun`'s to record, for the same reason. */
    const outcome = await record([claim()], { observedStates: ['failed'] })
    expect(outcome.outcome).toBe('rejected')
  })

  it('records a replay as having consumed nothing, not as free', async () => {
    await record([claim()])
    // `not-applicable` rather than a null cost: there was nothing to spend,
    // which is a different fact from a measurement of zero.
    expect((await repositories.runs.get(runId))!.usage).toEqual({
      state: 'not-applicable',
    })
  })

  it('records a measurement, including a measured zero', async () => {
    await record([claim()], {
      usage: {
        state: 'measured',
        inputTokens: 900,
        outputTokens: 120,
        costMinorUnits: 0,
        currency: 'USD',
      },
    })
    // Zero is a measurement: the provider said this call was free, which is
    // not the same as saying nothing.
    expect((await repositories.runs.get(runId))!.usage).toEqual({
      state: 'measured',
      inputTokens: 900,
      outputTokens: 120,
      costMinorUnits: 0,
      currency: 'USD',
    })
  })

  it('refuses usage a replay could not have', async () => {
    /*
     * A recorded run reporting `not-reported` would be claiming it made a call
     * whose cost nobody captured. It made no call — and the domain refuses the
     * combination rather than storing a plausible-looking one.
     */
    const result = await record([claim()], { usage: { state: 'not-reported' } })
    expect(result.outcome).toBe('failed')
  })

  it('replays to the same contribution rather than recording a second', async () => {
    const first = await recordAndAccept([claim()])
    const replay = await recordAndAccept([claim()])

    expect(first.outcome).toBe('committed')
    expect(replay.outcome).toBe('committed')
    expect(await repositories.claims.listForRun(runId)).toHaveLength(1)
  })
})

/* ---------------------------------------------------------- refused writes */

describe('what a contribution may not be', () => {
  const refused = (result: { outcome: string }) => expect(result.outcome).toBe('rejected')

  it('refuses a completion with no claims at all', async () => {
    // A desk that finished and asserted nothing did not contribute; that is
    // FailAgentRun's fact to record, and the difference is worth keeping.
    const result = await record([])
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
    expect((await repositories.runs.get(runId))!.state).toBe('running')
  })

  it('refuses a citation the evidence set never contained', async () => {
    const result = await record([
      claim({
        evidenceRefs: [
          { setId: evidenceSet.id, observationId: 'invented', contentHash: 'x' },
        ],
      }),
    ])
    refused(result)
  })

  it('refuses a citation into another evidence set', async () => {
    const result = await record([
      claim({
        evidenceRefs: [{ ...cite(REAL), setId: 'another-set' }],
      }),
    ])
    refused(result)
  })

  it('refuses a citation whose content moved after it was quoted', async () => {
    // Same observation id, different content hash: the number was revised
    // under the claim. Checking ids alone would pass this.
    const result = await record([
      claim({ evidenceRefs: [{ ...cite(REAL), contentHash: 'revised' }] }),
    ])
    refused(result)
  })

  it('refuses a supported claim with nothing behind it', async () => {
    const result = await record([claim({ evidenceRefs: [], status: 'supported' })])
    refused(result)
  })

  it('refuses a causal claim that states no attribution', async () => {
    const result = await record([
      claim({ type: 'causal', statement: 'yields rose because the ECB turned' }),
    ])
    refused(result)
  })

  it('refuses a forecast with no horizon', async () => {
    const result = await record([
      claim({ type: 'forecast', temporalScope: { asOf: AT } }),
    ])
    refused(result)
  })

  it('refuses fixture-backed reasoning that does not say so', async () => {
    /*
     * The storage-side half of the standing rule. The evidence is invented; a
     * claim resting on it that arrives publishable would put fabricated
     * numbers into a thesis as analysis.
     */
    const result = await record([
      claim({
        evidenceRefs: [cite(INVENTED)],
        confidence: { level: 'high', basis: ['looks convincing'] },
      }),
    ])
    refused(result)
  })

  it('accepts fixture-backed reasoning that is capped by it', async () => {
    const result = await record([
      claim({
        evidenceRefs: [cite(INVENTED)],
        status: 'insufficient-evidence',
        confidence: {
          level: 'insufficient',
          basis: ['rests on fixture data'],
          cappedBy: 'fixture-evidence',
        },
      }),
    ])
    expect(result.outcome).toBe('committed')
  })

  it('refuses two claims sharing one name', async () => {
    const result = await record([claim(), claim({ statement: 'and also' })])
    refused(result)
  })

  it('refuses a counterclaim contesting something nobody recorded', async () => {
    const result = await record([
      claim({ type: 'counterclaim', contests: 'never-existed' }),
    ])
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-found' },
    })
  })

  it('keeps a counterclaim pointing at the claim it was written to contest', async () => {
    await recordAndAccept([
      claim(),
      claim({ id: 'c-2', type: 'counterclaim', contests: 'c-1' }),
    ])

    const stored = await repositories.claims.listForRun(runId)
    const counter = stored.find((c) => c.type === 'counterclaim')
    // Translated with the claim it contests, so the link survives the change
    // of identity rather than dangling.
    expect(counter!.contests).toBe(deriveClaimId('cmd-record', 'c-1'))
    expect(stored.some((c) => c.id === counter!.contests)).toBe(true)
  })

  it('refuses a contribution for another department’s run', async () => {
    const result = await record([claim()], { departmentId: 'quant-technical' })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('refuses an expectedVersion it has no use for', async () => {
    const result = await runCommand(
      recordContribution(organization),
      {
        caseId: 'case-1',
        runId,
        departmentId: 'global-macro',
        claims: [claim()],
        observedStates: [],
        usage: { state: 'not-applicable' },
      },
      envelope({
        commandId: 'cmd-ver',
        expectedVersion: 2,
        actor: { kind: 'employee', employeeId: 'macro-analyst' },
      }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('writes nothing at all when it refuses', async () => {
    await record([claim({ evidenceRefs: [], status: 'supported' })])

    // Everything or nothing: no half-stored claim, no completed assignment.
    expect(await repositories.claims.listForRun(runId)).toEqual([])
    expect((await repositories.runs.get(runId))!.state).toBe('running')
    expect((await repositories.assignments.get(assignmentId))?.status).toBe('active')
  })

  it('records the refusal in the ledger rather than dropping it', async () => {
    await record([], {}, 'cmd-empty')
    const entry = await repositories.commands.find('cmd-empty')

    // "The desk answered with something inadmissible" is a fact, and an
    // absence cannot carry it.
    expect(entry).not.toBeNull()
    expect(entry!.outcomes).toEqual([
      { state: 'rejected', reasonCode: 'invariant-violated', recordedAt: AT },
    ])
  })

  it('gives two claims two identities', async () => {
    await recordAndAccept([
      claim(),
      claim({ id: 'c-2', statement: 'and the 2y at 2.10' }),
    ])
    const stored = await repositories.claims.listForRun(runId)

    expect(stored).toHaveLength(2)
    expect(new Set(stored.map((c) => c.id)).size).toBe(2)
  })

  it('rolls the whole contribution back when one claim cannot be stored', async () => {
    /*
     * The atomicity claim, exercised rather than asserted. A claim already
     * exists under the identity this contribution would derive, holding
     * different content — so the write fails partway through, after the run
     * and some claims would otherwise have been saved.
     */
    await repositories.claims.save(
      buildClaim({
        ...claim({ statement: 'something else entirely' }),
        id: deriveClaimId('cmd-rollback', 'c-2'),
      }),
      'case-1',
      runId,
    )

    const result = await recordAndAccept(
      [claim(), claim({ id: 'c-2', statement: 'and the 2y at 2.10' })],
      {},
      'cmd-rollback',
    )

    expect(result.outcome).toBe('failed')
    /*
     * Everything or nothing — now of the ACCEPTANCE act, which is where claims
     * reach the institution and therefore where the conflict surfaces. The run
     * falls back to awaiting acceptance rather than to running: the work was
     * produced and is still there to be judged, and only the attempt to admit
     * it failed.
     */
    expect((await repositories.runs.get(runId))!.state).toBe('awaiting-acceptance')
    expect((await repositories.assignments.get(assignmentId))?.status).toBe('active')
    expect(await repositories.claims.listForRun(runId)).toHaveLength(1)
  })

  it('refuses a second, different contribution under one command id', async () => {
    await record([claim()], {}, 'cmd-same-id')
    const conflicting = await record(
      [claim({ statement: 'a different assertion' })],
      {},
      'cmd-same-id',
    )

    // Not a retry. Two different requests travelling under one identity is
    // reported rather than silently answered with the first one's result.
    expect(conflicting).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'payload-conflict' },
    })
  })
})

/* -------------------------------------------------------------- late results */

describe('a result that arrives after the world moved on', () => {
  /**
   * Every way a run can stop being active, and the disposition each produces.
   *
   * The distinction the whole section exists for: the provider RETURNED
   * output, and the institution did not ACCEPT it. The first is a fact and
   * survives in the ledger; the second never happened, so nothing downstream
   * may act as though it did.
   */
  const settleRun = async (over: Record<string, unknown>) => {
    const current = await repositories.runs.get(runId)
    await repositories.runs.save(
      {
        ...current!,
        failure: { category: 'provider-error', retryable: false, attempt: 1, at: AT },
        ...over,
      },
      deps.provenance,
    )
  }

  it.each([
    ['failed', { state: 'failed' as const }],
    ['timed-out', { state: 'timed-out' as const }],
    ['cancelled', { state: 'cancelled' as const }],
    ['superseded', { state: 'superseded' as const, failure: undefined }],
  ])('refuses a result for a run that is already %s', async (_label, over) => {
    await settleRun(over)
    const late = await record([claim()], {}, 'cmd-late-settled')

    expect(late).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })

    // Not accepted: no claims, no completed assignment, no stored result.
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
    expect((await repositories.assignments.get(assignmentId))?.status).not.toBe(
      'completed',
    )
    // But recorded: the attempt is an auditable fact with a reason code.
    const entry = await repositories.commands.find('cmd-late-settled')
    expect(entry!.outcomes).toEqual([
      { state: 'rejected', reasonCode: 'illegal-prior-state', recordedAt: AT },
    ])
  })

  it('refuses a result for work the organization cancelled', async () => {
    const assignment = await repositories.assignments.get(assignmentId)
    await repositories.assignments.save({ ...assignment!, status: 'cancelled' })

    const late = await record([claim()], {}, 'cmd-late-cancelled')
    expect(late).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
  })

  it('refuses a second contribution once the run has settled', async () => {
    await recordAndAccept([claim()], {}, 'cmd-first')
    const late = await recordAndAccept(
      [claim({ statement: 'actually, something else' })],
      {},
      'cmd-late',
    )

    expect(late).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
    expect(await repositories.claims.listForRun(runId)).toHaveLength(1)
  })

  it('refuses work against a revision that was superseded mid-flight', async () => {
    await runCommand(
      proposeThesis(organization),
      {
        caseId: 'case-1',
        thesisId: 'thesis-1',
        statement: 'The ECB cuts in March',
        position: 'directional',
        invalidationCriteria: 'Core inflation above 3% in February',
        implications: [],
        proposedByDepartmentId: 'research-office',
      },
      envelope({ commandId: 'cmd-thesis' }),
      deps,
    )

    const revisionId = deriveRevisionId('cmd-thesis', 'thesis-1')
    const quantId = deriveAssignmentId('cmd-inst', 'quant-validation')
    await runCommand(
      startAgentRun(organization),
      {
        caseId: 'case-1',
        assignmentId: quantId,
        departmentId: 'quant-technical',
        revisionId,
        evidenceSetId: evidenceSet.id,
        ...RUN_DECLARATION,
      },
      envelope({
        commandId: 'cmd-quant-run',
        actor: { kind: 'employee', employeeId: 'quant-head' },
      }),
      deps,
    )

    // The firm replaces the argument while the desk is working. C1C-3 builds
    // the command that does this; the state it produces is what matters here.
    const revision = await repositories.theses.get(revisionId)
    await repositories.theses.save({ ...revision!, lifecycle: 'superseded' })

    const late = await runCommand(
      recordContribution(organization),
      {
        caseId: 'case-1',
        runId: deriveRunId('cmd-quant-run', quantId),
        departmentId: 'quant-technical',
        claims: [claim()],
        observedStates: [],
        usage: { state: 'not-applicable' },
      },
      envelope({
        commandId: 'cmd-quant-record',
        actor: { kind: 'employee', employeeId: 'quant-head' },
      }),
      deps,
    )

    expect(late).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
    // Not reattached to whatever the current revision happens to be.
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
  })
})

/* ------------------------------------------------------ the human boundary */

/**
 * The three citability assertions, which are C2-1's exit criteria.
 *
 * Generated work is **operational** until a person accepts it; accepted work is
 * **institutional**; rejected work is durable operational history and never
 * citable institutional evidence. Each of the three is checked by trying to
 * cite the work through a real institutional path — a counterclaim from another
 * desk — rather than by reading a flag and trusting it.
 *
 * The mechanism is the separation itself. Every citation in the institution is
 * a reference into the claims store, and produced work is not in it, so citing
 * unaccepted work fails because the claim is not there. In PostgreSQL that is a
 * foreign key; here it is the same absence. Neither is a filter that a consumer
 * had to remember to apply.
 */
describe('citing an agent’s work, before and after a person judges it', () => {
  /** The stored identity of the claim produced under `cmd-record`. */
  const producedClaimId = () => deriveClaimId('cmd-record', 'c-1')

  /**
   * Another desk contesting the macro desk's claim.
   *
   * A counterclaim across runs is the Devil's Advocate's whole purpose, which
   * makes it the honest way to ask "can this work be cited yet?".
   */
  const contestFromQuantDesk = async (commandId: string) => {
    const quantId = deriveAssignmentId('cmd-inst', 'quant-validation')
    await runCommand(
      startAgentRun(organization),
      {
        caseId: 'case-1',
        assignmentId: quantId,
        departmentId: 'quant-technical',
        evidenceSetId: evidenceSet.id,
        ...RUN_DECLARATION,
      },
      envelope({
        commandId: `${commandId}-run`,
        actor: { kind: 'employee', employeeId: 'quant-head' },
      }),
      deps,
    )

    return runCommand(
      recordContribution(organization),
      {
        caseId: 'case-1',
        runId: deriveRunId(`${commandId}-run`, quantId),
        departmentId: 'quant-technical',
        claims: [
          claim({
            id: 'q-1',
            type: 'counterclaim',
            statement: 'The 10y print is stale',
            contests: producedClaimId(),
          }),
        ],
        observedStates: ['running'],
        usage: { state: 'not-applicable' },
      },
      envelope({
        commandId: `${commandId}-record`,
        actor: { kind: 'employee', employeeId: 'quant-head' },
      }),
      deps,
    )
  }

  const decline = (commandId = 'cmd-reject', over: Record<string, unknown> = {}) =>
    runCommand(
      rejectContribution(organization),
      {
        caseId: 'case-1',
        runId,
        departmentId: 'global-macro',
        code: 'unsupported-by-evidence',
        detail: 'The 10y print does not support a claim about the ECB path.',
        ...over,
      },
      envelope({
        commandId,
        occurredAt: LATER,
        actor: { kind: 'employee', employeeId: 'macro-analyst' },
      }),
      deps,
    )

  /* ------------------------------------------------------------ produced */

  it('cannot be cited while it is awaiting a person', async () => {
    await record([claim()])

    // Real, durable, paid for — and outside the store citations resolve
    // against, which is the whole design.
    expect(await repositories.producedClaims.listForRun(runId)).toHaveLength(1)
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
    expect(await repositories.claims.get(producedClaimId())).toBeNull()

    /*
     * And the citation fails because the claim is not there — not because
     * something checked a status and decided to say no. There is no filter in
     * this path to forget.
     */
    expect(await contestFromQuantDesk('cmd-early')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-found' },
    })

    // Nothing else was released either: the desk's obligation is not
    // discharged while nobody has accepted the work.
    expect((await repositories.assignments.get(assignmentId))!.status).toBe('active')
  })

  /* ------------------------------------------------------------ accepted */

  it('becomes citable through the unchanged model once a person accepts it', async () => {
    await record([claim()])
    expect((await accept()).outcome).toBe('committed')

    /*
     * The SAME claim, with the same id and the same content. There is no second
     * canonicalisation and no second content hash — a claim that hashed
     * differently depending on which side of acceptance it was read from would
     * not be content-addressed at all.
     */
    const [produced] = await repositories.producedClaims.listForRun(runId)
    const institutional = await repositories.claims.get(producedClaimId())
    expect(institutional).not.toBeNull()
    expect(institutional).toEqual(produced)

    // And it is now citable, through exactly the path that refused before.
    expect(await contestFromQuantDesk('cmd-late')).toMatchObject({
      outcome: 'committed',
    })

    // The obligation is discharged here, and not before.
    expect((await repositories.assignments.get(assignmentId))!.status).toBe('completed')
  })

  /* ------------------------------------------------------------ rejected */

  it('stays readable and stays uncitable once a person declines it', async () => {
    await record([claim()])
    expect((await decline()).outcome).toBe('committed')

    const run = await repositories.runs.get(runId)
    expect(run!.state).toBe('rejected')
    /* Never a kind of `failed`: every call succeeded. */
    expect(run!.failure).toBeUndefined()
    expect(run!.rejection).toMatchObject({
      code: 'unsupported-by-evidence',
      rejectedByEmployeeId: 'macro-analyst',
      rejectedAt: LATER,
    })

    /*
     * The firm keeps what it paid for and what it thought of it. Over years
     * this is what answers "which agents are rejected most, and why".
     */
    expect(await repositories.producedClaims.listForRun(runId)).toHaveLength(1)

    // And it never becomes evidence. Same absence, same refusal.
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
    expect(await contestFromQuantDesk('cmd-after-reject')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-found' },
    })
  })

  /* ------------------------------------------------- the act, not the work */

  it('refuses a rejection that does not say what was wrong', async () => {
    await record([claim()])
    /*
     * A code with no explanation records that the firm declined the work
     * without recording what would make the next attempt better.
     */
    expect(await decline('cmd-blank', { detail: '   ' })).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
    expect((await repositories.runs.get(runId))!.state).toBe('awaiting-acceptance')
  })

  it('refuses a reason outside the vocabulary the firm counts', async () => {
    await record([claim()])
    expect(await decline('cmd-novel', { code: 'below-quality-bar' })).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('lets a decision be made once', async () => {
    await record([claim()])
    expect((await accept()).outcome).toBe('committed')

    // A settled run keeps the outcome it settled on.
    expect(await decline('cmd-too-late')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('refuses acceptance of work that was never produced', async () => {
    /* The run is running: there is nothing to judge yet. */
    expect(await accept('cmd-premature')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('refuses another department judging this desk’s work', async () => {
    await record([claim()])
    const foreign = await runCommand(
      acceptContribution(organization),
      { caseId: 'case-1', runId, departmentId: 'quant-technical' },
      envelope({
        commandId: 'cmd-foreign',
        actor: { kind: 'employee', employeeId: 'quant-head' },
      }),
      deps,
    )
    expect(foreign.outcome).toBe('rejected')
    expect((await repositories.runs.get(runId))!.state).toBe('awaiting-acceptance')
  })
})
