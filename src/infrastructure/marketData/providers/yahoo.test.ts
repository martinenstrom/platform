/**
 * The Yahoo index bindings.
 *
 * S&P 500 and FTSE 100 moved off fixture on 2026-08-25. Neither has a free
 * official route and neither exists as an index on Avanza — only as funds
 * written on them — so the alternative was a constant in the repository.
 *
 * Yahoo is a free aggregator with no service commitment, which makes three
 * properties load-bearing:
 *
 *   **identity**    the same endpoint serves futures and funds; HTTP 200 is
 *                   not proof that the payload is about an index
 *   **honesty**     a recent timestamp is not an exchange feed
 *   **units**       an index level is not a price in a currency
 */

import { describe, expect, it, vi } from 'vitest'
import {
  instrumentRef,
  SYM_BRENT,
  SYM_FTSE100,
  SYM_GOLD,
  SYM_SP500,
  SYM_VIX,
  type CanonicalSymbol,
} from '~/domain/market'
import { createYahooProvider, toIndexQuote, YAHOO_SOURCE } from './yahoo'
import { yahooBindingFor, yahooCovers, YAHOO_INDICES } from './yahoo/map'
import { HttpError, type HttpClient } from './httpClient'
import { avanzaCovers } from '../providers/avanza/map'
import { loadMarketDataConfig } from '../config'
import type { FetchContext } from '~/application/marketData/ports'

const NOW = new Date('2026-08-25T19:00:00.000Z')
const context = (): FetchContext =>
  ({
    clock: { now: () => NOW },
    signal: new AbortController().signal,
  }) as unknown as FetchContext

/** Recorded from a live `v8/finance/chart` response on 2026-08-25. */
const GSPC = {
  chart: {
    result: [
      {
        meta: {
          symbol: '^GSPC',
          instrumentType: 'INDEX',
          longName: 'S&P 500',
          currency: 'USD',
          exchangeName: 'SNP',
          exchangeTimezoneName: 'America/New_York',
          regularMarketPrice: 7675.71,
          chartPreviousClose: 7691.76,
          regularMarketTime: 1787689042,
          regularMarketDayHigh: 7699.2,
          regularMarketDayLow: 7650.11,
          currentTradingPeriod: {
            regular: { start: 1787670000, end: 1787693400 },
          },
        },
      },
    ],
  },
}

const FTSE = {
  chart: {
    result: [
      {
        meta: {
          symbol: '^FTSE',
          instrumentType: 'INDEX',
          longName: 'FTSE 100',
          currency: 'GBP',
          exchangeName: 'FGI',
          exchangeTimezoneName: 'Europe/London',
          regularMarketPrice: 10886.16,
          chartPreviousClose: 10728.0,
          regularMarketTime: 1787671530,
          currentTradingPeriod: {
            regular: { start: 1787643000, end: 1787671800 },
          },
        },
      },
    ],
  },
}

/** `GC=F` — the same endpoint, a completely different kind of instrument. */
const GOLD_FUTURE = {
  chart: {
    result: [
      {
        meta: {
          symbol: '^GSPC',
          instrumentType: 'FUTURE',
          longName: 'Gold Dec 26',
          regularMarketPrice: 4706.9,
          regularMarketTime: 1787688242,
        },
      },
    ],
  },
}

/** Recorded from a live `v8/finance/chart/^VIX` response on 2026-08-25. */
const VIX = {
  chart: {
    result: [
      {
        meta: {
          symbol: '^VIX',
          instrumentType: 'INDEX',
          longName: 'CBOE Volatility Index',
          currency: 'USD',
          exchangeName: 'CXI',
          exchangeTimezoneName: 'America/Chicago',
          regularMarketPrice: 15.45,
          chartPreviousClose: 14.89,
          regularMarketTime: 1787688901,
          regularMarketDayHigh: 16.3,
          regularMarketDayLow: 15.13,
          currentTradingPeriod: {
            /* 07:00:00Z -> 20:15:00Z, the Cboe session on 2026-08-25. */
            regular: { start: 1787641200, end: 1787688900 },
          },
        },
      },
    ],
  },
}

