import { describe, expect, it } from 'vitest'
import { FakeClock, SystemClock } from './clock'

describe('FakeClock', () => {
  it('does not move unless the test moves it', () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const first = clock.epochMs()
    const second = clock.epochMs()
    expect(second).toBe(first)
  })

  it('advances by an exact interval', () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    clock.advance(61_000)
    expect(clock.isoNow()).toBe('2026-07-26T12:01:01.000Z')
  })

  it('refuses to move backwards', () => {
    expect(() => new FakeClock().advance(-1)).toThrow(/cannot move backwards/)
  })

  it('returns a defensive copy from now()', () => {
    const clock = new FakeClock('2026-07-26T12:00:00.000Z')
    const date = clock.now()
    date.setFullYear(1999)
    expect(clock.isoNow()).toBe('2026-07-26T12:00:00.000Z')
  })
})

describe('SystemClock', () => {
  it('agrees with itself across its three accessors', () => {
    const clock = new SystemClock()
    const epoch = clock.epochMs()
    expect(Math.abs(clock.now().getTime() - epoch)).toBeLessThan(1_000)
    expect(Math.abs(new Date(clock.isoNow()).getTime() - epoch)).toBeLessThan(1_000)
  })
})
