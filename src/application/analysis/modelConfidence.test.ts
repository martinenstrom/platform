/**
 * What the firm does with a level a model proposed.
 *
 * The rule under test is one-directional: every path here must return the
 * proposal or something below it, and must never describe a bound the firm did
 * not derive. C3 Stage C adds the third derivable cap, and the risk it
 * introduces is not the level — the domain computes that — but the BASIS, because
 * `composeConfidence` writes "bounded by the weakest evidence" from a signal
 * this module passes as a neutral placeholder.
 */

import { describe, expect, it } from 'vitest'
import { observationRef, type EvidenceItem } from '~/domain/analysis'
import {
  buildProvenance,
  type Quality,
  type ProviderTrust,
} from '~/domain/shared/provenance'
import { resolveModelConfidence } from './modelConfidence'

const ASSEMBLED_AT = '2026-08-19T09:00:00.000Z'

function parYield(
  referencePeriod: string,
  { quality = 'official-daily' as Quality, trust = 'issuer' as ProviderTrust } = {},
): EvidenceItem {
  const value = {
    yieldPercent: '4.21',
    changeBasisPoints: null,
    observationDate: referencePeriod,
  }
  return {
    ref: observationRef(
      {
        subjectKind: 'instrument',
        subject: 'rate:us10y',
        kind: 'yield',
        observedAt: '2026-08-18T20:00:00.000Z',
        referencePeriod,
        sourceId: 'treasury',
        seriesId: 'BC_10YEAR',
        methodology: 'par-yield',
      },
      value,
    ),
    value,
    provenance: buildProvenance({
      asOf: '2026-08-18T20:00:00.000Z',
      nowMs: Date.parse(ASSEMBLED_AT),
      quality,
      source: {
        providerId: 'treasury',
        providerName: 'U.S. Department of the Treasury',
        trust,
      },
    }),
  }
}

const FRESH = parYield('2026-08-18')
const STALE = parYield('2026-08-01')

describe('a staleness cap the firm can now derive', () => {
  it('lowers a high proposal one step and names the rule that did it', () => {
    const resolved = resolveModelConfidence('high', 'observation', [STALE], ASSEMBLED_AT)
    expect(resolved.level).toBe('moderate')
    expect(resolved.cappedBy).toBe('stale-evidence')
  })

  it('lowers anything below high to low, as the domain rule states', () => {
    expect(
      resolveModelConfidence('moderate', 'observation', [STALE], ASSEMBLED_AT).level,
    ).toBe('low')
  })

  it('records the facts it capped on, not only the conclusion', () => {
    const basis = resolveModelConfidence(
      'high',
      'observation',
      [STALE],
      ASSEMBLED_AT,
    ).basis.join(' | ')
    expect(basis).toMatch(/2026-08-01/)
    expect(basis).toMatch(/18 days/)
    expect(basis).toMatch(/stale beyond 5 days/)
    // The proposal it started from, so the record shows what was lowered.
    expect(basis).toMatch(/proposed by the model \(high\)/)
  })

  it('never writes a bound the firm did not derive', () => {
    /*
     * The specific defect this branch exists to prevent. `composeConfidence`
     * composes the stale cap AFTER pushing "bounded by the weakest evidence
     * (high)" from the neutral value passed to it, and the firm has no
     * trust-to-level mapping that would make that sentence true.
     */
    const basis = resolveModelConfidence(
      'high',
      'observation',
      [STALE],
      ASSEMBLED_AT,
    ).basis.join(' | ')
    expect(basis).not.toMatch(/weakest evidence/)
  })

  it('leaves fresh evidence as the model proposed it, and says so', () => {
    const resolved = resolveModelConfidence('high', 'observation', [FRESH], ASSEMBLED_AT)
    expect(resolved.level).toBe('high')
    expect(resolved.cappedBy).toBeUndefined()
    expect(resolved.basis.join(' ')).toMatch(/not independently corroborated/)
  })

  it('does not judge a family the firm has stated no policy for', () => {
    /*
     * Same age, no stated methodology: unjudged, and therefore uncapped. An
     * undefined policy must not become a finding in either direction.
     */
    const unscoped: EvidenceItem = {
      ...STALE,
      ref: { ...STALE.ref, methodology: undefined },
    }
    const resolved = resolveModelConfidence(
      'high',
      'observation',
      [unscoped],
      ASSEMBLED_AT,
    )
    expect(resolved.level).toBe('high')
    expect(resolved.cappedBy).toBeUndefined()
  })
})

describe('the caps that came before still read as the domain wrote them', () => {
  it('keeps the domain basis intact for fixture evidence', () => {
    const fixture = parYield('2026-08-18', { quality: 'fixture', trust: 'synthetic' })
    const resolved = resolveModelConfidence(
      'high',
      'observation',
      [fixture],
      ASSEMBLED_AT,
    )
    expect(resolved.level).toBe('insufficient')
    expect(resolved.cappedBy).toBe('fixture-evidence')
    expect(resolved.basis).toEqual(['rests on fixture data'])
  })

  it('keeps the domain basis intact for a claim citing nothing', () => {
    const resolved = resolveModelConfidence('high', 'observation', [], ASSEMBLED_AT)
    expect(resolved.cappedBy).toBe('no-evidence')
    expect(resolved.basis).toEqual(['no evidence cited'])
  })

  it('caps on fixture evidence even when the same item is also stale', () => {
    // Order is the domain's; what matters is that the stronger cap still wins.
    const staleFixture = parYield('2026-08-01', {
      quality: 'fixture',
      trust: 'synthetic',
    })
    expect(
      resolveModelConfidence('high', 'observation', [staleFixture], ASSEMBLED_AT)
        .cappedBy,
    ).toBe('fixture-evidence')
  })
})

describe('confidence is reproducible from what was written down', () => {
  it('reads no clock, so a stored claim resolves the same way forever', () => {
    const first = resolveModelConfidence('high', 'observation', [STALE], ASSEMBLED_AT)
    const again = resolveModelConfidence('high', 'observation', [STALE], ASSEMBLED_AT)
    expect(again).toEqual(first)
  })

  it('is judged against the assembly, so a later assembly of the same figure differs', () => {
    const atAssembly = resolveModelConfidence(
      'high',
      'observation',
      [FRESH],
      '2026-08-19T09:00:00.000Z',
    )
    const muchLater = resolveModelConfidence(
      'high',
      'observation',
      [FRESH],
      '2026-09-19T09:00:00.000Z',
    )
    expect(atAssembly.cappedBy).toBeUndefined()
    expect(muchLater.cappedBy).toBe('stale-evidence')
  })
})
