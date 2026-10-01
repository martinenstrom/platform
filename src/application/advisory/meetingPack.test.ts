/**
 * The Meeting Pack over the synthetic seed on the frozen clock: the rich
 * financing case (Anna & Per), the liquidity and refinancing case (Henrik),
 * the quiet client, stale information, no market relevance, no financing,
 * no open promises, no historical baseline — and the record that cannot
 * bear a pack at all. Every section is the cockpit's; readiness is typed;
 * the outline follows the content; the fingerprint follows the record.
 */

import { describe, expect, it } from 'vitest'
import type { MarketCategory, MarketObservation } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import {
  syntheticClients,
  type AdvisorySeed,
} from '~/infrastructure/advisory/syntheticClients'
import { meetingCockpit } from './meetingCockpit'
import { fingerprintOf, meetingPack, outlineOf, readinessOf } from './meetingPack'
import { client360 } from './client360'
import type { AdvisoryContext } from './ports'

const TODAY = '2026-09-23'
const NOW = `${TODAY}T07:30:00.000Z`

const obs = (
  symbol: string,
  category: MarketCategory,
  change: number,
  tags: MarketObservation['tags'] = {},
): MarketObservation => ({
  symbol,
  category,
  label: symbol,
  value: 100,
  change,
  changeUnit: category === 'rates' ? 'bp' : 'percent',
  observedAt: NOW,
  source: 'test',
  quality: 'live',
  tags,
})

const RATES_UP = [obs('rate:us10y', 'rates', 32, { region: 'us' })]

function contextWith(
  observations: readonly MarketObservation[] = [],
  seed: AdvisorySeed = syntheticClients(TODAY),
): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(seed),
    clock: new FakeClock(NOW),
    market: {
      scenario: null,
      async observe() {
        return observations
      },
    },
  }
}

