/**
 * What a marker means.
 *
 * Financial OS measures three things that all sound like freshness — cache
 * TTL, retention ceiling, observation age — and until 2026-08-25 the disclosure
 * layer answered the third question with the first two. A seven-second-old S&P
 * observation, served from a cache that had passed its sixty-second TTL while
 * a refresh ran behind it, rendered INAKTUELL to the reader. Nothing about the
 * market had changed; only our request pacing had.
 *
 * These cases pin the vocabulary:
 *
 *   FÖRDRÖJD    a real observation, current enough for this session, from a
 *               source that guarantees no realtime
 *   INAKTUELL   the observation itself is too old for this session
 *
 * and the precedence that keeps both reachable: age outranks delay, because
 * every Yahoo observation is flagged delayed and a rule that let delay win
 * would make INAKTUELL unreachable for them at any age.
 */

import { describe, expect, it } from 'vitest'
import type { Envelope, Provenance, Quality } from '~/domain/shared/provenance'
import type { SessionState } from '~/domain/market'
import { canonicalSymbol } from '~/domain/market'
import { discloseObservation } from './disclosure'

const SP500 = canonicalSymbol('idx:sp500')
const FTSE = canonicalSymbol('idx:ftse100')
const US10Y = canonicalSymbol('rate:us10y')
const GOLD = canonicalSymbol('cmd:gold')
const BRENT = canonicalSymbol('cmd:brent')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Yahoo's shape: a real aggregator observation that guarantees no realtime. */
function provenance(ageMs: number, over: Partial<Provenance> = {}): Provenance {
  return {
    asOf: new Date(Date.parse('2026-08-25T19:28:07.000Z') - 0).toISOString(),
    asOfPrecision: 'second',
    receivedAt: '2026-08-25T19:28:14.000Z',
    ageMs,
    source: { providerId: 'yahoo', providerName: 'Yahoo Finance', trust: 'aggregator' },
    quality: 'delayed' as Quality,
    isDelayed: true,
    delayMinutes: null,
    isProxy: false,
    ...over,
  }
}

const ok = (p: Provenance): Envelope<unknown> => ({
  state: 'ok',
  data: {},
  provenance: p,
})

/** The exact envelope the resolver produces under stale-while-revalidate. */
const revalidating = (p: Provenance): Envelope<unknown> => ({
  state: 'stale',
  data: {},
  provenance: p,
  staleReason: 'no-fresh-source',
})

const marker = (
  p: Provenance,
  envelope: Envelope<unknown>,
  symbol = SP500,
  session: SessionState = 'open',
) => discloseObservation(p, envelope, { symbol, session })

describe('an open session judges the observation, not the cache', () => {
  it('reports a seven-second delayed observation as FÖRDRÖJD', () => {
    /*
     * The regression. Measured from the running product: S&P 500 observed
     * 19:28:07, received 19:28:14, session open, served under
     * stale-while-revalidate. It rendered INAKTUELL.
     */
    const d = marker(provenance(7 * 1000), revalidating(provenance(7 * 1000)))
    expect(d.marker).toBe('Fördröjd')
    expect(d.state).toBe('delayed')
  })

  it('reports the same observation as FÖRDRÖJD however it was delivered', () => {
    /* Delivery must not move the marker at all. */
    const p = provenance(7 * 1000)
    expect(marker(p, ok(p)).marker).toBe(marker(p, revalidating(p)).marker)
  })

  it('reports an observation past the horizon as INAKTUELL', () => {
    const d = marker(provenance(25 * MINUTE), ok(provenance(25 * MINUTE)))
    expect(d.marker).toBe('Inaktuell')
    expect(d.state).toBe('stale')
  })

  it('puts age above delay, so a delayed feed can still go stale', () => {
    /*
     * The precedence that makes both words reachable. Every Yahoo observation
     * carries `isDelayed`; if delay won, this row would read FÖRDRÖJD at any
     * age and INAKTUELL would be dead vocabulary for the S&P 500.
     */
    expect(marker(provenance(14 * MINUTE), ok(provenance(14 * MINUTE))).marker).toBe(
      'Fördröjd',
    )
    expect(marker(provenance(16 * MINUTE), ok(provenance(16 * MINUTE))).marker).toBe(
      'Inaktuell',
    )
  })

  it('leaves a current realtime observation unmarked', () => {
    const p = provenance(5 * 1000, { quality: 'realtime', isDelayed: false })
    const d = marker(p, ok(p))
    expect(d.marker).toBeNull()
    expect(d.state).toBe('ok')
  })
})

