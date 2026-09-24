import type { Opportunity } from '~/domain/advisory'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import {
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_TYPE_LABEL,
} from '~/presentation/advisory/text'

const STATUS_TONE: Record<Opportunity['status'], string> = {
  identified: 'text-content-muted',
  'in-discussion': 'text-accent',
  proposed: 'text-institution',
  won: 'text-positive',
  lost: 'text-content-subtle',
}

/** Where the relationship could grow, each with the facts it rests on and the next step. */
export function OpportunitiesPanel({
  opportunities,
  advisorNames,
}: {
  opportunities: readonly Opportunity[]
  advisorNames: Record<string, string>
}) {
  const live = opportunities.filter((o) => !['won', 'lost'].includes(o.status))
  const total = live.reduce((sum, o) => sum + o.potentialValue, 0)
  return (
    <Panel
      title="Möjligheter"
      meta={
        live.length > 0 ? `${live.length} aktiva · ${formatMsek(total)}` : 'Inga aktiva'
      }
      bodyClassName="p-3"
    >
      {opportunities.length === 0 ? (
        <p className="type-inst-sub">Inga möjligheter registrerade.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {opportunities.map((o) => (
            <li key={o.id} className="ref-module p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="type-inst truncate">{o.title}</p>
                  <p className="type-inst-sub">{OPPORTUNITY_TYPE_LABEL[o.type]}</p>
                </div>
                <span className={cn('type-machine shrink-0', STATUS_TONE[o.status])}>
                  {OPPORTUNITY_STATUS_LABEL[o.status]}
                </span>
              </div>
              <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-content-muted">
                <div className="flex gap-1">
                  <dt>Potential</dt>
                  <dd className="tabular text-content">{formatMsek(o.potentialValue)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Sannolikhet</dt>
                  <dd className="tabular">{o.probabilityPercent} %</dd>
                </div>
                {o.expectedDate && (
                  <div className="flex gap-1">
                    <dt>Förväntas</dt>
                    <dd>{formatLongDate(o.expectedDate)}</dd>
                  </div>
                )}
                <div className="flex gap-1">
                  <dt>Ansvarig</dt>
                  <dd>{advisorNames[o.ownerAdvisorId] ?? o.ownerAdvisorId}</dd>
                </div>
              </dl>
              <p className="mt-1.5 text-[12px] leading-snug text-content-muted">
                {o.basis}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-content">
                <span className="type-section mr-1.5">Nästa steg</span>
                {o.nextAction}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
