/**
 * Policy adapter contracts.
 *
 * Every payload here was recorded from the live source on 2026-07-26 and each
 * one spans a real policy change, so the carry-forward tests run against the
 * shape the institutions actually publish rather than a convenient invention.
 * No network, no keys.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import type { FetchContext } from '~/application/marketData/ports'
import { createNewYorkFedProvider, NY_FED_SOURCE, parseNyFedRefRates } from './newYorkFed'
import { createEcbProvider, ECB_SERIES, ECB_SOURCE, parseEcbCsv } from './ecb'
import {
  createRiksbankPolicyProvider,
  parseBankDays,
  RIKSBANK_POLICY_SOURCE,
} from './riksbankPolicy'
import { RIKSBANK_SOURCE } from './riksbank'
import { HttpError, type HttpClient } from './httpClient'

const F = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const NOW = '2026-07-26T16:00:00.000Z'

function context(): FetchContext {
  return {
    signal: new AbortController().signal,
    clock: new FakeClock(NOW),
    correlationId: 'test' as FetchContext['correlationId'],
  }
}

/** Serves recorded bytes; fails loudly on an unexpected URL. */
function http(
  routes: Array<[RegExp, string]>,
  onUrl?: (url: string) => void,
): HttpClient {
  const answer = (url: string) => {
    onUrl?.(url)
    const hit = routes.find(([pattern]) => pattern.test(url))
    if (!hit) throw new HttpError('not-found', `unrouted url ${url}`)
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

/* ------------------------------------------------------------ New York Fed */

const NYFED_ROUTES: Array<[RegExp, string]> = [
  [/markets\.newyorkfed\.org/, F('nyfed.effr.json')],
]

describe('New York Fed', () => {
  it('keeps the target range a range, with no midpoint anywhere', async () => {
    const state = await createNewYorkFedProvider(http(NYFED_ROUTES)).fetchPolicyState(
      context(),
    )
    expect(state.centralBank).toBe('federal-reserve')
    expect(state.regime.level).toEqual({
      kind: 'target-range',
      lowerPercent: 3.5,
      upperPercent: 3.75,
    })
    // 3.625 would be the midpoint. It must appear nowhere.
    expect(JSON.stringify(state)).not.toContain('3.625')
  })

  it('keeps the effective federal funds rate a separate observation', async () => {
    const state = await createNewYorkFedProvider(http(NYFED_ROUTES)).fetchPolicyState(
      context(),
    )
    if (state.centralBank !== 'federal-reserve') throw new Error('wrong bank')
    // Where the market traded, not what the committee set.
    expect(state.effectiveFedFundsRate?.ratePercent).toBe(3.64)
    expect(state.effectiveFedFundsRate?.observationDate).toBe('2026-01-15')
    // And it is not the level.
    // Inside the 3.50-3.75 range, and not the range itself.
    expect(state.regime.level).not.toMatchObject({ ratePercent: 3.64 })
  })

  it('finds the real effective date, not the observation date', async () => {
    const state = await createNewYorkFedProvider(http(NYFED_ROUTES)).fetchPolicyState(
      context(),
    )
    expect(state.regime.observationDate).toBe('2026-01-15')
    expect(state.regime.effectiveDate).toBe('2025-12-11')
    expect(state.regime.observationRelation).toBe('repeated-confirmation')
    expect(state.regime.change).toEqual({
      kind: 'target-range',
      lowerBasisPoints: -25,
      upperBasisPoints: -25,
    })
  })

  it('records the FOMC as originator, the desk as access provider', () => {
    expect(NY_FED_SOURCE.trust).toBe('central-bank')
    expect(NY_FED_SOURCE.originator).toBe('Federal Open Market Committee')
  })

  it('drops a row with only one bound rather than completing it', () => {
    const { levels } = parseNyFedRefRates({
      refRates: [
        {
          type: 'EFFR',
          effectiveDate: '2026-07-01',
          targetRateFrom: 3.5,
          percentRate: 3.6,
        },
        {
          type: 'EFFR',
          effectiveDate: '2026-07-02',
          targetRateFrom: 3.5,
          targetRateTo: 3.75,
          percentRate: 3.6,
        },
      ],
    })
    // The half row is discarded; `percentRate` never fills the missing bound.
    expect(levels).toHaveLength(1)
    expect(levels[0]?.date).toBe('2026-07-02')
  })

  it('fails rather than inventing a level when nothing is usable', async () => {
    const empty = http([[/newyorkfed/, JSON.stringify({ refRates: [] })]])
    await expect(
      createNewYorkFedProvider(empty).fetchPolicyState(context()),
    ).rejects.toThrow(/no usable target range/)
  })

  it('reports date-only precision, because the payload has no time', async () => {
    const state = await createNewYorkFedProvider(http(NYFED_ROUTES)).fetchPolicyState(
      context(),
    )
    expect(state.provenance.asOfPrecision).toBe('date')
    expect(state.provenance.quality).toBe('official-daily')
    expect(state.provenance.isDelayed).toBe(false)
  })
})

/* ---------------------------------------------------------------------- ECB */

const ECB_ROUTES: Array<[RegExp, string]> = [
  [new RegExp(ECB_SERIES.depositFacility.replace(/\./g, '\\.')), F('ecb.dfr.csv')],
  [new RegExp(ECB_SERIES.mainRefinancing.replace(/\./g, '\\.')), F('ecb.mro.csv')],
  [new RegExp(ECB_SERIES.marginalLending.replace(/\./g, '\\.')), F('ecb.mlf.csv')],
]

describe('ECB', () => {
  it('keeps all three key rates structurally distinct', async () => {
    const state = await createEcbProvider(http(ECB_ROUTES)).fetchPolicyState(context())
    expect(state.regime.level).toEqual({
      kind: 'key-rates',
      depositFacilityPercent: 2.25,
      mainRefinancingPercent: 2.4,
      marginalLendingPercent: 2.65,
    })
    if (state.centralBank !== 'ecb') throw new Error('wrong bank')
    expect(state.primaryRate).toBe('deposit-facility')
  })

  it('separates a Sunday observation from a June effective date', async () => {
    // The trap this whole phase is built around, on real bytes: the ECB
    // carried the value forward every calendar day for 39 days, weekends
    // included, and the latest observation is a Sunday.
    const state = await createEcbProvider(http(ECB_ROUTES)).fetchPolicyState(context())
    expect(state.regime.observationDate).toBe('2026-07-26')
    expect(new Date('2026-07-26T00:00:00Z').getUTCDay()).toBe(0)
    expect(state.regime.effectiveDate).toBe('2026-06-17')
    expect(state.regime.observationRelation).toBe('repeated-confirmation')
    expect(state.regime.observationRelation).not.toBe('transition')
  })

  it('reports a delta for each of the three rates', async () => {
    const state = await createEcbProvider(http(ECB_ROUTES)).fetchPolicyState(context())
    expect(state.regime.change).toEqual({
      kind: 'key-rates',
      depositFacilityBasisPoints: 25,
      mainRefinancingBasisPoints: 25,
      marginalLendingBasisPoints: 25,
    })
  })

  it('resolves CSV columns from the header rather than by position', () => {
    const observations = parseEcbCsv(
      'KEY,TIME_PERIOD,OBS_VALUE\nFM.X,2026-07-01,2.25\nFM.X,2026-07-02,2.25\n',
    )
    expect(observations).toEqual([
      { date: '2026-07-01', value: 2.25 },
      { date: '2026-07-02', value: 2.25 },
    ])
  })

  it('drops rows with an empty or unparseable value', () => {
    expect(
      parseEcbCsv(
        'TIME_PERIOD,OBS_VALUE\n2026-07-01,\n2026-07-02,n/a\n2026-07-03,2.25\n',
      ),
    ).toEqual([{ date: '2026-07-03', value: 2.25 }])
  })

  it('drops a date where one of the three rates is missing', async () => {
    // A level is a structure of three. Two rates plus a stale third would be a
    // corridor that never existed.
    const short = F('ecb.mlf.csv')
      .split('\n')
      .filter((line) => !line.includes('2026-07-26'))
      .join('\n')
    const state = await createEcbProvider(
      http([
        [new RegExp(ECB_SERIES.depositFacility.replace(/\./g, '\\.')), F('ecb.dfr.csv')],
        [new RegExp(ECB_SERIES.mainRefinancing.replace(/\./g, '\\.')), F('ecb.mro.csv')],
        [new RegExp(ECB_SERIES.marginalLending.replace(/\./g, '\\.')), short],
      ]),
    ).fetchPolicyState(context())
    expect(state.regime.observationDate).toBe('2026-07-25')
  })

  it('claims no originator, because the ECB sets what it publishes', () => {
    expect(ECB_SOURCE.trust).toBe('central-bank')
    expect(ECB_SOURCE.originator).toBeUndefined()
  })

  it('requests exactly the three official series', async () => {
    const urls: string[] = []
    await createEcbProvider(http(ECB_ROUTES, (u) => urls.push(u))).fetchPolicyState(
      context(),
    )
    expect(urls).toHaveLength(3)
    expect(urls.some((u) => u.includes('DFR'))).toBe(true)
    expect(urls.some((u) => u.includes('MRR_FR'))).toBe(true)
    expect(urls.some((u) => u.includes('MLFR'))).toBe(true)
  })
})

/* ----------------------------------------------------------------- Riksbank */

const RIKS_ROUTES: Array<[RegExp, string]> = [
  [/Observations\/SECBREPOEFF/, F('riksbank.policyrate.json')],
  [/CalendarDays/, F('riksbank.calendardays.json')],
]

describe('Riksbank policy rate', () => {
  it('keeps a scalar policy rate with no corridor fields', async () => {
    const state = await createRiksbankPolicyProvider(http(RIKS_ROUTES)).fetchPolicyState(
      context(),
    )
    expect(state.regime.level).toEqual({ kind: 'single', ratePercent: 1.75 })
    expect(state.rateType).toBe('policy-rate')
  })

  it('stores neither corridor rates nor the forecast path', async () => {
    const state = await createRiksbankPolicyProvider(http(RIKS_ROUTES)).fetchPolicyState(
      context(),
    )
    const keys = Object.keys(state).join(' ')
    expect(keys).not.toMatch(/deposit|lending|corridor|path|forecast/i)
    // 1.75 - 0.75 = 1.0 and 1.75 + 0.75 = 2.5: neither may have been derived.
    expect(JSON.stringify(state.regime.level)).not.toContain('2.5')
  })

  it('separates a July observation from an October effective date', async () => {
    const state = await createRiksbankPolicyProvider(http(RIKS_ROUTES)).fetchPolicyState(
      context(),
    )
    expect(state.regime.observationDate).toBe('2026-07-24')
    expect(state.regime.effectiveDate).toBe('2025-10-01')
    expect(state.regime.observationRelation).toBe('repeated-confirmation')
    expect(state.regime.change).toEqual({ kind: 'single', basisPoints: -25 })
  })

  it('claims no originator, unlike the yield series on the same API', () => {
    // The contrast is the point: same institution, same transport, and one is
    // a Refinitiv benchmark while the other is the Riksbank's own decision.
    expect(RIKSBANK_POLICY_SOURCE.originator).toBeUndefined()
    expect(RIKSBANK_SOURCE.originator).toBe('Refinitiv')
    expect(RIKSBANK_SOURCE.originatorTrust).toBe('licensed-vendor')
  })

  it('uses the bank-day calendar only for publication detection', async () => {
    const state = await createRiksbankPolicyProvider(http(RIKS_ROUTES)).fetchPolicyState(
      context(),
    )
    // The observation is the latest bank day, so nothing was skipped.
    expect(state.publication).toBe('current')
  })

  it('degrades to cadence-unknown when the calendar fails, keeping the rate', async () => {
    const provider = createRiksbankPolicyProvider(
      http([[/Observations\/SECBREPOEFF/, F('riksbank.policyrate.json')]]),
    )
    const state = await provider.fetchPolicyState(context())
    // A broken calendar must not lose the rate, and must not invent a miss.
    expect(state.regime.level).toEqual({ kind: 'single', ratePercent: 1.75 })
    expect(state.publication).toBe('cadence-unknown')
  })

  it('keeps only genuine bank days from the calendar', () => {
    expect(parseBankDays(JSON.parse(F('riksbank.calendardays.json')))).toEqual([
      '2026-07-24',
    ])
  })

  it('fails rather than inventing a rate when the series is empty', async () => {
    await expect(
      createRiksbankPolicyProvider(
        http([
          [/Observations/, '[]'],
          [/CalendarDays/, '[]'],
        ]),
      ).fetchPolicyState(context()),
    ).rejects.toThrow(/no policy-rate observation/)
  })
})

/* -------------------------------------------------- cross-source invariants */

describe('across all three institutions', () => {
  it('never reports the observation date as the effective date', async () => {
    const states = await Promise.all([
      createNewYorkFedProvider(http(NYFED_ROUTES)).fetchPolicyState(context()),
      createEcbProvider(http(ECB_ROUTES)).fetchPolicyState(context()),
      createRiksbankPolicyProvider(http(RIKS_ROUTES)).fetchPolicyState(context()),
    ])
    for (const state of states) {
      expect(state.regime.effectiveDate).not.toBe(state.regime.observationDate)
      expect(state.regime.observationRelation).toBe('repeated-confirmation')
      // A carried-forward observation is not a policy action.
      expect(state.regime.observationRelation).not.toBe('transition')
      expect(state.provenance.quality).toBe('official-daily')
    }
  })

  it('ages from the observation, never from the policy decision', async () => {
    const state = await createRiksbankPolicyProvider(http(RIKS_ROUTES)).fetchPolicyState(
      context(),
    )
    // Two days since the source last confirmed it, not ten months since the
    // rate moved. A standing policy rate is not stale data.
    expect(state.provenance.asOf).toBe('2026-07-24T00:00:00.000Z')
    expect(state.provenance.ageMs).toBeLessThan(3 * 86_400_000)
  })
})
