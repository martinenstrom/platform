/**
 * The international index bindings.
 *
 * Three instruments moved off fixture on 2026-08-24 — DAX, Nasdaq 100 and
 * Nikkei 225 — after being probed on Avanza and confirmed to be actual index
 * instruments rather than the funds and certificates written on them.
 *
 * What this suite protects is not the numbers. It is the three properties that
 * make serving a broker's index level defensible at all:
 *
 *   **identity**   the binding verifies what it fetched, and refuses anything
 *                  else rather than serving a plausible wrong instrument
 *   **freshness**  each level carries its own, because they genuinely differ
 *   **units**      an index level is not a price in a currency
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  instrumentRef,
  SYM_DAX,
  SYM_FTSE100,
  SYM_NASDAQ100,
  SYM_NIKKEI225,
  SYM_OMXS30,
  SYM_SP500,
} from '~/domain/market'
import { toIndexQuote } from './avanza'
import { orderBookIdFor, avanzaCovers } from './avanza/map'
import type { FetchContext } from '~/application/marketData/ports'

const FIXTURES = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'src/infrastructure/marketData/providers/__fixtures__/avanza.quotes.json',
    ),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>

/** The fixtures are untrusted wire shapes; the adapter's parameter is wider. */
const info = (key: string, over: Record<string, unknown> = {}) =>
  ({ ...FIXTURES[key], ...over }) as Parameters<typeof toIndexQuote>[2]

/** A fixed clock: nothing here may depend on when the suite runs. */
const NOW = new Date('2026-08-24T21:00:00.000Z')
const context = (): FetchContext =>
  ({
    clock: { now: () => NOW },
    signal: new AbortController().signal,
  }) as unknown as FetchContext

const INFO = {
  dax: { symbol: SYM_DAX, key: 'daxInfo' },
  nasdaq100: { symbol: SYM_NASDAQ100, key: 'nasdaq100Info' },
  nikkei: { symbol: SYM_NIKKEI225, key: 'nikkeiInfo' },
} as const

const quoteFor = (name: keyof typeof INFO) => {
  const { symbol, key } = INFO[name]
  return toIndexQuote(symbol, orderBookIdFor(symbol), info(key), context())
}

describe('the binding verifies what it fetched', () => {
  it('accepts a payload whose ISIN and type match the reviewed binding', () => {
    expect(quoteFor('dax').symbol).toBe(SYM_DAX)
    expect(quoteFor('nasdaq100').symbol).toBe(SYM_NASDAQ100)
    expect(quoteFor('nikkei').symbol).toBe(SYM_NIKKEI225)
  })

  it('refuses a reassigned order book, whatever it is called', () => {
    /*
     * The dangerous failure. A retired id returns nothing and fails loudly; a
     * REASSIGNED id keeps returning a plausible price for an instrument nobody
     * asked for. Only the ISIN catches it, because it is the one identity
     * Avanza did not choose for display.
     */
    const impostor = info('daxInfo', { isin: 'DE0007236101' })
    expect(() =>
      toIndexQuote(SYM_DAX, orderBookIdFor(SYM_DAX), impostor, context()),
    ).toThrow(/ISIN/)
  })

  it('refuses a certificate or warrant standing where an index should be', () => {
    /*
     * Avanza lists 746 DAX certificates and 2249 DAX warrants beside the index.
     * Each would return a number that looks entirely reasonable on a tape.
     */
    const certificate = info('daxInfo', { type: 'CERTIFICATE' })
    expect(() =>
      toIndexQuote(SYM_DAX, orderBookIdFor(SYM_DAX), certificate, context()),
    ).toThrow(/type/)
  })

  it('refuses a payload with no identity at all', () => {
    expect(() => toIndexQuote(SYM_DAX, orderBookIdFor(SYM_DAX), {}, context())).toThrow()
  })

  it('throws rather than returning a partial quote, so the chain can fall through', () => {
    /*
     * Fail closed. A throw becomes a provider error on the category, the chain
     * continues to fixture, and the disclosure layer says EJ MARKNADSDATA. What
     * must never happen is a half-built quote carrying the wrong instrument.
     */
    let served: unknown = 'nothing served'
    try {
      served = toIndexQuote(
        SYM_NIKKEI225,
        orderBookIdFor(SYM_NIKKEI225),
        info('nikkeiInfo', { isin: 'XX0000000000' }),
        context(),
      )
    } catch {
      /* expected */
    }
    expect(served).toBe('nothing served')
  })
})

