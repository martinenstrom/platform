/**
 * Immutable, content-addressed storage for agent results.
 *
 * Deliberately **not** the market-data cache. The economics and the semantics
 * are different in the way that matters most:
 *
 *   market data   stale is useful — a Friday close on Monday is still the
 *                 Friday close, and serving it beats serving nothing
 *   agent output  stale is dangerous — last week's reasoning about last week's
 *                 evidence reads as current analysis, and nothing on the page
 *                 says otherwise
 *
 * So: exact key match only. No stale-while-revalidate, no "closest previous
 * analysis", no fallback of any kind. A stored result is reusable when every
 * semantic input matches and not one moment sooner.
 */

import { stableHashHex } from '~/domain/shared/hash'
import type { AgentClaim, ProviderKind } from '~/domain/analysis'
import type { StorageProvenance } from './repositories'

/**
 * How evidence is serialized for hashing.
 *
 * Part of the result key because it has to be: if canonicalization changes,
 * two identical evidence sets can hash differently, and a result stored under
 * the old scheme would look reusable under the new one. A constant rather than
 * a caller's argument, because there is one canonicalization at a time and a
 * caller free to name its own could store a result under a scheme that never
 * existed.
 */
export const CANONICALIZATION_VERSION = '1'

/**
 * Everything that can change what an agent would produce.
 *
 * Each is here because changing it alone changes the output. `canonicalizationVersion` covers how we serialize evidence for
 * hashing: if that changes, two identical evidence sets could hash differently
 * and a stale result would look fresh. `agentImplementationVersion` covers the
 * code around the prompt — parsing, validation, retries — which can change the
 * result with the prompt untouched.
 */
export interface ResultKeyInputs {
  /**
   * The case whose desk produced it.
   *
   * Part of the key because a stored result carries CLAIM RECORDS, and a claim
   * id belongs to one case's run — C1C-2 made those ids derive from the command
   * that stored them. Two cases reasoning over one evidence set would otherwise
   * collide under a single key with different claim ids, and the write-once
   * store would report a conflict that is not one.
   *
   * The cost is that reuse is per-case. Genuine cross-case reuse would have to
   * re-mint claim identities for the borrowing case rather than replay another
   * case's records, which is a larger change than a cache key — see TD-37.
   */
  caseId: string
  evidenceSetId: string
  /**
   * What produced it, canonicalized by `executionIdentityKey`.
   *
   * One field rather than five, because what identifies an execution depends
   * on what kind of thing ran: a prompt and a model for a live call, a
   * scenario and a build for a stub. Five model-shaped fields would force
   * every producer to have a model, which is the confusion the identity union
   * exists to end.
   */
  executionIdentity: string
  agentContractVersion: string
  outputSchemaVersion: string
  canonicalizationVersion: string
  agentImplementationVersion: string
  /** Included where the playbook changes what was asked for. */
  playbookVersion?: string
  departmentId: string
}

export function resultKey(inputs: ResultKeyInputs): string {
  return stableHashHex(
    [
      inputs.caseId,
      inputs.departmentId,
      inputs.evidenceSetId,
      inputs.executionIdentity,
      inputs.agentContractVersion,
      inputs.outputSchemaVersion,
      inputs.canonicalizationVersion,
      inputs.agentImplementationVersion,
      inputs.playbookVersion ?? '',
    ].join('|'),
  )
}

export interface StoredResult {
  key: string
  claims: readonly AgentClaim[]
  storedAt: string
  /**
   * What produced it.
   *
   * Carried on the result rather than only on the run, so a stored result is
   * traceable to its producer without joining back through a run that may
   * since have been superseded. Reused analysis is still analysis: the moment
   * a fixture replay and a live contribution become indistinguishable here,
   * every consumer downstream inherits the confusion.
   */
  providerKind: ProviderKind
  /** Kept so a stored result can be explained without recomputing the key. */
  inputs: ResultKeyInputs
}

export interface ResultStore {
  /** Exact match only. Never a nearest or most-recent result. */
  get(key: string): Promise<StoredResult | null>
  /**
   * Writes once. A second write under the same key is ignored rather than
   * overwriting: the key covers every semantic input, so a differing result
   * under the same key means something is wrong and silently replacing the
   * first would hide it.
   *
   * Takes provenance for the same reason `runs.save` does: the row records
   * which code wrote it, beside the `providerKind` that records what decided
   * its content.
   */
  put(result: StoredResult, provenance: StorageProvenance): Promise<StoredResult>
}
