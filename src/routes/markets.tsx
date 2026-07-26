import { createFileRoute } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { MarketTickerList } from '~/components/dashboard/MarketTicker'
import { getMarketsFn } from '~/infrastructure/marketData/serverFns'
import {
  MARKETS_CRYPTO_SYMBOLS,
  MARKETS_FX_SYMBOLS,
  MARKETS_INDEX_INTL_SYMBOLS,
  MARKETS_INDEX_SE_SYMBOLS,
  MARKETS_TICKER_ORDER,
} from '~/application/marketData/getMarkets'
import {
  MARKET_INTELLIGENCE_ROWS,
  toMarketTickerRows,
} from '~/presentation/marketData/marketsViewModel'

export const Route = createFileRoute('/markets')({
  loader: () => getMarketsFn(),
  component: MarketsPage,
})

function MarketsPage() {
  const snapshot = Route.useLoaderData()
  const rows = toMarketTickerRows({
    order: MARKETS_TICKER_ORDER,
    groups: [
      { symbols: MARKETS_INDEX_SE_SYMBOLS, envelope: snapshot.indicesSe },
      { symbols: MARKETS_INDEX_INTL_SYMBOLS, envelope: snapshot.indicesIntl },
      { symbols: MARKETS_FX_SYMBOLS, envelope: snapshot.fx },
      { symbols: MARKETS_CRYPTO_SYMBOLS, envelope: snapshot.crypto },
    ],
    instruments: snapshot.instruments,
  })

  return (
    <PageShell>
      <PageHeader
        title="Marknader"
        /*
         * Neither "all live" nor "all example data" is true any more. Four rows
         * come from real sources, two have no approved source, and the analysis
         * panel has none at all — so the description says that rather than
         * picking one story for the whole page.
         */
        description="Fördröjda marknadsnoteringar där källa finns. Instrument utan godkänd källa och kommande analysfunktioner visas som ej tillgängliga."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Titled for what it holds: indices, FX and crypto, not just the first two. */}
        <DashboardCard title="Index, valutor och krypto">
          <MarketTickerList rows={rows} />
        </DashboardCard>

        <DashboardCard title="Marknadsklimat">
          {/*
           * Every row is unavailable, and nothing here can compute one. Breadth
           * needs OMXS30 constituents, trend strength needs moving averages
           * over real history, volatility needs options data, and flows need
           * positioning data. The card is the landing place for the future
           * Market Intelligence panel; the statistics it used to show were
           * invented and read as measurements.
           */}
          <dl className="flex flex-col gap-5">
            {MARKET_INTELLIGENCE_ROWS.map((row) => (
              <div key={row.id} className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-content-muted">{row.label}</dt>
                <dd className="text-sm text-content-subtle">Ej tillgänglig</dd>
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
