/**
 * Half B: two analytical desks, one argument.
 *
 * Until now every objection the firm could record came from a control
 * function. That is scrutiny OF the process. What it is not is a second
 * qualified opinion on the SUBJECT — and a firm whose only dissent comes from
 * a desk whose mandate is to dissent has never actually been disagreed with.
 *
 * The failure these tests are built against is a peer examination that looks
 * like independent scrutiny and is not: a control function filing one so its
 * verdict is counted twice, a desk examining itself, or — the one that matters
 * most — an examination that raised nothing being indistinguishable from an
 * examination that never happened.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { recordPeerExamination } from '~/application/analysis/commands/recordPeerExamination'
import { recordDevilsAdvocateReview } from '~/application/analysis/commands/recordDevilsAdvocateReview'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import type { ChallengeSubmission } from '~/application/analysis/reviewRecording'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import {
  AT,
  EVIDENCE_SET_ID,
  LATER,
  seedAggregatableCase,
  type Seeded,
} from './aggregationHarness'

const organization = TEST_ORGANIZATION

let repositories: AnalysisRepositories
let deps: CommandDeps
let seeded: Seeded
/** The revision the manager produced — the one a peer is allowed to read. */
let aggregated: string

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-x',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'rates-head' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  seeded = await seedAggregatableCase(repositories, deps, organization)

  const aggregation = await runCommand(
    aggregateManagerConclusion(organization),
    {
      caseId: 'case-1',
      sourceRevisionId: seeded.revisionId,
      departmentId: 'research-office',
      inputRunIds: [seeded.macroRunId, seeded.quantRunId, seeded.aggregationRunId],
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
      optionalInputs: [
        {
          playbookEntryKey: 'quant-validation',
          availability: 'received-and-used',
          scope: 'in-scope',
          materiallyRelevant: true,
        },
      ],
      rationale: 'Macro and quant agree on direction and disagree on timing.',
      statement: 'The ECB holds through Q2 and cuts in September.',
      position: 'hold',
      implications: ['position-sizing'],
      invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
    },
    envelope({
      commandId: 'cmd-aggregate',
      actor: { kind: 'employee', employeeId: 'research-director' },
    }),
    deps,
  )
  expect(aggregation.outcome).toBe('committed')
  aggregated = deriveRevisionId('cmd-aggregate', seeded.thesisId)

  /*
   * A peer examines a finished argument, not a draft — the same rule
   * `placeVerdict` applies to every other verdict, and inherited rather than
   * relaxed for this kind. An examination of work its author had not finished
   * would be recorded against a revision that then changed under it.
   */
  const submitted = await runCommand(
    submitForVerification(organization),
    {
      caseId: 'case-1',
      revisionId: aggregated,
      submittedByDepartmentId: 'research-office',
    },
    envelope({
      commandId: 'cmd-submit',
      actor: { kind: 'employee', employeeId: 'research-director' },
      expectedVersion: (await repositories.cases.get('case-1'))!.version,
    }),
    deps,
  )
  expect(submitted.outcome).toBe('committed')
})

/**
 * One objection, well formed: a claim in scope, and what would settle it.
 *
 * `fragile-assumption` is a REASONING objection, which the domain permits to
 * argue without a counter-source — a peer saying "this rests on something
 * nobody established" has no source to cite by construction. It still has to
 * say what would settle it, which is the difference between an objection and a
 * mood. `evidentialObjection` below exercises the other half of that rule.
 */
const objection = (over: Record<string, unknown> = {}): ChallengeSubmission => ({
  contests: seeded.macroClaimId,
  kind: 'fragile-assumption',
  argument:
    'The attribution to growth expectations assumes the real-rate component ' +
    'was unchanged, which nothing in the run establishes.',
  counterEvidence: [],
  wouldBeResolvedBy: 'A nominal/real decomposition over the same window.',
  materiality: 'material',
  ...over,
})

