/**
 * The invariant as a table: for every product state the firm can return, the
 * promise of delegated work is produced for `working` and for nothing else.
 */

import { describe, expect, it } from 'vitest'
import type { HostResult } from '~/application/analysis/hostContract'
import {
  ACKNOWLEDGEMENT_PATTERN,
  LIVE_BACKEND_INSTRUCTIONS,
  LIVE_VOICE_INSTRUCTIONS,
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

  it('asks for the person’s decision rather than promising a return', () => {
    const speech = toolSpeech(results.needsDecision!)
    expect(speech.decisionRequired).toBe(true)
    expect(speech.say).toContain('Jag behöver ditt beslut på en sak.')
    expect(speech.say).toContain('saknar en utgångstes')
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

describe('the two acts on the open case', () => {
  const withAdditions = (result: HostResult, count: number, workPredates: boolean): HostResult =>
    ({ ...result, amendments: { count, latestAt: AT, workPredates } }) as HostResult

  it('leads with the addition having landed, and asks for the decision the case still needs', () => {
    const speech = toolSpeech(withAdditions(results.needsDecision!, 1, false), 'amend')
    expect(speech.say.startsWith('Tillagt i ärendet.')).toBe(true)
    expect(speech.say).not.toContain('tar inte hänsyn')
    expect(speech.say).toContain('Jag behöver ditt beslut på en sak.')
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
