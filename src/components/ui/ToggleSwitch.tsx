import { cn } from '~/lib/cn'

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Hide the visible label text but keep it for screen readers (used when a sibling element already shows the label). */
  labelHidden?: boolean
  disabled?: boolean
}

/** iOS-style pill toggle — pure CSS, no dependency. Same semantics as a checkbox. */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  labelHidden = false,
  disabled = false,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelHidden ? label : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors duration-150',
        checked ? 'bg-accent-solid' : 'bg-surface-3',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  )
}
