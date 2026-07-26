/**
 * Federal Reserve Bank of New York — the FOMC target range and the effective
 * federal funds rate.
 *
 * Keyless. One payload carries both, clearly separated, which is why no FRED
 * dependency is needed for Phase 6A.
 *
 * ## Access provider and originator
 *
 * The New York Fed operates the desk and publishes the numbers; the **FOMC**
 * sets the target range. Both are central-bank grade, so `effectiveTrust` is
 * unaffected, but the originator is recorded anyway — the desk is reporting a
 * decision it did not make.
 *
 * ## The two rates are not the same measure
 *
 *   `targetRateFrom` / `targetRateTo`   what the FOMC decided
 *   `percentRate`                       where the market actually traded
 *
 * The effective rate sits inside the range and moves daily. It is carried as a
 * separate observation and is NEVER used as the current or previous target
 * level — reading 3.63 % as "the policy rate" would report a market outcome as
 * a policy decision.
 *
 * ## Dates
 *
 * `effectiveDate` in the payload is the date the rate applied, at date-only
 * precision — there is no intraday timestamp. It is also the date the target
 * range took effect, which is the day AFTER the FOMC announcement. The
 * announcement date is not in this feed and is therefore not reported at all.
 */

import { isoCurrency } from '~/domain/shared/primitives'
import type { DataSourceMetadata } from '~/domain/shared/provenance'
import {
  detectRegime,
  type CentralBankId,
  newYorkFedPublicationStatus,
  policyRatePercent,
  targetRange,
  type FederalReservePolicyState,
  type LevelObservation,
} from '~/domain/policy'
import type { FetchContext, PolicyRateProvider } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'

export const NY_FED_PROVIDER_ID = 'nyfed'

export const NY_FED_SOURCE: DataSourceMetadata = {
  providerId: NY_FED_PROVIDER_ID,
  providerName: 'Federal Reserve Bank of New York',
  attributionUrl: 'https://markets.newyorkfed.org/static/docs/markets-api.html',
  licenseNote: 'Reference rates published by the New York Fed markets desk',
  // The desk publishes; the committee decides.
  originator: 'Federal Open Market Committee',
  trust: 'central-bank',
  originatorTrust: 'central-bank',
}

const USD = isoCurrency('USD')
export const NY_FED_SERIES_ID = 'EFFR'

/**
 * The approved five-year lookback, in days.
 *
 * An IMPLEMENTATION LIMIT, not a claim that the current regime began inside
 * it: when no transition is found, the effective date is reported as `null`.
 *
 * The date-range `search` endpoint is used rather than `last/{n}`, which is
 * count-indexed and rejects large counts — `last/500` succeeds and `last/1000`
 * returns HTTP 400, so a count-based five-year window is not available.
 */
export const LOOKBACK_DAYS = 5 * 365

/** A US business-day series; a weekend gap is not a hole. */
const MAX_EXPECTED_GAP_DAYS = 4

/* ------------------------------------------------------------ wire contract */

interface NyFedRefRate {
  effectiveDate?: unknown
  type?: unknown
  percentRate?: unknown
  targetRateFrom?: unknown
  targetRateTo?: unknown
}

interface NyFedPayload {
  refRates?: unknown
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isoDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/**
 * Keeps only rows that carry a complete target range.
 *
 * A row missing a bound cannot describe a range, and inventing the other half
 * from `percentRate` would put a traded outcome where a decision belongs.
 */
export function parseNyFedRefRates(payload: NyFedPayload): {
  levels: LevelObservation[]
  effective: Array<{ date: string; ratePercent: number }>
} {
  const rows = Array.isArray(payload?.refRates)
    ? (payload.refRates as NyFedRefRate[])
    : []
  const levels: LevelObservation[] = []
  const effective: Array<{ date: string; ratePercent: number }> = []

  for (const row of rows) {
    if (row?.type !== 'EFFR') continue
    const date = isoDate(row.effectiveDate)
    if (!date) continue

    const lower = finite(row.targetRateFrom)
    const upper = finite(row.targetRateTo)
    if (lower !== null && upper !== null && upper >= lower) {
      levels.push({ date, level: targetRange(lower, upper) })
    }

    const rate = finite(row.percentRate)
    if (rate !== null) effective.push({ date, ratePercent: rate })
  }

  levels.sort((a, b) => a.date.localeCompare(b.date))
  effective.sort((a, b) => a.date.localeCompare(b.date))
  return { levels, effective }
}

/* ---------------------------------------------------------------- provider */

export function createNewYorkFedProvider(http: HttpClient): PolicyRateProvider {
  return {
    id: NY_FED_PROVIDER_ID,
    name: NY_FED_SOURCE.providerName,
    attributionUrl: NY_FED_SOURCE.attributionUrl,

    async fetchPolicyState(
      centralBank: CentralBankId,
      ctx: FetchContext,
    ): Promise<FederalReservePolicyState> {
      // This adapter serves one institution. Being asked for another is a
      // chain misconfiguration, not something to answer approximately.
      if (centralBank !== 'federal-reserve') {
        throw new HttpError(
          'not-found',
          `federal-reserve adapter cannot serve ${centralBank}`,
        )
      }

      const now = ctx.clock.now()
      const today = now.toISOString().slice(0, 10)
      const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10)

      const payload = await http.getJson<NyFedPayload>(
        `https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json` +
          `?startDate=${from}&endDate=${today}`,
        ctx.signal,
      )
      const { levels, effective } = parseNyFedRefRates(payload)
      if (levels.length === 0) {
        throw new HttpError('schema', 'New York Fed returned no usable target range')
      }

      const regime = detectRegime(levels, MAX_EXPECTED_GAP_DAYS)
      const asOf = `${regime.observationDate}T00:00:00.000Z`
      const latestEffective = effective.at(-1)

      return {
        centralBank: 'federal-reserve',
        jurisdiction: 'United States',
        currency: USD,
        rateType: 'target-range',
        seriesId: NY_FED_SERIES_ID,
        regime,
        publication: newYorkFedPublicationStatus(regime.observationDate, today),
        effectiveFedFundsRate: latestEffective
          ? {
              ratePercent: policyRatePercent(latestEffective.ratePercent),
              observationDate: latestEffective.date,
            }
          : null,
        provenance: {
          asOf,
          // Date-only: the payload carries no intraday timestamp.
          asOfPrecision: 'date',
          sourceDate: regime.observationDate,
          receivedAt: now.toISOString(),
          ageMs: Math.max(0, now.getTime() - Date.parse(asOf)),
          source: NY_FED_SOURCE,
          quality: 'official-daily',
          isDelayed: false,
          delayMinutes: null,
          isProxy: false,
        },
      }
    },
  }
}
