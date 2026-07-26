import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { canonicalSymbol } from './instruments'
import { isoCurrency } from './primitives'
import { buildNewsItem, sortByRecency } from './news'
import { buildQuote, buildSeries, rebaseToPercent } from './observations'
import {
  buildProvenance,
  hasData,
  isDegraded,
  type DataSourceMetadata,
  type Envelope,
} from './provenance'
import { buildYield, buildYieldCurve, curveSlopeBasisPoints } from './rates'
import {
  buildDerivedSentiment,
  labelForScore,
  type SentimentComponent,
} from './sentiment'
import { INSTRUMENTS, SYM_SP500, SYM_US10Y, SYM_US2Y } from './symbols'

const clock = new FakeClock('2026-07-26T12:00:00.000Z')
const SOURCE: DataSourceMetadata = { providerId: 'test', providerName: 'Test' }

function provenance(overrides: Partial<Parameters<typeof buildProvenance>[0]> = {}) {
  return buildProvenance({
    asOf: clock.isoNow(),
    nowMs: clock.epochMs(),
    source: SOURCE,
    quality: 'realtime',
    ...overrides,
  })
}

describe('canonical symbols', () => {
  it('rejects unnamespaced or malformed ids', () => {
    expect(() => canonicalSymbol('sp500')).toThrow()
    expect(() => canonicalSymbol('IDX:SP500')).toThrow()
    expect(() => canonicalSymbol('bogus:x')).toThrow()
    expect(canonicalSymbol('idx:sp500')).toBe('idx:sp500')
  })

  it('gives every catalog entry a unique, self-consistent key', () => {
    for (const [key, ref] of Object.entries(INSTRUMENTS)) {
      expect(ref.symbol).toBe(key)
    }
    // Namespacing is what makes the legacy bitcoin/btc collision impossible.
    expect(new Set(Object.keys(INSTRUMENTS)).size).toBe(Object.keys(INSTRUMENTS).length)
  })
})

describe('buildProvenance', () => {
  it('derives ageMs from the clock and clamps it at zero', () => {
    const past = buildProvenance({
      asOf: '2026-07-26T11:59:00.000Z',
      nowMs: clock.epochMs(),
      source: SOURCE,
      quality: 'delayed',
    })
    expect(past.ageMs).toBe(60_000)
    expect(past.isDelayed).toBe(true)

    // A provider clock running ahead must not produce a negative age.
    const future = buildProvenance({
      asOf: '2026-07-26T12:01:00.000Z',
      nowMs: clock.epochMs(),
      source: SOURCE,
      quality: 'realtime',
    })
    expect(future.ageMs).toBe(0)
  })

  it('requires a proxyNote whenever isProxy is set', () => {
    expect(() =>
      buildProvenance({
        asOf: clock.isoNow(),
        nowMs: clock.epochMs(),
        source: SOURCE,
        quality: 'delayed',
        isProxy: true,
      }),
    ).toThrow(/proxyNote is required/)
  })

  it('rejects a non-ISO asOf', () => {
    expect(() =>
      buildProvenance({
        asOf: 'yesterday',
        nowMs: clock.epochMs(),
        source: SOURCE,
        quality: 'eod',
      }),
    ).toThrow(/valid ISO timestamp/)
  })
})

describe('envelope helpers', () => {
  const ok: Envelope<number> = { state: 'ok', data: 1, provenance: provenance() }

  it('treats stale, fixture, delayed and proxied values as degraded', () => {
    expect(isDegraded(ok)).toBe(false)
    expect(isDegraded({ ...ok, state: 'stale', staleReason: 'provider-error' })).toBe(
      true,
    )
    expect(isDegraded({ ...ok, state: 'fixture', reason: 'no provider' })).toBe(true)
    expect(isDegraded({ ...ok, provenance: provenance({ quality: 'delayed' }) })).toBe(
      true,
    )
    expect(
      isDegraded({
        ...ok,
        provenance: provenance({ isProxy: true, proxyNote: 'SPY for S&P 500' }),
      }),
    ).toBe(true)
  })

  it('reports which states carry readable data', () => {
    expect(hasData(ok)).toBe(true)
    expect(hasData({ state: 'loading' })).toBe(false)
    expect(
      hasData({
        state: 'error',
        error: { code: 'network', message: 'down', providerId: 'x', retryable: true },
      }),
    ).toBe(false)
  })
})

