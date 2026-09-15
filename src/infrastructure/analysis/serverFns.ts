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
import { boardroomTimeline } from '~/application/analysis/boardroomTimeline'
import {
  boardroomSeating,
  type BoardroomProjection,
} from '~/application/analysis/boardroomSeating'
import { caseListing, type CaseListing } from '~/application/analysis/caseListing'
import {
  commandCenterView,
  floorDeskOf,
  type CommandCenterView,
  type FloorDesk,
} from '~/application/analysis/commandCenter'
import { projectActivity } from '~/domain/analysis'
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
import { assembleEvidenceSet } from '~/application/analysis/commands/assembleEvidenceSet'
import { evidenceDesk, type EvidenceDeskView } from '~/application/analysis/evidenceDesk'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { rejectContribution } from '~/application/analysis/commands/rejectContribution'
import {
  OPERATOR_ENV,
  resolveCurrentOperator,
  type CurrentOperator,
  type OperatorRefusal,
} from '~/application/analysis/currentOperator'
import {
  resumeConvening,
  startInvestmentCase,
  type StartInvestmentCaseResult,
} from '~/application/analysis/startInvestmentCase'
import { parseHostRequest, type HostResult } from '~/application/analysis/hostContract'
import type { RejectionCode } from '~/application/analysis/commandLog'
import {
  CONTRIBUTION_REJECTION_CODES,
  type ContributionRejectionCode,
  type RunState,
} from '~/domain/analysis'
import { NotConfiguredError, productHostGateway, runtime } from './runtime'
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

/**
 * The case, and the room that renders it.
 *
 * `boardroom` is assembled HERE rather than in the component, because a read
 * model is institutional state and the presentation layer consumes it as data.
 * A surface that called the projection itself would be a second place the room
 * could be computed, and two answers to "who acted" is one too many.
 */
export type CaseOverviewResponse =
  | { ok: true; overview: CaseOverview; boardroom: BoardroomProjection }
  | { ok: false; code: AnalysisReadFailure }

export type CaseListResponse =
  { ok: true; cases: readonly CaseListing[] } | { ok: false; code: AnalysisReadFailure }

export type AgentDirectoryResponse =
  | {
      ok: true
      desks: readonly AgentDesk[]
      /**
       * The same desks, counted.
       *
       * Projected here rather than in the route: counting run states is
       * application work, and importing it into a component would put an
       * application module on a bundle edge — which is what the presentation
       * fitness rule refuses, and for a good reason. Headquarters and the
       * Command Center then count the floor exactly once, the same way.
       */
      floor: readonly FloorDesk[]
    }
  | { ok: false; code: AnalysisReadFailure }

export type CommandCenterResponse =
  { ok: true; view: CommandCenterView } | { ok: false; code: AnalysisReadFailure }

export type AgentDeskResponse =
  { ok: true; desk: AgentDesk } | { ok: false; code: AnalysisReadFailure }

export type RunReviewResponse =
  { ok: true; review: RunReview } | { ok: false; code: AnalysisReadFailure }

export type OperatorIdentitiesResponse =
  | { ok: true; identities: readonly OperatorIdentity[] }
  | { ok: false; code: AnalysisReadFailure }

export type EvidenceDeskResponse =
  { ok: true; view: EvidenceDeskView } | { ok: false; code: AnalysisReadFailure }

/**
 * What an assembly answers with.
 *
 * Three outcomes, kept apart for the reason `ActResponse` keeps them apart: a
 * refusal is the institution declining and carries its bounded code, a failure
 * is an operational fault, and only a commit names a set.
 */
export type AssembleResponse =
  | {
      ok: true
      assemblyId: string
      evidenceSetId: string
      observationCount: number
      derivedCount: number
    }
  | { ok: false; outcome: 'refused'; code: RejectionCode }
  | { ok: false; outcome: 'failed'; code: AnalysisReadFailure }

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

/*
 * The runtime — one container per process, and the `NotConfiguredError` every
 * handler below translates into `NOT_CONFIGURED` — lives in `./runtime` now,
 * so the JARVIS live-voice session reaches the same pool and the same host
 * gateway from outside a request. Nothing about it changed in the move.
 */

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

      const timeline = boardroomTimeline(overview)
      return {
        ok: true,
        overview,
        boardroom: { timeline, seats: boardroomSeating(overview, timeline) },
      }
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

