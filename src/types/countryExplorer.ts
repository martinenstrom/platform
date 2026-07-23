/**
 * Domain types for the Global Markets Country Explorer (the globe + country
 * analysis dashboard on the Overview page). Transport-agnostic, same
 * convention as `~/types`: the service/adapter layer maps upstream payloads
 * into these shapes, components only ever see this module.
 */

export type MarketClassification = 'developed' | 'emerging' | 'frontier'

/**
 * Deliberately a plain string, not a closed union: the globe is clickable
 * across all ~177 countries in the topojson dataset (see registry.ts's
 * `resolveCountry`), most of which have no curated registry entry and so
 * need a region label synthesized on the fly.
 */
export type Region = string

/** One row in the globe/search index — every country the globe can resolve a click to. */
export interface CountryRegistryEntry {
  countryCode: string
  nameSv: string
  nameEn: string
  /** Property value to match against the topojson feature's `properties.name` — only differs from nameEn when the dataset uses a different label (e.g. "United States of America"). */
  geoName: string
  region: Region
  marketClassification: MarketClassification
  flagEmoji: string
  /** Camera fly-to target. */
  lat: number
  lng: number
  /** Whether full `CountryMacroData` exists for this country (see registry.ts). */
  hasFullData: boolean
}

export type TrendDirection = 'up' | 'down' | 'flat'

/** Whether a change in this indicator reads as good, bad, or context-dependent news — decided per indicator, never inferred from the sign of the change alone. */
export type IndicatorTone = 'positive' | 'negative' | 'neutral'

export interface MacroIndicator {
  id: string
  label: string
  value: string
  previousValue: string
  change: string
  trend: TrendDirection
  tone: IndicatorTone
  period: string
  source: string
  /** Short illustrative trend series ending near `value` — mock, not a real historical series. */
  sparkline?: number[]
}

export type NewsCategory =
  | 'macro'
  | 'central-bank'
  | 'politics'
  | 'regulation'
  | 'markets'
  | 'companies'
  | 'geopolitics'

export type NewsImportance = 'critical' | 'high' | 'medium' | 'low'

export type NewsSentiment = 'positive' | 'negative' | 'neutral' | 'mixed'

export interface CountryNewsItem {
  id: string
  countryCode: string
  headline: string
  summary: string
  category: NewsCategory
  publishedAt: string
  source: string
  sourceUrl?: string
  importance: NewsImportance
  expectedMarketImpact: string
  sentiment: NewsSentiment
  affectedAssets: string[]
  affectedSectors: string[]
  /** false = analyst interpretation / market expectation / unverified report, not a confirmed fact. */
  isConfirmed: boolean
}

export interface CountryNewsSynthesis {
  countryCode: string
  dominantNarrative: string
  overallNewsSentiment: NewsSentiment
  investorImplications: string
  sectorsLikelyToBenefit: string[]
  sectorsFacingRisks: string[]
  indicatorsToMonitor: string[]
  generatedAt: string
  sourceNewsIds: string[]
}

export interface MarketOverviewData {
  primaryIndexName: string
  primaryIndexValue: string
  indexChangeToday: string
  indexChange1M: string
  indexChangeYtd: string
  indexChange12M: string
  peRatio: string
  forwardPeRatio: string
  dividendYield: string
  marketCap: string
  avgDailyVolume: string
  foreignOwnership?: string
  volatility: string
  currencyPerformance: string
  creditSpread?: string
}

export type AnalystConsensus = 'Köp' | 'Behåll' | 'Sälj'

export interface TopCompany {
  name: string
  ticker: string
  sector: string
  marketCap: string
  ytdPerformance: string
  peRatio: string
  dividendYield: string
  analystConsensus: AnalystConsensus
}

export interface SectorWeight {
  sector: string
  domesticWeightPercent: number
  globalIndexWeightPercent: number
}

export interface InvestmentStrength {
  heading: string
  analysis: string
  suitableFor: string
  relevantSectors: string[]
}

export interface InvestmentRisk {
  heading: string
  analysis: string
  probableMarketImpact: string
  monitor: string[]
}

export interface CountryScores {
  macro: number
  valuation: number
  earningsMomentum: number
  politicalStability: number
  currencyRisk: number
  marketLiquidity: number
  structuralGrowth: number
  cycleSensitivity: number
  newsFlow: number
  overall: number
  classification: 'attractive' | 'neutral' | 'cautious' | 'high-risk'
  cioConclusion: string
}

export interface CountryTrigger {
  direction: 'positive' | 'negative'
  label: string
}

export interface CountryMacroData {
  countryCode: string
  countryName: string
  region: Region
  marketClassification: MarketClassification
  lastUpdated: string
  /** True for the lighter "basic info" tier — UI shows a clear "more coming later" notice. */
  isPartial: boolean
  macro: MacroIndicator[]
  news: CountryNewsItem[]
  newsSynthesis: CountryNewsSynthesis | null
  markets: MarketOverviewData | null
  sectors: SectorWeight[]
  sectorAnalysis: string | null
  topCompanies: TopCompany[]
  investmentStrengths: InvestmentStrength[]
  investmentRisks: InvestmentRisk[]
  scores: CountryScores | null
  triggers: CountryTrigger[]
  /** Every source cited across this record — shown as a consolidated data-source footer. */
  sources: string[]
}

/** State machine for the Country Explorer panel — replaces route navigation entirely. */
export type CountryExplorerView =
  | { mode: 'globe' }
  | { mode: 'loading-country'; countryCode: string }
  | { mode: 'country-analysis'; countryCode: string }
  | { mode: 'country-error'; countryCode: string; error: string }

export type NewsFilter = 'all' | NewsCategory
export type NewsSort = 'recent' | 'importance' | 'impact'

/**
 * Lightweight headline macro figures for the Global Command Center's
 * heatmap layers — deliberately just five numbers, not a full
 * `CountryMacroData` fixture. Covers every country in the registry (not
 * only the four full-tier ones) so a heatmap layer never looks broken/empty;
 * see `data/countryExplorer/globalHeadlineMacro.ts` for sourcing.
 */
export interface CountryHeadlineMacro {
  countryCode: string
  gdpGrowthPercent: number
  inflationPercent: number
  policyRatePercent: number
  manufacturingPmi: number
  /** 0-10, same convention as `CountryScores.politicalStability`. */
  politicalStabilityScore: number
}

export type HeatmapLayerId =
  'gdp-growth' | 'inflation' | 'policy-rate' | 'manufacturing-pmi' | 'political-stability'
