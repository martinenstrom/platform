import { Globe } from 'lucide-react'
import type { ClientMarketImpact } from '~/domain/advisory'
import type { MarketChangeSince } from '~/application/advisory/marketImpact'
import { ImpactExplanation } from '~/components/marketImpact/ImpactExplanation'
import { cn } from '~/lib/cn'
import {
  changeStatusText,
  concernMatches,
  DIRECTNESS_LABEL,
  freshnessText,
  marketMoveText,
  peakMoveText,
  RELEVANCE_LABEL,
  relevanceSplitText,
  relevanceText,
  SEVERITY_LABEL,
} from '~/presentation/advisory/marketImpactText'
import { Empty, Module } from './dossier/Module'

const RELEVANCE_TONE = {
  high: 'text-warning',
  medium: 'text-content',
  low: 'text-content-muted',
} as const

/**
 * Marknadspåverkan on Client 360: the open market moves this record is
 * exposed to, each with its relevance — financial and conversational, side
 * by side — and, on request, the five-section explanation. Beneath them,
 * the client-relevant moves that already closed: history, quoted at peak,
 * contributing to no priority. An empty list is an answer — the client's
 * record says nothing the market moved — and the module says so rather
 * than hiding.
 */
export function MarketImpactPanel({
  impacts,
  history,
  className,
}: {
  impacts: readonly ClientMarketImpact[]
  history: readonly MarketChangeSince[]
  className?: string
}) {
  return (
    <Module
      id="marknad"
      title="Marknadspåverkan"
      icon={Globe}
      meta={
        impacts.length === 0
          ? 'inga aktuella rörelser'
          : `${impacts.length} ${impacts.length === 1 ? 'rörelse' : 'rörelser'} berör klienten`
      }
      className={className}
    >
      {impacts.length === 0 ? (
        <Empty>
          Inga aktuella marknadsrörelser möter en registrerad exponering eller kontext hos
          den här klienten. Rörelser utan koppling till relationen visas inte.
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {impacts.map((impact) => (
            <li key={impact.id} className="dossier-row py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[13px] font-medium text-content">
                  {marketMoveText(impact.event)}
                  <span className="type-machine ml-2">
                    {SEVERITY_LABEL[impact.event.severity].toLowerCase()}
                  </span>
                </p>
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className={cn('type-section', RELEVANCE_TONE[impact.relevance])}>
                    {RELEVANCE_LABEL[impact.relevance]} relevans
                  </span>
                  <span className="type-machine">
                    {DIRECTNESS_LABEL[impact.directness]}
                  </span>
                </p>
              </div>
              <p className="type-inst-sub mt-1 leading-[1.05rem]">
                {relevanceText(impact)}
                {concernMatches(impact) && (
                  <span className="text-warning">
                    {' '}
                    Klienten har själv tagit upp ämnet.
                  </span>
                )}
              </p>
              <p className="type-machine mt-0.5">
                {relevanceSplitText(impact)} · {freshnessText(impact.event)}
              </p>
              <details className="mt-1">
                <summary className="type-machine cursor-pointer list-none underline decoration-dotted underline-offset-2 hover:text-content">
                  Varför det är relevant och vad som bör förberedas
                </summary>
                <ImpactExplanation
                  impact={impact}
                  className="mt-2 border-l border-hairline-strong pl-3"
                />
              </details>
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <section
          className="mt-3 border-t border-hairline pt-3"
          aria-label="Tidigare marknadsrörelser"
        >
          <h3 className="type-section">Tidigare rörelser · senaste 30 dagarna</h3>
          <ul className="mt-1.5 space-y-1.5">
            {history.map((change) => (
              <li
                key={change.impact.event.id + change.impact.event.firstSeenAt}
                className="text-[12px]"
              >
                <span className="text-content-muted">
                  {peakMoveText(change.impact.event)}
                </span>
                <span
                  className={cn(
                    'type-machine ml-1.5',
                    change.impact.relevance === 'high' && 'text-warning',
                  )}
                >
                  {RELEVANCE_LABEL[change.impact.relevance].toLowerCase()} relevans
                </span>
                <span className="type-machine block">{changeStatusText(change)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Module>
  )
}
