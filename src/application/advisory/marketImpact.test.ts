/**
 * Market-to-Client over the synthetic seed on the frozen clock, through a
 * market source the test controls: seven scenarios including the calm
 * market and the move nobody holds anything against, the brief they
 * produce, and Sentinel's one priority per client with the market beside
 * it — created, strengthened, deduplicated, and resolved when the move
 * fades.
 */

import { describe, expect, it } from 'vitest'
import type { MarketCategory, MarketObservation } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { client360 } from './client360'
import { marketImpactBrief } from './marketImpact'
import { prepareMeeting } from './meetingPrep'
import type { AdvisoryContext } from './ports'
import { disposePriority, sentinelBrief } from './sentinel'

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

const CALM: MarketObservation[] = [
  obs('rate:us10y', 'rates', 0, { currency: 'USD' }),
  obs('rate:se10y', 'rates', 2, { currency: 'SEK' }),
  obs('rate:de10y', 'rates', -4, { currency: 'EUR' }),
  obs('idx:sp500', 'equities', 0.41, { region: 'us' }),
  obs('idx:nasdaq100', 'equities', -0.28, { region: 'us' }),
  obs('idx:omxs30', 'equities', 0.74, { region: 'sweden' }),
  obs('sector:energy', 'sectors', -0.36, { sector: 'energy' }, { reference: 0.41 }),
  obs(
    'sector:technology',
    'sectors',
    0.81,
    { sector: 'technology' },
    { reference: 0.41 },
  ),
  obs('fx:usdsek', 'fx', 0.19, { currency: 'USD' }),
  obs('cmd:brent', 'commodities', 0.38, { commodityClass: 'energy' }),
  obs('sentiment:cross-asset', 'risk-appetite', 5),
]

const SCENARIOS: Record<string, MarketObservation[]> = {
  'rates-up': [
    obs('rate:se10y', 'rates', 18, { currency: 'SEK' }),
    obs('rate:de10y', 'rates', 12, { currency: 'EUR' }),
    obs('rate:us10y', 'rates', 14, { currency: 'USD' }),
  ],
  'energy-down': [
    obs('sector:energy', 'sectors', -4.5, { sector: 'energy' }, { reference: 0.41 }),
    obs('cmd:brent', 'commodities', -5.2, { commodityClass: 'energy' }),
  ],
  'gold-up': [obs('cmd:gold', 'commodities', 4.1, { commodityClass: 'metal' })],
  'equity-selloff': [
    obs('idx:nasdaq100', 'equities', -3.2, { region: 'us' }),
    obs('idx:sp500', 'equities', -2.4, { region: 'us' }),
    obs('idx:omxs30', 'equities', -2.1, { region: 'sweden' }),
    obs(
      'sector:technology',
      'sectors',
      -3.1,
      { sector: 'technology' },
      { reference: -2.4 },
    ),
  ],
  'usd-up': [obs('fx:usdsek', 'fx', 1.6, { currency: 'USD' })],
  'risk-off': [
    obs('sentiment:cross-asset', 'risk-appetite', -26),
    obs('idx:sp500', 'equities', -1.8, { region: 'us' }),
  ],
}

function contextWith(observations: readonly MarketObservation[] = CALM): AdvisoryContext {
  let current = observations
  const context: AdvisoryContext & {
    setMarket(next: readonly MarketObservation[]): void
  } = {
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
  }
  return context
}

const affected = (
  brief: Awaited<ReturnType<typeof marketImpactBrief>>,
  eventId: string,
) => brief.events.find((e) => e.event.id === eventId)?.affected ?? []

describe('the calm market', () => {
  it('opens no event, touches no client, and leaves Sentinel exactly as Client Intelligence left it', async () => {
    const context = contextWith(CALM)
    const brief = await marketImpactBrief(context)
    expect(brief.events).toEqual([])
    expect(brief).toMatchObject({
      affectedClients: 0,
      clientsAssessed: 7,
      observedAt: null,
      scenario: 'test',
      method: 'market-to-client-v1',
    })
    const sentinel = await sentinelBrief(context)
    expect(sentinel.entries.map((e) => [e.client.id, e.priority.theme])).toEqual([
      ['cl-berglund', 'overdue-commitment'],
      ['cl-grahn', 'overdue-commitment'],
      ['cl-dahlqvist', 'overdue-commitment'],
      ['cl-ceder', 'meeting-preparation'],
      ['cl-alvarsson', 'meeting-preparation'],
      ['cl-forsell', 'contact-silence'],
    ])
    expect(
      sentinel.entries.some((e) => e.priority.drivers.some((d) => d.kind === 'market')),
    ).toBe(false)
    expect(sentinel.quiet.map((c) => c.id)).toEqual(['cl-ekstrand'])
  })

  it('a record without a market source is complete without it', async () => {
    const context: AdvisoryContext = {
      repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
      clock: new FakeClock(NOW),
    }
    const brief = await marketImpactBrief(context)
    expect(brief.events).toEqual([])
    expect(brief.scenario).toBeNull()
  })
})

