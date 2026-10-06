/**
 * Market-to-Client's rules, planted and asserted: the materiality lines and
 * the hysteresis, expiry and dedupe of the event ledger; what the record
 * says a client is exposed to; and every relevance pathway with the case
 * that fires it, the near-miss that does not, and the zero-relevance move.
 */

import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { addDays } from './dates'
import type { ClientFacts } from './intelligence'
import {
  assessClient,
  assessImpact,
  concernTopicsOf,
  EMPTY_MARKET_LEDGER,
  EXPOSURE_THRESHOLDS,
  exposureOf,
  marketEventsSince,
  MATERIALITY,
  reconcileMarketEvents,
  reconcileMarketLedger,
  type MarketCategory,
  type MarketEvent,
  type MarketObservation,
  type MaterialityPolicy,
} from './marketToClient'
import type { Holding, Portfolio } from './portfolio'
import type { ContextFact, ImportantEvent, Provenance } from './relationship'
import { balanceSheetOf, type Asset, type Liability } from './wealth'

const TODAY = '2026-09-23'
const NOW = `${TODAY}T07:30:00.000Z`

/* ---------------------------------------------------------------- builders */

const observation = (
  symbol: string,
  category: MarketCategory,
  change: number | null,
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
  tags: {},
  ...extra,
})

const client: Client = {
  id: 'c1',
  householdId: 'h1',
  officeId: 'o1',
  displayName: 'Test Klient',
  segment: 'private-banking',
  relationshipSince: '2020-01-01',
  primaryAdvisorId: 'adv-martin',
  dateOfBirth: '1970-09-26',
  riskProfile: 4,
  preferredChannel: 'phone',
  annualIncome: null,
  currency: 'SEK',
  lifecycle: { status: 'active', since: '2020-01-01', closure: null },
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
  {
    id: 'a2',
    clientId: 'c1',
    kind: 'cash',
    title: 'Kassa',
    value: 400_000,
    valuedAt: TODAY,
    source: 'bank',
    withBank: true,
  },
]

const holding = (
  id: string,
  weightPercent: number,
  tags: Partial<Pick<Holding, 'currency' | 'region' | 'sector' | 'assetClass'>> = {},
): Holding => ({
  id,
  portfolioId: 'p1',
  name: id,
  assetClass: 'equities',
  marketValue: weightPercent * 100_000,
  weightPercent,
  performanceYtdPercent: 0,
  role: 'core-equity',
  currency: 'SEK',
  region: 'global',
  sector: 'multi',
  ...tags,
})

const portfolio = (
  equities: number,
  fixedIncome: number,
  holdings: Holding[],
  strategicEquities = equities,
): Portfolio => ({
  id: 'p1',
  clientId: 'c1',
  valuedAt: TODAY,
  source: 'synthetic',
  totalValue: 10_000_000,
  benchmarkName: 'B',
  allocation: [
    {
      assetClass: 'equities',
      strategicPercent: strategicEquities,
      currentPercent: equities,
    },
    {
      assetClass: 'fixed-income',
      strategicPercent: 100 - strategicEquities,
      currentPercent: fixedIncome,
    },
    {
      assetClass: 'cash',
      strategicPercent: 0,
      currentPercent: 100 - equities - fixedIncome,
    },
  ],
  holdings,
  performance: [],
  performanceYtdPercent: 0,
})

const loan = (
  id: string,
  interestType: Liability['interestType'],
  maturityInDays: number | null,
  outstandingBalance = 4_000_000,
): Liability => ({
  id,
  clientId: 'c1',
  kind: 'mortgage',
  title: 'Lån',
  outstandingBalance,
  interestType,
  ratePercent: 3.5,
  maturityDate: maturityInDays === null ? null : addDays(TODAY, maturityInDays),
  nextReviewDate: null,
  withBank: true,
  valuedAt: TODAY,
})

const fact = (
  id: string,
  category: ContextFact['category'],
  statement: string,
): ContextFact => ({
  id,
  clientId: 'c1',
  category,
  statement,
  status: 'active',
  statusAt: TODAY,
  provenance: provenance('2026-09-10'),
})

