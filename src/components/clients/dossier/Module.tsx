import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

/**
 * A module of the dossier.
 *
 * One frame for every analytical, relational and contextual block on
 * Client 360: the panel surface, a quiet head — the icon in its gold ring,
 * the label, the fact or the door opposite — and the body. The head is set
 * inside the padding rather than as a band, so a module reads as a
 * composed page element, not a window with a title bar.
 *
 * It stays a `<section>` with a real `<h2>`, so the structure a screen
 * reader walks is the page's own and every assertion written against a
 * heading still finds its region.
 */
export function Module({
  id,
  title,
  icon,
  meta,
  action,
  label,
  children,
  className,
  bodyClassName,
}: {
  id?: string
  title: string
  icon?: LucideIcon
  /** A fact or a count beside the title. Never an action nobody can perform. */
  meta?: ReactNode
  /** A door: a chevron or a quiet text link, at the head's right. */
  action?: ReactNode
  /** An accessible name other than the title, where the title alone would mislead. */
  label?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={cn('ref-panel flex min-w-0 flex-col', id && 'dossier-target', className)}
    >
      <ModuleHead title={title} icon={icon} meta={meta} action={action} />
      <div className={cn('min-h-0 flex-1 px-5 pb-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function ModuleHead({
  title,
  icon: Icon,
  meta,
  action,
  className,
}: {
  title: string
  icon?: LucideIcon
  meta?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn('flex items-center justify-between gap-3 px-5 pt-4 pb-3', className)}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <ModuleIcon icon={Icon} />}
        <h2 className="type-section truncate text-content">{title}</h2>
      </div>
      {meta && <span className="type-machine shrink-0 text-right">{meta}</span>}
      {action}
    </header>
  )
}

/** The icon in its thin gold ring: the one ornament a module carries. */
export function ModuleIcon({
  icon: Icon,
  className,
  size = 14,
}: {
  icon: LucideIcon
  className?: string
  size?: number
}) {
  return (
    <span aria-hidden="true" className={cn('dossier-icon', className)}>
      <Icon style={{ width: size, height: size }} strokeWidth={1.6} />
    </span>
  )
}

/** A line of rows cut by hairlines; each child carries `dossier-row`. */
export function Rows({
  as: Tag = 'ul',
  children,
  className,
  label,
}: {
  as?: 'ul' | 'ol'
  children: ReactNode
  className?: string
  label?: string
}) {
  return (
    <Tag aria-label={label} className={cn('flex flex-col', className)}>
      {children}
    </Tag>
  )
}

/** What a module says when it has nothing: one quiet sentence, never an empty frame. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="type-inst-sub py-1">{children}</p>
}

/** The machine line at a module's foot: method, counts, dates. */
export function Foot({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p className={cn('type-machine mt-3 border-t border-hairline pt-2.5', className)}>
      {children}
    </p>
  )
}

/** A label-over-value pair inside a module, for a short row of facts. */
export function Fact({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="type-section">{label}</dt>
      <dd className="mt-1 text-[13px] leading-snug text-content">{children}</dd>
    </div>
  )
}
