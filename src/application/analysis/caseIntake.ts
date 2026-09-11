/**
 * Who the firm puts on a case when somebody asks it a question.
 *
 * The Chairman supplies a question and a subject. Everything else — which desk
 * is accountable, which workflow applies, who owns the case — is an
 * institutional routing fact, and this module is where the firm states it
 * once, in the open, instead of letting a form or a server function decide.
 *
 * ## Why this is not a set of defaults
 *
 * `scripts/open-case.ts` carries `owner = 'research-director'` and
 * `participatingDepartmentIds = ['research-office']` as command-line defaults.
 * They are development conveniences that happened to work, and copying them
 * into the product would make a routing rule out of a flag nobody ruled on.
 *
 * What is here is derived from two authoritative sources and asserted against
 * neither: the approved playbook for the case kind, and the seeded
 * organisation. If either stops supporting the derivation, this fails loudly
 * rather than falling back to a name written in this file.
 *
 * ## The derivation
 *
 * A case kind names the **discipline that is accountable for the case as a
 * whole**. The playbook says which department holds that discipline; the
 * organisation says who manages that department. That manager owns the case.
 *
 * For `macro-regime` the accountable discipline is `aggregation` — the desk
 * that reconciles the other desks' work into one thesis is the desk answerable
 * for the case. Under the current playbook that resolves to Research Office,
 * and under the current organisation its manager is the Research Director.
 * Neither of those names is written here.
 *
 * ## Participation is seeded, not enumerated
 *
 * Only the accountable department is seeded. `instantiatePlaybook` already
 * grows participation to every department the playbook engages, deriving it
 * from `playbook.entries`, and duplicating that here would be a second answer
 * to a question the convening act already answers.
 *
 * Before convening, one department is involved: the desk that received the
 * question. That is also the honest reading of a case whose committee has not
 * been convened yet.
 *
 * ## Versioned
 *
 * `CASE_INTAKE_POLICY_VERSION` moves when the routing RULE changes. It does not
 * move when the playbook or the organisation changes underneath it — those
 * carry their own versions, and conflating the three would make this version
 * meaningless.
 */

import type { Organization } from '~/domain/analysis'
import { requirePlaybook, resolveForCaseKind } from './playbookRegistry'
import type { CasePlaybook } from './playbooks'
import { MACRO_REGIME_CASE_KIND } from './macroPlaybook'

/** Moves when the routing rule changes; not when its inputs do. */
export const CASE_INTAKE_POLICY_VERSION = '1'

/**
 * How one kind of case is routed on arrival.
 *
 * A tag, not a department. Naming a department here would put the org chart in
 * two places and let them disagree.
 */
interface CaseIntakeRouting {
  caseKind: string
  /**
   * The discipline whose desk answers for the case as a whole.
   *
   * Resolved through the playbook, so a workflow that moves the accountable
   * discipline to another desk moves the ownership with it.
   */
  accountableDisciplineTag: string
}

/** Every case kind the firm can currently be asked to open. */
export const CASE_INTAKE_POLICY: readonly CaseIntakeRouting[] = Object.freeze([
  Object.freeze({
    caseKind: MACRO_REGIME_CASE_KIND,
    accountableDisciplineTag: 'aggregation',
  }),
])

export class UnroutableCaseKindError extends Error {
  constructor(readonly caseKind: string) {
    super(
      `No intake routing covers case kind "${caseKind}". Add it to ` +
        `CASE_INTAKE_POLICY rather than choosing an owner at the call site.`,
    )
    this.name = 'UnroutableCaseKindError'
  }
}

/**
 * The routing exists but the firm can no longer satisfy it.
 *
 * Separated from `UnroutableCaseKindError` because they are different faults:
 * one is a case kind nobody has ruled on, the other is a rule whose ground has
 * moved. The second must never be answered by guessing another desk.
 */
export class IntakeRoutingUnsatisfiableError extends Error {
  constructor(
    readonly caseKind: string,
    why: string,
  ) {
    super(`Intake routing for "${caseKind}" cannot be satisfied: ${why}`)
    this.name = 'IntakeRoutingUnsatisfiableError'
  }
}

export interface ResolvedCaseIntake {
  policyVersion: string
  caseKind: string
  /** The approved workflow, from the registry. Never named by a caller. */
  playbookId: string
  playbookVersion: string
  /** The desk answerable for the case. */
  accountableDepartmentId: string
  /** Its manager, who owns the case. */
  ownerEmployeeId: string
  /** Convening acts on behalf of the accountable desk. */
  onBehalfOfDepartmentId: string
  /** The seed. Convening grows this from the playbook's own entries. */
  participatingDepartmentIds: readonly string[]
}

/**
 * Resolve everything the firm decides about a new case of this kind.
 *
 * Pure: it reads the registry and the organisation it is given, and touches no
 * storage. Callers may therefore run it BEFORE any commit, which is the point —
 * a routing fault should refuse the request rather than leave a case behind.
 */
