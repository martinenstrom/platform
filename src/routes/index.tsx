import { createFileRoute } from '@tanstack/react-router'
import { LightCommandCenter } from '~/components/lightDashboard/LightCommandCenter'
import { getOverviewSnapshotFn } from '~/infrastructure/marketData/serverFns'

/**
 * The Overview: a full-bleed, light-theme financial command center (see
 * `LightCommandCenter`) with its own Wall Street navigation column. The
 * previous dark globe hero and its widgets remain in the codebase under
 * `components/countryExplorer` and power the country-analysis modal.
 *
 * Data is assembled server-side into one `OverviewSnapshot` and handed to the
 * component as a prop, so first paint is fully rendered — no spinner, no
 * layout shift, and one coherent `asOf` across every panel.
 */
export const Route = createFileRoute('/')({
  loader: () => getOverviewSnapshotFn(),
  component: DashboardPage,
})

function DashboardPage() {
  const snapshot = Route.useLoaderData()
  return <LightCommandCenter snapshot={snapshot} />
}
