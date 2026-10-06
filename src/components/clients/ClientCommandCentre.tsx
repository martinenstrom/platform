import { Link } from '@tanstack/react-router'
import { CalendarDays, Landmark, TrendingUp, type LucideIcon } from 'lucide-react'
import type { ClientDirectory } from '~/application/advisory/clientDirectory'
import { cn } from '~/lib/cn'
import {
  workspaceAdvisor,
  type AdvisorIdentity,
} from '~/presentation/advisory/advisorIdentity'
import { formatMsek } from '~/presentation/advisory/format'
import { AdvisorPortrait } from './AdvisorPortrait'
import { BookSwitch } from './lifecycle/BookSwitch'
import { ClientBook } from './ClientBook'
import { OfficeFolder } from './OfficeFolder'

export type DirectoryViewMode = 'kontor' | 'alla'

/**
 * The relationship book: the advisor whose book it is, the whole Private
 * Banking book in one strip of figures, then the book office by office —
 * one tile per office the advisor answers for — or, on request, every
 * relationship at once. The office view is the advisor's way in; the whole
 * book is for the search that does not know the office. The room behind it
 * is the shell's, and the hero stands in it rather than in a panel.
 *
 * The view is in the URL (`?view=alla`) so a book can be linked; the
 * search, the filter and the order of each book live in `directoryState`,
 * outside the page, so coming back from a client finds the book as it was
 * left.
 */
export function ClientCommandCentre({
  directory,
  view = 'kontor',
  advisor = workspaceAdvisor(),
}: {
  directory: ClientDirectory
  view?: DirectoryViewMode
  /** Whose book this is, as the hero names them. */
  advisor?: AdvisorIdentity
}) {
  const { metrics, rows, offices } = directory
  const bankShare =
    metrics.estimatedWealth > 0
      ? Math.round((metrics.totalAum / metrics.estimatedWealth) * 100)
      : 0
  const highPriority = rows.filter(
    (row) => row.flags.needsAttention && row.highPrioritySignals > 0,
  ).length

  const figures: {
    label: string
    value: string
    note?: string
    icon?: LucideIcon
    tone?: 'warning' | 'negative'
    dot?: boolean
  }[] = [
    {
      label: 'AUM',
      value: formatMsek(metrics.totalAum),
      note: `${bankShare} % av förmögenheten`,
      icon: Landmark,
    },
    {
      label: 'Total förmögenhet',
      value: formatMsek(metrics.estimatedWealth),
      note: offices.length === 1 ? '1 kontor' : `${offices.length} kontor`,
    },
    {
      label: 'Klienter',
      value: String(metrics.totalClients),
      note: `${metrics.activeOpportunities} aktiva möjligheter`,
      icon: TrendingUp,
    },
    {
      label: 'Behöver uppmärksamhet',
      value: String(metrics.needingAttention),
      note:
        metrics.needingAttention === 0 ? 'inga just nu' : `${highPriority} hög prioritet`,
      tone: metrics.needingAttention > 0 ? 'warning' : undefined,
      dot: metrics.needingAttention > 0,
    },
    {
      label: 'Möten',
      value: String(metrics.upcomingMeetings),
      note: 'inom 30 dagar',
      icon: CalendarDays,
    },
    {
      label: 'Åtaganden',
      value: String(metrics.openCommitments),
      note:
        metrics.overdueCommitments > 0
          ? `${metrics.overdueCommitments} försenade`
          : 'inga försenade',
      tone: metrics.overdueCommitments > 0 ? 'negative' : undefined,
      dot: metrics.overdueCommitments > 0,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* The hero stands in the room, not in a panel: the environment is behind it. */}
      <header className="flex flex-col gap-5 px-1 pt-3 pb-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-6 lg:gap-9">
          <AdvisorPortrait identity={advisor} size="lg" />
          <div className="min-w-0">
            <p className="type-section text-institution">Client Intelligence</p>
            <h1 className="type-display-name mt-1.5 text-[54px] leading-none">
              Klienter
            </h1>
            <p className="mt-2 max-w-[21rem] font-display text-[15px] leading-snug text-content-muted">
              Dina private banking-relationer, prioriteringar och möjligheter — kontor för
              kontor.
            </p>
            <p className="mt-3.5 font-display text-[15px] font-semibold leading-tight text-content">
              {advisor.fullName}
              <span className="mt-0.5 block text-[13px] font-normal text-content-muted">
                {advisor.roleTitle}
              </span>
            </p>
          </div>
        </div>
        <BookSwitch current={view} />
      </header>

      <section aria-label="Nyckeltal" className="ref-panel">
        <dl className="grid grid-cols-3 divide-line sm:divide-x xl:grid-cols-6">
          {figures.map((figure) => {
            const Icon = figure.icon
            return (
              <div key={figure.label} className="min-w-0 px-5 py-5">
                <dt className="type-section truncate text-[9.5px] tracking-[0.1em]">
                  {figure.label}
                </dt>
                <dd className="mt-2.5">
                  <span
                    className={cn(
                      'type-display-figure-sm text-[30px] whitespace-nowrap',
                      figure.tone === 'warning' && 'text-warning',
                      figure.tone === 'negative' && 'text-negative',
                    )}
                  >
                    {figure.value}
                    {figure.dot && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'ml-2 inline-block h-1.5 w-1.5 -translate-y-1 rounded-full',
                          figure.tone === 'negative' ? 'bg-negative' : 'bg-warning',
                        )}
                      />
                    )}
                  </span>
                  {figure.note && (
                    <span className="type-machine mt-3 flex items-center gap-1.5 normal-case text-content-muted">
                      {Icon && (
                        <Icon
                          className="h-3.5 w-3.5 shrink-0 text-[#c9b17a]/80"
                          aria-hidden="true"
                          strokeWidth={1.5}
                        />
                      )}
                      <span className="truncate">{figure.note}</span>
                    </span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>

      {view === 'kontor' ? (
        <section aria-label="Kontor" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="type-section">Kontorsböcker</h2>
            <span className="flex items-center gap-4">
              <span className="type-machine">
                {offices.length === 1 ? '1 kontor' : `${offices.length} kontor`} ·{' '}
                {rows.length} klienter
              </span>
              <Link to="/clients/offices/archived" className="dossier-link">
                Arkiverade kontor →
              </Link>
            </span>
          </div>
          {offices.length === 0 ? (
            <p className="ref-panel type-inst-sub px-3 py-8 text-center">
              Inga kontor i registret.
            </p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {offices.map((book) => (
                <li key={book.office.id} className="min-w-0">
                  <OfficeFolder book={book} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <ClientBook
          rows={rows}
          scope="all"
          today={directory.today}
          method={directory.method}
          showOffice
        />
      )}
    </div>
  )
}
