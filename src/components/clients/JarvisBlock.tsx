import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

/**
 * The intelligence layer's one visual language.
 *
 * JARVIS is not a chat window. Wherever the product shows what JARVIS
 * noticed, understood or recommends, it does so through this block: a
 * compact uppercase mark naming the kind of statement, a hairline of the
 * market accent along the left edge, and the statement in the product's
 * own type. No glow, no pulse, no avatar — the intelligence reads as part
 * of the workstation, not as a visitor to it.
 */

export type JarvisKind =
  'insight' | 'signal' | 'alert' | 'understood' | 'recommends' | 'ask'

const KIND_LABEL: Record<JarvisKind, string> = {
  insight: 'JARVIS insikt',
  signal: 'JARVIS signal',
  alert: 'JARVIS varning',
  understood: 'JARVIS förstod',
  recommends: 'JARVIS rekommenderar',
  ask: 'Fråga JARVIS',
}

const KIND_TONE: Record<JarvisKind, string> = {
  insight: 'text-accent',
  signal: 'text-accent',
  alert: 'text-warning',
  understood: 'text-accent',
  recommends: 'text-institution',
  ask: 'text-accent',
}

const KIND_EDGE: Record<JarvisKind, string> = {
  insight: 'shadow-[inset_2px_0_0_0_var(--color-hud-line)]',
  signal: 'shadow-[inset_2px_0_0_0_var(--color-hud-line)]',
  alert: 'shadow-[inset_2px_0_0_0_var(--color-warning)]',
  understood: 'shadow-[inset_2px_0_0_0_var(--color-hud-line)]',
  recommends: 'shadow-[inset_2px_0_0_0_var(--color-institution-line)]',
  ask: 'shadow-[inset_2px_0_0_0_var(--color-hud-line)]',
}

export function JarvisMark({
  kind,
  className,
}: {
  kind: JarvisKind
  className?: string
}) {
  return (
    <span
      className={cn(
        'type-section inline-flex items-center gap-1.5',
        KIND_TONE[kind],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
      {KIND_LABEL[kind]}
    </span>
  )
}

export function JarvisBlock({
  kind,
  children,
  meta,
  className,
  as: Tag = 'div',
}: {
  kind: JarvisKind
  children: ReactNode
  /** Right-aligned machine metadata: a priority, a date, a method. */
  meta?: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article' | 'li'
}) {
  return (
    <Tag className={cn('ref-module px-3 py-2', KIND_EDGE[kind], className)}>
      <div className="flex items-center justify-between gap-2">
        <JarvisMark kind={kind} />
        {meta && <span className="type-machine shrink-0">{meta}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </Tag>
  )
}

export const JARVIS_KIND_LABEL = KIND_LABEL
