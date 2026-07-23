/**
 * The globe/search index: every country the Country Explorer treats as a
 * first-class citizen (search autocomplete, camera fly-to). The globe itself
 * is clickable across the full ~177-country topojson dataset — see
 * `resolveCountry` below for how a click outside this registry still
 * resolves to a (partial) result instead of doing nothing.
 */

import type { CountryRegistryEntry } from '~/types/countryExplorer'

export const COUNTRY_REGISTRY: CountryRegistryEntry[] = [
  {
    countryCode: 'SE',
    nameSv: 'Sverige',
    nameEn: 'Sweden',
    geoName: 'Sweden',
    region: 'Northern Europe',
    marketClassification: 'developed',
    flagEmoji: '🇸🇪',
    lat: 62.0,
    lng: 15.0,
    hasFullData: true,
  },
  {
    countryCode: 'NO',
    nameSv: 'Norge',
    nameEn: 'Norway',
    geoName: 'Norway',
    region: 'Northern Europe',
    marketClassification: 'developed',
    flagEmoji: '🇳🇴',
    lat: 60.5,
    lng: 8.5,
    hasFullData: false,
  },
  {
    countryCode: 'DK',
    nameSv: 'Danmark',
    nameEn: 'Denmark',
    geoName: 'Denmark',
    region: 'Northern Europe',
    marketClassification: 'developed',
    flagEmoji: '🇩🇰',
    lat: 56.0,
    lng: 10.0,
    hasFullData: false,
  },
  {
    countryCode: 'FI',
    nameSv: 'Finland',
    nameEn: 'Finland',
    geoName: 'Finland',
    region: 'Northern Europe',
    marketClassification: 'developed',
    flagEmoji: '🇫🇮',
    lat: 64.0,
    lng: 26.0,
    hasFullData: false,
  },
  {
    countryCode: 'DE',
    nameSv: 'Tyskland',
    nameEn: 'Germany',
    geoName: 'Germany',
    region: 'Western Europe',
    marketClassification: 'developed',
    flagEmoji: '🇩🇪',
    lat: 51.2,
    lng: 10.4,
    hasFullData: true,
  },
  {
    countryCode: 'FR',
    nameSv: 'Frankrike',
    nameEn: 'France',
    geoName: 'France',
    region: 'Western Europe',
    marketClassification: 'developed',
    flagEmoji: '🇫🇷',
    lat: 46.6,
    lng: 2.2,
    hasFullData: false,
  },
  {
    countryCode: 'GB',
    nameSv: 'Storbritannien',
    nameEn: 'United Kingdom',
    geoName: 'United Kingdom',
    region: 'Northern Europe',
    marketClassification: 'developed',
    flagEmoji: '🇬🇧',
    lat: 54.0,
    lng: -2.0,
    hasFullData: false,
  },
  {
    countryCode: 'CH',
    nameSv: 'Schweiz',
    nameEn: 'Switzerland',
    geoName: 'Switzerland',
    region: 'Western Europe',
    marketClassification: 'developed',
    flagEmoji: '🇨🇭',
    lat: 46.8,
    lng: 8.2,
    hasFullData: false,
  },
  {
    countryCode: 'IT',
    nameSv: 'Italien',
    nameEn: 'Italy',
    geoName: 'Italy',
    region: 'Southern Europe',
    marketClassification: 'developed',
    flagEmoji: '🇮🇹',
    lat: 42.8,
    lng: 12.8,
    hasFullData: false,
  },
  {
    countryCode: 'ES',
    nameSv: 'Spanien',
    nameEn: 'Spain',
    geoName: 'Spain',
    region: 'Southern Europe',
    marketClassification: 'developed',
    flagEmoji: '🇪🇸',
    lat: 40.0,
    lng: -4.0,
    hasFullData: false,
  },
  {
    countryCode: 'NL',
    nameSv: 'Nederländerna',
    nameEn: 'Netherlands',
    geoName: 'Netherlands',
    region: 'Western Europe',
    marketClassification: 'developed',
    flagEmoji: '🇳🇱',
    lat: 52.3,
    lng: 5.75,
    hasFullData: false,
  },
  {
    countryCode: 'US',
    nameSv: 'USA',
    nameEn: 'United States',
    geoName: 'United States of America',
    region: 'North America',
    marketClassification: 'developed',
    flagEmoji: '🇺🇸',
    lat: 39.8,
    lng: -98.5,
    hasFullData: true,
  },
  {
    countryCode: 'CA',
    nameSv: 'Kanada',
    nameEn: 'Canada',
    geoName: 'Canada',
    region: 'North America',
    marketClassification: 'developed',
    flagEmoji: '🇨🇦',
    lat: 56.1,
    lng: -106.3,
    hasFullData: false,
  },
  {
    countryCode: 'BR',
    nameSv: 'Brasilien',
    nameEn: 'Brazil',
    geoName: 'Brazil',
    region: 'Latin America',
    marketClassification: 'emerging',
    flagEmoji: '🇧🇷',
    lat: -10.3,
    lng: -53.2,
    hasFullData: false,
  },
  {
    countryCode: 'MX',
    nameSv: 'Mexiko',
    nameEn: 'Mexico',
    geoName: 'Mexico',
    region: 'Latin America',
    marketClassification: 'emerging',
    flagEmoji: '🇲🇽',
    lat: 23.6,
    lng: -102.5,
    hasFullData: false,
  },
  {
    countryCode: 'JP',
    nameSv: 'Japan',
    nameEn: 'Japan',
    geoName: 'Japan',
    region: 'East Asia',
    marketClassification: 'developed',
    flagEmoji: '🇯🇵',
    lat: 36.2,
    lng: 138.25,
    hasFullData: true,
  },
  {
    countryCode: 'CN',
    nameSv: 'Kina',
    nameEn: 'China',
    geoName: 'China',
    region: 'East Asia',
    marketClassification: 'emerging',
    flagEmoji: '🇨🇳',
    lat: 35.9,
    lng: 104.2,
    hasFullData: false,
  },
  {
    countryCode: 'IN',
    nameSv: 'Indien',
    nameEn: 'India',
    geoName: 'India',
    region: 'South Asia',
    marketClassification: 'emerging',
    flagEmoji: '🇮🇳',
    lat: 20.6,
    lng: 78.9,
    hasFullData: false,
  },
  {
    countryCode: 'KR',
    nameSv: 'Sydkorea',
    nameEn: 'South Korea',
    geoName: 'South Korea',
    region: 'East Asia',
    marketClassification: 'developed',
    flagEmoji: '🇰🇷',
    lat: 35.9,
    lng: 127.8,
    hasFullData: false,
  },
  {
    countryCode: 'AU',
    nameSv: 'Australien',
    nameEn: 'Australia',
    geoName: 'Australia',
    region: 'Oceania',
    marketClassification: 'developed',
    flagEmoji: '🇦🇺',
    lat: -25.3,
    lng: 133.8,
    hasFullData: false,
  },
  {
    countryCode: 'ZA',
    nameSv: 'Sydafrika',
    nameEn: 'South Africa',
    geoName: 'South Africa',
    region: 'Sub-Saharan Africa',
    marketClassification: 'emerging',
    flagEmoji: '🇿🇦',
    lat: -29.0,
    lng: 24.0,
    hasFullData: false,
  },
]

