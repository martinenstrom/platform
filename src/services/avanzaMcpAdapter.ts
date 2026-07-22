/**
 * Avanza MCP adapter — intentionally unimplemented.
 *
 * This file documents the shape the real integration should take so the UI never
 * needs to know where data comes from. Nothing here runs today.
 *
 * Where things go
 * ---------------
 * 1. `AvanzaMcpClient` is satisfied by whatever MCP transport is used
 *    (stdio / HTTP). Keep credentials on the server — call MCP tools from a
 *    TanStack Start `createServerFn`, never from the browser bundle.
 * 2. `mapPositionsToHoldings` (and siblings) translate upstream payloads into the
 *    domain types in `~/types`. Keep every field-level assumption in this file.
 * 3. `createAvanzaMcpMarketDataService` returns a `MarketDataService` that
 *    `getMarketDataService()` can hand to the UI in place of the mock.
 *
 * Scope guard: this template is read-only by design. Do not add order placement
 * or trading tools here.
 */

import type { MarketDataService } from './marketDataService'

/** Minimal surface expected from an MCP client (tool name + arguments). */
export interface AvanzaMcpClient {
  callTool<TResult>(name: string, args?: Record<string, unknown>): Promise<TResult>
}

/** Tool names the adapter is expected to call. Adjust to the real MCP server. */
export const AVANZA_MCP_TOOLS = {
  accountOverview: 'avanza.account.overview',
  positions: 'avanza.account.positions',
  instrumentSearch: 'avanza.instrument.search',
  instrumentQuote: 'avanza.instrument.quote',
  chartData: 'avanza.instrument.chart',
  watchlists: 'avanza.watchlist.list',
} as const

/**
 * TODO(avanza-mcp): implement.
 *
 * Suggested outline:
 *   const positions = await client.callTool(AVANZA_MCP_TOOLS.positions)
 *   return { ...mockMarketDataService, getHoldings: async () => map(positions) }
 *
 * Roll methods over one at a time — the mock service can back the rest until
 * each endpoint is mapped and verified.
 */
export function createAvanzaMcpMarketDataService(
  _client: AvanzaMcpClient,
): MarketDataService {
  throw new Error(
    'Avanza MCP-adaptern är inte implementerad ännu. Använd mockMarketDataService.',
  )
}

/**
 * TODO(agents): AI briefs, opportunities and analysis runs are produced by
 * analysis agents rather than Avanza. Add a separate `analysisAgentService.ts`
 * with the same async-interface pattern and compose the two here.
 */
