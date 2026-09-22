/**
 * What the firm knows, assembled for a desk about to synthesise.
 *
 * A synthesis is a judgement over institutional facts. The judgement is the
 * model's; the facts are not, and this is the line between them.
 *
 * The model is given the question, the argument on the table, and each accepted
 * contribution with its claim ids. What it may NOT be asked to supply is which
 * run a claim came from, which playbook entry was required, or whether an
 * optional desk contributed — those are recorded facts, and a producer that
 * stated them would be stating the record rather than reading it. They are read
 * here and assembled around the model's answer.
 *
 * Derived every time from the pinned playbook, the case's runs and its
 * assignments. Nothing is stored: a second copy of "what the office was given"
 * is a second thing that can disagree with the record.
 */

import type { AgentRunRecord, Assignment, InquiryKind, InvestmentThesis } from '~/domain/analysis'
import type { CasePlaybook } from './playbooks'

/** One accepted contribution the synthesis may reason over. */
export interface SynthesisInput {
  playbookEntryKey: string
  departmentId: string
  runId: string
  requirement: 'required' | 'optional' | 'conditional'
  claimIds: readonly string[]
}

/** An optional perspective the firm declared and did not receive. */
export interface AbsentOptionalInput {
  playbookEntryKey: string
  departmentId: string
}

export interface SynthesisContext {
  caseId: string
  question: string
  /** The kind of question, read off the opening revision: it decides what the synthesis may be. */
  inquiry: InquiryKind
  /** The argument being reconciled. */
  revisionId: string
  currentStatement: string
  currentPosition: string
  inputs: readonly SynthesisInput[]
  absentOptionalInputs: readonly AbsentOptionalInput[]
}

export interface SynthesisContextInput {
  caseId: string
  question: string
  inquiry: InquiryKind
  playbook: CasePlaybook
  /** The entry doing the synthesising. Its edges decide what is in view. */
  entryKey: string
  revision: InvestmentThesis
  assignments: readonly Assignment[]
  runs: readonly AgentRunRecord[]
}

/**
 * The contributions in view, and the perspectives that are missing.
 *
 * "In view" means the entry's declared edges — blocking dependencies and
 * declared optional inputs — never everything the case happens to hold. The
 * same rule the orchestrator applies when it builds a provider's inputs, and
 * for the same reason: a synthesis that silently reasoned over an undeclared
 * desk's work would be answering a question the playbook did not ask.
 */
export function synthesisContext(input: SynthesisContextInput): SynthesisContext {
  const entry = input.playbook.entries.find(
    (candidate) => candidate.key === input.entryKey,
  )
  if (!entry) {
    throw new Error(
      `Playbook "${input.playbook.id}@${input.playbook.version}" has no entry ` +
        `"${input.entryKey}", so there is nothing to synthesise from.`,
    )
  }

  const inView = [...entry.blockedBy, ...entry.optionalInputs]
  const byKey = new Map(input.playbook.entries.map((e) => [e.key, e]))
  const assignmentByKey = new Map(
    input.assignments.map((assignment) => [assignment.playbookEntryKey, assignment]),
  )

  const inputs: SynthesisInput[] = []
  const absentOptionalInputs: AbsentOptionalInput[] = []

  for (const key of inView) {
    const declared = byKey.get(key)
    if (!declared) continue

    const assignment = assignmentByKey.get(key)
    /*
     * Accepted, not merely finished. A run reaches `completed` only when a
     * principal adopted it, and produced work satisfies nothing — which is the
     * same rule `unmetRequiredWork` applies, stated once more here because a
     * synthesis reasoning over unaccepted work would be citing what the firm
     * has not taken.
     */
    const accepted = assignment
      ? input.runs.find(
          (run) => run.assignmentId === assignment.id && run.state === 'completed',
        )
      : undefined

    if (!accepted) {
      /*
       * A missing BLOCKING dependency is not recorded as an absence — it is a
       * state the synthesis should never have been reached in, and the
       * aggregation command refuses it by name. Only a declared optional
       * perspective can be legitimately absent.
       */
      if (entry.optionalInputs.includes(key)) {
        absentOptionalInputs.push({
          playbookEntryKey: key,
          departmentId: declared.departmentId,
        })
      }
      continue
    }

    inputs.push({
      playbookEntryKey: key,
      departmentId: declared.departmentId,
      runId: accepted.id,
      requirement: declared.requirement,
      claimIds: accepted.claims.map((claim) => claim.id),
    })
  }

  return {
    caseId: input.caseId,
    question: input.question,
    inquiry: input.inquiry,
    revisionId: input.revision.revisionId,
    currentStatement: input.revision.statement,
    currentPosition: input.revision.position,
    inputs,
    absentOptionalInputs,
  }
}
