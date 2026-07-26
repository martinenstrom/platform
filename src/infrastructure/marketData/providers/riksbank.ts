/**
 * Sveriges Riksbank (SWEA API) — Swedish government bond yields.
 *
 * Keyless. The Riksbank is a central bank, **but it is not the originator of
 * these numbers**: the SWEA series metadata names `source: "Refinitiv"`. The
 * Riksbank is the access route; Refinitiv produced the data.
 *
 * That distinction is recorded rather than glossed over —
 * `trust: 'central-bank'` for the route, `originatorTrust: 'licensed-vendor'`
 * for the origin — and `effectiveTrust` therefore reports vendor grade.
 * Republishing does not upgrade a vendor series, exactly as consuming an
 * exchange's prices through a chart vendor does not make the vendor their
 * origin.
 *
 * ## Methodology
 *
 * `SEGVB10YC` is "Swedish Government Bond, maturity 10 years" — a generic
 * benchmark yield, not a par yield, not a fitted zero rate, and not a quote
 * for one identified bond. `methodology: 'benchmark-bond-yield'`.
 *
 * ## Deliberately not used for Germany
 *
 * SWEA also carries `DEGVB10Y`. It is **not** wired as a German fallback: its
 * methodology differs from the Bundesbank's fitted zero rate, and silently
 * substituting one for the other is precisely what the methodology type exists
 * to prevent.
 */

import {
  buildYield,
  isoCurrency,
  type CanonicalSymbol,
  type DataSourceMetadata,
  type GovernmentYield,
  type Maturity,
} from '~/domain/market'
import type { YieldProvider } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'

export const RIKSBANK_PROVIDER_ID = 'riksbank'

export const RIKSBANK_SOURCE: DataSourceMetadata = {
  providerId: RIKSBANK_PROVIDER_ID,
  providerName: 'Sveriges Riksbank (SWEA)',
  attributionUrl: 'https://www.riksbank.se/en-gb/statistics/',
  licenseNote: 'Swedish government bond yields, series sourced from Refinitiv',
  // The route is a central bank; the numbers are a vendor's.
  originator: 'Refinitiv',
  trust: 'central-bank',
  originatorTrust: 'licensed-vendor',
}

const BASE_URL = 'https://api.riksbank.se/swea/v1'
const SEK = isoCurrency('SEK')

/** Canonical symbol → SWEA series id and maturity. */
const SERIES: Record<string, { seriesId: string; maturity: Maturity }> = {
  'rate:se10y': { seriesId: 'SEGVB10YC', maturity: '10Y' },
}

function seriesFor(symbol: CanonicalSymbol) {
  const entry = SERIES[symbol]
  if (!entry) throw new HttpError('not-found', `Riksbank has no series for ${symbol}`)
  return entry
}

/* ------------------------------------------------------------ wire contract */

interface SweaObservation {
  date: string
  value: number
}

function isObservationList(value: unknown): value is SweaObservation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SweaObservation).date === 'string' &&
        typeof (entry as SweaObservation).value === 'number',
    )
  )
}

/* ---------------------------------------------------------------- provider */

const LOOKBACK_DAYS = 14

export function createRiksbankProvider(http: HttpClient): YieldProvider {
  return {
    id: RIKSBANK_PROVIDER_ID,
    name: RIKSBANK_SOURCE.providerName,
    attributionUrl: RIKSBANK_SOURCE.attributionUrl,

    async fetchYields(symbols, ctx): Promise<GovernmentYield[]> {
      const now = ctx.clock.now()
      const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const to = now.toISOString().slice(0, 10)

      return Promise.all(
        symbols.map(async (symbol) => {
          const { seriesId, maturity } = seriesFor(symbol)
          const payload = await http.getJson<unknown>(
            `${BASE_URL}/Observations/${seriesId}/${from}/${to}`,
            ctx.signal,
          )
          if (!isObservationList(payload)) {
            throw new HttpError(
              'schema',
              `Riksbank returned an unexpected shape for ${symbol}`,
            )
          }

          const observations = [...payload].sort((a, b) => a.date.localeCompare(b.date))
          const latest = observations.at(-1)
          if (!latest) {
            throw new HttpError(
              'schema',
              `Riksbank returned no observation for ${symbol}`,
            )
          }
          const previous = observations.at(-2)
          const asOf = `${latest.date}T00:00:00.000Z`

          return buildYield({
            symbol,
            countryCode: 'SE',
            currency: SEK,
            maturity,
            seriesId,
            methodology: 'benchmark-bond-yield',
            observationDate: latest.date,
            yieldPercent: latest.value,
            previousYieldPercent: previous?.value ?? null,
            provenance: {
              asOf,
              asOfPrecision: 'date',
              sourceDate: latest.date,
              receivedAt: now.toISOString(),
              ageMs: Math.max(0, now.getTime() - Date.parse(asOf)),
              source: RIKSBANK_SOURCE,
              quality: 'official-daily',
              isDelayed: false,
              delayMinutes: null,
              isProxy: false,
            },
          })
        }),
      )
    },
  }
}
