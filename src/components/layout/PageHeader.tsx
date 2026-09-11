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
        'flex flex-col gap-3 lg:flex-row lg:items-baseline lg:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        {/*
         * Title and summary on one baseline. A stacked heading block pushes the
         * work down the screen; on a workstation the heading is a label on the
         * environment, not a cover page for it.
         */}
        <h1 className="type-heading text-institution">{title}</h1>
        {description && <p className="type-metadata">{description}</p>}
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
    /*
     * Wide and tight. The Command Center is a workstation: it fills the screen
     * it is given, and the rhythm between sections is a hairline's worth of
     * space rather than a document's.
     */
    <div className={cn('mx-auto flex w-full max-w-[1920px] flex-col gap-4', className)}>
      {children}
    </div>
  )
}
