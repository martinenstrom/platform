import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

type Size = 'md' | 'lg' | 'xl' | 'hero'

const VALUE_SIZE: Record<Size, string> = {
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-4xl',
  hero: 'text-5xl',
}

const TONE: Record<'default' | 'positive' | 'negative', string> = {
  default: 'text-content',
  positive: 'text-positive',
  negative: 'text-negative',
}

interface StatProps {
  label: string
  value: string
  /** Secondary line under the value — a change, a hint, anything short. */
  detail?: ReactNode
  size?: Size
  /** Colours the value itself; use only where the number is a signed result. */
  tone?: keyof typeof TONE
  className?: string
}

/**
 * A number and its label. Deliberately chrome-free: no card, no border — it sits
 * on whatever surface it is placed on, so stat rows read as one block.
 */
export function Stat({
  label,
  value,
  detail,
  size = 'lg',
  tone = 'default',
  className,
}: StatProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="type-label">{label}</p>
      <p
        className={cn(
          'tabular mt-2 font-semibold tracking-tight',
          VALUE_SIZE[size],
          TONE[tone],
        )}
      >
        {value}
      </p>
      {detail && <div className="mt-1.5 text-sm">{detail}</div>}
    </div>
  )
}
