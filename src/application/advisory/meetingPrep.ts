/**
 * Prepare a meeting: the briefing the domain assembles over the client's
 * facts, read once and handed to the surface — with the client-relevant
 * market changes since the previous meeting beside it, whether those moves
 * are still open or already history.
 */

import {
  lastMeeting,
  meetingPreparation,
  type ClientId,
  type MeetingPrep,
} from '~/domain/advisory'
import { assembleClientFacts } from './clientFacts'
import {
  marketChangesSince,
  marketLedger,
  marketWindowStart,
  type MarketChangeSince,
} from './marketImpact'
import type { AdvisoryContext } from './ports'

export interface MeetingPrepView extends MeetingPrep {
  /**
   * Market-to-Client: the moves that opened since the last meeting — or in
   * the standing window when no meeting is recorded — that the record is
   * exposed to or has context for, most relevant first. A move the client
   * has no exposure to or context for is not listed: the briefing is about
   * this client, not about the market. Closed moves are history: quoted at
   * their peak, contributing to no priority.
   */
  marketSinceLastMeeting: readonly MarketChangeSince[]
  /** ISO date the market window starts. */
  marketWindowStart: string
}

export async function prepareMeeting(
  context: AdvisoryContext,
  clientId: ClientId,
): Promise<MeetingPrepView | null> {
  const facts = await assembleClientFacts(context, clientId)
  if (!facts) return null
  const prep = meetingPreparation(facts)
  const ledger = await marketLedger(context)
  const since = marketWindowStart(lastMeeting(facts)?.date ?? null, facts.today)
  return {
    ...prep,
    marketSinceLastMeeting: marketChangesSince(ledger, facts, since),
    marketWindowStart: since,
  }
}
