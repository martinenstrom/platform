/**
 * The complete defensible record behind one committee case.
 *
 * ## Why this is a separate route from the Boardroom
 *
 * The Boardroom is a meeting: the question, who is working on it, what
 * positions they hold, where they disagree, what Research Office synthesised,
 * what governance is blocking or clearing, and whether the CIO has received it.
 * It is meant to be entered, read at a glance and acted from.
 *
 * This is the other thing a firm needs and must not confuse with the first: the
 * evidence, the provenance, the complete claims, the full review objects, the
 * challenge history, the gate questions, the timestamps and the event ids —
 * everything somebody would need to audit or defend the work.
 *
 * Measured on 2026-08-30, the two were one page: 5.87 viewports, of which the
 * room was 0.94. Nothing here is new, simplified or duplicated — it is the same
 * blocks, rendered from the same payload, given the surface they belong to.
 *
 * ## The same read model, not a second one
 *
 * The loader calls `getCaseOverviewFn`, exactly as the Boardroom does. This is a
 * presentation and routing split; there is no second projection, no second
 * derivation, and nothing here recomputes an institutional answer.
 *
 * ## Distinct from `/evidence`
 *
 * `/evidence` is the firm's evidence desk: holdings and assembly across every
 * case, selected by rule, subject family and date range. It owns no case
 * semantics and is deliberately not overloaded with any. This route is one
 * case's record.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { FileQuestion, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { CaseStandingPanel } from '~/components/headquarters/CaseStandingPanel'
import { DecisionHistory } from '~/components/headquarters/DecisionHistory'
import { getCaseOverviewFn } from '~/infrastructure/analysis/serverFns'
import { eligibilityText, GATE_STATUS } from '~/presentation/analysis/caseStandingText'
import { formatDateTime } from '~/lib/format'
import type { CaseOverviewResponse } from '~/infrastructure/analysis/serverFns'

export const Route = createFileRoute('/cases/$caseId_/underlag')({
  loader: async ({ params }) => getCaseOverviewFn({ data: params.caseId }),
  component: CaseRecordPage,
})

/** Bounded codes in, a sentence out. The code never reaches the reader. */
const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Ärendet finns inte.',
}

function CaseRecordPage() {
  return <CaseRecord response={Route.useLoaderData() as CaseOverviewResponse} />
}

/**
 * The record itself, taking its data as a prop.
 *
 * Separated from the route for the reason the Boardroom page is: a surface that
 * can only be reached through a loader cannot be put in front of the same
 * institutional record the read model was verified with.
 */
export function CaseRecord({ response }: { response: CaseOverviewResponse }) {
  if (!response.ok) {
    return (
      <PageShell>
        <PageHeader title="Underlag" description="Kunde inte läsas." />
        <EmptyState
          icon={response.code === 'NOT_FOUND' ? FileQuestion : ServerOff}
          title={FAILURE_TEXT[response.code] ?? 'Underlaget kunde inte läsas.'}
          description="Ingen institutionell information kunde hämtas."
        />
      </PageShell>
    )
  }

  const { overview } = response
  const { standing } = overview
  const eligibility = eligibilityText(overview.eligibility)

  return (
    <PageShell>
      <PageHeader title="Underlag" description={overview.investmentCase.question} />
      <p className="type-metadata">
        <Link to="/cases/$caseId" params={{ caseId: overview.investmentCase.id }}>
          ← Tillbaka till styrelserummet
        </Link>
      </p>
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

      {/* ======================================= the decision history ======== */}
      <DecisionHistory
        history={overview.decisionHistory}
        reconsiderations={overview.reconsiderations}
        liveDecisionId={overview.decision?.decisionId ?? null}
      />

      {/* ================================== the workflow, in full, below ===== */}
      {/*
       * Demoted, not deleted. The masthead above states the same standing in a
       * line; a reader chasing a specific step still needs the whole thing, and
       * removing it to tidy the page would take away information the firm has.
       */}
      <CaseStandingPanel standing={standing} />

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

        {/*
         * Runs are listed, and are NOT links from here.
         *
         * Deliberate, and worth stating because the alternative looks obviously
         * right. This page is renderable without a router — the property its
         * own header names, and what lets the rendered page be proved against a
         * real institutional record rather than only through a loader. A
         * `<Link>` here would need router context in twenty-five existing
         * assertions and would trade that property for a second route to a
         * surface the desk already reaches.
         *
         * The way into a run's review is Agent Headquarters → desk → the run.
         * A case overview answers where the case stands; judging one desk's
         * contribution is a different question with its own surface.
         */}
        <Section title="Körningar" count={overview.runs.length}>
          {overview.runs.map((run) => (
            <Row key={run.id} primary={run.execution.playbookEntryKey}>
              {run.state === 'awaiting-acceptance'
                ? 'Väntar på beslut — öppnas från avdelningen'
                : run.id}
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
