/**
 * The Command Center read model: what the firm owes, who is on the floor, and
 * what has actually happened.
 *
 * ## It projects; it never derives
 *
 * Every institutional judgement on this surface was already made somewhere
 * else and is read here unchanged:
 *
 *   what a case owes next   `CaseStanding.nextAct` — the domain decided it
 *   who owns it             `CaseStanding.ownership`
 *   whether it is settled   `CaseStanding.settled`
 *   what happened           `events.recent()` — persisted transition events
 *   who the desks are       `agentDirectory`
 *
 * Nothing here recomputes standing, re-ranks urgency by a rule of its own, or
 * invents a status. The one thing it does that the parts do not is **count**,
 * and counting rows the firm already wrote is not a second derivation.
 *
 * ## Why the coverage figures exist
 *
 * `stepCoverage` answers a question the Command Center has to be able to ask
 * honestly: *what can the firm not tell you yet?* It is computed from the
 * per-case step standings the domain already produced — how many cases have
 * reached each step at all. When the count is zero the surface says so in
 * words, instead of rendering a handsome empty panel that implies the firm
 * holds a view it has never formed.
 *
 * That is the opposite of a placeholder. A placeholder hides an absence; this
 * states it.
 */

import type {
  ActivityItem,
  CaseStage,
  CaseStanding,
  CaseStep,
  InstitutionalAct,
  ProviderKind,
  RunUsage,
} from '~/domain/analysis'
import { CASE_STEPS } from '~/domain/analysis'
import type { AgentDesk } from './agentDirectory'
import type { CaseListing } from './caseListing'

/** One case the firm still owes something on. */
export interface Obligation {
  caseId: string
  /** The question the case asks. Never truncated here; the surface decides. */
  question: string
  subjectDisplayName: string
  stage: CaseStage
  /** Read from `nextAct`, never inferred from the stage. */
  act: InstitutionalAct
  owningDepartmentId: string | null
  owningEmployeeId: string | null
  ownershipKind: CaseStanding['ownership']['kind']
  /** Structural reasons progress stopped. Kinds; the surface resolves them. */
  blockerKinds: readonly string[]
}

/** One desk on the floor, with what it currently has in hand. */
export interface FloorDesk {
  departmentId: string
  name: string
  /** Independent control function. Rendered separately, never ranked. */
  isGovernance: boolean
  managerDisplayName: string
  /**
   * What the desk's manager is accountable for, in the firm's own words.
   *
   * The first responsibility the organisation records for them. Carried so a
   * desk can say what it does — which is what the reference's agent cards show
   * and what turns a name into a colleague — without the surface inventing a
   * description for it.
   */
  summary: string | null
  /** Whether that discipline yields a reading rather than a measurement. */
  interpretive: boolean
  /** The desk's discipline tags, as the seed states them. */
  handles: readonly string[]
  /**
   * Cases whose next institutional act this desk owns.
   *
   * From `CaseStanding.nextAct.owningDepartmentId` — the domain's own answer to
   * whose queue a case sits in. It leads the desk module, because *what does
   * this desk owe the firm* is the question a floor exists to answer; how many
   * runs it once failed is not.
   */
  obligationsOwed: number
  /** Runs a person has still to judge. The desk's real queue. */
  awaitingAcceptance: number
  running: number
  completed: number
  failed: number
  /** Most recent run start, or null for a desk that has never run. */
  lastRunAt: string | null
  /**
   * When this desk last produced work a person accepted.
   *
   * Institutional output, as against execution history. `null` means nothing
   * has ever been accepted from it — a different fact from never having run,
   * and rendered as one.
   */
  latestAcceptedAt: string | null
}

/**
 * One run, flattened for a compact institutional listing.
 *
 * It carries `providerKind` and `usage` because two rules travel with every
 * run wherever it is shown: **a stub must never read as live analysis**, and
 * **what a run spent is a measurement or an absence, never a zero somebody
 * assumed**. A compact row that dropped them would be a shorter row that told
 * a reader less than the record holds.
 */
export interface RunLine {
  runId: string
  caseId: string
  departmentId: string
  state: string
  startedAt: string
  /** Present only where the run actually settled. */
  completedAt: string | null
  failureCategory: string | null
  providerKind: ProviderKind
  usage: RunUsage
}

/**
 * Obligations that owe the same act to the same owner.
 *
 * **Presentation grouping, not institutional merging.** Every case keeps its
 * own identity and its own standing; `caseIds` carries all of them, and the
 * drill-down opens each separately. What this removes is fourteen visually
 * identical rows saying the same sentence — which is a rendering problem, not a
 * fact about the firm.
 *
 * Nothing is prioritised. The order is `caseListing`'s, which puts outstanding
 * work before settled work and otherwise preserves the repository's order.
 */
