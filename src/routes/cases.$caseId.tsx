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
 *
 * ## The page is not defined here
 *
 * `CaseOverviewPage` lives in `~/components/boardroom/CaseOverviewPage` and is
 * re-exported unchanged, because the same page is opened contextually beside
 * the JARVIS conversation. This file owns the route — the loader, and the
 * resume act that needs the router — and nothing that could become a second
 * Boardroom.
 */

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CaseOverviewPage } from '~/components/boardroom/CaseOverviewPage'
import { getCaseOverviewFn, resumeConveningFn } from '~/infrastructure/analysis/serverFns'
import type { CaseOverviewResponse } from '~/infrastructure/analysis/serverFns'

export { CaseOverviewPage }

export const Route = createFileRoute('/cases/$caseId')({
  loader: async ({ params }) => getCaseOverviewFn({ data: params.caseId }),
  component: CasePage,
})

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
