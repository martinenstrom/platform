/**
 * The Tier-0 sentences and the model's context: a number with its session,
 * time and source; nothing where there is nothing; no driver without a headline.
 */

import { describe, expect, it } from 'vitest'
import type { BriefQuote, BriefYield, MarketBrief } from '~/application/jarvis/marketBrief'
import { SYM_DE10Y, SYM_GOLD, SYM_NASDAQ100, SYM_SECTOR_TECH, SYM_SP500, SYM_US10Y, SYM_USDSEK } from '~/domain/market'
import { LIVE_APPEND_MAX_CHARS, LIVE_MARKET_CONTEXT } from './liveSpeech'
import { marketContextText, marketVoiceContext, retrievalSpeech } from './marketSpeech'

const quote = (over: Partial<BriefQuote> & Pick<BriefQuote, 'symbol' | 'name' | 'level'>): BriefQuote => ({
  observedAt: '2026-09-16T18:20:00.000Z',
  source: 'Yahoo',
  quality: 'delayed',
  session: 'closed',
  freshness: 'current',
  delivery: 'fresh',
  changePercent: null,
  changeAbsolute: null,
  changePeriod: 'intraday',
  ...over,
})

const us10y: BriefYield = {
  symbol: 'rate:us10y',
  name: '10Y U.S. Yield',
  observedAt: '2026-09-16T00:00:00.000Z',
  source: 'U.S. Treasury',
  quality: 'official-daily',
  session: 'unknown',
  freshness: 'current',
  delivery: 'fresh',
  yieldPercent: 5.01,
  changeBasisPoints: 1,
  observationDate: '2026-09-16',
}

const brief: MarketBrief = {
  scope: 'us',
  generatedAt: '2026-09-16T18:21:00.000Z',
  indices: [quote({ symbol: 'idx:sp500', name: 'S&P 500', level: 7551.81, changePercent: -0.45, changeAbsolute: -34.1 })],
  sectors: [
    quote({ symbol: 'sector:technology', name: 'Information Technology', level: 6867.57, changePercent: 0.1 }),
    quote({ symbol: 'sector:financials', name: 'Financials', level: 900, changePercent: -1.62 }),
    quote({ symbol: 'sector:energy', name: 'Energy', level: 700, changePercent: -2.97 }),
  ],
  rates: [us10y],
  curveSlopeBasisPoints: 27,
  fx: [quote({ symbol: 'fx:usdsek', name: 'USD/SEK', level: 9.7837, changePercent: 0.14, changePeriod: 'publication-to-publication', source: 'ECB', quality: 'eod', session: 'unknown', observedAt: '2026-09-16T00:00:00.000Z' })],
  commodities: [quote({ symbol: 'cmd:gold', name: 'Gold', level: 3650, changePercent: -0.2, source: 'Avanza', session: 'unknown' })],
  riskAppetite: { score: 66, label: 'risk-on', observedAt: '2026-09-16T00:00:00.000Z' },
  headlines: [],
  unavailable: ['Nasdaq 100'],
  notServed: ['Dow Jones', 'VIX-nivå'],
}

