/**
 * Historical market series, and what a period did according to one.
 *
 * The one place a period change is computed — for JARVIS today, and for the
 * chart ranges, the Meeting Pack and Market-to-Client when they want a real
 * weekly or monthly move rather than today's percentage. A series arrives
 * through the `HistoricalSeriesSource` port as the domain's `MarketSeries`
 * with its provenance; this module turns it into a typed `HistoricalSeries`
 * (start, end, frequency, completeness, source), picks the observations a
 * period is measured between under a documented trading-day policy, and
 * computes the change by the kind of instrument — a price moves in percent,
 * a yield in basis points, an FX pair in percent of the quoted pair.
 *
 * ## Trading-day policy
 *
 * Observations are daily closes keyed by their calendar date. A period's
 * start is the observation AT OR BEFORE the period's boundary — the prior
 * close — so a boundary that falls on a weekend or a holiday snaps to the
 * last session before it, and no observation is ever required at midnight
 * on the requested date. The end is the latest observation at or before now.
 *
 *   den här veckan / i veckan        from the last close before the current
 *                                    week's first session (the previous
 *                                    Friday, or earlier) to the latest close
 *   senaste 5 handelsdagarna         exactly the latest five sessions: from
 *                                    the close before the first of them
 *   senaste veckan                   seven calendar days back, snapped to the
 *                                    prior close
 *   den här månaden                  from the last close of the previous month
 *   senaste månaden / kvartalet /    one month, three months, one year back,
 *   senaste året                     snapped to the prior close
 *   i år / sedan årsskiftet          from the previous year's last close
 *   i september (a named month)      from the first observation inside the
 *                                    month to the last inside it, or to the
 *                                    latest observation if the month is still
 *                                    in progress
 *
 * ## No fabricated continuity
 *
 * A series with a gap of more than `MAX_GAP_CALENDAR_DAYS` between
 * consecutive observations inside the measured period is incomplete and is
 * refused; nothing is interpolated to make an answer available. A fixture is
 * refused whatever it contains. A latest observation older than
 * `STALE_LATEST_DAYS` is still measured, but flagged so the answer says so.
 */

import {
  hasData,
  instrumentRef,
  type CanonicalSymbol,
  type Envelope,
  type MarketSeries,
  type Provenance,
  type Quality,
  type Unit,
} from '~/domain/market'

/* -------------------------------------------------------------- contract */

export type SeriesMetric = 'price' | 'yield' | 'fx'

export interface HistoricalObservation {
  /** The observation's calendar date, ISO `YYYY-MM-DD`. */
  date: string
  /** The observation's instant as the source gave it, ISO 8601. */
  t: string
  value: number
}

export interface SeriesWindow {
  /** ISO dates, inclusive. */
  from: string
  to: string
}

export interface SeriesGap {
  from: string
  to: string
  calendarDays: number
}

export interface HistoricalSeries {
  symbol: CanonicalSymbol
  name: string
  metric: SeriesMetric
  unit: Unit
  frequency: 'daily'
  /** First and last observation dates. */
  start: string
  end: string
  observations: readonly HistoricalObservation[]
  source: { providerId: string; providerName: string; originator?: string }
  /** When the source observed the latest point. */
  observedAt: string
  retrievedAt: string
  quality: Quality
  requested: SeriesWindow
  /** True when the series reaches both ends of the requested window with no gap beyond the policy. */
  isCompleteForRequestedRange: boolean
  gaps: readonly SeriesGap[]
}

/** The one door to a series: infrastructure binds it to the registry's `series` capability. */
export interface HistoricalSeriesSource {
  series(symbol: CanonicalSymbol, window: SeriesWindow): Promise<Envelope<MarketSeries>>
}

/* ---------------------------------------------------------------- policy */

const DAY_MS = 24 * 60 * 60 * 1000
/** A four-day weekend plus a holiday is still a series; a longer hole is not. */
export const MAX_GAP_CALENDAR_DAYS = 6
/** How far the window reaches before a boundary, so the prior close is inside it whatever the holidays. */
export const PRIOR_CLOSE_MARGIN_DAYS = 14
/** A latest observation older than this is measured but called out. */
export const STALE_LATEST_DAYS = 4

