/**
 * The governance a submission cites, created through the ports.
 *
 * Shared by both adapters rather than written twice. It has to exist at all
 * because the repositories now verify that every cited review, aggregation, run
 * and claim belongs to the exact case and revision — so a contract test can no
 * longer invent a review id and expect it to be accepted, which is the whole
 * point of that check.
 *
 * Written against the ports, not against either store: the in-memory adapter
 * needs no foreign keys and PostgreSQL needs all of them, and going through the
 * ports is what makes one function satisfy both.
 */

import {
  buildAssignment,
  buildClaim,
  buildRunRecord,
  NON_CONSUMING_BUDGET,
} from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import {
  aggregationIdFor,
  challengeIdsFor,
  claimIdFor,
  devilsAdvocateIdFor,
  evidenceSetsFor,
  peerChallengeIdFor,
  peerExaminationIdFor,
  PEER_EXAMINED_DEPARTMENT,
  PEER_EXAMINER_DEPARTMENT,
  runIdsFor,
  setSeededProvenanceId,
  riskIdFor,
  verificationIdFor,
} from '~/domain/analysis/decisionFixtures'

export interface SeedFixtures {
  /** Employees and departments the schema requires to exist. */
  ownerEmployeeId: string
  departmentId: string
  governanceEmployeeId: string
  governanceDepartmentId: string
  riskEmployeeId: string
  riskDepartmentId: string
  challengeEmployeeId: string
  challengeDepartmentId: string
  /**
   * The analytical desk that peer-examines, and the employee who acts for it.
   *
   * A separate seat from `challenge*`: a peer examination filed by the Devil's
   * Advocate would be refused by `recordPeerExamination`, and the department
   * ids are what the basis's foreign keys point at.
   */
  peerEmployeeId: string
}

const AT = '2026-07-28T08:00:00.000Z'

export interface SeedRequest {
  caseId: string
  revisionIds: readonly string[]
  fixtures: SeedFixtures
}

/**
 * Creates the case, its revisions and every governance artifact the fixture
 * submissions cite. Idempotent: contract tests call it per case.
 */
