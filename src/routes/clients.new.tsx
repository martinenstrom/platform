import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { NewClientForm } from '~/components/clients/lifecycle/NewClientForm'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import {
  createClientFn,
  getRegisterFn,
} from '~/infrastructure/advisory/lifecycle/serverFns'
import { getClientDirectoryFn } from '~/infrastructure/advisory/serverFns'
import { WORKSPACE_ADVISOR_ID } from '~/presentation/advisory/advisorIdentity'

/**
 * Ny PB-klient — a relationship enters the book. The register (offices,
 * advisors) and today's date come from the server; the form writes
 * through the one lifecycle door and opens the new dossier.
 */
export const Route = createFileRoute('/clients/new')({
  loader: async () => {
    const [register, directory] = await Promise.all([
      getRegisterFn(),
      getClientDirectoryFn(),
    ])
    return { register, today: directory.ok ? directory.directory.today : null }
  },
  component: NewClientPage,
})

function NewClientPage() {
  const { register, today } = Route.useLoaderData()
  const navigate = useNavigate()
  if (!register.ok || !today) {
    return (
      <PageShell>
        <EmptyState
          icon={Users}
          title="Registret kunde inte nås"
          description="Relationsminnet svarar inte just nu. Ingen relation kan skapas förrän det gör det."
        />
      </PageShell>
    )
  }
  return (
    <PageShell className="gap-3">
      <header className="px-1 pt-3 pb-1">
        <p className="type-section text-institution">Client Intelligence</p>
        <h1 className="type-display-name mt-1.5 text-[44px] leading-none">
          Ny PB-klient
        </h1>
        <p className="mt-2 max-w-[30rem] font-display text-[15px] leading-snug text-content-muted">
          En ny relation tas emot under onboarding om inget annat anges. Det som inte är
          känt lämnas tomt och visas som data saknas.
        </p>
      </header>
      <NewClientForm
        offices={register.offices}
        advisors={register.advisors}
        today={today}
        defaultAdvisorId={WORKSPACE_ADVISOR_ID}
        onCreate={(request) => createClientFn({ data: request })}
        onCreated={(clientId) =>
          void navigate({ to: '/clients/$clientId', params: { clientId } })
        }
      />
    </PageShell>
  )
}
