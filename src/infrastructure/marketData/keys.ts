/**
 * Cache-key construction.
 *
 * Keys derive from **normalized request identity** — never from a UI component
 * name. Two panels asking for the same symbols must hit the same entry, and
 * renaming a component must not invalidate a cache.
 *
 * Three independent version axes, so a change invalidates exactly what it must:
 *
 *  - `SCHEMA_VERSION`        the *shape* of the domain models. Bump when a
 *                            field is added, removed or retyped.
 *  - `NORMALIZATION_VERSION` the *semantics* of adapter mapping — a unit
 *                            correction, a different `previousClose` source, a
 *                            rounding fix — while the shape is unchanged.
 *  - request identity        never bumped; it *is* the request.
 *
 * The second axis is the one that is easy to omit and dangerous to lack: a
 * normalization change is invisible to the type system, so without it a
 * corrected unit mapping would leave plausible, well-typed, wrong values in the
 * cache until their TTL expired.
 */

import type { CanonicalSymbol } from '~/domain/market'
import type { Capability } from '~/application/marketData/ports'

export const SCHEMA_VERSION = 1
export const NORMALIZATION_VERSION = 1

/** `s1.n1` — the version prefix every key carries. */
export const KEY_PREFIX = `s${SCHEMA_VERSION}.n${NORMALIZATION_VERSION}`

/** Symbols are sorted so argument order cannot produce two keys for one request. */
function symbolPart(symbols: readonly CanonicalSymbol[]): string {
  return [...symbols].sort().join('|')
}

/** Marks entries produced by a proxy instrument, which must never share a slot. */
export function withProxy(key: string, isProxy: boolean): string {
  return isProxy ? `${key}#proxy` : key
}

export function quotesKey(
  capability: Capability,
  symbols: readonly CanonicalSymbol[],
): string {
  return `${KEY_PREFIX}:${capability}:${symbolPart(symbols)}`
}

export function seriesKey(
  symbol: CanonicalSymbol,
  interval: string,
  range: { from: string; to: string },
): string {
  return `${KEY_PREFIX}:series:${symbol}:${interval}:${range.from}/${range.to}`
}

export function newsKey(symbols: readonly CanonicalSymbol[], limit: number): string {
  const scope = symbols.length === 0 ? '*' : symbolPart(symbols)
  return `${KEY_PREFIX}:news:${scope}:limit=${limit}`
}

export function sentimentKey(formulaVersion: string): string {
  return `${KEY_PREFIX}:sentiment:${formulaVersion}`
}

export function yieldCurveKey(countryCode: string): string {
  return `${KEY_PREFIX}:yieldcurve:${countryCode}`
}

/**
 * Daily budget counter. Deliberately NOT version-prefixed: a schema bump must
 * not hand a provider a fresh quota for the day.
 */
export function budgetKey(providerId: string, utcDate: string): string {
  return `budget:${providerId}:${utcDate}`
}

/** Policy state for one institution. One state per bank, so no symbol list. */
export function policyStateKey(centralBank: string): string {
  return `${KEY_PREFIX}:policy:${centralBank}`
}
