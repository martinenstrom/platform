/**
 * Watchlist route data (C1 migration 2 of 5).
 *
 * The page renders four columns that look alike and are not: a delayed broker
 * quote, a series no provider serves yet, and an agent output no agent
 * produces. Most of these tests exist to prove those three never borrow each
 * other's provenance.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { hasData } from '~/domain/market'
import { getWatchlist, WATCHLIST_SYMBOLS } from '~/application/marketData/getWatchlist'
import { toWatchlistRows } from '~/presentation/marketData/watchlistViewModel'
import { createContainer } from './container'
import { createWatchlistDataSource } from './watchlistDataSource'
import { createFixtureProvider } from './providers/fixture'
import { createAvanzaProvider, type AvanzaToolCall } from './providers/avanza'
import { AVANZA_INSTRUMENTS } from './providers/avanza/map'

const RECORDED = JSON.parse(
  readFileSync(
    join(
      resolvePath(process.cwd(), 'src/infrastructure/marketData/providers/__fixtures__'),
      'avanza.quotes.json',
    ),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>

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

function workingTool(): AvanzaToolCall {
  const byId = Object.fromEntries(
    AVANZA_INSTRUMENTS.map((i) => [i.orderBookId, RECORDED.volvB]),
  )
  return (async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_marketplace_info') return RECORDED.marketplaceClosed
    return byId[String(args.instrument_id)]
  }) as AvanzaToolCall
}

const downTool: AvanzaToolCall = (async () => {
  throw new Error('avanza unreachable')
}) as AvanzaToolCall

function build(mode: 'fixture' | 'hybrid' | 'live', tool?: AvanzaToolCall) {
  const env: Record<string, string> = { MARKETDATA_MODE: mode }
  if (tool) env.MARKETDATA_CHAIN_EQUITY_SE = 'avanza,fixture'
  return createContainer({
    env,
    clock: new FakeClock('2026-07-26T16:00:00.000Z'),
    random: new SeededRandom(1),
    providers: [
      ...(tool && mode !== 'fixture'
        ? [
            {
              provider: createAvanzaProvider(tool),
              capabilities: new Set(['quotes'] as const),
            },
          ]
        : []),
      { provider: createFixtureProvider(), capabilities: ALL_CAPS },
    ],
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, maxAttemptsRateLimited: 1 },
  })
}

const snapshotOf = (mode: 'fixture' | 'hybrid' | 'live', tool?: AvanzaToolCall) =>
  getWatchlist(createWatchlistDataSource(build(mode, tool)))

const rowsOf = async (mode: 'fixture' | 'hybrid' | 'live', tool?: AvanzaToolCall) => {
  const snapshot = await snapshotOf(mode, tool)
  return {
    snapshot,
    rows: toWatchlistRows({
      symbols: WATCHLIST_SYMBOLS,
      quotes: snapshot.quotes,
      sparklines: snapshot.sparklines,
      instruments: snapshot.instruments,
    }),
  }
}

/* -------------------------------------------------------------------- quotes */

describe('the six curated instruments resolve through Avanza', () => {
  it('serves every symbol with broker provenance', async () => {
    const snapshot = await snapshotOf('hybrid', workingTool())
    expect(snapshot.quotes.state).toBe('ok')
    if (!hasData(snapshot.quotes)) throw new Error('no quotes')

    expect(snapshot.quotes.data.map((q) => q.symbol)).toEqual([...WATCHLIST_SYMBOLS])
    expect(snapshot.quotes.provenance.source.providerId).toBe('avanza')
    expect(snapshot.quotes.provenance.source.trust).toBe('broker')
  })

  it('keeps the delayed feed and the closed venue as separate facts', async () => {
    const snapshot = await snapshotOf('hybrid', workingTool())
    if (!hasData(snapshot.quotes)) throw new Error('no quotes')
    for (const quote of snapshot.quotes.data) {
      expect(quote.provenance.quality).toBe('delayed')
      expect(quote.session).toBe('closed')
      // timeOfLast, not `updated`.
      expect(quote.provenance.asOf).toBe('2026-07-24T15:29:30.000Z')
    }
  })

  it('exposes no Avanza payload field to the route', async () => {
    const snapshot = await snapshotOf('hybrid', workingTool())
    const serialized = JSON.stringify(snapshot)
    for (const leak of ['timeOfLast', 'isRealTime', 'orderBookId', 'updated']) {
      expect(serialized).not.toContain(leak)
    }
  })

  it('curates exactly six, unchanged', async () => {
    expect(WATCHLIST_SYMBOLS).toHaveLength(6)
    const { rows } = await rowsOf('hybrid', workingTool())
    expect(rows.map((r) => r.displayName)).toEqual([
      'Investor B',
      'Volvo B',
      'Evolution',
      'Avanza Bank',
      'Atlas Copco A',
      'SEB A',
    ])
  })
})

/* ------------------------------------------------------------------- signals */

