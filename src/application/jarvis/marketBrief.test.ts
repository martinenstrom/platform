/**
 * The market brief: fresh numbers with their provenance, nothing invented,
 * a fixture never quoted, and what is missing named.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import {
  buildNewsItem,
  buildProvenance,
  buildQuote,
  buildYield,
  buildYieldCurve,
  isoCurrency,
  OVERVIEW_COMMODITY_SYMBOLS,
  OVERVIEW_FX_SYMBOLS,
  OVERVIEW_INDEX_SYMBOLS,
  OVERVIEW_SECTOR_SYMBOLS,
  OVERVIEW_YIELD_SYMBOLS,
  SYM_BRENT,
  SYM_EURUSD,
  SYM_GOLD,
  SYM_NASDAQ100,
  SYM_OMXS30,
  SYM_SE10Y,
  SYM_SECTOR_ENERGY,
  SYM_SECTOR_HEALTHCARE,
  SYM_SECTOR_TECH,
  SYM_SP500,
  SYM_US10Y,
  SYM_US2Y,
  SYM_USDSEK,
  type DataSourceMetadata,
  type Envelope,
  type MarketQuote,
  type MarketSentiment,
} from '~/domain/market'
import type { OverviewDataSource } from '~/application/marketData/getOverviewSnapshot'
import {
  composeMarketBrief,
  fetchMarketBriefParts,
  MARKET_NOT_SERVED,
  type MarketBriefParts,
} from './marketBrief'

const NOW = '2026-09-16T14:00:00.000Z'
const clock = new FakeClock(NOW)
const now = () => new Date(NOW)

const YAHOO: DataSourceMetadata = { providerId: 'yahoo', providerName: 'Yahoo' }
const AVANZA: DataSourceMetadata = { providerId: 'avanza', providerName: 'Avanza' }
const TREASURY: DataSourceMetadata = { providerId: 'treasury', providerName: 'U.S. Treasury' }

const prov = (over: Partial<Parameters<typeof buildProvenance>[0]> = {}) =>
  buildProvenance({
    asOf: '2026-09-16T13:59:40.000Z',
    nowMs: clock.epochMs(),
    source: YAHOO,
    quality: 'delayed',
    isDelayed: true,
    ...over,
  })

const ok = <T>(data: T, provenance = prov()): Envelope<T> => ({ state: 'ok', data, provenance })
const failed = <T>(): Envelope<T> => ({
  state: 'error',
  error: { code: 'PROVIDER_ERROR', message: 'down' } as never,
})

const sp500 = buildQuote({ symbol: SYM_SP500, value: 6512.3, previousClose: 6485.2, session: 'open', changePeriod: 'intraday', provenance: prov() })
const nasdaq = buildQuote({
  symbol: SYM_NASDAQ100,
  value: 23950,
  percentageChange: 0.7,
  session: 'open',
  provenance: prov({ source: AVANZA }),
})
const omx = buildQuote({ symbol: SYM_OMXS30, value: 2710, percentageChange: -0.3, session: 'open', provenance: prov({ source: AVANZA }) })

const tech = buildQuote({ symbol: SYM_SECTOR_TECH, value: 100, percentageChange: 1.2, session: 'open', provenance: prov() })
const energy = buildQuote({ symbol: SYM_SECTOR_ENERGY, value: 100, percentageChange: -0.8, session: 'open', provenance: prov() })
/* No change figure from the source: stays null, sorts last. */
const health = buildQuote({ symbol: SYM_SECTOR_HEALTHCARE, value: 100, session: 'open', provenance: prov() })

const daily = (asOf: string, source = TREASURY) =>
  prov({ asOf, asOfPrecision: 'date', quality: 'official-daily', isDelayed: false, source })