export function metricOf(symbol: CanonicalSymbol): SeriesMetric {
  try {
    const kind = instrumentRef(symbol).kind
    if (kind === 'government-bond') return 'yield'
    if (kind === 'fx-pair') return 'fx'
    return 'price'
  } catch {
    if (symbol.startsWith('rate:')) return 'yield'
    if (symbol.startsWith('fx:')) return 'fx'
    return 'price'
  }
}

export function nameOf(symbol: CanonicalSymbol): string {
  try {
    return instrumentRef(symbol).displayName
  } catch {
    return symbol
  }
}

function unitOf(symbol: CanonicalSymbol): Unit {
  try {
    return instrumentRef(symbol).unit
  } catch {
    return metricOf(symbol) === 'yield' ? { kind: 'percent' } : { kind: 'index-points' }
  }
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)
const dateMs = (date: string): number => Date.parse(`${date}T00:00:00.000Z`)

/** A real observation: not a fixture standing in for a source that did not answer. */
export const realProvenance = (provenance: Provenance): boolean =>
  provenance.quality !== 'fixture' && provenance.source.providerId !== 'fixture'

/* ------------------------------------------------------- the typed series */

/** The domain series as the typed contract, with its completeness judged against the window asked for. */
export function toHistoricalSeries(
  series: MarketSeries,
  requested: SeriesWindow,
): HistoricalSeries {
  const observations: HistoricalObservation[] = series.points
    .map((point) => ({ date: point.t.slice(0, 10), t: point.t, value: point.v }))
    .filter((point) => point.date >= requested.from && point.date <= requested.to)
  const gaps: SeriesGap[] = []
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1]!
    const current = observations[index]!
    const days = Math.round((dateMs(current.date) - dateMs(previous.date)) / DAY_MS)
    if (days > MAX_GAP_CALENDAR_DAYS)
      gaps.push({ from: previous.date, to: current.date, calendarDays: days })
  }
  const first = observations[0]
  const last = observations[observations.length - 1]
  const reachesStart =
    first !== undefined &&
    dateMs(first.date) - dateMs(requested.from) <= MAX_GAP_CALENDAR_DAYS * DAY_MS
  const reachesEnd =
    last !== undefined &&
    dateMs(requested.to) - dateMs(last.date) <= MAX_GAP_CALENDAR_DAYS * DAY_MS
  return {
    symbol: series.symbol,
    name: nameOf(series.symbol),
    metric: metricOf(series.symbol),
    unit: unitOf(series.symbol),
    frequency: 'daily',
    start: first?.date ?? requested.from,
    end: last?.date ?? requested.from,
    observations,
    source: {
      providerId: series.provenance.source.providerId,
      providerName: series.provenance.source.providerName,
      ...(series.provenance.source.originator
        ? { originator: series.provenance.source.originator }
        : {}),
    },
    observedAt: series.provenance.asOf,
    retrievedAt: series.provenance.receivedAt,
    quality: series.provenance.quality,
    requested,
    isCompleteForRequestedRange: reachesStart && reachesEnd && gaps.length === 0,
    gaps,
  }
}

/* --------------------------------------------------------------- periods */

export type HistoryRange = 'this-week' | '5d' | '1w' | 'mtd' | '1m' | '3m' | '1y' | 'ytd'

export type HistoryPeriod =
  { kind: 'range'; range: HistoryRange } | { kind: 'month'; year: number; month: number }

export interface PeriodBounds {
  period: HistoryPeriod
  /** How the start observation is chosen. */
  startRule: 'prior-close' | 'sessions-back' | 'first-in-window'
  /** For `prior-close`: the boundary the start observation must be at or before. */
  boundary: string | null
  /** For `sessions-back`: how many sessions the period spans. */
  sessions: number | null
  /** Observations outside this window are not the period's. */
  window: SeriesWindow
  /** The window to fetch, wide enough to hold the prior close and rounded to a month so one fetch serves many questions. */
  fetch: SeriesWindow
}

const firstOfMonth = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
const monday = (date: Date): Date => {
  const day = date.getUTCDay()
  const back = day === 0 ? 6 : day - 1
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - back),
  )
}
const minusMonths = (date: Date, months: number): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()),
  )

