/**
 * The `derived` provider — Cross-Asset Risk Appetite.
 *
 * The first Financial OS observation that is **computed rather than obtained**.
 * Everything else in this directory adapts somebody's published number; this
 * one produces a number nobody publishes, from three markets that do.
 *
 * ## What it must never become
 *
 * `quality: 'derived'` is a real quality with real consequences, and the one
 * thing this provider may never do is let arithmetic launder invented inputs
 * into apparent market data. Three rules enforce that, and all three fail
 * closed:
 *
 *   history too short   -> `InsufficientHistoryError`, no score
 *   inputs incoherent   -> no new score
 *   any fixture input   -> the composite degrades to `quality: 'fixture'`
 *
 * A missing score is the correct output when the evidence is missing. The
 * chain then falls through to fixture and the disclosure layer says
 * EJ MARKNADSDATA, which is the honest answer.
 *
 * ## Why the score is built from session closes
 *
 * Cross-Asset Risk Appetite is a US-session measure. Its three legs stop
 * publishing at different moments — the credit ETFs at the equity close, VIX
 * fifteen minutes later, USDJPY not at all — so the only instant at which all
 * three describe the same completed session is that session's closes.
 *
 * This is also what stops overnight FX mutating the composite: USDJPY keeps
 * trading, but the last *aligned* observation does not move until the next
 * session closes, so the score is frozen by construction rather than by a
 * timer.
 */

import {
  buildRiskAppetite,
  coherence,
  labelForScore,
  RISK_APPETITE_METHODOLOGY,
  SENTIMENT_BASELINE,
  type DataSourceMetadata,
  type MarketSentiment,
  type SentimentComponent,
} from '~/domain/market'
import type { FetchContext, SentimentProvider } from '~/application/marketData/ports'
import {
  transformLegs,
  RISK_APPETITE_CHANGE_HORIZON_DAYS,
  type RiskAppetiteHistory,
} from '~/application/marketData/riskAppetiteTransform'
import { HttpError, type HttpClient } from './httpClient'
import { fetchDailyHistory } from './yahoo'

export const DERIVED_PROVIDER_ID = 'derived'

export const DERIVED_SOURCE: DataSourceMetadata = {
  providerId: DERIVED_PROVIDER_ID,
  providerName: 'Financial OS',
  /*
   * `derived` trust, tier 4. Weaker than every route it consumes, which is
   * correct: a computed figure inherits the weakness of its inputs and adds a
   * methodology of our own on top.
   */
  trust: 'derived',
  licenseNote:
    'Beräknad av Financial OS enligt ' +
    `${RISK_APPETITE_METHODOLOGY}. Ingen marknadsplats publicerar detta värde.`,
}

/**
 * The four series behind the three legs.
 *
 * `adjusted` is per instrument and is not a preference. HYG and LQD distribute
 * monthly, so their unadjusted closes step down twelve times a year for
 * reasons that have nothing to do with credit. An index and an FX pair have
 * nothing to adjust.
 */
const SERIES = [
  { key: 'vix', symbol: '^VIX', adjusted: false },
  { key: 'hyg', symbol: 'HYG', adjusted: true },
  { key: 'lqd', symbol: 'LQD', adjusted: true },
  { key: 'usdjpy', symbol: 'USDJPY=X', adjusted: false },
] as const

/**
 * Two years of raw history to obtain 252 aligned observations.
 *
 * Not a round number: the legs keep different calendars, and one calendar year
 * of raw bars yields only ~223 dates on which all four have an observation.
 * Two years is headroom, and the window is still taken as the trailing 252
 * ALIGNED dates — never as "whatever a year returned".
 */
const HISTORY_RANGE = '2y' as const

export function createDerivedProvider(http: HttpClient): SentimentProvider {
  return {
    id: DERIVED_PROVIDER_ID,
    name: DERIVED_SOURCE.providerName,

    async fetchSentiment(ctx: FetchContext): Promise<MarketSentiment> {
      const loaded = await Promise.all(
        SERIES.map(async (spec) => ({
          key: spec.key,
          bars: await fetchDailyHistory(
            http,
            spec.symbol,
            HISTORY_RANGE,
            spec.adjusted,
            ctx,
          ),
        })),
      )

      const history = Object.fromEntries(
        loaded.map((entry) => [entry.key, entry.bars]),
      ) as unknown as RiskAppetiteHistory

      /*
       * The observation instant of each leg is its own last daily bar. They are
       * deliberately NOT normalised to a common timestamp: the VIX close is
       * genuinely fifteen minutes after the equity close, and inventing a
       * shared instant to satisfy a tolerance would be fabricating the very
       * fact the tolerance exists to check.
       */
      const closeOf = (key: 'vix' | 'hyg' | 'lqd' | 'usdjpy') => {
        const bars = history[key]
        return `${bars[bars.length - 1]!.date}T00:00:00.000Z`
      }

      /*
       * Coherence for a close-based composite is same-session identity: every
       * leg's latest bar must carry the same trading date. The 120 s tolerance
       * governs intraday recomputation, which this version does not perform —
       * it recomputes once per session close.
       */
      const dates = SERIES.map((spec) => {
        const bars = history[spec.key]
        return bars[bars.length - 1]!.date
      })
      const spread = coherence(dates.map((date) => `${date}T00:00:00.000Z`))
      if (!spread.coherent) {
        throw new HttpError(
          'schema',
          `Cross-Asset Risk Appetite constituents are from different sessions ` +
            `(${dates.join(', ')}). Refusing to combine observations that do not ` +
            `describe the same market moment.`,
        )
      }

      const asOf = closeOf('vix')
      const legs = transformLegs(
        history,
        {
          vix: { asOf, quality: 'delayed' },
          credit: { asOf: closeOf('hyg'), quality: 'delayed' },
          fx: { asOf: closeOf('usdjpy'), quality: 'delayed' },
        },
        RISK_APPETITE_CHANGE_HORIZON_DAYS,
      )

      const composite = buildRiskAppetite({
        legs,
        /*
         * `closed`: this is the last complete reading of the most recent
         * common session. The frozen freshness policy gives a closed session
         * the long allowance, so the reading is retained overnight and across
         * a weekend instead of being called stale fifteen minutes after the
         * bell.
         */
        session: 'closed',
        nowMs: ctx.clock.now().getTime(),
        source: DERIVED_SOURCE,
        /* Built from session closes: the date is real, the time of day is not. */
        asOfPrecision: 'date',
      })

      /*
       * Projected onto `MarketSentiment`, which is what the snapshot and the
       * surface already consume. The mapping is arithmetic, not a
       * reinterpretation: with equal weights, a leg's contribution to the
       * headline is exactly its distance from the baseline divided by three,
       * and the three contributions plus the baseline reproduce the composite.
       */
      const components: SentimentComponent[] = composite.legs.map((leg) => ({
        id: leg.id,
        label: leg.label,
        contribution: (leg.score - SENTIMENT_BASELINE) / composite.legs.length,
        inputValue: leg.score,
        inputAsOf: leg.inputAsOf,
        inputQuality: leg.inputQuality,
        isProxy: leg.isProxy,
        proxyNote: leg.proxyNote,
      }))

      return {
        score: composite.score,
        label: labelForScore(composite.score),
        origin: composite.provenance.quality === 'fixture' ? 'fixture' : 'derived',
        components,
        formulaVersion: composite.methodology,
        /* Kept beside the score, never folded into it. */
        dispersion: composite.dispersion,
        session: composite.session,
        provenance: composite.provenance,
      }
    },
  }
}
