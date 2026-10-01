/**
 * The advisory recogniser: every intent from a line a Private Banker would
 * type, the scope deciding the family, a named client switching the
 * subject, and the lines that are not the record's to answer.
 */

import { describe, expect, it } from 'vitest'
import { recognizeAdvisoryIntent, resolveNamedClient } from './advisoryIntent'
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
const SENTINEL = resolveJarvisContext('/sentinel')
const IMPACT = resolveJarvisContext('/market-impact')
const MARKET = resolveJarvisContext('/')

const kind = (text: string, context = CLIENT) =>
  recognizeAdvisoryIntent(text, context, CLIENTS)?.kind ?? null

describe('on a client', () => {
  it('recognises the questions a banker asks about the client on screen', () => {
    expect(kind('Vad ska jag ta upp på mötet?')).toBe('MEETING_PREP')
    expect(kind('What should I think about before the meeting?')).toBe('MEETING_PREP')
    expect(kind('Förbered mig inför mötet')).toBe('MEETING_PREP')
    expect(kind('Vad pratade vi om sist?')).toBe('LAST_INTERACTION')
    expect(kind('What did we discuss last time?')).toBe('LAST_INTERACTION')
    expect(kind('Vad har jag lovat?')).toBe('OPEN_COMMITMENTS')
    expect(kind('Vad har jag inte slutfört?')).toBe('OPEN_COMMITMENTS')
    expect(kind('What changed since last time?')).toBe('CHANGES_SINCE_LAST_MEETING')
    expect(kind('Vad har förändrats sedan sist?')).toBe('CHANGES_SINCE_LAST_MEETING')
    expect(kind('Varför är kunden prioriterad?')).toBe('WHY_PRIORITY')
    expect(kind('Varför är de prioriterade?')).toBe('WHY_PRIORITY')
    expect(kind('När läggs lånet om?')).toBe('FINANCING')
    expect(kind('Vad hände i marknaden sedan sist?')).toBe('MARKET_RELEVANCE')
    expect(kind('Vilka risker ser du?')).toBe('RISKS')
    expect(kind('Vilka tre frågor bör jag ställa?')).toBe('QUESTIONS_TO_ASK')
    expect(kind('Vad kommer de sannolikt fråga om?')).toBe('CLIENT_QUESTIONS')
    expect(kind('Vilka siffror behöver jag kunna?')).toBe('KEY_FIGURES')
    expect(kind('Ge mig kunden på 30 sekunder.')).toBe('CLIENT_SUMMARY')
    expect(kind('Vad är viktigast med den här kunden?')).toBe('CLIENT_SUMMARY')
    expect(kind('Vilka möjligheter finns?')).toBe('OPPORTUNITIES')
    expect(kind('Vilka mål har de?')).toBe('GOALS')
  })

  it('sends what it does not recognise to the relationship memory, never away', () => {
    expect(kind('När pratade vi om avgiften?')).toBe('GENERAL_CLIENT_QUERY')
    expect(kind('Har vi diskuterat pension?')).toBe('GENERAL_CLIENT_QUERY')
  })

  it('keeps the more specific question ahead of the broader cue', () => {
    /* "sedan sist" inside a market question is the market's; "fråga" inside "ska jag fråga" is the advisor's. */
    expect(kind('Vad hände i marknaden sedan sist?')).toBe('MARKET_RELEVANCE')
    expect(kind('Vad ska jag fråga kunden om lånet?')).toBe('QUESTIONS_TO_ASK')
  })

  it('reads the cockpit questions the same way inside the meeting', () => {
    expect(kind('Vad har jag inte slutfört?', MEETING)).toBe('OPEN_COMMITMENTS')
    expect(kind('Vilka siffror behöver jag kunna?', MEETING)).toBe('KEY_FIGURES')
  })

  it('recognises the pack commands: depth, format, refresh — in either language', () => {
    expect(kind('Prepare full pack.', MEETING)).toBe('MEETING_PACK_FULL')
    expect(kind('Skapa mötesunderlag', MEETING)).toBe('MEETING_PACK_FULL')
    expect(kind('Skapa PowerPoint inför mötet.')).toBe('MEETING_PACK_PPTX')
    expect(kind('Create the PowerPoint.', MEETING)).toBe('MEETING_PACK_PPTX')
    expect(kind('Ge mig en femslides executive brief.')).toBe('MEETING_PACK_EXECUTIVE')
    expect(kind('Give me the executive version.', MEETING)).toBe('MEETING_PACK_EXECUTIVE')
    expect(kind('Skapa PDF inför mötet på torsdag.')).toBe('MEETING_PACK_PDF')
    expect(kind('Generate the PDF.', MEETING)).toBe('MEETING_PACK_PDF')
    expect(kind('Uppdatera mötesunderlaget med det som hänt sedan sist.')).toBe(
      'MEETING_PACK_UPDATE',
    )
    expect(kind('Update the pack.', MEETING)).toBe('MEETING_PACK_UPDATE')
    /* What the client said about a presentation is the memory's, not a command. */
    expect(kind('Vad sa de om presentationen?')).toBe('GENERAL_CLIENT_QUERY')
  })
})

