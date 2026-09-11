/**
 * The submission and decision repository contract, as executable tests.
 *
 * One body, invoked once per adapter. B1 runs it against the in-memory
 * reference; B2 adds the PostgreSQL call site and this file does not change —
 * which is the whole point, and why the setup differences live in `options`
 * rather than in the assertions.
 *
 * **No assertion below branches on which adapter is running.** If a behaviour
 * cannot be expressed identically, it is a divergence to resolve rather than
 * to accommodate.
 *
 * Separate from `repositoryContract.ts` only because the PostgreSQL adapter
 * cannot satisfy it until B2. Merging the two the moment it can would be a
 * reasonable follow-up; keeping them apart now is what lets B1 ship a suite
 * that genuinely passes rather than one that is skipped.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConcurrencyConflictError,
  ConflictingRecordError,
  DuplicateRecordError,
  InvariantViolationError,
  ReferentialIntegrityError,
  TransactionClosedError,
  type AnalysisRepositories,
} from '~/application/analysis/repositories'
import type { CaseDecision, CioReturn, CioSubmission } from '~/domain/analysis'
import { isDeeplyFrozen } from './seal'
import {
  aggregationIdFor,
  challengeIdsFor,
  caseReconsideration,
  cioReturn,
  cioSubmission,
  claimIdFor,
  devilsAdvocateIdFor,
  riskIdFor,
  runIdsFor,
  declinedDecision,
  deferredDecision,
  disclosedDissent,
  eligibilityBasis,
  qualitativeTrigger,
  quantitativeTrigger,
  selectedDecision,
  verificationIdFor,
} from '~/domain/analysis/decisionFixtures'
import { buildBasisManifest, verifyBasisManifest } from '~/domain/analysis'

/**
 * Every shared case this contract defines, recorded as it defines them.
 *
 * The two adapters run in different vitest projects and different processes,
 * so neither can observe what the other executed. What they CAN both do is
 * check the list this module produced while defining their suite — derived
 * from the definitions rather than copied beside them, so a case added or
 * removed moves the list automatically.
 *
 * `assertSharedInventory` then checks that list against the frozen inventory
 * below, from inside each adapter's own run. Two independent checks against one
 * pinned list, which is the strongest honest guarantee available across
 * processes.
 */
let registered: string[] = []

/** `it`, plus a record that this case exists. */
function sharedCase(name: string, body: () => Promise<void> | void): void {
  registered.push(name)
  it(name, body)
}

/**
 * The shared cases, pinned.
 *
 * Regenerated rather than remembered: when this drifts, the failure prints the
 * list the contract actually defined, and updating it is a copy of that output
 * rather than an act of memory.
 */
export const SHARED_CONTRACT_CASES: readonly string[] = Object.freeze([
  'round-trips a fully populated submission',
  'returns a submission whose witness still describes its basis',
  'refuses a submission whose witness describes another basis',
  'accepts a submission with no blockers',
  'refuses a submission carrying a blocker, before storing anything',
  'never silently drops blockers instead of refusing',
  'reconstructs blockers as an explicit empty array',
  'refuses a submission whose Risk requirement was never resolved',
  'returns the stored submission on an identical replay',
  'refuses a conflicting submission replay',
  'orders submissions for a case by time, then id',
  'finds every submission for one exact revision',
  'shows the queue oldest first and settles it',
  'settles a whole list in one act',
  'treats settling to the same state as a replay',
  'refuses to rewrite one settlement as the other',
  'refuses to settle a submission that does not exist',
  'refuses a verification review for another revision',
  "refuses a Devil's Advocate review for another revision",
  'refuses a Risk review for another revision',
  'refuses a challenge that belongs to another review',
  'refuses an aggregation that produced another revision',
  'refuses a review that reviewed another case',
  'refuses required work from another case',
  'refuses a disagreement about a claim from another case',
  'refuses a review that does not exist at all',
  'stores none of it',
  /* --------------------------------------------------- reconsideration */
  'round-trips a reopening with the triggers that fired',
  'is idempotent on id, and refuses a changed rewrite',
  'refuses a trigger belonging to another decision',
  'refuses a reopening that names no condition',
  'refuses a fired trigger with no observation',
  'refuses two reopenings of one submission',
  'lists a case’s reopenings oldest first',
  'round-trips a return with its concerns in order',
  'settles the submission it returns',
  'returns the stored return on an identical replay',
  'refuses a conflicting return replay',
  'refuses a return with no reason',
  'refuses a return against a submission that does not exist',
  'accepts a return raising several concerns',
  'refuses a return that raises no concern',
  'refuses a concern about another case',
  'refuses a concern about another revision',
  'refuses a concern whose subject does not exist',
  'allows a case-wide subject on any revision',
  'lists returns by case and by revision, oldest first',
  'round-trips a selected decision',
  'round-trips a deferred decision with its conditions',
  'round-trips a declined decision accounting for every revision',
  'keeps dissent, its acknowledgement and its evidence',
  'keeps each trigger policy version individually',
  'keeps dissent order across more than one entry',
  'canonicalises nothing about the actor it was given',
  'invents no Compliance state',
  'returns the stored decision on an identical replay',
  'refuses a conflicting decision replay',
  'refuses a decision the domain validator rejects',
  'refuses a deferral with no reconsideration condition',
  'refuses a decision referencing a submission that does not exist',
  'refuses a second live decision for one case',
  'makes the correction the only live decision',
  'keeps the superseded decision in history, unchanged',
  'excludes superseded decisions from the live listing',
  'still reaches a superseded decision by id',
  'refuses a second correction of an already-superseded decision',
  'refuses a correction reusing a predecessor trigger id',
  'refuses a decision that supersedes itself',
  'refuses a decision superseding one on another case',
  'refuses a correction of a decision that does not exist',
  'leaves the prior decision live when the correction rolls back',
  'freezes a submission and a return on read',
  'freezes a decision on read',
  'ignores a caller mutating the object it passed in',
  'ignores a caller mutating what a read returned',
  'guarantees nothing about object identity between reads',
  'refuses a repository captured inside a transaction and used after',
  'rolls a submission back with its transaction',
])

