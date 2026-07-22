import type { ElementType, ReactNode } from 'react'
import { cn } from '~/lib/cn'

interface DashboardCardProps {
  title?: string
  /** Right-aligned slot for filters or a single action. */
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** Renders the card as another element, e.g. `article` inside a feed. */
  as?: ElementType
}

/**
 * The card shell used across every page.
 * Depth comes from the raised surface and its shadow — no outline, no header
 * divider. Padding sits on the 8px grid (24px inset, 16px header gap).
 */
export function DashboardCard({
  title,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
}: DashboardCardProps) {
  return (
    <Tag className={cn('flex flex-col rounded-xl bg-surface p-6 shadow-card', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-4">
          {title && (
            <h2 className="truncate text-sm font-medium text-content">{title}</h2>
          )}
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn('flex-1', bodyClassName)}>{children}</div>
    </Tag>
  )
}

/** Section label for grouping cards on a page. */
export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="text-sm font-medium text-content">{children}</h2>
      {action}
    </div>
  )
}
