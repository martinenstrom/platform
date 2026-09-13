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

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { FileQuestion, ServerOff } from 'lucide-react'
import { PageHeader, PageShell } from '~/components/layout/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { DebateFloor } from '~/components/boardroom/DebateFloor'
import { getCaseOverviewFn, resumeConveningFn } from '~/infrastructure/analysis/serverFns'
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
  const router = useRouter()
  return (
    <CaseOverviewPage
      response={Route.useLoaderData() as CaseOverviewResponse}
      onResumeConvening={async (caseId, actingEmployeeId) => {
        await resumeConveningFn({ data: { caseId, actingEmployeeId } })
        /*
         * Re-run the loader rather than reload the document. The page re-reads
         * the case it now has, and nothing mounted above the route — the shell,
         * and whatever presence it comes to hold — is torn down to do it.
         */
        await router.invalidate()
      }}
    />
  )
}

/**
 * The page itself, taking its data as a prop.
 *
 * Separated from the route so it can be rendered without a loader. The point is
 * not tidiness: the human-visible page has to be provable against the same
 * institutional record the read model was verified with, and a component that
 * can only be reached through a loader cannot be put in front of one.
 *
 * The resume act is a prop for the same reason: it needs the router, and the
 * page does not.
 */
export function CaseOverviewPage({
  response,
  onResumeConvening,
}: {
  response: CaseOverviewResponse
  /**
   * Only ever the SECOND command, against the case that already exists. A
   * resume that could open a case would be a second open command wearing a
   * different name.
   */
  onResumeConvening?: (caseId: string, actingEmployeeId: string) => Promise<void>
}) {
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

  const { overview, boardroom } = response

  return (
    <PageShell>
      {/*
       * No page-chrome heading here.
       *
       * The masthead below IS this page's heading: it carries the investment
       * question as the `<h1>`, with the subject and stage beside it. A generic
       * "Ärende" title above it produced a second `<h1>`, which left the
       * document with two top-level headings and made the page's real subject
       * the lesser of them.
       */}
      {/* ======================================== the debate, as it happened == */}
      {/*
       * FIRST, because it is the reading: the investment question, who
       * concluded what, where they differed, what stopped the case and why the
       * CIO could finally receive it.
       *
       * The workflow checklist used to lead. It is truthful and it is not the
       * story — a reader arriving at a case wants to know what the firm thinks
       * and where it disagreed with itself, not which of seven rows is ticked.
       * `CaseMasthead` carries the same standing as one compact line; the full
       * panel stays below, where somebody chasing a step can still find it.
       */}
      <DebateFloor
        overview={overview}
        boardroom={boardroom}
        onResumeConvening={
          onResumeConvening
            ? () =>
                onResumeConvening(
                  overview.investmentCase.id,
                  overview.investmentCase.ownerEmployeeId,
                )
            : undefined
        }
      />
    </PageShell>
  )
}
