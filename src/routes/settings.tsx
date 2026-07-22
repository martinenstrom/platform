import { createFileRoute } from '@tanstack/react-router'
import { Plug, ShieldCheck } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusBadge } from '~/components/ui/StatusBadge'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

const PREFERENCES = [
  { id: 'currency', label: 'Visningsvaluta', value: 'SEK' },
  { id: 'locale', label: 'Språk och format', value: 'Svenska (sv-SE)' },
  { id: 'timezone', label: 'Tidszon', value: 'Europa/Stockholm' },
  { id: 'benchmark', label: 'Jämförelseindex', value: 'OMXS30' },
]

function SettingsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Inställningar"
        description="Kontoinställningar, format och framtida datakällor."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <DashboardCard title="Visning" className="lg:col-span-6" bodyClassName="p-0">
          <dl className="divide-y divide-line">
            {PREFERENCES.map((preference) => (
              <div
                key={preference.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <dt className="text-sm text-content-muted">{preference.label}</dt>
                <dd className="flex items-center gap-2">
                  <span className="text-sm text-content">{preference.value}</span>
                  <Button variant="ghost" size="sm">
                    Ändra
                  </Button>
                </dd>
              </div>
            ))}
          </dl>
        </DashboardCard>

        <DashboardCard title="Datakällor" className="lg:col-span-6">
          <ul className="flex flex-col gap-2">
            <li className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
              <span className="flex items-center gap-2.5">
                <Plug className="h-4 w-4 text-content-subtle" aria-hidden="true" />
                <span>
                  <span className="block text-sm text-content">Avanza (MCP)</span>
                  <span className="block text-xs text-content-subtle">
                    Läsning av innehav och kurser
                  </span>
                </span>
              </span>
              <StatusBadge tone="warning">Ej ansluten</StatusBadge>
            </li>
            <li className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
              <span className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 text-content-subtle" aria-hidden="true" />
                <span>
                  <span className="block text-sm text-content">Analysagenter</span>
                  <span className="block text-xs text-content-subtle">
                    Genererar briefer och uppslag
                  </span>
                </span>
              </span>
              <StatusBadge tone="accent">Simulerad</StatusBadge>
            </li>
          </ul>
        </DashboardCard>
      </div>

      <DashboardCard title="Notiser">
        <EmptyState
          icon={ShieldCheck}
          title="Notisregler saknas"
          description="Regler för kurslarm och analysnotiser konfigureras här i ett senare steg."
          action={
            <Button variant="secondary" size="sm">
              Skapa regel
            </Button>
          }
        />
      </DashboardCard>
    </PageShell>
  )
}
