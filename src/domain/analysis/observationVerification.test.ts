/**
 * The corruption matrix for observation references.
 *
 * Two coordinates are recomputed from what is stored — the id from the natural
 * key, the content hash from the kind's projection — so an edit to either side
 * is caught. What must *not* be caught matters just as much: the projection is
 * narrower than the payload, and a refetch that moves `receivedAt` must not
 * read as a revision. Both directions are asserted here.
 *
 * The `unsupported-unverifiable-kind` cases are the fail-closed guarantee. A
 * kind present in the `ObservationKind` union but absent from the projection
 * table is not admissible evidence — declaring a kind is not deciding to store
 * it.
 */

import { describe, expect, it } from 'vitest'
import { observationContent, observationRef, verifyObservationRef } from './identity'
import { buildEvidenceSet } from './evidence'
import type { ObservationKind } from './identity'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'

const YIELD_KEY = {
  subjectKind: 'instrument' as const,
  subject: 'US10Y',
  kind: 'yield' as const,
  observedAt: '2026-07-28T00:00:00.000Z',
  referencePeriod: '2026-07-28',
  sourceId: 'treasury',
}

const YIELD_PAYLOAD = {
  yieldPercent: '4.69',
  changeBasisPoints: '-2',
  observationDate: '2026-07-28',
}

const QUOTE_KEY = { ...YIELD_KEY, kind: 'quote' as const }
const QUOTE_PAYLOAD = {
  value: '104.25',
  absoluteChange: '-0.75',
  percentageChange: '-0.71',
  previousClose: '105',
}

const POLICY_KEY = {
  subjectKind: 'central-bank' as const,
  subject: 'riksbank',
  kind: 'policy-state' as const,
  observedAt: '2026-07-28T00:00:00.000Z',
  referencePeriod: '2026-06-15',
  sourceId: 'riksbank',
}
const POLICY_REGIME = {
  level: { kind: 'single', ratePercent: '2.25' },
  effectiveDate: '2026-06-15',
  effectiveDateConfidence: 'exact',
  change: null,
}
const POLICY_PAYLOAD = { regime: POLICY_REGIME }

describe('valid observations are admitted', () => {
  it('accepts a yield with its own payload', () => {
    expect(
      verifyObservationRef(observationRef(YIELD_KEY, YIELD_PAYLOAD), YIELD_PAYLOAD),
    ).toBeNull()
  })

  it('accepts a quote with its own payload', () => {
    expect(
      verifyObservationRef(observationRef(QUOTE_KEY, QUOTE_PAYLOAD), QUOTE_PAYLOAD),
    ).toBeNull()
  })

  it('accepts a policy state, whose projection is nested under regime', () => {
    expect(
      verifyObservationRef(observationRef(POLICY_KEY, POLICY_REGIME), POLICY_PAYLOAD),
    ).toBeNull()
  })

  it('ignores object key order', () => {
    const reordered = {
      observationDate: '2026-07-28',
      yieldPercent: '4.69',
      changeBasisPoints: '-2',
    }
    expect(
      verifyObservationRef(observationRef(YIELD_KEY, YIELD_PAYLOAD), reordered),
    ).toBeNull()
  })
})

describe('the payload is wider than the projection, deliberately', () => {
  const withMetadata = {
    ...YIELD_PAYLOAD,
    receivedAt: '2026-07-28T09:15:33.123Z',
    ageMs: '555',
    sourcePrecision: '2',
  }

  it('accepts extra fields outside the projection', () => {
    expect(
      verifyObservationRef(observationRef(YIELD_KEY, YIELD_PAYLOAD), withMetadata),
    ).toBeNull()
  })

  it('reports no revision when only refetch metadata moved', () => {
    /*
     * The regression guard for the whole design. If someone widens the content
     * hash back to the full payload, this fails — and the system would report a
     * revision every time the same data was fetched twice.
     */
    const first = observationRef(
      YIELD_KEY,
      observationContent('yield', withMetadata) as CanonicalValue,
    )
    const later = observationRef(
      YIELD_KEY,
      observationContent('yield', {
        ...withMetadata,
        receivedAt: '2026-07-29T11:00:00.000Z',
        ageMs: '20',
      }) as CanonicalValue,
    )
    expect(later.contentHash).toBe(first.contentHash)
    expect(later.id).toBe(first.id)
  })

  it('changes the hash when a projected field moves', () => {
    const before = observationRef(YIELD_KEY, YIELD_PAYLOAD)
    const after = observationRef(YIELD_KEY, { ...YIELD_PAYLOAD, yieldPercent: '4.71' })
    expect(after.contentHash).not.toBe(before.contentHash)
    expect(after.id).toBe(before.id)
  })

  it('changes the id when a natural-key field moves', () => {
    const before = observationRef(YIELD_KEY, YIELD_PAYLOAD)
    const after = observationRef({ ...YIELD_KEY, sourceId: 'ecb' }, YIELD_PAYLOAD)
    expect(after.id).not.toBe(before.id)
  })
})