export interface ObligationGroup {
  act: InstitutionalAct
  owningDepartmentId: string | null
  ownershipKind: CaseStanding['ownership']['kind']
  /** Every case in the group, in the order the read model returned them. */
  caseIds: readonly string[]
  /** The first case's question, shown as the group's example. */
  exampleQuestion: string
  /** True when at least one case in the group is blocked. */
  hasBlocker: boolean
}

/** How the firm's open obligations are distributed across the people who owe them. */
export interface OwnerLoad {
  /** Department id, or `null` where the chief owns it. */
  departmentId: string | null
  label: string
  count: number
  isChief: boolean
}

/** How many cases have reached a step at all. Zero is the interesting value. */
export interface StepCoverage {
  step: CaseStep
  complete: number
  outstanding: number
  notApplicable: number
}

export interface CommandCenterView {
  /** Cases still owing something, in the order `caseListing` settled on. */
  obligations: readonly Obligation[]
  totalCases: number
  settledCases: number
  floor: readonly FloorDesk[]
  /**
   * Real persisted state changes, newest first.
   *
   * Projected by the domain's own `projectActivity` from run events and case
   * transitions — never assembled here, and never carrying prose. The wording
   * is applied at the presentation boundary, which is what keeps "the floor
   * must feel alive" from ever becoming a field something can write into.
   */
  activity: readonly ActivityItem[]
  evidenceSetCount: number
  /** When the firm last declared a body of evidence fit. */
  latestAssemblyAt: string | null
  stepCoverage: readonly StepCoverage[]
  /**
   * Cases whose next act the chief owns.
   *
   * From `ownership.kind === 'chief'`, which the domain sets. It lets the floor
   * place the CIO in the organisation without implying a decision was made:
   * this says what is waiting, and `stepCoverage` says that none has ever been
   * taken.
   */
  chiefObligations: number
  /** The same obligations, grouped by what is owed and who owes it. */
  obligationGroups: readonly ObligationGroup[]
  /** Where the firm's obligations sit, most loaded first. Counting, not ranking. */
  ownerLoad: readonly OwnerLoad[]
  /** The firm's most recent runs, newest first. */
  recentRuns: readonly RunLine[]
}

export interface CommandCenterInput {
  cases: readonly CaseListing[]
  desks: readonly AgentDesk[]
  activity: readonly ActivityItem[]
  evidenceSetCount: number
  latestAssemblyAt: string | null
}

/**
 * Assembles the view from parts that were each read elsewhere.
 *
 * Takes already-read values rather than repositories, for the reason
 * `ingestYields` takes normalized domain values: the projection is then
 * testable without a database, and the fan-out cost stays visible at the call
 * site — which matters here, because `caseListing` computes one standing per
 * case sequentially and TD-71 exists to keep that from being forgotten.
 */
export function commandCenterView(input: CommandCenterInput): CommandCenterView {
  const { cases, desks, activity } = input

  const obligations = cases
    .filter((entry) => !entry.standing.settled)
    .map((entry) => toObligation(entry))

  return {
    obligations,
    totalCases: cases.length,
    settledCases: cases.filter((entry) => entry.standing.settled).length,
    floor: desks.map((desk) => floorDeskOf(desk, obligations)),
    activity,
    evidenceSetCount: input.evidenceSetCount,
    latestAssemblyAt: input.latestAssemblyAt,
    stepCoverage: coverage(cases),
    chiefObligations: obligations.filter((entry) => entry.ownershipKind === 'chief')
      .length,
    obligationGroups: groupObligations(obligations),
    ownerLoad: ownerLoad(obligations, desks),
    recentRuns: recentRuns(desks),
  }
}

/**
 * Obligations that owe the same act to the same owner, collapsed for reading.
 *
 * Order is preserved from the input, so the first group is the one holding the
 * firm's first outstanding case. Nothing is sorted by size or urgency: the firm
 * has no urgency model, and inventing one here would be exactly the
 * prioritisation the presentation boundary forbids.
 */
function groupObligations(
  obligations: readonly Obligation[],
): readonly ObligationGroup[] {
  const groups = new Map<string, ObligationGroup>()
  for (const obligation of obligations) {
    const key = `${obligation.act}|${obligation.owningDepartmentId ?? obligation.ownershipKind}`
    const existing = groups.get(key)
    if (existing) {
      groups.set(key, {
        ...existing,
        caseIds: [...existing.caseIds, obligation.caseId],
        hasBlocker: existing.hasBlocker || obligation.blockerKinds.length > 0,
      })
      continue
    }
    groups.set(key, {
      act: obligation.act,
      owningDepartmentId: obligation.owningDepartmentId,
      ownershipKind: obligation.ownershipKind,
      caseIds: [obligation.caseId],
      exampleQuestion: obligation.question,
      hasBlocker: obligation.blockerKinds.length > 0,
    })
  }
  return [...groups.values()]
}

