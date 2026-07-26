/**
 * The canonical instrument catalog.
 *
 * One entry per instrument the Overview displays. This is the single source of
 * identity: providers map their own tickers onto these symbols inside their
 * adapters, fixtures key off them, cache keys are built from them, and the UI
 * looks up reference data by them.
 *
 * Adding a provider must never add a symbol. Adding an instrument happens
 * here, once.
 */

import { canonicalSymbol, type CanonicalSymbol, type InstrumentRef } from './instruments'
import { isoCurrency } from './primitives'

const EUR = isoCurrency('EUR')
const SEK = isoCurrency('SEK')
const USD = isoCurrency('USD')

/** Shorthand so the catalog below reads as data rather than constructor noise. */
const s = canonicalSymbol

/* ------------------------------------------------------------ equity indices */

export const SYM_OMXS30 = s('idx:omxs30')
export const SYM_SP500 = s('idx:sp500')
export const SYM_NASDAQ100 = s('idx:nasdaq100')
export const SYM_DAX = s('idx:dax')
export const SYM_FTSE100 = s('idx:ftse100')
export const SYM_NIKKEI225 = s('idx:nikkei225')
/** Volatility index — an input to derived sentiment, not a displayed tile. */
export const SYM_VIX = s('idx:vix')

/* ------------------------------------------------------------------- fx pairs */

export const SYM_USDSEK = s('fx:usdsek')
export const SYM_EURSEK = s('fx:eursek')
export const SYM_EURUSD = s('fx:eurusd')

/* ----------------------------------------------------------------- commodities */

export const SYM_BRENT = s('cmd:brent')
export const SYM_GOLD = s('cmd:gold')

/* --------------------------------------------------------------------- crypto */

export const SYM_BTC = s('crypto:btc')

/* -------------------------------------------------------------- government bonds */

export const SYM_US2Y = s('rate:us2y')
export const SYM_US10Y = s('rate:us10y')
export const SYM_DE10Y = s('rate:de10y')
export const SYM_SE10Y = s('rate:se10y')

/* -------------------------------------------------------------------- sectors */

export const SYM_SECTOR_TECH = s('sector:technology')
export const SYM_SECTOR_COMMS = s('sector:communication')
export const SYM_SECTOR_INDUSTRIALS = s('sector:industrials')
export const SYM_SECTOR_FINANCIALS = s('sector:financials')
export const SYM_SECTOR_DISCRETIONARY = s('sector:discretionary')
export const SYM_SECTOR_HEALTHCARE = s('sector:healthcare')
export const SYM_SECTOR_REALESTATE = s('sector:realestate')
export const SYM_SECTOR_ENERGY = s('sector:energy')
export const SYM_SECTOR_STAPLES = s('sector:staples')

/* ------------------------------------------------------------------- equities */

export const SYM_INVE_B = s('eq:xsto:inve-b')
export const SYM_VOLV_B = s('eq:xsto:volv-b')
export const SYM_EVO = s('eq:xsto:evo')
export const SYM_AZA = s('eq:xsto:aza')
export const SYM_ATCO_A = s('eq:xsto:atco-a')
export const SYM_SEB_A = s('eq:xsto:seb-a')

/* ------------------------------------------------------------------- catalog */

function index(
  symbol: CanonicalSymbol,
  displayName: string,
  extra: { countryCode?: string; exchangeMic?: string } = {},
): InstrumentRef {
  return {
    symbol,
    kind: 'equity-index',
    displayName,
    currency: null,
    unit: { kind: 'index-points' },
    precision: 2,
    ...extra,
  }
}

function sector(symbol: CanonicalSymbol, displayName: string): InstrumentRef {
  // Sectors are sub-indices of the S&P 500: same semantics, own namespace.
  return index(symbol, displayName, { countryCode: 'US' })
}

function fx(
  symbol: CanonicalSymbol,
  displayName: string,
  base: ReturnType<typeof isoCurrency>,
  quote: ReturnType<typeof isoCurrency>,
): InstrumentRef {
  return {
    symbol,
    kind: 'fx-pair',
    displayName,
    currency: quote,
    unit: { kind: 'fx-rate', base, quote },
    // FX needs four decimals; two would round USD/SEK moves out of existence.
    precision: 4,
    base,
    quote,
  }
}

function bond(
  symbol: CanonicalSymbol,
  displayName: string,
  countryCode: string,
  tenorMonths: number,
): InstrumentRef {
  return {
    symbol,
    kind: 'government-bond',
    displayName,
    currency: null,
    unit: { kind: 'percent' },
    precision: 2,
    countryCode,
    tenorMonths,
  }
}

function equity(
  symbol: CanonicalSymbol,
  displayName: string,
  ticker: string,
): InstrumentRef {
  return {
    symbol,
    kind: 'equity',
    displayName,
    currency: SEK,
    unit: { kind: 'currency', currency: SEK },
    precision: 2,
    ticker,
    exchangeMic: 'XSTO',
  }
}

/**
 * Every instrument the Overview knows about. Frozen: the catalog is reference
 * data, and a provider adapter mutating it would be a cross-layer bug.
 */
