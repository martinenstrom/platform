/**
 * Manager aggregation — how a conclusion was reached, kept apart from the
 * conclusion itself.
 *
 * A thesis revision says what the firm's position **is**. This says how the
 * manager got there: which contributions were in scope, what happened to every
 * claim inside them, which perspectives were missing, and who is accountable.
 * Two records because they answer two questions, and folding the second into
 * the first would make the position harder to read than its own bookkeeping.
 *
 * ## The failure this exists to prevent
 *
 * A manager reconciling four desks can quietly drop the one that disagreed, and
 * the result reads exactly like a manager who reconciled four desks that
 * agreed. Every rule below follows from refusing that:
 *
 *   - every claim in the declared scope gets exactly one disposition
 *   - a contribution that OPPOSES the thesis is in scope whether it was listed
 *     or not
 *   - losing a claim requires a bounded reason and, where judgement was
 *     exercised, an explanation
 *   - a disagreement the manager could not resolve carries materiality, and the
 *     most serious kind blocks the CIO rather than travelling as a footnote
 *
 * Nothing here deletes or edits a claim. The aggregation references stored
 * claims; that is the only relationship it has to them.
 */

import type { CaseId } from './cases'
import type { ClaimId } from './claims'
import type { EmployeeId, DepartmentId } from './organization'
import type { RevisionId, ThesisId } from './theses'
import { utf8ByteOrder } from '~/domain/shared/canonicalValue'

export type AggregationId = string

/* ---------------------------------------------------------- dispositions */

/**
 * What the manager did with one claim.
 *
 * Closed, for the same reason `RunFailureCategory` is closed: a free-text field
 * on the path where work disappears is where the reasons stop being comparable
 * across cases, desks and years.
 */
export type ClaimDisposition =
  /** Adopted as an argument for the thesis. */
  | 'adopted-supporting'
  /** Adopted as an argument against it, and kept on the revision. */
  | 'adopted-opposing'
  /** The manager could not reconcile it. Kept, with materiality. */
  | 'retained-unresolved'
  /** Answered by better evidence, which must be named and adopted. */
  | 'superseded-by-stronger-evidence'
  | 'excluded-duplicate'
  | 'excluded-out-of-scope'
  | 'excluded-methodologically-incompatible'
  | 'excluded-insufficiently-supported'

export const CLAIM_DISPOSITIONS: readonly ClaimDisposition[] = [
  'adopted-supporting',
  'adopted-opposing',
  'retained-unresolved',
  'superseded-by-stronger-evidence',
  'excluded-duplicate',
  'excluded-out-of-scope',
  'excluded-methodologically-incompatible',
  'excluded-insufficiently-supported',
] as const

/** Dispositions where the manager exercised judgement and owes an explanation. */
const EXPLANATION_REQUIRED: readonly ClaimDisposition[] = [
  'superseded-by-stronger-evidence',
  'excluded-duplicate',
  'excluded-out-of-scope',
  'excluded-methodologically-incompatible',
  'excluded-insufficiently-supported',
] as const

/** Dispositions that put the claim on the resulting revision. */
export function landsOnRevision(disposition: ClaimDisposition): boolean {
  return (
    disposition === 'adopted-supporting' ||
    disposition === 'adopted-opposing' ||
    disposition === 'retained-unresolved'
  )
}

/* ------------------------------------------------------------ materiality */

/**
 * How much an unresolved disagreement matters.
 *
 * Three levels because unresolved disagreements do not behave alike, and
 * treating them alike fails in both directions: a footnote-level quibble would
 * block a case, or a disagreement that decides the answer would travel to the
 * CIO as a footnote.
 */
export type DisagreementMateriality = 'non-material' | 'material' | 'decision-critical'

export const DISAGREEMENT_MATERIALITIES: readonly DisagreementMateriality[] = [
  'non-material',
  'material',
  'decision-critical',
] as const

const MATERIALITY_ORDER: Readonly<Record<DisagreementMateriality, number>> =
  Object.freeze({ 'non-material': 0, material: 1, 'decision-critical': 2 })

