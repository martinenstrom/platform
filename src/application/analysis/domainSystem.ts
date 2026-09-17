/**
 * Financial OS, as the system above it sees it.
 *
 * JARVIS is the personal AI layer. Financial OS is a specialist domain system
 * inside it: the user talks to JARVIS, JARVIS decides a request belongs to the
 * firm, delegates it here, and presents what the firm concluded through its own
 * single identity. This module is the face Financial OS turns towards that
 * host — and towards any host, because nothing here knows what JARVIS is.
 *
 * ## What it is
 *
 * A port. Application-layer and transport-agnostic, constructed by the
 * composition root and callable from a test against the in-memory store. It
 * wraps use cases and read models that already exist and adds no institutional
 * behaviour: every act still goes through `runCommand`, every refusal is still
 * the firm's own word for it, and every result is a typed record the
 * presentation boundary already forbids anyone from recomputing.
 *
 * ## The delegation contract, and why it needs no new vocabulary
 *
 * The command envelope has always separated who is ACCOUNTABLE (the actor) from
 * who DISPATCHED (the initiator), and `orchestrator` has always been an
 * initiator kind. A host is an orchestrator. The person asking is the actor.
 * The ledger records both, and a reader can see that JARVIS dispatched an act
 * a named employee is answerable for — which is the truthful provenance, and
 * different from either "the person clicked" or "the system did it".
 *
 * ## What a host may keep
 *
 * A `DomainReference`: an id and the storage provenance it was read under.
 * Never a copy of the record. A copy in a host's memory would be a second
 * answer free to disagree with the firm; a reference is verifiable later,
 * because every Financial OS identity carries its canonicalization version.
 *
 * ## What it does not do
 *
 * It does not authenticate — `authentication` stays `system-asserted`, and
 * TD-8 becomes a fact the host resolves and this port consumes. It does not
 * decide whether a request belongs to the firm; that is the host's. It does
 * not expose commissioning or governance acts yet: what a host may do
 * autonomously against a decision gate is a ruling this port waits for.
 */

import type { CaseAmendment, CaseStanding, InvestmentCase } from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import { runCommand, type CommandDeps } from './commands/runCommand'
import type { CommandResult } from './commands/envelope'
import { amendCase } from './commands/amendCase'
import { closeCase } from './commands/closeCase'
import { proposeThesis } from './commands/proposeThesis'
import { assembleEvidenceSet } from './commands/assembleEvidenceSet'
import { commissionAnalysis, type CommissionResult } from './commissionAnalysis'
import type { ContributionProvider } from './contributionPort'
import { requirePlaybook, UnknownPlaybookError } from './playbookRegistry'
import { evidenceWindow, openingProposal, standingEvidenceFor } from './opening'
import type { HostOpening, HostWithheldReason } from './hostContract'
import {
  caseIdFor,
  resumeConvening,
  startInvestmentCase,
  type StartInvestmentCaseResult,
} from './startInvestmentCase'
import { caseListing, type CaseListing } from './caseListing'
import { caseOverview, type CaseOverview } from './caseOverview'
import { standingForCase } from './caseStandingFor'
import { resolveCurrentOperator, type CurrentOperatorResult } from './currentOperator'
import { operatorIdentities, type OperatorIdentity } from './operatorIdentity'

/** How this system names itself to a host's registry of domain systems. */
export const FINANCIAL_OS_SYSTEM_ID = 'financial-os' as const

/**
 * What a host supplies when it hands work to the firm.
 *
 * Deliberately three things. The host's idempotency key, because a retried
 * delegation must land on the same case rather than open a second one; the
 * person, as the firm employs them, because the firm refuses to invent a
 * principal; and the host's own name, recorded as the initiator so the ledger
 * says who dispatched the act without ever saying the host performed it.
 *
 * No correlation id of the host's own. Financial OS correlates by case, and
 * the case id derives from `requestId` — so the host's key already links the
 * two, and a second correlation would be a second place for them to disagree.
 */
export interface Delegation {
  /** Minted once per request by the host. Same key, same case. */
  requestId: string
  /** Who is asking, as the seeded organisation employs them. */
  actingEmployeeId: string
  /** The host, as the ledger will record the initiator. Never the actor. */
  orchestratorId: string
}

/**
 * What a host may keep about a Financial OS record.
 *
 * The id and the storage provenance it was read under — enough to find the
 * record again and to notice, later, that the firm's storage has moved since.
 * Not the record: the firm is the source of truth for its own state.
 */