describe('projection integrity', () => {
  const ref = observationRef(YIELD_KEY, YIELD_PAYLOAD)

  const refused: Array<[string, Parameters<typeof verifyObservationRef>, string]> = [
    [
      'a projected value changed while the stored hash was not',
      [ref, { ...YIELD_PAYLOAD, yieldPercent: '9.99' }],
      'observation-content-hash-mismatch',
    ],
    [
      'the stored hash changed while the payload was not',
      [{ ...ref, contentHash: 'deadbeef' }, YIELD_PAYLOAD],
      'observation-content-hash-mismatch',
    ],
    [
      'the observation id changed',
      [{ ...ref, id: 'deadbeef' }, YIELD_PAYLOAD],
      'observation-id-mismatch',
    ],
    [
      'the declared kind changed while the payload did not',
      [{ ...ref, kind: 'quote' as ObservationKind }, YIELD_PAYLOAD],
      'observation-id-mismatch',
    ],
    [
      'a projected field was removed',
      [ref, { yieldPercent: '4.69', changeBasisPoints: '-2' }],
      'missing-projected-field',
    ],
    ['the payload is not an object', [ref, '4.69'], 'kind-payload-mismatch'],
    ['the payload is an array', [ref, ['4.69']], 'kind-payload-mismatch'],
  ]

  for (const [name, args, code] of refused) {
    it(`refuses ${name}`, () => {
      expect(verifyObservationRef(...args)).toBe(code)
    })
  }
})

describe('kind and payload must agree', () => {
  it('refuses a quote payload declared as a yield', () => {
    const ref = observationRef(YIELD_KEY, YIELD_PAYLOAD)
    expect(verifyObservationRef(ref, QUOTE_PAYLOAD)).toBe('missing-projected-field')
  })

  it('refuses a yield payload declared as a quote', () => {
    const ref = observationRef(QUOTE_KEY, QUOTE_PAYLOAD)
    expect(verifyObservationRef(ref, YIELD_PAYLOAD)).toBe('missing-projected-field')
  })

  it('refuses a policy-state payload declared as a quote', () => {
    const ref = observationRef(QUOTE_KEY, QUOTE_PAYLOAD)
    expect(verifyObservationRef(ref, POLICY_PAYLOAD)).toBe('missing-projected-field')
  })

  it('refuses a policy state whose regime is absent', () => {
    const ref = observationRef(POLICY_KEY, POLICY_REGIME)
    expect(verifyObservationRef(ref, { level: 'x' })).toBe('kind-payload-mismatch')
  })

  it('refuses a policy state missing a projected regime field', () => {
    const ref = observationRef(POLICY_KEY, POLICY_REGIME)
    const { change: _dropped, ...partial } = POLICY_REGIME
    expect(verifyObservationRef(ref, { regime: partial })).toBe('missing-projected-field')
  })
})

describe('unknown kinds fail closed', () => {
  /*
   * Nothing in the repository declares these as observations, and no builder
   * mints one. They are in the `ObservationKind` union and nothing else — which
   * is exactly the state that must not imply admissibility.
   */
  const undeclared: ObservationKind[] = ['fx-rate', 'series', 'news', 'sentiment']

  for (const kind of undeclared) {
    it(`refuses ${kind}, which has no projection`, () => {
      const ref = observationRef({ ...YIELD_KEY, kind }, YIELD_PAYLOAD)
      expect(verifyObservationRef(ref, YIELD_PAYLOAD)).toBe(
        'unsupported-unverifiable-kind',
      )
    })
  }

  it('refuses yield-curve, which has a ref builder but no evidence path', () => {
    /*
     * `yieldCurveRef` exists and has zero callers. A builder existing is not a
     * decision to store what it builds, so a yield-curve is refused as evidence
     * until an evidence path is deliberately added.
     */
    const ref = observationRef({ ...YIELD_KEY, kind: 'yield-curve' }, YIELD_PAYLOAD)
    expect(verifyObservationRef(ref, YIELD_PAYLOAD)).toBe('unsupported-unverifiable-kind')
  })

  it('does not rescue a malformed payload through the unverifiable path', () => {
    // The allow-list is for kinds without a projection, never for malformed
    // payloads of kinds that have one.
    const ref = observationRef(YIELD_KEY, YIELD_PAYLOAD)
    expect(verifyObservationRef(ref, { nonsense: true })).toBe('missing-projected-field')
  })
})

describe('an evidence set refuses a bad item outright', () => {
  const good = {
    ref: observationRef(YIELD_KEY, YIELD_PAYLOAD),
    value: YIELD_PAYLOAD,
    provenance: { source: { providerId: 'treasury' } } as never,
  }

  it('accepts a consistent set', () => {
    expect(
      buildEvidenceSet({ items: [good], assembledAt: 'x', correlationId: 'c' }).items,
    ).toHaveLength(1)
  })

  it('returns no partially trusted set when one item is bad', () => {
    /*
     * One bad item refuses the whole set. A set that dropped the item and
     * returned the rest would be attesting a membership nobody chose.
     */
    const bad = { ...good, value: { ...YIELD_PAYLOAD, yieldPercent: '0.01' } }
    expect(() =>
      buildEvidenceSet({ items: [good, bad], assembledAt: 'x', correlationId: 'c' }),
    ).toThrow(/not admissible/)
  })

  it('names the kind and the reason, and no payload', () => {
    const bad = { ...good, value: { ...YIELD_PAYLOAD, yieldPercent: '0.01' } }
    try {
      buildEvidenceSet({ items: [bad], assembledAt: 'x', correlationId: 'c' })
      expect.unreachable('should have refused')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('yield')
      expect(message).toContain('observation-content-hash-mismatch')
      // The error must not become a way to read evidence.
      expect(message).not.toContain('0.01')
      expect(message).not.toContain('4.69')
    }
  })
})