/**
 * Whether a disagreement at this level stops the CIO seeing the revision as
 * eligible.
 *
 * **The only implementation of that comparison**, and it must stay so: a second
 * one in a handler, in assembly, in SQL or in a view would be free to drift.
 *
 * **The threshold is not domain law -- it is policy.** It arrives as an argument
 * from the versioned `EligibilityPolicy` the submission selected
 * (`disagreementBlocksAtOrAbove`), because different policies may draw the line
 * differently and the firm is entitled to change where it draws it.
 *
 * Nothing derived from this is stored. `blocks_eligibility` used to be, computed
 * at aggregation time from materiality alone -- a policy judgement written
 * before its governing policy was known, and quietly wrong for any policy that
 * disagreed with the one hardcoded rule. Migration 0023 removed it. The
 * judgement is made where the policy is known, and nowhere else.
 */
export function disagreementBlocksEligibility(
  materiality: DisagreementMateriality,
  threshold: DisagreementMateriality,
): boolean {
  return MATERIALITY_ORDER[materiality] >= MATERIALITY_ORDER[threshold]
}

/**
 * Whether this level owes an escalation or an explicit acknowledgement.
 *
 * `material` is the level that would otherwise disappear: it does not block, so
 * without this flag it would travel to the CIO indistinguishable from a
 * quibble.
 */
export function disagreementRequiresEscalation(
  materiality: DisagreementMateriality,
): boolean {
  return materiality === 'material' || materiality === 'decision-critical'
}

/** True when `next` is a weaker judgement than `previous`. */
export function isMaterialityDowngrade(
  previous: DisagreementMateriality,
  next: DisagreementMateriality,
): boolean {
  return MATERIALITY_ORDER[next] < MATERIALITY_ORDER[previous]
}

/* ------------------------------------------------------------- the records */

export interface ClaimDispositionRecord {
  claimId: ClaimId
  /** The contribution the claim came from. */
  runId: string
  disposition: ClaimDisposition
  /**
   * Required wherever the manager exercised judgement — every exclusion, every
   * supersession, and every materiality downgrade.
   */
  explanation?: string
  /** Required by `superseded-by-stronger-evidence`, and adopted in this same act. */
  supersededByClaimId?: ClaimId

  /* ------------------------------------- unresolved disagreement only */

  materiality?: DisagreementMateriality
  /** Derived from materiality. Present exactly when `materiality` is. */
  escalationRequired?: boolean
  /**
   * The highest materiality this claim was previously recorded at, when this
   * aggregation records a lower one.
   *
   * A manager may change their mind. A manager may not change their mind
   * invisibly to clear a gate, so the earlier judgement travels with the
   * later one and the explanation is required.
   */
  downgradedFrom?: DisagreementMateriality
}

/** What became of an available contribution the manager did not have to use. */
export type ContributionScope =
  | 'in-scope'
  | 'excluded-out-of-scope'
  | 'excluded-duplicate'
  | 'excluded-methodologically-incompatible'
  | 'excluded-other'

export const CONTRIBUTION_SCOPES: readonly ContributionScope[] = [
  'in-scope',
  'excluded-out-of-scope',
  'excluded-duplicate',
  'excluded-methodologically-incompatible',
  'excluded-other',
] as const

/**
 * Whether an optional perspective was there when the manager acted.
 *
 * Snapshotted rather than derived: read from the runs later it would change as
 * late contributions arrived, and the record would stop describing what the
 * manager actually had.
 */
export type OptionalInputAvailability =
  | 'received-and-used'
  | 'received-not-adopted'
  | 'failed'
  | 'timed-out'
  | 'cancelled'
  | 'superseded'
  | 'unavailable-at-aggregation'

export const OPTIONAL_INPUT_AVAILABILITIES: readonly OptionalInputAvailability[] = [
  'received-and-used',
  'received-not-adopted',
  'failed',
  'timed-out',
  'cancelled',
  'superseded',
  'unavailable-at-aggregation',
] as const

export interface OptionalInputRecord {
  playbookEntryKey: string
  availability: OptionalInputAvailability
  /** Present when a contribution actually exists. */
  runId?: string
  /** Present exactly when `runId` is: an available contribution says what became of it. */
  scope?: ContributionScope
  /** The manager's judgement. A relevant one may not be excluded. */
  materiallyRelevant: boolean
  /** Required for every exclusion. */
  explanation?: string
}

