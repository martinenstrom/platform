/**
 * A market value may not reach a reader without its disclosure.
 *
 * ## The defect this guards
 *
 * `Envelope<T>` has always carried what a number is — `ok`, `stale`, `fixture`
 * or `error` — together with the provenance behind it. Every market surface
 * then read it through `dataOr`, which returns the data and drops the rest, so
 * a hard-coded fixture constant and an exchange quote arrived at the screen
 * indistinguishable from one another. The only disclosure left was one boolean
 * for the whole snapshot.
 *
 * The property protected here is architectural, not textual: **a surface that
 * presents a number as current market context must still have that number's
 * state available to it.** Nothing below asserts a particular instrument, a
 * particular level or a particular wording, because none of those is the
 * property — they change, and the rule must not.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { disclose, disclosedRows, isCurrent } from '~/presentation/marketData/disclosure'
import { buildProvenance, type Envelope } from '~/domain/shared/provenance'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * Every surface that presents numbers as current market context.
 *
 * A new one is added here when it is built. That is the point: the list is the
 * inventory the rule applies to, and leaving a surface off it is a decision
 * somebody has to make in this file rather than an omission nobody notices.
 */
const MARKET_SURFACES = [
  'src/components/lightDashboard/LightCommandCenter.tsx',
  'src/components/commandCenter/CommandCenter.tsx',
] as const

/** Envelope fixtures, built through the real provenance builder. */
const provenance = (over: Partial<Parameters<typeof buildProvenance>[0]> = {}) =>
  buildProvenance({
    asOf: '2026-08-24T10:00:00.000Z',
    nowMs: Date.parse('2026-08-24T10:00:30.000Z'),
    source: { providerId: 'p', providerName: 'Provider' },
    quality: 'realtime',
    ...over,
  })

const ok: Envelope<number[]> = { state: 'ok', data: [1], provenance: provenance() }
const stale: Envelope<number[]> = {
  state: 'stale',
  data: [1],
  provenance: provenance(),
  staleReason: 'no-fresh-source',
}
const fixture: Envelope<number[]> = {
  state: 'fixture',
  data: [1],
  provenance: provenance({ quality: 'fixture' }),
  reason: 'no live provider',
}