export interface DomainReference {
  system: typeof FINANCIAL_OS_SYSTEM_ID
  kind: 'case'
  id: string
  provenanceId: string
}

/**
 * What an act on an open case came back with.
 *
 * `refused` carries the institution's own code — `not-authorised`,
 * `illegal-prior-state`, `not-found` — never a driver message. `unresolved`
 * is a commit that cannot be proven either way, and is not reported as done.
 */
export type CaseActResult<T> =
  | { state: 'done'; value: T }
  | { state: 'refused'; code: string }
  /** Storage failed before or during the commit; nothing is claimed. */
  | { state: 'failed' }
  | { state: 'unresolved' }

export interface FinancialOsSystem {
  readonly id: typeof FINANCIAL_OS_SYSTEM_ID

  /* ------------------------------------------------------------ identity */

  /**
   * The operator this deployment is configured to act for, resolved against
   * the organisation. Fails closed: absent, unknown or departed refuses.
   */
  operator(configuredEmployeeId: string | undefined): Promise<CurrentOperatorResult>
  /** Everyone who may act, as the organisation names them. */
  operators(): Promise<readonly OperatorIdentity[]>

  /* ---------------------------------------------------------- delegation */

  /** The case a delegation will land on, knowable before it lands. */
  caseIdFor(requestId: string): string
  /** The Chairman's question, asked on the host's behalf by the person named. */
  ask(
    delegation: Delegation,
    request: { question: string; subjectDisplayName: string },
  ): Promise<StartInvestmentCaseResult>
  /** Convene the committee on a case whose first commit landed and second did not. */
  resume(delegation: Delegation, caseId: string): Promise<StartInvestmentCaseResult>

  /* ------------------------------------------------- the open case, acted on */

  /**
   * The person adds to their open case — "ta hänsyn till dollarn också".
   *
   * Recorded beside the question with who, when and at which version; it
   * moves no stage and starts no work. `requestId` is the host's idempotency
   * key for this addition, as it is for `ask`: the same key lands on the same
   * record rather than adding it twice.
   */
  amend(
    delegation: Delegation,
    caseId: string,
    text: string,
  ): Promise<CaseActResult<CaseAmendment>>
  /**
   * The person closes their case on explicit instruction, with the reason
   * they gave. The case becomes `withdrawn`; its history stays. Whether that
   * reads as cancelled or abandoned is derived from the record afterwards.
   */
  close(
    delegation: Delegation,
    caseId: string,
    reason: string,
  ): Promise<CaseActResult<InvestmentCase>>
  /**
   * The person's opening position, on their behalf, and the firm advanced as
   * far as policy permits (ruled 2026-09-17; closes TD-88).
   *
   * Revision 1 is proposed from the person's words — the operator is the
   * actor, the host the initiator, as for the question itself — unless the
   * case already holds one. Then the standing evidence basis for the
   * workflow is assembled and every desk that may start is commissioned
   * under its own institutional agent. What started and what was withheld
   * is read off the record and reported; nothing is promised.
   */
  begin(
    delegation: Delegation,
    caseId: string,
    opening: HostOpening,
  ): Promise<CaseActResult<BeginOutcome>>

  /* ------------------------------------------------------------- results */

  /** Every case the firm holds, outstanding first. */
  queue(): Promise<readonly CaseListing[]>
  /** Where one case stands: stage, ownership, blockers, and what happens next. */
  standing(caseId: string): Promise<CaseStanding | null>
  /** Everything the firm holds on one case, with eligibility as recorded. */
  overview(caseId: string): Promise<CaseOverview | null>
  /** What a host may keep. */
  reference(caseId: string): Promise<DomainReference>
}

/** What the firm did when it was advanced on the person's word. */
export interface CaseCommission {
  evidence: {
    evidenceSetId: string
    family: string
    from: string
    to: string
    observations: number
  } | null
  started: readonly { departmentId: string; runId: string }[]
  withheld: readonly { departmentId: string | null; reason: HostWithheldReason }[]
}

export interface BeginOutcome {
  /** The opening the case now holds: proposed by this act, or the one it already had. */
  revisionId: string
  commission: CaseCommission
}

/**
 * What advancing a case needs from the world: a provider that executes a
 * desk's work, and how long to wait for a run to appear on the record
 * before reporting a desk as not started.
 *
 * A live provider runs for minutes; the person is not kept waiting for
 * that. The commission continues in this process after `begin` returns,
 * and what the person is told is read off the run record — a run inside
 * its window is work the firm is doing, and a process that dies mid-run
 * leaves exactly what TD-92 describes, reported as such.
 */