const meeting = (daysAhead: number): ImportantEvent => ({
  id: 'ev-meeting',
  clientId: 'c1',
  type: 'client-meeting',
  title: 'Möte',
  date: addDays(TODAY, daysAhead),
  recurring: 'none',
  importance: 'normal',
  notes: '',
  reminderRules: [],
  status: 'upcoming',
  provenance: provenance('2026-09-01'),
})

const facts = (overrides: Partial<ClientFacts> = {}): ClientFacts => ({
  client,
  balanceSheet: balanceSheetOf(assets, overrides.liabilities ?? []),
  portfolio: portfolio(50, 40, [
    holding('h-eq', 50),
    holding('h-fi', 40, { assetClass: 'fixed-income', sector: 'government' }),
  ]),
  goals: [],
  interactions: [],
  contextFacts: [],
  commitments: [],
  events: [],
  opportunities: [],
  liabilities: [],
  today: TODAY,
  ...overrides,
})

/** One open event from one observation, the way a read would produce it. */
const eventOf = (o: MarketObservation): MarketEvent => {
  const [event] = reconcileMarketEvents([], [o], NOW)
  if (!event) throw new Error(`no event opened for ${o.symbol}`)
  return event
}

/* ------------------------------------------------------------- materiality */

describe('materiality and the event ledger', () => {
  it('opens nothing below the line, a notable event at it, a major one past the major line', () => {
    expect(
      reconcileMarketEvents([], [observation('rate:se10y', 'rates', 8)], NOW),
    ).toEqual([])
    const [notable] = reconcileMarketEvents(
      [],
      [observation('rate:se10y', 'rates', 12)],
      NOW,
    )
    expect(notable).toMatchObject({
      id: 'rates:rate:se10y:daily',
      severity: 'notable',
      direction: 'up',
      change: 12,
      magnitude: 12,
      firstSeenAt: NOW,
      updatedAt: NOW,
    })
    const [major] = reconcileMarketEvents(
      [],
      [observation('rate:se10y', 'rates', -22)],
      NOW,
    )
    expect(major).toMatchObject({ severity: 'major', direction: 'down', magnitude: 22 })
    expect(MATERIALITY.rates).toMatchObject({ enter: 10, exit: 6, major: 20 })
  })

  it('hysteresis: an open event survives a fade below enter but above exit, and closes below exit', () => {
    const open = reconcileMarketEvents([], [observation('rate:se10y', 'rates', 12)], NOW)
    const faded = reconcileMarketEvents(
      open,
      [observation('rate:se10y', 'rates', 8)],
      NOW,
    )
    expect(faded).toHaveLength(1)
    expect(faded[0]).toMatchObject({ change: 8, severity: 'notable' })
    expect(
      reconcileMarketEvents(faded, [observation('rate:se10y', 'rates', 5)], NOW),
    ).toEqual([])
    /* A fresh read at 8 opens nothing: the enter line applies when no event is open. */
    expect(
      reconcileMarketEvents([], [observation('rate:se10y', 'rates', 8)], NOW),
    ).toEqual([])
  })

  it('the same key keeps its identity and first-seen time while its values update', () => {
    const later = `${TODAY}T09:30:00.000Z`
    const first = reconcileMarketEvents([], [observation('rate:se10y', 'rates', 12)], NOW)
    const second = reconcileMarketEvents(
      first,
      [observation('rate:se10y', 'rates', 15, { observedAt: later })],
      later,
    )
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({
      id: first[0]!.id,
      firstSeenAt: NOW,
      updatedAt: later,
      change: 15,
      observedAt: later,
    })
  })

  it('an event whose series was not observed survives until it expires, then drops', () => {
    const [event] = reconcileMarketEvents(
      [],
      [observation('rate:se10y', 'rates', 12)],
      NOW,
    )
    expect(event!.expiresAt).toBe(`2026-09-26T07:30:00.000Z`)
    const beforeExpiry = '2026-09-25T07:00:00.000Z'
    expect(reconcileMarketEvents([event!], [], beforeExpiry)).toHaveLength(1)
    const afterExpiry = '2026-09-26T08:00:00.000Z'
    expect(reconcileMarketEvents([event!], [], afterExpiry)).toEqual([])
    /* Observed again after expiry, it is a new episode. */
    const fresh = reconcileMarketEvents(
      [event!],
      [observation('rate:se10y', 'rates', 12, { observedAt: afterExpiry })],
      afterExpiry,
    )
    expect(fresh[0]!.firstSeenAt).toBe(afterExpiry)
  })

  it('a series without a comparable prior opens nothing — never a fabricated zero', () => {
    expect(
      reconcileMarketEvents([], [observation('idx:sp500', 'equities', null)], NOW),
    ).toEqual([])
  })

  it('a sector is measured against the broad index, so a sector moving with the market is no event', () => {
    expect(
      reconcileMarketEvents(
        [],
        [observation('sector:energy', 'sectors', 3, { reference: 2 })],
        NOW,
      ),
    ).toEqual([])
    const [event] = reconcileMarketEvents(
      [],
      [observation('sector:energy', 'sectors', 3, { reference: -0.3 })],
      NOW,
    )
    expect(event).toMatchObject({ change: 3.3, metric: 'sector-relative-change' })
  })

  it('risk appetite opens only on the risk-off side', () => {
    expect(
      reconcileMarketEvents([], [observation('sentiment', 'risk-appetite', 25)], NOW),
    ).toEqual([])
    const [notable] = reconcileMarketEvents(
      [],
      [observation('sentiment', 'risk-appetite', -24)],
      NOW,
    )
    expect(notable).toMatchObject({ change: -24, severity: 'notable', currentValue: 26 })
    const [major] = reconcileMarketEvents(
      [],
      [observation('sentiment', 'risk-appetite', -32)],
      NOW,
    )
    expect(major).toMatchObject({ severity: 'major' })
  })

  it('orders events by how far past their own line they are', () => {
    const events = reconcileMarketEvents(
      [],
      [observation('fx:usdsek', 'fx', 1.2), observation('rate:se10y', 'rates', 30)],
      NOW,
    )
    expect(events.map((e) => e.symbol)).toEqual(['rate:se10y', 'fx:usdsek'])
  })
})

