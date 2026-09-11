/**
 * Work queues and assignments.
 *
 * A department owns a queue. An assignment is a piece of a case given to a
 * department, and it is what makes "who is working on what, and who is waiting
 * for whom" answerable directly rather than inferred from run history.
 *
 * `waiting-on` is the field that earns its place here. Real analysis stalls
 * because one desk needs something from another — equity research waiting on a
 * macro view, the fact checker waiting on a source. Without it, a blocked
 * assignment looks identical to a slow one, and the headquarters cannot show
 * who is holding whom up.
 */

import type { CaseId } from './cases'
import type { DepartmentId, EmployeeId } from './organization'

export type AssignmentId = string

export type AssignmentStatus =
  | 'queued'
  /** Picked up and being worked. */
  | 'active'
  /** Cannot proceed until another assignment or a piece of evidence lands. */
  | 'waiting'
  /** Work submitted, awaiting review by a governance department or a manager. */
  | 'submitted'
  /** Reviewed and sent back with required corrections. */
  | 'returned'
  | 'completed'
  /**
   * The department tried and its run failed non-retryably.
   *
   * Distinct from `cancelled`, which means the organization withdrew the work.
   * A desk that attempted something and could not finish it is a different
   * institutional fact from one that was told to stop, and collapsing them
   * would hide provider trouble behind a managerial decision nobody made.
   */
  | 'failed'
  | 'cancelled'

/**
 * Open statuses occupy a queue; the rest do not.
 *
 * `failed` is deliberately NOT open. The desk is not working on it and has no
 * further move to make on its own — it is a blocker for a manager, and it
 * surfaces through case health and eligibility rather than by inflating a
 * department's workload with work nobody is doing.
 */
export const OPEN_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'queued',
  'active',
  'waiting',
  'submitted',
  'returned',
] as const

export interface Assignment {
  id: AssignmentId
  caseId: CaseId
  /**
   * The playbook entry this assignment came from, when it came from one.
   *
   * Absent for ad-hoc work, which is legitimate and common — a manager asks a
   * department for something the playbook did not anticipate. Present for
   * playbook-created work, where it is half of the identity that makes opening
   * a case idempotent: a retried command must not give a department the same
   * work twice, and `(caseId, playbookEntryKey)` is what says it is the same
   * work.
   *
   * The distinction is deliberate rather than incidental. Without it, "one
   * assignment per case per playbook entry" is a rule the store can enforce
   * and the domain cannot express — which is how it came to be enforced by a
   * unique index that nothing could ever trigger.
   */
  playbookEntryKey?: string
  /** The department that owes the work. */
  departmentId: DepartmentId
  /** Set once someone picks it up. */
  assigneeEmployeeId?: EmployeeId
  /** The institutional agent that picked the work up, where one did. */
  assigneeAgentPrincipalId?: string
  /** What this department is being asked for, in its own discipline's terms. */
  brief: string
  status: AssignmentStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  /**
   * What this assignment is waiting for. Required when `status` is `waiting`.
   *
   * Either another assignment (a department waiting on a department) or a
   * described gap (waiting on evidence that does not exist yet).
   */
  waitingOn?:
    | { kind: 'assignment'; assignmentId: AssignmentId }
    | { kind: 'evidence'; evidenceSought: string }
  /** Why it came back. Required when `status` is `returned`. */
  returnedReason?: string
  /** Higher runs first within a department's queue. */
  priority: number
}

export function buildAssignment(assignment: Assignment): Assignment {
  if (assignment.status === 'waiting' && !assignment.waitingOn) {
    throw new Error(
      `Assignment "${assignment.id}" is waiting but does not say on what — ` +
        `an unexplained wait is indistinguishable from a stall`,
    )
  }
  if (assignment.status === 'returned' && !assignment.returnedReason) {
    throw new Error(`Assignment "${assignment.id}" was returned without a reason`)
  }
  if (assignment.playbookEntryKey !== undefined && !assignment.playbookEntryKey.trim()) {
    throw new Error(
      `Assignment "${assignment.id}" carries a blank playbook entry key. Omit it ` +
        `for ad-hoc work rather than recording an empty one — an empty key would ` +
        `collide with every other empty key on the case.`,
    )
  }
  return Object.freeze({ ...assignment })
}

