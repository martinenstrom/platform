/**
 * The firm's opening position, written from the person's words.
 *
 * Ruled 2026-09-17. A case is a question; the committee cannot argue about
 * it until somebody states an opening position, and until this act the only
 * way to state one was a script a person typed at a terminal (TD-88). The
 * ruling settled the authority question TD-88 left open: the person who put
 * the question establishes the opening — in their own words, translated by
 * JARVIS, confirmed by them — and the act is booked to the operator with the
 * host as initiator, exactly as their question was.
 *
 * What this module writes is the record's shape around the person's words,
 * never words the person did not say:
 *
 *   - an **explanation** ("varför är guld upp idag?") opens on the question
 *     itself, examined against the focus the person named, with the
 *     position `explain` and no investment implication — it is descriptive,
 *     and declaring that here is what a conditional Risk review resolves
 *     against;
 *   - a **position** with the person's view opens on their statement and
 *     the position word read off it;
 *   - a **position** examined openly — "pröva den öppet", or a bare "kör" —
 *     opens on the question with the position `open` and no predetermined
 *     view. Both position shapes declare `position-sizing`: acting on the
 *     answer would change what the firm holds, so Risk is not waived by
 *     phrasing.
 *
 * The invalidation criterion is required by the domain ("a thesis that
 * cannot be wrong is a preference") and is stated for the shape, not for
 * the subject: what would make an opening of this kind fall.
 */

import type { InvestmentImplication } from '~/domain/analysis'
import type { HostOpening } from './hostContract'

export interface OpeningProposal {
  statement: string
  position: string
  invalidationCriteria: string
  horizon?: string
  implications: readonly InvestmentImplication[]
}

/** The position word of an explanation: the firm explains, it does not take a side. */
export const EXPLANATION_POSITION = 'explain'
/** The position word of a question examined without a predetermined view. */
export const OPEN_POSITION = 'open'

const sentence = (text: string): string => text.trim().replace(/[\s.!?]+$/u, '')

export function openingProposal(question: string, opening: HostOpening): OpeningProposal {
  const against = opening.focus.length > 0 ? ` Prövas mot: ${opening.focus.join(', ')}.` : ''
  if (opening.kind === 'explanation') {
    return {
      statement: `${sentence(question)}.${against}`,
      position: EXPLANATION_POSITION,
      invalidationCriteria:
        'Faller om ingen av de angivna faktorerna kan beläggas som drivkraft i underlaget.',
      horizon: 'dagens rörelse',
      implications: [],
    }
  }
  if (opening.view === null) {
    return {
      statement: `${sentence(question)}. Prövas öppet, utan förutbestämd position.${against}`,
      position: OPEN_POSITION,
      invalidationCriteria: 'Faller om underlaget inte bär någon position i frågan.',
      implications: ['position-sizing'],
    }
  }
  return {
    statement: `${sentence(opening.view.statement)}.${against}`,
    position: opening.view.position,
    invalidationCriteria:
      'Faller om kommitténs prövning inte finner belägg för positionen i underlaget.',
    implications: ['position-sizing'],
  }
}

/* ------------------------------------------- the standing evidence basis */

/**
 * What a workflow's desks read when the firm is advanced on the person's
 * word, before anyone has chosen evidence by hand.
 *
 * A policy, stated once and ruled 2026-09-17 for `macro-regime`: the US par
 * curve over the last seven days, as the firm knew it at the moment of the
 * act. Seven, not thirty, because the budget is the firm's and is not
 * widened to fit a window: measured on 2026-09-17, a thirty-day window
 * (252 observations) cost the Macro desk 63,010 input tokens against the
 * 24,000 the pinned workflow authorises and the run failed
 * `budget-exhausted`; the v6 measurement table puts a week of the curve
 * (60 observations) at 15,531 — inside the envelope for both desks. A
 * workflow with no entry here starts no desk — the firm says it has no
 * basis rather than handing a desk nothing to read. Choosing a basis by
 * subject ("gold", "Nvidia") is the evidence architecture's next question
 * and is not decided by this table.
 */
export interface StandingEvidence {
  ruleId: string
  subjectFamily: string
  windowDays: number
}

export const STANDING_EVIDENCE: Readonly<Record<string, StandingEvidence>> = Object.freeze({
  'macro-regime': { ruleId: 'sovereign-yield-curve@1', subjectFamily: 'us-par-curve', windowDays: 7 },
})

export function standingEvidenceFor(playbookId: string | null | undefined): StandingEvidence | null {
  if (!playbookId) return null
  return STANDING_EVIDENCE[playbookId] ?? null
}

/**
 * The entry of a workflow that synthesises the desks' work — the one whose
 * run is thesis-scoped and whose candidate the Research Office adopts as a
 * revision (`AggregateManagerConclusion`). A policy per workflow, like the
 * evidence basis; a workflow without one has its synthesis commissioned by
 * nobody on the person's word.
 */
export const SYNTHESIS_ENTRY: Readonly<Record<string, string>> = Object.freeze({
  'macro-regime': 'aggregation',
})

export function synthesisEntryFor(playbookId: string | null | undefined): string | null {
  if (!playbookId) return null
  return SYNTHESIS_ENTRY[playbookId] ?? null
}

/** The window's inclusive reference dates, ending on the day of the act. */
export function evidenceWindow(now: string, windowDays: number): { from: string; to: string } {
  const to = new Date(now)
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000)
  const day = (date: Date) => date.toISOString().slice(0, 10)
  return { from: day(from), to: day(to) }
}
