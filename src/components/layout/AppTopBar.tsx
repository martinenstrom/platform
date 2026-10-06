import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Bell, Search } from 'lucide-react'
import type { CurrentOperator } from '~/application/analysis/currentOperator'
import { AdvisorPortrait } from '~/components/clients/AdvisorPortrait'
import { officeScope, updateDirectoryState } from '~/components/clients/directoryState'
import { cn } from '~/lib/cn'
import { inJarvisWorkspace } from '~/lib/navigation'
import {
  workspaceAdvisor,
  type AdvisorIdentity,
} from '~/presentation/advisory/advisorIdentity'

/**
 * The workspace bar: where the reader is, in the product's own words, and
 * the two things a terminal's chrome carries — a way to find a client and
 * who is at the desk. Shallow, quiet, never a page.
 *
 * **The breadcrumb is derived from the route**, not assembled by pages, so
 * every surface of the workspace reads the same hierarchy: JARVIS › KLIENTER
 * › CLIENT 360 › FÖRBERED MÖTE. The client search hands its words to the
 * relationship book — the same search the book carries — and opens it.
 *
 * **The identity.** The server-asserted operator the home page greets, from
 * the root loader, with the portrait the presentation holds for them. Inside
 * the JARVIS workspace, when no operator is configured, the bar names the
 * advisor whose book the workspace is read as (`advisorIdentity.ts`) — a
 * presentation default labelled as the advisor, never a login. Elsewhere,
 * with none configured, nobody is shown.
 *
 * **The bell is unlit and says so.** Nothing in the product produces
 * notifications yet; the bell stands in the chrome where one will, disabled
 * and titled "inga ännu", so it never implies a count it cannot have.
 *
 * **Huvudkontoret does not render this at all.** That page carries the firm's
 * identity and its destinations in its own institutional rail. The shell
 * decides; see `AppLayout`.
 */
