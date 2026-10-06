import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { SystemStatus } from '~/infrastructure/platform/serverFns'

/**
 * One quiet line under the bar when the system has something to say about
 * itself: the last session did not end in order (the database was checked
 * at start and is whole), or the record is in Recovery Mode. Dismissed for
 * the session; never a modal, never a stack.
 */
export function SystemNotice() {
  const system = useRouterState({
    select: (state) => systemOf(state.matches[0]?.loaderData),
  })
  const [dismissed, setDismissed] = useState(true)
  const key = system ? `fos-notice:${system.database.openedAt ?? system.generatedAt}` : null
  useEffect(() => {
    if (!key) return
    try {
      setDismissed(sessionStorage.getItem(key) === '1')
    } catch {
      setDismissed(false)
    }
  }, [key])
  if (!system || dismissed) return null
  const unclean = system.database.state === 'OK' && system.database.uncleanShutdown
  const recovery = system.database.state === 'RECOVERY'
  if (!unclean && !recovery) return null
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-line bg-[#060910]/40 px-4 py-1.5 text-[12.5px] text-content-muted backdrop-blur-[4px]"
    >
      <span className="min-w-0 flex-1">
        {unclean
          ? 'Senaste sessionen avslutades inte i ordning. Databasen kontrollerades vid start och är hel.'
          : 'Databasen kunde inte öppnas. Återställningsläget är öppet.'}
      </span>
      <Link to={recovery ? '/recovery' : '/settings'} className="type-section text-institution">
        {recovery ? 'Återställning →' : 'Säkerhet & backup →'}
      </Link>
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
          try {
            if (key) sessionStorage.setItem(key, '1')
          } catch {
            /* a session that cannot remember shows the line again */
          }
        }}
        className="type-section text-content-subtle hover:text-content"
        aria-label="Dölj meddelandet"
      >
        Dölj
      </button>
    </div>
  )
}

function systemOf(loaderData: unknown): SystemStatus | null {
  if (!loaderData || typeof loaderData !== 'object') return null
  const data = loaderData as { system?: SystemStatus }
  return data.system ?? null
}
