/**
 * The manager's formal synthesis.
 *
 * Several desks contributed claims; this is the accountable act that turns them
 * into one argument the firm is prepared to be judged on. It produces two
 * records atomically: a `ManagerAggregation` saying how the manager got there,
 * and the thesis revision governance will review.
 *
 * ## Why the desk's contribution and the manager's act stay separate
 *
 * The Research Office's run is a contribution like any other — a desk producing
 * claims, accepted or refused on the same terms as the macro desk's. This
 * command is the managerial layer above it. Keeping them apart is what lets the
 * record answer, later and separately: what the Research Office produced, what
 * the manager adopted, what the manager set aside, which disagreements were
 * escalated, and who took responsibility for the resulting revision. Folding
 * the two together would make the last question unanswerable, because the
 * provider that produced the run is not the person accountable for the firm's
 * position.
 *
 * ## Scope is chosen; answering for what is in it is not
 *
 * The manager names the contributions considered. Three rules bound that
 * choice: every required upstream contribution is in scope, every completed
 * contribution that OPPOSES this lineage is in scope whether it was named or
 * not, and every available optional contribution the manager calls materially
 * relevant is in scope. Inside the scope, every claim gets exactly one
 * disposition. Scope selection is therefore not a way to lose a dissenting
 * desk — which is the failure this whole stage is built against.
 */

