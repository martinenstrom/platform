/**
 * Domain types for the weekly Private Banking investment letter pipeline.
 *
 * Kept separate from `~/types` (the dashboard domain) because this models a
 * different product surface: an 11-agent institutional research pipeline that
 * produces one long-form document per week, not live portfolio/market state.
 *
 * The pipeline is a strict chain (see `services/investmentLetter/pipeline.ts`):
 *   News -> Flow -> Macro -> Equity -> Valuation -> Portfolio -> Quant ->
 *   Devil's Advocate -> CIO -> Editorial -> Compliance -> publish
 *
 * Every stage's output type below is what the next stage (and ultimately the
 * Editorial Director) reads. Nothing here talks to a network; see
 * `dataAdapters.ts` for the (unimplemented) real integration seams.
 */

export type Region = 'Globalt' | 'Sverige' | 'Europa' | 'USA' | 'Tillväxtmarknader'

export type UncertaintyLevel = 'låg' | 'medel' | 'hög'

export interface NewsItem {
  headline: string
  region: Region
  source: string
  date: string
  whatHappened: string
  whyItMatters: string
  marketImpact: string
  relevanceForLongTermInvestor: string
  uncertainty: UncertaintyLevel
}

/** Agent 1: News Intelligence Analyst. */
export interface NewsIntelligenceOutput {
  topGlobal: NewsItem[]
  sweden: NewsItem[]
  europe: NewsItem[]
  us: NewsItem[]
  emergingMarkets: NewsItem[]
  /** What matters this week vs. what is noise, in plain language. */
  signalVsNoise: string
}

export type RiskRegime = 'risk-on' | 'neutral' | 'risk-off'

/** Agent 2: Flow Intelligence Analyst. */
export interface FlowIntelligenceOutput {
  capitalInflows: string[]
  capitalOutflows: string[]
  riskRegime: RiskRegime
  positioningOverheated: boolean
  topInsiderBuys: string[]
  topInsiderSells: string[]
  optionsMarketSignals: string
  creditMarketSignals: string
  /** Do flows confirm or contradict the week's price action? */
  flowsConfirmPriceAction: boolean
  conclusion: string
}

export type RiskHorizon = '1 månad' | '3 månader' | '12 månader'

export interface MacroRegionAssessment {
  region: string
  assessment: string
}

export interface MacroRisk {
  horizon: RiskHorizon
  description: string
}

/** Agent 3: Global Macro Strategist. */
export interface GlobalMacroOutput {
  globalAssessment: string
  regional: MacroRegionAssessment[]
  centralBankAssessment: string
  inflationAssessment: string
  rateView: string
  creditMarketAssessment: string
  currencyAssessment: string
  risks: MacroRisk[]
}

export type MarketDriver = 'vinster' | 'räntor' | 'multipelexpansion'
export type ValuationView = 'billig' | 'rimlig' | 'dyr'

/** Agent 4: Equity Strategist. */
export interface EquityStrategistOutput {
  topMoves: string[]
  winningSectors: string[]
  losingSectors: string[]
  driver: MarketDriver
  marketValuationView: ValuationView
  risks: string[]
  opportunities: string[]
  longTermConclusion: string
}

/** Agent 5: Valuation Specialist. */
export interface ValuationSpecialistOutput {
  globalView: string
  usView: string
  europeView: string
  swedenView: string
  emergingMarketsView: string
  mostExpensiveSegments: string[]
  cheapestSegments: string[]
  whatIsNeededForContinuedUpside: string
  whatCouldPressureValuations: string
  conclusion: string
}

export type PortfolioEnvironment = 'risk-on' | 'neutral' | 'defensiv'
export type EquityStance = 'övervikt' | 'neutral' | 'undervikt'

/** Agent 6: Portfolio Strategist. Never issues individual/aggressive advice. */
export interface PortfolioStrategistOutput {
  environment: PortfolioEnvironment
  equityStance: EquityStance
  rateAndDurationView: string
  creditAttractiveness: string
  attractiveRegions: string[]
  sectorsToWatch: string[]
  underratedRisks: string[]
  /** What clients should do mentally, not necessarily transact. */
  mentalGuidance: string
}

export interface ChartSpec {
  id: string
  title: string
  period: string
  source: string
  /** Short comment shown under the chart. */
  commentary: string
  relevance: string
}