const us10y = buildYield({
  symbol: SYM_US10Y,
  countryCode: 'US',
  currency: isoCurrency('USD'),
  maturity: '10Y',
  seriesId: 'DGS10',
  methodology: 'par-yield',
  observationDate: '2026-09-16',
  yieldPercent: 4.12,
  previousYieldPercent: 4.08,
  provenance: daily('2026-09-16T00:00:00.000Z'),
})
const us2y = buildYield({
  symbol: SYM_US2Y,
  countryCode: 'US',
  currency: isoCurrency('USD'),
  maturity: '2Y',
  seriesId: 'DGS2',
  methodology: 'par-yield',
  observationDate: '2026-09-16',
  yieldPercent: 3.6,
  provenance: daily('2026-09-16T00:00:00.000Z'),
})
const se10y = buildYield({
  symbol: SYM_SE10Y,
  countryCode: 'SE',
  currency: isoCurrency('SEK'),
  maturity: '10Y',
  seriesId: 'SEGVB10Y',
  methodology: 'par-yield',
  observationDate: '2026-09-16',
  yieldPercent: 2.4,
  provenance: daily('2026-09-16T00:00:00.000Z', { providerId: 'riksbank', providerName: 'Riksbanken' }),
})
const curve = buildYieldCurve({ countryCode: 'US', points: [us2y, us10y], provenance: daily('2026-09-16T00:00:00.000Z') })

const eurusd = buildQuote({ symbol: SYM_EURUSD, value: 1.0842, previousClose: 1.081, provenance: daily('2026-09-16T00:00:00.000Z', { providerId: 'frankfurter', providerName: 'ECB' }) })
const usdsek = buildQuote({ symbol: SYM_USDSEK, value: 9.31, previousClose: 9.35, provenance: daily('2026-09-16T00:00:00.000Z', { providerId: 'frankfurter', providerName: 'ECB' }) })
const brent = buildQuote({ symbol: SYM_BRENT, value: 68.4, percentageChange: 1.1, provenance: prov({ source: AVANZA }) })
const gold = buildQuote({ symbol: SYM_GOLD, value: 3650, percentageChange: -0.2, provenance: prov({ source: AVANZA }) })

/* The components carry percentile scores, not levels — which is why no VIX level is read from them. */
const sentiment = {
  score: 38.49,
  label: 'risk-off',
  origin: 'derived',
  formulaVersion: 'v1',
  components: [
    { id: 'equity-volatility', label: 'Aktievolatilitet', contribution: -6, inputValue: 38.49, inputAsOf: '2026-09-16T00:00:00.000Z', inputQuality: 'delayed' },
  ],
  provenance: prov({ quality: 'derived', asOf: '2026-09-16T00:00:00.000Z', isDelayed: false, source: { providerId: 'derived', providerName: 'Financial OS' } }),
} as unknown as MarketSentiment

const news = [
  buildNewsItem({ id: 'n1', headline: 'Fed holds rates, signals patience', outlet: 'Reuters', publishedAt: '2026-09-16T13:00:00.000Z', provenance: prov({ source: { providerId: 'marketaux', providerName: 'Marketaux' }, quality: 'near-realtime', isDelayed: false }) }),
]

const parts = (over: Partial<MarketBriefParts> = {}): MarketBriefParts => ({
  indices: ok([omx, sp500, nasdaq]),
  sectors: ok([health, energy, tech]),
  yields: ok([us10y, us2y, se10y]),
  yieldCurve: ok(curve),
  fx: ok([usdsek, eurusd]),
  commodities: ok([brent, gold]),
  sentiment: ok(sentiment),
  news: ok(news),
  ...over,
})