/**
 * Asserts this run defined exactly the shared contract, and skipped nothing.
 *
 * Called by each adapter's suite. The residual limitation, stated: if the
 * shared contract itself were edited wrongly, both adapters would drift
 * identically and still agree. That is a contract-quality risk, not an
 * adapter-parity divergence, and no cross-process check can distinguish them.
 */
export function sharedContractInventory(): readonly string[] {
  return Object.freeze([...registered])
}

/**
 * Asserts this adapter's run defined the whole shared contract, and no more.
 *
 * Invoked from each adapter's suite file. It compares what the contract just
 * registered against the pinned inventory, both directions, and refuses
 * duplicates — so a case added without updating the pin fails in both suites,
 * and a suite that quietly stopped defining half its cases fails in its own.
 *
 * There are no conditional cases left to skip: the staged entry points that
 * ran half the contract were removed once both adapters could run all of it,
 * which makes "nothing was skipped" structural rather than asserted.
 */
export function assertSharedInventory(): void {
  const actual = sharedContractInventory()

  const duplicates = actual.filter((name, index) => actual.indexOf(name) !== index)
  if (duplicates.length > 0) {
    throw new Error(`The shared contract defines duplicate case names: ${duplicates}`)
  }

  const missing = SHARED_CONTRACT_CASES.filter((name) => !actual.includes(name))
  const extra = actual.filter((name) => !SHARED_CONTRACT_CASES.includes(name))

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `The shared contract inventory has drifted.
` +
        `Missing from this run: ${JSON.stringify(missing)}
` +
        `Not in the pinned inventory: ${JSON.stringify(extra)}
` +
        `The pin is meant to be copied, not remembered — the current list is:
` +
        JSON.stringify(actual, null, 2),
    )
  }
}

export interface DecisionContractOptions {
  /** A fresh, empty store for each test. */
  create: () => Promise<AnalysisRepositories>
  destroy?: (repositories: AnalysisRepositories) => Promise<void>
  /**
   * Creates whatever the store requires to exist before a submission can.
   *
   * The in-memory store requires nothing; PostgreSQL requires the case, the
   * revisions, the reviews and the evidence its foreign keys point at. Setup
   * only — no assertion consults it.
   */
  seed: (
    repositories: AnalysisRepositories,
    fixture: { caseId: string; revisionIds: readonly string[] },
  ) => Promise<void>
}

export function describeDecisionRepositoryContract(
  name: string,
  options: DecisionContractOptions,
): void {
  buildContract(name, options)
}

