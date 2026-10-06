import { createFileRoute, Link } from '@tanstack/react-router'
import { Archive, ArrowRight, Building2 } from 'lucide-react'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { getRegisterFn } from '~/infrastructure/advisory/lifecycle/serverFns'
import { formatLongDate } from '~/presentation/advisory/format'

/** Arkiverade kontor — the offices that retired, each still a door to its history. */
export const Route = createFileRoute('/clients/offices/archived')({
  loader: () => getRegisterFn(),
  component: ArchivedOfficesPage,
})

function ArchivedOfficesPage() {
  const register = Route.useLoaderData()
  if (!register.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={Building2}
          title="Registret kunde inte nås"
          description="Relationsminnet svarar inte just nu."
        />
      </PageShell>
    )
  }
  const archived = register.offices.filter((office) => office.status === 'archived')
  return (
    <PageShell className="gap-3">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-1 pt-3 pb-1">
        <div className="min-w-0">
          <p className="type-section text-institution">Client Intelligence</p>
          <h1 className="type-display-name mt-1.5 text-[44px] leading-none">
            Arkiverade kontor
          </h1>
          <p className="mt-2 max-w-[30rem] font-display text-[15px] leading-snug text-content-muted">
            Kontor som inte längre tar emot relationer. Deras böcker och historik finns
            kvar och räknas inte in bland aktiva kontor.
          </p>
        </div>
        <Link to="/clients" className="jarvis-ghost-btn dossier-cta">
          Aktiva kontor
        </Link>
      </header>
      {archived.length === 0 ? (
        <p className="ref-panel type-inst-sub px-5 py-8 text-center">
          Inga arkiverade kontor.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {archived.map((office) => (
            <li key={office.id} className="min-w-0">
              <Link
                to="/clients/office/$officeId"
                params={{ officeId: office.id }}
                className="client-card flex h-full flex-col gap-3 px-4 pt-3.5 pb-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="dossier-icon" aria-hidden="true">
                      <Archive className="h-[14px] w-[14px]" strokeWidth={1.6} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-[20px] leading-tight font-medium text-content">
                        {office.displayName}
                      </span>
                      <span className="type-inst-sub block truncate">{office.city}</span>
                    </span>
                  </span>
                  <span className="dossier-chevron" aria-hidden="true">
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 border-t border-hairline pt-3">
                  <div>
                    <dt className="type-section">Arkiverat</dt>
                    <dd className="mt-0.5 text-[13px] text-content">
                      {office.archivedAt ? formatLongDate(office.archivedAt) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="type-section">Id</dt>
                    <dd className="type-machine mt-1">{office.id}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  )
}
