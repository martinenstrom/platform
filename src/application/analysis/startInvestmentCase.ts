/**
 * The Chairman asks the firm a question, and the committee is convened.
 *
 * One user-facing act — *Kalla samman kommittén* — over **two** institutional
 * commands, and the seam between them is deliberately visible rather than
 * smoothed away.
 *
 * ## Why this is not one transaction
 *
 * `commands/envelope.ts` states the rule: one handler is one `withTransaction`,
 * no handler calls another, and composition happens above by issuing a second
 * command so that every transaction boundary stays visible in the ledger. A
 * composite command would hide two commits behind one ledger entry; a
 * cross-command transaction would break the rule the command layer is built on.
 * Neither is available, and neither should be.
 *
 * So there are three outcomes, not two, and the middle one is real:
 *
 *   `convened`               both commands committed
 *   `convening-incomplete`   the case exists; the committee was not convened
 *   `refused`                nothing was created
 *
 * A `convening-incomplete` case is **not** a failure to be cleaned up. The
 * Chairman's question has been registered and the firm is keeping it. It is not
 * active analysis, not a convened committee and not an invalid thesis, and
 * deleting it would throw away something a person actually asked.
 *
 * ## Everything checkable is checked before the first commit
 *
 * `resolveCaseIntake` reads the registry and the organisation and touches no
 * storage, so an unroutable case kind, an absent department or an orphaned
 * manager refuses the request outright. The partial state is therefore reserved
 * for genuine execution failure — storage going away between two commits —
 * rather than for input anybody could have rejected up front.
 *
 * ## Retry does not open a second case
 *
 * `resumeConvening` runs only the second command, against the case that already
 * exists. `instantiatePlaybook` is idempotent on `(playbookId, version)` by
 * content, so retrying a convening that actually succeeded replays rather than
 * doubling, and no compensation or deletion is needed.
 */

import { stableHashHex } from '~/domain/shared/hash'
import { systemClock } from '~/domain/shared/clock'
import type { AnalysisRepositories } from './repositories'
import type { CommandInitiator } from '~/domain/analysis'
import { runCommand, type CommandDeps } from './commands/runCommand'
import { openInvestmentCase } from './commands/openInvestmentCase'
import { instantiatePlaybook } from './commands/instantiatePlaybook'
import {
  deriveSubjectRef,
  resolveCaseIntake,
  type ResolvedCaseIntake,
} from './caseIntake'
import { MACRO_REGIME_CASE_KIND } from './macroPlaybook'

export type StartInvestmentCaseResult =
  /** Both commands committed. The committee is convened. */
  | { state: 'convened'; caseId: string }
  /**
   * The case is durable; the committee is not convened.
   *
   * `code` is the institution's own word for what stopped the second command,
   * never a driver message.
   */
  | { state: 'convening-incomplete'; caseId: string; code: string }
  /** Nothing was created. */
  | { state: 'refused'; code: string }

export interface StartInvestmentCaseInput {
  repositories: AnalysisRepositories
  deps: CommandDeps
  /** What the firm is being asked. */
  question: string
  /** What the question is about, as the Chairman named it. */
  subjectDisplayName: string
  /** Minted once per submission so a retry does not open a second case. */
  requestId: string
  actingEmployeeId: string
  /**
   * Who dispatched the act, where that is not the person themselves.
   *
   * Absent — the Chairman Console — the actor and the initiator are one person
   * at a form, which is what the ledger has always recorded for this act. A
   * host acting on the person's behalf names itself here as an orchestrator,
   * so the record says who dispatched the act without ever saying the host
   * performed it. A host that could not say so would have the ledger claim the
   * person acted directly, which is false provenance.
   */
  initiator?: CommandInitiator
  now?: () => string
}

/**
 * The id for a case the Chairman is opening.
 *
 * Derived from a `requestId` the console mints once per submission, so a
 * retried network call lands on the same case rather than opening a second one,
 * while two genuinely different questions never collide. `cases.create` is
 * idempotent on id, which is what makes that safe.
 */
export function caseIdFor(requestId: string): string {
  return `case-${stableHashHex(requestId).slice(0, 24)}`
}

/**
 * The envelope for the Chairman's act.
 *
 * The actor is always the person. The initiator is the person too unless a
 * host dispatched the act on their behalf — see `StartInvestmentCaseInput`.
 */
function chairmanEnvelope(
  commandId: string,
  caseId: string,
  employeeId: string,
  initiator: CommandInitiator,
  occurredAt: string,
  over: Record<string, unknown> = {},
) {
  return {
    commandId,
    correlationId: caseId,
    actor: { kind: 'employee' as const, employeeId },
    initiator,
    occurredAt,
    ...over,
  }
}

/** The console's case: the person at the form dispatched their own act. */
const selfInitiated = (employeeId: string): CommandInitiator => ({
  kind: 'employee',
  employeeId,
})

/**
 * Convene the committee on an already-open case.
 *
 * Shared by the initial submission and by *Återuppta sammankallning*, so the
 * retry path is the same code as the first attempt rather than a second
 * implementation free to drift from it.
 */
