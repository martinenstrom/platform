/**
 * The only door between the browser and the institution.
 *
 * Everything the Headquarters view knows arrives through here. The fitness rule
 * `no-ui-import-of-infrastructure` keeps it that way: a component that reached
 * for the analysis runtime directly would put a database driver, and its
 * credentials, into the client bundle.
 *
 * ## Read-only, deliberately
 *
 * Nothing here issues a command. Headquarters is where the firm is inspected,
 * not operated — publication and reconsideration are their own milestones, and
 * a read surface that quietly grew a write path would be the wrong place to
 * discover that.
 *
 * ## Errors say what happened, and nothing about how
 *
 * A failure returns a bounded code. It never carries a connection string, SQL,
 * a parameter, or a driver message. The rule the whole codebase follows: a
 * refusal must not become a way to read what was refused. `SERVICE_UNAVAILABLE`
 * tells an operator to look at the logs, which is where the detail belongs.
 *
 * ## One container, not one per request
 *
 * The runtime owns a connection pool and a provenance row. Building one per
 * request would open a pool per request, and would re-derive provenance on
 * every page load.
 */

import { createServerFn } from '@tanstack/react-start'
import { caseOverview, type CaseOverview } from '~/application/analysis/caseOverview'
import { caseListing, type CaseListing } from '~/application/analysis/caseListing'
import { createAnalysisContainer, type AnalysisContainer } from './container'
import { systemClock } from '~/domain/shared/clock'

/** Bounded. Never free text, and never anything read out of the failure. */
export type CaseOverviewFailure = 'NOT_CONFIGURED' | 'SERVICE_UNAVAILABLE' | 'NOT_FOUND'

export type CaseOverviewResponse =
  { ok: true; overview: CaseOverview } | { ok: false; code: CaseOverviewFailure }

export type CaseListResponse =
  { ok: true; cases: readonly CaseListing[] } | { ok: false; code: CaseOverviewFailure }

let container: Promise<AnalysisContainer> | null = null

/**
 * The runtime connects as the application role, never as the schema owner.
 *
 * A separate variable from `DATABASE_URL` on purpose: that one is the owner
 * connection the migrations run under, and it can drop tables. Reusing it here
 * would hand the request path a privilege the request path must never hold.
 */
function connectionString(): string | null {
  return process.env.ANALYSIS_DATABASE_URL ?? null
}

async function runtime(): Promise<AnalysisContainer> {
  if (!container) {
    const url = connectionString()
    if (!url) throw new NotConfiguredError()
    container = createAnalysisContainer({
      connectionString: url,
      buildId: process.env.BUILD_ID ?? 'dev',
      clock: systemClock,
    })
    /*
     * A failed start must not be cached as a permanent failure. Without this a
     * database that was briefly unreachable at boot would keep the process
     * refusing until it was restarted.
     */
    container.catch(() => {
      container = null
    })
  }
  return container
}

class NotConfiguredError extends Error {
  constructor() {
    super('The analysis runtime has no database configured.')
    this.name = 'NotConfiguredError'
  }
}

/**
 * One case, in full, as the institution holding it.
 *
 * `POST` rather than `GET` because a case id is not something to leave in
 * request logs and proxy caches by default.
 */
export const getCaseOverviewFn = createServerFn({ method: 'POST' })
  .validator((caseId: string) => caseId)
  .handler(async ({ data: caseId }): Promise<CaseOverviewResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      const overview = await caseOverview({
        repositories: analysis.repositories,
        organization: deps.organization,
        caseId,
        now: systemClock.isoNow(),
      })

      if (!overview) return { ok: false, code: 'NOT_FOUND' }
      return { ok: true, overview }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      /*
       * Logged in full on the server, reported as a code to the client. The
       * message may name a host, a role or a constraint, and none of that
       * belongs in a browser.
       */
      console.error('[analysis] case overview failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/**
 * Every case the firm is holding, with where each one stands.
 *
 * `NOT_FOUND` is not among its outcomes: a firm with no open cases has an
 * empty queue, which is a fact about the firm rather than a failure to find
 * something.
 */
export const getCaseListFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<CaseListResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      return {
        ok: true,
        cases: await caseListing({
          repositories: analysis.repositories,
          organization: deps.organization,
          now: systemClock.isoNow(),
        }),
      }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] case list failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)
