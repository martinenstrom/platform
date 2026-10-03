/**
 * The advisory tier of the one router: a typed line, answered from the
 * relationship record when the advisor's workspace makes it the record's
 * to answer — before any model, and without one.
 *
 * Order of precedence, as ruled: a named instrument's state stays the
 * market's fast path; then the workspace decides. On a client, an office,
 * the book, Sentinel or Marknadspåverkan, the line is read against that
 * subject and answered from the evidence services. A line the record
 * cannot answer here — a capital question, a market overview — goes on to
 * the router unchanged.
 */

import type { AdvisoryContext } from '~/application/advisory/ports'
import { answerAdvisoryLine } from './advisoryAnswer'
import type { JarvisAnswer } from './answer'
import type { AskJarvisRequest } from './askJarvis'
import { resolveJarvisContext, type JarvisContext } from './context'
import { recognizeMarketQuery } from './marketQuery'
import { recognizeResearchQuery } from './research/researchQuery'

export interface AdvisoryTurnResult {
  advisory: JarvisAnswer
  context: JarvisContext
}

/** "Varför?", "Vad betyder det?": a continuation of whatever answered last. */
export const BARE_WHY =
  /^(?:varför|why|hur kommer det sig|vad betyder det|förklara)\W*$/iu

export async function advisoryTurn(
  request: AskJarvisRequest,
  advisory: () => Promise<AdvisoryContext>,
): Promise<AdvisoryTurnResult | null> {
  if (!request.context) return null
  const jarvis = resolveJarvisContext(request.context.route)
  /* A clearly named instrument, a region, a period in a market conversation: the market's, wherever the advisor is. */
  if (
    recognizeMarketQuery(request.text, {
      scope: jarvis.scope,
      conversation: request.marketContext?.conversation ?? null,
    })
  )
    return null
  /*
   * Why the market moved, what a central bank said, what a company reported:
   * research, wherever the advisor is — except a bare "varför?" right after
   * the record answered, which continues the record's answer.
   */
  if (
    !(BARE_WHY.test(request.text) && request.previous) &&
    recognizeResearchQuery(request.text, {
      scope: jarvis.scope,
      market: request.marketContext?.conversation ?? null,
      research: request.marketContext?.research ?? null,
    })
  )
    return null
  const context = await advisory()
  const turn = await answerAdvisoryLine(
    context,
    jarvis,
    request.text,
    request.previous ?? null,
  )
  return turn ? { advisory: turn.answer, context: turn.context } : null
}