/** The bounds a period is measured between at `now`; null when the period lies in the future. */
export function periodBounds(period: HistoryPeriod, now: Date): PeriodBounds | null {
  const today = isoDate(now)
  const fetchFor = (from: Date): SeriesWindow => ({
    from: isoDate(
      firstOfMonth(new Date(from.getTime() - PRIOR_CLOSE_MARGIN_DAYS * DAY_MS)),
    ),
    to: today,
  })
  if (period.kind === 'month') {
    const start = new Date(Date.UTC(period.year, period.month - 1, 1))
    const end = new Date(Date.UTC(period.year, period.month, 0))
    if (start.getTime() > now.getTime()) return null
    const to = end.getTime() < now.getTime() ? isoDate(end) : today
    return {
      period,
      startRule: 'first-in-window',
      boundary: null,
      sessions: null,
      window: { from: isoDate(start), to },
      fetch: {
        from: isoDate(firstOfMonth(new Date(start.getTime() - DAY_MS))),
        to: today,
      },
    }
  }
  const priorClose = (boundary: Date): PeriodBounds => ({
    period,
    startRule: 'prior-close',
    boundary: isoDate(boundary),
    sessions: null,
    window: {
      from: isoDate(new Date(boundary.getTime() - PRIOR_CLOSE_MARGIN_DAYS * DAY_MS)),
      to: today,
    },
    fetch: fetchFor(boundary),
  })
  switch (period.range) {
    case 'this-week':
      return priorClose(new Date(monday(now).getTime() - DAY_MS))
    case '5d': {
      const from = new Date(now.getTime() - 30 * DAY_MS)
      return {
        period,
        startRule: 'sessions-back',
        boundary: null,
        sessions: 5,
        window: { from: isoDate(from), to: today },
        fetch: fetchFor(from),
      }
    }
    case '1w':
      return priorClose(new Date(now.getTime() - 7 * DAY_MS))
    case 'mtd':
      return priorClose(new Date(firstOfMonth(now).getTime() - DAY_MS))
    case '1m':
      return priorClose(minusMonths(now, 1))
    case '3m':
      return priorClose(minusMonths(now, 3))
    case '1y':
      return priorClose(minusMonths(now, 12))
    case 'ytd':
      return priorClose(new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 31)))
  }
}

/* ----------------------------------------------------------- the change */

export interface PeriodChange {
  symbol: CanonicalSymbol
  name: string
  metric: SeriesMetric
  unit: Unit
  period: HistoryPeriod
  start: HistoricalObservation
  end: HistoricalObservation
  /** Sessions measured, from the start (exclusive) to the end (inclusive). */
  sessions: number
  /** A price or an FX pair: `(end / start − 1) × 100`. Null for a yield. */
  changePercent: number | null
  /** A yield: `(end − start) × 100`. Null for a price or an FX pair. */
  changeBasisPoints: number | null
  changeAbsolute: number
  /** The latest observation is older than the policy allows for "now". */
  latestIsStale: boolean
  /** The series measured, from the start to the end. */
  series: HistoricalSeries
}

export type PeriodChangeFailure =
  /** The series does not reach back to the period's start, or has too few observations. */
  | 'insufficient-coverage'
  /** A hole inside the measured period beyond the trading-calendar policy. */
  | 'incomplete-series'

