/**
 * Deutsche Bundesbank — daily term-structure estimates for Federal securities.
 *
 * Keyless, official, `trust: 'central-bank'`.
 *
 * ## Methodology, and why it is not a par yield
 *
 * The BBSIS series is the **Svensson-fitted zero-coupon (spot) rate** for
 * listed Federal securities at a given residual maturity —
 * "Zinsstrukturkurve (Svensson-Methode) / Börsennotierte Bundeswertpapiere".
 * That is a different measure from the US Treasury's par yield: one is a
 * fitted spot rate, the other the coupon at which a bond prices at par.
 * `methodology: 'zero-coupon-fitted'` records it, and the curve builder will
 * refuse to plot the two together.
 *
 * ## Payload traps
 *
 *  - `;`-delimited CSV with metadata rows before the data
 *  - **comma decimal separator** (`3,24`)
 *  - non-publication days appear as `.` with "Kein Wert vorhanden" and must be
 *    SKIPPED — reading one as zero would invent a 0.00% yield
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

export const BUNDESBANK_PROVIDER_ID = 'bundesbank'

export const BUNDESBANK_SOURCE: DataSourceMetadata = {
  providerId: BUNDESBANK_PROVIDER_ID,
  providerName: 'Deutsche Bundesbank',
  attributionUrl: 'https://www.bundesbank.de/en/statistics/time-series-databases',
  licenseNote:
    'Term structure of interest rates (Svensson method) on listed Federal securities',
  trust: 'central-bank',
}

const BASE_URL = 'https://api.statistiken.bundesbank.de/rest/data/BBSIS'
const EUR = isoCurrency('EUR')

/** Canonical symbol → BBSIS key and maturity. The key IS the series identity. */
const SERIES: Record<string, { key: string; maturity: Maturity }> = {
  'rate:de10y': {
    key: 'D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A',
    maturity: '10Y',
  },
}

function seriesFor(symbol: CanonicalSymbol) {
  const entry = SERIES[symbol]
  if (!entry) throw new HttpError('not-found', `Bundesbank has no series for ${symbol}`)
  return entry
}

/* ------------------------------------------------------------ wire parsing */

interface Observation {
  date: string
  value: number
}

/**
 * Parses the Bundesbank CSV.
 *
 * Rows are `date;value;flags`. Only rows whose first field is a real date and
 * whose value parses as a number are kept, which naturally discards both the
 * metadata header block and the `.` placeholders for non-publication days.
 */
export function parseBundesbankCsv(csv: string): Observation[] {
  const observations: Observation[] = []
  for (const line of csv.split(/\r?\n/)) {
    const [rawDate, rawValue] = line.split(';')
    if (!rawDate || !rawValue) continue
    const date = rawDate.trim().replace(/^"|"$/g, '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    // German decimal comma. A `.` placeholder becomes NaN and is dropped.
    const value = Number(rawValue.trim().replace(',', '.'))
    if (!Number.isFinite(value)) continue
    observations.push({ date, value })
  }
  return observations.sort((a, b) => a.date.localeCompare(b.date))
}

/* ---------------------------------------------------------------- provider */

const LOOKBACK_DAYS = 14

export function createBundesbankProvider(http: HttpClient): YieldProvider {
  return {
    id: BUNDESBANK_PROVIDER_ID,
    name: BUNDESBANK_SOURCE.providerName,
    attributionUrl: BUNDESBANK_SOURCE.attributionUrl,

    async fetchYields(symbols, ctx): Promise<GovernmentYield[]> {
      const from = new Date(ctx.clock.epochMs() - LOOKBACK_DAYS * 86_400_000)
      const startPeriod = from.toISOString().slice(0, 10)

      return Promise.all(
        symbols.map(async (symbol) => {
          const { key, maturity } = seriesFor(symbol)
          const csv = await http.getText(
            `${BASE_URL}/${key}?startPeriod=${startPeriod}&format=csv`,
            ctx.signal,
          )
          const observations = parseBundesbankCsv(csv)
          const latest = observations.at(-1)
          if (!latest) {
            throw new HttpError(
              'schema',
              `Bundesbank returned no observation for ${symbol}`,
            )
          }
          const previous = observations.at(-2)
          const now = ctx.clock.now()
          const asOf = `${latest.date}T00:00:00.000Z`

          return buildYield({
            symbol,
            countryCode: 'DE',
            currency: EUR,
            maturity,
            seriesId: key,
            // A fitted spot rate, NOT a par yield.
            methodology: 'zero-coupon-fitted',
            observationDate: latest.date,
            yieldPercent: latest.value,
            previousYieldPercent: previous?.value ?? null,
            provenance: {
              asOf,
              asOfPrecision: 'date',
              sourceDate: latest.date,
              receivedAt: now.toISOString(),
              ageMs: Math.max(0, now.getTime() - Date.parse(asOf)),
              source: BUNDESBANK_SOURCE,
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
