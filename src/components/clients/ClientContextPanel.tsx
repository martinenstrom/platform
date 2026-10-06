import { MessageSquareText } from 'lucide-react'
import type { ContextCategory, ContextFact } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import { CONFIDENCE_LABEL, CONTEXT_LABEL } from '~/presentation/advisory/text'
import { Empty, Module } from './dossier/Module'

const ORDER: readonly ContextCategory[] = [
  'concern',
  'preference',
  'objective',
  'family',
  'business',
  'communication',
  'behaviour',
]

const ORIGIN_LABEL = {
  advisor: 'Rådgivare',
  'jarvis-extraction': 'JARVIS · bekräftad',
  seed: 'Import',
} as const

/**
 * What the firm knows about the client, as dated and sourced statements
 * grouped by what kind of thing each is. A statement JARVIS drew from a
 * note carries the note's words beneath it, so "where did this come from?"
 * is answered on the spot and an interpretation never passes as a record.
 */
export function ClientContextPanel({
  facts,
  className,
}: {
  facts: readonly ContextFact[]
  className?: string
}) {
  const active = facts.filter((fact) => fact.status === 'active')
  const groups = ORDER.map((category) => ({
    category,
    facts: active.filter((fact) => fact.category === category),
  })).filter((group) => group.facts.length > 0)
  return (
    <Module
      id="klientkontext"
      title="Klientkontext"
      icon={MessageSquareText}
      meta={`${active.length} aktiva fakta`}
      className={className}
    >
      {groups.length === 0 ? (
        <Empty>Ingen klientkontext registrerad ännu.</Empty>
      ) : (
        <div className="flex flex-col">
          {groups.map((group) => (
            <section
              key={group.category}
              aria-label={CONTEXT_LABEL[group.category]}
              className="dossier-row py-2.5"
            >
              <h3
                className={cn(
                  'type-section',
                  group.category === 'concern' && 'text-warning',
                )}
              >
                {CONTEXT_LABEL[group.category]}
              </h3>
              <ul className="mt-1.5 space-y-2">
                {group.facts.map((fact) => (
                  <li key={fact.id} className="text-[13px] leading-snug">
                    <p className="text-content">{fact.statement}</p>
                    <FactSource fact={fact} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Module>
  )
}

/** The provenance line beneath a statement, with the source words on request. */
export function FactSource({ fact }: { fact: ContextFact }) {
  const { provenance } = fact
  const line = `${ORIGIN_LABEL[provenance.origin]} · ${formatLongDate(provenance.sourceDate)}${
    provenance.origin === 'jarvis-extraction'
      ? ` · ${CONFIDENCE_LABEL[provenance.confidence].toLowerCase()}`
      : ''
  }`
  if (!provenance.sourceText) return <p className="type-machine mt-0.5">{line}</p>
  return (
    <details className="mt-0.5">
      <summary className="type-machine cursor-pointer list-none hover:text-content">
        {line} ·{' '}
        <span className="underline decoration-dotted underline-offset-2">källa</span>
      </summary>
      <blockquote className="mt-1 border-l border-hairline-strong pl-2 text-[11.5px] italic leading-snug text-content-muted">
        ”{provenance.sourceText}”
      </blockquote>
    </details>
  )
}
