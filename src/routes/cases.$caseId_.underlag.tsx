/**
 * The complete defensible record behind one committee case — the route.
 *
 * ## Why this is a separate route from the Boardroom
 *
 * The Boardroom is a meeting, meant to be entered, read at a glance and acted
 * from. The record is what somebody needs to audit or defend the work. Measured
 * on 2026-08-30, the two were one page: 5.87 viewports, of which the room was
 * 0.94. The split gave each its surface; nothing was simplified or duplicated.
 *
 * ## The same read model, not a second one
 *
 * The loader calls `getCaseOverviewFn`, exactly as the Boardroom does. This is a
 * presentation and routing split; there is no second projection, no second
 * derivation, and nothing here recomputes an institutional answer.
 *
 * ## The record is not defined here
 *
 * `CaseRecord` lives in `~/components/headquarters/CaseRecord` and is
 * re-exported unchanged, because the same record is opened contextually beside
 * the JARVIS conversation ("Visa underlaget"). This file owns the route and
 * nothing that could become a second Underlag.
 */

import { createFileRoute } from '@tanstack/react-router'
import { CaseRecord } from '~/components/headquarters/CaseRecord'
import { getCaseOverviewFn } from '~/infrastructure/analysis/serverFns'
import type { CaseOverviewResponse } from '~/infrastructure/analysis/serverFns'

export { CaseRecord }

export const Route = createFileRoute('/cases/$caseId_/underlag')({
  loader: async ({ params }) => getCaseOverviewFn({ data: params.caseId }),
  component: CaseRecordPage,
})

function CaseRecordPage() {
  return <CaseRecord response={Route.useLoaderData() as CaseOverviewResponse} />
}
