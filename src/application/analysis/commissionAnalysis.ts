/**
 * Commissioning one piece of analysis, from the product.
 *
 * The act C2-1 proved and only a hard-coded smoke route could perform. What is
 * new here is reachability and selection, not workflow: every command below
 * already existed, in this order, and the orchestration that sequences them is
 * the one every other caller uses.
 *
 * ## Selection is intent, never permission
 *
 * A person names a case, an evidence set and a piece of the firm's registered
 * workflow. That selection tells `runPlaybook` **which entry to attempt** —
 * through `requestedEntryKeys`, a filter over the entries that are ready, not a
 * second orchestration path and not a trimmed playbook. Everything that decides
 * whether the work may actually run is untouched: the dependency graph, the
 * assignment's status, the mandate on `StartAgentRun`, the budget the three
 * policy sources resolve to, and the acceptance boundary at the other end.
 *
 * The consequence to keep in mind while reading `eligibility` below: it does
 * not grant anything. It reports, ahead of time, what the institution would
 * answer — so a person is not asked to spend money on a request that was always
 * going to be refused. The command refuses independently and would refuse the
 * same way if this file did not exist.
 *
 * ## It reads the firm's own answers rather than forming its own
 *
 * `eligibility` asks the same questions `StartAgentRun` asks, in the same
 * order, against the same records, and resolves the budget with the same
 * `resolveExecutionBudget`. That is deliberately not a second rule: it is the
 * pattern `runReview.decision` already follows by asking `canTransitionRun`
 * whether work can still be judged. A screen that decided any of this for
 * itself would be the second answer the whole architecture exists to prevent.
 *
 * ## The workflow is not negotiable at the call site
 *
 * The brief the desk receives is the brief the **case's pinned playbook
 * version** states, resolved through the registry. There is deliberately no
 * free-text brief on the commission input: the brief is inside
 * `playbookContentHash` and is hashed into the run's prompt identity, so
 * letting a caller replace it would run the desk under a workflow the firm
 * never registered and could not reproduce. What a person supplies is *which*
 * question the firm is asking, and that is the case they select.
 *
 * ## Nothing here writes
 *
 * Reads through the repositories, and every durable effect through
 * `runCommand`, via the orchestrator. Same rule as the orchestrator's own.
 */

import { standingEntryKeys, standingRunFor } from './requiredWork'
import {
  budgetPermitsStart,
  unmeasuredBudgetDimensions,
  type AgentClaim,
  type AgentRunRecord,
  type CorrectionFinding,
  type Assignment,
  type AssignmentStatus,
  type CaseStage,
  type EvidenceAssembly,
  type EvidenceSet,
  type ExecutionBudget,
  type InvestmentCase,
  type Organization,
  type ProviderKind,
  type RunFailureCategory,
  type RunState,
  type AssertedActor,  isRunTerminal,
} from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import type { CommandDeps } from './commands/runCommand'
import type { DomainRejection } from './commands/envelope'
import type { ContributionProvider } from './contributionPort'
import { requirePlaybook, UnknownPlaybookError } from './playbookRegistry'
import { DERIVED_SOURCE_ID } from './deriveObservations'
import { resolveExecutionBudget } from './executionBudget'
import { runPlaybook } from './orchestrator'
import { agentDesk, type AgentDesk } from './agentDirectory'
import type { CasePlaybook, PlaybookEntry } from './playbooks'

/* ------------------------------------------------------------- eligibility */

/**
 * Why the firm would not commission this work against this case.
 *
 * A closed vocabulary, each member naming a rule that exists somewhere else.
 * None of them is invented here, and none of them is a UI condition: every one
 * corresponds to a refusal `StartAgentRun` would issue on its own.
 */
