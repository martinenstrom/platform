/**
 * Avanza adapter contract.
 *
 * Every payload here was recorded from the live `avanza-mcp` server on
 * 2026-07-26. No test in this file touches the network or spawns a process:
 * the tool call is injected, so the whole suite runs offline.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeClock } from '~/domain/shared/clock'
import {
  SYM_ATCO_A,
  SYM_AZA,
  SYM_EVO,
  SYM_INVE_B,
  SYM_OMXS30,
  SYM_SEB_A,
  SYM_VOLV_B,
  type CanonicalSymbol,
} from '~/domain/market'
import type { FetchContext } from '~/application/marketData/ports'
import {
  AVANZA_SOURCE,
  createAvanzaProvider,
  createGate,
  MAX_CONCURRENCY,
  MAX_QUEUE_DEPTH,
  sessionFrom,
  type AvanzaToolCall,
} from './avanza'
import { AVANZA_INSTRUMENTS, avanzaCovers, orderBookIdFor } from './avanza/map'

const FIXTURES = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/avanza.quotes.json'), 'utf8'),
) as Record<string, Record<string, unknown>> & {
  volvB: Record<string, unknown> & { timeOfLast: number }
}

const NOW = '2026-07-26T16:00:00.000Z'

function context(signal = new AbortController().signal): FetchContext {
  return {
    signal,
    clock: new FakeClock(NOW),
    correlationId: 'test-correlation' as FetchContext['correlationId'],
  }
}

/** Routes by tool name so a test only has to describe the quote it cares about. */
function toolCall(
  quotes: Record<string, unknown>,
  marketplace: unknown = FIXTURES.marketplaceClosed,
): AvanzaToolCall {
  return (async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_marketplace_info') return marketplace
    if (name === 'get_stock_quote') {
      const payload = quotes[String(args.instrument_id)]
      if (!payload) throw new Error(`no fixture for order book ${args.instrument_id}`)
      return payload
    }
    throw new Error(`unexpected tool ${name}`)
  }) as AvanzaToolCall
}

const VOLV_ID = orderBookIdFor(SYM_VOLV_B).orderBookId
const OMX_ID = orderBookIdFor(SYM_OMXS30).orderBookId

async function quoteOne(
  symbol: CanonicalSymbol,
  payload: unknown,
  marketplace: unknown = FIXTURES.marketplaceClosed,
) {
  const id = orderBookIdFor(symbol).orderBookId
  const provider = createAvanzaProvider(toolCall({ [id]: payload }, marketplace))
  const [quote] = await provider.fetchQuotes([symbol], context())
  if (!quote) throw new Error(`no quote returned for ${symbol}`)
  return quote
}

/* ------------------------------------------------------------ identity map */

