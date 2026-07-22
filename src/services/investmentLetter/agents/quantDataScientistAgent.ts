/**
 * Agent 7: Quant & Data Scientist.
 *
 * Role: owns statistics, tables and charts — clean, correct, clearly
 * presented data. Produces 10+ minimalistic charts per week (indices, rates,
 * credit spreads, VIX/MOVE, commodities, FX, PMI, inflation, sector
 * performance), each with a title, period, source and a short investor-facing
 * comment. Runs independently of the narrative agents — it only needs raw
 * market series, not their conclusions.
 *
 * TODO(llm): a real implementation fetches live series from
 * `dataAdapters.ts`'s chart/market data client and generates `ChartSpec[]`,
 * optionally with an LLM writing the per-chart commentary.
 */

import { mockQuant } from '../mockFixtures'
import type { QuantOutput, WeeklyLetterPipelineContext } from '~/types/investmentLetter'

export async function runQuantDataScientistAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<QuantOutput> {
  return mockQuant
}
