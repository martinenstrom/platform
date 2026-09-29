import { createFileRoute } from '@tanstack/react-router'
import { Radar } from 'lucide-react'
import { PageShell } from '~/components/layout/PageHeader'
import { MarketImpactMatrix } from '~/components/marketImpact/MarketImpactMatrix'
import { EmptyState } from '~/components/ui/EmptyState'
import { getMarketImpactFn } from '~/infrastructure/advisory/serverFns'

/**
 * Marknadspåverkan — which clients the market's material moves touch, why,
 * and what the advisor should prepare: Market-to-Client's affected-clients
 * view, reached from the dashboard's "Vilka klienter berörs?".
 *
 * Deliberately not a primary destination. The navigation names the
 * questions the product answers; this page is the client half of the
 * market question, and the market screen links to it where a move touches
 * somebody.
 */
export const Route = createFileRoute('/market-impact')({
  loader: () => getMarketImpactFn(),
  component: MarketImpactPage,
})

function MarketImpactPage() {
  const response = Route.useLoaderData()
  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={Radar}
          title="Marknadspåverkan kunde inte bedömas"
          description="Relationsminnet eller marknadsdata svarar inte just nu. Ingen bedömning visas förrän de gör det."
        />
      </PageShell>
    )
  }
  return (
    <PageShell className="gap-2">
      <MarketImpactMatrix brief={response.brief} />
    </PageShell>
  )
}
