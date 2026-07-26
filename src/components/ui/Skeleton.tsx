import { cn } from '~/lib/cn'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-xs bg-surface-3 motion-safe:animate-pulse', className)}
      aria-hidden="true"
    />
  )
}

interface SkeletonCardProps {
  /** Number of placeholder rows in the card body. */
  rows?: number
  className?: string
  /** Renders a taller block instead of rows, for chart cards. */
  variant?: 'rows' | 'chart'
}

/** Loading placeholder that matches DashboardCard's geometry. */
export function SkeletonCard({
  rows = 4,
  className,
  variant = 'rows',
}: SkeletonCardProps) {
  return (
    <section
      className={cn('hud-frame rounded-xl bg-surface p-6 shadow-card', className)}
      aria-busy="true"
      aria-label="Innehåll laddas"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="mt-4 space-y-3">
        {variant === 'chart' ? (
          <Skeleton className="h-48 w-full rounded-sm" />
        ) : (
          Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))
        )}
      </div>
    </section>
  )
}
