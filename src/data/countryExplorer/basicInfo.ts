import type { CountryMacroData, CountryRegistryEntry } from '~/types/countryExplorer'
import { COUNTRY_MOCK_NOW } from './mockNow'

/**
 * The "basic info only" tier: countries the spec asks to be clickable and
 * searchable, but this template doesn't (yet) have full macro/news/markets
 * content for. Returns just the header-level facts the registry already
 * knows — everything else is intentionally empty so the UI shows an honest
 * "not yet available" state instead of fabricated numbers.
 */
export function buildBasicCountryData(entry: CountryRegistryEntry): CountryMacroData {
  return {
    countryCode: entry.countryCode,
    countryName: entry.nameEn,
    region: entry.region,
    marketClassification: entry.marketClassification,
    lastUpdated: COUNTRY_MOCK_NOW.toISOString(),
    isPartial: true,
    macro: [],
    news: [],
    newsSynthesis: null,
    markets: null,
    sectors: [],
    sectorAnalysis: null,
    topCompanies: [],
    investmentStrengths: [],
    investmentRisks: [],
    scores: null,
    triggers: [],
    sources: [],
  }
}
