/**
 * Local mock data for the UI foundation.
 * Nothing here talks to a network — every value is static or derived from a
 * deterministic pseudo-random generator so renders stay stable between reloads.
 *
 * When the Avanza MCP integration lands, `src/services/marketDataService.ts`
 * is the only file that should change; this module then becomes fixtures.
 */

import { CATEGORICAL } from '~/lib/chartTheme'
import type {
  AIMarketBrief,
  AllocationSlice,
  Holding,
  Instrument,
  MarketIndexQuote,
  MarketStatus,
  MarketTrend,
  Opportunity,
  PerformancePoint,
  PortfolioSummary,
  Quote,
  ReportItem,
  RiskScore,
  ScreenerRow,
  TimeRange,
  WatchlistItem,
} from '~/types'

/** Fixed reference point so mock timestamps never drift during a session. */
export const MOCK_NOW = new Date('2025-03-14T16:40:00+01:00')

/** Deterministic PRNG (mulberry32) — same seed always yields the same series. */
function createRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const portfolioSummary: PortfolioSummary = {
  totalValue: 2847320,
  dayChange: 18940,
  dayChangePercent: 0.67,
  monthChangePercent: 3.42,
  investedCapital: 2310000,
  cashBalance: 184500,
  buyingPower: 246800,
  unrealizedResult: 352820,
  unrealizedResultPercent: 15.27,
  currency: 'SEK',
}

export const marketStatus: MarketStatus = {
  isOpen: true,
  label: 'Stockholmsbörsen öppen',
  detail: 'Stänger 17:30 CET',
}

export const marketIndices: MarketIndexQuote[] = [
  { id: 'omxs30', name: 'OMXS30', value: 2612.48, changePercent: 0.74, precision: 2 },
  { id: 'sp500', name: 'S&P 500', value: 5843.12, changePercent: 0.41, precision: 2 },
  {
    id: 'nasdaq',
    name: 'Nasdaq 100',
    value: 20418.65,
    changePercent: -0.28,
    precision: 2,
  },
  { id: 'eursek', name: 'EUR/SEK', value: 11.2384, changePercent: -0.12, precision: 4 },
  { id: 'usdsek', name: 'USD/SEK', value: 10.4127, changePercent: 0.19, precision: 4 },
  {
    id: 'btc',
    name: 'Bitcoin',
    value: 843200,
    changePercent: 2.14,
    precision: 0,
    currency: 'SEK',
  },
]

/** Slice colours come from the validated categorical palette, in fixed order. */
export const allocation: AllocationSlice[] = [
  {
    id: 'se-equity',
    label: 'Svenska aktier',
    value: 1082000,
    percent: 38,
    color: CATEGORICAL[0],
  },
  {
    id: 'global-equity',
    label: 'Globala aktier',
    value: 740300,
    percent: 26,
    color: CATEGORICAL[1],
  },
  { id: 'funds', label: 'Fonder', value: 512500, percent: 18, color: CATEGORICAL[2] },
  { id: 'etf', label: 'ETF:er', value: 328020, percent: 11.5, color: CATEGORICAL[3] },
  {
    id: 'cash',
    label: 'Likvida medel',
    value: 184500,
    percent: 6.5,
    color: CATEGORICAL[4],
  },
]

export const riskScore: RiskScore = {
  score: 62,
  level: 'moderate',
  label: 'Måttlig risk',
  description:
    'Portföljen har en balanserad exponering men högre koncentration mot svenska verkstadsbolag än jämförelseindex.',
  updatedAt: '2025-03-14T15:10:00+01:00',
}

