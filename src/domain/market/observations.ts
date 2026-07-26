/**
 * Market observations — what an instrument *did*, at a point in time.
 *
 * Numeric throughout. No formatted strings, no locale, no colour, no chart
 * shapes: a `MarketQuote` is the same object whether it ends up in a tile, a
 * ticker, an agent prompt or a CSV export.
 */

import type { CanonicalSymbol } from './instruments'
import { changePercent, price, type Percent, type Price } from './primitives'
import type { Provenance } from './provenance'

/** Where an instrument's venue is in its trading day. */
export type SessionState = 'open' | 'closed' | 'pre-market' | 'after-hours' | 'unknown'

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
  provenance: Provenance
}

/**
 * Builds a quote, deriving both change figures from `value` and
 * `previousClose` so an adapter cannot report a change that disagrees with the
 * levels it also reported. Providers that supply their own change values are
 * deliberately ignored here — one derivation, one truth.
 */
export function buildQuote(args: {
  symbol: CanonicalSymbol
  value: number
  previousClose?: number | null
  dayHigh?: number | null
  dayLow?: number | null
  session?: SessionState
  provenance: Provenance
}): MarketQuote {
  const value = price(args.value)
  const previousClose =
    args.previousClose === null || args.previousClose === undefined
      ? null
      : price(args.previousClose)

  return {
    symbol: args.symbol,
    value,
    previousClose,
    absoluteChange: previousClose === null ? null : value - previousClose,
    percentageChange: changePercent(value, previousClose),
    dayHigh:
      args.dayHigh === null || args.dayHigh === undefined ? null : price(args.dayHigh),
    dayLow: args.dayLow === null || args.dayLow === undefined ? null : price(args.dayLow),
    session: args.session ?? 'unknown',
    provenance: args.provenance,
  }
}

/* -------------------------------------------------------------------- series */

export type SeriesInterval = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1mo'

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
