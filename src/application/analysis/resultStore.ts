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
import type { AgentClaim } from '~/domain/analysis'

/**
 * Everything that can change what an agent would produce.
 *
 * Nine components, and each is here because changing it alone changes the
 * output. `canonicalizationVersion` covers how we serialize evidence for
 * hashing: if that changes, two identical evidence sets could hash differently
 * and a stale result would look fresh. `agentImplementationVersion` covers the
 * code around the prompt — parsing, validation, retries — which can change the
 * result with the prompt untouched.
 */
export interface ResultKeyInputs {
  evidenceSetId: string
  promptId: string
  promptVersion: string
  promptContentHash: string
  modelId: string
  modelParametersHash: string
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
      inputs.departmentId,
      inputs.evidenceSetId,
      inputs.promptId,
      inputs.promptVersion,
      inputs.promptContentHash,
      inputs.modelId,
      inputs.modelParametersHash,
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
   */
  put(result: StoredResult): Promise<StoredResult>
}
