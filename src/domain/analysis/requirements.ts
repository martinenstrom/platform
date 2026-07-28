/**
 * Conditional workflow requirements, and their resolution.
 *
 * A playbook can say that a stage is **conditionally** required — Risk Review
 * is needed when the thesis implies the firm might act, and not needed for
 * purely descriptive analysis. That declaration is static and belongs to the
 * immutable playbook entry. Whether the condition actually held for a specific
 * argument is a different fact, and this file is about that second fact.
 *
 * ## Why the resolution is stored rather than recomputed
 *
 * The tempting design is to evaluate the condition whenever the headquarters
 * loads: read the current thesis, apply the current rule, show whether Risk is
 * required. It is also wrong, in three separate ways.
 *
 *   - The thesis changes. A revision that adds position sizing would
 *     retroactively make Risk "always required", including for the period when
 *     it demonstrably was not.
 *   - The rule changes. Tightening it next year would rewrite why Risk was not
 *     required last year, and the record would no longer explain the decision
 *     the CIO actually made.
 *   - Nothing would be accountable. A recomputed value has no evaluator, no
 *     time and no reason, so "who decided Risk could be skipped" has no answer.
 *
 * So a resolution is an institutional fact: scoped to an **exact revision**,
 * naming the **exact rule version**, recording who evaluated it, when, and why.
 *
 * ## `not-required` is recorded, never inferred
 *
 * Absence means *not yet evaluated*. An explicit `not-required` row means the
 * firm looked and decided. Collapsing those two would make "Risk was skipped"
 * indistinguishable from "Risk was forgotten", which is precisely the
 * distinction a governance record exists to preserve.
 *
 * A later revision has no row, so it is unresolved — which is how a new
 * argument reopens the gate without anyone having to remember to.
 */

import type { CaseId } from './cases'
import type { ActorSnapshot } from './authority'
import type { InvestmentImplication, RevisionId } from './theses'

/**
 * How much a playbook entry is needed.
 *
 * Three states, because the approved Macro workflow has three. A boolean plus
 * a second flag would let the two disagree; one closed union cannot.
 */
export type RequirementLevel = 'required' | 'optional' | 'conditional'

export const REQUIREMENT_LEVELS: readonly RequirementLevel[] = [
  'required',
  'optional',
  'conditional',
] as const

/* --------------------------------------------------------------- the rule */

/** Everything a conditional rule is allowed to look at. */
export interface RequirementRuleInput {
  /** Declared on the revision, never inferred from its prose. */
  implications: readonly InvestmentImplication[]
}

export interface RequirementRuleOutcome {
  required: boolean
  /**
   * Why, in terms of the inputs.
   *
   * Deterministic: the same inputs produce the same sentence, so a stored
   * reason can be compared against a re-evaluation rather than merely read.
   */
  reason: string
}

/**
 * A named, versioned, deterministic condition.
 *
 * `ruleId` and `ruleVersion` are stored on every resolution, so improving a
 * rule means publishing a new version beside the old one. The old version is
 * never removed, because resolutions recorded under it must remain
 * explainable.
 */
export interface ConditionalRequirementRule {
  ruleId: string
  ruleVersion: string
  /** Pure. No clock, no organization lookup, no provider call. */
  evaluate(input: RequirementRuleInput): RequirementRuleOutcome
}

/**
 * Risk Review is required when acting on the thesis is on the table.
 *
 * The institutional reading: Risk exists to size, hedge and constrain
 * positions. An argument that recommends nothing, allocates nothing and moves
 * nothing gives Risk nothing to review, and requiring a verdict on it would
 * make the verdict ceremonial. The moment the thesis carries any
 * implementation implication — even "this could later lead to a position" —
 * Risk is required.
 *
 * The rule reads the revision's **declared** implications. It cannot read the
 * statement, so a contributor cannot make Risk go away by rephrasing, and an
 * agent cannot silently decide its own work needs no risk review: the
 * declaration is a structured field on the revision, recorded under the
 * command that created it and visible to the manager who aggregates it.
 */
export const RISK_REVIEW_WHEN_IMPLEMENTABLE: ConditionalRequirementRule = Object.freeze({
  ruleId: 'risk-review-when-implementable',
  ruleVersion: '1',
  evaluate({ implications }: RequirementRuleInput): RequirementRuleOutcome {
    const declared = [...implications].sort((a, b) => a.localeCompare(b))
    if (declared.length === 0) {
      return {
        required: false,
        reason:
          'The revision declares no investment-implementation implications. ' +
          'It is descriptive analysis, so Risk Review has no position, size ' +
          'or exposure to assess.',
      }
    }
    return {
      required: true,
      reason:
        `The revision declares implementation implications ` +
        `(${declared.join(', ')}), so the firm could act on it and Risk ` +
        `Review must assess the exposure that would create.`,
    }
  },
})

/**
 * Every rule the runtime knows, keyed by identity **and version**.
 *
 * A resolution recorded under a version no longer present is a loud lookup
 * failure rather than a silent re-evaluation under whatever replaced it.
 */
