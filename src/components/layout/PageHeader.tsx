import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

interface PageHeaderProps {
  title: string
  description?: string
  /** Toolbar slot: filters, segmented controls, primary actions. */
  actions?: ReactNode
  className?: string
}

/** Page heading and toolbar row. No divider — whitespace separates it instead. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 pt-6 lg:flex-row lg:items-center lg:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-content">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-content-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
      )}
    </div>
  )
}

/** Standard page body wrapper — one place controls page rhythm and max width. */
export function PageShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mx-auto flex max-w-[1400px] flex-col gap-10', className)}>
      {children}
    </div>
  )
}
