/**
 * JARVIS and the Meeting Pack: a pack command on the client or the meeting
 * resolves the client from the screen, answers with the readiness and the
 * contents, opens the preview itself, and passes the depth and the format
 * in the door it opens. A named other client gets the door offered, not
 * opened. A refresh names what changed since the last meeting.
 */

import { describe, expect, it } from 'vitest'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { answerPlainText } from '~/presentation/jarvis/advisoryAnswerText'
import { answerAdvisoryLine } from './advisoryAnswer'
import type { JarvisAnswer } from './answer'
import { resolveJarvisContext } from './context'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

async function answerOn(route: string, text: string): Promise<JarvisAnswer> {
  const turn = await answerAdvisoryLine(contextAt(), resolveJarvisContext(route), text)
  if (!turn) throw new Error(`no answer for "${text}" on ${route}`)
  return turn.answer
}

const items = (answer: JarvisAnswer, key: string) =>
  answer.sections.find((s) => s.key === key)?.items ?? []

describe('the pack commands on Anna & Per', () => {
  it('prepares the full pack from the cockpit and opens the preview', async () => {
    const answer = await answerOn(
      '/clients/cl-dahlqvist/meeting-prep',
      'Prepare full pack.',
    )
    expect(answer.intent).toBe('MEETING_PACK_FULL')
    expect(answer.about).toMatchObject({ kind: 'meeting', label: 'Anna & Per Dahlqvist' })
    expect(answer.sections.map((s) => s.key)).toEqual(['readiness', 'contents'])
    expect(items(answer, 'readiness')[0]).toMatchObject({
      kind: 'pack-readiness',
      nature: 'assessment',
    })
    expect(items(answer, 'contents')[0]).toMatchObject({
      kind: 'pack-outline',
      depth: 'full',
      nature: 'fact',
    })
    expect(answer.actions).toEqual([
      {
        kind: 'open-meeting-pack',
        href: '/clients/cl-dahlqvist/meeting-pack?depth=full&format=both',
      },
    ])
    expect(answer.opens).toBe('/clients/cl-dahlqvist/meeting-pack?depth=full&format=both')
    const text = answerPlainText(answer)
    expect(text).toMatch(/Redo · Underlaget kan genereras utan förbehåll/)
    expect(text).toMatch(/Fullt mötesunderlag: \d+ kärnbilder och \d+ bilagor/)
  })

  it('carries the format and the depth in the door: PowerPoint, PDF, executive', async () => {
    const pptx = await answerOn('/clients/cl-dahlqvist', 'Skapa PowerPoint inför mötet.')
    expect(pptx.intent).toBe('MEETING_PACK_PPTX')
    expect(pptx.opens).toBe('/clients/cl-dahlqvist/meeting-pack?depth=full&format=pptx')
    const pdf = await answerOn(
      '/clients/cl-dahlqvist',
      'Skapa PDF inför mötet på torsdag.',
    )
    expect(pdf.intent).toBe('MEETING_PACK_PDF')
    expect(pdf.opens).toBe('/clients/cl-dahlqvist/meeting-pack?depth=full&format=pdf')
    const brief = await answerOn(
      '/clients/cl-dahlqvist',
      'Ge mig en femslides executive brief.',
    )
    expect(brief.intent).toBe('MEETING_PACK_EXECUTIVE')
    expect(brief.opens).toBe(
      '/clients/cl-dahlqvist/meeting-pack?depth=executive&format=both',
    )
    expect(items(brief, 'contents')[0]).toMatchObject({
      kind: 'pack-outline',
      depth: 'executive',
    })
  })

  it('names what changed when asked to refresh the pack', async () => {
    const answer = await answerOn(
      '/clients/cl-dahlqvist/meeting-prep',
      'Uppdatera mötesunderlaget med det som hänt sedan sist.',
    )
    expect(answer.intent).toBe('MEETING_PACK_UPDATE')
    expect(answer.sections.map((s) => s.key)).toEqual([
      'readiness',
      'contents',
      'since-last',
    ])
    expect(items(answer, 'since-last').length).toBeGreaterThan(0)
    expect(answer.sources.length).toBeGreaterThan(0)
  })

  it('reports Henrik as a review pack, with the reasons as facts', async () => {
    const answer = await answerOn('/clients/cl-alvarsson', 'Prepare full pack.')
    const readiness = items(answer, 'readiness')
    expect(readiness[0]).toMatchObject({ kind: 'pack-readiness' })
    expect(
      readiness
        .slice(1)
        .every((i) => i.kind === 'readiness-reason' && i.nature === 'fact'),
    ).toBe(true)
    expect(answerPlainText(answer)).toMatch(/Granska/)
  })

  it('offers, but does not open, the door for a named other client', async () => {
    const turn = await answerAdvisoryLine(
      contextAt(),
      resolveJarvisContext('/clients/cl-dahlqvist'),
      'Skapa mötesunderlag för Henrik.',
    )
    expect(turn?.answer.intent).toBe('MEETING_PACK_FULL')
    expect(turn?.answer.about).toMatchObject({
      label: 'Henrik Alvarsson',
      switched: true,
    })
    expect(turn?.answer.opens).toBeUndefined()
    expect(turn?.answer.actions).toEqual(
      expect.arrayContaining([
        {
          kind: 'open-meeting-pack',
          href: '/clients/cl-alvarsson/meeting-pack?depth=full&format=both',
        },
      ]),
    )
    expect(turn?.context.clientId).toBe('cl-dahlqvist')
  })
})
