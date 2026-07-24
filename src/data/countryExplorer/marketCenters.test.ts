import { describe, expect, it } from 'vitest'
import { getMarketStatus, MARKET_CENTERS } from './marketCenters'

const newYork = MARKET_CENTERS.find((c) => c.id === 'new-york')!
const dubai = MARKET_CENTERS.find((c) => c.id === 'dubai')!

describe('getMarketStatus', () => {
  it('is CLOSED on a weekend regardless of time of day', () => {
    // 2026-07-19 is a Sunday.
    const sunday = new Date('2026-07-19T15:00:00Z')
    expect(getMarketStatus(newYork, sunday)).toBe('CLOSED')
  })

  it('is OPEN during the regular session on a weekday', () => {
    // 2026-07-20 (Monday) 15:00 UTC = 11:00 America/New_York (EDT, UTC-4) — within 09:30-16:00.
    const monday = new Date('2026-07-20T15:00:00Z')
    expect(getMarketStatus(newYork, monday)).toBe('OPEN')
  })

  it('is PRE-MARKET in the hour before the session opens', () => {
    // 09:00 America/New_York (EDT) = 13:00 UTC, 30 min before the 09:30 open.
    const preMarket = new Date('2026-07-20T13:00:00Z')
    expect(getMarketStatus(newYork, preMarket)).toBe('PRE-MARKET')
  })

  it('is AFTER-HOURS in the hour after the session closes', () => {
    // 16:30 America/New_York (EDT) = 20:30 UTC, 30 min after the 16:00 close.
    const afterHours = new Date('2026-07-20T20:30:00Z')
    expect(getMarketStatus(newYork, afterHours)).toBe('AFTER-HOURS')
  })

  it('is CLOSED late at night', () => {
    const midnight = new Date('2026-07-21T04:00:00Z')
    expect(getMarketStatus(newYork, midnight)).toBe('CLOSED')
  })

  it('defines all 23 expected financial centers', () => {
    expect(MARKET_CENTERS).toHaveLength(23)
  })

  it('is OPEN during Dubai regular session (no DST, UTC+4 year-round)', () => {
    // 2026-07-20 (Monday) 10:30 Asia/Dubai = 06:30 UTC — within 10:00-14:00.
    const duringSession = new Date('2026-07-20T06:30:00Z')
    expect(getMarketStatus(dubai, duringSession)).toBe('OPEN')
  })

  it('is CLOSED outside the Dubai session', () => {
    // 2026-07-20 (Monday) 20:00 Asia/Dubai = 16:00 UTC — after the 14:00 close + after-hours window.
    const afterSession = new Date('2026-07-20T16:00:00Z')
    expect(getMarketStatus(dubai, afterSession)).toBe('CLOSED')
  })
})
