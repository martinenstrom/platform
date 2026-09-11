/**
 * The nine S&P 500 sector indices, and the return basis they are ranked on.
 *
 * Two failure classes, both found in production rather than in review.
 *
 * **The return basis.** The quote path requested `range=5d` and mapped
 * `meta.chartPreviousClose` to `previousClose`. That field is the close before
 * the REQUESTED WINDOW, so Financial OS rendered five-day moves labelled as
 * intraday ones. Measured on 2026-08-26: `^GSPC` +0.15 % on a one-day basis
 * against -0.25 % on a five-day basis, `^FTSE` -0.07 % against +1.25 %,
 * `^VIX` -0.65 % against -4.12 %. The sign was wrong on all three.
 *
 * **The Energy binding.** Eight sectors follow `^SP500-{GICS}`. Energy does
 * not: `^SP500-10` does not exist, and `^SP500-1010` — which does — is the
 * Energy **Industry Group**, one level below the sector in the GICS hierarchy.
 * It returns a well-formed INDEX payload with a plausible level and would sit
 * in a sector ranking quietly misreporting the sector.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  OVERVIEW_SECTOR_SYMBOLS,
  SYM_FTSE100,
  SYM_SECTOR_ENERGY,
  SYM_SP500,
  SYM_VIX,
} from '~/domain/market'
import { createYahooProvider, toIndexQuote } from './yahoo'
import { yahooBindingFor, YAHOO_SECTOR_INDICES, YAHOO_INDICES } from './yahoo/map'
import type { HttpClient } from './httpClient'
import type { FetchContext } from '~/application/marketData/ports'

const NOW = new Date('2026-08-26T19:30:00.000Z')
const context = (): FetchContext =>
  ({
    clock: { now: () => NOW },
    signal: new AbortController().signal,
  }) as unknown as FetchContext

/** `^SP500-45` as returned for `range=1d` on 2026-08-26. */
const sectorPayload = (
  symbol: string,
  name: string,
  price: number,
  previous: number,
) => ({
  chart: {
    result: [
      {
        meta: {
          symbol,
          instrumentType: 'INDEX',
          longName: name,
          currency: 'USD',
          exchangeName: 'SNP',
          exchangeTimezoneName: 'America/New_York',
          regularMarketPrice: price,
          chartPreviousClose: previous,
          regularMarketTime: 1787772300,
          currentTradingPeriod: {
            regular: { start: 1787751000, end: 1787774400 },
          },
        },
      },
    ],
  },
})

describe('a market quote change is against the PREVIOUS SESSION close', () => {
  it('requests a one-day window, so chartPreviousClose is yesterday', async () => {
    /*
     * The defect, pinned at the request. `chartPreviousClose` is defined
     * relative to the requested range, so the range IS the return definition —
     * asking for five days silently redefines "daily change".
     */
    const calls: string[] = []
    const provider = createYahooProvider({
      getJson: async (url: string) => {
        calls.push(url)
        return sectorPayload('^GSPC', 'S&P 500', 7688.59, 7677.28)
      },
      getText: vi.fn(),
    } as unknown as HttpClient)
    await provider.fetchQuotes([SYM_SP500], context())
    expect(calls[0]).toContain('range=1d')
    expect(calls[0]).not.toContain('range=5d')
  })

  it('computes the S&P 500 change against the immediately preceding close', () => {
    /* +0.15 %, the one-day basis — not the -0.25 % a five-day window gave. */
    const quote = toIndexQuote(
      yahooBindingFor(SYM_SP500),
      sectorPayload('^GSPC', 'S&P 500', 7688.59, 7677.28),
      context(),
    )
    expect(quote.previousClose).toBe(7677.28)
    expect(quote.percentageChange).toBeCloseTo(0.15, 2)
  })

  it('computes the FTSE 100 change on the same basis', () => {
    const quote = toIndexQuote(
      yahooBindingFor(SYM_FTSE100),
      sectorPayload('^FTSE', 'FTSE 100', 10878.12, 10886.16),
      context(),
    )
    expect(quote.percentageChange).toBeCloseTo(-0.07, 2)
  })

  it('would have reported the wrong sign on a five-day basis', () => {
    /*
     * The regression made explicit: feeding the five-day previous close
     * produces a materially different number with the opposite sign, which is
     * exactly what shipped. If the request shape ever reverts, the numbers
     * move like this again.
     */
    const fiveDay = toIndexQuote(
      yahooBindingFor(SYM_SP500),
      sectorPayload('^GSPC', 'S&P 500', 7688.59, 7707.98),
      context(),
    )
    const oneDay = toIndexQuote(
      yahooBindingFor(SYM_SP500),
      sectorPayload('^GSPC', 'S&P 500', 7688.59, 7677.28),
      context(),
    )
    expect(Math.sign(fiveDay.percentageChange!)).not.toBe(
      Math.sign(oneDay.percentageChange!),
    )
  })

  it('uses one return definition for indices and sectors alike', () => {
    /*
     * Set-level comparability starts here: a ranking is only meaningful if
     * every row was measured the same way, and the sectors share the index
     * mapper rather than having one of their own.
     */
    const index = toIndexQuote(
      yahooBindingFor(SYM_SP500),
      sectorPayload('^GSPC', 'S&P 500', 101, 100),
      context(),
    )
    const sector = toIndexQuote(
      yahooBindingFor(OVERVIEW_SECTOR_SYMBOLS[0]),
      sectorPayload('^SP500-45', 'S&P 500 Information Technology', 101, 100),
      context(),
    )
    expect(sector.percentageChange).toBeCloseTo(index.percentageChange!, 10)
    expect(sector.changePeriod).toBe(index.changePeriod)
  })
})

