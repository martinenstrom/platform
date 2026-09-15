/**
 * The one analysis runtime in the process, and the one host gateway built on it.
 *
 * Lifted out of `serverFns.ts` unchanged so a second server-side caller — the
 * JARVIS live-voice session, which executes the voice model's delegation calls
 * on a sideband socket rather than inside a request — reaches the same
 * container, the same pool, the same provenance row and the same host
 * gateway as `financialOsHostFn`. Two containers would be two pools; two
 * gateway constructions would be two places to get the operator wrong.
 *
 * Nothing here is a server function and nothing here may be imported by the
 * UI; the fitness rule `no-ui-import-of-infrastructure` sees to that.
 */

import { createHostGateway, HOST_ORCHESTRATOR_ID } from '~/application/analysis/hostGateway'
import type { HostGateway } from '~/application/analysis/hostGateway'
import { OPERATOR_ENV, resolveCurrentOperator } from '~/application/analysis/currentOperator'
import { systemClock } from '~/domain/shared/clock'
import { createAnalysisContainer, type AnalysisContainer } from './container'

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

export async function runtime(): Promise<AnalysisContainer> {
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

export class NotConfiguredError extends Error {
  constructor() {
    super('The analysis runtime has no database configured.')
    this.name = 'NotConfiguredError'
  }
}

/**
 * JARVIS's way into the firm, built the one way it is ever built.
 *
 * Who is asking is the server-resolved current operator, exactly as
 * `getCurrentOperatorFn` reports it; the host is recorded as the initiator.
 * The caller — a request, or a voice session's sideband — never supplies
 * either.
 */
export async function productHostGateway(): Promise<HostGateway> {
  const analysis = await runtime()
  return createHostGateway({
    system: analysis.domainSystem(),
    operator: async () => {
      const deps = await analysis.commandDeps()
      return resolveCurrentOperator(process.env[OPERATOR_ENV], deps.organization)
    },
    surfaces: (caseId) => ({
      boardroom: `/cases/${caseId}`,
      record: `/cases/${caseId}/underlag`,
    }),
    orchestratorId: HOST_ORCHESTRATOR_ID,
    now: () => systemClock.isoNow(),
  })
}
