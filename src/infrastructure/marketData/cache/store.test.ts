/**
 * Cache store bounds (C2).
 *
 * The store previously had no ceiling and never removed anything. That is safe
 * only while every cache key is fixed at build time, which stops being true the
 * moment a user-driven surface — a watchlist, a search box, a screener — reaches
 * the pipeline. These tests pin the bound so it cannot quietly come back.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { MemoryCacheStore, MAX_ENTRIES, STALE_RETENTION_MS } from './store'

const HOUR = 60 * 60 * 1000

describe('the store is bounded', () => {
  it('never exceeds its entry ceiling', async () => {
    const store = new MemoryCacheStore(new FakeClock(), 10)
    for (let i = 0; i < 50; i += 1) {
      await store.set(`key-${i}`, i, HOUR)
    }
    expect(store.size()).toBe(10)
  })

  it('evicts the least recently used key', async () => {
    const store = new MemoryCacheStore(new FakeClock(), 3)
    await store.set('a', 1, HOUR)
    await store.set('b', 2, HOUR)
    await store.set('c', 3, HOUR)

    // Touching 'a' makes 'b' the oldest.
    await store.get('a')
    await store.set('d', 4, HOUR)

    expect(await store.get('a')).not.toBeNull()
    expect(await store.get('b')).toBeNull()
    expect(await store.get('c')).not.toBeNull()
    expect(await store.get('d')).not.toBeNull()
  })

  it('ships a ceiling that normal operation never reaches', () => {
    // The Overview resolves roughly fifteen keys. The bound exists for the
    // user-driven surfaces that follow, not to constrain today's traffic.
    expect(MAX_ENTRIES).toBeGreaterThanOrEqual(1000)
  })
})

describe('expiry is not eviction', () => {
  it('keeps an expired entry so it can still be served as stale', async () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const store = new MemoryCacheStore(clock)
    await store.set('k', 'value', 60_000)

    clock.advance(10 * HOUR)
    const entry = await store.get('k')

    // Long past its TTL, and still available: the resolver decides whether to
    // serve it, and dropping it here would remove the fallback that keeps a
    // panel alive through an outage.
    expect(entry?.value).toBe('value')
    expect(entry!.expiresAtMs).toBeLessThan(clock.epochMs())
  })

  it('sweeps only what no policy could still serve', async () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const store = new MemoryCacheStore(clock)
    await store.set('ancient', 'value', 60_000)

    // Older than the longest maxStaleMs any category configures.
    clock.advance(STALE_RETENTION_MS + HOUR)
    // A write triggers the sweep; nothing sweeps on a read path.
    await store.set('fresh', 'value', 60_000)

    expect(await store.get('ancient')).toBeNull()
    expect(await store.get('fresh')).not.toBeNull()
  })

  it('retains an entry that is stale but still servable', async () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const store = new MemoryCacheStore(clock)
    await store.set('weekend', 'friday close', 60_000)

    // Three days: past every TTL, inside every stale ceiling.
    clock.advance(3 * 24 * HOUR)
    await store.set('other', 'value', 60_000)

    expect((await store.get('weekend'))?.value).toBe('friday close')
  })
})

describe('budget counters', () => {
  it('keeps a live counter across increments', async () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const store = new MemoryCacheStore(clock)
    const resetAt = clock.epochMs() + 12 * HOUR

    expect(await store.increment('budget:x', 1, resetAt)).toBe(1)
    expect(await store.increment('budget:x', 1, resetAt)).toBe(2)
  })

  it('starts a fresh window once the counter has reset', async () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const store = new MemoryCacheStore(clock)
    await store.increment('budget:x', 5, clock.epochMs() + HOUR)

    clock.advance(2 * HOUR)
    expect(await store.increment('budget:x', 1, clock.epochMs() + HOUR)).toBe(1)
  })

  it('drops counters whose window has passed', async () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const store = new MemoryCacheStore(clock)
    await store.increment('budget:gone', 1, clock.epochMs() + HOUR)

    clock.advance(2 * HOUR)
    // Incrementing a different provider sweeps the dead window.
    await store.increment('budget:live', 1, clock.epochMs() + HOUR)
    expect(await store.increment('budget:gone', 1, clock.epochMs() + HOUR)).toBe(1)
  })
})
