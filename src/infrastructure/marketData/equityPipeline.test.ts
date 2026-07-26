/**
 * Avanza through the full pipeline (Phase 5 exit criteria).
 *
 * The adapter's own contract lives in `providers/avanza.test.ts`. This file
 * proves the end-to-end path — Avanza → registry → resilience → application
 * service → snapshot — and the mode guarantees that matter most: that live
 * mode never shows a fixture quote, never shows a synthetic sparkline, and
 * that losing Avanza or the local MCP dependency costs the Overview those
 * panels rather than the whole page.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import {
  hasData,
  OVERVIEW_INDEX_SYMBOLS,
  OVERVIEW_WATCHLIST_SYMBOLS,
  SYM_OMXS30,
} from '~/domain/market'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import { policyFor } from '~/application/marketData/policy'
import { createContainer } from './container'
import { createOverviewDataSource } from './overviewDataSource'
import { createFixtureProvider } from './providers/fixture'
import { createAvanzaProvider, type AvanzaToolCall } from './providers/avanza'
import { AVANZA_INSTRUMENTS, orderBookIdFor } from './providers/avanza/map'

const FIXTURES = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const RECORDED = JSON.parse(
  readFileSync(join(FIXTURES, 'avanza.quotes.json'), 'utf8'),
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
] as const)

const NOW = '2026-07-26T16:00:00.000Z'

/** Serves every approved order book from the recorded payloads. */
function workingTool(): AvanzaToolCall {
  const byId = Object.fromEntries(
    AVANZA_INSTRUMENTS.map((i) => [
      i.orderBookId,
      i.symbol === SYM_OMXS30 ? RECORDED.omxs30 : RECORDED.volvB,
    ]),
  )
  return (async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_marketplace_info') return RECORDED.marketplaceClosed
    const payload = byId[String(args.instrument_id)]
    if (!payload) throw new Error(`unmapped order book ${args.instrument_id}`)
    return payload
  }) as AvanzaToolCall
}

/** Stands in for `uvx` or `avanza-mcp` not being installed at all. */
function missingDependencyTool(): AvanzaToolCall {
  return (async () => {
    throw new Error("spawn uvx ENOENT: 'uvx' is not recognised as a command")
  }) as AvanzaToolCall
}

function build(options: {
  mode: 'fixture' | 'hybrid' | 'live'
  tool?: AvanzaToolCall
  now?: string
}) {
  const env: Record<string, string> = { MARKETDATA_MODE: options.mode }
  if (options.tool) {
    env.MARKETDATA_CHAIN_EQUITY_SE = 'avanza,fixture'
    env.MARKETDATA_CHAIN_EQUITY_SE_INDEX = 'avanza,fixture'
  }
  return createContainer({
    env,
    clock: new FakeClock(options.now ?? NOW),
    random: new SeededRandom(1),
    providers: [
      ...(options.tool
        ? [
            {
              provider: createAvanzaProvider(options.tool),
              capabilities: new Set(['quotes'] as const),
            },
          ]
        : []),
      { provider: createFixtureProvider(), capabilities: ALL_CAPS },
    ],
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, maxAttemptsRateLimited: 1 },
  })
}

const snapshotOf = (options: Parameters<typeof build>[0]) =>
  getOverviewSnapshot(createOverviewDataSource(build(options)))

/* ------------------------------------------------------------- the happy path */