/** Agent 7: Quant & Data Scientist. A real run produces 10+ charts. */
export interface QuantOutput {
  charts: ChartSpec[]
}

/** Agent 8: Devil's Advocate. Only role is to stress-test the other agents' output. */
export interface DevilsAdvocateOutput {
  strongestCounterargument: string
  alternativeScenarios: string[]
  risksToMention: string[]
  balancingLanguageSuggestions: string[]
}

export interface Scenario {
  name: string
  probabilityPercent: number
  description: string
}

export type CioHorizon = '2 veckor' | '1 månad' | '3 månader' | '12 månader' | '10 år'

export interface HorizonImpact {
  horizon: CioHorizon
  impact: string
}

/** Agent 9: Chief Investment Officer. Reads only the specialists' summaries above. */
export interface CIOOutput {
  marketRegime: string
  mainScenario: Scenario
  alternativeScenarios: Scenario[]
  topRisks: string[]
  topOpportunities: string[]
  noise: string
  whatMattersNow: string
  horizonImpact: HorizonImpact[]
  investmentImplication: string
  /** Brief to the Editorial Director on how to frame the letter. */
  instructionToEditorial: string
}

export type DashboardSignal = 'positiv' | 'negativ' | 'neutral'

export interface DashboardRow {
  indicator: string
  level: string
  weeklyChange: string
  signal: DashboardSignal
  comment: string
}

export interface KeyEvent {
  region: Region
  bullet: string
}

export interface WeeklyQuote {
  author: string
  quote: string
}

/** Agent 10: Editorial Director. Writes only after the CIO decision. */
export interface WeeklyLetterDraft {
  title: string
  weekLabel: string
  date: string
  /** Max 5 bullets, readable in 60 seconds. */
  executiveSummary: string[]
  marketDashboard: DashboardRow[]
  keyEvents: KeyEvent[]
  macroSection: string
  equitySection: string
  bondSection: string
  fxSection: string
  commoditiesSection: string
  flowsAndSentimentSection: string
  charts: ChartSpec[]
  cioView: CIOOutput
  whatThisMeansForYou: string
  weeklyLesson: string
  weeklyQuote: WeeklyQuote
  weeklySmile: string
  /** Three things clients should remember. */
  conclusion: string[]
}

export interface ComplianceChecklistItem {
  label: string
  passed: boolean
}

/** Agent 11: Compliance & Risk Officer. Final gate — has the mandate to stop publication. */
export interface ComplianceReviewOutput {
  checklist: ComplianceChecklistItem[]
  approved: boolean
  disclaimer: string
  notes?: string
}

/** The published, compliance-approved letter. */
export interface WeeklyLetter extends WeeklyLetterDraft {
  compliance: ComplianceReviewOutput
  publishedAt: string
}

export type InvestmentLetterAgentId =
  | 'news-intelligence'
  | 'flow-intelligence'
  | 'global-macro'
  | 'equity-strategist'
  | 'valuation-specialist'
  | 'portfolio-strategist'
  | 'quant-data-scientist'
  | 'devils-advocate'
  | 'chief-investment-officer'
  | 'editorial-director'
  | 'compliance-risk-officer'

/** One row of the agent roster — condensed role metadata, not the full prompt. */
export interface InvestmentLetterAgentDefinition {
  id: InvestmentLetterAgentId
  name: string
  stage: number
  roleSummary: string
  watches: string[]
  outputSummary: string
}

/**
 * Accumulates as the pipeline runs. Each agent only reads the fields it needs
 * per the spec (e.g. the CIO reads specialist summaries, never `news`/`flows`
 * raw data directly) — a real implementation should keep to that discipline
 * even though TypeScript won't enforce it structurally.
 */
export interface WeeklyLetterPipelineContext {
  news?: NewsIntelligenceOutput
  flows?: FlowIntelligenceOutput
  macro?: GlobalMacroOutput
  equity?: EquityStrategistOutput
  valuation?: ValuationSpecialistOutput
  portfolio?: PortfolioStrategistOutput
  quant?: QuantOutput
  devilsAdvocate?: DevilsAdvocateOutput
  cio?: CIOOutput
  draft?: WeeklyLetterDraft
  compliance?: ComplianceReviewOutput
}
