/**
 * Markets route data (C1 migration 3 of 5).
 *
 * The route mixes four asset classes with different availability, and it is
 * the first page where migrating makes the screen visibly emptier. Most of
 * these tests exist to prove the emptiness is honest: no fixture standing in
 * for a missing source, no derived cross-rate invented to preserve a mock's
 * currency, and no fabricated statistic anywhere.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import {
  hasData,
  SYM_BTC,
  SYM_EURSEK,
  SYM_NASDAQ100,
  SYM_OMXS30,
  SYM_SP500,
  SYM_USDSEK,
} from '~/domain/market'
import {
  getMarkets,
  MARKETS_CRYPTO_SYMBOLS,
  MARKETS_FX_SYMBOLS,
  MARKETS_INDEX_INTL_SYMBOLS,
  MARKETS_INDEX_SE_SYMBOLS,
  MARKETS_TICKER_ORDER,
} from '~/application/marketData/getMarkets'
import {
  MARKET_INTELLIGENCE_ROWS,
  toMarketTickerRows,
  toneFor,
} from '~/presentation/marketData/marketsViewModel'
import { createContainer } from './container'
import { createMarketsDataSource } from './marketsDataSource'
import { createFixtureProvider } from './providers/fixture'
import { createAvanzaProvider, type AvanzaToolCall } from './providers/avanza'
import { createFrankfurterProvider } from './providers/frankfurter'
import { createCoinGeckoProvider } from './providers/coinGecko'
import { AVANZA_INSTRUMENTS } from './providers/avanza/map'
import { HttpError, type HttpClient } from './providers/httpClient'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const recorded = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')
const AVANZA = JSON.parse(recorded('avanza.quotes.json')) as Record<
  string,
  Record<string, unknown>
>

const ALL_CAPS = new Set([
  'quotes',
  'series',
  'fx',
  'yields',
  'commodities',
  'crypto',
  'news',
  'sentiment',
  'policy-rates',
  'search',
] as const)

function avanzaTool(): AvanzaToolCall {
  const byId = Object.fromEntries(
    AVANZA_INSTRUMENTS.map((i) => [i.orderBookId, AVANZA.omxs30]),
  )
  return (async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_marketplace_info') return AVANZA.marketplaceClosed
    return byId[String(args.instrument_id)]
  }) as AvanzaToolCall
}

/** Frankfurter and CoinGecko share one stub, routed by URL. */
function liveHttp(): HttpClient {
  const answer = (url: string) => {
    if (url.includes('coingecko')) {
      return JSON.stringify({ bitcoin: { usd: 78240.5, usd_24h_change: 2.14 } })
    }
    if (url.includes('base=EUR')) return recorded('frankfurter.eursek.timeseries.json')
    return recorded('frankfurter.usdsek.timeseries.json')
  }
  return {
    async getText(url: string) {
      return answer(url)
    },
    async getJson<T>(url: string) {
      return JSON.parse(answer(url)) as T
    },
  }
}

const deadHttp: HttpClient = {
  async getText(): Promise<string> {
    throw new HttpError('network', 'down')
  },
  async getJson<T>(): Promise<T> {
    throw new HttpError('network', 'down')
  },
}

const deadAvanza: AvanzaToolCall = (async () => {
  throw new Error('avanza unreachable')
}) as AvanzaToolCall