describe('a named client', () => {
  it('resolves exactly one client from a first name, a surname or a couple', () => {
    expect(resolveNamedClient('Vad gäller Henrik?', CLIENTS)?.id).toBe('cl-alvarsson')
    expect(resolveNamedClient('Och Dahlqvist?', CLIENTS)?.id).toBe('cl-dahlqvist')
    expect(resolveNamedClient('Vad har jag lovat Anna & Per?', CLIENTS)?.id).toBe(
      'cl-dahlqvist',
    )
    expect(resolveNamedClient('Vad ska jag ta upp på mötet?', CLIENTS)).toBeNull()
  })

  it('names nobody when the name fits two clients or two clients are named', () => {
    const twoAnnas = [...CLIENTS, { id: 'cl-x', displayName: 'Anna Lind' }]
    expect(resolveNamedClient('Vad gäller Anna?', twoAnnas)).toBeNull()
    expect(resolveNamedClient('Henrik och Margareta?', CLIENTS)).toBeNull()
  })

  it('switches the subject from any scope without changing the route', () => {
    const fromMarket = recognizeAdvisoryIntent(
      'Vad är viktigast med Henrik just nu?',
      MARKET,
      CLIENTS,
    )
    expect(fromMarket).toMatchObject({
      kind: 'CLIENT_SUMMARY',
      namedClient: { id: 'cl-alvarsson' },
    })
    const fromClient = recognizeAdvisoryIntent(
      'Vad har jag lovat Henrik?',
      CLIENT,
      CLIENTS,
    )
    expect(fromClient).toMatchObject({
      kind: 'OPEN_COMMITMENTS',
      namedClient: { id: 'cl-alvarsson' },
    })
    const bare = recognizeAdvisoryIntent('Och Henrik?', CLIENT, CLIENTS)
    expect(bare?.kind).toBe('CLIENT_SUMMARY')
  })
})

describe('in the book, the office, Sentinel and Marknadspåverkan', () => {
  it('reads the office questions', () => {
    expect(kind('Vilka kunder här behöver mig?', OFFICE)).toBe('OFFICE_PRIORITIES')
    expect(kind('Vem har möte den här veckan?', OFFICE)).toBe('OFFICE_MEETINGS')
    expect(kind('Vilka försenade åtaganden finns?', OFFICE)).toBe('OFFICE_OVERDUE')
    expect(kind('Var finns störst möjlighet?', OFFICE)).toBe('OFFICE_OPPORTUNITIES')
  })

  it('reads the whole book’s questions', () => {
    expect(kind('Vem borde jag ringa idag?', DIRECTORY)).toBe('DIRECTORY_CALL_TODAY')
    expect(kind('Vilka kunder har möte kommande vecka?', DIRECTORY)).toBe(
      'DIRECTORY_MEETINGS',
    )
    expect(kind('Vilka löften är försenade?', DIRECTORY)).toBe('DIRECTORY_OVERDUE')
    expect(kind('Vilka kunder har stora externa tillgångar?', DIRECTORY)).toBe(
      'DIRECTORY_EXTERNAL_ASSETS',
    )
  })

  it('reads Sentinel and Marknadspåverkan', () => {
    expect(kind('Vem behöver mig idag?', SENTINEL)).toBe('SENTINEL_TODAY')
    expect(kind('Vilka klienter berörs mest?', IMPACT)).toBe('MARKET_IMPACT_CLIENTS')
  })

  it('leaves what the record cannot answer there to the router', () => {
    expect(kind('Hur ser amerikanska börsen ut idag?', OFFICE)).toBeNull()
    expect(kind('Är Nvidia köpvärd?', DIRECTORY)).toBeNull()
    expect(kind('Vad ska jag ta upp på mötet?', MARKET)).toBeNull()
  })
})
