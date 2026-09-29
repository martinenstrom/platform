/**
 * The hardening pass, proved over the synthetic seed on a frozen clock:
 * many events become one advisor-facing episode with the events intact and
 * unrelated moves apart; an expired event stays queryable as history and
 * boosts no priority; financial and conversation relevance stay distinct;
 * a move nobody holds anything against stays silent; and every client
 * keeps exactly one priority whatever the market does.
 */

import { describe, expect, it } from 'vitest'
import {
  MATERIALITY,
  type MarketCategory,
  type MarketObservation,
  type MaterialityPolicy,
} from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { dashboardEpisodes } from '~/presentation/advisory/marketImpactText'
import { client360 } from './client360'
import { groupMarketEpisodes } from './marketEpisodes'
import { marketImpactBrief } from './marketImpact'
import { prepareMeeting } from './meetingPrep'
import type { AdvisoryContext } from './ports'
import { sentinelBrief } from './sentinel'

const TODAY = '2026-09-23'
const NOW = `${TODAY}T07:30:00.000Z`

const obs = (
  symbol: string,
  category: MarketCategory,
  change: number | null,
  tags: MarketObservation['tags'] = {},
  extra: Partial<MarketObservation> = {},
): MarketObservation => ({
  symbol,
  category,
  label: symbol,
  value: category === 'risk-appetite' ? 50 + (change ?? 0) : 100,
  change,
  changeUnit:
    category === 'rates' ? 'bp' : category === 'risk-appetite' ? 'points' : 'percent',
  observedAt: NOW,
  source: 'test',
  quality: 'live',
  tags,
  ...extra,
})

const SELLOFF: MarketObservation[] = [
  obs('idx:nasdaq100', 'equities', -3.2, { region: 'us' }),
  obs('idx:sp500', 'equities', -2.4, { region: 'us' }),
  obs('idx:omxs30', 'equities', -2.1, { region: 'sweden' }),
  obs('idx:dax', 'equities', -1.9, { region: 'europe' }),
  obs('idx:ftse100', 'equities', -1.6, { region: 'europe' }),
]

const RATES_UP: MarketObservation[] = [
  obs('rate:se10y', 'rates', 18, { currency: 'SEK' }),
  obs('rate:de10y', 'rates', 12, { currency: 'EUR' }),
  obs('rate:us10y', 'rates', 14, { currency: 'USD' }),
]

const ENERGY_DOWN: MarketObservation[] = [
  obs('sector:energy', 'sectors', -4.5, { sector: 'energy' }, { reference: 0.41 }),
  obs('cmd:brent', 'commodities', -5.2, { commodityClass: 'energy' }),
]

const GOLD_UP = [obs('cmd:gold', 'commodities', 4.1, { commodityClass: 'metal' })]

const RISK_OFF: MarketObservation[] = [
  obs('sentiment:cross-asset', 'risk-appetite', -26),
  obs('idx:sp500', 'equities', -1.8, { region: 'us' }),
]

type TestContext = AdvisoryContext & {
  setMarket(next: readonly MarketObservation[]): void
  setNow(iso: string): void
}

function contextWith(observations: readonly MarketObservation[]): TestContext {
  let current = observations
  const context: TestContext = {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(NOW),
    market: {
      scenario: 'test',
      async observe() {
        return current
      },
    },
    setMarket(next) {
      current = next
    },
    setNow(iso) {
      context.clock = new FakeClock(iso)
    },
  }
  return context
}

