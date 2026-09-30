import { createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import {
  ClientCommandCentre,
  type DirectoryViewMode,
} from '~/components/clients/ClientCommandCentre'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { getClientDirectoryFn } from '~/infrastructure/advisory/serverFns'

/**
 * Klienter — the relationship book, and the answer to *who do I serve, and
 * what does each relationship need from me today?* Read office by office
 * by default (`/clients`), or every relationship at once (`?view=alla`).
 *
 * The directory is derived on the server from the relationship record and
 * the clock, and handed to the surface as typed rows, metrics and office
 * books. The page filters and sorts; it decides nothing.
 */
export const Route = createFileRoute('/clients/')({
  validateSearch: (search: Record<string, unknown>): { view?: 'alla' } =>
    search.view === 'alla' ? { view: 'alla' } : {},
  loader: () => getClientDirectoryFn(),
  component: ClientsPage,
})

function ClientsPage() {
  const response = Route.useLoaderData()
  const { view } = Route.useSearch()
  const mode: DirectoryViewMode = view === 'alla' ? 'alla' : 'kontor'
  return (
    <PageShell className="gap-2">
      {response.ok ? (
        <ClientCommandCentre directory={response.directory} view={mode} />
      ) : (
        <EmptyState
          icon={Users}
          title="Klientregistret kunde inte nås"
          description="Relationsminnet svarar inte just nu. Inga klienter visas förrän det gör det."
        />
      )}
    </PageShell>
  )
}
