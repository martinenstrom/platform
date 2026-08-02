/**
 * Thesis lifecycle, and the blockers that are deliberately NOT part of it.
 *
 * The correction this module exists to encode: **a governance challenge is an
 * orthogonal condition, not a workflow position.** An earlier draft made
 * `challenged` a lifecycle state, which meant a thesis could not be "under
 * analysis AND challenged", or "verified but blocked by an unresolved material
 * objection" — one dimension silently overwrote the other.
 *
 * So there are two axes:
 *
 *   LIFECYCLE   where the thesis is in its own progression. One value.
 *   BLOCKERS    what currently prevents it moving. Zero or more, derived from
 *               first-class review records rather than stored as a state.
 *
 * Eligibility is computed from both. A thesis reaching `verified` while a
 * material challenge is open is **not** eligible for the CIO, and the only way
 * to express that is to keep the two apart.
 */

import type { ClaimId } from './claims'
import type { RevisionId, ThesisId } from './theses'
import type { AssignmentId } from './work'
import type { DepartmentId } from './organization'
import type { EvidenceRef } from './identity'
import type { DisagreementMateriality } from './aggregation'
/*
 * Type-only, and therefore erased. `review.ts` imports values from here, so a
 * value import in this direction would be a runtime cycle; a verdict status is
 * a type and travels freely.
 */
import type { ComplianceStatus, VerificationStatus } from './review'

/* --------------------------------------------------------------- lifecycle */

/**
 * Where a thesis is in its own progression.
 *
 * `challenged` is absent on purpose — see the module note. `rejected` and
 * `not-selected` are both retained rather than collapsed: one means governance
 * stopped it, the other means it reached the CIO as a live alternative and
 * lost. An institution reviewing its own record needs to tell those apart.
 */
export type ThesisLifecycleState =
  | 'proposed'
  | 'under-analysis'
  | 'awaiting-verification'
  | 'verified'
  /** A gate stopped it: verification, risk, compliance or an open challenge. */
  | 'rejected'
  /** The proposing department pulled it. Not a governance outcome. */
  | 'withdrawn'
  /** A later revision replaced it. The thesis lives on; this version does not. */
  | 'superseded'
  /** The CIO chose it. At most one live revision per case. */
  | 'selected'
  /** Reached the CIO as an eligible alternative and was not chosen. */
  | 'not-selected'

const LIFECYCLE_TRANSITIONS: Readonly<
  Record<ThesisLifecycleState, readonly ThesisLifecycleState[]>
> = Object.freeze({
  proposed: ['under-analysis', 'withdrawn', 'superseded'],
  'under-analysis': ['awaiting-verification', 'rejected', 'withdrawn', 'superseded'],
  'awaiting-verification': [
    'verified',
    'under-analysis',
    'rejected',
    'withdrawn',
    'superseded',
  ],
  // A verified thesis can still be sent back, rejected outright, or replaced.
  verified: ['selected', 'not-selected', 'under-analysis', 'rejected', 'superseded'],
  rejected: ['superseded'],
  withdrawn: [],
  superseded: [],
  selected: ['superseded'],
  'not-selected': ['superseded'],
})

export function canTransitionThesis(
  from: ThesisLifecycleState,
  to: ThesisLifecycleState,
): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to)
}

/** States in which the thesis is still live work. */
export const ACTIVE_LIFECYCLE_STATES: readonly ThesisLifecycleState[] = [
  'proposed',
  'under-analysis',
  'awaiting-verification',
  'verified',
] as const

export function isActive(state: ThesisLifecycleState): boolean {
  return ACTIVE_LIFECYCLE_STATES.includes(state)
}

/**
 * A revision is sealed once it has left the desk that wrote it, or once
 * anything cites it.
 *
 * Sealed means "revise, do not edit". Editing a revision that a review or a
 * claim already points at would silently change what was reviewed or cited.
 */
export function isSealed(args: {
  lifecycle: ThesisLifecycleState
  citedByClaimIds: readonly ClaimId[]
}): boolean {
  const stillOnTheDesk =
    args.lifecycle === 'proposed' || args.lifecycle === 'under-analysis'
  return !stillOnTheDesk || args.citedByClaimIds.length > 0
}

/* ---------------------------------------------------------------- blockers */

/**
 * Why a thesis cannot progress right now.
 *
 * Derived from review records at evaluation time, never stored on the thesis.
 * Storing them would create two sources of truth that drift: a thesis marked
 * "unblocked" while an open challenge sits in the Devil's Advocate queue.
 */
export type BlockerKind = Blocker['kind']

/** Whether it stops the CIO seeing the thesis, or only publication. */
export type BlockerSeverity = 'blocks-decision' | 'blocks-publication'

interface BlockerBase {
  severity: BlockerSeverity
  /** The department that must act. Lets the floor show whose queue it is in. */
  owningDepartmentId?: DepartmentId
}

/**
 * Why a thesis cannot progress right now — structurally.
 *
 * A union rather than a `kind` beside a sentence, and that is the whole point.
 * The previous model carried `detail: string`, `evaluateGate` composed English
 * into it, and `blockerKindFor` recovered the category by matching sentence
 * prefixes. Renaming a message silently reclassified a blocker and nothing
 * failed — prose used as a data channel, in the layer that has spent three
 * phases removing exactly that.
 *
 * Each arm names the records it points at, so the floor can link to them and
 * the CIO can ask "which claim, whose queue, which review" without parsing
 * anything. Human-readable text is composed in the presentation layer from the
 * arm and its fields.
 */