/** One contribution the manager considered. */
export interface AggregationInput {
  runId: string
  playbookEntryKey: string
  requirementLevel: 'required' | 'optional' | 'conditional'
}

/**
 * The record of one managerial synthesis.
 *
 * Immutable. A changed judgement is a new aggregation producing a new revision,
 * for the same reason a changed thesis is a new revision: the reviews and
 * decisions attached to the old one reviewed the old one.
 */
export interface ManagerAggregation {
  id: AggregationId
  caseId: CaseId
  thesisId: ThesisId
  /** The revision synthesised from. */
  sourceRevisionId: RevisionId
  /** The revision this produced. One aggregation, one revision. */
  producedRevisionId: RevisionId

  /**
   * Accountable, and deliberately not the run's employee or provider.
   *
   * Exactly one of these two, enforced by the database. A synthesis the
   * Research Office agent adopted is the agent's act, and attributing it to the
   * human Research Director would put a person's name on a position they never
   * read.
   */
  managerEmployeeId?: EmployeeId
  /** The institutional agent that adopted the synthesis, where one did. */
  managerAgentPrincipalId?: string
  departmentId: DepartmentId
  aggregatedAt: string

  /**
   * The persisted synthesis candidate this aggregation adopted.
   *
   * Absent for a directly authored synthesis: a human manager may state and
   * stand behind a position in one act, and no historical aggregation is given
   * a synthetic candidate to look like one that was adopted.
   *
   * Present for every agent synthesis, so the institution can prove
   * `model artifact → this exact persisted candidate → this exact institutional
   * position` by join. Matching prose is a coincidence that usually holds.
   */
  synthesisRunId?: string

  /** Why the synthesis reads as it does. Prose, and the only prose here. */
  rationale: string

  inputs: readonly AggregationInput[]
  dispositions: readonly ClaimDispositionRecord[]
  optionalInputs: readonly OptionalInputRecord[]
}

/* ------------------------------------------------------------ construction */

export interface AggregationClaimContext {
  claimId: ClaimId
  runId: string
  /** Set when the claim argues against this lineage. Cannot be adopted as support. */
  opposesThisThesis: boolean
}

/**
 * Builds an aggregation, refusing every shape that would lose work.
 *
 * Takes the claims in scope as context rather than reading them: the domain
 * decides what is admissible, and the application supplies what exists.
 */
