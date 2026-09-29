/**
 * Example market moves for demonstration.
 *
 * The fixture market is calm by design (US 10Y 0 bp, S&P 500 +0.41 %), so
 * nothing Market-to-Client does can be seen on a clean checkout. Setting
 * `MARKET_TO_CLIENT_SCENARIO=rates-up,energy-down` reshapes the named series
 * of whatever the pipeline reported. Every overridden observation is stamped
 * `quality: 'fixture'`, `source: 'Exempelscenario'` and the advisory clock's
 * time, so no surface can present an invented move as a market observation,
 * and the brief names the scenario it was shaped by.
 *
 * Synthetic and server-only. Never read by tests, never a substitute for the
 * pipeline, never applied unless the variable is set.
 */

import type { MarketObservation } from '~/domain/advisory'

export const MARKET_SCENARIOS = [
  'rates-up',
  'rates-major',
  'equity-selloff',
  'energy-down',
  'usd-up',
  'gold-up',
  'tech-up',
  'risk-off',
  'calm',
] as const

export type MarketScenario = (typeof MARKET_SCENARIOS)[number]

interface Override {
  symbol: string
  /** The move, in the observation's own unit. */
  change: number
  /** The level, where the scenario states one; otherwise the reported level stays. */
  value?: number
}

const SCENARIO_OVERRIDES: Record<MarketScenario, readonly Override[]> = {
  /* Swedish and European long yields up: a notable move, below the major line. */
  'rates-up': [
    { symbol: 'rate:se10y', change: 18, value: 2.84 },
    { symbol: 'rate:de10y', change: 12, value: 2.61 },
    { symbol: 'rate:us10y', change: 14, value: 4.46 },
    { symbol: 'rate:us2y', change: 9, value: 4.0 },
  ],
  /* The same curve, past the major line. */
  'rates-major': [
    { symbol: 'rate:se10y', change: 24, value: 2.9 },
    { symbol: 'rate:de10y', change: 19, value: 2.68 },
    { symbol: 'rate:us10y', change: 21, value: 4.53 },
    { symbol: 'rate:us2y', change: 11, value: 4.02 },
  ],
  /* A broad equity selloff with sectors moving together, so no sector stands out. */
  'equity-selloff': [
    { symbol: 'idx:sp500', change: -2.4 },
    { symbol: 'idx:nasdaq100', change: -3.2 },
    { symbol: 'idx:omxs30', change: -2.1 },
    { symbol: 'idx:dax', change: -1.9 },
    { symbol: 'idx:ftse100', change: -1.6 },
    { symbol: 'idx:nikkei225', change: -1.0 },
    { symbol: 'sector:technology', change: -3.1 },
    { symbol: 'sector:communication', change: -2.6 },
    { symbol: 'sector:industrials', change: -2.2 },
    { symbol: 'sector:financials', change: -2.8 },
    { symbol: 'sector:discretionary', change: -2.9 },
    { symbol: 'sector:healthcare', change: -1.2 },
    { symbol: 'sector:realestate', change: -1.9 },
    { symbol: 'sector:energy', change: -1.7 },
    { symbol: 'sector:staples', change: -0.6 },
    { symbol: 'sentiment:cross-asset', change: -16, value: 34 },
  ],
  /* Energy alone: the sector against a flat market, and Brent with it. */
  'energy-down': [
    { symbol: 'sector:energy', change: -4.5 },
    { symbol: 'cmd:brent', change: -5.2, value: 62.3 },
  ],
  'usd-up': [{ symbol: 'fx:usdsek', change: 1.6, value: 10.58 }],
  /* A material move no synthetic client holds anything against. */
  'gold-up': [{ symbol: 'cmd:gold', change: 4.1, value: 2483.2 }],
  /* A positive sector move, to show relevance is not alarm. */
  'tech-up': [{ symbol: 'sector:technology', change: 3.4 }],
  /* Risk-off regime with a modest index move. */
  'risk-off': [
    { symbol: 'sentiment:cross-asset', change: -26, value: 24 },
    { symbol: 'idx:sp500', change: -1.8 },
    { symbol: 'idx:omxs30', change: -1.7 },
  ],
  calm: [],
}

function isScenario(name: string): name is MarketScenario {
  return (MARKET_SCENARIOS as readonly string[]).includes(name)
}

/** The scenarios a `MARKET_TO_CLIENT_SCENARIO` value names, unknown names dropped. */
export function parseMarketScenarios(value: string | undefined): MarketScenario[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(isScenario)
}

/** The observations with the scenarios' moves applied, each stamped as example data. */
export function applyMarketScenario(
  observations: readonly MarketObservation[],
  scenarios: readonly MarketScenario[],
  now: string,
): MarketObservation[] {
  if (scenarios.length === 0) return [...observations]
  const overrides = new Map<string, Override>()
  for (const scenario of scenarios) {
    for (const override of SCENARIO_OVERRIDES[scenario])
      overrides.set(override.symbol, override)
  }
  const reference = new Map<string, number>()
  const shaped = observations.map((observation) => {
    const override = overrides.get(observation.symbol)
    if (!override) return observation
    const next: MarketObservation = {
      ...observation,
      change: override.change,
      value: override.value ?? observation.value,
      observedAt: now,
      source: 'Exempelscenario',
      quality: 'fixture',
    }
    return next
  })
  /* A sector is measured against the broad index; the scenario's index move is the reference. */
  for (const o of shaped)
    if (o.category === 'equities') reference.set(o.symbol, o.change ?? 0)
  const broad = reference.get('idx:sp500')
  return shaped.map((o) =>
    o.category === 'sectors' && broad !== undefined ? { ...o, reference: broad } : o,
  )
}