describe('rates up', () => {
  it('reaches the Dahlqvists at high relevance through fixed income, the bridge loan and their own concern; Ceder is untouched', async () => {
    const brief = await marketImpactBrief(contextWith(SCENARIOS['rates-up']))
    expect(brief.events.map((e) => e.event.id)).toEqual([
      'rates:rate:se10y:daily',
      'rates:rate:us10y:daily',
      'rates:rate:de10y:daily',
    ])
    const se = affected(brief, 'rates:rate:se10y:daily')
    const anna = se.find((a) => a.client.id === 'cl-dahlqvist')!
    expect(anna.impact).toMatchObject({ relevance: 'high', directness: 'direct' })
    expect(anna.impact.reasons.map((r) => r.kind)).toEqual([
      'fixed-income-duration',
      'refinancing-approaching',
      'related-concern',
      'meeting-approaching',
    ])
    expect(anna.impact.sourceIds).toEqual(
      expect.arrayContaining(['li-dah-bridge', 'cf-dah-1']),
    )
    expect(se.find((a) => a.client.id === 'cl-alvarsson')?.impact.relevance).toBe(
      'medium',
    )
    expect(
      brief.events.flatMap((e) => e.affected).some((a) => a.client.id === 'cl-ceder'),
    ).toBe(false)
    expect(brief.affectedClients).toBeGreaterThanOrEqual(2)
  })

  it('strengthens the Dahlqvists’ one priority instead of opening a second, and keeps the record ids', async () => {
    const context = contextWith(SCENARIOS['rates-up'])
    const sentinel = await sentinelBrief(context)
    const rows = sentinel.entries.filter((e) => e.client.id === 'cl-dahlqvist')
    expect(rows).toHaveLength(1)
    const [anna] = rows
    expect(anna!.priority).toMatchObject({
      theme: 'overdue-commitment',
      severity: 'critical',
      strengthenedByMarket: false,
    })
    /* Both the Swedish and the German curve reach her; the driver for the Swedish one is asserted. */
    const market = anna!.priority.drivers.find(
      (d) => d.kind === 'market' && d.eventId === 'rates:rate:se10y:daily',
    )
    expect(market).toMatchObject({
      kind: 'market',
      eventId: 'rates:rate:se10y:daily',
      relevance: 'high',
      directness: 'direct',
    })
    expect(market && market.kind === 'market' ? market.sourceIds : []).toEqual(
      expect.arrayContaining(['li-dah-bridge', 'cf-dah-1']),
    )
    expect(anna!.priority.sourceIds).toContain('rates:rate:se10y:daily')
    const affectedRow = affected(
      await marketImpactBrief(context),
      'rates:rate:se10y:daily',
    ).find((a) => a.client.id === 'cl-dahlqvist')!
    expect(affectedRow.sentinel).toMatchObject({
      priorityId: 'cl-dahlqvist:overdue-commitment',
      anchoredByMarket: false,
      strengthenedByMarket: false,
      carriesEvent: true,
    })
  })
})

describe('energy down', () => {
  it('reaches Henrik at high relevance because his record holds energy and says he worried about it; Viktor’s 4 % is below the line', async () => {
    const context = contextWith(SCENARIOS['energy-down'])
    const brief = await marketImpactBrief(context)
    const sector = affected(brief, 'sectors:sector:energy:daily')
    expect(sector.map((a) => a.client.id)).toEqual(['cl-alvarsson'])
    expect(sector[0]!.impact).toMatchObject({ relevance: 'high', directness: 'direct' })
    expect(sector[0]!.impact.event.severity).toBe('major')
    expect(sector[0]!.impact.reasons.map((r) => r.kind)).toEqual([
      'sector-holding',
      'related-concern',
      'meeting-approaching',
    ])
    expect(
      affected(brief, 'commodities:cmd:brent:daily').map((a) => a.client.id),
    ).toEqual(['cl-alvarsson'])

    const view = (await client360(context, 'cl-alvarsson'))!
    expect(view.marketImpacts.map((i) => [i.event.symbol, i.relevance])).toEqual([
      ['sector:energy', 'high'],
      ['cmd:brent', 'medium'],
    ])
    expect((await client360(context, 'cl-ekstrand'))!.marketImpacts).toEqual([])

    const prep = (await prepareMeeting(context, 'cl-alvarsson'))!
    expect(
      prep.marketSinceLastMeeting.map((c) => [c.impact.event.symbol, c.status]),
    ).toEqual([
      ['sector:energy', 'active'],
      ['cmd:brent', 'active'],
    ])
  })
})

