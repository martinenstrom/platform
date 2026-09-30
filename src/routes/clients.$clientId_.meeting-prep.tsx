import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { CalendarX } from 'lucide-react'
import type { ClientActions } from '~/components/clients/clientActions'
import { PageShell } from '~/components/layout/PageHeader'
import { MeetingCockpit } from '~/components/meeting/MeetingCockpit'
import type { MeetingActions } from '~/components/meeting/meetingActions'
import { EmptyState } from '~/components/ui/EmptyState'
import {
  askAboutClientFn,
  askBeforeMeetingFn,
  completeCommitmentFn,
  confirmClientUpdateFn,
  getMeetingCockpitFn,
  recordClientUpdateFn,
} from '~/infrastructure/advisory/serverFns'

/**
 * Meeting Cockpit — what the advisor needs for THIS meeting, on a page of
 * its own beneath the client: focused, temporary, read once on the server
 * from the same record Client 360 shows. Closing the meeting goes through
 * the existing client update, and the page re-reads itself afterwards so
 * the next preparation compares against the baseline just captured.
 */
export const Route = createFileRoute('/clients/$clientId_/meeting-prep')({
  loader: ({ params }) => getMeetingCockpitFn({ data: params.clientId }),
  component: MeetingPrepPage,
})

function MeetingPrepPage() {
  const response = Route.useLoaderData()
  const { clientId } = Route.useParams()
  const router = useRouter()

  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={CalendarX}
          title={
            response.code === 'NOT_FOUND'
              ? 'Klienten finns inte'
              : 'Mötesunderlaget kunde inte läsas'
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

  const client: ClientActions = {
    recordUpdate: (input) => recordClientUpdateFn({ data: { clientId, ...input } }),
    confirmUpdate: (candidateId, decisions) =>
      confirmClientUpdateFn({ data: { candidateId, decisions } }),
    completeCommitment: (commitmentId) => completeCommitmentFn({ data: commitmentId }),
    ask: (question) => askAboutClientFn({ data: { clientId, question } }),
  }
  const actions: MeetingActions = {
    client,
    askBeforeMeeting: (question) => askBeforeMeetingFn({ data: { clientId, question } }),
  }

  return (
    <PageShell className="gap-2">
      {/* The way back is the shell's breadcrumb; the cockpit carries none of its own. */}
      <MeetingCockpit
        cockpit={response.cockpit}
        actions={actions}
        onChanged={() => router.invalidate()}
      />
    </PageShell>
  )
}
