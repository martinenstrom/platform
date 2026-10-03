/**
 * The record's answer to a spoken or typed line, from the one router, in
 * both modalities at once: the structured JarvisAnswer the presence renders
 * with its evidence, and the spoken sentences the voice reads. Used by the
 * live session's workspace tool, by a typed line while a session is live,
 * and by the simulated microphone — one brain, two renderers.
 */

import type { AdvisoryContext } from '~/application/advisory/ports'
import { answerAdvisoryLine } from '~/application/jarvis/advisoryAnswer'
import type { JarvisAnswer } from '~/application/jarvis/answer'
import { resolveJarvisContext, type JarvisContext } from '~/application/jarvis/context'
import {
  recognizeMarketQuery,
  type MarketConversation,
} from '~/application/jarvis/marketQuery'
import { contextLabel, type ContextNames } from '~/presentation/jarvis/contextText'
import {
  spokenAnswerOf,
  type JarvisSpokenAnswer,
} from '~/presentation/jarvis/spokenAnswer'

export interface WorkspaceTurnInput {
  text: string
  /** The route the browser last reported; null when the session opened without one. */
  route: string | null
  /** The record's last answer in this conversation, for a continuation. */
  previous: JarvisAnswer | null
  /** The market conversation so far, so "och i veckan?" is the market's and not the record's. */
  marketConversation?: MarketConversation | null
}

export interface WorkspaceTurnResult {
  answer: JarvisAnswer
  spoken: JarvisSpokenAnswer
  context: JarvisContext
}

/**
 * The advisory tier for a line with a route: null when the line is the
 * market's fast path or not the record's to answer, so the caller lets the
 * model have it.
 */
export async function workspaceTurn(
  advisory: () => Promise<AdvisoryContext>,
  input: WorkspaceTurnInput,
): Promise<WorkspaceTurnResult | null> {
  const text = input.text.trim()
  if (!text) return null
  const jarvis = resolveJarvisContext(input.route ?? '/')
  if (
    recognizeMarketQuery(text, {
      scope: jarvis.scope,
      conversation: input.marketConversation ?? null,
    })
  )
    return null
  const context = await advisory()
  const turn = await answerAdvisoryLine(context, jarvis, text, input.previous)
  if (!turn) return null
  return {
    answer: turn.answer,
    spoken: spokenAnswerOf(turn.answer),
    context: turn.context,
  }
}

/**
 * The workspace's name for the voice — "Anna & Per Dahlqvist · Möte 2 okt",
 * "Strandvägen", "Klienter" — resolved from the route and the record, never
 * from anything the browser sent beside the route.
 */
export async function workspaceLabel(
  advisory: () => Promise<AdvisoryContext>,
  route: string | null,
): Promise<string | null> {
  if (!route) return null
  const jarvis = resolveJarvisContext(route)
  if (jarvis.scope === 'GLOBAL' || jarvis.scope === 'MARKET') return null
  const context = await advisory()
  const names: ContextNames = {}
  if (jarvis.clientId) {
    const client = await context.repositories.clients.byId(jarvis.clientId)
    if (client) names.clientName = client.displayName
    if (jarvis.scope === 'MEETING') {
      const events = await context.repositories.events.eventsOf(jarvis.clientId)
      const today = context.clock.isoNow().slice(0, 10)
      const meeting = events
        .filter(
          (e) =>
            e.type === 'client-meeting' && e.status === 'upcoming' && e.date >= today,
        )
        .sort((a, b) => a.date.localeCompare(b.date))[0]
      if (meeting) names.meetingDate = meeting.date
    }
  }
  if (jarvis.officeId) {
    const office = await context.repositories.clients.officeById(jarvis.officeId)
    if (office) names.officeName = office.displayName
  }
  return contextLabel(jarvis, names)
}