function build(mode: 'fixture' | 'hybrid' | 'live', options: { live?: boolean } = {}) {
  const useLive = options.live !== false && mode !== 'fixture'
  const http = options.live === false ? deadHttp : liveHttp()
  // Avanza speaks MCP, not HTTP, so a dead http client does not stop it. The
  // "everything is down" case has to kill the tool call too.
  const tool = options.live === false ? deadAvanza : avanzaTool()
  const env: Record<string, string> = { MARKETDATA_MODE: mode }
  if (useLive) {
    env.MARKETDATA_CHAIN_EQUITY_SE_INDEX = 'avanza,fixture'
    env.MARKETDATA_CHAIN_FX = 'frankfurter,fixture'
    env.MARKETDATA_CHAIN_CRYPTO = 'coingecko,fixture'
    env.COINGECKO_API_KEY = 'test-key'
    // Live mode with a metered provider refuses to start without this — the
    // H1 quota guard doing its job, including in tests.
    env.MARKETDATA_INSTANCE_COUNT = '1'
  }
  return createContainer({
    env,
    clock: new FakeClock('2026-07-24T12:00:00.000Z'),
    random: new SeededRandom(1),
    providers: [
      ...(mode === 'fixture'
        ? []
        : [
            {
              provider: createAvanzaProvider(tool),
              capabilities: new Set(['quotes'] as const),
            },
            {
              provider: createFrankfurterProvider(http),
              capabilities: new Set(['fx'] as const),
            },
            {
              provider: createCoinGeckoProvider(http, { apiKey: 'test-key' }),
              capabilities: new Set(['crypto'] as const),
            },
          ]),
      { provider: createFixtureProvider(), capabilities: ALL_CAPS },
    ],
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, maxAttemptsRateLimited: 1 },
  })
}

const snapshotOf = (mode: 'fixture' | 'hybrid' | 'live', options = {}) =>
  getMarkets(createMarketsDataSource(build(mode, options)))

async function rowsOf(mode: 'fixture' | 'hybrid' | 'live', options = {}) {
  const snapshot = await snapshotOf(mode, options)
  return {
    snapshot,
    rows: toMarketTickerRows({
      order: MARKETS_TICKER_ORDER,
      groups: [
        { symbols: MARKETS_INDEX_SE_SYMBOLS, envelope: snapshot.indicesSe },
        { symbols: MARKETS_INDEX_INTL_SYMBOLS, envelope: snapshot.indicesIntl },
        { symbols: MARKETS_FX_SYMBOLS, envelope: snapshot.fx },
        { symbols: MARKETS_CRYPTO_SYMBOLS, envelope: snapshot.crypto },
      ],
      instruments: snapshot.instruments,
    }),
  }
}

const rowFor = (rows: Awaited<ReturnType<typeof rowsOf>>['rows'], symbol: string) =>
  rows.find((r) => r.symbol === symbol)

/* ------------------------------------------------------------ real coverage */

describe('four rows resolve from real sources', () => {
  it('serves OMXS30 through Avanza', async () => {
    const snapshot = await snapshotOf('hybrid')
    expect(snapshot.indicesSe.state).toBe('ok')
    if (!hasData(snapshot.indicesSe)) throw new Error('no index')
    expect(snapshot.indicesSe.provenance.source.providerId).toBe('avanza')
    expect(snapshot.indicesSe.data[0]?.value).toBe(3199.61)
  })

  it('serves both FX pairs through Frankfurter', async () => {
    const snapshot = await snapshotOf('hybrid')
    expect(snapshot.fx.state).toBe('ok')
    if (!hasData(snapshot.fx)) throw new Error('no fx')
    expect(snapshot.fx.provenance.source.providerId).toBe('frankfurter')
    expect(snapshot.fx.data.map((q) => q.symbol).sort()).toEqual(
      [...MARKETS_FX_SYMBOLS].sort(),
    )
  })

  it('serves Bitcoin in USD through CoinGecko', async () => {
    const snapshot = await snapshotOf('hybrid')
    expect(snapshot.crypto.state).toBe('ok')
    if (!hasData(snapshot.crypto)) throw new Error('no crypto')
    expect(snapshot.crypto.provenance.source.providerId).toBe('coingecko')
    expect(snapshot.crypto.data[0]?.value).toBe(78240.5)
  })

  it('labels Bitcoin with its currency, since nothing else on the row would', async () => {
    const { rows } = await rowsOf('hybrid')
    expect(rowFor(rows, SYM_BTC)?.displayName).toBe('Bitcoin (USD)')
  })

  it('creates no derived BTC/SEK value', async () => {
    // The legacy mock showed 843200 SEK. Reproducing it would need
    // BTC/USD x USD/SEK with aligned timestamps and derived provenance — not
    // something to introduce to preserve a mock's currency choice.
    const { snapshot, rows } = await rowsOf('hybrid')
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('843200')
    expect(rowFor(rows, SYM_BTC)?.value).toBe(78240.5)
    if (!hasData(snapshot.crypto)) throw new Error('no crypto')
    expect(snapshot.crypto.provenance.source.trust).not.toBe('derived')
  })
})

