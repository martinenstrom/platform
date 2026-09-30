import { useSyncExternalStore } from 'react'
import type { ClientFilter, ClientSort } from '~/presentation/advisory/directoryView'

/**
 * What a relationship book remembers while the advisor is elsewhere: the
 * search, the filter and the order — one memory per book. The whole book
 * (Alla klienter) and each office book keep their own, so that opening a
 * client from Strandvägen and pressing back finds Strandvägen as it was
 * left, and the whole book as it was left. The router restores the scroll
 * position; this restores the selection. Process-local and deliberately
 * not in the URL: a keystroke in the search box is not a navigation, and a
 * deep link to a book is a deep link to all of it (TD-113).
 */
export interface DirectoryState {
  query: string
  filter: ClientFilter
  sort: ClientSort
}

/** Which book: the whole one, or one office's. */
export type DirectoryScope = 'all' | `office:${string}`

export function officeScope(officeId: string): DirectoryScope {
  return `office:${officeId}`
}

export const INITIAL_DIRECTORY_STATE: DirectoryState = Object.freeze({
  query: '',
  filter: 'all',
  sort: 'priority',
})

let scopes: Readonly<Record<string, DirectoryState>> = {}
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function updateDirectoryState(
  scope: DirectoryScope,
  change: Partial<DirectoryState>,
): void {
  scopes = {
    ...scopes,
    [scope]: { ...(scopes[scope] ?? INITIAL_DIRECTORY_STATE), ...change },
  }
  for (const listener of listeners) listener()
}

/** Every book back to its initial state — for tests and for a "clear" control. */
export function resetDirectoryState(): void {
  scopes = {}
  for (const listener of listeners) listener()
}

export function useDirectoryState(scope: DirectoryScope): DirectoryState {
  return useSyncExternalStore(
    subscribe,
    () => scopes[scope] ?? INITIAL_DIRECTORY_STATE,
    () => INITIAL_DIRECTORY_STATE,
  )
}
