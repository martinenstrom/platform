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
import type { ThesisId } from './theses'

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
export type BlockerKind =
  | 'unresolved-challenge'
  | 'verification-correction-required'
  | 'verification-missing'
  | 'compliance-block'
  | 'risk-rejected'
  | 'unresolved-risk-escalation'
  | 'missing-required-contribution'
  | 'unresolved-citation'

export interface Blocker {
  kind: BlockerKind
  detail: string
  /** The department that must act. Lets the floor show whose queue it is in. */
  owningDepartmentId?: string
  /** Whether it stops the CIO seeing the thesis, or only publication. */
  severity: 'blocks-decision' | 'blocks-publication'
}

/** The inputs eligibility is computed from. Supplied by the application layer. */
export interface ThesisGateInputs {
  lifecycle: ThesisLifecycleState
  blockers: readonly Blocker[]
  /** Required playbook contributions that have not completed. */
  missingRequiredContributions: readonly string[]
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
  const blockers = [
    ...inputs.blockers,
    ...inputs.missingRequiredContributions.map((departmentId): Blocker => ({
      kind: 'missing-required-contribution',
      detail: `required contribution from ${departmentId} has not completed`,
      owningDepartmentId: departmentId,
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