/** An objection that asserts a competing explanation, so it must cite one. */
const evidentialObjection = (over: Record<string, unknown> = {}): ChallengeSubmission => ({
  ...objection(),
  kind: 'alternative-explanation',
  argument:
    'The move is a real-rate repricing, not a growth repricing; the two ' +
    'produce the same nominal path.',
  ...over,
})

const REF = {
  setId: EVIDENCE_SET_ID,
  observationId: 'obs-real-yield',
  contentHash: 'h-real-yield',
}

const examine = (
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
) =>
  runCommand(
    recordPeerExamination(organization),
    {
      caseId: 'case-1',
      thesisId: seeded.thesisId,
      revisionId: aggregated,
      byDepartmentId: 'rates',
      examinedDepartmentId: 'global-macro',
      challenges: [],
      ...over,
    },
    envelope({ commandId: 'cmd-peer', ...env }),
    deps,
  )

/* ================================================ an examination is a record */

describe('an examination that raised nothing', () => {
  /*
   * The distinction the whole review kind exists for. If this collapses, the
   * eligibility gate cannot tell "a qualified desk read this and had nothing
   * to contest" from "nobody qualified ever read it", and PEER_SCRUTINY_ABSENT
   * becomes satisfiable by silence.
   */
  it('is persisted, with no challenges', async () => {
    const result = await examine()
    expect(result.outcome).toBe('committed')

    const reviews = await repositories.reviews.peerExaminationsForCase('case-1')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]!.challenges).toEqual([])
  })

  it('records who examined whom', async () => {
    await examine()

    const [review] = await repositories.reviews.peerExaminationsForCase('case-1')
    expect(review!.byDepartmentId).toBe('rates')
    expect(review!.examinedDepartmentId).toBe('global-macro')
  })

  it('is visible in the ledger as an act, not as an absence', async () => {
    /*
     * A review with no challenges emits no challenge-opened event. Without an
     * event of its own the examination would leave the ledger unchanged — and
     * "no events" is exactly what never happening looks like.
     */
    await examine()

    const events = await repositories.events.listForCase('case-1')
    const recorded = events.filter((e) => e.toState === 'examined-no-objection')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]!.subject).toBe('review')
  })

  it('does not fabricate agreement', async () => {
    /*
     * Zero challenges means a peer found nothing to contest. It must not mean
     * the peer endorsed the conclusion: nothing here writes a verdict, a
     * status, or a challenge with a resolved outcome.
     */
    const [review] = await (await examine(), repositories.reviews).peerExaminationsForCase(
      'case-1',
    )
    expect(review!.outcomes).toEqual({})
    expect(Object.hasOwn(review!, 'status')).toBe(false)
  })

  it('does not settle a Devil’s Advocate objection', async () => {
    await runCommand(
      recordDevilsAdvocateReview(organization),
      {
        caseId: 'case-1',
        thesisId: seeded.thesisId,
        revisionId: aggregated,
        byDepartmentId: 'devils-advocate',
        challenges: [objection()],
      },
      envelope({
        commandId: 'cmd-da',
        actor: { kind: 'employee', employeeId: 'devils-advocate-head' },
      }),
      deps,
    )
    await examine()

    const [da] = await repositories.reviews.challengesForCase('case-1')
    expect(Object.values(da!.outcomes)).toEqual(['open'])
  })
})

/* ============================================================ a real dissent */