describe('market episodes', () => {
  it('five index moves in one selloff are one episode, with every event inside it and intact', async () => {
    const brief = await marketImpactBrief(contextWith(SELLOFF))
    expect(brief.events).toHaveLength(5)
    expect(brief.episodes).toHaveLength(1)
    const [episode] = brief.episodes
    expect(episode).toMatchObject({
      kind: 'equity-selloff',
      direction: 'down',
      severity: 'major',
    })
    expect(episode!.events.map((e) => e.event.id)).toEqual(
      brief.events.map((e) => e.event.id),
    )
    /* The underlying entries are the brief's own, untouched: same affected lists, same counts. */
    for (const inner of episode!.events) {
      expect(inner).toBe(brief.events.find((e) => e.event.id === inner.event.id))
    }
    expect(episode!.high).toBeGreaterThanOrEqual(2)
    expect(episode!.meaningful).toBeGreaterThanOrEqual(episode!.high)
    expect(dashboardEpisodes(brief.episodes)).toHaveLength(1)
  })

  it('unrelated moves on the same day stay apart, and each event lands in exactly one episode', async () => {
    const brief = await marketImpactBrief(
      contextWith([...RATES_UP, ...ENERGY_DOWN, ...GOLD_UP]),
    )
    expect(brief.events).toHaveLength(6)
    expect(brief.episodes.map((e) => [e.kind, e.events.length])).toEqual(
      expect.arrayContaining([
        ['rates-up', 3],
        ['energy-selloff', 2],
        ['single', 1],
      ]),
    )
    const placed = brief.episodes.flatMap((e) => e.events.map((x) => x.event.id))
    expect([...placed].sort()).toEqual(brief.events.map((e) => e.event.id).sort())
    expect(new Set(placed).size).toBe(placed.length)
    /* The gold move reaches nobody: not on the dashboard, still in the workspace. */
    const gold = brief.episodes.find((e) => e.kind === 'single')!
    expect(gold.meaningful).toBe(0)
    expect(dashboardEpisodes(brief.episodes).map((e) => e.kind)).toEqual([
      'rates-up',
      'energy-selloff',
    ])
  })

  it('risk-off with equity weakness is one global risk-off episode', async () => {
    const brief = await marketImpactBrief(contextWith(RISK_OFF))
    expect(brief.episodes.map((e) => [e.kind, e.events.length])).toEqual([
      ['global-risk-off', 2],
    ])
  })

  it('does not group moves outside the time window, and never groups across direction', async () => {
    const monday = '2026-09-21T07:30:00.000Z'
    const brief = await marketImpactBrief(
      contextWith([
        obs('rate:se10y', 'rates', 18, { currency: 'SEK' }, { observedAt: monday }),
        obs('rate:us10y', 'rates', 14, { currency: 'USD' }),
        obs('rate:de10y', 'rates', -12, { currency: 'EUR' }),
      ]),
    )
    expect(brief.episodes.map((e) => e.kind).sort()).toEqual([
      'single',
      'single',
      'single',
    ])
  })

  it('is deterministic: the same events in any order give the same episodes', async () => {
    const forward = await marketImpactBrief(contextWith([...RATES_UP, ...ENERGY_DOWN]))
    const reversed = await marketImpactBrief(
      contextWith([...ENERGY_DOWN, ...RATES_UP].reverse()),
    )
    expect(reversed.episodes.map((e) => e.id)).toEqual(forward.episodes.map((e) => e.id))
    expect(groupMarketEpisodes([...forward.events].reverse()).map((e) => e.id)).toEqual(
      forward.episodes.map((e) => e.id),
    )
  })

  it('caps the dashboard at three episodes while the workspace keeps them all', async () => {
    const brief = await marketImpactBrief(
      contextWith([
        ...RATES_UP,
        ...ENERGY_DOWN,
        obs('fx:usdsek', 'fx', 1.6, { currency: 'USD' }),
        obs('idx:omxs30', 'equities', -2.1, { region: 'sweden' }),
      ]),
    )
    expect(brief.episodes.filter((e) => e.meaningful > 0).length).toBeGreaterThan(3)
    expect(dashboardEpisodes(brief.episodes)).toHaveLength(3)
  })
})

describe('active relevance versus historical events', () => {
  it('an expired event stays queryable as history on Client 360 and in the briefing, and boosts no priority', async () => {
    const context = contextWith(SELLOFF)
    const during = await sentinelBrief(context)
    expect(
      during.entries.find((e) => e.client.id === 'cl-ekstrand')?.priority.theme,
    ).toBe('market-impact')

    /* Thirty hours on, nothing observed: the equity events have expired. */
    const later = '2026-09-24T13:30:00.000Z'
    context.setNow(later)
    context.setMarket([])
    const brief = await marketImpactBrief(context)
    expect(brief.events).toEqual([])
    expect(brief.episodes).toEqual([])

    const after = await sentinelBrief(context)
    expect(after.quiet.map((c) => c.id)).toEqual(['cl-ekstrand'])
    expect(
      after.entries.some((e) => e.priority.drivers.some((d) => d.kind === 'market')),
    ).toBe(false)

    const view = (await client360(context, 'cl-ekstrand'))!
    expect(view.marketImpacts).toEqual([])
    expect(
      view.recentMarketHistory.map((c) => [
        c.impact.event.symbol,
        c.status,
        c.closeReason,
      ]),
    ).toEqual(expect.arrayContaining([['idx:nasdaq100', 'closed', 'expired']]))
    expect(view.recentMarketHistory.every((c) => c.impact.event.peakChange !== 0)).toBe(
      true,
    )

    const prep = (await prepareMeeting(context, 'cl-ekstrand'))!
    expect(prep.marketSinceLastMeeting.map((c) => c.status)).toEqual(
      expect.arrayContaining(['closed']),
    )
    expect(
      prep.marketSinceLastMeeting.some((c) => c.impact.event.symbol === 'idx:nasdaq100'),
    ).toBe(true)
  })

  it('a faded event is history at its peak, and the priority it created is gone', async () => {
    const context = contextWith(SELLOFF)
    await marketImpactBrief(context)
    const t1 = '2026-09-23T10:30:00.000Z'
    context.setNow(t1)
    context.setMarket(
      SELLOFF.map((o) => ({ ...o, change: (o.change ?? 0) / 8, observedAt: t1 })),
    )
    const brief = await marketImpactBrief(context)
    expect(brief.events).toEqual([])
    const state = await context.repositories.marketEvents.state()
    expect(state.history.map((h) => h.closeReason)).toEqual([
      'faded',
      'faded',
      'faded',
      'faded',
      'faded',
    ])
    expect(state.history.find((h) => h.symbol === 'idx:nasdaq100')).toMatchObject({
      peakChange: -3.2,
    })
    const sentinel = await sentinelBrief(context)
    expect(sentinel.quiet.map((c) => c.id)).toEqual(['cl-ekstrand'])
  })

  it('the briefing window starts at the last meeting, or thirty days back without one', async () => {
    const context = contextWith([])
    const henrik = (await prepareMeeting(context, 'cl-alvarsson'))!
    expect(henrik.marketWindowStart).toBe(henrik.lastMeeting!.date)
    const viktor = (await prepareMeeting(context, 'cl-ekstrand'))!
    expect(viktor.marketWindowStart).toBe(
      viktor.lastMeeting ? viktor.lastMeeting.date : '2026-08-24',
    )
  })
})

