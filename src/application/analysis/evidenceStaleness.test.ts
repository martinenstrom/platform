/**
 * The staleness policy, verified the way a load-bearing rule has to be: a
 * planted violation that fails it, and a near-miss that passes.
 *
 * The near-miss matters more than the violation here. A ceiling set one day
 * too tight would mark the newest figure a working Treasury has published as
 * stale after every long weekend, and a rule that fires on the normal case is
 * worse than no rule at all — it teaches a desk to ignore the flag.
 */

import { describe, expect, it } from 'vitest'
import {
  observationRef,
  observationRefV1,
  type EvidenceItem,
  type ObservationRef,
} from '~/domain/analysis'
import { buildProvenance } from '~/domain/shared/provenance'
import { judgeStaleness } from './evidenceStaleness'

const ASSEMBLED_AT = '2026-08-19T09:00:00.000Z'

/**
 * A publication instant that is NOT derived from the reference period.
 *
 * They are different coordinates — that separation is the whole of v2 — and a
 * fixture that computed one from the other could not express a quarterly
 * reference period at all.
 */
const PUBLISHED_AT = '2026-08-18T20:00:00.000Z'

const treasuryProvenance = () =>
  buildProvenance({
    asOf: PUBLISHED_AT,
    nowMs: Date.parse(ASSEMBLED_AT),
    quality: 'official-daily',
    source: {
      providerId: 'treasury',
      providerName: 'U.S. Department of the Treasury',
      trust: 'issuer',
    },
  })

/**
 * One sovereign yield as the store holds it.
 *
 * `methodology` is a parameter because it is the coordinate the policy is
 * keyed on — the tests below use it to walk in and out of scope without
 * changing anything else about the record. It is `string | null` rather than
 * an optional, so "the record states none" is passed explicitly and cannot be
 * confused with a default.
 */
function yieldItem(
  referencePeriod: string,
  methodology: string | null = 'par-yield',
  subject = 'rate:us10y',
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
        subject,
        kind: 'yield',
        observedAt: PUBLISHED_AT,
        referencePeriod,
        sourceId: 'treasury',
        seriesId: 'BC_10YEAR',
        ...(methodology === null ? {} : { methodology }),
      },
      value,
    ),
    value,
    provenance: treasuryProvenance(),
  }
}

/** The same yield as a v1 record: no reference period, by construction. */
function v1YieldItem(): EvidenceItem {
  const value = { yieldPercent: '4.21', changeBasisPoints: null }
  const ref: ObservationRef = observationRefV1(
    {
      subjectKind: 'instrument',
      subject: 'rate:us10y',
      kind: 'yield',
      observedAt: PUBLISHED_AT,
      sourceId: 'treasury',
      seriesId: 'BC_10YEAR',
      methodology: 'par-yield',
    },
    value,
  )
  return { ref, value, provenance: treasuryProvenance() }
}

/** The derived 2s10s, as `deriveCurveSlope` writes it into the set. */
function spreadItem(referencePeriod: string): EvidenceItem {
  const value = {
    slopeBasisPoints: '20',
    observationDate: referencePeriod,
    inputs: [
      ['2y', 'obs-2y', 'hash-2y'],
      ['10y', 'obs-10y', 'hash-10y'],
    ],
  }
  return {
    ref: observationRef(
      {
        subjectKind: 'series',
        subject: 'curve:us:2s10s',
        kind: 'derived-spread',
        observedAt: `${referencePeriod}T20:00:00.000Z`,
        referencePeriod,
        sourceId: 'derived',
        seriesId: '2s10s',
        methodology: 'spread-2s10s@1',
      },
      value,
    ),
    value,
    provenance: buildProvenance({
      asOf: `${referencePeriod}T20:00:00.000Z`,
      nowMs: Date.parse(ASSEMBLED_AT),
      quality: 'derived',
      source: {
        providerId: 'derived',
        providerName: 'Financial OS — derived',
        trust: 'derived',
        originatorTrust: 'issuer',
      },
    }),
  }
}