/* ------------------------------------------------------------ Command Center */

/**
 * The firm's operating picture, assembled from read models that already exist.
 *
 * **Nothing new is derived.** Standing comes from `caseListing`, which calls the
 * domain; the floor comes from `agentDirectory`; activity comes from the
 * domain's own `projectActivity` over persisted run events and case
 * transitions; evidence is counted, not characterised. `commandCenterView`
 * arranges and counts, and that is the whole of its authority.
 *
 * **The activity source is deliberately the recorded one.** `events.recent()`
 * has existed on both adapters, contract-tested, with no production caller
 * since it was written — and `projectActivity`'s signature is the guarantee
 * that matters: run events and case transitions in, activity out, with no
 * parameter through which invented activity could enter.
 *
 * **The cost is stated rather than hidden.** `caseListing` computes one
 * standing per case, sequentially, and TD-71 records why it must not be fanned
 * out. This page therefore costs what the case list costs, and it is the
 * reason no second standing pass happens here.
 */
export const getCommandCenterFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<CommandCenterResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()
      const repositories = analysis.repositories

      const cases = await caseListing({
        repositories,
        organization: deps.organization,
        now: systemClock.isoNow(),
      })

      const desks = await agentDirectory({
        repositories,
        organization: deps.organization,
        playbooks: registeredPlaybooks(),
      })

      /*
       * Case transitions only. Run activity is projected from the runs the
       * directory already carries, so a run's history is read once rather than
       * assembled twice from two sources that could disagree.
       */
      const events = await repositories.events.recent(ACTIVITY_EVENT_LIMIT)
      const caseTransitions = events
        .filter((event) => event.subject === 'case')
        .map((event) => ({
          at: event.occurredAt,
          byDepartmentId: event.actorDepartmentId ?? 'unknown',
          caseId: event.caseId,
          from: event.fromState ?? '',
          to: event.toState,
        }))

      const sets = await repositories.evidence.list(EVIDENCE_SAMPLE_LIMIT)
      const assemblies = await repositories.assemblies.list(1)

      return {
        ok: true,
        view: commandCenterView({
          cases,
          desks,
          activity: projectActivity(
            desks.flatMap((desk) => desk.runs),
            caseTransitions,
            ACTIVITY_LINE_LIMIT,
          ),
          evidenceSetCount: sets.length,
          latestAssemblyAt: assemblies[0]?.assembledAt ?? null,
        }),
      }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] command center failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

/**
 * How far back the feed reads, and how much of it is shown.
 *
 * Two numbers because they answer different questions: the first bounds the
 * query, the second bounds the page. Reading more than is rendered is
 * deliberate — case transitions are filtered out of a mixed stream, so
 * fetching exactly the render count would silently shorten the feed whenever
 * run events dominated the tail.
 */
const ACTIVITY_EVENT_LIMIT = 120
const ACTIVITY_LINE_LIMIT = 24
/** Enough to count what the firm holds without reading every set's payload. */
const EVIDENCE_SAMPLE_LIMIT = 100

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

      const desks = await agentDirectory({
        repositories: analysis.repositories,
        organization: deps.organization,
        playbooks: registeredPlaybooks(),
      })

      return { ok: true, desks, floor: desks.map((desk) => floorDeskOf(desk)) }
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
        /*
         * A person commissioned this from the product, so a person is
         * accountable. The autonomous path supplies the desk's own principal
         * instead; the surface never chooses between them silently.
         */
        actingPrincipal: { kind: 'employee', employeeId: data.actingEmployeeId },
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

/**
 * What the firm holds for a family and a window, and what it has assembled.
 *
 * A read. It counts through the same `runSelection` the command runs, so the
 * screen and the act cannot disagree about what a selection means — and it
 * decides nothing: the command refuses independently.
 */