/* ------------------------------------------------------- unavailable rows */

describe('the international indices have no approved source', () => {
  it('renders both as unavailable in live mode', async () => {
    const { rows } = await rowsOf('live')
    for (const symbol of [SYM_SP500, SYM_NASDAQ100]) {
      const row = rowFor(rows, symbol)
      expect(row?.state).toBe('unavailable')
      expect(row?.value).toBeNull()
      expect(row?.changePercent).toBeNull()
    }
  })

  it('keeps both rows visible rather than narrowing the product', async () => {
    const { rows } = await rowsOf('live')
    expect(rows.map((r) => r.symbol)).toEqual([...MARKETS_TICKER_ORDER])
    expect(rowFor(rows, SYM_SP500)?.displayName).toBe('S&P 500')
  })

  it('substitutes no proxy instrument for them', async () => {
    const { snapshot } = await rowsOf('live')
    const serialized = JSON.stringify(snapshot)
    // No ETF proxy, and nothing claiming to stand in for something else.
    expect(serialized).not.toContain('"isProxy":true')
  })

  it('mutes them rather than colouring them as flat', async () => {
    const { rows } = await rowsOf('live')
    expect(rowFor(rows, SYM_SP500)?.tone).toBe('muted')
  })
})

/* -------------------------------------------------------------- mode rules */

describe('mode behaviour', () => {
  it('live: shows no fixture quote', async () => {
    const { snapshot } = await rowsOf('live', { live: false })
    for (const envelope of [snapshot.indicesSe, snapshot.fx, snapshot.crypto]) {
      expect(envelope.state).not.toBe('fixture')
    }
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('"trust":"synthetic"')
    expect(serialized).not.toContain('"quality":"fixture"')
  })

  it('hybrid: labels a fixture fallback rather than hiding it', async () => {
    const { snapshot, rows } = await rowsOf('hybrid', { live: false })
    expect(snapshot.fx.state).toBe('fixture')
    // The row carries the demo marker so the screen can say so.
    expect(rowFor(rows, SYM_USDSEK)?.isDemo).toBe(true)
  })

  it('fixture: deterministic values with explicit synthetic provenance', async () => {
    const { snapshot, rows } = await rowsOf('fixture')
    expect(snapshot.indicesSe.state).toBe('fixture')
    if (!hasData(snapshot.indicesSe)) throw new Error('no index')
    expect(snapshot.indicesSe.provenance.source.trust).toBe('synthetic')
    expect(rowFor(rows, SYM_OMXS30)?.isDemo).toBe(true)
  })

  it('degrades without crashing when every provider is down', async () => {
    const { rows } = await rowsOf('live', { live: false })
    expect(rows).toHaveLength(6)
    for (const row of rows) expect(row.value).toBeNull()
  })
})

/* ------------------------------------------------------- market climate card */

