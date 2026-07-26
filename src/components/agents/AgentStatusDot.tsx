import { cn } from '~/lib/cn'
import type { AgentStatus } from '~/types'

export const AGENT_STATUS_META: Record<
  AgentStatus,
  { label: string; dot: string; text: string }
> = {
  running: { label: 'Kör', dot: 'bg-accent', text: 'text-accent' },
  finished: { label: 'Klar', dot: 'bg-positive', text: 'text-positive' },
  waiting: { label: 'Väntar', dot: 'bg-content-subtle', text: 'text-content-subtle' },
  failed: { label: 'Fel', dot: 'bg-negative', text: 'text-negative' },
}

/**
 * Status dot plus its word — the label is always present, so status never
 * depends on colour alone. Only `running` animates.
 */
export function AgentStatusDot({
  status,
  className,
}: {
  status: AgentStatus
  className?: string
}) {
  const meta = AGENT_STATUS_META[status]
  return (
    <span
      className={cn(
        'type-badge inline-flex items-center gap-2',
        meta.text,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        {status === 'running' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
        )}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', meta.dot)} />
      </span>
      {meta.label}
    </span>
  )
}
