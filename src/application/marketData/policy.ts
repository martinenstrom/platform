/**
 * Per-category data policy: how long a value stays fresh, and what may stand
 * in for it when no live source answers.
 *
 * The TTL numbers are quota arithmetic, not taste. Twelve Data bills per
 * symbol against 800 calls/day: six index tiles at 60 s is 8 640 calls/day,
 * eleven times over. Marketaux allows 100 requests/day, so a 5-minute news TTL
 * (288/day) runs out by mid-afternoon while 15 minutes uses ~40. Changing a
 * number here changes whether the app fits in its free tiers.
 *
 * The fallback columns implement decision D2: **every category is
 * `non-production`**. There is no category in which a fabricated value may be
 * shown to a production user.
 */

import type { DataCategory } from './ports'

/** When a fixture may substitute for a live value. */
export type FixtureAllowance = 'never' | 'non-production' | 'always'

export interface FallbackPolicy {
  /** May a cached value be served past its TTL? */
  allowStale: boolean
  /** Hard ceiling; beyond this the value is discarded rather than shown. */
  maxStaleMs: number
  allowFixture: FixtureAllowance
  /** May a labelled proxy instrument substitute (an ETF for an index)? */
  allowProxy: boolean
}

export interface CategoryPolicy {
  /** TTL while the relevant market is open. */
  ttlOpenMs: number
  /** TTL while it is closed — no point spending quota on a static value. */
  ttlClosedMs: number
  fallback: FallbackPolicy
  /** Serve the cached value immediately and refresh behind it. */
  staleWhileRevalidate: boolean
}

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const PRICE_FALLBACK: FallbackPolicy = {
  allowStale: true,
  maxStaleMs: 4 * HOUR,
  allowFixture: 'non-production',
  allowProxy: false,
}

const POLICY_RATE_POLICY: CategoryPolicy = {
  ttlOpenMs: 6 * HOUR,
  ttlClosedMs: 6 * HOUR,
  fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
  staleWhileRevalidate: false,
}

