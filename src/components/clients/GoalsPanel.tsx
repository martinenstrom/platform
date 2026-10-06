import { Target } from 'lucide-react'
import type { Goal } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import {
  GOAL_KIND_LABEL,
  GOAL_PRIORITY_LABEL,
  GOAL_STATUS_LABEL,
} from '~/presentation/advisory/text'
import { Empty, Module } from './dossier/Module'

const STATUS_TONE: Record<Goal['status'], string> = {
  'on-track': 'text-positive',
  'at-risk': 'text-warning',
  behind: 'text-negative',
  achieved: 'text-accent',
  'not-started': 'text-content-subtle',
}

const STATUS_BAR: Record<Goal['status'], string> = {
  'on-track': 'bg-positive',
  'at-risk': 'bg-warning',
  behind: 'bg-negative',
  achieved: 'bg-accent',
  'not-started': 'bg-content-subtle',
}

/** What the client is trying to achieve, each goal as one row with its progress, its target and its last assessment. */
export function GoalsPanel({
  goals,
  className,
}: {
  goals: readonly Goal[]
  className?: string
}) {
  return (
    <Module
      id="mal"
      title="Mål"
      icon={Target}
      meta={`${goals.length} mål`}
      className={className}
    >
      {goals.length === 0 ? (
        <Empty>Inga mål registrerade.</Empty>
      ) : (
        <ul className="flex flex-col">
          {goals.map((goal) => (
            <li key={goal.id} className="dossier-row py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-content">{goal.title}</p>
                  <p className="type-inst-sub">
                    {GOAL_KIND_LABEL[goal.kind]} · {GOAL_PRIORITY_LABEL[goal.priority]}
                  </p>
                </div>
                <span className={cn('type-machine shrink-0', STATUS_TONE[goal.status])}>
                  {GOAL_STATUS_LABEL[goal.status]}
                </span>
              </div>
              <div
                className="mt-2 h-[3px] w-full overflow-hidden rounded-[1px] bg-hairline-strong"
                aria-hidden="true"
              >
                <div
                  className={cn('h-full rounded-[1px]', STATUS_BAR[goal.status])}
                  style={{ width: `${Math.min(100, goal.progressPercent)}%` }}
                />
              </div>
              <dl className="type-machine mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 normal-case">
                <div className="flex gap-1">
                  <dt className="sr-only">Framsteg</dt>
                  <dd className="text-content">{goal.progressPercent} %</dd>
                </div>
                {goal.targetAmount !== null && (
                  <div className="flex gap-1">
                    <dt>Mål</dt>
                    <dd>{formatMsek(goal.targetAmount)}</dd>
                  </div>
                )}
                {goal.targetDate && (
                  <div className="flex gap-1">
                    <dt>Senast</dt>
                    <dd>{formatLongDate(goal.targetDate)}</dd>
                  </div>
                )}
                <div className="flex gap-1">
                  <dt>Bedömt</dt>
                  <dd>{formatLongDate(goal.assessedAt)}</dd>
                </div>
              </dl>
              {goal.notes && <p className="type-inst-sub mt-1.5">{goal.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </Module>
  )
}
