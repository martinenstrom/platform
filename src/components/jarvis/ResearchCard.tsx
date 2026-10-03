import { cn } from '~/lib/cn'
import type { ResearchCard as ResearchCardModel } from '~/presentation/jarvis/researchCard'

/**
 * The research strip under a researched answer: what JARVIS looked at, how
 * many sources stand behind the answer, how fresh they are, how strong the
 * support is — and, on request, the sources themselves. Subtle by design;
 * the answer is the sentence above, and the evidence is inspectable here.
 */
export function ResearchCard({ card }: { card: ResearchCardModel }) {
  return (
    <div
      className="mt-2 rounded-md border border-line bg-surface-2/60 px-3 py-2"
      data-research-card
      data-confidence={card.confidence.code}
    >
      <p className="type-section flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[9px] tracking-[0.12em]">
        <span className="text-accent">{card.label}</span>
        <span aria-hidden="true">·</span>
        <span>
          {card.unavailable ? 'extern research ej tillgänglig' : card.sourcesLabel}
        </span>
        {card.asOf && (
          <>
            <span aria-hidden="true">·</span>
            <span className="normal-case tracking-normal">{card.asOf}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span
          className={cn(
            'normal-case tracking-normal',
            card.confidence.code === 'STRONG_EVIDENCE' && 'text-positive',
            card.confidence.code === 'MIXED' && 'text-warning',
            card.confidence.code === 'INSUFFICIENT' && 'text-content-muted',
          )}
        >
          {card.confidence.label}
        </span>
        {card.depth === 'deep' && (
          <>
            <span aria-hidden="true">·</span>
            <span>djup</span>
          </>
        )}
      </p>
      {card.conflicts.map((conflict) => (
        <p key={conflict} className="type-metadata mt-1 text-warning">
          {conflict}
        </p>
      ))}
      {card.sources.length > 0 && (
        <details className="mt-1">
          <summary className="type-metadata cursor-pointer select-none text-content-muted hover:text-content">
            Visa källor
          </summary>
          <ol className="mt-1.5 flex flex-col gap-1.5" aria-label="Källor">
            {card.sources.map((source) => (
              <li key={source.id} className="min-w-0">
                <p className="type-metadata flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-semibold text-content">{source.publisher}</span>
                  <span className="text-content-subtle">{source.kindLabel}</span>
                  {source.publishedAt && (
                    <span className="text-content-subtle">{source.publishedAt}</span>
                  )}
                </p>
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="type-metadata block truncate text-content-muted underline-offset-2 hover:underline"
                  >
                    {source.title}
                  </a>
                ) : (
                  <p className="type-metadata truncate text-content-muted">
                    {source.title}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
