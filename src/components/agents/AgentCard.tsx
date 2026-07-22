import { cn } from '~/lib/cn'
import { formatRelativeTime } from '~/lib/format'
import { MOCK_NOW } from '~/data/mockData'
import type { Agent } from '~/types'
import { AgentStatusDot } from './AgentStatusDot'

/**
 * One agent in the fleet. Reads top-down: who it is, what state it is in, what
 * it is doing or found. The result line is the payload — it gets the emphasis.
 */
export function AgentCard({ agent, className }: { agent: Agent; className?: string }) {
  return (
    <article
      className={cn(
        'group flex flex-col rounded-xl bg-surface p-5 shadow-card transition-colors duration-150 hover:bg-surface-2',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="truncate text-sm font-medium text-content">{agent.name}</h3>
        <AgentStatusDot status={agent.status} className="shrink-0" />
      </header>

      <p className="mt-3 text-sm leading-relaxed text-content-muted">
        {agent.result ?? agent.activity}
      </p>

      {agent.status === 'running' && agent.progress !== undefined && (
        <div
          className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={agent.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Förlopp för ${agent.name}`}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${agent.progress}%` }}
          />
        </div>
      )}

      <footer className="mt-4 flex items-center justify-between gap-3 text-xs text-content-subtle">
        <span className="truncate">{agent.result ? agent.activity : agent.role}</span>
        <time dateTime={agent.lastRunAt} className="shrink-0">
          {formatRelativeTime(agent.lastRunAt, MOCK_NOW)}
        </time>
      </footer>
    </article>
  )
}
