import { cn } from '~/lib/cn'

/** Small "SOURCE: X" tag — every data point in the Country Explorer carries one. */
export function DataSourceBadge({
  source,
  className,
}: {
  source: string
  className?: string
}) {
  return (
    <span className={cn('hud-label text-[9px] text-content-subtle', className)}>
      Källa: {source}
    </span>
  )
}

/** Shown wherever a section has no data yet, instead of ever fabricating a value. */
export function DataNotAvailable({ className }: { className?: string }) {
  return (
    <span className={cn('hud-label text-[10px] text-content-subtle', className)}>
      Data ej tillgänglig
    </span>
  )
}
