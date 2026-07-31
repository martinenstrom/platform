/**
 * Where the identity of a written record comes from.
 *
 * One mechanism, used by every command. C1B let callers supply
 * `creationEventId`, `eventIdPrefix` and `assignmentIdPrefix`, which was safe
 * only because one code path produced them. It stops being safe the moment a
 * command is reachable from a route: nothing constrained those strings, so two
 * cases could collide and the only protection was that nobody had tried.
 *
 * ## Why it derives from the command id
 *
 * A command id is already required to be stable across retries and unique
 * across commands — the ledger's primary key depends on both. Deriving record
 * identity from it inherits those two properties exactly, so a retry rewrites
 * the same rows and two commands cannot reach each other's.
 *
 * ## Why a hash rather than a readable composite
 *
 * `${commandId}:${type}:${entityId}` would be self-describing and unbounded —
 * text in a primary key that every child row references, growing with whatever
 * the longest id happens to be. Nothing is lost by hashing: the event row
 * already carries `subject`, `caseId`, `toState`, `occurredAt` and
 * `correlationId` as columns, which is where a reader actually looks. The id is
 * a key, not a description.
 *
 * Deterministic in the strict sense — no clock, no counter, no randomness — so
 * the same command produces the same ids after a restart, on another machine,
 * a year later.
 */

import { stableHashHex } from '~/domain/shared/hash'
import { canonicalJson } from '~/domain/analysis'

/** Long enough that collision is not a practical concern, short enough to read. */
const ID_LENGTH = 32

export interface DerivedIdentity {
  commandId: string
  /** What kind of record this is: `case-opened`, `run-started`, … */
  recordType: string
  /** The entity the record concerns. */
  entityId: string
  /**
   * Distinguishes several records of the SAME type for the SAME entity within
   * one command.
   *
   * Nothing needs it today — assignment events differ by entity — and it exists
   * so that the first command which does need one does not invent a second
   * scheme beside this one.
   */
  ordinal?: number
}

function derive(prefix: string, identity: DerivedIdentity): string {
  const digest = stableHashHex(
    canonicalJson({
      commandId: identity.commandId,
      recordType: identity.recordType,
      entityId: identity.entityId,
      ordinal: identity.ordinal ?? 0,
    }),
  )
  return `${prefix}-${digest.slice(0, ID_LENGTH)}`
}

/** The identity of a transition event a command emits. */
export function deriveEventId(identity: DerivedIdentity): string {
  return derive('evt', identity)
}

/** The identity of an assignment a command creates. */
export function deriveAssignmentId(commandId: string, playbookEntryKey: string): string {
  return derive('asg', {
    commandId,
    recordType: 'assignment',
    entityId: playbookEntryKey,
  })
}

/**
 * The identity of a run a command starts.
 *
 * One `StartAgentRun` starts one run, so the assignment is the entity. A retry
 * of the same command therefore addresses the same run rather than starting a
 * second one — which is the property the one-active-run index would otherwise
 * have to catch after the fact.
 */
export function deriveRunId(commandId: string, assignmentId: string): string {
  return derive('run', { commandId, recordType: 'run', entityId: assignmentId })
}

/**
 * The identity of a claim a contribution records.
 *
 * The provider names its own claims — it has to, because a counterclaim says
 * which claim it contests and a fixture is written before it is replayed. Those
 * names are local to one contribution and carry none of the guarantees a stored
 * identity needs: replay the same recording on two cases and both would assert
 * `claim-1`, which is either a collision or a silent merge depending on which
 * store you ask.
 *
 * So the provider's name is an INPUT to the identity rather than the identity.
 * `RecordContribution` translates every intra-contribution reference through
 * this same function, which keeps a counterclaim pointing at the claim it was
 * written to contest while making the stored ids unique per command and stable
 * across a retry.
 */
export function deriveClaimId(commandId: string, providerClaimId: string): string {
  return derive('clm', { commandId, recordType: 'claim', entityId: providerClaimId })
}
