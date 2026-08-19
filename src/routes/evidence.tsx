/**
 * Underlag — what the firm holds, and what it has declared fit for analysis.
 *
 * The first screen C3 adds, and the smallest honest one: it shows the
 * observations the firm ingested itself, lets a person record an assembly as an
 * institutional act, and hands the resulting set to the commission screen where
 * Global Macro can be put to work against it.
 *
 * Deliberately **not** a redesign of Agent Headquarters and not the Command
 * Center visual phase. It exists to make the chain visible end to end:
 *
 *   observations the firm holds → governed selection → EvidenceSet → commission
 *
 * ## The holdings reload when the window changes
 *
 * Client-side, through the same server function the loader uses, because the
 * count must come from the store rather than from a filter over something
 * already fetched — a screen that narrowed a cached list would show what it
 * downloaded rather than what the firm holds.
 */

import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EvidencePanel, type AssemblyQuery } from '~/components/agents/EvidencePanel'
import {
  getEvidenceDeskFn,
  getOperatorIdentitiesFn,
} from '~/infrastructure/analysis/serverFns'
import type {
  EvidenceDeskResponse,
  OperatorIdentitiesResponse,
} from '~/infrastructure/analysis/serverFns'

/**
 * The window the page opens on.
 *
 * A default window is not a default ACT — nothing is assembled until a person
 * presses the button — so this is a starting view rather than a preselected
 * decision. Thirty days, which is one Treasury XML page plus its neighbour.
 */
function initialQuery(): AssemblyQuery {
  const today = new Date()
  const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  return {
    ruleId: 'sovereign-yield-curve@1',
    subjectFamily: 'us-par-curve',
    from: iso(start),
    to: iso(today),
    knownAt: '',
    onBehalfOfDepartmentId: 'research-office',
  }
}

export const Route = createFileRoute('/evidence')({
  loader: async () => {
    const query = initialQuery()
    return {
      desk: await getEvidenceDeskFn({
        data: {
          ruleId: query.ruleId,
          subjectFamily: query.subjectFamily,
          from: query.from,
          to: query.to,
        },
      }),
      operators: await getOperatorIdentitiesFn(),
    }
  },
  component: () => {
    const data = Route.useLoaderData() as {
      desk: EvidenceDeskResponse
      operators: OperatorIdentitiesResponse
    }
    return <EvidencePage desk={data.desk} operators={data.operators} />
  },
})

const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Underlagen kunde inte läsas.',
}

/** Exported so the rendered surface can be proved without a router. */
export function EvidencePage({
  desk,
  operators,
}: {
  desk: EvidenceDeskResponse
  operators: OperatorIdentitiesResponse
}) {
  const [query, setQuery] = useState<AssemblyQuery>(initialQuery)
  const [view, setView] = useState(desk)

  const reload = useCallback(async (next: AssemblyQuery) => {
    setView(
      await getEvidenceDeskFn({
        data: {
          ruleId: next.ruleId,
          subjectFamily: next.subjectFamily,
          from: next.from,
          to: next.to,
          ...(next.knownAt ? { knownAt: next.knownAt } : {}),
        },
      }),
    )
  }, [])

  useEffect(() => {
    setView(desk)
  }, [desk])

  if (!view.ok) {
    return (
      <PageShell>
        <PageHeader title="Underlag" description="Kunde inte läsas." />
        <EmptyState
          icon={ServerOff}
          title={FAILURE_TEXT[view.code] ?? 'Underlagen kunde inte läsas.'}
          description="Ingen institutionell information kunde hämtas."
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="Underlag"
        description="Observationer firman håller, och de sammanställningar den har bokfört."
        actions={
          <Link to="/agents" className="type-metadata hover:text-content">
            Till avdelningarna
          </Link>
        }
      />

      {operators.ok ? (
        <EvidencePanel
          view={view.view}
          identities={operators.identities}
          query={query}
          onQueryChange={(next) => {
            setQuery(next)
            void reload(next)
          }}
        />
      ) : (
        <DashboardCard title="Sammanställ">
          <p className="text-sm text-content-muted">
            Medarbetarregistret kunde inte läsas, så ingen sammanställning kan bokföras på
            en namngiven person just nu.
          </p>
        </DashboardCard>
      )}
    </PageShell>
  )
}