describe('the horizon, planted against and just missed', () => {
  it('calls a par yield stale one day past the ceiling', () => {
    // 2026-08-13 -> 2026-08-19 is six days, and the policy states five.
    const verdict = judgeStaleness([yieldItem('2026-08-13')], ASSEMBLED_AT)
    expect(verdict.judged).toBe(true)
    expect(verdict.stale).toBe(true)
    expect(verdict.ageDays).toBe(6)
    expect(verdict.maxAgeDays).toBe(5)
  })

  it('does not call it stale exactly at the ceiling', () => {
    const verdict = judgeStaleness([yieldItem('2026-08-14')], ASSEMBLED_AT)
    expect(verdict.judged).toBe(true)
    expect(verdict.stale).toBe(false)
    expect(verdict.ageDays).toBe(5)
  })

  it('leaves a long weekend alone, which is the case that must not fire', () => {
    // Friday's close read the following Monday: three days, and normal.
    const verdict = judgeStaleness([yieldItem('2026-08-14')], '2026-08-17T09:00:00.000Z')
    expect(verdict.stale).toBe(false)
    expect(verdict.ageDays).toBe(3)
  })
})

describe('history is not staleness', () => {
  /*
   * The discriminating pair for the sub-decision in the module header. Both
   * claims cite figures from three weeks ago; only one of them is resting on
   * an old read of the curve.
   */
  const window = [
    yieldItem('2026-07-27'),
    yieldItem('2026-08-03'),
    yieldItem('2026-08-10'),
    yieldItem('2026-08-18'),
  ]

  it('does not penalise a claim for citing the history it is about', () => {
    const verdict = judgeStaleness(window, ASSEMBLED_AT)
    expect(verdict.stale).toBe(false)
    expect(verdict.freshestReferencePeriod).toBe('2026-08-18')
  })

  it('does penalise a claim that cites only the old end of the same window', () => {
    const verdict = judgeStaleness(window.slice(0, 2), ASSEMBLED_AT)
    expect(verdict.stale).toBe(true)
    expect(verdict.freshestReferencePeriod).toBe('2026-08-03')
  })
})

describe('the derived spread is judged with its inputs', () => {
  it('caps a claim that cites only a stale 2s10s', () => {
    // Otherwise the derived fact is the way round a cap both its legs take.
    expect(judgeStaleness([spreadItem('2026-08-03')], ASSEMBLED_AT).stale).toBe(true)
  })

  it('leaves a fresh 2s10s alone', () => {
    expect(judgeStaleness([spreadItem('2026-08-18')], ASSEMBLED_AT).stale).toBe(false)
  })
})

describe('what the firm has stated no policy for is not judged', () => {
  it('refuses a family it has not ruled on rather than guessing a ceiling', () => {
    const verdict = judgeStaleness(
      [yieldItem('2026-01-02', 'inflation-swap-implied')],
      ASSEMBLED_AT,
    )
    expect(verdict.judged).toBe(false)
    expect(verdict.stale).toBe(false)
  })

  it('refuses an observation whose methodology the record does not state', () => {
    expect(judgeStaleness([yieldItem('2026-01-02', null)], ASSEMBLED_AT).judged).toBe(
      false,
    )
  })

  it('refuses a v1 observation, which carries no reference period at all', () => {
    // The publication instant is a different fact and is not substituted for it.
    expect(judgeStaleness([v1YieldItem()], ASSEMBLED_AT).judged).toBe(false)
  })

  it('refuses a reference period that is not a calendar date', () => {
    expect(judgeStaleness([yieldItem('2026-Q2')], ASSEMBLED_AT).judged).toBe(false)
  })

  it('judges the in-scope observations when a set mixes the two', () => {
    const verdict = judgeStaleness(
      [yieldItem('2026-Q2'), yieldItem('2026-08-18')],
      ASSEMBLED_AT,
    )
    expect(verdict.judged).toBe(true)
    expect(verdict.freshestReferencePeriod).toBe('2026-08-18')
  })

  it('reports nothing at all for a claim that cited nothing', () => {
    expect(judgeStaleness([], ASSEMBLED_AT).judged).toBe(false)
  })
})

describe('the verdict is reproducible', () => {
  it('reads no clock — the same claim resolves the same way forever', () => {
    const item = yieldItem('2026-08-13')
    const first = judgeStaleness([item], ASSEMBLED_AT)
    const later = judgeStaleness([item], ASSEMBLED_AT)
    expect(later).toEqual(first)
  })

  it('records the horizon it applied, so a later policy change cannot rewrite it', () => {
    expect(judgeStaleness([yieldItem('2026-08-13')], ASSEMBLED_AT).maxAgeDays).toBe(5)
  })
})