/** The change over the bounds, or why there is none. */
export function periodChange(
  series: HistoricalSeries,
  bounds: PeriodBounds,
  now: Date,
): { change: PeriodChange } | { reason: PeriodChangeFailure } {
  const inWindow = series.observations.filter(
    (point) => point.date >= bounds.window.from && point.date <= bounds.window.to,
  )
  let start: HistoricalObservation | undefined
  let end: HistoricalObservation | undefined = inWindow[inWindow.length - 1]
  switch (bounds.startRule) {
    case 'prior-close': {
      const boundary = bounds.boundary!
      const before = inWindow.filter((point) => point.date <= boundary)
      start = before[before.length - 1]
      /* The prior close must stand within the policy's reach of the boundary, or the series does not cover the period. */
      if (start && dateMs(boundary) - dateMs(start.date) > MAX_GAP_CALENDAR_DAYS * DAY_MS)
        start = undefined
      break
    }
    case 'sessions-back': {
      const sessions = bounds.sessions!
      if (inWindow.length >= sessions + 1)
        start = inWindow[inWindow.length - 1 - sessions]
      break
    }
    case 'first-in-window': {
      start = inWindow[0]
      end = inWindow[inWindow.length - 1]
      /* The month's first observation must stand near its start, and — for a month already over — its last near its end. */
      if (
        start &&
        dateMs(start.date) - dateMs(bounds.window.from) > MAX_GAP_CALENDAR_DAYS * DAY_MS
      )
        start = undefined
      if (
        end &&
        dateMs(bounds.window.to) - dateMs(end.date) > MAX_GAP_CALENDAR_DAYS * DAY_MS
      )
        end = undefined
      break
    }
  }
  if (!start || !end || end.date <= start.date) return { reason: 'insufficient-coverage' }
  const measured = inWindow.filter(
    (point) => point.date >= start!.date && point.date <= end!.date,
  )
  for (let index = 1; index < measured.length; index += 1) {
    const days = Math.round(
      (dateMs(measured[index]!.date) - dateMs(measured[index - 1]!.date)) / DAY_MS,
    )
    if (days > MAX_GAP_CALENDAR_DAYS) return { reason: 'incomplete-series' }
  }
  if (
    bounds.startRule !== 'first-in-window' &&
    !(start.value > 0) &&
    series.metric !== 'yield'
  )
    return { reason: 'insufficient-coverage' }
  const latestIsStale =
    bounds.window.to === isoDate(now) &&
    dateMs(bounds.window.to) - dateMs(end.date) > STALE_LATEST_DAYS * DAY_MS
  const changeAbsolute = end.value - start.value
  return {
    change: {
      symbol: series.symbol,
      name: series.name,
      metric: series.metric,
      unit: series.unit,
      period: bounds.period,
      start,
      end,
      sessions: measured.length - 1,
      changePercent:
        series.metric === 'yield' ? null : (end.value / start.value - 1) * 100,
      changeBasisPoints: series.metric === 'yield' ? changeAbsolute * 100 : null,
      changeAbsolute,
      latestIsStale,
      series: { ...series, observations: measured, start: start.date, end: end.date },
    },
  }
}

/* ------------------------------------------------------------- the reads */

export type HistoryMissingReason =
  | 'no-history-source'
  | 'no-series'
  | 'fixture'
  | PeriodChangeFailure
  | 'unsupported-period'

export interface HistoryMissing {
  symbol: CanonicalSymbol
  name: string
  reason: HistoryMissingReason
}

export interface PeriodChanges {
  changes: PeriodChange[]
  missing: HistoryMissing[]
}

/**
 * The changes of several instruments over one period, each read through the
 * port and judged on its own: one missing series never hides another's move.
 */
export async function periodChanges(
  source: HistoricalSeriesSource | null,
  symbols: readonly CanonicalSymbol[],
  period: HistoryPeriod,
  now: Date,
): Promise<PeriodChanges> {
  const bounds = periodBounds(period, now)
  if (!bounds) {
    return {
      changes: [],
      missing: symbols.map((symbol) => ({
        symbol,
        name: nameOf(symbol),
        reason: 'unsupported-period',
      })),
    }
  }
  if (!source) {
    return {
      changes: [],
      missing: symbols.map((symbol) => ({
        symbol,
        name: nameOf(symbol),
        reason: 'no-history-source',
      })),
    }
  }
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return { symbol, envelope: await source.series(symbol, bounds.fetch) }
      } catch {
        return { symbol, envelope: null }
      }
    }),
  )
  const changes: PeriodChange[] = []
  const missing: HistoryMissing[] = []
  for (const { symbol, envelope } of results) {
    if (!envelope || !hasData(envelope)) {
      missing.push({ symbol, name: nameOf(symbol), reason: 'no-series' })
      continue
    }
    if (envelope.state === 'fixture' || !realProvenance(envelope.data.provenance)) {
      missing.push({ symbol, name: nameOf(symbol), reason: 'fixture' })
      continue
    }
    const outcome = periodChange(
      toHistoricalSeries(envelope.data, bounds.fetch),
      bounds,
      now,
    )
    if ('change' in outcome) changes.push(outcome.change)
    else missing.push({ symbol, name: nameOf(symbol), reason: outcome.reason })
  }
  return { changes, missing }
}