describe('the nine sectors are actual indices, acquired as one set', () => {
  it('binds every sector the panel ranks, and only those', () => {
    expect(YAHOO_SECTOR_INDICES.map((b) => b.symbol).sort()).toEqual(
      [...OVERVIEW_SECTOR_SYMBOLS].sort(),
    )
    expect(YAHOO_SECTOR_INDICES).toHaveLength(9)
  })

  it('binds the reviewed Yahoo symbols', () => {
    expect(
      Object.fromEntries(YAHOO_SECTOR_INDICES.map((b) => [b.symbol, b.yahooSymbol])),
    ).toEqual({
      'sector:technology': '^SP500-45',
      'sector:communication': '^SP500-50',
      'sector:industrials': '^SP500-20',
      'sector:financials': '^SP500-40',
      'sector:discretionary': '^SP500-25',
      'sector:healthcare': '^SP500-35',
      'sector:realestate': '^SP500-60',
      'sector:energy': '^GSPE',
      'sector:staples': '^SP500-30',
    })
  })

  it('substitutes no ETF for any sector index', () => {
    /*
     * XLK and the rest resolve perfectly well and diverged from their indices
     * by up to two percentage points on the day this was probed. Displaying an
     * ETF's performance as the sector's would be a silent substitution.
     */
    const bound = YAHOO_INDICES.map((b) => b.yahooSymbol)
    for (const etf of ['XLK', 'XLC', 'XLI', 'XLF', 'XLY', 'XLV', 'XLRE', 'XLE', 'XLP']) {
      expect(bound, etf).not.toContain(etf)
    }
  })

  it('fails the whole set when any single sector fails', async () => {
    /*
     * The panel makes a comparative claim across nine sectors, so a partial
     * set is not a smaller truth — it is a misleading ranking. `fetchQuotes`
     * resolves all-or-nothing, which is what makes the fall to fixture honest.
     */
    const provider = createYahooProvider({
      getJson: async (url: string) =>
        url.includes('%5EGSPE')
          ? { chart: { result: [] } }
          : sectorPayload('^SP500-45', 'S&P 500 Information Technology', 101, 100),
      getText: vi.fn(),
    } as unknown as HttpClient)
    await expect(
      provider.fetchQuotes([...OVERVIEW_SECTOR_SYMBOLS], context()),
    ).rejects.toThrow()
  })
})

describe('Energy is the binding most likely to be got wrong', () => {
  it('binds the SECTOR index, not the industry group', () => {
    /*
     * `^SP500-1010` resolves, is typed INDEX, and is named "S&P 500 Energy
     * (Industry Group)" — one level below the sector in GICS. Only the name
     * separates them.
     */
    const binding = yahooBindingFor(SYM_SECTOR_ENERGY)
    expect(binding.yahooSymbol).toBe('^GSPE')
    expect(binding.yahooSymbol).not.toBe('^SP500-1010')
    expect(binding.yahooSymbol).not.toBe('^SP500-10')
    expect(binding.expectedName).toBe('S&P 500 Energy (Sector)')
    expect(binding.expectedName).not.toMatch(/Industry/i)
  })

  it('refuses an industry-group payload served under the sector binding', () => {
    const industryGroup = sectorPayload(
      '^SP500-1010',
      'S&P 500 Energy (Industry Group)',
      950.41,
      947.08,
    )
    expect(() =>
      toIndexQuote(yahooBindingFor(SYM_SECTOR_ENERGY), industryGroup, context()),
    ).toThrow(/symbol/)
  })

  it('binds no industry-group or industry series anywhere in the set', () => {
    /*
     * Generic rather than a check on Energy alone: the same trap exists for
     * every sector, since `^SP500-{n}{n}{n}{n}` industry groups all resolve.
     */
    for (const binding of YAHOO_SECTOR_INDICES) {
      expect(binding.expectedName, binding.yahooSymbol).not.toMatch(
        /Industry Group|Industry\b/i,
      )
      expect(binding.yahooSymbol, binding.yahooSymbol).not.toMatch(/^\^SP500-\d{4}$/)
    }
  })
})

describe('VIX keeps the corrected basis too', () => {
  it('reports its change against the previous session close', () => {
    const quote = toIndexQuote(
      yahooBindingFor(SYM_VIX),
      sectorPayload('^VIX', 'CBOE Volatility Index', 15.35, 15.45),
      context(),
    )
    expect(quote.previousClose).toBe(15.45)
    expect(quote.percentageChange).toBeCloseTo(-0.65, 2)
  })
})