export type CommissionRefusalReason =
  /** `published` or `withdrawn` — the case accepts no new work. */
  | 'case-accepts-no-new-work'
  /** The version the case is pinned to has no such entry for this desk. */
  | 'workflow-does-not-assign-this'
  /** The playbook was never instantiated, so there is no assignment to start. */
  | 'no-assignment'
  /** The assignment is not waiting to be picked up. */
  | 'assignment-not-waiting'
  /** Blocking dependencies have not completed. Produced work does not count. */
  | 'dependencies-not-met'
  /**
   * No policy source bounded a dimension a live run consumes.
   *
   * The refusal a case pinned to `macro-regime` v1 gets, and correctly: that
   * version proposes no budget, `not-measured` is not `unlimited`, and the firm
   * does not start work it has not authorized.
   */
  | 'no-authorized-budget'

export type CommissionEligibility =
  | {
      kind: 'eligible'
      /** What the firm would authorize, resolved exactly as the run will. */
      budget: ExecutionBudget
    }
  | { kind: 'refused'; reason: 'case-accepts-no-new-work'; stage: CaseStage }
  | { kind: 'refused'; reason: 'workflow-does-not-assign-this' }
  | { kind: 'refused'; reason: 'no-assignment' }
  | { kind: 'refused'; reason: 'assignment-not-waiting'; status: AssignmentStatus }
  | { kind: 'refused'; reason: 'dependencies-not-met'; unmet: readonly string[] }
  | {
      kind: 'refused'
      reason: 'no-authorized-budget'
      /** Which dimensions nobody decided. Named, so the reason is actionable. */
      unmeasured: readonly string[]
    }

/**
 * What the firm would answer if this were commissioned right now.
 *
 * Pure, and given everything it needs rather than fetching any of it: the same
 * inputs `StartAgentRun` reads inside its transaction, so the two cannot look
 * at different records. The order of the checks matches the command's, so the
 * reason reported is the reason the institution would give first.
 */
export function commissionEligibility(input: {
  investmentCase: InvestmentCase
  /** The entry as the case's PINNED version states it, or null if it has none. */
  entry: PlaybookEntry | null
  assignment: Assignment | null
  /** Every assignment the case holds: a dependency is satisfied by work that STANDS, which a returned assignment's does not. */
  assignments: readonly Assignment[]
  /** Every run the case holds, for the readiness derivation. */
  runs: readonly AgentRunRecord[]
  providerKind: ProviderKind
  /**
   * The revision the work is scoped to, where it is. Decides what "already
   * worked" means: a control function's verdict on revision 2 does not work
   * its queue for revision 3, which the submission of the successor reopened
   * (TD-99, 2026-09-22).
   */
  revisionId?: string
}): CommissionEligibility {
  const { investmentCase, entry, assignment, assignments, runs, providerKind, revisionId } = input

  if (investmentCase.stage === 'published' || investmentCase.stage === 'withdrawn') {
    return {
      kind: 'refused',
      reason: 'case-accepts-no-new-work',
      stage: investmentCase.stage,
    }
  }

  if (!entry) return { kind: 'refused', reason: 'workflow-does-not-assign-this' }
  if (!assignment) return { kind: 'refused', reason: 'no-assignment' }

  /*
   * The same rule `StartAgentRun` applies. An assignment already carrying a
   * live run cannot carry a second — the partial unique index in migration
   * 0015 is what actually enforces it — and one whose work is completed is
   * not waiting. `active` with no run on record is a queue that was OPENED
   * and not yet worked: a control function's, by the submission that put a
   * revision before it (G1, 2026-09-17). The run is what works it.
   */
  const worked =
    assignment.status === 'active' &&
    runs.some(
      (run) =>
        run.assignmentId === assignment.id &&
        (!isRunTerminal(run.state) ||
          (run.state === 'completed' &&
            (revisionId === undefined || run.revisionId === revisionId))),
    )
  if ((assignment.status !== 'queued' && assignment.status !== 'returned' && assignment.status !== 'active') || worked) {
    return {
      kind: 'refused',
      reason: 'assignment-not-waiting',
      status: assignment.status,
    }
  }

  /*
   * A dependency is satisfied by a COMPLETED run, which means a person accepted
   * the work. Produced work satisfies nothing, which is the whole point of the
   * acceptance boundary and is why this reads `completed` rather than
   * "something ran".
   */
  const completedEntryKeys = standingEntryKeys(assignments, runs)
  const unmet = entry.blockedBy.filter((key) => !completedEntryKeys.has(key))
  if (unmet.length > 0) return { kind: 'refused', reason: 'dependencies-not-met', unmet }

  const budget = resolveEntryBudget(entry, providerKind)
  /*
   * The firm's own predicate, not a second reading of it. Only live work is
   * refused for an unmeasured dimension — a stub consumes nothing external, so
   * an unbounded dimension on one authorizes no spend — and `budgetPermitsStart`
   * is where that line is drawn. Comparing the provider kind here instead would
   * put a second copy of the rule one edit away from disagreeing with the one
   * `StartAgentRun` applies.
   */
  if (!budgetPermitsStart(providerKind, budget)) {
    return {
      kind: 'refused',
      reason: 'no-authorized-budget',
      /* Which dimensions nobody decided, so the refusal is actionable. */
      unmeasured: unmeasuredBudgetDimensions(budget),
    }
  }

  return { kind: 'eligible', budget }
}