export async function seedDecisionGovernance(
  repositories: AnalysisRepositories,
  request: SeedRequest,
): Promise<void> {
  const { caseId, revisionIds, fixtures: f } = request

  await repositories.cases.create({
    id: caseId,
    version: 1,
    ownerEmployeeId: f.ownerEmployeeId,
    subject: { kind: 'macro', ref: 'us-rates', displayName: 'US rates' },
    question: 'Is the policy path mispriced?',
    stage: 'decision',
    openedAt: AT,
    participatingDepartmentIds: [f.departmentId],
    transitions: [],
  } as never)

  const provenance = await repositories.provenance()
  setSeededProvenanceId(provenance.provenanceId)

  /*
   * A run carries a foreign key to the playbook entry it executed, so the
   * workflow has to be registered before any run can exist. Registering the
   * real macro playbook rather than inventing one keeps the seed honest about
   * what a run actually references.
   */
  await repositories.playbooks.register(MACRO_REGIME_PLAYBOOK)

  for (const [index, revisionId] of revisionIds.entries()) {
    /*
     * Built by the fixture module, so the ids the submissions cite are the ids
     * that exist. An evidence set id is content-addressed and cannot be chosen.
     */
    const sets = evidenceSetsFor(revisionId)
    for (const set of sets) await repositories.evidence.save(set)

    /*
     * Built as a plain value rather than through `buildThesis`. The revision
     * builder may only be imported by the approved minting sites, and a test
     * fixture is not one of them — weakening that rule so a seed could reuse a
     * constructor would cost more than writing the literal.
     */
    await repositories.theses.save({
      thesisId: `thesis-${caseId}-${index + 1}`,
      revisionId,
      revisionNumber: 1,
      revisionCause: 'initial-proposal',
      caseId,
      implications: [],
      statement: 'The policy path is mispriced',
      position: index === 0 ? 'buy' : 'sell',
      proposedByDepartmentId: f.departmentId,
      proposedByEmployeeId: f.ownerEmployeeId,
      proposedAt: AT,
      invalidationCriteria: 'Inflation reaccelerates.',
      lifecycle: 'proposed',
      supportingClaimIds: [],
      opposingClaimIds: [],
      citedByClaimIds: [],
    } as never)

    for (const runId of runIdsFor(revisionId)) {
      // A run carries a foreign key to the assignment it executed.
      await repositories.assignments.save(
        buildAssignment({
          id: `assignment-${runId}`,
          caseId,
          departmentId: f.departmentId,
          brief: 'Regime read',
          status: 'queued',
          createdAt: AT,
          priority: 5,
        } as never),
      )
      await repositories.runs.save(
        buildRunRecord({
          id: runId,
          caseId,
          assignmentId: `assignment-${runId}`,
          departmentId: f.departmentId,
          employeeId: f.ownerEmployeeId,
          agentContractVersion: '1',
          outputSchemaVersion: '1',
          usage: { state: 'not-applicable' },
          budget: NON_CONSUMING_BUDGET,
          evidenceSetId: sets[0]!.id,
          state: 'running',
          startedAt: AT,
          missingOptionalInputs: [],
          events: [{ runId, at: AT, state: 'running' }],
          claims: [],
          execution: {
            playbookId: MACRO_REGIME_PLAYBOOK.id,
            playbookVersion: MACRO_REGIME_PLAYBOOK.version,
            playbookEntryKey: 'macro-analysis',
            providerId: 'recorded-provider',
            providerVersion: '1',
            providerKind: 'recorded',
            identity: {
              kind: 'model',
              prompt: { id: 'p', version: '1', contentHash: 'ph' },
              model: {
                id: 'm',
                provider: 'anthropic',
                parameters: { temperature: 0 },
                parametersHash: 'mh',
              },
            },
          },
        } as never),
        provenance,
      )
    }

    await repositories.claims.save(
      buildClaim({
        id: claimIdFor(revisionId),
        type: 'observation',
        statement: 'The 10y is at 4.1%',
        evidenceRefs: [],
        contradictingEvidenceRefs: [],
        confidence: { level: 'high', basis: ['single authoritative source'] },
        temporalScope: { asOf: AT },
        status: 'insufficient-evidence',
      } as never),
      caseId,
      runIdsFor(revisionId)[0],
    )

    const scope = {
      scope: 'thesis-revision' as const,
      caseId,
      thesisId: `thesis-${caseId}-${index + 1}`,
      revisionId,
    }

    await repositories.reviews.saveVerification({
      ...scope,
      reviewId: verificationIdFor(revisionId),
      sequence: 1,
      byEmployeeId: f.governanceEmployeeId,
      byDepartmentId: f.governanceDepartmentId,
      at: AT,
      status: 'verified',
      findings: [],
      claimsReviewed: [],
    } as never)

    await repositories.reviews.saveDevilsAdvocate({
      ...scope,
      reviewId: devilsAdvocateIdFor(revisionId),
      sequence: 1,
      byEmployeeId: f.challengeEmployeeId,
      byDepartmentId: f.challengeDepartmentId,
      at: AT,
      challenges: challengeIdsFor(revisionId).map((id) => ({
        id,
        /*
         * Seeded fixtures file Devil's Advocate objections, like the command
         * they stand in for. Written out because this call is `as never` —
         * the cast means the compiler cannot tell anyone when the shape of a
         * challenge changes, so the fields have to be maintained by hand.
         */
        challengerKind: 'devils-advocate',
        byDepartmentId: f.challengeDepartmentId,
        contests: claimIdFor(revisionId),
        kind: 'fragile-assumption',
        argument: 'The assumption rests on one print.',
        // A fragile-assumption objection must say what would settle it.
        wouldBeResolvedBy: 'A second independent print.',
        materiality: 'non-material',
        counterEvidence: [],
      })),
      // How the organization answered each challenge. Open, so the submission
      // legitimately lists them as open.
      outcomes: Object.fromEntries(challengeIdsFor(revisionId).map((id) => [id, 'open'])),
    } as never)

    /*
     * The peer examination the basis references.
     *
     * Seeded for the same reason the Devil's Advocate review above is: a
     * submission's basis names a review id and a department, and PostgreSQL has
     * foreign keys to both. Leaving this out did not make the fixture smaller —
     * it made every Postgres submission save fail on a reference to a review
     * nobody had written.
     */
    await repositories.reviews.savePeerExamination({
      ...scope,
      reviewId: peerExaminationIdFor(revisionId),
      sequence: 1,
      byEmployeeId: f.peerEmployeeId,
      byDepartmentId: PEER_EXAMINER_DEPARTMENT,
      examinedDepartmentId: PEER_EXAMINED_DEPARTMENT,
      at: AT,
      challenges: [
        {
          id: peerChallengeIdFor(revisionId),
          /* A peer's objection, not the control function's. Written out for the
           * reason the Devil's Advocate's are: this call is `as never`. */
          challengerKind: 'peer',
          byDepartmentId: PEER_EXAMINER_DEPARTMENT,
          contests: claimIdFor(revisionId),
          kind: 'fragile-assumption',
          argument: 'The attribution assumes the real-rate component was unchanged.',
          wouldBeResolvedBy: 'A nominal/real decomposition over the same window.',
          materiality: 'material',
          counterEvidence: [],
        },
      ],
      outcomes: { [peerChallengeIdFor(revisionId)]: 'open' },
    } as never)

    await repositories.reviews.saveRisk({
      ...scope,
      reviewId: riskIdFor(revisionId),
      sequence: 1,
      byEmployeeId: f.riskEmployeeId,
      byDepartmentId: f.riskDepartmentId,
      at: AT,
      status: 'accepted',
      findings: [],
      limits: [],
    } as never)
  }

  /*
   * Aggregations last, and in their own pass: an aggregation may not name the
   * revision it produced as its own source, so it needs a sibling revision to
   * have been created first.
   */
  for (const [index, revisionId] of revisionIds.entries()) {
    const source = revisionIds[(index + 1) % revisionIds.length]!
    await repositories.aggregations.save(
      {
        id: aggregationIdFor(revisionId),
        caseId,
        thesisId: `thesis-${caseId}-${index + 1}`,
        sourceRevisionId: source,
        producedRevisionId: revisionId,
        managerEmployeeId: f.ownerEmployeeId,
        departmentId: f.departmentId,
        aggregatedAt: AT,
        rationale: 'Synthesised from the desk contributions.',
        inputs: [
          {
            runId: runIdsFor(revisionId)[0],
            playbookEntryKey: 'macro-analysis',
            requirementLevel: 'required',
          },
        ],
        dispositions: [],
        optionalInputs: [],
      } as never,
      provenance,
    )
  }
}