/**
 * Obligations grouped by whoever owes them.
 *
 * Counting, not ranking: the order is by how much is waiting, which is a fact,
 * and nothing here decides that one owner's queue matters more than another's.
 */
function ownerLoad(
  obligations: readonly Obligation[],
  desks: readonly AgentDesk[],
): readonly OwnerLoad[] {
  const names = new Map(desks.map((desk) => [desk.departmentId, desk.name]))
  const tally = new Map<string, OwnerLoad>()

  for (const obligation of obligations) {
    const isChief = obligation.ownershipKind === 'chief'
    const key = isChief ? 'chief' : (obligation.owningDepartmentId ?? 'unassigned')
    const existing = tally.get(key)
    if (existing) {
      tally.set(key, { ...existing, count: existing.count + 1 })
      continue
    }
    tally.set(key, {
      departmentId: isChief ? null : obligation.owningDepartmentId,
      label: isChief
        ? 'CIO'
        : (names.get(obligation.owningDepartmentId ?? '') ??
          obligation.owningDepartmentId ??
          'Ingen angiven'),
      count: 1,
      isChief,
    })
  }

  return [...tally.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  )
}

/** Newest first across the whole firm. A filing order, never an institutional one. */
function recentRuns(desks: readonly AgentDesk[]): readonly RunLine[] {
  return desks
    .flatMap((desk) =>
      desk.runs.map((run) => ({
        runId: run.id,
        caseId: run.caseId,
        departmentId: desk.departmentId,
        state: run.state as string,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? null,
        failureCategory: run.failure?.category ?? null,
        providerKind: run.execution.providerKind,
        usage: run.usage,
      })),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, RECENT_RUN_LINES)
}

const RECENT_RUN_LINES = 8

function toObligation(entry: CaseListing): Obligation {
  const { investmentCase, standing } = entry
  return {
    caseId: investmentCase.id,
    question: investmentCase.question,
    subjectDisplayName: investmentCase.subject.displayName,
    stage: standing.stage,
    /* The domain's answer, carried through. */
    act: standing.nextAct.act,
    owningDepartmentId: standing.ownership.departmentId,
    owningEmployeeId: standing.ownership.employeeId,
    ownershipKind: standing.ownership.kind,
    blockerKinds: standing.blockers.map((blocker) => blocker.kind),
  }
}

/**
 * One desk, counted.
 *
 * Exported because Headquarters renders the same floor and must count it the
 * same way. Two surfaces tallying run states independently is how the firm ends
 * up telling a reader two different things about the same desk.
 */
export function floorDeskOf(
  desk: AgentDesk,
  /** The firm's open obligations, so a desk can say what it owes. */
  obligations: readonly Obligation[] = [],
): FloorDesk {
  const runs = desk.runs
  const count = (state: string) => runs.filter((run) => run.state === state).length
  const accepted = runs
    .filter((run) => run.state === 'completed' && run.completedAt)
    .map((run) => run.completedAt!)
    .sort()
  return {
    departmentId: desk.departmentId,
    name: desk.name,
    isGovernance: desk.isGovernance,
    managerDisplayName: desk.manager.displayName,
    summary: desk.responsibilities[0]?.summary ?? null,
    interpretive: desk.responsibilities[0]?.interpretive ?? false,
    handles: desk.handles,
    obligationsOwed: obligations.filter(
      (entry) => entry.owningDepartmentId === desk.departmentId,
    ).length,
    latestAcceptedAt: accepted.at(-1) ?? null,
    awaitingAcceptance: count('awaiting-acceptance'),
    running: count('running'),
    completed: count('completed'),
    /*
     * Every way a run can end without producing acceptable work. Counted
     * together because the floor strip answers "does this desk need a person",
     * and the difference between a timeout and a refusal is a question the run
     * record answers, one level down.
     */
    failed: runs.filter(
      (run) =>
        run.state === 'failed' || run.state === 'timed-out' || run.state === 'cancelled',
    ).length,
    lastRunAt: runs[0]?.startedAt ?? null,
  }
}

/** One row per step the firm's workflow defines, in the order it defines them. */
function coverage(cases: readonly CaseListing[]): readonly StepCoverage[] {
  return CASE_STEPS.map((step) => {
    let complete = 0
    let outstanding = 0
    let notApplicable = 0
    for (const entry of cases) {
      const standing = entry.standing.steps.find((candidate) => candidate.step === step)
      if (!standing) continue
      if (standing.status === 'complete') complete += 1
      else if (standing.status === 'outstanding') outstanding += 1
      else notApplicable += 1
    }
    return { step, complete, outstanding, notApplicable }
  })
}