describe('freshness is read per observation, not assumed for the feed', () => {
  it('does not promote a delayed Tokyo close to real time', () => {
    /*
     * The reason this suite exists. All three arrive from one provider in one
     * batch, and Nikkei reports `isRealTime: false` where the other two report
     * `true`. A blanket provider quality would either understate DAX and
     * Nasdaq or dress a stale close as a live tick.
     */
    const nikkei = quoteFor('nikkei')
    expect(nikkei.provenance.quality).toBe('delayed')
    expect(nikkei.provenance.isDelayed).toBe(true)
  })

  it('does not understate the two that report real time', () => {
    for (const key of ['dax', 'nasdaq100'] as const) {
      const quote = quoteFor(key)
      expect(quote.provenance.isDelayed, key).toBe(false)
      /*
       * `near-realtime`, never `realtime`: Avanza is a broker redistributing a
       * level it did not compute, and `realtime` in this domain means an
       * exchange-grade tick from the venue itself.
       */
      expect(quote.provenance.quality, key).toBe('near-realtime')
    }
  })

  it('takes the observation time from the instrument, not the fetch', () => {
    /* Three instruments, three different observation times, one clock. */
    const times = (['dax', 'nasdaq100', 'nikkei'] as const).map(
      (key) => quoteFor(key).provenance.asOf,
    )
    expect(new Set(times).size).toBe(3)
    for (const asOf of times) expect(asOf).not.toBe(NOW.toISOString())
  })

  it('never claims a delay it was not given', () => {
    for (const key of ['dax', 'nasdaq100', 'nikkei'] as const) {
      expect(quoteFor(key).provenance.delayMinutes, key).toBeNull()
    }
  })

  it('claims no venue, because Avanza attributes these to none', () => {
    /*
     * Avanza reports `XXXX` / "Inofficiella (beQuoted)" for index levels — the
     * placeholder for "no market applicable". Asserting XETR or XNAS here would
     * be speaking for an exchange on a broker's behalf.
     */
    for (const key of ['dax', 'nasdaq100', 'nikkei'] as const) {
      expect(quoteFor(key).provenance.venue, key).toBeUndefined()
    }
  })

  it('is not a proxy — these are the indices themselves', () => {
    for (const key of ['dax', 'nasdaq100', 'nikkei'] as const) {
      expect(quoteFor(key).provenance.isProxy, key).toBe(false)
    }
  })
})

describe('an index level is not a price in a currency', () => {
  it('carries no currency for any bound index', () => {
    /*
     * Avanza's listing metadata reports `currency: "SEK"` for all three,
     * including Nasdaq 100 and Nikkei. That is an artefact of a Swedish
     * broker's listing record, not a claim that the Nikkei is denominated in
     * kronor — index levels are unitless.
     *
     * The domain already models this correctly and the adapter never reads
     * that field. This asserts both halves stay true.
     */
    for (const symbol of [SYM_OMXS30, SYM_DAX, SYM_NASDAQ100, SYM_NIKKEI225]) {
      const ref = instrumentRef(symbol)
      expect(ref.currency, String(symbol)).toBeNull()
      expect(ref.unit, String(symbol)).toEqual({ kind: 'index-points' })
    }
  })

  it('never lets a currency reach the quote from the provider', () => {
    const withCurrency = info('daxInfo', { listing: { currency: 'SEK' } })
    const quote = toIndexQuote(SYM_DAX, orderBookIdFor(SYM_DAX), withCurrency, context())
    expect(JSON.stringify(quote)).not.toContain('SEK')
  })
})

describe('what is deliberately not bound', () => {
  it('leaves S&P 500 and FTSE 100 unbound rather than serving a fund', () => {
    /*
     * Neither exists as an index in Avanza's corpus — only as UCITS ETFs,
     * certificates and warrants written on them. They stay fixture-backed, and
     * `avanzaCovers` returning false is what routes them there.
     */
    expect(avanzaCovers(SYM_SP500)).toBe(false)
    expect(avanzaCovers(SYM_FTSE100)).toBe(false)
    expect(() => orderBookIdFor(SYM_SP500)).toThrow(/never resolve it by search/)
    expect(() => orderBookIdFor(SYM_FTSE100)).toThrow(/never resolve it by search/)
  })

  it('routes the three bound indices to Avanza', () => {
    for (const symbol of [SYM_DAX, SYM_NASDAQ100, SYM_NIKKEI225]) {
      expect(avanzaCovers(symbol), String(symbol)).toBe(true)
      expect(orderBookIdFor(symbol).fetchWith, String(symbol)).toBe('info')
    }
  })
})
