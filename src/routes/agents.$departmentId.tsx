/**
 * One desk, as the institution holds it.
 *
 * Who owns it and what they are accountable for; what the firm's registered
 * workflow asks of it; and every run it has performed, with what produced each
 * one, what it was allowed to spend and what it actually spent.
 *
 * Read-only, like the floor it is reached from.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { FileQuestion, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { RunRow } from '~/components/agents/RunRow'
import { getAgentDeskFn } from '~/infrastructure/analysis/serverFns'
import type { AgentDeskResponse } from '~/infrastructure/analysis/serverFns'
import type { RequirementLevel } from '~/domain/analysis'
import type { Tone } from '~/types'

export const Route = createFileRoute('/agents/$departmentId')({
  loader: async ({ params }) => getAgentDeskFn({ data: params.departmentId }),
  component: () => (
    <AgentDeskPage response={Route.useLoaderData() as AgentDeskResponse} />
  ),
})

const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Avdelningen finns inte, eller tilldelas inget arbete.',
}

/**
 * How much the workflow needs an entry.
 *
 * `conditional` is neither required nor optional: the firm decides per argument
 * whether the control applies, and rendering it as either would state a
 * decision nobody has made yet.
 */
const REQUIREMENT: Record<RequirementLevel, { label: string; tone: Tone }> = {
  required: { label: 'Obligatoriskt', tone: 'accent' },
  optional: { label: 'Valfritt', tone: 'neutral' },
  conditional: { label: 'Villkorat', tone: 'warning' },
}

/** Exported so the rendered desk can be proved without a router. */
export function AgentDeskPage({ response }: { response: AgentDeskResponse }) {
  if (!response.ok) {
    return (
      <PageShell>
        <PageHeader title="Avdelning" description="Kunde inte läsas." />
        <EmptyState
          icon={response.code === 'NOT_FOUND' ? FileQuestion : ServerOff}
          title={FAILURE_TEXT[response.code] ?? 'Avdelningen kunde inte läsas.'}
          description="Ingen institutionell information kunde hämtas för den här avdelningen."
        />
      </PageShell>
    )
  }

  const { desk } = response
  const awaitingCount = desk.runs.filter(
    (run) => run.state === 'awaiting-acceptance',
  ).length

  return (
    <PageShell>
      <PageHeader
        title={desk.name}
        description={`${desk.manager.displayName} · ${desk.manager.roleTitle}`}
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/agents" className="type-metadata hover:text-content">
              Alla avdelningar
            </Link>
            {/*
             * The way in to the act, on the page that describes the desk.
             *
             * Rendered only where the firm's registered workflow actually asks
             * this desk for something: a commission screen for a department no
             * playbook assigns work to would offer a button the institution
             * could only refuse. Whether any particular CASE can take the work
             * is decided on the commission surface itself, by the read model,
             * rather than guessed at here.
             */}
            {desk.assignableWork.length > 0 && (
              <Link
                to="/agents/$departmentId/commission"
                params={{ departmentId: desk.departmentId }}
                className="text-sm text-accent hover:underline"
              >
                Beställ analys
              </Link>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard title="Ansvar">
          {desk.responsibilities.length === 0 ? (
            <p className="text-sm text-content-muted">Inget ansvarsområde registrerat.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {desk.responsibilities.map((responsibility) => (
                <li key={responsibility.id} className="flex flex-col gap-1">
                  <span className="text-sm">{responsibility.summary}</span>
                  {/*
                   * A discipline that yields a reading rather than a
                   * measurement is required to be labelled as such wherever it
                   * appears. This is one of the places it appears.
                   */}
                  {responsibility.interpretive && (
                    <span>
                      <StatusBadge tone="warning">Tolkning, inte mätning</StatusBadge>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {desk.handles.map((discipline) => (
              <StatusBadge key={discipline} tone="neutral">
                {discipline}
              </StatusBadge>
            ))}
          </div>
        </DashboardCard>

        <DashboardCard title={`Uppdrag i arbetsflödet (${desk.assignableWork.length})`}>
          {desk.assignableWork.length === 0 ? (
            <p className="text-sm text-content-muted">
              Inget registrerat arbetsflöde tilldelar den här avdelningen arbete.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {desk.assignableWork.map((work) => (
                <li
                  key={`${work.playbookId}|${work.playbookVersion}|${work.entryKey}`}
                  className="flex flex-col gap-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{work.entryKey}</span>
                    <StatusBadge tone={REQUIREMENT[work.requirement].tone}>
                      {REQUIREMENT[work.requirement].label}
                    </StatusBadge>
                  </div>
                  <p className="text-sm leading-relaxed text-content-muted">
                    {work.brief}
                  </p>
                  {/*
                   * The exact playbook version, because a case pinned to an
                   * older one is still live work for whoever owes it.
                   */}
                  <span className="type-metadata">
                    {work.playbookId} v{work.playbookVersion}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>

      <DashboardCard
        title={`Körningar (${desk.runs.length})`}
        action={
          /*
           * What the desk owes a person, counted off the records rather than
           * stored. A run in `awaiting-acceptance` is work produced and paid
           * for that nobody has judged, and a desk page that did not say so
           * would leave the decision to whoever happened to scroll.
           */
          awaitingCount > 0 ? (
            <StatusBadge tone="warning">
              {awaitingCount} väntar på ditt beslut
            </StatusBadge>
          ) : undefined
        }
      >
        {desk.runs.length === 0 ? (
          <p className="text-sm text-content-muted">
            Avdelningen har inte kört något ännu. Det är inte detsamma som att en körning
            misslyckats.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {desk.runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </DashboardCard>
    </PageShell>
  )
}
