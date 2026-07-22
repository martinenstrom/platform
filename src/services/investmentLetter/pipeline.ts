/**
 * Chains the 11 agents in the exact order the spec requires:
 *
 *   News -> Flow -> Macro -> Equity -> Valuation -> Portfolio -> Quant ->
 *   Devil's Advocate -> CIO -> Editorial -> Compliance -> publish
 *
 * Each stage only needs the previous stages' output, threaded through one
 * accumulating `WeeklyLetterPipelineContext`. Every agent can also be run in
 * isolation by importing it directly from `./agents/*` — the pipeline itself
 * adds nothing but ordering and the compliance gate.
 */

import { runChiefInvestmentOfficerAgent } from './agents/chiefInvestmentOfficerAgent'
import { runComplianceRiskOfficerAgent } from './agents/complianceRiskOfficerAgent'
import { runDevilsAdvocateAgent } from './agents/devilsAdvocateAgent'
import { runEditorialDirectorAgent } from './agents/editorialDirectorAgent'
import { runEquityStrategistAgent } from './agents/equityStrategistAgent'
import { runFlowIntelligenceAgent } from './agents/flowIntelligenceAgent'
import { runGlobalMacroAgent } from './agents/globalMacroAgent'
import { runNewsIntelligenceAgent } from './agents/newsIntelligenceAgent'
import { runPortfolioStrategistAgent } from './agents/portfolioStrategistAgent'
import { runQuantDataScientistAgent } from './agents/quantDataScientistAgent'
import { runValuationSpecialistAgent } from './agents/valuationSpecialistAgent'
import type { WeeklyLetter, WeeklyLetterPipelineContext } from '~/types/investmentLetter'

export class ComplianceRejectionError extends Error {
  constructor(public readonly context: WeeklyLetterPipelineContext) {
    super(
      'Compliance & Risk Officer stoppade publiceringen — se context.compliance.checklist för underkända punkter.',
    )
    this.name = 'ComplianceRejectionError'
  }
}

/**
 * Runs the full pipeline and returns the published `WeeklyLetter`.
 *
 * Throws `ComplianceRejectionError` if the Compliance & Risk Officer does not
 * approve the draft — the letter must never be published in that case (spec
 * §19: "Rapporten får inte publiceras om någon punkt är 'Nej'").
 */
export async function runWeeklyLetterPipeline(): Promise<WeeklyLetter> {
  const context: WeeklyLetterPipelineContext = {}

  context.news = await runNewsIntelligenceAgent(context)
  context.flows = await runFlowIntelligenceAgent(context)
  context.macro = await runGlobalMacroAgent(context)
  context.equity = await runEquityStrategistAgent(context)
  context.valuation = await runValuationSpecialistAgent(context)
  context.portfolio = await runPortfolioStrategistAgent(context)
  context.quant = await runQuantDataScientistAgent(context)
  context.devilsAdvocate = await runDevilsAdvocateAgent(context)
  context.cio = await runChiefInvestmentOfficerAgent(context)
  context.draft = await runEditorialDirectorAgent(context)
  context.compliance = await runComplianceRiskOfficerAgent(context)

  if (!context.compliance.approved) {
    throw new ComplianceRejectionError(context)
  }

  return {
    ...context.draft,
    compliance: context.compliance,
    publishedAt: new Date().toISOString(),
  }
}
