/**
 * The Marknader route's data.
 *
 * The ticker card mixes asset classes — a Swedish index, two US indices, two
 * FX pairs and one crypto — and each resolves through the category that owns
 * it. They are kept in separate envelopes rather than merged into one list,
 * because their availability genuinely differs: OMXS30 has a provider, S&P 500
 * does not, and a combined envelope would have to pick one story for both.
 *
 * The Market Climate card has NO data source here on purpose. Breadth,
 * volatility, flows and positioning are derived analytics requiring
 * constituent data, options data and volume history that this system does not
 * have. Rather than compute something approximate, the route renders explicit
 * unavailable states — see `presentation/marketData/marketsViewModel.ts`.
 */

import { isolate } from '~/application/shared/isolate'
import { DEFAULT_SNAPSHOT_BUDGET_MS, withDeadline } from '~/application/shared/deadline'
import {
  INSTRUMENTS,
  SYM_BTC,
  SYM_EURSEK,
  SYM_NASDAQ100,
  SYM_OMXS30,
  SYM_SP500,
  SYM_USDSEK,
  type CanonicalSymbol,
  type Envelope,
  type InstrumentRef,
  type MarketQuote,
} from '~/domain/market'

/** The Swedish index, which Avanza serves. */
export const MARKETS_INDEX_SE_SYMBOLS = [SYM_OMXS30] as const

/**
 * The international indices.
 *
 * No approved provider exists (decision D1 / TD-3), so in live mode these
 * resolve to an error and the rows say so. They stay in the list rather than
 * being dropped: removing them would quietly narrow the product, and they are
 * the landing place for whatever D1 approves.
 */
export const MARKETS_INDEX_INTL_SYMBOLS = [SYM_SP500, SYM_NASDAQ100] as const

/** Both quoted against SEK, which is what a Swedish reader needs. */
export const MARKETS_FX_SYMBOLS = [SYM_EURSEK, SYM_USDSEK] as const

/**
 * Bitcoin, in USD.
 *
 * The catalog defines BTC in USD and CoinGecko is asked for USD, so USD is
 * what the row shows. The legacy mock displayed a SEK figure; reproducing it
 * would require deriving BTC/USD x USD/SEK, which is a genuine derived
 * observation needing aligned timestamps, its own methodology and the weaker
 * of two trust levels. That is not something to introduce as a side effect of
 * preserving a mock's currency choice.
 */
export const MARKETS_CRYPTO_SYMBOLS = [SYM_BTC] as const

/** Display order of the ticker card, across all four groups. */
export const MARKETS_TICKER_ORDER = [
  SYM_OMXS30,
  SYM_SP500,
  SYM_NASDAQ100,
  SYM_EURSEK,
  SYM_USDSEK,
  SYM_BTC,
] as const

export interface MarketsSnapshot {
  indicesSe: Envelope<MarketQuote[]>
  indicesIntl: Envelope<MarketQuote[]>
  fx: Envelope<MarketQuote[]>
  crypto: Envelope<MarketQuote[]>
  instruments: Record<CanonicalSymbol, InstrumentRef>
  generatedAt: string
  correlationId: string
}

export interface MarketsDataSource {
  now(): Date
  correlationId(): string
  indicesSe(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  indicesIntl(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  fx(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
  crypto(symbols: readonly CanonicalSymbol[]): Promise<Envelope<MarketQuote[]>>
}

export async function getMarkets(
  source: MarketsDataSource,
  budgetMs: number = DEFAULT_SNAPSHOT_BUDGET_MS,
): Promise<MarketsSnapshot> {
  const unit = <T>(label: string, run: () => Promise<Envelope<T>>) =>
    Number.isFinite(budgetMs)
      ? withDeadline(label, () => isolate(label, run), { budgetMs })
      : isolate(label, run)

  const [indicesSe, indicesIntl, fx, crypto] = await Promise.all([
    unit('markets.indicesSe', () => source.indicesSe(MARKETS_INDEX_SE_SYMBOLS)),
    unit('markets.indicesIntl', () => source.indicesIntl(MARKETS_INDEX_INTL_SYMBOLS)),
    unit('markets.fx', () => source.fx(MARKETS_FX_SYMBOLS)),
    unit('markets.crypto', () => source.crypto(MARKETS_CRYPTO_SYMBOLS)),
  ])

  return {
    indicesSe,
    indicesIntl,
    fx,
    crypto,
    instruments: Object.fromEntries(
      MARKETS_TICKER_ORDER.map((symbol) => [symbol, INSTRUMENTS[symbol]]),
    ) as Record<CanonicalSymbol, InstrumentRef>,
    generatedAt: source.now().toISOString(),
    correlationId: source.correlationId(),
  }
}
