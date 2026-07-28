/**
 * What makes two write-once records the same record.
 *
 * The Stage 2 review found the two adapters disagreeing here: PostgreSQL threw
 * `ConflictingRecordError` for a claim whose statement had changed, and the
 * in-memory store — the authoritative one for reads until stage 5 — returned
 * the stored claim and said nothing. The rule had been implemented once and
 * approved twice.
 *
 * So the rule lives here, in one place, and both adapters call it:
 *
 *   identical semantic content  ->  return the stored record
 *   same identity, different    ->  ConflictingRecordError
 *
 * ## Why a normalized key rather than deep equality
 *
 * PostgreSQL returns collections in the order its `ORDER BY` specifies, which
 * is rarely the order the caller passed. Comparing the two directly would
 * report a conflict every time a caller listed two evidence refs in the other
 * order — a false alarm on a path whose whole purpose is to distinguish a
 * replay from a fault. Each key therefore sorts its collections before
 * hashing, so the comparison is about content and not about sequence.
 *
 * Fields that are genuinely incidental are excluded and said to be excluded.
 */

import { canonicalJson } from '~/domain/analysis'
import type {
  AgentClaim,
  CaseDecision,
  EvidenceSet,
  RunEvent,
  TransitionEvent,
} from '~/domain/analysis'
import type { StoredResult } from './resultStore'

const sorted = (values: readonly string[]) => [...values].sort()

/**
 * A claim, minus nothing.
 *
 * Everything about a claim is semantic: its statement, its confidence, what it
 * cites and what it contests. A claim is cited by theses and contested by
 * challenges, so a change to any of it changes what those citations mean.
 */
export function claimSemanticKey(claim: AgentClaim): string {
  return canonicalJson({
    id: claim.id,
    type: claim.type,
    statement: claim.statement,
    status: claim.status,
    confidence: {
      level: claim.confidence.level,
      cappedBy: claim.confidence.cappedBy ?? null,
      basis: sorted(claim.confidence.basis),
    },
    temporalScope: claim.temporalScope,
    contests: claim.contests ?? null,
    supportsThesisId: claim.supportsThesisId ?? null,
    opposesThesisId: claim.opposesThesisId ?? null,
    attribution: claim.type === 'causal' ? claim.attribution : null,
    evidence: sorted(
      claim.evidenceRefs.map(
        (ref) => `${ref.setId}|${ref.observationId}|${ref.contentHash}`,
      ),
    ),
    contradicting: sorted(
      claim.contradictingEvidenceRefs.map(
        (ref) => `${ref.setId}|${ref.observationId}|${ref.contentHash}`,
      ),
    ),
  })
}

/**
 * An evidence set, **including its payloads**.
 *
 * The set's id hashes `[observationId, contentHash]` per item — its
 * composition — so two sets sharing an id necessarily cite the same
 * observations at the same content hashes. It does **not** cover the stored
 * values, so a set whose payloads differ can still present the same id. That
 * gap was recorded as TD-25; comparing payloads here closes it on the write
 * path, where a mismatch means one of the two writers is wrong.
 *
 * `assembledAt` and `correlationId` are excluded: the same evidence assembled
 * twice by two resolution runs is the same evidence.
 */
export function evidenceSetSemanticKey(set: EvidenceSet): string {
  return canonicalJson({
    id: set.id,
    items: [...set.items]
      .map((item) =>
        canonicalJson({
          id: item.ref.id,
          contentHash: item.ref.contentHash,
          value: item.value,
        }),
      )
      .sort(),
  })
}

/**
 * A stored agent result.
 *
 * `storedAt` is excluded — when it was written is not what it says. `inputs`
 * is included even though the key is derived from it: a mismatch there means
 * the key derivation and the recorded inputs disagree, which is worth hearing
 * about immediately.
 */
export function resultSemanticKey(result: StoredResult): string {
  return canonicalJson({
    key: result.key,
    claims: result.claims.map(claimSemanticKey).sort(),
    inputs: result.inputs,
  })
}

/** A committed decision. All of it — this is the record that matters most. */
export function decisionSemanticKey(decision: CaseDecision): string {
  return canonicalJson({
    caseId: decision.caseId,
    aggregateVersion: decision.aggregateVersion,
    decidedAt: decision.decidedAt,
    decidedByEmployeeId: decision.decidedByEmployeeId,
    selectedRevisionId: decision.selectedRevisionId,
    notSelected: sorted(decision.notSelectedRevisionIds),
    rejected: sorted(decision.rejectedRevisionIds),
    evidenceSetId: decision.evidenceSetId,
    governance: decision.governance,
    rationale: decision.rationale,
    unresolvedDissent: sorted(decision.unresolvedDissent),
    reconsiderationTriggers: sorted(decision.reconsiderationTriggers),
  })
}

/** An appended transition event. Identity is `eventId`; everything else is content. */
export function transitionEventSemanticKey(event: TransitionEvent): string {
  return canonicalJson({ ...event })
}

/**
 * One recorded run state change.
 *
 * Identity is `(runId, at, state)` — a run cannot enter the same state at the
 * same instant twice, so a second one is a replay. `reason` is content: the
 * same transition recorded with a different reason is a disagreement, not a
 * retry.
 */
export function runEventIdentity(event: RunEvent): string {
  return `${event.runId}|${event.at}|${event.state}`
}

export function runEventSemanticKey(event: RunEvent): string {
  return canonicalJson({
    runId: event.runId,
    at: event.at,
    state: event.state,
    reason: event.reason ?? null,
  })
}