describe('order book identity', () => {
  it('covers exactly the seven approved instruments', () => {
    expect(AVANZA_INSTRUMENTS.map((i) => i.symbol)).toEqual([
      SYM_OMXS30,
      SYM_INVE_B,
      SYM_VOLV_B,
      SYM_EVO,
      SYM_AZA,
      SYM_ATCO_A,
      SYM_SEB_A,
    ])
  })

  it('binds every symbol to the id, ticker, name and ISIN recorded from Avanza', () => {
    // The ISIN is the check that survives a rename. A reassigned order book id
    // is the dangerous failure, and only an identity that Avanza did not choose
    // for display can catch it.
    expect(
      AVANZA_INSTRUMENTS.map((i) => [
        i.symbol,
        i.orderBookId,
        i.expectedTicker,
        i.expectedName,
        i.expectedIsin,
      ]),
    ).toEqual([
      [SYM_OMXS30, '19002', 'OMXS30', 'OMX Stockholm 30', 'SE0000337842'],
      [SYM_INVE_B, '5247', 'INVE B', 'Investor B', 'SE0015811963'],
      [SYM_VOLV_B, '5269', 'VOLV B', 'Volvo B', 'SE0000115446'],
      [SYM_EVO, '549768', 'EVO', 'Evolution', 'SE0012673267'],
      [SYM_AZA, '5361', 'AZA', 'Avanza Bank Holding', 'SE0012454072'],
      [SYM_ATCO_A, '5234', 'ATCO A', 'Atlas Copco A', 'SE0017486889'],
      [SYM_SEB_A, '5255', 'SEB A', 'SEB A', 'SE0000148884'],
    ])
  })

  it('does not bind the wrong share class', () => {
    // Live search for "Atlas Copco A" ranked Atlas Copco B (5235) FIRST. The
    // A share is 5234, and that is what must be wired.
    expect(orderBookIdFor(SYM_ATCO_A).orderBookId).toBe('5234')
    expect(AVANZA_INSTRUMENTS.map((i) => i.orderBookId)).not.toContain('5235')
  })

  it('holds no duplicate ids or symbols', () => {
    const ids = AVANZA_INSTRUMENTS.map((i) => i.orderBookId)
    const symbols = AVANZA_INSTRUMENTS.map((i) => i.symbol)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(symbols).size).toBe(symbols.length)
  })

  it('throws on an unmapped symbol instead of guessing', () => {
    expect(() => orderBookIdFor('eq:xsto:ericb' as CanonicalSymbol)).toThrow(
      /no reviewed order book id/i,
    )
    expect(avanzaCovers('eq:xsto:ericb' as CanonicalSymbol)).toBe(false)
  })

  it('never resolves identity by search', async () => {
    const seen: string[] = []
    const provider = createAvanzaProvider((async (name: string) => {
      seen.push(name)
      if (name === 'get_marketplace_info') return FIXTURES.marketplaceClosed
      return FIXTURES.volvB
    }) as AvanzaToolCall)
    await provider.fetchQuotes([SYM_VOLV_B], context())
    expect(seen).not.toContain('search_instruments')
  })
})

/* ------------------------------------------------------------- normalization */

describe('quote normalization', () => {
  it('maps a recorded equity quote', async () => {
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB)
    expect(quote.value).toBe(354.8)
    expect(quote.absoluteChange).toBe(2.8)
    expect(quote.percentageChange).toBe(0.8)
    expect(quote.dayHigh).toBe(355.9)
    expect(quote.dayLow).toBe(350.7)
    expect(quote.changeSource).toBe('provider')
    expect(quote.changePeriod).toBe('intraday')
    expect(quote.sourcePrecision).toBe(1)
    expect(quote.requestedPrecision).toBeNull()
  })

  it('maps a recorded index quote, which carries no bid or ask', async () => {
    const quote = await quoteOne(SYM_OMXS30, FIXTURES.omxs30)
    expect(quote.value).toBe(3199.61)
    expect(quote.absoluteChange).toBe(32.51)
    expect(quote.percentageChange).toBe(1.03)
    expect(quote.sourcePrecision).toBe(2)
  })

  it('never claims a previous close Avanza did not publish', async () => {
    // `last - change` is arithmetically a prior level, but Avanza never calls
    // it the official close, and an auction result is not ours to assert.
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB)
    expect(quote.previousClose).toBeNull()
  })

  it('records the venue only where the payload states one', async () => {
    const equity = await quoteOne(SYM_VOLV_B, FIXTURES.volvB)
    expect(equity.provenance.venue).toBe('XSTO')

    // Avanza returns the placeholder MIC `XXXX` for OMXS30. Knowing the index
    // is a Stockholm one does not license claiming Stockholm said so.
    const index = await quoteOne(SYM_OMXS30, FIXTURES.omxs30)
    expect(index.provenance.venue).toBeUndefined()
  })

  it('names Avanza as a broker and claims no originator', async () => {
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB)
    expect(quote.provenance.source.trust).toBe('broker')
    expect(quote.provenance.source.providerName).toBe('Avanza')
    expect(AVANZA_SOURCE.originator).toBeUndefined()
    expect(AVANZA_SOURCE.originatorTrust).toBeUndefined()
  })
})

