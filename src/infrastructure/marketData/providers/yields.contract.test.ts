/**
 * Yield adapter contract tests, over payloads recorded from the live APIs on
 * 2026-07-26. No network is touched.
 *
 * The through-line: three sources, three different measures of "the ten-year
 * yield", and nothing here may let them be confused for one another.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import {
  buildYieldCurve,
  canonicalSymbol,
  effectiveTrust,
  type CanonicalSymbol,
} from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import { HttpError, type HttpClient } from './httpClient'
import { createUsTreasuryProvider } from './usTreasury'
import { createBundesbankProvider, parseBundesbankCsv } from './bundesbank'
import { createRiksbankProvider, RIKSBANK_SOURCE } from './riksbank'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const recordedText = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')
const recordedJson = (name: string): unknown => JSON.parse(recordedText(name))

const US10Y = canonicalSymbol('rate:us10y')
const US2Y = canonicalSymbol('rate:us2y')
const DE10Y = canonicalSymbol('rate:de10y')
const SE10Y = canonicalSymbol('rate:se10y')

const clock = new FakeClock('2026-07-26T12:00:00.000Z')
const ctx = (): FetchContext => ({
  signal: new AbortController().signal,
  clock,
  correlationId: NO_CORRELATION,
})

function stub(body: { text?: string; json?: unknown }): HttpClient {
  return {
    async getText() {
      if (body.text === undefined) throw new Error('no recorded text')
      return body.text
    },
    async getJson<T>() {
      if (body.json === undefined) throw new Error('no recorded json')
      return body.json as T
    },
  }
}

/* ------------------------------------------------------------ US Treasury */

const TREASURY = stub({ text: recordedText('treasury.parcurve.202607.xml') })

