/**
 * Contribution providers for Phase B. Neither is a model.
 *
 * The constraint that makes them worth having: **they go through the same
 * validation, lifecycle, review and gating code a live provider will.** A
 * fixture path that skipped checks would prove nothing about the real path,
 * and the runtime would be tested against a version of itself that never
 * ships.
 *
 * A recorded contribution is an immutable fixture stating exactly what it is —
 * provider identity, contract version, the evidence set it was recorded
 * against, the claims it yields and the states it passes through. It is not a
 * mock returning whatever the test needs; it is a replay of a shape a live
 * provider would produce.
 */

import { stableHashHex } from '~/domain/shared/hash'
import type { AgentClaim, ModelRef, PromptRef, RunState } from '~/domain/analysis'
import type {
  ContributionProvider,
  ContributionRequest,
  ContributionResult,
} from '~/application/analysis/contributionPort'
import {
  resultKey,
  type ResultKeyInputs,
  type ResultStore,
  type StoredResult,
} from '~/application/analysis/resultStore'

/** One immutable recorded contribution. */
export interface RecordedContribution {
  /** Which department's work this is a recording of. */
  departmentId: string
  /** The evidence set it was recorded against. Replay refuses a mismatch. */
  evidenceSetId: string
  agentContractVersion: string
  outputSchemaVersion: string
  prompt: PromptRef
  model: ModelRef
  claims: readonly AgentClaim[]
  /** The states the recording passed through, replayed in order. */
  observedStates: readonly RunState[]
  /** Present where the recording captured usage. `null` when unmeasured. */
  usage: ContributionResult['usage']
}

export const RECORDED_PROVIDER_ID = 'recorded'
export const STUB_PROVIDER_ID = 'stub'

/**
 * Replays recorded contributions.
 *
 * Refuses a recording made against a different evidence set. Silently
 * replaying it would mean the runtime's determinism tests were passing
 * against evidence the recording never saw — the exact confusion the
 * content-addressed key exists to prevent.
 */
export function createRecordedContributionProvider(
  recordings: readonly RecordedContribution[],
): ContributionProvider {
  const byDepartment = new Map(recordings.map((r) => [r.departmentId, r]))

  return {
    id: RECORDED_PROVIDER_ID,
    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      const recording = byDepartment.get(request.departmentId)
      if (!recording) {
        throw new Error(
          `No recorded contribution for department "${request.departmentId}"`,
        )
      }
      if (recording.evidenceSetId !== request.evidenceSetId) {
        throw new Error(
          `Recording for "${request.departmentId}" was made against evidence ` +
            `set "${recording.evidenceSetId}", but the request supplies ` +
            `"${request.evidenceSetId}". Replaying it would attribute claims ` +
            `to evidence they never saw.`,
        )
      }
      if (request.signal.aborted) {
        throw new Error('contribution cancelled before it began')
      }

      return {
        claims: recording.claims,
        prompt: recording.prompt,
        model: recording.model,
        agentContractVersion: recording.agentContractVersion,
        outputSchemaVersion: recording.outputSchemaVersion,
        usage: recording.usage,
        observedStates: recording.observedStates,
      }
    },
  }
}

/**
 * A provider that produces nothing.
 *
 * For exercising orchestration shape — dependency ordering, blocking,
 * concurrency — without asserting on content. It returns zero claims rather
 * than plausible-looking ones, so a test that accidentally depends on stub
 * output fails loudly instead of passing on invented analysis.
 */
export function createStubContributionProvider(
  options: { failFor?: readonly string[]; hangFor?: readonly string[] } = {},
): ContributionProvider {
  const fail = new Set(options.failFor ?? [])
  const hang = new Set(options.hangFor ?? [])

  return {
    id: STUB_PROVIDER_ID,
    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      if (fail.has(request.departmentId)) {
        throw new Error(`stub failure for ${request.departmentId}`)
      }
      if (hang.has(request.departmentId)) {
        return new Promise<never>(() => {})
      }
      return {
        claims: [],
        prompt: { id: 'stub', version: '0', contentHash: 'stub' },
        model: {
          id: 'stub',
          provider: 'stub',
          parameters: {},
          parametersHash: 'stub',
        },
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        usage: null,
        observedStates: ['running', 'completed'],
      }
    },
  }
}

/* ----------------------------------------------------------- result store */

/**
 * In-memory result store.
 *
 * Exact key match only. There is deliberately no lookup that ignores part of
 * the key: no "most recent for this department", no nearest match. Every one
 * of those would eventually serve last week's reasoning against this week's
 * evidence.
 */
export function createInMemoryResultStore(): ResultStore {
  const results = new Map<string, StoredResult>()
  return {
    async get(key) {
      return results.get(key) ?? null
    },
    async put(result) {
      // Write-once. The key covers every semantic input, so a differing result
      // under the same key means something is wrong; overwriting would hide it.
      const existing = results.get(result.key)
      if (existing) return existing
      results.set(result.key, result)
      return result
    },
  }
}

/** Convenience: the key a recorded contribution would be stored under. */
export function keyForRecording(
  recording: RecordedContribution,
  extra: Pick<
    ResultKeyInputs,
    'canonicalizationVersion' | 'agentImplementationVersion' | 'playbookVersion'
  >,
): string {
  return resultKey({
    evidenceSetId: recording.evidenceSetId,
    promptId: recording.prompt.id,
    promptVersion: recording.prompt.version,
    promptContentHash: recording.prompt.contentHash,
    modelId: recording.model.id,
    modelParametersHash: recording.model.parametersHash,
    agentContractVersion: recording.agentContractVersion,
    outputSchemaVersion: recording.outputSchemaVersion,
    departmentId: recording.departmentId,
    ...extra,
  })
}

/** Stable id for a recording, used in fixtures and assertions. */
export function recordingId(recording: RecordedContribution): string {
  return stableHashHex(`${recording.departmentId}|${recording.evidenceSetId}`)
}
