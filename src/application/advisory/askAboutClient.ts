/**
 * "Ask JARVIS about this client" — answered from the relationship's own
 * structured memory, deterministically, in Phase 1.
 *
 * The answer is a set of dated records, never a sentence nobody wrote. A
 * semantic or vector search later replaces the classifier and the ranking
 * behind the same `MemoryAnswer` shape; this door does not change.
 */

import { searchClientMemory, type MemoryAnswer } from '~/domain/advisory'
import { todayOf, type AdvisoryContext } from './ports'

export interface AskAboutClientInput {
  clientId: string
  question: string
}

export type AskAboutClientResult =
  | { ok: true; answer: MemoryAnswer; askedAt: string }
  | { ok: false; code: 'NOT_FOUND' | 'EMPTY_QUESTION' }

export async function askAboutClient(
  context: AdvisoryContext,
  input: AskAboutClientInput,
): Promise<AskAboutClientResult> {
  const question = input.question.trim()
  if (question.length === 0) return { ok: false, code: 'EMPTY_QUESTION' }
  const { repositories } = context
  const client = await repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }

  const [interactions, contextFacts, commitments, events, goals, portfolio, liabilities] =
    await Promise.all([
      repositories.interactions.interactionsOf(client.id),
      repositories.context.factsOf(client.id),
      repositories.commitments.commitmentsOf(client.id),
      repositories.events.eventsOf(client.id),
      repositories.goals.goalsOf(client.id),
      repositories.portfolios.portfolioOf(client.id),
      repositories.wealth.liabilitiesOf(client.id),
    ])

  const answer = searchClientMemory(question, {
    interactions,
    contextFacts,
    commitments,
    events,
    goals,
    holdings: portfolio?.holdings ?? [],
    liabilities,
    today: todayOf(context),
  })
  return { ok: true, answer, askedAt: context.clock.isoNow() }
}