/**
 * The budget for one entry, from the sources that actually exist.
 *
 * **`firmCeiling` is empty, and that is a measurement rather than an
 * oversight.** There is no durable home for a firm-wide execution ceiling —
 * TD-76 — so no source supplies one, and inventing a number here would be the
 * smoke constant becoming policy by a longer route. What bounds this work is
 * the playbook's proposal, which is the first of the three sources and is
 * described as exactly that.
 *
 * The deadline the orchestration then runs under is read back off this
 * resolution rather than chosen beside it. `runPlaybook` folds its mandatory
 * `stageDeadlineMs` into the firm ceiling as a minimum, so passing anything
 * else would either silently truncate the authorization or manufacture one the
 * firm never gave.
 */
function resolveEntryBudget(
  entry: PlaybookEntry,
  providerKind: ProviderKind,
): ExecutionBudget {
  return resolveExecutionBudget(providerKind, {
    ...(entry.budget ? { proposed: entry.budget } : {}),
    firmCeiling: {},
  })
}

/* ------------------------------------------------------------- the surface */

/** One evidence set, as much of it as choosing between them needs. */
export interface EvidenceOffer {
  evidenceSetId: string
  assembledAt: string
  observationCount: number
  /** Distinct provider names, so a reader sees whose numbers these are. */
  sources: readonly string[]
  /** Where the firm's own sources disagree. A reason to look, never a filter. */
  disagreementCount: number
  /** One source restating a period. Never folded into the count above. */
  revisionCount: number
  /**
   * Observations the firm derived, and the methodologies it derived them under.
   *
   * Read off the set's own members — a derived observation is a member like any
   * other — so this counts what the desk will actually be given rather than
   * what a screen believes should exist.
   */
  derivedCount: number
  derivedMethodologies: readonly string[]
  /**
   * The recorded selection, when the set was assembled through the governed act.
   *
   * Absent for a pre-C3 set, and stated as absent rather than filled in. A set
   * assembled before `AssembleEvidenceSet` existed has no selection rule, and
   * manufacturing one would be inventing an act nobody performed.
   */
  selection?: {
    ruleId: string
    subjectFamily: string
    from: string
    to: string
    knownAt: string
    actorEmployeeId: string
  }
  eligibility:
    | { kind: 'eligible' }
    /**
     * An assembled set holding no observations.
     *
     * Refused rather than offered, under the stage ruling that where no
     * eligible institutional evidence exists the firm declines instead of
     * producing a low-quality demonstration. A live desk handed nothing to
     * reason over can only produce an assertion, and an assertion is what the
     * evidence requirement exists to prevent.
     */
    | { kind: 'refused'; reason: 'no-observations' }
}

/** One case the desk could be commissioned against, and whether it could. */
export interface CommissionableCase {
  investmentCase: InvestmentCase
  /** The workflow the case is pinned to — not the one currently approved. */
  playbookId: string | null
  playbookVersion: string | null
  /** The exact brief the desk would receive, as that version states it. */
  brief: string | null
  eligibility: CommissionEligibility
}