export interface AdvanceDeps {
  provider: () => ContributionProvider | null
  startWaitMs?: number
  /** Where a commission that continues after `begin` reports how it ended. */
  log?: (line: string) => void
}

export function createFinancialOsSystem(input: {
  repositories: AnalysisRepositories
  /** Assembled per call, so the organisation read is the current one. */
  commandDeps: () => Promise<CommandDeps>
  /** Domain time, from the clock the container was built with. */
  now: () => string
  /** Absent in a deployment that may open but not advance: every desk is then withheld. */
  advance?: AdvanceDeps
}): FinancialOsSystem {
  const { repositories, commandDeps, now, advance } = input

  /** The initiator every delegated act is recorded under. */
  const initiatedBy = (delegation: Delegation) =>
    ({ kind: 'orchestrator', orchestratorId: delegation.orchestratorId }) as const

  /**
   * The desk a case belongs to, read from its owner — the department the
   * convenor mandate is about. Resolved here, never named by a host: a host
   * that could name the department could name one it happens to be allowed
   * to act for.
   */
  async function owningDepartmentOf(
    caseId: string,
    deps: CommandDeps,
  ): Promise<
    | { ok: true; departmentId: string; version: number }
    | { ok: false; result: { state: 'refused'; code: string } }
  > {
    const current = await repositories.cases.get(caseId)
    if (!current) return { ok: false, result: { state: 'refused', code: 'not-found' } }
    const owner = deps.organization.employees.find(
      (employee) => employee.id === current.ownerEmployeeId,
    )
    if (!owner) return { ok: false, result: { state: 'refused', code: 'not-authorised' } }
    return { ok: true, departmentId: owner.departmentId, version: current.version }
  }

  /** A command's outcome, in the port's words. */
  const settled = <T>(result: CommandResult<T>): CaseActResult<T> => {
    switch (result.outcome) {
      case 'committed':
        return { state: 'done', value: result.value }
      case 'rejected':
        return { state: 'refused', code: result.rejection.code }
      case 'failed':
        return { state: 'failed' }
      case 'unresolved':
        return { state: 'unresolved' }
    }
  }

  /** A commission's refusal, in the host's semantic words. */
  const withheldReason = (result: CommissionResult): HostWithheldReason => {
    if (result.outcome === 'declined') return 'declined'
    if (result.outcome === 'ran') return 'declined'
    switch (result.reason) {
      case 'dependencies-not-met':
        return 'dependencies-not-met'
      case 'no-authorized-budget':
        return 'no-authorized-budget'
      case 'evidence-not-found':
      case 'evidence-has-no-observations':
        return 'no-observations'
      default:
        return 'not-assignable'
    }
  }

  /** The next run on the record for this assignment, or null once the wait is over. */
  async function runAppears(
    caseId: string,
    assignmentId: string,
    known: ReadonlySet<string>,
    waitMs: number,
  ): Promise<string | null> {
    const until = Date.now() + waitMs
    for (;;) {
      const runs = await repositories.runs.listForCase(caseId)
      const fresh = runs.find((run) => run.assignmentId === assignmentId && !known.has(run.id))
      if (fresh) return fresh.id
      if (Date.now() >= until) return null
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /**
   * The firm advanced as far as policy permits, on the person's word.
   *
   * Evidence first, from the workflow's standing basis; then every entry of
   * the pinned workflow, in its order, under the desk's own institutional
   * agent. Each commission is started and left to run; `begin` waits only
   * until the run is on the record. Refusals are the institution's own,
   * reported in the host's words, and nothing is retried.
   */
  async function advanceCase(
    delegation: Delegation,
    current: InvestmentCase,
    owningDepartmentId: string,
    deps: CommandDeps,
  ): Promise<CaseCommission> {
    const none = (reason: HostWithheldReason): CaseCommission => ({
      evidence: null,
      started: [],
      withheld: [{ departmentId: null, reason }],
    })
    if (!advance) return none('no-provider')
    const basis = standingEvidenceFor(current.playbookId)
    if (!basis || !current.playbookId || !current.playbookVersion) return none('no-evidence-basis')

    const at = now()
    const window = evidenceWindow(at, basis.windowDays)
    const assembled = await runCommand(
      assembleEvidenceSet(deps.organization),
      {
        selection: {
          ruleId: basis.ruleId,
          subjectFamily: basis.subjectFamily,
          from: window.from,
          to: window.to,
        },
        onBehalfOfDepartmentId: owningDepartmentId,
      },
      {
        commandId: `${current.id}-begin-${delegation.requestId}-evidence`,
        correlationId: current.id,
        actor: { kind: 'employee', employeeId: delegation.actingEmployeeId },
        initiator: initiatedBy(delegation),
        occurredAt: at,
      },
      deps,
    )
    if (assembled.outcome !== 'committed') {
      /* "The firm holds no observations for …" is the one refusal the person is told in those words. */
      const why = assembled.outcome === 'rejected' ? JSON.stringify(assembled.rejection) : ''
      return none(/no observations/i.test(why) ? 'no-observations' : 'declined')
    }
    const evidence = {
      evidenceSetId: assembled.value.evidenceSetId,
      family: basis.subjectFamily,
      from: window.from,
      to: window.to,
      observations: assembled.value.observationCount,
    }

    const provider = advance.provider()
    if (!provider) return { evidence, started: [], withheld: [{ departmentId: null, reason: 'no-provider' }] }

    let playbook
    try {
      playbook = requirePlaybook(current.playbookId, current.playbookVersion)
    } catch (error) {
      if (error instanceof UnknownPlaybookError)
        return { evidence, started: [], withheld: [{ departmentId: null, reason: 'not-assignable' }] }
      throw error
    }

    const started: { departmentId: string; runId: string }[] = []
    const withheld: { departmentId: string | null; reason: HostWithheldReason }[] = []
    const known = new Set((await repositories.runs.listForCase(current.id)).map((run) => run.id))
    const assignments = await repositories.assignments.listForCase(current.id)
    for (const entry of playbook.entries) {
      const assignment = assignments.find(
        (candidate) => candidate.playbookEntryKey === entry.key && candidate.departmentId === entry.departmentId,
      )
      if (!assignment) {
        withheld.push({ departmentId: entry.departmentId, reason: 'not-assignable' })
        continue
      }
      const principal = deps.organization.agentPrincipals.find(
        (candidate) => candidate.active && candidate.departmentId === entry.departmentId,
      )
      if (!principal) {
        withheld.push({ departmentId: entry.departmentId, reason: 'no-principal' })
        continue
      }
      const commission = commissionAnalysis({
        repositories,
        deps,
        provider,
        caseId: current.id,
        departmentId: entry.departmentId,
        entryKey: entry.key,
        evidenceSetId: evidence.evidenceSetId,
        actingPrincipal: { kind: 'institutional-agent', agentPrincipalId: principal.id },
        now: () => new Date(now()),
      })
      /* Left to run; how it ended is on the record, and in the log for whoever reads it. */
      commission.then(
        (result) => advance.log?.(`[begin] ${current.id} ${entry.key}: ${result.outcome}${'reason' in result ? ` ${result.reason}` : ''}${'state' in result ? ` ${result.state}` : ''}`),
        (error: unknown) => advance.log?.(`[begin] ${current.id} ${entry.key}: threw ${String(error)}`),
      )
      const outcome = await Promise.race([
        commission.then((result) => ({ kind: 'settled' as const, result })),
        runAppears(current.id, assignment.id, known, advance.startWaitMs ?? 3000).then((runId) => ({ kind: 'appeared' as const, runId })),
      ])
      if (outcome.kind === 'appeared') {
        if (outcome.runId) {
          known.add(outcome.runId)
          started.push({ departmentId: entry.departmentId, runId: outcome.runId })
        } else {
          /* Neither refused nor on the record inside the wait: not started, as far as the person can be told. */
          withheld.push({ departmentId: entry.departmentId, reason: 'declined' })
        }
      } else if (outcome.result.outcome === 'ran') {
        known.add(outcome.result.runId)
        started.push({ departmentId: entry.departmentId, runId: outcome.result.runId })
      } else {
        withheld.push({ departmentId: entry.departmentId, reason: withheldReason(outcome.result) })
      }
    }
    return { evidence, started, withheld }
  }

  return {
    id: FINANCIAL_OS_SYSTEM_ID,

    async operator(configuredEmployeeId) {
      const deps = await commandDeps()
      return resolveCurrentOperator(configuredEmployeeId, deps.organization)
    },

    async operators() {
      const deps = await commandDeps()
      return operatorIdentities(deps.organization)
    },

    caseIdFor,

    async ask(delegation, request) {
      return startInvestmentCase({
        repositories,
        deps: await commandDeps(),
        question: request.question,
        subjectDisplayName: request.subjectDisplayName,
        requestId: delegation.requestId,
        actingEmployeeId: delegation.actingEmployeeId,
        initiator: initiatedBy(delegation),
        now,
      })
    },

    async resume(delegation, caseId) {
      return resumeConvening({
        repositories,
        deps: await commandDeps(),
        caseId,
        actingEmployeeId: delegation.actingEmployeeId,
        initiator: initiatedBy(delegation),
        now,
      })
    },

    async amend(delegation, caseId, text) {
      const deps = await commandDeps()
      const owning = await owningDepartmentOf(caseId, deps)
      if (!owning.ok) return owning.result
      const result = await runCommand(
        amendCase(deps.organization),
        {
          caseId,
          amendmentId: `${caseId}-amend-${delegation.requestId}`,
          text,
          onBehalfOfDepartmentId: owning.departmentId,
        },
        {
          commandId: `${caseId}-amend-${delegation.requestId}`,
          correlationId: caseId,
          actor: { kind: 'employee', employeeId: delegation.actingEmployeeId },
          initiator: initiatedBy(delegation),
          occurredAt: now(),
        },
        deps,
      )
      return settled(result)
    },

    async close(delegation, caseId, reason) {
      const deps = await commandDeps()
      const owning = await owningDepartmentOf(caseId, deps)
      if (!owning.ok) return owning.result
      const result = await runCommand(
        closeCase(deps.organization),
        { caseId, onBehalfOfDepartmentId: owning.departmentId },
        {
          /*
           * One closure per case, whatever asked for it: a retry of the same
           * instruction replays; a second instruction after a reopening — an
           * act the firm has not written — would be a different case version
           * and a different command id then.
           */
          commandId: `${caseId}-close-v${owning.version}`,
          correlationId: caseId,
          actor: { kind: 'employee', employeeId: delegation.actingEmployeeId },
          initiator: initiatedBy(delegation),
          occurredAt: now(),
          expectedVersion: owning.version,
          reason,
        },
        deps,
      )
      return settled(result)
    },

    async begin(delegation, caseId, opening) {
      const deps = await commandDeps()
      const owning = await owningDepartmentOf(caseId, deps)
      if (!owning.ok) return owning.result
      const current = await repositories.cases.get(caseId)
      if (!current) return { state: 'refused', code: 'not-found' }

      /* The opening: proposed from the person's words, unless the case already argues about one. */
      const revisions = await repositories.theses.listForCase(caseId)
      let revisionId: string
      if (revisions.length === 0) {
        const proposal = openingProposal(current.question, opening)
        const proposed = await runCommand(
          proposeThesis(deps.organization),
          {
            caseId,
            thesisId: `${caseId}-opening`,
            statement: proposal.statement,
            position: proposal.position,
            invalidationCriteria: proposal.invalidationCriteria,
            ...(proposal.horizon ? { horizon: proposal.horizon } : {}),
            implications: proposal.implications,
            proposedByDepartmentId: owning.departmentId,
          },
          {
            commandId: `${caseId}-begin-${delegation.requestId}`,
            correlationId: caseId,
            actor: { kind: 'employee', employeeId: delegation.actingEmployeeId },
            initiator: initiatedBy(delegation),
            occurredAt: now(),
          },
          deps,
        )
        if (proposed.outcome !== 'committed') return settled(proposed) as CaseActResult<BeginOutcome>
        revisionId = proposed.value.revisionId
      } else {
        revisionId = [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0]!.revisionId
      }

      const commission = await advanceCase(delegation, current, owning.departmentId, deps)
      return { state: 'done', value: { revisionId, commission } }
    },

    async queue() {
      const deps = await commandDeps()
      return caseListing({ repositories, organization: deps.organization, now: now() })
    },

    async standing(caseId) {
      const investmentCase = await repositories.cases.get(caseId)
      if (!investmentCase) return null
      const deps = await commandDeps()
      return standingForCase({
        repositories,
        organization: deps.organization,
        investmentCase,
        now: now(),
      })
    },

    async overview(caseId) {
      const deps = await commandDeps()
      return caseOverview({
        repositories,
        organization: deps.organization,
        caseId,
        now: now(),
      })
    },

    async reference(caseId) {
      const deps = await commandDeps()
      return {
        system: FINANCIAL_OS_SYSTEM_ID,
        kind: 'case',
        id: caseId,
        provenanceId: deps.provenance.provenanceId,
      }
    },
  }
}