describe('the US brief', () => {
  it('reads the scope off the Overview’s own categories, with provenance beside every number', () => {
    const brief = composeMarketBrief(parts(), 'us', now())
    expect(brief.indices.map((q) => [q.name, q.level, q.changePercent, q.source, q.freshness])).toEqual([
      ['S&P 500', 6512.3, expect.closeTo(0.418, 2), 'Yahoo', 'current'],
      ['Nasdaq 100', 23950, 0.7, 'Avanza', 'current'],
    ])
    expect(brief.indices[0]!.observedAt).toBe('2026-09-16T13:59:40.000Z')
    expect(brief.indices[0]!.changePeriod).toBe('intraday')
    /* Best to worst; a sector without a change figure last, and still null. */
    expect(brief.sectors.map((q) => [q.name, q.changePercent])).toEqual([
      [expect.any(String), 1.2],
      [expect.any(String), -0.8],
      [expect.any(String), null],
    ])
    expect(brief.rates.map((r) => [r.symbol, r.yieldPercent, r.changeBasisPoints])).toEqual([
      ['rate:us10y', 4.12, expect.closeTo(4, 6)],
      ['rate:us2y', 3.6, null],
    ])
    expect(brief.curveSlopeBasisPoints).toBeCloseTo(52, 6)
    expect(brief.fx.map((q) => q.symbol)).toEqual(['fx:eurusd', 'fx:usdsek'])
    expect(brief.commodities.map((q) => [q.symbol, q.changePercent])).toEqual([
      ['cmd:brent', 1.1],
      ['cmd:gold', -0.2],
    ])
    /* The risk-appetite score, as the score it is; the VIX level is named as not served, never read off a score. */
    expect(brief.riskAppetite).toEqual({ score: 38, label: 'risk-off', observedAt: '2026-09-16T00:00:00.000Z' })
    expect(JSON.stringify(brief)).not.toMatch(/"level":38/)
    expect(brief.notServed).toContain('VIX-nivå')
    expect(brief.headlines).toEqual([
      { headline: 'Fed holds rates, signals patience', outlet: 'Reuters', publishedAt: '2026-09-16T13:00:00.000Z' },
    ])
    expect(brief.unavailable).toEqual([])
    expect(brief.notServed).toBe(MARKET_NOT_SERVED)
    expect(brief.notServed).toContain('Dow Jones')
    expect(brief.notServed).toContain('värderingsmått (P/E, multiplar)')
  })

  it('never quotes a fixture as the market, and keeps the real observations beside it', () => {
    /*
     * Measured on the dev server 2026-09-16: the index envelope read
     * `fixture` because the broker-served indices were circuit-open, while
     * S&P 500 inside it was a real Yahoo observation. Each value is judged
     * by its own provenance; the envelope's state is only how it arrived.
     */
    const nasdaqFixture = buildQuote({
      symbol: SYM_NASDAQ100,
      value: 20418.65,
      percentageChange: -0.28,
      provenance: prov({ quality: 'fixture', source: { providerId: 'fixture', providerName: 'Fixture' } }),
    })
    const fixtureIndices: Envelope<MarketQuote[]> = {
      state: 'fixture',
      data: [sp500, nasdaqFixture],
      provenance: prov({ quality: 'fixture' }),
      reason: 'live providers unavailable: circuit-open',
    }
    const brief = composeMarketBrief(parts({ indices: fixtureIndices, sentiment: failed() }), 'us', now())
    expect(brief.indices.map((q) => [q.name, q.level, q.delivery])).toEqual([['S&P 500', 6512.3, 'fresh']])
    expect(brief.unavailable).toEqual(['Nasdaq 100', 'riskaptit'])
    /* And no fixture number reaches the brief, whatever envelope carried it. */
    expect(JSON.stringify(brief)).not.toContain('20418.65')
    /* Every value a fixture: nothing is quoted, everything is named. */
    const allFixture: Envelope<MarketQuote[]> = {
      ...fixtureIndices,
      data: [buildQuote({ symbol: SYM_SP500, value: 1, provenance: prov({ quality: 'fixture' }) }), nasdaqFixture],
    }
    const none = composeMarketBrief(parts({ indices: allFixture }), 'us', now())
    expect(none.indices).toEqual([])
    expect(none.unavailable).toEqual(['S&P 500', 'Nasdaq 100'])
    /* A fixture-origin sentiment lends no score. */
    const fixtureSentiment = ok({ ...sentiment, origin: 'fixture' } as MarketSentiment)
    expect(composeMarketBrief(parts({ sentiment: fixtureSentiment }), 'us', now()).riskAppetite).toBeNull()
  })

  it('names every category the sources failed to serve', () => {
    const brief = composeMarketBrief(
      parts({ indices: failed(), sectors: { state: 'loading' }, yields: failed(), yieldCurve: failed(), fx: failed(), commodities: failed(), sentiment: failed(), news: failed() }),
      'us',
      now(),
    )
    expect(brief.indices).toEqual([])
    expect(brief.unavailable).toEqual([
      'S&P 500',
      'Nasdaq 100',
      'EUR/USD',
      'USD/SEK',
      expect.any(String),
      expect.any(String),
      'sektorer',
      '10Y U.S. Yield',
      '2Y U.S. Yield',
      'riskaptit',
    ])
    expect(brief.curveSlopeBasisPoints).toBeNull()
    expect(brief.headlines).toEqual([])
  })

  it('tells a stale observation from a stale delivery', () => {
    /* Twenty minutes old with the venue open: the level no longer represents the market. */
    const old = buildQuote({ symbol: SYM_SP500, value: 6500, previousClose: 6490, session: 'open', provenance: prov({ asOf: '2026-09-16T13:39:00.000Z' }) })
    const stale = composeMarketBrief(parts({ indices: ok([old, nasdaq]) }), 'us', now())
    expect(stale.indices[0]).toMatchObject({ name: 'S&P 500', freshness: 'stale', delivery: 'fresh' })
    /* Served from a cache that could not revalidate, but the observation itself is fresh. */
    const cached: Envelope<MarketQuote[]> = { state: 'stale', data: [sp500, nasdaq], provenance: prov(), staleReason: 'provider-error' }
    const delivery = composeMarketBrief(parts({ indices: cached }), 'us', now())
    expect(delivery.indices[0]).toMatchObject({ name: 'S&P 500', freshness: 'current', delivery: 'stale' })
    /* A daily publication is judged by its own clock: this morning's fix is current all day. */
    expect(delivery.fx[0]).toMatchObject({ symbol: 'fx:eurusd', freshness: 'current', changePeriod: expect.any(String) })
  })
})

