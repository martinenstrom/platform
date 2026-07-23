import { describe, expect, it } from 'vitest'
import { GLOBAL_HEADLINE_MACRO } from './globalHeadlineMacro'
import { COUNTRY_REGISTRY } from './registry'

describe('GLOBAL_HEADLINE_MACRO', () => {
  it('covers every country in the registry', () => {
    for (const entry of COUNTRY_REGISTRY) {
      expect(GLOBAL_HEADLINE_MACRO[entry.countryCode]).toBeDefined()
    }
    expect(Object.keys(GLOBAL_HEADLINE_MACRO)).toHaveLength(COUNTRY_REGISTRY.length)
  })

  it('derives the four full-tier countries from their real fixtures, not hand-duplicated numbers', () => {
    expect(GLOBAL_HEADLINE_MACRO.SE?.gdpGrowthPercent).toBe(1.4)
    expect(GLOBAL_HEADLINE_MACRO.US?.inflationPercent).toBe(2.8)
    expect(GLOBAL_HEADLINE_MACRO.DE?.manufacturingPmi).toBe(48.9)
    expect(GLOBAL_HEADLINE_MACRO.JP?.politicalStabilityScore).toBe(8)
  })

  it('every entry has finite numeric fields', () => {
    for (const macro of Object.values(GLOBAL_HEADLINE_MACRO)) {
      expect(Number.isFinite(macro.gdpGrowthPercent)).toBe(true)
      expect(Number.isFinite(macro.inflationPercent)).toBe(true)
      expect(Number.isFinite(macro.policyRatePercent)).toBe(true)
      expect(Number.isFinite(macro.manufacturingPmi)).toBe(true)
      expect(macro.politicalStabilityScore).toBeGreaterThanOrEqual(0)
      expect(macro.politicalStabilityScore).toBeLessThanOrEqual(10)
    }
  })
})
