/**
 * Market observations — what an instrument *did*, at a point in time.
 *
 * Numeric throughout. No formatted strings, no locale, no colour, no chart
 * shapes: a `MarketQuote` is the same object whether it ends up in a tile, a
 * ticker, an agent prompt or a CSV export.
 */

import type { CanonicalSymbol } from './instruments'
import { changePercent, percent, price, type Percent, type Price } from './primitives'
import type { Provenance } from './provenance'

/** Where an instrument's venue is in its trading day. */
export type SessionState = 'open' | 'closed' | 'pre-market' | 'after-hours' | 'unknown'

/**
 * The period a change figure actually covers.
 *
 * Stated explicitly rather than assumed, because the same `percentageChange`
 * field means different things per source: an index tick is intraday, while
 * two consecutive ECB reference rates are a publication-to-publication move
 * that must never be presented as intraday.
 *
 * A field is used rather than renaming `percentageChange` to `dailyChange`,
 * because `MarketQuote` is shared with genuinely intraday instruments where
 * `daily` would itself be the dishonest name.
 */
export type ChangePeriod =
  | 'intraday'
  | 'daily'
  | 'publication-to-publication'
  /** A rolling 24-hour window, as crypto aggregators report. */
  | 'rolling-24h'
  | 'unknown'

/**
 * Whether we computed the change or the provider stated it.
 *
 * Worth recording: a derived change is reproducible from `value` and
 * `previousClose`, while a provider-supplied one cannot be checked against
 * anything we hold. They are different epistemic objects and should not look
 * identical in the data.
 */
export type ChangeSource = 'derived' | 'provider'

export interface MarketQuote {
  symbol: CanonicalSymbol
  /** Current level or price, in the instrument's `unit`. */
  value: Price
  /** Prior official close. `null` when the provider does not supply one. */
  previousClose: Price | null
  /** `value - previousClose`, same unit. `null` when it cannot be derived. */
  absoluteChange: number | null
  /** `null` when it cannot be derived honestly — never a fabricated 0. */
  percentageChange: Percent | null
  dayHigh: Price | null
  dayLow: Price | null
  session: SessionState
  /** What period `absoluteChange` and `percentageChange` span. */
  changePeriod: ChangePeriod
  /** Whether the change was computed here or stated by the provider. */
  changeSource: ChangeSource | null
  /**
   * Decimals the upstream source itself determined, independently of anything
   * we asked for. Frankfurter is the case: the ECB published `9.717`, and
   * rendering `9,7170` would imply a digit it never gave.
   */
  sourcePrecision: number | null
  /**
   * Decimals produced because WE asked for them.
   *
   * Kept distinct from `sourcePrecision` on purpose: CoinGecko returns
   * whatever `precision=` we request, so calling that intrinsic source
   * precision would dress our own choice up as a property of the data.
   */
  requestedPrecision: number | null
  provenance: Provenance
}

/**
 * Builds a quote, deriving both change figures from `value` and
 * `previousClose` so an adapter cannot report a change that disagrees with the
 * levels it also reported. Providers that supply their own change values are
 * deliberately ignored here — one derivation, one truth.
 */
/** Decimals present in a number as the provider published it. */
export function decimalsOf(value: number): number {
  const text = String(value)
  const dot = text.indexOf('.')
  if (dot === -1 || text.includes('e') || text.includes('E')) return 0
  return text.length - dot - 1
}

/**
 * How far a provider's own two change figures may disagree, in percentage
 * points, before the quote is refused.
 *
 * Sized for rounding, not for error. Avanza publishes `change` and
 * `changePercent` each rounded to one or two decimals — 354.80 with a change
 * of 2.80 implies 0.7955%, and Avanza states 0.80% — so half-ulp rounding on
 * both fields contributes under 0.01pp. 0.05pp leaves room for a source that
 * rounds harder, while still catching the failure that matters: a change
 * figure left over from an earlier session against a freshly updated price.
 */
export const CHANGE_TOLERANCE_PP = 0.05

function assertChangesAgree(
  symbol: CanonicalSymbol,
  value: number,
  absoluteChange: number,
  percentageChange: number,
): void {
  const impliedPrevious = value - absoluteChange
  if (impliedPrevious === 0) {
    throw new Error(
      `buildQuote(${symbol}): absoluteChange implies a prior level of 0, ` +
        `against which no percentage change is defined`,
    )
  }
  const impliedPercent = (absoluteChange / Math.abs(impliedPrevious)) * 100
  const disagreement = Math.abs(impliedPercent - percentageChange)
  if (disagreement > CHANGE_TOLERANCE_PP) {
    throw new Error(
      `buildQuote(${symbol}): provider change figures disagree — ` +
        `absolute ${absoluteChange} against ${value} implies ` +
        `${impliedPercent.toFixed(4)}%, but the provider states ` +
        `${percentageChange}% (${disagreement.toFixed(4)}pp apart, ` +
        `tolerance ${CHANGE_TOLERANCE_PP}pp)`,
    )
  }
}

