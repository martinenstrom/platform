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
 * ## Three caps are derivable, and the rest is stated rather than hidden
 *
 * `composeConfidence` defines seven rules. Their inputs do not all exist:
 *
 * | signal | derivable now? |
 * | --- | --- |
 * | `evidenceCount === 0` | **yes** — count the citations |
 * | `anyFixtureBacked` | **yes** — `isFixtureBacked`, already used by validation |
 * | `anyStale` | **yes, for sovereign yields only** — `judgeStaleness`, C3 Stage C |
 * | `anyMissingProvenance` | not reachable — `EvidenceItem.provenance` is required, so a stored item always has it |
 * | `weakestEvidence` | **no** — no trust-to-level mapping exists in production |
 * | `conflictingEvidence` | **no** — no definition of conflict |
 * | `methodologyMismatch` | **no** — no definition of comparability |
 *
 * `anyStale` moved from the second block to the first when the firm stated a
 * staleness policy for sovereign yields, and for **no other family**: outside
 * that scope `judgeStaleness` reports itself unable to judge, which passes the
 * signal as `false` — the value that cannot lower anything — rather than as a
 * finding. The remaining three are recorded as **TD-75**. They are deliberately
 * not invented here, and the model is deliberately not asked to self-report
 * them: a signal the model supplied and the firm then treated as firm-derived
 * would be the model grading its own work through a longer route.
 *
 * ## Why a cap the domain composed is not always returned as the domain wrote it
 *
 * Two of the derivable caps — `no-evidence` and `fixture-evidence` — make
 * `composeConfidence` return **early**, with a basis composed entirely of
 * things the firm derived. Those are returned untouched.
 *
 * `stale-evidence` is applied in the composer's later section, after it has
 * already written `bounded by the weakest evidence (…)` into the basis from the
 * neutral value this module passed it. That sentence is not true: the firm
 * never mapped evidence trust to a level, which is exactly why the neutral
 * value was passed. So for a late cap the LEVEL and the CAP come from the
 * domain — the rule stays in one place — and the basis is written here, from
 * the domain's own words for the cap that bit plus the facts this module
 * actually derived. What is never done is letting an un-earned sentence stand
 * in the record because it arrived attached to an earned one.
 *
 * ## What an uncapped result may and may not say
 *
 * When no derivable cap applies, the result carries the model's proposal **and
 * says so**. It must not read as though the firm independently confirmed the
 * level, because it did not — it confirmed only that the caps it can currently
 * compute do not bite.
 *
 * The long-term direction is that institutional confidence becomes
 * increasingly firm-derived as those signals acquire policy definitions. One
 * of the four now has one; three do not, and this does not pretend otherwise.
 */

import {
  composeConfidence,
  STALE_EVIDENCE_BASIS,
  type ClaimConfidence,
  type ClaimType,
  type ConfidenceCap,
  type ConfidenceLevel,
  type EvidenceItem,
} from '~/domain/analysis'
import { isFixtureBacked } from './contributionValidation'
import { judgeStaleness, stalenessBasis } from './evidenceStaleness'

/**
 * Caps whose basis the domain writes in full, because it returns before ever
 * describing a signal this module passed as neutral.
 */
const EARLY_CAPS: readonly ConfidenceCap[] = ['no-evidence', 'fixture-evidence']

/**
 * Caps the domain composes alongside the neutral signals, so their basis has
 * to be restated here. See the module header.
 */
const LATE_CAPS: readonly ConfidenceCap[] = ['stale-evidence']

/**
 * The caps whose inputs genuinely exist. Anything else `composeConfidence`
 * can produce is not derivable yet and must never be claimed.
 */
const DERIVABLE_CAPS: readonly ConfidenceCap[] = [...EARLY_CAPS, ...LATE_CAPS]

/**
 * Resolves one claim's confidence from the model's proposal and the evidence
 * it actually cited.
 *
 * `citedItems` are the resolved items behind the claim's citations, supporting
 * and contradicting alike — a claim resting on invented evidence is capped
 * whichever direction it cited it in.
 *
 * `assembledAt` is the instant the firm declared the evidence fit, and it is
 * what staleness is measured against. Passed in rather than read from a clock
 * so the same stored claim resolves to the same confidence forever.
 */
export function resolveModelConfidence(
  proposed: ConfidenceLevel,
  claimType: ClaimType,
  citedItems: readonly EvidenceItem[],
  assembledAt: string,
): ClaimConfidence {
  const staleness = judgeStaleness(citedItems, assembledAt)

  /*
   * `composeConfidence` is called rather than reimplemented, so the caps the
   * firm can derive keep exactly one definition — their level, their `cappedBy`
   * and, where it is earned, their basis wording all come from the domain.
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
      /*
       * Derived for sovereign yields and nothing else. Outside that scope
       * `judged` is false and this is `false` — the neutral value — because a
       * family the firm has stated no policy for has not been found fresh
       * either.
       */
      anyStale: staleness.stale,
      // No institutional definition exists for either of these. TD-75.
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
  if (composed.cappedBy && DERIVABLE_CAPS.includes(composed.cappedBy)) {
    /* The domain wrote the whole basis; nothing here improves on it. */
    if (EARLY_CAPS.includes(composed.cappedBy)) return composed

    return {
      // The domain decided how far a stale reading lowers a claim; it still does.
      level: composed.level,
      cappedBy: composed.cappedBy,
      basis: Object.freeze([
        `proposed by the model (${proposed})`,
        // The domain's own words for the rule that bit, not a second wording.
        STALE_EVIDENCE_BASIS,
        stalenessBasis(staleness),
      ]),
    }
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