describe('buildQuote', () => {
  it('derives both change figures from the levels it was given', () => {
    const quote = buildQuote({
      symbol: SYM_SP500,
      value: 5843.12,
      previousClose: 5819.28,
      provenance: provenance(),
    })
    expect(quote.absoluteChange).toBeCloseTo(23.84, 6)
    expect(quote.percentageChange).toBeCloseTo(0.4097, 3)
  })

  it('reports null changes rather than a fabricated zero', () => {
    const quote = buildQuote({ symbol: SYM_SP500, value: 100, provenance: provenance() })
    expect(quote.previousClose).toBeNull()
    expect(quote.absoluteChange).toBeNull()
    expect(quote.percentageChange).toBeNull()
  })

  it('rejects a negative level', () => {
    expect(() =>
      buildQuote({ symbol: SYM_SP500, value: -1, provenance: provenance() }),
    ).toThrow(/must not be negative/)
  })
})

describe('buildSeries', () => {
  const points = [
    { t: '2026-07-26T11:00:00.000Z', v: 102 },
    { t: '2026-07-26T09:00:00.000Z', v: 100 },
    { t: '2026-07-26T10:00:00.000Z', v: 101 },
  ]

  it('sorts points ascending by timestamp', () => {
    const series = buildSeries({
      symbol: SYM_SP500,
      interval: '1h',
      points,
      provenance: provenance(),
    })
    expect(series.points.map((p) => p.v)).toEqual([100, 101, 102])
  })

  it('rejects non-finite values and invalid timestamps', () => {
    expect(() =>
      buildSeries({
        symbol: SYM_SP500,
        interval: '1h',
        points: [{ t: '2026-07-26T09:00:00.000Z', v: Number.NaN }],
        provenance: provenance(),
      }),
    ).toThrow(/non-finite/)

    expect(() =>
      buildSeries({
        symbol: SYM_SP500,
        interval: '1h',
        points: [{ t: 'noon', v: 1 }],
        provenance: provenance(),
      }),
    ).toThrow(/invalid timestamp/)
  })

  it('rebases to percent from the first point', () => {
    const series = buildSeries({
      symbol: SYM_SP500,
      interval: '1h',
      points,
      provenance: provenance(),
    })
    const rebased = rebaseToPercent(series)
    expect(rebased[0]?.v).toBe(0)
    expect(rebased[2]?.v).toBeCloseTo(2, 6)
  })

  it('rebases to null when the base point is zero', () => {
    const series = buildSeries({
      symbol: SYM_SP500,
      interval: '1h',
      points: [
        { t: '2026-07-26T09:00:00.000Z', v: 0 },
        { t: '2026-07-26T10:00:00.000Z', v: 5 },
      ],
      provenance: provenance(),
    })
    expect(rebaseToPercent(series).every((point) => point.v === null)).toBe(true)
  })
})

