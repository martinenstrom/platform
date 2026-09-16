/**
 * A typed line to JARVIS, checked field by field.
 *
 * The browser may send the text, an optional subject hint, the case pointer
 * the conversation is bound to, and the live session the line should also be
 * spoken in. Nothing else: an actor, an operator, a command, a model name —
 * refused by name, the way `parseHostRequest` and `parseLiveOpenRequest`
 * refuse them. The reference is a pointer the firm re-reads, never an
 * authority; the session id is the server's own, handed back to it.
 */

import type { DomainReference } from '~/application/analysis/domainSystem'
import { parseReference } from './liveOpen'

/** One earlier line of the conversation, as the presence shows it, so a follow-up has its context. */
export interface AskJarvisTurn {
  by: 'user' | 'jarvis'
  text: string
}

export interface AskJarvisRequest {
  text: string
  subject?: string
  reference?: DomainReference
  sessionId?: string
  /** The last few turns before this line, oldest first. Conversational data, never the record. */
  history?: AskJarvisTurn[]
}

const MAX_TEXT = 2_000
/** How much of the conversation travels with a line: enough for "varför?", not a transcript. */
export const MAX_HISTORY_TURNS = 12
export const MAX_HISTORY_TURN_CHARS = 600

function parseHistory(value: unknown): AskJarvisTurn[] | null {
  if (!Array.isArray(value)) return null
  const turns: AskJarvisTurn[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    if (entry.by !== 'user' && entry.by !== 'jarvis') return null
    if (typeof entry.text !== 'string') return null
    const text = entry.text.trim().slice(0, MAX_HISTORY_TURN_CHARS)
    if (text) turns.push({ by: entry.by, text })
  }
  return turns.slice(-MAX_HISTORY_TURNS)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseAskJarvisRequest(
  input: unknown,
): { ok: true; request: AskJarvisRequest } | { ok: false; field: string } {
  if (!isRecord(input)) return { ok: false, field: '' }
  for (const key of Object.keys(input)) {
    if (key !== 'text' && key !== 'subject' && key !== 'reference' && key !== 'sessionId' && key !== 'history')
      return { ok: false, field: key }
  }
  if (typeof input.text !== 'string' || input.text.trim().length === 0 || input.text.length > MAX_TEXT)
    return { ok: false, field: 'text' }
  if (input.subject !== undefined && typeof input.subject !== 'string') return { ok: false, field: 'subject' }
  if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || !input.sessionId))
    return { ok: false, field: 'sessionId' }
  let reference: DomainReference | undefined
  if (input.reference !== undefined) {
    const parsed = parseReference(input.reference)
    if (!parsed) return { ok: false, field: 'reference' }
    reference = parsed
  }
  let history: AskJarvisTurn[] | undefined
  if (input.history !== undefined) {
    const parsed = parseHistory(input.history)
    if (!parsed) return { ok: false, field: 'history' }
    if (parsed.length > 0) history = parsed
  }
  const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
  return {
    ok: true,
    request: {
      text: input.text.trim(),
      ...(subject ? { subject } : {}),
      ...(reference ? { reference } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(history ? { history } : {}),
    },
  }
}
