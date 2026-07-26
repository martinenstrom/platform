/**
 * Central-bank state through the full pipeline (Phase 6A exit criteria).
 *
 * Adapter contracts live in `providers/policy.contract.test.ts`. This file
 * proves the end-to-end path and the two properties that matter operationally:
 * each institution resolves independently, and live mode never shows a
 * fixture.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { hasData, type Envelope } from '~/domain/shared/provenance'
import type { CentralBankPolicyState } from '~/domain/policy'
import { getCentralBanksSnapshot } from '~/application/policy/getCentralBanksSnapshot'
import { policyFor } from '~/application/marketData/policy'
import { createContainer } from './container'
import { createCentralBanksDataSource } from './centralBanksDataSource'
import { createFixtureProvider } from './providers/fixture'
import { createNewYorkFedProvider } from './providers/newYorkFed'
import { createEcbProvider, ECB_SERIES } from './providers/ecb'
import { createRiksbankPolicyProvider } from './providers/riksbankPolicy'
import { HttpError, type HttpClient } from './providers/httpClient'

const DIR = resolvePath(
  process.cwd(),
  'src/infrastructure/marketData/providers/__fixtures__',
)
const F = (name: string) => readFileSync(join(DIR, name), 'utf8')
const NOW = '2026-07-26T16:00:00.000Z'

const ALL_CAPS = new Set([
  'quotes',
  'series',
  'fx',
  'yields',
  'commodities',
  'crypto',
  'news',
  'sentiment',
  'policy-rates',
] as const)

function routed(routes: Array<[RegExp, string]>): HttpClient {
  const answer = (url: string) => {
    const hit = routes.find(([pattern]) => pattern.test(url))
    if (!hit) throw new HttpError('not-found', `unrouted ${url}`)
    return hit[1]
  }
  return {
    async getText(url: string) {
      return answer(url)
    },
    async getJson<T>(url: string) {
      return JSON.parse(answer(url)) as T
    },
  }
}

const WORKING = (): HttpClient =>
  routed([
    [/newyorkfed/, F('nyfed.effr.json')],
    [new RegExp(ECB_SERIES.depositFacility.replace(/\./g, '\\.')), F('ecb.dfr.csv')],
    [new RegExp(ECB_SERIES.mainRefinancing.replace(/\./g, '\\.')), F('ecb.mro.csv')],
    [new RegExp(ECB_SERIES.marginalLending.replace(/\./g, '\\.')), F('ecb.mlf.csv')],
    [/Observations\/SECBREPOEFF/, F('riksbank.policyrate.json')],
    [/CalendarDays/, F('riksbank.calendardays.json')],
  ])

const DOWN = (): HttpClient => ({
  async getText(): Promise<string> {
    throw new HttpError('network', 'source unavailable')
  },
  async getJson<T>(): Promise<T> {
    throw new HttpError('network', 'source unavailable')
  },
})

function build(options: {
  mode: 'fixture' | 'hybrid' | 'live'
  http?: HttpClient
  /** Per-bank override, for the isolation tests. */
  perBank?: { fed?: HttpClient; ecb?: HttpClient; riks?: HttpClient }
}) {
  const env: Record<string, string> = { MARKETDATA_MODE: options.mode }
  const http = options.http ?? WORKING()
  const network =
    options.mode === 'fixture'
      ? []
      : [
          {
            provider: createNewYorkFedProvider(options.perBank?.fed ?? http),
            capabilities: new Set(['policy-rates'] as const),
          },
          {
            provider: createEcbProvider(options.perBank?.ecb ?? http),
            capabilities: new Set(['policy-rates'] as const),
          },
          {
            provider: createRiksbankPolicyProvider(options.perBank?.riks ?? http),
            capabilities: new Set(['policy-rates'] as const),
          },
        ]
  return createContainer({
    env,
    clock: new FakeClock(NOW),
    random: new SeededRandom(1),
    providers: [
      ...network,
      { provider: createFixtureProvider(), capabilities: ALL_CAPS },
    ],
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, maxAttemptsRateLimited: 1 },
  })
}

const snapshotOf = (options: Parameters<typeof build>[0]) =>
  getCentralBanksSnapshot(createCentralBanksDataSource(build(options)))

/* ---------------------------------------------------------------- resolution */

