import { createFileRoute } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { MarketTickerList } from '~/components/dashboard/MarketTicker'
import { marketIndices, marketTrends } from '~/data/mockData'
import { cn } from '~/lib/cn'

export const Route = createFileRoute('/markets')({
  component: MarketsPage,
})

const TREND_TONE: Record<string, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  accent: 'text-accent',
  neutral: 'text-content',
}

function MarketsPage() {
  return (
    <PageShell>
      <PageHeader title="Marknader" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DashboardCard title="Index och valutor">
          <MarketTickerList quotes={marketIndices} />
        </DashboardCard>

        <DashboardCard title="Marknadsklimat">
          <dl className="flex flex-col gap-5">
            {marketTrends.map((trend) => (
              <div key={trend.id} className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-content-muted">{trend.label}</dt>
                <dd
                  className={cn(
                    'text-sm font-medium',
                    TREND_TONE[trend.tone] ?? 'text-content',
                  )}
                >
                  {trend.value}
                </dd>
              </div>
            ))}
          </dl>
        </DashboardCard>

        <DashboardCard title="Sektorer">
          <EmptyState
            icon={Globe}
            title="Sektordata saknas"
            description="Sektorrotation visas här när marknadsdatakällan är ansluten."
          />
        </DashboardCard>
      </div>
    </PageShell>
  )
}
