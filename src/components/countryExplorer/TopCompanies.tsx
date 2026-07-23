import { DashboardCard } from '~/components/ui/DashboardCard'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { Table, TableWrapper, Td, Th, Tr } from '~/components/ui/Table'
import { DataNotAvailable } from './DataSourceBadge'
import type { AnalystConsensus, TopCompany } from '~/types/countryExplorer'
import type { Tone } from '~/types'

const CONSENSUS_TONE: Record<AnalystConsensus, Tone> = {
  Köp: 'positive',
  Behåll: 'neutral',
  Sälj: 'negative',
}

/**
 * Its own tab in the Country Analysis window. Companies aren't clickable yet
 * — the spec itself frames opening a per-company analysis as a later step.
 */
export function TopCompanies({ companies }: { companies: TopCompany[] }) {
  if (companies.length === 0) {
    return (
      <section aria-labelledby="top-companies-heading">
        <h3 id="top-companies-heading" className="hud-label text-xs text-content-muted">
          Största börsnoterade bolag
        </h3>
        <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      </section>
    )
  }

  return (
    <DashboardCard title="Största börsnoterade bolag">
      <TableWrapper>
        <Table>
          <caption className="sr-only">De fem största börsnoterade bolagen.</caption>
          <thead>
            <tr>
              <Th>Bolag</Th>
              <Th>Sektor</Th>
              <Th align="right">Börsvärde</Th>
              <Th align="right">P/E</Th>
              <Th align="right">Direktavkastning</Th>
              <Th align="right">YTD</Th>
              <Th align="right">Analytikerkonsensus</Th>
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <Tr key={company.ticker}>
                <Td className="text-sm font-medium">
                  {company.name}
                  <span className="ml-2 text-xs text-content-subtle">
                    {company.ticker}
                  </span>
                </Td>
                <Td className="text-sm text-content-muted">{company.sector}</Td>
                <Td numeric>{company.marketCap}</Td>
                <Td numeric>{company.peRatio}</Td>
                <Td numeric>{company.dividendYield}</Td>
                <Td numeric>{company.ytdPerformance}</Td>
                <Td className="text-right">
                  <StatusBadge tone={CONSENSUS_TONE[company.analystConsensus]}>
                    {company.analystConsensus}
                  </StatusBadge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrapper>
    </DashboardCard>
  )
}