/**
 * The identity that makes a playbook-created assignment idempotent.
 *
 * `null` for ad-hoc work, which has no derivable identity — several ad-hoc
 * assignments on one case are legitimate, so they are distinguished only by
 * their own ids.
 */
export function playbookAssignmentIdentity(assignment: Assignment): string | null {
  return assignment.playbookEntryKey
    ? `${assignment.caseId}|${assignment.playbookEntryKey}`
    : null
}

export function isOpen(assignment: Assignment): boolean {
  return OPEN_ASSIGNMENT_STATUSES.includes(assignment.status)
}

/**
 * A department's queue.
 *
 * A projection over assignments rather than a stored list, so a department's
 * workload cannot drift out of step with the assignments that constitute it.
 */
export interface WorkQueue {
  departmentId: DepartmentId
  assignments: readonly Assignment[]
}

export function workQueueFor(
  departmentId: DepartmentId,
  assignments: readonly Assignment[],
): WorkQueue {
  const mine = assignments
    .filter((a) => a.departmentId === departmentId && isOpen(a))
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
  return { departmentId, assignments: Object.freeze(mine) }
}

/** Headline numbers for a department tile on the headquarters floor. */
export interface DepartmentWorkload {
  departmentId: DepartmentId
  queued: number
  active: number
  waiting: number
  submitted: number
  returned: number
}

export function workloadFor(queue: WorkQueue): DepartmentWorkload {
  const count = (status: AssignmentStatus) =>
    queue.assignments.filter((a) => a.status === status).length
  return {
    departmentId: queue.departmentId,
    queued: count('queued'),
    active: count('active'),
    waiting: count('waiting'),
    submitted: count('submitted'),
    returned: count('returned'),
  }
}

/** Why an assignment is waiting, structurally. */
export type WaitBasis =
  /** On another department's assignment, which is in the set. */
  | { kind: 'assignment'; blockedBy: Assignment }
  /** On an assignment that is not — a chain with a hole in it. */
  | { kind: 'missing-assignment'; assignmentId: AssignmentId }
  /** On evidence that does not exist yet, as whoever assigned it stated. */
  | { kind: 'evidence'; evidenceSought: string }

/**
 * Who is waiting on whom, across the whole firm.
 *
 * Answers the headquarters question "who is waiting for input" without the UI
 * traversing assignments itself.
 *
 * Returns structure, not sentences. It used to return a `description` reading
 * `waiting on ${departmentId}` — English, composed in the domain, on its way to
 * being rendered as headquarters activity. That is the one thing the activity
 * feed may not be built from: a sentence assembled here is indistinguishable,
 * downstream, from one an agent actually justified. The presentation layer
 * phrases these; the domain says which case it is.
 */
export function waitingChains(
  assignments: readonly Assignment[],
): Array<{ waiter: Assignment; basis: WaitBasis }> {
  const byId = new Map(assignments.map((a) => [a.id, a]))
  return assignments
    .filter((a) => a.status === 'waiting' && a.waitingOn)
    .map((waiter) => {
      const on = waiter.waitingOn!
      if (on.kind === 'evidence') {
        return {
          waiter,
          basis: { kind: 'evidence' as const, evidenceSought: on.evidenceSought },
        }
      }
      const blockedBy = byId.get(on.assignmentId)
      return {
        waiter,
        basis: blockedBy
          ? { kind: 'assignment' as const, blockedBy }
          : { kind: 'missing-assignment' as const, assignmentId: on.assignmentId },
      }
    })
}