describe('yields', () => {
  it('expresses a yield move in basis points, not percent', () => {
    const y = buildYield({
      symbol: SYM_US10Y,
      countryCode: 'US',
      currency: isoCurrency('USD'),
      maturity: '10Y',
      seriesId: 'TEST',
      methodology: 'par-yield',
      observationDate: '2026-07-24',
      yieldPercent: 4.32,
      previousYieldPercent: 4.28,
      provenance: provenance({ quality: 'eod' }),
    })
    // 0.04 percentage points is 4 bp — the classic rates unit confusion.
    expect(y.changeBasisPoints).toBeCloseTo(4, 6)
  })

  it('rejects a maturity that contradicts an explicit tenor', () => {
    // Two answers to one question is worse than none, so the disagreement is
    // refused rather than silently resolved in favour of either.
    expect(() =>
      buildYield({
        symbol: SYM_US10Y,
        countryCode: 'US',
        currency: isoCurrency('USD'),
        maturity: '10Y',
        tenorMonths: 24,
        seriesId: 'TEST',
        methodology: 'par-yield',
        observationDate: '2026-07-24',
        yieldPercent: 4,
        provenance: provenance(),
      }),
    ).toThrow(/is 120 months, not 24/)
  })

  it('requires either a maturity or a tenor', () => {
    expect(() =>
      buildYield({
        symbol: SYM_US10Y,
        countryCode: 'US',
        currency: isoCurrency('USD'),
        seriesId: 'TEST',
        methodology: 'par-yield',
        observationDate: '2026-07-24',
        yieldPercent: 4,
        provenance: provenance(),
      }),
    ).toThrow(/supply a maturity or a tenorMonths/)
  })

  it('refuses to mix issuers in one curve', () => {
    const us = buildYield({
      symbol: SYM_US2Y,
      countryCode: 'US',
      currency: isoCurrency('USD'),
      maturity: '2Y',
      seriesId: 'TEST',
      methodology: 'par-yield',
      observationDate: '2026-07-24',
      yieldPercent: 3.91,
      provenance: provenance(),
    })
    const de = buildYield({
      symbol: SYM_US10Y,
      countryCode: 'DE',
      currency: isoCurrency('USD'),
      maturity: '10Y',
      seriesId: 'TEST',
      methodology: 'par-yield',
      observationDate: '2026-07-24',
      yieldPercent: 2.48,
      provenance: provenance(),
    })
    expect(() =>
      buildYieldCurve({ countryCode: 'US', points: [us, de], provenance: provenance() }),
    ).toThrow(/contains a DE point/)
  })

  it('computes 10Y-2Y slope, or null when a tenor is missing', () => {
    const short = buildYield({
      symbol: SYM_US2Y,
      countryCode: 'US',
      currency: isoCurrency('USD'),
      maturity: '2Y',
      seriesId: 'TEST',
      methodology: 'par-yield',
      observationDate: '2026-07-24',
      yieldPercent: 3.91,
      provenance: provenance(),
    })
    const long = buildYield({
      symbol: SYM_US10Y,
      countryCode: 'US',
      currency: isoCurrency('USD'),
      maturity: '10Y',
      seriesId: 'TEST',
      methodology: 'par-yield',
      observationDate: '2026-07-24',
      yieldPercent: 4.32,
      provenance: provenance(),
    })
    const curve = buildYieldCurve({
      countryCode: 'US',
      points: [long, short],
      provenance: provenance(),
    })
    expect(curve.points[0]?.tenorMonths).toBe(24)
    expect(curveSlopeBasisPoints(curve)).toBeCloseTo(41, 6)

    const partial = buildYieldCurve({
      countryCode: 'US',
      points: [long],
      provenance: provenance(),
    })
    expect(curveSlopeBasisPoints(partial)).toBeNull()
  })
})

