/**
 * The commodity spot bindings.
 *
 * Gold and Brent moved off fixture on 2026-08-25, the last two instruments on
 * the Overview with no real source. Both resolve from Avanza as commodity
 * INDEX instruments — `Guld` (18986) and `Olja` / `Brent Spot` (155722) — and
 * both sit in a corpus dominated by the leveraged products written on them:
 * 744 gold certificates and 1084 gold warrants against one gold spot quote.
 *
 * Four properties carry the binding, and each has a different failure mode:
 *
 *   **identity**   composite, not ISIN-backed, and the model says so
 *   **spot**       these are not futures, and not proxies for futures
 *   **units**      USD per troy ounce and per barrel, from the catalog
 *   **session**    `unknown`, because Avanza's schedule is not the market's
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  instrumentRef,
  SYM_BRENT,
  SYM_GOLD,
  SYM_NIKKEI225,
  type CanonicalSymbol,
} from '~/domain/market'
import { toIndexQuote } from './avanza'
import { orderBookIdFor, avanzaCovers, AVANZA_INSTRUMENTS } from './avanza/map'
import { YAHOO_INDICES } from './yahoo/map'
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

const info = (key: string, over: Record<string, unknown> = {}) =>
  ({ ...FIXTURES[key], ...over }) as Parameters<typeof toIndexQuote>[2]

/** A fixed clock: nothing here may depend on when the suite runs. */
const NOW = new Date('2026-08-25T20:00:00.000Z')
const context = (): FetchContext =>
  ({
    clock: { now: () => NOW },
    signal: new AbortController().signal,
  }) as unknown as FetchContext

const COMMODITY = {
  gold: { symbol: SYM_GOLD, key: 'goldInfo' },
  brent: { symbol: SYM_BRENT, key: 'brentInfo' },
} as const

const quoteFor = (name: keyof typeof COMMODITY) => {
  const { symbol, key } = COMMODITY[name]
  return toIndexQuote(symbol, orderBookIdFor(symbol), info(key), context())
}

const reject = (name: keyof typeof COMMODITY, over: Record<string, unknown>) => {
  const { symbol, key } = COMMODITY[name]
  return () => toIndexQuote(symbol, orderBookIdFor(symbol), info(key, over), context())
}

describe('the bindings resolve the reviewed instruments', () => {
  it('binds Gold to order book 18986', () => {
    const binding = orderBookIdFor(SYM_GOLD)
    expect(binding.orderBookId).toBe('18986')
    expect(binding.expectedTicker).toBe('GOLDSP')
    expect(binding.expectedName).toBe('Guld')
    expect(quoteFor('gold').symbol).toBe(SYM_GOLD)
    expect(quoteFor('gold').value).toBe(4664.97)
  })

  it('binds Brent to order book 155722', () => {
    const binding = orderBookIdFor(SYM_BRENT)
    expect(binding.orderBookId).toBe('155722')
    /* Avanza's own strings, read from `get_stock_info`. */
    expect(binding.expectedTicker).toBe('Brent Spot')
    expect(binding.expectedName).toBe('Olja')
    expect(quoteFor('brent').symbol).toBe(SYM_BRENT)
    expect(quoteFor('brent').value).toBe(85.69)
  })

  it('routes both through Avanza with self-verifying fetches', () => {
    for (const symbol of [SYM_GOLD, SYM_BRENT]) {
      expect(avanzaCovers(symbol), String(symbol)).toBe(true)
      /* `info`, not `quote`: identity must arrive with the price. */
      expect(orderBookIdFor(symbol).fetchWith, String(symbol)).toBe('info')
    }
  })
})

