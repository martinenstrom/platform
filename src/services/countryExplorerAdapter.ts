/**
 * Real-data adapter for the Country Explorer — intentionally unimplemented.
 *
 * Documents the shape a live integration should take so the UI never needs
 * to know where data comes from, same pattern as `avanzaMcpAdapter.ts`:
 * a tool/endpoint table per data domain, and a throwing factory with a
 * "suggested outline" comment. Wire up one domain (and one country) at a
 * time — `mockCountryExplorerService` backs the rest until each is mapped.
 *
 * Scope guard: this is read-only reference/analysis data. Do not add
 * anything that places trades or submits orders here.
 */

/** Macro/market data domain — World Bank, IMF, OECD, Eurostat, national central banks/statistics offices, FRED, exchange APIs. */
export const MACRO_DATA_SOURCES = {
  worldBank: 'https://api.worldbank.org/v2',
  imf: 'https://www.imf.org/external/datamapper/api',
  oecd: 'https://sdmx.oecd.org',
  fred: 'https://api.stlouisfed.org/fred',
  // Country-specific: Riksbanken/SCB, Bundesbank/Destatis, BOJ/Statistics Bureau of Japan, BLS/BEA/Fed, etc.
} as const

/** News domain — NewsAPI, GNews, Finnhub, Marketaux, central-bank/government/statistics-office RSS feeds. */
export const NEWS_DATA_SOURCES = {
  newsApi: 'https://newsapi.org/v2',
  gnews: 'https://gnews.io/api/v4',
  finnhub: 'https://finnhub.io/api/v1',
  marketaux: 'https://api.marketaux.com/v1',
} as const

/**
 * TODO(country-macro-data): implement.
 *
 * Suggested outline per country:
 *   const [gdp, cpi, policyRate] = await Promise.all([
 *     fetchWorldBankIndicator(countryCode, 'NY.GDP.MKTP.KD.ZG'),
 *     fetchFred(seriesIdForCountry(countryCode, 'CPI')),
 *     fetchCentralBankRate(countryCode),
 *   ])
 *   return mapToMacroIndicators({ gdp, cpi, policyRate })
 *
 * Roll indicators over one at a time per country — the mock fixtures in
 * `~/data/countryExplorer/` can back the rest until each is mapped.
 */
export function createCountryMacroAdapter(): never {
  throw new Error(
    'Country macro-data-adaptern är inte implementerad ännu. Använd mockCountryExplorerService.',
  )
}

/**
 * TODO(country-news): implement.
 *
 * Suggested outline: fetch + rank recent articles for the country from one
 * or more of `NEWS_DATA_SOURCES`, filter to the categories in
 * `NewsCategory`, and either call an LLM briefed on the
 * "WHAT MATTERS FOR INVESTORS" framing (see the spec this feature was built
 * from) or a rule-based ranking to produce a `CountryNewsSynthesis`. Refresh
 * independently from macro data (news moves faster) and always fall back to
 * the last successfully cached batch on a failed refresh — never clear
 * previously loaded news on an error.
 */
export function createCountryNewsAdapter(): never {
  throw new Error(
    'Country news-adaptern är inte implementerad ännu. Använd mockCountryExplorerService.',
  )
}
