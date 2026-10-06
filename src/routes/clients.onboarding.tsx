import { createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { LifecycleBook } from '~/components/clients/lifecycle/LifecycleBook'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { getLifecycleBookFn } from '~/infrastructure/advisory/lifecycle/serverFns'

/** Onboarding — the relationships being taken in, not yet in the active book. */
export const Route = createFileRoute('/clients/onboarding')({
  loader: () => getLifecycleBookFn({ data: 'onboarding' }),
  component: OnboardingPage,
})

function OnboardingPage() {
  const response = Route.useLoaderData()
  return (
    <PageShell className="gap-2">
      {response.ok ? (
        <LifecycleBook book="onboarding" directory={response.directory} />
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
