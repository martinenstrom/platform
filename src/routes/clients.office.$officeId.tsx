import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2 } from 'lucide-react'
import { OfficeBook } from '~/components/clients/OfficeBook'
import { PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { getOfficeBookFn } from '~/infrastructure/advisory/serverFns'

/**
 * An office's Private Banking book — `/clients/office/:officeId`, a real
 * destination the advisor can link to. Read once on the server from the
 * same directory the whole book reads, scoped to the office; the page
 * filters and sorts, and decides nothing.
 */
export const Route = createFileRoute('/clients/office/$officeId')({
  loader: ({ params }) => getOfficeBookFn({ data: params.officeId }),
  component: OfficePage,
})

function OfficePage() {
  const response = Route.useLoaderData()
  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={Building2}
          title={
            response.code === 'NOT_FOUND'
              ? 'Kontoret finns inte'
              : 'Kontorsboken kunde inte läsas'
          }
          description={
            response.code === 'NOT_FOUND'
              ? 'Inget kontor med det här id:t finns i registret.'
              : 'Relationsminnet svarar inte just nu.'
          }
          action={
            <Link
              to="/clients"
              className="type-section text-institution underline-offset-4 hover:underline"
            >
              Till klientboken
            </Link>
          }
        />
      </PageShell>
    )
  }
  return (
    <PageShell className="gap-2">
      <OfficeBook book={response.book} />
    </PageShell>
  )
}
