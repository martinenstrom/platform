import { createFileRoute } from '@tanstack/react-router'
import { FileText, Plus } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { AnalysisStatusBadge } from '~/components/ui/StatusBadge'
import { Table, TableWrapper, Td, Th, Tr } from '~/components/ui/Table'
import { reports } from '~/data/mockData'
import { formatDate } from '~/lib/format'

export const Route = createFileRoute('/reports')({
  component: ReportsPage,
})

function ReportsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Rapporter"
        description="Genererade rapporter och underlag. Exempeldata."
        actions={
          <Button variant="primary" size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Ny rapport
          </Button>
        }
      />

      <DashboardCard title="Alla rapporter">
        <TableWrapper>
          <Table>
            <caption className="sr-only">Genererade rapporter med status.</caption>
            <thead>
              <tr>
                <Th>Titel</Th>
                <Th>Typ</Th>
                <Th>Skapad</Th>
                <Th align="right">Sidor</Th>
                <Th>Status</Th>
                <Th align="right">Åtgärd</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <Tr key={report.id}>
                  <Td className="text-sm font-medium">{report.title}</Td>
                  <Td className="text-sm text-content-muted">{report.type}</Td>
                  <Td className="tabular text-sm whitespace-nowrap text-content-muted">
                    {formatDate(report.createdAt)}
                  </Td>
                  <Td numeric>{report.pages || '—'}</Td>
                  <Td>
                    <AnalysisStatusBadge status={report.status} />
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={report.status !== 'completed'}
                      aria-label={`Öppna rapporten ${report.title}`}
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      Öppna
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      </DashboardCard>
    </PageShell>
  )
}