/** `VIXY` — a futures ETF on the same transport, at a different level. */
const VIX_ETF = {
  chart: {
    result: [
      {
        meta: {
          symbol: '^VIX',
          instrumentType: 'ETF',
          longName: 'ProShares VIX Short-Term Futures ETF',
          regularMarketPrice: 18.01,
          regularMarketTime: 1787688901,
        },
      },
    ],
  },
}

const clientReturning = (body: unknown, calls: string[] = []): HttpClient =>
  ({
    getJson: vi.fn(async (url: string) => {
      calls.push(url)
      return body
    }),
    getText: vi.fn(),
  }) as unknown as HttpClient

describe('the actual indices resolve', () => {
  it('resolves ^GSPC as the S&P 500 index', () => {
    const quote = toIndexQuote(yahooBindingFor(SYM_SP500), GSPC, context())
    expect(quote.symbol).toBe(SYM_SP500)
    expect(quote.value).toBe(7675.71)
    expect(quote.previousClose).toBe(7691.76)
  })

  it('resolves ^FTSE as the FTSE 100 index', () => {
    const quote = toIndexQuote(yahooBindingFor(SYM_FTSE100), FTSE, context())
    expect(quote.symbol).toBe(SYM_FTSE100)
    expect(quote.value).toBe(10886.16)
  })

  it('requests the chart endpoint and never the crumb-gated one', async () => {
    /*
     * `v7/finance/quote` returned 401 when probed: it requires a cookie and a
     * crumb. Calling it would trade a working anonymous request for an auth
     * dance that fails.
     */
    const calls: string[] = []
    const provider = createYahooProvider(clientReturning(GSPC, calls))
    await provider.fetchQuotes([SYM_SP500], context())
    expect(calls[0]).toContain('/v8/finance/chart/')
    expect(calls[0]).not.toContain('/v7/')
  })

  it('sends a User-Agent, because Yahoo returns 429 without one', async () => {
    /*
     * Established by direct probe: the same request with a browser-style UA
     * returned 200 eight times consecutively; without one it returned 429 on
     * the first attempt. The header is a functional requirement.
     */
    let sent: Record<string, string> | undefined
    const provider = createYahooProvider({
      getJson: async (
        _url: string,
        _signal: unknown,
        headers: Record<string, string>,
      ) => {
        sent = headers
        return GSPC
      },
      getText: vi.fn(),
    } as unknown as HttpClient)
    await provider.fetchQuotes([SYM_SP500], context())
    expect(sent?.['User-Agent']).toBeTruthy()
  })
})

describe('identity is verified, not inferred from a 200', () => {
  it('refuses a futures contract standing where an index should be', () => {
    /*
     * The load-bearing case. `GC=F` on this endpoint is "Gold Dec 26" — a
     * dated COMEX contract that carries carry and roll and expires. It returns
     * a well-formed payload and a plausible number.
     */
    expect(() =>
      toIndexQuote(yahooBindingFor(SYM_SP500), GOLD_FUTURE, context()),
    ).toThrow(/INDEX/)
  })

  it('refuses an ETF or fund type', () => {
    for (const type of ['ETF', 'MUTUALFUND', 'EQUITY', 'CURRENCY']) {
      const body = {
        chart: {
          result: [{ meta: { ...GSPC.chart.result[0]!.meta, instrumentType: type } }],
        },
      }
      expect(() => toIndexQuote(yahooBindingFor(SYM_SP500), body, context())).toThrow(
        /INDEX/,
      )
    }
  })

  it('refuses a payload about a different ticker', () => {
    const body = {
      chart: {
        result: [{ meta: { ...GSPC.chart.result[0]!.meta, symbol: '^DJI' } }],
      },
    }
    expect(() => toIndexQuote(yahooBindingFor(SYM_SP500), body, context())).toThrow(
      /symbol/,
    )
  })

  it('refuses an empty or malformed payload rather than guessing', () => {
    for (const body of [
      {},
      { chart: {} },
      { chart: { result: [] } },
      { chart: { result: null } },
    ]) {
      expect(() => toIndexQuote(yahooBindingFor(SYM_SP500), body, context())).toThrow()
    }
  })

  it('refuses a payload with no price or no timestamp', () => {
    const noPrice = {
      chart: {
        result: [{ meta: { ...GSPC.chart.result[0]!.meta, regularMarketPrice: null } }],
      },
    }
    const noTime = {
      chart: {
        result: [{ meta: { ...GSPC.chart.result[0]!.meta, regularMarketTime: null } }],
      },
    }
    expect(() => toIndexQuote(yahooBindingFor(SYM_SP500), noPrice, context())).toThrow()
    expect(() => toIndexQuote(yahooBindingFor(SYM_SP500), noTime, context())).toThrow()
  })

  it('throws rather than returning a partial quote, so the chain falls through', () => {
    let served: unknown = 'nothing served'
    try {
      served = toIndexQuote(yahooBindingFor(SYM_FTSE100), GOLD_FUTURE, context())
    } catch {
      /* expected */
    }
    expect(served).toBe('nothing served')
  })

  it('surfaces a transport failure instead of swallowing it', async () => {
    /*
     * Rate limits and auth failures must reach the pipeline as provider errors
     * so the chain can move on. A caught-and-ignored 429 would leave the last
     * value looking current.
     */
    const provider = createYahooProvider({
      getJson: vi.fn(async () => {
        throw new HttpError('rate-limit', 'Yahoo said 429')
      }),
      getText: vi.fn(),
    } as unknown as HttpClient)
    await expect(provider.fetchQuotes([SYM_SP500], context())).rejects.toThrow(/429/)
  })
})

