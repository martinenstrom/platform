/**
 * The only door between the browser and the institution.
 *
 * Everything the Headquarters view knows arrives through here. The fitness rule
 * `no-ui-import-of-infrastructure` keeps it that way: a component that reached
 * for the analysis runtime directly would put a database driver, and its
 * credentials, into the client bundle.
 *
 * ## No longer read-only, and deliberately so
 *
 * This module was read-only through C1 and C2-1, and its own comment said the
 * firm was inspected here rather than operated. **C2-2 Stage B changed that on
 * purpose**, and the change is recorded rather than made quietly: judging an
 * agent's work is the act the acceptance boundary exists for, and a boundary a
 * person could only exercise from a test is not a boundary the institution
 * actually has.
 *
 * What did not change is the shape of the door:
 *
 * **One function per institutional act.** There is no generic
 * `runCommand(type, payload)` here and there must never be one. A client able
 * to name a command type would be choosing the firm's authority from a
 * browser, and every mandate in the system would then be guarding a decision
 * that had already been made somewhere else.
 *
 * **The client supplies the act, never the authority.** An acceptance carries
 * a run id and the employee acting; the case and the department are read from
 * the run on the server. A caller that could name its own department would be
 * asserting the mandate it is about to be checked against.
 *
 * **Refusals are institutional answers, not errors.** A command the firm
 * declines comes back as a refusal with its bounded code — `not-authorised`,
 * `illegal-prior-state` — because a desk being told it may not judge another
 * desk's work is the institution working correctly, and reporting it as a
 * failure would send someone to look at the database.
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
import {
  agentDesk,
  agentDirectory,
  type AgentDesk,
} from '~/application/analysis/agentDirectory'
import { runReview, type RunReview } from '~/application/analysis/runReview'
import {
  commissionAnalysis,
  commissionBrief,
  type CommissionBrief,
  type CommissionResult,
} from '~/application/analysis/commissionAnalysis'
import {
  createLiveContributionProvider,
  LIVE_MAX_OUTPUT_TOKENS,
  LIVE_MODEL_ID,
  LIVE_PROVIDER_KIND,
} from './providers/live'
import {
  operatorIdentities,
  type OperatorIdentity,
} from '~/application/analysis/operatorIdentity'
import { registeredPlaybooks } from '~/application/analysis/playbookRegistry'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { rejectContribution } from '~/application/analysis/commands/rejectContribution'
import type { RejectionCode } from '~/application/analysis/commandLog'
import {
  CONTRIBUTION_REJECTION_CODES,
  type ContributionRejectionCode,
  type RunState,
} from '~/domain/analysis'
import { createAnalysisContainer, type AnalysisContainer } from './container'
import { systemClock } from '~/domain/shared/clock'

/** Bounded. Never free text, and never anything read out of the failure. */
export type AnalysisReadFailure = 'NOT_CONFIGURED' | 'SERVICE_UNAVAILABLE' | 'NOT_FOUND'

/**
 * The original name, kept because the case surfaces are written against it.
 *
 * The union was never about case overviews specifically — it is what any read
 * through this boundary can fail with — and renaming it at every call site
 * would be churn in files this stage otherwise does not touch.
 */
export type CaseOverviewFailure = AnalysisReadFailure

export type CaseOverviewResponse =
  { ok: true; overview: CaseOverview } | { ok: false; code: AnalysisReadFailure }

export type CaseListResponse =
  { ok: true; cases: readonly CaseListing[] } | { ok: false; code: AnalysisReadFailure }

export type AgentDirectoryResponse =
  { ok: true; desks: readonly AgentDesk[] } | { ok: false; code: AnalysisReadFailure }

export type AgentDeskResponse =
  { ok: true; desk: AgentDesk } | { ok: false; code: AnalysisReadFailure }

export type RunReviewResponse =
  { ok: true; review: RunReview } | { ok: false; code: AnalysisReadFailure }

export type OperatorIdentitiesResponse =
  | { ok: true; identities: readonly OperatorIdentity[] }
  | { ok: false; code: AnalysisReadFailure }

export type CommissionBriefResponse =
  { ok: true; brief: CommissionBrief } | { ok: false; code: AnalysisReadFailure }