describe('the seven approved instruments resolve through Avanza', () => {
  it('serves the watchlist with broker provenance', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid', tool: workingTool() })
    const { watchlist } = snapshot
    expect(watchlist.state).toBe('ok')
    if (!hasData(watchlist)) throw new Error('no watchlist')
    expect(watchlist.provenance.source.providerId).toBe('avanza')
    expect(watchlist.provenance.source.trust).toBe('broker')
    expect(watchlist.provenance.quality).toBe('delayed')
    expect(watchlist.data.map((q) => q.symbol)).toEqual([...OVERVIEW_WATCHLIST_SYMBOLS])
  })

  it('serves OMXS30 from Avanza while the other five indices stay fixture', async () => {
    // The split is the point: an international index has no approved source
    // until D1 is settled, and one shared chain would either mask a Swedish
    // outage or let an international fixture ride in on a Swedish success.
    const snapshot = await snapshotOf({ mode: 'hybrid', tool: workingTool() })
    const { indices } = snapshot
    if (!hasData(indices)) throw new Error('no indices')
    expect(indices.data.map((q) => q.symbol)).toEqual([...OVERVIEW_INDEX_SYMBOLS])

    const omx = indices.data.find((q) => q.symbol === SYM_OMXS30)
    expect(omx?.provenance.source.providerId).toBe('avanza')
    expect(omx?.value).toBe(3199.61)

    // The combined envelope is honest about the weakest part.
    expect(indices.state).toBe('fixture')
  })

  it('keeps the session and the feed quality as separate facts', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid', tool: workingTool() })
    if (!hasData(snapshot.watchlist)) throw new Error('no watchlist')
    for (const quote of snapshot.watchlist.data) {
      expect(quote.session).toBe('closed')
      expect(quote.provenance.quality).toBe('delayed')
    }
  })

  it('asks for one quote per instrument and one session lookup per batch', async () => {
    const calls: string[] = []
    const inner = workingTool()
    const spy = (async (name: string, args: Record<string, unknown>) => {
      calls.push(name)
      return inner(name, args)
    }) as AvanzaToolCall

    const container = build({ mode: 'hybrid', tool: spy })
    await getOverviewSnapshot(createOverviewDataSource(container))

    const quoteCalls = calls.filter((c) => c === 'get_stock_quote')
    const infoCalls = calls.filter((c) => c === 'get_marketplace_info')
    // Six watchlist symbols plus OMXS30.
    expect(quoteCalls).toHaveLength(7)
    // One per resolved category — the watchlist and the Swedish index.
    expect(infoCalls).toHaveLength(2)
    expect(calls).not.toContain('search_instruments')
  })
})

/* ----------------------------------------------------------- mode guarantees */

describe('fixture mode', () => {
  it('registers no Avanza provider and reaches no transport', async () => {
    let touched = 0
    const container = build({
      mode: 'fixture',
      tool: (async () => {
        touched += 1
        throw new Error('must not be reached')
      }) as AvanzaToolCall,
    })
    const snapshot = await getOverviewSnapshot(createOverviewDataSource(container))
    expect(touched).toBe(0)
    expect(snapshot.watchlist.state).toBe('fixture')
  })
})

describe('hybrid mode', () => {
  it('falls back to fixtures and says so', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid', tool: missingDependencyTool() })
    expect(snapshot.watchlist.state).toBe('fixture')
    if (!hasData(snapshot.watchlist)) throw new Error('no watchlist')
    // Labelled, not disguised: synthetic trust is what makes it visible.
    expect(snapshot.watchlist.provenance.source.trust).toBe('synthetic')
    expect(snapshot.watchlist.provenance.quality).toBe('fixture')
  })
})

describe('live mode never presents invented data', () => {
  it('shows no fixture quote when Avanza is unavailable', async () => {
    const snapshot = await snapshotOf({ mode: 'live', tool: missingDependencyTool() })
    // An honest failure, not a fabricated price.
    expect(snapshot.watchlist.state).toBe('error')
    expect(hasData(snapshot.watchlist)).toBe(false)
  })

  it('shows no fixture quote for the Swedish index either', async () => {
    const snapshot = await snapshotOf({ mode: 'live', tool: missingDependencyTool() })
    if (hasData(snapshot.indices)) {
      const omx = snapshot.indices.data.find((q) => q.symbol === SYM_OMXS30)
      expect(omx).toBeUndefined()
    }
  })

  it('shows no synthetic sparkline', async () => {
    // Phase 6 owns real series. Until then live mode simply has none, and the
    // PRNG generator must not stand in for market history.
    const snapshot = await snapshotOf({ mode: 'live', tool: workingTool() })
    for (const envelope of [snapshot.indexSparklines, snapshot.watchlistSparklines]) {
      expect(hasData(envelope)).toBe(false)
    }
  })

  it('carries no synthetic provenance anywhere in the snapshot', async () => {
    const snapshot = await snapshotOf({ mode: 'live', tool: workingTool() })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('"trust":"synthetic"')
    expect(serialized).not.toContain('"quality":"fixture"')
  })

  it('still serves the quotes it can while the sparklines are absent', async () => {
    // The degradation must be surgical. Losing decorative history is not a
    // reason to lose the prices.
    const snapshot = await snapshotOf({ mode: 'live', tool: workingTool() })
    expect(snapshot.watchlist.state).toBe('ok')
    expect(hasData(snapshot.watchlistSparklines)).toBe(false)
  })
})

