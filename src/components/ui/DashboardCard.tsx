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
  /**
   * Terminal-density variant: tighter inset (16px), smaller title and a
   * reduced header gap — for information-dense dashboard widgets.
   */
  dense?: boolean
}

/**
 * The card shell used across every page.
 * Depth comes from the raised surface and its shadow — no outline, no header
 * divider. Padding sits on the 8px grid (24px inset, 16px header gap; the
 * `dense` variant tightens both).
 */
export function DashboardCard({
  title,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
  dense = false,
}: DashboardCardProps) {
  return (
    <Tag
      className={cn(
        'hud-frame flex flex-col rounded-xl bg-surface shadow-card',
        dense ? 'p-4' : 'p-6',
        className,
      )}
    >
      {(title || action) && (
        <header
          className={cn(
            'flex items-center justify-between gap-4',
            dense ? 'mb-2.5' : 'mb-4',
          )}
        >
          {title && (
            <h2
              className={cn(
                'hud-label truncate text-content-muted',
                dense ? 'text-[11px]' : 'text-xs',
              )}
            >
              {title}
            </h2>
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
      <h2 className="hud-label text-xs text-content-muted">{children}</h2>
      {action}
    </div>
  )
}
