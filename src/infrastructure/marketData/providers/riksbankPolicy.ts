/**
 * Sveriges Riksbank — the Swedish policy rate.
 *
 * Keyless, via the same SWEA API the yield adapter already uses, and the
 * contrast between the two is the clearest argument for keeping the domains
 * apart:
 *
 *   `riksbank.ts`        SEGVB10YC, a MARKET yield, originated by Refinitiv,
 *                        so `originatorTrust: 'licensed-vendor'`
 *   this adapter         SECBREPOEFF, the Riksbank's OWN policy decision, so
 *                        no originator at all
 *
 * Same API, same transport, same trust tier for the route — and two domain
 * types that cannot be substituted for one another.
 *
 * ## Carry-forward
 *
 * A **bank-day** series, unlike the ECB's calendar-day one. Probed on
 * 2026-07-26: 287 observations over roughly fourteen months, containing three
 * changes, the last on 2025-10-01. The latest observation was 2026-07-24, a
 * Friday — nearly ten months after the rate actually moved.
 *
 * ## What is deliberately absent
 *
 *  - **Corridor rates.** SWEA's own description states the deposit and lending
 *    rates are always policy ∓ 0.75pp. They are defined by rule, not observed
 *    independently, so `RiksbankPolicyState` gives them nowhere to live.
 *  - **The forecast rate path.** The Riksbank is alone among the three in
 *    publishing a projection of its own future policy rate. It is a forecast,
 *    not an observation, and it must never enter this model.
 *  - **Meeting dates.** SWEA's `CalendarDays` endpoint reports Swedish BANK
 *    days. It is used here only to decide whether a publication was owed; it
 *    is not a monetary-policy calendar and says nothing about decisions.
 */

import { isoCurrency } from '~/domain/shared/primitives'
import type { DataSourceMetadata } from '~/domain/shared/provenance'
import {
  detectRegime,
  riksbankPublicationStatus,
  singleRate,
  type LevelObservation,
  type RiksbankPolicyState,
} from '~/domain/policy'
import type { FetchContext, PolicyRateProvider } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'

export const RIKSBANK_POLICY_PROVIDER_ID = 'riksbank-policy'

export const RIKSBANK_POLICY_SOURCE: DataSourceMetadata = {
  providerId: RIKSBANK_POLICY_PROVIDER_ID,
  providerName: 'Sveriges Riksbank (SWEA)',
  attributionUrl: 'https://www.riksbank.se/en-gb/statistics/',
  licenseNote: 'Swedish policy rate, set and published by the Riksbank',
  // The Riksbank sets its own policy rate. No originator, unlike the yield
  // series on this same API.
  trust: 'central-bank',
}

const SEK = isoCurrency('SEK')
const BASE_URL = 'https://api.riksbank.se/swea/v1'

export const RIKSBANK_POLICY_SERIES_ID = 'SECBREPOEFF'

/** Five years. An implementation limit, not a claim about the regime. */
export const LOOKBACK_DAYS = 5 * 365

/** A bank-day series: a weekend or a bank holiday is not a hole. */
const MAX_EXPECTED_GAP_DAYS = 5

/* ------------------------------------------------------------ wire contract */

interface SweaObservation {
  date?: unknown
  value?: unknown
}

interface SweaCalendarDay {
  calendarDate?: unknown
  swedishBankday?: unknown
}

export function parseSweaObservations(payload: unknown): LevelObservation[] {
  if (!Array.isArray(payload)) return []
  const levels: LevelObservation[] = []
  for (const row of payload as SweaObservation[]) {
    const date = row?.date
    const value = row?.value
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    levels.push({ date, level: singleRate(value) })
  }
  return levels.sort((a, b) => a.date.localeCompare(b.date))
}

export function parseBankDays(payload: unknown): string[] {
  if (!Array.isArray(payload)) return []
  return (payload as SweaCalendarDay[])
    .filter((row) => row?.swedishBankday === true)
    .map((row) => String(row.calendarDate))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
}

/* ---------------------------------------------------------------- provider */

export function createRiksbankPolicyProvider(http: HttpClient): PolicyRateProvider {
  return {
    id: RIKSBANK_POLICY_PROVIDER_ID,
    name: RIKSBANK_POLICY_SOURCE.providerName,
    attributionUrl: RIKSBANK_POLICY_SOURCE.attributionUrl,

    async fetchPolicyState(ctx: FetchContext): Promise<RiksbankPolicyState> {
      const now = ctx.clock.now()
      const today = now.toISOString().slice(0, 10)
      const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10)

      const payload = await http.getJson<unknown>(
        `${BASE_URL}/Observations/${RIKSBANK_POLICY_SERIES_ID}/${from}/${today}`,
        ctx.signal,
      )
      const levels = parseSweaObservations(payload)
      if (levels.length === 0) {
        throw new HttpError('schema', 'Riksbank returned no policy-rate observation')
      }

      const regime = detectRegime(levels, MAX_EXPECTED_GAP_DAYS)

      /*
       * The bank-day calendar is an ENRICHMENT, not a dependency. If it fails
       * we report `cadence-unknown` rather than losing the rate or, worse,
       * inventing a publication that was never owed.
       */
      let bankDays: string[] | null = null
      try {
        const calendar = await http.getJson<unknown>(
          `${BASE_URL}/CalendarDays/${regime.observationDate}`,
          ctx.signal,
        )
        bankDays = parseBankDays(calendar)
      } catch {
        bankDays = null
      }

      const asOf = `${regime.observationDate}T00:00:00.000Z`

      return {
        centralBank: 'riksbank',
        jurisdiction: 'Sweden',
        currency: SEK,
        rateType: 'policy-rate',
        seriesId: RIKSBANK_POLICY_SERIES_ID,
        regime,
        publication: riksbankPublicationStatus(regime.observationDate, today, bankDays),
        provenance: {
          asOf,
          asOfPrecision: 'date',
          sourceDate: regime.observationDate,
          receivedAt: now.toISOString(),
          ageMs: Math.max(0, now.getTime() - Date.parse(asOf)),
          source: RIKSBANK_POLICY_SOURCE,
          quality: 'official-daily',
          isDelayed: false,
          delayMinutes: null,
          isProxy: false,
        },
      }
    },
  }
}