/* ----------------------------------------------------------------- timestamps */

describe('timeOfLast is the observation timestamp', () => {
  it('uses timeOfLast, not updated', async () => {
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB)
    // Friday 17:29:30 CEST — the closing trade.
    expect(quote.provenance.asOf).toBe('2026-07-24T15:29:30.000Z')
    expect(quote.provenance.asOfPrecision).toBe('second')
  })

  it('keeps them apart when they diverge wildly', async () => {
    // Deliberately divergent so the two can never quietly become
    // interchangeable: `updated` here is two days after the last trade, which
    // is roughly what Avanza really did over the recorded weekend.
    const quote = await quoteOne(SYM_VOLV_B, {
      ...FIXTURES.volvB,
      timeOfLast: Date.parse('2026-07-20T09:00:00.000Z'),
      updated: Date.parse('2026-07-26T15:59:00.000Z'),
    })
    expect(quote.provenance.asOf).toBe('2026-07-20T09:00:00.000Z')
    expect(quote.provenance.ageMs).toBe(
      Date.parse(NOW) - Date.parse('2026-07-20T09:00:00.000Z'),
    )
  })

  it('does not fall back to updated when timeOfLast is missing', async () => {
    // A quote with no observation time is not a quote. Borrowing `updated`
    // would manufacture a freshness the source never claimed.
    const { timeOfLast: _dropped, ...withoutTime } = FIXTURES.volvB
    await expect(quoteOne(SYM_VOLV_B, withoutTime)).rejects.toThrow(/timeOfLast/)
  })
})

/* ------------------------------------------------- delay, session, separation */

describe('feed delay and market session are separate facts', () => {
  it('reports a delayed feed without quantifying the delay', async () => {
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB)
    expect(quote.provenance.quality).toBe('delayed')
    expect(quote.provenance.isDelayed).toBe(true)
    // Avanza states `isRealTime: false` but never says by how much.
    expect(quote.provenance.delayMinutes).toBeNull()
  })

  it('keeps quality at delayed when the venue is closed', async () => {
    // The decisive case. A closed venue does not turn a delayed print into an
    // official end-of-day close: only the source may make that claim.
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB, FIXTURES.marketplaceClosed)
    expect(quote.session).toBe('closed')
    expect(quote.provenance.quality).toBe('delayed')
    expect(quote.provenance.quality).not.toBe('eod')
    expect(quote.previousClose).toBeNull()
  })

  it('carries the open session through unchanged', async () => {
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB, FIXTURES.marketplaceOpen)
    expect(quote.session).toBe('open')
    expect(quote.provenance.quality).toBe('delayed')
  })

  it('maps only the statuses Avanza actually reports', () => {
    expect(sessionFrom('OPEN')).toBe('open')
    expect(sessionFrom('CLOSED')).toBe('closed')
    // An auction phase is not represented, because the schedule never offers
    // one. Guessing at it would be a claim about the venue we cannot support.
    expect(sessionFrom('PRE_OPEN')).toBe('unknown')
    expect(sessionFrom(undefined)).toBe('unknown')
  })

  it('falls back to an unknown session rather than dropping the quotes', async () => {
    const provider = createAvanzaProvider((async (name: string) => {
      if (name === 'get_marketplace_info') throw new Error('marketplace unavailable')
      return FIXTURES.volvB
    }) as AvanzaToolCall)
    const [quote] = await provider.fetchQuotes([SYM_VOLV_B], context())
    expect(quote?.session).toBe('unknown')
    expect(quote?.value).toBe(354.8)
  })

  it('never infers the session from the local clock', async () => {
    // A Wednesday at 11:00 Stockholm time, with no marketplace answer. There
    // is no Swedish holiday calendar in this repository, so weekday-and-clock
    // is not evidence the venue is open.
    const provider = createAvanzaProvider((async (name: string) => {
      if (name === 'get_marketplace_info') throw new Error('unavailable')
      return FIXTURES.volvB
    }) as AvanzaToolCall)
    const ctx: FetchContext = {
      ...context(),
      clock: new FakeClock('2026-07-22T09:00:00.000Z'),
    }
    const [quote] = await provider.fetchQuotes([SYM_VOLV_B], ctx)
    expect(quote?.session).toBe('unknown')
  })
})

