import type { Goal } from '~/domain/advisory'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import {
  GOAL_KIND_LABEL,
  GOAL_PRIORITY_LABEL,
  GOAL_STATUS_LABEL,
} from '~/presentation/advisory/text'

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

/** What the client is trying to achieve, each goal with its progress, its target and its last assessment. */
export function GoalsPanel({ goals }: { goals: readonly Goal[] }) {
  return (
    <Panel
      title="Mål"
      meta={`${goals.length} ${goals.length === 1 ? 'mål' : 'mål'}`}
      bodyClassName="p-3"
    >
      {goals.length === 0 ? (
        <p className="type-inst-sub">Inga mål registrerade.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((goal) => (
            <li key={goal.id} className="ref-module p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="type-inst truncate">{goal.title}</p>
                  <p className="type-inst-sub">
                    {GOAL_KIND_LABEL[goal.kind]} · {GOAL_PRIORITY_LABEL[goal.priority]}
                  </p>
                </div>
                <span className={cn('type-machine shrink-0', STATUS_TONE[goal.status])}>
                  {GOAL_STATUS_LABEL[goal.status]}
                </span>
              </div>
              <div
                className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-3"
                aria-hidden="true"
              >
                <div
                  className={cn('h-full rounded-full', STATUS_BAR[goal.status])}
                  style={{ width: `${Math.min(100, goal.progressPercent)}%` }}
                />
              </div>
              <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-content-muted">
                <div className="flex gap-1">
                  <dt className="sr-only">Framsteg</dt>
                  <dd className="tabular text-content">{goal.progressPercent} %</dd>
                </div>
                {goal.targetAmount !== null && (
                  <div className="flex gap-1">
                    <dt>Mål</dt>
                    <dd className="tabular">{formatMsek(goal.targetAmount)}</dd>
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
              {goal.notes && (
                <p className="mt-1.5 text-[12px] leading-snug text-content-muted">
                  {goal.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
