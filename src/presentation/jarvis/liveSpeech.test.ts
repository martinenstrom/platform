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
}

const results: Record<string, HostResult> = {
  working: { ...context, state: 'working' },
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

  it('refuses a note on an open case honestly, with no promise in it', () => {
    for (const reason of ['context-not-supported', 'no-open-case', 'unknown-tool', 'invalid-arguments'] as const) {
      const speech = unsupportedSpeech(reason)
      expect(speech.acknowledgeWork).toBe(false)
      expect(ACKNOWLEDGEMENT_PATTERN.test(speech.say)).toBe(false)
    }
    expect(unsupportedSpeech('context-not-supported').say).toContain('inte att lägga till i ärendet ännu')
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

  it('name no command, no actor and no playbook the voice could reach for', () => {
    for (const text of [LIVE_VOICE_INSTRUCTIONS, LIVE_BACKEND_INSTRUCTIONS]) {
      expect(text).not.toMatch(/AcceptContribution|RecordVerification|actorEmployeeId|playbookEntryKey|mandate/i)
    }
  })
})
