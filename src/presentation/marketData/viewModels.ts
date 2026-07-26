/**
 * Presentation boundary for market data.
 *
 * The ONLY module that turns a domain number into a display string. The domain
 * is numeric and locale-free; everything sv-SE happens here, composing the
 * existing `~/lib/format` primitives so the Overview keeps formatting exactly
 * as the rest of the app does.
 *
 * If a component ever needs `formatNumber` directly again, that is a signal a
 * view model is missing — not a licence to format in the component.
 */

import {
  hasData,
  instrumentRef,
  rebaseToPercent,
  type CanonicalSymbol,
  type Envelope,
  type GovernmentYield,
  type MarketQuote,
  type MarketSeries,
  type NewsItem,
  type YieldCurve,
  type SeriesRange,
} from '~/domain/market'
import { formatNumber, formatPercent, formatRelativeTime } from '~/lib/format'

/* ----------------------------------------------------------------- helpers */

/** Data from any envelope that carries it, or `[]`/`null` when it does not. */
export function dataOr<T>(envelope: Envelope<T>, fallback: T): T {
  return hasData(envelope) ? envelope.data : fallback
}

/* ------------------------------------------------------------------ quotes */

export interface QuoteViewModel {
  id: string
  label: string
  /** Formatted to the instrument's own precision. */
  value: string
  changePercent: number
}

export function toQuoteViewModel(quote: MarketQuote): QuoteViewModel {
  const ref = instrumentRef(quote.symbol)
  return {
    id: quote.symbol,
    label: ref.displayName,
    value: formatNumber(quote.value, ref.precision),
    changePercent: quote.percentageChange ?? 0,
  }
}

/** "Aktuella marknader" rows carry a leading glyph the domain has no opinion on. */
const ROW_ICONS: Record<string, string> = {
  'fx:usdsek': '🇺🇸',
  'fx:eurusd': '🇪🇺',
  'cmd:brent': '🛢️',
  'cmd:gold': '🥇',
  'crypto:btc': '₿',
}

/** Display names for the rows that the Overview labels its own way. */
const ROW_LABELS: Record<string, string> = {
  'cmd:brent': 'Brent Olja',
  'cmd:gold': 'Guld (USD/oz)',
  'crypto:btc': 'Bitcoin (USD)',
}

export interface MarketRowViewModel extends QuoteViewModel {
  icon: string
}

export function toMarketRowViewModel(quote: MarketQuote): MarketRowViewModel {
  const base = toQuoteViewModel(quote)
  return {
    ...base,
    label: ROW_LABELS[quote.symbol] ?? base.label,
    icon: ROW_ICONS[quote.symbol] ?? '',
  }
}

/* ------------------------------------------------------------------ yields */

export interface YieldViewModel {
  label: string
  value: string
  /** Basis-point change, e.g. "+0,01 bp" or "−0,04 bp". */
  change: string
  negative: boolean
}

/**
 * Formats a basis-point move. Uses the same sign convention as
 * `formatPercent` — U+2212 for negatives, an explicit `+` otherwise — so the
 * rates column matches every other signed figure on the screen.
 */
function formatBasisPoints(value: number): string {
  const magnitude = formatNumber(Math.abs(value), 2)
  const sign = value > 0 ? '+' : value < 0 ? '−' : '+'
  return `${sign}${magnitude} bp`
}

export function toYieldViewModel(governmentYield: GovernmentYield): YieldViewModel {
  const ref = instrumentRef(governmentYield.symbol)
  const change = governmentYield.changeBasisPoints ?? 0
  return {
    label: ref.displayName,
    value: `${formatNumber(governmentYield.yieldPercent, 2)}%`,
    change: formatBasisPoints(change),
    negative: change < 0,
  }
}

/* ------------------------------------------------------------------ series */

/** Curve preview values: the yield of each tenor, ascending. */
export function toYieldCurveValues(curve: YieldCurve | undefined): number[] {
  return curve?.points.map((point) => point.yieldPercent) ?? []
}

/** Sparkline input: the bare numbers the `Sparkline` component expects. */
export function toSparklineValues(series: MarketSeries | undefined): number[] {
  return series?.points.map((point) => point.v) ?? []
}

export interface IntradayRow {
  time: string
  [seriesId: string]: number | string
}

