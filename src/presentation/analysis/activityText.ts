/**
 * Human-readable activity, generated from structured events.
 *
 * The wording lives here and nowhere else. The domain stores what happened —
 * event type, department, case, states, timestamp — and this turns it into a
 * sentence.
 *
 * That split is the integrity mechanism, not a style preference. If activity
 * text were a domain field, anything could write "Macro Team is studying the
 * Fed" with no work behind it, and the headquarters would look busy on demand.
 * Because the text is derived, a line can only appear when a run or a case
 * actually entered the state it describes.
 */

import type { ActivityItem } from '~/domain/analysis'

/** Department display names. Falls back to the id rather than inventing one. */
export type DepartmentNames = Readonly<Record<string, string>>

const RUN_STATE_TEXT: Readonly<Record<string, string>> = {
  queued: 'satte upp ett uppdrag',
  'waiting-for-dependencies': 'väntar på underlag',
  ready: 'är redo att börja',
  running: 'arbetar med ett uppdrag',
  /*
   * The desk has finished and the institution has not. Phrased as work handed
   * over rather than work completed, because nothing has entered the record: a
   * person has to accept it first, and a line reading "lämnade in sitt
   * underlag" here would be indistinguishable from the accepted case below.
   */
  'awaiting-acceptance': 'lämnade arbete för godkännande',
  /*
   * The code travels on the event, never the prose. What was wrong is written
   * for whoever tries to fix the work; the floor sees that the firm declined
   * it, which is the institutional fact.
   */
  rejected: 'fick sitt arbete avvisat',
  completed: 'lämnade in sitt underlag',
  failed: 'kunde inte slutföra uppdraget',
  'timed-out': 'hann inte slutföra uppdraget',
  cancelled: 'avbröt uppdraget',
  superseded: 'arbetade mot en ersatt tes',
  blocked: 'är blockerad av ett tidigare steg',
}

const CASE_STAGE_TEXT: Readonly<Record<string, string>> = {
  intake: 'tog emot ett ärende',
  research: 'inledde analysen',
  aggregation: 'sammanställer underlaget',
  review: 'skickade ärendet till granskning',
  returned: 'returnerade ärendet för komplettering',
  blocked: 'blockerade ärendet',
  decision: 'lyfte ärendet till investeringsbeslut',
  published: 'publicerade ärendet',
  withdrawn: 'avslutade ärendet utan publicering',
}

export interface ActivityLine {
  at: string
  departmentName: string
  text: string
  caseId: string
}

/**
 * Renders one line.
 *
 * An unrecognised state produces a plain factual fallback rather than being
 * dropped: an event that happened should appear on the feed even if nobody has
 * written wording for it yet, and silence would be the wrong failure.
 */
export function toActivityLine(
  item: ActivityItem,
  names: DepartmentNames = {},
): ActivityLine {
  const departmentName = names[item.departmentId] ?? item.departmentId
  const table = item.subject === 'run' ? RUN_STATE_TEXT : CASE_STAGE_TEXT
  const text = table[item.toState] ?? `gick vidare till ${item.toState}`
  return { at: item.at, departmentName, text, caseId: item.caseId }
}

export function toActivityLines(
  items: readonly ActivityItem[],
  names: DepartmentNames = {},
): ActivityLine[] {
  return items.map((item) => toActivityLine(item, names))
}
