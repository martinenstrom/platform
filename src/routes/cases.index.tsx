/**
 * Headquarters: everything the firm is holding.
 *
 * A queue, not an inventory. The first question is not "how many cases are
 * there" but "what is waiting on somebody, and on whom" — so each row leads
 * with where the case stands and what the institution does next, and the
 * question itself follows.
 *
 * Read-only, like the case page. Nothing is issued from here.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { Inbox, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { getCaseListFn } from '~/infrastructure/analysis/serverFns'
import {
  ACT_LABEL,
  ownershipText,
  STAGE_LABEL,
  STAGE_TONE,
} from '~/presentation/analysis/caseStandingText'
import type { CaseListResponse } from '~/infrastructure/analysis/serverFns'

export const Route = createFileRoute('/cases/')({
  loader: async () => getCaseListFn(),
  component: () => <CaseListPage response={Route.useLoaderData() as CaseListResponse} />,
})

const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Ärendena kunde inte läsas.',
}

/** Exported so the rendered queue can be proved without a router. */
export function CaseListPage({ response }: { response: CaseListResponse }) {
  if (!response.ok) {
    return (
      <PageShell>
        <PageHeader title="Huvudkontor" description="Kunde inte läsas." />
        <EmptyState
          icon={ServerOff}
          title={FAILURE_TEXT[response.code] ?? 'Ärendena kunde inte läsas.'}
          description="Ingen institutionell information kunde hämtas."
        />
      </PageShell>
    )
  }

  const { cases } = response
  const outstanding = cases.filter((entry) => !entry.standing.settled)
  const settled = cases.filter((entry) => entry.standing.settled)

  return (
    <PageShell>
      <PageHeader
        title="Huvudkontor"
        description={
          cases.length === 0
            ? 'Inga ärenden.'
            : `${outstanding.length} pågående, ${settled.length} avgjorda.`
        }
      />

      {cases.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inga ärenden ännu"
          description="När ett ärende öppnas visas det här med var det står och vad som händer härnäst."
        />
      ) : (
        <>
          {/*
           * Outstanding first, and in its own section. A single list ordered by
           * date would bury the work somebody owes under the work already
           * finished, which is the opposite of what a queue is for.
           */}
          <DashboardCard title={`Pågående (${outstanding.length})`}>
            {outstanding.length === 0 ? (
              <p className="text-sm text-content-muted">
                Inget ärende väntar på någon just nu.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {outstanding.map((entry) => (
                  <CaseRow key={entry.investmentCase.id} entry={entry} />
                ))}
              </ul>
            )}
          </DashboardCard>

          {settled.length > 0 && (
            <DashboardCard title={`Avgjorda (${settled.length})`}>
              <ul className="flex flex-col divide-y divide-line">
                {settled.map((entry) => (
                  <CaseRow key={entry.investmentCase.id} entry={entry} />
                ))}
              </ul>
            </DashboardCard>
          )}
        </>
      )}
    </PageShell>
  )
}

function CaseRow({
  entry,
}: {
  entry: Extract<CaseListResponse, { ok: true }>['cases'][number]
}) {
  const { investmentCase, standing } = entry
  const owner = ownershipText(standing.ownership)
  const outstanding = standing.steps.filter((step) => step.status === 'outstanding')

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <Link
        to="/cases/$caseId"
        params={{ caseId: investmentCase.id }}
        className="flex flex-col gap-2 rounded-lg px-2 py-2 hover:bg-surface-2"
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={STAGE_TONE[standing.stage]}>
            {STAGE_LABEL[standing.stage]}
          </StatusBadge>
          <span className="text-sm font-medium">{investmentCase.question}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          {/*
           * The two facts a queue exists to show. A settled case says so in
           * words rather than leaving the owner column blank, which reads as
           * missing data on a row that is complete.
           */}
          <span className="type-metadata">
            {owner === null ? 'Ingen ansvarig — avgjort' : `Ansvarig: ${owner}`}
          </span>
          <span className="type-metadata">{ACT_LABEL[standing.nextAct.act]}</span>
          {outstanding.length > 0 && (
            <span className="type-metadata">{outstanding.length} utestående steg</span>
          )}
          {standing.blockers.length > 0 && (
            <span className="type-metadata text-warning">
              {standing.blockers.length} blockerande
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}
