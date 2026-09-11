import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

/**
 * A region of the workstation.
 *
 * Reference-matched geometry: a thin border on a layered navy ground, a single
 * pixel of interior light along the top edge, a very small radius, and a
 * compact head band carrying an uppercase label with machine metadata opposite.
 * Panels **tile** — they are regions cut into one surface, not cards floating
 * above a page, which is the difference between an operating environment and a
 * dashboard.
 *
 * Deliberately not `DashboardCard`. That is a document component — 24px inset,
 * 16px header gap, a drop shadow that lifts it off the page — and a screen made
 * of them reads as separate applications tiled together.
 *
 * It stays a `<section>` with a real `<h2>`, so the structure a screen reader
 * walks is unchanged and every assertion written against the old cards still
 * finds its region.
 */
export function Panel({
  title,
  meta,
  children,
  className,
  bodyClassName,
  /** Marks the region as belonging to an independent control function. */
  governance = false,
}: {
  title: string
  /** Right-aligned fact or count. Never an action nobody can perform. */
  meta?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  governance?: boolean
}) {
  return (
    <section
      className={cn(
        'ref-panel flex min-w-0 flex-col',
        governance && 'inst-edge',
        className,
      )}
    >
      <header className="ref-head">
        <h2 className={cn('type-section truncate', governance && 'text-institution')}>
          {title}
        </h2>
        {meta && <span className="type-machine shrink-0">{meta}</span>}
      </header>
      <div className={cn('min-h-0 flex-1', bodyClassName ?? 'p-2')}>{children}</div>
    </section>
  )
}