/** Hour labels for the intraday axis, one per four 15-minute points. */
const INTRADAY_HOURS = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
]

/**
 * Recharts rows for the comparison chart.
 *
 * The axis is still labelled from the point index rather than from each
 * point's timestamp — that is defect D4, and fixing it needs real
 * range-aware series, which arrive in Phase 6. Phase 0 reproduces the current
 * behaviour rather than half-fixing it.
 */
export function toIntradayRows(series: MarketSeries[]): IntradayRow[] {
  const length = series[0]?.points.length ?? 0
  return Array.from({ length }, (_, i) => {
    const row: IntradayRow = { time: i % 4 === 0 ? (INTRADAY_HOURS[i / 4] ?? '') : '' }
    for (const entry of series) row[entry.symbol] = entry.points[i]?.v ?? 0
    return row
  })
}

/** Percent-rebased rows, for when the chart shows relative performance. */
export function toRebasedRows(series: MarketSeries[]): IntradayRow[] {
  const rebased = series.map((entry) => ({
    symbol: entry.symbol,
    points: rebaseToPercent(entry),
  }))
  const length = rebased[0]?.points.length ?? 0
  return Array.from({ length }, (_, i) => {
    const row: IntradayRow = { time: i % 4 === 0 ? (INTRADAY_HOURS[i / 4] ?? '') : '' }
    for (const entry of rebased) row[entry.symbol] = entry.points[i]?.v ?? 0
    return row
  })
}

/* -------------------------------------------------------------------- news */

export interface NewsViewModel {
  id: string
  headline: string
  /** "Riksbanken · för 42 minuter sedan" is assembled by the component. */
  outlet: string
  relativeTime: string
}

export function toNewsViewModel(item: NewsItem, now: Date): NewsViewModel {
  return {
    id: item.id,
    headline: item.headline,
    outlet: item.outlet,
    relativeTime: formatRelativeTime(item.publishedAt, now),
  }
}

/* --------------------------------------------------------------- freshness */

/**
 * The "Data uppdaterad" label. Reads the snapshot's true `asOf` — the oldest
 * across categories — rather than render time (defects D5/D10). Same `HH:MM`
 * format and position as before; only the value's source changed.
 */
export function formatDataFreshness(asOf: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(asOf))
}

/* ---------------------------------------------------------- range labelling */

/** Swedish button labels for the range selector. Locale lives here, not in the domain. */
export const RANGE_LABELS: Record<SeriesRange, string> = {
  '1d': '1D',
  '1w': '1V',
  '1m': '1M',
  '3m': '3M',
  '1y': '1Å',
  ytd: 'YTD',
}

/* ------------------------------------------------------------- sector rows */

export interface SectorViewModel {
  id: CanonicalSymbol
  label: string
  change: number
}

/** Short Swedish sector names — the Overview's own labels, not the canonical ones. */
const SECTOR_LABELS: Record<string, string> = {
  'sector:technology': 'Teknologi',
  'sector:communication': 'Kommunikation',
  'sector:industrials': 'Industri',
  'sector:financials': 'Finans',
  'sector:discretionary': 'Sällanköp',
  'sector:healthcare': 'Hälsovård',
  'sector:realestate': 'Fastigheter',
  'sector:energy': 'Energi',
  'sector:staples': 'Dagligvaror',
}

export function toSectorViewModel(quote: MarketQuote): SectorViewModel {
  return {
    id: quote.symbol,
    label: SECTOR_LABELS[quote.symbol] ?? instrumentRef(quote.symbol).displayName,
    change: quote.percentageChange ?? 0,
  }
}

/* ---------------------------------------------------------------- watchlist */

export interface WatchlistViewModel {
  id: CanonicalSymbol
  name: string
  price: string
  changePercent: number
  spark: number[]
}

export function toWatchlistViewModel(
  quote: MarketQuote,
  series: MarketSeries | undefined,
): WatchlistViewModel {
  const ref = instrumentRef(quote.symbol)
  return {
    id: quote.symbol,
    name: ref.displayName,
    price: formatNumber(quote.value, ref.precision),
    changePercent: quote.percentageChange ?? 0,
    spark: toSparklineValues(series),
  }
}

/** Re-exported so components never reach for the raw formatter. */
export { formatPercent }
