/**
 * A period's move, from a series the platform actually holds.
 *
 * "Hur gick S&P 500 i veckan?" needs the level at the start of the week and
 * the level now — a daily series, not today's change. This module turns a
 * series into that move, and refuses everything that is not one: a fixture
 * standing in for a source, a series that does not reach back to the start
 * of the period, a period the platform has no series for. What it refuses
 * is named with its reason, so the answer can say exactly what is missing.
 *
 * ## Never the day for the week
 *
 * A quote's `percentageChange` covers the day (or a publication-to-
 * publication move). It is never read here as anything else: a period move
 * comes from two points of a series or it does not come at all.
 *
 * ## The port
 *
 * `MarketHistorySource` is the one door to a series. Infrastructure binds it
 * to the registry's `series` capability; where no live provider serves one
 * — the case on 2026-10-03, when the chart ranges are fixture-only — every
 * period is reported missing, honestly, and the moment a real series
 * provider exists the same questions light up without a change here.
 */

import {
  hasData,
  instrumentRef,
  type CanonicalSymbol,
  type Envelope,
  type MarketSeries,
  type Provenance,
  type Quality,
  type SeriesRange,
} from '~/domain/market'
import type { MarketPeriod } from './marketQuery'

export interface MarketHistorySource {
  /** A daily series for the symbol over the range, with its provenance; an error envelope when none is served. */
  series(symbol: CanonicalSymbol, range: SeriesRange): Promise<Envelope<MarketSeries>>
}

export interface SeriesPointRef {
  t: string
  v: number
}

export interface PeriodMove {
  symbol: CanonicalSymbol
  name: string
  /** `(to / from − 1) × 100`. */
  changePercent: number
  from: SeriesPointRef
  to: SeriesPointRef
  source: string
  quality: Quality
  /** When the series was observed, ISO 8601. */
  observedAt: string
  points: number
}

export type PeriodMissingReason =
  /** No history source is bound at all. */
  | 'no-history-source'
  /** The source served no series for the symbol. */
  | 'no-series'
  /** The only series is a fixture, which is never quoted as the market. */
  | 'fixture'
  /** The series does not reach back to the start of the period, or has too few points. */
  | 'insufficient-coverage'
  /** The platform has no series for this kind of period. */
  | 'unsupported-period'

export interface PeriodMissing {
  symbol: CanonicalSymbol
  name: string
  reason: PeriodMissingReason
}

export interface PeriodPerformance {
  moves: PeriodMove[]
  missing: PeriodMissing[]
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Weekends and holidays: the first observation may lie this far after the period's start. */
const START_TOLERANCE_MS = 4 * DAY_MS
const END_TOLERANCE_MS = 5 * DAY_MS
const MIN_POINTS = 2

export interface PeriodWindow {
  from: Date
  to: Date
  /** The range to fetch so the window is covered. */
  range: SeriesRange
}

/** The window a period covers at `now`, and the range that covers it; null for a period with no series. */
export function periodWindow(period: MarketPeriod, now: Date): PeriodWindow | null {
  switch (period.kind) {
    case 'today':
    case 'unsupported':
      return null
    case 'range': {
      const days = { '1w': 7, '1m': 31, '3m': 93, '1y': 366, ytd: 0 }[period.range]
      const from =
        period.range === 'ytd'
          ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
          : new Date(now.getTime() - days * DAY_MS)
      return { from, to: now, range: period.range }
    }
    case 'month': {
      const from = new Date(Date.UTC(period.year, period.month - 1, 1))
      const end = new Date(Date.UTC(period.year, period.month, 1))
      const to = end.getTime() < now.getTime() ? end : now
      if (from.getTime() > now.getTime()) return null
      const ageMs = now.getTime() - from.getTime()
      const range: SeriesRange | null =
        ageMs <= 93 * DAY_MS ? '3m' : ageMs <= 366 * DAY_MS ? '1y' : null
      return range ? { from, to, range } : null
    }
  }
}

const nameOf = (symbol: CanonicalSymbol): string => {
  try {
    return instrumentRef(symbol).displayName
  } catch {
    return symbol
  }
}

const real = (provenance: Provenance): boolean =>
  provenance.quality !== 'fixture' && provenance.source.providerId !== 'fixture'

/** The move over the window from a series, or the reason there is none. */
export function moveFromSeries(
  series: MarketSeries,
  window: PeriodWindow,
): { move: PeriodMove } | { reason: PeriodMissingReason } {
  if (!real(series.provenance)) return { reason: 'fixture' }
  const inside = series.points.filter((point) => {
    const t = new Date(point.t).getTime()
    return t >= window.from.getTime() && t <= window.to.getTime()
  })
  if (inside.length < MIN_POINTS) return { reason: 'insufficient-coverage' }
  const first = inside[0]!
  const last = inside[inside.length - 1]!
  if (new Date(first.t).getTime() > window.from.getTime() + START_TOLERANCE_MS)
    return { reason: 'insufficient-coverage' }
  if (new Date(last.t).getTime() < window.to.getTime() - END_TOLERANCE_MS)
    return { reason: 'insufficient-coverage' }
  if (!(first.v > 0)) return { reason: 'insufficient-coverage' }
  return {
    move: {
      symbol: series.symbol,
      name: nameOf(series.symbol),
      changePercent: (last.v / first.v - 1) * 100,
      from: { t: first.t, v: first.v },
      to: { t: last.t, v: last.v },
      source: series.provenance.source.providerName,
      quality: series.provenance.quality,
      observedAt: series.provenance.asOf,
      points: inside.length,
    },
  }
}

/**
 * The moves of the symbols over the period, and what could not be served.
 * One missing symbol never hides another's move.
 */
export async function periodPerformance(
  source: MarketHistorySource | null,
  symbols: readonly CanonicalSymbol[],
  period: MarketPeriod,
  now: Date,
): Promise<PeriodPerformance> {
  const window = periodWindow(period, now)
  if (!window) {
    return {
      moves: [],
      missing: symbols.map((symbol) => ({
        symbol,
        name: nameOf(symbol),
        reason: 'unsupported-period',
      })),
    }
  }
  if (!source) {
    return {
      moves: [],
      missing: symbols.map((symbol) => ({
        symbol,
        name: nameOf(symbol),
        reason: 'no-history-source',
      })),
    }
  }
  const moves: PeriodMove[] = []
  const missing: PeriodMissing[] = []
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return { symbol, envelope: await source.series(symbol, window.range) }
      } catch {
        return { symbol, envelope: null }
      }
    }),
  )
  for (const { symbol, envelope } of results) {
    if (!envelope || !hasData(envelope)) {
      missing.push({ symbol, name: nameOf(symbol), reason: 'no-series' })
      continue
    }
    if (envelope.state === 'fixture') {
      missing.push({ symbol, name: nameOf(symbol), reason: 'fixture' })
      continue
    }
    const outcome = moveFromSeries(envelope.data, window)
    if ('move' in outcome) moves.push(outcome.move)
    else missing.push({ symbol, name: nameOf(symbol), reason: outcome.reason })
  }
  return { moves, missing }
}
