import { createFileRoute } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { EmptyState } from '~/components/ui/EmptyState'
import { WatchlistTable } from '~/components/dashboard/WatchlistTable'
import { getWatchlistFn } from '~/infrastructure/marketData/serverFns'
import {
  toWatchlistRows,
  watchlistUnavailable,
} from '~/presentation/marketData/watchlistViewModel'
import { WATCHLIST_SYMBOLS } from '~/application/marketData/getWatchlist'

export const Route = createFileRoute('/watchlist')({
  loader: () => getWatchlistFn(),
  component: WatchlistPage,
})

function WatchlistPage() {
  const snapshot = Route.useLoaderData()
  const rows = toWatchlistRows({
    symbols: WATCHLIST_SYMBOLS,
    quotes: snapshot.quotes,
    sparklines: snapshot.sparklines,
    instruments: snapshot.instruments,
  })

  return (
    <PageShell>
      <PageHeader
        title="Bevakning"
        /*
         * Says what this list IS. It is curated by the product — the same six
         * instruments the Overview shows — not chosen by the reader and not
         * synchronized from any account.
         */
        description="En kuraterad bevakningslista över sex svenska instrument. Listan är vald av Stack och är inte kopplad till ett konto."
        actions={
          /*
           * Not a button. The previous control looked and behaved like a
           * working "add instrument" action and did nothing — a real watchlist
           * needs identity, persistence and add/remove, none of which exist.
           * A non-interactive note says so: no hover, no pointer, no focus
           * ring, nothing to click.
           */
          <span
            className="hud-label rounded-md px-2.5 py-1.5 text-[11px] text-content-subtle"
            aria-disabled="true"
          >
            Egen bevakningslista – kommer senare
          </span>
        }
      />

      <DashboardCard title="Bevakningslista">
        {watchlistUnavailable(snapshot.quotes) ? (
          <EmptyState
            icon={Star}
            title="Kurser kunde inte hämtas"
            description="Marknadsdata är inte tillgänglig just nu. Inga uppskattade eller tidigare kurser visas."
          />
        ) : (
          <WatchlistTable items={rows} />
        )}
      </DashboardCard>

      <DashboardCard title="Delade listor">
        <EmptyState
          icon={Star}
          title="Inga delade listor ännu"
          description="Listor som delas i teamet visas här när samarbetsfunktionerna aktiveras."
          action={
            <Button variant="secondary" size="sm">
              Skapa lista
            </Button>
          }
        />
      </DashboardCard>
    </PageShell>
  )
}