/* ---------------------------------------------------------------- exposure */

describe('exposure is what the record holds', () => {
  it('sums holdings by sector, currency and region and reads loans, concerns and the meeting', () => {
    const exposure = exposureOf(
      facts({
        portfolio: portfolio(
          67,
          21,
          [
            holding('h1', 31, { currency: 'USD', region: 'us' }),
            holding('h2', 12, { currency: 'USD', region: 'global', sector: 'energy' }),
            holding('h3', 21, { assetClass: 'fixed-income', sector: 'credit' }),
          ],
          60,
        ),
        liabilities: [
          loan('l-fixed', 'fixed', 53, 6_500_000),
          loan('l-var', 'variable', null, 1_000_000),
        ],
        contextFacts: [
          fact('cf-1', 'concern', 'Orolig över energiexponeringen efter nedgången'),
          fact('cf-2', 'behaviour', 'Blir obekväm vid större nedgångar'),
        ],
        events: [meeting(10)],
      }),
    )
    expect(exposure.assetClassShare.equities).toBe(67)
    expect(exposure.equityDeviationPoints).toBe(7)
    expect(exposure.sectorShare.energy).toBe(12)
    expect(exposure.currencyShare.USD).toBe(43)
    expect(exposure.regionShare.us).toBe(31)
    expect(exposure.largestHoldingPercent).toBe(31)
    expect(exposure.refinancingWithinDays).toBe(53)
    expect(exposure.variableRateDebt).toBe(1_000_000)
    expect(exposure.concerns.map((c) => c.topic)).toEqual(['energy', 'drawdown'])
    expect(exposure.drawdownSensitivity?.contextFactId).toBe('cf-2')
    expect(exposure.daysToNextMeeting).toBe(10)
    expect(exposure.nextMeetingEventId).toBe('ev-meeting')
    expect(exposure.holdingIds).toEqual(['h1', 'h2', 'h3'])
  })

  it('reads the topic a concern speaks to, in Swedish, and nothing where there is none', () => {
    expect(
      concernTopicsOf('Oroliga för att räntan stiger innan finansieringen är låst'),
    ).toContain('rates')
    expect(concernTopicsOf('Undrar om portföljen tar för hög risk')).toContain('drawdown')
    expect(concernTopicsOf('Vill träffas personligen, helst hemma')).toEqual([])
  })
})

/* --------------------------------------------------------------- relevance */

const rates = (change = 18, currency = 'SEK') =>
  eventOf(observation('rate:se10y', 'rates', change, { tags: { currency } }))