describe('freshness and provenance are honest', () => {
  it('preserves the venue observation time, not the fetch time', () => {
    const quote = toIndexQuote(yahooBindingFor(SYM_SP500), GSPC, context())
    expect(quote.provenance.asOf).toBe(new Date(1787689042 * 1000).toISOString())
    expect(quote.provenance.asOf).not.toBe(NOW.toISOString())
    expect(quote.provenance.receivedAt).toBe(NOW.toISOString())
  })

  it('is never marked exchange-grade, however recent the timestamp', () => {
    /*
     * Yahoo publishes no delay guarantee and no real-time flag on this
     * endpoint. A level that arrived seconds ago may still be a delayed
     * republication, and nothing in the payload distinguishes the two.
     */
    const fresh = {
      chart: {
        result: [
          {
            meta: {
              ...GSPC.chart.result[0]!.meta,
              regularMarketTime: Math.floor(NOW.getTime() / 1000),
            },
          },
        ],
      },
    }
    const quote = toIndexQuote(yahooBindingFor(SYM_SP500), fresh, context())
    expect(quote.provenance.quality).toBe('delayed')
    expect(quote.provenance.isDelayed).toBe(true)
    expect(quote.provenance.quality).not.toBe('realtime')
    expect(quote.provenance.quality).not.toBe('near-realtime')
  })

  it('records Yahoo as an aggregator and names no originator', () => {
    expect(YAHOO_SOURCE.trust).toBe('aggregator')
    /* The index owners computed these levels; Yahoo does not speak for them. */
    expect(YAHOO_SOURCE.originator).toBeUndefined()
  })

  it('claims no venue, because Yahoo gives exchange codes and not MICs', () => {
    /* `SNP` and `FGI` are Yahoo's own codes, not ISO 10383. */
    const quote = toIndexQuote(yahooBindingFor(SYM_SP500), GSPC, context())
    expect(quote.provenance.venue).toBeUndefined()
  })

  it('claims no delay figure it was not given', () => {
    const quote = toIndexQuote(yahooBindingFor(SYM_SP500), GSPC, context())
    expect(quote.provenance.delayMinutes).toBeNull()
    expect(quote.provenance.isProxy).toBe(false)
  })

  it('reads the session from the venue trading period', () => {
    /*
     * Both recorded observations fall inside their own venue's regular window
     * — the FTSE one by four and a half minutes. Session is a fact about the
     * market at the moment of observation, so it is read from the bounds Yahoo
     * gave and never from when this suite happens to run.
     */
    expect(toIndexQuote(yahooBindingFor(SYM_SP500), GSPC, context()).session).toBe('open')
    expect(toIndexQuote(yahooBindingFor(SYM_FTSE100), FTSE, context()).session).toBe(
      'open',
    )
  })

  it('reports closed for an observation outside the window', () => {
    /* The FTSE close, recorded five minutes after its regular period ended. */
    const afterClose = {
      chart: {
        result: [
          {
            meta: {
              ...FTSE.chart.result[0]!.meta,
              regularMarketTime:
                FTSE.chart.result[0]!.meta.currentTradingPeriod.regular.end + 300,
            },
          },
        ],
      },
    }
    expect(
      toIndexQuote(yahooBindingFor(SYM_FTSE100), afterClose, context()).session,
    ).toBe('closed')
  })

  it('says unknown rather than guessing when no trading period is given', () => {
    const body = {
      chart: {
        result: [
          { meta: { ...GSPC.chart.result[0]!.meta, currentTradingPeriod: undefined } },
        ],
      },
    }
    expect(toIndexQuote(yahooBindingFor(SYM_SP500), body, context()).session).toBe(
      'unknown',
    )
  })
})

