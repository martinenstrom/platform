/**
 * Fixture values for the Overview — FIXTURE ONLY, never production.
 *
 * Every number here is transcribed from the mock module it replaces, as a
 * number rather than a localized string. Where the legacy source held
 * `'19 840'` or `'+0.32%'`, this file holds `19840` and `0.32`; formatting
 * happens once, at the presentation boundary.
 *
 * Timestamps are expressed as **offsets from the injected clock**, never as
 * absolute instants, so fixture data ages correctly and never reads as being
 * from 2025. This is what retires `MOCK_NOW` and `COUNTRY_MOCK_NOW` from the
 * Overview path (defect D3).
 */

import {
  SYM_ATCO_A,
  SYM_AZA,
  SYM_BRENT,
  SYM_BTC,
  SYM_DAX,
  SYM_DE10Y,
  SYM_EURSEK,
  SYM_EURUSD,
  SYM_EVO,
  SYM_FTSE100,
  SYM_GOLD,
  SYM_INVE_B,
  SYM_NASDAQ100,
  SYM_NIKKEI225,
  SYM_OMXS30,
  SYM_SE10Y,
  SYM_SEB_A,
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
  SYM_US10Y,
  SYM_US1M,
  SYM_US1Y,
  SYM_US20Y,
  SYM_US2M,
  SYM_US2Y,
  SYM_US30Y,
  SYM_US3M,
  SYM_US3Y,
  SYM_US4M,
  SYM_US5Y,
  SYM_US6M,
  SYM_US7Y,
  SYM_USDSEK,
  SYM_VOLV_B,
  type CanonicalSymbol,
  type Maturity,
  type YieldMethodology,
} from '~/domain/market'

export interface FixtureQuote {
  symbol: CanonicalSymbol
  value: number
  /** Percent change on the day. The domain derives previousClose from it. */
  changePercent: number
  /** Seed for this instrument's tile sparkline, where it has one. */
  sparkSeed?: number
}

/** "Marknadsöversikt" tiles, in display order. Seeds match the legacy component. */
export const FIXTURE_INDEX_QUOTES: FixtureQuote[] = [
  { symbol: SYM_OMXS30, value: 2612.48, changePercent: 0.74, sparkSeed: 3 },
  { symbol: SYM_SP500, value: 5843.12, changePercent: 0.41, sparkSeed: 5 },
  { symbol: SYM_DAX, value: 19840, changePercent: 0.32, sparkSeed: 7 },
  { symbol: SYM_FTSE100, value: 8363.95, changePercent: 0.28, sparkSeed: 11 },
  { symbol: SYM_NIKKEI225, value: 40850, changePercent: 0.55, sparkSeed: 13 },
  { symbol: SYM_NASDAQ100, value: 20418.65, changePercent: -0.28, sparkSeed: 17 },
]

export const FIXTURE_FX_QUOTES: FixtureQuote[] = [
  { symbol: SYM_USDSEK, value: 10.4127, changePercent: 0.19 },
  { symbol: SYM_EURUSD, value: 1.0812, changePercent: -0.15 },
  // EUR/SEK is on the Markets card but not the Overview. Without a fixture
  // the page cannot run offline, which is the one thing fixture mode is for.
  { symbol: SYM_EURSEK, value: 11.2384, changePercent: -0.12 },
]

export const FIXTURE_COMMODITY_QUOTES: FixtureQuote[] = [
  { symbol: SYM_BRENT, value: 65.72, changePercent: 0.38 },
  { symbol: SYM_GOLD, value: 2385.4, changePercent: 0.27 },
]

/**
 * Bitcoin in USD. The legacy component looked this up as `'bitcoin'` while the
 * mock id was `'btc'`, so the lookup always failed and an inline literal was
 * rendered instead (defect D1). There is now exactly one canonical symbol, and
 * the value below is the one that was actually reaching the screen.
 */
export const FIXTURE_CRYPTO_QUOTES: FixtureQuote[] = [
  { symbol: SYM_BTC, value: 71386.25, changePercent: 1.18 },
]

