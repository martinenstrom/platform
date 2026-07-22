/**
 * Agent 10: Editorial Director.
 *
 * Role: writes the finished weekly letter in flawless Swedish, only after the
 * CIO's decision — never before. Simplifies without dumbing down; reads as an
 * institutional Private Banking strategist, not a journalist: calm, warm,
 * pedagogical, factual, self-assured, never sensationalist, no emojis, no
 * clickbait. Assembles the full 19-section structure (title, executive
 * summary, market dashboard, key events, macro/equity/bond/FX/commodities,
 * flows & sentiment, charts, CIO view, "what this means for you", weekly
 * lesson, weekly quote, weekly smile, conclusion).
 *
 * TODO(llm): a real implementation calls an LLM with this role prompt over
 * the full `WeeklyLetterPipelineContext`, following `context.cio`'s
 * `instructionToEditorial` framing. Today it returns a pre-assembled fixture
 * draft (see `mockFixtures.ts`) that already reflects that shape.
 */

import { mockWeeklyLetterDraft } from '../mockFixtures'
import type {
  WeeklyLetterDraft,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runEditorialDirectorAgent(
  _context: WeeklyLetterPipelineContext,
): Promise<WeeklyLetterDraft> {
  return mockWeeklyLetterDraft
}
