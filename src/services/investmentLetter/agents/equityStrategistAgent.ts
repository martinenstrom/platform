/**
 * Agent 4: Equity Strategist.
 *
 * Role: analyzes the equity market — what drives stocks, sectors, regions,
 * earnings expectations and valuations across US/Europe/Sweden/Japan/China/
 * India/EM, style factors (growth/value/quality/momentum) and sectors
 * (tech/AI, banks, industrials, healthcare, energy, commodities, consumer,
 * real estate, defense, cybersecurity). Reads Global Macro output.
 *
 * TODO(llm): a real implementation calls an LLM with this role prompt plus
 * live index/sector/earnings data from `dataAdapters.ts`'s market data client.
 */

import { mockEquityStrategist } from '../mockFixtures'
import type {
  EquityStrategistOutput,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runEquityStrategistAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<EquityStrategistOutput> {
  return mockEquityStrategist
}