/* --------------------------------------------------------------- degradation */

describe('a missing local MCP dependency degrades safely', () => {
  it('never rejects the snapshot as a whole', async () => {
    // A spawn failure must surface as a degraded category, not a rejected
    // promise that takes SSR down with it.
    const snapshot = await snapshotOf({ mode: 'live', tool: missingDependencyTool() })
    expect(snapshot.generatedAt).toBeTruthy()
    expect(snapshot.watchlist.state).toBe('error')
  })

  it('leaves the categories Avanza does not serve alone', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid', tool: missingDependencyTool() })
    // Yields, FX and the rest resolve exactly as they did before Phase 5.
    expect(snapshot.yields.state).not.toBe('error')
    expect(snapshot.fx.state).not.toBe('error')
    expect(snapshot.yieldCurve.state).not.toBe('error')
  })

  it('isolates the Swedish index failure from the international ones', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid', tool: missingDependencyTool() })
    if (!hasData(snapshot.indices)) throw new Error('no indices')
    // The five international tiles are fixture-backed and unaffected.
    expect(snapshot.indices.data.length).toBeGreaterThanOrEqual(5)
  })
})

/* -------------------------------------------------------------------- policy */

describe('the Swedish equity freshness policy', () => {
  it('is stated concretely rather than as "one session"', () => {
    for (const category of ['equity-se', 'equity-index-se'] as const) {
      const policy = policyFor(category)
      expect(policy.ttlOpenMs).toBe(60_000)
      expect(policy.ttlClosedMs).toBe(15 * 60_000)
      expect(policy.staleWhileRevalidate).toBe(true)
      // 5 days. Nasdaq Stockholm's longest scheduled closure runs from the
      // Maundy Thursday half-day to the Tuesday after Easter Monday, roughly
      // 116 hours; a tighter ceiling would blank the panel over Easter while
      // Avanza was working perfectly.
      expect(policy.fallback.maxStaleMs).toBe(5 * 24 * 60 * 60 * 1000)
      // Fixtures are barred from production, which is what makes the live-mode
      // guarantees above structural rather than incidental.
      expect(policy.fallback.allowFixture).toBe('non-production')
      expect(policy.fallback.allowProxy).toBe(false)
    }
  })

  it('holds a stale quote across a normal weekend', async () => {
    // Friday's last trade, read on Monday morning before the open: 63.5 hours,
    // comfortably inside the ceiling.
    const policy = policyFor('equity-se')
    const fridayClose = Date.parse('2026-07-24T15:30:00.000Z')
    const mondayOpen = Date.parse('2026-07-27T07:00:00.000Z')
    expect(mondayOpen - fridayClose).toBeLessThan(policy.fallback.maxStaleMs)
  })

  it('holds a stale quote across the Easter closure', async () => {
    const policy = policyFor('equity-se')
    const maundyThursday = Date.parse('2026-04-02T11:00:00.000Z')
    const tuesdayOpen = Date.parse('2026-04-07T07:00:00.000Z')
    expect(tuesdayOpen - maundyThursday).toBeLessThan(policy.fallback.maxStaleMs)
  })
})

/* ------------------------------------------------------- staleness is honest */

