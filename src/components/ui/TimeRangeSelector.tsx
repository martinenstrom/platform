import { cn } from '~/lib/cn'
import type { TimeRange } from '~/types'

export const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: '1D', label: '1D' },
  { value: '1W', label: '1V' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '1Y', label: '1Å' },
  { value: 'ALL', label: 'Allt' },
]

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  /** Accessible group name, e.g. "Tidsintervall för portföljutveckling". */
  label?: string
}

export function TimeRangeSelector({
  value,
  onChange,
  label = 'Tidsintervall',
}: TimeRangeSelectorProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5"
    >
      {TIME_RANGES.map((range) => {
        const isActive = range.value === value
        return (
          <button
            key={range.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(range.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150',
              isActive
                ? 'bg-surface-3 text-content'
                : 'text-content-muted hover:text-content',
            )}
          >
            {range.label}
          </button>
        )
      })}
    </div>
  )
}