export const getEvidenceDeskFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      ruleId?: string
      subjectFamily?: string
      from?: string
      to?: string
      knownAt?: string
    }) => input,
  )
  .handler(async ({ data }): Promise<EvidenceDeskResponse> => {
    try {
      const analysis = await runtime()
      const selection =
        data.ruleId && data.subjectFamily && data.from && data.to
          ? {
              ruleId: data.ruleId,
              subjectFamily: data.subjectFamily,
              from: data.from,
              to: data.to,
              /*
               * Resolved here for the READ only, and echoed back so the screen
               * states the instant it counted at. The command resolves its own
               * from `occurredAt`, because what the record must hold is when
               * the ACT happened rather than when a screen was drawn.
               */
              knownAt: data.knownAt || systemClock.isoNow(),
            }
          : undefined

      const view = await evidenceDesk({
        repositories: analysis.repositories,
        ...(selection ? { selection } : {}),
      })
      return { ok: true, view }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] evidence desk failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

/**
 * A person declaring a body of evidence fit for analysis.
 *
 * The governed replacement for `/smoke/c2-1`, which manufactured an evidence
 * set with no actor, no mandate, no command, no ledger entry and no recorded
 * selection. Everything the client supplies is the ACT — which rule, which
 * window, who is acting. The authority is checked against the seeded firm by
 * the command, and the selection is executed on the server.
 *
 * The command id is derived from the request rather than sent, so a
 * double-click replays one act instead of filing two.
 */
export const assembleEvidenceSetFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      ruleId: string
      subjectFamily: string
      from: string
      to: string
      knownAt?: string
      onBehalfOfDepartmentId: string
      actingEmployeeId: string
    }) => input,
  )
  .handler(async ({ data }): Promise<AssembleResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()

      /*
       * Stable across a retry of the same request and distinct across two
       * different ones — the two properties the ledger's primary key needs.
       * A caller-supplied id would let one browser address another's act.
       */
      const commandId = [
        'assemble',
        data.ruleId,
        data.subjectFamily,
        data.from,
        data.to,
        data.knownAt ?? 'now',
        data.actingEmployeeId,
      ].join('-')

      const result = await runCommand(
        assembleEvidenceSet(deps.organization),
        {
          selection: {
            ruleId: data.ruleId,
            subjectFamily: data.subjectFamily,
            from: data.from,
            to: data.to,
            ...(data.knownAt ? { knownAt: data.knownAt } : {}),
          },
          onBehalfOfDepartmentId: data.onBehalfOfDepartmentId,
        },
        {
          ...operatorEnvelope(commandId, commandId, data.actingEmployeeId),
          /*
           * Deliberately NOT `systemClock.isoNow()` a second time. The envelope
           * already stamped `occurredAt`, and the command resolves `knownAt`
           * from it — two clock reads would let the record say the firm knew
           * something at an instant other than the one it acted at.
           */
        },
        deps,
      )

      if (result.outcome === 'committed') {
        const assembly = result.value
        return {
          ok: true,
          assemblyId: assembly.assemblyId,
          evidenceSetId: assembly.evidenceSetId,
          observationCount: assembly.observationCount,
          derivedCount: assembly.derivedCount,
        }
      }
      if (result.outcome === 'rejected') {
        return { ok: false, outcome: 'refused', code: result.rejection.code }
      }
      return { ok: false, outcome: 'failed', code: 'SERVICE_UNAVAILABLE' }
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, outcome: 'failed', code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] assemble evidence set failed', error)
      return { ok: false, outcome: 'failed', code: 'SERVICE_UNAVAILABLE' }
    }
  })

/*
 * `/smoke/c2-1` was retired here, in C3 Stage B, and is not coming back.
 *
 * It was the only production path that could write an `EvidenceSet`, and it did
 * so with no actor, no mandate, no command, no ledger entry, no event and no
 * recorded selection — beside nineteen governed acts. Gate §0.3 kept it alive
 * only until a replacement genuinely existed, because removing the sole working
 * evidence-write path ahead of one would have left the firm unable to produce
 * evidence at all. `assembleEvidenceSetFn` above is that replacement.
 *
 * The records it created are untouched. The C2-2 run's evidence set and the
 * seven claims citing it remain readable, resolvable and cited as the v1
 * evidence they are (§0.1) — retiring the door does not rewrite what came
 * through it.
 *
 * The fitness rule `evidence-assembled-only-by-the-governed-act` is what keeps
 * a second door from being opened by accident.
 */

/* ------------------------------------------------------ convening a committee */

