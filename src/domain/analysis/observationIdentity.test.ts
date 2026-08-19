/**
 * The observation content boundary refuses what it cannot represent.
 *
 * `contentHash` is what `isRevisionOf` compares to decide whether an
 * observation was revised. Under the previous `unknown` signature every one of
 * `NaN`, `Infinity`, `-Infinity`, `undefined` and any `Date` canonicalized to
 * `null` — so **a value that went from missing to `NaN` read as unrevised**,
 * and a value that went from one date to another read as unchanged.
 *
 * The compile-time narrowing stops TypeScript callers. These tests cover the
 * other half: parsed JSON, provider payloads, unsafe casts and rows hydrated
 * from the database, none of which the type system sees. A bad value must fail
 * **before** a hash exists rather than become one that stands for two things.
 */

import { describe, expect, it } from 'vitest'
import { NotCanonicalError } from '~/domain/shared/canonicalValue'
import { isRevisionOf, observationRef, sameObservation } from './identity'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'

const KEY = {
  subjectKind: 'instrument' as const,
  subject: 'US10Y',
  kind: 'yield' as const,
  observedAt: '2026-07-28T00:00:00.000Z',
  /* v2's temporal coordinate. These tests are about CONTENT, so any stable
     period does; it is stated rather than defaulted because v2 has no default. */
  referencePeriod: '2026-07-28',
  sourceId: 'treasury',
}

/** What an unchecked caller would hand in: JSON, a cast, a hydrated row. */
const unchecked = (value: unknown) => observationRef(KEY, value as CanonicalValue)

describe('values the boundary accepts', () => {
  const accepted: Array<[string, CanonicalValue]> = [
    [
      'a decimal string, as the market boundary supplies',
      { yieldPercent: '4.69', changeBasisPoints: null, observationDate: '2026-07-28' },
    ],
    ['a safe integer', { tenorMonths: 120 }],
    ['a boolean', { provisional: true }],
    ['an explicit null', { changeBasisPoints: null }],
    ['a nested structure', { level: { kind: 'single', ratePercent: '2.25' } }],
    [
      'an array',
      {
        points: [
          ['2Y', '3.1'],
          ['10Y', '4.2'],
        ],
      },
    ],
    ['an empty object', {}],
  ]

  for (const [name, value] of accepted) {
    it(`accepts ${name}`, () => {
      expect(observationRef(KEY, value).contentHash).toMatch(/^[0-9a-f]+$/)
    })
  }

  it('gives one value one hash', () => {
    expect(
      observationRef(KEY, {
        yieldPercent: '4.69',
        changeBasisPoints: null,
        observationDate: '2026-07-28',
      }).contentHash,
    ).toBe(
      observationRef(KEY, {
        yieldPercent: '4.69',
        changeBasisPoints: null,
        observationDate: '2026-07-28',
      }).contentHash,
    )
  })

  it('does not depend on key order', () => {
    expect(observationRef(KEY, { a: '1', b: '2' }).contentHash).toBe(
      observationRef(KEY, { b: '2', a: '1' }).contentHash,
    )
  })
})

describe('values the boundary refuses', () => {
  class Instance {
    a = 1
  }
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic

  const refused: Array<[string, unknown]> = [
    ['NaN', { yieldPercent: Number.NaN }],
    ['Infinity', { yieldPercent: Number.POSITIVE_INFINITY }],
    ['-Infinity', { yieldPercent: Number.NEGATIVE_INFINITY }],
    ['a fractional number', { yieldPercent: 4.69 }],
    ['negative zero', { changeBasisPoints: -0 }],
    ['an unsafe integer', { count: 9007199254740993 }],
    ['undefined', { yieldPercent: undefined }],
    ['a Date', { observedAt: new Date('2026-01-01') }],
    ['a BigInt', { count: 1n }],
    ['a sparse array', { points: [1, , 3] }],
    ['a class instance', { level: new Instance() }],
    ['a cyclic object', cyclic],
  ]

  for (const [name, value] of refused) {
    it(`refuses ${name}`, () => {
      expect(() => unchecked(value)).toThrow(NotCanonicalError)
    })
  }

  it('fails before a hash exists', () => {
    /*
     * The ordering matters. A validator that ran after hashing would leave a
     * hash in a caller's hands, and the whole point is that a bad value never
     * acquires an identity at all.
     */
    for (const [name, value] of refused) {
      let produced: string | null = null
      try {
        produced = unchecked(value).contentHash
      } catch {
        produced = null
      }
      expect(produced, `${name} produced a content hash`).toBeNull()
    }
  })
})

describe('the revision defect this closes', () => {
  it('never gives a missing value and NaN the same hash', () => {
    /*
     * The exact regression. Under `canonicalJson` both rendered as `null`, so
     * `isRevisionOf` reported "not revised" for an observation that had gone
     * from absent to nonsense — and a Fact Checker watching for revisions saw
     * nothing.
     *
     * Now neither can produce a hash at all, so they cannot produce the same
     * one. The absent case is expressed as an explicit `null`, which is a value
     * the model does represent, and it is distinct from every other.
     */
    expect(() => unchecked({ yieldPercent: Number.NaN })).toThrow(NotCanonicalError)
    expect(() => unchecked({ yieldPercent: undefined })).toThrow(NotCanonicalError)

    const absent = observationRef(KEY, { yieldPercent: null })
    const present = observationRef(KEY, {
      yieldPercent: '4.69',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    expect(absent.contentHash).not.toBe(present.contentHash)
    expect(isRevisionOf(present, absent)).toBe(true)
  })

  it('still treats the same observation as the same observation', () => {
    // The identity comes from the natural key and is untouched by any of this:
    // `serializeKey` was already a fixed-field-order serializer.
    const a = observationRef(KEY, {
      yieldPercent: '4.69',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    const b = observationRef(KEY, {
      yieldPercent: '4.71',
      changeBasisPoints: null,
      observationDate: '2026-07-28',
    })
    expect(sameObservation(a, b)).toBe(true)
    expect(isRevisionOf(b, a)).toBe(true)
  })

  it('never gives two different dates the same hash', () => {
    // Every Date canonicalized to `{}`, so all of them collided. Dates arrive
    // as ISO strings now, which are distinct values.
    expect(() => unchecked({ at: new Date('2026-01-01') })).toThrow(NotCanonicalError)
    expect(observationRef(KEY, { at: '2026-01-01' }).contentHash).not.toBe(
      observationRef(KEY, { at: '2026-01-02' }).contentHash,
    )
  })
})
