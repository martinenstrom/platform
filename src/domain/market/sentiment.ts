/**
 * Market sentiment.
 *
 * Decision D2 requires three things that look alike to stay distinguishable:
 *
 *  - **derived**  — computed in-house from real (or explicitly stale) market
 *                   inputs. Production-eligible, with provenance, input
 *                   timestamps and a methodology version.
 *  - **provider** — a vendor's own figure. Its quality is theirs
 *                   ('realtime' | 'delayed'), never 'derived'.
 *  - **fixture**  — invented. Never production-eligible.
 *
 * The rule that makes the distinction real rather than decorative:
 * `buildDerivedSentiment` degrades the whole score to `quality: 'fixture'` if
 * any input was a fixture. Arithmetic over invented inputs produces an
 * invented output, and "derived" must not become a laundering route for it.
 */

import type { Provenance, Quality } from './provenance'
import type { SessionState } from './observations'

export type SentimentLabel = 'risk-off' | 'neutral' | 'risk-on'

export type SentimentOrigin = 'derived' | 'provider' | 'fixture'

export interface SentimentComponent {
  /** 'vix' | 'us10y-change' | 'dxy-change' | 'btc-24h' | … */
  id: string
  label: string
  /** Signed contribution to `score`, in score points. */
  contribution: number
  /** The domain value the contribution was computed from, for explainability. */
  inputValue: number
  /** When THAT input was observed. A score is only as fresh as its stalest input. */
  inputAsOf: string
  /** Quality of the input itself. Drives the degradation rule above. */
  inputQuality: Quality
  /**
   * True where this component is measured through something other than the
   * thing it describes — the credit leg of Cross-Asset Risk Appetite is two
   * ETFs standing in for credit spreads. The aggregate must never hide it.
   */
  isProxy?: boolean
  /** What the proxy contaminates. Present only when `isProxy`. */
  proxyNote?: string
}

export interface MarketSentiment {
  /** 0..100, higher = more risk-on. Feeds the gauge position directly. */
  score: number
  label: SentimentLabel
  origin: SentimentOrigin
  components: SentimentComponent[]
  /**
   * Methodology version, bumped whenever weights change so historical scores
   * stay interpretable. Required when `origin === 'derived'`.
   */
  formulaVersion: string
  /**
   * `max(component) - min(component)` on the component scale, when the
   * methodology defines one.
   *
   * **State and confidence are different questions.** A score of 45 from
   * components at 43/45/47 and one from 5/45/85 are the same number and
   * entirely different statements. Dispersion carries that second fact and
   * **never modifies the score** — no smoothing, no suppression, no dynamic
   * weights.
   */
  dispersion?: number
  /**
   * The score's OWN session, where the methodology defines one.
   *
   * Cross-Asset Risk Appetite is a US-session measure: `closed` means this is
   * the last complete reading of the most recent common session, retained
   * rather than recomputed. The disclosure layer needs it, because without it
   * the score falls to the generic unknown-session horizon and a perfectly
   * valid overnight reading is reported stale fifteen minutes after the bell.
   */
  session?: SessionState
  provenance: Provenance
}

/** Neutral midpoint the components push away from. */
export const SENTIMENT_BASELINE = 50

export function labelForScore(score: number): SentimentLabel {
  if (score >= 60) return 'risk-on'
  if (score <= 40) return 'risk-off'
  return 'neutral'
}

/**
 * Assembles a derived sentiment score from weighted components.
 *
 * Three invariants, all enforced here rather than left to the caller:
 *  1. `provenance.asOf` is the OLDEST `inputAsOf` — never fresher than its
 *     stalest input.
 *  2. `quality` is `'derived'`, degraded to `'fixture'` if any input was one.
 *  3. `score` is the baseline plus contributions, clamped to 0..100 so a
 *     runaway input cannot drive the gauge off its track.
 */
export function buildDerivedSentiment(args: {
  components: SentimentComponent[]
  formulaVersion: string
  nowMs: number
  source: Provenance['source']
}): MarketSentiment {
  if (args.components.length === 0) {
    throw new Error('buildDerivedSentiment: at least one component is required')
  }
  if (!args.formulaVersion) {
    throw new Error(
      'buildDerivedSentiment: formulaVersion is required for derived sentiment',
    )
  }

  const oldestAsOf = args.components.reduce((oldest, component) => {
    const at = new Date(component.inputAsOf).getTime()
    if (Number.isNaN(at)) {
      throw new Error(
        `buildDerivedSentiment: invalid inputAsOf "${component.inputAsOf}" on component ${component.id}`,
      )
    }
    return at < new Date(oldest).getTime() ? component.inputAsOf : oldest
  }, args.components[0]!.inputAsOf)

  const derivedFromFixture = args.components.some(
    (component) => component.inputQuality === 'fixture',
  )

  const raw =
    SENTIMENT_BASELINE +
    args.components.reduce((sum, component) => sum + component.contribution, 0)
  const score = Math.min(100, Math.max(0, raw))

  const asOfMs = new Date(oldestAsOf).getTime()
  return {
    score,
    label: labelForScore(score),
    // Origin records how it was produced; quality records what it is worth.
    origin: derivedFromFixture ? 'fixture' : 'derived',
    components: args.components,
    formulaVersion: args.formulaVersion,
    provenance: {
      asOf: oldestAsOf,
      // A derived score is only as precise as its stalest input; treat it as
      // second-precision because it is computed at a known instant.
      asOfPrecision: 'second',
      receivedAt: new Date(args.nowMs).toISOString(),
      ageMs: Math.max(0, args.nowMs - asOfMs),
      source: args.source,
      quality: derivedFromFixture ? 'fixture' : 'derived',
      isDelayed: false,
      delayMinutes: null,
      isProxy: false,
    },
  }
}
