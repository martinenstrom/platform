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
import { acceptContribution } from './commands/acceptContribution'
import { aggregateManagerConclusion } from './commands/aggregateManagerConclusion'
import { submitForVerification } from './commands/submitForVerification'
import { returnForCorrection } from './commands/returnForCorrection'
import { resolveConditionalRequirement } from './commands/resolveConditionalRequirement'
import { recordVerificationReview } from './commands/recordVerificationReview'
import { recordDevilsAdvocateReview } from './commands/recordDevilsAdvocateReview'
import { recordPeerExamination } from './commands/recordPeerExamination'
import { governanceContext, type GovernanceContext, type GovernanceKind } from './governanceContext'
import { PEER_EXAMINATION_ENTRY_KEY, RISK_ENTRY_KEY } from './reviewRecording'
import {
  automaticCorrectionPermitted,
  correctionRoundsTaken,
  correctionsOwed,
  correctionsOwedBy,
  currentRevision,
  inquiryKindOf,
  latestApplicable,
  requirementStatusFor,
  type CorrectionFinding,
  type CorrectionOwnership,
  type VerificationReview,
} from '~/domain/analysis'
import { commissionAnalysis, type CommissionResult } from './commissionAnalysis'
import type { ContributionProvider } from './contributionPort'
import { requirePlaybook, UnknownPlaybookError } from './playbookRegistry'
import type { CasePlaybook } from './playbooks'
import { synthesisContext, type SynthesisContext } from './synthesisContext'
import { standingRunFor } from './requiredWork'
import { evidenceWindow, openingProposal, standingEvidenceFor, synthesisEntryFor } from './opening'
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
  /** Finished candidate work adopted by its own desk's principal in this pass. */
  adopted: readonly { departmentId: string; runId: string }[]
  /** A control function's candidate filed as its verdict, objection or examination by its own principal in this pass. */
  filed: readonly { departmentId: string; runId: string }[]
  withheld: readonly { departmentId: string | null; reason: HostWithheldReason }[]
}

export interface BeginOutcome {
  /** The opening the case now holds: proposed by this act, or the one it already had. */
  revisionId: string
  commission: CaseCommission
}

/**
 * What advancing a case needs from the world: a provider that executes a
 * desk's work, one that synthesises it, and how long to wait for a run to
 * appear on the record before reporting a desk as not started.
 *
 * A live provider runs for minutes; the person is not kept waiting for
 * that. The commission continues in this process after `begin` returns,
 * and when it ends the firm is advanced again — the desk's own principal
 * adopts what it produced, the next entries that are ready are
 * commissioned — until nothing autonomous remains. What the person is told
 * is read off the record at every step; a process that dies mid-run leaves
 * exactly what TD-92 describes, reported as such.
 */
export interface AdvanceDeps {
  provider: () => ContributionProvider | null
  /**
   * The provider for the workflow's synthesis entry, given a loader of the
   * facts it reconciles — read off the record at dispatch, never before.
   */
  synthesisProvider?: (loadContext: () => Promise<SynthesisContext>) => ContributionProvider | null
  /**
   * The provider for a control function's entry — verification, challenge,
   * peer examination — given a loader of what that function may read (G1,
   * 2026-09-17). Each is its own invocation, prompt and identity.
   */
  governanceProvider?: (kind: GovernanceKind, loadContext: () => Promise<GovernanceContext | null>) => ContributionProvider | null
  startWaitMs?: number
  /** Where a commission that continues after `begin` reports how it ended. */
  log?: (line: string) => void
}

/**
 * How many times one beginning may advance the case after its first pass:
 * each finished run earns one. Twelve covers the macro-regime workflow's
 * longest honest path — two desks, the synthesis, three control functions —
 * with a margin for refusals; a case that needs more is a case whose stop
 * conditions should be read, not a loop to be lengthened.
 */
const ADVANCE_PASSES = 12