export const INSTRUMENTS: Readonly<Record<CanonicalSymbol, InstrumentRef>> =
  Object.freeze(
    Object.fromEntries(
      (
        [
          index(SYM_OMXS30, 'OMXS30', { countryCode: 'SE', exchangeMic: 'XSTO' }),
          index(SYM_SP500, 'S&P 500', { countryCode: 'US', exchangeMic: 'XNYS' }),
          index(SYM_NASDAQ100, 'Nasdaq 100', { countryCode: 'US', exchangeMic: 'XNAS' }),
          // DAX and Nikkei are quoted without decimals on this screen; precision
          // is instrument reference data, revisit when real levels land (Phase 6).
          {
            ...index(SYM_DAX, 'DAX', { countryCode: 'DE', exchangeMic: 'XETR' }),
            precision: 0,
          },
          index(SYM_FTSE100, 'FTSE 100', { countryCode: 'GB', exchangeMic: 'XLON' }),
          {
            ...index(SYM_NIKKEI225, 'Nikkei 225', {
              countryCode: 'JP',
              exchangeMic: 'XTKS',
            }),
            precision: 0,
          },
          index(SYM_VIX, 'VIX', { countryCode: 'US' }),

          fx(SYM_USDSEK, 'USD/SEK', USD, SEK),
          fx(SYM_EURSEK, 'EUR/SEK', EUR, SEK),
          fx(SYM_EURUSD, 'EUR/USD', EUR, USD),

          {
            symbol: SYM_BRENT,
            kind: 'commodity',
            displayName: 'Brent Crude',
            currency: USD,
            unit: { kind: 'per-physical', currency: USD, measure: 'bbl' },
            precision: 2,
            commodityClass: 'energy',
          },
          {
            symbol: SYM_GOLD,
            kind: 'commodity',
            displayName: 'Gold',
            currency: USD,
            unit: { kind: 'per-physical', currency: USD, measure: 'troy_oz' },
            precision: 2,
            commodityClass: 'metal',
          },

          {
            symbol: SYM_BTC,
            kind: 'crypto',
            displayName: 'Bitcoin',
            currency: USD,
            unit: { kind: 'currency', currency: USD },
            precision: 2,
            assetId: 'bitcoin',
            quoteCurrency: USD,
          },

          bond(SYM_US2Y, '2Y U.S. Yield', 'US', 24),
          bond(SYM_US10Y, '10Y U.S. Yield', 'US', 120),
          bond(SYM_DE10Y, '10Y Germany Yield', 'DE', 120),
          bond(SYM_SE10Y, 'Sweden 10Y Yield', 'SE', 120),

          sector(SYM_SECTOR_TECH, 'Information Technology'),
          sector(SYM_SECTOR_COMMS, 'Communication Services'),
          sector(SYM_SECTOR_INDUSTRIALS, 'Industrials'),
          sector(SYM_SECTOR_FINANCIALS, 'Financials'),
          sector(SYM_SECTOR_DISCRETIONARY, 'Consumer Discretionary'),
          sector(SYM_SECTOR_HEALTHCARE, 'Health Care'),
          sector(SYM_SECTOR_REALESTATE, 'Real Estate'),
          sector(SYM_SECTOR_ENERGY, 'Energy'),
          sector(SYM_SECTOR_STAPLES, 'Consumer Staples'),

          equity(SYM_INVE_B, 'Investor B', 'INVE B'),
          equity(SYM_VOLV_B, 'Volvo B', 'VOLV B'),
          equity(SYM_EVO, 'Evolution', 'EVO'),
          equity(SYM_AZA, 'Avanza Bank', 'AZA'),
          equity(SYM_ATCO_A, 'Atlas Copco A', 'ATCO A'),
          equity(SYM_SEB_A, 'SEB A', 'SEB A'),
        ] satisfies InstrumentRef[]
      ).map((ref) => [ref.symbol, ref]),
    ) as Record<CanonicalSymbol, InstrumentRef>,
  )

/** Throws on an unknown symbol: a missing catalog entry is a programming error. */
export function instrumentRef(symbol: CanonicalSymbol): InstrumentRef {
  const ref = INSTRUMENTS[symbol]
  if (!ref) throw new Error(`Unknown instrument: ${symbol}`)
  return ref
}

/* --------------------------------------------------------- Overview groupings */

/** The six "Marknadsöversikt" tiles, in display order. */
export const OVERVIEW_INDEX_SYMBOLS = [
  SYM_OMXS30,
  SYM_SP500,
  SYM_DAX,
  SYM_FTSE100,
  SYM_NIKKEI225,
  SYM_NASDAQ100,
] as const

/** "Aktuella marknader" — mixed asset classes, hence separate from the above. */
export const OVERVIEW_FX_SYMBOLS = [SYM_USDSEK, SYM_EURUSD] as const
export const OVERVIEW_COMMODITY_SYMBOLS = [SYM_BRENT, SYM_GOLD] as const
export const OVERVIEW_CRYPTO_SYMBOLS = [SYM_BTC] as const

/** "Räntemarknaden", in display order. */
export const OVERVIEW_YIELD_SYMBOLS = [SYM_US10Y, SYM_DE10Y, SYM_US2Y, SYM_SE10Y] as const

/** "Sektorer (S&P 500)", in display order. */
export const OVERVIEW_SECTOR_SYMBOLS = [
  SYM_SECTOR_TECH,
  SYM_SECTOR_COMMS,
  SYM_SECTOR_INDUSTRIALS,
  SYM_SECTOR_FINANCIALS,
  SYM_SECTOR_DISCRETIONARY,
  SYM_SECTOR_HEALTHCARE,
  SYM_SECTOR_REALESTATE,
  SYM_SECTOR_ENERGY,
  SYM_SECTOR_STAPLES,
] as const

/** "Bevakning" tiles, in display order. */
export const OVERVIEW_WATCHLIST_SYMBOLS = [
  SYM_INVE_B,
  SYM_VOLV_B,
  SYM_EVO,
  SYM_AZA,
  SYM_ATCO_A,
  SYM_SEB_A,
] as const

/** The four series compared in "Utveckling idag". */
export const OVERVIEW_INTRADAY_SYMBOLS = [
  SYM_OMXS30,
  SYM_SP500,
  SYM_DAX,
  SYM_NIKKEI225,
] as const