export function AppTopBar() {
  /*
   * The resolved location, not the pending one: the crumb names the page
   * that is on screen, and a page whose loader is still reading stays
   * named until it arrives.
   */
  const pathname = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  })
  const operator = useRouterState({
    select: (state) => operatorOf(state.matches[0]?.loaderData),
  })
  /* The office the loaded page belongs to, as "id|label" so the selection stays a primitive. */
  const officeKey = useRouterState({
    select: (state) => officeOf(state.matches.map((match) => match.loaderData)),
  })
  const office = officeKey
    ? {
        id: officeKey.slice(0, officeKey.indexOf('|')),
        label: officeKey.slice(officeKey.indexOf('|') + 1),
      }
    : null
  const crumbs = breadcrumbs(pathname, office)
  const identity: Identity | null = operator
    ? {
        name: operator.displayName,
        role: operator.roleTitle,
        portrait: {
          advisorId: operator.employeeId,
          fullName: operator.displayName,
          roleTitle: operator.roleTitle,
          portraitUrl: null,
        },
        label: `Inloggad: ${operator.displayName}, ${operator.roleTitle}`,
      }
    : inJarvisWorkspace(pathname)
      ? workspaceIdentity()
      : null

  return (
    <header className="app-rail sticky top-0 z-30 border-b border-line bg-gradient-to-b from-[#060910]/55 to-[#060910]/30 backdrop-blur-[6px]">
      <div className="flex h-[52px] items-center gap-4 pl-4 pr-3">
        <nav aria-label="Var du är" className="min-w-0 flex-1">
          <ol className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
            {crumbs.map((crumb, index) => (
              <li key={`${index}-${crumb.label}`} className="flex items-center gap-2">
                {index > 0 && (
                  <span aria-hidden="true" className="type-machine text-content-subtle">
                    ›
                  </span>
                )}
                {crumb.to && index < crumbs.length - 1 ? (
                  <Link
                    to={crumb.to}
                    className={cn(
                      'type-machine text-[10.5px] tracking-[0.14em] uppercase transition-colors hover:text-content',
                      index === 0 && 'text-institution',
                    )}
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                    className={cn(
                      'type-machine text-[10.5px] tracking-[0.14em] uppercase',
                      index === crumbs.length - 1 ? 'text-content' : undefined,
                      index === 0 && crumbs.length === 1 && 'text-institution',
                    )}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <ClientSearch pathname={pathname} />
        <Clock />
        <Bell_ />
        {identity && <IdentityMark identity={identity} />}
      </div>
    </header>
  )
}

/* ------------------------------------------------------------ breadcrumb */

interface Crumb {
  label: string
  to?: string
}

/**
 * The hierarchy for a pathname, in the workspace's own words: JARVIS ›
 * KLIENTER › STRANDVÄGEN › CLIENT 360 › FÖRBERED MÖTE. The office is the
 * one the loaded page belongs to — an office book's own, or the client's —
 * so a direct link to a client reads the same as the way in through the
 * office.
 */
export function breadcrumbs(
  pathname: string,
  office: { id: string; label: string } | null = null,
): Crumb[] {
  const parts = pathname.split('/').filter(Boolean)
  const head = parts[0]
  if (head === 'clients') {
    const crumbs: Crumb[] = [
      { label: 'JARVIS', to: '/clients' },
      { label: 'Klienter', to: '/clients' },
    ]
    if (parts[1] === 'new') return [...crumbs, { label: 'Ny PB-klient' }]
    if (parts[1] === 'onboarding') return [...crumbs, { label: 'Onboarding' }]
    if (parts[1] === 'former') return [...crumbs, { label: 'Tidigare klienter' }]
    if (parts[1] === 'office' && parts[2] === 'new')
      return [...crumbs, { label: 'Nytt kontor' }]
    if (parts[1] === 'office') {
      crumbs.push({
        label: office?.label ?? parts[2] ?? 'Kontor',
        to: parts[2] ? `/clients/office/${parts[2]}` : undefined,
      })
      return crumbs
    }
    if (parts[1]) {
      if (office) crumbs.push({ label: office.label, to: `/clients/office/${office.id}` })
      crumbs.push({ label: 'Client 360', to: `/clients/${parts[1]}` })
    }
    if (parts[2] === 'meeting-prep') crumbs.push({ label: 'Förbered möte' })
    return crumbs
  }
  if (head === 'sentinel') {
    return [{ label: 'JARVIS', to: '/clients' }, { label: 'Sentinel' }]
  }
  if (head === 'market-impact') {
    return [{ label: 'JARVIS', to: '/clients' }, { label: 'Marknadspåverkan' }]
  }
  const NAMED: Record<string, string> = {
    evidence: 'Underlag',
    settings: 'Inställningar',
    setup: 'Kom igång',
    recovery: 'Återställning',
    watchlist: 'Bevakning',
    portfolio: 'Portfölj',
    reports: 'Rapporter',
    agents: 'Agenter',
    runs: 'Körningar',
    cases: 'Ärenden',
  }
  const label = head ? (NAMED[head] ?? head) : 'Kommandocentral'
  return [{ label }]
}

/* ------------------------------------------------------------ the office */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** "id|label" of the office the loaded page belongs to, from any route's data; '' when none. */
function officeOf(loaded: readonly unknown[]): string {
  for (const data of loaded) {
    if (!isRecord(data) || data.ok !== true) continue
    const book = isRecord(data.book) ? data.book : null
    const view = isRecord(data.view) ? data.view : null
    const cockpit = isRecord(data.cockpit) ? data.cockpit : null
    const identity = cockpit && isRecord(cockpit.identity) ? cockpit.identity : null
    const office = book?.office ?? view?.office ?? identity?.office
    if (
      isRecord(office) &&
      typeof office.id === 'string' &&
      typeof office.displayName === 'string'
    ) {
      return `${office.id}|${office.displayName}`
    }
  }
  return ''
}

/* ---------------------------------------------------------- client search */

const OFFICE_PATH = /^\/clients\/office\/([^/]+)$/

/**
 * The search in the bar: inside an office book it searches that office and
 * stays there; anywhere else it hands its words to the whole book and opens
 * it. The office book offers "Sök i alla klienter" beside its own search.
 */
function ClientSearch({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const officeId = OFFICE_PATH.exec(pathname)?.[1] ?? null
  function submit(event: FormEvent) {
    event.preventDefault()
    const words = query.trim()
    if (officeId) {
      updateDirectoryState(officeScope(officeId), { query: words, filter: 'all' })
      return
    }
    updateDirectoryState('all', { query: words, filter: 'all' })
    void navigate({ to: '/clients', search: { view: 'alla' } })
  }
  return (
    <form
      role="search"
      aria-label="Sök klient"
      onSubmit={submit}
      className="hidden items-center md:flex"
    >
      <label htmlFor="shell-client-search" className="sr-only">
        Sök klient
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-content-subtle"
          aria-hidden="true"
          strokeWidth={1.6}
        />
        <input
          id="shell-client-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            officeId ? 'Sök klient på kontoret…' : 'Sök klient, person, bolag…'
          }
          className="hq-field h-8 w-52 rounded-full py-1 pr-3 pl-8 text-[12px] lg:w-72 xl:w-80"
        />
      </div>
    </form>
  )
}

/* -------------------------------------------------------------- identity */

function operatorOf(loaderData: unknown): CurrentOperator | null {
  if (!loaderData || typeof loaderData !== 'object') return null
  const data = loaderData as { ok?: boolean; operator?: CurrentOperator }
  return data.ok && data.operator ? data.operator : null
}

interface Identity {
  name: string
  role: string
  portrait: AdvisorIdentity
  label: string
}

/** The workspace's advisor, as the bar shows them when no operator is configured. */
function workspaceIdentity(): Identity {
  const advisor = workspaceAdvisor()
  return {
    name: advisor.fullName,
    role: advisor.roleTitle,
    portrait: advisor,
    label: `Rådgivare: ${advisor.fullName}, ${advisor.roleTitle}`,
  }
}

/** Who is at the desk: the portrait in its frame and the name, the role beneath it. */
function IdentityMark({ identity }: { identity: Identity }) {
  return (
    <div
      className="flex items-center gap-2.5 border-l border-line pl-3.5"
      aria-label={identity.label}
    >
      <AdvisorPortrait identity={identity.portrait} size="sm" />
      <span className="hidden min-w-0 leading-tight lg:block">
        <span className="block truncate text-[12.5px] font-medium text-content">
          {identity.name}
        </span>
        <span className="block truncate text-[10.5px] text-content-subtle">
          {identity.role}
        </span>
      </span>
    </div>
  )
}

/** The bell: in the chrome, unlit, and honest about why. */
function Bell_() {
  return (
    <button
      type="button"
      disabled
      aria-label="Aviseringar"
      title="Aviseringar · inga ännu"
      className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-content-subtle sm:inline-flex"
    >
      <Bell className="h-[15px] w-[15px]" aria-hidden="true" strokeWidth={1.6} />
    </button>
  )
}

/* ----------------------------------------------------------------- clock */

/**
 * The wall clock.
 *
 * Client-only: `null` until mounted, so a server-rendered time cannot disagree
 * with the browser's and cause a hydration mismatch. It names its zone, because
 * a time on a trading floor that does not say which one is a number nobody can
 * act on.
 */
function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <span className="type-machine hidden shrink-0 text-content-muted sm:inline">
      {now
        ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${localZone()}`
        : ''}
    </span>
  )
}

/** The browser's own zone abbreviation, never a hardcoded market's. */
function localZone(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZoneName: 'short' }).formatToParts(
    new Date(),
  )
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}
