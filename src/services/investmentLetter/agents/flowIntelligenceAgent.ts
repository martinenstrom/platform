/**
 * Agent 2: Flow Intelligence Analyst.
 *
 * Role: analyzes flows, positioning and market behavior — what capital is
 * actually doing, not just what the news says. Watches ETF/fund flows,
 * options flow and gamma exposure, dark pools, insider activity, 13F/EDGAR
 * filings, hedge fund and CTA positioning, retail sentiment, credit spreads,
 * VIX/MOVE and put/call ratios. Reads the News Intelligence output as
 * background context, not as its primary input.
 *
 * TODO(llm): a real implementation calls an LLM with this role prompt plus
 * live data from `dataAdapters.ts`'s flow/positioning data client.
 */

import { mockFlowIntelligence } from '../mockFixtures'
import type {
  FlowIntelligenceOutput,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runFlowIntelligenceAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<FlowIntelligenceOutput> {
  return mockFlowIntelligence
}
