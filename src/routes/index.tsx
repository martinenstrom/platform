import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { DashboardCard, SectionHeading } from '~/components/ui/DashboardCard'
import { Stat } from '~/components/ui/Stat'
import { ChangeValue } from '~/components/ui/ChangeValue'
import { TimeRangeSelector } from '~/components/ui/TimeRangeSelector'
import { PerformanceChart } from '~/components/charts/PerformanceChart'
import { MarketTickerList } from '~/components/dashboard/MarketTicker'
import { AgentCard } from '~/components/agents/AgentCard'
import {
  agents,
  getPerformanceSeries,
  marketIndices,
  portfolioSummary,
} from '~/data/mockData'
import { formatCurrency, formatPercent, formatSignedCurrency } from '~/lib/format'
import type { TimeRange } from '~/types'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const [range, setRange] = useState<TimeRange>('1M')

  // Purely local recomputation — no request is made when the range changes.
  const performance = useMemo(() => getPerformanceSeries(range), [range])

  const { currency } = portfolioSummary
  const activeAgents = agents.filter((agent) => agent.status === 'running').length

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-12">
      <section className="pt-6" aria-labelledby="overview-heading">
        <div className="flex items-center justify-between gap-4">
          <h1 id="overview-heading" className="text-sm font-medium text-content">
            Översikt
          </h1>
          <AgentPulse count={activeAgents} />
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3">
          <Stat
            label="Portföljvärde"
            size="hero"
            value={formatCurrency(portfolioSummary.totalValue, currency)}
          />
          <div className="flex items-center gap-3 pb-2">
            <ChangeValue
              value={portfolioSummary.dayChangePercent}
              showIcon={false}
              className="rounded-md bg-surface px-2 py-1 text-sm"
            />
            <span className="tabular text-sm text-content-subtle">
              {formatSignedCurrency(portfolioSummary.dayChange, currency)} idag
            </span>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          <Stat
            label="Senaste månaden"
            size="md"
            tone={portfolioSummary.monthChangePercent >= 0 ? 'positive' : 'negative'}
            value={formatPercent(portfolioSummary.monthChangePercent)}
          />
          <Stat
            label="Tillgängligt kapital"
            size="md"
            value={formatCurrency(portfolioSummary.cashBalance, currency)}
          />
          <Stat
            label="Köpkraft"
            size="md"
            value={formatCurrency(portfolioSummary.buyingPower, currency)}
          />
          <Stat
            label="Investerat kapital"
            size="md"
            value={formatCurrency(portfolioSummary.investedCapital, currency)}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DashboardCard
          title="Utveckling"
          className="lg:col-span-2"
          action={<TimeRangeSelector value={range} onChange={setRange} />}
        >
          <PerformanceChart data={performance} range={range} />
        </DashboardCard>

        <DashboardCard title="Marknad">
          <MarketTickerList quotes={marketIndices} />
        </DashboardCard>
      </div>

      <section aria-labelledby="agent-activity-heading">
        <SectionHeading
          action={
            <Link
              to="/agents"
              className="inline-flex items-center gap-1.5 rounded-sm text-xs text-content-muted transition-colors duration-150 hover:text-content"
            >
              Alla agenter
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
        >
          <span id="agent-activity-heading">Agentaktivitet</span>
        </SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {agents.slice(0, 4).map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
        <p className="mt-4 text-xs text-content-subtle">
          Agenterna och deras resultat är simulerade. Innehållet utgör inte
          investeringsrådgivning.
        </p>
      </section>
    </div>
  )
}

/** Live fleet indicator — links straight into the agent view. */
function AgentPulse({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="text-xs text-content-subtle">Inga agenter arbetar just nu</span>
    )
  }
  return (
    <Link
      to="/agents"
      className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs text-content-muted transition-colors duration-150 hover:bg-surface-2 hover:text-content"
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      {count === 1 ? '1 agent arbetar' : `${count} agenter arbetar`}
    </Link>
  )
}
