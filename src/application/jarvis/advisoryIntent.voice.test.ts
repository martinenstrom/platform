/**
 * The lines a voice brings: the meeting mode's, the figure that was asked
 * for first, the next meeting, the office's "whom first", the
 * continuations, a brief that is not a pack, and a first name two clients
 * share.
 */

import { describe, expect, it } from 'vitest'
import { recognizeAdvisoryIntent, resolveNamedClients } from './advisoryIntent'
import { resolveJarvisContext } from './context'

const CLIENTS = [
  { id: 'cl-dahlqvist', displayName: 'Anna & Per Dahlqvist' },
  { id: 'cl-alvarsson', displayName: 'Henrik Alvarsson' },
  { id: 'cl-berglund', displayName: 'Margareta Berglund' },
]
const CLIENT = resolveJarvisContext('/clients/cl-dahlqvist')
const MEETING = resolveJarvisContext('/clients/cl-dahlqvist/meeting-prep')
const OFFICE = resolveJarvisContext('/clients/office/of-strandvagen')
const DIRECTORY = resolveJarvisContext('/clients')
const MARKET = resolveJarvisContext('/')

const intent = (text: string, context = CLIENT) =>
  recognizeAdvisoryIntent(text, context, CLIENTS)
const kind = (text: string, context = CLIENT) => intent(text, context)?.kind ?? null

describe('meeting mode', () => {
  it('reads the cockpit’s spoken commands, and a brief is preparation, not a pack', () => {
    expect(kind('Brief me.', MEETING)).toBe('MEETING_PREP')
    expect(kind('Förbered mig.', MEETING)).toBe('MEETING_PREP')
    expect(kind('Vad får jag inte glömma?', MEETING)).toBe('RISKS')
    expect(kind('Vilka tre frågor ska jag ställa?', MEETING)).toBe('QUESTIONS_TO_ASK')
    expect(kind('Vad kommer de sannolikt fråga?', MEETING)).toBe('CLIENT_QUESTIONS')
    expect(kind('Vilka siffror behöver jag kunna?', MEETING)).toBe('KEY_FIGURES')
    expect(kind('Vad har hänt sedan sist?', MEETING)).toBe('CHANGES_SINCE_LAST_MEETING')
    expect(kind('Ge mig executive brief.', MEETING)).toBe('MEETING_PACK_EXECUTIVE')
    expect(kind('Skapa PowerPointen.', MEETING)).toBe('MEETING_PACK_PPTX')
    expect(kind('Skapa PDF.', MEETING)).toBe('MEETING_PACK_PDF')
    expect(kind('Uppdatera mötesunderlaget.', MEETING)).toBe('MEETING_PACK_UPDATE')
  })
})

describe('figures and the meeting', () => {
  it('knows which figure was asked for first', () => {
    expect(intent('Vad har de i totalförmögenhet?')).toMatchObject({
      kind: 'KEY_FIGURES',
      emphasis: 'total-wealth',
    })
    expect(intent('Och hur mycket har vi hos oss?')).toMatchObject({
      kind: 'KEY_FIGURES',
      emphasis: 'aum',
    })
    expect(intent('Hur mycket har vi hos oss?')).toMatchObject({
      kind: 'KEY_FIGURES',
      emphasis: 'aum',
    })
    expect(intent('Vad är nettoförmögenheten?')).toMatchObject({
      kind: 'KEY_FIGURES',
      emphasis: 'net-worth',
    })
    expect(intent('Hur mycket likviditet har de?')).toMatchObject({
      kind: 'KEY_FIGURES',
      emphasis: 'liquidity',
    })
  })

  it('reads the next meeting', () => {
    expect(kind('När ses vi?')).toBe('NEXT_MEETING')
    expect(kind('När är nästa möte?')).toBe('NEXT_MEETING')
    expect(kind('When do we meet?')).toBe('NEXT_MEETING')
    expect(kind('Vad har jag lovat dem?')).toBe('OPEN_COMMITMENTS')
  })
})

describe('the office and the book, spoken', () => {
  it('reads whom to start with as the office’s priorities, and the book’s questions as before', () => {
    expect(kind('Vem ska jag börja med?', OFFICE)).toBe('OFFICE_PRIORITIES')
    expect(kind('Vilka kunder här behöver mig?', OFFICE)).toBe('OFFICE_PRIORITIES')
    expect(kind('Vilka har möte denna vecka?', OFFICE)).toBe('OFFICE_MEETINGS')
    expect(kind('Vilka löften är försenade?', OFFICE)).toBe('OFFICE_OVERDUE')
    expect(kind('Vem borde jag ringa idag?', DIRECTORY)).toBe('DIRECTORY_CALL_TODAY')
    expect(kind('Vilka möten har jag kommande vecka?', DIRECTORY)).toBe(
      'DIRECTORY_MEETINGS',
    )
    expect(kind('Vilka kunder har försenade åtaganden?', DIRECTORY)).toBe(
      'DIRECTORY_OVERDUE',
    )
  })
})

describe('the conversation’s own', () => {
  it('reads the continuations from any scope', () => {
    expect(kind('Ta resten också.')).toBe('FOLLOW_UP_MORE')
    expect(kind('Ta resten också.', MARKET)).toBe('FOLLOW_UP_MORE')
    expect(intent('Utveckla punkt två.')).toMatchObject({
      kind: 'FOLLOW_UP_ITEM',
      itemIndex: 2,
    })
    expect(intent('Elaborate on point 3.', OFFICE)).toMatchObject({
      kind: 'FOLLOW_UP_ITEM',
      itemIndex: 3,
    })
    expect(kind('Vad bygger du det på?')).toBe('FOLLOW_UP_EVIDENCE')
    expect(kind('Varför säger du det?', MEETING)).toBe('FOLLOW_UP_EVIDENCE')
    /* A long line that happens to say "fortsätt" is not a continuation. */
    expect(
      kind('Fortsätt att berätta vad de sa om avgiften förra gången vi sågs'),
    ).not.toBe('FOLLOW_UP_MORE')
  })

  it('names nobody when a first name fits two clients, and the line asks which', () => {
    const twins = [...CLIENTS, { id: 'cl-lindqvist', displayName: 'Henrik Lindqvist' }]
    expect(resolveNamedClients('Vad är viktigast för Henrik?', twins)).toMatchObject({
      kind: 'many',
    })
    expect(
      recognizeAdvisoryIntent('Vad är viktigast för Henrik?', CLIENT, twins),
    ).toMatchObject({
      kind: 'CLARIFY_CLIENT',
      ambiguous: [
        { id: 'cl-alvarsson', displayName: 'Henrik Alvarsson' },
        { id: 'cl-lindqvist', displayName: 'Henrik Lindqvist' },
      ],
    })
    /* The full name is one client, whatever the first name alone would be. */
    expect(
      recognizeAdvisoryIntent('Vad är viktigast för Henrik Alvarsson?', CLIENT, twins),
    ).toMatchObject({
      kind: 'CLIENT_SUMMARY',
      namedClient: { id: 'cl-alvarsson' },
    })
  })
})
