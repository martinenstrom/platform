/**
 * Agent 1: News Intelligence Analyst.
 *
 * Role: the world's best information gatherer for financial markets. Collects,
 * filters and summarizes the week's most important news across Bloomberg/
 * Reuters/FT/WSJ/CNBC/MarketWatch/Barron's/The Economist, central banks (Fed,
 * ECB, Riksbanken, BoE, BIS, IMF, OECD, World Bank), macro data, earnings,
 * geopolitics and regulation. Does NOT draw final investment conclusions —
 * only identifies what actually matters vs. what is noise. First stage of the
 * pipeline; reads no prior context.
 *
 * TODO(llm): a real implementation calls an LLM with this role prompt plus
 * live articles from `dataAdapters.ts`'s news/macro data client, and returns
 * structured `NewsIntelligenceOutput`. Today this returns a fixed fixture.
 */

import { mockNewsIntelligence } from '../mockFixtures'
import type {
  NewsIntelligenceOutput,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runNewsIntelligenceAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<NewsIntelligenceOutput> {
  return mockNewsIntelligence
}
