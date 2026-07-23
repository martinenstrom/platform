import { ChangeValue } from '~/components/ui/ChangeValue'
import { formatCurrency, formatNumber } from '~/lib/format'
import type { MarketIndexQuote } from '~/types'

/**
 * A compact horizontal strip for the Global Command Center's minimal header
 * chrome — distinct from the full vertical `MarketTickerList` card further
 * down the Overview page (same underlying `marketIndices` data, no
 * duplication, just a smaller presentation for this context).
 */
export function GlobalMarketTicker({ quotes }: { quotes: MarketIndexQuote[] }) {
  return (
    <ul className="flex items-center gap-4 overflow-x-auto">
      {quotes.map((quote) => {
        const value = quote.currency
          ? formatCurrency(quote.value, quote.currency)
          : formatNumber(quote.value, quote.precision)
        return (
          <li
            key={quote.id}
            className="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap"
          >
            <span className="text-content-subtle">{quote.name}</span>
            <span className="tabular font-medium text-content">{value}</span>
            <ChangeValue
              value={quote.changePercent}
              showIcon={false}
              className="text-[11px]"
            />
          </li>
        )
      })}
    </ul>
  )
}