describe('the scopes', () => {
  it('give Sweden its index and its ten-year, and no US-only category', () => {
    const brief = composeMarketBrief(parts(), 'sweden', now())
    expect(brief.indices.map((q) => q.name)).toEqual(['OMXS30'])
    expect(brief.rates.map((r) => r.symbol)).toEqual(['rate:se10y'])
    expect(brief.sectors).toEqual([])
    expect(brief.riskAppetite).toBeNull()
    expect(brief.curveSlopeBasisPoints).toBeNull()
    expect(brief.fx.map((q) => q.symbol)).toEqual(['fx:usdsek', 'fx:eurusd'])
    expect(brief.unavailable).toEqual([])
  })

  it('fetch with the Overview’s own symbol lists, and skip the US categories a narrower scope does not need', async () => {
    const calls: string[] = []
    const source = {
      correlationId: () => 'c1',
      now,
      quotes: async (symbols: readonly string[]) => {
        calls.push(`quotes:${symbols.join('|')}`)
        return ok([omx, sp500, nasdaq])
      },
      sectors: async (symbols: readonly string[]) => {
        calls.push(`sectors:${symbols.length}`)
        return ok([tech])
      },
      yields: async (symbols: readonly string[]) => {
        calls.push(`yields:${symbols.join('|')}`)
        return ok([us10y, us2y, se10y])
      },
      yieldCurve: async (country: string) => {
        calls.push(`curve:${country}`)
        return ok(curve)
      },
      fx: async (symbols: readonly string[]) => {
        calls.push(`fx:${symbols.join('|')}`)
        return ok([usdsek, eurusd])
      },
      commodities: async (symbols: readonly string[]) => {
        calls.push(`commodities:${symbols.join('|')}`)
        return ok([brent, gold])
      },
      sentiment: async () => {
        calls.push('sentiment')
        return ok(sentiment)
      },
      news: async (limit: number) => {
        calls.push(`news:${limit}`)
        return ok(news)
      },
    } as unknown as OverviewDataSource

    await fetchMarketBriefParts(source, 'us', Infinity)
    expect(calls.sort()).toEqual(
      [
        `quotes:${OVERVIEW_INDEX_SYMBOLS.join('|')}`,
        `sectors:${OVERVIEW_SECTOR_SYMBOLS.length}`,
        `yields:${OVERVIEW_YIELD_SYMBOLS.join('|')}`,
        'curve:US',
        `fx:${OVERVIEW_FX_SYMBOLS.join('|')}`,
        `commodities:${OVERVIEW_COMMODITY_SYMBOLS.join('|')}`,
        'sentiment',
        'news:4',
      ].sort(),
    )

    calls.length = 0
    const parts = await fetchMarketBriefParts(source, 'sweden', Infinity)
    expect(calls.some((call) => call.startsWith('sectors') || call.startsWith('curve') || call === 'sentiment')).toBe(false)
    expect(parts.sectors).toEqual({ state: 'loading' })
    expect(composeMarketBrief(parts, 'sweden', now()).indices.map((q) => q.name)).toEqual(['OMXS30'])
  })
})