describe('a closed session keeps its latest valid close', () => {
  it('does not age out the close merely because hours passed', () => {
    /*
     * FTSE 100 from the running product: London closed at 15:35:30 UTC and the
     * level was still being read at 19:28. That close IS the market until
     * trading resumes — hours of wall clock do not make it wrong.
     */
    const p = provenance(3 * HOUR + 52 * MINUTE)
    expect(marker(p, revalidating(p), FTSE, 'closed').marker).toBe('Fördröjd')
  })

  it('carries a close across a weekend', () => {
    const p = provenance(3 * DAY)
    expect(marker(p, ok(p), FTSE, 'closed').state).not.toBe('stale')
  })

  it('does eventually report a feed that has silently stopped', () => {
    /* The closed allowance is generous, not unbounded. */
    const p = provenance(9 * DAY)
    expect(marker(p, ok(p), FTSE, 'closed').marker).toBe('Inaktuell')
  })
})

describe('extended sessions take the conservative reading', () => {
  it('does not age out a regular close during pre-market or after-hours', () => {
    /*
     * Neither bound provider publishes an extended-hours index level, and
     * nothing on `MarketQuote` says which session an observation belongs to.
     * Treating the last regular close as intraday would age it out fifteen
     * minutes after the bell while it is still the only real level there is.
     */
    for (const session of ['pre-market', 'after-hours'] as const) {
      const p = provenance(2 * HOUR)
      expect(marker(p, ok(p), SP500, session).state, session).not.toBe('stale')
    }
  })
})

describe('an unknown session does not earn the closed allowance', () => {
  it('holds an intraday observation to the open horizon', () => {
    /*
     * Conservative means under-claiming freshness, not over-claiming closure.
     * We cannot prove the venue is shut, and granting a multi-day allowance on
     * that assumption is how a dead feed goes unreported.
     */
    const p = provenance(25 * MINUTE)
    expect(marker(p, ok(p), SP500, 'unknown').marker).toBe('Inaktuell')
  })

  it('still governs published daily figures by their quality', () => {
    /*
     * A Treasury par yield has no intraday existence: it is correct until the
     * next publication. Judging it against a fifteen-minute horizon would
     * report a perfectly current figure as stale every afternoon.
     */
    const p = provenance(8 * HOUR, {
      quality: 'official-daily',
      isDelayed: false,
      source: { providerId: 'treasury', providerName: 'U.S. Treasury', trust: 'issuer' },
    })
    const d = discloseObservation(p, ok(p), { symbol: US10Y })
    expect(d.marker).toBeNull()
    expect(d.state).toBe('ok')
  })
})

describe('a genuinely old observation is still stale', () => {
  it('reports a long-cached observation as INAKTUELL', () => {
    /*
     * The case the old rule got right, and which must survive the correction:
     * when the resolver serves a retained observation because no provider
     * answered, and that observation really is old, the marker is honest.
     */
    const p = provenance(6 * HOUR)
    const envelope: Envelope<unknown> = {
      state: 'stale',
      data: {},
      provenance: p,
      staleReason: 'circuit-open',
    }
    const d = marker(p, envelope)
    expect(d.marker).toBe('Inaktuell')
    expect(d.delivery.state).toBe('degraded')
  })
})

describe('delivery is recorded, never rendered as a market claim', () => {
  it('names stale-while-revalidate as revalidating, not degraded', () => {
    const p = provenance(7 * 1000)
    const d = marker(p, revalidating(p))
    expect(d.delivery).toEqual({ state: 'revalidating', reason: 'no-fresh-source' })
    expect(d.marker).not.toBe('Inaktuell')
  })

  it('distinguishes a real delivery failure from request pacing', () => {
    const p = provenance(7 * 1000)
    const rateLimited: Envelope<unknown> = {
      state: 'stale',
      data: {},
      provenance: p,
      staleReason: 'rate-limited',
    }
    expect(marker(p, rateLimited).delivery.state).toBe('degraded')
    /* Still not a market claim: the observation is seven seconds old. */
    expect(marker(p, rateLimited).marker).toBe('Fördröjd')
  })

  it('reports fresh delivery for a provider that answered', () => {
    const p = provenance(7 * 1000)
    expect(marker(p, ok(p)).delivery).toEqual({ state: 'fresh', reason: null })
  })
})

