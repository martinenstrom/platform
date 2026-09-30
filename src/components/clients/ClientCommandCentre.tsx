import { Link } from '@tanstack/react-router'
import type { ClientDirectory } from '~/application/advisory/clientDirectory'
import { cn } from '~/lib/cn'
import { formatMsek } from '~/presentation/advisory/format'
import { ClientBook } from './ClientBook'
import { OfficeFolder } from './OfficeFolder'

export type DirectoryViewMode = 'kontor' | 'alla'

/**
 * The relationship book: the whole Private Banking book in one line of
 * figures, then the book office by office — one folder per office the
 * advisor answers for — or, on request, every relationship at once. The
 * office view is the advisor's way in; the whole book is for the search
 * that does not know the office. The room behind it is the shell's.
 *
 * The view is in the URL (`?view=alla`) so a book can be linked; the
 * search, the filter and the order of each book live in `directoryState`,
 * outside the page, so coming back from a client finds the book as it was
 * left.
 */
export function ClientCommandCentre({
  directory,
  view = 'kontor',
}: {
  directory: ClientDirectory
  view?: DirectoryViewMode
}) {
  const { metrics } = directory

  const figures: {
    label: string
    value: string
    note?: string
    tone?: 'warning' | 'negative'
  }[] = [
    { label: 'AUM', value: formatMsek(metrics.totalAum) },
    { label: 'Total förmögenhet', value: formatMsek(metrics.estimatedWealth) },
    { label: 'Klienter', value: String(metrics.totalClients) },
    {
      label: 'Behöver uppmärksamhet',
      value: String(metrics.needingAttention),
      tone: metrics.needingAttention > 0 ? 'warning' : undefined,
    },
    { label: 'Möten', value: String(metrics.upcomingMeetings), note: 'inom 30 dagar' },
    {
      label: 'Åtaganden',
      value: String(metrics.openCommitments),
      note:
        metrics.overdueCommitments > 0
          ? `${metrics.overdueCommitments} försenade`
          : 'inga försenade',
      tone: metrics.overdueCommitments > 0 ? 'negative' : undefined,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* The title stands in the room, not in a panel: the environment is behind it. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-1 pt-5 pb-1">
        <div>
          <p className="type-section text-institution">Client Intelligence</p>
          <h1 className="mt-1.5 text-[34px] font-semibold leading-none tracking-[-0.022em] text-content">
            Klienter
          </h1>
          <p className="mt-2.5 max-w-xl text-[13px] leading-snug text-content-muted">
            Dina private banking-relationer, prioriteringar och möjligheter — kontor för
            kontor.
          </p>
        </div>
        <nav
          aria-label="Vy"
          className="flex items-center gap-0.5 rounded-[4px] border border-line p-0.5"
        >
          <ViewSwitch view="kontor" current={view} label="Kontor" />
          <ViewSwitch view="alla" current={view} label="Alla klienter" />
        </nav>
      </header>

      <section aria-label="Nyckeltal" className="ref-panel">
        <dl className="grid grid-cols-3 divide-line sm:divide-x xl:grid-cols-6">
          {figures.map((figure) => (
            <div key={figure.label} className="min-w-0 px-3.5 py-2.5">
              <dt className="type-section truncate">{figure.label}</dt>
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                <span
                  className={cn(
                    'tabular text-[18px] leading-6 font-semibold tracking-[-0.015em] text-content',
                    figure.tone === 'warning' && 'text-warning',
                    figure.tone === 'negative' && 'text-negative',
                  )}
                >
                  {figure.value}
                </span>
                {figure.note && (
                  <span
                    className={cn(
                      'type-machine',
                      figure.tone === 'negative' && 'text-negative',
                    )}
                  >
                    {figure.note}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {view === 'kontor' ? (
        <section aria-label="Kontor" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="type-section">Kontorsböcker</h2>
            <span className="type-machine">
              {directory.offices.length === 1
                ? '1 kontor'
                : `${directory.offices.length} kontor`}{' '}
              · {directory.rows.length} klienter
            </span>
          </div>
          {directory.offices.length === 0 ? (
            <p className="ref-panel type-inst-sub px-3 py-8 text-center">
              Inga kontor i registret.
            </p>
          ) : (
            <ul className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
              {directory.offices.map((book) => (
                <li key={book.office.id} className="min-w-0">
                  <OfficeFolder book={book} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <ClientBook
          rows={directory.rows}
          scope="all"
          today={directory.today}
          method={directory.method}
          showOffice
        />
      )}
    </div>
  )
}

function ViewSwitch({
  view,
  current,
  label,
}: {
  view: DirectoryViewMode
  current: DirectoryViewMode
  label: string
}) {
  const active = view === current
  return (
    <Link
      to="/clients"
      search={view === 'alla' ? { view: 'alla' } : {}}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'type-section rounded-[3px] px-2.5 py-1 transition-colors',
        active
          ? 'bg-institution-soft text-institution'
          : 'text-content-muted hover:text-content',
      )}
    >
      {label}
    </Link>
  )
}
