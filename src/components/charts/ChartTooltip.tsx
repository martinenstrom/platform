import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

interface TooltipRow {
  label: string
  value: string
  color?: string
}

/**
 * The ground adapts to the surrounding theme; everything else — structure,
 * type, spacing, swatches — stays identical, so consistency comes from the
 * component, not from forcing one background everywhere. The ink tokens read
 * correctly on both dark grounds, so only the surface + hairline change.
 */
const TOOLTIP_SURFACE = {
  app: 'bg-surface-3',
  overview: 'bg-[rgba(6,18,29,0.96)] ring-1 ring-[rgba(70,130,163,0.3)]',
} as const

/** Shared tooltip surface so every chart reads identically on hover. */
export function ChartTooltip({
  title,
  rows,
  footer,
  surface = 'app',
}: {
  title: string
  rows: TooltipRow[]
  footer?: ReactNode
  /** Which theme's ground to sit on — structure is the same either way. */
  surface?: keyof typeof TOOLTIP_SURFACE
}) {
  return (
    <div
      className={cn(
        'chart-tooltip-in rounded-lg px-3 py-2.5 shadow-pop',
        TOOLTIP_SURFACE[surface],
      )}
    >
      <p className="text-xs font-medium text-content">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-xs">
            {row.color && (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-xs"
                style={{ backgroundColor: row.color }}
              />
            )}
            <span className="text-content-muted">{row.label}</span>
            <span className="tabular ml-auto font-medium text-content">{row.value}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1.5 text-[11px] text-content-subtle">{footer}</div>}
    </div>
  )
}
