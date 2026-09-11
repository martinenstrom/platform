/**
 * US Treasury — Daily Treasury Par Yield Curve Rates.
 *
 * The strongest provenance available for a US yield: the Treasury issues the
 * securities and publishes the curve itself, so `trust: 'issuer'`. No key, no
 * quota, public domain.
 *
 * ## Methodology
 *
 * These are **par yields** — the coupon at which a security would price at
 * par — derived from bid-side market quotations around 15:30 ET each business
 * day. They are not constant-maturity series (though FRED's DGS series are
 * derived from this same curve), not fitted zero rates, and not individual
 * bond quotes. `methodology: 'par-yield'` records that so nothing downstream
 * can quietly treat them as interchangeable with a different measure.
 *
 * ## What it does NOT do
 *
 *  - does not invent intraday movement: one observation per business day
 *  - does not interpolate a maturity the payload omits
 *  - does not fabricate a publication instant from a publication date
 *  - does not retry, cache or fall back; the pipeline owns those
 */

import {
  buildYield,
  buildYieldCurve,
  type CanonicalSymbol,
  type DataSourceMetadata,
  type GovernmentYield,
  type Maturity,
  type YieldCurve,
} from '~/domain/market'
import { isoCurrency } from '~/domain/market'
import type { FetchContext, YieldProvider } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'

export const US_TREASURY_PROVIDER_ID = 'treasury'

export const US_TREASURY_SOURCE: DataSourceMetadata = {
  providerId: US_TREASURY_PROVIDER_ID,
  providerName: 'U.S. Department of the Treasury',
  attributionUrl:
    'https://home.treasury.gov/resource-center/data-chart-center/interest-rates',
  licenseNote: 'Daily Treasury Par Yield Curve Rates; U.S. Government public domain',
  // Publishes data about instruments it issues itself.
  trust: 'issuer',
}

/**
 * The REAL curve is a different publication, so it carries its own note.
 *
 * Same issuer, same public-domain basis, same endpoint family — but a
 * different series with a different methodology, and inheriting a note that
 * names the *Par Yield* publication would attribute a TIPS observation to a
 * document that does not contain it.
 */
export const US_TREASURY_REAL_SOURCE: DataSourceMetadata = {
  ...US_TREASURY_SOURCE,
  licenseNote:
    'Daily Treasury Par Real Yield Curve Rates (TIPS); U.S. Government public domain',
}

const BASE_URL =
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml'

const USD = isoCurrency('USD')

/* --------------------------------------------------------- series mapping */

/**
 * Canonical symbol → the Treasury's own XML tag and maturity.
 *
 * The tag IS the series identity; a maturity is never inferred from a display
 * label. `BC_1` and `BC_30YEARDISPLAY` appear in the payload and are
 * deliberately absent here — the first is an artefact and the second is a
 * duplicate for presentation.
 */
const SERIES: Array<{ symbol: string; tag: string; maturity: Maturity }> = [
  { symbol: 'rate:us1m', tag: 'BC_1MONTH', maturity: '1M' },
  { symbol: 'rate:us2m', tag: 'BC_2MONTH', maturity: '2M' },
  { symbol: 'rate:us3m', tag: 'BC_3MONTH', maturity: '3M' },
  { symbol: 'rate:us4m', tag: 'BC_4MONTH', maturity: '4M' },
  { symbol: 'rate:us6m', tag: 'BC_6MONTH', maturity: '6M' },
  { symbol: 'rate:us1y', tag: 'BC_1YEAR', maturity: '1Y' },
  { symbol: 'rate:us2y', tag: 'BC_2YEAR', maturity: '2Y' },
  { symbol: 'rate:us3y', tag: 'BC_3YEAR', maturity: '3Y' },
  { symbol: 'rate:us5y', tag: 'BC_5YEAR', maturity: '5Y' },
  { symbol: 'rate:us7y', tag: 'BC_7YEAR', maturity: '7Y' },
  { symbol: 'rate:us10y', tag: 'BC_10YEAR', maturity: '10Y' },
  { symbol: 'rate:us20y', tag: 'BC_20YEAR', maturity: '20Y' },
  { symbol: 'rate:us30y', tag: 'BC_30YEAR', maturity: '30Y' },
]