import {
  buildManagerAggregation,
  disagreementRequiresEscalation,
  revisionClaimIds,
  type AgentClaim,
  type AggregationInput,
  type ClaimDispositionRecord,
  type DisagreementMateriality,
  type InvestmentImplication,
  type InvestmentThesis,
  type ManagerAggregation,
  type Organization,
  type OptionalInputRecord,
  inquiryKindOf,
  latestApplicable,
  synthesisPermittedFor,
  type AgentRunRecord,
  type Assignment,
} from '~/domain/analysis'
import { requirePlaybook } from '../playbookRegistry'
import { mintRevision } from '../revisions'
import { standingRunFor, unmetRequiredWork } from '../requiredWork'
import { deriveAggregationId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import {
  asCanonicalValue,
  utf8ByteOrder,
  type CanonicalValue,
} from '~/domain/shared/canonicalValue'

export interface ClaimDispositionInput {
  claimId: string
  disposition: ClaimDispositionRecord['disposition']
  explanation?: string
  supersededByClaimId?: string
  /** Required by `retained-unresolved`, refused everywhere else. */
  materiality?: DisagreementMateriality
}

export interface OptionalInputRecordInput {
  playbookEntryKey: string
  availability: OptionalInputRecord['availability']
  scope?: OptionalInputRecord['scope']
  materiallyRelevant: boolean
  explanation?: string
}

interface AggregationScope {
  caseId: string
  /** The revision synthesised from. Must be the lineage's current one. */
  sourceRevisionId: string
  /** Declared for the mandate; verified against the playbook's aggregation entry. */
  departmentId: string
}

/**
 * A synthesis a human manager authors in this act.
 *
 * Unchanged, deliberately. A person can read the contributions and state a
 * position they stand behind in one act; requiring them to produce a candidate
 * first and adopt it second would be ceremony, and would mean manufacturing
 * candidate records for work no model produced.
 */
export interface DirectSynthesisInput extends AggregationScope {
  /** Absent: nothing is being adopted, because this synthesis is being written. */
  synthesisFromRunId?: undefined
  /** The exact contributions considered, as completed run ids. */
  inputRunIds: readonly string[]
  dispositions: readonly ClaimDispositionInput[]
  optionalInputs: readonly OptionalInputRecordInput[]
  /** Why the synthesis reads as it does. Stored on the aggregation. */
  rationale: string

  /** The resulting position. Stated by the manager, never assembled from claims. */
  statement: string
  position: string
  implications: readonly InvestmentImplication[]
  invalidationCriteria: string
  horizon?: string
}

/**
 * A synthesis an institutional agent adopts, having produced it as a candidate.
 *
 * The reference is the whole input, and every other field is `never`. That is
 * the point: a caller cannot name candidate A and supply prose B, so a
 * candidate cannot survive as decorative provenance beside a synthesis it does
 * not match. The command loads the immutable candidate and institutionalises
 * exactly what it holds.
 */
export interface AdoptedSynthesisInput extends AggregationScope {
  /** The run whose produced synthesis this act adopts. */
  synthesisFromRunId: string

  inputRunIds?: undefined
  dispositions?: undefined
  optionalInputs?: undefined
  rationale?: undefined
  statement?: undefined
  position?: undefined
  implications?: undefined
  invalidationCriteria?: undefined
  horizon?: undefined
}

export type AggregateManagerConclusionInput =
  | DirectSynthesisInput
  | AdoptedSynthesisInput

export function aggregateManagerConclusion(
  organization: Organization,
): CommandDefinition<AggregateManagerConclusionInput, InvestmentThesis> {
  return {
    type: 'AggregateManagerConclusion',
    /* It mints a revision; it does not move case-level stage. */
    versionPolicy: 'refuses-expected-version',
    /*
     * Optional on the envelope, because the rationale is a required INPUT: a
     * synthesis owes an explanation of itself, and that explanation belongs on
     * the aggregation record where the CIO reads it, not on a delivery envelope
     * nobody projects.
     */
    reasonPolicy: 'optional',
    category: 'analysis',
    mandate: (input) => ({
      kind: 'department-manager',
      departmentId: input.departmentId,
    }),
    scope: (input) => ({
      caseId: input.caseId,
      thesisRevisionId: input.sourceRevisionId,
    }),
    /*
     * Two payload shapes, because there are two acts.
     *
     * The direct one is byte-for-byte what it always was, so every historical
     * aggregation keeps the identity it was recorded under. The adopted one is
     * the candidate reference and nothing else — and it is STRONGER, not
     * weaker: the candidate is immutable and its hash covers the artifact and
     * the institutional basis together, so the payload is content-bound rather
     * than a hash of prose the caller could have retyped.
     */
    payload: (input): CanonicalValue => {
      if (input.synthesisFromRunId !== undefined) {
        return {
          sourceRevisionId: input.sourceRevisionId,
          departmentId: input.departmentId,
          synthesisFromRunId: input.synthesisFromRunId,
        }
      }
      return {
        sourceRevisionId: input.sourceRevisionId,
        departmentId: input.departmentId,
        inputRunIds: [...input.inputRunIds].sort(utf8ByteOrder),
        dispositions: asCanonicalValue(
          [...input.dispositions].sort((a, b) =>
            utf8ByteOrder(a.claimId, b.claimId),
          ),
        ),
        optionalInputs: asCanonicalValue(
          [...input.optionalInputs].sort((a, b) =>
            utf8ByteOrder(a.playbookEntryKey, b.playbookEntryKey),
          ),
        ),
        rationale: input.rationale,
        statement: input.statement,
        position: input.position,
        implications: [...input.implications].sort(utf8ByteOrder),
        invalidationCriteria: input.invalidationCriteria,
        horizon: input.horizon ?? null,
      }
    },

    async execute(repositories, context, input) {
      /* --------------------------------------------------------- the case */

      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)
      if (investmentCase.stage === 'published' || investmentCase.stage === 'withdrawn') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage} and accepts no ` +
            `further synthesis.`,
        )
      }
      if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" has no playbook, so there is no declared set ` +
            `of contributions to aggregate.`,
        )
      }
      const playbook = requirePlaybook(
        investmentCase.playbookId,
        investmentCase.playbookVersion,
      )

      /* ----------------------------------------------------- the authority */

      const entry = playbook.entries.find(
        (candidate) => candidate.departmentId === input.departmentId,
      )
      if (!entry) {
        reject(
          'not-authorised',
          `Playbook "${playbook.id}@${playbook.version}" gives "${input.departmentId}" ` +
            `no step to aggregate.`,
        )
      }

      const department = organization.departments.find((d) => d.id === input.departmentId)
      if (!department) {
        reject('not-found', `Department "${input.departmentId}" does not exist`)
      }
      /*
       * `authorize` has already checked that the actor holds this department's
       * management authority. What it cannot check is that somebody the firm
       * can hold to account — rather than the orchestrator — is standing behind
       * the conclusion. An orchestrator may INITIATE this command and may never
       * author what it concludes.
       *
       * A person or an authorised institutional agent. Which one decides which
       * shape of input is legal, below: a person may author a synthesis in this
       * act, and an agent may only adopt one it already produced and persisted.
       */
      const managerEmployeeId = context.actor.employeeId
      const managerAgentPrincipalId = context.actor.agentPrincipalId
      if (!managerEmployeeId && !managerAgentPrincipalId) {
        reject(
          'not-authorised',
          `A managerial synthesis needs an accountable principal. A system ` +
            `actor cannot take responsibility for the firm's position.`,
        )
      }

      /*
       * The two paths, and why they are not interchangeable.
       *
       * A human manager reads the contributions and states a position they
       * stand behind — one act, and the text is theirs. A model did not do
       * that: its output is work the firm paid for and has not yet adopted, and
       * letting it reach `thesis_revisions` straight from a command input would
       * lose for the manager exactly the boundary the specialist desks keep.
       *
       * So the actor kind decides the shape, and the wrong combination fails
       * closed rather than picking a reading.
       */
      const adopting = input.synthesisFromRunId !== undefined
      if (managerAgentPrincipalId && !adopting) {
        reject(
          'not-authorised',
          `An institutional agent may not state a synthesis directly. Produce ` +
            `it as a candidate and adopt it by reference, so the firm can prove ` +
            `which model artifact became its position.`,
        )
      }
      if (managerEmployeeId && adopting) {
        reject(
          'invariant-violated',
          `A synthesis candidate is adopted by the principal that produced it. ` +
            `An employee stating the firm's position states it here, in their ` +
            `own act.`,
        )
      }

      /* ----------------------------------------------------- the revision */

      const source = await repositories.theses.get(input.sourceRevisionId)
      if (!source) {
        reject('not-found', `Revision "${input.sourceRevisionId}" does not exist`)
      }
      if (source.caseId !== input.caseId) {
        reject(
          'invariant-violated',
          `Revision "${input.sourceRevisionId}" is another case's`,
        )
      }
      if (source.lifecycle === 'superseded') {
        reject(
          'illegal-prior-state',
          `Revision "${input.sourceRevisionId}" has been superseded. Aggregate ` +
            `onto the lineage's current revision.`,
        )
      }


      /* ------------------------------------------------- required work */

      const assignments = await repositories.assignments.listForCase(input.caseId)
      const runs = await repositories.runs.listForCase(input.caseId)
      const resolutions = await repositories.requirements.listForCase(input.caseId)

      const unmet = unmetRequiredWork({
        playbook,
        entryKey: entry.key,
        revisionId: input.sourceRevisionId,
        assignments,
        runs,
        resolutions,
      })
      if (unmet.length > 0) {
        reject(
          'illegal-prior-state',
          `Required work has not been accepted: ` +
            unmet.map((item) => `${item.playbookEntryKey} (${item.reason})`).join(', ') +
            `. A manager's conclusion drawn from work that never arrived is a ` +
            `different conclusion, not a weaker one.`,
        )
      }

      /* ----------------------------------------- the synthesis being adopted */

      /*
       * From here on the command works from ONE synthesis, whichever path
       * produced it. A human's is the input; an agent's is loaded from the
       * candidate store and the input is only the reference.
       */
      let synthesis: {
        inputRunIds: readonly string[]
        dispositions: readonly ClaimDispositionInput[]
        optionalInputs: readonly OptionalInputRecordInput[]
        rationale: string
        statement: string
        position: string
        implications: readonly InvestmentImplication[]
        invalidationCriteria: string
        horizon?: string
      }
      let synthesisRunId: string | undefined

      if (input.synthesisFromRunId !== undefined) {
        const candidate = await repositories.producedSyntheses.get(
          input.synthesisFromRunId,
        )
        if (!candidate) {
          reject(
            'not-found',
            `Run "${input.synthesisFromRunId}" produced no synthesis. There is ` +
              `nothing to adopt, and an agent may not supply one here.`,
          )
        }
        if (candidate.caseId !== input.caseId) {
          reject(
            'invariant-violated',
            `The candidate belongs to case "${candidate.caseId}", not to ` +
              `"${input.caseId}".`,
          )
        }
        if (candidate.basis.sourceRevisionId !== input.sourceRevisionId) {
          reject(
            'invariant-violated',
            `The candidate was produced from revision ` +
              `"${candidate.basis.sourceRevisionId}" and is being adopted onto ` +
              `"${input.sourceRevisionId}". A synthesis answers the argument it ` +
              `reconciled, not a different one.`,
          )
        }
        if (
          candidate.basis.playbookId !== playbook.id ||
          candidate.basis.playbookVersion !== playbook.version
        ) {
          reject(
            'invariant-violated',
            `The candidate was produced under playbook ` +
              `"${candidate.basis.playbookId}@${candidate.basis.playbookVersion}" ` +
              `and the case runs "${playbook.id}@${playbook.version}".`,
          )
        }

        /*
         * The stale-candidate refusal.
         *
         * The candidate captured the completed-run universe it was produced
         * against; this recomputes it. The comparison is deliberately over the
         * SAME set the checks below reason about — every completed run on the
         * case — so a candidate is stale exactly when the state those checks
         * read has moved.
         *
         * The rules below already catch a new REQUIRED contribution and a new
         * OPPOSING one. This catches the case they cannot: a newly accepted
         * optional contribution that argues for nothing in particular. The
         * candidate recorded "unavailable at aggregation" and that has since
         * become false, and a synthesis whose account of what it saw is wrong
         * is not a weaker synthesis — it is a different one.
         *
         * Not a timestamp. A clock reading says nothing about whether the
         * inputs moved.
         */
        const observedNow = runs
          .filter((candidateRun) => candidateRun.state === 'completed')
          /*
           * The producing run is outside its own basis, on both sides of the
           * comparison. It was still `running` when the candidate was written
           * and is `completed` by the time anyone adopts, so counting it would
           * make every candidate stale against itself.
           */
          .filter((candidateRun) => candidateRun.id !== candidate.runId)
          .map((candidateRun) => candidateRun.id)
          .sort(utf8ByteOrder)
        const observedThen = [...candidate.basis.observedCompletedRunIds].sort(
          utf8ByteOrder,
        )
        if (
          observedNow.length !== observedThen.length ||
          observedNow.some((runId, index) => runId !== observedThen[index])
        ) {
          const appeared = observedNow.filter((runId) => !observedThen.includes(runId))
          const gone = observedThen.filter((runId) => !observedNow.includes(runId))
          reject(
            'illegal-prior-state',
            `The synthesis candidate was produced against a different set of ` +
              `accepted contributions` +
              (appeared.length > 0 ? ` (since accepted: ${appeared.join(', ')})` : '') +
              (gone.length > 0 ? ` (no longer accepted: ${gone.join(', ')})` : '') +
              `. Synthesise again against what the firm now holds — an old ` +
              `reading of the evidence is not the institution's conclusion ` +
              `about the new one.`,
          )
        }

        synthesis = {
          inputRunIds: candidate.artifact.inputRunIds,
          dispositions: candidate.artifact.dispositions,
          optionalInputs: candidate.artifact.optionalInputs,
          rationale: candidate.artifact.rationale,
          statement: candidate.artifact.statement,
          position: candidate.artifact.position,
          implications: candidate.artifact.implications,
          invalidationCriteria: candidate.artifact.invalidationCriteria,
          ...(candidate.artifact.horizon !== undefined
            ? { horizon: candidate.artifact.horizon }
            : {}),
        }
        synthesisRunId = candidate.runId
      } else {
        synthesis = {
          inputRunIds: input.inputRunIds,
          dispositions: input.dispositions,
          optionalInputs: input.optionalInputs,
          rationale: input.rationale,
          statement: input.statement,
          position: input.position,
          implications: input.implications,
          invalidationCriteria: input.invalidationCriteria,
          ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
        }
      }

      /* --------------------------------------------------- declared scope */

      const declared = new Set(synthesis.inputRunIds)
      const byRunId = new Map(runs.map((run) => [run.id, run]))

      for (const runId of declared) {
        const run = byRunId.get(runId)
        if (!run) reject('not-found', `Run "${runId}" does not exist on this case`)
        if (run.state !== 'completed') {
          reject(
            'illegal-prior-state',
            `Run "${runId}" is ${run.state}. Only an accepted contribution can ` +
              `be aggregated.`,
          )
        }
      }

      // Every required upstream contribution, whether the manager listed it.
      const requiredRunIds = requiredContributionRunIds(
        playbook,
        entry.key,
        assignments,
        runs,
        input.sourceRevisionId,
        resolutions,
      )
      const omittedRequired = [...requiredRunIds].filter((id) => !declared.has(id))
      if (omittedRequired.length > 0) {
        reject(
          'invariant-violated',
          `The declared scope omits required contributions ` +
            `(${omittedRequired.join(', ')}). Required work is in scope by ` +
            `definition; the manager chooses what else is.`,
        )
      }

      /*
       * And every completed contribution that argues AGAINST this lineage.
       * Mechanical rather than a judgement call, and the one rule that makes
       * scope selection unusable as a way to lose a dissenting desk.
       */
      const standingRunIds = new Set(
        assignments
          .map((assignment) => standingRunFor(assignment, runs)?.id)
          .filter((id): id is string => id !== undefined),
      )
      const opposing = runs.filter(
        (run) =>
          standingRunIds.has(run.id) &&
          run.claims.some((claim) => claim.opposesThesisId === source.thesisId),
      )
      const hiddenOpposition = opposing
        .filter((run) => !declared.has(run.id))
        .map((run) => run.id)
      if (hiddenOpposition.length > 0) {
        reject(
          'invariant-violated',
          `The declared scope omits contributions arguing against this thesis ` +
            `(${hiddenOpposition.join(', ')}). Contrary work is answered, not ` +
            `left out of scope.`,
        )
      }

      /* ------------------------------------------------- optional inputs */

      const optionalEntries = playbook.entries.filter(
        (candidate) =>
          candidate.requirement === 'optional' &&
          (entry.optionalInputs.includes(candidate.key) ||
            entry.blockedBy.includes(candidate.key)),
      )
      const accountedFor = new Set(
        synthesis.optionalInputs.map((record) => record.playbookEntryKey),
      )
      const unaccounted = optionalEntries
        .map((candidate) => candidate.key)
        .filter((key) => !accountedFor.has(key))
      if (unaccounted.length > 0) {
        reject(
          'invariant-violated',
          `Optional inputs are unaccounted for (${unaccounted.join(', ')}). An ` +
            `absent perspective is a fact about the synthesis and is recorded ` +
            `as one.`,
        )
      }

      /* ------------------------------------------------- the claims in scope */

      const claimsInScope: Array<{ claim: AgentClaim; runId: string }> = []
      for (const runId of declared) {
        for (const claim of byRunId.get(runId)!.claims) {
          claimsInScope.push({ claim, runId })
        }
      }

      /*
       * The highest materiality each claim was previously recorded at, across
       * this lineage. A later aggregation recording a lower one has to say so.
       */
      const priorMateriality = await highestPriorMateriality(
        repositories,
        input.caseId,
        source.thesisId,
      )

      const aggregationId = deriveAggregationId(context.commandId, input.sourceRevisionId)

      const dispositions: ClaimDispositionRecord[] = synthesis.dispositions.map((given) => {
        const found = claimsInScope.find(
          (entryInScope) => entryInScope.claim.id === given.claimId,
        )
        if (!found) {
          reject(
            'not-found',
            `Claim "${given.claimId}" is not in any declared input contribution.`,
          )
        }
        const materiality = given.materiality
        return {
          claimId: given.claimId,
          runId: found.runId,
          disposition: given.disposition,
          ...(given.explanation ? { explanation: given.explanation } : {}),
          ...(given.supersededByClaimId
            ? { supersededByClaimId: given.supersededByClaimId }
            : {}),
          ...(materiality
            ? {
                materiality,
                // Derived here and nowhere else, so the stored consequence and
                // the rule that produced it cannot drift apart.
                escalationRequired: disagreementRequiresEscalation(materiality),
                ...(priorMateriality[given.claimId] &&
                priorMateriality[given.claimId] !== materiality &&
                isDowngrade(priorMateriality[given.claimId]!, materiality)
                  ? { downgradedFrom: priorMateriality[given.claimId]! }
                  : {}),
              }
            : {}),
        }
      })

      const inputs: AggregationInput[] = [...declared].map((runId) => {
        const run = byRunId.get(runId)!
        const assignment = assignments.find((a) => a.id === run.assignmentId)
        const runEntry = playbook.entries.find(
          (candidate) => candidate.key === assignment?.playbookEntryKey,
        )
        return {
          runId,
          playbookEntryKey: run.execution.playbookEntryKey,
          requirementLevel: runEntry?.requirement ?? 'optional',
        }
      })

      let aggregation: ManagerAggregation
      try {
        aggregation = buildManagerAggregation(
          {
            id: aggregationId,
            caseId: input.caseId,
            thesisId: source.thesisId,
            sourceRevisionId: input.sourceRevisionId,
            producedRevisionId: '',
            /*
             * Exactly one principal, in its own field. An agent's synthesis is
             * the agent's act; writing the human Research Director's id here
             * would put a person's name on a position they never read.
             */
            ...(managerEmployeeId ? { managerEmployeeId } : {}),
            ...(managerAgentPrincipalId ? { managerAgentPrincipalId } : {}),
            /* The candidate that became this position, where one did. */
            ...(synthesisRunId ? { synthesisRunId } : {}),
            departmentId: input.departmentId,
            aggregatedAt: context.occurredAt,
            rationale: synthesis.rationale,
            inputs,
            dispositions,
            optionalInputs: synthesis.optionalInputs.map((record) => ({
              playbookEntryKey: record.playbookEntryKey,
              availability: record.availability,
              ...(runIdForEntry(record.playbookEntryKey, assignments, runs)
                ? { runId: runIdForEntry(record.playbookEntryKey, assignments, runs)! }
                : {}),
              ...(record.scope ? { scope: record.scope } : {}),
              materiallyRelevant: record.materiallyRelevant,
              ...(record.explanation ? { explanation: record.explanation } : {}),
            })),
          },
          {
            claimsInScope: claimsInScope.map((entryInScope) => ({
              claimId: entryInScope.claim.id,
              runId: entryInScope.runId,
              opposesThisThesis: entryInScope.claim.opposesThesisId === source.thesisId,
            })),
            priorMateriality,
          },
        )
      } catch (error) {
        reject(
          'invariant-violated',
          error instanceof Error ? error.message : String(error),
        )
      }

      /* ------------------------------------------------------- the writes */

      const { supporting, opposing: opposingIds } = revisionClaimIds(aggregation)

      /*
       * The kind of question decides what a synthesis may be (ruled
       * 2026-09-18). An explanation stays an explanation: the office may weigh
       * drivers and state uncertainty in its prose, but a position or an
       * implementation implication nobody asked for is refused here — whether
       * a person stated it or a candidate carried it — not routed to Risk as
       * though the person had asked what to do.
       */
      const lineage = await repositories.theses.listForCase(input.caseId)
      const permitted = synthesisPermittedFor(
        inquiryKindOf(lineage, source.thesisId),
        synthesis.position,
        synthesis.implications,
      )
      if (!permitted.permitted) reject('invariant-violated', permitted.reason)

      /*
       * A synthesis onto a revision Verification sent back is a CORRECTION.
       * The successor's cause and reason carry the lineage — which verdict,
       * on which revision — so the record reads revision N → findings →
       * correction work → revision N+1 without anyone narrating it (TD-99,
       * ruled 2026-09-22). The examined revision is superseded, not edited.
       */
      const demanded = latestApplicable(
        await repositories.reviews.verificationsForCase(input.caseId),
        input.caseId,
        source.revisionId,
      )
      const correcting = demanded?.status === 'correction-required'

      const revision = await mintRevision(repositories, context, {
        caseId: input.caseId,
        thesisId: source.thesisId,
        prior: source,
        changes: {
          statement: synthesis.statement,
          position: synthesis.position,
          invalidationCriteria: synthesis.invalidationCriteria,
          ...(synthesis.horizon ? { horizon: synthesis.horizon } : {}),
          implications: synthesis.implications,
          supportingClaimIds: supporting,
          opposingClaimIds: opposingIds,
        },
        cause: correcting ? 'correction' : 'manager-aggregation',
        reason: correcting
          ? `Correction of revision ${source.revisionNumber} after Verification ` +
            `${demanded!.reviewId} demanded corrections. ${synthesis.rationale}`
          : synthesis.rationale,
        proposedByDepartmentId: input.departmentId,
        lifecycle: 'under-analysis',
        aggregationId,
      })

      /*
       * The aggregation names the revision it produced, and the revision names
       * the aggregation. Both are written here, in one transaction: an
       * aggregation whose revision rolled back would describe a synthesis that
       * never happened.
       */
      await repositories.aggregations.save(
        { ...aggregation, producedRevisionId: revision.revisionId },
        context.provenance,
      )

      /*
       * Nothing here asks whether a disagreement blocks. Aggregation records
       * what the research organization concluded; whether that conclusion
       * permits progression to the CIO is a policy judgement made at
       * submission, under the eligibility policy in force then. Migration 0023
       * removed the stored answer for the same reason.
       */

      return { value: revision, resultKind: 'revision', resultRef: revision.revisionId }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.theses.get(resultRef)
      if (!found) {
        throw new Error(
          `Revision "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}

/* -------------------------------------------------------------- helpers */

const MATERIALITY_RANK: Readonly<Record<DisagreementMateriality, number>> = Object.freeze(
  {
    'non-material': 0,
    material: 1,
    'decision-critical': 2,
  },
)

function isDowngrade(
  previous: DisagreementMateriality,
  next: DisagreementMateriality,
): boolean {
  return MATERIALITY_RANK[next] < MATERIALITY_RANK[previous]
}

/** The run ids of accepted contributions for required upstream entries. */
function requiredContributionRunIds(
  playbook: ReturnType<typeof requirePlaybook>,
  entryKey: string,
  assignments: readonly Assignment[],
  runs: readonly AgentRunRecord[],
  revisionId: string,
  resolutions: readonly Parameters<typeof unmetRequiredWork>[0]['resolutions'][number][],
): Set<string> {
  const required = new Set(
    playbook.entries
      .filter((entry) => {
        if (entry.requirement === 'required') return true
        if (entry.requirement !== 'conditional') return false
        return resolutions.some(
          (resolution) =>
            resolution.playbookEntryKey === entry.key &&
            resolution.revisionId === revisionId &&
            resolution.state === 'required',
        )
      })
      .map((entry) => entry.key),
  )

  const closure = new Set(
    playbook.entries
      .find((entry) => entry.key === entryKey)
      ?.blockedBy.filter((key) => required.has(key)) ?? [],
  )

  /* The run that STANDS for each required assignment — accepted, not returned, not replaced. */
  const standing = new Set<string>()
  for (const assignment of assignments) {
    if (!assignment.playbookEntryKey || !closure.has(assignment.playbookEntryKey)) continue
    const run = standingRunFor(assignment, runs)
    if (run) standing.add(run.id)
  }
  return standing
}

function runIdForEntry(
  entryKey: string,
  assignments: readonly Assignment[],
  runs: readonly AgentRunRecord[],
): string | null {
  const assignment = assignments.find((a) => a.playbookEntryKey === entryKey)
  if (!assignment) return null
  return standingRunFor(assignment, runs)?.id ?? null
}

/** The highest materiality each claim carries across this lineage's history. */
async function highestPriorMateriality(
  repositories: Parameters<
    CommandDefinition<AggregateManagerConclusionInput, InvestmentThesis>['execute']
  >[0],
  caseId: string,
  thesisId: string,
): Promise<Record<string, DisagreementMateriality>> {
  const previous = await repositories.aggregations.listForCase(caseId)
  const highest: Record<string, DisagreementMateriality> = {}

  for (const aggregation of previous) {
    if (aggregation.thesisId !== thesisId) continue
    for (const record of aggregation.dispositions) {
      if (!record.materiality) continue
      const current = highest[record.claimId]
      if (!current || MATERIALITY_RANK[record.materiality] > MATERIALITY_RANK[current]) {
        highest[record.claimId] = record.materiality
      }
    }
  }
  return highest
}