describe('identity is composite, and the model says so', () => {
  it('records these as composite rather than ISIN-backed', () => {
    /*
     * The distinction is the point. `GC` and `BRENT` sit in the `isin` field
     * and are not ISINs; calling this ISIN-equivalent verification would
     * overstate what the binding can prove.
     */
    for (const symbol of [SYM_GOLD, SYM_BRENT]) {
      const identity = orderBookIdFor(symbol).identity
      expect(identity.class, String(symbol)).toBe('composite')
      if (identity.class !== 'composite') throw new Error('unreachable')
      expect(identity.reviewedSubType).toBe('Råvara')
    }
  })

  it('keeps the real indices on strong identity', () => {
    /* The correction must not have quietly downgraded anything else. */
    const nikkei = orderBookIdFor(SYM_NIKKEI225).identity
    expect(nikkei.class).toBe('strong')
    if (nikkei.class !== 'strong') throw new Error('unreachable')
    expect(nikkei.isin).toBe('JP9010C00002')
  })

  it('rejects a type that is not INDEX', () => {
    /*
     * The likeliest mistake by a wide margin: a binding pointed at
     * `BULL GULD X20` would serve a leveraged product's price as spot gold.
     */
    for (const type of ['CERTIFICATE', 'WARRANT', 'STOCK', 'FUND', 'ETF']) {
      expect(reject('gold', { type }), type).toThrow(/type/)
      expect(reject('brent', { type }), type).toThrow(/type/)
    }
  })

  it('rejects a changed identifier in the isin field', () => {
    expect(reject('gold', { isin: 'XAU' })).toThrow(/identifier/)
    expect(reject('brent', { isin: 'CL' })).toThrow(/identifier/)
  })

  it('rejects a changed instrument name', () => {
    expect(reject('gold', { name: 'Guld Certifikat' })).toThrow(/name/)
    expect(reject('brent', { name: 'WTI' })).toThrow(/name/)
  })

  it('rejects a changed ticker', () => {
    expect(reject('gold', { listing: { tickerSymbol: 'GOLDFUT' } })).toThrow(/ticker/)
    expect(reject('brent', { listing: { tickerSymbol: 'BRENTFUT' } })).toThrow(/ticker/)
  })

  it('rejects an answer about a different order book', () => {
    expect(reject('gold', { orderbookId: '155722' })).toThrow(/orderbookId/)
    expect(reject('brent', { orderbookId: '18986' })).toThrow(/orderbookId/)
  })

  it('rejects a malformed or empty payload rather than guessing', () => {
    for (const symbol of [SYM_GOLD, SYM_BRENT]) {
      expect(() => toIndexQuote(symbol, orderBookIdFor(symbol), {}, context())).toThrow()
    }
    expect(reject('gold', { quote: {} })).toThrow()
    expect(reject('brent', { quote: { last: 85.69 } })).toThrow(/timeOfLast/)
  })

  it('serves nothing at all when identity fails', () => {
    /*
     * Fail closed. A throw becomes a provider error on the category, the chain
     * continues to fixture, and the disclosure layer says EJ MARKNADSDATA.
     * What must never happen is a half-built quote carrying the wrong metal.
     */
    let served: unknown = 'nothing served'
    try {
      served = reject('gold', { isin: 'XAU' })()
    } catch {
      /* expected */
    }
    expect(served).toBe('nothing served')
  })
})

describe('these are spot observations, not futures', () => {
  it('binds no Yahoo futures symbol as Gold or Brent', () => {
    /*
     * The regression that matters most. `GC=F` is "Gold Dec 26" and `BZ=F` is
     * "Brent Crude Oil Last Day Financial Futures" — dated contracts that carry
     * carry and roll and expire. Yahoo's map must never acquire either as a
     * spot binding, and the check is on the map itself rather than on a
     * comment, so adding one fails here.
     */
    const bound = YAHOO_INDICES.map((b) => b.yahooSymbol)
    expect(bound).not.toContain('GC=F')
    expect(bound).not.toContain('BZ=F')
    expect(bound).not.toContain('CL=F')
    expect(YAHOO_INDICES.map((b) => b.symbol)).not.toContain(SYM_GOLD)
    expect(YAHOO_INDICES.map((b) => b.symbol)).not.toContain(SYM_BRENT)
  })

  it('binds no futures root through Avanza either', () => {
    /*
     * A futures contract would have to enter as a named contract with contract
     * semantics — an expiry, a roll — never as a substitute for spot. Nothing
     * in the table carries a futures ticker.
     */
    const tickers = AVANZA_INSTRUMENTS.map((i) => i.expectedTicker)
    for (const ticker of tickers) {
      expect(ticker, ticker).not.toMatch(/=F$/)
    }
  })

  it('marks neither as a proxy, because neither is standing in for anything', () => {
    for (const key of ['gold', 'brent'] as const) {
      expect(quoteFor(key).provenance.isProxy, key).toBe(false)
    }
  })
})

describe('units come from the catalog, never from the payload', () => {
  it('models Gold as USD per troy ounce', () => {
    const ref = instrumentRef(SYM_GOLD)
    expect(ref.unit).toEqual({
      kind: 'per-physical',
      currency: 'USD',
      measure: 'troy_oz',
    })
  })

  it('models Brent as USD per barrel', () => {
    const ref = instrumentRef(SYM_BRENT)
    expect(ref.unit).toEqual({ kind: 'per-physical', currency: 'USD', measure: 'bbl' })
  })

  it("never lets Avanza's SEK listing currency reach either observation", () => {
    /*
     * `listing.currency` is `"SEK"` in both recorded payloads. Gold is quoted
     * in dollars per ounce and Brent in dollars per barrel; letting a Swedish
     * broker's listing record override the catalog would restate a dollar
     * price as kronor.
     */
    for (const key of ['gold', 'brent'] as const) {
      expect(JSON.stringify(quoteFor(key)), key).not.toContain('SEK')
    }
  })
})

