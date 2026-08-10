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
} from '~/domain/analysis'
import { requirePlaybook } from '../playbookRegistry'
import { mintRevision } from '../revisions'
import { unmetRequiredWork } from '../requiredWork'
import { deriveAggregationId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { asCanonicalValue, utf8ByteOrder } from '~/domain/shared/canonicalValue'

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

export interface AggregateManagerConclusionInput {
  caseId: string
  /** The revision synthesised from. Must be the lineage's current one. */
  sourceRevisionId: string
  /** Declared for the mandate; verified against the playbook's aggregation entry. */
  departmentId: string
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
    payload: (input) => ({
      sourceRevisionId: input.sourceRevisionId,
      departmentId: input.departmentId,
      inputRunIds: [...input.inputRunIds].sort(utf8ByteOrder),
      dispositions: asCanonicalValue(
        [...input.dispositions].sort((a, b) => utf8ByteOrder(a.claimId, b.claimId)),
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
    }),

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
       * `authorize` has already checked that the actor manages this department.
       * What it cannot check is that a person, rather than the orchestrator, is
       * accountable — an orchestrator may INITIATE this command and may not
       * author the conclusion.
       */
      const managerEmployeeId = context.actor.employeeId
      if (!managerEmployeeId) {
        reject(
          'not-authorised',
          `A managerial synthesis needs an accountable employee. A system actor ` +
            `cannot take responsibility for the firm's position.`,
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

      /* --------------------------------------------------- declared scope */

      const declared = new Set(input.inputRunIds)
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
      const opposing = runs.filter(
        (run) =>
          run.state === 'completed' &&
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
        input.optionalInputs.map((record) => record.playbookEntryKey),
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

      const dispositions: ClaimDispositionRecord[] = input.dispositions.map((given) => {
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
            managerEmployeeId,
            departmentId: input.departmentId,
            aggregatedAt: context.occurredAt,
            rationale: input.rationale,
            inputs,
            dispositions,
            optionalInputs: input.optionalInputs.map((record) => ({
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

      const revision = await mintRevision(repositories, context, {
        caseId: input.caseId,
        thesisId: source.thesisId,
        prior: source,
        changes: {
          statement: input.statement,
          position: input.position,
          invalidationCriteria: input.invalidationCriteria,
          ...(input.horizon ? { horizon: input.horizon } : {}),
          implications: input.implications,
          supportingClaimIds: supporting,
          opposingClaimIds: opposingIds,
        },
        cause: 'manager-aggregation',
        reason: input.rationale,
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
  assignments: readonly { id: string; playbookEntryKey?: string }[],
  runs: readonly { id: string; assignmentId: string; state: string }[],
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

  const assignmentIds = new Set(
    assignments
      .filter((a) => a.playbookEntryKey && closure.has(a.playbookEntryKey))
      .map((a) => a.id),
  )
  return new Set(
    runs
      .filter((run) => assignmentIds.has(run.assignmentId) && run.state === 'completed')
      .map((run) => run.id),
  )
}

function runIdForEntry(
  entryKey: string,
  assignments: readonly { id: string; playbookEntryKey?: string }[],
  runs: readonly { id: string; assignmentId: string; state: string }[],
): string | null {
  const assignment = assignments.find((a) => a.playbookEntryKey === entryKey)
  if (!assignment) return null
  const run = runs.find(
    (r) => r.assignmentId === assignment.id && r.state === 'completed',
  )
  return run?.id ?? null
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
