/**
 * The only functions allowed to reach into `./client.ts` (the Node-only MCP
 * transport). `createServerFn` handlers execute exclusively on the server —
 * calling one from client code performs a network round trip instead of
 * ever bundling the handler body (and therefore the Node `child_process`
 * dependency chain it pulls in via `./client.ts`) into the browser build.
 * That's also why the `AVANZA_MCP_ENABLED` check lives here rather than in
 * `marketDataService.ts`: `process.env` is only meaningfully populated in
 * this server-side handler, never in the client bundle that also evaluates
 * that file.
 *
 * The dynamic `import('./client')` inside each handler is a deliberate,
 * defense-in-depth guard on top of that: even if a future refactor changes
 * how these fetchers are composed, the Node-only module can only ever be
 * reached from code that is already known to run server-side.
 */

import { createServerFn } from '@tanstack/react-start'
import { getMockQuote, marketStatus, searchInstrumentsLocal } from '~/data/mockData'
import {
  mapMarketplaceInfoToMarketStatus,
  mapSearchResponseToInstruments,
  mapStockQuoteToQuote,
  type AvanzaMarketplaceInfo,
  type AvanzaSearchResponse,
  type AvanzaStockQuote,
} from './mappers'
import type { Instrument, MarketStatus, Quote } from '~/types'

/** Order book ID for OMX Stockholm 30 — used as the reference instrument for market-open status. */
const OMXS30_ORDER_BOOK_ID = '19002'

function isAvanzaMcpEnabled(): boolean {
  return process.env.AVANZA_MCP_ENABLED === 'true'
}

export const searchAvanzaInstrumentsFn = createServerFn({ method: 'GET' })
  .validator((query: string) => query)
  .handler(async ({ data: query }): Promise<Instrument[]> => {
    if (!isAvanzaMcpEnabled()) {
      return searchInstrumentsLocal(query)
    }
    const { callAvanzaTool } = await import('./client')
    const response = await callAvanzaTool<AvanzaSearchResponse>('search_instruments', {
      query,
      instrument_type: 'all',
      limit: 10,
    })
    return mapSearchResponseToInstruments(response)
  })

export const getAvanzaMarketStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MarketStatus> => {
    if (!isAvanzaMcpEnabled()) {
      return marketStatus
    }
    const { callAvanzaTool } = await import('./client')
    const info = await callAvanzaTool<AvanzaMarketplaceInfo>('get_marketplace_info', {
      instrument_id: OMXS30_ORDER_BOOK_ID,
    })
    return mapMarketplaceInfoToMarketStatus(info)
  },
)

export const getAvanzaStockQuoteFn = createServerFn({ method: 'GET' })
  .validator((instrumentId: string) => instrumentId)
  .handler(async ({ data: instrumentId }): Promise<Quote> => {
    if (!isAvanzaMcpEnabled()) {
      return getMockQuote(instrumentId)
    }
    const { callAvanzaTool } = await import('./client')
    const quote = await callAvanzaTool<AvanzaStockQuote>('get_stock_quote', {
      instrument_id: instrumentId,
    })
    return mapStockQuoteToQuote(instrumentId, quote)
  })
