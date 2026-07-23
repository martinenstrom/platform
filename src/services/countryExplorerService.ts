/**
 * Country Explorer service — the seam between the UI and any real
 * macro/news/market data source. Same shape as `marketDataService.ts`:
 * a typed interface, a mock implementation, and a resolver components
 * should call instead of importing fixtures directly.
 */

import {
  COUNTRY_REGISTRY,
  getCountryAnalysis as getCountryAnalysisData,
  searchCountryRegistry,
} from '~/data/countryExplorer'
import type { CountryMacroData, CountryRegistryEntry } from '~/types/countryExplorer'

export interface CountryExplorerService {
  getRegistry(): Promise<CountryRegistryEntry[]>
  searchCountries(query: string): Promise<CountryRegistryEntry[]>
  getCountryAnalysis(countryCode: string): Promise<CountryMacroData>
}

/**
 * Purely local implementation — no timers, no fake latency. All content is
 * clearly-labeled mock data (`isPartial`/empty sections for anything beyond
 * the four full-tier countries); see `countryExplorerAdapter.ts` for where a
 * real data source would plug in.
 */
export const mockCountryExplorerService: CountryExplorerService = {
  getRegistry: async () => COUNTRY_REGISTRY,
  searchCountries: async (query) => searchCountryRegistry(query),
  getCountryAnalysis: async (countryCode) => getCountryAnalysisData(countryCode),
}

export function getCountryExplorerService(): CountryExplorerService {
  return mockCountryExplorerService
}

export const countryExplorerService = getCountryExplorerService()
