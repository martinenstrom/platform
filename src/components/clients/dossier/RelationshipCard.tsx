import { HeartPulse } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import type { RelationshipHealth } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatDaysFromToday, formatLongDate } from '~/presentation/advisory/format'
import { HEALTH_BAND_LABEL, HEALTH_INTERPRETATION } from '~/presentation/advisory/text'
import { HealthDrivers } from '../HealthIndicator'
import { Foot, Module } from './Module'

const BAND_TEXT: Record<RelationshipHealth['band'], string> = {
  strong: 'text-positive',
  stable: 'text-content',
  watch: 'text-warning',
  'at-risk': 'text-negative',
}

const BAND_BAR: Record<RelationshipHealth['band'], string> = {
  strong: 'bg-positive',
  stable: 'bg-institution',
  watch: 'bg-warning',
  'at-risk': 'bg-negative',
}

/**
 * The relationship lens: the health score as a reading rather than a
 * statistic — the score, its band, the scale, one line of interpretation
 * and the contact rhythm — and beneath it every driver that moved the
 * score, with its points, so the reading can be added up. The score and
 * the drivers are the read model's; the interpretation is the band's own
 * sentence.
 */
export function RelationshipCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { health } = view
  const contact =
    view.daysSinceContact === null
      ? 'Ingen kontakt registrerad.'
      : view.daysSinceContact > 30
        ? `Ingen kontakt på ${view.daysSinceContact} dagar.`
        : `Senaste kontakt ${formatDaysFromToday(-view.daysSinceContact)}.`
  return (
    <Module
      id="relation"
      title="Relationshälsa"
      icon={HeartPulse}
      meta={HEALTH_BAND_LABEL[health.band]}
      className={className}
    >
      <div className="flex items-end gap-2">
        <span
          className={cn(
            'font-display text-[40px] leading-none tracking-[-0.01em]',
            BAND_TEXT[health.band],
          )}
        >
          {health.score}
        </span>
        <span className="type-inst-sub pb-[3px]">/100</span>
        <span className={cn('type-section ml-auto pb-[3px]', BAND_TEXT[health.band])}>
          {HEALTH_BAND_LABEL[health.band]}
        </span>
      </div>
      <span
        className="mt-3 block h-[5px] w-full overflow-hidden rounded-[1px] bg-hairline-strong"
        aria-hidden="true"
      >
        <span
          className={cn('block h-full rounded-[1px]', BAND_BAR[health.band])}
          style={{ width: `${Math.max(0, Math.min(100, health.score))}%` }}
        />
      </span>
      <p className="mt-3 text-[12.5px] leading-[1.15rem] text-content-muted">
        {HEALTH_INTERPRETATION[health.band]} {contact}
      </p>

      <div className="mt-4 border-t border-hairline pt-3">
        <p className="type-section mb-1.5">Drivkrafter</p>
        <HealthDrivers health={health} />
      </div>
      <Foot>
        {health.method} · bedömd {formatLongDate(health.assessedAt)}
      </Foot>
    </Module>
  )
}
