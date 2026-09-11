/**
 * The words the Boardroom uses, and nowhere else.
 *
 * The domain records what happened; this turns it into Swedish. The split is
 * the same integrity mechanism `activityText` describes: if the wording were a
 * stored field, anything could write "Rates instämmer" with no examination
 * behind it. Because the text is derived, a sentence can only appear when the
 * act it describes was actually recorded.
 *
 * ## What is not here
 *
 * No sentence in this file decides anything. There is no wording for "the desks
 * agree", "the case is ready" or "scrutiny passed" that is not a direct
 * rendering of a persisted value or of the recorded gate report. In particular
 * there is no phrase meaning *consensus*: the firm does not record agreement,
 * only objections and their absence, and a word for something nobody stored
 * would be the first fabrication.
 */

import type {
  CaseStanding,
  ChallengeStatus,
  DisagreementMateriality,
} from '~/domain/analysis'
import type { Tone } from '~/types'
import type {
  BoardroomEntryKind,
  BoardroomObjection,
} from '~/application/analysis/boardroomTimeline'
import type {
  ExecutiveStanding,
  SeatParticipation,
} from '~/application/analysis/boardroomSeating'
import { DECISION_OUTCOME_LABEL } from './caseStandingText'

/**
 * Text plus the tone it is shown in. Same shape the other mappings use.
 *
 * The tone vocabulary is the product's, not this file's. Institutional
 * standing is carried by the surrounding region — `Panel`'s bronze governance
 * edge — rather than by a badge colour, so nothing here needs a tone the
 * design system does not have.
 */
export interface Rendered {
  label: string
  tone: Tone
}

/** What each act is called on the floor. */
export const ENTRY_LABEL: Record<BoardroomEntryKind, string> = {
  'analysis-recorded': 'Analys',
  'synthesis-produced': 'Sammanvägning',
  'peer-examination': 'Kollegial granskning',
  'governance-review': 'Kontrollfunktion',
  'cio-submission': 'Inlämnad till CIO',
  'cio-decision': 'Investeringsbeslut',
}

/**
 * How heavily a desk weighed its own objection.
 *
 * The desk's assessment, rendered — never this module's opinion of it, and
 * never a statement about whether it blocks. What blocks is the gate's answer
 * under the policy in force.
 */
export const MATERIALITY: Record<DisagreementMateriality, Rendered> = {
  'non-material': { label: 'Ej väsentlig', tone: 'neutral' },
  material: { label: 'Väsentlig', tone: 'warning' },
  'decision-critical': { label: 'Avgörande', tone: 'negative' },
}

/** Where an objection stands, as the organisation answered it. */
export const OBJECTION_STATUS: Record<ChallengeStatus, Rendered> = {
  open: { label: 'Obesvarad', tone: 'warning' },
  resolved: { label: 'Bemött', tone: 'positive' },
  /*
   * The firm conceded the point. Distinct from `resolved`, which is the
   * objection being answered — accepting one means the argument moved, and
   * collapsing the two would lose which way the disagreement went.
   */
  accepted: { label: 'Godtagen', tone: 'accent' },
  rejected: { label: 'Avvisad', tone: 'neutral' },
}

/**
 * What an examination found — stated as a finding, never as agreement.
 *
 * "Inga invändningar" is the honest rendering of an empty objection list: a
 * qualified desk read the argument and raised nothing. It is deliberately NOT
 * "Rates instämmer", which would report an endorsement the desk never gave and
 * the firm never stored.
 */
export function examinationFinding(objections: readonly BoardroomObjection[]): string {
  if (objections.length === 0) return 'Granskade slutsatsen och reste inga invändningar'
  const open = objections.filter((objection) => objection.outcome === 'open').length
  if (open === 0) {
    return objections.length === 1
      ? 'Reste en invändning, som är bemött'
      : `Reste ${objections.length} invändningar, samtliga bemötta`
  }
  return open === 1
    ? 'Reste en invändning som ännu är obesvarad'
    : `Reste ${objections.length} invändningar, varav ${open} obesvarade`
}

/**
 * Why the case cannot reach the CIO, from the recorded gate report.
 *
 * The gate's own `detail` is carried through rather than re-worded. It names
 * counts, thresholds and desks the evaluator actually applied, and a second
 * sentence written here would be a second account of the same refusal — free
 * to soften it.
 */
