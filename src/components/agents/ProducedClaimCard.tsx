import { StatusBadge } from '~/components/ui/StatusBadge'
import { DashboardCard } from '~/components/ui/DashboardCard'
import {
  citationText,
  CLAIM_STATUS,
  CLAIM_TYPE_LABEL,
  CONFIDENCE_CAP_LABEL,
  CONFIDENCE_LEVEL,
  confidenceOrigin,
  isCitationFinding,
  QUALITY_LABEL,
  TRUST_LABEL,
} from '~/presentation/analysis/claimText'
import { formatDateTime } from '~/lib/format'
import type { ReviewedCitation, ReviewedClaim } from '~/application/analysis/runReview'

/**
 * One thing the agent asserted, and everything a person needs to judge it.
 *
 * Ordered the way a reviewer actually reads: **the assertion first**, then how
 * far the firm trusts it and why, then the evidence underneath it. A claim
 * whose evidence moved, or whose confidence is the model's own word, says so
 * before a reader has to go looking.
 *
 * Nothing here is computed. The level, its basis, the cap that bit and the
 * status of every citation all arrive decided.
 */
export function ProducedClaimCard({ reviewed }: { reviewed: ReviewedClaim }) {
  const { claim } = reviewed
  const status = CLAIM_STATUS[claim.status]
  const level = CONFIDENCE_LEVEL[claim.confidence.level]
  const origin = confidenceOrigin(claim.confidence.cappedBy)
  const findings = [...reviewed.supporting, ...reviewed.contradicting].filter(
    isCitationFinding,
  )

  return (
    <DashboardCard as="article">
      {/* The assertion, in the position a reader looks first. */}
      <p className="text-base leading-relaxed text-content">{claim.statement}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone="neutral">{CLAIM_TYPE_LABEL[claim.type]}</StatusBadge>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {claim.temporalScope.horizon && (
          <StatusBadge tone="neutral">Horisont {claim.temporalScope.horizon}</StatusBadge>
        )}
      </div>

      {/*
       * The one thing a reviewer must not miss. Raised to the top of the card
       * rather than left for them to notice inside the evidence list, because
       * "the number changed after this was written" is not something anyone
       * spots by reading carefully.
       */}
      {findings.length > 0 && (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-warning">
          {findings.length} av påståendets hänvisningar stämmer inte längre med underlaget.
        </p>
      )}

      {/* ------------------------------------------------------ confidence */}

      <section className="mt-5 flex flex-col gap-2" aria-label="Tillförlitlighet">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={level.tone}>{level.label}</StatusBadge>
          <StatusBadge tone={origin.tone}>{origin.label}</StatusBadge>
          {claim.confidence.cappedBy && (
            <span className="type-metadata">
              {CONFIDENCE_CAP_LABEL[claim.confidence.cappedBy]}
            </span>
          )}
        </div>
        {/*
         * The firm's recorded reasoning, verbatim. Not translated: it is the
         * text stored with the decision, and a second wording here would let a
         * reader find two versions of one judgement.
         */}
        <ul className="flex flex-col gap-1">
          {claim.confidence.basis.map((line) => (
            <li key={line} className="type-metadata">
              {line}
            </li>
          ))}
        </ul>
      </section>

      {/* -------------------------------------------------------- evidence */}

      <section className="mt-5 flex flex-col gap-3" aria-label="Åberopat underlag">
        <h3 className="type-metadata">Åberopat underlag ({reviewed.supporting.length})</h3>
        {reviewed.supporting.length === 0 ? (
          <p className="text-sm text-content-muted">
            Påståendet åberopar inget underlag. Det är därför det inte kan vara stött.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reviewed.supporting.map((citation) => (
              <CitationRow key={citation.observationId} citation={citation} />
            ))}
          </ul>
        )}
      </section>

      {reviewed.contradicting.length > 0 && (
        <section className="mt-5 flex flex-col gap-3" aria-label="Motsägande underlag">
          {/*
           * Kept, never quietly dropped. Evidence that cuts against a claim is
           * the part of a record most worth preserving.
           */}
          <h3 className="type-metadata">
            Underlag som talar emot ({reviewed.contradicting.length})
          </h3>
          <ul className="flex flex-col gap-3">
            {reviewed.contradicting.map((citation) => (
              <CitationRow key={citation.observationId} citation={citation} />
            ))}
          </ul>
        </section>
      )}
    </DashboardCard>
  )
}

/**
 * One observation a claim rests on, with where it came from.
 *
 * An unresolved citation has no observation to describe, so it shows what was
 * cited and what happened — rather than nothing, which would let a claim that
 * quoted something imaginary look like a claim that quoted nothing.
 */
function CitationRow({ citation }: { citation: ReviewedCitation }) {
  const rendered = citationText(citation)

  if (citation.status === 'unresolved') {
    return (
      <li className="flex flex-col gap-1">
        <span className="text-sm">Hänvisning {citation.observationId.slice(0, 12)}…</span>
        <span>
          <StatusBadge tone={rendered.tone}>{rendered.label}</StatusBadge>
        </span>
      </li>
    )
  }

  const { item } = citation
  const source = item.provenance.source
  const trust = source.trust

  return (
    <li className="flex flex-col gap-1">
      <span className="text-sm">
        {item.ref.subject} · {item.ref.kind}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="type-metadata">{source.providerName}</span>
        {trust && <span className="type-metadata">{TRUST_LABEL[trust]}</span>}
        <span className="type-metadata">{QUALITY_LABEL[item.provenance.quality]}</span>
        <time dateTime={item.ref.observedAt} className="type-metadata tabular">
          {formatDateTime(item.ref.observedAt)}
        </time>
        {/*
         * A proxy is a different instrument standing in for the one asked
         * about. Disclosed wherever the observation appears, never only where
         * it was resolved.
         */}
        {item.provenance.isProxy && <StatusBadge tone="warning">Ersättningsdata</StatusBadge>}
        <StatusBadge tone={rendered.tone}>{rendered.label}</StatusBadge>
      </div>
    </li>
  )
}