export const watchlist: WatchlistItem[] = [
  {
    id: 'inve-b',
    name: 'Investor B',
    ticker: 'INVE B',
    price: 289.4,
    changePercent: 1.12,
    currency: 'SEK',
    spark: [281, 283, 282, 286, 285, 288, 287, 289.4],
    signal: 'buy',
  },
  {
    id: 'volv-b',
    name: 'Volvo B',
    ticker: 'VOLV B',
    price: 274.85,
    changePercent: -0.63,
    currency: 'SEK',
    spark: [278, 277, 279, 276, 275, 276, 275, 274.85],
    signal: 'hold',
  },
  {
    id: 'evo',
    name: 'Evolution',
    ticker: 'EVO',
    price: 812.2,
    changePercent: 2.48,
    currency: 'SEK',
    spark: [782, 788, 795, 790, 801, 806, 809, 812.2],
    signal: 'buy',
  },
  {
    id: 'avanza',
    name: 'Avanza Bank',
    ticker: 'AZA',
    price: 268.9,
    changePercent: 0.34,
    currency: 'SEK',
    spark: [266, 267, 266.5, 268, 267.5, 269, 268.4, 268.9],
    signal: 'watch',
  },
  {
    id: 'atco-a',
    name: 'Atlas Copco A',
    ticker: 'ATCO A',
    price: 178.15,
    changePercent: -1.24,
    currency: 'SEK',
    spark: [181, 180.5, 181.2, 179.8, 179, 178.6, 178.9, 178.15],
    signal: 'sell',
  },
  {
    id: 'seb-a',
    name: 'SEB A',
    ticker: 'SEB A',
    price: 158.6,
    changePercent: 0.88,
    currency: 'SEK',
    spark: [155, 156, 155.8, 157, 157.4, 158, 158.2, 158.6],
    signal: 'hold',
  },
]
export const opportunities: Opportunity[] = [
  {
    id: 'op-1',
    instrument: 'Evolution',
    ticker: 'EVO',
    signal: 'buy',
    confidence: 78,
    rationale:
      'Bruttomarginalen har stabiliserats tre kvartal i rad samtidigt som värderingen ligger under femårssnittet.',
    horizon: '6–12 mån',
  },
  {
    id: 'op-2',
    instrument: 'Investor B',
    ticker: 'INVE B',
    signal: 'watch',
    confidence: 64,
    rationale:
      'Substansrabatten har vidgats till nivåer som historiskt föregått en återhämtning i kursen.',
    horizon: '3–6 mån',
  },
  {
    id: 'op-3',
    instrument: 'Atlas Copco A',
    ticker: 'ATCO A',
    signal: 'sell',
    confidence: 57,
    rationale:
      'Avtagande orderingång inom industrisegmentet i kombination med en historiskt hög multipel.',
    horizon: '1–3 mån',
  },
]

export const aiMarketBrief: AIMarketBrief = {
  id: 'brief-2025-03-14',
  generatedAt: '2025-03-14T16:05:00+01:00',
  model: 'Analysagent v0 (simulerad)',
  summary:
    'Stockholmsbörsen handlas upp med stöd från verkstad och bank, medan defensiva sektorer släpar efter. Räntemarknaden prisar in en oförändrad styrränta vid nästa besked.',
  observations: [
    {
      id: 'obs-1',
      title: 'Verkstad leder uppgången',
      detail: 'Sektorn står för merparten av dagens indexbidrag i OMXS30.',
      tone: 'positive',
    },
    {
      id: 'obs-2',
      title: 'Kronan försvagas mot dollarn',
      detail: 'USD/SEK upp 0,19 % vilket gynnar exporttunga innehav.',
      tone: 'neutral',
    },
    {
      id: 'obs-3',
      title: 'Förhöjd volatilitet i tech',
      detail: 'Nasdaq 100 handlas ned med bred nedgång bland halvledarbolag.',
      tone: 'warning',
    },
  ],
}
export const marketTrends: MarketTrend[] = [
  {
    id: 'momentum',
    label: 'Momentum',
    value: 'Stigande',
    description: 'Andelen bolag över MA50 har ökat fyra dagar i rad.',
    strength: 72,
    tone: 'positive',
    trend: 'up',
  },
  {
    id: 'volatility',
    label: 'Volatilitet',
    value: 'Förhöjd',
    description: 'Implicit volatilitet ligger över tremånaderssnittet.',
    strength: 58,
    tone: 'warning',
    trend: 'up',
  },
  {
    id: 'breadth',
    label: 'Bredd',
    value: 'Neutral',
    description: '54 % av OMXS30-bolagen stiger under dagen.',
    strength: 54,
    tone: 'neutral',
    trend: 'flat',
  },
  {
    id: 'volume',
    label: 'Omsättning',
    value: 'Under snitt',
    description: 'Handelsvolymen är 12 % lägre än tjugodagarssnittet.',
    strength: 38,
    tone: 'negative',
    trend: 'down',
  },
]

