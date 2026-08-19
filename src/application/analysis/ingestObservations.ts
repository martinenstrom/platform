/**
 * Ingestion: acquiring an observation the institution did not have.
 *
 * The first of the two acts C3 separates, and **only** the first. This module
 * fetches from a source, normalizes, and records durable observations. It does
 * not select, does not assemble, does not judge, and produces no `EvidenceSet`.
 *
 * > external source acquisition → durable institutional observation
 *
 * is not
 *
 * > the institution selects observations → an EvidenceSet fit for analysis
 *
 * The second act is Stage B's, carries an actor and a mandate, and records the
 * selection rule it applied (`phase-c3-evidence-gate.md` §0.3). Nothing here
 * may grow into it: an ingestion that also decided what a desk should see would
 * put a machine in the seat where the firm's judgement belongs.
 *
 * ## Why this takes no actor and no mandate
 *
 * Deliberate, and ruled. Ingestion makes no claim — it records what a source
 * said. A scheduled poll issuing commands under a person's name would put an
 * auditable identity on an act nobody performed, which is the same rule C2-2
 * §8.4 states as *"the operator is the actor"*. What it carries instead is
 * **storage provenance**: which build, which adapter, which schema wrote the
 * row, exactly as every other institutional record carries.
 *
 * ## Idempotency
 *
 * The natural key plus the content hash **are** the idempotency key. Polling
 * the Treasury daily re-reads the same month page, so nearly every observation
 * offered is already held; the repository records what is new and reports the
 * rest as nothing. No token, no cursor, no watermark — a second mechanism would
 * be a second answer to a question the identity already settles, and the two
 * would eventually disagree.
 */

import { buildObservation, type DurableObservation } from '~/domain/analysis'
import { yieldRef } from './evidenceRefs'
import type { AnalysisRepositories } from './repositories'
import type { GovernmentYield } from '~/domain/market'
import { canonicalDecimalOrNull } from '~/domain/shared/canonicalValue'

/**
 * What one ingestion run did, in terms a person can act on.
 *
 * `alreadyHeld` is reported rather than inferred from the difference, because
 * "the source published nothing new" and "the source published nothing" are
 * different facts and a poll that silently returned zero for both would hide a
 * broken feed behind a normal-looking result.
 */
export interface IngestionReport {
  sourceId: string
  correlationId: string
  /** Observations the source offered, after normalization. */
  offered: number
  /** Newly recorded — facts the institution did not previously hold. */
  recorded: readonly DurableObservation[]
  /** Offered and already held. The normal outcome of a re-poll. */
  alreadyHeld: number
}

/**
 * A government yield, as a durable observation.
 *
 * `yieldRef` is reused rather than re-derived: it is the sanctioned bridge from
 * the market domain into observation identity, and it is what supplies the
 * reference period from `observationDate`. A second conversion here would be a
 * second answer to what a yield's identity is.
 *
 * The stored payload is the projection exactly — `yieldPercent`,
 * `changeBasisPoints`, `observationDate` — and not the whole `GovernmentYield`.
 * The wider object carries `receivedAt` and `ageMs`, which move on every fetch;
 * storing them would not change the content hash, which is computed over the
 * projection, but it would put values in the record that differ between two
 * ingests of the identical fact and mean nothing to a reader.
 */
export function yieldObservation(
  governmentYield: GovernmentYield,
  args: { recordedAt: string; correlationId: string },
): DurableObservation {
  return buildObservation({
    ref: yieldRef(governmentYield),
    value: {
      yieldPercent: canonicalDecimalOrNull(governmentYield.yieldPercent)!,
      changeBasisPoints: canonicalDecimalOrNull(governmentYield.changeBasisPoints),
      observationDate: governmentYield.observationDate,
    },
    provenance: governmentYield.provenance,
    recordedAt: args.recordedAt,
    correlationId: args.correlationId,
  })
}

export interface IngestYieldsInput {
  repositories: AnalysisRepositories
  /** Already fetched and normalized. This module performs no I/O. */
  yields: readonly GovernmentYield[]
  /** When the institution is learning these. Injected, never read from a clock. */
  recordedAt: string
  /** Names this ingestion run. Traceability, never identity. */
  correlationId: string
}

/**
 * Records what a source published, and reports what was new.
 *
 * Takes already-normalized domain values rather than a provider, so the act is
 * testable without a network and so the adapter boundary stays where the rest
 * of the architecture puts it. Composition — provider, then this — happens at
 * the infrastructure edge.
 */
export async function ingestYields(input: IngestYieldsInput): Promise<IngestionReport> {
  const { repositories, yields, recordedAt, correlationId } = input

  const observations = yields.map((governmentYield) =>
    yieldObservation(governmentYield, { recordedAt, correlationId }),
  )

  const provenance = await repositories.provenance()
  const recorded = await repositories.observations.record(observations, provenance)

  return {
    sourceId: yields[0]?.provenance.source.providerId ?? 'none',
    correlationId,
    offered: observations.length,
    recorded,
    alreadyHeld: observations.length - recorded.length,
  }
}
