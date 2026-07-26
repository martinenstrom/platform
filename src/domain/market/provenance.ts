/**
 * Provenance and data-state contracts.
 *
 * Every value that reaches the UI carries where it came from, when it was
 * observed, and how it relates to the real market. The rule the whole
 * architecture exists to enforce: fixture, stale, delayed and proxied data are
 * never presented as live.
 */

import type { IsoCurrencyCode } from './primitives'

/* --------------------------------------------------------------------- unit */

/**
 * Explicit unit of a numeric value. Never inferred from a symbol name — a
 * yield is percent, a yield *change* is basis points, and Brent is dollars per
 * barrel, and none of that is guessable from `'rate:us10y'` or `'cmd:brent'`.
 */
export type Unit =
  | { kind: 'index-points' }
  | { kind: 'currency'; currency: IsoCurrencyCode }
  | { kind: 'fx-rate'; base: IsoCurrencyCode; quote: IsoCurrencyCode }
  | { kind: 'percent' }
  | { kind: 'basis-points' }
  | {
      kind: 'per-physical'
      currency: IsoCurrencyCode
      measure: 'bbl' | 'troy_oz' | 'mt' | 'mmbtu'
    }

/* ------------------------------------------------------------------ quality */

/**
 * How a value relates to the real market — its *nature*.
 *
 * Orthogonal to `Envelope` state, which describes its *freshness*. A derived
 * score computed from stale inputs is `quality: 'derived'` in `state: 'stale'`;
 * both facts are true and both are preserved.
 */
export type Quality =
  /** Exchange-grade live tick from the venue itself. */
  | 'realtime'
  /**
   * Aggregated market data with a provider timestamp and a short cache
   * interval — current, but not exchange-grade.
   *
   * CoinGecko is the motivating case: a cross-exchange aggregate with a
   * `last_updated_at` and a 30-60 s cache. Calling that 'realtime' would
   * overstate it; calling it 'delayed' would misdescribe it, since it is not
   * a venue feed running behind.
   */
  | 'near-realtime'
  /** Real, but behind by a known or unknown delay (most free tiers). */
  | 'delayed'
  /**
   * End-of-day official value, correct until the next close. Distinct from
   * 'delayed': this is not a late real-time quote, it is a different kind of
   * observation, so `isDelayed` stays false for it.
   */
  | 'eod'
  /** Computed in-house from other real values. Production-eligible. */
  | 'derived'
  /** Invented. Never production-eligible — see FallbackPolicy. */
  | 'fixture'

export interface DataSourceMetadata {
  /** Stable id, also used as the provider's registry key. */
  providerId: string
  /** Human-readable name, for attribution surfaces. */
  providerName: string
  /** Some free tiers require visible attribution as a licence condition. */
  attributionUrl?: string
  licenseNote?: string
}

/**
 * Travels with every resolved value. Present on any `Envelope` state that
 * carries data, so a caller never has to ask a second question to know what it
 * is holding.
 */
/**
 * How precisely the source pinned its own observation.
 *
 * A provider that publishes a DATE has not told us a time, and inventing one
 * would replace an honest gap with a fabricated fact.
 */
export type AsOfPrecision = 'date' | 'minute' | 'second'

export interface Provenance {
  /**
   * When the provider observed the value. ISO 8601 with offset.
   *
   * For `asOfPrecision: 'date'` this is midnight UTC of the publication date,
   * which makes `ageMs` over-state age by up to a day — the safe direction.
   */
  asOf: string
  asOfPrecision: AsOfPrecision
  /** The provider's own date string, preserved exactly. e.g. '2026-07-24'. */
  sourceDate?: string
  /**
   * Operational ESTIMATE of when the source published.
   *
   * Never authoritative: not used for `asOf`, not used to compute `ageMs`, not
   * displayed as fact. It exists so an operator can judge "should newer data
   * exist by now?" for a source that only publishes a date.
   */
  estimatedPublicationAt?: string
  /** When we retrieved it. ISO 8601 with offset. */
  receivedAt: string
  /** `now - asOf` at resolution time. Never negative. */
  ageMs: number
  source: DataSourceMetadata
  quality: Quality
  isDelayed: boolean
  /** Known provider delay; `null` when the provider does not quantify it. */
  delayMinutes: number | null
  /** True when a different instrument stands in for the requested one. */
  isProxy: boolean
  /** Required whenever `isProxy` — what was substituted, for disclosure. */
  proxyNote?: string
}

/* -------------------------------------------------------------------- state */