describe('a Tier-0 answer', () => {
  it('says the level and the move with the session, and the provenance once', () => {
    expect(retrievalSpeech([{ kind: 'quote', symbol: SYM_SP500 }], brief)).toBe(
      'S&P 500 stängde på 7 552, ned 0,45 procent idag (fördröjd data från Yahoo, kl. 20:20).',
    )
  })

  it('says a yield as the official daily level it is', () => {
    expect(retrievalSpeech([{ kind: 'rate', symbol: SYM_US10Y }], brief)).toBe(
      'USA:s tioårsränta ligger på 5,01 procent, upp 1 baspunkt (officiell dagsnivå 16 september, U.S. Treasury).',
    )
  })

  it('puts a sector against the broad index', () => {
    expect(retrievalSpeech([{ kind: 'quote', symbol: SYM_SECTOR_TECH }], brief)).toBe(
      'Information Technology är upp 0,1 procent idag. Det är bättre än S&P 500, som är ned 0,45 procent (fördröjd data från Yahoo, kl. 20:20).',
    )
  })

  it('names best and worst when asked for the sectors', () => {
    expect(retrievalSpeech([{ kind: 'sectors' }], brief)).toContain('Starkast idag är Information Technology, upp 0,1 procent; svagast Energy, ned 2,97 procent')
  })

  it('reads FX against the previous fix, and a commodity as its source quotes it', () => {
    expect(retrievalSpeech([{ kind: 'quote', symbol: SYM_USDSEK }], brief)).toBe(
      'USD/SEK står i 9,7837, upp 0,14 procent mot föregående notering (ECB, 16 september).',
    )
    expect(retrievalSpeech([{ kind: 'quote', symbol: SYM_GOLD }], brief)).toBe(
      'Gold: senaste notering 3 650, ned 0,2 procent idag (fördröjd data från Avanza, kl. 20:20).',
    )
  })

  it('says a missing instrument is missing, and never guesses', () => {
    expect(retrievalSpeech([{ kind: 'quote', symbol: SYM_NASDAQ100 }], brief)).toBe(
      'Nasdaq 100 saknas i datan just nu — källan svarar inte, och jag vill inte gissa.',
    )
    expect(retrievalSpeech([{ kind: 'rate', symbol: SYM_DE10Y }], brief)).toContain('saknas i datan just nu')
  })

  it('answers VIX with what the platform has: no level, a risk-appetite score', () => {
    expect(retrievalSpeech([{ kind: 'vix' }], brief)).toBe(
      'En VIX-nivå serveras inte av plattformen. Riskaptitindexet står i 66 av 100.',
    )
    expect(retrievalSpeech([{ kind: 'risk' }], brief)).toBe(
      'Plattformens riskaptitindex står i 66 av 100 — risk-on (härlett, 16 september).',
    )
  })

  it('marks a stale observation as the latest available, not as now', () => {
    const stale: MarketBrief = {
      ...brief,
      indices: [quote({ symbol: 'idx:sp500', name: 'S&P 500', level: 7500, changePercent: -0.3, freshness: 'stale', session: 'open' })],
    }
    expect(retrievalSpeech([{ kind: 'quote', symbol: SYM_SP500 }], stale)).toBe(
      'Senaste tillgängliga noteringen för S&P 500 är från kl. 20:20 (Yahoo): 7 500, ned 0,3 procent.',
    )
  })

  it('answers two named things in the order they were asked', () => {
    const text = retrievalSpeech([{ kind: 'quote', symbol: SYM_SP500 }, { kind: 'rate', symbol: SYM_US10Y }], brief)
    expect(text.indexOf('S&P 500')).toBeLessThan(text.indexOf('tioårsränta'))
  })
})

describe('the brief as a model reads it', () => {
  it('carries every number with its time and source, and says the driver is unverified without headlines', () => {
    const text = marketContextText(brief)
    expect(text).toContain('MARKNADSLÄGE hämtat 20:21')
    expect(text).toContain('S&P 500: 7 552, ned 0,45 procent, closed, Yahoo kl. 20:20')
    expect(text).toContain('10Y U.S. Yield 5,01 % (upp 1 baspunkt) 16 september U.S. Treasury')
    expect(text).toContain('kurvlutning 10y−2y 27 bp')
    expect(text).toContain('Riskaptitindex (härlett, 0–100, aldrig VIX): 66 risk-on')
    expect(text).toContain('dagens drivkraft är inte verifierad')
    expect(text).toContain('Saknas just nu: Nasdaq 100.')
    expect(text).toContain('Serveras inte alls: Dow Jones, VIX-nivå.')
  })

  it('lists headlines when the source served them', () => {
    const withNews = { ...brief, headlines: [{ headline: 'Fed holds', outlet: 'Reuters', publishedAt: '2026-09-16T13:00:00.000Z' }] }
    expect(marketContextText(withNews)).toContain('Rubriker: "Fed holds" (Reuters)')
    expect(marketContextText(withNews)).not.toContain('inte verifierad')
  })
})

