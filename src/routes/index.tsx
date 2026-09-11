import { createFileRoute } from '@tanstack/react-router'
import { LightCommandCenter } from '~/components/lightDashboard/LightCommandCenter'
import { getOverviewSnapshotFn } from '~/infrastructure/marketData/serverFns'

/**
 * Kommandocentralen — the Financial OS home, and the answer to *what is
 * happening in the world?*
 *
 * ## Why the market is here and the firm is not
 *
 * This page has changed hands twice, and the second move is the one that
 * settled it. The Command Center v1 gate put the institution on `/` and moved
 * the market overview to `/markets`; the ruling that followed reversed the
 * placement. Opening Financial OS lands on the world, not on the firm's own
 * floor — and the firm's floor is a destination you go to, at `/headquarters`,
 * where the CIO, the desks, the control functions and the work all live
 * together.
 *
 * **Nothing here was rebuilt for the move.** This is the same truthful market
 * experience that has been through the chart, globe and hero work, rendered by
 * the same `LightCommandCenter` from the same `OverviewSnapshot`. The route
 * moved; the screen did not change.
 *
 * ## What may never appear on this page
 *
 * No Agent Network, no CIO synthesis, no governance floor, no institutional
 * workflow. Those are the firm's own state, they belong on Huvudkontoret, and
 * rendering them in both places is what made the two pages one page twice
 * over. Market context is the whole subject here.
 *
 * Data is assembled server-side into one `OverviewSnapshot` and handed to the
 * component as a prop, so first paint is fully rendered — no spinner, no layout
 * shift, and one coherent `asOf` across every panel.
 */
export const Route = createFileRoute('/')({
  loader: () => getOverviewSnapshotFn(),
  component: HomePage,
})

function HomePage() {
  const snapshot = Route.useLoaderData()
  return <LightCommandCenter snapshot={snapshot} />
}
