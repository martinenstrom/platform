import { Sparkline } from '~/components/charts/Sparkline'
import { ChangeValue } from '~/components/ui/ChangeValue'
import { SignalBadge } from '~/components/ui/StatusBadge'
import { Table, TableWrapper, Td, Th, Tr } from '~/components/ui/Table'
import { formatNumber } from '~/lib/format'
import type { WatchlistItem } from '~/types'

export function WatchlistTable({ items }: { items: WatchlistItem[] }) {
  return (
    <TableWrapper>
      <Table>
        <caption className="sr-only">
          Bevakade instrument med kurs, daglig utveckling och simulerad signal.
        </caption>
        <thead>
          <tr>
            <Th>Instrument</Th>
            <Th align="right">Kurs</Th>
            <Th align="right">Idag</Th>
            <Th align="center">Trend</Th>
            <Th align="right">Signal</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <Tr key={item.id}>
              <Td>
                <span className="block text-sm font-medium text-content">
                  {item.name}
                </span>
                <span className="block text-xs text-content-subtle">{item.ticker}</span>
              </Td>
              <Td numeric>{formatNumber(item.price)}</Td>
              <Td numeric>
                <ChangeValue
                  value={item.changePercent}
                  showIcon={false}
                  className="justify-end"
                />
              </Td>
              <Td className="text-center">
                <span className="inline-flex justify-center">
                  <Sparkline data={item.spark} trendUp={item.changePercent >= 0} />
                </span>
              </Td>
              <Td className="text-right">
                <SignalBadge signal={item.signal} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrapper>
  )
}