/**
 * What came of commissioning work.
 *
 * `NOT_CONFIGURED` gains a sibling here that the read boundary does not need:
 * a live desk cannot run without a model credential, and reporting that as a
 * service outage would send an operator to look at the database.
 */
export type CommissionFailure = AnalysisReadFailure | 'NO_MODEL_CREDENTIAL'

export type CommissionResponse =
  { ok: true; result: CommissionResult } | { ok: false; code: CommissionFailure }

/**
 * What came of an institutional act.
 *
 * Three outcomes, kept apart because they place different obligations on
 * whoever reads them:
 *
 *   `ok`        the firm did it, and here is the run's new state
 *   `refused`   the firm understood and declined. **Not a failure.** The
 *               bounded code says which rule, so the surface can explain it
 *   `failed`    something operational went wrong and nothing was decided
 *
 * Collapsing `refused` into `failed` would tell a person the system broke when
 * what actually happened is that the institution said no — and those lead to
 * completely different next actions.
 */
export type ActResponse =
  | { ok: true; state: RunState }
  | { ok: false; outcome: 'refused'; code: RejectionCode }
  | { ok: false; outcome: 'failed'; code: AnalysisReadFailure }

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

/* --------------------------------------------------------- Agent Headquarters */

/**
 * Every desk the firm can commission, with the work it has actually done.
 *
 * The playbooks are read from the registry here rather than inside the
 * derivation, for the reason the registry exists at all: what workflows this
 * build ships is a composition fact, and a read model that imported them itself
 * would decide it — which is one step from a second catalogue of who works
 * here.
 *
 * `NOT_FOUND` is not among its outcomes. A firm whose registered playbooks
 * assign work to nobody has an empty floor, which is a fact about the firm.
 */
export const getAgentDirectoryFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<AgentDirectoryResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      return {
        ok: true,
        desks: await agentDirectory({
          repositories: analysis.repositories,
          organization: deps.organization,
          playbooks: registeredPlaybooks(),
        }),
      }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] agent directory failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

/**
 * One desk, in full.
 *
 * `NOT_FOUND` here means the firm has no such desk to commission — either the
 * department does not exist, or no registered playbook assigns it work. Both
 * are the same answer to the reader's question, and distinguishing them on
 * screen would explain the registry rather than the firm.
 */
export const getAgentDeskFn = createServerFn({ method: 'POST' })
  .validator((departmentId: string) => departmentId)
  .handler(async ({ data: departmentId }): Promise<AgentDeskResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      const desk = await agentDesk({
        repositories: analysis.repositories,
        organization: deps.organization,
        playbooks: registeredPlaybooks(),
        departmentId,
      })

      if (!desk) return { ok: false, code: 'NOT_FOUND' }
      return { ok: true, desk }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] agent desk failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* --------------------------------------------------------------- the review */

/**
 * One run, assembled for the person judging it.
 *
 * Reads produced work — the claims an agent made that nobody has accepted —
 * which no read path in the system could reach before this one.
 */
export const getRunReviewFn = createServerFn({ method: 'POST' })
  .validator((runId: string) => runId)
  .handler(async ({ data: runId }): Promise<RunReviewResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      const review = await runReview({
        repositories: analysis.repositories,
        organization: deps.organization,
        runId,
      })

      if (!review) return { ok: false, code: 'NOT_FOUND' }
      return { ok: true, review }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] run review failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/**
 * Who the operator may act as.
 *
 * **Operator identity, not authentication.** Nothing here establishes that the
 * person at the keyboard is who they select, and the interface that renders
 * this is required to say so.
 */
export const getOperatorIdentitiesFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<OperatorIdentitiesResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()
      return { ok: true, identities: operatorIdentities(deps.organization) }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] operator identities failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

/* ------------------------------------------------------------ commissioning */

/**
 * What a person needs before asking a desk to do work.
 *
 * Every case the firm holds and every evidence set it holds, each carrying
 * whether it can be commissioned and — where it cannot — the institution's own
 * reason. Deliberately not pre-filtered to the eligible ones: "there are no
 * cases" and "there are four cases and none of them can take this work, here is
 * why each" are different things to put in front of somebody about to spend
 * money.
 *
 * The provider kind is taken from the live provider itself rather than named
 * here, so the eligibility this produces is the answer for the producer that
 * would actually run. A literal restated at this call site could disagree with
 * the provider constructed thirty lines below, and the screen would then offer
 * work under rules nothing was going to apply.
 */
