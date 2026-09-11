/**
 * Derived observations: institutional facts computed from other institutional
 * facts, and persisted so nothing computes them twice.
 *
 * A derived observation is an `ObservationRef` like any other. Three things make
 * it traceable rather than merely plausible (gate §0.5):
 *
 *   `sourceId: 'derived'`   trust tier 4, already defined in the provenance model
 *   `methodology`           the transformation id AND version — `spread-2s10s@1`
 *   payload `inputs`        the exact observation refs it was computed from
 *
 * The third is what turns "a number with a provenance story" into a number a
 * reader can re-derive. `methodology` is part of the natural KEY, so
 * `spread-2s10s@1` and `spread-2s10s@2` are two different observations rather
 * than one silently recomputed — the same rule that already keeps a par yield
 * and a fitted zero rate apart.
 *
 * ## Why this is a write and never a read
 *
 * Deriving inside `runReview`, a view model or a prompt would mean a claim cites
 * a value recomputed on every read: the cited content hash would drift and
 * `resolveCitation` would report `revised` for a value that never changed.
 * Content addressing forces the decision, and it forces it correctly.
 *
 * **One derivation per institutional fact.** The transformation runs here, once,
 * at assembly time. Every reader reads the stored result.
 *
 * ## The arithmetic is not defined here
 *
 * `curveSlopeBasisPoints` already existed in `domain/market/rates.ts` and is
 * reused rather than reimplemented, so there is exactly one definition of what
 * the slope IS. What this module adds is institutional: identity, provenance,
 * and the inputs.
 */

import {
  buildObservation,
  observationRef,
  type DurableObservation,
} from '~/domain/analysis'
import {
  buildYield,
  buildYieldCurve,
  curveSlopeBasisPoints,
  isoCurrency,
  type CanonicalSymbol,
  type Maturity,
} from '~/domain/market'
import { buildProvenance, effectiveTrust } from '~/domain/shared/provenance'
import type { CanonicalDecimal } from '~/domain/shared/canonicalValue'

/**
 * The transformation, named and versioned.
 *
 * The version is inside `methodology`, which is inside the natural key. Changing
 * how the slope is computed therefore mints different observations rather than
 * quietly restating the old ones — which is what makes "which rule produced this
 * number" answerable years later.
 */
export const SPREAD_2S10S = 'spread-2s10s@1'

/** Where a derived fact comes from. Trust tier 4, weaker than any real source. */
export const DERIVED_SOURCE_ID = 'derived'

/* ------------------------------------------------- the decimal boundary */

/**
 * Exact decimal subtraction, scaled to basis points.
 *
 * The institutional rule `spread-2s10s@1` binds (gate §0.3c):
 *
 *   decimal(10Y) − decimal(2Y), expressed in basis points
 *
 * so `4.1 − 3.9` is `0.2` percentage points and therefore **20 bp**, not the
 * `19.99999999999997` that `(4.1 - 3.9) * 100` produces in doubles.
 *
 * **Why not compute in doubles and round.** A rounding applied afterwards is a
 * second rule nobody stated, hiding the first — and it would have to choose a
 * precision, which lands inside the content hash. Working from the canonical
 * decimal strings the sources actually published means no precision is chosen
 * at all: the answer is exact, and it is exact for inputs of any scale.
 *
 * **Why not change `curveSlopeBasisPoints`.** Its financial formula is reused
 * verbatim — long minus short, times one hundred. What is not reused is its
 * arithmetic, because it is shared with the sentiment path and altering it
 * would change a behaviour C3 was never asked to touch. This is the smallest
 * boundary that makes the persisted fact exact.
 *
 * Integer arithmetic throughout: the two values are aligned to a common scale,
 * subtracted as integers, then shifted two places for percent → basis points.
 * `BigInt` rather than `number`, so a long decimal cannot silently exceed the
 * safe integer range on the way through.
 */