function buildContract(name: string, options: DecisionContractOptions): void {
  registered = []

  describe(`decision repository contract — ${name}`, () => {
    let repositories: AnalysisRepositories

    beforeEach(async () => {
      repositories = await options.create()
      await options.seed(repositories, {
        caseId: 'case-1',
        revisionIds: ['rev-1', 'rev-2'],
      })
    })

    afterEach(async () => {
      await options.destroy?.(repositories)
    })

    /** A submission per considered revision, so a decision can reference them. */
    const seedSubmissions = async (): Promise<CioSubmission[]> => [
      await repositories.submissions.save(cioSubmission()),
      await repositories.submissions.save(
        cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
      ),
    ]

    /* --------------------------------------------------- reconsideration */

    describe('reconsideration', () => {
      const seedDeferral = async () => {
        await seedSubmissions()
        await repositories.decisions.save(deferredDecision())
      }

      sharedCase('round-trips a reopening with the triggers that fired', async () => {
        await seedDeferral()
        await repositories.submissions.recordReconsideration(caseReconsideration())

        const read = await repositories.submissions.getReconsideration('rec-1')
        expect(read?.reconsidersDecisionId).toBe('dec-deferred')
        expect(read?.reopenedByEmployeeId).toBe('cio')
        expect(read?.firedTriggers).toHaveLength(1)
        expect(read?.firedTriggers[0]?.triggerId).toBe('trg-1')
        expect(read?.firedTriggers[0]?.observation).toContain('June projections')
      })

      sharedCase('is idempotent on id, and refuses a changed rewrite', async () => {
        await seedDeferral()
        await repositories.submissions.recordReconsideration(caseReconsideration())
        /* Same content, same id: a replay, not a conflict. */
        await repositories.submissions.recordReconsideration(caseReconsideration())

        await expect(
          repositories.submissions.recordReconsideration(
            caseReconsideration({ authorizationBasis: 'mandate:something-else' }),
          ),
        ).rejects.toThrow(ConflictingRecordError)
      })

      sharedCase('refuses a trigger belonging to another decision', async () => {
        /*
         * The rule PostgreSQL holds as a composite foreign key. The reference
         * store has to reach the same answer or the two adapters disagree about
         * which reopenings the firm permits.
         */
        await seedDeferral()
        await expect(
          repositories.submissions.recordReconsideration(
            caseReconsideration({
              firedTriggers: [
                { triggerId: 'trg-not-on-this-decision', observation: 'Seen.' },
              ],
            }),
          ),
        ).rejects.toThrow()
      })

      sharedCase('refuses a reopening that names no condition', async () => {
        await seedDeferral()
        await expect(
          repositories.submissions.recordReconsideration(
            caseReconsideration({ firedTriggers: [] }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a fired trigger with no observation', async () => {
        await seedDeferral()
        await expect(
          repositories.submissions.recordReconsideration(
            caseReconsideration({
              firedTriggers: [{ triggerId: 'trg-1', observation: '   ' }],
            }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses two reopenings of one submission', async () => {
        /*
         * A reopening creates the submission it explains. Two naming the same
         * one would be two acts claiming to have created a single request for
         * a decision, and whichever was read second would look like a
         * duplicate of the first.
         */
        await seedDeferral()
        await repositories.submissions.recordReconsideration(caseReconsideration())
        await expect(
          repositories.submissions.recordReconsideration(
            caseReconsideration({ id: 'rec-other' }),
          ),
        ).rejects.toThrow()
      })

      sharedCase('lists a case’s reopenings oldest first', async () => {
        await seedDeferral()
        /*
         * Two reopenings, two submissions. A reopening creates the submission
         * it explains, so two sharing one would be two acts claiming to have
         * created the same request for a decision — which the schema refuses.
         */
        await repositories.submissions.recordReconsideration(
          caseReconsideration({
            id: 'rec-2',
            submissionId: 'sub-2',
            revisionId: 'rev-2',
            reopenedAt: '2026-07-28T16:00:00.000Z',
          }),
        )
        await repositories.submissions.recordReconsideration(caseReconsideration())

        const listed = await repositories.submissions.reconsiderationsForCase('case-1')
        expect(listed.map((entry) => entry.id)).toEqual(['rec-1', 'rec-2'])
      })
    })

    /* ------------------------------------------------------- submissions */

    describe('submissions', () => {
      sharedCase('round-trips a fully populated submission', async () => {
        const saved = await repositories.submissions.save(cioSubmission())
        const read = await repositories.submissions.get('sub-1')

        expect(read).not.toBeNull()
        expect(read?.basis.verification).toEqual({
          reviewId: verificationIdFor('rev-1'),
          sequence: 1,
          status: 'verified',
        })
        expect(read?.basis.requiredWork).toHaveLength(2)
        expect(read?.basis.evidenceSetIds).toHaveLength(2)
        expect(read?.basis.eligibilityPolicyVersion).toBe('1')
        expect(read?.state).toBe('pending')
        expect(saved.id).toBe('sub-1')
      })

      sharedCase(
        'returns a submission whose witness still describes its basis',
        async () => {
          /*
           * Parity for TD-58, and the two adapters reach it differently. The
           * in-memory store returns the object it was given; PostgreSQL rebuilds
           * the basis from rows and verifies the stored digest against it. The
           * contract asserts the OUTCOME both must produce -- a manifest that
           * describes what came back -- rather than the mechanism, which is the
           * only way one body of tests can hold both.
           */
          await repositories.submissions.save(cioSubmission())
          const read = await repositories.submissions.get('sub-1')

          expect(read).not.toBeNull()
          expect(read!.basis.manifest.algorithm).toBe('sha256')
          expect(read!.basis.manifest.canonicalizationVersion).toBe(3)
          expect(read!.basis.manifest.digest).toMatch(/^[0-9a-f]{64}$/)

          const { manifest, ...content } = read!.basis
          expect(
            verifyBasisManifest(
              { submissionId: read!.id, caseId: read!.caseId },
              content,
              manifest,
            ),
            'the stored witness does not describe the basis it came back with',
          ).toBeNull()
        },
      )

      sharedCase(
        'refuses a submission whose witness describes another basis',
        async () => {
          /*
           * The write-path half. A caller presenting an attestation that does not
           * attest to what it is attached to is not a smaller failure than a
           * corrupt row -- and it is refused before anything is stored, by the
           * same domain validator in both adapters.
           */
          const submission = cioSubmission()
          const foreign = {
            ...submission,
            basis: {
              ...submission.basis,
              // A real witness, for a different basis.
              manifest: buildBasisManifest(
                { submissionId: submission.id, caseId: submission.caseId },
                { ...submission.basis, requiredWork: [] },
              ),
            },
          }

          await expect(repositories.submissions.save(foreign)).rejects.toThrow(
            InvariantViolationError,
          )
        },
      )

      sharedCase('accepts a submission with no blockers', async () => {
        await expect(
          repositories.submissions.save(cioSubmission()),
        ).resolves.toMatchObject({ id: 'sub-1' })
      })

      sharedCase(
        'refuses a submission carrying a blocker, before storing anything',
        async () => {
          const blocked = cioSubmission({
            id: 'sub-blocked',
            basis: eligibilityBasis({
              blockers: [{ kind: 'verification-missing', severity: 'blocks-decision' }],
            }),
          })

          await expect(repositories.submissions.save(blocked)).rejects.toThrow(
            InvariantViolationError,
          )
          // Refused BEFORE persistence, not refused and half-written.
          expect(await repositories.submissions.get('sub-blocked')).toBeNull()
        },
      )

      sharedCase('never silently drops blockers instead of refusing', async () => {
        /*
         * The failure this guards is the plausible one: a mapper that ignored
         * the field would store the submission happily and read it back with
         * `blockers: []`, producing a record that says the firm found none.
         */
        const blocked = cioSubmission({
          id: 'sub-blocked',
          basis: eligibilityBasis({
            blockers: [
              {
                kind: 'risk-review-missing',
                severity: 'blocks-decision',
                playbookEntryKey: 'risk-review',
              },
            ],
          }),
        })
        await expect(repositories.submissions.save(blocked)).rejects.toThrow()
        expect(await repositories.submissions.listForCase('case-1')).toEqual([])
      })

      sharedCase('reconstructs blockers as an explicit empty array', async () => {
        await repositories.submissions.save(cioSubmission())
        expect((await repositories.submissions.get('sub-1'))?.basis.blockers).toEqual([])
      })

      sharedCase(
        'refuses a submission whose Risk requirement was never resolved',
        async () => {
          await expect(
            repositories.submissions.save(
              cioSubmission({
                id: 'sub-unresolved',
                basis: eligibilityBasis({ riskRequirement: 'unresolved' }),
              }),
            ),
          ).rejects.toThrow(InvariantViolationError)
        },
      )

      sharedCase('returns the stored submission on an identical replay', async () => {
        const first = await repositories.submissions.save(cioSubmission())
        const second = await repositories.submissions.save(cioSubmission())
        expect(second.id).toBe(first.id)
        expect(await repositories.submissions.listForCase('case-1')).toHaveLength(1)
      })

      sharedCase('refuses a conflicting submission replay', async () => {
        await repositories.submissions.save(cioSubmission())
        await expect(
          repositories.submissions.save(cioSubmission({ caseVersion: 99 })),
        ).rejects.toThrow(ConflictingRecordError)
      })

      sharedCase('orders submissions for a case by time, then id', async () => {
        await repositories.submissions.save(
          cioSubmission({ id: 'sub-2', revisionId: 'rev-2', submittedAt: SECOND }),
        )
        await repositories.submissions.save(cioSubmission())
        expect(
          (await repositories.submissions.listForCase('case-1')).map((s) => s.id),
        ).toEqual(['sub-1', 'sub-2'])
      })

      sharedCase('finds every submission for one exact revision', async () => {
        await seedSubmissions()
        await repositories.submissions.save(
          cioSubmission({ id: 'sub-3', submittedAt: SECOND }),
        )
        expect(
          (await repositories.submissions.applicableForRevision('rev-1')).map(
            (s) => s.id,
          ),
        ).toEqual(['sub-1', 'sub-3'])
      })

      sharedCase('shows the queue oldest first and settles it', async () => {
        await seedSubmissions()
        expect((await repositories.submissions.pending()).map((s) => s.id)).toEqual([
          'sub-1',
          'sub-2',
        ])

        await repositories.submissions.settle(['sub-1'], 'decided')
        expect((await repositories.submissions.pending()).map((s) => s.id)).toEqual([
          'sub-2',
        ])
        expect((await repositories.submissions.get('sub-1'))?.state).toBe('decided')
      })

      sharedCase('settles a whole list in one act', async () => {
        await seedSubmissions()
        await repositories.submissions.settle(['sub-1', 'sub-2'], 'decided')
        expect(await repositories.submissions.pending()).toEqual([])
      })

      sharedCase('treats settling to the same state as a replay', async () => {
        await seedSubmissions()
        await repositories.submissions.settle(['sub-1'], 'decided')
        await expect(
          repositories.submissions.settle(['sub-1'], 'decided'),
        ).resolves.toBeUndefined()
      })

      sharedCase('refuses to rewrite one settlement as the other', async () => {
        await seedSubmissions()
        await repositories.submissions.settle(['sub-1'], 'returned')
        await expect(
          repositories.submissions.settle(['sub-1'], 'decided'),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses to settle a submission that does not exist', async () => {
        await expect(
          repositories.submissions.settle(['sub-nowhere'], 'decided'),
        ).rejects.toThrow(ReferentialIntegrityError)
      })
    })

    /* ------------------------------------- cross-revision and cross-case */

    describe('a submission may only cite its own governance', () => {
      /*
       * The failure a foreign key cannot see. `reviews` is keyed on `id` alone,
       * so the database can prove a review EXISTS and nothing about which
       * revision it reviewed — a submission could cite a sibling revision's
       * verification and every constraint would be satisfied, leaving a record
       * that says the firm verified something it did not.
       *
       * The commands check this too. The repository checks it so the record is
       * right regardless of which caller wrote it.
       */
      const citing = (basis: Partial<ReturnType<typeof eligibilityBasis>>) =>
        repositories.submissions.save(
          cioSubmission({ id: 'sub-wrong', basis: eligibilityBasis(basis) }),
        )

      sharedCase('refuses a verification review for another revision', async () => {
        await expect(
          citing({
            verification: {
              reviewId: verificationIdFor('rev-2'),
              sequence: 1,
              status: 'verified',
            },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase("refuses a Devil's Advocate review for another revision", async () => {
        await expect(
          citing({
            devilsAdvocate: {
              reviewId: devilsAdvocateIdFor('rev-2'),
              sequence: 1,
              openChallenges: [],
            },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a Risk review for another revision', async () => {
        await expect(
          citing({
            risk: { reviewId: riskIdFor('rev-2'), sequence: 1, status: 'accepted' },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a challenge that belongs to another review', async () => {
        await expect(
          citing({
            devilsAdvocate: {
              reviewId: devilsAdvocateIdFor('rev-1'),
              sequence: 1,
              openChallenges: [
                {
                  challengeId: challengeIdsFor('rev-2')[0]!,
                  materiality: 'material' as const,
                },
              ],
            },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses an aggregation that produced another revision', async () => {
        await expect(
          citing({ aggregationId: aggregationIdFor('rev-2') }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a review that reviewed another case', async () => {
        await options.seed(repositories, {
          caseId: 'case-2',
          revisionIds: ['rev-3', 'rev-4'],
        })
        await expect(
          citing({
            verification: {
              reviewId: verificationIdFor('rev-3'),
              sequence: 1,
              status: 'verified',
            },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses required work from another case', async () => {
        await options.seed(repositories, {
          caseId: 'case-2',
          revisionIds: ['rev-3', 'rev-4'],
        })
        await expect(
          citing({
            requiredWork: [
              { playbookEntryKey: 'macro-scan', runId: runIdsFor('rev-3')[0] },
            ],
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a disagreement about a claim from another case', async () => {
        await options.seed(repositories, {
          caseId: 'case-2',
          revisionIds: ['rev-3', 'rev-4'],
        })
        await expect(
          citing({
            materialDisagreements: [
              { claimId: claimIdFor('rev-3'), materiality: 'material' },
            ],
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a review that does not exist at all', async () => {
        await expect(
          citing({
            verification: { reviewId: 'review-nowhere', sequence: 1, status: 'verified' },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('stores none of it', async () => {
        await expect(
          citing({ aggregationId: aggregationIdFor('rev-2') }),
        ).rejects.toThrow()
        expect(await repositories.submissions.get('sub-wrong')).toBeNull()
      })
    })

    /* ----------------------------------------------------------- returns */

    describe('returns', () => {
      sharedCase('round-trips a return with its concerns in order', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())

        const read = await repositories.submissions.getReturn('ret-1')
        expect(read?.reason).toBe('The inflation path rests on one observation.')
        expect(read?.concerns.map((concern) => concern.subjectId)).toEqual([
          claimIdFor('rev-1'),
          'rev-1',
        ])
        expect(read?.returnedBy.departmentHandles).toEqual(['chief-decision', 'strategy'])
      })

      sharedCase('settles the submission it returns', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())
        expect((await repositories.submissions.get('sub-1'))?.state).toBe('returned')
      })

      sharedCase('returns the stored return on an identical replay', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())
        await repositories.submissions.recordReturn(cioReturn())
        expect(await repositories.submissions.returnsForCase('case-1')).toHaveLength(1)
      })

      sharedCase('refuses a conflicting return replay', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())
        await expect(
          repositories.submissions.recordReturn(cioReturn({ reason: 'Something else.' })),
        ).rejects.toThrow(ConflictingRecordError)
      })

      sharedCase('refuses a return with no reason', async () => {
        await seedSubmissions()
        await expect(
          repositories.submissions.recordReturn(cioReturn({ reason: '   ' })),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase(
        'refuses a return against a submission that does not exist',
        async () => {
          await expect(
            repositories.submissions.recordReturn(
              cioReturn({ submissionId: 'sub-nowhere' }),
            ),
          ).rejects.toThrow(ReferentialIntegrityError)
        },
      )

      sharedCase('accepts a return raising several concerns', async () => {
        await seedSubmissions()
        const stored = await repositories.submissions.recordReturn(cioReturn())
        expect(stored.concerns).toHaveLength(2)
      })

      sharedCase('refuses a return that raises no concern', async () => {
        /*
         * A return exists to send work back WITH reasons. One that records only
         * that the CIO was unhappy tells whoever receives it nothing they can
         * act on.
         */
        await seedSubmissions()
        await expect(
          repositories.submissions.recordReturn(cioReturn({ concerns: [] })),
        ).rejects.toThrow(InvariantViolationError)
        expect(await repositories.submissions.getReturn('ret-1')).toBeNull()
      })

      sharedCase('refuses a concern about another case', async () => {
        await seedSubmissions()
        await options.seed(repositories, {
          caseId: 'case-2',
          revisionIds: ['rev-3', 'rev-4'],
        })
        await expect(
          repositories.submissions.recordReturn(
            cioReturn({
              concerns: [
                {
                  concernKind: 'evidence-thin',
                  subjectKind: 'claim',
                  subjectId: claimIdFor('rev-3'),
                  detail: 'A claim from a different case entirely.',
                },
              ],
            }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a concern about another revision', async () => {
        await seedSubmissions()
        await expect(
          repositories.submissions.recordReturn(
            cioReturn({
              concerns: [
                {
                  concernKind: 'unaddressed-objection',
                  subjectKind: 'review',
                  subjectId: verificationIdFor('rev-2'),
                  detail: "A verdict about the other revision's argument.",
                },
              ],
            }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a concern whose subject does not exist', async () => {
        await seedSubmissions()
        await expect(
          repositories.submissions.recordReturn(
            cioReturn({
              concerns: [
                {
                  concernKind: 'evidence-thin',
                  subjectKind: 'claim',
                  subjectId: 'claim-nowhere',
                  detail: 'Points at nothing.',
                },
              ],
            }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('allows a case-wide subject on any revision', async () => {
        /*
         * A case-wide review applies to every revision of its case, so citing
         * one from a return about `rev-2` is legitimate. The near-miss to the
         * wrong-revision rule.
         */
        await seedSubmissions()
        const stored = await repositories.submissions.recordReturn(
          cioReturn({
            revisionId: 'rev-1',
            concerns: [
              {
                concernKind: 'scope',
                subjectKind: 'revision',
                subjectId: 'rev-1',
                detail: 'The revision itself.',
              },
            ],
          }),
        )
        expect(stored.concerns).toHaveLength(1)
      })

      sharedCase('lists returns by case and by revision, oldest first', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())
        await repositories.submissions.recordReturn(
          cioReturn({
            id: 'ret-2',
            submissionId: 'sub-2',
            revisionId: 'rev-2',
            returnedAt: SECOND,
          }),
        )
        expect(
          (await repositories.submissions.returnsForCase('case-1')).map((r) => r.id),
        ).toEqual(['ret-1', 'ret-2'])
        expect(
          (await repositories.submissions.returnsForRevision('rev-2')).map((r) => r.id),
        ).toEqual(['ret-2'])
      })
    })

    /* --------------------------------------------------------- decisions */

    describe('decisions', () => {
      const save = async (decision: CaseDecision) => {
        await seedSubmissions()
        return repositories.decisions.save(decision)
      }

      sharedCase('round-trips a selected decision', async () => {
        await save(selectedDecision())
        const read = await repositories.decisions.get('dec-1')

        expect(read?.outcome).toMatchObject({
          kind: 'selected',
          selectedRevisionId: 'rev-1',
        })
        expect(read?.outcome.consideredRevisionIds).toEqual(['rev-1', 'rev-2'])
        expect(read?.submissionIds).toEqual(['sub-1', 'sub-2'])
        expect(read?.rationale).toContain('disinflation')
      })

      sharedCase('round-trips a deferred decision with its conditions', async () => {
        await save(deferredDecision())
        const read = await repositories.decisions.get('dec-deferred')
        expect(read?.outcome.kind).toBe('deferred')
        expect('selectedRevisionId' in read!.outcome).toBe(false)
        expect(read?.reconsiderationTriggers).toHaveLength(2)
      })

      sharedCase(
        'round-trips a declined decision accounting for every revision',
        async () => {
          await save(declinedDecision())
          const read = await repositories.decisions.get('dec-declined')
          expect(read?.outcome).toMatchObject({
            kind: 'declined',
            declinedRevisionIds: ['rev-1', 'rev-2'],
          })
        },
      )

      sharedCase('keeps dissent, its acknowledgement and its evidence', async () => {
        await save(selectedDecision())
        const dissent = (await repositories.decisions.get('dec-1'))?.unresolvedDissent[0]
        expect(dissent?.acknowledgement).toContain('Weighed and accepted')
        expect(dissent?.evidence).toHaveLength(2)
        expect(dissent?.materiality).toBe('material')
      })

      sharedCase('keeps each trigger policy version individually', async () => {
        await save(
          selectedDecision({
            reconsiderationTriggers: [
              quantitativeTrigger({ policyVersion: '1' }),
              qualitativeTrigger({ policyVersion: '2' }),
            ],
          }),
        )
        expect(
          (await repositories.decisions.get('dec-1'))?.reconsiderationTriggers.map(
            (trigger) => trigger.policyVersion,
          ),
        ).toEqual(['1', '2'])
      })

      sharedCase('keeps dissent order across more than one entry', async () => {
        await save(
          selectedDecision({
            unresolvedDissent: [
              disclosedDissent({ sourceId: 'challenge-z' }),
              disclosedDissent({ sourceId: 'challenge-a', revisionId: 'rev-2' }),
            ],
          }),
        )
        expect(
          (await repositories.decisions.get('dec-1'))?.unresolvedDissent.map(
            (entry) => entry.sourceId,
          ),
        ).toEqual(['challenge-z', 'challenge-a'])
      })

      sharedCase('canonicalises nothing about the actor it was given', async () => {
        await save(selectedDecision())
        const actor = (await repositories.decisions.get('dec-1'))?.decidedBy
        expect(actor?.departmentHandles).toEqual(['chief-decision', 'strategy'])
        expect(actor?.authentication).toBe('system-asserted')
      })

      sharedCase('invents no Compliance state', async () => {
        await save(selectedDecision())
        const read = await repositories.decisions.get('dec-1')
        expect(JSON.stringify(read)).not.toMatch(/compliance/i)
      })

      sharedCase('returns the stored decision on an identical replay', async () => {
        await save(selectedDecision())
        await repositories.decisions.save(selectedDecision())
        expect(await repositories.decisions.historyForCase('case-1')).toHaveLength(1)
      })

      sharedCase('refuses a conflicting decision replay', async () => {
        await save(selectedDecision())
        await expect(
          repositories.decisions.save(selectedDecision({ rationale: 'Different.' })),
        ).rejects.toThrow(ConflictingRecordError)
      })

      sharedCase('refuses a decision the domain validator rejects', async () => {
        await expect(
          save(
            selectedDecision({
              outcome: {
                kind: 'declined',
                declinedRevisionIds: ['rev-1'],
                consideredRevisionIds: ['rev-1', 'rev-2'],
              },
            }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a deferral with no reconsideration condition', async () => {
        await expect(
          save(deferredDecision({ reconsiderationTriggers: [] })),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase(
        'refuses a decision referencing a submission that does not exist',
        async () => {
          await expect(
            save(selectedDecision({ submissionIds: ['sub-1', 'sub-nowhere'] })),
          ).rejects.toThrow(ReferentialIntegrityError)
        },
      )

      sharedCase('refuses a second live decision for one case', async () => {
        await save(selectedDecision())
        await expect(
          repositories.decisions.save(selectedDecision({ decisionId: 'dec-2' })),
        ).rejects.toThrow(DuplicateRecordError)
      })
    })

    /* ------------------------------------------------------ supersession */

    describe('supersession', () => {
      /*
       * A correction mints its own reconsideration conditions. Trigger ids are
       * unique across every decision, so restating the predecessor's under the
       * same ids is not a correction -- it is two decisions claiming one
       * condition. See TD-52.
       */
      const correction = (over: Partial<CaseDecision> = {}) =>
        selectedDecision({
          decisionId: 'dec-2',
          supersedesDecisionId: 'dec-1',
          decidedAt: SECOND,
          rationale: 'Corrected: the credit impulse was mis-signed.',
          reconsiderationTriggers: [
            quantitativeTrigger({ id: 'trg-corrected-1' }),
            qualitativeTrigger({ id: 'trg-corrected-2' }),
          ],
          ...over,
        })

      beforeEach(async () => {
        await seedSubmissions()
        await repositories.decisions.save(selectedDecision())
      })

      sharedCase('makes the correction the only live decision', async () => {
        await repositories.decisions.save(correction())
        expect((await repositories.decisions.getForCase('case-1'))?.decisionId).toBe(
          'dec-2',
        )
      })

      sharedCase('keeps the superseded decision in history, unchanged', async () => {
        await repositories.decisions.save(correction())
        const history = await repositories.decisions.historyForCase('case-1')
        expect(history.map((decision) => decision.decisionId)).toEqual(['dec-1', 'dec-2'])
        expect(history[0]?.rationale).toContain('disinflation')
      })

      sharedCase('excludes superseded decisions from the live listing', async () => {
        await repositories.decisions.save(correction())
        expect(
          (await repositories.decisions.listRecent(10)).map((d) => d.decisionId),
        ).toEqual(['dec-2'])
      })

      sharedCase('still reaches a superseded decision by id', async () => {
        await repositories.decisions.save(correction())
        expect((await repositories.decisions.get('dec-1'))?.decisionId).toBe('dec-1')
      })

      sharedCase(
        'refuses a second correction of an already-superseded decision',
        async () => {
          await repositories.decisions.save(correction())
          await expect(
            repositories.decisions.save(correction({ decisionId: 'dec-3' })),
          ).rejects.toThrow(ConcurrencyConflictError)
        },
      )

      sharedCase('refuses a correction reusing a predecessor trigger id', async () => {
        /*
         * Found by running the shared contract against PostgreSQL: the trigger
         * id is a global primary key, and the in-memory reference had no such
         * rule. The schema is right -- a superseding decision restates its
         * conditions as its own, which is why they carry no lineage.
         */
        await expect(
          repositories.decisions.save(
            correction({
              decisionId: 'dec-reused',
              reconsiderationTriggers: [quantitativeTrigger()],
            }),
          ),
        ).rejects.toThrow(DuplicateRecordError)
      })

      sharedCase('refuses a decision that supersedes itself', async () => {
        await expect(
          repositories.decisions.save(
            selectedDecision({ decisionId: 'dec-9', supersedesDecisionId: 'dec-9' }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a decision superseding one on another case', async () => {
        await options.seed(repositories, {
          caseId: 'case-2',
          revisionIds: ['rev-3', 'rev-4'],
        })
        await expect(
          repositories.decisions.save(
            selectedDecision({
              decisionId: 'dec-other',
              caseId: 'case-2',
              supersedesDecisionId: 'dec-1',
            }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      sharedCase('refuses a correction of a decision that does not exist', async () => {
        await expect(
          repositories.decisions.save(
            correction({ decisionId: 'dec-4', supersedesDecisionId: 'dec-nowhere' }),
          ),
        ).rejects.toThrow(ReferentialIntegrityError)
      })

      sharedCase(
        'leaves the prior decision live when the correction rolls back',
        async () => {
          await expect(
            repositories.withTransaction(async (scoped) => {
              await scoped.decisions.save(correction({ decisionId: 'dec-5' }))
              throw new Error('rolled back')
            }),
          ).rejects.toThrow('rolled back')

          expect((await repositories.decisions.getForCase('case-1'))?.decisionId).toBe(
            'dec-1',
          )
          expect(await repositories.decisions.get('dec-5')).toBeNull()
        },
      )
    })

    /* -------------------------------------------------------- immutability */

    describe('records cannot be changed through what they return', () => {
      sharedCase('freezes a submission and a return on read', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())

        expect(isDeeplyFrozen(await repositories.submissions.get('sub-2'))).toBe(true)
        expect(isDeeplyFrozen(await repositories.submissions.getReturn('ret-1'))).toBe(
          true,
        )
      })

      sharedCase('freezes a decision on read', async () => {
        await seedSubmissions()
        await repositories.decisions.save(selectedDecision())
        expect(isDeeplyFrozen(await repositories.decisions.get('dec-1'))).toBe(true)
      })

      sharedCase('ignores a caller mutating the object it passed in', async () => {
        /*
         * The guarantee is that the STORE does not change — not that the
         * mutation succeeds or fails. The two adapters reach it differently:
         * the in-memory store seals what it is given, so the assignment throws;
         * PostgreSQL leaves the caller's object alone because the row is
         * already written. Asserting on the mechanism would be asserting on
         * which adapter is running, which this suite may not do.
         */
        const mutable: CioSubmission = JSON.parse(JSON.stringify(cioSubmission()))
        await repositories.submissions.save(mutable)
        try {
          ;(mutable as { caseVersion: number }).caseVersion = 999
        } catch {
          /* sealed in place, as the in-memory reference does */
        }

        expect((await repositories.submissions.get('sub-1'))?.caseVersion).toBe(3)
      })

      sharedCase('ignores a caller mutating what a read returned', async () => {
        await seedSubmissions()
        await repositories.decisions.save(selectedDecision())
        const read = await repositories.decisions.get('dec-1')

        // Frozen, so the write either throws or is silently ignored depending
        // on strict mode. Either is acceptable; a changed store is not.
        try {
          ;(read as unknown as { rationale: string }).rationale = 'tampered'
        } catch {
          /* frozen, as intended */
        }
        expect((await repositories.decisions.get('dec-1'))?.rationale).toContain(
          'disinflation',
        )
      })

      sharedCase('guarantees nothing about object identity between reads', async () => {
        /*
         * Deliberately NOT asserting that two reads return the same reference.
         * The in-memory store can; PostgreSQL cannot; and a caller that depended
         * on it would work against one adapter and fail against the other.
         */
        await seedSubmissions()
        const first = await repositories.submissions.get('sub-1')
        const second = await repositories.submissions.get('sub-1')
        expect(second).toEqual(first)
      })
    })

    /* --------------------------------------------------------- lifetimes */

    describe('transaction lifetime', () => {
      sharedCase(
        'refuses a repository captured inside a transaction and used after',
        async () => {
          let escaped: AnalysisRepositories['submissions'] | null = null
          await repositories.withTransaction(async (scoped) => {
            escaped = scoped.submissions
          })
          await expect(escaped!.get('sub-1')).rejects.toThrow(TransactionClosedError)
        },
      )

      sharedCase('rolls a submission back with its transaction', async () => {
        await expect(
          repositories.withTransaction(async (scoped) => {
            await scoped.submissions.save(cioSubmission())
            throw new Error('rolled back')
          }),
        ).rejects.toThrow('rolled back')
        expect(await repositories.submissions.get('sub-1')).toBeNull()
      })
    })
  })
}

/** A second instant, for orderings that need two. */
const SECOND = '2026-07-28T15:00:00.000Z'

/** Referenced so the fixture module's types stay used where narrowing needs them. */
export type { CioReturn }
