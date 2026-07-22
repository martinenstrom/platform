import { cn } from '~/lib/cn'
import { ChangeValue } from '~/components/ui/ChangeValue'
import { formatCurrency, formatNumber } from '~/lib/format'
import type { MarketIndexQuote } from '~/types'

/** One index/FX row: name, current level, signed change. */
export function MarketTicker({
  quote,
  className,
}: {
  quote: MarketIndexQuote
  className?: string
}) {
  const value = quote.currency
    ? formatCurrency(quote.value, quote.currency)
    : formatNumber(quote.value, quote.precision)

  return (
    <li
      className={cn(
        'flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2',
        className,
      )}
    >
      <span className="min-w-0 truncate text-sm text-content">{quote.name}</span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="tabular text-sm font-medium text-content">{value}</span>
        <ChangeValue
          value={quote.changePercent}
          showIcon={false}
          className="w-16 justify-end text-xs"
        />
      </span>
    </li>
  )
}

export function MarketTickerList({ quotes }: { quotes: MarketIndexQuote[] }) {
  return (
    <ul className="-mx-2 flex flex-col">
      {quotes.map((quote) => (
        <MarketTicker key={quote.id} quote={quote} />
      ))}
    </ul>
  )
}
