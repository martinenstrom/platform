/**
 * Prepare a meeting: the briefing the domain assembles over the client's
 * facts, read once and handed to the surface.
 */

import { meetingPreparation, type ClientId, type MeetingPrep } from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import type { AdvisoryContext } from './ports'

export async function prepareMeeting(
  context: AdvisoryContext,
  clientId: ClientId,
): Promise<MeetingPrep | null> {
  const facts = await assembleClientFacts(context, clientId)
  if (!facts) return null
  return meetingPreparation(facts)
}
