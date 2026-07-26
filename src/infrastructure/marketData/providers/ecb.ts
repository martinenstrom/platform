/**
 * European Central Bank — the three key interest rates.
 *
 * Keyless SDMX from the ECB Data Portal. The ECB both sets and publishes these
 * rates, so it is access provider and originator at once and no separate
 * originator is recorded.
 *
 * ## The carry-forward trap, measured
 *
 * These are **calendar-day** series that repeat the standing value every day,
 * weekends included. Probed on 2026-07-26: 400 consecutive daily observations
 * contained exactly **two** value changes, and the latest observation was
 * dated 2026-07-26 — a Sunday — while the rate had last moved on 2026-06-17,
 * thirty-nine days earlier.
 *
 * Reading the observation date as the effective date would therefore have
 * manufactured a policy decision every single day, including weekends. The
 * effective date is found by scanning the history for the last actual change;
 * the observation date only ever says when the ECB last confirmed the state.
 *
 * ## Three rates, independently
 *
 * The deposit facility rate is the stance indicator under the current
 * operational framework, but all three are fetched and retained separately: a
 * corridor can narrow without the deposit rate moving at all, and a comparison
 * on the headline rate alone would miss it.
 *
 * ## Wire format
 *
 * `format=csvdata` returns one flat row per observation with a full metadata
 * header. Cheaper and safer to parse than the default SDMX-JSON, whose
 * observations are positional arrays keyed by index.
 */

import { isoCurrency } from '~/domain/shared/primitives'
import type { DataSourceMetadata } from '~/domain/shared/provenance'
import {
  detectRegime,
  ecbPublicationStatus,
  keyRates,
  type EcbPolicyState,
  type LevelObservation,
} from '~/domain/policy'
import type { FetchContext, PolicyRateProvider } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'

export const ECB_PROVIDER_ID = 'ecb'

export const ECB_SOURCE: DataSourceMetadata = {
  providerId: ECB_PROVIDER_ID,
  providerName: 'European Central Bank',
  attributionUrl: 'https://data.ecb.europa.eu',
  licenseNote: 'ECB Data Portal — key interest rates (FM dataflow)',
  // Sets the rates and publishes them. No separate originator.
  trust: 'central-bank',
}

const EUR = isoCurrency('EUR')
const BASE_URL = 'https://data-api.ecb.europa.eu/service/data/FM'

/** The three official key rates. The key IS the series identity. */
export const ECB_SERIES = {
  depositFacility: 'D.U2.EUR.4F.KR.DFR.LEV',
  mainRefinancing: 'D.U2.EUR.4F.KR.MRR_FR.LEV',
  marginalLending: 'D.U2.EUR.4F.KR.MLFR.LEV',
} as const

export const ECB_SERIES_ID = Object.values(ECB_SERIES).join(' + ')

/** Five years of calendar days. An implementation limit, not a claim. */
export const LOOKBACK_OBSERVATIONS = 1830

/** A calendar-day series: any missing day is a genuine hole. */
const MAX_EXPECTED_GAP_DAYS = 1

/* ------------------------------------------------------------ wire parsing */

/**
 * Extracts `TIME_PERIOD` and `OBS_VALUE` from the CSV.
 *
 * Column positions are resolved from the header rather than assumed, because
 * the metadata block around them is wide and has changed shape before.
 */
export function parseEcbCsv(csv: string): Array<{ date: string; value: number }> {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '')
  const header = lines.shift()
  if (!header) return []
  const columns = header.split(',')
  const dateAt = columns.indexOf('TIME_PERIOD')
  const valueAt = columns.indexOf('OBS_VALUE')
  if (dateAt === -1 || valueAt === -1) return []

  const observations: Array<{ date: string; value: number }> = []
  for (const line of lines) {
    const cells = line.split(',')
    const date = cells[dateAt]?.trim()
    const raw = cells[valueAt]?.trim()
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (raw === undefined || raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    observations.push({ date, value })
  }
  return observations.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Aligns the three series onto the dates where ALL THREE are present.
 *
 * A level is a structure of three rates; a date holding only two of them
 * cannot describe one. Dropping those dates is safer than carrying a stale
 * component forward, which would invent a corridor that never existed.
 */
export function alignKeyRates(
  deposit: Array<{ date: string; value: number }>,
  main: Array<{ date: string; value: number }>,
  marginal: Array<{ date: string; value: number }>,
): LevelObservation[] {
  const byDate = (rows: Array<{ date: string; value: number }>) =>
    new Map(rows.map((row) => [row.date, row.value]))
  const mainByDate = byDate(main)
  const marginalByDate = byDate(marginal)

  const levels: LevelObservation[] = []
  for (const row of deposit) {
    const mainValue = mainByDate.get(row.date)
    const marginalValue = marginalByDate.get(row.date)
    if (mainValue === undefined || marginalValue === undefined) continue
    levels.push({
      date: row.date,
      level: keyRates(row.value, mainValue, marginalValue),
    })
  }
  return levels
}

/* ---------------------------------------------------------------- provider */

export function createEcbProvider(http: HttpClient): PolicyRateProvider {
  return {
    id: ECB_PROVIDER_ID,
    name: ECB_SOURCE.providerName,
    attributionUrl: ECB_SOURCE.attributionUrl,

    async fetchPolicyState(ctx: FetchContext): Promise<EcbPolicyState> {
      const fetchSeries = async (key: string) => {
        const csv = await http.getText(
          `${BASE_URL}/${key}?lastNObservations=${LOOKBACK_OBSERVATIONS}&format=csvdata&detail=dataonly`,
          ctx.signal,
        )
        return parseEcbCsv(csv)
      }

      const [deposit, main, marginal] = await Promise.all([
        fetchSeries(ECB_SERIES.depositFacility),
        fetchSeries(ECB_SERIES.mainRefinancing),
        fetchSeries(ECB_SERIES.marginalLending),
      ])

      const levels = alignKeyRates(deposit, main, marginal)
      if (levels.length === 0) {
        throw new HttpError(
          'schema',
          'ECB returned no date on which all three key rates were present',
        )
      }

      const regime = detectRegime(levels, MAX_EXPECTED_GAP_DAYS)
      const now = ctx.clock.now()
      const asOf = `${regime.observationDate}T00:00:00.000Z`

      return {
        centralBank: 'ecb',
        jurisdiction: 'Euro area',
        currency: EUR,
        rateType: 'key-rates',
        seriesId: ECB_SERIES_ID,
        regime,
        publication: ecbPublicationStatus(
          regime.observationDate,
          now.toISOString().slice(0, 10),
        ),
        // Recorded for later presentation. All three stay independent above.
        primaryRate: 'deposit-facility',
        provenance: {
          asOf,
          asOfPrecision: 'date',
          sourceDate: regime.observationDate,
          receivedAt: now.toISOString(),
          ageMs: Math.max(0, now.getTime() - Date.parse(asOf)),
          source: ECB_SOURCE,
          quality: 'official-daily',
          isDelayed: false,
          delayMinutes: null,
          isProxy: false,
        },
      }
    },
  }
}
