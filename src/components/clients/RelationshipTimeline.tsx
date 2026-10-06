import { History } from 'lucide-react'
import type { Interaction } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatDayMonth, formatMsek, yearOf } from '~/presentation/advisory/format'
import {
  IMPORTANCE_LABEL,
  INTERACTION_LABEL,
  SOURCE_LABEL,
  TOPIC_LABEL,
} from '~/presentation/advisory/text'
import { Empty, Module } from './dossier/Module'

const SHOWN = 5

/**
 * Template 5 — the relationship in order, newest first, as a timeline: a
 * line down the left, a mark at every entry, the date and the kind, the
 * confirmed structure — title, key points, topics — and the advisor's
 * original note one click beneath it, exactly as written. The note is the
 * record; the structure is what the advisor agreed it says. The latest
 * five stand open; the rest unfold beneath them.
 */
export function RelationshipTimeline({
  interactions,
  advisorNames,
  className,
}: {
  interactions: readonly Interaction[]
  advisorNames: Record<string, string>
  className?: string
}) {
  const recent = interactions.slice(0, SHOWN)
  const earlier = interactions.slice(SHOWN)
  return (
    <Module
      id="relationstidslinje"
      title="Relationstidslinje"
      icon={History}
      meta={`${interactions.length} händelser`}
      className={className}
    >
      {interactions.length === 0 ? (
        <Empty>Inga händelser ännu.</Empty>
      ) : (
        <>
          <Entries interactions={recent} advisorNames={advisorNames} />
          {earlier.length > 0 && (
            <details className="mt-3 border-t border-hairline pt-3">
              <summary className="dossier-link list-none">
                Visa all historik · {earlier.length} till
              </summary>
              <div className="mt-3">
                <Entries interactions={earlier} advisorNames={advisorNames} />
              </div>
            </details>
          )}
        </>
      )}
    </Module>
  )
}

function Entries({
  interactions,
  advisorNames,
}: {
  interactions: readonly Interaction[]
  advisorNames: Record<string, string>
}) {
  return (
    <ol className="relative ml-[5px] border-l border-hairline-strong pl-5">
      {interactions.map((interaction) => (
        <li key={interaction.id} className="relative pb-4 last:pb-0">
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-[5px] -left-[25px] h-[9px] w-[9px] rounded-full ring-2 ring-[#0b111c]',
              interaction.importance === 'high'
                ? 'bg-institution'
                : interaction.source === 'system'
                  ? 'bg-content-subtle'
                  : 'bg-accent',
            )}
          />
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <span className="tabular text-[12.5px] font-semibold text-content">
              {formatDayMonth(interaction.date)}{' '}
              <span className="type-machine">{yearOf(interaction.date)}</span>
            </span>
            <span className="type-section text-[9.5px]">
              {INTERACTION_LABEL[interaction.type]}
            </span>
            {interaction.importance === 'high' && (
              <span className="type-machine text-institution">
                {IMPORTANCE_LABEL.high} vikt
              </span>
            )}
            {interaction.amount !== undefined && (
              <span className="type-machine text-content">
                {formatMsek(interaction.amount)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-content">
            {interaction.title}
          </p>
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
          <p className="type-machine mt-1">
            {SOURCE_LABEL[interaction.source]} ·{' '}
            {advisorNames[interaction.advisorId] ?? interaction.advisorId}
            {interaction.topics.length > 0 &&
              ` · ${interaction.topics.map((topic) => TOPIC_LABEL[topic]).join(' · ')}`}
          </p>
          <details className="mt-1">
            <summary className="type-machine cursor-pointer list-none text-content-subtle hover:text-content">
              <span className="underline decoration-dotted underline-offset-2">
                Ursprunglig notering
              </span>
            </summary>
            <blockquote className="mt-1 border-l border-hairline-strong pl-2 text-[12px] leading-snug whitespace-pre-line text-content-muted">
              {interaction.noteText}
            </blockquote>
          </details>
        </li>
      ))}
    </ol>
  )
}