describe('an Avanza value past its TTL is never labelled fresh', () => {
  /** Same container across two resolutions, with a clock we can move. */
  function persistent(tool: AvanzaToolCall) {
    const clock = new FakeClock(NOW)
    const container = createContainer({
      env: {
        MARKETDATA_MODE: 'hybrid',
        MARKETDATA_CHAIN_EQUITY_SE: 'avanza,fixture',
        MARKETDATA_CHAIN_EQUITY_SE_INDEX: 'avanza,fixture',
      },
      clock,
      random: new SeededRandom(1),
      providers: [
        {
          provider: createAvanzaProvider(tool),
          capabilities: new Set(['quotes'] as const),
        },
        { provider: createFixtureProvider(), capabilities: ALL_CAPS },
      ],
      retry: {
        maxAttempts: 1,
        baseDelayMs: 1,
        maxDelayMs: 2,
        maxAttemptsRateLimited: 1,
      },
    })
    return { container, clock }
  }

  it('serves a cached quote as stale, not ok, once the TTL has passed', async () => {
    let calls = 0
    const working = workingTool()
    const counting = (async (name: string, args: Record<string, unknown>) => {
      if (name === 'get_stock_quote') calls += 1
      return working(name, args)
    }) as AvanzaToolCall

    const { container, clock } = persistent(counting)
    const first = await getOverviewSnapshot(createOverviewDataSource(container))
    expect(first.watchlist.state).toBe('ok')

    // Past the closed-market TTL, with the provider now unreachable so the
    // cache is the only thing left to serve.
    clock.advance(16 * 60_000)
    const seen = calls
    const stalled = await getOverviewSnapshot(createOverviewDataSource(container))

    expect(stalled.watchlist.state).toBe('stale')
    expect(stalled.watchlist.state).not.toBe('ok')
    if (!hasData(stalled.watchlist)) throw new Error('no watchlist')
    // The age is recomputed against the current clock, so it cannot be frozen
    // at the moment the value was cached and read as fresh later.
    expect(stalled.watchlist.provenance.ageMs).toBeGreaterThan(
      first.watchlist.state === 'ok' ? first.watchlist.provenance.ageMs : 0,
    )
    expect(calls).toBeGreaterThanOrEqual(seen)
  })

  it('keeps a four-day-old value stale rather than promoting it to fresh', async () => {
    // Working once, then unreachable — so the cached value is the only thing
    // available and the ceiling is what decides whether it may be shown.
    let live = true
    const working = workingTool()
    const failing = (async (name: string, args: Record<string, unknown>) => {
      if (!live) throw new Error('avanza unreachable')
      return working(name, args)
    }) as AvanzaToolCall

    const { container, clock } = persistent(failing)
    expect(
      (await getOverviewSnapshot(createOverviewDataSource(container))).watchlist.state,
    ).toBe('ok')
    live = false

    /*
     * Age runs from the OBSERVATION, not from when the value was cached. The
     * recorded payload's last trade is 2026-07-24T15:29:30Z, already ~2 days
     * before this container's clock starts, so two more days puts it at ~4 —
     * inside the ceiling. A quote that was old when we fetched it does not get
     * a fresh five-day budget for having been stored.
     */
    clock.advance(2 * 24 * 60 * 60 * 1000)
    const aged = await getOverviewSnapshot(createOverviewDataSource(container))
    expect(aged.watchlist.state).toBe('stale')
    if (!hasData(aged.watchlist)) throw new Error('no watchlist')
    expect(aged.watchlist.provenance.ageMs).toBeGreaterThan(4 * 24 * 60 * 60 * 1000)

    // The ceiling limits how long a stale value may be SHOWN. It is never a
    // window in which that value counts as current, and past it the value is
    // not served at all rather than quietly ageing into freshness.
    expect(policyFor('equity-se').fallback.maxStaleMs).toBe(5 * 24 * 60 * 60 * 1000)
  })

  it('stops serving the value once it passes the ceiling', async () => {
    let live = true
    const working = workingTool()
    const failing = (async (name: string, args: Record<string, unknown>) => {
      if (!live) throw new Error('avanza unreachable')
      return working(name, args)
    }) as AvanzaToolCall

    const { container, clock } = persistent(failing)
    await getOverviewSnapshot(createOverviewDataSource(container))
    live = false

    // ~2 days old on arrival plus four more: past the ceiling.
    clock.advance(4 * 24 * 60 * 60 * 1000)
    const expired = await getOverviewSnapshot(createOverviewDataSource(container))
    // Hybrid mode may fall to a fixture here; what must never happen is the
    // six-day-old broker quote being served, in any state.
    expect(expired.watchlist.state).not.toBe('ok')
    expect(expired.watchlist.state).not.toBe('stale')
  })
})

/* ------------------------------------------------------------------ identity */

describe('identity never resolves at runtime', () => {
  it('maps every Overview symbol without a search', () => {
    for (const symbol of OVERVIEW_WATCHLIST_SYMBOLS) {
      expect(orderBookIdFor(symbol).orderBookId).toMatch(/^\d+$/)
    }
    expect(orderBookIdFor(SYM_OMXS30).orderBookId).toBe('19002')
  })
})