/**
 * The Chairman's act, at the published boundary.
 *
 * The orchestration itself lives in `application/analysis/startInvestmentCase`,
 * where it is reachable by tests. Both server functions below are transport:
 * they build the runtime, hand over, and translate a thrown configuration
 * fault into the same bounded vocabulary every other read and write here uses.
 *
 * The three-state result is passed through UNCHANGED. Collapsing
 * `convening-incomplete` into success or failure at this edge would throw away
 * the one distinction the Chairman Console exists to act on.
 */
export type StartInvestmentCaseResponse = StartInvestmentCaseResult

export const startInvestmentCaseFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      question: string
      subjectDisplayName: string
      /** Minted once per submission so a retry does not open a second case. */
      requestId: string
      actingEmployeeId: string
    }) => input,
  )
  .handler(async ({ data }): Promise<StartInvestmentCaseResponse> => {
    try {
      const analysis = await runtime()
      return await startInvestmentCase({
        repositories: analysis.repositories,
        deps: await analysis.commandDeps(),
        question: data.question,
        subjectDisplayName: data.subjectDisplayName,
        requestId: data.requestId,
        actingEmployeeId: data.actingEmployeeId,
      })
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { state: 'refused', code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] start investment case failed', error)
      return { state: 'refused', code: 'SERVICE_UNAVAILABLE' }
    }
  })

/** *Återuppta sammankallning*. Never opens a case; only convenes an open one. */
export const resumeConveningFn = createServerFn({ method: 'POST' })
  .validator((input: { caseId: string; actingEmployeeId: string }) => input)
  .handler(async ({ data }): Promise<StartInvestmentCaseResponse> => {
    try {
      const analysis = await runtime()
      return await resumeConvening({
        repositories: analysis.repositories,
        deps: await analysis.commandDeps(),
        caseId: data.caseId,
        actingEmployeeId: data.actingEmployeeId,
      })
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { state: 'refused', code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] resume convening failed', error)
      return { state: 'refused', code: 'SERVICE_UNAVAILABLE' }
    }
  })

/* -------------------------------------------------- who is asking the firm */

export type CurrentOperatorResponse =
  | { ok: true; operator: CurrentOperator }
  | { ok: false; code: OperatorRefusal | AnalysisReadFailure }

/**
 * The operator the server is configured to act for.
 *
 * Read from the server's own configuration and resolved against the seeded
 * organisation. The client is TOLD who the operator is; it does not choose,
 * which is the difference between this and the acting-as dropdown it replaces
 * on the product path.
 *
 * It is not authentication and the response says so: `authentication` is
 * `system-asserted`, the same value the ledger records, because nobody logged
 * in. TD-8 stays open.
 */
export const getCurrentOperatorFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<CurrentOperatorResponse> => {
    try {
      const analysis = await runtime()
      const deps = await analysis.commandDeps()
      return resolveCurrentOperator(process.env[OPERATOR_ENV], deps.organization)
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { ok: false, code: 'NOT_CONFIGURED' }
      }
      console.error('[analysis] current operator failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  },
)

/* ------------------------------------------------ the host's one door */

/**
 * JARVIS's way into the firm, and the only one.
 *
 * One function, one discriminated request, one typed product result — see
 * `application/analysis/hostContract`. It is not a way to reach the sixteen
 * functions above: it exposes no command, accepts no actor, names no playbook
 * entry and returns no run state. The host holds a reference and the firm
 * interprets its own record.
 *
 * Input is taken as `unknown` and parsed inside, because a request that
 * carries a field the contract does not name — an actor, say — has to be
 * refused as a typed result the host can read, not thrown as a transport
 * error nobody can.
 *
 * Who is asking is the server-resolved current operator, exactly as
 * `getCurrentOperatorFn` reports it; the host is recorded as the initiator.
 */
export type FinancialOsHostResponse = HostResult

export const financialOsHostFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<FinancialOsHostResponse> => {
    const parsed = parseHostRequest(data)
    if (!parsed.ok)
      return { state: 'failed', reason: 'invalid-request', field: parsed.field }

    try {
      const gateway = await productHostGateway()
      return await gateway(parsed.request)
    } catch (error) {
      if (error instanceof NotConfiguredError) {
        return { state: 'failed', reason: 'not-configured' }
      }
      console.error('[analysis] host gateway failed', error)
      return { state: 'failed', reason: 'service-unavailable' }
    }
  })
