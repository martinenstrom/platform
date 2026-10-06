import { ChevronDown } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { LifecycleStatus } from '~/domain/advisory'
import type { LifecycleAct } from './lifecycleActions'

const ACTIVE_ACTS: readonly { act: LifecycleAct; label: string; grave?: boolean }[] = [
  { act: 'edit', label: 'Redigera relation' },
  { act: 'move', label: 'Flytta till annat kontor' },
  { act: 'advisor', label: 'Ändra ansvarig rådgivare' },
  { act: 'close', label: 'Avsluta PB-relation', grave: true },
]

const FORMER_ACTS: readonly { act: LifecycleAct; label: string }[] = [
  { act: 'reactivate', label: 'Återaktivera PB-relation' },
]

const ONBOARDING_ACTS: readonly { act: LifecycleAct; label: string; grave?: boolean }[] =
  [{ act: 'activate', label: 'Aktivera PB-relation' }, ...ACTIVE_ACTS]

/**
 * The restrained overflow on the cover: "Fler åtgärder", and beneath it
 * the administration of the relationship — edit, move, hand over, close;
 * for a former client, reactivate. Never on the cover itself, never
 * beside the meeting door; one quiet menu.
 */
export function ClientActionsMenu({
  status,
  onChoose,
}: {
  status: LifecycleStatus
  onChoose: (act: LifecycleAct) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const acts =
    status === 'former'
      ? FORMER_ACTS
      : status === 'onboarding'
        ? ONBOARDING_ACTS
        : ACTIVE_ACTS
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <details ref={ref} className="dossier-menu relative">
      <summary
        role="button"
        className="jarvis-ghost-btn dossier-cta list-none"
        aria-label="Fler åtgärder"
      >
        Fler åtgärder
        <ChevronDown className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
      </summary>
      <ul className="dossier-menu-list" role="menu">
        {acts.map((item) => (
          <li key={item.act} role="none">
            <button
              type="button"
              role="menuitem"
              className={
                'grave' in item && item.grave
                  ? 'dossier-menu-item is-grave'
                  : 'dossier-menu-item'
              }
              onClick={() => {
                if (ref.current) ref.current.open = false
                onChoose(item.act)
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
