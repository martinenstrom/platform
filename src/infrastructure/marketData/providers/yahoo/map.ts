/**
 * Canonical symbol → Yahoo Finance ticker.
 *
 * ## Why this table is committed rather than searched
 *
 * The same reasoning as the Avanza map, for the same reason: Yahoo's transport
 * serves far more than indices, and a symbol resolved dynamically is a symbol
 * nobody reviewed. `^GSPC` is the S&P 500; `GC=F` on the identical endpoint is
 * "Gold Dec 26", a December COMEX futures contract. Both return HTTP 200 and a
 * well-formed payload.
 *
 * So identity is fixed here, in review, and `yahooBindingFor` throws on
 * anything it does not know. There is no fallback to a lookup — not on a miss,
 * not on an error, not ever.
 *
 * ## Deliberately absent
 *
 * **Gold and Brent.** Yahoo has no spot for either: `GC=F` is a dated COMEX
 * contract, `BZ=F` is "Brent Crude Oil Last Day Financial Futures", and
 * `XAUUSD=X` returns 404. A futures contract is a different instrument from a
 * spot benchmark — it carries carry and roll, and it expires. If futures are
 * wanted later they belong in Financial OS as named contracts with contract
 * semantics, never as a substitute for the spot observation.
 *
 * **DAX, Nasdaq 100, Nikkei 225 and OMXS30.** All four resolve from Avanza as
 * verified INDEX instruments with ISINs. Routing them through Yahoo as well
 * would trade a broker's identity-checked binding for an aggregator's, for no
 * gain but provider uniformity.
 *
 * Every field below was read from a live `v8/finance/chart` response on
 * 2026-08-25.
 */

import {
  SYM_FTSE100,
  SYM_SECTOR_COMMS,
  SYM_SECTOR_DISCRETIONARY,
  SYM_SECTOR_ENERGY,
  SYM_SECTOR_FINANCIALS,
  SYM_SECTOR_HEALTHCARE,
  SYM_SECTOR_INDUSTRIALS,
  SYM_SECTOR_REALESTATE,
  SYM_SECTOR_STAPLES,
  SYM_SECTOR_TECH,
  SYM_SP500,
  SYM_VIX,
  type CanonicalSymbol,
} from '~/domain/market'

export interface YahooBinding {
  symbol: CanonicalSymbol
  /** The ticker as Yahoo spells it, echoed back in `meta.symbol`. */
  yahooSymbol: string
  /** Yahoo's `longName`. Recorded for review, asserted by the smoke test. */
  expectedName: string
  /** Yahoo's own exchange code — NOT an ISO 10383 MIC. Never published as one. */
  expectedExchange: string
}

/**
 * The nine S&P 500 GICS sector indices.
 *
 * The Sektorer panel is a **ranking**, so correctness applies to the set and
 * not only to each row. Nine changes sourced on different bases would produce
 * an ordering that looks authoritative and is not — so every one of these is
 * an actual sector index from one provider, one instrument type, one venue and
 * one return definition. No ETF appears here: `XLK` and the rest resolve
 * perfectly well and diverged from their indices by up to two percentage
 * points on the day this was probed, which is exactly why they are not
 * interchangeable.
 *
 * ## Energy is the load-bearing binding
 *
 * Eight sectors follow the `^SP500-{GICS}` pattern. **Energy does not.**
 * `^SP500-10` does not exist, and the trap is that a near-miss does:
 *
 *   `^SP500-1010`  resolves, `INDEX`, "S&P 500 Energy (**Industry Group**)"
 *   `^GSPE`        resolves, `INDEX`, "S&P 500 Energy (**Sector**)"
 *
 * An industry group sits one level below a sector in the GICS hierarchy. The
 * wrong one returns a well-formed payload, an INDEX type and a plausible
 * number, and would sit in a sector ranking misreporting the sector. Only the
 * name distinguishes them, which is why `expectedName` is checked and why
 * `sectorIndices.test.ts` guards this specific substitution.
 *
 * Probed live on 2026-08-26: all nine resolved as `INDEX`, one timestamp, all
 * `America/New_York`, all `open`.
 */