export const getCommissionBriefFn = createServerFn({ method: 'POST' })
  .validator((input: { departmentId: string; entryKey?: string }) => input)
  .handler(async ({ data }): Promise<CommissionBriefResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      const brief = await commissionBrief({
        repositories: analysis.repositories,
        organization: deps.organization,
        playbooks: registeredPlaybooks(),
        departmentId: data.departmentId,
        ...(data.entryKey ? { entryKey: data.entryKey } : {}),
        providerKind: LIVE_PROVIDER_KIND,
      })

      if (!brief) return { ok: false, code: 'NOT_FOUND' }
      return { ok: true, brief }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] commission brief failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/**
 * A person commissioning a real analysis. **This spends money.**
 *
 * The write that closes the loop C2-1 opened: the same command sequence, the
 * same orchestration, the same live provider — reachable from the product for
 * the first time, and reachable only with a case, an evidence set and an
 * employee the caller names explicitly.
 *
 * **The client supplies the act, never the authority.** It names what to work
 * on and who is acting; the workflow, the brief and the budget are all read on
 * the server from the version the case is pinned to. A caller that could send
 * its own brief or its own budget would be choosing what the firm authorized
 * from a browser.
 *
 * Synchronous, by ruling. The request is held for as long as the run's
 * authorized deadline allows, which is what makes the result a fact read back
 * from the record rather than a promise about one.
 */
export const commissionAnalysisFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      caseId: string
      departmentId: string
      entryKey: string
      evidenceSetId: string
      actingEmployeeId: string
    }) => input,
  )
  .handler(async ({ data }): Promise<CommissionResponse> => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY
      /*
       * Refused before the runtime is even built. A live desk with no
       * credential cannot produce anything, and starting a run that was always
       * going to fail would spend an institutional record on a configuration
       * mistake.
       */
      if (!apiKey) return { ok: false, code: 'NO_MODEL_CREDENTIAL' }

      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      const result = await commissionAnalysis({
        repositories: analysis.repositories,
        deps,
        provider: createLiveContributionProvider({
          apiKey,
          model: LIVE_MODEL_ID,
          maxTokens: LIVE_MAX_OUTPUT_TOKENS,
          loadEvidenceSet: (id) => analysis.repositories.evidence.get(id),
        }),
        caseId: data.caseId,
        departmentId: data.departmentId,
        entryKey: data.entryKey,
        evidenceSetId: data.evidenceSetId,
        actingEmployeeId: data.actingEmployeeId,
        now: () => new Date(systemClock.isoNow()),
      })

      return { ok: true, result }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] commission analysis failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* ----------------------------------------------------------- the two acts */

/**
 * The command id for one operator's act on one run.
 *
 * Derived on the server from what the act IS — never accepted from a client,
 * which would let a replay be aimed at a record it did not create.
 *
 * **The acting employee is part of the identity, and has to be.** `runCommand`
 * folds `accountableEmployeeId` into the payload hash, so two people accepting
 * the same run are two different payloads. Under a fixed id the second would
 * come back `payload-conflict` — meaning a desk that selected the wrong
 * operator, was correctly refused, and then corrected it could never act at
 * all. Keying on the pair makes a genuine retry by the same person replay to
 * its original outcome, and a corrected attempt by the right person a fresh
 * command.
 */
function actCommandId(
  act: 'accept' | 'reject',
  runId: string,
  employeeId: string,
): string {
  return `${act}-${runId}-${employeeId}`
}

/** The envelope for a human act: the operator is both actor and initiator. */
function operatorEnvelope(commandId: string, correlationId: string, employeeId: string) {
  return {
    commandId,
    correlationId,
    /*
     * Both, deliberately. An orchestrator initiates agent work on the firm's
     * behalf; this is a person deciding, so there is nobody else to name.
     */
    actor: { kind: 'employee' as const, employeeId },
    initiator: { kind: 'employee' as const, employeeId },
    occurredAt: systemClock.isoNow(),
  }
}