/**
 * Everything the commission surface needs, assembled once.
 *
 * The desk comes from the same `agentDesk` derivation the floor and the desk
 * page use — a commission screen that assembled its own idea of who works here
 * is how two surfaces start disagreeing about what a department is for.
 */
export interface CommissionBrief {
  desk: AgentDesk
  /** The piece of work being commissioned, from the CURRENT registry. */
  entryKey: string
  /** What the desk is being asked for, as the current registry states it. */
  currentBrief: string
  /** Every case, eligible or not, with the reason. Never pre-filtered. */
  cases: readonly CommissionableCase[]
  /** Every evidence set the firm holds. The institution has no per-case index. */
  evidence: readonly EvidenceOffer[]
  /** Live execution is billable. Stated by the read model, not by a component. */
  providerKind: ProviderKind
}

/**
 * How many evidence sets the surface offers.
 *
 * A bound rather than everything, because `evidence.list` takes one and a
 * screen that grew unboundedly with the firm's history would stop being a
 * choice. Newest first, which is the port's stated ordering.
 */
const EVIDENCE_LIMIT = 25

export interface CommissionBriefInput {
  repositories: AnalysisRepositories
  organization: Organization
  /** The registered playbooks this build ships. Passed in, never imported. */
  playbooks: readonly CasePlaybook[]
  departmentId: string
  /**
   * Which piece of the desk's work. Defaults to its highest-priority
   * assignable work, which is the desk's own ordering rather than a new one.
   */
  entryKey?: string
  /** What would execute it. Live, from the product; a stub under test. */
  providerKind: ProviderKind
}

/** `null` when the firm has no such desk to commission. */
export async function commissionBrief(
  input: CommissionBriefInput,
): Promise<CommissionBrief | null> {
  const { repositories, organization, playbooks, departmentId, providerKind } = input

  const desk = await agentDesk({ repositories, organization, playbooks, departmentId })
  if (!desk) return null

  const work =
    desk.assignableWork.find((candidate) => candidate.entryKey === input.entryKey) ??
    desk.assignableWork[0]
  if (!work) return null

  const cases: CommissionableCase[] = []
  /*
   * Sequential, for the reason `caseListing` gives: each case needs its
   * assignments and its runs, and firing every query at once would take the
   * connection pool from the request path.
   *
   * The cost is stated rather than discovered: this walks the case list a
   * second time, after `agentDesk` has already walked it for the desk's runs.
   * Same shape as TD-71 and correct at the firm's present size — the thing to
   * revisit before it holds hundreds of cases, not after.
   */
  for (const investmentCase of await repositories.cases.list()) {
    cases.push(
      await commissionableCase({
        repositories,
        investmentCase,
        entryKey: work.entryKey,
        departmentId,
        providerKind,
      }),
    )
  }

  /*
   * The acts are read once and joined in memory rather than one lookup per set.
   * `forSet` returns every act that produced a set, newest first, and the
   * newest is what the offer states — an older act over the same membership is
   * a real record and is reached from the evidence desk, not from here.
   */
  const sets = await repositories.evidence.list(EVIDENCE_LIMIT)
  const acts = await repositories.assemblies.list(EVIDENCE_LIMIT)
  const newestActFor = new Map<string, EvidenceAssembly>()
  for (const act of acts) {
    if (!newestActFor.has(act.evidenceSetId)) newestActFor.set(act.evidenceSetId, act)
  }
  const evidence = sets.map((set) => toEvidenceOffer(set, newestActFor.get(set.id)))

  return {
    desk,
    entryKey: work.entryKey,
    currentBrief: work.brief,
    cases,
    evidence,
    providerKind,
  }
}