export type StaleReason =
  | 'provider-error'
  | 'rate-limited'
  | 'budget-exhausted'
  | 'circuit-open'
  | 'timeout'
  | 'offline'
  | 'no-fresh-source'

export type ErrorCode =
  | 'network'
  | 'auth'
  | 'rate-limit'
  | 'schema'
  | 'not-found'
  | 'timeout'
  | 'circuit-open'
  | 'budget-exhausted'
  | 'no-provider-configured'
  /** Policy forbade the only fallback that was available. */
  | 'fallback-disallowed'
  | 'unknown'

/**
 * A fetch or resolution failure. Safe to log and to display: adapters must
 * never put an API key or a raw provider body in `message`.
 */
export interface DomainError {
  code: ErrorCode
  message: string
  providerId: string | null
  retryable: boolean
  retryAfterMs?: number
}

/**
 * The five states any piece of market data can be in.
 *
 * `error` is a real, reachable state. Fixture fallback does not eliminate it —
 * whether a fixture may stand in is a per-category policy decision, and for
 * every price category in production the answer is no.
 */
export type Envelope<T> =
  | { state: 'loading' }
  | { state: 'ok'; data: T; provenance: Provenance }
  | { state: 'stale'; data: T; provenance: Provenance; staleReason: StaleReason }
  | { state: 'fixture'; data: T; provenance: Provenance; reason: string }
  | {
      state: 'error'
      error: DomainError
      /**
       * Last known good value, when one exists. Present so a caller *may*
       * choose to show it with explicit disclosure — but `state` stays
       * `'error'`, so nothing renders it as live by accident.
       */
      lastGood?: { data: T; provenance: Provenance }
    }

/* ------------------------------------------------------------------ helpers */

/** True when the envelope carries data a caller can read. */
export function hasData<T>(
  envelope: Envelope<T>,
): envelope is Extract<Envelope<T>, { provenance: Provenance }> {
  return (
    envelope.state === 'ok' || envelope.state === 'stale' || envelope.state === 'fixture'
  )
}

/**
 * True when the value must not be presented as current market data without
 * disclosure. Drives the presentation layer's disclosure affordance.
 */
export function isDegraded<T>(envelope: Envelope<T>): boolean {
  if (envelope.state === 'error' || envelope.state === 'stale') return true
  if (envelope.state === 'fixture') return true
  if (envelope.state === 'loading') return false
  return envelope.provenance.isDelayed || envelope.provenance.isProxy
}

/**
 * Builds a `Provenance`, deriving `ageMs` from the clock rather than trusting
 * a caller to compute it. Clamped at zero: a provider whose clock runs ahead
 * of ours must not produce a negative age.
 */
export function buildProvenance(args: {
  asOf: string
  nowMs: number
  source: DataSourceMetadata
  quality: Quality
  /** Defaults to 'second'; a date-only source must say so explicitly. */
  asOfPrecision?: AsOfPrecision
  sourceDate?: string
  estimatedPublicationAt?: string
  isDelayed?: boolean
  delayMinutes?: number | null
  isProxy?: boolean
  proxyNote?: string
}): Provenance {
  const asOfMs = new Date(args.asOf).getTime()
  if (Number.isNaN(asOfMs)) {
    throw new Error(`buildProvenance: asOf is not a valid ISO timestamp: ${args.asOf}`)
  }
  if (args.isProxy === true && args.proxyNote === undefined) {
    throw new Error('buildProvenance: proxyNote is required when isProxy is true')
  }
  return {
    asOf: args.asOf,
    asOfPrecision: args.asOfPrecision ?? 'second',
    ...(args.sourceDate === undefined ? {} : { sourceDate: args.sourceDate }),
    ...(args.estimatedPublicationAt === undefined
      ? {}
      : { estimatedPublicationAt: args.estimatedPublicationAt }),
    receivedAt: new Date(args.nowMs).toISOString(),
    // Deliberately from `asOf`, never from `estimatedPublicationAt`: an
    // estimate must not be able to make data look fresher than it is proven
    // to be.
    ageMs: Math.max(0, args.nowMs - asOfMs),
    source: args.source,
    quality: args.quality,
    // 'delayed' means a real-time feed running behind. 'eod' is a different
    // kind of observation, not a late one, so it is NOT delayed.
    isDelayed: args.isDelayed ?? args.quality === 'delayed',
    delayMinutes: args.delayMinutes ?? null,
    isProxy: args.isProxy ?? false,
    ...(args.proxyNote === undefined ? {} : { proxyNote: args.proxyNote }),
  }
}