export const CATEGORY_POLICY: Readonly<Record<DataCategory, CategoryPolicy>> =
  Object.freeze({
    /*
     * Nasdaq Stockholm cash equities: 09:00-17:30 CET/CEST, Monday to Friday.
     *
     * TTL is unchanged from the pre-Avanza configuration. It is deliberately
     * NOT tuned to the feed delay, because Avanza does not state one: a delay
     * we cannot measure cannot justify a refresh interval, and inventing a
     * "15 minutes" to pace against would be exactly the fabrication the rest
     * of this file avoids. 60s while open keeps the tiles moving; SWR means no
     * user waits on a refresh.
     *
     * `maxStaleMs` is 5 days, and the number is chosen against the exchange's
     * own calendar rather than a round figure:
     *
     *   normal weekend      Fri 17:30 -> Mon 09:00        = 63.5 h
     *   + a holiday Monday  Fri 17:30 -> Tue 09:00        = 87.5 h
     *   Easter, the longest Thu 13:00 (half day) -> Tue 09:00 ~ 116 h
     *
     * A ceiling under ~116 h would blank the panel over Easter and Christmas
     * while Avanza was working perfectly and the last trade was simply the one
     * before the holiday. 5 days clears the longest scheduled closure with
     * margin. It is a CEILING, not a claim of freshness — the envelope still
     * reports `stale` and the observation timestamp is always rendered.
     *
     * No local holiday calendar is consulted anywhere. Session state comes
     * from Avanza's own `get_marketplace_info`, and is `unknown` when that
     * call fails. Weekday-and-clock is never treated as evidence the venue is
     * open, and the opening and closing auctions are not represented at all
     * because Avanza's schedule reports only OPEN and CLOSED.
     */
    'equity-index-se': {
      ttlOpenMs: 60 * SECOND,
      ttlClosedMs: 15 * MINUTE,
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: true,
    },
    /*
     * The broker-routed international indices share the Swedish index policy:
     * same feed, same provider, same refresh economics.
     */
    'equity-index-intl-broker': {
      ttlOpenMs: 60 * SECOND,
      ttlClosedMs: 15 * MINUTE,
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: true,
    },
    'equity-index-intl': {
      ttlOpenMs: 60 * SECOND,
      ttlClosedMs: 15 * MINUTE,
      // Proxy ETFs remain OFF until decision D1 is resolved. Turning this on
      // also obliges the presentation layer to disclose the substitution.
      //
      // `maxStaleMs` is 5 days, aligned with the other two index families on
      // 2026-08-25. It inherited the 4-hour PRICE_FALLBACK default while this
      // category had no live provider, and that became wrong the moment Yahoo
      // gave it one: London closes at 16:30 UTC and the FTSE 100 level was
      // being discarded around 20:30, replaced by a fixture constant for the
      // rest of the night while the close was still the correct observation.
      //
      // This is a RETENTION ceiling, not a freshness horizon. The two are set
      // independently and mean different things: an open-session observation
      // is disclosed INAKTUELL after 15 minutes (see `freshness.ts`) while the
      // resolver may still retain it for days as the last real observation.
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY, allowProxy: false },
      staleWhileRevalidate: true,
    },
    /*
     * Monetary policy. All three institutions share these numbers because they
     * share a publication model: an official body confirms a standing state on
     * a defined cadence, and the state itself changes a handful of times a year.
     *
     * TTL 6h — there is no market session here, and asking more often re-reads
     * a value that changes at most eight times a year.
     *
     * `maxStaleMs` 5 days covers a Christmas or Easter run of non-publication
     * days in the two business-day series without erroring.
     *
     * SWR off. An official policy state is current or it is not; serving a
     * known-stale one while refreshing buys nothing when the underlying value
     * has not moved in months.
     *
     * Note what age means here: `provenance.asOf` is the OBSERVATION date, so
     * `ageMs` measures how long since the source last confirmed the state. It
     * is never the age of the policy decision — a rate unchanged since October
     * is not stale data. `regime.effectiveDate` carries that separately, and
     * nothing in this policy reads it.
     */
    /*
     * Instrument search. Keyed by the query string, so this is the first
     * category whose cache cardinality is driven by user input rather than a
     * fixed symbol set — the reason MemoryCacheStore is now LRU-bounded.
     *
     * Short TTL: a search result is a list of instruments, which barely
     * changes, but the prices attached to it do. Two minutes absorbs the
     * keystroke bursts a debounced search box produces without serving a
     * meaningfully old list.
     *
     * No fixture fallback in production and no stale service: an empty result
     * with an error state is honest, while a stale list for a DIFFERENT query
     * would be actively wrong.
     */
    'search-se': {
      ttlOpenMs: 2 * MINUTE,
      ttlClosedMs: 2 * MINUTE,
      fallback: {
        allowStale: false,
        maxStaleMs: 0,
        allowFixture: 'non-production',
        allowProxy: false,
      },
      staleWhileRevalidate: false,
    },
    'policy-us': POLICY_RATE_POLICY,
    'policy-ea': POLICY_RATE_POLICY,
    'policy-se': POLICY_RATE_POLICY,

    /** Same venue, same schedule, same reasoning as `equity-index-se`. */
    'equity-se': {
      ttlOpenMs: 60 * SECOND,
      ttlClosedMs: 15 * MINUTE,
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: true,
    },
    fx: {
      // The ECB publishes once per TARGET business day and Frankfurter sends
      // `cache-control: max-age=86400`, so polling faster re-fetches identical
      // bytes. Configurable, so a publication-window-aware refresh can replace
      // the fixed interval later (D14).
      ttlOpenMs: 30 * MINUTE,
      ttlClosedMs: 30 * MINUTE,
      // 5 days, not 48 hours (D13). A Friday rate is ~65 h old on Monday
      // morning and older still after a long weekend, so a 48-hour ceiling
      // would have errored every Monday while holding a perfectly valid rate.
      //
      // This is a WALL-CLOCK APPROXIMATION of "a few missed business days".
      // No TARGET holiday calendar is introduced in Phase 2; a
      // publication-calendar-aware model may replace it later.
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: true,
    },
    'yields-us': {
      ttlOpenMs: 12 * HOUR,
      ttlClosedMs: 12 * HOUR,
      // EOD series; a weekend legitimately leaves Friday's value in place.
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: false,
    },
    'yields-de': {
      ttlOpenMs: 12 * HOUR,
      ttlClosedMs: 12 * HOUR,
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: false,
    },
    'yields-se': {
      ttlOpenMs: 12 * HOUR,
      ttlClosedMs: 12 * HOUR,
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: false,
    },
    'curve-us': {
      // Same source and cadence as the US headline rates: one Treasury
      // payload published once per business day.
      ttlOpenMs: 12 * HOUR,
      ttlClosedMs: 12 * HOUR,
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 5 * DAY },
      staleWhileRevalidate: false,
    },
    commodities: {
      ttlOpenMs: 5 * MINUTE,
      ttlClosedMs: 15 * MINUTE,
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 8 * HOUR },
      staleWhileRevalidate: true,
    },
    crypto: {
      // Quota-driven, not taste (D19). CoinGecko's Demo plan allows ~322
      // calls/day; at 60 s this one tile would attempt 1,440. Ten minutes
      // yields ~144/day in continuous use, comfortably inside the 250/day
      // budget with room for retries. Configurable, like every TTL here.
      ttlOpenMs: 10 * MINUTE,
      ttlClosedMs: 10 * MINUTE,
      // A 24/7 market never closes, so staleness is unambiguously a fault.
      fallback: { ...PRICE_FALLBACK, maxStaleMs: 2 * HOUR },
      staleWhileRevalidate: true,
    },
    news: {
      // Quota-bound: Marketaux free is 100 requests/day.
      ttlOpenMs: 15 * MINUTE,
      ttlClosedMs: 30 * MINUTE,
      // Plausible fabricated headlines are the worst failure mode on the screen.
      fallback: {
        allowStale: true,
        maxStaleMs: 24 * HOUR,
        allowFixture: 'non-production',
        allowProxy: false,
      },
      staleWhileRevalidate: true,
    },
    sentiment: {
      ttlOpenMs: 15 * MINUTE,
      ttlClosedMs: 60 * MINUTE,
      // Fixture sentiment is barred; DERIVED sentiment over real or explicitly
      // stale inputs is not a fixture and stays production-eligible.
      fallback: {
        allowStale: true,
        maxStaleMs: 6 * HOUR,
        allowFixture: 'non-production',
        allowProxy: false,
      },
      staleWhileRevalidate: true,
    },
    intraday: {
      ttlOpenMs: 5 * MINUTE,
      ttlClosedMs: 60 * MINUTE,
      fallback: PRICE_FALLBACK,
      staleWhileRevalidate: true,
    },
    sectors: {
      ttlOpenMs: 5 * MINUTE,
      ttlClosedMs: 60 * MINUTE,
      fallback: PRICE_FALLBACK,
      staleWhileRevalidate: true,
    },
  })

export function policyFor(category: DataCategory): CategoryPolicy {
  return CATEGORY_POLICY[category]
}

export function ttlFor(category: DataCategory, marketOpen: boolean): number {
  const policy = CATEGORY_POLICY[category]
  return marketOpen ? policy.ttlOpenMs : policy.ttlClosedMs
}

/**
 * Whether a fixture may be served right now. `production` is the deployment
 * posture, derived from `MARKETDATA_MODE=live` — not from `NODE_ENV`, so a
 * production build running in fixture mode for a demo still renders.
 */
export function fixtureAllowed(policy: FallbackPolicy, production: boolean): boolean {
  switch (policy.allowFixture) {
    case 'always':
      return true
    case 'never':
      return false
    case 'non-production':
      return !production
  }
}
