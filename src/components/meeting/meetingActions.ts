/**
 * What the Meeting Cockpit may ask the record to do: the client update flow
 * it reuses for closing the meeting, and the meeting-scoped question. The
 * route implements these over the server functions; a test implements them
 * in memory.
 */

import type { AskBeforeMeetingResult } from '~/application/advisory/meetingCockpit'
import type { ClientActions, Unavailable } from '~/components/clients/clientActions'

export interface MeetingActions {
  /** The existing client update flow: record the note, confirm what JARVIS understood. */
  client: ClientActions
  askBeforeMeeting(question: string): Promise<AskBeforeMeetingResult | Unavailable>
}
