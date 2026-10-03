/**
 * What the presence remembers between renders and reloads — and nothing more.
 *
 * `sessionStorage`, so the conversation survives a reload and dies with the
 * tab. This is transient browser continuity: whether the panel is open, the
 * turns exchanged so far, and the Financial OS reference the conversation is
 * bound to. It is not JARVIS's memory and it is not the firm's record. The
 * reference is a pointer; the truth it points at is re-read from the firm on
 * every question, never copied here.
 *
 * Same shape as `ActingAs`: an external store read through
 * `useSyncExternalStore`, with an in-memory copy so a browser that refuses
 * storage still has a working conversation for the life of the page.
 */

import { useSyncExternalStore } from 'react'
import type { DomainReference } from '~/application/analysis/domainSystem'
import type { HostResult } from '~/application/analysis/hostContract'
import type { JarvisAnswer } from '~/application/jarvis/answer'
import type { MarketCard } from '~/presentation/jarvis/marketCard'
import type { ResearchCard } from '~/presentation/jarvis/researchCard'
import type { Tone } from '~/types'

export interface PresenceTurn {
  id: string
  at: string
  by: 'user' | 'jarvis'
  text: string
  /** Further lines, already phrased. */
  detail?: string
  tone?: Tone
  /** The product state this turn reported, where it reported one. */
  state?: HostResult['state']
  /** Spoken rather than typed. One conversation either way. */
  via?: 'voice'
  /** A structured answer from the relationship record, rendered as its sections. */
  answer?: JarvisAnswer
  /** The compact card of a period market answer, rendered under the sentence. */
  card?: MarketCard
  /** The research strip of a researched answer: sources, freshness, support. */
  research?: ResearchCard
}

/**
 * The firm's deeper surfaces, opened beside the conversation on request.
 * `boardroom` is how the committee got there; `underlag` is the record.
 */
export type ContextualSurface = 'boardroom' | 'underlag'

export interface PresenceState {
  open: boolean
  /** The institutional work this conversation is bound to. A pointer, never a copy. */
  reference: DomainReference | null
  subject: string | null
  question: string | null
  turns: readonly PresenceTurn[]
  /** Which deeper surface stands open beside the conversation, if any. */
  surface: ContextualSurface | null
  /**
   * When the conversation last carried a market brief, ISO 8601. A pointer
   * handed back with the next line so a follow-up is answered over the same
   * numbers; the numbers themselves are re-read on the server, never kept here.
   */
  marketContextAt: string | null
  /**
   * What the last market answer was about and over which period, as the
   * server wrote it, handed back so "och i veckan?" continues it. Opaque
   * here: never read, never edited, only returned.
   */
  marketConversation: unknown | null
  /** The research conversation's subject, as the server wrote it; opaque here, only returned. */
  researchContext: unknown | null
}

export const EMPTY_PRESENCE: PresenceState = Object.freeze({
  open: false,
  reference: null,
  subject: null,
  question: null,
  turns: Object.freeze([]) as readonly PresenceTurn[],
  surface: null,
  marketContextAt: null,
  marketConversation: null,
  researchContext: null,
})

const KEY = 'jarvis:presence'
const listeners = new Set<() => void>()

let current: PresenceState | null = null

function load(): PresenceState {
  if (typeof window === 'undefined') return EMPTY_PRESENCE
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return EMPTY_PRESENCE
    const parsed = JSON.parse(raw) as Partial<PresenceState>
    /*
     * Every field is checked for shape, not just presence. The store is
     * mounted from the root, so a stale or hand-edited entry that put an
     * object where a sentence belongs would take the whole page down with
     * it — measured once, with a probe that seeded a typed subject.
     */
    return {
      open: parsed.open === true,
      reference: parsed.reference ?? null,
      subject: typeof parsed.subject === 'string' ? parsed.subject : null,
      question: typeof parsed.question === 'string' ? parsed.question : null,
      turns: Array.isArray(parsed.turns) ? parsed.turns : [],
      surface:
        parsed.surface === 'boardroom' || parsed.surface === 'underlag'
          ? parsed.surface
          : null,
      marketContextAt:
        typeof parsed.marketContextAt === 'string' ? parsed.marketContextAt : null,
      marketConversation:
        typeof parsed.marketConversation === 'object' &&
        parsed.marketConversation !== null
          ? parsed.marketConversation
          : null,
      researchContext:
        typeof parsed.researchContext === 'object' && parsed.researchContext !== null
          ? parsed.researchContext
          : null,
    }
  } catch {
    return EMPTY_PRESENCE
  }
}

function read(): PresenceState {
  if (current === null) current = load()
  return current
}

export function updatePresence(change: (state: PresenceState) => PresenceState): void {
  current = change(read())
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* Storage refused. The in-memory copy still carries the conversation. */
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The presence as remembered; `EMPTY_PRESENCE` on the server. */
export function usePresence(): PresenceState {
  return useSyncExternalStore(subscribe, read, () => EMPTY_PRESENCE)
}

/** Forgets everything. For a test's `beforeEach`, and for nothing in the product yet. */
export function resetPresence(): void {
  current = null
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to forget */
  }
  for (const listener of listeners) listener()
}