export interface FixtureYield {
  symbol: CanonicalSymbol
  countryCode: string
  currency: string
  maturity: Maturity
  /** Placeholder id; each Phase 4B adapter supplies the source's own. */
  seriesId: string
  /** The methodology the real source will use, so the shape is accurate. */
  methodology: YieldMethodology
  yieldPercent: number
  /** Day change in basis points. */
  changeBasisPoints: number
}

/** "Räntemarknaden", in display order. */
export const FIXTURE_YIELDS: FixtureYield[] = [
  {
    symbol: SYM_US10Y,
    countryCode: 'US',
    currency: 'USD',
    maturity: '10Y',
    seriesId: 'BC_10YEAR',
    methodology: 'par-yield',
    yieldPercent: 4.32,
    changeBasisPoints: 0,
  },
  {
    symbol: SYM_DE10Y,
    countryCode: 'DE',
    currency: 'EUR',
    maturity: '10Y',
    seriesId: 'BBSIS-R10XX',
    methodology: 'zero-coupon-fitted',
    yieldPercent: 2.48,
    changeBasisPoints: -0.04,
  },
  {
    symbol: SYM_US2Y,
    countryCode: 'US',
    currency: 'USD',
    maturity: '2Y',
    seriesId: 'BC_2YEAR',
    methodology: 'par-yield',
    yieldPercent: 3.91,
    changeBasisPoints: 0.01,
  },
  {
    symbol: SYM_SE10Y,
    countryCode: 'SE',
    currency: 'SEK',
    maturity: '10Y',
    seriesId: 'SEGVB10YC',
    methodology: 'benchmark-bond-yield',
    yieldPercent: 2.34,
    changeBasisPoints: 0.02,
  },
]

/**
 * US par curve, the 13 maturities the Treasury publishes.
 *
 * Replaces a 14-point PRNG walk that had no maturities, no observation date
 * and no source. A plausible upward-sloping shape, but fixture data: labelled
 * `quality: 'fixture'` and barred from production like everything else here.
 */
export const FIXTURE_US_PAR_CURVE: Array<{
  symbol: CanonicalSymbol
  maturity: Maturity
  seriesId: string
  yieldPercent: number
}> = [
  { symbol: SYM_US1M, maturity: '1M', seriesId: 'BC_1MONTH', yieldPercent: 4.1 },
  { symbol: SYM_US2M, maturity: '2M', seriesId: 'BC_2MONTH', yieldPercent: 4.13 },
  { symbol: SYM_US3M, maturity: '3M', seriesId: 'BC_3MONTH', yieldPercent: 4.16 },
  { symbol: SYM_US4M, maturity: '4M', seriesId: 'BC_4MONTH', yieldPercent: 4.19 },
  { symbol: SYM_US6M, maturity: '6M', seriesId: 'BC_6MONTH', yieldPercent: 4.22 },
  { symbol: SYM_US1Y, maturity: '1Y', seriesId: 'BC_1YEAR', yieldPercent: 4.25 },
  { symbol: SYM_US2Y, maturity: '2Y', seriesId: 'BC_2YEAR', yieldPercent: 3.91 },
  { symbol: SYM_US3Y, maturity: '3Y', seriesId: 'BC_3YEAR', yieldPercent: 3.95 },
  { symbol: SYM_US5Y, maturity: '5Y', seriesId: 'BC_5YEAR', yieldPercent: 4.05 },
  { symbol: SYM_US7Y, maturity: '7Y', seriesId: 'BC_7YEAR', yieldPercent: 4.18 },
  { symbol: SYM_US10Y, maturity: '10Y', seriesId: 'BC_10YEAR', yieldPercent: 4.32 },
  { symbol: SYM_US20Y, maturity: '20Y', seriesId: 'BC_20YEAR', yieldPercent: 4.61 },
  { symbol: SYM_US30Y, maturity: '30Y', seriesId: 'BC_30YEAR', yieldPercent: 4.74 },
]