describe('news', () => {
  it('rejects an out-of-range sentiment score and an invalid timestamp', () => {
    const base = {
      id: 'a',
      headline: 'H',
      outlet: 'Reuters',
      publishedAt: clock.isoNow(),
      provenance: provenance(),
    }
    expect(() => buildNewsItem({ ...base, sentimentScore: 1.4 })).toThrow(/-1\.\.1/)
    expect(() => buildNewsItem({ ...base, publishedAt: 'today' })).toThrow(
      /invalid publishedAt/,
    )
  })

  it('defaults absent optional fields to null rather than inventing them', () => {
    const item = buildNewsItem({
      id: 'a',
      headline: 'H',
      outlet: 'Reuters',
      publishedAt: clock.isoNow(),
      provenance: provenance(),
    })
    expect(item.summary).toBeNull()
    expect(item.url).toBeNull()
    expect(item.sentimentScore).toBeNull()
    expect(item.symbols).toEqual([])
  })

  it('sorts newest first', () => {
    const make = (id: string, publishedAt: string) =>
      buildNewsItem({
        id,
        headline: id,
        outlet: 'R',
        publishedAt,
        provenance: provenance(),
      })
    const sorted = sortByRecency([
      make('old', '2026-07-25T08:00:00.000Z'),
      make('new', '2026-07-26T08:00:00.000Z'),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['new', 'old'])
  })
})

describe('derived sentiment', () => {
  const component = (
    overrides: Partial<SentimentComponent> & Pick<SentimentComponent, 'id'>,
  ): SentimentComponent => ({
    label: overrides.id,
    contribution: 0,
    inputValue: 0,
    inputAsOf: clock.isoNow(),
    inputQuality: 'realtime',
    ...overrides,
  })

  it('sums contributions from the baseline and labels the result', () => {
    const sentiment = buildDerivedSentiment({
      components: [
        component({ id: 'vix', contribution: 14 }),
        component({ id: 'btc-24h', contribution: 8 }),
      ],
      formulaVersion: 'v1',
      nowMs: clock.epochMs(),
      source: SOURCE,
    })
    expect(sentiment.score).toBe(72)
    expect(sentiment.label).toBe('risk-on')
    expect(sentiment.origin).toBe('derived')
    expect(sentiment.provenance.quality).toBe('derived')
  })

  it('clamps a runaway score to the 0..100 gauge track', () => {
    const high = buildDerivedSentiment({
      components: [component({ id: 'vix', contribution: 900 })],
      formulaVersion: 'v1',
      nowMs: clock.epochMs(),
      source: SOURCE,
    })
    expect(high.score).toBe(100)
  })

  it('is never fresher than its stalest input', () => {
    const sentiment = buildDerivedSentiment({
      components: [
        component({ id: 'fresh', inputAsOf: '2026-07-26T11:59:00.000Z' }),
        component({ id: 'stale', inputAsOf: '2026-07-26T06:00:00.000Z' }),
      ],
      formulaVersion: 'v1',
      nowMs: clock.epochMs(),
      source: SOURCE,
    })
    expect(sentiment.provenance.asOf).toBe('2026-07-26T06:00:00.000Z')
    expect(sentiment.provenance.ageMs).toBe(6 * 60 * 60 * 1000)
  })

  it('degrades to fixture quality when any input was a fixture', () => {
    // Deriving from invented inputs must not launder them into a
    // production-eligible "derived" value (decision D2).
    const sentiment = buildDerivedSentiment({
      components: [
        component({ id: 'real', inputQuality: 'realtime' }),
        component({ id: 'made-up', inputQuality: 'fixture' }),
      ],
      formulaVersion: 'v1',
      nowMs: clock.epochMs(),
      source: SOURCE,
    })
    expect(sentiment.origin).toBe('fixture')
    expect(sentiment.provenance.quality).toBe('fixture')
  })

  it('requires a formulaVersion and at least one component', () => {
    expect(() =>
      buildDerivedSentiment({
        components: [],
        formulaVersion: 'v1',
        nowMs: clock.epochMs(),
        source: SOURCE,
      }),
    ).toThrow(/at least one component/)

    expect(() =>
      buildDerivedSentiment({
        components: [component({ id: 'vix' })],
        formulaVersion: '',
        nowMs: clock.epochMs(),
        source: SOURCE,
      }),
    ).toThrow(/formulaVersion is required/)
  })

  it('labels scores at the band boundaries', () => {
    expect(labelForScore(40)).toBe('risk-off')
    expect(labelForScore(50)).toBe('neutral')
    expect(labelForScore(60)).toBe('risk-on')
  })
})