describe('an index level is not a price in a currency', () => {
  it('does not let Yahoo currency reach the quote', () => {
    /*
     * Yahoo reports USD for the S&P 500 and GBP for the FTSE 100 — the same
     * trap Avanza sets with SEK. Index levels are unitless.
     */
    for (const [symbol, body] of [
      [SYM_SP500, GSPC],
      [SYM_FTSE100, FTSE],
    ] as const) {
      const quote = toIndexQuote(yahooBindingFor(symbol), body, context())
      const serialized = JSON.stringify(quote)
      expect(serialized).not.toContain('USD')
      expect(serialized).not.toContain('GBP')
    }
  })

  it('keeps the domain model unitless for both indices', () => {
    for (const symbol of [SYM_SP500, SYM_FTSE100]) {
      const ref = instrumentRef(symbol)
      expect(ref.currency, String(symbol)).toBeNull()
      expect(ref.unit, String(symbol)).toEqual({ kind: 'index-points' })
    }
  })
})

describe('what is deliberately not bound', () => {
  it('binds exactly the indices with no other free route', () => {
    /*
     * VIX joined on 2026-08-25 as the primary risk-appetite input; the nine
     * GICS sector indices on 2026-08-26. The list is asserted exactly so a new
     * binding cannot arrive without a reviewer seeing it here.
     */
    expect(YAHOO_INDICES.map((b) => [b.symbol, b.yahooSymbol])).toEqual([
      [SYM_SP500, '^GSPC'],
      [SYM_FTSE100, '^FTSE'],
      [SYM_VIX, '^VIX'],
      ['sector:technology', '^SP500-45'],
      ['sector:communication', '^SP500-50'],
      ['sector:industrials', '^SP500-20'],
      ['sector:financials', '^SP500-40'],
      ['sector:discretionary', '^SP500-25'],
      ['sector:healthcare', '^SP500-35'],
      ['sector:realestate', '^SP500-60'],
      /* Energy is `^GSPE`, never `^SP500-10` or the `^SP500-1010` group. */
      ['sector:energy', '^GSPE'],
      ['sector:staples', '^SP500-30'],
    ])
  })

  it('leaves Gold and Brent unbound, because Yahoo offers only futures', () => {
    /*
     * `GC=F` is "Gold Dec 26" and `BZ=F` is "Brent Crude Oil Last Day
     * Financial Futures". Both are dated contracts, neither is a spot or
     * benchmark observation, and `XAUUSD=X` returns 404. If futures are wanted
     * they belong in the domain as named contracts, never as a substitute.
     */
    expect(yahooCovers(SYM_GOLD)).toBe(false)
    expect(yahooCovers(SYM_BRENT)).toBe(false)
    expect(() => yahooBindingFor(SYM_GOLD)).toThrow(/never resolve it dynamically/)
    expect(() => yahooBindingFor(SYM_BRENT)).toThrow(/never resolve it dynamically/)
  })

  it('does not take over an instrument that already has a verified source', () => {
    /*
     * DAX, Nasdaq 100, Nikkei and OMXS30 resolve from Avanza as INDEX
     * instruments with ISINs. Routing them through an aggregator as well would
     * trade an identity-checked binding for a weaker one, for provider
     * uniformity alone.
     */
    for (const symbol of ['idx:dax', 'idx:nasdaq100', 'idx:nikkei225', 'idx:omxs30']) {
      expect(yahooCovers(symbol as CanonicalSymbol), symbol).toBe(false)
    }
  })
})

