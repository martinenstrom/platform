/**
 * Analysis agent service — the seam between the UI and the weekly Private
 * Banking letter pipeline. Mirrors `marketDataService.ts`'s shape exactly, as
 * anticipated by the README: briefs, uppslag and analyskörningar hör inte
 * till Avanza and get their own service with the same async-interface
 * pattern.
 *
 * Today every method returns local mock data (or runs the mock pipeline
 * stub chain, which itself only returns fixtures). Swapping in real agents
 * happens one stage at a time inside `investmentLetter/agents/*` and
 * `investmentLetter/dataAdapters.ts` — this file's public interface does not
 * need to change when that happens.
 */

import { INVESTMENT_LETTER_AGENTS } from './investmentLetter/agentRoster'
import { mockWeeklyLetter } from './investmentLetter/mockFixtures'
import { runWeeklyLetterPipeline } from './investmentLetter/pipeline'
import type {
  InvestmentLetterAgentDefinition,
  WeeklyLetter,
} from '~/types/investmentLetter'

export interface AnalysisAgentService {
  /** The 11-agent roster and their stage order. */
  getAgentRoster(): Promise<InvestmentLetterAgentDefinition[]>
  /** The latest published letter, without re-running the pipeline. */
  getWeeklyLetter(): Promise<WeeklyLetter>
  /** Runs the full News -> ... -> Compliance chain and returns the result. */
  runWeeklyLetterPipeline(): Promise<WeeklyLetter>
}

export const mockAnalysisAgentService: AnalysisAgentService = {
  getAgentRoster: async () => INVESTMENT_LETTER_AGENTS,
  getWeeklyLetter: async () => mockWeeklyLetter,
  runWeeklyLetterPipeline: async () => runWeeklyLetterPipeline(),
}

/**
 * Resolves the active service implementation.
 *
 * TODO(agents): return an LLM-backed service here once the agents in
 * `investmentLetter/agents/*` call a real model instead of returning
 * fixtures.
 */
export function getAnalysisAgentService(): AnalysisAgentService {
  return mockAnalysisAgentService
}

export const analysisAgentService = getAnalysisAgentService()
