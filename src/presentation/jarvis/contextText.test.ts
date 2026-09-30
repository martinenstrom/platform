/**
 * The presence's words for its place: the label, the chip, the quick actions,
 * and what JARVIS already knows from the page's own loaded view.
 */

import { describe, expect, it } from 'vitest'
import { resolveJarvisContext } from '~/application/jarvis/context'
import {
  contextChip,
  contextLabel,
  contextNamesOf,
  jarvisKnows,
  quickActions,
} from './contextText'

describe('the context, named', () => {
  it('names the client, the meeting, the office and the pages', () => {
    const names = {
      clientName: 'Anna & Per Dahlqvist',
      meetingDate: '2026-10-02',
      officeName: 'Strandvägen',
    }
    expect(contextLabel(resolveJarvisContext('/clients/cl-dahlqvist'), names)).toBe(
      'Anna & Per Dahlqvist',
    )
    expect(
      contextLabel(resolveJarvisContext('/clients/cl-dahlqvist/meeting-prep'), names),
    ).toBe('Anna & Per Dahlqvist · Möte 2 okt')
    expect(
      contextLabel(resolveJarvisContext('/clients/office/of-strandvagen'), names),
    ).toBe('Strandvägen')
    expect(contextLabel(resolveJarvisContext('/clients'), names)).toBe('Klienter')
    expect(contextLabel(resolveJarvisContext('/sentinel'), names)).toBe('Sentinel')
    expect(contextLabel(resolveJarvisContext('/'), names)).toBe('Marknaden')
  })

  it('shrinks to a chip for the strip', () => {
    const names = { clientName: 'Anna & Per Dahlqvist', officeName: 'Strandvägen' }
    expect(contextChip(resolveJarvisContext('/clients/cl-dahlqvist'), names)).toBe('AD')
    expect(
      contextChip(resolveJarvisContext('/clients/office/of-strandvagen'), names),
    ).toBe('STRANDV')
    expect(contextChip(resolveJarvisContext('/headquarters'), names)).toBe('')
  })

  it('reads the names from what the page loaded', () => {
    const loaded = [
      { ok: true, operator: {} },
      {
        ok: true,
        view: {
          client: { displayName: 'Anna & Per Dahlqvist' },
          nextMeeting: { occursOn: '2026-10-02' },
        },
      },
    ]
    expect(contextNamesOf(loaded)).toEqual({
      clientName: 'Anna & Per Dahlqvist',
      meetingDate: '2026-10-02',
    })
    expect(
      contextNamesOf([{ ok: true, book: { office: { displayName: 'Strandvägen' } } }]),
    ).toEqual({
      officeName: 'Strandvägen',
    })
    expect(contextNamesOf([undefined, { ok: false }])).toEqual({})
  })

  it('offers client questions on a client and office questions in an office, none on the market', () => {
    expect(quickActions(resolveJarvisContext('/clients/cl-dahlqvist'))).toContain(
      'Vad har jag lovat?',
    )
    expect(
      quickActions(resolveJarvisContext('/clients/cl-dahlqvist/meeting-prep')),
    ).toContain('Vad kommer de sannolikt fråga om?')
    expect(quickActions(resolveJarvisContext('/clients/office/of-x'))).toContain(
      'Vilka kunder här behöver mig?',
    )
    expect(quickActions(resolveJarvisContext('/'))).toEqual([])
  })
})

describe('what JARVIS knows from the loaded view', () => {
  it('names the meeting, the overdue promise, the maturity and the concern', () => {
    const view = {
      today: '2026-09-23',
      nextMeeting: { occursOn: '2026-10-02', daysAhead: 9 },
      openCommitments: [{ overdue: true }, { overdue: false }],
      liabilities: [{ maturityDate: '2026-11-13' }, { maturityDate: null }],
      contextFacts: [
        { category: 'concern', status: 'active' },
        { category: 'preference', status: 'active' },
      ],
    }
    expect(jarvisKnows([{ ok: true, view }]).map((f) => f.text)).toEqual([
      'Möte om 9 dagar',
      '1 försenat åtagande',
      'Lån förfaller om 51 dagar',
      '1 aktiv oro',
    ])
  })

  it('knows nothing off a client page', () => {
    expect(jarvisKnows([{ ok: true, book: {} }, undefined])).toEqual([])
  })
})