describe('a market surface keeps the state of what it renders', () => {
  it('reads quote envelopes through the disclosing projection', () => {
    /*
     * `dataOr` is not banned outright — a sparkline is a shape rather than a
     * quoted figure, and decorative series legitimately need only the data. But
     * a surface that renders market numbers must import the disclosure
     * projection, because without it there is nothing on the page that could
     * tell a fixture from a quote.
     */
    for (const surface of MARKET_SURFACES) {
      expect(read(surface), surface).toMatch(
        /from '~\/presentation\/marketData\/disclosure'/,
      )
    }
  })

  it('renders a disclosure for every category it projects', () => {
    /*
     * Counted rather than named: each category the surface discloses must also
     * be surfaced somewhere in its markup. A surface that computed a disclosure
     * and never rendered it would satisfy the import check and still tell the
     * reader nothing.
     */
    for (const surface of MARKET_SURFACES) {
      const source = read(surface)
      const computed = source.match(/disclose\w*\(|disclosedRows\(/g)?.length ?? 0
      const rendered =
        source.match(/MarketDisclosure|disclosure\.marker|ref-disclosure/g)?.length ?? 0
      expect(computed, `${surface} computes no disclosure`).toBeGreaterThan(0)
      expect(rendered, `${surface} renders no disclosure`).toBeGreaterThan(0)
    }
  })
})

describe('stale and fixture are not the same thing', () => {
  it('treats a stale quote as a real observation with an age', () => {
    const disclosure = disclose(stale)
    expect(disclosure.state).toBe('stale')
    expect(isCurrent(disclosure)).toBe(false)
    /* It was really observed, so it keeps its observation time and its source. */
    expect(disclosure.observedAt).toBe('2026-08-24T10:00:00.000Z')
    expect(disclosure.sourceName).toBe('Provider')
    expect(disclosure.marker).not.toBeNull()
  })

  it('treats fixture as not being a market observation at all', () => {
    const disclosure = disclose(fixture)
    expect(disclosure.state).toBe('fixture')
    expect(isCurrent(disclosure)).toBe(false)
    /*
     * The load-bearing assertion of this suite.
     *
     * `fixtureProvenance` stamps `asOf: now`, so the envelope offers a
     * timestamp that looks like a fresh observation and describes nothing but
     * the moment the constant was read out of the repository. Exposing it would
     * restate the original defect in a more confident voice, so the field a
     * surface would need is null and no rendering convention can recover it.
     */
    expect(disclosure.observedAt).toBeNull()
    expect(disclosure.sourceName).toBeNull()
    expect(disclosure.marker).not.toBeNull()
  })

  it('gives the two different markers', () => {
    expect(disclose(stale).marker).not.toBe(disclose(fixture).marker)
  })

  it('marks a delayed or proxied feed even when the envelope resolved', () => {
    /*
     * `state: 'ok'` is not the same as live. A delayed venue feed resolves
     * successfully and is still not what a reader assumes an unmarked number
     * to be.
     */
    const delayed: Envelope<number[]> = {
      state: 'ok',
      data: [1],
      provenance: provenance({ isDelayed: true, quality: 'delayed' }),
    }
    expect(disclose(delayed).state).toBe('delayed')
    expect(disclose(delayed).marker).not.toBeNull()
    expect(isCurrent(disclose(delayed))).toBe(false)
  })

  it('leaves a current observation unmarked, so a marker means something', () => {
    const disclosure = disclose(ok)
    expect(disclosure.state).toBe('ok')
    expect(isCurrent(disclosure)).toBe(true)
    expect(disclosure.marker).toBeNull()
    expect(disclosure.observedAt).toBe('2026-08-24T10:00:00.000Z')
  })
})

describe('the projection cannot drop the state on the floor', () => {
  it('returns the rows and their disclosure together', () => {
    const projected = disclosedRows(fixture)
    expect(projected.rows).toEqual([1])
    expect(projected.disclosure.state).toBe('fixture')
  })

  it('yields no rows for an envelope that carries none', () => {
    const failed: Envelope<number[]> = {
      state: 'error',
      error: { code: 'unknown', message: 'x', providerId: null, retryable: false },
    }
    const projected = disclosedRows(failed)
    expect(projected.rows).toEqual([])
    expect(projected.disclosure.state).toBe('unavailable')
    expect(projected.disclosure.observedAt).toBeNull()
  })
})

describe('granularity follows the data, not the panel', () => {
  /**
   * The rule, stated once.
   *
   * A panel-level marker is only honest when every value under it is
   * guaranteed to share one disclosure. That is a property of the **type**,
   * not of today's provider chain: `sectors` resolves from a single fixture
   * call right now, and the day a live sector feed lands for eight of nine
   * sectors, a panel-level marker would start lying without a line of UI
   * changing.
   *
   * So the test is structural. A category whose payload is a LIST of things
   * that each carry their own `Provenance` must disclose per value; only a
   * category whose payload is a single observation may disclose per panel.
   */
  const PER_VALUE = [
    'indices',
    'fx',
    'commodities',
    'crypto',
    'yields',
    'sectors',
    'watchlist',
    'intraday',
  ] as const

  it('discloses per value wherever the payload is a list of observations', () => {
    /*
     * `MarketQuote`, `GovernmentYield` and `MarketSeries` each carry their own
     * `Provenance`, so every one of these categories can hold values that
     * differ in source and state. The Overview proves it today: its index
     * panel merges Avanza's Swedish quotes with international fixtures, and a
     * panel-level marker would have called a real quote fixture data.
     */
    const source = read('src/components/lightDashboard/LightCommandCenter.tsx')
    for (const category of PER_VALUE) {
      /*
       * The context argument added on 2026-08-25 carries the symbol and the
       * provider's session, which is what lets the row judge the observation's
       * own age instead of inheriting the resolver's cache state. It is
       * optional in the signature, so the pattern accepts a call with or
       * without it — what must not change is that the ENVELOPE named here is
       * the category's, one call per rendered observation.
       */
      expect(source, `${category} must disclose per observation`).toMatch(
        new RegExp(
          String.raw`discloseObservation\(\s*[\w.[\]]+,\s*snapshot\.${category}\s*[,)]`,
        ),
      )
    }
  })

  it('leaves sentiment as the only panel-level marker, because it is one value', () => {
    /*
     * `MarketSentiment` is a single score with a single provenance. Its
     * components carry their own `inputAsOf` and `inputQuality`, and the domain
     * folds the stalest of them into the score's provenance rather than
     * publishing them as separate observations — so there is exactly one number
     * on that panel and the marker cannot disagree with anything.
     *
     * If a component is ever rendered as its own figure, this expectation is
     * what should fail.
     */
    const source = read('src/components/lightDashboard/LightCommandCenter.tsx')
    /*
     * `discloseEnvelope` since 2026-08-25: still one call for the whole
     * panel, and still not a per-observation projection. It judges the single
     * observation's age rather than the delivery state, which is the same
     * correction every row received.
     */
    /*
     * The observation context added on 2026-08-26 carries the composite's own
     * session, which is what earns the closed-session allowance overnight
     * instead of the generic 15-minute one. Optional in the signature, so the
     * pattern accepts the call with or without it — what must not change is
     * that this is ONE call for the whole panel.
     */
    expect(source).toMatch(/disclose(?:Envelope)?\(\s*snapshot\.sentiment\s*[,)]/)
    expect(source).not.toMatch(/discloseObservation\([^)]*snapshot\.sentiment/)
    /*
     * Components ARE now inspectable, by ruling on 2026-08-26.
     *
     * The earlier version of this rule forbade rendering a component's own
     * value, written when sentiment was a single opaque fixture gauge. Under
     * `cross-asset-risk-appetite-v1` the headline is an equal-weighted mean of
     * three legs that regularly disagree — measured median dispersion ~41 —
     * and a score of 45 from 43/45/47 says something entirely different from
     * one built from 5/45/85. Hiding the legs would make the aggregate
     * misleading rather than tidy.
     *
     * The panel-level marker stays honest because all three legs are ranked
     * from the SAME session close: they share one `asOf` and one quality, so
     * there is no per-value disclosure for them to disagree about. If a future
     * methodology ever gives the legs different observation times, this is the
     * expectation that must fail.
     */
    const legAsOfsShareOneObservation = /inputAsOf: leg\.inputAsOf/.test(
      read('src/infrastructure/marketData/providers/derived.ts'),
    )
    expect(legAsOfsShareOneObservation).toBe(true)
    /* And the disagreement measure must reach the reader, not just the payload. */
    expect(source).toMatch(/dispersion/)
  })

  it('keeps one disclosure per rendered market value on the rail', () => {
    const source = read('src/components/commandCenter/CommandCenter.tsx')
    for (const category of ['indices', 'fx', 'yields']) {
      expect(source, `${category} must disclose per observation`).toMatch(
        new RegExp(
          String.raw`discloseObservation\(\s*[\w.[\]]+,\s*market\.${category}\s*[,)]`,
        ),
      )
    }
  })
})
