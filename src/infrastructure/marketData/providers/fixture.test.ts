/**
 * Fixture provider guarantees (T18 + Phase 0 gate G3).
 *
 * The Overview's determinism rests entirely on this provider, so the two
 * properties it promises are tested directly rather than inferred from the
 * golden snapshot passing.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import { hasData, type Envelope } from '~/domain/market'
import { createContainer } from '../container'
import { createOverviewDataSource } from '../overviewDataSource'
import { createFixtureProvider } from './fixture'

const CAPABILITIES = new Set([
  'quotes',
  'series',
  'fx',
  'yields',
  'commodities',
  'crypto',
  'news',
  'sentiment',
] as const)

function snapshotAt(iso: string) {
  const container = createContainer({
    env: {},
    clock: new FakeClock(iso),
    providers: [{ provider: createFixtureProvider(), capabilities: CAPABILITIES }],
  })
  return getOverviewSnapshot(createOverviewDataSource(container))
}

describe('fixture-backed OverviewSnapshot', () => {
  it('is byte-identical across runs for the same clock', async () => {
    const a = await snapshotAt('2026-07-26T12:00:00.000Z')
    const b = await snapshotAt('2026-07-26T12:00:00.000Z')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('labels every category as fixture quality', async () => {
    const snapshot = await snapshotAt('2026-07-26T12:00:00.000Z')
    const envelopes: Array<Envelope<unknown>> = [
      snapshot.indices,
      snapshot.fx,
      snapshot.commodities,
      snapshot.crypto,
      snapshot.yields,
      snapshot.yieldCurve,
      snapshot.sectors,
      snapshot.sentiment,
      snapshot.news,
      snapshot.intraday,
      snapshot.watchlist,
    ]
    for (const envelope of envelopes) {
      expect(hasData(envelope)).toBe(true)
      if (hasData(envelope)) {
        expect(envelope.provenance.quality).toBe('fixture')
        expect(envelope.provenance.source.providerId).toBe('fixture')
      }
    }
  })

  it('ages with the clock instead of pinning to a frozen mock date', async () => {
    // The legacy fixtures carried absolute 2025/2026 dates, so the news feed
    // would eventually have read "för 8 månader sedan". Offsets keep it honest.
    const early = await snapshotAt('2026-07-26T12:00:00.000Z')
    const later = await snapshotAt('2027-01-15T09:30:00.000Z')
    expect(early.asOf).not.toBe(later.asOf)
    expect(new Date(later.asOf).getUTCFullYear()).toBe(2027)

    const earlyNews = hasData(early.news) ? early.news.data[0] : undefined
    const laterNews = hasData(later.news) ? later.news.data[0] : undefined
    const ageOf = (published: string | undefined, now: string) =>
      published === undefined
        ? null
        : new Date(now).getTime() - new Date(published).getTime()
    // Same age, different absolute instant — that is the whole point.
    expect(ageOf(earlyNews?.publishedAt, early.generatedAt)).toBe(42 * 60_000)
    expect(ageOf(laterNews?.publishedAt, later.generatedAt)).toBe(42 * 60_000)
  })

  it('reports asOf as the oldest category, never the newest', async () => {
    const snapshot = await snapshotAt('2026-07-26T12:00:00.000Z')
    const categories: Array<Envelope<unknown>> = [
      snapshot.indices,
      snapshot.news,
      snapshot.yields,
    ]
    const ages = categories
      .filter(hasData)
      .map((envelope) => new Date(envelope.provenance.asOf).getTime())
    expect(new Date(snapshot.asOf).getTime()).toBe(Math.min(...ages))
  })

  it('flags the snapshot as degraded while it is fixture-backed', async () => {
    const snapshot = await snapshotAt('2026-07-26T12:00:00.000Z')
    expect(snapshot.hasDegradedCategory).toBe(true)
  })

  it('resolves the bitcoin/btc identifier defect (D1)', async () => {
    const snapshot = await snapshotAt('2026-07-26T12:00:00.000Z')
    expect(hasData(snapshot.crypto)).toBe(true)
    if (!hasData(snapshot.crypto)) return
    const btc = snapshot.crypto.data.find((quote) => quote.symbol === 'crypto:btc')
    // Previously the lookup used 'bitcoin' against an id of 'btc', silently
    // fell through, and an inline literal was rendered instead.
    expect(btc).toBeDefined()
    expect(btc?.value).toBe(71386.25)
    expect(btc?.percentageChange).toBeCloseTo(1.18, 6)
  })

  it('keeps every financial value numeric', async () => {
    const snapshot = await snapshotAt('2026-07-26T12:00:00.000Z')
    if (!hasData(snapshot.indices) || !hasData(snapshot.yields))
      throw new Error('no data')
    for (const quote of snapshot.indices.data) {
      expect(typeof quote.value).toBe('number')
      expect(typeof quote.percentageChange).toBe('number')
    }
    for (const entry of snapshot.yields.data) {
      expect(typeof entry.yieldPercent).toBe('number')
      expect(typeof entry.changeBasisPoints).toBe('number')
    }
  })
})