export function subtractToBasisPoints(long: string, short: string): CanonicalDecimal {
  const a = parseDecimal(long)
  const b = parseDecimal(short)
  const scale = Math.max(a.scale, b.scale)

  const lift = (parsed: { digits: bigint; scale: number }) =>
    parsed.digits * 10n ** BigInt(scale - parsed.scale)

  /* (long − short) in units of 10^-scale, then × 100 for basis points. */
  const differenceBp = (lift(a) - lift(b)) * 100n
  return formatDecimal(differenceBp, scale)
}

/** A canonical decimal string as digits and scale. Never lossy. */
function parseDecimal(value: string): { digits: bigint; scale: number } {
  const [whole, fraction = ''] = value.split('.')
  return {
    digits: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  }
}

/**
 * Integer digits and a scale back into a canonical decimal string.
 *
 * Trailing zeros are stripped and a bare integer keeps no decimal point,
 * because `CANONICAL_DECIMAL` refuses `20.0` and `20.` — one value must have
 * exactly one encoding, or the content hash would depend on how it was written.
 */
function formatDecimal(digits: bigint, scale: number): CanonicalDecimal {
  if (scale === 0) return String(digits) as CanonicalDecimal

  const negative = digits < 0n
  const text = (negative ? -digits : digits).toString().padStart(scale + 1, '0')
  const whole = text.slice(0, text.length - scale)
  const fraction = text.slice(text.length - scale).replace(/0+$/, '')
  const signed = `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
  /* `-0` is not a canonical decimal, and a zero slope is simply zero. */
  return (signed === '-0' ? '0' : signed) as CanonicalDecimal
}

/** A stored yield observation, plus the tenor the caller knows it to be. */
export interface SlopeLeg {
  observation: DurableObservation
  maturity: Extract<Maturity, '2Y' | '10Y'>
}

export interface DeriveSlopeInput {
  short: SlopeLeg
  long: SlopeLeg
  countryCode: string
  recordedAt: string
  correlationId: string
}

/** The stored payload of a yield observation, as ingestion writes it. */
interface StoredYield {
  yieldPercent: string
  observationDate: string
}

/**
 * The 2s10s curve slope, as a durable derived observation.
 *
 * Returns `null` when the two legs do not describe the same period. A slope
 * across two reference dates is not a slope — it mixes a move in the curve with
 * a move in time, and the resulting number would answer no question anyone
 * asked. `buildYieldCurve` refuses the same thing for the same reason.
 */
export function deriveCurveSlope(input: DeriveSlopeInput): DurableObservation | null {
  const short = input.short.observation
  const long = input.long.observation
  const shortValue = short.value as unknown as StoredYield
  const longValue = long.value as unknown as StoredYield

  const referencePeriod = short.ref.referencePeriod
  if (referencePeriod === undefined) return null
  if (long.ref.referencePeriod !== referencePeriod) return null
  if (shortValue.observationDate !== longValue.observationDate) return null

  const legs = [
    { leg: input.short, stored: shortValue },
    { leg: input.long, stored: longValue },
  ].map(({ leg, stored }) =>
    buildYield({
      symbol: leg.observation.ref.subject as CanonicalSymbol,
      countryCode: input.countryCode,
      currency: isoCurrency('USD'),
      maturity: leg.maturity,
      seriesId: leg.observation.ref.seriesId ?? '',
      methodology: 'par-yield',
      observationDate: stored.observationDate,
      yieldPercent: Number(stored.yieldPercent),
      provenance: leg.observation.provenance,
    }),
  )

  /*
   * The domain rule decides whether this pair IS a 2s10s slope at all — it
   * finds the 24-month and 120-month points and returns null otherwise. Reused
   * exactly as it stands, so there is one definition of the measure.
   *
   * Its NUMBER is not what gets persisted. See `subtractToBasisPoints` and
   * gate §0.3c: the stored fact is computed in exact decimal from the canonical
   * source values, because `(4.1 - 3.9) * 100` is 19.99999999999997 in doubles
   * and that is not the fact the Treasury published.
   */
  const admissible = curveSlopeBasisPoints(
    buildYieldCurve({
      countryCode: input.countryCode,
      points: legs,
      provenance: legs[0]!.provenance,
    }),
  )
  /* Needs exactly the 2Y and the 10Y. Anything else is not this measure. */
  if (admissible === null) return null

  const slopeBasisPoints = subtractToBasisPoints(
    longValue.yieldPercent,
    shortValue.yieldPercent,
  )

  /*
   * The inputs, inside the payload and therefore inside the content hash. A
   * derived value whose inputs could change without its hash changing would be
   * a fact nobody could re-derive — and `resolveCitation` would report it as
   * unrevised while it rested on different numbers.
   */
  const value = {
    slopeBasisPoints,
    observationDate: referencePeriod,
    inputs: [
      ['2y', short.ref.id, short.ref.contentHash],
      ['10y', long.ref.id, long.ref.contentHash],
    ],
  }

  const ref = observationRef(
    {
      subjectKind: 'series',
      subject: `curve:${input.countryCode.toLowerCase()}:2s10s`,
      kind: 'derived-spread',
      /* A derivation is published when its inputs were, not when we ran it. */
      observedAt: maxOf(short.ref.observedAt, long.ref.observedAt),
      referencePeriod,
      sourceId: DERIVED_SOURCE_ID,
      seriesId: '2s10s',
      methodology: SPREAD_2S10S,
    },
    value,
  )

  return buildObservation({
    ref,
    value,
    provenance: derivedProvenance(input, legs[0]!.provenance, legs[1]!.provenance),
    recordedAt: input.recordedAt,
    correlationId: input.correlationId,
  })
}

const maxOf = (a: string, b: string) => (a > b ? a : b)
const minOf = (a: string, b: string) => (a < b ? a : b)

/**
 * Provenance for a derived fact.
 *
 * `quality: 'derived'`, and the originator trust taken as the WEAKER of the two
 * inputs through `effectiveTrust` — a slope computed from one issuer series and
 * one aggregator series is aggregator-grade, and saying otherwise would launder
 * the weaker input's provenance through the arithmetic.
 *
 * `asOf` is the EARLIER of the two inputs. A derivation is never fresher than
 * its stalest input, which is the rule `MarketSentiment` already states for the
 * same reason.
 */
function derivedProvenance(
  input: DeriveSlopeInput,
  shortProvenance: { asOf: string; source: { trust?: string } },
  longProvenance: { asOf: string; source: { trust?: string } },
) {
  const shortTrust = (shortProvenance.source.trust ?? 'aggregator') as 'aggregator'
  const longTrust = (longProvenance.source.trust ?? 'aggregator') as 'aggregator'
  return buildProvenance({
    asOf: minOf(shortProvenance.asOf, longProvenance.asOf),
    nowMs: Date.parse(input.recordedAt),
    asOfPrecision: 'date',
    quality: 'derived',
    source: {
      providerId: DERIVED_SOURCE_ID,
      providerName: 'Financial OS — derived',
      trust: 'derived',
      originatorTrust: effectiveTrust(shortTrust, longTrust),
    },
  })
}

/* ------------------------------------------------- long-end curve and breakevens */

/**
 * The long-end slope. `spread-10s30s@1`.
 *
 * Same shape as `SPREAD_2S10S` and a different question. 2s10s is read for
 * monetary-policy and cycle information; the 10s30s segment sits beyond where
 * policy expectations dominate.
 *
 * **It is an observed curve relationship and nothing more.** It does not by
 * itself establish term-premium repricing, fiscal stress, or any other cause.
 * Those are interpretations, and interpretations belong in challengeable
 * analytical claims — not in the identity of an observation.
 */
export const SPREAD_10S30S = 'spread-10s30s@1'

/**
 * Market-implied inflation compensation. `breakeven-{tenor}@1`.
 *
 * The nominal par yield minus the par REAL yield at the same tenor and the
 * same reference date.
 *
 * ## What it is not
 *
 * **Not a forecast of CPI, and the domain must never call it "expected
 * inflation".** It is what the market charges to hold a nominal Treasury
 * rather than an inflation-linked one, which bundles expected inflation with
 * an inflation-risk premium and with the relative liquidity of the two
 * securities. Naming it as a forecast would turn a price into a prediction,
 * and every downstream claim would inherit that overstatement.
 *
 * The subject id says `inflation-compensation` for exactly this reason.
 */
export const BREAKEVEN_METHODOLOGY = (tenor: string) => `breakeven-${tenor}@1`

/** Tenors at which a breakeven exists. There is no 2Y: TIPS start at 5Y. */
export type BreakevenTenor = '5y' | '7y' | '10y' | '20y' | '30y'

export interface DeriveBreakevenInput {
  /** The nominal par yield leg. */
  nominal: DurableObservation
  /** The par REAL yield leg, at the same tenor and reference date. */
  real: DurableObservation
  tenor: BreakevenTenor
  countryCode: string
  recordedAt: string
  correlationId: string
  /**
   * Refuse fixture inputs. `true` in production.
   *
   * Arithmetic over an invented number produces an invented number, and a
   * derived observation carries no marker saying which of its inputs was real.
   * `MarketSentiment` degrades to `fixture` for the same reason; here the
   * derivation simply does not happen.
   */
  rejectFixtureInputs: boolean
}

/** Common gate for a two-leg derivation. `null` means: do not derive. */
function admissiblePair(
  a: DurableObservation,
  b: DurableObservation,
  rejectFixtureInputs: boolean,
): { referencePeriod: string; aValue: StoredYield; bValue: StoredYield } | null {
  const aValue = a.value as unknown as StoredYield
  const bValue = b.value as unknown as StoredYield

  /*
   * Same reference period, and same observation date inside the payload.
   * Both are checked because they are two different records of the same fact
   * and a disagreement between them means one of the legs is not what it
   * claims to be.
   *
   * Fails CLOSED. No nearest-date selection, no interpolation: a spread across
   * two reference dates mixes a move in the curve with a move in time, and the
   * result answers no question anyone asked.
   */
  const referencePeriod = a.ref.referencePeriod
  if (referencePeriod === undefined) return null
  if (b.ref.referencePeriod !== referencePeriod) return null
  if (aValue.observationDate !== bValue.observationDate) return null

  if (rejectFixtureInputs) {
    for (const observation of [a, b]) {
      if (observation.provenance.quality === 'fixture') return null
    }
  }
  return { referencePeriod, aValue, bValue }
}

/**
 * The 10s30s slope, as a durable derived observation.
 *
 * Deliberately does NOT reuse `curveSlopeBasisPoints`: that function finds the
 * 24-month and 120-month points by construction and is the single definition
 * of 2s10s. Widening it to take arbitrary tenors would change a measure this
 * work was not asked to touch. The admissibility rule here is the tenor pair
 * itself, checked against the legs the caller declared.
 */
export function deriveLongEndSlope(input: {
  ten: DurableObservation
  thirty: DurableObservation
  countryCode: string
  recordedAt: string
  correlationId: string
  rejectFixtureInputs: boolean
}): DurableObservation | null {
  const pair = admissiblePair(input.ten, input.thirty, input.rejectFixtureInputs)
  if (!pair) return null

  const slopeBasisPoints = subtractToBasisPoints(
    pair.bValue.yieldPercent,
    pair.aValue.yieldPercent,
  )

  const value = {
    slopeBasisPoints,
    observationDate: pair.referencePeriod,
    inputs: [
      ['10y', input.ten.ref.id, input.ten.ref.contentHash],
      ['30y', input.thirty.ref.id, input.thirty.ref.contentHash],
    ],
  }

  const ref = observationRef(
    {
      subjectKind: 'series',
      subject: `curve:${input.countryCode.toLowerCase()}:10s30s`,
      kind: 'derived-spread',
      observedAt: maxOf(input.ten.ref.observedAt, input.thirty.ref.observedAt),
      referencePeriod: pair.referencePeriod,
      sourceId: DERIVED_SOURCE_ID,
      seriesId: '10s30s',
      methodology: SPREAD_10S30S,
    },
    value,
  )

  return buildObservation({
    ref,
    value,
    provenance: composedProvenance(
      input.recordedAt,
      input.ten.provenance,
      input.thirty.provenance,
    ),
    recordedAt: input.recordedAt,
    correlationId: input.correlationId,
  })
}

/**
 * One breakeven, as a durable derived observation.
 *
 * `nominal − real`, in basis points, in exact decimal. The subtraction reuses
 * `subtractToBasisPoints` for the reason gate §0.3c gives: `(4.66 - 2.34) * 100`
 * in doubles is not the number the Treasury published.
 */
export function deriveBreakeven(input: DeriveBreakevenInput): DurableObservation | null {
  const pair = admissiblePair(input.nominal, input.real, input.rejectFixtureInputs)
  if (!pair) return null

  /*
   * The legs must actually BE the declared tenor.
   *
   * Without this the tenor is only the caller's word for it, and pairing a 10Y
   * nominal against a 5Y real passes every other check — both are Treasury
   * observations on the same reference date — while producing a number that is
   * not a breakeven at any tenor. Found by probing the derivation rather than
   * by reading it: the mis-paired call returned a plausible 232 bp.
   *
   * Checked against the subject, which carries the instrument identity, rather
   * than against a parameter the same caller supplied.
   */
  const nominalSubject = String(input.nominal.ref.subject)
  const realSubject = String(input.real.ref.subject)
  if (!nominalSubject.endsWith(`:us${input.tenor}`)) return null
  if (!realSubject.endsWith(`:us${input.tenor}-real`)) return null

  const breakevenBasisPoints = subtractToBasisPoints(
    pair.aValue.yieldPercent,
    pair.bValue.yieldPercent,
  )

  const value = {
    breakevenBasisPoints,
    observationDate: pair.referencePeriod,
    inputs: [
      ['nominal', input.nominal.ref.id, input.nominal.ref.contentHash],
      ['real', input.real.ref.id, input.real.ref.contentHash],
    ],
  }

  const ref = observationRef(
    {
      subjectKind: 'series',
      /*
       * `inflation-compensation`, never `expected-inflation`. See
       * `BREAKEVEN_METHODOLOGY`: this is a price, not a forecast.
       */
      subject: `rates:${input.countryCode.toLowerCase()}:inflation-compensation:${input.tenor}`,
      kind: 'derived-breakeven',
      observedAt: maxOf(input.nominal.ref.observedAt, input.real.ref.observedAt),
      referencePeriod: pair.referencePeriod,
      sourceId: DERIVED_SOURCE_ID,
      seriesId: `breakeven-${input.tenor}`,
      methodology: BREAKEVEN_METHODOLOGY(input.tenor),
    },
    value,
  )

  return buildObservation({
    ref,
    value,
    provenance: composedProvenance(
      input.recordedAt,
      input.nominal.provenance,
      input.real.provenance,
    ),
    recordedAt: input.recordedAt,
    correlationId: input.correlationId,
  })
}

/**
 * Provenance for a two-leg derivation, without a `DeriveSlopeInput`.
 *
 * Identical rules to `derivedProvenance`: `quality: 'derived'`, `asOf` the
 * EARLIER of the two inputs, and originator trust the WEAKER of the two
 * through `effectiveTrust`. Both Treasury curves are `issuer`, so a breakeven
 * composed from them stays issuer-grade — unusually strong for a derived
 * value, and true only because both legs come from the party that issues the
 * securities.
 */
function composedProvenance(
  recordedAt: string,
  a: { asOf: string; source: { trust?: string } },
  b: { asOf: string; source: { trust?: string } },
) {
  const aTrust = (a.source.trust ?? 'aggregator') as 'aggregator'
  const bTrust = (b.source.trust ?? 'aggregator') as 'aggregator'
  return buildProvenance({
    asOf: minOf(a.asOf, b.asOf),
    nowMs: Date.parse(recordedAt),
    /* Daily publications: the date is real, the time of day is not. */
    asOfPrecision: 'date',
    quality: 'derived',
    source: {
      providerId: DERIVED_SOURCE_ID,
      providerName: 'Financial OS — derived',
      trust: 'derived',
      originatorTrust: effectiveTrust(aTrust, bTrust),
    },
  })
}