/** Case-insensitive match against Swedish name, English name, or country code. */
export function searchCountryRegistry(query: string): CountryRegistryEntry[] {
  const q = query.trim().toLocaleLowerCase('sv-SE')
  if (!q) return []
  return COUNTRY_REGISTRY.filter(
    (entry) =>
      entry.nameSv.toLocaleLowerCase('sv-SE').includes(q) ||
      entry.nameEn.toLocaleLowerCase('sv-SE').includes(q) ||
      entry.countryCode.toLocaleLowerCase('sv-SE') === q,
  ).slice(0, 8)
}

export function getRegistryEntry(countryCode: string): CountryRegistryEntry | undefined {
  return COUNTRY_REGISTRY.find((entry) => entry.countryCode === countryCode)
}

/**
 * Resolves a topojson feature's `properties.name` to a registry entry, or —
 * for the ~150 countries this template doesn't curate — synthesizes a
 * minimal ad-hoc entry so every country on the globe is still clickable.
 * The synthetic `countryCode` is the geo name itself; it's only ever used as
 * a lookup key back into `getCountryAnalysis`, never displayed.
 */
export function resolveCountryByGeoName(geoName: string): CountryRegistryEntry {
  const known = COUNTRY_REGISTRY.find((entry) => entry.geoName === geoName)
  if (known) return known
  return {
    countryCode: geoName,
    nameSv: geoName,
    nameEn: geoName,
    geoName,
    region: 'Unclassified region',
    marketClassification: 'frontier',
    flagEmoji: '🏳️',
    lat: 0,
    lng: 0,
    hasFullData: false,
  }
}
