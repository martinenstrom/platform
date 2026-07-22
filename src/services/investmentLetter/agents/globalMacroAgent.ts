/**
 * Agent 3: Global Macro Strategist.
 *
 * Role: analyzes the global macro picture — business cycle, inflation, rates,
 * central banks, currencies and liquidity — across Sweden, the Nordics,
 * Europe, the US, Japan, China, India, Brazil and other emerging markets.
 * For every data point, answers: what happened, why, what it means, and how
 * it affects rates/equities/bonds/currencies for a long-term investor. Reads
 * News and Flow Intelligence output.
 *
 * TODO(llm): a real implementation calls an LLM with this role prompt plus
 * live macro series from `dataAdapters.ts`'s macro data client (FRED,
 * Riksbanken, ECB, national statistics offices).
 */

import { mockGlobalMacro } from '../mockFixtures'
import type {
  GlobalMacroOutput,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runGlobalMacroAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<GlobalMacroOutput> {
  return mockGlobalMacro
}
