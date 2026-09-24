import type { ContextCategory, ContextFact } from '~/domain/advisory'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatLongDate } from '~/presentation/advisory/format'
import { CONFIDENCE_LABEL, CONTEXT_LABEL } from '~/presentation/advisory/text'

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
export function ClientContextPanel({ facts }: { facts: readonly ContextFact[] }) {
  const active = facts.filter((fact) => fact.status === 'active')
  const groups = ORDER.map((category) => ({
    category,
    facts: active.filter((fact) => fact.category === category),
  })).filter((group) => group.facts.length > 0)
  return (
    <Panel
      title="Klientkontext"
      meta={`${active.length} aktiva fakta`}
      bodyClassName="p-3"
    >
      {groups.length === 0 ? (
        <p className="type-inst-sub">Ingen klientkontext registrerad ännu.</p>
      ) : (
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          {groups.map((group) => (
            <section key={group.category} aria-label={CONTEXT_LABEL[group.category]}>
              <h3
                className={cn(
                  'type-section',
                  group.category === 'concern' && 'text-warning',
                )}
              >
                {CONTEXT_LABEL[group.category]}
              </h3>
              <ul className="mt-1.5 space-y-1.5">
                {group.facts.map((fact) => (
                  <li key={fact.id} className="text-[12.5px] leading-snug">
                    <p className="text-content">{fact.statement}</p>
                    <FactSource fact={fact} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
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
      <blockquote className="mt-1 border-l border-line pl-2 text-[11.5px] italic leading-snug text-content-muted">
        ”{provenance.sourceText}”
      </blockquote>
    </details>
  )
}