export function buildManagerAggregation(
  aggregation: ManagerAggregation,
  context: {
    /** Every claim belonging to the declared input runs. */
    claimsInScope: readonly AggregationClaimContext[]
    /** Highest materiality previously recorded per claim, across this lineage. */
    priorMateriality?: Readonly<Record<ClaimId, DisagreementMateriality>>
  },
): ManagerAggregation {
  if (!aggregation.rationale.trim()) {
    throw new Error(
      `Aggregation "${aggregation.id}" states no rationale. A synthesis nobody ` +
        `explained cannot be reviewed, and the CIO would be choosing between ` +
        `conclusions with no account of how either was reached.`,
    )
  }
  if (aggregation.inputs.length === 0) {
    throw new Error(
      `Aggregation "${aggregation.id}" declares no input contributions. A ` +
        `synthesis of nothing is not a synthesis.`,
    )
  }
  /*
   * Exactly one accountable principal. Mirrors
   * `aggregations_one_accountable_principal` from migration 0040, so a record
   * the database would refuse does not reach it.
   */
  const accountable = [
    aggregation.managerEmployeeId,
    aggregation.managerAgentPrincipalId,
  ].filter((principal) => principal !== undefined).length
  if (accountable !== 1) {
    throw new Error(
      `Aggregation "${aggregation.id}" names ${accountable} accountable ` +
        `principals. A synthesis is stood behind by exactly one — the firm has ` +
        `to know who to ask.`,
    )
  }

  /* ------------------------------------------- exactly one disposition */

  const seen = new Set<ClaimId>()
  for (const record of aggregation.dispositions) {
    if (seen.has(record.claimId)) {
      throw new Error(
        `Aggregation "${aggregation.id}" dispositions claim "${record.claimId}" ` +
          `twice. One claim, one decision.`,
      )
    }
    seen.add(record.claimId)
  }

  const inScope = new Map(context.claimsInScope.map((claim) => [claim.claimId, claim]))

  const undispositioned = context.claimsInScope
    .filter((claim) => !seen.has(claim.claimId))
    .map((claim) => claim.claimId)
  if (undispositioned.length > 0) {
    throw new Error(
      `Aggregation "${aggregation.id}" leaves ${undispositioned.length} claim(s) ` +
        `in its declared scope with no disposition: ${undispositioned.join(', ')}. ` +
        `A claim the manager considered and did not answer for is a claim that ` +
        `disappeared.`,
    )
  }

  const adopted = new Set(
    aggregation.dispositions
      .filter((record) => record.disposition.startsWith('adopted-'))
      .map((record) => record.claimId),
  )

  /* --------------------------------------------------- per disposition */

  for (const record of aggregation.dispositions) {
    const claim = inScope.get(record.claimId)
    if (!claim) {
      throw new Error(
        `Aggregation "${aggregation.id}" dispositions claim "${record.claimId}", ` +
          `which is not in any declared input contribution.`,
      )
    }
    if (claim.runId !== record.runId) {
      throw new Error(
        `Claim "${record.claimId}" came from run "${claim.runId}", not from ` +
          `"${record.runId}".`,
      )
    }

    if (
      EXPLANATION_REQUIRED.includes(record.disposition) &&
      !record.explanation?.trim()
    ) {
      throw new Error(
        `Claim "${record.claimId}" is ${record.disposition} with no explanation. ` +
          `Work the manager set aside owes a reason the CIO can read.`,
      )
    }

    if (record.disposition === 'superseded-by-stronger-evidence') {
      if (!record.supersededByClaimId) {
        throw new Error(
          `Claim "${record.claimId}" is superseded by stronger evidence that is ` +
            `not named. "Something better exists" is not a finding.`,
        )
      }
      if (!adopted.has(record.supersededByClaimId)) {
        throw new Error(
          `Claim "${record.claimId}" is superseded by "${record.supersededByClaimId}", ` +
            `which this aggregation did not adopt. The stronger evidence has to ` +
            `be evidence the firm actually stands behind.`,
        )
      }
    } else if (record.supersededByClaimId) {
      throw new Error(
        `Claim "${record.claimId}" names superseding evidence but is ` +
          `${record.disposition}.`,
      )
    }

    /*
     * A manager may weigh a claim. A manager may not invert it: a claim its own
     * author filed against this thesis cannot be adopted as an argument for it.
     */
    if (claim.opposesThisThesis && record.disposition === 'adopted-supporting') {
      throw new Error(
        `Claim "${record.claimId}" argues against this thesis and cannot be ` +
          `adopted as supporting it. Adopt it as opposing, or say why it was ` +
          `set aside.`,
      )
    }

    /* ------------------------------------------ unresolved disagreement */

    if (record.disposition === 'retained-unresolved') {
      if (!record.materiality) {
        throw new Error(
          `Claim "${record.claimId}" is retained as an unresolved disagreement ` +
            `with no materiality. Whether a disagreement decides the answer or ` +
            `is a footnote is the fact the CIO needs.`,
        )
      }
      if (!record.explanation?.trim()) {
        throw new Error(
          `Unresolved disagreement on claim "${record.claimId}" states no ` +
            `rationale.`,
        )
      }
      if (
        record.escalationRequired !== disagreementRequiresEscalation(record.materiality)
      ) {
        throw new Error(
          `Claim "${record.claimId}" records an escalation requirement that does ` +
            `not follow from its materiality.`,
        )
      }

      const previous = context.priorMateriality?.[record.claimId]
      if (previous && isMaterialityDowngrade(previous, record.materiality)) {
        if (record.downgradedFrom !== previous) {
          throw new Error(
            `Claim "${record.claimId}" was previously ${previous} and is now ` +
              `${record.materiality}. A downgrade is recorded as one, with the ` +
              `level it came from — a gate cleared by quietly reclassifying the ` +
              `objection is a gate that was not cleared.`,
          )
        }
      } else if (record.downgradedFrom) {
        throw new Error(
          `Claim "${record.claimId}" records a downgrade from ` +
            `"${record.downgradedFrom}" that did not happen.`,
        )
      }
    } else if (record.materiality || record.escalationRequired) {
      throw new Error(
        `Claim "${record.claimId}" is ${record.disposition} and carries ` +
          `materiality. Materiality belongs to unresolved disagreement.`,
      )
    }
  }

  /* --------------------------------------------------- optional inputs */

  const optionalKeys = new Set<string>()
  for (const optional of aggregation.optionalInputs) {
    if (optionalKeys.has(optional.playbookEntryKey)) {
      throw new Error(
        `Aggregation "${aggregation.id}" accounts for optional input ` +
          `"${optional.playbookEntryKey}" twice.`,
      )
    }
    optionalKeys.add(optional.playbookEntryKey)

    const available = optional.runId !== undefined
    if (available !== (optional.scope !== undefined)) {
      throw new Error(
        `Optional input "${optional.playbookEntryKey}" ${
          available
            ? 'exists but says nothing about its scope'
            : 'has no run but names a scope'
        }.`,
      )
    }
    if (optional.scope && optional.scope !== 'in-scope') {
      if (!optional.explanation?.trim()) {
        throw new Error(
          `Optional contribution "${optional.playbookEntryKey}" was excluded ` +
            `from scope with no explanation.`,
        )
      }
      if (optional.materiallyRelevant) {
        throw new Error(
          `Optional contribution "${optional.playbookEntryKey}" is materially ` +
            `relevant and was excluded from scope. Scope selection is not a way ` +
            `to set aside work that bears on the thesis.`,
        )
      }
    }
  }

  return Object.freeze({
    ...aggregation,
    inputs: Object.freeze(aggregation.inputs.map((input) => Object.freeze({ ...input }))),
    dispositions: Object.freeze(
      [...aggregation.dispositions]
        .sort((a, b) => utf8ByteOrder(a.claimId, b.claimId))
        .map((record) => Object.freeze({ ...record })),
    ),
    optionalInputs: Object.freeze(
      [...aggregation.optionalInputs]
        .sort((a, b) => utf8ByteOrder(a.playbookEntryKey, b.playbookEntryKey))
        .map((record) => Object.freeze({ ...record })),
    ),
  })
}