describe('an examination that objected', () => {
  it('records the objection under the peer mandate', async () => {
    await examine({ challenges: [objection()] })

    const [review] = await repositories.reviews.peerExaminationsForCase('case-1')
    const [challenge] = review!.challenges
    expect(challenge!.challengerKind).toBe('peer')
    expect(challenge!.byDepartmentId).toBe('rates')
    expect(challenge!.contests).toBe(seeded.macroClaimId)
  })

  it('leaves it open, and opens it in the ledger', async () => {
    await examine({ challenges: [objection()] })

    const [review] = await repositories.reviews.peerExaminationsForCase('case-1')
    expect(review!.outcomes[review!.challenges[0]!.id]).toBe('open')

    const events = await repositories.events.listForCase('case-1')
    expect(events.some((e) => e.toState === 'open' && e.subject === 'review')).toBe(true)
  })

  it('holds an objection to the same evidentiary standard as the control function', async () => {
    /*
     * Half A's rules are not weakened because a peer raised the objection. A
     * reasoning objection that does not say what would settle it is a mood,
     * whoever filed it.
     */
    const result = await examine({
      challenges: [objection({ counterEvidence: [], wouldBeResolvedBy: '  ' })],
    })
    expect(result.outcome).toBe('rejected')
  })

  it('refuses a competing explanation that cites nothing', async () => {
    /*
     * The other half of the same rule. A peer asserting a different cause is
     * making a claim about the world, and the domain requires a source for it
     * — exactly as it does for the Devil's Advocate.
     */
    const result = await examine({ challenges: [evidentialObjection()] })
    expect(result.outcome).toBe('rejected')
  })

  it('accepts a competing explanation that cites its source, and keeps the citation', async () => {
    const result = await examine({
      challenges: [evidentialObjection({ counterEvidence: [REF] })],
    })
    expect(result.outcome).toBe('committed')

    const [review] = await repositories.reviews.peerExaminationsForCase('case-1')
    expect(review!.challenges[0]!.counterEvidence).toEqual([REF])
    expect(review!.challenges[0]!.challengerKind).toBe('peer')
  })

  it('carries materiality through unchanged', async () => {
    await examine({ challenges: [objection({ materiality: 'decision-critical' })] })

    const [review] = await repositories.reviews.peerExaminationsForCase('case-1')
    expect(review!.challenges[0]!.materiality).toBe('decision-critical')
  })

  it('records a resolution and who settled it', async () => {
    await examine({
      challenges: [objection({ outcome: 'resolved', resolvedBy: 'research-director' })],
    })

    const [review] = await repositories.reviews.peerExaminationsForCase('case-1')
    const challenge = review!.challenges[0]!
    expect(review!.outcomes[challenge.id]).toBe('resolved')
    expect(challenge.resolvedBy).toBe('research-director')
  })

  it('refuses an objection against a claim the manager did not put in scope', async () => {
    const result = await examine({ challenges: [objection({ contests: 'claim-elsewhere' })] })
    expect(result.outcome).toBe('rejected')
  })

  it('refuses a resolution nobody is accountable for', async () => {
    const result = await examine({
      challenges: [objection({ outcome: 'resolved' })],
    })
    expect(result.outcome).toBe('rejected')
  })
})

/* ========================================================= who may examine */

describe('the mandate boundary', () => {
  it('refuses the Devil’s Advocate', async () => {
    /*
     * The control function has a STANDING obligation to object. Letting it
     * file a peer examination would let that obligation be read as a qualified
     * peer independently agreeing.
     */
    const result = await examine(
      { byDepartmentId: 'devils-advocate' },
      { actor: { kind: 'employee', employeeId: 'devils-advocate-head' } },
    )
    expect(result.outcome).toBe('rejected')
  })

  it('refuses any other control function', async () => {
    const result = await examine(
      { byDepartmentId: 'verification' },
      { actor: { kind: 'employee', employeeId: 'verification-head' } },
    )
    expect(result.outcome).toBe('rejected')
  })

  it('refuses a desk examining itself', async () => {
    const result = await examine({ examinedDepartmentId: 'rates' })
    expect(result.outcome).toBe('rejected')
  })

  it('refuses an examiner who is not acting for the desk they name', async () => {
    /*
     * `department-contribution`: the actor must belong to the department the
     * examination is filed under. Otherwise the record would name Rates as
     * having examined the argument when Rates never did.
     */
    const result = await examine(
      {},
      { actor: { kind: 'employee', employeeId: 'quant-head' } },
    )
    expect(result.outcome).toBe('rejected')
  })

  it('refuses a department the firm does not have', async () => {
    const result = await examine({ examinedDepartmentId: 'fixed-income' })
    expect(result.outcome).toBe('rejected')
  })
})

