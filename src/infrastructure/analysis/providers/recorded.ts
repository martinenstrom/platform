/**
 * The recorded contribution provider.
 *
 * A replay of an immutable fixture: a fixed evidence set, fixed claims, fixed
 * confidence, a fixed output schema and the exact states the recording passed
 * through. It is not a mock returning whatever a test needs — it is a
 * deterministic replay of a shape a live provider would produce.
 *
 * The constraint that makes it worth having: **a recorded contribution goes
 * through the same validation, lifecycle, review and gating code a live one
 * will.** It cannot bypass claim validation, evidence resolution, the command
 * ledger, assignment state, governance gates or execution provenance, because
 * it enters through the same port and its output is written by the same
 * command.
 *
 * It declares `providerKind: 'recorded'` at the call site that starts the run,
 * and every row downstream carries that forward. A replay must never be
 * indistinguishable from work the firm stands behind.
 */

import { stableHashHex } from '~/domain/shared/hash'
import {
  executionIdentityKey,
  type AgentClaim,
  type ModelRef,
  type PromptRef,
  type RunState,
} from '~/domain/analysis'
import type {
  ContributionProvider,
  ContributionRequest,
  ContributionResult,
} from '~/application/analysis/contributionPort'
import { resultKey, type ResultKeyInputs } from '~/application/analysis/resultStore'

/** One immutable recorded contribution. */
export interface RecordedContribution {
  /** Which department's work this is a recording of. */
  departmentId: string
  /** The evidence set it was recorded against. Replay refuses a mismatch. */
  evidenceSetId: string
  agentContractVersion: string
  outputSchemaVersion: string
  /**
   * What produced the recording, where the artifact captured it.
   *
   * Omitted when it did not, which the replay reports as `unavailable` rather
   * than filling in — a recording that cannot say which model produced it is a
   * fact about the recording, not a blank to complete.
   */
  captured?: { prompt: PromptRef; model: ModelRef }
  claims: readonly AgentClaim[]
  /** The states the recording passed through, replayed in order. */
  observedStates: readonly RunState[]
  /**
   * What the ORIGINAL run consumed, where the artifact captured it.
   *
   * The replay itself spends nothing, so this defaults to `not-applicable`.
   * A captured measurement is kept because it is a true fact about the work
   * being replayed.
   */
  usage?: ContributionResult['usage']
}

export const RECORDED_PROVIDER_ID = 'recorded'

/**
 * Replays recorded contributions.
 *
 * Refuses a recording made against a different evidence set. Silently
 * replaying it would mean the determinism tests were passing against evidence
 * the recording never saw — the exact confusion the content-addressed key
 * exists to prevent.
 */
export function createRecordedContributionProvider(
  recordings: readonly RecordedContribution[],
  /** Which build of the replay this is. Recorded as the run's provenance. */
  version = '1',
): ContributionProvider {
  const byDepartment = new Map(recordings.map((r) => [r.departmentId, r]))

  const require_ = (departmentId: string): RecordedContribution => {
    const recording = byDepartment.get(departmentId)
    if (!recording) {
      throw new Error(`No recorded contribution for department "${departmentId}"`)
    }
    return recording
  }

  return {
    id: RECORDED_PROVIDER_ID,
    version,
    kind: 'recorded',

    /*
     * Read off the fixture, which is the only honest source: a recording was
     * made against one prompt, one model and one output schema, and replaying
     * it under any other version axis would attribute the recorded claims to a
     * question that was never asked.
     */
    declare(request: ContributionRequest) {
      const recording = require_(request.departmentId)
      return {
        agentContractVersion: recording.agentContractVersion,
        outputSchemaVersion: recording.outputSchemaVersion,
        identity: recording.captured
          ? { kind: 'model' as const, ...recording.captured }
          : {
              kind: 'unavailable' as const,
              reason: 'not-captured-by-recording' as const,
              recordingId: recordingId(recording),
            },
      }
    },

    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      const recording = require_(request.departmentId)
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
        agentContractVersion: recording.agentContractVersion,
        outputSchemaVersion: recording.outputSchemaVersion,
        usage: recording.usage ?? { state: 'not-applicable' },
        observedStates: recording.observedStates,
      }
    },
  }
}

/** Convenience: the key a recorded contribution would be stored under. */
export function keyForRecording(
  recording: RecordedContribution,
  extra: Pick<
    ResultKeyInputs,
    | 'caseId'
    | 'canonicalizationVersion'
    | 'agentImplementationVersion'
    | 'playbookVersion'
  >,
): string {
  return resultKey({
    evidenceSetId: recording.evidenceSetId,
    executionIdentity: executionIdentityKey(
      recording.captured
        ? { kind: 'model', ...recording.captured }
        : {
            kind: 'unavailable',
            reason: 'not-captured-by-recording',
            recordingId: recordingId(recording),
          },
    ),
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
