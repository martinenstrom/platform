/**
 * The invariant as a table: for every product state the firm can return, the
 * promise of delegated work is produced for `working` and for nothing else.
 */

import { describe, expect, it } from 'vitest'
import type { HostResult } from '~/application/analysis/hostContract'
import {
  ACKNOWLEDGEMENT_PATTERN,
  BRIDGING_PATTERN,
  LIVE_BACKEND_INSTRUCTIONS,
  LIVE_TYPED_CONTEXT,
  LIVE_VOICE_INSTRUCTIONS,
  MARKET_UNAVAILABLE,
  toolSpeech,
  unsupportedSpeech,
  WORKING_ACKNOWLEDGEMENT,
} from './liveSpeech'

const reference = { system: 'financial-os', kind: 'case', id: 'case-1', provenanceId: 'p' } as const
const context = {
  reference,
  question: 'Är Nvidia köpvärd?',
  subject: 'Nvidia',
  surfaces: { boardroom: '/cases/case-1', record: '/cases/case-1/underlag' },
  activity: {
    stage: 'research' as const,
    desks: [{ id: 'rates', name: 'Rates', isGovernance: false }],
    outstanding: [],
    inFlight: 1,
    expired: 0,
    awaitingAdoption: 0,
  },
  amendments: { count: 0, latestAt: null, workPredates: false },
}
const AT = '2026-09-16T08:00:00.000Z'

const results: Record<string, HostResult> = {
  working: { ...context, state: 'working' },
  closed: {
    ...context,
    state: 'closed',
    closure: { kind: 'cancelled', reason: 'På användarens begäran i samtalet.', at: AT, byDesk: null },
  },
  settled: { state: 'failed', reason: 'case-settled', reference },
  needsDecision: {
    ...context,
    state: 'needs-decision',
    decision: { reason: 'institutional-initialization-required' },
  },
  blocked: {
    ...context,
    state: 'blocked',
    block: { reason: 'verification-required', owner: { id: 'verification', name: 'Verification', isGovernance: true } },
  },
  unsupported: { state: 'unsupported', reason: 'not-routable' },
  failedOperator: { state: 'failed', reason: 'operator-unresolved', code: 'NOT_CONFIGURED' },
  failedService: { state: 'failed', reason: 'service-unavailable' },
  answerReady: {
    ...context,
    state: 'answer-ready',
    kind: 'committee-conclusion',
    answer: {
      kind: 'committee-conclusion',
      thesis: {
        revisionId: 'rev-2',
        statement: 'Kurvan prisar in en mjuklandning.',
        position: 'hold',
        invalidationCriteria: 'Realräntorna stiger över 2,5 %.',
        implications: [],
        proposedByDepartmentId: 'research-office',
      },
      synthesisedBy: null,
      scrutiny: { verification: 'verified', risk: null, peerExaminations: 0, devilsAdvocateReviews: 1 },
      dissent: [],
      materialDissentCount: 0,
    },
  },
}

