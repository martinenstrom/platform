/**
 * Cache-key construction.
 *
 * Keys are derived from **normalized request identity**, never from a UI
 * component name. Two panels asking for the same symbols must hit the same
 * entry, and renaming a component must not invalidate a cache.
 *
 * `v1:` is a schema version — bumping it invalidates every entry at once when
 * a domain model changes shape.
 */

import type { CanonicalSymbol } from '~/domain/market'
import type { Capability } from '~/application/marketData/ports'

const SCHEMA_VERSION = 'v1'

/** Symbols are sorted so argument order cannot produce two keys for one request. */
function symbolPart(symbols: readonly CanonicalSymbol[]): string {
  return [...symbols].sort().join('|')
}

export function quotesKey(
  capability: Capability,
  symbols: readonly CanonicalSymbol[],
): string {
  return `${SCHEMA_VERSION}:${capability}:${symbolPart(symbols)}`
}

export function seriesKey(
  symbol: CanonicalSymbol,
  interval: string,
  range: { from: string; to: string },
): string {
  return `${SCHEMA_VERSION}:series:${symbol}:${interval}:${range.from}/${range.to}`
}

export function newsKey(symbols: readonly CanonicalSymbol[], limit: number): string {
  const scope = symbols.length === 0 ? '*' : symbolPart(symbols)
  return `${SCHEMA_VERSION}:news:${scope}:limit=${limit}`
}

export function sentimentKey(formulaVersion: string): string {
  return `${SCHEMA_VERSION}:sentiment:${formulaVersion}`
}

/** Daily budget counter, keyed by provider and UTC date. */
export function budgetKey(providerId: string, utcDate: string): string {
  return `${SCHEMA_VERSION}:budget:${providerId}:${utcDate}`
}