/* Everything the global scope can serve at once, all of it present: the longest brief there is. */
const sector = (symbol: string, name: string, changePercent: number) => quote({ symbol: `sector:${symbol}`, name, level: 1000, changePercent })
const everything: MarketBrief = {
  ...brief,
  scope: 'global',
  indices: [
    quote({ symbol: 'idx:sp500', name: 'S&P 500', level: 7551.81, changePercent: -0.45, changeAbsolute: -34.1 }),
    quote({ symbol: 'idx:nasdaq100', name: 'Nasdaq 100', level: 24912.4, changePercent: -0.81 }),
    quote({ symbol: 'idx:dax', name: 'DAX', level: 18402.1, changePercent: 0.32, observedAt: '2026-09-16T15:35:00.000Z' }),
    quote({ symbol: 'idx:ftse100', name: 'FTSE 100', level: 8212.3, changePercent: 0.12, observedAt: '2026-09-16T15:35:00.000Z' }),
    quote({ symbol: 'idx:omxs30', name: 'OMXS30', level: 2610.2, changePercent: -0.2, source: 'Avanza', observedAt: '2026-09-16T15:30:00.000Z' }),
    quote({ symbol: 'idx:nikkei225', name: 'Nikkei 225', level: 38120.5, changePercent: 1.1, observedAt: '2026-09-16T06:00:00.000Z' }),
  ],
  sectors: [
    sector('health', 'Health Care', 0.35),
    sector('staples', 'Consumer Staples', 0.2),
    sector('utilities', 'Utilities', 0.05),
    sector('industrials', 'Industrials', -0.1),
    sector('technology', 'Information Technology', -0.2),
    sector('materials', 'Materials', -0.4),
    sector('discretionary', 'Consumer Discretionary', -0.6),
    sector('realestate', 'Real Estate', -0.8),
    sector('communication', 'Communication Services', -1.1),
    sector('financials', 'Financials', -1.62),
    sector('energy', 'Energy', -2.97),
  ],
  rates: [
    us10y,
    { ...us10y, symbol: 'rate:us2y', name: '2Y U.S. Yield', yieldPercent: 4.2, changeBasisPoints: -2 },
    { ...us10y, symbol: 'rate:de10y', name: '10Y Bund', yieldPercent: 2.7, changeBasisPoints: 3, source: 'Bundesbank' },
    { ...us10y, symbol: 'rate:se10y', name: '10Y Sweden', yieldPercent: 2.55, changeBasisPoints: 0, source: 'Riksbanken' },
  ],
  curveSlopeBasisPoints: 81,
  fx: [
    quote({ symbol: 'fx:eurusd', name: 'EUR/USD', level: 1.162, changePercent: 0.1, changePeriod: 'publication-to-publication', source: 'ECB', quality: 'eod', session: 'unknown', observedAt: '2026-09-16T00:00:00.000Z' }),
    quote({ symbol: 'fx:usdsek', name: 'USD/SEK', level: 9.7837, changePercent: 0.14, changePeriod: 'publication-to-publication', source: 'ECB', quality: 'eod', session: 'unknown', observedAt: '2026-09-16T00:00:00.000Z' }),
  ],
  commodities: [
    quote({ symbol: 'cmd:gold', name: 'Gold', level: 3650, changePercent: -0.2, source: 'Avanza', session: 'unknown' }),
    quote({ symbol: 'cmd:brent', name: 'Brent', level: 78.2, changePercent: -1.1, source: 'Avanza', session: 'unknown' }),
  ],
  headlines: [
    { headline: 'Fed holds rates steady as inflation cools further', outlet: 'Reuters', publishedAt: '2026-09-16T13:00:00.000Z' },
    { headline: 'Oil slides on demand worries after inventory build', outlet: 'Bloomberg', publishedAt: '2026-09-16T12:00:00.000Z' },
    { headline: 'Chipmakers fall as export rules tighten', outlet: 'FT', publishedAt: '2026-09-16T11:00:00.000Z' },
  ],
  unavailable: [],
  notServed: ['Dow Jones', 'Russell 2000', 'dollarindex (DXY)', 'VIX-nivå', 'marknadsbredd (advance/decline)', 'intradagsserier', 'värderingsmått (P/E, multiplar)'],
}