describe('the acknowledgement of delegated work', () => {
  it('is produced for working, and carries the firm’s activity', () => {
    const speech = toolSpeech(results.working!)
    expect(speech.acknowledgeWork).toBe(true)
    expect(speech.say.startsWith(WORKING_ACKNOWLEDGEMENT)).toBe(true)
    expect(speech.say).toContain('Rates')
    expect(speech.reference).toEqual(reference)
    expect(ACKNOWLEDGEMENT_PATTERN.test(speech.say)).toBe(true)
  })

  it('is never produced for any other state, in words or in the flag', () => {
    for (const [name, result] of Object.entries(results)) {
      if (name === 'working') continue
      const speech = toolSpeech(result)
      expect(speech.acknowledgeWork, name).toBe(false)
      expect(ACKNOWLEDGEMENT_PATTERN.test(speech.say), `${name}: ${speech.say}`).toBe(false)
    }
  })

  it('asks the one human question rather than promising a return, and never for a thesis', () => {
    const speech = toolSpeech(results.needsDecision!)
    expect(speech.decisionRequired).toBe(true)
    expect(speech.say).toContain('En sak innan de sätter igång.')
    expect(speech.say).toContain('din egen syn')
    expect(speech.say.toLowerCase()).not.toContain('utgångstes')
  })

  it('says what stopped the firm, and who holds it', () => {
    expect(toolSpeech(results.blocked!).say).toBe(
      'Analysen kan inte fortsätta just nu. Faktagranskningen är inte gjord. Ligger hos Verification.',
    )
  })

  it('tells the truth about an unresolved operator', () => {
    const speech = toolSpeech(results.failedOperator!)
    expect(speech.say).toContain('Ingen operatör är konfigurerad')
    expect(speech.reference).toBeNull()
  })

  it('reads the committee’s conclusion off the typed answer, dissent included', () => {
    const speech = toolSpeech(results.answerReady!)
    expect(speech.say).toContain('Jag är klar.')
    expect(speech.say).toContain('Kommitténs slutsats är hold')
    expect(speech.say).toContain('Ingen materiell invändning kvarstår.')
  })

  it('refuses what it cannot do honestly, with no promise in it', () => {
    for (const reason of ['no-open-case', 'unknown-tool', 'invalid-arguments'] as const) {
      const speech = unsupportedSpeech(reason)
      expect(speech.acknowledgeWork).toBe(false)
      expect(speech.reference).toBeNull()
      expect(ACKNOWLEDGEMENT_PATTERN.test(speech.say)).toBe(false)
    }
    expect(unsupportedSpeech('no-open-case').say).toContain('inget pågående ärende')
  })
})

describe('the opening, said aloud (2026-09-17)', () => {
  const macro = { id: 'global-macro', name: 'Global Macro', isGovernance: false }
  const rates = { id: 'rates', name: 'Rates', isGovernance: false }
  const gold = { ...context, question: 'Kolla med kommittén varför guld är upp idag.', subject: 'Guld' }

  it('says what the desks were asked, who started on what, and that JARVIS will return — nothing else', () => {
    const speech = toolSpeech(
      {
        ...gold,
        state: 'working',
        commission: {
          evidence: { family: 'us-par-curve', from: '2026-08-18', to: '2026-09-17', observations: 220 },
          started: [macro, rates],
          adopted: [],
          withheld: [{ desk: { id: 'quant-technical', name: 'Quant & Technical', isGovernance: false }, reason: 'dependencies-not-met' }],
        },
      },
      'begin',
      { kind: 'explanation', focus: ['makro', 'flöden', 'specifika händelser'] },
    )
    expect(speech.say).toBe(
      'Absolut. Jag ber dem ta reda på vad som driver guld idag — makro, flöden, specifika händelser. Global Macro och Rates har börjat, med den amerikanska räntekurvan som underlag. Jag återkommer när det är klart.',
    )
    expect(speech.acknowledgeWork).toBe(true)
    expect(speech.decisionRequired).toBe(false)
    expect(speech.reference).toEqual(reference)
  })

  it('says plainly, once, why no desk could start, and promises no return', () => {
    const speech = toolSpeech(
      {
        ...gold,
        state: 'blocked',
        block: { reason: 'analysis-required', owner: macro },
        commission: { evidence: null, started: [], adopted: [], withheld: [{ desk: null, reason: 'no-evidence-basis' }] },
      },
      'begin',
      { kind: 'explanation', focus: ['makro'] },
    )
    expect(speech.say).toBe(
      'Absolut. Jag ber dem ta reda på vad som driver guld idag — makro. Men borden kan inte börja än — firman har inget registrerat underlag för den här sortens fråga än.',
    )
    expect(speech.acknowledgeWork).toBe(false)
    expect(ACKNOWLEDGEMENT_PATTERN.test(speech.say)).toBe(false)
  })

  it('words a position from the person’s view, or as an open examination', () => {
    const usa = { ...context, question: 'Borde jag minska min USA-exponering?', subject: 'USA-exponering' }
    const commission = { evidence: null, started: [macro], adopted: [], withheld: [] }
    expect(
      toolSpeech({ ...usa, state: 'working', commission }, 'begin', {
        kind: 'position',
        focus: ['värdering'],
        view: { statement: 'Jag är negativ till USA.', position: 'reduce' },
      }).say,
    ).toContain('Jag ber dem pröva din syn på USA-exponering mot värdering.')
    expect(toolSpeech({ ...usa, state: 'working', commission }, 'begin', { kind: 'position', focus: [], view: null }).say).toContain(
      'Jag ber dem pröva frågan om USA-exponering öppet.',
    )
  })

  it('never uses the words of a form', () => {
    for (const text of [LIVE_VOICE_INSTRUCTIONS, LIVE_BACKEND_INSTRUCTIONS]) {
      expect(text).toContain('klartecken')
    }
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('begin_delegation')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('EN kort mänsklig fråga')
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('Fråga ALDRIG efter en tes')
  })
})