describe('Anna & Per — the financing-rich pack', () => {
  it('is the cockpit arranged for a document, with every section the cockpit produced', async () => {
    const context = contextWith()
    const pack = (await meetingPack(context, 'cl-dahlqvist'))!
    const cockpit = (await meetingCockpit(context, 'cl-dahlqvist'))!
    expect(pack.method).toBe('meeting-pack-v1')
    expect(pack.audience).toBe('INTERNAL_ADVISOR')
    expect(pack.identity).toMatchObject({
      clientName: 'Anna & Per Dahlqvist',
      officeName: 'Arbetargatan',
      advisorName: 'Sofia',
    })
    expect(pack.meeting.mode).toBe('scheduled')
    expect(pack.meeting.date).toBe(cockpit.meeting.event!.occursOn)
    expect(pack.meetingFocus).toEqual(cockpit.focus)
    expect(pack.commitments).toEqual(cockpit.promises)
    expect(pack.financing).toEqual(cockpit.financing)
    expect(pack.possibleClientQuestions).toEqual(cockpit.clientQuestions)
    expect(pack.advisorQuestions).toEqual(cockpit.advisorQuestions)
    expect(pack.meetingObjectives).toEqual(cockpit.objectives)
    expect(pack.agenda).toEqual(cockpit.agenda)
    expect(pack.changesSinceLastMeeting).toEqual(cockpit.changes)
    expect(pack.dataAsOf).toBe(TODAY)
    expect(pack.provenance.baseline).toEqual(cockpit.baseline)
    expect(pack.provenance.sourceCount).toBe(pack.sources.length)
  })

  it('leads with the bridge financing, an overdue promise and a typed executive summary', async () => {
    const pack = (await meetingPack(contextWith(), 'cl-dahlqvist'))!
    expect(pack.financing.length).toBeGreaterThan(0)
    expect(pack.financing[0]!.questionKind).toBe('maturity-plan')
    expect(pack.topPriorities.length).toBeGreaterThan(0)
    expect(pack.topPriorities.length).toBeLessThanOrEqual(3)
    expect(pack.topPriorities[0]!.kind).toBe('focus-topic')
    expect(pack.executiveSummary[0]!.kind).toBe('focus')
    expect(pack.executiveSummary.map((p) => p.kind)).toContain('promise')
    /* A priority never repeats a record another priority already carries. */
    const ids = pack.topPriorities.flatMap((p) => p.sourceIds)
    expect(new Set(ids).size).toBe(ids.length)
    /* The overdue promise is a next step as it stands: open, the advisor's, not "proposed". */
    const overdue = pack.nextSteps.find((s) => s.status === 'overdue')
    expect(overdue).toMatchObject({ kind: 'commitment', owner: 'advisor' })
    expect(pack.nextSteps.filter((s) => s.status === 'proposed').length).toBeGreaterThan(
      0,
    )
  })

  it('is ready, with a full outline and a stable fingerprint', async () => {
    const context = contextWith()
    const pack = (await meetingPack(context, 'cl-dahlqvist'))!
    expect(pack.readiness.state).toBe('REDO')
    expect(pack.outline.core).toEqual(
      expect.arrayContaining([
        'executive',
        'glance',
        'wealth',
        'portfolio',
        'financing',
        'plan',
        'next-steps',
      ]),
    )
    expect(pack.outline.appendix).toContain('appendix-sources')
    const again = (await meetingPack(context, 'cl-dahlqvist'))!
    expect(again.fingerprint).toBe(pack.fingerprint)
    expect(pack.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('carries the market history as context and marks its as-of', async () => {
    const pack = (await meetingPack(contextWith(RATES_UP), 'cl-dahlqvist'))!
    expect(pack.marketContext.length).toBeGreaterThan(0)
    expect(pack.provenance.marketDataAsOf).toBe(NOW)
    expect(pack.outline.core).toContain('market')
    const quiet = (await meetingPack(contextWith(), 'cl-dahlqvist'))!
    expect(quiet.marketContext).toEqual([])
    expect(quiet.provenance.marketDataAsOf).toBeNull()
    expect(quiet.outline.core).not.toContain('market')
  })

  it('names no source it cannot title', async () => {
    const pack = (await meetingPack(contextWith(), 'cl-dahlqvist'))!
    for (const source of pack.sources) {
      expect(source.label.length).toBeGreaterThan(0)
      expect(pack.titles[source.id] ?? source.label).toBeTruthy()
    }
  })
})

describe('Henrik — liquidity, portfolio and refinancing, with stale information', () => {
  it('asks for review because the company valuation is old, and says so with the date', async () => {
    const pack = (await meetingPack(contextWith(), 'cl-alvarsson'))!
    expect(pack.readiness.state).toBe('GRANSKA')
    const stale = pack.readiness.reasons.find((r) => r.kind === 'stale-valuation')
    expect(stale).toMatchObject({ severity: 'review' })
    expect(stale?.date).toBeTruthy()
    expect((stale?.daysOld ?? 0) >= 180).toBe(true)
    expect(pack.liquidity.excess).not.toBeNull()
    expect(
      pack.strategy.observations.some((o) => o.kind === 'allocation-deviation'),
    ).toBe(true)
    expect(
      pack.financing.some((f) => f.questionKind === 'flexibility-vs-certainty'),
    ).toBe(true)
  })
})

describe('the quiet client and the sparse records', () => {
  it('builds a shorter pack for a quiet client and never pads it', async () => {
    const pack = (await meetingPack(contextWith(), 'cl-ekstrand'))!
    const rich = (await meetingPack(contextWith(), 'cl-dahlqvist'))!
    expect(pack.outline.core.length).toBeLessThan(rich.outline.core.length)
    expect(pack.outline.core).not.toContain('market')
    expect(pack.outline.core).not.toContain('since-last')
  })

  it('states the missing baseline and the unbooked meeting as review reasons, not as facts', async () => {
    const pack = (await meetingPack(contextWith(), 'cl-grahn'))!
    expect(pack.readiness.reasons.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['no-baseline']),
    )
    expect(pack.provenance.baseline).toBeNull()
    expect(pack.outline.appendix).not.toContain('appendix-baseline')
    if (pack.meeting.mode === 'unscheduled') {
      expect(pack.readiness.reasons.map((r) => r.kind)).toContain('no-scheduled-meeting')
    }
  })

  it('builds without open promises when none are open', async () => {
    const seed = syntheticClients(TODAY)
    const context = contextWith([], {
      ...seed,
      commitments: seed.commitments.filter((c) => c.clientId !== 'cl-ekstrand'),
    })
    const pack = (await meetingPack(context, 'cl-ekstrand'))!
    expect(pack.commitments).toEqual([])
    expect(pack.nextSteps.every((s) => s.status === 'proposed')).toBe(true)
    expect(pack.readiness.state).not.toBe('BLOCKERAD')
  })

  it('has no financing slide for a client without loans', async () => {
    const seed = syntheticClients(TODAY)
    const context = contextWith([], {
      ...seed,
      liabilities: seed.liabilities.filter((l) => l.clientId !== 'cl-berglund'),
      events: seed.events.filter(
        (e) =>
          !(
            e.clientId === 'cl-berglund' &&
            ['loan-maturity', 'mortgage-refinancing'].includes(e.type)
          ),
      ),
    })
    const pack = (await meetingPack(context, 'cl-berglund'))!
    expect(pack.financing).toEqual([])
    expect(pack.outline.core).not.toContain('financing')
    expect(pack.outline.appendix).not.toContain('appendix-loans')
    expect(pack.wealth.totalLiabilities).toBe(0)
  })

  it('blocks a record with no valued assets rather than draw an empty balance sheet', async () => {
    const seed = syntheticClients(TODAY)
    const context = contextWith([], {
      ...seed,
      assets: seed.assets.filter((a) => a.clientId !== 'cl-ceder'),
      portfolios: seed.portfolios.filter((p) => p.clientId !== 'cl-ceder'),
    })
    const pack = (await meetingPack(context, 'cl-ceder'))!
    expect(pack.readiness.state).toBe('BLOCKERAD')
    expect(pack.readiness.reasons.find((r) => r.severity === 'block')?.kind).toBe(
      'no-valued-assets',
    )
  })
})

describe('the depth', () => {
  it("keeps the executive brief to five slides at most and to the first two slides' answers", async () => {
    const context = contextWith()
    const brief = (await meetingPack(context, 'cl-dahlqvist', 'executive'))!
    expect(brief.depth).toBe('executive')
    expect(brief.outline.core.length).toBeGreaterThanOrEqual(3)
    expect(brief.outline.core.length).toBeLessThanOrEqual(5)
    expect(brief.outline.core.slice(0, 2)).toEqual(['executive', 'glance'])
    expect(brief.outline.appendix).toEqual([])
    const full = (await meetingPack(context, 'cl-dahlqvist', 'full'))!
    expect(full.fingerprint).not.toBe(brief.fingerprint)
  })
})

describe('the readiness gate and the fingerprint, as functions', () => {
  it('derives readiness from the views alone', async () => {
    const context = contextWith()
    const view = (await client360(context, 'cl-dahlqvist'))!
    const cockpit = (await meetingCockpit(context, 'cl-dahlqvist'))!
    expect(readinessOf(view, cockpit)).toEqual({
      state: 'REDO',
      reasons: [],
      method: 'pack-readiness-v1',
    })
  })

  it('ignores the timestamps that move without the record moving', () => {
    const a = fingerprintOf({ x: 1, generatedAt: 'a', nested: { assessedAt: 'b' } })
    const b = fingerprintOf({ x: 1, generatedAt: 'c', nested: { assessedAt: 'd' } })
    const c = fingerprintOf({ x: 2, generatedAt: 'a', nested: { assessedAt: 'b' } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('never lists a slide the record does not justify', async () => {
    const pack = (await meetingPack(contextWith(), 'cl-dahlqvist'))!
    const outline = outlineOf({ ...pack, marketContext: [], financing: [] }, 'full')
    expect(outline.core).not.toContain('market')
    expect(outline.core).not.toContain('financing')
  })
})