const SECTOR_INDICES: readonly YahooBinding[] = [
  {
    symbol: SYM_SECTOR_TECH,
    yahooSymbol: '^SP500-45',
    expectedName: 'S&P 500 Information Technology',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_SECTOR_COMMS,
    yahooSymbol: '^SP500-50',
    expectedName: 'S&P 500 Communication Services',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_SECTOR_INDUSTRIALS,
    yahooSymbol: '^SP500-20',
    expectedName: 'S&P 500 Industrials (Sector)',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_SECTOR_FINANCIALS,
    yahooSymbol: '^SP500-40',
    expectedName: 'S&P 500 Financials (Sector)',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_SECTOR_DISCRETIONARY,
    yahooSymbol: '^SP500-25',
    expectedName: 'S&P 500 Consumer Discretionary',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_SECTOR_HEALTHCARE,
    yahooSymbol: '^SP500-35',
    expectedName: 'S&P 500 Health Care (Sector)',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_SECTOR_REALESTATE,
    yahooSymbol: '^SP500-60',
    expectedName: 'S&P 500 Real Estate (Sector)',
    expectedExchange: 'SNP',
  },
  {
    /* NOT `^SP500-10` (does not exist) and NOT `^SP500-1010` (industry group). */
    symbol: SYM_SECTOR_ENERGY,
    yahooSymbol: '^GSPE',
    expectedName: 'S&P 500 Energy (Sector)',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_SECTOR_STAPLES,
    yahooSymbol: '^SP500-30',
    expectedName: 'S&P 500 Consumer Staples (Sector)',
    expectedExchange: 'SNP',
  },
]

/** Every sector binding, for the set-level guards. */
export const YAHOO_SECTOR_INDICES = SECTOR_INDICES

export const YAHOO_INDICES: readonly YahooBinding[] = Object.freeze([
  {
    symbol: SYM_SP500,
    yahooSymbol: '^GSPC',
    expectedName: 'S&P 500',
    expectedExchange: 'SNP',
  },
  {
    symbol: SYM_FTSE100,
    yahooSymbol: '^FTSE',
    expectedName: 'FTSE 100',
    expectedExchange: 'FGI',
  },
  /*
   * VIX, probed 2026-08-25: `instrumentType: INDEX`, `longName` "CBOE
   * Volatility Index", Cboe Indices, America/Chicago.
   *
   * The volatility complex is unusually easy to substitute, so the contrast was
   * measured rather than assumed. At the same instant `^VIX` stood at 15,45
   * while `VIXY` (ProShares VIX Short-Term Futures ETF) was 18,01, `UVXY`
   * (Ultra VIX Short-Term Futures) 18,95 and `^VIX9D` (the 9-day index) 13,45.
   * Every one of those is a different number describing a different thing, and
   * three of them are not the 30-day index at all. `VX=F` returned no result.
   *
   * `^VIX` is the actual index — the input a sentiment model may legitimately
   * use. None of the others may stand in for it.
   */
  {
    symbol: SYM_VIX,
    yahooSymbol: '^VIX',
    expectedName: 'CBOE Volatility Index',
    expectedExchange: 'CXI',
  },
  ...SECTOR_INDICES,
])

const BY_SYMBOL: ReadonlyMap<CanonicalSymbol, YahooBinding> = new Map(
  YAHOO_INDICES.map((binding) => [binding.symbol, binding]),
)

/**
 * Throws on an unmapped symbol. A miss is a wiring mistake, and the only safe
 * responses are to fail or to guess — guessing is how a futures contract ends
 * up being served as spot.
 */
export function yahooBindingFor(symbol: CanonicalSymbol): YahooBinding {
  const binding = BY_SYMBOL.get(symbol)
  if (!binding) {
    throw new Error(
      `Yahoo has no reviewed binding for ${symbol}. Add one to YAHOO_INDICES ` +
        `with its exact ticker — never resolve it dynamically.`,
    )
  }
  return binding
}

export function yahooCovers(symbol: CanonicalSymbol): boolean {
  return BY_SYMBOL.has(symbol)
}
