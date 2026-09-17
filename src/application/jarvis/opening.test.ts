/**
 * The person speaks human; these are the readings JARVIS makes of it, and
 * the planted lines that must read the other way.
 */

import { describe, expect, it } from 'vitest'
import {
  commissionKind,
  DEFAULT_FOCUS,
  focusFrom,
  isConfirmation,
  isFocusOnly,
  isOpenExamination,
  openingFromWords,
  positionFrom,
} from './opening'

describe('what kind of commission a line is', () => {
  it('reads a why, a what-drives and a find-out as an explanation, whatever the subject', () => {
    for (const line of [
      'Kolla med kommittén och be dem ta reda på varför guld är upp idag.',
      'Varför är guld upp idag?',
      'Be dem ta reda på vad som driver oljan.',
      'Vad driver dollarn just nu?',
      'Ask the committee to find out why gold is up today.',
      'Kolla varför guld är upp idag och ta fram den konkreta drivkraften bakom rörelsen.',
    ]) {
      expect(commissionKind(line), line).toBe('explanation')
    }
  })

  it('reads a capital judgement as a position, whatever the subject — the planted violations', () => {
    for (const line of [
      'Borde jag minska min USA-exponering?',
      'Ska jag köpa guld?',
      'Bör vi öka i tech?',
      'Hur borde portföljen positioneras nu?',
      'Should I reduce US exposure?',
      'Är guld attraktivt på sikt?',
    ]) {
      expect(commissionKind(line), line).toBe('position')
    }
  })
})

describe('the focus a person names', () => {
  it('is read in their order and their words, canonically', () => {
    expect(focusFrom('Makro, flöden och specifika händelser.')).toEqual(['makro', 'flöden', 'specifika händelser'])
    expect(focusFrom('Fokusera på flödena och makrobilden')).toEqual(['flöden', 'makro'])
    expect(focusFrom('Ta dollarn och räntorna, och värderingen')).toEqual(['dollarn', 'räntor', 'värdering'])
    expect(focusFrom('Macro, flows and any specific events')).toEqual(['makro', 'flöden', 'specifika händelser'])
  })

  it('is empty when nothing was named, so the standing default applies', () => {
    expect(focusFrom('Kolla med kommittén varför guld är upp idag.')).toEqual([])
    expect(focusFrom('Kör.')).toEqual([])
    expect(DEFAULT_FOCUS).toEqual(['makro', 'flöden', 'specifika händelser'])
  })
})

describe('a human confirmation', () => {
  it('counts, in the words people actually use', () => {
    for (const line of [
      'Ja.',
      'Kör.',
      'Kör på det.',
      'De kan börja.',
      'De kan gå vidare.',
      'Precis.',
      'Det är vad jag menar.',
      'Okej, gör det.',
      'Go ahead.',
      'Yes, exactly.',
      'Absolut, kör igång nu.',
      'Ja tack.',
    ]) {
      expect(isConfirmation(line), line).toBe(true)
    }
  })

  it('is not a line that says something the firm must record — the near-misses', () => {
    for (const line of [
      'Ja, men ta hänsyn till dollarn också.',
      'Kör, men fokusera på flöden.',
      'Jag är negativ till USA på sex till tolv månader.',
      'Makro, flöden och specifika händelser.',
      'Nej.',
      'Varför?',
      '',
    ]) {
      expect(isConfirmation(line), line).toBe(false)
    }
  })
})

describe('leave to examine openly, and a focus alone', () => {
  it('are not views', () => {
    for (const line of ['Pröva den öppet.', 'Pröva frågan helt förutsättningslöst.', 'Utan egen syn, kör.', 'Examine it openly.']) {
      expect(isOpenExamination(line), line).toBe(true)
    }
    expect(isOpenExamination('Jag är negativ till USA.')).toBe(false)
    for (const line of ['Makro, flöden och specifika händelser.', 'Framför allt flödena.', 'Macro and flows.']) {
      expect(isFocusOnly(line), line).toBe(true)
    }
    for (const line of ['Jag tror flödena driver det, sälj.', 'Makro, och jag är negativ.']) {
      expect(isFocusOnly(line), line).toBe(false)
    }
  })
})

describe('the opening from the firm’s question and the person’s words', () => {
  it('opens an explanation on the question with the named or standing focus, whatever the words', () => {
    const q = 'Kolla med kommittén varför guld är upp idag.'
    expect(openingFromWords(q, null)).toEqual({ kind: 'explanation', focus: DEFAULT_FOCUS })
    expect(openingFromWords(q, 'Kör.')).toEqual({ kind: 'explanation', focus: DEFAULT_FOCUS })
    expect(openingFromWords(q, 'Makro och flöden.')).toEqual({ kind: 'explanation', focus: ['makro', 'flöden'] })
    expect(openingFromWords('Be dem titta på flödena i guld.', null)).toEqual({ kind: 'explanation', focus: ['flöden'] })
  })

  it('opens a position on the view, and openly on a confirmation, a focus or leave to examine', () => {
    const q = 'Borde jag minska min USA-exponering?'
    expect(openingFromWords(q, 'Jag är negativ till USA, värderingen är huvudskälet.')).toEqual({
      kind: 'position',
      focus: ['värdering'],
      view: { statement: 'Jag är negativ till USA, värderingen är huvudskälet.', position: 'reduce' },
    })
    expect(openingFromWords(q, 'De kan börja.')).toEqual({ kind: 'position', focus: [], view: null })
    expect(openingFromWords(q, 'Pröva den öppet.')).toEqual({ kind: 'position', focus: [], view: null })
    expect(openingFromWords(q, 'Makro, flöden och specifika händelser.')).toEqual({
      kind: 'position',
      focus: ['makro', 'flöden', 'specifika händelser'],
      view: null,
    })
    expect(openingFromWords(q, null, ['värdering'])).toEqual({ kind: 'position', focus: ['värdering'], view: null })
  })
})

describe("the person's view as a position word", () => {
  it('reads direction off the verbs about capital, and open when there is none', () => {
    expect(positionFrom('Jag är negativ till amerikanska börsen och vill minska.')).toBe('reduce')
    expect(positionFrom('Jag tror det är dags att köpa guld.')).toBe('buy')
    expect(positionFrom('Vi bör sälja hela innehavet.')).toBe('sell')
    expect(positionFrom('Behåll som det är.')).toBe('hold')
    expect(positionFrom('Öka i tech, jag är positiv.')).toBe('accumulate')
    expect(positionFrom('Undvik sektorn tills vidare.')).toBe('avoid')
    expect(positionFrom('Pröva den helt öppet.')).toBe('open')
    expect(positionFrom('Kör.')).toBe('open')
  })
})