export const GATE_QUESTION: Readonly<Record<string, string>> = Object.freeze({
  VERIFICATION_INCOMPLETE: 'Är siffrorna kontrollerade?',
  CHALLENGE_UNRESOLVED: 'Kvarstår någon invändning som väger nog för att stoppa?',
  PEER_SCRUTINY_ABSENT: 'Har ett kunnigt analysdesk granskat slutsatsen?',
  RISK_UNRESOLVED: 'Har Risk sagt sitt, där Risk ska säga något?',
  REQUIRED_WORK_INCOMPLETE: 'Är det arbete spelboken kräver utfört?',
  DISAGREEMENT_BLOCKING: 'Bär sammanvägningen en oförlöst oenighet som stoppar?',
})

/**
 * What a seat says about this case, in words.
 *
 * "Utan uppdrag här" is the honest rendering of a desk the case never asked
 * for: the firm holds the seat, and this case did not involve it. It is
 * deliberately not "inaktiv", which would read as a judgement on the desk
 * rather than a fact about the case.
 */
export const SEAT_PARTICIPATION: Record<SeatParticipation, Rendered> = {
  acted: { label: 'Bidrog i ärendet', tone: 'accent' },
  'assigned-not-acted': { label: 'Tilldelad · inget registrerat', tone: 'warning' },
  'not-in-case': { label: 'Utan uppdrag här', tone: 'neutral' },
}

/**
 * What the chief's plate says, and why it does not use the generic wording.
 *
 * "Utan uppdrag här" is right for a desk the case never asked for and wrong at
 * the head of the table: a case sitting with the CIO would be labelled as one
 * the CIO has nothing to do with. The seat is the DESTINATION of the work, so
 * it is worded from the submission and the decision instead.
 *
 * Every string below reports a stored fact. None of them says the CIO has read,
 * weighed, considered or accepted anything — "beslut väntar" is where the case
 * is, not what the office has done with it — and the four states stay visibly
 * apart, because *submitted to* the CIO, *answered by* the CIO and *decided by*
 * the CIO are three different things and the room must not blur them.
 */
export function executiveStandingText(standing: ExecutiveStanding): string {
  switch (standing.kind) {
    case 'not-submitted':
      return 'Inte inlämnat'
    case 'awaiting-decision':
      return 'Ärendet inlämnat · beslut väntar'
    /* The CIO answered by sending it back. An answer, and not a decision. */
    case 'returned':
      return 'Återsänt av CIO'
    /*
     * The outcome as the firm recorded it, in the one place that word is
     * written. An unmapped kind shows the stored value rather than a guess.
     */
    case 'decided':
      return DECISION_OUTCOME_LABEL[standing.outcome] ?? standing.outcome
  }
}

/**
 * A desk, as this surface may name it.
 *
 * `name` comes from the ORGANISATION, always. A caller may show a persona
 * beside it where the firm has one — that is fiction carrying no institutional
 * claim — but the identity this returns is the desk the record names, and a
 * desk without a persona is shown by its department name with nothing invented
 * to fill the gap. Rates is the first such desk.
 */
export interface DeskIdentity {
  departmentId: string
  /** The organisation's own name for the desk. Always present. */
  name: string
  isGovernance: boolean
}

export function deskIdentity(
  departmentId: string,
  departments: readonly { id: string; name: string; isGovernance: boolean }[],
): DeskIdentity {
  const found = departments.find((department) => department.id === departmentId)
  return {
    departmentId,
    /*
     * The id is the fallback, not an invented name. A desk the case does not
     * involve should not appear here at all; if one does, showing its
     * identifier is honest and visible, and inventing a label would hide the
     * fact that something is wrong.
     */
    name: found?.name ?? departmentId,
    isGovernance: found?.isGovernance ?? false,
  }
}

/**
 * How far the committee has got, counted once for the whole product.
 *
 * The room's status line and the Chairman Console both need this number, and
 * two places counting it independently is exactly how two surfaces come to
 * disagree about the same case. It is a projection of `CaseStanding.steps` and
 * derives nothing the domain has not already decided.
 *
 * A step the institution ruled `not-applicable` is neither done nor owed, so it
 * leaves the denominator entirely. Counting it as outstanding would invent a
 * backlog; counting it as complete would claim work nobody did.
 */
export function committeeProgress(standing: CaseStanding): {
  done: number
  total: number
  label: string
} {
  const applicable = standing.steps.filter((step) => step.status !== 'not-applicable')
  const done = applicable.filter((step) => step.status === 'complete').length
  return { done, total: applicable.length, label: `${done}/${applicable.length} klart` }
}