describe('rates pathway', () => {
  const financed = () =>
    facts({
      portfolio: portfolio(67, 21, [
        holding('h-eq', 67),
        holding('h-fi', 21, { assetClass: 'fixed-income', sector: 'credit' }),
      ]),
      liabilities: [loan('l1', 'fixed', 53, 6_500_000)],
      events: [meeting(10)],
    })

  it('fixed income is direct; a refinancing and a meeting are context; every id is kept', () => {
    const impact = assessImpact(rates(), exposureOf(financed()), TODAY)
    expect(impact).toMatchObject({
      id: 'c1|rates:rate:se10y:daily',
      relevance: 'medium',
      directness: 'direct',
      method: 'market-to-client-v1',
    })
    expect(impact!.reasons.map((r) => r.kind)).toEqual([
      'fixed-income-duration',
      'refinancing-approaching',
      'meeting-approaching',
    ])
    expect(impact!.sourceIds).toEqual(['ev-meeting', 'h-eq', 'h-fi', 'l1'])
  })

  it('a concern about rates lifts the same client to high, and names the fact', () => {
    const withConcern = facts({
      ...financed(),
      contextFacts: [
        fact('cf-rates', 'concern', 'Orolig för att räntan stiger före omläggningen'),
      ],
    })
    const impact = assessImpact(rates(), exposureOf(withConcern), TODAY)!
    expect(impact.relevance).toBe('high')
    expect(impact.reasons).toContainEqual(
      expect.objectContaining({ kind: 'related-concern', contextFactId: 'cf-rates' }),
    )
    expect(impact.sourceIds).toContain('cf-rates')
  })

  it('a financing context follows the client’s currency: the US curve carries no refinancing reason', () => {
    const impact = assessImpact(rates(18, 'USD'), exposureOf(financed()), TODAY)!
    expect(impact.reasons.map((r) => r.kind)).toEqual([
      'fixed-income-duration',
      'meeting-approaching',
    ])
    expect(impact.relevance).toBe('low')
  })

  it('no fixed income and no financing is no impact; variable debt alone is contextual and low', () => {
    const equityOnly = facts({
      portfolio: portfolio(90, 5, [holding('h-eq', 90)]),
    })
    expect(assessImpact(rates(), exposureOf(equityOnly), TODAY)).toBeNull()
    const variable = facts({
      portfolio: portfolio(90, 5, [holding('h-eq', 90)]),
      liabilities: [loan('l-var', 'variable', null, EXPOSURE_THRESHOLDS.variableDebt)],
    })
    expect(assessImpact(rates(), exposureOf(variable), TODAY)).toMatchObject({
      relevance: 'low',
      directness: 'contextual',
    })
  })

  it('a major move doubles the weight of the exposure', () => {
    const heavy = facts({
      portfolio: portfolio(40, 55, [
        holding('h-eq', 40),
        holding('h-fi', 55, { assetClass: 'fixed-income', sector: 'government' }),
      ]),
    })
    expect(assessImpact(rates(18), exposureOf(heavy), TODAY)!.relevance).toBe('low')
    expect(assessImpact(rates(24), exposureOf(heavy), TODAY)!.relevance).toBe('medium')
  })
})