/* ------------------------------------------------------ change cross-checking */

describe('provider change figures are cross-checked', () => {
  it('accepts the rounding present in the recorded payloads', async () => {
    // 2.8 against 354.8 implies 0.7955%; Avanza states 0.80%.
    await expect(quoteOne(SYM_VOLV_B, FIXTURES.volvB)).resolves.toBeDefined()
    await expect(quoteOne(SYM_OMXS30, FIXTURES.omxs30)).resolves.toBeDefined()
  })

  it('refuses a quote whose two change figures disagree', async () => {
    // The failure that matters: a change left over from an earlier session
    // against a freshly updated price.
    await expect(
      quoteOne(SYM_VOLV_B, { ...FIXTURES.volvB, changePercent: 4.2 }),
    ).rejects.toThrow(/disagree/i)
  })

  it('does not silently substitute a locally derived change', async () => {
    const quote = await quoteOne(SYM_VOLV_B, FIXTURES.volvB)
    // The provider's own figures, passed through, and labelled as theirs.
    expect(quote.absoluteChange).toBe(2.8)
    expect(quote.changeSource).toBe('provider')
  })
})

/* ------------------------------------------------------------ malformed input */

describe('malformed payloads', () => {
  it.each([
    ['a missing last', { ...FIXTURES.volvB, last: undefined }],
    ['a string last', { ...FIXTURES.volvB, last: '354,80' }],
    ['a null last', { ...FIXTURES.volvB, last: null }],
    ['a NaN last', { ...FIXTURES.volvB, last: Number.NaN }],
    ['a string timeOfLast', { ...FIXTURES.volvB, timeOfLast: '2026-07-24' }],
  ])('rejects %s', async (_label, payload) => {
    await expect(quoteOne(SYM_VOLV_B, payload)).rejects.toThrow()
  })

  it('drops optional fields it cannot trust rather than inventing them', async () => {
    const quote = await quoteOne(SYM_VOLV_B, {
      ...FIXTURES.volvB,
      highest: null,
      lowest: 'n/a',
      change: undefined,
    })
    expect(quote.dayHigh).toBeNull()
    expect(quote.dayLow).toBeNull()
    // The percentage survives; the absolute does not, and none is derived.
    expect(quote.percentageChange).toBe(0.8)
    expect(quote.absoluteChange).toBeNull()
  })

  it('rejects an empty payload', async () => {
    await expect(quoteOne(SYM_VOLV_B, {})).rejects.toThrow()
  })
})

/* -------------------------------------------- cancellation and backpressure */

