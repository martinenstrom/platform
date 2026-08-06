/**
 * The frozen identity corpus: one entry per production identity surface.
 *
 * **Migration accounting, not backward compatibility.** TD-61 changed the
 * encoding deliberately, so every identity here except the observation *id*
 * changed. The corpus does not claim the old hashes still hold — it records
 * that every valid production input has an explicit new representation, that no
 * caller was dropped, and that the new values are what this build actually
 * produces.
 *
 * ## The rule that makes it worth anything
 *
 * `expectedCanonical` and `expectedHash` are **literals reviewed in source
 * control**. No test may derive them: a test that computes its own expectation
 * asserts only that the code agrees with itself, which is the failure mode this
 * corpus exists to prevent. The runner executes the corpus; it never generates
 * it.
 *
 * A change to any encoding fails here with a visible diff, and updating a
 * literal is then a deliberate act with a version coordinate attached.
 */

import { buildEvidenceSet, observationRef } from '~/domain/analysis'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'

export interface CorpusEntry {
  name: string
  /** The production site this shape belongs to. */
  caller: string
  /** How this input was written before TD-61, where it differed. */
  previously: string
  /** Why the identity changed, or why it did not. */
  reason: string
  /** Which version coordinate governs the change. */
  governedBy:
    'DOMAIN_CONTRACT_VERSION' | 'PAYLOAD_CANONICALIZATION_VERSION' | 'none — unchanged'
  /** The canonical encoding, pinned. */
  expectedCanonical: string
  /** The identity derived from it, pinned. */
  expectedHash: string
  /** Produces the identity from live production code. */
  run: () => { canonical: string; hash: string }
}

const OBSERVATION_KEY = {
  subjectKind: 'instrument' as const,
  subject: 'US10Y',
  kind: 'yield' as const,
  observedAt: '2026-07-28T00:00:00.000Z',
  sourceId: 'treasury',
}

/** A market observation as `evidenceRefs` now supplies it: decimals as strings. */
export const MARKET_QUOTE_CONTENT: CanonicalValue = {
  value: '104.25',
  absoluteChange: '-0.75',
  percentageChange: '-0.71',
  previousClose: '105',
}

export const YIELD_CONTENT: CanonicalValue = {
  yieldPercent: '4.69',
  changeBasisPoints: '-2',
  observationDate: '2026-07-28',
}

/** Nested and structured, with every rate an exact decimal string. */
export const POLICY_STATE_CONTENT: CanonicalValue = {
  level: { kind: 'target-range', lowerPercent: '5.25', upperPercent: '5.5' },
  effectiveDate: '2026-06-15',
  effectiveDateConfidence: 'exact',
  change: null,
}

export const evidenceItemsFor = () => [
  {
    ref: observationRef(OBSERVATION_KEY, YIELD_CONTENT),
    value: YIELD_CONTENT,
    provenance: { source: { providerId: 'treasury' }, quality: 'ok' } as never,
  },
  {
    ref: observationRef(
      { ...OBSERVATION_KEY, subject: 'DE10Y', sourceId: 'bundesbank' },
      MARKET_QUOTE_CONTENT,
    ),
    value: MARKET_QUOTE_CONTENT,
    provenance: { source: { providerId: 'bundesbank' }, quality: 'ok' } as never,
  },
]

export const buildCorpusEvidenceSet = () =>
  buildEvidenceSet({
    items: evidenceItemsFor(),
    assembledAt: '2026-07-28T09:00:00.000Z',
    correlationId: 'corr-1',
  })
