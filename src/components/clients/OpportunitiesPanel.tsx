import { Lightbulb } from 'lucide-react'
import type { Opportunity } from '~/domain/advisory'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import {
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_TYPE_LABEL,
} from '~/presentation/advisory/text'
import { Empty, Module } from './dossier/Module'

const STATUS_TONE: Record<Opportunity['status'], string> = {
  identified: 'text-content-muted',
  'in-discussion': 'text-accent',
  proposed: 'text-institution',
  won: 'text-positive',
  lost: 'text-content-subtle',
}

/** Where the relationship could grow, each as one row with the facts it rests on and the next step. */
export function OpportunitiesPanel({
  opportunities,
  advisorNames,
  className,
}: {
  opportunities: readonly Opportunity[]
  advisorNames: Record<string, string>
  className?: string
}) {
  const live = opportunities.filter((o) => !['won', 'lost'].includes(o.status))
  const total = live.reduce((sum, o) => sum + o.potentialValue, 0)
  return (
    <Module
      id="mojligheter"
      title="Möjligheter"
      icon={Lightbulb}
      meta={
        live.length > 0 ? `${live.length} aktiva · ${formatMsek(total)}` : 'Inga aktiva'
      }
      className={className}
    >
      {opportunities.length === 0 ? (
        <Empty>Inga möjligheter registrerade.</Empty>
      ) : (
        <ul className="flex flex-col">
          {opportunities.map((o) => (
            <li key={o.id} className="dossier-row py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-content">{o.title}</p>
                  <p className="type-inst-sub">
                    {OPPORTUNITY_TYPE_LABEL[o.type]} ·{' '}
                    <span className={STATUS_TONE[o.status]}>
                      {OPPORTUNITY_STATUS_LABEL[o.status]}
                    </span>
                  </p>
                </div>
                <span className="tabular shrink-0 text-[13px] font-semibold text-content">
                  {formatMsek(o.potentialValue)}
                </span>
              </div>
              <p className="type-inst-sub mt-1.5 leading-[1.05rem]">{o.basis}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-content">
                <span className="type-section mr-1.5">Nästa steg</span>
                {o.nextAction}
              </p>
              <p className="type-machine mt-1 normal-case">
                Sannolikhet {o.probabilityPercent} %
                {o.expectedDate && ` · förväntas ${formatLongDate(o.expectedDate)}`} ·{' '}
                {advisorNames[o.ownerAdvisorId] ?? o.ownerAdvisorId}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Module>
  )
}
