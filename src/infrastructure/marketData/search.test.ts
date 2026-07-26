/**
 * Instrument search (C1 phase one).
 *
 * Search is the one place a fuzzy provider lookup is legitimate — the user
 * reads the list and chooses — and these tests pin the boundary between that
 * and identity resolution, which Phase 5 established must never be fuzzy.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { hasData } from '~/domain/market'
import {
  MAX_SEARCH_RESULTS,
  MIN_QUERY_LENGTH,
  searchInstruments,
} from '~/application/marketData/searchInstruments'
import { createContainer } from './container'
import { createSearchDataSource } from './searchDataSource'
import { createFixtureProvider } from './providers/fixture'
import {
  createAvanzaSearchProvider,
  parseSearchHits,
  splitTitle,
} from './providers/avanza/search'

const RECORDED = JSON.parse(
  readFileSync(
    join(
      resolvePath(process.cwd(), 'src/infrastructure/marketData/providers/__fixtures__'),
      'avanza.search.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>

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

function build(mode: 'fixture' | 'hybrid' | 'live', tool?: unknown) {
  return createContainer({
    env: { MARKETDATA_MODE: mode },
    clock: new FakeClock('2026-07-26T16:00:00.000Z'),
    random: new SeededRandom(1),
    providers: [
      ...(tool && mode !== 'fixture'
        ? [
            {
              provider: createAvanzaSearchProvider(tool as never),
              capabilities: new Set(['search'] as const),
            },
          ]
        : []),
      { provider: createFixtureProvider(), capabilities: ALL_CAPS },
    ],
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, maxAttemptsRateLimited: 1 },
  })
}

const run = (mode: 'fixture' | 'hybrid' | 'live', query: string, tool?: unknown) =>
  searchInstruments(createSearchDataSource(build(mode, tool)), query)

const workingTool = async () => RECORDED.atlasCopco
const failingTool = async () => {
  throw new Error('avanza unreachable')
}

/* ------------------------------------------------------------------ parsing */