async function conveneCommittee(
  repositories: AnalysisRepositories,
  deps: CommandDeps,
  caseId: string,
  intake: ResolvedCaseIntake,
  actingEmployeeId: string,
  initiator: CommandInitiator,
  occurredAt: string,
): Promise<{ committed: boolean; code: string }> {
  const current = await repositories.cases.get(caseId)
  if (!current) return { committed: false, code: 'NOT_FOUND' }

  /*
   * Already convened: the case pins a workflow. Reported as convened without a
   * second command, because that is the truth and the alternative was not.
   *
   * Measured when a host retried a delegation that had fully succeeded. The
   * first command replays cleanly — same id, same payload — but this one
   * carries `expectedVersion`, which the first convening moved, so the replay
   * arrived as a different payload under the same command id and the ledger
   * refused it as `payload-conflict`. The caller was then told
   * `convening-incomplete` about a committee that was sitting. Reading the
   * case first makes a retry after success what the retry doctrine says it
   * is: a no-op onto the same case.
   */
  if (current.playbookId && current.playbookVersion) {
    return { committed: true, code: 'CONVENED' }
  }

  const result = await runCommand(
    instantiatePlaybook(deps.organization),
    {
      caseId,
      playbookId: intake.playbookId,
      playbookVersion: intake.playbookVersion,
      onBehalfOfDepartmentId: intake.onBehalfOfDepartmentId,
    },
    chairmanEnvelope(
      `${caseId}-convene`,
      caseId,
      actingEmployeeId,
      initiator,
      occurredAt,
      {
        expectedVersion: current.version,
      },
    ),
    deps,
  )

  if (result.outcome === 'committed') return { committed: true, code: 'CONVENED' }
  if (result.outcome === 'rejected') {
    return { committed: false, code: result.rejection.code }
  }
  /*
   * `unresolved` is not reported as convened. The commit cannot be proven, and
   * a committee the firm cannot show was convened is exactly the state the
   * incomplete arm exists to name.
   */
  return { committed: false, code: 'SERVICE_UNAVAILABLE' }
}

export async function startInvestmentCase(
  input: StartInvestmentCaseInput,
): Promise<StartInvestmentCaseResult> {
  const { repositories, deps, actingEmployeeId } = input
  const now = input.now ?? (() => systemClock.isoNow())
  const initiator = input.initiator ?? selfInitiated(actingEmployeeId)

  /* --------------------------------------------- before anything is created */

  if (!input.question.trim()) return { state: 'refused', code: 'QUESTION_REQUIRED' }
  if (!input.subjectDisplayName.trim()) {
    return { state: 'refused', code: 'SUBJECT_REQUIRED' }
  }
  if (!input.requestId.trim()) return { state: 'refused', code: 'REQUEST_ID_REQUIRED' }

  let intake: ResolvedCaseIntake
  let subjectRef: string
  try {
    intake = resolveCaseIntake(MACRO_REGIME_CASE_KIND, deps.organization)
    subjectRef = deriveSubjectRef(input.subjectDisplayName)
  } catch {
    /*
     * A routing or naming fault the firm can state before it writes anything.
     * Refusing here is what keeps the partial state rare.
     */
    return { state: 'refused', code: 'NOT_ROUTABLE' }
  }

  if (!deps.organization.employees.some((employee) => employee.id === actingEmployeeId)) {
    return { state: 'refused', code: 'UNKNOWN_OPERATOR' }
  }

  /* ----------------------------------- first commit: the question is durable */

  const caseId = caseIdFor(input.requestId)
  const at = now()
  const opened = await runCommand(
    openInvestmentCase(deps.organization),
    {
      caseId,
      subject: {
        kind: MACRO_REGIME_CASE_KIND,
        ref: subjectRef,
        displayName: input.subjectDisplayName.trim(),
      },
      question: input.question.trim(),
      ownerEmployeeId: intake.ownerEmployeeId,
      participatingDepartmentIds: intake.participatingDepartmentIds,
    },
    chairmanEnvelope(`${caseId}-open`, caseId, actingEmployeeId, initiator, at),
    deps,
  )

  if (opened.outcome === 'rejected') {
    return { state: 'refused', code: opened.rejection.code }
  }
  if (opened.outcome !== 'committed') {
    /*
     * Nothing is claimed about a case that may or may not exist. The Chairman
     * is told the request did not land, and a resubmission carrying the same
     * `requestId` replays onto the same id if it did.
     */
    return { state: 'refused', code: 'SERVICE_UNAVAILABLE' }
  }

  /* ------------------------------ second commit: the committee is convened */

  const convened = await conveneCommittee(
    repositories,
    deps,
    caseId,
    intake,
    actingEmployeeId,
    initiator,
    at,
  )
  return convened.committed
    ? { state: 'convened', caseId }
    : { state: 'convening-incomplete', caseId, code: convened.code }
}

/**
 * *Återuppta sammankallning* — convene the committee on a case that exists.
 *
 * Never opens a case. If the case is gone this reports `NOT_FOUND` rather than
 * creating one, because a resume that can create is a second open command
 * wearing a different name.
 */
export async function resumeConvening(input: {
  repositories: AnalysisRepositories
  deps: CommandDeps
  caseId: string
  actingEmployeeId: string
  /** As on `StartInvestmentCaseInput`: absent means the person dispatched it. */
  initiator?: CommandInitiator
  now?: () => string
}): Promise<StartInvestmentCaseResult> {
  const now = input.now ?? (() => systemClock.isoNow())
  const initiator = input.initiator ?? selfInitiated(input.actingEmployeeId)
  const existing = await input.repositories.cases.get(input.caseId)
  if (!existing) return { state: 'refused', code: 'NOT_FOUND' }

  let intake: ResolvedCaseIntake
  try {
    intake = resolveCaseIntake(existing.subject.kind, input.deps.organization)
  } catch {
    return { state: 'refused', code: 'NOT_ROUTABLE' }
  }

  const convened = await conveneCommittee(
    input.repositories,
    input.deps,
    input.caseId,
    intake,
    input.actingEmployeeId,
    initiator,
    now(),
  )
  return convened.committed
    ? { state: 'convened', caseId: input.caseId }
    : { state: 'convening-incomplete', caseId: input.caseId, code: convened.code }
}
