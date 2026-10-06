import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'
import { ModuleIcon } from './Module'

/**
 * A metric of the dossier: the icon in its ring and the label on one line,
 * the figure in the display face beneath, then at most two supporting
 * lines and one small visual — a bar, a ring, a scale. A mini intelligence
 * card, not a cell in a table: the number first, the qualification second,
 * nothing else.
 */
export function MetricCard({
  icon,
  label,
  value,
  lead = false,
  support,
  visual,
  className,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  /** The first, heaviest figure: larger, in the gold. */
  lead?: boolean
  /** One or two short lines under the figure. */
  support?: ReactNode
  /** A bar, a ring or a scale beneath the support. */
  visual?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('ref-panel flex min-w-0 flex-col px-4 pt-3.5 pb-4', className)}>
      <div className="flex items-center gap-2.5">
        <ModuleIcon icon={icon} className="h-7 w-7" size={13} />
        <dt className="type-section truncate text-[9.5px] tracking-[0.11em]">{label}</dt>
      </div>
      <dd className="mt-3 flex min-h-0 flex-1 flex-col">
        <span
          className={cn(
            'whitespace-nowrap',
            lead ? 'type-display-figure text-institution' : 'type-display-figure-sm',
          )}
        >
          {value}
        </span>
        {support && (
          <span className="type-inst-sub mt-2 block leading-[1.05rem]">{support}</span>
        )}
        {visual && <span className="mt-auto block pt-2.5">{visual}</span>}
      </dd>
    </div>
  )
}

/* ------------------------------------------------------------ visuals */

const TONE_BAR = {
  gold: 'bg-institution',
  positive: 'bg-positive',
  warning: 'bg-warning',
  negative: 'bg-negative',
  neutral: 'bg-content-subtle',
} as const

export type VisualTone = keyof typeof TONE_BAR

/** A thin bar: the share filled, the track the hairline. */
export function Bar({ percent, tone = 'gold' }: { percent: number; tone?: VisualTone }) {
  return (
    <span
      className="block h-[4px] w-full overflow-hidden rounded-[1px] bg-hairline-strong"
      aria-hidden="true"
    >
      <span
        className={cn('block h-full rounded-[1px]', TONE_BAR[tone])}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </span>
  )
}

/** A small ring: the share drawn once, with the number beside it. */
export function Ring({
  percent,
  label,
  size = 32,
}: {
  percent: number
  label?: ReactNode
  size?: number
}) {
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  return (
    <span className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(150 172 210 / 0.22)"
          strokeWidth="2.5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2b45a"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, percent))) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {label && <span className="type-inst-sub">{label}</span>}
    </span>
  )
}

/** A stepped scale: `value` of `steps` lit. */
export function Scale({ value, steps }: { value: number; steps: number }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-[5px] w-[12px] rounded-[1px]',
            i < value ? 'bg-institution' : 'bg-hairline-strong',
          )}
        />
      ))}
    </span>
  )
}
