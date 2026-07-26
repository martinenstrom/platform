/**
 * The Bevakning route's data.
 *
 * Route-scoped rather than a slice of `OverviewSnapshot`: the Overview is a
 * different page with different panels, and coupling the two would make every
 * Overview change a watchlist change. Both compose from the same domain models
 * through the same `equity-se` resolution, which is where the sharing belongs.
 *
 * ## Three kinds of thing, three provenances
 *
 * The route renders values that look alike in a table and are not alike at all:
 *
 *   price, change    market data, from Avanza, delayed, with a timestamp
 *   sparkline        historical market data, which no provider serves yet
 *   signal           AGENT output, which no agent produces yet
 *   membership       product state — a curated list, not the user's
 *
 * They are kept in separate envelopes so nothing can present one under
 * another's provenance. In particular there is no field here for a signal:
 * inventing a place for it would invite something to fill it.
 */

import { isolate } from '~/application/shared/isolate'
import { DEFAULT_SNAPSHOT_BUDGET_MS, withDeadline } from '~/application/shared/deadline'
import {
  INSTRUMENTS,
  OVERVIEW_WATCHLIST_SYMBOLS,
  type CanonicalSymbol,
  type Envelope,
  type InstrumentRef,
  type MarketQuote,
  type MarketSeries,
} from '~/domain/market'

/**
 * The curated list.
 *
 * Deliberately the same six as the Overview's watchlist panel — one curated
 * Swedish list, referenced twice, so the two screens cannot drift apart.
 */
export const WATCHLIST_SYMBOLS = OVERVIEW_WATCHLIST_SYMBOLS

export interface WatchlistSnapshot {
  quotes: Envelope<MarketQuote[]>
  /**
   * Historical series per symbol.
   *
   * Its own envelope, not merged with `quotes`: a live quote with no history
   * is the normal state today, and a shared envelope would force one of the
   * two to lie about the other.
   */
  sparklines: Envelope<Record<CanonicalSymbol, MarketSeries>>
  /** Reference data for every symbol above. */
  instruments: Record<CanonicalSymbol, InstrumentRef>
  generatedAt: string
  correlationId: string
}

export interface WatchlistDataSource {
  now(): Date
  correlationId(): string
  quotes(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  sparklines(
    symbols: readonly CanonicalSymbol[],
  ): Promise<Envelope<Record<CanonicalSymbol, MarketSeries>>>
}

export async function getWatchlist(
  source: WatchlistDataSource,
  budgetMs: number = DEFAULT_SNAPSHOT_BUDGET_MS,
): Promise<WatchlistSnapshot> {
  const unit = <T>(label: string, run: () => Promise<Envelope<T>>) =>
    Number.isFinite(budgetMs)
      ? withDeadline(label, () => isolate(label, run), { budgetMs })
      : isolate(label, run)

  const [quotes, sparklines] = await Promise.all([
    unit('watchlist.quotes', () => source.quotes(WATCHLIST_SYMBOLS)),
    unit('watchlist.sparklines', () => source.sparklines(WATCHLIST_SYMBOLS)),
  ])

  return {
    quotes,
    sparklines,
    instruments: Object.fromEntries(
      WATCHLIST_SYMBOLS.map((symbol) => [symbol, INSTRUMENTS[symbol]]),
    ) as Record<CanonicalSymbol, InstrumentRef>,
    generatedAt: source.now().toISOString(),
    correlationId: source.correlationId(),
  }
}
