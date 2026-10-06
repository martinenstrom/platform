import { useRouterState } from '@tanstack/react-router'
import type { SystemStatus } from '~/infrastructure/platform/serverFns'

/**
 * What a book's foot calls the record it was derived from: the synthetic
 * demonstration, or the person's own local register. Read from the
 * system status the root route loaded; where a surface stands without
 * it — a test rendering the component alone — the demonstration is
 * assumed, which is what it is there.
 */
export function useRecordLabel(): string {
  const store = useRouterState({
    select: (state) => {
      const data = state.matches[0]?.loaderData as { system?: SystemStatus } | undefined
      return data?.system?.store ?? null
    },
  })
  return store === 'sqlite' ? 'lokalt register' : 'syntetiska klienter'
}
