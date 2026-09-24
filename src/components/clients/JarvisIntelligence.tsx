import type { Client360 } from '~/application/advisory/client360'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import {
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
} from '~/presentation/advisory/format'
import {
  nextBestActionText,
  SIGNAL_TONE,
  signalText,
} from '~/presentation/advisory/intelligenceText'
import {
  healthDriverText,
  OPPORTUNITY_TYPE_LABEL,
  PRIORITY_LABEL,
} from '~/presentation/advisory/text'
import { JarvisBlock } from './JarvisBlock'

const PRIORITY_TONE = {
  high: 'text-warning',
  medium: 'text-content',
  low: 'text-content-muted',
} as const

/**
 * The intelligence over the relationship, at most three insights at once:
 * the signal, why it matters, the recommended action and its priority.
 * Beneath them the relationship's risks and its openings, and the one
 * recommendation the rules rank first. Every sentence quotes the facts it
 * rests on; the method is named.
 */
export function JarvisIntelligence({ view }: { view: Client360 }) {
  const insights = view.signals.slice(0, 3)
  const risks = view.health.drivers.filter((d) => d.effect === 'negative')
  const openings = view.opportunities
    .filter((o) => !['won', 'lost'].includes(o.status))
    .slice(0, 3)
  return (
    <Panel
      title="JARVIS-intelligens"
      meta={`${view.signals.length} signaler · regelbaserad v1 · ${formatLongDate(view.today)}`}
      bodyClassName="p-3"
    >
      {insights.length === 0 ? (
        <p className="type-inst-sub">
          Inga signaler. Relationen kräver ingen åtgärd just nu.
        </p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-3">
          {insights.map((signal, index) => {
            const text = signalText(signal)
            return (
              <JarvisBlock
                key={`${signal.kind}-${index}`}
                as="li"
                kind={SIGNAL_TONE[signal.kind]}
                meta={
                  <span className={PRIORITY_TONE[signal.priority]}>
                    {PRIORITY_LABEL[signal.priority]} prioritet
                  </span>
                }
              >
                <dl className="space-y-1.5 text-[12.5px] leading-snug">
                  <div>
                    <dt className="type-section">Signal</dt>
                    <dd className="text-content">{text.signal}</dd>
                  </div>
                  <div>
                    <dt className="type-section">Varför det spelar roll</dt>
                    <dd className="text-content-muted">{text.why}</dd>
                  </div>
                  <div>
                    <dt className="type-section">Rekommenderad åtgärd</dt>
                    <dd className="text-content">{text.action}</dd>
                  </div>
                </dl>
              </JarvisBlock>
            )
          })}
        </ul>
      )}

      <div className="mt-3 grid gap-4 border-t border-line pt-3 md:grid-cols-3">
        <section aria-label="Relationsrisker">
          <h3 className="type-section text-warning">Relationsrisker</h3>
          {risks.length === 0 ? (
            <p className="type-inst-sub mt-1.5">Inga negativa drivkrafter.</p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-[12px]">
              {risks.map((driver) => (
                <li
                  key={driver.kind}
                  className="flex items-baseline justify-between gap-2 text-content-muted"
                >
                  <span>{healthDriverText(driver.kind, driver.count)}</span>
                  <span className="type-machine text-negative">
                    {'−'}
                    {driver.points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Möjligheter">
          <h3 className="type-section text-accent">Möjligheter</h3>
          {openings.length === 0 ? (
            <p className="type-inst-sub mt-1.5">Inga aktiva möjligheter.</p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-[12px]">
              {openings.map((o) => (
                <li key={o.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-content-muted">
                    {o.title}{' '}
                    <span className="type-machine">
                      · {OPPORTUNITY_TYPE_LABEL[o.type]}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-content">
                    {formatMsek(o.potentialValue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Rekommendation">
          <h3 className="type-section text-institution">Rekommendation</h3>
          {view.nextBestAction ? (
            <div className="mt-1.5">
              <p className="type-inst">{nextBestActionText(view.nextBestAction)}</p>
              <p className={cn('type-machine mt-0.5')}>
                Brådska {view.nextBestAction.urgency}/5
                {view.nextBestAction.dueDate &&
                  ` · senast ${formatLongDate(view.nextBestAction.dueDate)}`}
                {view.nextMeeting &&
                  ` · möte ${formatDaysFromToday(view.nextMeeting.daysAhead)}`}
              </p>
            </div>
          ) : (
            <p className="type-inst-sub mt-1.5">Ingen åtgärd rekommenderas.</p>
          )}
        </section>
      </div>
    </Panel>
  )
}
