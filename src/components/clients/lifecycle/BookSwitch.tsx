import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'

export type BookView = 'kontor' | 'alla' | 'onboarding' | 'former'

/**
 * The books of the Client Intelligence workspace and the one restrained
 * door to add to them. AKTIVA KLIENTER opens on the office folders or on
 * every active relationship; ONBOARDING and TIDIGARE KLIENTER are books of
 * their own with their own routes, so each can be linked.
 */
export function BookSwitch({ current }: { current: BookView }) {
  return (
    <div className="flex flex-wrap items-center gap-2 self-start md:self-end md:mb-5">
      <nav aria-label="Vy" className="view-pill-group flex items-center">
        <Pill active={current === 'kontor'} to="/clients" search={{}}>
          Kontor
        </Pill>
        <Pill active={current === 'alla'} to="/clients" search={{ view: 'alla' }}>
          Alla klienter
        </Pill>
        <Pill active={current === 'onboarding'} to="/clients/onboarding">
          Onboarding
        </Pill>
        <Pill active={current === 'former'} to="/clients/former">
          Tidigare
        </Pill>
      </nav>
      <AddMenu />
    </div>
  )
}

function Pill({
  active,
  to,
  search,
  children,
}: {
  active: boolean
  to: '/clients' | '/clients/onboarding' | '/clients/former'
  search?: { view?: 'alla' }
  children: string
}) {
  return (
    <Link
      to={to}
      search={search as never}
      aria-current={active ? 'page' : undefined}
      className="view-pill"
    >
      {children}
    </Link>
  )
}

/** "+ Lägg till": a new relationship, or a new office. */
export function AddMenu() {
  const ref = useRef<HTMLDetailsElement>(null)
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
        className="jarvis-ghost-btn dossier-cta list-none px-3.5"
        aria-label="Lägg till"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        Lägg till
      </summary>
      <ul className="dossier-menu-list" role="menu">
        <li role="none">
          <Link to="/clients/new" role="menuitem" className="dossier-menu-item">
            Ny PB-klient
          </Link>
        </li>
        <li role="none">
          <Link to="/clients/office/new" role="menuitem" className="dossier-menu-item">
            Nytt kontor
          </Link>
        </li>
      </ul>
    </details>
  )
}
