import { GERMANY_DATA } from './germany'
import { JAPAN_DATA } from './japan'
import { SWEDEN_DATA } from './sweden'
import { USA_DATA } from './usa'
import { parseLeadingNumber } from './trendSeries'
import type { CountryHeadlineMacro, CountryMacroData } from '~/types/countryExplorer'

/**
 * Headline macro figures backing the Global Command Center's heatmap layers.
 * Covers every country in the registry (not just the four full-tier ones)
 * so a heatmap layer never looks sparse/broken — everywhere outside this
 * registry (the ~156 remaining topojson countries) stays uncolored on every
 * layer rather than interpolating or fabricating a value.
 *
 * The four full-tier countries derive their numbers from the real fixtures
 * (single source of truth, no hand-duplicated figures that could drift).
 * The other 17 are illustrative headline figures, not live data — same
 * honest-mock-data convention as every other fixture in this app.
 */

function fromFullFixture(data: CountryMacroData, indicatorId: string): number {
  const indicator = data.macro.find((item) => item.id === indicatorId)
  const parsed = indicator ? parseLeadingNumber(indicator.value) : null
  if (parsed === null) {
    throw new Error(
      `Kunde inte tolka makroindikatorn "${indicatorId}" för ${data.countryName}`,
    )
  }
  return parsed
}

function deriveFromFullFixture(data: CountryMacroData): CountryHeadlineMacro {
  return {
    countryCode: data.countryCode,
    gdpGrowthPercent: fromFullFixture(data, 'gdp-growth'),
    inflationPercent: fromFullFixture(data, 'cpi'),
    policyRatePercent: fromFullFixture(data, 'policy-rate'),
    manufacturingPmi: fromFullFixture(data, 'pmi'),
    politicalStabilityScore: data.scores?.politicalStability ?? 5,
  }
}

export const GLOBAL_HEADLINE_MACRO: Record<string, CountryHeadlineMacro> = {
  SE: deriveFromFullFixture(SWEDEN_DATA),
  US: deriveFromFullFixture(USA_DATA),
  DE: deriveFromFullFixture(GERMANY_DATA),
  JP: deriveFromFullFixture(JAPAN_DATA),

  NO: {
    countryCode: 'NO',
    gdpGrowthPercent: 1.1,
    inflationPercent: 3.0,
    policyRatePercent: 4.25,
    manufacturingPmi: 49.5,
    politicalStabilityScore: 9,
  },
  DK: {
    countryCode: 'DK',
    gdpGrowthPercent: 1.8,
    inflationPercent: 1.6,
    policyRatePercent: 2.6,
    manufacturingPmi: 51.0,
    politicalStabilityScore: 9,
  },
  FI: {
    countryCode: 'FI',
    gdpGrowthPercent: 0.6,
    inflationPercent: 1.2,
    policyRatePercent: 2.0,
    manufacturingPmi: 47.5,
    politicalStabilityScore: 9,
  },
  FR: {
    countryCode: 'FR',
    gdpGrowthPercent: 0.7,
    inflationPercent: 1.8,
    policyRatePercent: 2.0,
    manufacturingPmi: 46.8,
    politicalStabilityScore: 6,
  },
  GB: {
    countryCode: 'GB',
    gdpGrowthPercent: 1.0,
    inflationPercent: 2.9,
    policyRatePercent: 4.0,
    manufacturingPmi: 50.5,
    politicalStabilityScore: 7,
  },
  CH: {
    countryCode: 'CH',
    gdpGrowthPercent: 1.3,
    inflationPercent: 0.6,
    policyRatePercent: 0.5,
    manufacturingPmi: 49.0,
    politicalStabilityScore: 10,
  },
  IT: {
    countryCode: 'IT',
    gdpGrowthPercent: 0.5,
    inflationPercent: 1.7,
    policyRatePercent: 2.0,
    manufacturingPmi: 48.0,
    politicalStabilityScore: 6,
  },
  ES: {
    countryCode: 'ES',
    gdpGrowthPercent: 2.1,
    inflationPercent: 2.3,
    policyRatePercent: 2.0,
    manufacturingPmi: 52.0,
    politicalStabilityScore: 7,
  },
  NL: {
    countryCode: 'NL',
    gdpGrowthPercent: 1.2,
    inflationPercent: 2.8,
    policyRatePercent: 2.0,
    manufacturingPmi: 50.2,
    politicalStabilityScore: 8,
  },
  CA: {
    countryCode: 'CA',
    gdpGrowthPercent: 1.5,
    inflationPercent: 2.2,
    policyRatePercent: 3.25,
    manufacturingPmi: 50.9,
    politicalStabilityScore: 8,
  },
  BR: {
    countryCode: 'BR',
    gdpGrowthPercent: 2.4,
    inflationPercent: 4.3,
    policyRatePercent: 10.75,
    manufacturingPmi: 51.5,
    politicalStabilityScore: 5,
  },
  MX: {
    countryCode: 'MX',
    gdpGrowthPercent: 1.7,
    inflationPercent: 4.1,
    policyRatePercent: 9.5,
    manufacturingPmi: 49.8,
    politicalStabilityScore: 5,
  },
  CN: {
    countryCode: 'CN',
    gdpGrowthPercent: 4.8,
    inflationPercent: 0.3,
    policyRatePercent: 3.1,
    manufacturingPmi: 49.7,
    politicalStabilityScore: 6,
  },
  IN: {
    countryCode: 'IN',
    gdpGrowthPercent: 6.5,
    inflationPercent: 4.6,
    policyRatePercent: 6.0,
    manufacturingPmi: 57.2,
    politicalStabilityScore: 6,
  },
  KR: {
    countryCode: 'KR',
    gdpGrowthPercent: 2.0,
    inflationPercent: 2.0,
    policyRatePercent: 2.75,
    manufacturingPmi: 49.3,
    politicalStabilityScore: 7,
  },
  AU: {
    countryCode: 'AU',
    gdpGrowthPercent: 2.0,
    inflationPercent: 3.1,
    policyRatePercent: 3.85,
    manufacturingPmi: 50.1,
    politicalStabilityScore: 8,
  },
  ZA: {
    countryCode: 'ZA',
    gdpGrowthPercent: 1.2,
    inflationPercent: 4.8,
    policyRatePercent: 7.5,
    manufacturingPmi: 48.5,
    politicalStabilityScore: 5,
  },
}
