import { createFileRoute, Link } from '@tanstack/react-router'
import { FileX } from 'lucide-react'
import type { MeetingPackDepth } from '~/application/advisory/meetingPack'
import { PageShell } from '~/components/layout/PageHeader'
import { MeetingPackPreview } from '~/components/meetingPack/MeetingPackPreview'
import {
  saveInBrowser,
  type MeetingPackActions,
  type RequestedFormat,
} from '~/components/meetingPack/meetingPackActions'
import { EmptyState } from '~/components/ui/EmptyState'
import {
  downloadMeetingPackFn,
  generateMeetingPackFn,
  getMeetingPackFn,
} from '~/infrastructure/advisory/serverFns'

interface MeetingPackSearch {
  depth: MeetingPackDepth
  format?: RequestedFormat
}

/**
 * Meeting Pack Preview — the pack as the record justifies it today, its
 * readiness, its contents and the Executive Brief on screen, before a file
 * is generated. The depth is in the URL so JARVIS, the cockpit and a
 * bookmark all open the same preview; the requested format only preselects
 * a button.
 */
export const Route = createFileRoute('/clients/$clientId_/meeting-pack')({
  validateSearch: (search: Record<string, unknown>): MeetingPackSearch => ({
    depth: search.depth === 'executive' ? 'executive' : 'full',
    ...(search.format === 'pptx' || search.format === 'pdf' || search.format === 'both'
      ? { format: search.format }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ depth: search.depth }),
  loader: ({ params, deps }) =>
    getMeetingPackFn({ data: { clientId: params.clientId, depth: deps.depth } }),
  component: MeetingPackPage,
})

function MeetingPackPage() {
  const response = Route.useLoaderData()
  const { clientId } = Route.useParams()
  const { depth, format } = Route.useSearch()

  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={FileX}
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

  const actions: MeetingPackActions = {
    generate: (requestedDepth, formats) =>
      generateMeetingPackFn({ data: { clientId, depth: requestedDepth, formats } }),
    download: (id) => downloadMeetingPackFn({ data: id }),
    save: saveInBrowser,
  }

  return (
    <PageShell className="gap-2">
      <MeetingPackPreview
        key={`${clientId}-${depth}`}
        pack={response.pack}
        versions={response.versions}
        depth={depth}
        requestedFormat={format ?? null}
        actions={actions}
      />
    </PageShell>
  )
}
