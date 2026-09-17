/**
 * The firm's opening, written from the person's words and nothing else.
 */

import { describe, expect, it } from 'vitest'
import {
  evidenceWindow,
  EXPLANATION_POSITION,
  OPEN_POSITION,
  openingProposal,
  STANDING_EVIDENCE,
  standingEvidenceFor,
} from './opening'

const question = 'Kolla varför guld är upp idag och ta fram den konkreta drivkraften bakom rörelsen.'

describe('an explanation opens on the question itself', () => {
  it('states the question, the focus, the explanatory position and no investment implication', () => {
    const proposal = openingProposal(question, { kind: 'explanation', focus: ['makro', 'flöden', 'specifika händelser'] })
    expect(proposal).toEqual({
      statement:
        'Kolla varför guld är upp idag och ta fram den konkreta drivkraften bakom rörelsen. Prövas mot: makro, flöden, specifika händelser.',
      position: EXPLANATION_POSITION,
      invalidationCriteria: 'Faller om ingen av de angivna faktorerna kan beläggas som drivkraft i underlaget.',
      horizon: 'dagens rörelse',
      implications: [],
    })
  })

  it('adds no focus sentence when the person named none and the default was not applied', () => {
    expect(openingProposal('Varför är guld upp idag?', { kind: 'explanation', focus: [] }).statement).toBe(
      'Varför är guld upp idag?.'.replace('?.', '.'),
    )
  })
})

describe('a position opens on the person’s view, or openly', () => {
  it('carries their statement and the position word read off it, with position-sizing declared', () => {
    const proposal = openingProposal('Borde jag minska min USA-exponering?', {
      kind: 'position',
      focus: ['värdering'],
      view: { statement: 'Jag är negativ till USA på sex till tolv månader, värderingen är huvudskälet', position: 'reduce' },
    })
    expect(proposal.statement).toBe(
      'Jag är negativ till USA på sex till tolv månader, värderingen är huvudskälet. Prövas mot: värdering.',
    )
    expect(proposal.position).toBe('reduce')
    expect(proposal.implications).toEqual(['position-sizing'])
    expect(proposal.horizon).toBeUndefined()
  })

  it('examines openly when the person only said to go ahead', () => {
    const proposal = openingProposal('Borde jag minska min USA-exponering?', { kind: 'position', focus: [], view: null })
    expect(proposal.statement).toBe('Borde jag minska min USA-exponering. Prövas öppet, utan förutbestämd position.')
    expect(proposal.position).toBe(OPEN_POSITION)
    expect(proposal.implications).toEqual(['position-sizing'])
  })

  it('never writes words the person did not say: every statement is the question or the view', () => {
    const view = { statement: 'Köp guld.', position: 'buy' }
    const proposal = openingProposal(question, { kind: 'position', focus: [], view })
    expect(proposal.statement).toBe('Köp guld.')
  })
})

describe('the standing evidence basis', () => {
  it('is a policy per workflow, and nothing for a workflow nobody ruled on', () => {
    expect(standingEvidenceFor('macro-regime')).toEqual(STANDING_EVIDENCE['macro-regime'])
    /* Seven days: measured 2026-09-17, thirty days of the curve exhausted the desks' 24,000-token budget. */
    expect(standingEvidenceFor('macro-regime')).toEqual({ ruleId: 'sovereign-yield-curve@1', subjectFamily: 'us-par-curve', windowDays: 7 })
    expect(standingEvidenceFor('equity-single-name')).toBeNull()
    expect(standingEvidenceFor(null)).toBeNull()
    expect(standingEvidenceFor(undefined)).toBeNull()
  })

  it('ends its window on the day of the act', () => {
    expect(evidenceWindow('2026-09-17T18:30:00.000Z', 30)).toEqual({ from: '2026-08-18', to: '2026-09-17' })
    expect(evidenceWindow('2026-09-17T18:30:00.000Z', 7)).toEqual({ from: '2026-09-10', to: '2026-09-17' })
  })
})
