import type { CountryMacroData, CountryNewsItem } from '~/types/countryExplorer'
import { getRegistryEntry, resolveCountryByGeoName } from './registry'
import { buildBasicCountryData } from './basicInfo'
import { SWEDEN_DATA } from './sweden'
import { USA_DATA } from './usa'
import { GERMANY_DATA } from './germany'
import { JAPAN_DATA } from './japan'

export {
  COUNTRY_REGISTRY,
  searchCountryRegistry,
  getRegistryEntry,
  resolveCountryByGeoName,
} from './registry'

const FULL_DATA_BY_CODE: Record<string, CountryMacroData> = {
  SE: SWEDEN_DATA,
  US: USA_DATA,
  DE: GERMANY_DATA,
  JP: JAPAN_DATA,
}

/**
 * Resolves a country code (from the registry, or a synthetic
 * `resolveCountryByGeoName` code for an uncurated country) to its analysis
 * data. Full-tier countries return complete data; everything else returns
 * the honest "basic info" shell.
 */
export function getCountryAnalysis(countryCode: string): CountryMacroData {
  const full = FULL_DATA_BY_CODE[countryCode]
  if (full) return full

  const entry = getRegistryEntry(countryCode) ?? resolveCountryByGeoName(countryCode)
  return buildBasicCountryData(entry)
}

export { COUNTRY_MOCK_NOW } from './mockNow'

/**
 * Global News Feed card: aggregates the real (mock) news already written
 * for the four full-tier countries — no new news content — merged and
 * sorted by recency.
 */
export function getGlobalNewsFeed(limit = 6): CountryNewsItem[] {
  return [...SWEDEN_DATA.news, ...USA_DATA.news, ...GERMANY_DATA.news, ...JAPAN_DATA.news]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit)
}