/** "Sektorer (S&P 500)", in display order. */
export const FIXTURE_SECTOR_CHANGES: Array<{
  symbol: CanonicalSymbol
  changePercent: number
}> = [
  { symbol: SYM_SECTOR_TECH, changePercent: 0.81 },
  { symbol: SYM_SECTOR_COMMS, changePercent: 0.68 },
  { symbol: SYM_SECTOR_INDUSTRIALS, changePercent: 0.42 },
  { symbol: SYM_SECTOR_FINANCIALS, changePercent: 0.27 },
  { symbol: SYM_SECTOR_DISCRETIONARY, changePercent: 0.15 },
  { symbol: SYM_SECTOR_HEALTHCARE, changePercent: -0.11 },
  { symbol: SYM_SECTOR_REALESTATE, changePercent: -0.18 },
  { symbol: SYM_SECTOR_ENERGY, changePercent: -0.36 },
  { symbol: SYM_SECTOR_STAPLES, changePercent: -0.47 },
]

export interface FixtureWatchlistItem {
  symbol: CanonicalSymbol
  price: number
  changePercent: number
  spark: number[]
}

/** "Bevakning" tiles, in display order. Sparks are literal in the legacy mock. */
export const FIXTURE_WATCHLIST: FixtureWatchlistItem[] = [
  {
    symbol: SYM_INVE_B,
    price: 289.4,
    changePercent: 1.12,
    spark: [281, 283, 282, 286, 285, 288, 287, 289.4],
  },
  {
    symbol: SYM_VOLV_B,
    price: 274.85,
    changePercent: -0.63,
    spark: [278, 277, 279, 276, 275, 276, 275, 274.85],
  },
  {
    symbol: SYM_EVO,
    price: 812.2,
    changePercent: 2.48,
    spark: [782, 788, 795, 790, 801, 806, 809, 812.2],
  },
  {
    symbol: SYM_AZA,
    price: 268.9,
    changePercent: 0.34,
    spark: [266, 267, 266.5, 268, 267.5, 269, 268.4, 268.9],
  },
  {
    symbol: SYM_ATCO_A,
    price: 178.15,
    changePercent: -1.24,
    spark: [181, 180.5, 181.2, 179.8, 179, 178.6, 178.9, 178.15],
  },
  {
    symbol: SYM_SEB_A,
    price: 158.6,
    changePercent: 0.88,
    spark: [155, 156, 155.8, 157, 157.4, 158, 158.2, 158.6],
  },
]

/** Gauge position, 0-100. Legacy `GLOBAL_RISK_SENTIMENT.position`. */
export const FIXTURE_SENTIMENT_SCORE = 72

export interface FixtureNewsItem {
  id: string
  headline: string
  outlet: string
  /** Minutes before `clock.now()`. Preserves the rendered relative labels. */
  publishedMinutesAgo: number
}

/**
 * The four items `getGlobalNewsFeed(4)` produced, with their ages relative to
 * the legacy frozen clock converted to offsets. Rendering these against the
 * real clock reproduces the same "för N minuter sedan" labels indefinitely,
 * instead of drifting to "för 8 månader sedan" as absolute mock dates would.
 */
export const FIXTURE_NEWS: FixtureNewsItem[] = [
  {
    id: 'se-news-1',
    headline: 'Riksbanken signalerar möjlig räntesänkning',
    outlet: 'Riksbanken',
    publishedMinutesAgo: 42,
  },
  {
    id: 'us-news-1',
    headline: 'Federal Reserve sänker styrräntan med 0.25 procentenheter',
    outlet: 'Federal Reserve',
    publishedMinutesAgo: 55,
  },
  {
    id: 'jp-news-1',
    headline: 'Bank of Japan höjer styrräntan till 0.75%',
    outlet: 'Bank of Japan',
    publishedMinutesAgo: 65,
  },
  {
    id: 'de-news-1',
    headline: 'Tysk industri-PMI når högsta nivån på två år',
    outlet: 'S&P Global/HCOB',
    publishedMinutesAgo: 70,
  },
]

/** Series compared in "Utveckling idag", in legend order. */
export const FIXTURE_INTRADAY_SYMBOLS = [
  SYM_OMXS30,
  SYM_SP500,
  SYM_DAX,
  SYM_NIKKEI225,
] as const

/** Intraday grid: 33 points at 15-minute steps from 09:00 to 17:00 local. */
export const FIXTURE_INTRADAY_POINTS = 33
export const FIXTURE_INTRADAY_STEP_MINUTES = 15
export const FIXTURE_INTRADAY_START_HOUR = 9
