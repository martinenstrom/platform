/**
 * How old a market observation may be before a reader must be told.
 *
 * ## Three different clocks, previously one
 *
 * Financial OS measures three things that all sound like "freshness" and are
 * not the same fact:
 *
 *   **cache TTL**          how often we may spend a request. Quota arithmetic
 *                          — see `CATEGORY_POLICY`. It says nothing about the
 *                          age of the number being held.
 *   **max stale retention** how long a real observation may be kept and served
 *                          when no provider answers. A failover ceiling.
 *   **freshness horizon**   *this module.* How old the observation a reader is
 *                          looking at may be before it stops representing the
 *                          market.
 *
 * They were conflated in the disclosure projection, which took the resolver's
 * `Envelope.state` as the answer to the third question. It is the answer to the
 * first two. A cache entry that passed its 60-second TTL was being reported as
 * INAKTUELL while the observation inside it was seven seconds old and the S&P
 * was open — a statement about our cache dressed as a statement about the
 * market.
 *
 * ## The horizon is a disclosure threshold, not a claim about a feed
 *
 * Fifteen minutes for an open equity index is a Financial OS judgement about
 * when a level may have moved enough that a reader should be told, and nothing
 * more. It is **not** an assertion that Yahoo or Avanza publishes on a
 * fifteen-minute delay — neither states a delay, and inventing one is exactly
 * the fabrication the surrounding policy avoids.
 *
 * ## A horizon must clear its source's publication cadence
 *
 * Thresholds are per instrument class for a reason that only appeared once
 * commodities went live. Avanza's gold and Brent quotes were measured directly
 * on 2026-08-25: `timeOfLast` 20:42:40 against a clock of 20:58:05, and
 * 20:04:49 half an hour before that. **The feed publishes roughly every
 * fifteen minutes.**
 *
 * A fifteen-minute horizon on a fifteen-minute cadence sits exactly on top of
 * the source's normal behaviour: a perfectly healthy feed reaches the
 * threshold immediately before each publication, so the row flips between
 * FÖRDRÖJD and INAKTUELL forever. Each individual reading is defensible and
 * the aggregate is useless — a marker that fires during normal operation stops
 * carrying information, and the reader learns to ignore it.
 *
 * So a horizon has to clear the cadence of the source behind it, and the
 * cadence is a property of the instrument's feed rather than of markets in
 * general. That is why there is no single number here.
 *
 * ## Session comes from the provider, never from a clock
 *
 * A weekday and an hour are not evidence a venue is trading: holidays, half
 * days and auctions all break that inference, and this repository holds no
 * exchange calendar. Session state therefore comes from the observation
 * itself — Avanza's `marketPlace.currentStatus`, Yahoo's
 * `currentTradingPeriod` — and is `unknown` when a provider does not say.
 */

import type { CanonicalSymbol } from '~/domain/market'
import type { Quality, SessionState } from '~/domain/market'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Every horizon is a **half-open interval**: `age < limit` is within the
 * horizon, `age >= limit` is stale.
 *
 * Stated once, here, because it is the rule for all instrument classes and not
 * an accident of one comparator. Reaching the limit exactly means the
 * observation has spent its whole allowance, so 15m00s.000 on an equity index
 * and 30m00s.000 on a commodity are both stale. Accepted deliberately on
 * 2026-08-25 — not a rounding artefact.
 */
export interface FreshnessHorizon {
  /** How old an observation may be while its own market is trading. */
  maxAgeOpenMs: number
  /**
   * How old the latest valid observation may be while that market is shut.
   *
   * Generous by design: a closing level is the correct observation for the
   * whole closure, and wall-clock hours passing over a weekend does not make
   * Friday's close wrong. The ceiling exists to catch a feed that has silently
   * stopped, not to age out a legitimate close.
   */
  maxAgeClosedMs: number
}

/**
 * Continuously quoted while its venue is open: index levels, shares, sector
 * aggregates.
 *
 * Fifteen minutes open. The sources behind these publish far faster than that
 * — a live S&P observation arrives seconds old — so the threshold sits well
 * clear of normal operation and only fires when something has actually
 * stopped.
 *
 * The closed allowance matches the retention ceiling reasoning in
 * `CATEGORY_POLICY`: five days clears the longest scheduled closure — an
 * Easter or Christmas run — without aging out the last real print.
 */
const INTRADAY: FreshnessHorizon = {
  maxAgeOpenMs: 15 * MINUTE,
  maxAgeClosedMs: 5 * DAY,
}