describe('a dispatched MCP call cannot be cancelled', () => {
  it('reports a timeout when the caller gives up', async () => {
    const controller = new AbortController()
    const provider = createAvanzaProvider((async (name: string) => {
      if (name === 'get_marketplace_info') return FIXTURES.marketplaceClosed
      return new Promise(() => {}) // never settles, like a hung child process
    }) as AvanzaToolCall)

    const pending = provider.fetchQuotes([SYM_VOLV_B], context(controller.signal))
    controller.abort()
    // The caller experienced a timeout, so a timeout is what is recorded.
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
  })

  it('discards a late result instead of letting it overwrite fresher data', async () => {
    const controller = new AbortController()
    let settle: (value: unknown) => void = () => {}
    const late = new Promise((resolve) => (settle = resolve))

    const provider = createAvanzaProvider((async (name: string) => {
      if (name === 'get_marketplace_info') return FIXTURES.marketplaceClosed
      return late
    }) as AvanzaToolCall)

    const pending = provider.fetchQuotes([SYM_VOLV_B], context(controller.signal))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })

    // The abandoned call now returns. Nothing must come of it: the adapter
    // already reported failure, so this value has no path to the cache.
    settle({ ...FIXTURES.volvB, last: 999.9 })
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
  })

  it('does not leave the late rejection unhandled', async () => {
    const controller = new AbortController()
    let fail: (error: Error) => void = () => {}
    const provider = createAvanzaProvider((async (name: string) => {
      if (name === 'get_marketplace_info') return FIXTURES.marketplaceClosed
      return new Promise((_resolve, reject) => (fail = reject))
    }) as AvanzaToolCall)

    const pending = provider.fetchQuotes([SYM_VOLV_B], context(controller.signal))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
    fail(new Error('child process died after we stopped waiting'))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('concurrency is bounded', () => {
  it('never exceeds the cap', async () => {
    let active = 0
    let peak = 0
    const gate = createGate(MAX_CONCURRENCY, MAX_QUEUE_DEPTH)
    await Promise.all(
      Array.from({ length: 20 }, () =>
        gate(async () => {
          active += 1
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, 1))
          active -= 1
        }),
      ),
    )
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY)
    expect(peak).toBe(MAX_CONCURRENCY)
  })

  it('refuses rather than queueing without limit', async () => {
    const gate = createGate(1, 2)
    const block = new Promise((resolve) => setTimeout(resolve, 20))
    const running = [gate(() => block), gate(() => block), gate(() => block)]
    // One running, two waiting: the fourth has nowhere to go.
    await expect(gate(async () => 'never')).rejects.toThrow(/queue is full/i)
    await Promise.all(running)
  })

  it('fetches every requested symbol despite the cap', async () => {
    const symbols = AVANZA_INSTRUMENTS.map((i) => i.symbol)
    const quotes = Object.fromEntries(
      AVANZA_INSTRUMENTS.map((i) => [
        i.orderBookId,
        i.symbol === SYM_OMXS30 ? FIXTURES.omxs30 : FIXTURES.volvB,
      ]),
    )
    const provider = createAvanzaProvider(toolCall(quotes))
    const result = await provider.fetchQuotes(symbols, context())
    expect(result.map((q) => q.symbol)).toEqual(symbols)
  })
})

/* -------------------------------------------------------------- transport gap */

describe('a missing local dependency degrades rather than crashing', () => {
  it('surfaces a uvx failure as a provider error', async () => {
    const provider = createAvanzaProvider((async () => {
      throw new Error("spawn uvx ENOENT: 'uvx' is not recognised")
    }) as AvanzaToolCall)
    // Not a crash, not a fabricated quote: an error the chain can fall back
    // from. Marketplace info fails the same way and is swallowed, so the
    // rejection here comes from the quote call itself.
    await expect(provider.fetchQuotes([SYM_VOLV_B], context())).rejects.toThrow(/uvx/)
  })
})

/* --------------------------------------------------------------- no network */

describe('the adapter is inert without a tool call', () => {
  it('spawns nothing on import', async () => {
    const spawned = vi.fn()
    const provider = createAvanzaProvider(spawned as unknown as AvanzaToolCall)
    expect(spawned).not.toHaveBeenCalled()
    expect(provider.id).toBe('avanza')
  })

  it('asks only for the order book ids in its table', async () => {
    const requested: string[] = []
    const provider = createAvanzaProvider((async (
      name: string,
      args: Record<string, unknown>,
    ) => {
      if (name === 'get_marketplace_info') return FIXTURES.marketplaceClosed
      requested.push(String(args.instrument_id))
      return FIXTURES.volvB
    }) as AvanzaToolCall)
    await provider.fetchQuotes([SYM_VOLV_B, SYM_OMXS30], context())
    expect(requested.sort()).toEqual([OMX_ID, VOLV_ID].sort())
  })
})