describe('financial relevance versus conversation relevance, on the seed', () => {
  it('keeps the two distinct and never relabels one as the other', async () => {
    const energy = await marketImpactBrief(contextWith(ENERGY_DOWN))
    const henrik = energy.events
      .find((e) => e.event.symbol === 'sector:energy')!
      .affected.find((a) => a.client.id === 'cl-alvarsson')!
    expect(henrik.impact).toMatchObject({
      relevance: 'high',
      financialRelevance: 'medium',
      conversationRelevance: 'high',
    })

    const selloff = await marketImpactBrief(contextWith(SELLOFF))
    const nasdaq = selloff.events.find((e) => e.event.symbol === 'idx:nasdaq100')!
    expect(
      nasdaq.affected.find((a) => a.client.id === 'cl-ekstrand')!.impact,
    ).toMatchObject({
      financialRelevance: 'high',
      conversationRelevance: 'none',
    })
    expect(
      nasdaq.affected.find((a) => a.client.id === 'cl-forsell')!.impact,
    ).toMatchObject({
      directness: 'contextual',
      financialRelevance: 'none',
    })
    /* The episode carries both verdicts per client, strongest across its events. */
    const episode = selloff.episodes[0]!
    const viktor = episode.affected.find((a) => a.client.id === 'cl-ekstrand')!
    expect(viktor).toMatchObject({
      financialRelevance: 'high',
      conversationRelevance: 'none',
    })
    expect(viktor.impacts.length).toBe(5)
  })
})

describe('what does not change', () => {
  it('a large move nobody holds anything against stays silent everywhere', async () => {
    const brief = await marketImpactBrief(contextWith(GOLD_UP))
    expect(brief.events).toHaveLength(1)
    expect(brief.episodes).toHaveLength(1)
    expect(brief.episodes[0]).toMatchObject({
      kind: 'single',
      meaningful: 0,
      affected: [],
    })
    expect(dashboardEpisodes(brief.episodes)).toEqual([])
    expect(brief.affectedClients).toBe(0)
    const sentinel = await sentinelBrief(contextWith(GOLD_UP))
    expect(sentinel.quiet.map((c) => c.id)).toEqual(['cl-ekstrand'])
  })

  it('one active priority per client holds under an episode of five events', async () => {
    const context = contextWith(SELLOFF)
    const brief = await marketImpactBrief(context)
    expect(brief.episodes).toHaveLength(1)
    const sentinel = await sentinelBrief(context)
    const ids = sentinel.entries.map((e) => e.client.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length + sentinel.quiet.length).toBe(7)
    const viktor = sentinel.entries.find((e) => e.client.id === 'cl-ekstrand')!
    /* The events stay independent drivers beneath the one priority; the episode adds none. */
    expect(viktor.priority.drivers.filter((d) => d.kind === 'market')).toHaveLength(5)
    expect(viktor.priority.theme).toBe('market-impact')
  })

  it('the context can carry a different materiality policy without touching detection or relevance code', async () => {
    const strict: MaterialityPolicy = {
      ...MATERIALITY,
      rates: { ...MATERIALITY.rates, enter: 30, exit: 20, major: 50 },
    }
    const context = contextWith(RATES_UP)
    context.materiality = strict
    const brief = await marketImpactBrief(context)
    expect(brief.events).toEqual([])
    context.materiality = undefined
    expect((await marketImpactBrief(context)).events).toHaveLength(3)
  })
})
