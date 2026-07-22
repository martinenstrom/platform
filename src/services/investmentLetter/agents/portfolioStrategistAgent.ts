/**
 * Agent 6: Portfolio Strategist.
 *
 * Role: translates the analysis above into portfolio implications for a
 * long-term, diversified portfolio — never individual advice, never
 * aggressive language ("buy more now"). Covers equity/rate weight, credit,
 * duration, region/sector weight, currency risk and alternatives. Reads
 * Equity Strategist and Valuation Specialist output.
 *
 * TODO(llm): a real implementation calls an LLM with this role prompt. No
 * external data adapter needed — this agent only reasons over prior stages'
 * output, it does not fetch new data.
 */

import { mockPortfolioStrategist } from '../mockFixtures'
import type {
  PortfolioStrategistOutput,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runPortfolioStrategistAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<PortfolioStrategistOutput> {
  return mockPortfolioStrategist
}