/* ==================================================== more than one examiner */

describe('two peers examining one revision', () => {
  const bothExamine = async () => {
    const first = await examine()
    const second = await examine(
      { byDepartmentId: 'quant-technical' },
      {
        commandId: 'cmd-peer-2',
        actor: { kind: 'employee', employeeId: 'quant-head' },
      },
    )
    return [first, second] as const
  }

  it('both commit', async () => {
    const [first, second] = await bothExamine()
    expect(first.outcome).toBe('committed')
    expect(second.outcome).toBe('committed')
  })

  it('take different positions in the sequence', async () => {
    /*
     * The property, stated directly. `reviews_sequence_unique` is on
     * (case, revision, kind, sequence), so a second examiner colliding here
     * would either fail the constraint or silently overwrite the first — and
     * the firm would show one examiner where two had looked.
     *
     * Deliberately NOT asserting "exactly one peer examiner". Several desks
     * may hold a view on one argument, and that is the capability, not a
     * defect to be constrained away.
     */
    await bothExamine()

    const reviews = await repositories.reviews.peerExaminationsForCase('case-1')
    expect(reviews).toHaveLength(2)
    expect(new Set(reviews.map((r) => r.sequence)).size).toBe(2)
  })

  it('remain independently addressable by (revision, kind, department)', async () => {
    await bothExamine()

    const reviews = await repositories.reviews.peerExaminationsForCase('case-1')
    const byDepartment = new Map(reviews.map((r) => [r.byDepartmentId, r]))
    expect([...byDepartment.keys()].sort()).toEqual(['quant-technical', 'rates'])
    for (const review of reviews) {
      expect(review.revisionId).toBe(aggregated)
    }
    expect(new Set(reviews.map((r) => r.reviewId)).size).toBe(2)
  })

  it('can disagree with each other about the same claim', async () => {
    /*
     * One objects, one does not. Both facts survive — which is the point of
     * recording examinations rather than a single "was it peer reviewed" flag.
     */
    await examine({ challenges: [objection()] })
    await examine(
      { byDepartmentId: 'quant-technical', challenges: [] },
      {
        commandId: 'cmd-peer-2',
        actor: { kind: 'employee', employeeId: 'quant-head' },
      },
    )

    const reviews = await repositories.reviews.peerExaminationsForCase('case-1')
    const counts = Object.fromEntries(
      reviews.map((r) => [r.byDepartmentId, r.challenges.length]),
    )
    expect(counts).toEqual({ rates: 1, 'quant-technical': 0 })
  })
})

/* ============================================ kept apart from the control fn */

describe('peer examinations and Devil’s Advocate reviews are separate records', () => {
  it('a peer examination is not returned as a Devil’s Advocate review', async () => {
    await examine({ challenges: [objection()] })

    expect(await repositories.reviews.challengesForCase('case-1')).toEqual([])
    expect(await repositories.reviews.peerExaminationsForCase('case-1')).toHaveLength(1)
  })

  it('the two kinds do not compete for one sequence', async () => {
    await runCommand(
      recordDevilsAdvocateReview(organization),
      {
        caseId: 'case-1',
        thesisId: seeded.thesisId,
        revisionId: aggregated,
        byDepartmentId: 'devils-advocate',
        challenges: [objection()],
      },
      envelope({
        commandId: 'cmd-da',
        actor: { kind: 'employee', employeeId: 'devils-advocate-head' },
      }),
      deps,
    )
    const peer = await examine()
    expect(peer.outcome).toBe('committed')

    const [da] = await repositories.reviews.challengesForCase('case-1')
    const [examination] = await repositories.reviews.peerExaminationsForCase('case-1')
    /* Each kind numbers from 1 within its own kind. */
    expect(da!.sequence).toBe(1)
    expect(examination!.sequence).toBe(1)
  })
})