/** Maps a command outcome onto the three answers the surface distinguishes. */
function actResponse(
  result: Awaited<ReturnType<typeof runCommand>>,
  state: () => Promise<RunState | null>,
): Promise<ActResponse> | ActResponse {
  if (result.outcome === 'committed') {
    return state().then((current): ActResponse =>
      current
        ? { ok: true, state: current }
        : { ok: false, outcome: 'failed', code: 'NOT_FOUND' },
    )
  }
  if (result.outcome === 'rejected') {
    /* The institution declined. An answer, not a fault. */
    return { ok: false, outcome: 'refused', code: result.rejection.code }
  }
  /*
   * `failed` and `unresolved` alike. An unresolved commit is deliberately NOT
   * reported as success: the outcome cannot yet be proven, and telling a person
   * their acceptance landed when nobody knows would be the one lie this whole
   * boundary exists to prevent. Re-reading the run is what settles it.
   */
  return { ok: false, outcome: 'failed', code: 'SERVICE_UNAVAILABLE' }
}

/**
 * A person accepting an agent's work into the institution.
 *
 * The act C2-1 built and only a test could perform. The case and the department
 * are read from the run: a caller able to name its own department would be
 * asserting the very mandate it is about to be checked against.
 */
export const acceptContributionFn = createServerFn({ method: 'POST' })
  .validator((input: { runId: string; actingEmployeeId: string }) => input)
  .handler(async ({ data }): Promise<ActResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      const run = await analysis.repositories.runs.get(data.runId)
      if (!run) return { ok: false, outcome: 'failed', code: 'NOT_FOUND' }

      const result = await runCommand(
        acceptContribution(deps.organization),
        { caseId: run.caseId, runId: run.id, departmentId: run.departmentId },
        operatorEnvelope(
          actCommandId('accept', run.id, data.actingEmployeeId),
          run.caseId,
          data.actingEmployeeId,
        ),
        deps,
      )

      return await actResponse(result, async () => {
        const settled = await analysis.repositories.runs.get(run.id)
        return settled?.state ?? null
      })
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, outcome: 'failed', code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] accept contribution failed', error)
      return { ok: false, outcome: 'failed', code: 'SERVICE_UNAVAILABLE' }
    }
  })

/**
 * A person declining an agent's work.
 *
 * The code is checked against the firm's vocabulary here as well as in the
 * command — not because the command is untrusted, but because this is the edge
 * where an arbitrary string arrives, and a value that is not a reason the firm
 * defines should not travel any further than the door it came in at.
 *
 * The prose is passed through untouched and is required by the command. A code
 * alone teaches nobody anything.
 */
export const rejectContributionFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      runId: string
      actingEmployeeId: string
      code: ContributionRejectionCode
      detail: string
    }) => input,
  )
  .handler(async ({ data }): Promise<ActResponse> => {
    try {
      if (!CONTRIBUTION_REJECTION_CODES.includes(data.code)) {
        return { ok: false, outcome: 'refused', code: 'invariant-violated' }
      }

      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      const run = await analysis.repositories.runs.get(data.runId)
      if (!run) return { ok: false, outcome: 'failed', code: 'NOT_FOUND' }

      const result = await runCommand(
        rejectContribution(deps.organization),
        {
          caseId: run.caseId,
          runId: run.id,
          departmentId: run.departmentId,
          code: data.code,
          detail: data.detail,
        },
        operatorEnvelope(
          actCommandId('reject', run.id, data.actingEmployeeId),
          run.caseId,
          data.actingEmployeeId,
        ),
        deps,
      )

      return await actResponse(result, async () => {
        const settled = await analysis.repositories.runs.get(run.id)
        return settled?.state ?? null
      })
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, outcome: 'failed', code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] reject contribution failed', error)
      return { ok: false, outcome: 'failed', code: 'SERVICE_UNAVAILABLE' }
    }
  })

/*
 * The C2-1 smoke proof, re-exported through the published boundary.
 *
 * `no-ui-import-of-infrastructure` permits the presentation layer to name
 * exactly one kind of infrastructure module: a `serverFns` boundary. The smoke
 * route reached into `smokeFns` directly and the rule caught it — correctly, so
 * the fix is to use the sanctioned door rather than widen it. The function
 * itself stays in its own module; only its reachability changes.
 */
export { c2SmokeProofFn, type SmokeResult } from './smokeFns'
