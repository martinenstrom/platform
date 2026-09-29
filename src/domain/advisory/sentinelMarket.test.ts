/**
 * Sentinel's market driver, planted and asserted: a high-relevance impact
 * anchors only when nothing else calls, strengthens the one priority the
 * record already has, never opens a second one, and lapses with the event.
 */

import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { addDays } from './dates'
import type { ClientFacts } from './intelligence'
import type { ClientMarketImpact, MarketEvent, Relevance } from './marketToClient'
import type { Commitment, Interaction, Provenance } from './relationship'
import { prioritiseClient } from './sentinel'
import { balanceSheetOf, type Asset } from './wealth'
import type { Portfolio } from './portfolio'

const TODAY = '2026-09-23'

const client: Client = {
  id: 'c1',
  householdId: 'h1',
  displayName: 'Test Klient',
  segment: 'private-banking',
  relationshipSince: '2020-01-01',
  primaryAdvisorId: 'adv-martin',
  dateOfBirth: '1970-05-26',
  riskProfile: 4,
  preferredChannel: 'phone',
  annualIncome: null,
  currency: 'SEK',
}

const provenance = (sourceDate = TODAY): Provenance => ({
  origin: 'advisor',
  sourceInteractionId: null,
  sourceText: null,
  sourceDate,
  createdAt: `${sourceDate}T09:00:00.000Z`,
  createdBy: 'adv-martin',
  confidence: 'high',
  confirmedByAdvisor: true,
  confirmedAt: null,
})

const interaction = (date: string): Interaction => ({
  id: `i-${date}`,
  clientId: 'c1',
  type: 'meeting',
  date,
  advisorId: 'adv-martin',
  source: 'advisor',
  importance: 'normal',
  title: 'Samtal',
  noteText: 'note',
  topics: [],
  keyPoints: [],
  provenance: provenance(date),
})

const commitment = (id: string, dueDate: string): Commitment => ({
  id,
  clientId: 'c1',
  title: `Löfte ${id}`,
  createdAt: '2026-09-01',
  dueDate,
  status: 'open',
  priority: 'medium',
  ownerAdvisorId: 'adv-martin',
  completedAt: null,
  provenance: provenance('2026-09-01'),
})

const assets: Asset[] = [
  {
    id: 'a1',
    clientId: 'c1',
    kind: 'investment-portfolio',
    title: 'Portfölj',
    value: 10_000_000,
    valuedAt: TODAY,
    source: 'bank',
    withBank: true,
    portfolioId: 'p1',
  },
]

const portfolioWith = (equitiesCurrent: number): Portfolio => ({
  id: 'p1',
  clientId: 'c1',
  valuedAt: TODAY,
  source: 'synthetic',
  totalValue: 10_000_000,
  benchmarkName: 'B',
  allocation: [
    { assetClass: 'equities', strategicPercent: 60, currentPercent: equitiesCurrent },
    {
      assetClass: 'fixed-income',
      strategicPercent: 40,
      currentPercent: 100 - equitiesCurrent,
    },
  ],
  holdings: [],
  performance: [],
  performanceYtdPercent: 0,
})

/** A quiet, healthy relationship: spoke ten days ago, nothing due, nothing booked. */
const quiet = (overrides: Partial<ClientFacts> = {}): ClientFacts => ({
  client,
  balanceSheet: balanceSheetOf(assets, []),
  portfolio: portfolioWith(61),
  goals: [],
  interactions: [interaction('2026-09-13')],
  contextFacts: [],
  commitments: [],
  events: [],
  opportunities: [],
  liabilities: [],
  today: TODAY,
  ...overrides,
})

const marketEvent = (
  severity: MarketEvent['severity'] = 'notable',
  change = 18,
  symbol = 'rate:se10y',
): MarketEvent => ({
  id: `rates:${symbol}:daily`,
  category: 'rates',
  symbol,
  label: 'SE 10Y',
  metric: 'yield-change',
  currentValue: 2.84,
  previousValue: 2.66,
  change,
  changeUnit: 'bp',
  direction: 'up',
  magnitude: Math.abs(change),
  severity,
  horizon: 'daily',
  observedAt: `${TODAY}T07:00:00.000Z`,
  source: 'test',
  quality: 'live',
  peakChange: change,
  peakAt: `${TODAY}T07:00:00.000Z`,
  thresholds: { enter: 10, exit: 6, major: 20 },
  firstSeenAt: `${TODAY}T07:30:00.000Z`,
  updatedAt: `${TODAY}T07:30:00.000Z`,
  expiresAt: `2026-09-26T07:00:00.000Z`,
  tags: { currency: 'SEK' },
})

const impact = (
  relevance: Relevance,
  event: MarketEvent = marketEvent(),
): ClientMarketImpact => ({
  id: `c1|${event.id}`,
  clientId: 'c1',
  eventId: event.id,
  event,
  relevance,
  relevanceScore: relevance === 'high' ? 8 : relevance === 'medium' ? 5 : 2,
  financialRelevance: relevance,
  conversationRelevance: 'none',
  directness: 'direct',
  reasons: [],
  sourceIds: ['h-fi'],
  assessedAt: TODAY,
  method: 'market-to-client-v1',
})