async function commissionableCase(input: {
  repositories: AnalysisRepositories
  investmentCase: InvestmentCase
  entryKey: string
  departmentId: string
  providerKind: ProviderKind
}): Promise<CommissionableCase> {
  const { repositories, investmentCase, entryKey, departmentId, providerKind } = input

  const entry = pinnedEntry(investmentCase, entryKey, departmentId)

  const [assignments, runs] = await Promise.all([
    repositories.assignments.listForCase(investmentCase.id),
    repositories.runs.listForCase(investmentCase.id),
  ])
  const assignment =
    assignments.find(
      (candidate) =>
        candidate.playbookEntryKey === entryKey &&
        candidate.departmentId === departmentId,
    ) ?? null

  return {
    investmentCase,
    playbookId: investmentCase.playbookId ?? null,
    playbookVersion: investmentCase.playbookVersion ?? null,
    brief: entry?.brief ?? null,
    eligibility: commissionEligibility({
      investmentCase,
      entry,
      assignment,
      assignments,
      runs,
      providerKind,
    }),
  }
}

/**
 * The entry as the case's own workflow version states it.
 *
 * Resolved through the registry by the case's pin, never by the currently
 * approved version: a case opened under v1 runs under v1, and reading the
 * current version here would show a person a budget and a brief their case
 * would never execute under.
 *
 * An unregistered pin returns `null` rather than throwing. A build that no
 * longer ships a version some case pinned is a real situation — the case is
 * simply not commissionable by this build — and it is a fact to report on the
 * row, not an exception that takes down the whole screen.
 */
function pinnedEntry(
  investmentCase: InvestmentCase,
  entryKey: string,
  departmentId: string,
): PlaybookEntry | null {
  if (!investmentCase.playbookId || !investmentCase.playbookVersion) return null
  let playbook: CasePlaybook
  try {
    playbook = requirePlaybook(investmentCase.playbookId, investmentCase.playbookVersion)
  } catch (error) {
    if (error instanceof UnknownPlaybookError) return null
    throw error
  }
  const entry = playbook.entries.find((candidate) => candidate.key === entryKey)
  if (!entry || entry.departmentId !== departmentId) return null
  return entry
}

function toEvidenceOffer(
  set: EvidenceSet,
  assembly: EvidenceAssembly | undefined,
): EvidenceOffer {
  const sources = [
    ...new Set(set.items.map((item) => item.provenance.source.providerName)),
  ].sort()
  /*
   * A derived member declares itself: `sourceId: 'derived'` is the provenance
   * model's own tier-4 source, and `methodology` carries the transformation and
   * its version. Neither is inferred from the value.
   */
  const derived = set.items.filter((item) => item.ref.sourceId === DERIVED_SOURCE_ID)
  return {
    evidenceSetId: set.id,
    assembledAt: set.assembledAt,
    observationCount: set.items.length,
    sources,
    disagreementCount: set.disagreements.length,
    revisionCount: set.revisions.length,
    derivedCount: derived.length,
    derivedMethodologies: [
      ...new Set(derived.map((item) => item.ref.methodology ?? 'unstated')),
    ].sort(),
    ...(assembly === undefined
      ? {}
      : {
          selection: {
            ruleId: assembly.selection.ruleId,
            subjectFamily: assembly.selection.subjectFamily,
            from: assembly.selection.from,
            to: assembly.selection.to,
            knownAt: assembly.selection.knownAt,
            actorEmployeeId: assembly.actorEmployeeId,
          },
        }),
    eligibility:
      set.items.length === 0
        ? { kind: 'refused', reason: 'no-observations' }
        : { kind: 'eligible' },
  }
}

/* ------------------------------------------------------------------ the act */

/**
 * Everything commissioning can be refused for, before anything is attempted.
 *
 * The eligibility vocabulary, plus the two things a person cannot see on the
 * screen because they were true a moment ago and are not now. Both are races
 * rather than choices — the surface offers only cases and evidence it just read
 * — and they are named rather than folded into an eligibility reason, because
 * "the firm will not take this work" and "the thing you picked is gone" send a
 * reader to two different places.
 */
export type CommissionActRefusal =
  | CommissionRefusalReason
  | 'case-not-found'
  | 'evidence-not-found'
  | 'evidence-has-no-observations'

