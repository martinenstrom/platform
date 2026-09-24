import type { Interaction } from '~/domain/advisory'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatDayMonth, formatMsek, yearOf } from '~/presentation/advisory/format'
import {
  IMPORTANCE_LABEL,
  INTERACTION_LABEL,
  SOURCE_LABEL,
  TOPIC_LABEL,
} from '~/presentation/advisory/text'

/**
 * The relationship in order, newest first. Each entry is the confirmed
 * structure — title, key points, topics — with the advisor's original note
 * one click beneath it, exactly as written. The note is the record; the
 * structure is what the advisor agreed it says.
 */
export function RelationshipTimeline({
  interactions,
  advisorNames,
}: {
  interactions: readonly Interaction[]
  advisorNames: Record<string, string>
}) {
  return (
    <Panel
      title="Relationstidslinje"
      meta={`${interactions.length} händelser`}
      bodyClassName="p-3"
    >
      {interactions.length === 0 ? (
        <p className="type-inst-sub">Inga händelser ännu.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-4">
          {interactions.map((interaction) => (
            <li key={interaction.id} className="relative">
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-canvas',
                  interaction.importance === 'high'
                    ? 'bg-institution'
                    : interaction.source === 'system'
                      ? 'bg-content-subtle'
                      : 'bg-accent',
                )}
              />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="type-machine text-content-muted">
                  {formatDayMonth(interaction.date)} {yearOf(interaction.date)}
                </span>
                <span className="type-section">
                  {INTERACTION_LABEL[interaction.type]}
                </span>
                {interaction.importance === 'high' && (
                  <span className="type-machine text-institution">
                    {IMPORTANCE_LABEL.high} vikt
                  </span>
                )}
                <span className="type-machine">
                  {SOURCE_LABEL[interaction.source]} ·{' '}
                  {advisorNames[interaction.advisorId] ?? interaction.advisorId}
                </span>
                {interaction.amount !== undefined && (
                  <span className="type-machine text-content">
                    {formatMsek(interaction.amount)}
                  </span>
                )}
              </div>
              <p className="type-inst mt-0.5">{interaction.title}</p>
              {interaction.keyPoints.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[12px] text-content-muted">
                  {interaction.keyPoints.map((point) => (
                    <li key={point} className="flex gap-1.5">
                      <span aria-hidden="true" className="text-content-subtle">
                        –
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              )}
              {interaction.topics.length > 0 && (
                <p className="type-machine mt-1">
                  {interaction.topics.map((topic) => TOPIC_LABEL[topic]).join(' · ')}
                </p>
              )}
              <details className="mt-1">
                <summary className="type-machine cursor-pointer list-none text-content-subtle hover:text-content">
                  <span className="underline decoration-dotted underline-offset-2">
                    Ursprunglig notering
                  </span>
                </summary>
                <blockquote className="mt-1 whitespace-pre-line border-l border-line pl-2 text-[12px] leading-snug text-content-muted">
                  {interaction.noteText}
                </blockquote>
              </details>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
