import { createFileRoute } from '@tanstack/react-router'
import { LightCommandCenter } from '~/components/lightDashboard/LightCommandCenter'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

/**
 * The Overview: a full-bleed, light-theme financial command center (see
 * `LightCommandCenter`) with its own Wall Street navigation column. The
 * previous dark globe hero and its widgets remain in the codebase under
 * `components/countryExplorer` and power the country-analysis modal.
 */
function DashboardPage() {
  return <LightCommandCenter />
}