describe('equities and risk-appetite pathways', () => {
  const selloff = () =>
    eventOf(observation('idx:nasdaq100', 'equities', -3.2, { tags: { region: 'us' } }))

  it('a regional index reaches a client with equities in that region; concentration and drawdown sensitivity are context', () => {
    const exposed = facts({
      portfolio: portfolio(72, 13, [
        holding('h-us', 38, { currency: 'USD', region: 'us' }),
        holding('h-eu', 34, { currency: 'EUR', region: 'europe' }),
      ]),
      contextFacts: [fact('cf-b', 'behaviour', 'Blir obekväm vid större nedgångar')],
    })
    const impact = assessImpact(selloff(), exposureOf(exposed), TODAY)!
    expect(impact.relevance).toBe('high')
    expect(impact.reasons.map((r) => r.kind)).toEqual([
      'equity-allocation',
      'drawdown-sensitivity',
      'concentration',
    ])
  })

  it('a regional index reaches a client through global funds, and the reason says so — never "0 % in the region"', () => {
    const viaGlobal = facts({
      portfolio: portfolio(67, 21, [
        holding('h-global', 49, { currency: 'USD', region: 'global' }),
        holding('h-se', 18, { region: 'sweden' }),
      ]),
    })
    const impact = assessImpact(selloff(), exposureOf(viaGlobal), TODAY)!
    expect(impact.reasons[0]).toMatchObject({
      kind: 'equity-allocation',
      sharePercent: 67,
      region: 'global',
      regionSharePercent: 49,
    })
    const domestic = facts({
      portfolio: portfolio(67, 21, [holding('h-se', 67, { region: 'sweden' })]),
    })
    expect(assessImpact(selloff(), exposureOf(domestic), TODAY)).toBeNull()
  })

  it('without equities the same move is context only where the record shows sensitivity, else nothing', () => {
    const cautious = facts({
      portfolio: portfolio(30, 60, [holding('h-fi', 60, { assetClass: 'fixed-income' })]),
      contextFacts: [fact('cf-b', 'behaviour', 'Blir obekväm vid större nedgångar')],
    })
    /* A major move on context alone reaches medium; a notable one stays low. */
    expect(assessImpact(selloff(), exposureOf(cautious), TODAY)).toMatchObject({
      relevance: 'medium',
      directness: 'contextual',
    })
    const notable = eventOf(
      observation('idx:sp500', 'equities', -1.8, { tags: { region: 'us' } }),
    )
    expect(assessImpact(notable, exposureOf(cautious), TODAY)).toMatchObject({
      relevance: 'low',
      directness: 'contextual',
    })
    const indifferent = facts({
      portfolio: portfolio(30, 60, [holding('h-fi', 60, { assetClass: 'fixed-income' })]),
    })
    expect(assessImpact(selloff(), exposureOf(indifferent), TODAY)).toBeNull()
  })

  it('a rally is relevant without alarm, and drawdown sensitivity is not a reason for it', () => {
    const rally = eventOf(
      observation('idx:sp500', 'equities', 2.1, { tags: { region: 'us' } }),
    )
    const exposed = facts({
      portfolio: portfolio(60, 30, [
        holding('h-us', 60, { currency: 'USD', region: 'us' }),
      ]),
      contextFacts: [fact('cf-b', 'behaviour', 'Blir obekväm vid större nedgångar')],
    })
    const impact = assessImpact(rally, exposureOf(exposed), TODAY)!
    expect(impact.reasons.map((r) => r.kind)).toEqual([
      'equity-allocation',
      'concentration',
    ])
  })

  it('risk-off reaches only a portfolio heavy in equities, or a record with drawdown context', () => {
    const riskOff = eventOf(observation('sentiment', 'risk-appetite', -26))
    const heavy = facts({ portfolio: portfolio(65, 30, [holding('h-eq', 65)]) })
    expect(assessImpact(riskOff, exposureOf(heavy), TODAY)).toMatchObject({
      directness: 'direct',
    })
    const balanced = facts({ portfolio: portfolio(45, 50, [holding('h-eq', 45)]) })
    expect(assessImpact(riskOff, exposureOf(balanced), TODAY)).toBeNull()
  })
})

