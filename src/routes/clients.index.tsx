import { createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { ClientCommandCentre } from '~/components/clients/ClientCommandCentre'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { getClientDirectoryFn } from '~/infrastructure/advisory/serverFns'

/**
 * Klienter — the relationship command centre, and the answer to *who do I
 * serve, and what does each relationship need from me today?*
 *
 * The directory is derived on the server from the relationship record and
 * the clock, and handed to the surface as typed rows and metrics. The page
 * filters and sorts; it decides nothing.
 */
export const Route = createFileRoute('/clients/')({
  loader: () => getClientDirectoryFn(),
  component: ClientsPage,
})

function ClientsPage() {
  const response = Route.useLoaderData()
  return (
    <PageShell className="gap-2">
      {response.ok ? (
        <ClientCommandCentre directory={response.directory} />
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