describe('the two acts on the open case', () => {
  const withAdditions = (result: HostResult, count: number, workPredates: boolean): HostResult =>
    ({ ...result, amendments: { count, latestAt: AT, workPredates } }) as HostResult

  it('leads with the addition having landed, and asks for the decision the case still needs', () => {
    const speech = toolSpeech(withAdditions(results.needsDecision!, 1, false), 'amend')
    expect(speech.say.startsWith('Tillagt i ärendet.')).toBe(true)
    expect(speech.say).not.toContain('tar inte hänsyn')
    expect(speech.say).toContain('En sak innan de sätter igång.')
    expect(speech.decisionRequired).toBe(true)
    expect(speech.acknowledgeWork).toBe(false)
    expect(speech.reference).toEqual(reference)
  })

  it('says when work already done predates the addition, and promises work only while the firm works', () => {
    const working = toolSpeech(withAdditions(results.working!, 2, true), 'amend')
    expect(working.say).toBe(
      `Tillagt i ärendet. Det arbete som redan gjorts tar inte hänsyn till det. ${WORKING_ACKNOWLEDGEMENT}`,
    )
    expect(working.acknowledgeWork).toBe(true)
    const blocked = toolSpeech(withAdditions(results.blocked!, 1, true), 'amend')
    expect(blocked.say).toBe('Tillagt i ärendet. Det arbete som redan gjorts tar inte hänsyn till det.')
    expect(blocked.acknowledgeWork).toBe(false)
    expect(ACKNOWLEDGEMENT_PATTERN.test(blocked.say)).toBe(false)
  })

  it('reads the additions beside the state when the person only asks', () => {
    const working = toolSpeech(withAdditions(results.working!, 1, true), 'status')
    expect(working.say.startsWith(WORKING_ACKNOWLEDGEMENT)).toBe(true)
    expect(working.say).toContain(
      'Ett tillägg sedan ärendet öppnades; det arbete som redan gjorts tar inte hänsyn till det senaste.',
    )
    const blocked = toolSpeech(withAdditions(results.blocked!, 1, false), 'status')
    expect(blocked.say).toContain('Ett tillägg sedan ärendet öppnades.')
    expect(blocked.acknowledgeWork).toBe(false)
  })

  it('confirms a closure only from the closed state the firm read back, and says how it was closed', () => {
    const afterClose = toolSpeech(results.closed!, 'close')
    expect(afterClose.say).toBe(
      'Ärendet är stängt. Pågående arbete avbröts — På användarens begäran i samtalet.',
    )
    expect(afterClose.acknowledgeWork).toBe(false)
    expect(afterClose.decisionRequired).toBe(false)
    expect(afterClose.reference).toEqual(reference)
    /* Asked about later, a closed case reads the same. */
    expect(toolSpeech(results.closed!, 'status').say).toBe(afterClose.say)
  })

  it('says a settled case cannot be changed, and promises nothing', () => {
    for (const act of ['amend', 'close'] as const) {
      const speech = toolSpeech(results.settled!, act)
      expect(speech.say).toContain('Ärendet är redan avslutat')
      expect(speech.acknowledgeWork).toBe(false)
      expect(speech.decisionRequired).toBe(false)
    }
  })
})