export type CommissionResult =
  /**
   * The firm would not start it, and nothing was attempted.
   *
   * Reported before any command is issued, from the same rules the command
   * enforces. Nothing was spent and no run exists.
   */
  | { outcome: 'refused'; reason: CommissionActRefusal }
  /**
   * The institution declined at the command boundary.
   *
   * The mandate refusing an operator who does not work at the desk lands here,
   * as does anything else the firm decided at `StartAgentRun`. Not a failure:
   * an answer, with the code that says which rule.
   */
  | { outcome: 'declined'; code: DomainRejection['code']; detail?: string }
  /**
   * A run exists. What came of it is on the run, which is where to read it.
   *
   * `awaiting-acceptance` is the successful shape and `failed` is an honest
   * one — a live desk that timed out or overran its authorization produced a
   * record and no claims, and the person who commissioned it is owed that fact
   * rather than an error page.
   */
  | {
      outcome: 'ran'
      runId: string
      state: RunState
      failureCategory?: RunFailureCategory
      /** The domain's sentence for a refused candidate, for the log; never provider prose. */
      failureDetail?: string
    }

export interface CommissionAnalysisInput {
  repositories: AnalysisRepositories
  /** Everything a command needs, the seeded organization included. */
  deps: CommandDeps
  /** What will execute the work. Live from the product; never chosen here. */
  provider: ContributionProvider
  caseId: string
  departmentId: string
  entryKey: string
  evidenceSetId: string
  /**
   * The employee this act is booked to.
   *
   * Recorded as the ACTOR on every command the orchestration issues, which is
   * what makes the mandate load-bearing: `department-contribution` authorizes a
   * member of the owning department and nobody else, so an operator acting as
   * somebody who works elsewhere is declined by the institution rather than
   * filtered out by a dropdown.
   */
  /**
   * Who is accountable for the work.
   *
   * An employee when a person commissions a desk from the product, or the
   * desk's own institutional agent when it acts for itself. The orchestrator
   * is the initiator in both cases and never the actor.
   */
  actingPrincipal: AssertedActor
  /**
   * The thesis revision this work is scoped to, where it is scoped to one.
   *
   * Absent for an ordinary specialist contribution: the desk reads the evidence
   * and reports, and its claims stand whatever the argument on the table says.
   *
   * Required for a SYNTHESIS, because a synthesis reconciles one argument.
   * Recorded on the run, and the synthesis candidate is bound to it — which is
   * what stops a position produced from one revision being adopted onto
   * another. The run is refused outright if the revision was superseded while
   * the work was in flight.
   */
  revisionId?: string
  /**
   * Corrections Verification demands of this desk's accepted claims, when the
   * commission is correction work (TD-99). Handed to the provider with the
   * brief; the institution derived them from the record, the caller did not
   * write them.
   */
  corrections?: readonly CorrectionFinding[]
  now: () => Date
}

/**
 * Commissions one entry, synchronously, and reports what the firm did.
 *
 * Execution is synchronous by ruling: the run and its transitions persist
 * normally and the caller waits. There is no detached execution and no
 * invented progress — what a person sees afterwards is read back from the
 * record.
 */
/** The principal's id, for a deterministic commission identity. */
function principalId(actor: AssertedActor): string {
  if (actor.kind === 'employee') return actor.employeeId
  if (actor.kind === 'institutional-agent') return actor.agentPrincipalId
  return actor.systemId
}

