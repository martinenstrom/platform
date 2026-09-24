import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { UserX } from 'lucide-react'
import { Client360 } from '~/components/clients/Client360'
import type { ClientActions } from '~/components/clients/clientActions'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import {
  askAboutClientFn,
  completeCommitmentFn,
  confirmClientUpdateFn,
  getClient360Fn,
  getMeetingPrepFn,
  recordClientUpdateFn,
} from '~/infrastructure/advisory/serverFns'

/**
 * Client 360 — one relationship in full.
 *
 * The view is read once on the server; every act the page offers goes back
 * through the same door and the page re-reads itself afterwards, so what
 * the advisor confirmed is what the timeline shows, from the record and
 * not from the form.
 */
export const Route = createFileRoute('/clients/$clientId')({
  loader: ({ params }) => getClient360Fn({ data: params.clientId }),
  component: ClientPage,
})

function ClientPage() {
  const response = Route.useLoaderData()
  const { clientId } = Route.useParams()
  const router = useRouter()

  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={UserX}
          title={
            response.code === 'NOT_FOUND'
              ? 'Klienten finns inte'
              : 'Klienten kunde inte läsas'
          }
          description={
            response.code === 'NOT_FOUND'
              ? 'Ingen relation med det här id:t finns i registret.'
              : 'Relationsminnet svarar inte just nu.'
          }
          action={
            <Link
              to="/clients"
              className="type-section text-institution underline-offset-4 hover:underline"
            >
              Till klientlistan
            </Link>
          }
        />
      </PageShell>
    )
  }

  const actions: ClientActions = {
    recordUpdate: (input) => recordClientUpdateFn({ data: { clientId, ...input } }),
    confirmUpdate: (candidateId, decisions) =>
      confirmClientUpdateFn({ data: { candidateId, decisions } }),
    completeCommitment: (commitmentId) => completeCommitmentFn({ data: commitmentId }),
    ask: (question) => askAboutClientFn({ data: { clientId, question } }),
    prepareMeeting: () => getMeetingPrepFn({ data: clientId }),
  }

  return (
    <PageShell className="gap-2">
      <nav aria-label="Brödsmulor" className="px-1">
        <Link to="/clients" className="type-machine hover:text-content">
          ← Klienter
        </Link>
      </nav>
      <Client360
        view={response.view}
        actions={actions}
        onChanged={() => router.invalidate()}
      />
    </PageShell>
  )
}