describe('the instructions', () => {
  it('forbid the voice the sentence, and tell the backend the flags mean what they say', () => {
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('Säg ALDRIG själv "Jag kollar på det och återkommer"')
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('Talar användaren engelska svarar du på engelska')
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('Inga "ehm"')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('Är acknowledgeWork false får du inte säga att du återkommer')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('delegate_to_financial_os')
  })

  it('route by consequence: what is happening is JARVIS from fresh data, what to do with capital is the firm', () => {
    /* The voice hands market questions to the backend and never quotes a level from memory. */
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('Säg ALDRIG nivåer eller dagsrörelser ur minnet')
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('"Amerikanska börsen" betyder S&P 500 och Nasdaq 100')
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('Be ALDRIG om en tes, ett scenario eller ett förtydligande kring en vanlig fråga om marknaden')
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('en finansfråga är inte automatiskt ett ärende')
    /* The backend reads the snapshot first, answers in two to five sentences, and opens no case for it. */
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('get_market_snapshot FÖRST')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('två till fem meningar')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('Inget ärende, ingen kommitté, ingen tes, inget scenario')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('Nivåer ur minnet är förbjudna')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('kalla det aldrig VIX')
    /* Valuation is reasoning, never a case by itself — measured: under low effort it was delegated. */
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('är resonemang du gör själv, inte ett ärende')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('En fråga om vad som händer är inte en investeringsbedömning')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('VAD SKA JAG GÖRA MED KAPITAL? — investeringskommittén')
  })

  it('measure the first useful word past a whole bridging sentence, not just its first words', () => {
    /* Measured by voice 2026-09-17: "Jag kollar den senaste nivån." is a wait, however it ends. */
    for (const opening of [
      'Jag kollar den senaste nivån. ',
      'Jag tar fram senaste rörelsen. ',
      '[hum] Jag kollar. ',
      'Mm, jag kollar. ',
      'Ja, ett ögonblick. ',
      'Ja, jag ser på det. ',
      'Ett ögonblick. Jag kollar nu. ',
    ]) {
      expect(`${opening}Tioåringen ligger på 5,01 procent.`.replace(BRIDGING_PATTERN, ''), opening).toBe('Tioåringen ligger på 5,01 procent.')
    }
    /* Content that merely begins with "jag" is content. */
    expect('Jag har tyvärr inte aktuella siffror för Nasdaq nu.'.replace(BRIDGING_PATTERN, '')).toBe(
      'Jag har tyvärr inte aktuella siffror för Nasdaq nu.',
    )
    expect('S&P 500 föll 0,45 procent.'.replace(BRIDGING_PATTERN, '')).toBe('S&P 500 föll 0,45 procent.')
  })

  it('tell the voice to say a routed typed answer, and never to answer the question itself', () => {
    const content = LIVE_TYPED_CONTEXT.speak('Hur går börsen?', 'S&P 500 är upp 0,4 procent.')
    expect(content).toContain('«Hur går börsen?»')
    expect(content).toContain('«S&P 500 är upp 0,4 procent.»')
    expect(content).toContain('Svara inte på frågan själv.')
    expect(LIVE_TYPED_CONTEXT.channel).toContain('Kanalen är text')
    expect(MARKET_UNAVAILABLE).not.toMatch(/återkommer/)
  })

  it('forbid a claimed act the firm did not confirm, and an acknowledgement said out of habit', () => {
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('Påstå aldrig att du gjort något som backend inte bekräftat')
    expect(LIVE_VOICE_INSTRUCTIONS).toContain('säg INTE "Ett ögonblick" av vana')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('add_to_delegation')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('close_case')
    expect(LIVE_BACKEND_INSTRUCTIONS).toContain('Påstå aldrig att något lagts till, stängts eller gjorts om verktyget inte bekräftade det')
  })

  it('name no command, no actor and no playbook the voice could reach for', () => {
    for (const text of [LIVE_VOICE_INSTRUCTIONS, LIVE_BACKEND_INSTRUCTIONS]) {
      expect(text).not.toMatch(/AcceptContribution|RecordVerification|actorEmployeeId|playbookEntryKey|mandate/i)
    }
  })
})
