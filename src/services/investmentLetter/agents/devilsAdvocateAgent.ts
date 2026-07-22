/**
 * Agent 8: Devil's Advocate.
 *
 * Role: the only agent whose job is to argue against the team's conclusions —
 * not negativity for its own sake, but identifying weaknesses, blind spots
 * and alternative scenarios. Reads every specialist output produced so far
 * (news, flows, macro, equity, valuation, portfolio, quant) before the CIO
 * makes a final call.
 *
 * TODO(llm): a real implementation calls an LLM briefed on this adversarial
 * role over the accumulated `WeeklyLetterPipelineContext`.
 */

import { mockDevilsAdvocate } from '../mockFixtures'
import type {
  DevilsAdvocateOutput,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runDevilsAdvocateAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<DevilsAdvocateOutput> {
  return mockDevilsAdvocate
}