export function buildQuote(args: {
  symbol: CanonicalSymbol
  value: number
  /** Derives the change. Mutually exclusive with `percentageChange`. */
  previousClose?: number | null
  /**
   * Provider-authoritative change, for sources that report one without a
   * comparable prior close. Mutually exclusive with `previousClose`.
   */
  percentageChange?: number | null
  /**
   * Provider-authoritative ABSOLUTE change, for the sources that state both.
   * Only valid alongside `percentageChange`; the two are cross-checked against
   * each other by `CHANGE_TOLERANCE_PP`.
   *
   * This does not license inferring a `previousClose` from it. `value` minus
   * this figure is arithmetically a prior level, but whether that level is the
   * *official close* is a claim the provider has not made.
   */
  absoluteChange?: number | null
  dayHigh?: number | null
  dayLow?: number | null
  session?: SessionState
  changePeriod?: ChangePeriod
  sourcePrecision?: number | null
  requestedPrecision?: number | null
  provenance: Provenance
}): MarketQuote {
  const value = price(args.value)
  const hasPrevious = args.previousClose !== null && args.previousClose !== undefined
  const hasProvided =
    args.percentageChange !== null && args.percentageChange !== undefined

  // One change, one origin. Accepting both would mean holding two numbers that
  // can disagree, with nothing to say which is right.
  if (hasPrevious && hasProvided) {
    throw new Error(
      `buildQuote(${args.symbol}): supply previousClose OR percentageChange, not both`,
    )
  }

  const hasProvidedAbsolute =
    args.absoluteChange !== null && args.absoluteChange !== undefined

  if (hasProvidedAbsolute && !hasProvided) {
    throw new Error(
      `buildQuote(${args.symbol}): absoluteChange requires percentageChange — an ` +
        `unchecked absolute move is exactly what the cross-check exists to prevent`,
    )
  }
  if (hasProvidedAbsolute && hasPrevious) {
    throw new Error(
      `buildQuote(${args.symbol}): supply previousClose OR absoluteChange, not both`,
    )
  }

  const previousClose = hasPrevious ? price(args.previousClose as number) : null
  const derived = changePercent(value, previousClose)
  const provided = hasProvided ? percent(args.percentageChange as number) : null

  if (hasProvidedAbsolute) {
    assertChangesAgree(args.symbol, value, args.absoluteChange as number, provided ?? 0)
  }

  return {
    symbol: args.symbol,
    value,
    previousClose,
    // Derivable against a real prior close, or stated outright by a provider
    // that reports both figures. What is never done is reverse-engineering one
    // from the other: a provider that gives only a percentage gives us no
    // absolute move, and inventing one would invent a price it never published.
    absoluteChange: hasProvidedAbsolute
      ? (args.absoluteChange as number)
      : previousClose === null
        ? null
        : value - previousClose,
    percentageChange: provided ?? derived,
    dayHigh:
      args.dayHigh === null || args.dayHigh === undefined ? null : price(args.dayHigh),
    dayLow: args.dayLow === null || args.dayLow === undefined ? null : price(args.dayLow),
    session: args.session ?? 'unknown',
    changePeriod: args.changePeriod ?? 'unknown',
    changeSource: hasProvided ? 'provider' : previousClose === null ? null : 'derived',
    sourcePrecision: args.sourcePrecision ?? null,
    requestedPrecision: args.requestedPrecision ?? null,
    provenance: args.provenance,
  }
}

/* -------------------------------------------------------------------- series */

export type SeriesInterval = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1mo'

/**
 * Lookback window for a comparison series. Locale-neutral: the Overview's
 * Swedish button labels ('1D', '1V', '1M', '3M', '1Å', 'YTD') are a
 * presentation concern and map onto these in the view model.
 */
export type SeriesRange = '1d' | '1w' | '1m' | '3m' | '1y' | 'ytd'

export const SERIES_RANGES: readonly SeriesRange[] = [
  '1d',
  '1w',
  '1m',
  '3m',
  '1y',
  'ytd',
] as const

export interface SeriesPoint {
  /** ISO 8601 with offset. Absolute instants, never bare clock labels. */
  t: string
  /** Absolute value in the instrument's unit. Rebasing is presentation's job. */
  v: number
}

export interface MarketSeries {
  symbol: CanonicalSymbol
  interval: SeriesInterval
  /** Ascending by `t`. Enforced by `buildSeries`. */
  points: SeriesPoint[]
  provenance: Provenance
}

export function buildSeries(args: {
  symbol: CanonicalSymbol
  interval: SeriesInterval
  points: SeriesPoint[]
  provenance: Provenance
}): MarketSeries {
  const points = [...args.points].sort(
    (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
  )
  for (const point of points) {
    if (!Number.isFinite(point.v)) {
      throw new Error(`buildSeries: non-finite value at ${point.t} for ${args.symbol}`)
    }
    if (Number.isNaN(new Date(point.t).getTime())) {
      throw new Error(`buildSeries: invalid timestamp "${point.t}" for ${args.symbol}`)
    }
  }
  return {
    symbol: args.symbol,
    interval: args.interval,
    points,
    provenance: args.provenance,
  }
}

/**
 * Rebases a series to percent change from its first point — the shape the
 * Overview's comparison chart needs. Lives here rather than in the chart so
 * the transformation is testable and identical for every consumer.
 */
export function rebaseToPercent(
  series: MarketSeries,
): Array<{ t: string; v: Percent | null }> {
  const base = series.points[0]?.v
  if (base === undefined || base === 0) {
    return series.points.map((point) => ({ t: point.t, v: null }))
  }
  return series.points.map((point) => ({ t: point.t, v: changePercent(point.v, base) }))
}
