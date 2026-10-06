import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Sunrise } from 'lucide-react'
import { PageShell } from '~/components/layout/PageHeader'
import { DailyCommand } from '~/components/today/DailyCommand'
import { EmptyState } from '~/components/ui/EmptyState'
import { getDailyCommandFn } from '~/infrastructure/advisory/serverFns'

/**
 * Idag — Daily Command, and the answer to *who needs me today, what is the
 * best use of my time, and what changed?*
 *
 * The view is composed on the server from the same record Sentinel,
 * Market-to-Client and the Meeting Pack read, on the advisory clock; the
 * page renders it and narrows it to an office through its search. Nothing
 * is persisted for it: every visit recomputes from the record.
 */
export const Route = createFileRoute('/today')({
  validateSearch: (search: Record<string, unknown>): { office?: string } =>
    typeof search.office === 'string' && search.office ? { office: search.office } : {},
  loaderDeps: ({ search }) => ({ office: search.office }),
  loader: ({ deps }) =>
    getDailyCommandFn({ data: deps.office ? { officeId: deps.office } : {} }),
  component: TodayPage,
})

function TodayPage() {
  const response = Route.useLoaderData()
  const navigate = useNavigate()
  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={Sunrise}
          title="Dagen kunde inte läsas"
          description="Relationsminnet svarar inte just nu. Inga prioriteringar visas förrän det gör det."
        />
      </PageShell>
    )
  }
  return (
    <PageShell className="gap-2">
      <DailyCommand
        view={response.view}
        onOfficeChange={(officeId) =>
          void navigate({ to: '/today', search: officeId ? { office: officeId } : {} })
        }
      />
    </PageShell>
  )
}
