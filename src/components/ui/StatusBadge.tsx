import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'
import type { AnalysisStatus, SignalType, Tone } from '~/types'

const TONE_CLASS: Record<Tone, string> = {
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-surface-3 text-content-muted',
}

interface StatusBadgeProps {
  tone?: Tone
  children: ReactNode
  className?: string
  /** Small leading dot, useful for live/market status. */
  dot?: boolean
}

export function StatusBadge({
  tone = 'neutral',
  children,
  className,
  dot = false,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}

const SIGNAL_META: Record<SignalType, { label: string; tone: Tone }> = {
  buy: { label: 'Köpsignal', tone: 'positive' },
  sell: { label: 'Säljsignal', tone: 'negative' },
  hold: { label: 'Behåll', tone: 'neutral' },
  watch: { label: 'Bevaka', tone: 'warning' },
}

export function SignalBadge({ signal }: { signal: SignalType }) {
  const meta = SIGNAL_META[signal]
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
}

const ANALYSIS_STATUS_META: Record<AnalysisStatus, { label: string; tone: Tone }> = {
  completed: { label: 'Klar', tone: 'positive' },
  running: { label: 'Pågår', tone: 'accent' },
  queued: { label: 'I kö', tone: 'warning' },
  failed: { label: 'Misslyckades', tone: 'negative' },
}

export function AnalysisStatusBadge({ status }: { status: AnalysisStatus }) {
  const meta = ANALYSIS_STATUS_META[status]
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
}
