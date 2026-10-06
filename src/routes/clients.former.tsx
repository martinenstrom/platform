import { createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { LifecycleBook } from '~/components/clients/lifecycle/LifecycleBook'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { getLifecycleBookFn } from '~/infrastructure/advisory/lifecycle/serverFns'

/** Tidigare klienter — the relationships that ended, kept whole. */
export const Route = createFileRoute('/clients/former')({
  loader: () => getLifecycleBookFn({ data: 'former' }),
  component: FormerClientsPage,
})

function FormerClientsPage() {
  const response = Route.useLoaderData()
  return (
    <PageShell className="gap-2">
      {response.ok ? (
        <LifecycleBook book="former" directory={response.directory} />
      ) : (
        <EmptyState
          icon={Users}
          title="Klientregistret kunde inte nås"
          description="Relationsminnet svarar inte just nu."
        />
      )}
    </PageShell>
  )
}