describe('US Treasury — par yield curve', () => {
  it('maps the recorded payload onto the headline maturities', async () => {
    const [ten, two] = await createUsTreasuryProvider(TREASURY).fetchYields(
      [US10Y, US2Y],
      ctx(),
    )
    expect(ten!.yieldPercent).toBe(4.69)
    expect(two!.yieldPercent).toBe(4.33)
    expect(ten!.maturity).toBe('10Y')
    expect(two!.tenorMonths).toBe(24)
  })

  it('records par-yield methodology and the Treasury series id', async () => {
    const [ten] = await createUsTreasuryProvider(TREASURY).fetchYields([US10Y], ctx())
    // Not a constant-maturity series, not a fitted zero rate.
    expect(ten!.methodology).toBe('par-yield')
    expect(ten!.seriesId).toBe('BC_10YEAR')
    expect(ten!.currency).toBe('USD')
  })

  it('preserves the observation date at date precision', async () => {
    const [ten] = await createUsTreasuryProvider(TREASURY).fetchYields([US10Y], ctx())
    expect(ten!.observationDate).toBe('2026-07-24')
    expect(ten!.provenance.asOf).toBe('2026-07-24T00:00:00.000Z')
    expect(ten!.provenance.asOfPrecision).toBe('date')
    expect(ten!.provenance.quality).toBe('official-daily')
    expect(ten!.provenance.isDelayed).toBe(false)
  })

  it('derives the change from the prior PUBLICATION, in basis points', async () => {
    const [ten] = await createUsTreasuryProvider(TREASURY).fetchYields([US10Y], ctx())
    // Thursday to Friday, not "yesterday" — after a weekend the gap is longer.
    expect(ten!.changeBasisPoints).not.toBeNull()
    expect(Math.abs(ten!.changeBasisPoints!)).toBeLessThan(50)
  })

  it('is the issuer of the instruments it reports on', async () => {
    const [ten] = await createUsTreasuryProvider(TREASURY).fetchYields([US10Y], ctx())
    expect(ten!.provenance.source.trust).toBe('issuer')
    expect(ten!.provenance.source.originator).toBeUndefined()
  })

  it('builds a curve of one methodology and one date', async () => {
    const curve = await createUsTreasuryProvider(TREASURY).fetchYieldCurve!('US', ctx())
    expect(curve.methodology).toBe('par-yield')
    expect(curve.observationDate).toBe('2026-07-24')
    expect(curve.points.length).toBeGreaterThanOrEqual(12)
    // Ascending, and every point a real published maturity.
    const tenors = curve.points.map((point) => point.tenorMonths)
    expect(tenors).toEqual([...tenors].sort((a, b) => a - b))
    expect(curve.points.every((point) => point.methodology === 'par-yield')).toBe(true)
  })

  it('omits maturities the payload does not contain, never interpolating', async () => {
    const sparse = stub({
      text: `<entry><content><m:properties>
        <d:NEW_DATE>2026-07-24T00:00:00</d:NEW_DATE>
        <d:BC_2YEAR>4.33</d:BC_2YEAR>
        <d:BC_10YEAR>4.69</d:BC_10YEAR>
      </m:properties></content></entry>`,
    })
    const curve = await createUsTreasuryProvider(sparse).fetchYieldCurve!('US', ctx())
    // A missing 5Y stays missing. Inventing one would be indistinguishable
    // from a real point on the chart.
    expect(curve.points.map((point) => point.maturity)).toEqual(['2Y', '10Y'])
  })

  it('refuses a curve for a country it does not publish', async () => {
    await expect(
      createUsTreasuryProvider(TREASURY).fetchYieldCurve!('DE', ctx()),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('rejects an unmapped symbol and an empty payload', async () => {
    await expect(
      createUsTreasuryProvider(TREASURY).fetchYields(
        ['rate:jp10y' as CanonicalSymbol],
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
    await expect(
      createUsTreasuryProvider(stub({ text: '<feed></feed>' })).fetchYields(
        [US10Y],
        ctx(),
      ),
    ).rejects.toBeInstanceOf(HttpError)
  })
})

/* ------------------------------------------------------------- Bundesbank */

const BUNDESBANK = stub({ text: recordedText('bundesbank.de10y.csv') })

describe('Bundesbank — fitted zero-coupon curve', () => {
  it('parses German decimal commas', () => {
    const rows = parseBundesbankCsv(recordedText('bundesbank.de10y.csv'))
    expect(rows.at(-1)).toEqual({ date: '2026-07-24', value: 3.24 })
  })

  it('skips non-publication days instead of reading them as zero', () => {
    const rows = parseBundesbankCsv(recordedText('bundesbank.de10y.csv'))
    const dates = rows.map((row) => row.date)
    // The 18th and 19th are a weekend, marked "." / "Kein Wert vorhanden".
    expect(dates).not.toContain('2026-07-18')
    expect(dates).not.toContain('2026-07-19')
    expect(rows.every((row) => row.value > 0)).toBe(true)
  })

  it('records zero-coupon-fitted methodology, NOT a par yield', async () => {
    const [de] = await createBundesbankProvider(BUNDESBANK).fetchYields([DE10Y], ctx())
    // Svensson-fitted spot rate. A different measure from the US par yield,
    // and the curve builder refuses to plot them together.
    expect(de!.methodology).toBe('zero-coupon-fitted')
    expect(de!.yieldPercent).toBe(3.24)
    expect(de!.currency).toBe('EUR')
    expect(de!.provenance.source.trust).toBe('central-bank')
  })

  it('reports the change against the prior publication', async () => {
    const [de] = await createBundesbankProvider(BUNDESBANK).fetchYields([DE10Y], ctx())
    // 3.25 -> 3.24 is one basis point.
    expect(de!.changeBasisPoints).toBeCloseTo(-1, 6)
  })

  it('rejects a payload with no usable rows', async () => {
    await expect(
      createBundesbankProvider(stub({ text: 'header;only;\n' })).fetchYields(
        [DE10Y],
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'schema' })
  })
})

/* --------------------------------------------------------------- Riksbank */

const RIKSBANK = stub({ json: recordedJson('riksbank.segvb10yc.json') })

describe('Riksbank — Swedish benchmark yields', () => {
  it('maps the recorded observations', async () => {
    const [se] = await createRiksbankProvider(RIKSBANK).fetchYields([SE10Y], ctx())
    expect(se!.yieldPercent).toBe(3.012)
    expect(se!.observationDate).toBe('2026-07-24')
    expect(se!.seriesId).toBe('SEGVB10YC')
    expect(se!.currency).toBe('SEK')
    expect(se!.methodology).toBe('benchmark-bond-yield')
  })

  it('names Refinitiv as the originator, not the Riksbank', async () => {
    const [se] = await createRiksbankProvider(RIKSBANK).fetchYields([SE10Y], ctx())
    const { source } = se!.provenance
    // The Riksbank is the access route; the numbers are Refinitiv's. Claiming
    // otherwise would overstate the provenance by a whole tier.
    expect(source.providerId).toBe('riksbank')
    expect(source.originator).toBe('Refinitiv')
    expect(source.trust).toBe('central-bank')
    expect(source.originatorTrust).toBe('licensed-vendor')
  })

  it('reports vendor-grade effective trust despite the central-bank route', () => {
    expect(effectiveTrust(RIKSBANK_SOURCE.trust!, RIKSBANK_SOURCE.originatorTrust)).toBe(
      'licensed-vendor',
    )
  })

  it('reports the change in basis points', async () => {
    const [se] = await createRiksbankProvider(RIKSBANK).fetchYields([SE10Y], ctx())
    // 3.025 -> 3.012 is 1.3 basis points down.
    expect(se!.changeBasisPoints).toBeCloseTo(-1.3, 6)
  })

  it('rejects a malformed payload and an unmapped symbol', async () => {
    await expect(
      createRiksbankProvider(stub({ json: { nope: true } })).fetchYields([SE10Y], ctx()),
    ).rejects.toMatchObject({ code: 'schema' })
    await expect(
      createRiksbankProvider(RIKSBANK).fetchYields(
        ['rate:no10y' as CanonicalSymbol],
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('reports a null change when only one observation exists', async () => {
    const single = stub({ json: [{ date: '2026-07-24', value: 3.012 }] })
    const [se] = await createRiksbankProvider(single).fetchYields([SE10Y], ctx())
    expect(se!.changeBasisPoints).toBeNull()
  })
})

/* ------------------------------------------------- cross-source integrity */

describe('the three sources are not interchangeable', () => {
  it('refuses to build a curve mixing US and German methodologies', async () => {
    const [us] = await createUsTreasuryProvider(TREASURY).fetchYields([US10Y], ctx())
    const [de] = await createBundesbankProvider(BUNDESBANK).fetchYields([DE10Y], ctx())
    // A par yield and a fitted zero rate on one axis is a shape that means
    // nothing, so it cannot be constructed at all.
    expect(() =>
      buildYieldCurve({
        countryCode: 'US',
        points: [us!, { ...de!, countryCode: 'US' }],
        provenance: us!.provenance,
      }),
    ).toThrow(/cannot mix par-yield with zero-coupon-fitted/)
  })

  it('gives each country its own methodology and originator', async () => {
    const [us] = await createUsTreasuryProvider(TREASURY).fetchYields([US10Y], ctx())
    const [de] = await createBundesbankProvider(BUNDESBANK).fetchYields([DE10Y], ctx())
    const [se] = await createRiksbankProvider(RIKSBANK).fetchYields([SE10Y], ctx())
    expect([us!.methodology, de!.methodology, se!.methodology]).toEqual([
      'par-yield',
      'zero-coupon-fitted',
      'benchmark-bond-yield',
    ])
    expect(se!.provenance.source.originator).toBe('Refinitiv')
    expect(de!.provenance.source.originator).toBeUndefined()
  })
})

/* ------------------------------------------------------------- revisions */

describe('revisions', () => {
  it('separates the observation date from when it was received', async () => {
    const first = stub({ json: [{ date: '2026-07-24', value: 3.012 }] })
    const revised = stub({ json: [{ date: '2026-07-24', value: 3.05 }] })

    const [before] = await createRiksbankProvider(first).fetchYields([SE10Y], ctx())
    clock.advance(60 * 60_000)
    const [after] = await createRiksbankProvider(revised).fetchYields([SE10Y], ctx())

    // A revision is the SAME observation date with a later receipt and a
    // different value. Treating historical observations as immutable would
    // make this impossible to represent.
    expect(after!.observationDate).toBe(before!.observationDate)
    expect(after!.yieldPercent).not.toBe(before!.yieldPercent)
    expect(Date.parse(after!.provenance.receivedAt)).toBeGreaterThan(
      Date.parse(before!.provenance.receivedAt),
    )
    clock.setTo('2026-07-26T12:00:00.000Z')
  })
})