export async function commissionAnalysis(
  input: CommissionAnalysisInput,
): Promise<CommissionResult> {
  const {
    repositories,
    deps,
    provider,
    caseId,
    departmentId,
    entryKey,
    evidenceSetId,
    actingPrincipal,
  } = input

  const investmentCase = await repositories.cases.get(caseId)
  if (!investmentCase) return { outcome: 'refused', reason: 'case-not-found' }

  const entry = pinnedEntry(investmentCase, entryKey, departmentId)

  const [assignments, priorRuns] = await Promise.all([
    repositories.assignments.listForCase(caseId),
    repositories.runs.listForCase(caseId),
  ])
  const assignment =
    assignments.find(
      (candidate) =>
        candidate.playbookEntryKey === entryKey &&
        candidate.departmentId === departmentId,
    ) ?? null

  const eligibility = commissionEligibility({
    investmentCase,
    entry,
    assignment,
    assignments,
    runs: priorRuns,
    providerKind: provider.kind,
    ...(input.revisionId ? { revisionId: input.revisionId } : {}),
  })
  if (eligibility.kind === 'refused') {
    return { outcome: 'refused', reason: eligibility.reason }
  }

  /*
   * Evidence is resolved before anything is committed, not left to the
   * provider. A live provider handed an id the store does not hold fails
   * `evidence-unavailable` — after `StartAgentRun` has committed a run — which
   * would spend a run record on a mistake the firm could see in advance.
   */
  const evidenceSet = await repositories.evidence.get(evidenceSetId)
  if (!evidenceSet) return { outcome: 'refused', reason: 'evidence-not-found' }
  /*
   * An assembled set holding nothing. Refused for the same reason the surface
   * refuses to offer it: a desk handed no observations can only produce an
   * assertion, and an assertion is what the evidence requirement exists to
   * prevent.
   */
  if (evidenceSet.items.length === 0) {
    return { outcome: 'refused', reason: 'evidence-has-no-observations' }
  }

  /* Narrowed by `commissionEligibility`; both are non-null on the eligible path. */
  const readyEntry = entry!
  const readyAssignment = assignment!

  /*
   * The deadline the run is bound by, read off the resolution rather than
   * chosen beside it. `runPlaybook` takes the minimum of this and the firm
   * ceiling it builds, and since there is no firm ceiling the minimum is this —
   * so the authorization the record carries is the one the playbook proposed
   * and nothing else.
   */
  const deadlineMs =
    eligibility.budget.deadline.kind === 'limit'
      ? eligibility.budget.deadline.deadlineMs
      : null
  /* Unreachable for live work, which `commissionEligibility` already refused. */
  if (deadlineMs === null) {
    return { outcome: 'refused', reason: 'no-authorized-budget' }
  }

  /*
   * Which attempt this is, counted off the record.
   *
   * The orchestration's command ids have to be deterministic — that is what
   * makes a crashed run resumable rather than duplicated — and they also have
   * to differ between two genuine commissions. A retryable failure returns the
   * assignment to `queued`, so re-commissioning is legitimate; keying on the
   * runs already recorded against the assignment gives the retry a fresh
   * identity while a double-submit against unchanged state replays the first.
   */
  const attempt = priorRuns.filter(
    (run) => run.assignmentId === readyAssignment.id,
  ).length

  /*
   * What the record shows finished, read the way `StartAgentRun` reads it:
   * `completed` is the state a run reaches once its contribution was ACCEPTED,
   * so produced-but-unadopted work does not satisfy a dependency here either.
   *
   * Obsolete runs are excluded for the reason they are excluded in flight — the
   * work reasoned over a revision the firm has replaced, and a synthesis fed
   * those claims would reconcile an argument nobody is having any more.
   */
  const satisfiedClaims = new Map<string, AgentClaim[]>()
  for (const candidate of assignments) {
    /*
     * The entry being commissioned is never satisfied by its own earlier run:
     * work returned for correction has an adopted run on record, and that run
     * is exactly what is being replaced (TD-99). Listing it here would tell the
     * orchestrator the entry is done, and nothing would start.
     */
    if (candidate.id === readyAssignment.id) continue
    /* The run that STANDS for the assignment — after a correction, the corrected one, never both. */
    const run = standingRunFor(candidate, priorRuns)
    if (!run) continue
    const key = run.execution.playbookEntryKey
    satisfiedClaims.set(key, [...(satisfiedClaims.get(key) ?? []), ...run.claims])
  }
  const satisfiedEntries = [...satisfiedClaims].map(([entryKey, claims]) => ({
    entryKey,
    claims,
  }))
  const commissionId = `commission-${caseId}-${entryKey}-${attempt}-${principalId(actingPrincipal)}`

  const outcome = await runPlaybook(
    requirePlaybook(investmentCase.playbookId!, investmentCase.playbookVersion!),
    provider,
    {
      caseId,
      evidenceSetId,
      /*
       * The assignment the institution already created, read back rather than
       * re-derived from the command that made it. A second derivation of an
       * identity is a second chance to disagree with the stored one.
       */
      assignmentIdFor: () => readyAssignment.id,
      /*
       * The operator, on every command. Not the department's manager: this is
       * a person commissioning work, and booking it to somebody who did not
       * press the button would put a name the firm can audit on an act they
       * never performed.
       */
      actorFor: () => actingPrincipal,
      commandIdFor: (key, act) => `${commissionId}-${key}-${act}`,
      correlationId: caseId,
      /*
       * What set it in motion. A person is the actor; the surface they used is
       * the initiator, which is the distinction the envelope already draws.
       */
      orchestratorId: 'agent-headquarters',
      now: input.now,
      ...(input.revisionId ? { revisionId: input.revisionId } : {}),
      /*
       * Where a revision IS targeted, currency is decided by the record rather
       * than asserted: `StartAgentRun` refuses a superseded one, and a revision
       * that was replaced between the check and the command is refused there
       * too. Where none is targeted there is nothing that could be superseded.
       */
      revisionIsCurrent: () => true,
      /* Correction work carries what Verification found, for the one entry commissioned here. */
      correctionsFor: () => input.corrections,
    },
    {
      stageDeadlineMs: deadlineMs,
      maxConcurrency: 1,
      /* Intent. The institution still decides — see this module's header. */
      requestedEntryKeys: [readyEntry.key],
      /*
       * What the case has already finished, so the orchestrator judges
       * readiness against the record rather than against this one call.
       *
       * A commission runs a SINGLE entry, so every dependency it has
       * necessarily completed in an earlier invocation. Without this the
       * orchestrator's `completed` set is empty, nothing with a blocker is ever
       * ready, and `aggregation` — the whole point of a workflow that waits for
       * two desks — could not be commissioned at all.
       *
       * This grants nothing. `StartAgentRun` asks the same question of the same
       * rows and refuses an entry whose blockers have not completed.
       */
      satisfiedEntries,
      /*
       * No `firmBudgetCeiling`. There is no durable firm-wide ceiling to read
       * (TD-76), and a caller-side constant would be exactly the override the
       * stage forbids.
       */
    },
    deps,
  )

  const stage = outcome.outcomes.find((candidate) => candidate.entryKey === entryKey)
  /*
   * Unreachable: a requested entry is always accounted for, either as a run or
   * on one of the tails. Reported rather than asserted, because a silent
   * `undefined` here would look like a successful commission that produced
   * nothing.
   */
  if (!stage) return { outcome: 'declined', code: 'invariant-violated' }

  /*
   * The firm refused to start. `runEntry` reports that as `blocked` carrying
   * the rejection code, because nothing started and there is therefore no run
   * to fail.
   */
  if (stage.state === 'blocked' && stage.rejection) {
    return {
      outcome: 'declined',
      code: stage.rejection,
      ...(stage.rejectionDetail ? { detail: stage.rejectionDetail } : {}),
    }
  }

  /*
   * The run, found by what is new rather than by an id derived a second time.
   * A run that exists is the fact worth returning even when it failed: the
   * record is where a person reads what the firm spent and why it stopped.
   */
  const before = new Set(priorRuns.map((run) => run.id))
  const created = (await repositories.runs.listForCase(caseId)).find(
    (run) => run.assignmentId === readyAssignment.id && !before.has(run.id),
  )
  if (!created) {
    return {
      outcome: 'declined',
      code: stage.rejection ?? 'illegal-prior-state',
    }
  }

  return {
    outcome: 'ran',
    runId: created.id,
    state: created.state,
    ...(created.failure ? { failureCategory: created.failure.category } : {}),
    ...(stage.rejectionDetail ? { failureDetail: stage.rejectionDetail } : {}),
  }
}