/**
 * Canonical symbol -> the Treasury's REAL yield tag.
 *
 * A separate table because it is a separate publication with separate tags
 * (`TC_*` rather than `BC_*`) fetched from a separate `data=` parameter. The
 * shapes are identical, which is why one parser serves both.
 *
 * **Five tenors, and the shortest is 5Y.** Probed 2026-08-26: the real curve
 * carries TC_5YEAR, TC_7YEAR, TC_10YEAR, TC_20YEAR and TC_30YEAR and nothing
 * below, because TIPS are not issued at the short end. A 2Y real yield does
 * not exist and no 2Y breakeven can be derived from this source.
 */
const REAL_SERIES: Array<{ symbol: string; tag: string; maturity: Maturity }> = [
  { symbol: 'rate:us5y-real', tag: 'TC_5YEAR', maturity: '5Y' },
  { symbol: 'rate:us7y-real', tag: 'TC_7YEAR', maturity: '7Y' },
  { symbol: 'rate:us10y-real', tag: 'TC_10YEAR', maturity: '10Y' },
  { symbol: 'rate:us20y-real', tag: 'TC_20YEAR', maturity: '20Y' },
  { symbol: 'rate:us30y-real', tag: 'TC_30YEAR', maturity: '30Y' },
]

/** Whether a symbol belongs to the real curve rather than the nominal one. */
export function isRealYieldSymbol(symbol: CanonicalSymbol): boolean {
  return REAL_SERIES.some((candidate) => candidate.symbol === symbol)
}

function seriesFor(symbol: CanonicalSymbol) {
  const entry =
    SERIES.find((candidate) => candidate.symbol === symbol) ??
    REAL_SERIES.find((candidate) => candidate.symbol === symbol)
  if (!entry) {
    throw new HttpError('not-found', `US Treasury has no series for ${symbol}`)
  }
  return entry
}

/* ------------------------------------------------------------ wire parsing */
/* The response shape stays inside this adapter and is never exported.        */

interface TreasuryObservation {
  date: string
  /** Tag → percent. Absent tags are absent, never zero. */
  rates: Record<string, number>
}

/**
 * Extracts observations from the Treasury's OData XML.
 *
 * A deliberate hand-rolled scan rather than an XML dependency: the document is
 * flat, the tags are fixed, and the parse is fully covered by a recorded
 * payload. An empty tag (`<d:BC_2MONTH m:null="true"/>` or an empty element)
 * means the Treasury published no value for that maturity that day, and it is
 * skipped — reading it as zero would invent a 0.00% yield.
 */
function parseTreasuryXml(xml: string): TreasuryObservation[] {
  const entries: TreasuryObservation[] = []
  for (const chunk of xml.split('<entry>').slice(1)) {
    const dateMatch = /<d:NEW_DATE[^>]*>([^<]+)</.exec(chunk)
    if (!dateMatch?.[1]) continue
    const date = dateMatch[1].slice(0, 10)

    const rates: Record<string, number> = {}
    /*
     * Both tables. One payload only ever carries one family — `BC_*` for the
     * nominal curve, `TC_*` for the real one — so scanning for both costs a
     * handful of failed regexes and keeps a single parser honest for both
     * datasets. Iterating only `SERIES` silently returned an empty real curve.
     */
    for (const { tag } of [...SERIES, ...REAL_SERIES]) {
      const match = new RegExp(`<d:${tag}[^>]*>([^<]*)<`).exec(chunk)
      const raw = match?.[1]?.trim()
      if (!raw) continue
      const value = Number(raw)
      if (Number.isFinite(value)) rates[tag] = value
    }
    if (Object.keys(rates).length > 0) entries.push({ date, rates })
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date))
}

/* ------------------------------------------------------------ normalization */

