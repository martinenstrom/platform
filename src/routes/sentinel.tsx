import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Radar } from 'lucide-react'
import { PageShell } from '~/components/layout/PageHeader'
import { SentinelQueue } from '~/components/sentinel/SentinelQueue'
import type { SentinelActions } from '~/components/sentinel/sentinelActions'
import { EmptyState } from '~/components/ui/EmptyState'
import {
  disposePriorityFn,
  getSentinelBriefFn,
} from '~/infrastructure/advisory/serverFns'

/**
 * Sentinel — the cross-client work queue, and the answer to *who needs me
 * today, why, and what should I prepare?*
 *
 * The brief is derived on the server from the same record Client 360
 * shows, on the advisory clock; the page renders it and records the
 * advisor's word on a priority through the same door, then re-reads.
 */
export const Route = createFileRoute('/sentinel')({
  loader: () => getSentinelBriefFn(),
  component: SentinelPage,
})

function SentinelPage() {
  const response = Route.useLoaderData()
  const router = useRouter()
  if (!response.ok) {
    return (
      <PageShell>
        <EmptyState
          icon={Radar}
          title="Sentinel kunde inte läsa relationerna"
          description="Relationsminnet svarar inte just nu. Inga prioriteringar visas förrän det gör det."
        />
      </PageShell>
    )
  }
  const actions: SentinelActions = {
    dispose: (input) => disposePriorityFn({ data: input }),
  }
  return (
    <PageShell className="gap-2">
      <SentinelQueue
        brief={response.brief}
        actions={actions}
        onChanged={() => router.invalidate()}
      />
    </PageShell>
  )
}