/**
 * The entry a case's accountable desk answers for, in the playbook the case
 * actually pinned.
 *
 * Distinct from `resolveCaseIntake`, which resolves the playbook the registry
 * currently approves. That is right at intake and wrong afterwards: a case runs
 * on the version it started on, and asking today's registry which step is the
 * synthesis would answer for a workflow this case is not following.
 *
 * `null` where the question has no answer — an unrouted kind, a playbook with
 * no entry carrying the accountable discipline, or two departments carrying it.
 * The third is not a tie to break: it means the workflow no longer says who
 * answers for the case, and picking one would invent an answer the playbook
 * declined to give.
 */
export function accountableEntryKeyFor(
  caseKind: string,
  playbook: CasePlaybook,
): string | null {
  const routing = CASE_INTAKE_POLICY.find((entry) => entry.caseKind === caseKind)
  if (!routing) return null

  const accountable = playbook.entries.filter(
    (entry) => entry.disciplineTag === routing.accountableDisciplineTag,
  )
  if (accountable.length !== 1) return null
  return accountable[0]!.key
}

export function resolveCaseIntake(
  caseKind: string,
  organization: Organization,
): ResolvedCaseIntake {
  const routing = CASE_INTAKE_POLICY.find((entry) => entry.caseKind === caseKind)
  if (!routing) throw new UnroutableCaseKindError(caseKind)

  /* Throws `UnsupportedCaseKindError` if no approved playbook covers the kind. */
  const approved = resolveForCaseKind(caseKind)
  const playbook = requirePlaybook(approved.playbookId, approved.version)

  const accountable = playbook.entries.filter(
    (entry) => entry.disciplineTag === routing.accountableDisciplineTag,
  )
  if (accountable.length === 0) {
    throw new IntakeRoutingUnsatisfiableError(
      caseKind,
      `playbook "${playbook.id}@${playbook.version}" has no entry tagged ` +
        `"${routing.accountableDisciplineTag}"`,
    )
  }
  /*
   * Two desks holding the accountable discipline is not a tie to break. It
   * means the workflow no longer says who answers for the case, and choosing
   * one here would invent an answer the playbook declined to give.
   */
  const departments = new Set(accountable.map((entry) => entry.departmentId))
  if (departments.size > 1) {
    throw new IntakeRoutingUnsatisfiableError(
      caseKind,
      `playbook "${playbook.id}@${playbook.version}" tags ${departments.size} ` +
        `departments as "${routing.accountableDisciplineTag}"`,
    )
  }

  const accountableDepartmentId = accountable[0]!.departmentId
  const department = organization.departments.find(
    (candidate) => candidate.id === accountableDepartmentId,
  )
  if (!department) {
    throw new IntakeRoutingUnsatisfiableError(
      caseKind,
      `the firm has no department "${accountableDepartmentId}"`,
    )
  }

  const manager = organization.employees.find(
    (employee) => employee.id === department.managerEmployeeId,
  )
  if (!manager) {
    throw new IntakeRoutingUnsatisfiableError(
      caseKind,
      `department "${accountableDepartmentId}" names manager ` +
        `"${department.managerEmployeeId}", who is not an employee`,
    )
  }

  return {
    policyVersion: CASE_INTAKE_POLICY_VERSION,
    caseKind,
    playbookId: playbook.id,
    playbookVersion: playbook.version,
    accountableDepartmentId,
    ownerEmployeeId: manager.id,
    onBehalfOfDepartmentId: accountableDepartmentId,
    participatingDepartmentIds: Object.freeze([accountableDepartmentId]),
  }
}

/**
 * A technical reference derived from what the Chairman called the subject.
 *
 * `CaseSubject.ref` is documented as "a canonical symbol, a sector code, a
 * country, a portfolio id" — an aspiration the codebase does not yet implement.
 * Measured on 2026-08-31: nothing resolves it, joins on it, dispatches on it or
 * validates it. Every consumer is persistence mapping, reconsideration-trigger
 * validation checks the rationale, policy version and comparator but never the
 * ref, and the only value in the database (`ecb`) belongs to no vocabulary.
 *
 * So it is treated as opaque, and derived deterministically from the display
 * name the Chairman actually typed. The same subject name always produces the
 * same ref, which is what makes it usable for grouping later.
 *
 * **When subject resolution becomes a real capability this must be replaced,
 * not extended.** A slug that starts meaning "the ECB policy path" is a
 * canonical identifier nobody minted, and two subjects whose names differ by
 * punctuation would silently become one.
 */
export function deriveSubjectRef(displayName: string): string {
  const slug = displayName
    .normalize('NFD')
    /* Strip combining marks so "statsräntor" and "statsrantor" do not diverge. */
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) {
    throw new Error(
      'A subject needs a name that survives normalisation. ' +
        `"${displayName}" reduces to nothing.`,
    )
  }
  return slug
}