describe('parsing Avanza search hits', () => {
  it('splits the name from the ticker', () => {
    expect(splitTitle('Volvo B (VOLV B)')).toEqual({ name: 'Volvo B', ticker: 'VOLV B' })
  })

  it('leaves the ticker null when there is no trailing parenthesis', () => {
    // "SEB A" comes back with no bracket at all. A guess would be worse.
    expect(splitTitle('SEB A')).toEqual({ name: 'SEB A', ticker: null })
  })

  it('drops help articles, which carry no order book id', () => {
    // Searching "Avanza Bank" returns customer-support pages. Nothing to
    // select, so they are not search results.
    const results = parseSearchHits({
      hits: [
        { type: 'STOCK', title: 'Avanza Bank Holding (AZA)', orderBookId: '5361' },
        { type: 'ARTICLE', title: 'Hur skaffar jag BankID?' },
      ],
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.providerRef).toBe('avanza:5361')
  })

  it('reads no price, because search prices carry no timestamp', () => {
    // `search_instruments` returns Swedish-formatted strings with no
    // observation time. A price with no timestamp has no place here.
    const results = parseSearchHits(RECORDED.atlasCopco as never)
    expect(JSON.stringify(results)).not.toContain('354,80')
    for (const result of results) {
      expect(Object.keys(result)).not.toContain('price')
    }
  })

  it('attributes a venue only where the payload names one', () => {
    const results = parseSearchHits({
      hits: [
        {
          type: 'STOCK',
          title: 'Volvo B (VOLV B)',
          orderBookId: '5269',
          marketPlaceName: 'Stockholmsbörsen',
        },
        {
          type: 'STOCK',
          title: 'Something (X)',
          orderBookId: '999',
          marketPlaceName: 'Nordic MTF',
        },
      ],
    })
    expect(results[0]?.venue).toBe('XSTO')
    expect(results[1]?.venue).toBeNull()
  })
})

/* ----------------------------------------------------------------- identity */

describe('search is discovery, never identity', () => {
  it('returns a provider ref rather than a canonical symbol', () => {
    // The type-level guard: a fuzzy hit cannot become a tracked instrument by
    // assignment, which is what stops "Atlas Copco A" binding Atlas Copco B.
    const results = parseSearchHits(RECORDED.atlasCopco as never)
    for (const result of results) {
      expect(result.providerRef).toMatch(/^avanza:\d+$/)
      expect(result).not.toHaveProperty('symbol')
    }
  })

  it('still ranks the wrong share class first, and that is survivable here', () => {
    // The exact hazard from Phase 5, on the recorded payload. In a list the
    // user is reading, it is a minor annoyance; on a price tile it would be
    // the wrong company.
    const results = parseSearchHits(RECORDED.atlasCopco as never)
    expect(results[0]?.displayName).toBe('Atlas Copco B')
    expect(results.some((r) => r.displayName === 'Atlas Copco A')).toBe(true)
  })

  it('marks catalog members as tracked from the reviewed table', () => {
    const results = parseSearchHits(RECORDED.atlasCopco as never)
    const a = results.find((r) => r.providerRef === 'avanza:5234')
    const b = results.find((r) => r.providerRef === 'avanza:5235')
    // 5234 is in AVANZA_INSTRUMENTS; 5235 deliberately is not.
    expect(a?.isTracked).toBe(true)
    expect(b?.isTracked).toBe(false)
  })
})

/* ------------------------------------------------------------ the service */

describe('the search service', () => {
  it('sends nothing for a query too short to be useful', async () => {
    let called = 0
    const spy = async () => {
      called += 1
      return RECORDED.atlasCopco
    }
    const envelope = await run('hybrid', 'a', spy)
    expect(called).toBe(0)
    if (!hasData(envelope)) throw new Error('expected ok')
    expect(envelope.data.results).toEqual([])
    expect(MIN_QUERY_LENGTH).toBe(2)
  })

  it('caps how many results reach the UI', async () => {
    const envelope = await run('hybrid', 'atlas', workingTool)
    if (!hasData(envelope)) throw new Error('expected data')
    expect(envelope.data.results.length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS)
  })

  it('carries provenance naming Avanza a broker', async () => {
    const envelope = await run('hybrid', 'atlas', workingTool)
    if (!hasData(envelope)) throw new Error('expected data')
    expect(envelope.provenance.source.trust).toBe('broker')
  })

  it('distinguishes a failed search from an empty one', async () => {
    // The legacy path returned a bare list, so an outage and "no matches" both
    // rendered as an empty dropdown.
    const failed = await run('live', 'atlas', failingTool)
    expect(failed.state).toBe('error')
    expect(hasData(failed)).toBe(false)

    const empty = await run('fixture', 'zzzznothing')
    expect(hasData(empty)).toBe(true)
    if (!hasData(empty)) throw new Error('unreachable')
    expect(empty.data.results).toEqual([])
  })
})

/* --------------------------------------------------------------- mode rules */

describe('mode behaviour', () => {
  it('fixture: searches the reviewed catalog offline', async () => {
    const envelope = await run('fixture', 'volvo')
    if (!hasData(envelope)) throw new Error('expected data')
    expect(envelope.state).toBe('fixture')
    expect(envelope.data.results[0]?.displayName).toContain('Volvo')
  })

  it('live: shows no fixture results when the provider fails', async () => {
    const envelope = await run('live', 'volvo', failingTool)
    expect(envelope.state).toBe('error')
  })

  it('never serves a stale list for a different query', async () => {
    // Search deliberately disables stale fallback: a stale list from another
    // query is not degraded data, it is the wrong answer.
    const { policyFor } = await import('~/application/marketData/policy')
    expect(policyFor('search-se').fallback.allowStale).toBe(false)
  })
})
