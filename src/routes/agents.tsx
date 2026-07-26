import { createFileRoute } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { SectionHeading } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { AgentCard } from '~/components/agents/AgentCard'
import { AgentStatusDot } from '~/components/agents/AgentStatusDot'
import { agents, recentAnalyses } from '~/data/mockData'
import { formatDateTime } from '~/lib/format'
import type { AgentStatus } from '~/types'

export const Route = createFileRoute('/agents')({
  component: AgentsPage,
})

/** Fleet order: what needs attention first, then what is working, then idle. */
const STATUS_ORDER: AgentStatus[] = ['failed', 'running', 'finished', 'waiting']

function AgentsPage() {
  const sorted = [...agents].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  )

  return (
    <PageShell>
      <PageHeader
        title="Agenter"
        description="Dina agenter, vad de gör just nu och vad de senast kom fram till."
        actions={
          <Button variant="primary" size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Ny agent
          </Button>
        }
      />

      <section aria-label="Agentflotta">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </section>

      <section aria-labelledby="agent-runs-heading">
        <SectionHeading>
          <span id="agent-runs-heading">Senaste körningar</span>
        </SectionHeading>
        <ul className="flex flex-col">
          {recentAnalyses.map((run) => (
            <li
              key={run.id}
              className="flex items-center gap-4 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-surface"
            >
              <AgentStatusDot
                status={toAgentStatus(run.status)}
                className="w-16 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-content">
                  {run.instrument}
                </span>
                <span className="type-metadata block truncate">{run.type}</span>
              </span>
              <time dateTime={run.generatedAt} className="type-metadata tabular shrink-0">
                {formatDateTime(run.generatedAt)}
              </time>
            </li>
          ))}
        </ul>
        <p className="type-metadata mt-6">
          Simulerade agentkörningar. Innehållet utgör inte investeringsrådgivning.
        </p>
      </section>
    </PageShell>
  )
}

/** Analysis runs use their own status vocabulary; map it onto agent status. */
function toAgentStatus(status: (typeof recentAnalyses)[number]['status']): AgentStatus {
  switch (status) {
    case 'completed':
      return 'finished'
    case 'running':
      return 'running'
    case 'failed':
      return 'failed'
    case 'queued':
      return 'waiting'
  }
}
