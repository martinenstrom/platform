/**
 * A promise kept. The commitment is closed with the date it was completed;
 * its provenance — which note it came from — stays with it.
 */

import { todayOf, type AdvisoryContext } from './ports'

export type CompleteCommitmentResult =
  { ok: true } | { ok: false; code: 'NOT_FOUND' | 'NOT_OPEN' }

export async function completeCommitment(
  context: AdvisoryContext,
  commitmentId: string,
): Promise<CompleteCommitmentResult> {
  const commitment = await context.repositories.commitments.commitmentById(commitmentId)
  if (!commitment) return { ok: false, code: 'NOT_FOUND' }
  if (commitment.status !== 'open') return { ok: false, code: 'NOT_OPEN' }
  await context.repositories.commitments.saveCommitment({
    ...commitment,
    status: 'done',
    completedAt: todayOf(context),
  })
  return { ok: true }
}