describe('the signal column', () => {
  it('stays in the table as the future agent landing point', async () => {
    const { rows } = await rowsOf('hybrid', workingTool())
    for (const row of rows) expect(row.signal).toBeDefined()
  })

  it('is explicitly unavailable when real quotes resolved', async () => {
    // No agent exists. A buy/sell beside a real price would read as advice
    // about that price.
    const { rows } = await rowsOf('hybrid', workingTool())
    for (const row of rows) expect(row.signal.state).toBe('unavailable')
  })

  it('shows no simulated signal in live mode', async () => {
    const { rows } = await rowsOf('live', workingTool())
    for (const row of rows) {
      expect(row.signal.state).toBe('unavailable')
      expect(row.signal).not.toHaveProperty('signal')
    }
  })

  it('may show labelled examples only when the quotes are themselves fixtures', async () => {
    const { rows } = await rowsOf('fixture')
    const examples = rows.filter((r) => r.signal.state === 'example')
    expect(examples.length).toBeGreaterThan(0)
  })

  it('gates examples on the envelope, not on an environment flag', async () => {
    // Hybrid with a dead provider falls back to fixture quotes — and examples
    // are then permitted, because nothing real is on the row to be confused
    // with them.
    const { snapshot, rows } = await rowsOf('hybrid', downTool)
    expect(snapshot.quotes.state).toBe('fixture')
    expect(rows.some((r) => r.signal.state === 'example')).toBe(true)
  })
})

/* ---------------------------------------------------------------- sparklines */

describe('the sparkline column', () => {
  it('is empty in live mode rather than invented', async () => {
    const { snapshot, rows } = await rowsOf('live', workingTool())
    // No live series provider exists, and policy bars the fixture in
    // production, so there is no history — and none is manufactured.
    expect(hasData(snapshot.sparklines)).toBe(false)
    for (const row of rows) expect(row.spark).toEqual([])
  })

  it('keeps deterministic fixture history for development', async () => {
    const { rows } = await rowsOf('fixture')
    expect(rows[0]?.spark.length).toBeGreaterThan(1)
  })

  it('loses history without losing prices', async () => {
    const { snapshot, rows } = await rowsOf('live', workingTool())
    expect(snapshot.quotes.state).toBe('ok')
    expect(rows[0]?.value).toBe(354.8)
    expect(rows[0]?.spark).toEqual([])
  })
})

/* ---------------------------------------------------------------- degradation */

describe('degradation', () => {
  it('reports an error rather than a fixture quote in live mode', async () => {
    const snapshot = await snapshotOf('live', downTool)
    expect(snapshot.quotes.state).toBe('error')
    expect(hasData(snapshot.quotes)).toBe(false)
  })

  it('produces rows with null values rather than throwing', async () => {
    // The page must still render. A null value becomes a dash, never a zero.
    const { rows } = await rowsOf('live', downTool)
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.value).toBeNull()
      expect(row.changePercent).toBeNull()
      expect(row.signal.state).toBe('unavailable')
    }
  })

  it('carries no synthetic provenance anywhere in live mode', async () => {
    const snapshot = await snapshotOf('live', workingTool())
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('"trust":"synthetic"')
    expect(serialized).not.toContain('"quality":"fixture"')
  })
})

/* --------------------------------------------------------------------- reuse */

describe('the route shares the Overview resolution', () => {
  it('resolves quotes from the equity-se category', async () => {
    // One category, one cache entry, one breaker — the two pages cannot
    // disagree about the same six prices, and Avanza is not called twice.
    const calls: string[] = []
    const inner = workingTool()
    const spy = (async (name: string, args: Record<string, unknown>) => {
      calls.push(name)
      return inner(name, args)
    }) as AvanzaToolCall

    const container = build('hybrid', spy)
    await getWatchlist(createWatchlistDataSource(container))
    const first = calls.filter((c) => c === 'get_stock_quote').length
    expect(first).toBe(6)

    await getWatchlist(createWatchlistDataSource(container))
    // Second read is a cache hit; no further provider traffic.
    expect(calls.filter((c) => c === 'get_stock_quote').length).toBe(first)
  })
})

describe('one gate governs every invented value on a row', () => {
  it('withholds fixture history beside a real price', async () => {
    // Hybrid: real quotes, fixture sparklines. A generated line next to a real
    // price reads as that price's history.
    const { snapshot, rows } = await rowsOf('hybrid', workingTool())
    expect(snapshot.quotes.state).toBe('ok')
    expect(snapshot.sparklines.state).toBe('fixture')
    for (const row of rows) expect(row.spark).toEqual([])
  })

  it('allows a fully synthetic row to be a coherent demo', async () => {
    const { rows } = await rowsOf('fixture')
    expect(rows[0]?.spark.length).toBeGreaterThan(1)
    expect(rows.some((r) => r.signal.state === 'example')).toBe(true)
  })

  it('never mixes a real price with an invented signal', async () => {
    const { snapshot, rows } = await rowsOf('hybrid', workingTool())
    expect(snapshot.quotes.state).toBe('ok')
    for (const row of rows) expect(row.signal.state).toBe('unavailable')
  })
})