/** Small local universe backing the header search — no network calls. */
export const instrumentUniverse: Instrument[] = [
  {
    id: 'inve-b',
    name: 'Investor B',
    ticker: 'INVE B',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'volv-b',
    name: 'Volvo B',
    ticker: 'VOLV B',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'evo',
    name: 'Evolution',
    ticker: 'EVO',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'avanza',
    name: 'Avanza Bank',
    ticker: 'AZA',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'atco-a',
    name: 'Atlas Copco A',
    ticker: 'ATCO A',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'seb-a',
    name: 'SEB A',
    ticker: 'SEB A',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'hm-b',
    name: 'H&M B',
    ticker: 'HM B',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'eric-b',
    name: 'Ericsson B',
    ticker: 'ERIC B',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'assa-b',
    name: 'Assa Abloy B',
    ticker: 'ASSA B',
    type: 'stock',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'avanza-global',
    name: 'Avanza Global',
    ticker: 'AVGLOB',
    type: 'fund',
    market: 'Fond',
    currency: 'SEK',
  },
  {
    id: 'xact-norden',
    name: 'XACT Norden 30',
    ticker: 'XACTNORDEN',
    type: 'etf',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'omxs30',
    name: 'OMXS30',
    ticker: 'OMXS30',
    type: 'index',
    market: 'Stockholm',
    currency: 'SEK',
  },
  {
    id: 'usdsek',
    name: 'USD/SEK',
    ticker: 'USDSEK',
    type: 'currency',
    market: 'FX',
    currency: 'SEK',
  },
  {
    id: 'btc',
    name: 'Bitcoin',
    ticker: 'BTC',
    type: 'crypto',
    market: 'Krypto',
    currency: 'SEK',
  },
]

/** Synchronous variant used by the header search, which filters as you type. */
export function searchInstrumentsLocal(query: string, limit = 6): Instrument[] {
  const q = query.trim().toLocaleLowerCase('sv-SE')
  if (!q) return []
  return instrumentUniverse
    .filter(
      (instrument) =>
        instrument.name.toLocaleLowerCase('sv-SE').includes(q) ||
        instrument.ticker.toLocaleLowerCase('sv-SE').includes(q),
    )
    .slice(0, limit)
}

