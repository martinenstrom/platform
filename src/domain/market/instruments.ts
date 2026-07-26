/**
 * Instrument identity — what a thing *is*, as opposed to what it *did*.
 *
 * Separating identity (stable reference data) from observation (a quote, a
 * series) is what stops every model re-declaring name, currency and precision,
 * and what makes `'idx:sp500'` mean exactly one thing across providers,
 * fixtures, cache keys and the UI.
 */

import type { IsoCurrencyCode } from './primitives'
import type { Unit } from './provenance'

declare const canonicalSymbolBrand: unique symbol

/**
 * The single identity used everywhere: adapters, cache keys, envelopes, view
 * models. Namespaced `<kind>:<id>` so an id collision across asset classes is
 * impossible — the `bitcoin` vs `btc` defect in the legacy mock layer existed
 * precisely because ids were bare strings with no namespace.
 */
export type CanonicalSymbol = string & { readonly [canonicalSymbolBrand]: true }

export type InstrumentKind =
  'equity-index' | 'fx-pair' | 'commodity' | 'crypto' | 'equity' | 'government-bond'

const SYMBOL_PATTERN =
  /^(idx|fx|cmd|crypto|eq|rate|sector):[a-z0-9]([a-z0-9:._-]*[a-z0-9])?$/

/**
 * Mints a canonical symbol, rejecting anything that is not well-formed. The
 * only way to produce one — a bare string can never be passed where a
 * `CanonicalSymbol` is expected.
 */
export function canonicalSymbol(value: string): CanonicalSymbol {
  if (!SYMBOL_PATTERN.test(value)) {
    throw new Error(
      `Invalid CanonicalSymbol "${value}": expected <namespace>:<id>, ` +
        `namespace one of idx|fx|cmd|crypto|eq|rate|sector, id lowercase`,
    )
  }
  return value as CanonicalSymbol
}

/** Namespace prefix, e.g. `'idx'`. Used for routing and cache-key grouping. */
export function symbolNamespace(symbol: CanonicalSymbol): string {
  const [namespace] = symbol.split(':')
  // The brand guarantees the pattern matched, so a namespace always exists.
  return namespace as string
}

export interface InstrumentRefBase {
  symbol: CanonicalSymbol
  kind: InstrumentKind
  /**
   * Canonical, locale-neutral name — 'S&P 500', 'Brent Crude'. NOT a localized
   * display string; the presentation layer owns localization.
   */
  displayName: string
  /** `null` where the concept does not apply, e.g. an index level or a yield. */
  currency: IsoCurrencyCode | null
  unit: Unit
  /**
   * Decimals used when rendering. Reference data about the instrument (FX
   * quotes to 4, indices to 2, BTC to 0), not a formatting preference.
   */
  precision: number
}

export type InstrumentRef =
  | (InstrumentRefBase & {
      kind: 'equity-index'
      countryCode?: string
      exchangeMic?: string
    })
  | (InstrumentRefBase & {
      kind: 'fx-pair'
      base: IsoCurrencyCode
      quote: IsoCurrencyCode
    })
  | (InstrumentRefBase & {
      kind: 'commodity'
      commodityClass: 'energy' | 'metal' | 'agri'
    })
  | (InstrumentRefBase & {
      kind: 'crypto'
      assetId: string
      quoteCurrency: IsoCurrencyCode
    })
  | (InstrumentRefBase & {
      kind: 'equity'
      ticker: string
      exchangeMic: string
      isin?: string
    })
  | (InstrumentRefBase & {
      kind: 'government-bond'
      countryCode: string
      /** 24 = 2Y, 120 = 10Y. Months, so sub-year tenors stay expressible. */
      tenorMonths: number
    })