const RULES: ReadonlyMap<string, ConditionalRequirementRule> = new Map([
  [ruleKey(RISK_REVIEW_WHEN_IMPLEMENTABLE), RISK_REVIEW_WHEN_IMPLEMENTABLE],
])

export function ruleKey(rule: { ruleId: string; ruleVersion: string }): string {
  return `${rule.ruleId}@${rule.ruleVersion}`
}

export class UnknownRequirementRuleError extends Error {
  constructor(
    readonly ruleId: string,
    readonly ruleVersion: string,
  ) {
    super(
      `No conditional requirement rule "${ruleId}" at version "${ruleVersion}". ` +
        `Rule versions are never removed — a resolution recorded under one must ` +
        `stay explainable.`,
    )
    this.name = 'UnknownRequirementRuleError'
  }
}

export function requirementRule(reference: {
  ruleId: string
  ruleVersion: string
}): ConditionalRequirementRule {
  const rule = RULES.get(ruleKey(reference))
  if (!rule) {
    throw new UnknownRequirementRuleError(reference.ruleId, reference.ruleVersion)
  }
  return rule
}

export function knownRequirementRules(): readonly ConditionalRequirementRule[] {
  return [...RULES.values()]
}

/* --------------------------------------------------------- the resolution */

/** The evaluated states. `unresolved` is derived from absence, never stored. */
export type ResolvedRequirementState = 'required' | 'not-required'

/**
 * A recorded evaluation of one conditional entry against one exact revision.
 *
 * Write-once. Deterministic rules cannot legitimately produce two answers for
 * the same `(entry, revision, rule version)`, so a second write with a
 * different outcome is a real disagreement and fails rather than overwriting.
 */
export interface RequirementResolution {
  caseId: CaseId
  playbookEntryKey: string
  /**
   * The exact revision this speaks to.
   *
   * Not the lineage. A resolution against revision 2 says nothing about
   * revision 3, in the same way a Verification verdict does not carry forward.
   */
  revisionId: RevisionId
  state: ResolvedRequirementState
  ruleId: string
  ruleVersion: string
  reason: string
  evaluatedAt: string
  /** Snapshotted, for the same reason command actors are. */
  evaluatedBy: ActorSnapshot
}

/** What the runtime knows about one conditional entry right now. */
export type RequirementStatus =
  /** Declared conditional; not yet evaluated for this revision. */
  | { state: 'unresolved'; playbookEntryKey: string; revisionId: RevisionId | null }
  | ({ state: ResolvedRequirementState } & RequirementResolution)

export function buildRequirementResolution(
  resolution: RequirementResolution,
): RequirementResolution {
  if (!resolution.reason.trim()) {
    throw new Error(
      `Resolution of "${resolution.playbookEntryKey}" for revision ` +
        `"${resolution.revisionId}" records no reason. A gate that was opened ` +
        `or skipped without a stated reason cannot be reviewed.`,
    )
  }
  if (resolution.evaluatedBy.kind !== 'employee') {
    throw new Error(
      `Resolution of "${resolution.playbookEntryKey}" was evaluated by a system ` +
        `actor. Whether a governance gate applies is an institutional judgement ` +
        `and an employee is accountable for it.`,
    )
  }
  return Object.freeze({ ...resolution })
}

/**
 * The status of a conditional entry for one exact revision.
 *
 * **Absence resolves to `unresolved`, never to `not-required`.** That is the
 * whole reason resolutions are stored, so it is stated here rather than left
 * to each caller's `?? false`.
 */
export function requirementStatusFor(
  playbookEntryKey: string,
  revisionId: RevisionId | null,
  resolutions: readonly RequirementResolution[],
): RequirementStatus {
  if (!revisionId) return { state: 'unresolved', playbookEntryKey, revisionId: null }

  const match = resolutions.find(
    (resolution) =>
      resolution.playbookEntryKey === playbookEntryKey &&
      resolution.revisionId === revisionId,
  )
  if (!match) return { state: 'unresolved', playbookEntryKey, revisionId }
  return { ...match, state: match.state }
}

/**
 * Applies a rule to a revision's declared implications.
 *
 * The only place a resolution is produced, so the recorded `ruleId`,
 * `ruleVersion` and `reason` cannot drift from the rule that actually ran.
 */
export function evaluateRequirement(
  rule: ConditionalRequirementRule,
  input: {
    caseId: CaseId
    playbookEntryKey: string
    revisionId: RevisionId
    implications: readonly InvestmentImplication[]
    evaluatedAt: string
    evaluatedBy: ActorSnapshot
  },
): RequirementResolution {
  const outcome = rule.evaluate({ implications: input.implications })
  return buildRequirementResolution({
    caseId: input.caseId,
    playbookEntryKey: input.playbookEntryKey,
    revisionId: input.revisionId,
    state: outcome.required ? 'required' : 'not-required',
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    reason: outcome.reason,
    evaluatedAt: input.evaluatedAt,
    evaluatedBy: input.evaluatedBy,
  })
}
