/**
 * Agent Headquarters: the firm's desks, and what they have actually done.
 *
 * This route replaced a page of five invented agents with invented progress
 * bars, and the replacement is the point of the stage: **every desk here exists
 * in the seeded organization, and every run here is a row in the database.**
 * There is no fallback to mock data, because there is no mock data left.
 *
 * ## Read-only
 *
 * No command is issued from this page. Selecting a desk, giving it an
 * assignment and judging what it produced are later stages with their own write
 * boundary; a read surface that grew one by accident would be the worst place
 * to discover it.
 *
 * ## Nothing here is computed
 *
 * The desks, their responsibilities, the work the firm's workflow assigns them
 * and their runs all arrive already derived. This file arranges them.
 */

import { createFileRoute } from '@tanstack/react-router'
import { ServerOff, Users } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { DeskCard } from '~/components/agents/DeskCard'
import { RunRow } from '~/components/agents/RunRow'
import { getAgentDirectoryFn } from '~/infrastructure/analysis/serverFns'
import type { AgentDirectoryResponse } from '~/infrastructure/analysis/serverFns'
import type { AgentRunRecord } from '~/domain/analysis'

export const Route = createFileRoute('/agents/')({
  loader: async () => getAgentDirectoryFn(),
  component: () => (
    <AgentFloorPage response={Route.useLoaderData() as AgentDirectoryResponse} />
  ),
})

/** Bounded codes in, a sentence out. The code never reaches the reader. */
const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Avdelningarna kunde inte läsas.',
}

/** How many runs the floor's history shows before it asks you to open a desk. */
const RECENT_LIMIT = 8

/** Exported so the rendered floor can be proved without a router. */
export function AgentFloorPage({ response }: { response: AgentDirectoryResponse }) {
  if (!response.ok) {
    return (
      <PageShell>
        <PageHeader title="Agenter" description="Kunde inte läsas." />
        <EmptyState
          icon={ServerOff}
          title={FAILURE_TEXT[response.code] ?? 'Avdelningarna kunde inte läsas.'}
          description="Ingen institutionell information kunde hämtas."
        />
      </PageShell>
    )
  }

  const { desks } = response
  /*
   * Newest first across the whole firm. The only ordering claim this page
   * makes, and it is a filing order rather than an institutional one — each
   * desk's own history is already ordered by the read model, and this simply
   * interleaves them so the floor shows what happened most recently.
   */
  const recent: readonly AgentRunRecord[] = desks
    .flatMap((desk) => desk.runs)
    .sort(
      (a, b) =>
        b.startedAt.localeCompare(a.startedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .slice(0, RECENT_LIMIT)

  const total = desks.reduce((sum, desk) => sum + desk.runs.length, 0)

  return (
    <PageShell>
      <PageHeader
        title="Agenter"
        description={
          desks.length === 0
            ? 'Inga avdelningar kan tilldelas arbete.'
            : `${desks.length} avdelningar, ${total} registrerade körningar.`
        }
      />

      {desks.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Inga avdelningar att tilldela arbete"
          description="Här visas de avdelningar som firmans registrerade arbetsflöden faktiskt tilldelar arbete."
        />
      ) : (
        <>
          <section aria-label="Avdelningar">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {desks.map((desk) => (
                <DeskCard key={desk.departmentId} desk={desk} />
              ))}
            </div>
          </section>

          <DashboardCard title={`Senaste körningar (${recent.length})`}>
            {recent.length === 0 ? (
              /*
               * A firm that has not commissioned anything has no history. Said
               * plainly, because a blank panel reads as data that failed to
               * load — and because the previous version of this page filled
               * exactly this space with runs that never happened.
               */
              <p className="text-sm text-content-muted">
                Ingen körning är registrerad ännu. När en avdelning får ett uppdrag visas
                den här.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {recent.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </ul>
            )}
          </DashboardCard>
        </>
      )}
    </PageShell>
  )
}
