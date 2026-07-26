import { Sparkline } from '~/components/charts/Sparkline'
import { ChangeValue } from '~/components/ui/ChangeValue'
import { SignalBadge } from '~/components/ui/StatusBadge'
import { Table, TableWrapper, Td, Th, Tr } from '~/components/ui/Table'
import { formatNumber } from '~/lib/format'
import type { WatchlistRow } from '~/presentation/marketData/watchlistViewModel'

/** Shown wherever a real value does not exist. Never a zero, never a dash of convenience. */
const NOT_AVAILABLE = 'Ej tillgänglig'

/**
 * The Signal column.
 *
 * It stays in the table because it is the landing place for real
 * agent-generated signals — produced by a specialist agent, challenged by the
 * Devil's Advocate, approved up the chain — not because it has anything to
 * show today. Until that exists, live mode says so plainly rather than
 * displaying a simulated buy/sell that reads as advice.
 */
function SignalCellContent({ row }: { row: WatchlistRow }) {
  if (row.signal.state === 'example') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <SignalBadge signal={row.signal.signal} />
        <span className="text-[10px] uppercase tracking-wide text-content-subtle">
          Exempel
        </span>
      </span>
    )
  }
  return <span className="text-xs text-content-subtle">{NOT_AVAILABLE}</span>
}

export function WatchlistTable({ items }: { items: WatchlistRow[] }) {
  return (
    <TableWrapper>
      <Table>
        <caption className="sr-only">
          Bevakade instrument med kurs, daglig utveckling och analyssignal.
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
            <Tr key={item.symbol}>
              <Td>
                <span className="block text-sm font-medium text-content">
                  {item.displayName}
                </span>
                <span className="block text-xs text-content-subtle">{item.ticker}</span>
              </Td>
              <Td numeric>
                {item.value === null ? (
                  <span className="text-content-subtle">–</span>
                ) : (
                  formatNumber(item.value, item.precision)
                )}
              </Td>
              <Td numeric>
                {item.changePercent === null ? (
                  <span className="text-content-subtle">–</span>
                ) : (
                  <ChangeValue
                    value={item.changePercent}
                    showIcon={false}
                    className="justify-end"
                  />
                )}
              </Td>
              <Td className="text-center">
                {/*
                 * Empty when no real history exists. `Sparkline` renders
                 * nothing below two points, so the row keeps its height and
                 * the column keeps its width — no placeholder curve, no
                 * decorative line standing in for market history.
                 */}
                <span className="inline-flex justify-center">
                  <Sparkline data={item.spark} trendUp={(item.changePercent ?? 0) >= 0} />
                </span>
              </Td>
              <Td className="text-right">
                <SignalCellContent row={item} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrapper>
  )
}