export type Blocker =
  /* ------------------------------------------------------- verification */
  /** Never verified. Absence is a blocker, not a pass. */
  | (BlockerBase & { kind: 'verification-missing' })
  | (BlockerBase & {
      kind: 'verification-correction-required'
      reviewId: string
      status: VerificationStatus
      /** The claims whose findings block. Empty when the status alone blocks. */
      blockingClaimIds: readonly ClaimId[]
    })
  /** A finding the verifier could not resolve against a source. */
  | (BlockerBase & { kind: 'unresolved-citation'; reviewId: string; claimId: ClaimId })

  /* ---------------------------------------------------- devil's advocate */
  /**
   * An open challenge at `material` or above. Non-material open challenges are
   * recorded and visible and do not appear here — see `challengeBlocks`.
   */
  | (BlockerBase & {
      kind: 'unresolved-material-challenge'
      reviewId: string
      challengeId: string
      contests: ClaimId
      materiality: DisagreementMateriality
    })

  /* ------------------------------------------------------- aggregation */
  /**
   * A disagreement the manager could not resolve, at a level that decides the
   * answer. Distinct from an unresolved challenge, which is the Devil's
   * Advocate's formal objection: this one comes from two desks disagreeing and
   * a manager saying so rather than picking a side.
   */
  | (BlockerBase & { kind: 'decision-critical-disagreement'; claimId: ClaimId })

  /* -------------------------------------------------------------- risk */
  /** Nobody has decided whether Risk applies. No verdict can satisfy this. */
  | (BlockerBase & { kind: 'risk-requirement-unresolved'; playbookEntryKey: string })
  | (BlockerBase & { kind: 'risk-review-missing'; playbookEntryKey: string })
  | (BlockerBase & { kind: 'risk-review-rejected'; reviewId: string })
  /** A Risk verdict against a revision recorded as not needing one. */
  | (BlockerBase & { kind: 'risk-review-not-expected'; reviewId: string })

  /* -------------------------------------------------------------- work */
  | (BlockerBase & { kind: 'missing-required-contribution'; playbookEntryKey: string })
  | (BlockerBase & {
      kind: 'required-assignment-failed'
      playbookEntryKey: string
      assignmentId?: AssignmentId
    })

  /* ---------------------------------------------------------- evidence */
  | (BlockerBase & { kind: 'missing-evidence'; claimId: ClaimId; evidence?: EvidenceRef })
  | (BlockerBase & { kind: 'missing-provenance'; claimId: ClaimId })

  /* --------------------------------------------------------- lifecycle */
  | (BlockerBase & { kind: 'superseded-revision'; supersededBy: RevisionId })

  /* --------------------------------------------- publication (not C1C-4) */
  | (BlockerBase & {
      kind: 'compliance-block'
      reviewId: string
      status: ComplianceStatus
    })

/** Required work that has not arrived, as the domain needs to see it. */
export interface MissingWork {
  playbookEntryKey: string
  departmentId: DepartmentId
  /**
   * A run exists and failed, as opposed to work simply not being done.
   *
   * Two different institutional facts: a desk that tried and could not finish
   * needs a manager, and a desk that has not started needs a queue.
   */
  failed: boolean
}

/** The inputs eligibility is computed from. Supplied by the application layer. */
export interface ThesisGateInputs {
  lifecycle: ThesisLifecycleState
  blockers: readonly Blocker[]
  /** Required playbook contributions that have not completed. */
  missingRequiredContributions: readonly MissingWork[]
  /**
   * Claims the manager retained as decision-critical unresolved disagreement.
   *
   * Supplied by the application layer from the aggregation record, like
   * contribution state — the aggregation records what it found; eligibility is
   * decided here, in the one place that decides it.
   */
  blockingDisagreements?: readonly ClaimId[]
}

/**
 * What the runtime may do with this thesis right now.
 *
 * The four answers the amendment asked for, all computed rather than stored.
 */
export interface ThesisEligibility {
  thesisId: ThesisId
  revisionId: string
  lifecycle: ThesisLifecycleState
  /** May accept new contributions. */
  canProgress: boolean
  /** May be put in front of the CIO. */
  eligibleForDecision: boolean
  /** May be published, once selected. */
  eligibleForPublication: boolean
  blockedBy: readonly Blocker[]
}

export function evaluateThesisEligibility(
  thesisId: ThesisId,
  revisionId: string,
  inputs: ThesisGateInputs,
): ThesisEligibility {
  const blockers: Blocker[] = [
    ...inputs.blockers,
    ...inputs.missingRequiredContributions.map((missing): Blocker =>
      missing.failed
        ? {
            kind: 'required-assignment-failed',
            playbookEntryKey: missing.playbookEntryKey,
            owningDepartmentId: missing.departmentId,
            severity: 'blocks-decision',
          }
        : {
            kind: 'missing-required-contribution',
            playbookEntryKey: missing.playbookEntryKey,
            owningDepartmentId: missing.departmentId,
            severity: 'blocks-decision',
          },
    ),
    ...(inputs.blockingDisagreements ?? []).map((claimId): Blocker => ({
      kind: 'decision-critical-disagreement',
      claimId,
      severity: 'blocks-decision',
    })),
  ]

  const decisionBlockers = blockers.filter((b) => b.severity === 'blocks-decision')

  /*
   * The rule the amendment exists for: `verified` is necessary but not
   * sufficient. A thesis with a material unresolved challenge does not reach
   * the CIO however clean its lifecycle looks.
   */
  const eligibleForDecision =
    inputs.lifecycle === 'verified' && decisionBlockers.length === 0

  return {
    thesisId,
    revisionId,
    lifecycle: inputs.lifecycle,
    canProgress: isActive(inputs.lifecycle),
    eligibleForDecision,
    eligibleForPublication: inputs.lifecycle === 'selected' && blockers.length === 0,
    blockedBy: Object.freeze(blockers),
  }
}
