/**
 * The assembly act: who declared a body of evidence fit for analysis, and by
 * what rule.
 *
 * Ingestion records what a source said; assembly chooses what a desk may reason
 * over. The second determines the ceiling on every claim the firm can make from
 * the set — `citeFrom` refuses anything outside it, `composeConfidence` is
 * bounded by its properties — so it carries an actor, a mandate, a command
 * identity and a ledger entry (`phase-c3-evidence-gate.md` §0.3).
 *
 * ## Why the rule is stored and not just the membership
 *
 * Membership answers *what the firm reasoned over*. Only the recorded selection
 * rule answers *why those observations and not others*. A reviewer who can see
 * what was included and cannot tell whether anything was left out is holding an
 * auditable set that is still indefensible.
 *
 * ## Why this is keyed by the ACT and not by the set
 *
 * An `EvidenceSet` id is a content hash of its membership. Two selections that
 * happen to select the same observations are therefore one set — the artifact
 * is the same artifact — but they are two acts, by possibly two people, under
 * possibly two rules. Keying the record on the set id would force one of those
 * acts to overwrite the other or to be dropped, and neither is true. So the
 * assembly is its own append-only record pointing AT the set, and a set may be
 * reached by more than one of them.
 *
 * A pre-C3 set is reached by none, which is the honest answer for a set nobody
 * assembled through this act. Nothing manufactures a selection for it — the
 * same refusal §0.3b makes about backfilled knowledge time.
 */

import type { CanonicalValue } from '~/domain/shared/canonicalValue'

/**
 * The versioned selection rule that produced a set.
 *
 * The **id carries the version**, exactly as `spread-2s10s@1` does, and for the
 * same reason: a change to what the rule selects is a new rule rather than a
 * silent restatement of sets already assembled under the old one. A reader
 * years later resolves `sovereign-yield-curve@1` to the semantics that ran.
 */
export interface EvidenceSelection {
  /** e.g. `sovereign-yield-curve@1`. Version included, never implied. */
  ruleId: string
  /**
   * The family the rule expands into concrete series.
   *
   * A family, never a list of observation ids. That constraint is load-bearing
   * (§0.3): an assembler who names individual observations can drop the
   * inconvenient source and the disagreement machinery would never see it.
   */
  subjectFamily: string
  /** Inclusive lower bound on the reference period. */
  from: string
  /** Inclusive upper bound on the reference period. */
  to: string
  /**
   * What the institution knew when it selected — resolved, never absent.
   *
   * A caller may name an earlier instant to assemble *as the firm knew it then*;
   * where none is named this is the assembly instant itself. It is stored
   * either way, because "latest known" is only reproducible if the moment that
   * phrase referred to is written down.
   */
  knownAt: string
}

/**
 * One recorded assembly. Append-only, like every other institutional record.
 *
 * There is deliberately no transition event beside it. `TransitionEvent`
 * requires a `caseId` — it is the CASE timeline — and an evidence set belongs to
 * the firm rather than to a case. Inventing a case to carry the event would
 * fabricate a coordinate the act does not have, which is the same thing §0.3b
 * refuses about knowledge time. The ledger entry every command writes, plus
 * this record, are what the act leaves behind.
 */
export interface EvidenceAssembly {
  /** Derived from the command id, so a retry addresses the same record. */
  assemblyId: string
  /** The set this act produced. */
  evidenceSetId: string
  selection: EvidenceSelection
  /** What the rule expanded the family into, as it ran. */
  selectedSubjects: readonly string[]
  /** Observation ids the query returned, before derivation. */
  observationCount: number
  /** Derived observations this act computed and recorded. */
  derivedCount: number
  assembledAt: string
  /** The person who declared this body of evidence fit for analysis. */
  actorEmployeeId: string
  /** On whose authority. The mandate the command was granted. */
  onBehalfOfDepartmentId: string
  correlationId: string
}

/**
 * The selection as an identity input.
 *
 * Used by the command's payload hash, so two assemblies asking for the same
 * thing are one command and a retry is not mistaken for a new act.
 */
export function selectionPayload(selection: EvidenceSelection): CanonicalValue {
  return {
    ruleId: selection.ruleId,
    subjectFamily: selection.subjectFamily,
    from: selection.from,
    to: selection.to,
    knownAt: selection.knownAt,
  }
}

/**
 * Whether two records describe the same act.
 *
 * Everything that determines what was assembled and on whose authority. Both
 * adapters use it to tell a benign replay — the same command retried — from two
 * different judgements filed under one identity, which is a disagreement rather
 * than a retry and must be reported.
 *
 * `assembledAt` counts: the same rule run at two instants over a growing store
 * is two different acts, however similar the two records look.
 */
export function sameAssemblyAct(a: EvidenceAssembly, b: EvidenceAssembly): boolean {
  return (
    a.evidenceSetId === b.evidenceSetId &&
    a.selection.ruleId === b.selection.ruleId &&
    a.selection.subjectFamily === b.selection.subjectFamily &&
    a.selection.from === b.selection.from &&
    a.selection.to === b.selection.to &&
    a.selection.knownAt === b.selection.knownAt &&
    a.assembledAt === b.assembledAt &&
    a.actorEmployeeId === b.actorEmployeeId &&
    a.onBehalfOfDepartmentId === b.onBehalfOfDepartmentId &&
    a.selectedSubjects.join('|') === b.selectedSubjects.join('|')
  )
}
