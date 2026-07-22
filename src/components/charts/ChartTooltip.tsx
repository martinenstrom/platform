import type { ReactNode } from 'react'

interface TooltipRow {
  label: string
  value: string
  color?: string
}

/** Shared tooltip surface so every chart reads identically on hover. */
export function ChartTooltip({
  title,
  rows,
  footer,
}: {
  title: string
  rows: TooltipRow[]
  footer?: ReactNode
}) {
  return (
    <div className="rounded-lg bg-surface-3 px-3 py-2.5 shadow-pop">
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