describe('the two indices no longer normally come from a constant', () => {
  it('routes S&P 500 and FTSE 100 to the international chain', () => {
    /*
     * The routing rule in `createOverviewDataSource`: an index Avanza does not
     * carry as an index goes to `equity-index-intl`. That is exactly the
     * category Yahoo now serves, and it is what moved these two off fixture.
     */
    expect(avanzaCovers(SYM_SP500)).toBe(false)
    expect(avanzaCovers(SYM_FTSE100)).toBe(false)
    expect(yahooCovers(SYM_SP500)).toBe(true)
    expect(yahooCovers(SYM_FTSE100)).toBe(true)
  })

  it('puts Yahoo ahead of fixture on that chain, not instead of it', () => {
    /*
     * Order is the whole point. Yahoo first means a working request serves a
     * real level; fixture still last means a 429, an outage or a failed
     * identity check degrades to a disclosed constant rather than to nothing.
     */
    const chain = loadMarketDataConfig({ MARKETDATA_MODE: 'hybrid' }).chains[
      'equity-index-intl'
    ]
    expect(chain[0]).toBe('yahoo')
    expect(chain[chain.length - 1]).toBe('fixture')
  })

  it('leaves fixture reachable, because a free aggregator has no uptime promise', () => {
    /*
     * Yahoo publishes no service commitment. Removing fixture from the chain
     * would turn every rate limit into an empty tape, so the fall-through stays
     * — and when it is used, the disclosure layer says so.
     */
    for (const mode of ['fixture', 'hybrid'] as const) {
      const chain = loadMarketDataConfig({ MARKETDATA_MODE: mode }).chains[
        'equity-index-intl'
      ]
      expect(chain, mode).toContain('fixture')
    }
  })
})

describe('VIX is the index, not the volatility complex around it', () => {
  it('resolves ^VIX as the CBOE Volatility Index', () => {
    const quote = toIndexQuote(yahooBindingFor(SYM_VIX), VIX, context())
    expect(quote.symbol).toBe(SYM_VIX)
    expect(quote.value).toBe(15.45)
    expect(quote.previousClose).toBe(14.89)
  })

  it('refuses a futures ETF standing where the index should be', () => {
    /*
     * The substitution this binding exists to prevent, and it is not
     * hypothetical: measured at one instant on 2026-08-25, `^VIX` was 15,45
     * while `VIXY` was 18,01, `UVXY` 18,95 and `^VIX9D` 13,45. A sentiment
     * model fed any of the others would be reading a different quantity.
     */
    expect(() => toIndexQuote(yahooBindingFor(SYM_VIX), VIX_ETF, context())).toThrow(
      /INDEX/,
    )
  })

  it('carries no currency, because an index level has none', () => {
    /* Yahoo reports USD for VIX. A volatility level is unitless points. */
    const quote = toIndexQuote(yahooBindingFor(SYM_VIX), VIX, context())
    expect(JSON.stringify(quote)).not.toContain('USD')
    const ref = instrumentRef(SYM_VIX)
    expect(ref.currency).toBeNull()
    expect(ref.unit).toEqual({ kind: 'index-points' })
  })

  it('is aggregator-grade and delayed, like every other Yahoo observation', () => {
    const quote = toIndexQuote(yahooBindingFor(SYM_VIX), VIX, context())
    expect(quote.provenance.source.trust).toBe('aggregator')
    expect(quote.provenance.quality).toBe('delayed')
    expect(quote.provenance.asOf).toBe(new Date(1787688901 * 1000).toISOString())
  })

  it('binds the index ticker and no substitute', () => {
    const bound = YAHOO_INDICES.map((b) => b.yahooSymbol)
    expect(bound).toContain('^VIX')
    for (const substitute of ['VIXY', 'UVXY', 'SVXY', '^VIX9D', 'VX=F']) {
      expect(bound, substitute).not.toContain(substitute)
    }
  })
})