/**
 * Gold and Brent spot, quoted through Avanza.
 *
 * **Thirty minutes, and the number comes from the feed's measured cadence.**
 * Avanza publishes these roughly every fifteen minutes (see the module note),
 * so thirty deliberately allows **one missed publication interval** before the
 * observation is called stale. A single skipped update is normal; two in a row
 * is a feed that has stopped, and that is what the reader should hear about.
 *
 * As with every threshold here, this is **not** a claim that Avanza has a
 * thirty-minute delay. Avanza states no delay figure at all and
 * `delayMinutes` stays `null`. It is Financial OS's stale-observation
 * threshold, calibrated from an observed publication cadence — a different
 * kind of statement entirely, and the two must not be conflated.
 *
 * These instruments carry `session: 'unknown'` by ruling, because Avanza's
 * 09:00-17:30 beQuoted schedule describes its own quoting window rather than
 * a commodity market that trades nearly around the clock. `unknown` takes the
 * open horizon, so this threshold is the one that governs them in practice.
 */
const COMMODITY: FreshnessHorizon = {
  maxAgeOpenMs: 30 * MINUTE,
  maxAgeClosedMs: 5 * DAY,
}

/**
 * Published once per business day: FX reference rates, par yields, policy
 * rates.
 *
 * These have no intraday existence at all, so an open venue somewhere does not
 * make this morning's publication old. Both horizons are the same because the
 * session is irrelevant to the question.
 */
const DAILY: FreshnessHorizon = {
  maxAgeOpenMs: 5 * DAY,
  maxAgeClosedMs: 5 * DAY,
}

/**
 * A market that never closes, so a gap is unambiguously a fault rather than a
 * session. There is no closed state to be generous about.
 */
const CONTINUOUS: FreshnessHorizon = {
  maxAgeOpenMs: 30 * MINUTE,
  maxAgeClosedMs: 30 * MINUTE,
}

/**
 * The horizon for a symbol, by namespace.
 *
 * Deliberately reads the namespace rather than calling `instrumentRef`, which
 * throws on anything outside the catalog — sector aggregates are legitimate
 * observation symbols and have no catalog entry. A total function is required
 * here: an unrecognised symbol must degrade to a conservative answer, not an
 * exception in a disclosure path.
 */
export function horizonFor(symbol: CanonicalSymbol | null | undefined): FreshnessHorizon {
  if (!symbol) return INTRADAY
  const namespace = symbol.slice(0, symbol.indexOf(':'))
  switch (namespace) {
    case 'idx':
    case 'eq':
    case 'sector':
      return INTRADAY
    case 'cmd':
      return COMMODITY
    case 'crypto':
      return CONTINUOUS
    case 'fx':
    case 'rate':
      return DAILY
    default:
      /* Unknown namespace: the shortest horizon, so we under-claim. */
      return INTRADAY
  }
}

export type ObservationFreshness = 'current' | 'stale'

/**
 * Whether the observation itself is still current for its market.
 *
 * Nothing about how it was delivered enters here. A value served from cache
 * under stale-while-revalidate and a value fetched a moment ago get the same
 * answer if their observations are the same age, because they describe the
 * market equally well.
 *
 * The ordering of the rules matters:
 *
 *  1. **Quality first.** An `official-daily` or `eod` observation is not an
 *     intraday quote running late; it is a different kind of fact, correct
 *     until the next publication. Judging a Treasury par yield against a
 *     fifteen-minute horizon would report a perfectly current figure as stale
 *     every afternoon.
 *  2. **Closed and extended sessions** get the long allowance, because the
 *     latest valid close remains the right observation until trading resumes.
 *  3. **Open, or unknown,** gets the intraday horizon. `unknown` is grouped
 *     with open deliberately: we cannot prove the venue is shut, and granting
 *     the multi-day closed allowance on an unproven assumption is how a dead
 *     feed goes unreported.
 */
export function observationFreshness(input: {
  quality: Quality
  session: SessionState
  ageMs: number
  horizon: FreshnessHorizon
}): ObservationFreshness {
  const { quality, session, ageMs, horizon } = input

  if (quality === 'official-daily' || quality === 'eod') {
    /* Strict: at the horizon the observation is stale, not current. */
    return ageMs < horizon.maxAgeClosedMs ? 'current' : 'stale'
  }

  /*
   * `pre-market` and `after-hours` take the closed allowance rather than the
   * intraday one.
   *
   * The reason is a modelling gap, recorded here rather than papered over: a
   * `MarketQuote` says which session is running, but nothing on it says which
   * session the OBSERVATION belongs to. When a provider serves the last
   * regular-session close during extended hours — which is what both current
   * providers do, neither publishing an extended-hours index level — treating
   * it as an intraday observation would age out a perfectly valid close
   * fifteen minutes after the bell.
   *
   * If a provider is ever bound that supplies extended-hours observations and
   * identifies them as such, the model needs a field for it and this branch
   * needs revisiting. Until then the conservative reading is the honest one.
   */
  const closedAllowance =
    session === 'closed' || session === 'pre-market' || session === 'after-hours'

  const limit = closedAllowance ? horizon.maxAgeClosedMs : horizon.maxAgeOpenMs
  /*
   * Strictly less than. Reaching the horizon exactly means the observation has
   * used up its whole allowance, so 30m00s on a commodity is stale rather than
   * current. The boundary is uniform across every class; only the limit differs.
   */
  return ageMs < limit ? 'current' : 'stale'
}
