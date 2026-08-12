/**
 * Headquarters: one case, as the institution holding it.
 *
 * The first human interface to the institution. Everything above the fold
 * answers where the case stands; everything below it is the record a reader
 * drills into once they know why they are reading it.
 *
 * Reachable by URL only. The navigation layout is finished work and this stage
 * does not touch it.
 *
 * ## Read-only
 *
 * No command is issued from this page. Headquarters is where the firm is
 * inspected; publication and reconsideration are their own milestones, and a
 * read surface that grew a write path by accident would be the worst place to
 * find that out.
 */

import { createFileRoute } from '@tanstack/react-router'
import { FileQuestion, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { CaseStandingPanel } from '~/components/headquarters/CaseStandingPanel'
import { getCaseOverviewFn } from '~/infrastructure/analysis/serverFns'
import {
  eligibilityText,
  GATE_STATUS,
  STAGE_LABEL,
} from '~/presentation/analysis/caseStandingText'
import { formatDateTime } from '~/lib/format'
import type { CaseOverviewResponse } from '~/infrastructure/analysis/serverFns'

export const Route = createFileRoute('/cases/$caseId')({
  loader: async ({ params }) => getCaseOverviewFn({ data: params.caseId }),
  component: CasePage,
})

/** Bounded codes in, a sentence out. The code never reaches the reader. */
const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Ärendet finns inte.',
}

function CasePage() {
  return <CaseOverviewPage response={Route.useLoaderData() as CaseOverviewResponse} />
}

/**
 * The page itself, taking its data as a prop.
 *
 * Separated from the route so it can be rendered without a router. The point is
 * not tidiness: the human-visible page has to be provable against the same
 * institutional record the read model was verified with, and a component that
 * can only be reached through a loader cannot be put in front of one.
 */
