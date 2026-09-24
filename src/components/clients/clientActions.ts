/**
 * What a client surface may ask the record to do.
 *
 * The route implements these over the server functions and re-reads the
 * page afterwards; a test implements them in memory. The surface itself
 * never knows which — it only knows the acts, each answered with the same
 * typed result the application returns.
 */

import type { AskAboutClientResult } from '~/application/advisory/askAboutClient'
import type { CompleteCommitmentResult } from '~/application/advisory/completeCommitment'
import type {
  ConfirmClientUpdateResult,
  ItemDecision,
} from '~/application/advisory/confirmClientUpdate'
import type { RecordClientUpdateResult } from '~/application/advisory/recordClientUpdate'
import type {
  Importance,
  InteractionSource,
  InteractionType,
  MeetingPrep,
} from '~/domain/advisory'

export interface RecordUpdateInput {
  noteText: string
  interactionDate: string
  interactionType: InteractionType | null
  source: InteractionSource
  importance: Importance
}

export type Unavailable = { ok: false; code: 'SERVICE_UNAVAILABLE' }

export interface ClientActions {
  recordUpdate(input: RecordUpdateInput): Promise<RecordClientUpdateResult | Unavailable>
  confirmUpdate(
    candidateId: string,
    decisions: readonly ItemDecision[],
  ): Promise<ConfirmClientUpdateResult | Unavailable>
  completeCommitment(
    commitmentId: string,
  ): Promise<CompleteCommitmentResult | Unavailable>
  ask(question: string): Promise<AskAboutClientResult | Unavailable>
  prepareMeeting(): Promise<
    | { ok: true; prep: MeetingPrep }
    | { ok: false; code: 'NOT_FOUND' | 'SERVICE_UNAVAILABLE' }
  >
}
