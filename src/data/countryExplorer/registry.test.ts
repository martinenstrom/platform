import { describe, expect, it } from 'vitest'
import {
  COUNTRY_REGISTRY,
  getRegistryEntry,
  resolveCountryByGeoName,
  searchCountryRegistry,
} from './registry'
import { getCountryAnalysis } from './index'

describe('searchCountryRegistry', () => {
  it('matches Swedish names', () => {
    expect(searchCountryRegistry('Sverige').map((e) => e.countryCode)).toContain('SE')
  })

  it('matches English names', () => {
    expect(searchCountryRegistry('Germany').map((e) => e.countryCode)).toContain('DE')
  })

  it('matches by country code', () => {
    expect(searchCountryRegistry('jp').map((e) => e.countryCode)).toContain('JP')
  })

  it('returns nothing for an empty query', () => {
    expect(searchCountryRegistry('   ')).toEqual([])
  })

  it('returns nothing for a query that matches no country', () => {
    expect(searchCountryRegistry('xyzxyz')).toEqual([])
  })
})

describe('getRegistryEntry', () => {
  it('finds a known country by code', () => {
    expect(getRegistryEntry('SE')?.nameEn).toBe('Sweden')
  })

  it('returns undefined for an unknown code', () => {
    expect(getRegistryEntry('ZZ')).toBeUndefined()
  })
})

describe('resolveCountryByGeoName', () => {
  it('resolves a registered geo name to its full entry', () => {
    const entry = resolveCountryByGeoName('United States of America')
    expect(entry.countryCode).toBe('US')
  })

  it('synthesizes a minimal entry for an uncurated country', () => {
    const entry = resolveCountryByGeoName('Fiji')
    expect(entry.nameEn).toBe('Fiji')
    expect(entry.hasFullData).toBe(false)
  })
})

describe('getCountryAnalysis', () => {
  it('returns full, non-partial data for the four curated countries', () => {
    for (const code of ['SE', 'US', 'DE', 'JP']) {
      const data = getCountryAnalysis(code)
      expect(data.isPartial).toBe(false)
      expect(data.macro.length).toBeGreaterThan(0)
      expect(data.news.length).toBeGreaterThan(0)
      expect(data.scores).not.toBeNull()
    }
  })

  it('returns a partial, honest shell for a registered-but-basic country', () => {
    const data = getCountryAnalysis('NO')
    expect(data.isPartial).toBe(true)
    expect(data.macro).toEqual([])
    expect(data.scores).toBeNull()
    expect(data.countryName).toBe('Norway')
  })

  it('never fabricates data for a country outside the registry', () => {
    const data = getCountryAnalysis('Fiji')
    expect(data.isPartial).toBe(true)
    expect(data.news).toEqual([])
    expect(data.sources).toEqual([])
  })

  it('registry contains every country marked hasFullData with matching full data', () => {
    const fullCodes = COUNTRY_REGISTRY.filter((e) => e.hasFullData).map(
      (e) => e.countryCode,
    )
    expect(fullCodes.sort()).toEqual(['DE', 'JP', 'SE', 'US'])
  })
})
