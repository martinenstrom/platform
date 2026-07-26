import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Stat } from '~/components/ui/Stat'
import { TimeRangeSelector } from '~/components/ui/TimeRangeSelector'
import { ChangeValue } from '~/components/ui/ChangeValue'
import { Table, TableWrapper, Td, Th, Tr } from '~/components/ui/Table'
import { PerformanceChart } from '~/components/charts/PerformanceChart'
import { AllocationChart } from '~/components/charts/AllocationChart'
import {
  allocation,
  getPerformanceSeries,
  holdings,
  portfolioSummary,
} from '~/data/mockData'
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
} from '~/lib/format'
import type { TimeRange } from '~/types'

export const Route = createFileRoute('/portfolio')({
  component: PortfolioPage,
})

function PortfolioPage() {
  const [range, setRange] = useState<TimeRange>('1Y')
  const performance = useMemo(() => getPerformanceSeries(range), [range])
  const allocationTotal = allocation.reduce((sum, slice) => sum + slice.value, 0)
  const { currency } = portfolioSummary

  return (
    <PageShell>
      <PageHeader
        title="Portfölj"
        description="Innehav, utveckling och fördelning. Exempeldata."
      />

      <div className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4">
        <Stat
          label="Portföljvärde"
          size="xl"
          value={formatCurrency(portfolioSummary.totalValue, currency)}
        />
        <Stat
          label="Orealiserat resultat"
          size="xl"
          tone={portfolioSummary.unrealizedResult >= 0 ? 'positive' : 'negative'}
          value={formatSignedCurrency(portfolioSummary.unrealizedResult, currency)}
          detail={
            <span className="text-content-subtle">
              {formatPercent(portfolioSummary.unrealizedResultPercent)}
            </span>
          }
        />
        <Stat
          label="Investerat kapital"
          size="xl"
          value={formatCurrency(portfolioSummary.investedCapital, currency)}
        />
        <Stat
          label="Köpkraft"
          size="xl"
          value={formatCurrency(portfolioSummary.buyingPower, currency)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DashboardCard
          title="Utveckling"
          className="lg:col-span-2"
          action={<TimeRangeSelector value={range} onChange={setRange} />}
        >
          <PerformanceChart data={performance} range={range} />
        </DashboardCard>

        <DashboardCard title="Fördelning">
          <AllocationChart data={allocation} total={allocationTotal} />
        </DashboardCard>
      </div>

      <DashboardCard title="Innehav">
        <TableWrapper>
          <Table>
            <caption className="sr-only">Portföljens innehav med värde och vikt.</caption>
            <thead>
              <tr>
                <Th>Instrument</Th>
                <Th align="right">Antal</Th>
                <Th align="right">GAV</Th>
                <Th align="right">Kurs</Th>
                <Th align="right">Värde</Th>
                <Th align="right">Idag</Th>
                <Th align="right">Vikt</Th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <Tr key={holding.id}>
                  <Td>
                    <span className="block text-sm text-content">{holding.name}</span>
                    <span className="type-metadata block">{holding.ticker}</span>
                  </Td>
                  <Td numeric>{formatNumber(holding.quantity, 0)}</Td>
                  <Td numeric>{formatNumber(holding.averagePrice)}</Td>
                  <Td numeric>{formatNumber(holding.lastPrice)}</Td>
                  <Td numeric>{formatCurrency(holding.marketValue, holding.currency)}</Td>
                  <Td numeric>
                    <ChangeValue
                      value={holding.changePercent}
                      showIcon={false}
                      className="justify-end"
                    />
                  </Td>
                  <Td numeric>{formatNumber(holding.weight, 1)} %</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      </DashboardCard>
    </PageShell>
  )
}
