import { cn } from '~/lib/cn'
import { ChangeValue } from '~/components/ui/ChangeValue'
import { formatNumber } from '~/lib/format'
import type { MarketTickerRow } from '~/presentation/marketData/marketsViewModel'

/** Shown wherever no approved source exists for an instrument. */
const NOT_AVAILABLE = 'Ej tillgänglig'

/**
 * One ticker row: name, current level, signed change.
 *
 * Takes a `MarketTickerRow` rather than a bare quote so a value can never
 * reach the screen without the route model knowing its state and provenance.
 * A row either has a number and a source, or it says it has neither.
 */
export function MarketTicker({
  row,
  className,
}: {
  row: MarketTickerRow
  className?: string
}) {
  return (
    <li
      className={cn(
        'flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2',
        className,
      )}
    >
      <span className="min-w-0 truncate text-sm text-content">
        {row.displayName}
        {row.isDemo && (
          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-content-subtle">
            Exempel
          </span>
        )}
      </span>
      {row.value === null ? (
        // No number at all — not a zero, and not a dash that could read as
        // "unchanged". The row states why it is empty.
        <span className="shrink-0 text-xs text-content-subtle">{NOT_AVAILABLE}</span>
      ) : (
        <span className="flex shrink-0 items-center gap-3">
          <span className="tabular text-sm font-medium text-content">
            {formatNumber(row.value, row.precision)}
          </span>
          {row.changePercent === null ? (
            <span className="w-16 text-right text-xs text-content-subtle">–</span>
          ) : (
            <ChangeValue
              value={row.changePercent}
              showIcon={false}
              className="w-16 justify-end text-xs"
            />
          )}
        </span>
      )}
    </li>
  )
}

export function MarketTickerList({ rows }: { rows: MarketTickerRow[] }) {
  return (
    <ul className="-mx-2 flex flex-col">
      {rows.map((row) => (
        <MarketTicker key={row.symbol} row={row} />
      ))}
    </ul>
  )
}
