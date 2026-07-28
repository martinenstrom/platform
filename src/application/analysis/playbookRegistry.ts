/**
 * The one place a playbook is resolved.
 *
 * C1B let `InstantiatePlaybook` receive a whole `CasePlaybook` object. With one
 * compiled-in playbook that was a convenience; with two it becomes a routing
 * decision made at every call site, and with an untrusted caller it becomes a
 * way to run a case under a workflow the firm never approved.
 *
 * So commands take a stable identity — `(playbookId, version)` — and the
 * registry returns the immutable definition this build ships. Adding a second
 * playbook is a second entry in `COMPILED_PLAYBOOKS` plus a case-kind mapping,
 * with no conditional logic anywhere in a handler.
 *
 * The registry answers what workflow SHOULD apply. Which one a case is actually
 * running under is a different question, answered by the pin on the case, and
 * the two are deliberately not the same lookup: a case opened last month keeps
 * v1 even after v2 becomes the approved default.
 */

import { COMPILED_PLAYBOOKS } from './macroPlaybook'
import {
  playbookContentHash,
  validatePlaybook,
  type CasePlaybook,
  type PlaybookValidationContext,
} from './playbooks'

export class UnknownPlaybookError extends Error {
  constructor(
    readonly playbookId: string,
    readonly version: string,
  ) {
    super(
      `No playbook "${playbookId}" at version "${version}" is registered in this ` +
        `build. A case may only run under a workflow the firm ships.`,
    )
    this.name = 'UnknownPlaybookError'
  }
}

export class UnsupportedCaseKindError extends Error {
  constructor(readonly caseKind: string) {
    super(
      `No approved playbook covers case kind "${caseKind}". Add one to ` +
        `COMPILED_PLAYBOOKS rather than choosing a workflow at the call site.`,
    )
    this.name = 'UnsupportedCaseKindError'
  }
}

const byIdentity = new Map<string, CasePlaybook>(
  COMPILED_PLAYBOOKS.map((playbook) => [`${playbook.id}|${playbook.version}`, playbook]),
)

/**
 * The approved workflow for a kind of case.
 *
 * Where two versions of one playbook exist, the highest is the default for NEW
 * cases. Existing cases are unaffected: they carry their own pin.
 */
export function resolveForCaseKind(caseKind: string): {
  playbookId: string
  version: string
} {
  const candidates = COMPILED_PLAYBOOKS.filter(
    (playbook) => playbook.caseKind === caseKind,
  )
  if (candidates.length === 0) throw new UnsupportedCaseKindError(caseKind)

  const latest = [...candidates]
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
    .at(-1)!
  return { playbookId: latest.id, version: latest.version }
}

/** The immutable definition, or a loud failure. */
export function requirePlaybook(playbookId: string, version: string): CasePlaybook {
  const found = byIdentity.get(`${playbookId}|${version}`)
  if (!found) throw new UnknownPlaybookError(playbookId, version)
  return found
}

export function isRegistered(playbookId: string, version: string): boolean {
  return byIdentity.has(`${playbookId}|${version}`)
}

/** Content address of the registered definition, for registration and audit. */
export function registeredContentHash(playbookId: string, version: string): string {
  return playbookContentHash(requirePlaybook(playbookId, version))
}

/**
 * Every compiled-in playbook is structurally sound against the seeded firm.
 *
 * Called once at composition time rather than per command. A playbook that
 * names a department the firm does not have, or a rule version that no longer
 * exists, is a build problem — and finding it when the first case tries to use
 * it means finding it in front of a user.
 */
export function validateRegistry(context: PlaybookValidationContext): void {
  for (const playbook of COMPILED_PLAYBOOKS) {
    validatePlaybook(playbook, context)
  }
}

export function registeredPlaybooks(): readonly CasePlaybook[] {
  return COMPILED_PLAYBOOKS
}
