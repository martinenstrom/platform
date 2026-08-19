/**
 * The durable observation: one version of one fact, as the institution holds it.
 *
 * An observation used to exist only **inside** an evidence set — the same ECB
 * print used by two sets was stored twice, under two set ids, and no table was
 * keyed by the observation itself. Three things were impossible as a result: a
 * time series, a revision history, and any answer to *"what did the firm know
 * about this period, and when did it learn it?"*
 *
 * This record is the observation standing on its own. It is deliberately NOT an
 * evidence set, not a member of one, and not a step toward becoming one.
 * Acquiring an observation and declaring a body of evidence fit for analysis
 * are two different institutional acts (`phase-c3-evidence-gate.md` §0.3), and
 * this is the first one only.
 *
 * ## Three times, none of which is the others
 *
 * | | what it answers |
 * |---|---|
 * | `ref.referencePeriod` | what period the figure DESCRIBES — identity |
 * | `ref.observedAt` | when the source PUBLISHED this version — provenance |
 * | `recordedAt` | when the FIRM learned it — institutional knowledge time |
 *
 * The third is what makes the record bitemporal, and it is the one that cannot
 * be reconstructed later. Without it the firm can say what it believes now and
 * can never say what it believed in March — so a decision taken in March cannot
 * be judged against the evidence that actually existed when it was taken.
 *
 * ## Append-only, including revisions
 *
 * A revision does not replace anything. Same `ref.id`, different
 * `ref.contentHash`, a new record — so both versions stay readable and
 * `isRevisionOf` can say which is which. Nothing here overwrites a published
 * value, because a store that overwrote one could not answer the March
 * question either.
 *
 * **What is deliberately NOT tracked:** when a version was last re-retrieved
 * unchanged. Re-fetching a figure the source has not revised produces the same
 * `(id, contentHash)` and is a no-op — which is the idempotency the ingestion
 * act depends on. Recording a "last seen" would mean mutating a stored
 * observation on every poll, and this table is append-only for the same reason
 * the rest of the institution's records are.
 */

import { verifyObservationRef, type ObservationRef } from './identity'
import type { Provenance } from '~/domain/shared/provenance'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'

export interface DurableObservation {
  ref: ObservationRef
  /** The normalized domain value, canonical. Same contract as `EvidenceItem`. */
  value: CanonicalValue
  /** The source's own provenance: who, when, how trustworthy, how fresh. */
  provenance: Provenance
  /**
   * When the institution first learned this version. ISO 8601 with offset.
   *
   * **Never identity.** Two firms ingesting the same Treasury print on
   * different days hold one observation, learned at two moments. It is the
   * knowledge-time coordinate a bitemporal query reads, and nothing else.
   */
  recordedAt: string
  /**
   * The ingestion run that first recorded it. Traceability, never identity —
   * the same rule `EvidenceSet.correlationId` follows.
   *
   * A second run that re-retrieves an unchanged figure does not replace this:
   * it names the run that first brought the fact into the institution.
   */
  correlationId: string
}

/**
 * Builds a durable observation, refusing one that does not describe itself.
 *
 * The reference is verified against the value **before** the record can exist,
 * by the same projection `buildEvidenceSet` uses and under the reference's own
 * key generation. An observation store that accepted an unverified record would
 * be a store whose contents no citation could be checked against — and it would
 * accept it silently, which is worse than refusing loudly.
 */
export function buildObservation(observation: DurableObservation): DurableObservation {
  const mismatch = verifyObservationRef(observation.ref, observation.value)
  if (mismatch !== null) {
    throw new Error(
      `observation "${observation.ref.id}" of kind "${observation.ref.kind}" ` +
        `(v${observation.ref.keyGeneration}) is not admissible: ${mismatch}`,
    )
  }
  return Object.freeze({
    ...observation,
    ref: Object.freeze(observation.ref),
  })
}

/* ------------------------------------------------------------------ queries */

/**
 * A request for a series — which is a QUERY over individually citable
 * observations, never a stored aggregate.
 *
 * The distinction is load-bearing and was ruled before any of this was built
 * (gate §0.2). Every element this returns keeps its own `ObservationRef`, so a
 * claim cites *the March print*, not *the series*. Storing the series as one
 * array-valued observation would rehash the whole thing when one point was
 * revised, and `resolveCitation`'s `revised` verdict — the Fact Checker's
 * primitive — would degrade to noise.
 *
 * The natural-key prefix identifies the series: a series IS the set of
 * observations sharing everything except the reference period.
 */
export interface ObservationSeriesQuery {
  subject: string
  kind: ObservationRef['kind']
  sourceId: string
  seriesId?: string
  methodology?: string
  /** Inclusive lower bound on `referencePeriod`, compared as a string. */
  from: string
  /** Inclusive upper bound on `referencePeriod`. */
  to: string
  /**
   * Read the series as the institution knew it at this instant.
   *
   * Absent means **latest known**: for each reference period, the version the
   * firm holds now. Present means *what did we believe on this date* — records
   * learned later are excluded, so a decision can be judged against the
   * evidence that actually existed when it was taken rather than against
   * everything discovered since.
   *
   * This is the whole reason `recordedAt` is stored. A store without it can
   * only ever answer the first question.
   */
  knownAt?: string
}