describe('all three institutions resolve', () => {
  it('serves each from its own official source', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid' })

    expect(snapshot.federalReserve.state).toBe('ok')
    expect(snapshot.ecb.state).toBe('ok')
    expect(snapshot.riksbank.state).toBe('ok')

    if (!hasData(snapshot.federalReserve)) throw new Error('no fed')
    if (!hasData(snapshot.ecb)) throw new Error('no ecb')
    if (!hasData(snapshot.riksbank)) throw new Error('no riksbank')

    expect(snapshot.federalReserve.provenance.source.providerId).toBe('nyfed')
    expect(snapshot.ecb.provenance.source.providerId).toBe('ecb')
    expect(snapshot.riksbank.provenance.source.providerId).toBe('riksbank-policy')
  })

  it('keeps each structure intact through the pipeline', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid' })
    if (!hasData(snapshot.federalReserve)) throw new Error('no fed')
    if (!hasData(snapshot.ecb)) throw new Error('no ecb')
    if (!hasData(snapshot.riksbank)) throw new Error('no riksbank')

    expect(snapshot.federalReserve.data.regime.level.kind).toBe('target-range')
    expect(snapshot.ecb.data.regime.level.kind).toBe('key-rates')
    expect(snapshot.riksbank.data.regime.level.kind).toBe('single')
  })

  it('never conflates observation and effective dates', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid' })
    const all: Array<Envelope<CentralBankPolicyState>> = [
      snapshot.federalReserve,
      snapshot.ecb,
      snapshot.riksbank,
    ]
    for (const envelope of all) {
      if (!hasData(envelope)) throw new Error('missing state')
      const { regime } = envelope.data
      expect(regime.effectiveDate).not.toBe(regime.observationDate)
      expect(regime.observationRelation).toBe('repeated-confirmation')
    }
  })

  it('reports the oldest observation as the snapshot asOf', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid' })
    // The Fed fixture is the oldest of the three.
    expect(snapshot.asOf).toBe('2026-01-15T00:00:00.000Z')
    expect(snapshot.generatedAt).toBe(NOW)
    expect(snapshot.correlationId).toBeTruthy()
  })
})

/* ----------------------------------------------------------------- isolation */

describe('one institution failing does not affect the others', () => {
  it('loses only the ECB when the ECB is down', async () => {
    const snapshot = await snapshotOf({
      mode: 'live',
      perBank: { ecb: DOWN() },
    })
    expect(snapshot.ecb.state).toBe('error')
    // "The ECB is unavailable" is not a statement about the Fed.
    expect(snapshot.federalReserve.state).toBe('ok')
    expect(snapshot.riksbank.state).toBe('ok')
  })

  it('loses only the Fed when the Fed is down', async () => {
    const snapshot = await snapshotOf({ mode: 'live', perBank: { fed: DOWN() } })
    expect(snapshot.federalReserve.state).toBe('error')
    expect(snapshot.ecb.state).toBe('ok')
    expect(snapshot.riksbank.state).toBe('ok')
  })

  it('still returns a snapshot when all three are down', async () => {
    const snapshot = await snapshotOf({ mode: 'live', http: DOWN() })
    expect(snapshot.federalReserve.state).toBe('error')
    expect(snapshot.ecb.state).toBe('error')
    expect(snapshot.riksbank.state).toBe('error')
    // No rejection, and no fabricated observation date.
    expect(snapshot.asOf).toBe(snapshot.generatedAt)
  })
})

/* ---------------------------------------------------------------- mode rules */

describe('mode behaviour', () => {
  it('fixture: no network provider is registered', async () => {
    const snapshot = await snapshotOf({ mode: 'fixture' })
    expect(snapshot.riksbank.state).toBe('fixture')
    if (!hasData(snapshot.riksbank)) throw new Error('no state')
    expect(snapshot.riksbank.provenance.source.trust).toBe('synthetic')
  })

  it('hybrid: falls back to a labelled fixture', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid', http: DOWN() })
    expect(snapshot.ecb.state).toBe('fixture')
    if (!hasData(snapshot.ecb)) throw new Error('no state')
    expect(snapshot.ecb.provenance.quality).toBe('fixture')
  })

  it('live: shows an error rather than a fixture', async () => {
    const snapshot = await snapshotOf({ mode: 'live', http: DOWN() })
    const all: Array<Envelope<CentralBankPolicyState>> = [
      snapshot.federalReserve,
      snapshot.ecb,
      snapshot.riksbank,
    ]
    for (const envelope of all) {
      expect(envelope.state).toBe('error')
      expect(hasData(envelope)).toBe(false)
    }
  })

  it('live: carries no synthetic provenance at all', async () => {
    const snapshot = await snapshotOf({ mode: 'live' })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('"trust":"synthetic"')
    expect(serialized).not.toContain('"quality":"fixture"')
  })
})

/* -------------------------------------------------------------------- policy */

describe('the policy-rate freshness policy', () => {
  it('is identical for all three and does not revalidate', () => {
    for (const category of ['policy-us', 'policy-ea', 'policy-se'] as const) {
      const policy = policyFor(category)
      expect(policy.ttlOpenMs).toBe(6 * 60 * 60 * 1000)
      // No trading session applies, so both TTLs are the same on purpose.
      expect(policy.ttlClosedMs).toBe(policy.ttlOpenMs)
      expect(policy.fallback.maxStaleMs).toBe(5 * 24 * 60 * 60 * 1000)
      expect(policy.staleWhileRevalidate).toBe(false)
      expect(policy.fallback.allowFixture).toBe('non-production')
    }
  })

  it('ages from the observation, so a long-standing rate is not stale', async () => {
    const snapshot = await snapshotOf({ mode: 'hybrid' })
    if (!hasData(snapshot.riksbank)) throw new Error('no state')
    const { provenance, regime } = snapshot.riksbank.data
    // The rate last moved in October; the source confirmed it two days ago.
    expect(regime.effectiveDate).toBe('2025-10-01')
    expect(provenance.ageMs).toBeLessThan(policyFor('policy-se').fallback.maxStaleMs)
    expect(snapshot.riksbank.state).toBe('ok')
  })
})
