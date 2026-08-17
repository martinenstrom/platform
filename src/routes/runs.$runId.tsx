/**
 * Judgment: one piece of agent work, and the decision it is waiting for.
 *
 * The surface C2-1 built the acceptance boundary for and could not reach. Until
 * this page existed, work an agent had produced was durable, paid for, and
 * readable only from inside a command — the institution's most consequential
 * ruling was exercisable only by a test.
 *
 * ## Written for a person deciding, not for a reader of records
 *
 * The order is the order a reviewer thinks in: what was asked, what came back,
 * how far the firm trusts it and why, what it rests on — and only then the two
 * acts, with what each one means stated before the buttons that perform them.
 *
 * ## Produced work is not institutional work
 *
 * Everything on this page comes from the produced-claim store. None of it is in
 * `analysis.claims`, so none of it can be cited, verified, challenged or
 * aggregated — and the page says so, because a reviewer who assumed otherwise
 * would be judging something they thought was already in the record.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { FileQuestion, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { RunStateBadge } from '~/components/agents/RunStateBadge'
import { ProducedClaimCard } from '~/components/agents/ProducedClaimCard'
import { JudgementPanel } from '~/components/agents/JudgementPanel'
import {
  getOperatorIdentitiesFn,
  getRunReviewFn,
} from '~/infrastructure/analysis/serverFns'
import {
  budgetText,
  modelText,
  PROVIDER_KIND_LABEL,
  PROVIDER_KIND_TONE,
  RUN_FAILURE_LABEL,
  usageText,
} from '~/presentation/analysis/runText'
import { formatDateTime } from '~/lib/format'
import type {
  OperatorIdentitiesResponse,
  RunReviewResponse,
} from '~/infrastructure/analysis/serverFns'

export const Route = createFileRoute('/runs/$runId')({
  loader: async ({ params }) => ({
    review: await getRunReviewFn({ data: params.runId }),
    /*
     * Loaded beside the review rather than on demand. The operator has to be
     * chosen before either act is possible, and a dropdown that populates after
     * the page settles invites a click on a control that is not ready.
     */
    operators: await getOperatorIdentitiesFn(),
  }),
  component: () => {
    const data = Route.useLoaderData() as {
      review: RunReviewResponse
      operators: OperatorIdentitiesResponse
    }
    return <RunReviewPage review={data.review} operators={data.operators} />
  },
})

const FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Körningen finns inte.',
}

/** Exported so the review can be proved without a router. */
export function RunReviewPage({
  review: response,
  operators,
}: {
  review: RunReviewResponse
  operators: OperatorIdentitiesResponse
}) {
  if (!response.ok) {
    return (
      <PageShell>
        <PageHeader title="Granskning" description="Kunde inte läsas." />
        <EmptyState
          icon={response.code === 'NOT_FOUND' ? FileQuestion : ServerOff}
          title={FAILURE_TEXT[response.code] ?? 'Körningen kunde inte läsas.'}
          description="Ingen institutionell information kunde hämtas för den här körningen."
        />
      </PageShell>
    )
  }

  const { review } = response
  const { run } = review
  const model = modelText(run.execution.identity)
  const awaiting = review.decision.kind === 'open'

  return (
    <PageShell>
      <PageHeader
        title={review.investmentCase.question}
        description={`${review.investmentCase.subject.displayName} · ${review.department.name}`}
        actions={
          <Link
            to="/agents/$departmentId"
            params={{ departmentId: review.department.id }}
            className="type-metadata hover:text-content"
          >
            Till avdelningen
          </Link>
        }
      />

      {/* ================================================ where this stands === */}
      <DashboardCard title="Vad du tittar på">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <RunStateBadge state={run.state} />
            <StatusBadge tone={PROVIDER_KIND_TONE[run.execution.providerKind]}>
              {PROVIDER_KIND_LABEL[run.execution.providerKind]}
            </StatusBadge>
            <Link
              to="/cases/$caseId"
              params={{ caseId: run.caseId }}
              className="type-metadata ml-auto hover:text-content"
            >
              Ärendet
            </Link>
          </div>

          {/*
           * The sentence that keeps a reviewer from mistaking produced work for
           * the record. It is the whole institutional point of this screen.
           */}
          {awaiting && (
            <p className="text-sm leading-relaxed text-content-muted">
              Det här är <strong className="text-content">producerat arbete</strong>, inte
              firmans ståndpunkt. Påståendena är sparade och betalda, men de ingår inte i
              beslutsunderlaget och kan varken granskas, ifrågasättas eller åberopas
              förrän en människa godkänt dem.
            </p>
          )}

          {review.assignment && (
            <div className="flex flex-col gap-1">
              <span className="type-metadata">Uppdraget som gavs</span>
              <p className="text-sm leading-relaxed text-content">
                {review.assignment.brief}
              </p>
            </div>
          )}
        </div>
      </DashboardCard>

      {/* ================================================== the produced work == */}
      <section aria-label="Producerat arbete" className="flex flex-col gap-4">
        <h2 className="type-heading">Vad agenten kom fram till ({review.produced.length})</h2>
        {review.produced.length === 0 ? (
          <DashboardCard>
            <p className="text-sm text-content-muted">
              {run.failure
                ? 'Körningen producerade ingenting — den stoppade innan något arbete blev till.'
                : 'Inga påståenden är registrerade för den här körningen.'}
            </p>
          </DashboardCard>
        ) : (
          review.produced.map((reviewed) => (
            <ProducedClaimCard key={reviewed.claim.id} reviewed={reviewed} />
          ))
        )}
      </section>

      {/* ====================================================== the decision === */}
      {operators.ok ? (
        <JudgementPanel review={review} identities={operators.identities} />
      ) : (
        <DashboardCard title="Ditt beslut">
          <p className="text-sm text-content-muted">
            Medarbetarregistret kunde inte läsas, så ingen handling kan bokföras på en
            namngiven person just nu.
          </p>
        </DashboardCard>
      )}

      {/* ================================================ what produced it ===== */}
      <DashboardCard title="Körningen">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <time dateTime={run.startedAt} className="type-metadata tabular">
              Startad {formatDateTime(run.startedAt)}
            </time>
            {model && <span className="type-metadata">{model}</span>}
            <span className="type-metadata">
              {run.execution.playbookId} v{run.execution.playbookVersion} ·{' '}
              {run.execution.playbookEntryKey}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="type-metadata">
              Tillåtet: {budgetText(run.budget).join(' · ')}
            </span>
            <span className="type-metadata">Förbrukat: {usageText(run.usage)}</span>
          </div>

          {run.failure && (
            <p className="type-metadata text-negative">
              {RUN_FAILURE_LABEL[run.failure.category]} · försök {run.failure.attempt}
            </p>
          )}

          {review.evidenceSet && (
            <span className="type-metadata">
              Underlag: {review.evidenceSet.items.length} observationer
              {review.evidenceSet.disagreements.length > 0 &&
                ` · ${review.evidenceSet.disagreements.length} motsägelser mellan källor`}
            </span>
          )}
        </div>
      </DashboardCard>
    </PageShell>
  )
}
