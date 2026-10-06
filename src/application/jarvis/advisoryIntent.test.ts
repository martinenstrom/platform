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

describe('the book’s lifecycle', () => {
  const OFFICES = [
    { id: 'of-strandvagen', displayName: 'Strandvägen' },
    { id: 'of-arbetargatan', displayName: 'Arbetargatan' },
  ]
  const read = (text: string, context = DIRECTORY) =>
    recognizeAdvisoryIntent(text, context, CLIENTS, OFFICES)

  it('reads who came, who is being taken in, who left, who moved, who came back, what changed', () => {
    expect(read('Vilka nya klienter har jag?')?.kind).toBe('BOOK_NEW_CLIENTS')
    expect(read('Vilka är under onboarding?', OFFICE)?.kind).toBe('BOOK_ONBOARDING')
    expect(read('Vilka kunder lämnade i år?')).toMatchObject({
      kind: 'BOOK_FORMER',
      period: 'year',
    })
    expect(read('Vilka har återaktiverats?')?.kind).toBe('BOOK_REACTIVATED')
    expect(read('Vad ändrades i min PB-bok den här månaden?')).toMatchObject({
      kind: 'BOOK_CHANGES',
      period: 'month',
    })
    expect(read('Which clients left this year?')).toMatchObject({
      kind: 'BOOK_FORMER',
      period: 'year',
    })
    expect(read('Vad hände i boken i veckan?')).toMatchObject({
      kind: 'BOOK_CHANGES',
      period: 'week',
    })
  })

  it('resolves an office the line names, with the direction of a move', () => {
    expect(read('Visa tidigare klienter från Strandvägen')).toMatchObject({
      kind: 'BOOK_FORMER',
      office: { id: 'of-strandvagen' },
      direction: 'from',
    })
    expect(read('Vilka flyttades till Arbetargatan?')).toMatchObject({
      kind: 'BOOK_MOVED',
      office: { id: 'of-arbetargatan' },
      direction: 'to',
    })
    /* Without diacritics, and in English, the office is still the office. */
    expect(read('Who moved to Strandvagen?')).toMatchObject({
      kind: 'BOOK_MOVED',
      office: { id: 'of-strandvagen' },
      direction: 'to',
    })
    expect(read('Vilka har flyttats?')).toMatchObject({ kind: 'BOOK_MOVED' })
    expect(read('Vilka har flyttats?')?.office).toBeUndefined()
    expect(read('Vilka flyttades till Kungsgatan?')?.office).toBeUndefined()
  })

  it('is the book’s from anywhere, and on a client only when the line speaks of the book', () => {
    expect(read('Vilka kunder lämnade i år?', MARKET)?.kind).toBe('BOOK_FORMER')
    expect(read('Vilka nya klienter har jag?', CLIENT)?.kind).toBe('BOOK_NEW_CLIENTS')
    expect(read('Vad ändrades i min PB-bok den här månaden?', CLIENT)?.kind).toBe(
      'BOOK_CHANGES',
    )
    /* On a client, the onboarding and a moved meeting are the client's, not the book's. */
    expect(read('Hur går onboardingen?', CLIENT)?.kind).toBe('GENERAL_CLIENT_QUERY')
    expect(read('Kan vi flytta mötet?', CLIENT)?.kind).not.toBe('BOOK_MOVED')
    /* A named client makes the line that client's. */
    expect(read('Har Henrik flyttats?', DIRECTORY)?.kind).not.toBe('BOOK_MOVED')
    /* What changed since the last meeting stays the meeting's. */
    expect(read('Vad har förändrats sedan sist?', CLIENT)?.kind).toBe(
      'CHANGES_SINCE_LAST_MEETING',
    )
  })
})