function provenanceFor(observationDate: string, ctx: FetchContext) {
  const now = ctx.clock.now()
  // Midnight UTC of the publication DATE. The Treasury publishes a date, not
  // an instant, so this over-states age by up to a day — the safe direction.
  const asOf = `${observationDate}T00:00:00.000Z`
  return {
    asOf,
    asOfPrecision: 'date' as const,
    sourceDate: observationDate,
    receivedAt: now.toISOString(),
    ageMs: Math.max(0, now.getTime() - Date.parse(asOf)),
    source: US_TREASURY_SOURCE,
    // An official statistic published once per business day: not a market
    // close, and not a real-time feed running behind.
    quality: 'official-daily' as const,
    isDelayed: false,
    delayMinutes: null,
    isProxy: false,
  }
}

function toYield(
  symbol: CanonicalSymbol,
  observations: TreasuryObservation[],
  ctx: FetchContext,
): GovernmentYield {
  const { tag, maturity } = seriesFor(symbol)
  const real = isRealYieldSymbol(symbol)
  const published = observations.filter((entry) => entry.rates[tag] !== undefined)
  const latest = published.at(-1)
  if (!latest) {
    throw new HttpError('schema', `US Treasury returned no ${tag} observation`)
  }
  const previous = published.at(-2)

  return buildYield({
    symbol,
    countryCode: 'US',
    currency: USD,
    maturity,
    seriesId: tag,
    methodology: real ? 'par-real-yield' : 'par-yield',
    observationDate: latest.date,
    yieldPercent: latest.rates[tag]!,
    // The prior PUBLICATION, which after a weekend is Friday — not "yesterday".
    previousYieldPercent: previous ? previous.rates[tag]! : null,
    provenance: {
      ...provenanceFor(latest.date, ctx),
      /* The real curve is its own publication; see US_TREASURY_REAL_SOURCE. */
      ...(real ? { source: US_TREASURY_REAL_SOURCE } : {}),
    },
  })
}

/* ---------------------------------------------------------------- provider */

