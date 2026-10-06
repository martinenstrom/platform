import { ChevronRight, ListOrdered } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import type { Signal } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatDaysFromToday, formatLongDate } from '~/presentation/advisory/format'
import { signalText } from '~/presentation/advisory/intelligenceText'
import { PRIORITY_LABEL } from '~/presentation/advisory/text'
import { Empty, Foot, Module } from './Module'
import { anchorFor } from './sections'

const SHOWN = 3

/**
 * Template 2 — the ranked priorities. The three signals the rules rank
 * highest, numbered, each as one line, one reason and one status — an
 * investment-committee summary of what needs the advisor's attention, not
 * a list of alerts. The order is the read model's; a promise among them
 * is closed where it is kept, in the commitments module, which its door
 * opens.
 */
export function PrioritiesCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const top = view.signals.slice(0, SHOWN)
  return (
    <Module
      title="Topp 3 prioriteringar"
      icon={ListOrdered}
      meta={`${view.signals.length} ${view.signals.length === 1 ? 'signal' : 'signaler'}`}
      className={className}
      bodyClassName="px-5 pb-3"
    >
      {top.length === 0 ? (
        <Empty>Inget som kräver uppmärksamhet. Relationen är i ordning.</Empty>
      ) : (
        <ol className="flex flex-col">
          {top.map((signal, index) => (
            <PriorityRow
              key={`${signal.kind}-${index}`}
              rank={index + 1}
              signal={signal}
            />
          ))}
        </ol>
      )}
      <Foot>
        rangordnade av regelverket · {view.method} · {formatLongDate(view.today)}
      </Foot>
    </Module>
  )
}

function PriorityRow({ rank, signal }: { rank: number; signal: Signal }) {
  const text = signalText(signal)
  const promise =
    signal.kind === 'overdue-commitment' || signal.kind === 'commitment-due-soon'
      ? signal.title
      : null
  const status =
    signal.kind === 'overdue-commitment'
      ? { text: `Försenat ${signal.daysOverdue} dagar`, tone: 'text-negative' }
      : signal.kind === 'commitment-due-soon'
        ? {
            text: `Senast ${formatDaysFromToday(signal.daysAhead)}`,
            tone: 'text-warning',
          }
        : {
            text: `${PRIORITY_LABEL[signal.priority]} prioritet`,
            tone: signal.priority === 'high' ? 'text-warning' : 'text-content-subtle',
          }
  return (
    <li className="dossier-row flex items-start gap-3.5 py-3">
      <span className="dossier-rank mt-0.5" aria-hidden="true">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug font-medium text-content">
          {promise ?? text.signal}
        </p>
        <p className="type-inst-sub mt-0.5 leading-[1.05rem]">
          {promise ? text.action : text.why}
        </p>
        <p className={cn('type-machine mt-1 normal-case', status.tone)}>{status.text}</p>
      </div>
      <a
        href={anchorFor(signal.kind)}
        aria-label={`Visa underlag: ${promise ?? text.signal}`}
        className="dossier-chevron mt-0.5"
      >
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.8} />
      </a>
    </li>
  )
}
