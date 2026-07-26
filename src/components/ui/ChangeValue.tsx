import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cn } from '~/lib/cn'
import { changeTone, formatPercent } from '~/lib/format'
import { toneText } from '~/lib/tone'

interface ChangeValueProps {
  value: number
  /** Pre-formatted text; defaults to a signed percentage. */
  label?: string
  showIcon?: boolean
  className?: string
}

/** Signed value with consistent green/red/neutral colouring. */
export function ChangeValue({
  value,
  label,
  showIcon = true,
  className,
}: ChangeValueProps) {
  const tone = changeTone(value)
  const Icon =
    tone === 'positive' ? TrendingUp : tone === 'negative' ? TrendingDown : Minus

  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 font-medium',
        toneText[tone],
        className,
      )}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {label ?? formatPercent(value)}
    </span>
  )
}