describe('a market impact as the only reason', () => {
  it('a high-relevance major move anchors a market-impact priority: high, today', () => {
    const p = prioritiseClient(quiet(), undefined, undefined, [
      impact('high', marketEvent('major', 24)),
    ])
    expect(p).toMatchObject({
      id: 'c1:market-impact',
      theme: 'market-impact',
      severity: 'high',
      horizon: 'today',
      strengthenedByMarket: false,
      dueAt: null,
    })
    expect(p!.primary.kind).toBe('market')
    expect(p!.sourceIds).toEqual(['rates:rate:se10y:daily'])
  })

  it('a high-relevance notable move anchors at normal, upcoming', () => {
    expect(
      prioritiseClient(quiet(), undefined, undefined, [impact('high')]),
    ).toMatchObject({
      theme: 'market-impact',
      severity: 'normal',
      horizon: 'upcoming',
    })
  })

  it('medium relevance never anchors, and low relevance never reaches Sentinel', () => {
    expect(prioritiseClient(quiet(), undefined, undefined, [impact('medium')])).toBeNull()
    expect(prioritiseClient(quiet(), undefined, undefined, [impact('low')])).toBeNull()
  })
})

describe('a market impact beside what the record already calls for', () => {
  const silent = () => quiet({ interactions: [interaction(addDays(TODAY, -70))] })

  it('strengthens the one priority — normal to high — and never opens a second', () => {
    const without = prioritiseClient(silent())!
    expect(without).toMatchObject({ theme: 'contact-silence', severity: 'normal' })
    const lifted = prioritiseClient(silent(), undefined, undefined, [impact('high')])!
    expect(lifted).toMatchObject({
      id: without.id,
      theme: 'contact-silence',
      severity: 'high',
      horizon: 'upcoming',
      strengthenedByMarket: true,
    })
    expect(lifted.drivers.filter((d) => d.kind === 'market')).toHaveLength(1)
    expect(lifted.score).toBeGreaterThan(without.score)
    expect(lifted.fingerprint).not.toBe(without.fingerprint)
  })

  it('medium relevance adds weight only; critical is never lifted', () => {
    const overdue = () => quiet({ commitments: [commitment('c', addDays(TODAY, -3))] })
    const without = prioritiseClient(overdue())!
    const withMedium = prioritiseClient(overdue(), undefined, undefined, [
      impact('medium'),
    ])!
    expect(withMedium).toMatchObject({
      theme: 'overdue-commitment',
      severity: 'critical',
      strengthenedByMarket: false,
    })
    expect(withMedium.score).toBe(without.score + 6)
    const withHigh = prioritiseClient(overdue(), undefined, undefined, [impact('high')])!
    expect(withHigh).toMatchObject({ severity: 'critical', strengthenedByMarket: false })
    expect(withHigh.drivers.map((d) => d.kind)).toEqual(['overdue-commitment', 'market'])
  })

  it('a watched portfolio lifted by a high impact becomes upcoming, not high-and-watch', () => {
    const drifting = () => quiet({ portfolio: portfolioWith(68) })
    expect(prioritiseClient(drifting())).toMatchObject({
      theme: 'portfolio',
      horizon: 'watch',
    })
    expect(
      prioritiseClient(drifting(), undefined, undefined, [impact('high')]),
    ).toMatchObject({
      theme: 'portfolio',
      severity: 'high',
      horizon: 'upcoming',
      strengthenedByMarket: true,
    })
  })

  it('two events are two drivers under one priority, the more relevant first', () => {
    const fx = marketEvent('notable', 1.6, 'fx:usdsek')
    const p = prioritiseClient(silent(), undefined, undefined, [
      impact('medium', fx),
      impact('high'),
    ])!
    const market = p.drivers.filter((d) => d.kind === 'market')
    expect(market.map((d) => d.kind === 'market' && d.relevance)).toEqual([
      'high',
      'medium',
    ])
    expect(p.sourceIds).toEqual(
      expect.arrayContaining(['rates:fx:usdsek:daily', 'rates:rate:se10y:daily']),
    )
  })
})

describe('stability', () => {
  it('the fingerprint follows the event key, not its values, and lapses with the event', () => {
    const silent = () => quiet({ interactions: [interaction(addDays(TODAY, -70))] })
    const at18 = prioritiseClient(silent(), undefined, undefined, [
      impact('high', marketEvent('notable', 18)),
    ])!
    const at21 = prioritiseClient(silent(), undefined, undefined, [
      impact('high', marketEvent('notable', 21)),
    ])!
    expect(at21.fingerprint).toBe(at18.fingerprint)
    const gone = prioritiseClient(silent())!
    expect(gone.fingerprint).not.toBe(at18.fingerprint)
    expect(gone.severity).toBe('normal')
  })

  it('a tiny move is no impact and changes nothing', () => {
    expect(prioritiseClient(quiet(), undefined, undefined, [])).toBeNull()
  })
})