describe('the two states that are not observations at all', () => {
  it('reports fixture as EJ MARKNADSDATA with no source and no time', () => {
    const p = provenance(30 * 1000, {
      quality: 'fixture',
      source: { providerId: 'fixture', providerName: 'Fixture', trust: 'synthetic' },
    })
    const d = marker(p, { state: 'fixture', data: {}, provenance: p, reason: 'none' })
    expect(d.marker).toBe('Ej marknadsdata')
    expect(d.observedAt).toBeNull()
    expect(d.sourceName).toBeNull()
  })

  it('reports fixture as fixture however fresh its stamped timestamp looks', () => {
    /* `fixtureProvenance` ages its timestamps but never its values. */
    const p = provenance(0, {
      quality: 'fixture',
      source: { providerId: 'fixture', providerName: 'Fixture', trust: 'synthetic' },
    })
    expect(marker(p, ok(p)).state).toBe('fixture')
  })

  it('reports an unresolved category as OTILLGÄNGLIG', () => {
    const p = provenance(7 * 1000)
    const d = marker(p, {
      state: 'error',
      error: {
        code: 'network',
        message: 'unreachable',
        providerId: 'yahoo',
        retryable: true,
      },
    })
    expect(d.marker).toBe('Otillgänglig')
    expect(d.observedAt).toBeNull()
  })
})

describe('a horizon has to clear the publication cadence behind it', () => {
  /*
   * Measured on 2026-08-25: Avanza's gold quote reported `timeOfLast`
   * 20:42:40 against a clock of 20:58:05, and 20:04:49 half an hour earlier.
   * The feed publishes roughly every fifteen minutes.
   *
   * Under the equity horizon that put a perfectly healthy feed on the
   * threshold immediately before every publication, so the row oscillated
   * between FÖRDRÖJD and INAKTUELL indefinitely. Thirty minutes allows one
   * missed interval; two consecutive misses is a feed that has stopped, which
   * is the thing worth reporting.
   */
  const commodity = (ageMs: number, symbol = GOLD) =>
    marker(provenance(ageMs), ok(provenance(ageMs)), symbol, 'unknown')

  it('does not call a commodity stale inside one publication interval', () => {
    for (const minutes of [14, 15, 16]) {
      const d = commodity(minutes * MINUTE)
      expect(d.marker, `${minutes} min`).toBe('Fördröjd')
      expect(d.state, `${minutes} min`).toBe('delayed')
    }
  })

  it('holds FÖRDRÖJD to the last second before the horizon', () => {
    const d = commodity(29 * MINUTE + 59 * 1000)
    expect(d.marker).toBe('Fördröjd')
  })

  it('reports INAKTUELL at thirty minutes exactly', () => {
    /* The boundary is strict: reaching the horizon spends the whole allowance. */
    expect(commodity(30 * MINUTE).marker).toBe('Inaktuell')
    expect(commodity(30 * MINUTE + 1).marker).toBe('Inaktuell')
  })

  it('applies the same horizon to Brent as to Gold', () => {
    expect(commodity(20 * MINUTE, BRENT).marker).toBe('Fördröjd')
    expect(commodity(31 * MINUTE, BRENT).marker).toBe('Inaktuell')
  })

  it('leaves the equity-index horizon at fifteen minutes', () => {
    /*
     * The load-bearing half of the ruling. Widening commodities must not have
     * widened anything else: the same age that is normal for a commodity is
     * stale for an index, because their feeds behave differently.
     */
    for (const session of ['open', 'unknown'] as const) {
      const stale = marker(
        provenance(16 * MINUTE),
        ok(provenance(16 * MINUTE)),
        SP500,
        session,
      )
      expect(stale.marker, session).toBe('Inaktuell')
    }
    /* And the commodity horizon does not leak into equities or crypto. */
    expect(
      marker(provenance(20 * MINUTE), ok(provenance(20 * MINUTE)), SP500, 'unknown')
        .marker,
    ).toBe('Inaktuell')
  })

  it('needs no special case for Gold or Brent in presentation', () => {
    /*
     * The distinction lives entirely in the freshness policy. The disclosure
     * projection is handed a symbol and a session and never asks what the
     * instrument is, so the same call shape produces different answers purely
     * because the policy says so.
     */
    const age = 20 * MINUTE
    expect(commodity(age, GOLD).marker).toBe('Fördröjd')
    expect(marker(provenance(age), ok(provenance(age)), SP500, 'unknown').marker).toBe(
      'Inaktuell',
    )
  })
})