describe('the day — Daily Command', () => {
  const DAILY = resolveJarvisContext('/today')
  const OFFICES = [
    { id: 'of-strandvagen', displayName: 'Strandvägen' },
    { id: 'of-arbetargatan', displayName: 'Arbetargatan' },
  ]
  const read = (text: string, context = DAILY) =>
    recognizeAdvisoryIntent(text, context, CLIENTS, OFFICES)

  it('reads the day’s questions on Idag', () => {
    expect(read('Vem behöver mig idag?')?.kind).toBe('DAILY_PRIORITIES')
    expect(read('Vilka relationer kräver min uppmärksamhet?')?.kind).toBe('DAILY_PRIORITIES')
    expect(read('Vad ska jag göra idag?')?.kind).toBe('DAILY_PRIORITIES')
    expect(read('Who needs me today?')?.kind).toBe('DAILY_PRIORITIES')
    expect(read('Vilka kan vänta?')?.kind).toBe('DAILY_CAN_WAIT')
    expect(read('Vilka möten har jag idag?')?.kind).toBe('DAILY_MEETINGS')
    expect(read('Vilka löften är försenade?')?.kind).toBe('DAILY_OVERDUE')
    expect(read('Vilka har finansiering som förfaller snart?')?.kind).toBe('DAILY_FINANCING')
    expect(read('Vilka klienter berörs av marknaden?')?.kind).toBe('MARKET_IMPACT_CLIENTS')
    expect(read('Vilka klienter påverkas av räntan?')?.kind).toBe('MARKET_IMPACT_CLIENTS')
  })

  it('reads a window of time from anywhere, with the minutes, unless a client is named', () => {
    expect(read('Jag har 30 minuter. Vem borde jag ringa?')).toMatchObject({
      kind: 'DAILY_TIME_WINDOW',
      minutes: 30,
    })
    expect(read('Jag har en kvart över, vad hinner jag?', MARKET)).toMatchObject({
      kind: 'DAILY_TIME_WINDOW',
      minutes: 15,
    })
    expect(read('I have an hour before my next meeting', SENTINEL)).toMatchObject({
      kind: 'DAILY_TIME_WINDOW',
      minutes: 60,
    })
    expect(read('Jag har 20 minuter, vad gör jag bäst med dem?', CLIENT)).toMatchObject({
      kind: 'DAILY_TIME_WINDOW',
      minutes: 20,
    })
    /* On the client's page, a client question with a time in it stays the client's. */
    expect(read('Jag har 15 minuter innan mötet, vad ska jag ta upp?', CLIENT)?.kind).toBe(
      'MEETING_PREP',
    )
    /* A named client makes it that client's line, not the day's. */
    expect(read('Jag har 30 minuter, hinner jag med Henrik?')?.kind).not.toBe('DAILY_TIME_WINDOW')
  })

  it('reads what changed, and from when', () => {
    expect(read('Vad har förändrats sedan igår?')).toMatchObject({
      kind: 'DAILY_CHANGES',
      since: 'yesterday',
    })
    expect(read('Vad har hänt sedan i fredags?')).toMatchObject({
      kind: 'DAILY_CHANGES',
      since: 'friday',
    })
    expect(read('Vad har ändrats den här veckan?')).toMatchObject({
      kind: 'DAILY_CHANGES',
      since: 'week',
    })
    expect(read('What changed since yesterday?', MARKET)).toMatchObject({
      kind: 'DAILY_CHANGES',
      since: 'yesterday',
    })
    /* On the directory the same line is the day's; on a client it is the meeting's. */
    expect(read('Vad har förändrats sedan igår?', DIRECTORY)?.kind).toBe('DAILY_CHANGES')
    expect(read('Vad har förändrats sedan igår?', CLIENT)?.kind).toBe(
      'CHANGES_SINCE_LAST_MEETING',
    )
  })

  it('narrows to an office the line names', () => {
    expect(read('Vilka på Strandvägen behöver mig?')).toMatchObject({
      kind: 'DAILY_PRIORITIES',
      office: { id: 'of-strandvagen' },
    })
    expect(read('Vilka möten har vi på Arbetargatan den här veckan?', MARKET)).toMatchObject({
      kind: 'DAILY_MEETINGS',
      office: { id: 'of-arbetargatan' },
    })
  })

  it('answers the day from the market and the firm only when the line is anchored in the day', () => {
    expect(read('Vem behöver mig idag?', MARKET)?.kind).toBe('DAILY_PRIORITIES')
    expect(read('Vilka kan vänta?', MARKET)?.kind).toBe('DAILY_CAN_WAIT')
    expect(read('Vilka löften är försenade?', MARKET)?.kind).toBe('DAILY_OVERDUE')
    /* "call" alone, on the market, is not the day's. */
    expect(read('What is the margin call risk on the index?', MARKET)).toBeNull()
    expect(read('Vilka möten brukar ni ha?', MARKET)).toBeNull()
  })

  it('keeps the existing doors: Sentinel, the directory and the office answer their own', () => {
    expect(read('Vem behöver mig idag?', SENTINEL)?.kind).toBe('SENTINEL_TODAY')
    expect(read('Vem borde jag ringa idag?', DIRECTORY)?.kind).toBe('DIRECTORY_CALL_TODAY')
    expect(read('Vilka kunder här behöver mig?', OFFICE)?.kind).toBe('OFFICE_PRIORITIES')
    expect(read('Vilka försenade åtaganden finns?', OFFICE)?.kind).toBe('OFFICE_OVERDUE')
    /* …and the day's own reach them where they had no answer before. */
    expect(read('Vilka kan vänta?', OFFICE)?.kind).toBe('DAILY_CAN_WAIT')
    expect(read('Vad har hänt sedan igår?', SENTINEL)?.kind).toBe('DAILY_CHANGES')
  })

  it('reads a call to prepare and a why for a named client', () => {
    expect(read('Förbered samtal med Henrik')).toMatchObject({
      kind: 'PREPARE_CALL',
      namedClient: { id: 'cl-alvarsson' },
    })
    expect(read('Förbered mig inför samtalet med Margareta', MARKET)).toMatchObject({
      kind: 'PREPARE_CALL',
      namedClient: { id: 'cl-berglund' },
    })
    expect(read('Prepare the call with Berglund')?.kind).toBe('PREPARE_CALL')
    expect(read('Förbered samtalet', CLIENT)?.kind).toBe('PREPARE_CALL')
    /* The meeting's preparation stays the meeting's. */
    expect(read('Förbered mig inför mötet', CLIENT)?.kind).toBe('MEETING_PREP')
    expect(read('Varför Berglund?')).toMatchObject({
      kind: 'WHY_PRIORITY',
      namedClient: { id: 'cl-berglund' },
    })
    expect(read('Varför just nu?', CLIENT)?.kind).toBe('WHY_PRIORITY')
    expect(read('Why Henrik?', MARKET)?.kind).toBe('WHY_PRIORITY')
  })
})
