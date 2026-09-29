import type { ReactNode } from 'react'
import type { ClientMarketImpact } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import { explanationOf } from '~/presentation/advisory/marketImpactText'

/**
 * One impact, explained in the five sections the spec names: the market
 * fact, the client's exposure, the client's context, an interpretation
 * typed as one, and what to prepare — with the two relevance verdicts side
 * by side above them. Rendered from the typed explanation model, so the
 * same object a future JARVIS answer reads is what the advisor sees.
 */
export function ImpactExplanation({
  impact,
  className,
}: {
  impact: ClientMarketImpact
  className?: string
}) {
  const model = explanationOf(impact)
  return (
    <div className={cn('text-[12px] leading-snug', className)}>
      <p className="type-machine mb-2">{model.relevance.split}</p>
      <dl className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
        <Section label="Marknadsfakta">
          <p className="text-content">{model.marketFact}</p>
          <p className="type-machine mt-0.5">{model.freshness}</p>
        </Section>
        <Section label="Klientexponering">
          <List items={model.exposure} />
        </Section>
        <Section label="Klientkontext">
          <List items={model.context} />
        </Section>
        <Section label="Tolkning" note="tolkning, inte fakta">
          <List items={model.interpretation} />
        </Section>
        <Section label="Förbered inför kontakt" wide>
          <ol className="space-y-0.5 text-content">
            {model.preparation.map((line, i) => (
              <li key={line} className="flex gap-2">
                <span className="type-machine w-4 shrink-0 text-content-subtle">
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </Section>
      </dl>
      <p className="type-machine mt-2">{model.sourceLine}</p>
    </div>
  )
}

function Section({
  label,
  note,
  wide = false,
  children,
}: {
  label: string
  note?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn(wide && 'md:col-span-2')}>
      <dt className="type-section">
        {label}
        {note && (
          <span className="type-machine ml-1.5 normal-case tracking-normal">
            · {note}
          </span>
        )}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-0.5 text-content-muted">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
