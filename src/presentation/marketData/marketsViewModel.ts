/**
 * Markets route view model.
 *
 * Two jobs, both about not lying:
 *
 * 1. **Availability is explicit per row.** A row never carries a number
 *    without the state that number came in. S&P 500 and Nasdaq 100 have no
 *    approved provider, so in live mode they say so rather than showing a
 *    stale, fixture or proxy figure.
 *
 * 2. **Tone is derived here, not shipped as data.** The legacy mock carried a
 *    `tone` field that dictated a colour class — a presentation decision
 *    travelling as if it were a domain fact. Colour is now a function of the
 *    row's state and its change, computed at the boundary where presentation
 *    decisions belong.
 */

import {
  hasData,
  type CanonicalSymbol,
  type Envelope,
  type InstrumentRef,
  type MarketQuote,
} from '~/domain/market'

/** What a row's number is, or why there isn't one. */
export type RowState =
  | 'ok'
  | 'stale'
  | 'fixture'
  /** No approved provider exists for this instrument at all. */
  | 'unavailable'
  /** A provider exists and failed. */
  | 'error'

export type RowTone = 'positive' | 'negative' | 'neutral' | 'muted'

export interface MarketTickerRow {
  symbol: CanonicalSymbol
  /** Includes the currency where the instrument's unit is not obvious. */
  displayName: string
  value: number | null
  changePercent: number | null
  precision: number
  state: RowState
  tone: RowTone
  /** Named so a row can say where its number came from. */
  sourceName: string | null
  /** True for `fixture`, so the UI can mark demo values. */
  isDemo: boolean
}

/**
 * Bitcoin is quoted in USD and nothing on the row would otherwise say so.
 *
 * The other five are unambiguous to a Swedish reader: an index is an index,
 * and EUR/SEK names both currencies. Only crypto needs the suffix, so only
 * crypto gets it — a blanket rule would clutter five rows to clarify one.
 */
const CURRENCY_SUFFIX: Partial<Record<string, string>> = {
  'crypto:btc': 'USD',
}

/**
 * Colour from state and direction.
 *
 * `muted` for anything without a real current number: an unavailable row must
 * not read as "flat", which is what a neutral grey number implies.
 */
export function toneFor(state: RowState, changePercent: number | null): RowTone {
  if (state === 'unavailable' || state === 'error') return 'muted'
  if (changePercent === null) return 'neutral'
  if (changePercent > 0) return 'positive'
  if (changePercent < 0) return 'negative'
  return 'neutral'
}

function stateOf(envelope: Envelope<unknown>, hasQuote: boolean): RowState {
  // No quote for this symbol — whether the envelope failed, timed out, or
  // resolved without it. There is no number either way, and the row says so.
  if (!hasQuote) return 'unavailable'
  switch (envelope.state) {
    case 'ok':
      return 'ok'
    case 'stale':
      return 'stale'
    case 'fixture':
      return 'fixture'
    default:
      return 'unavailable'
  }
}

/** Maps one envelope's quotes onto rows, in the caller's display order. */
function rowsFrom(
  symbols: readonly CanonicalSymbol[],
  envelope: Envelope<MarketQuote[]>,
  instruments: Record<CanonicalSymbol, InstrumentRef>,
): MarketTickerRow[] {
  const quotes = hasData(envelope) ? envelope.data : []
  const sourceName = hasData(envelope) ? envelope.provenance.source.providerName : null

  return symbols.map((symbol) => {
    const ref = instruments[symbol]
    const quote = quotes.find((q) => q.symbol === symbol)
    const state = stateOf(envelope, quote !== undefined)
    const changePercent = quote?.percentageChange ?? null
    const suffix = CURRENCY_SUFFIX[symbol]

    return {
      symbol,
      displayName: suffix
        ? `${ref?.displayName ?? symbol} (${suffix})`
        : (ref?.displayName ?? symbol),
      value: quote?.value ?? null,
      changePercent,
      precision: ref?.precision ?? 2,
      state,
      tone: toneFor(state, changePercent),
      sourceName: state === 'unavailable' ? null : sourceName,
      isDemo: state === 'fixture',
    }
  })
}

export function toMarketTickerRows(args: {
  order: readonly CanonicalSymbol[]
  groups: Array<{
    symbols: readonly CanonicalSymbol[]
    envelope: Envelope<MarketQuote[]>
  }>
  instruments: Record<CanonicalSymbol, InstrumentRef>
}): MarketTickerRow[] {
  const bySymbol = new Map<CanonicalSymbol, MarketTickerRow>()
  for (const group of args.groups) {
    for (const row of rowsFrom(group.symbols, group.envelope, args.instruments)) {
      bySymbol.set(row.symbol, row)
    }
  }
  return args.order
    .map((symbol) => bySymbol.get(symbol))
    .filter((row): row is MarketTickerRow => row !== undefined)
}

/* ------------------------------------------------------- market intelligence */

/**
 * The Market Climate card's rows.
 *
 * Every one is unavailable, and there is deliberately no code path that could
 * make them otherwise. Breadth needs OMXS30 constituents, trend strength needs
 * moving averages over real history, volatility needs options data, and flows
 * need positioning data — none of which this system has.
 *
 * The card survives because it is the landing place for the future Market
 * Intelligence panel, which is meant to synthesize breadth, volatility term
 * structure, positioning, liquidity, flows, sentiment, macro regime and
 * cross-asset confirmation into a view of the market regime — produced by
 * specialist agents reporting to a Market Intelligence Manager, not by an
 * anonymous calculation. It does not survive because the numbers it used to
 * show were worth keeping. They were invented, and they read as measurements.
 */
export interface MarketIntelligenceRow {
  id: string
  label: string
}

export const MARKET_INTELLIGENCE_ROWS: readonly MarketIntelligenceRow[] = [
  { id: 'breadth', label: 'Marknadsbredd' },
  { id: 'trend', label: 'Trendstyrka' },
  { id: 'volatility', label: 'Volatilitet' },
  { id: 'flows', label: 'Flöden och positionering' },
] as const