export const holdings: Holding[] = [
  {
    id: 'inve-b',
    name: 'Investor B',
    ticker: 'INVE B',
    quantity: 1200,
    averagePrice: 231.4,
    lastPrice: 289.4,
    marketValue: 347280,
    changePercent: 1.12,
    weight: 12.2,
    currency: 'SEK',
  },
  {
    id: 'volv-b',
    name: 'Volvo B',
    ticker: 'VOLV B',
    quantity: 900,
    averagePrice: 248.1,
    lastPrice: 274.85,
    marketValue: 247365,
    changePercent: -0.63,
    weight: 8.7,
    currency: 'SEK',
  },
  {
    id: 'evo',
    name: 'Evolution',
    ticker: 'EVO',
    quantity: 310,
    averagePrice: 924.5,
    lastPrice: 812.2,
    marketValue: 251782,
    changePercent: 2.48,
    weight: 8.8,
    currency: 'SEK',
  },
  {
    id: 'atco-a',
    name: 'Atlas Copco A',
    ticker: 'ATCO A',
    quantity: 1500,
    averagePrice: 152.3,
    lastPrice: 178.15,
    marketValue: 267225,
    changePercent: -1.24,
    weight: 9.4,
    currency: 'SEK',
  },
  {
    id: 'avanza-global',
    name: 'Avanza Global',
    ticker: 'AVGLOB',
    quantity: 2400,
    averagePrice: 198.2,
    lastPrice: 241.7,
    marketValue: 580080,
    changePercent: 0.42,
    weight: 20.4,
    currency: 'SEK',
  },
  {
    id: 'xact-norden',
    name: 'XACT Norden 30',
    ticker: 'XACTNORDEN',
    quantity: 1800,
    averagePrice: 168.4,
    lastPrice: 182.24,
    marketValue: 328032,
    changePercent: 0.61,
    weight: 11.5,
    currency: 'SEK',
  },
]

export const screenerRows: ScreenerRow[] = [
  {
    id: 'inve-b',
    name: 'Investor B',
    ticker: 'INVE B',
    sector: 'Investmentbolag',
    price: 289.4,
    changePercent: 1.12,
    peRatio: 14.2,
    dividendYield: 1.7,
    marketCap: 886000000000,
  },
  {
    id: 'volv-b',
    name: 'Volvo B',
    ticker: 'VOLV B',
    sector: 'Verkstad',
    price: 274.85,
    changePercent: -0.63,
    peRatio: 11.8,
    dividendYield: 3.4,
    marketCap: 558000000000,
  },
  {
    id: 'evo',
    name: 'Evolution',
    ticker: 'EVO',
    sector: 'Spel',
    price: 812.2,
    changePercent: 2.48,
    peRatio: 13.1,
    dividendYield: 3.9,
    marketCap: 172000000000,
  },
  {
    id: 'seb-a',
    name: 'SEB A',
    ticker: 'SEB A',
    sector: 'Bank',
    price: 158.6,
    changePercent: 0.88,
    peRatio: 8.4,
    dividendYield: 6.2,
    marketCap: 340000000000,
  },
  {
    id: 'assa-b',
    name: 'Assa Abloy B',
    ticker: 'ASSA B',
    sector: 'Verkstad',
    price: 341.2,
    changePercent: 0.24,
    peRatio: 24.6,
    dividendYield: 1.6,
    marketCap: 379000000000,
  },
  {
    id: 'eric-b',
    name: 'Ericsson B',
    ticker: 'ERIC B',
    sector: 'Telekom',
    price: 82.14,
    changePercent: -1.02,
    peRatio: 17.9,
    dividendYield: 3.1,
    marketCap: 274000000000,
  },
]

export const reports: ReportItem[] = [
  {
    id: 'rep-1',
    title: 'Månadsrapport portfölj – februari',
    type: 'Portföljrapport',
    createdAt: '2025-03-01T09:00:00+01:00',
    status: 'completed',
    pages: 14,
  },
  {
    id: 'rep-2',
    title: 'Sektoranalys: svensk verkstad',
    type: 'Sektoranalys',
    createdAt: '2025-03-08T11:20:00+01:00',
    status: 'completed',
    pages: 22,
  },
  {
    id: 'rep-3',
    title: 'Riskgenomlysning Q1',
    type: 'Riskrapport',
    createdAt: '2025-03-12T14:45:00+01:00',
    status: 'running',
    pages: 0,
  },
  {
    id: 'rep-4',
    title: 'Utdelningsöversikt 2025',
    type: 'Utdelningar',
    createdAt: '2025-03-13T08:15:00+01:00',
    status: 'queued',
    pages: 0,
  },
]

/** Axis label granularity and point count per range. */
const RANGE_CONFIG: Record<
  TimeRange,
  { points: number; seed: number; drift: number; label: (i: number, n: number) => string }