describe('a move nobody holds anything against', () => {
  it('is listed with zero relevant clients and changes nothing for Sentinel', async () => {
    const context = contextWith(SCENARIOS['gold-up'])
    const brief = await marketImpactBrief(context)
    expect(brief.events).toHaveLength(1)
    expect(brief.events[0]).toMatchObject({
      affected: [],
      counts: { high: 0, medium: 0, low: 0 },
      meaningful: 0,
    })
    expect(brief.affectedClients).toBe(0)
    const sentinel = await sentinelBrief(context)
    expect(sentinel.quiet.map((c) => c.id)).toEqual(['cl-ekstrand'])
    expect(
      sentinel.entries.some((e) => e.priority.drivers.some((d) => d.kind === 'market')),
    ).toBe(false)
  })
})

describe('an equity selloff', () => {
  it('gives the quiet client a market-anchored priority, which the advisor can dispose of; Ingrid is reached only as context', async () => {
    const context = contextWith(SCENARIOS['equity-selloff'])
    const brief = await marketImpactBrief(context)
    const nasdaq = affected(brief, 'equities:idx:nasdaq100:daily')
    const viktor = nasdaq.find((a) => a.client.id === 'cl-ekstrand')!
    expect(viktor.impact.relevance).toBe('high')
    expect(viktor.sentinel).toMatchObject({
      priorityId: 'cl-ekstrand:market-impact',
      theme: 'market-impact',
      severity: 'high',
      anchoredByMarket: true,
    })
    /* 19 % equities is no exposure; her recorded discomfort with swings is context, never more than that. */
    const ingrid = brief.events
      .flatMap((e) => e.affected)
      .filter((a) => a.client.id === 'cl-forsell')
    expect(ingrid.length).toBeGreaterThan(0)
    expect(ingrid.every((a) => a.impact.directness === 'contextual')).toBe(true)
    expect(ingrid.every((a) => a.impact.relevance !== 'high')).toBe(true)
    const margareta = nasdaq.find((a) => a.client.id === 'cl-berglund')!
    expect(margareta.impact.reasons.map((r) => r.kind)).toContain('drawdown-sensitivity')

    const sentinel = await sentinelBrief(context)
    expect(sentinel.quiet).toEqual([])
    const row = sentinel.entries.find((e) => e.client.id === 'cl-ekstrand')!
    expect(row.priority).toMatchObject({
      theme: 'market-impact',
      severity: 'high',
      horizon: 'today',
    })
    expect(
      await disposePriority(context, {
        priorityId: 'cl-ekstrand:market-impact',
        status: 'reviewed',
      }),
    ).toMatchObject({ ok: true, status: 'reviewed' })
  })
})

describe('the dollar, and risk-off', () => {
  it('a stronger dollar reaches USD holders only, at low or medium relevance', async () => {
    const brief = await marketImpactBrief(contextWith(SCENARIOS['usd-up']))
    const usd = affected(brief, 'fx:fx:usdsek:daily')
    expect(usd.some((a) => a.client.id === 'cl-forsell')).toBe(false)
    expect(usd.find((a) => a.client.id === 'cl-alvarsson')?.impact.relevance).toBe(
      'medium',
    )
    expect(usd.every((a) => a.impact.relevance !== 'high')).toBe(true)
  })

  it('risk-off reaches the equity-heavy and the sensitive, not the balanced', async () => {
    const brief = await marketImpactBrief(contextWith(SCENARIOS['risk-off']))
    const riskOff = affected(brief, 'risk-appetite:sentiment:cross-asset:daily')
    expect(riskOff.find((a) => a.client.id === 'cl-ceder')?.impact.directness).toBe(
      'direct',
    )
    expect(riskOff.find((a) => a.client.id === 'cl-berglund')?.impact.directness).toBe(
      'contextual',
    )
    expect(riskOff.some((a) => a.client.id === 'cl-grahn')).toBe(false)
  })
})

describe('stability across reads', () => {
  it('keeps one event per key with its first-seen time, and resolves the priority when the move fades', async () => {
    const context = contextWith(SCENARIOS['equity-selloff']) as AdvisoryContext & {
      setMarket(next: readonly MarketObservation[]): void
    }
    const first = await marketImpactBrief(context)
    const second = await marketImpactBrief(context)
    expect(second.events.map((e) => e.event.id)).toEqual(
      first.events.map((e) => e.event.id),
    )
    expect(second.events[0]!.event.firstSeenAt).toBe(first.events[0]!.event.firstSeenAt)
    expect((await context.repositories.marketEvents.state()).active).toHaveLength(
      first.events.length,
    )

    context.setMarket(CALM)
    const calm = await marketImpactBrief(context)
    expect(calm.events).toEqual([])
    const sentinel = await sentinelBrief(context)
    expect(sentinel.quiet.map((c) => c.id)).toEqual(['cl-ekstrand'])
  })

  it('a market source that fails leaves the open events standing until they expire', async () => {
    const context = contextWith(SCENARIOS['rates-up'])
    const before = await marketImpactBrief(context)
    expect(before.events).toHaveLength(3)
    context.market = {
      scenario: null,
      async observe() {
        throw new Error('pipeline down')
      },
    }
    const during = await marketImpactBrief(context)
    expect(during.events.map((e) => e.event.id)).toEqual(
      before.events.map((e) => e.event.id),
    )
  })
})