describe('sector, commodity and fx pathways', () => {
  const energyDown = () =>
    eventOf(
      observation('sector:energy', 'sectors', -4.5, {
        reference: 0.4,
        tags: { sector: 'energy' },
      }),
    )

  it('a sector move needs a holding in the sector; a concern then makes it high and names itself', () => {
    const holder = facts({
      portfolio: portfolio(67, 21, [
        holding('h-energy', 12, { sector: 'energy', currency: 'USD' }),
        holding('h-rest', 55),
      ]),
      contextFacts: [
        fact('cf-e', 'concern', 'Orolig över energiexponeringen efter nedgången'),
      ],
      events: [meeting(10)],
    })
    const impact = assessImpact(energyDown(), exposureOf(holder), TODAY)!
    expect(impact.event.severity).toBe('major')
    expect(impact).toMatchObject({ relevance: 'high', directness: 'direct' })
    expect(impact.reasons.map((r) => r.kind)).toEqual([
      'sector-holding',
      'related-concern',
      'meeting-approaching',
    ])
  })

  it('a concern without a holding is not an impact: the move does not touch the client', () => {
    const worried = facts({
      portfolio: portfolio(67, 21, [holding('h-rest', 67)]),
      contextFacts: [
        fact('cf-e', 'concern', 'Orolig över energiexponeringen efter nedgången'),
      ],
    })
    expect(assessImpact(energyDown(), exposureOf(worried), TODAY)).toBeNull()
    const tiny = facts({
      portfolio: portfolio(67, 21, [holding('h-energy', 4, { sector: 'energy' })]),
    })
    expect(assessImpact(energyDown(), exposureOf(tiny), TODAY)).toBeNull()
  })

  it('oil reaches an energy holder; a metal reaches nobody', () => {
    const holder = facts({
      portfolio: portfolio(67, 21, [holding('h-energy', 12, { sector: 'energy' })]),
    })
    const brent = eventOf(
      observation('cmd:brent', 'commodities', -5.2, {
        tags: { commodityClass: 'energy' },
      }),
    )
    expect(assessImpact(brent, exposureOf(holder), TODAY)).toMatchObject({
      reasons: [expect.objectContaining({ kind: 'commodity-theme', sharePercent: 12 })],
    })
    const gold = eventOf(
      observation('cmd:gold', 'commodities', 4.1, { tags: { commodityClass: 'metal' } }),
    )
    expect(assessImpact(gold, exposureOf(holder), TODAY)).toBeNull()
  })

  it('a currency move reaches holdings in that currency and nobody else', () => {
    const usd = eventOf(
      observation('fx:usdsek', 'fx', 1.6, { tags: { currency: 'USD' } }),
    )
    const holder = facts({
      portfolio: portfolio(60, 30, [
        holding('h-us', 49, { currency: 'USD', region: 'us' }),
      ]),
    })
    expect(assessImpact(usd, exposureOf(holder), TODAY)).toMatchObject({
      relevance: 'low',
      directness: 'direct',
      reasons: [expect.objectContaining({ kind: 'currency-holding', currency: 'USD' })],
    })
    const domestic = facts({ portfolio: portfolio(60, 30, [holding('h-se', 60)]) })
    expect(assessImpact(usd, exposureOf(domestic), TODAY)).toBeNull()
  })
})

describe('assessing one client against every event', () => {
  it('orders by relevance and produces nothing for a calm market', () => {
    const exposed = facts({
      portfolio: portfolio(
        67,
        21,
        [
          holding('h-energy', 12, { sector: 'energy', currency: 'USD', region: 'us' }),
          holding('h-fi', 21, { assetClass: 'fixed-income' }),
          holding('h-rest', 55, { currency: 'USD', region: 'us' }),
        ],
        60,
      ),
      contextFacts: [
        fact('cf-e', 'concern', 'Orolig över energiexponeringen efter nedgången'),
      ],
      liabilities: [loan('l1', 'fixed', 53)],
    })
    const events = reconcileMarketEvents(
      [],
      [
        observation('rate:se10y', 'rates', 18, { tags: { currency: 'SEK' } }),
        observation('sector:energy', 'sectors', -4.5, {
          reference: 0.4,
          tags: { sector: 'energy' },
        }),
        observation('idx:sp500', 'equities', 0.4, { tags: { region: 'us' } }),
      ],
      NOW,
    )
    const impacts = assessClient(events, exposed)
    expect(impacts.map((i) => [i.event.symbol, i.relevance])).toEqual([
      ['sector:energy', 'high'],
      ['rate:se10y', 'medium'],
    ])
    const calm = reconcileMarketEvents(
      [],
      [observation('rate:se10y', 'rates', 3), observation('idx:sp500', 'equities', 0.4)],
      NOW,
    )
    expect(assessClient(calm, exposed)).toEqual([])
  })
})

/* ------------------------------------------------------- policy boundary */

