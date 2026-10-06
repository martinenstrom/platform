import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { PhoneOff } from 'lucide-react'
import type { ClientActions } from '~/components/clients/clientActions'
import { PageShell } from '~/components/layout/PageHeader'
import { CallBriefView } from '~/components/today/CallBriefView'
import { EmptyState } from '~/components/ui/EmptyState'
import {
  askAboutClientFn,
  completeCommitmentFn,
  confirmClientUpdateFn,
  getCallBriefFn,
  recordClientUpdateFn,
} from '~/infrastructure/advisory/serverFns'

/**
 * Förbered samtal — the call brief for one client, beneath Idag: read once
 * on the server from the record, with the same Client Memory doors Client
 * 360 uses for what happened on the call. The page re-reads itself after a
 * confirmed update, so what it says about the relationship's priority is
 * the record's, not the form's.
 */
export const Route = createFileRoute('/today_/call/$clientId')({
  loader: ({ params }) => getCallBriefFn({ data: params.clientId }),
  component: CallBriefPage,
})

function CallBriefPage() {
  const response = Route.useLoaderData()
  const { clientId } = Route.useParams()
  const router = useRouter()

  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={PhoneOff}
          title={
            response.code === 'NOT_FOUND' ? 'Klienten finns inte' : 'Samtalsunderlaget kunde inte läsas'
          }
          description={
            response.code === 'NOT_FOUND'
              ? 'Ingen relation med det här id:t finns i registret.'
              : 'Relationsminnet svarar inte just nu.'
          }
          action={
            <Link
              to="/today"
              className="type-section text-institution underline-offset-4 hover:underline"
            >
              Tillbaka till Idag
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
  }

  return (
    <PageShell className="gap-2">
      <CallBriefView
        brief={response.brief}
        actions={actions}
        onChanged={() => router.invalidate()}
      />
    </PageShell>
  )
}
