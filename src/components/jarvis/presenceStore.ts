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
}

export interface PresenceState {
  open: boolean
  /** The institutional work this conversation is bound to. A pointer, never a copy. */
  reference: DomainReference | null
  subject: string | null
  question: string | null
  turns: readonly PresenceTurn[]
}

export const EMPTY_PRESENCE: PresenceState = Object.freeze({
  open: false,
  reference: null,
  subject: null,
  question: null,
  turns: Object.freeze([]) as readonly PresenceTurn[],
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
    return {
      open: parsed.open === true,
      reference: parsed.reference ?? null,
      subject: parsed.subject ?? null,
      question: parsed.question ?? null,
      turns: Array.isArray(parsed.turns) ? parsed.turns : [],
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