describe('session is unknown, deliberately', () => {
  it('does not adopt Avanza CLOSED for either commodity', () => {
    /*
     * Both payloads say `currentStatus: "CLOSED"`, describing Avanza's
     * 09:00-17:30 Stockholm beQuoted window. Gold and Brent trade nearly around
     * the clock, so that is a fact about Avanza's opening hours, not about the
     * market — and adopting it would hand a stalled feed the multi-day
     * closed-session freshness allowance every evening.
     */
    for (const key of ['gold', 'brent'] as const) {
      expect(quoteFor(key).session, key).toBe('unknown')
    }
  })

  it('still reads the venue schedule where it describes a real venue', () => {
    /* The indices are unaffected: DAX keeps its own venue's session. */
    expect(orderBookIdFor(SYM_NIKKEI225).sessionModel).toBe('venue')
    for (const symbol of [SYM_GOLD, SYM_BRENT]) {
      expect(orderBookIdFor(symbol).sessionModel, String(symbol)).toBe('unknown')
    }
  })
})

describe('provenance is the broker telling the truth about itself', () => {
  it('preserves the provider observation time, not the fetch time', () => {
    expect(quoteFor('gold').provenance.asOf).toBe(new Date(1787688289000).toISOString())
    expect(quoteFor('brent').provenance.asOf).toBe(new Date(1787688313000).toISOString())
    for (const key of ['gold', 'brent'] as const) {
      expect(quoteFor(key).provenance.asOf, key).not.toBe(NOW.toISOString())
    }
  })

  it('reports delayed, because both payloads say isRealTime false', () => {
    for (const key of ['gold', 'brent'] as const) {
      const quote = quoteFor(key)
      expect(quote.provenance.quality, key).toBe('delayed')
      expect(quote.provenance.isDelayed, key).toBe(true)
    }
  })

  it('promotes neither to exchange-grade when Avanza reports real time', () => {
    /*
     * `near-realtime`, never `realtime`: Avanza is a broker redistributing a
     * quote it did not compute, and `realtime` here means an exchange-grade
     * tick from the venue itself.
     */
    const quote = toIndexQuote(
      SYM_GOLD,
      orderBookIdFor(SYM_GOLD),
      info('goldInfo', {
        quote: { ...(FIXTURES.goldInfo!.quote as object), isRealTime: true },
      }),
      context(),
    )
    expect(quote.provenance.quality).toBe('near-realtime')
    expect(quote.provenance.quality).not.toBe('realtime')
  })

  it('claims no delay figure and no venue it was not given', () => {
    for (const key of ['gold', 'brent'] as const) {
      const provenance = quoteFor(key).provenance
      expect(provenance.delayMinutes, key).toBeNull()
      /* beQuoted's `XXXX` is the placeholder for "no market applicable". */
      expect(provenance.venue, key).toBeUndefined()
    }
  })

  it('attributes to the broker and names no originator', () => {
    for (const key of ['gold', 'brent'] as const) {
      const source = quoteFor(key).provenance.source
      expect(source.providerId, key).toBe('avanza')
      expect(source.trust, key).toBe('broker')
      /*
       * No originator. Avanza's payload never says whose quote this is, and
       * naming one — an exchange, or the LBMA — would attribute the number to
       * a party that did not publish it here.
       */
      expect(source.originator, key).toBeUndefined()
    }
  })
})

describe('the LBMA benchmark is a different thing and is not consumed', () => {
  it('reads no LBMA endpoint anywhere in the market-data adapters', () => {
    /*
     * The LBMA Gold Price is administered by ICE Benchmark Administration and
     * requires a licence to obtain, use or redistribute. Its public JSON
     * endpoint returns 200 to anyone, which is exactly why this is asserted:
     * accessibility is not permission. What Financial OS shows is a
     * continuously quoted OTC spot observation from a broker — a different
     * observation that happens to sit close to the auction price.
     */
    const dir = join(process.cwd(), 'src/infrastructure/marketData/providers')
    const walk = (path: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
      return readdirSync(path).flatMap((entry: string) => {
        const full = join(path, entry)
        return statSync(full).isDirectory()
          ? walk(full)
          : /* Adapter source only: a test may name the endpoint to forbid it. */
            full.endsWith('.ts') && !full.endsWith('.test.ts')
            ? [full]
            : []
      })
    }
    for (const file of walk(dir)) {
      const source = readFileSync(file, 'utf8')
      expect(source.includes('prices.lbma.org.uk'), file).toBe(false)
    }
  })
})

describe('what is deliberately not bound', () => {
  it('leaves the futures contracts unbound in both providers', () => {
    const yahooSymbols = YAHOO_INDICES.map((b) => b.symbol) as CanonicalSymbol[]
    expect(yahooSymbols).not.toContain(SYM_GOLD)
    expect(yahooSymbols).not.toContain(SYM_BRENT)
  })
})