describe('the Market Climate card', () => {
  it('carries none of the four fabricated claims', () => {
    /*
     * Scanned against the ROUTE SOURCE, not a snapshot: the claims were
     * hardcoded strings in mock data, and a snapshot scan for "54" matches
     * any payload digit pair, which would pass for the wrong reason.
     */
    const route = readFileSync(
      join(resolvePath(process.cwd(), 'src/routes'), 'markets.tsx'),
      'utf8',
    )
    for (const invented of [
      '54 %',
      'MA50',
      'tremånaderssnitt',
      'fyra dagar',
      'Stigande',
      'Förhöjd',
      'Under snitt',
    ]) {
      expect(route).not.toContain(invented)
    }
    expect(route).not.toMatch(/\bmarketTrends\b/)
  })

  it('carries labels only — there is no value field to fill', async () => {
    for (const row of MARKET_INTELLIGENCE_ROWS) {
      expect(Object.keys(row).sort()).toEqual(['id', 'label'])
    }
  })

  it('survives as the future Market Intelligence landing place', () => {
    expect(MARKET_INTELLIGENCE_ROWS.length).toBeGreaterThan(0)
    expect(MARKET_INTELLIGENCE_ROWS.map((r) => r.id)).toEqual([
      'breadth',
      'trend',
      'volatility',
      'flows',
    ])
  })
})

/* -------------------------------------------------------------------- tone */

describe('tone is derived, not shipped as data', () => {
  it('follows the change when a real number exists', () => {
    expect(toneFor('ok', 1.2)).toBe('positive')
    expect(toneFor('ok', -0.4)).toBe('negative')
    expect(toneFor('ok', 0)).toBe('neutral')
  })

  it('mutes anything without a current number', () => {
    // An unavailable row must not read as "flat", which a neutral grey
    // number implies.
    expect(toneFor('unavailable', null)).toBe('muted')
    expect(toneFor('error', 5)).toBe('muted')
  })

  it('applies the same rule to stale and fixture values', () => {
    expect(toneFor('stale', 1)).toBe('positive')
    expect(toneFor('fixture', -1)).toBe('negative')
  })
})

/* ------------------------------------------------------------------ hygiene */

describe('provenance and ordering', () => {
  it('names a source for every resolved row', async () => {
    const { rows } = await rowsOf('hybrid')
    for (const row of rows) {
      if (row.value === null) continue
      expect(row.sourceName).toBeTruthy()
    }
  })

  it('names no source for an unavailable row', async () => {
    const { rows } = await rowsOf('live')
    expect(rowFor(rows, SYM_SP500)?.sourceName).toBeNull()
  })

  it('preserves the display order across four separate envelopes', async () => {
    const { rows } = await rowsOf('hybrid')
    expect(rows.map((r) => r.symbol)).toEqual([
      SYM_OMXS30,
      SYM_SP500,
      SYM_NASDAQ100,
      SYM_EURSEK,
      SYM_USDSEK,
      SYM_BTC,
    ])
  })
})

describe('example-data wording is no longer globally misleading', () => {
  const read = (path: string) => readFileSync(resolvePath(process.cwd(), path), 'utf8')

  it('drops the app-wide claim that everything is example data', () => {
    // True before Phase 0, false since the Overview, Bevakning and Marknader
    // routes began serving real quotes.
    const root = read('src/routes/__root.tsx')
    expect(root).not.toContain('All data i denna version är exempeldata')
  })

  it('does not claim the Markets page is entirely example data', () => {
    const route = read('src/routes/markets.tsx')
    expect(route).not.toContain('Exempeldata.')
  })

  it('does not claim the Markets page is entirely live', () => {
    /*
     * The Command Center v1 gate moved the market overview to `/markets` and
     * required the disclosure to move with it — so this now reads the component
     * the route renders rather than the route file, which is four lines of
     * wiring.
     *
     * What it protects is unchanged and is now stronger: the page states
     * whether every category is actually serving live data, from
     * `hasDegradedCategory`, instead of leaving a fixture or a stale value
     * looking identical to a live one.
     */
    const screen = read('src/components/lightDashboard/LightCommandCenter.tsx')
    expect(screen).toMatch(/hasDegradedCategory/)
    expect(screen).toMatch(/ej tillgängliga/i)
  })
})
