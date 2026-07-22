/**
 * Real external data integrations — intentionally unimplemented.
 *
 * This file documents the shape each agent's live data source should take,
 * grouped by data domain rather than by agent (several agents share a
 * domain). Nothing here runs today; every factory throws. Follows the same
 * shape as `~/services/avanzaMcpAdapter.ts`:
 *
 *   1. A `*Client` interface for whatever transport is used underneath.
 *   2. A tool-name table naming the concrete upstream endpoints.
 *   3. A `create*Adapter()` factory that will return real data once wired up.
 *
 * Keep credentials on the server and call these from a TanStack Start
 * `createServerFn`, never from the browser bundle. Wire up one domain at a
 * time — mock fixtures back the rest until each is mapped and verified.
 */

/** Minimal surface expected from any of these clients (tool name + args). */
export interface InvestmentLetterDataClient {
  callTool<TResult>(name: string, args?: Record<string, unknown>): Promise<TResult>
}

/**
 * News & central bank sources feeding the News Intelligence Analyst.
 * Bloomberg/Reuters/FT/WSJ/CNBC/MarketWatch/Barron's/The Economist, plus
 * Fed/ECB/Riksbanken/BoE/BIS/IMF/OECD/World Bank/Trading Economics/FRED.
 */
export const NEWS_DATA_TOOLS = {
  headlines: 'news.headlines.search',
  centralBankStatements: 'news.centralbank.statements',
  macroCalendar: 'news.macro.calendar',
  earningsCalendar: 'news.earnings.calendar',
} as const

/**
 * TODO(news-data): implement.
 * Suggested outline: fetch headlines + statements for the current week,
 * pass them to an LLM briefed on `agents/newsIntelligenceAgent.ts`'s role.
 */
export function createNewsIntelligenceDataAdapter(
  _client: InvestmentLetterDataClient,
): never {
  throw new Error(
    'Nyhets-adaptern är inte implementerad ännu. Använd mockNewsIntelligence.',
  )
}

/**
 * Flow & positioning sources feeding the Flow Intelligence Analyst.
 * ETF/fund flows, options flow & gamma exposure, dark pools, 13F/SEC EDGAR,
 * insider transactions (OpenInsider/InsiderMonkey/GuruFocus), hedge fund and
 * CTA positioning, credit spreads (IG/HY/CDS), VIX/MOVE, put/call ratio.
 */
export const FLOW_DATA_TOOLS = {
  etfFlows: 'flows.etf.daily',
  fundFlows: 'flows.fund.weekly',
  optionsFlow: 'flows.options.summary',
  edgarFilings: 'flows.edgar.13f',
  insiderTransactions: 'flows.insider.transactions',
  creditSpreads: 'flows.credit.spreads',
  volatilityIndices: 'flows.volatility.indices',
} as const

/** TODO(flow-data): implement. Suggested outline: same pattern as above. */
export function createFlowIntelligenceDataAdapter(
  _client: InvestmentLetterDataClient,
): never {
  throw new Error(
    'Flow-adaptern är inte implementerad ännu. Använd mockFlowIntelligence.',
  )
}

/**
 * Macro & rates sources feeding the Global Macro Strategist.
 * FRED, Riksbanken, ECB, national statistics offices, PMI/ISM providers.
 */
export const MACRO_DATA_TOOLS = {
  inflationSeries: 'macro.inflation.series',
  pmiSeries: 'macro.pmi.series',
  centralBankRates: 'macro.rates.policy',
  yieldCurve: 'macro.rates.yieldcurve',
  fxRates: 'macro.fx.rates',
} as const

/** TODO(macro-data): implement. Suggested outline: same pattern as above. */
export function createGlobalMacroDataAdapter(_client: InvestmentLetterDataClient): never {
  throw new Error('Makro-adaptern är inte implementerad ännu. Använd mockGlobalMacro.')
}

/**
 * Market & valuation sources feeding the Equity Strategist, Valuation
 * Specialist and Quant & Data Scientist (index/sector prices, multiples,
 * dividend/buyback data, and the raw series behind every chart).
 */
export const MARKET_DATA_TOOLS = {
  indexQuotes: 'market.index.quotes',
  sectorPerformance: 'market.sector.performance',
  valuationMultiples: 'market.valuation.multiples',
  earningsRevisions: 'market.earnings.revisions',
  chartSeries: 'market.chart.series',
} as const

/** TODO(market-data): implement. Suggested outline: same pattern as above. */
export function createMarketDataAdapter(_client: InvestmentLetterDataClient): never {
  throw new Error(
    'Marknadsdata-adaptern är inte implementerad ännu. Använd mockEquityStrategist / mockValuationSpecialist / mockQuant.',
  )
}