describe('the materiality policy boundary', () => {
  const move = observation('rate:se10y', 'rates', 18, { tags: { currency: 'SEK' } })
  const heavy = () =>
    facts({
      portfolio: portfolio(40, 55, [
        holding('h-eq', 40),
        holding('h-fi', 55, { assetClass: 'fixed-income', sector: 'government' }),
      ]),
    })

  it('event detection reads the policy it is given, never the constants', () => {
    const strict: MaterialityPolicy = {
      ...MATERIALITY,
      rates: { ...MATERIALITY.rates, enter: 30, exit: 20, major: 50 },
    }
    expect(reconcileMarketEvents([], [move], NOW, strict)).toEqual([])
    const loose: MaterialityPolicy = {
      ...MATERIALITY,
      rates: { ...MATERIALITY.rates, enter: 5, exit: 3, major: 15 },
    }
    const [event] = reconcileMarketEvents([], [move], NOW, loose)
    expect(event).toMatchObject({
      severity: 'major',
      thresholds: { enter: 5, exit: 3, major: 15 },
    })
    expect(reconcileMarketEvents([], [move], NOW)[0]).toMatchObject({
      severity: 'notable',
      thresholds: { enter: 10, exit: 6, major: 20 },
    })
  })

  it('client relevance reads the event the policy produced, so a new policy changes verdicts without a new rule', () => {
    const loose: MaterialityPolicy = {
      ...MATERIALITY,
      rates: { ...MATERIALITY.rates, enter: 5, exit: 3, major: 15 },
    }
    const [major] = reconcileMarketEvents([], [move], NOW, loose)
    const [notable] = reconcileMarketEvents([], [move], NOW)
    const exposure = exposureOf(heavy())
    expect(assessImpact(notable!, exposure, TODAY)!.relevance).toBe('low')
    expect(assessImpact(major!, exposure, TODAY)!.relevance).toBe('medium')
    /* The ledger carries the policy through too. */
    expect(
      reconcileMarketLedger(EMPTY_MARKET_LEDGER, [move], NOW, loose).active[0],
    ).toMatchObject({ severity: 'major' })
  })
})

/* ------------------------------------------- active relevance vs history */

describe('active relevance and historical events', () => {
  const t1 = '2026-09-23T09:30:00.000Z'
  const t2 = '2026-09-23T11:30:00.000Z'
  const t3 = '2026-09-23T13:30:00.000Z'
  const rates = (change: number, observedAt: string) =>
    observation('rate:se10y', 'rates', change, { observedAt, tags: { currency: 'SEK' } })

  it('a faded event closes into history at its peak, and is not forgotten', () => {
    const opened = reconcileMarketLedger(EMPTY_MARKET_LEDGER, [rates(18, NOW)], NOW)
    expect(opened.active).toHaveLength(1)
    expect(opened.history).toEqual([])
    const higher = reconcileMarketLedger(opened, [rates(24, t1)], t1)
    expect(higher.active[0]).toMatchObject({ change: 24, peakChange: 24, peakAt: t1 })
    const faded = reconcileMarketLedger(higher, [rates(8, t2)], t2)
    expect(faded.active[0]).toMatchObject({ change: 8, peakChange: 24, peakAt: t1 })
    const closed = reconcileMarketLedger(faded, [rates(4, t3)], t3)
    expect(closed.active).toEqual([])
    expect(closed.history).toHaveLength(1)
    expect(closed.history[0]).toMatchObject({
      id: 'rates:rate:se10y:daily',
      recordId: `rates:rate:se10y:daily@${NOW}`,
      firstSeenAt: NOW,
      closedAt: t3,
      closeReason: 'faded',
      peakChange: 24,
      change: 8,
    })
  })

  it('an unobserved event expires into history as expired', () => {
    const opened = reconcileMarketLedger(
      EMPTY_MARKET_LEDGER,
      [observation('fx:usdsek', 'fx', 1.6, { tags: { currency: 'USD' } })],
      NOW,
    )
    const afterExpiry = '2026-09-26T08:00:00.000Z'
    const expired = reconcileMarketLedger(opened, [], afterExpiry)
    expect(expired.active).toEqual([])
    expect(expired.history[0]).toMatchObject({
      id: 'fx:fx:usdsek:daily',
      closedAt: afterExpiry,
      closeReason: 'expired',
      peakChange: 1.6,
    })
  })

  it('history is queryable by window; a re-opened key is a new episode beside the old', () => {
    const first = reconcileMarketLedger(EMPTY_MARKET_LEDGER, [rates(18, NOW)], NOW)
    const later = '2026-09-27T08:00:00.000Z'
    const reopened = reconcileMarketLedger(first, [rates(15, later)], later)
    expect(reopened.active).toHaveLength(1)
    expect(reopened.active[0]!.firstSeenAt).toBe(later)
    expect(reopened.history).toHaveLength(1)
    expect(reopened.history[0]!.closeReason).toBe('expired')
    expect(
      marketEventsSince(reopened, '2026-09-23').map((s) => [
        s.status,
        s.event.firstSeenAt,
      ]),
    ).toEqual([
      ['active', later],
      ['closed', NOW],
    ])
    expect(marketEventsSince(reopened, '2026-09-27')).toHaveLength(1)
    expect(marketEventsSince(reopened, '2026-09-28')).toEqual([])
  })

  it('history is pruned after the retention window', () => {
    const closed = reconcileMarketLedger(
      reconcileMarketLedger(EMPTY_MARKET_LEDGER, [rates(18, NOW)], NOW),
      [rates(2, t1)],
      t1,
    )
    expect(closed.history).toHaveLength(1)
    const muchLater = '2027-04-01T00:00:00.000Z'
    expect(reconcileMarketLedger(closed, [], muchLater).history).toEqual([])
  })

  it('a closed event still yields an impact for a client, judged against the record as it stands', () => {
    const closed = reconcileMarketLedger(
      reconcileMarketLedger(EMPTY_MARKET_LEDGER, [rates(18, NOW)], NOW),
      [rates(2, t1)],
      t1,
    )
    const financed = facts({
      portfolio: portfolio(67, 21, [
        holding('h-eq', 67),
        holding('h-fi', 21, { assetClass: 'fixed-income', sector: 'credit' }),
      ]),
      liabilities: [loan('l1', 'fixed', 53, 6_500_000)],
    })
    const impact = assessImpact(closed.history[0]!, exposureOf(financed), TODAY)
    expect(impact).not.toBeNull()
    expect(impact!.event).toMatchObject({ peakChange: 18, id: 'rates:rate:se10y:daily' })
  })
})

