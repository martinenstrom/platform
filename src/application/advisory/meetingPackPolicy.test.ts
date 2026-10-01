/**
 * The export policy: every content section of the pack is classified,
 * the internal ones are absent — not blanked — from a client-facing pack,
 * and only the internal advisor pack can be generated in V1.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { meetingPack } from './meetingPack'
import {
  forAudience,
  GENERATABLE_AUDIENCES,
  INTERNAL_SECTION_KEYS,
  isGeneratable,
  PACK_META_KEYS,
  PACK_SECTION_CLASSIFICATION,
  SHAREABLE_SECTION_KEYS,
} from './meetingPackPolicy'

const TODAY = '2026-09-23'

async function pack() {
  const context = {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
  return (await meetingPack(context, 'cl-dahlqvist'))!
}

describe('the classification', () => {
  it('covers every key a real pack carries, as metadata or as a classified section', async () => {
    const built = await pack()
    const classified = new Set<string>([
      ...PACK_META_KEYS,
      ...Object.keys(PACK_SECTION_CLASSIFICATION),
    ])
    for (const key of Object.keys(built)) expect(classified.has(key), key).toBe(true)
  })

  it("keeps the firm's judgement and the advisor's business internal", () => {
    for (const key of [
      'relationshipHealth',
      'sentinelContext',
      'commitments',
      'opportunities',
      'risks',
      'dataQuality',
      'possibleClientQuestions',
      'advisorQuestions',
      'readiness',
      'meetingFocus',
      'executiveSummary',
      'topPriorities',
      'dontForget',
      'nextSteps',
      'appendix',
      'sources',
    ] as const) {
      expect(PACK_SECTION_CLASSIFICATION[key], key).toBe('internal')
    }
    for (const key of [
      'identity',
      'wealth',
      'portfolio',
      'financing',
      'goals',
      'agenda',
    ] as const) {
      expect(PACK_SECTION_CLASSIFICATION[key], key).toBe('shareable')
    }
    expect(INTERNAL_SECTION_KEYS.length + SHAREABLE_SECTION_KEYS.length).toBe(
      Object.keys(PACK_SECTION_CLASSIFICATION).length,
    )
  })
})

describe('the audiences', () => {
  it('generates the internal advisor pack only', () => {
    expect(GENERATABLE_AUDIENCES).toEqual(['INTERNAL_ADVISOR'])
    expect(isGeneratable('INTERNAL_ADVISOR')).toBe(true)
    expect(isGeneratable('FUTURE_CLIENT')).toBe(false)
  })

  it('leaves no internal section on a client-facing pack — absent, not emptied', async () => {
    const built = await pack()
    const facing = forAudience(built, 'FUTURE_CLIENT')
    expect(facing.audience).toBe('FUTURE_CLIENT')
    for (const key of INTERNAL_SECTION_KEYS) expect(key in facing, key).toBe(false)
    for (const key of SHAREABLE_SECTION_KEYS) expect(key in facing, key).toBe(true)
    expect(facing.identity.clientName).toBe('Anna & Per Dahlqvist')
    const internal = forAudience(built, 'INTERNAL_ADVISOR')
    expect(internal.sentinelContext).toEqual(built.sentinelContext)
  })
})
