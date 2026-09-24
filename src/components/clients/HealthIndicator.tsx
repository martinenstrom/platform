import type { RelationshipHealth } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { healthDriverText, HEALTH_BAND_LABEL } from '~/presentation/advisory/text'

/**
 * Relationship health, never as a black box: the score, its band and every
 * driver that moved it, positive and negative, with the points each one
 * carried. A reader can add the list up.
 */

const BAND_TONE: Record<RelationshipHealth['band'], string> = {
  strong: 'text-positive',
  stable: 'text-content',
  watch: 'text-warning',
  'at-risk': 'text-negative',
}

const BAND_BAR: Record<RelationshipHealth['band'], string> = {
  strong: 'bg-positive',
  stable: 'bg-accent',
  watch: 'bg-warning',
  'at-risk': 'bg-negative',
}

export function HealthScore({
  health,
  size = 'md',
}: {
  health: RelationshipHealth
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      className={cn('tabular inline-flex items-baseline gap-1.5', BAND_TONE[health.band])}
    >
      <span
        className={cn(
          'font-semibold tracking-tight',
          size === 'lg'
            ? 'text-[26px] leading-7'
            : size === 'md'
              ? 'text-[15px]'
              : 'text-[13px]',
        )}
      >
        {health.score}
      </span>
      <span
        className={cn(
          size === 'lg' ? 'type-inst-sub' : 'text-[11px]',
          'text-current opacity-90',
        )}
      >
        {HEALTH_BAND_LABEL[health.band]}
      </span>
    </span>
  )
}

export function HealthBar({
  health,
  className,
}: {
  health: RelationshipHealth
  className?: string
}) {
  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-surface-3', className)}
      aria-hidden="true"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          BAND_BAR[health.band],
        )}
        style={{ width: `${health.score}%` }}
      />
    </div>
  )
}

export function HealthDrivers({ health }: { health: RelationshipHealth }) {
  return (
    <ul className="space-y-0.5" aria-label="Drivkrafter bakom relationshälsan">
      {health.drivers.map((driver) => (
        <li
          key={driver.kind}
          className="flex items-baseline justify-between gap-3 text-[12px]"
        >
          <span className="flex items-baseline gap-1.5 text-content-muted">
            <span
              aria-hidden="true"
              className={cn(
                'w-2 shrink-0 text-center',
                driver.effect === 'positive' ? 'text-positive' : 'text-negative',
              )}
            >
              {driver.effect === 'positive' ? '+' : '−'}
            </span>
            {healthDriverText(driver.kind, driver.count)}
          </span>
          <span
            className={cn(
              'type-machine',
              driver.effect === 'positive' ? 'text-positive' : 'text-negative',
            )}
          >
            {driver.effect === 'positive' ? '+' : '−'}
            {driver.points}
          </span>
        </li>
      ))}
    </ul>
  )
}
