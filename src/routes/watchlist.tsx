import { createFileRoute } from '@tanstack/react-router'
import { Plus, Star } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { EmptyState } from '~/components/ui/EmptyState'
import { WatchlistTable } from '~/components/dashboard/WatchlistTable'
import { watchlist } from '~/data/mockData'

export const Route = createFileRoute('/watchlist')({
  component: WatchlistPage,
})

function WatchlistPage() {
  return (
    <PageShell>
      <PageHeader
        title="Bevakning"
        description="Instrument du följer, med simulerade signaler från analysagenter."
        actions={
          <Button variant="primary" size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Lägg till instrument
          </Button>
        }
      />

      <DashboardCard title="Bevakningslista">
        <WatchlistTable items={watchlist} />
      </DashboardCard>

      <DashboardCard title="Delade listor">
        <EmptyState
          icon={Star}
          title="Inga delade listor ännu"
          description="Listor som delas i teamet visas här när samarbetsfunktionerna aktiveras."
          action={
            <Button variant="secondary" size="sm">
              Skapa lista
            </Button>
          }
        />
      </DashboardCard>
    </PageShell>
  )
}