export function CaseOverviewPage({ response }: { response: CaseOverviewResponse }) {
  if (!response.ok) {
    return (
      <PageShell>
        <PageHeader title="Ärende" description="Kunde inte läsas." />
        <EmptyState
          icon={response.code === 'NOT_FOUND' ? FileQuestion : ServerOff}
          title={FAILURE_TEXT[response.code] ?? 'Ärendet kunde inte läsas.'}
          description="Ingen institutionell information kunde hämtas för det här ärendet."
        />
      </PageShell>
    )
  }

  const { overview } = response
  const { standing, investmentCase } = overview
  const eligibility = eligibilityText(overview.eligibility)

  return (
    <PageShell>
      <PageHeader
        title={investmentCase.question}
        description={`${investmentCase.subject.displayName} · ${STAGE_LABEL[standing.stage]}`}
      />

      {/* ============================================ the workflow, first ==== */}
      <CaseStandingPanel standing={standing} />

      {/* ============================================ eligibility ============ */}
      <DashboardCard title="Beslutsunderlagets status">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={eligibility.tone}>{eligibility.label}</StatusBadge>
            {overview.eligibility.kind === 'recorded' && (
              <span className="type-metadata">
                {/*
                 * The policy the basis NAMES. Stated on screen because a
                 * verdict without the rule it was reached under cannot be
                 * re-examined -- and because this is emphatically not a
                 * re-evaluation under today's policy.
                 */}
                Bedömt enligt policy {overview.eligibility.policyVersion}
              </span>
            )}
          </div>

          {overview.eligibility.kind === 'recorded' && (
            <ul className="flex flex-col gap-2">
              {overview.eligibility.report.gates.map((gate) => {
                const rendered = GATE_STATUS[gate.status]
                return (
                  <li key={gate.code} className="flex items-center gap-3">
                    <code className="font-mono text-xs">{gate.code}</code>
                    <span className="ml-auto">
                      <StatusBadge tone={rendered.tone}>{rendered.label}</StatusBadge>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {overview.eligibility.kind === 'not-submitted' && (
            <p className="text-sm text-content-muted">
              Ärendet har inte lämnats in för beslut, så ingen bedömning finns att visa.
              Det är inte samma sak som att kraven inte är uppfyllda.
            </p>
          )}

          {overview.eligibility.kind === 'policy-unresolvable' && (
            <p className="text-sm text-content-muted">
              Underlaget hänvisar till en policyversion som den här versionen av systemet
              inte kan läsa. Bedömningen visas inte under någon annan policy — det skulle
              vara ett utlåtande firman aldrig gjort.
            </p>
          )}
        </div>
      </DashboardCard>

      {/* ============================================ the decision =========== */}
      <DashboardCard title="Beslut">
        {overview.decision === null ? (
          <p className="text-sm text-content-muted">Inget beslut är fattat ännu.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <Labelled label="Utfall">
                <code className="font-mono text-xs">
                  {overview.decision.outcome.kind}
                </code>
              </Labelled>
              <Labelled label="Beslutad av">
                {overview.decision.decidedByEmployeeId}
              </Labelled>
              <Labelled label="Tidpunkt">
                {formatDateTime(overview.decision.decidedAt)}
              </Labelled>
              <Labelled label="Mandat">{overview.decision.authorizationBasis}</Labelled>
            </div>

            <p className="text-sm">{overview.decision.rationale}</p>

            {/*
             * Dissent is part of the record, not a comment on it. The firm
             * decided KNOWING somebody disagreed, and a page that omitted this
             * would describe an agreement that never happened.
             */}
            {overview.decision.unresolvedDissent.length > 0 && (
              <div className="rounded-lg bg-warning-soft p-4">
                <span className="type-label">Kvarstående avvikande mening</span>
                <ul className="mt-2 flex flex-col gap-2">
                  {overview.decision.unresolvedDissent.map((dissent, index) => (
                    <li key={index} className="text-sm">
                      {dissent.raisedByDepartmentId && (
                        <span className="font-medium">
                          {dissent.raisedByDepartmentId}:{' '}
                        </span>
                      )}
                      {dissent.rationale}
                      {/*
                       * The weight it was raised at, verbatim. A dissent
                       * without its materiality reads as a footnote, and the
                       * whole point of recording it is that it was not one.
                       */}
                      <code className="ml-2 font-mono text-xs">
                        {dissent.materiality}
                      </code>
                      {/*
                       * And the CIO's answer to it. The domain calls this the
                       * field that matters: an objection shown without the
                       * reason it was overridden leaves the reader believing
                       * nobody responded to it.
                       */}
                      {dissent.acknowledgement && (
                        <span className="mt-1 block text-content-muted">
                          Bemötande: {dissent.acknowledgement}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DashboardCard>

      {/* ============================================ the record ============= */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Tes" count={overview.revisions.length}>
          {overview.revisions.map((revision) => (
            <Row key={revision.revisionId} primary={revision.statement}>
              {revision.position} · {revision.revisionId}
            </Row>
          ))}
        </Section>

        <Section title="Sammanvägning" count={overview.aggregations.length}>
          {overview.aggregations.map((aggregation) => (
            <Row key={aggregation.id} primary={aggregation.id}>
              {aggregation.dispositions.length} bedömda påståenden
            </Row>
          ))}
        </Section>

        <Section title="Bidrag" count={overview.claims.length}>
          {overview.claims.map((claim) => (
            <Row key={claim.id} primary={claim.statement}>
              {claim.type}
            </Row>
          ))}
        </Section>

        <Section title="Underlag" count={overview.evidenceSets.length}>
          {overview.evidenceSets.map((set) => (
            <Row key={set.id} primary={set.id}>
              {set.items.length} poster
            </Row>
          ))}
        </Section>

        <Section title="Faktagranskning" count={overview.verification.length}>
          {overview.verification.map((review) => (
            <Row key={review.reviewId} primary={review.status}>
              {review.reviewId} · {review.byDepartmentId}
            </Row>
          ))}
        </Section>

        <Section title="Devil's Advocate" count={overview.devilsAdvocate.length}>
          {overview.devilsAdvocate.map((review) => (
            <Row
              key={review.reviewId}
              primary={`${review.challenges.length} invändningar`}
            >
              {review.reviewId}
            </Row>
          ))}
        </Section>

        <Section title="Risk" count={overview.risk.length}>
          {overview.risk.map((review) => (
            <Row key={review.reviewId} primary={review.status}>
              {review.reviewId}
            </Row>
          ))}
        </Section>

        <Section title="Inlämningar till CIO" count={overview.submissions.length}>
          {overview.submissions.map((submission) => (
            <Row key={submission.id} primary={submission.state}>
              {formatDateTime(submission.submittedAt)} · policy{' '}
              {submission.basis.eligibilityPolicyVersion}
            </Row>
          ))}
        </Section>

        {/*
         * Returns are shown even when empty is not the case: work coming back
         * is a real institutional event, and a page that only showed forward
         * motion would describe a process no firm has.
         */}
        <Section title="Återsändningar" count={overview.returns.length}>
          {overview.returns.map((entry) => (
            <Row key={entry.id} primary={entry.returnedFor}>
              {entry.reason}
            </Row>
          ))}
        </Section>

        <Section title="Körningar" count={overview.runs.length}>
          {overview.runs.map((run) => (
            <Row key={run.id} primary={run.execution.playbookEntryKey}>
              {run.id}
            </Row>
          ))}
        </Section>
      </div>

      {/* ============================================ the timeline =========== */}
      <DashboardCard title="Händelseförlopp">
        <ol className="flex flex-col gap-2">
          {overview.timeline.map((event) => (
            <li key={event.eventId} className="flex flex-wrap items-baseline gap-x-3">
              <span className="type-metadata">{formatDateTime(event.occurredAt)}</span>
              <code className="font-mono text-xs">
                {event.subject}: {event.fromState ?? '—'} → {event.toState}
              </code>
              {event.actorEmployeeId && (
                <span className="type-metadata">{event.actorEmployeeId}</span>
              )}
            </li>
          ))}
        </ol>
      </DashboardCard>
    </PageShell>
  )
}

/* ------------------------------------------------------------- small parts */

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="type-metadata">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <DashboardCard
      title={`${title} (${count})`}
      /* The count is in the heading so an empty section is legibly empty. */
    >
      {count === 0 ? (
        <p className="text-sm text-content-muted">Inget registrerat.</p>
      ) : (
        <ul className="flex flex-col gap-3">{children}</ul>
      )}
    </DashboardCard>
  )
}

function Row({ primary, children }: { primary: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-sm">{primary}</span>
      <span className="type-metadata">{children}</span>
    </li>
  )
}
