/**
 * The correction round — who corrects what, and how many times the firm
 * corrects on its own (TD-99, ruled 2026-09-22).
 *
 * Verification files a verdict that demands corrections on revision N. The
 * findings are immutable; the revision is not edited. The institution then
 * decides — from provenance, never from anyone's choice — whose work each
 * finding is about, that owner does targeted correction work, the Research
 * Office synthesises a successor revision N+1, and governance examines the
 * successor afresh.
 *
 * **Ownership follows provenance.** A finding names a claim; the claim was
 * produced by exactly one accepted run; the run belongs to a desk. A defect in
 * a specialist's claim is the specialist's to correct; a defect in a claim the
 * Research Office produced in its own synthesis is the office's; a citation
 * defect is corrected by whoever made the claim, because the reference is
 * theirs. A finding on a claim no accepted run produced is `unattributed`, and
 * the act that would return work refuses it — the record does not send work
 * back to nobody.
 *
 * **The bound.** The firm takes at most `MAX_AUTOMATIC_CORRECTION_ROUNDS`
 * correction rounds on its own; after that it stops visibly with what remains.
 * Rounds are counted off the lineage — a successor minted with cause
 * `correction` — so the count is a fact of the record, not a counter anyone
 * keeps. Neither JARVIS nor Verification corrects anything: the correcting
 * actor is always the owner the provenance names.
 */

import type { AgentRunRecord } from './contributions'
import type { EvidenceRef } from './identity'
import type { FindingSeverity, VerificationFinding, VerificationFindingKind, VerificationReview } from './review'
import type { InvestmentThesis } from './theses'

/** How many correction rounds the firm takes without a person (ruled 2026-09-22: one). */
export const MAX_AUTOMATIC_CORRECTION_ROUNDS = 1

/** One finding, as the owner is told it: the claim as they wrote it and what would clear the finding. */
export interface CorrectionFinding {
  claimId: string
  /** The claim's statement, from the record, so the owner sees what is contested. */
  statement: string
  kind: VerificationFindingKind
  detail: string
  severity: FindingSeverity
  /** What Verification said would clear it. Required on every blocking finding. */
  correctionRequired: string
  evidence?: EvidenceRef
}

/** The corrections one accepted run's owner owes. */
export interface CorrectionOwed {
  departmentId: string
  assignmentId: string
  /** The accepted run whose claims the findings are about. */
  runId: string
  findings: readonly CorrectionFinding[]
}

export interface CorrectionOwnership {
  owed: readonly CorrectionOwed[]
  /** Blocking findings on claims no accepted run produced. Never silently dropped. */
  unattributed: readonly VerificationFinding[]
}

/**
 * Who owes which correction, read off the verdict and the runs.
 *
 * Only blocking findings are corrections; an advisory finding is on the record
 * and asks nothing. A claim id is unique across the case, so a finding maps to
 * at most one run; only accepted (`completed`) runs count, because those are
 * the runs whose claims a revision can stand on. A run later marked obsolete —
 * replaced by its own correction — still produced the claim: provenance does
 * not move, so the ownership reads the same before and after the correction.
 */
export function correctionsOwed(
  review: VerificationReview,
  runs: readonly AgentRunRecord[],
): CorrectionOwnership {
  const accepted = runs.filter((run) => run.state === 'completed')
  const byRun = new Map<string, { run: AgentRunRecord; findings: CorrectionFinding[] }>()
  const unattributed: VerificationFinding[] = []

  for (const finding of review.findings) {
    if (!finding.blocking) continue
    const run = accepted.find((candidate) => candidate.claims.some((claim) => claim.id === finding.claimId))
    const claim = run?.claims.find((candidate) => candidate.id === finding.claimId)
    if (!run || !claim) {
      unattributed.push(finding)
      continue
    }
    const entry = byRun.get(run.id) ?? { run, findings: [] }
    entry.findings.push({
      claimId: finding.claimId,
      statement: claim.statement,
      kind: finding.kind,
      detail: finding.detail,
      severity: finding.severity,
      /* `buildVerificationFinding` refuses a blocking finding without one; the fallback is never reached on a filed review. */
      correctionRequired: finding.correctionRequired ?? finding.detail,
      ...(finding.evidence ? { evidence: finding.evidence } : {}),
    })
    byRun.set(run.id, entry)
  }

  return Object.freeze({
    owed: Object.freeze(
      [...byRun.values()].map(({ run, findings }) =>
        Object.freeze({
          departmentId: run.departmentId,
          assignmentId: run.assignmentId,
          runId: run.id,
          findings: Object.freeze(findings),
        }),
      ),
    ),
    unattributed: Object.freeze(unattributed),
  })
}

/** The corrections one desk owes under an ownership, flattened. Empty when it owes none. */
export function correctionsOwedBy(
  ownership: CorrectionOwnership,
  departmentId: string,
): readonly CorrectionFinding[] {
  return ownership.owed
    .filter((owed) => owed.departmentId === departmentId)
    .flatMap((owed) => owed.findings)
}

/**
 * How many correction rounds this lineage has taken: one per successor minted
 * with cause `correction`. Read off the revisions, so a replayed or resumed
 * process counts what happened rather than what it remembers.
 */
export function correctionRoundsTaken(
  revisions: readonly InvestmentThesis[],
  thesisId?: string,
): number {
  const lineage = thesisId ? revisions.filter((revision) => revision.thesisId === thesisId) : revisions
  return lineage.filter((revision) => revision.revisionCause === 'correction').length
}

/** Whether the firm may still correct on its own, under the ruled bound. */
export function automaticCorrectionPermitted(roundsTaken: number): boolean {
  return roundsTaken < MAX_AUTOMATIC_CORRECTION_ROUNDS
}
