import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}

/** Shared placeholder for pages and panels without data yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2">
        <Icon className="h-5 w-5 text-content-muted" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-content">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-content-muted">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
