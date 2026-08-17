/**
 * Giving a desk an assignment.
 *
 * The screen the whole of C2-2 exists to make possible: from here a person
 * selects an open case, selects the evidence the firm actually holds, and
 * commissions a real live analysis — after which the work lands on the Stage B
 * review surface where the same person judges it.
 *
 * ## A sibling of the desk page, not a child
 *
 * `agents_.` rather than `agents.`, so this renders on its own rather than
 * beneath the desk's runs. Commissioning is a decision that deserves the whole
 * page: everything on it is something a person has to read before spending the
 * firm's money.
 *
 * ## It decides nothing
 *
 * Which cases can take this work, what the firm authorizes for it, and what
 * came of the run are all decided elsewhere and arrive already derived. This
 * file loads them and arranges them.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { FileQuestion, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { CommissionPanel } from '~/components/agents/CommissionPanel'
import {
  getCommissionBriefFn,
  getOperatorIdentitiesFn,
} from '~/infrastructure/analysis/serverFns'
import type {
  CommissionBriefResponse,
  OperatorIdentitiesResponse,
} from '~/infrastructure/analysis/serverFns'

export const Route = createFileRoute('/agents_/$departmentId/commission')({
  loader: async ({ params }) => ({
    brief: await getCommissionBriefFn({ data: { departmentId: params.departmentId } }),
    /*
     * Beside the brief rather than on demand, for the reason the review page
     * gives: the operator has to be chosen before the act is possible, and a
     * selector that populates after the page settles invites a click on a
     * control that is not ready.
     */
    operators: await getOperatorIdentitiesFn(),
  }),
  component: () => {
    const data = Route.useLoaderData() as {
      brief: CommissionBriefResponse
      operators: OperatorIdentitiesResponse
    }
    return <CommissionPage brief={data.brief} operators={data.operators} />
  },
})

const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Avdelningen finns inte, eller tilldelas inget arbete.',
}

/** Exported so the rendered surface can be proved without a router. */
export function CommissionPage({
  brief: response,
  operators,
}: {
  brief: CommissionBriefResponse
  operators: OperatorIdentitiesResponse
}) {
  if (!response.ok) {
    return (
      <PageShell>
        <PageHeader title="Beställ analys" description="Kunde inte läsas." />
        <EmptyState
          icon={response.code === 'NOT_FOUND' ? FileQuestion : ServerOff}
          title={FAILURE_TEXT[response.code] ?? 'Beställningen kunde inte förberedas.'}
          description="Ingen institutionell information kunde hämtas för den här avdelningen."
        />
      </PageShell>
    )
  }

  const { brief } = response

  return (
    <PageShell>
      <PageHeader
        title={`Beställ analys av ${brief.desk.name}`}
        description="Välj ärende och underlag. Körningen är verklig och bokförs på firman."
        actions={
          <Link
            to="/agents/$departmentId"
            params={{ departmentId: brief.desk.departmentId }}
            className="type-metadata hover:text-content"
          >
            Till avdelningen
          </Link>
        }
      />

      {operators.ok ? (
        <CommissionPanel brief={brief} identities={operators.identities} />
      ) : (
        <DashboardCard title="Beställ">
          <p className="text-sm text-content-muted">
            Medarbetarregistret kunde inte läsas, så ingen beställning kan bokföras på en
            namngiven person just nu.
          </p>
        </DashboardCard>
      )}
    </PageShell>
  )
}