/** Which month to request. The Treasury paginates its XML by calendar month. */
function monthParam(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function createUsTreasuryProvider(http: HttpClient): YieldProvider {
  /**
   * One month of one dataset.
   *
   * The nominal and real curves are two `data=` values on one endpoint with an
   * identical payload shape, so one parser and one pagination rule serve both.
   */
  async function fetchObservations(
    ctx: FetchContext,
    dataset: 'daily_treasury_yield_curve' | 'daily_treasury_real_yield_curve',
  ): Promise<TreasuryObservation[]> {
    const now = ctx.clock.now()
    const url = `${BASE_URL}?data=${dataset}&field_tdr_date_value_month=${monthParam(now)}`
    const xml = await http.getText(url, ctx.signal)
    const observations = parseTreasuryXml(xml)

    // Early in a month the current page can hold fewer than two publications,
    // which would leave the change underivable. One extra request for the
    // previous month is cheaper than reporting a null change all week.
    if (observations.length >= 2) return observations
    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    )
    const priorUrl = `${BASE_URL}?data=${dataset}&field_tdr_date_value_month=${monthParam(previousMonth)}`
    const priorXml = await http.getText(priorUrl, ctx.signal)
    return [...parseTreasuryXml(priorXml), ...observations]
  }

  return {
    id: US_TREASURY_PROVIDER_ID,
    name: US_TREASURY_SOURCE.providerName,
    attributionUrl: US_TREASURY_SOURCE.attributionUrl,

    async fetchYields(symbols, ctx): Promise<GovernmentYield[]> {
      if (symbols.length === 0) return []
      /*
       * One request per CURVE, not per maturity: each payload carries every
       * tenor of its own curve. A request touching only nominals costs one
       * call exactly as before; only a request that also wants real yields
       * pays for the second dataset.
       */
      const wantsReal = symbols.some(isRealYieldSymbol)
      const wantsNominal = symbols.some((symbol) => !isRealYieldSymbol(symbol))
      const [nominal, real] = await Promise.all([
        wantsNominal ? fetchObservations(ctx, 'daily_treasury_yield_curve') : [],
        wantsReal ? fetchObservations(ctx, 'daily_treasury_real_yield_curve') : [],
      ])
      return symbols.map((symbol) =>
        toYield(symbol, isRealYieldSymbol(symbol) ? real : nominal, ctx),
      )
    },

    /**
     * Every observation the Treasury published in a range.
     *
     * The same payload `fetchYields` reads, without the collapse to `.at(-1)`.
     * That collapse is right for a quote tile and wrong for a series: the month
     * page holds ~22 business days of the full curve, and taking the last one
     * discards the history the firm is trying to acquire.
     *
     * Paged by calendar month because that is how the Treasury paginates. A
     * range is walked month by month rather than requested wholesale, and a
     * month the source has no page for contributes nothing rather than failing
     * the range — an incomplete history is a fact about the source, not an
     * error in the request.
     *
     * `changeBasisPoints` is deliberately left null on every point. `buildYield`
     * derives it from a `previousYieldPercent` the caller supplies, and the
     * honest previous value for a historical point is the prior PUBLICATION for
     * that maturity — which the series query can compute across records and a
     * per-point ingest cannot see. Deriving it from whatever happened to be
     * adjacent in one page would report a change across a page boundary that no
     * publication ever showed.
     */
    async fetchYieldHistory(symbols, range, ctx): Promise<GovernmentYield[]> {
      if (symbols.length === 0) return []

      const observations: TreasuryObservation[] = []
      const from = new Date(`${range.from}T00:00:00.000Z`)
      const to = new Date(`${range.to}T00:00:00.000Z`)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new HttpError(
          'not-found',
          `US Treasury: invalid range ${range.from}..${range.to}`,
        )
      }

      let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
      while (cursor.getTime() <= to.getTime()) {
        const url = `${BASE_URL}?data=daily_treasury_yield_curve&field_tdr_date_value_month=${monthParam(cursor)}`
        observations.push(...parseTreasuryXml(await http.getText(url, ctx.signal)))
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
      }

      const inRange = observations
        .filter((entry) => entry.date >= range.from && entry.date <= range.to)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

      const out: GovernmentYield[] = []
      for (const entry of inRange) {
        for (const symbol of symbols) {
          const { tag, maturity } = seriesFor(symbol)
          const percent = entry.rates[tag]
          // Absent means the Treasury published no value for that maturity that
          // day. Omitted, never zero and never carried forward.
          if (percent === undefined) continue
          out.push(
            buildYield({
              symbol,
              countryCode: 'US',
              currency: USD,
              maturity,
              seriesId: tag,
              methodology: 'par-yield',
              observationDate: entry.date,
              yieldPercent: percent,
              provenance: provenanceFor(entry.date, ctx),
            }),
          )
        }
      }
      return out
    },

    async fetchYieldCurve(countryCode, ctx): Promise<YieldCurve> {
      if (countryCode !== 'US') {
        throw new HttpError(
          'not-found',
          `US Treasury publishes no curve for ${countryCode}`,
        )
      }
      /*
       * The NOMINAL curve. The real curve is deliberately not offered here:
       * `methodologiesAreComparable` forbids the two in one curve, and a
       * caller wanting real yields asks for the real symbols.
       */
      const observations = await fetchObservations(ctx, 'daily_treasury_yield_curve')
      const latest = observations.at(-1)
      if (!latest) throw new HttpError('schema', 'US Treasury returned no observations')

      // Only maturities the Treasury actually published that day. A missing
      // one is omitted, never interpolated: inventing a point would be
      // indistinguishable from a real one on the chart.
      const points = SERIES.filter(({ tag }) => latest.rates[tag] !== undefined).map(
        ({ symbol, tag, maturity }) =>
          buildYield({
            symbol: symbol as CanonicalSymbol,
            countryCode: 'US',
            currency: USD,
            maturity,
            seriesId: tag,
            methodology: 'par-yield',
            observationDate: latest.date,
            yieldPercent: latest.rates[tag]!,
            provenance: provenanceFor(latest.date, ctx),
          }),
      )

      return buildYieldCurve({
        countryCode: 'US',
        points,
        provenance: provenanceFor(latest.date, ctx),
      })
    },
  }
}