/** The control act a workflow entry performs, read off its discipline and key; null for a desk's analysis. */
function governanceKindOf(entry: { key: string; disciplineTag?: string }): GovernanceKind | null {
  if (entry.key === PEER_EXAMINATION_ENTRY_KEY) return 'peer-examination'
  if (entry.disciplineTag === 'verification') return 'verification'
  if (entry.disciplineTag === 'challenge') return 'devils-advocate'
  return null
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

  /** The desk's own institutional agent, where the firm has one. */
  const principalFor = (deps: CommandDeps, departmentId: string) =>
    deps.organization.agentPrincipals.find(
      (candidate) => candidate.active && candidate.departmentId === departmentId,
    ) ?? null

  /** The evidence set this case was advanced on before, so the desks read one body of evidence. */
  async function standingEvidenceSetFor(caseId: string) {
    const sets = await repositories.evidence.list(50)
    return sets.find((set) => set.correlationId === caseId) ?? null
  }

  /**
   * The standing evidence basis, assembled once per case under the
   * convenor mandate — or reused when this case was advanced before.
   */
  async function evidenceFor(
    delegation: Delegation,
    current: InvestmentCase,
    owningDepartmentId: string,
    deps: CommandDeps,
  ): Promise<{ evidence: CaseCommission['evidence']; withheld: HostWithheldReason | null }> {
    const basis = standingEvidenceFor(current.playbookId)
    if (!basis) return { evidence: null, withheld: 'no-evidence-basis' }
    const window = evidenceWindow(now(), basis.windowDays)
    const existing = await standingEvidenceSetFor(current.id)
    if (existing) {
      return {
        evidence: {
          evidenceSetId: existing.id,
          family: basis.subjectFamily,
          from: window.from,
          to: window.to,
          observations: existing.items.length,
        },
        withheld: null,
      }
    }
    const at = now()
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
      return { evidence: null, withheld: /no observations/i.test(why) ? 'no-observations' : 'declined' }
    }
    return {
      evidence: {
        evidenceSetId: assembled.value.evidenceSetId,
        family: basis.subjectFamily,
        from: window.from,
        to: window.to,
        observations: assembled.value.observationCount,
      },
      withheld: null,
    }
  }

  /**
   * Finished candidate work adopted by its own desk's principal — the act
   * the P4 proof performed, ruled a production path on 2026-09-17: a
   * specialist's adoption is an internal institutional act, not a decision
   * of the person's, and never the host's. A synthesis candidate goes one
   * step further through the office's own act: `AggregateManagerConclusion`
   * mints the revision from the exact persisted candidate.
   */
  async function adoptFinishedWork(
    delegation: Delegation,
    current: InvestmentCase,
    deps: CommandDeps,
    adopted: { departmentId: string; runId: string }[],
    filed: { departmentId: string; runId: string }[],
    withheld: { departmentId: string | null; reason: HostWithheldReason }[],
  ): Promise<void> {
    const runs = await repositories.runs.listForCase(current.id)
    for (const run of runs.filter((candidate) => candidate.state === 'awaiting-acceptance')) {
      const principal = principalFor(deps, run.departmentId)
      if (!principal) {
        withheld.push({ departmentId: run.departmentId, reason: 'no-principal' })
        continue
      }
      const actor = { kind: 'institutional-agent' as const, agentPrincipalId: principal.id }
      const envelope = (commandId: string) => ({
        commandId,
        correlationId: current.id,
        actor,
        initiator: initiatedBy(delegation),
        occurredAt: now(),
      })

      /*
       * A control function's candidate is FILED, not accepted: the filing
       * command institutionalises the persisted candidate under the
       * function's own mandate and completes the producing run. The principal
       * is the control function's; the host only initiates (G1, 2026-09-17).
       */
      const verification = await repositories.producedVerifications.get(run.id)
      const challenge = verification ? null : await repositories.producedChallenges.get(run.id)
      const examination = verification || challenge ? null : await repositories.producedPeerExaminations.get(run.id)
      if (verification || challenge || examination) {
        const filing = { caseId: current.id, byDepartmentId: run.departmentId, candidateFromRunId: run.id }
        const result = verification
          ? await runCommand(recordVerificationReview(deps.organization), filing, envelope(`file-${run.id}`), deps)
          : challenge
            ? await runCommand(recordDevilsAdvocateReview(deps.organization), filing, envelope(`file-${run.id}`), deps)
            : await runCommand(recordPeerExamination(deps.organization), filing, envelope(`file-${run.id}`), deps)
        advance?.log?.(`[advance] ${current.id} ${run.departmentId} files ${run.id}: ${result.outcome}${result.outcome === 'rejected' ? ` ${result.rejection.code}: ${result.rejection.detail}` : ''}`)
        if (result.outcome === 'committed') filed.push({ departmentId: run.departmentId, runId: run.id })
        else withheld.push({ departmentId: run.departmentId, reason: 'declined' })
        continue
      }

      const accepted = await runCommand(
        acceptContribution(deps.organization),
        { caseId: current.id, runId: run.id, departmentId: run.departmentId },
        envelope(`agent-accept-${run.id}`),
        deps,
      )
      advance?.log?.(`[advance] ${current.id} ${run.departmentId} adopts ${run.id}: ${accepted.outcome}${accepted.outcome === 'rejected' ? ` ${accepted.rejection.code}: ${accepted.rejection.detail}` : ''}`)
      if (accepted.outcome !== 'committed') {
        withheld.push({ departmentId: run.departmentId, reason: 'declined' })
        continue
      }
      adopted.push({ departmentId: run.departmentId, runId: run.id })

      const candidate = await repositories.producedSyntheses.get(run.id)
      if (!candidate) continue
      const institutionalised = await runCommand(
        aggregateManagerConclusion(deps.organization),
        {
          caseId: current.id,
          sourceRevisionId: candidate.basis.sourceRevisionId,
          departmentId: run.departmentId,
          synthesisFromRunId: run.id,
        },
        envelope(`office-adopt-${run.id}`),
        deps,
      )
      advance?.log?.(
        `[advance] ${current.id} ${run.departmentId} institutionalises ${run.id}: ${institutionalised.outcome}${institutionalised.outcome === 'rejected' ? ` ${institutionalised.rejection.code}: ${institutionalised.rejection.detail}` : ''}${institutionalised.outcome === 'committed' ? ` → ${institutionalised.value.revisionId}` : ''}`,
      )
      if (institutionalised.outcome !== 'committed') withheld.push({ departmentId: run.departmentId, reason: 'declined' })
    }
  }

  /**
   * The lineage's current revision — the argument a synthesis reconciles and
   * the control functions scrutinise. The domain's own rule: the LAST live
   * revision of the lineage, so revision 2 is current the moment the office
   * mints it (the first live one would be revision 1 forever; found by the
   * loop suite, 2026-09-18).
   */
  async function currentRevisionOf(caseId: string) {
    const revisions = await repositories.theses.listForCase(caseId)
    const thesisId = revisions[0]?.thesisId
    return thesisId ? currentRevision(revisions, thesisId) : null
  }

  /**
   * The office's revision put before the control functions, on the firm's
   * own reading of what it owes next (G1, 2026-09-17).
   *
   * Two acts, each by its own principal, each only when the standing says it
   * is owed: the Risk desk resolves whether its review applies to this
   * revision — the pinned rule decides, the rule's reason is the act's — and
   * the Research Office submits the aggregated revision for verification,
   * which opens the control functions' queues. Nothing here submits to the
   * CIO: that stays a deliberate act, and the loop stops at the committee's
   * conclusion.
   */
  /**
   * The corrections Verification's STANDING verdict demands on a revision, by
   * owner — or null where no verdict demands any. One derivation, read by the
   * return, by the desks' correction briefs and by the office's re-synthesis.
   */
  async function correctionsDemandedOn(
    caseId: string,
    revision: { revisionId: string },
  ): Promise<{ review: VerificationReview; ownership: CorrectionOwnership } | null> {
    const review = latestApplicable(await repositories.reviews.verificationsForCase(caseId), caseId, revision.revisionId)
    if (!review || review.status !== 'correction-required') return null
    return { review, ownership: correctionsOwed(review, await repositories.runs.listForCase(caseId)) }
  }

  /**
   * The correction round, when the firm says one is owed (TD-99, ruled
   * 2026-09-22): Verification's verdict on the current revision demands
   * corrections, the firm has not spent its one automatic round, and no
   * control function is still examining the revision. The office that owns
   * the revision returns each defective claim to the desk that produced it —
   * the ownership is the record's, not the office's choice — and its own
   * synthesis, so a successor is written onto the corrected work. Neither
   * JARVIS nor Verification corrects anything.
   */
  async function returnForCorrectionWhereDemanded(
    delegation: Delegation,
    current: InvestmentCase,
    deps: CommandDeps,
    withheld: { departmentId: string | null; reason: HostWithheldReason }[],
  ): Promise<void> {
    const revision = await currentRevisionOf(current.id)
    if (!revision || revision.lifecycle !== 'awaiting-verification') return
    const standing = await standingForCase({ repositories, organization: deps.organization, investmentCase: current, now: now() })
    if (standing.nextAct.act !== 'return-for-correction') return
    /*
     * The bound (ruled 2026-09-22): one correction round on the firm's own
     * initiative, counted off the lineage. Past it the verdict stands as the
     * visible stop — the host reads it with its findings and owners — and the
     * act stays a person's to perform.
     */
    const rounds = correctionRoundsTaken(await repositories.theses.listForCase(current.id), revision.thesisId)
    if (!automaticCorrectionPermitted(rounds)) {
      advance?.log?.(`[advance] ${current.id}: Verification still demands corrections on ${revision.revisionId} after ${rounds} automatic correction round(s) — the firm stops here`)
      return
    }
    /* The control functions still examining this revision finish first: their filings are the record's. */
    const runs = await repositories.runs.listForCase(current.id)
    if (runs.some((run) => run.revisionId === revision.revisionId && run.state === 'running')) return
    const demanded = await correctionsDemandedOn(current.id, revision)
    if (!demanded) return
    /* Already returned: the round is in progress, and the owners' correction work is what is owed now. */
    const assignments = await repositories.assignments.listForCase(current.id)
    if (assignments.some((assignment) => assignment.status === 'returned')) return
    const office = principalFor(deps, revision.proposedByDepartmentId)
    if (!office) {
      withheld.push({ departmentId: revision.proposedByDepartmentId, reason: 'no-principal' })
      return
    }
    const returned = await runCommand(
      returnForCorrection(deps.organization),
      {
        caseId: current.id,
        revisionId: revision.revisionId,
        verificationReviewId: demanded.review.reviewId,
        returnedByDepartmentId: revision.proposedByDepartmentId,
      },
      {
        commandId: `${current.id}-return-correction-${revision.revisionId}`,
        correlationId: current.id,
        actor: { kind: 'institutional-agent', agentPrincipalId: office.id },
        initiator: initiatedBy(delegation),
        occurredAt: now(),
        reason: `Verification ${demanded.review.reviewId} demands corrections on revision ${revision.revisionId}; the office returns each defective claim to the desk that produced it, and its own synthesis for the successor.`,
      },
      deps,
    )
    advance?.log?.(
      `[advance] ${current.id} ${revision.proposedByDepartmentId} returns ${revision.revisionId} for correction: ${returned.outcome}${returned.outcome === 'rejected' ? ` ${returned.rejection.code}: ${returned.rejection.detail}` : ''}${returned.outcome === 'committed' ? ` → ${returned.value.returned.map((entry) => `${entry.departmentId}(${entry.claimIds.length})`).join(',')}` : ''}`,
    )
    if (returned.outcome !== 'committed') withheld.push({ departmentId: revision.proposedByDepartmentId, reason: 'declined' })
  }

  async function putBeforeGovernance(
    delegation: Delegation,
    current: InvestmentCase,
    deps: CommandDeps,
    withheld: { departmentId: string | null; reason: HostWithheldReason }[],
  ): Promise<void> {
    const revision = await currentRevisionOf(current.id)
    if (!revision || !revision.aggregationId) return
    if (revision.lifecycle === 'awaiting-verification' || revision.lifecycle === 'verified') return
    const standing = await standingForCase({ repositories, organization: deps.organization, investmentCase: current, now: now() })
    if (standing.nextAct.act !== 'submit-for-verification') return

    /* Risk decides whether Risk applies, before the queues open, so a revision that needs it gets it. */
    const resolutions = await repositories.requirements.listForCase(current.id)
    if (requirementStatusFor(RISK_ENTRY_KEY, revision.revisionId, resolutions).state === 'unresolved') {
      const risk = principalFor(deps, 'risk')
      if (!risk) {
        withheld.push({ departmentId: 'risk', reason: 'no-principal' })
      } else {
        /*
         * The command evaluates the workflow's pinned rule and records the
         * rule's own reason on the resolution; this reason is the ACT's, for
         * the ledger. Reading the rule here would be a second answer.
         */
        const resolved = await runCommand(
          resolveConditionalRequirement(deps.organization),
          {
            caseId: current.id,
            playbookEntryKey: RISK_ENTRY_KEY,
            revisionId: revision.revisionId,
            departmentId: 'risk',
            discipline: 'risk',
          },
          {
            commandId: `${current.id}-risk-resolve-${revision.revisionId}`,
            correlationId: current.id,
            actor: { kind: 'institutional-agent', agentPrincipalId: risk.id },
            initiator: initiatedBy(delegation),
            occurredAt: now(),
            reason: `Risk resolves whether its review applies to revision ${revision.revisionId}, by the workflow's pinned rule, before the revision goes before the control functions.`,
          },
          deps,
        )
        advance?.log?.(`[advance] ${current.id} risk resolves its requirement on ${revision.revisionId}: ${resolved.outcome}${resolved.outcome === 'rejected' ? ` ${resolved.rejection.code}: ${resolved.rejection.detail}` : ''}`)
        if (resolved.outcome !== 'committed') withheld.push({ departmentId: 'risk', reason: 'declined' })
      }
    }

    const office = principalFor(deps, revision.proposedByDepartmentId)
    if (!office) {
      withheld.push({ departmentId: revision.proposedByDepartmentId, reason: 'no-principal' })
      return
    }
    const fresh = await repositories.cases.get(current.id)
    const submitted = await runCommand(
      submitForVerification(deps.organization),
      { caseId: current.id, revisionId: revision.revisionId, submittedByDepartmentId: revision.proposedByDepartmentId },
      {
        commandId: `${current.id}-submit-verification-${revision.revisionId}`,
        correlationId: current.id,
        actor: { kind: 'institutional-agent', agentPrincipalId: office.id },
        initiator: initiatedBy(delegation),
        occurredAt: now(),
        expectedVersion: (fresh ?? current).version,
      },
      deps,
    )
    advance?.log?.(`[advance] ${current.id} ${revision.proposedByDepartmentId} submits ${revision.revisionId} for verification: ${submitted.outcome}${submitted.outcome === 'rejected' ? ` ${submitted.rejection.code}: ${submitted.rejection.detail}` : ''}`)
    if (submitted.outcome !== 'committed') withheld.push({ departmentId: revision.proposedByDepartmentId, reason: 'declined' })
  }

  /**
   * Every entry of the pinned workflow that has no run yet, in the
   * workflow's order, commissioned under the desk's own institutional agent.
   * The synthesis entry reads the facts off the record at dispatch and is
   * scoped to the current revision. Each commission is left to run; this
   * waits only until the run is on the record, and when the run ends the
   * case is advanced again.
   */
  async function commissionReadyEntries(
    delegation: Delegation,
    current: InvestmentCase,
    playbook: CasePlaybook,
    evidenceSetId: string,
    deps: CommandDeps,
    pass: number,
    started: { departmentId: string; runId: string }[],
    withheld: { departmentId: string | null; reason: HostWithheldReason }[],
  ): Promise<void> {
    if (!advance) return
    const provider = advance.provider()
    if (!provider) {
      withheld.push({ departmentId: null, reason: 'no-provider' })
      return
    }
    const synthesisEntry = synthesisEntryFor(current.playbookId)
    const runs = await repositories.runs.listForCase(current.id)
    const known = new Set(runs.map((run) => run.id))
    const assignments = await repositories.assignments.listForCase(current.id)
    /* The revision the pass is working on, and the corrections its standing verdict demands, if any. */
    const currentNow = await currentRevisionOf(current.id)
    const demanded =
      currentNow && currentNow.lifecycle === 'awaiting-verification'
        ? await correctionsDemandedOn(current.id, currentNow)
        : null
    /*
     * A correction round in progress: the verdict stands and the office has
     * returned the work — some desk is `returned`, or the office's own
     * synthesis is no longer `completed`. The revision is about to be
     * replaced; the control functions examine its successor, not it.
     */
    const roundInProgress =
      demanded !== null &&
      assignments.some(
        (candidate) =>
          candidate.status === 'returned' ||
          (candidate.playbookEntryKey === synthesisEntry && candidate.status !== 'completed'),
      )
    for (const entry of playbook.entries) {
      const assignment = assignments.find(
        (candidate) => candidate.playbookEntryKey === entry.key && candidate.departmentId === entry.departmentId,
      )
      if (!assignment) {
        withheld.push({ departmentId: entry.departmentId, reason: 'not-assignable' })
        continue
      }
      const control = governanceKindOf(entry)
      const own = runs.filter((run) => run.assignmentId === assignment.id)
      /* A desk already running or waiting to be adopted is not commissioned again here. */
      if (own.some((run) => run.state === 'running' || run.state === 'awaiting-acceptance')) continue
      /*
       * Nor is a desk whose work is adopted — with the two exceptions the
       * record names (TD-99, ruled 2026-09-22). Work the office RETURNED for
       * correction is owed again: the adopted run is the one being corrected.
       * And a control function's verdict stands only for the revision it
       * examined: adopted for revision 2 is not adopted for revision 3, whose
       * submission reopened the queue. Correction work is scoped to the
       * revision the verdict examined, so the same rule reads it.
       */
      /* Adopted work is not commissioned again; the assignment says so. */
      if (assignment.status === 'completed') continue
      /*
       * Revision-scoped work — a control function's, and the office's — is
       * worked once PER REVISION: adopted for revision 2 is not adopted for
       * revision 3, and a synthesis that timed out on revision 2 is owed on
       * revision 2 still (measured live, run 13). A desk's contribution is
       * commissioned again only when nothing of its work stands
       * (`standingRunFor`): returned for correction, or its latest attempt
       * produced nothing the firm accepted.
       */
      const scopedToRevision = control !== null || entry.key === synthesisEntry
      const onThisRevision = (run: { revisionId?: string }) =>
        !scopedToRevision || run.revisionId === currentNow?.revisionId
      if (
        scopedToRevision
          ? own.some((run) => run.state === 'completed' && onThisRevision(run))
          : standingRunFor(assignment, own) !== undefined
      )
        continue
      /*
       * The firm retries on the person's word, not on its own. An entry whose
       * run failed stays on the record, visible, until the next beginning; the
       * passes the firm gives itself never re-commission it — a provider that
       * refused once would only be paid to refuse again.
       */
      if (pass > 0 && own.some((run) => (run.state === 'failed' || run.state === 'timed-out') && onThisRevision(run))) {
        withheld.push({ departmentId: entry.departmentId, reason: 'declined' })
        continue
      }
      const principal = principalFor(deps, entry.departmentId)
      if (!principal) {
        withheld.push({ departmentId: entry.departmentId, reason: 'no-principal' })
        continue
      }
      let entryProvider: ContributionProvider | null = provider
      let revisionId: string | undefined
      let corrections: readonly CorrectionFinding[] | undefined
      if (entry.key === RISK_ENTRY_KEY) {
        /*
         * Risk's review has no candidate boundary yet (TD-98). Where the
         * submission opened its queue — the review applies — the firm says
         * so rather than pretending; before that, nothing is owed.
         */
        if (assignment.status === 'active') withheld.push({ departmentId: entry.departmentId, reason: 'no-provider' })
        continue
      }
      if (control) {
        /*
         * A control function reads only what its mandate requires, assembled
         * from the record at dispatch, and is scoped to the revision under
         * scrutiny — the candidate command refuses one that names none.
         */
        const revision = await currentRevisionOf(current.id)
        /* Scrutiny is owed only once the office has put its revision before the control functions. */
        if (!revision || !revision.aggregationId || revision.lifecycle !== 'awaiting-verification') continue
        /* A revision returned for correction is about to be replaced; its successor is what the control functions examine. */
        if (roundInProgress) continue
        revisionId = revision.revisionId
        entryProvider =
          advance.governanceProvider?.(control, async () => {
            const revisionNow = await currentRevisionOf(current.id)
            if (!revisionNow) return null
            return governanceContext({ repositories, kind: control, caseId: current.id, question: current.question, revision: revisionNow })
          }) ?? null
        if (!entryProvider) {
          withheld.push({ departmentId: entry.departmentId, reason: 'no-provider' })
          continue
        }
      } else if (entry.key === synthesisEntry) {
        const revision = await currentRevisionOf(current.id)
        if (!revision) {
          withheld.push({ departmentId: entry.departmentId, reason: 'not-assignable' })
          continue
        }
        revisionId = revision.revisionId
        entryProvider =
          advance.synthesisProvider?.(async () => {
            const [assignmentsNow, runsNow, revisionsNow] = await Promise.all([
              repositories.assignments.listForCase(current.id),
              repositories.runs.listForCase(current.id),
              repositories.theses.listForCase(current.id),
            ])
            const thesisId = revisionsNow[0]?.thesisId
            const revisionNow = thesisId ? currentRevision(revisionsNow, thesisId) : null
            return synthesisContext({
              caseId: current.id,
              question: current.question,
              inquiry: inquiryKindOf(revisionsNow, thesisId),
              playbook,
              entryKey: entry.key,
              revision: revisionNow ?? revision,
              assignments: assignmentsNow,
              runs: runsNow,
              /* A re-synthesis after a return is told what Verification found, and whose it was. */
              ...(demanded
                ? {
                    corrections: {
                      reviewId: demanded.review.reviewId,
                      revisionId: revision.revisionId,
                      revisionNumber: revision.revisionNumber,
                      findings: demanded.ownership.owed.flatMap((owed) =>
                        owed.findings.map((finding) => ({ ...finding, departmentId: owed.departmentId })),
                      ),
                    },
                  }
                : {}),
            })
          }) ?? null
        if (!entryProvider) {
          withheld.push({ departmentId: entry.departmentId, reason: 'no-provider' })
          continue
        }
      } else if (demanded && currentNow && correctionsOwedBy(demanded.ownership, entry.departmentId).length > 0) {
        /*
         * Correction work: the desk is told what Verification found against
         * its own accepted claims, scoped to the revision the verdict
         * examined. The ownership is the record's (`correctionsOwed`); the
         * desk gets exactly the findings on the claims it produced — on the
         * first attempt and on a retry after a timed-out one alike.
         */
        revisionId = currentNow.revisionId
        corrections = correctionsOwedBy(demanded.ownership, entry.departmentId)
      }
      const commission = commissionAnalysis({
        repositories,
        deps,
        provider: entryProvider,
        caseId: current.id,
        departmentId: entry.departmentId,
        entryKey: entry.key,
        evidenceSetId,
        actingPrincipal: { kind: 'institutional-agent', agentPrincipalId: principal.id },
        ...(revisionId ? { revisionId } : {}),
        ...(corrections && corrections.length > 0 ? { corrections } : {}),
        now: () => new Date(now()),
      })
      /* Left to run; how it ended is on the record and in the log, and a finished run advances the case again. */
      commission.then(
        (result) => {
          advance.log?.(
            `[begin] ${current.id} ${entry.key}: ${result.outcome}${'reason' in result ? ` ${result.reason}` : ''}${'code' in result ? ` ${result.code}` : ''}${'state' in result ? ` ${result.state}` : ''}${'failureDetail' in result && result.failureDetail ? ` — ${result.failureDetail}` : ''}${'detail' in result && result.detail ? ` — ${result.detail}` : ''}`,
          )
          /*
           * A finished run advances the case again — whatever way it finished.
           * Produced work is adopted on the next pass; a failed or timed-out run
           * is not re-commissioned on the firm's own initiative, but the work it
           * was holding up may now be owed (measured live, run 14: the last
           * examination of a revision failed, and the return it was holding up
           * never came).
           */
          if (result.outcome === 'ran' && result.state !== 'running') void advanceLater(delegation, current.id, pass + 1)
        },
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
        /* A stub or recorded provider settles at once; the adoption happens on the next pass, which this run earned. */
        if (outcome.result.state !== 'running') void advanceLater(delegation, current.id, pass + 1)
      } else {
        withheld.push({ departmentId: entry.departmentId, reason: withheldReason(outcome.result) })
      }
    }
  }

  /** One case is advanced by one pass at a time; a pass that arrives while another runs waits for it. */
  const advancing = new Map<string, Promise<unknown>>()

  /**
   * The firm advanced as far as policy permits, on the person's word.
   *
   * Evidence first, from the workflow's standing basis; then finished
   * candidate work adopted by its desks' own principals; then every entry
   * that is ready, under the desk's own institutional agent. Refusals are
   * the institution's own, reported in the host's words, and nothing is
   * retried.
   */
  async function advanceCase(
    delegation: Delegation,
    current: InvestmentCase,
    owningDepartmentId: string,
    deps: CommandDeps,
    pass = 0,
  ): Promise<CaseCommission> {
    /*
     * One pass at a time per case. Every pass queues behind the LATEST one
     * registered, not behind whichever it happened to read first: two passes
     * that both waited on the same predecessor would run side by side, and
     * two desks adopting the same run at once is exactly the collision the
     * ledger then refuses (found by the loop suite, 2026-09-18).
     */
    const previous = advancing.get(current.id) ?? Promise.resolve(null)
    const run = previous.catch(() => null).then(async (): Promise<CaseCommission> => {
      const started: { departmentId: string; runId: string }[] = []
      const adopted: { departmentId: string; runId: string }[] = []
      const filed: { departmentId: string; runId: string }[] = []
      const withheld: { departmentId: string | null; reason: HostWithheldReason }[] = []
      /* Adoption and filing need no provider and no evidence: they are the desks' own acts on work already produced. */
      await adoptFinishedWork(delegation, current, deps, adopted, filed, withheld)
      /* The office's revision goes before the control functions when the firm says it is owed. */
      await putBeforeGovernance(delegation, current, deps, withheld)
      /* And comes back from them for correction when Verification's verdict demands it — once, on its own. */
      await returnForCorrectionWhereDemanded(delegation, current, deps, withheld)
      const stopped = (reason: HostWithheldReason, evidence: CaseCommission['evidence'] = null): CaseCommission => ({
        evidence,
        started,
        adopted,
        filed,
        withheld: [...withheld, { departmentId: null, reason }],
      })
      if (!advance) return stopped('no-provider')
      if (!current.playbookId || !current.playbookVersion) return stopped('no-evidence-basis')
      const basis = await evidenceFor(delegation, current, owningDepartmentId, deps)
      if (!basis.evidence) return stopped(basis.withheld ?? 'declined')
      let playbook: CasePlaybook
      try {
        playbook = requirePlaybook(current.playbookId, current.playbookVersion)
      } catch (error) {
        if (error instanceof UnknownPlaybookError) return stopped('not-assignable', basis.evidence)
        throw error
      }
      await commissionReadyEntries(delegation, current, playbook, basis.evidence.evidenceSetId, deps, pass, started, withheld)
      return { evidence: basis.evidence, started, adopted, filed, withheld }
    })
    advancing.set(current.id, run)
    try {
      return await run
    } finally {
      if (advancing.get(current.id) === run) advancing.delete(current.id)
    }
  }

  /** A finished run earns the case one more pass, in this process, off the request's clock. */
  async function advanceLater(delegation: Delegation, caseId: string, pass: number): Promise<void> {
    if (pass > ADVANCE_PASSES) {
      advance?.log?.(`[advance] ${caseId}: pass ${pass} not taken — the beginning's allowance is spent`)
      return
    }
    try {
      const deps = await commandDeps()
      const owning = await owningDepartmentOf(caseId, deps)
      const current = await repositories.cases.get(caseId)
      if (!owning.ok || !current) return
      if (current.stage === 'withdrawn' || current.stage === 'published') return
      const result = await advanceCase(delegation, current, owning.departmentId, deps, pass)
      advance?.log?.(
        `[advance] ${caseId} pass ${pass}: adopted ${result.adopted.map((entry) => entry.departmentId).join(',') || '–'} · filed ${result.filed.map((entry) => entry.departmentId).join(',') || '–'} · started ${result.started.map((entry) => entry.departmentId).join(',') || '–'} · withheld ${result.withheld.map((entry) => `${entry.departmentId ?? '*'}:${entry.reason}`).join(',') || '–'}`,
      )
    } catch (error) {
      advance?.log?.(`[advance] ${caseId} pass ${pass}: threw ${String(error)}`)
    }
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