/* ------------------------------ financial vs conversation relevance */

describe('financial relevance and conversation relevance', () => {
  const energyDown = () =>
    eventOf(
      observation('sector:energy', 'sectors', -4.5, {
        reference: 0.4,
        tags: { sector: 'energy' },
      }),
    )
  const selloff = () =>
    eventOf(observation('idx:nasdaq100', 'equities', -3.2, { tags: { region: 'us' } }))

  it('a small energy holding with a repeatedly voiced concern is low financially and high in conversation', () => {
    const worried = facts({
      portfolio: portfolio(67, 21, [
        holding('h-energy', 6, { sector: 'energy' }),
        holding('h-rest', 61),
      ]),
      contextFacts: [
        fact('cf-e1', 'concern', 'Orolig över energiexponeringen efter nedgången'),
        fact('cf-e2', 'concern', 'Vill inte ha mer energi i portföljen'),
      ],
      events: [meeting(10)],
    })
    const impact = assessImpact(energyDown(), exposureOf(worried), TODAY)!
    expect(impact).toMatchObject({
      financialRelevance: 'low',
      conversationRelevance: 'high',
      directness: 'direct',
    })
  })

  it('a large exposure with nothing said is high financially and none in conversation', () => {
    const exposed = facts({
      portfolio: portfolio(72, 13, [
        holding('h-us', 71, { currency: 'USD', region: 'us' }),
      ]),
    })
    expect(assessImpact(selloff(), exposureOf(exposed), TODAY)).toMatchObject({
      financialRelevance: 'high',
      conversationRelevance: 'none',
    })
  })

  it('context alone never claims financial exposure', () => {
    const cautious = facts({
      portfolio: portfolio(30, 60, [holding('h-fi', 60, { assetClass: 'fixed-income' })]),
      contextFacts: [fact('cf-b', 'behaviour', 'Blir obekväm vid större nedgångar')],
    })
    expect(assessImpact(selloff(), exposureOf(cautious), TODAY)).toMatchObject({
      financialRelevance: 'none',
      conversationRelevance: 'medium',
      directness: 'contextual',
    })
  })

  it('a loan is financial exposure, not conversation', () => {
    const borrower = facts({
      portfolio: portfolio(90, 5, [holding('h-eq', 90)]),
      liabilities: [loan('l-var', 'variable', null, EXPOSURE_THRESHOLDS.variableDebt)],
    })
    const rates = eventOf(
      observation('rate:se10y', 'rates', 18, { tags: { currency: 'SEK' } }),
    )
    expect(assessImpact(rates, exposureOf(borrower), TODAY)).toMatchObject({
      financialRelevance: 'low',
      conversationRelevance: 'none',
    })
  })
})
