/**
 * "What happened with the client?" — the advisor's note becomes a candidate.
 *
 * The note is kept exactly as written and JARVIS proposes what it understood
 * beside it. Nothing here touches the relationship record: a candidate is
 * not a fact, and it stays a candidate until `confirmClientUpdate` carries
 * the items the advisor confirmed across the boundary.
 *
 * The advisor recording the note is the client's primary advisor in Phase 1:
 * there is no authenticated session, and the product does not invent one.
 */

import {
  extractFromNote,
  isIsoDate,
  type Importance,
  type InteractionSource,
  type InteractionType,
  type MemoryCandidate,
} from '~/domain/advisory'
import { todayOf, type AdvisoryContext } from './ports'

export interface RecordClientUpdateInput {
  clientId: string
  noteText: string
  /** ISO date the interaction happened. Defaults to today. */
  interactionDate?: string
  /** Overrides what the note suggests, where the advisor said so. */
  interactionType?: InteractionType | null
  source?: InteractionSource
  importance?: Importance
}

export type RecordClientUpdateResult =
  | { ok: true; candidate: MemoryCandidate }
  | { ok: false; code: 'NOT_FOUND' | 'EMPTY_NOTE' | 'INVALID_DATE' }

export async function recordClientUpdate(
  context: AdvisoryContext,
  input: RecordClientUpdateInput,
): Promise<RecordClientUpdateResult> {
  const noteText = input.noteText.trim()
  if (noteText.length === 0) return { ok: false, code: 'EMPTY_NOTE' }
  const interactionDate = input.interactionDate ?? todayOf(context)
  if (!isIsoDate(interactionDate)) return { ok: false, code: 'INVALID_DATE' }

  const client = await context.repositories.clients.byId(input.clientId)
  if (!client) return { ok: false, code: 'NOT_FOUND' }

  const extraction = extractFromNote({ text: noteText, interactionDate })
  const interactionType = input.interactionType ?? extraction.interactionType
  const items = extraction.items.map((item) =>
    item.kind === 'interaction' ? { ...item, interactionType } : item,
  )

  const candidate: MemoryCandidate = {
    id: await context.repositories.ids.mint('candidate'),
    clientId: client.id,
    advisorId: client.primaryAdvisorId,
    noteText,
    interactionDate,
    interactionType,
    source: input.source ?? 'advisor',
    importance: input.importance ?? 'normal',
    items,
    status: 'pending',
    createdAt: context.clock.isoNow(),
    resolvedAt: null,
    interactionId: null,
  }
  await context.repositories.interactions.saveCandidate(candidate)
  return { ok: true, candidate }
}
