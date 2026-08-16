/**
 * What a live model's proposed confidence is allowed to become.
 *
 * **Model confidence is candidate metadata, not institutional judgment.** It
 * may lower confidence; it may never raise it above a level the firm can
 * justify from independently verifiable signals.
 *
 * So the effective confidence is the **lower** of the model's proposal and
 * every cap the firm can objectively derive — the same "minimum across
 * sources" shape the execution budget already resolves by, and for the same
 * reason: a source that can only lower cannot be defeated by ordering.
 *
 * ## Only two caps are derivable today, and that is stated rather than hidden
 *
 * `composeConfidence` defines seven rules. Their inputs do not all exist:
 *
 * | signal | derivable now? |
 * | --- | --- |
 * | `evidenceCount === 0` | **yes** — count the citations |
 * | `anyFixtureBacked` | **yes** — `isFixtureBacked`, already used by validation |
 * | `anyMissingProvenance` | not reachable — `EvidenceItem.provenance` is required, so a stored item always has it |
 * | `weakestEvidence` | **no** — no trust-to-level mapping exists in production |
 * | `anyStale` | **no** — the firm has no staleness policy |
 * | `conflictingEvidence` | **no** — no definition of conflict |
 * | `methodologyMismatch` | **no** — no definition of comparability |
 *
 * The four missing ones are recorded as **TD-75**. They are deliberately not
 * invented here, and the model is deliberately not asked to self-report them:
 * a signal the model supplied and the firm then treated as firm-derived would
 * be the model grading its own work through a longer route.
 *
 * ## What an uncapped result may and may not say
 *
 * When no derivable cap applies, the result carries the model's proposal **and
 * says so**. It must not read as though the firm independently confirmed the
 * level, because it did not — it confirmed only that the two caps it can
 * currently compute do not bite.
 *
 * The long-term direction is that institutional confidence becomes
 * increasingly firm-derived as those signals acquire policy definitions. C2-1
 * does not solve that, and does not pretend to.
 */

import {
  composeConfidence,
  type ClaimConfidence,
  type ClaimType,
  type ConfidenceLevel,
  type EvidenceItem,
} from '~/domain/analysis'
import { isFixtureBacked } from './contributionValidation'

/**
 * The caps whose inputs genuinely exist. Anything else `composeConfidence`
 * can produce is not derivable yet and must never be claimed.
 */
const DERIVABLE_CAPS = ['no-evidence', 'fixture-evidence'] as const

/**
 * Resolves one claim's confidence from the model's proposal and the evidence
 * it actually cited.
 *
 * `citedItems` are the resolved items behind the claim's citations, supporting
 * and contradicting alike — a claim resting on invented evidence is capped
 * whichever direction it cited it in.
 */
export function resolveModelConfidence(
  proposed: ConfidenceLevel,
  claimType: ClaimType,
  citedItems: readonly EvidenceItem[],
): ClaimConfidence {
  /*
   * `composeConfidence` is called rather than reimplemented, so the two caps
   * the firm can derive keep exactly one definition — their level, their
   * `cappedBy` and their basis wording all come from the domain.
   *
   * The signals it cannot derive are passed as the values that CANNOT lower
   * anything: `false` for each undefined boolean, and the model's own proposal
   * as `weakestEvidence`. That is not a claim that the evidence is as strong as
   * the model says — it is the neutral element, chosen so this function can
   * only ever return the proposal or something below it.
   */
  const composed = composeConfidence(
    {
      weakestEvidence: proposed,
      evidenceCount: citedItems.length,
      anyFixtureBacked: citedItems.some(isFixtureBacked),
      // Not reachable: provenance is required on a stored evidence item.
      anyMissingProvenance: false,
      // No institutional definition exists for any of these. TD-75.
      anyStale: false,
      conflictingEvidence: false,
      methodologyMismatch: false,
    },
    claimType,
  )

  /*
   * Taken only when the cap is one the firm actually computed. Any other
   * `cappedBy` would be `weakest-evidence`, whose basis reads "bounded by the
   * weakest evidence" — a sentence the firm has not earned, because it never
   * mapped evidence trust to a level. Recording it would be exactly the
   * misrepresentation this module exists to prevent.
   */
  if (
    composed.cappedBy &&
    (DERIVABLE_CAPS as readonly string[]).includes(composed.cappedBy)
  ) {
    return composed
  }

  return {
    level: proposed,
    /*
     * Honest about its own provenance. A reader — or a later capability
     * counting how much of the firm's confidence is model-asserted — can tell
     * this apart from a level the firm derived.
     */
    basis: Object.freeze([
      'proposed by the model',
      'no firm-derivable cap applies; the firm has not independently corroborated this level',
    ]),
  }
}
