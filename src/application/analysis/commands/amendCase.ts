/**
 * The person adds to a case that is already open.
 *
 * "Ta hänsyn till dollarn också." The committee was convened on a question;
 * the person who put it has something more to say about it. That is neither
 * a new question nor evidence nor a revision of the thesis — it is the
 * asker's own words, added to the asker's own case — and until now the firm
 * had no act for it (TD-94). A remark that stayed in a voice session's
 * conversation was not on the record; a remark silently written into the
 * question would have been an edit of the one column the storage grants
 * refuse to let the application touch.
 *
 * ## What it is
 *
 * An append-only record beside the question: who added what, when, and at
 * which version of the case. The version is the provenance a reader needs to
 * tell which work was done before the addition and which after — the desks'
 * runs carry their own timestamps, so "the Rates analysis predates the
 * dollar remark" is a fact of the record rather than a guess.
 *
 * ## What it is not
 *
 * It moves no stage, starts no work and revises nothing. Whether the desks
 * must look again because of it is a later institutional act with its own
 * mandate; this one records that the person said it. A host reads the
 * additions back and says, truthfully, that work may predate them.
 *
 * ## Who may
 *
 * The same authority that could convene the committee on this case — the
 * convenor, or the owning desk's manager under the pre-existing rule. Adding
 * to the question is the asker's act, and the firm's name for "the one who
 * may put a question to the committee" is that mandate. As with convening,
 * the department is named by the caller and checked here against the case's
 * actual owner, so a manager cannot add to a case owned elsewhere.
 *
 * ## No reason, no version
 *
 * `reasonPolicy: 'forbidden'` — the addition IS the person's words; a second
 * free-text field beside it would be a reason for the reason. And
 * `refuses-expected-version`: nothing on the case aggregate moves, so a
 * version check would promise concurrency protection over nothing.
 */

import type { CaseAmendment, Organization } from '~/domain/analysis'
import { isTerminal } from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'

export interface AmendCaseInput {
  caseId: string
  /** Minted by the caller, stable across a retry. The addition's own identity. */
  amendmentId: string
  /** The person's words, as given. */
  text: string
  /** Checked against the case owner's department inside `execute`. */
  onBehalfOfDepartmentId: string
}

export function amendCase(
  organization: Organization,
): CommandDefinition<AmendCaseInput, CaseAmendment> {
  return {
    type: 'AmendCase',
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'forbidden',
    category: 'workflow',
    mandate: (input) => ({
      kind: 'investment-committee-convenor',
      owningDepartmentId: input.onBehalfOfDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      amendmentId: input.amendmentId,
      text: input.text,
      onBehalfOfDepartmentId: input.onBehalfOfDepartmentId,
    }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) {
        reject('not-found', `Case "${input.caseId}" does not exist`)
      }

      const owner = organization.employees.find(
        (employee) => employee.id === investmentCase.ownerEmployeeId,
      )
      if (!owner || owner.departmentId !== input.onBehalfOfDepartmentId) {
        reject(
          'not-authorised',
          `Case "${input.caseId}" is owned by ${owner?.departmentId ?? 'nobody'}, ` +
            `not by "${input.onBehalfOfDepartmentId}". Adding to a question is ` +
            `the asker's act, on the asker's own case.`,
        )
      }

      const accountable = context.actor.employeeId
      const actingDepartment = context.actor.departmentId
      if (accountable === null || actingDepartment === null) {
        reject(
          'unknown-actor',
          'An addition must name the person who made it. Words do not enter ' +
            'a case from nobody.',
        )
      }

      if (isTerminal(investmentCase.stage) || investmentCase.closedAt) {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage}. Nothing is added ` +
            `to a case the firm has settled or closed; that is a new question.`,
        )
      }

      if (!input.text.trim()) {
        reject('invariant-violated', 'An addition must say something.')
      }

      const saved = await repositories.amendments.append({
        id: input.amendmentId,
        caseId: input.caseId,
        text: input.text.trim(),
        byEmployeeId: accountable,
        byDepartmentId: actingDepartment,
        at: context.occurredAt,
        caseVersion: investmentCase.version,
      })

      return { value: saved, resultKind: 'case-amendment', resultRef: saved.id }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.amendments.get(resultRef)
      if (!found) {
        throw new Error(
          `Addition "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
