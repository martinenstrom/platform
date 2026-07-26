/**
 * Watchlist row view model.
 *
 * The presentation boundary is where the three different kinds of value on
 * this page stop looking alike. In the table they are four columns; in the
 * data they are a delayed broker quote, a series that does not exist yet, and
 * an agent output that no agent produces. Each becomes an explicit render
 * state here so the component cannot accidentally show one as another.
 */

import {
  hasData,
  type CanonicalSymbol,
  type Envelope,
  type InstrumentRef,
  type MarketQuote,
  type MarketSeries,
} from '~/domain/market'

/**
 * What the Signal column shows.
 *
 * `example` exists ONLY for fixture mode, and the component labels it as such.
 * There is deliberately no state that renders a bare buy/sell/hold without
 * saying where it came from.
 */
export type SignalCell =
  /** No agent has produced a signal for this instrument. The live state. */
  | { state: 'unavailable' }
  /** Demo data, rendered with a visible "example" marker. */
  | { state: 'example'; signal: ExampleSignal }

export type ExampleSignal = 'buy' | 'sell' | 'hold' | 'watch'

export interface WatchlistRow {
  symbol: CanonicalSymbol
  displayName: string
  ticker: string | null
  /** `null` when no quote resolved — the cell renders a dash, not a zero. */
  value: number | null
  changePercent: number | null
  precision: number
  /** Empty when no real history exists. Never a generated curve. */
  spark: number[]
  signal: SignalCell
}

/**
 * Example signals, for fixture mode only.
 *
 * Kept here rather than in the domain or a provider because they are neither
 * market data nor a real agent output — they are demo furniture. Their one
 * job is to show what the column will look like once the agent organization
 * fills it, and they are unreachable outside fixture mode.
 */
const EXAMPLE_SIGNALS: Record<string, ExampleSignal> = {
  'eq:xsto:inve-b': 'buy',
  'eq:xsto:volv-b': 'hold',
  'eq:xsto:evo': 'watch',
  'eq:xsto:aza': 'buy',
  'eq:xsto:atco-a': 'hold',
  'eq:xsto:seb-a': 'sell',
}

function tickerOf(ref: InstrumentRef | undefined): string | null {
  if (!ref) return null
  return 'ticker' in ref ? ((ref.ticker as string | undefined) ?? null) : null
}

export function toWatchlistRows(args: {
  symbols: readonly CanonicalSymbol[]
  quotes: Envelope<MarketQuote[]>
  sparklines: Envelope<Record<CanonicalSymbol, MarketSeries>>
  instruments: Record<CanonicalSymbol, InstrumentRef>
}): WatchlistRow[] {
  const quotes = hasData(args.quotes) ? args.quotes.data : []
  const series = hasData(args.sparklines) ? args.sparklines.data : {}

  /*
   * ONE gate for every invented value on the row: demo content appears only
   * when the QUOTES themselves are fixtures.
   *
   * The gate is the envelope, not an environment flag. A row of real prices
   * beside an invented signal reads as analysis of those prices, and beside an
   * invented trend line reads as their history — so both are withheld the
   * moment anything real is on the row. A fully synthetic row is a coherent
   * demo; a half-synthetic one is a misleading chart.
   */
  const demoRow = args.quotes.state === 'fixture'

  return args.symbols.map((symbol) => {
    const ref = args.instruments[symbol]
    const quote = quotes.find((q) => q.symbol === symbol)
    const example = EXAMPLE_SIGNALS[symbol]

    return {
      symbol,
      displayName: ref?.displayName ?? symbol,
      ticker: tickerOf(ref),
      value: quote?.value ?? null,
      changePercent: quote?.percentageChange ?? null,
      precision: ref?.precision ?? 2,
      // Fixture history is withheld beside a real price for the same reason
      // the signal is. Real series (Phase 6) will pass through unconditionally.
      spark:
        args.sparklines.state === 'fixture' && !demoRow
          ? []
          : (series[symbol]?.points.map((point) => point.v) ?? []),
      signal:
        demoRow && example
          ? { state: 'example', signal: example }
          : { state: 'unavailable' },
    }
  })
}

/** True when nothing resolved at all, so the page can say so once. */
export function watchlistUnavailable(quotes: Envelope<MarketQuote[]>): boolean {
  return !hasData(quotes)
}