> = {
  '1D': {
    points: 26,
    seed: 11,
    drift: 0.7,
    label: (i) => {
      const start = 9 * 60
      const minutes = start + i * 20
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    },
  },
  '1W': {
    points: 28,
    seed: 23,
    drift: 1.6,
    label: (i, n) => dayLabel(i, n, 7),
  },
  '1M': { points: 30, seed: 37, drift: 4.1, label: (i, n) => dayLabel(i, n, 30) },
  '3M': { points: 45, seed: 53, drift: 7.8, label: (i, n) => dayLabel(i, n, 90) },
  '1Y': { points: 52, seed: 71, drift: 18.4, label: (i, n) => dayLabel(i, n, 365) },
  ALL: { points: 60, seed: 97, drift: 46.2, label: (i, n) => dayLabel(i, n, 365 * 5) },
}

function dayLabel(index: number, total: number, spanDays: number): string {
  const daysBack = Math.round(((total - 1 - index) / Math.max(total - 1, 1)) * spanDays)
  const date = new Date(MOCK_NOW)
  date.setDate(date.getDate() - daysBack)
  return date.toISOString().slice(0, 10)
}

/**
 * Builds a deterministic performance series for the selected range.
 * Values are indexed to 100 at the start so portfolio and benchmark are comparable.
 */
export function getPerformanceSeries(range: TimeRange): PerformancePoint[] {
  const config = RANGE_CONFIG[range]
  const random = createRandom(config.seed)
  const points: PerformancePoint[] = []

  let portfolio = 100
  let benchmark = 100

  for (let i = 0; i < config.points; i += 1) {
    const progress = i / Math.max(config.points - 1, 1)
    const noise = (random() - 0.5) * (config.drift / 3)
    const benchNoise = (random() - 0.5) * (config.drift / 3.6)

    portfolio = 100 + config.drift * progress + noise * 2
    benchmark = 100 + config.drift * 0.72 * progress + benchNoise * 2

    points.push({
      t: config.label(i, config.points),
      portfolio: Number(portfolio.toFixed(2)),
      benchmark: Number(benchmark.toFixed(2)),
    })
  }

  return points
}

/**
 * Looks up a quote across the mock fixtures that carry price data. Falls
 * back to a flat zeroed quote for instruments this template has no price
 * for (e.g. most of `instrumentUniverse`) — mock data, not a real "no data" error.
 */
export function getMockQuote(instrumentId: string): Quote {
  const watchlistItem = watchlist.find((item) => item.id === instrumentId)
  if (watchlistItem) {
    return {
      instrumentId,
      price: watchlistItem.price,
      change: Number(
        ((watchlistItem.price * watchlistItem.changePercent) / 100).toFixed(2),
      ),
      changePercent: watchlistItem.changePercent,
      currency: watchlistItem.currency,
      updatedAt: MOCK_NOW.toISOString(),
    }
  }

  const holding = holdings.find((item) => item.id === instrumentId)
  if (holding) {
    return {
      instrumentId,
      price: holding.lastPrice,
      change: Number(((holding.lastPrice * holding.changePercent) / 100).toFixed(2)),
      changePercent: holding.changePercent,
      currency: holding.currency,
      updatedAt: MOCK_NOW.toISOString(),
    }
  }

  const index = marketIndices.find((item) => item.id === instrumentId)
  if (index) {
    return {
      instrumentId,
      price: index.value,
      change: Number(((index.value * index.changePercent) / 100).toFixed(2)),
      changePercent: index.changePercent,
      currency: index.currency ?? 'SEK',
      updatedAt: MOCK_NOW.toISOString(),
    }
  }

  return {
    instrumentId,
    price: 0,
    change: 0,
    changePercent: 0,
    currency: 'SEK',
    updatedAt: MOCK_NOW.toISOString(),
  }
}
