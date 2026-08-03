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

/**
 * Submissions and returns.
 *
 * A separate entry point from the decision half only so a stage that has
 * finished one and not the other can run what exists. Both are invoked for
 * every completed adapter, and neither body knows which adapter it is running
 * against.
 */
export function describeSubmissionRepositoryContract(
  name: string,
  options: DecisionContractOptions,
): void {
  buildContract(name, options, { decisions: false, supersession: false })
}

/**
 * Decisions without supersession.
 *
 * The correcting-decision transaction needs the deferred foreign keys and the
 * named constraint forcing, which arrive a stage later than the rest. A stage
 * that has the one and not the other runs this.
 */
export function describeDecisionPersistenceContract(
  name: string,
  options: DecisionContractOptions,
): void {
  buildContract(name, options, { decisions: true, supersession: false })
}

export function describeDecisionRepositoryContract(
  name: string,
  options: DecisionContractOptions,
): void {
  buildContract(name, options, { decisions: true, supersession: true })
}

function buildContract(
  name: string,
  options: DecisionContractOptions,
  parts: { decisions: boolean; supersession: boolean },
): void {
  /*
   * `describe`/`it` for a stage that has the decision repository, and their
   * skipping counterparts for one that does not. Named rather than written
   * inline: a parenthesised conditional at the start of a statement is parsed
   * as a call on whatever the line above evaluated to.
   */
  const describeDecisions = parts.decisions ? describe : describe.skip
  const describeSupersession = parts.supersession ? describe : describe.skip
  const whenDecisions = parts.decisions ? it : it.skip

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

    /* ------------------------------------------------------- submissions */

    describe('submissions', () => {
      it('round-trips a fully populated submission', async () => {
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

      it('accepts a submission with no blockers', async () => {
        await expect(
          repositories.submissions.save(cioSubmission()),
        ).resolves.toMatchObject({ id: 'sub-1' })
      })

      it('refuses a submission carrying a blocker, before storing anything', async () => {
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
      })

      it('never silently drops blockers instead of refusing', async () => {
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

      it('reconstructs blockers as an explicit empty array', async () => {
        await repositories.submissions.save(cioSubmission())
        expect((await repositories.submissions.get('sub-1'))?.basis.blockers).toEqual([])
      })

      it('refuses a submission whose Risk requirement was never resolved', async () => {
        await expect(
          repositories.submissions.save(
            cioSubmission({
              id: 'sub-unresolved',
              basis: eligibilityBasis({ riskRequirement: 'unresolved' }),
            }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('returns the stored submission on an identical replay', async () => {
        const first = await repositories.submissions.save(cioSubmission())
        const second = await repositories.submissions.save(cioSubmission())
        expect(second.id).toBe(first.id)
        expect(await repositories.submissions.listForCase('case-1')).toHaveLength(1)
      })

      it('refuses a conflicting replay', async () => {
        await repositories.submissions.save(cioSubmission())
        await expect(
          repositories.submissions.save(cioSubmission({ caseVersion: 99 })),
        ).rejects.toThrow(ConflictingRecordError)
      })

      it('orders submissions for a case by time, then id', async () => {
        await repositories.submissions.save(
          cioSubmission({ id: 'sub-2', revisionId: 'rev-2', submittedAt: SECOND }),
        )
        await repositories.submissions.save(cioSubmission())
        expect(
          (await repositories.submissions.listForCase('case-1')).map((s) => s.id),
        ).toEqual(['sub-1', 'sub-2'])
      })

      it('finds every submission for one exact revision', async () => {
        await seedSubmissions()
        await repositories.submissions.save(
          cioSubmission({ id: 'sub-3', submittedAt: SECOND }),
        )
        expect(
          (await repositories.submissions.applicableForRevision('rev-1')).map((s) => s.id),
        ).toEqual(['sub-1', 'sub-3'])
      })

      it('shows the queue oldest first and settles it', async () => {
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

      it('settles a whole list in one act', async () => {
        await seedSubmissions()
        await repositories.submissions.settle(['sub-1', 'sub-2'], 'decided')
        expect(await repositories.submissions.pending()).toEqual([])
      })

      it('treats settling to the same state as a replay', async () => {
        await seedSubmissions()
        await repositories.submissions.settle(['sub-1'], 'decided')
        await expect(
          repositories.submissions.settle(['sub-1'], 'decided'),
        ).resolves.toBeUndefined()
      })

      it('refuses to rewrite one settlement as the other', async () => {
        await seedSubmissions()
        await repositories.submissions.settle(['sub-1'], 'returned')
        await expect(
          repositories.submissions.settle(['sub-1'], 'decided'),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('refuses to settle a submission that does not exist', async () => {
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

      it('refuses a verification review for another revision', async () => {
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

      it("refuses a Devil's Advocate review for another revision", async () => {
        await expect(
          citing({
            devilsAdvocate: {
              reviewId: devilsAdvocateIdFor('rev-2'),
              sequence: 1,
              openChallengeIds: [],
            },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('refuses a Risk review for another revision', async () => {
        await expect(
          citing({
            risk: { reviewId: riskIdFor('rev-2'), sequence: 1, status: 'accepted' },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('refuses a challenge that belongs to another review', async () => {
        await expect(
          citing({
            devilsAdvocate: {
              reviewId: devilsAdvocateIdFor('rev-1'),
              sequence: 1,
              openChallengeIds: [challengeIdsFor('rev-2')[0]],
            },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('refuses an aggregation that produced another revision', async () => {
        await expect(citing({ aggregationId: aggregationIdFor('rev-2') })).rejects.toThrow(
          InvariantViolationError,
        )
      })

      it('refuses a review that reviewed another case', async () => {
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

      it('refuses required work from another case', async () => {
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

      it('refuses a disagreement about a claim from another case', async () => {
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

      it('refuses a review that does not exist at all', async () => {
        await expect(
          citing({
            verification: { reviewId: 'review-nowhere', sequence: 1, status: 'verified' },
          }),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('stores none of it', async () => {
        await expect(
          citing({ aggregationId: aggregationIdFor('rev-2') }),
        ).rejects.toThrow()
        expect(await repositories.submissions.get('sub-wrong')).toBeNull()
      })
    })

    /* ----------------------------------------------------------- returns */

    describe('returns', () => {
      it('round-trips a return with its concerns in order', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())

        const read = await repositories.submissions.getReturn('ret-1')
        expect(read?.reason).toBe('The inflation path rests on one observation.')
        expect(read?.concerns.map((concern) => concern.subjectId)).toEqual([
          'claim-1',
          'rev-1',
        ])
        expect(read?.returnedBy.departmentHandles).toEqual([
          'chief-decision',
          'strategy',
        ])
      })

      it('settles the submission it returns', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())
        expect((await repositories.submissions.get('sub-1'))?.state).toBe('returned')
      })

      it('returns the stored return on an identical replay', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())
        await repositories.submissions.recordReturn(cioReturn())
        expect(await repositories.submissions.returnsForCase('case-1')).toHaveLength(1)
      })

      it('refuses a conflicting replay', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())
        await expect(
          repositories.submissions.recordReturn(cioReturn({ reason: 'Something else.' })),
        ).rejects.toThrow(ConflictingRecordError)
      })

      it('refuses a return with no reason', async () => {
        await seedSubmissions()
        await expect(
          repositories.submissions.recordReturn(cioReturn({ reason: '   ' })),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('refuses a return against a submission that does not exist', async () => {
        await expect(
          repositories.submissions.recordReturn(cioReturn({ submissionId: 'sub-nowhere' })),
        ).rejects.toThrow(ReferentialIntegrityError)
      })

      it('lists returns by case and by revision, oldest first', async () => {
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

    describeDecisions('decisions', () => {
      const save = async (decision: CaseDecision) => {
        await seedSubmissions()
        return repositories.decisions.save(decision)
      }

      it('round-trips a selected decision', async () => {
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

      it('round-trips a deferred decision with its conditions', async () => {
        await save(deferredDecision())
        const read = await repositories.decisions.get('dec-deferred')
        expect(read?.outcome.kind).toBe('deferred')
        expect('selectedRevisionId' in read!.outcome).toBe(false)
        expect(read?.reconsiderationTriggers).toHaveLength(2)
      })

      it('round-trips a declined decision accounting for every revision', async () => {
        await save(declinedDecision())
        const read = await repositories.decisions.get('dec-declined')
        expect(read?.outcome).toMatchObject({
          kind: 'declined',
          declinedRevisionIds: ['rev-1', 'rev-2'],
        })
      })

      it('keeps dissent, its acknowledgement and its evidence', async () => {
        await save(selectedDecision())
        const dissent = (await repositories.decisions.get('dec-1'))?.unresolvedDissent[0]
        expect(dissent?.acknowledgement).toContain('Weighed and accepted')
        expect(dissent?.evidence).toHaveLength(2)
        expect(dissent?.materiality).toBe('material')
      })

      it('keeps each trigger policy version individually', async () => {
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

      it('keeps dissent order across more than one entry', async () => {
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

      it('canonicalises nothing about the actor it was given', async () => {
        await save(selectedDecision())
        const actor = (await repositories.decisions.get('dec-1'))?.decidedBy
        expect(actor?.departmentHandles).toEqual(['chief-decision', 'strategy'])
        expect(actor?.authentication).toBe('system-asserted')
      })

      it('invents no Compliance state', async () => {
        await save(selectedDecision())
        const read = await repositories.decisions.get('dec-1')
        expect(JSON.stringify(read)).not.toMatch(/compliance/i)
      })

      it('returns the stored decision on an identical replay', async () => {
        await save(selectedDecision())
        await repositories.decisions.save(selectedDecision())
        expect(await repositories.decisions.historyForCase('case-1')).toHaveLength(1)
      })

      it('refuses a conflicting replay', async () => {
        await save(selectedDecision())
        await expect(
          repositories.decisions.save(selectedDecision({ rationale: 'Different.' })),
        ).rejects.toThrow(ConflictingRecordError)
      })

      it('refuses a decision the domain validator rejects', async () => {
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

      it('refuses a deferral with no reconsideration condition', async () => {
        await expect(
          save(deferredDecision({ reconsiderationTriggers: [] })),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('refuses a decision referencing a submission that does not exist', async () => {
        await expect(
          save(selectedDecision({ submissionIds: ['sub-1', 'sub-nowhere'] })),
        ).rejects.toThrow(ReferentialIntegrityError)
      })

      it('refuses a second live decision for one case', async () => {
        await save(selectedDecision())
        await expect(
          repositories.decisions.save(selectedDecision({ decisionId: 'dec-2' })),
        ).rejects.toThrow(DuplicateRecordError)
      })
    })

    /* ------------------------------------------------------ supersession */

    describeSupersession('supersession', () => {
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

      it('makes the correction the only live decision', async () => {
        await repositories.decisions.save(correction())
        expect((await repositories.decisions.getForCase('case-1'))?.decisionId).toBe(
          'dec-2',
        )
      })

      it('keeps the superseded decision in history, unchanged', async () => {
        await repositories.decisions.save(correction())
        const history = await repositories.decisions.historyForCase('case-1')
        expect(history.map((decision) => decision.decisionId)).toEqual(['dec-1', 'dec-2'])
        expect(history[0]?.rationale).toContain('disinflation')
      })

      it('excludes superseded decisions from the live listing', async () => {
        await repositories.decisions.save(correction())
        expect(
          (await repositories.decisions.listRecent(10)).map((d) => d.decisionId),
        ).toEqual(['dec-2'])
      })

      it('still reaches a superseded decision by id', async () => {
        await repositories.decisions.save(correction())
        expect((await repositories.decisions.get('dec-1'))?.decisionId).toBe('dec-1')
      })

      it('refuses a second correction of an already-superseded decision', async () => {
        await repositories.decisions.save(correction())
        await expect(
          repositories.decisions.save(correction({ decisionId: 'dec-3' })),
        ).rejects.toThrow(ConcurrencyConflictError)
      })

      it('refuses a correction reusing a predecessor trigger id', async () => {
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

      it('refuses a decision that supersedes itself', async () => {
        await expect(
          repositories.decisions.save(
            selectedDecision({ decisionId: 'dec-9', supersedesDecisionId: 'dec-9' }),
          ),
        ).rejects.toThrow(InvariantViolationError)
      })

      it('refuses a decision superseding one on another case', async () => {
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

      it('refuses a correction of a decision that does not exist', async () => {
        await expect(
          repositories.decisions.save(
            correction({ decisionId: 'dec-4', supersedesDecisionId: 'dec-nowhere' }),
          ),
        ).rejects.toThrow(ReferentialIntegrityError)
      })

      it('leaves the prior decision live when the correction rolls back', async () => {
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
      })
    })

    /* -------------------------------------------------------- immutability */

    describe('records cannot be changed through what they return', () => {
      it('freezes a submission and a return on read', async () => {
        await seedSubmissions()
        await repositories.submissions.recordReturn(cioReturn())

        expect(isDeeplyFrozen(await repositories.submissions.get('sub-2'))).toBe(true)
        expect(isDeeplyFrozen(await repositories.submissions.getReturn('ret-1'))).toBe(true)
      })

      whenDecisions('freezes a decision on read', async () => {
        await seedSubmissions()
        await repositories.decisions.save(selectedDecision())
        expect(isDeeplyFrozen(await repositories.decisions.get('dec-1'))).toBe(true)
      })

      it('ignores a caller mutating the object it passed in', async () => {
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

      whenDecisions('ignores a caller mutating what a read returned', async () => {
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

      it('guarantees nothing about object identity between reads', async () => {
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
      it('refuses a repository captured inside a transaction and used after', async () => {
        let escaped: AnalysisRepositories['submissions'] | null = null
        await repositories.withTransaction(async (scoped) => {
          escaped = scoped.submissions
        })
        await expect(escaped!.get('sub-1')).rejects.toThrow(TransactionClosedError)
      })

      it('rolls a submission back with its transaction', async () => {
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
