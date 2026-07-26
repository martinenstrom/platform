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

export const CATEGORY_POLICY: Readonly<Record<DataCategory, CategoryPolicy>> =
  Object.freeze({
    'equity-index-se': {
      ttlOpenMs: 60 * SECOND,
      ttlClosedMs: 15 * MINUTE,
      fallback: PRICE_FALLBACK,
      staleWhileRevalidate: true,
    },
    'equity-index-intl': {
      ttlOpenMs: 60 * SECOND,
      ttlClosedMs: 15 * MINUTE,
      // Proxy ETFs remain OFF until decision D1 is resolved. Turning this on
      // also obliges the presentation layer to disclose the substitution.
      fallback: { ...PRICE_FALLBACK, allowProxy: false },
      staleWhileRevalidate: true,
    },
    'equity-se': {
      ttlOpenMs: 60 * SECOND,
      ttlClosedMs: 15 * MINUTE,
      fallback: PRICE_FALLBACK,
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
