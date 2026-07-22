/**
 * Agent 9: Chief Investment Officer.
 *
 * Role: final decision-maker. Reads only the specialists' summaries (macro,
 * equity, valuation, portfolio, quant, Devil's Advocate) — never raw news or
 * flow data directly. Thinks like a CIO responsible for several hundred
 * billion SEK: calm, disciplined, data-driven. Decides the main scenario,
 * alternative scenarios with probabilities, the top risks and opportunities,
 * what is noise, and the impact across 2 weeks / 1 / 3 / 12 months / 10 years.
 *
 * TODO(llm): a real implementation calls an LLM with this role prompt over
 * `context.macro`, `context.equity`, `context.valuation`, `context.portfolio`,
 * `context.quant` and `context.devilsAdvocate` — deliberately excluding
 * `context.news` and `context.flows`.
 */

import { mockCIO } from '../mockFixtures'
import type { CIOOutput, WeeklyLetterPipelineContext } from '~/types/investmentLetter'

export async function runChiefInvestmentOfficerAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<CIOOutput> {
  return mockCIO
}