describe('the brief as the voice reads it', () => {
  it('carries the same numbers with their sessions, times and sources, in fewer words', () => {
    const text = marketVoiceContext(brief, 4000)
    expect(text).toContain('MARKNADSLÄGE hämtat 20:21')
    expect(text).toContain('S&P 500 7 552 ned 0,45 % (stängt, Yahoo 20:20)')
    expect(text).toContain('Sektorer (bäst→sämst): Information Technology upp 0,1 % · Financials ned 1,62 % · Energy ned 2,97 %')
    expect(text).toContain('USA 10 år 5,01 % (upp 1 bp, 16 sep')
    expect(text).toContain('10y−2y 27 bp')
    expect(text).toContain('USD/SEK 9,7837 upp 0,14 % (ECB 16 sep')
    expect(text).toContain('Gold 3 650 ned 0,2 % (Avanza 20:20)')
    expect(text).toContain('Riskaptit (härlett 0–100, aldrig VIX): 66 risk-on')
    expect(text).toContain('Rubriker: inga — drivkraften ej verifierad, hitta inte på en orsak.')
    expect(text).toContain('Saknas: Nasdaq 100.')
    expect(text).toContain('Ej serverat: Dow Jones, VIX-nivå.')
    expect(text.length).toBeLessThan(marketContextText(brief).length)
  })

  it('marks a stale row so the voice says "senaste tillgängliga", not "just nu"', () => {
    const stale: MarketBrief = {
      ...brief,
      indices: [quote({ symbol: 'idx:sp500', name: 'S&P 500', level: 7500, changePercent: -0.3, freshness: 'stale', session: 'open' })],
    }
    expect(marketVoiceContext(stale, 4000)).toContain('INAKTUELL S&P 500 7 500 ned 0,3 % (öppet, Yahoo 20:20)')
  })

  it('fits the limit by dropping the least useful lines first, and keeps the indices and rates to the last', () => {
    const full = marketVoiceContext(everything, 4000)
    expect(full).toContain('Ej serverat: Dow Jones')
    expect(full).toContain('Industrials ned 0,1 %')
    expect(full).toContain('"Chipmakers fall as export rules tighten" (FT)')

    const indices = ['S&P 500 7 552', 'Nasdaq 100 24 912', 'DAX 18 402', 'FTSE 100 8 212', 'OMXS30 2 610', 'Nikkei 225 38 121']
    const fitted = marketVoiceContext(everything, 1100)
    expect(fitted.length).toBeLessThanOrEqual(1100)
    for (const name of indices) expect(fitted).toContain(name)
    expect(fitted).toContain('USA 10 år 5,01 %')
    expect(fitted).toContain('Sverige 10 år 2,55 % (oförändrad')
    expect(fitted).not.toContain('Ej serverat')
    /* The middle of the sector table goes; the edges and technology — asked about by name — stay. */
    expect(fitted).toContain('Health Care upp 0,35 %')
    expect(fitted).toContain('Energy ned 2,97 %')
    expect(fitted).toContain('Information Technology ned 0,2 %')
    expect(fitted).not.toContain('Industrials')
    /* Then the headlines beyond the first. */
    expect(fitted).toContain('"Fed holds rates steady as inflation cools further" (Reuters)')
    expect(fitted).not.toContain('Chipmakers')

    /* Tighter still: the sector table goes before any index or rate does. */
    const tighter = marketVoiceContext(everything, 900)
    expect(tighter.length).toBeLessThanOrEqual(900)
    expect(tighter).not.toContain('Sektorer')
    for (const name of indices) expect(tighter).toContain(name)
    expect(tighter).toContain('USA 10 år 5,01 %')
    expect(tighter).toContain('Rubriker: "Fed holds')

    const tiny = marketVoiceContext(everything, 500)
    expect(tiny.length).toBeLessThanOrEqual(500)
    expect(tiny).toContain('S&P 500 7 552')
  })

  it('never hands the voice an append above the provider limit, whatever the brief holds', () => {
    for (const candidate of [brief, everything, { ...everything, unavailable: ['Nasdaq 100', 'DAX', 'FTSE 100', 'OMXS30', 'Nikkei 225', 'guld', 'Brent'] }]) {
      const append = LIVE_MARKET_CONTEXT.voice(candidate, 180)
      expect(append.length).toBeLessThanOrEqual(LIVE_APPEND_MAX_CHARS)
      expect(append).toContain('MARKNADSLÄGE hämtat')
      expect(append).toContain('S&P 500 7 552')
      expect(append).toContain('Gäller 3 min; nyare ersätter äldre.')
    }
  })
})