/* ------------------------------------------------------------- projections */

/** The claims this aggregation puts on the revision, by relation. */
export function revisionClaimIds(aggregation: ManagerAggregation): {
  supporting: readonly ClaimId[]
  opposing: readonly ClaimId[]
} {
  const supporting: ClaimId[] = []
  const opposing: ClaimId[] = []
  for (const record of aggregation.dispositions) {
    if (record.disposition === 'adopted-supporting') supporting.push(record.claimId)
    // An unresolved disagreement stays attached as opposing. It is not an
    // exclusion, and the CIO must see it beside the argument it contests.
    if (record.disposition === 'adopted-opposing') opposing.push(record.claimId)
    if (record.disposition === 'retained-unresolved') opposing.push(record.claimId)
  }
  return { supporting, opposing }
}

/**
 * Unresolved disagreements that stop the revision reaching the CIO **under a
 * given policy threshold**.
 *
 * The threshold is required rather than defaulted. A default would be a second
 * place the firm's line is drawn, and callers would inherit it without noticing
 * -- which is how the stored `blocksEligibility` came to disagree with the
 * policy registry in the first place.
 */
export function blockingDisagreements(
  aggregation: ManagerAggregation,
  threshold: DisagreementMateriality,
): readonly ClaimDispositionRecord[] {
  return aggregation.dispositions.filter(
    (record) =>
      record.materiality !== undefined &&
      disagreementBlocksEligibility(record.materiality, threshold),
  )
}

/** Unresolved disagreements owed an escalation or an acknowledgement. */
export function escalatedDisagreements(
  aggregation: ManagerAggregation,
): readonly ClaimDispositionRecord[] {
  return aggregation.dispositions.filter((record) => record.escalationRequired === true)
}
