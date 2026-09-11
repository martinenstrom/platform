/**
 * Debate does not turn weak evidence into strong conclusions.
 *
 * Half B lets two analytical desks disagree on the record: Rates can contest a
 * Macro claim, Macro can answer with a revision. That machinery creates a
 * laundering route the firm did not have before, and it is the most plausible
 * way this institution could start lying to itself:
 *
 *   Macro claims something on fixture data.
 *   Rates challenges it.
 *   Macro revises, cites the SAME fixture data, and proposes `high` —
 *     because the argument has now "survived scrutiny".
 *   The revision reads as better-established than its predecessor
 *     while resting on exactly the same evidence.
 *
 * Nothing was learned. A challenge is a question about an argument, and a
 * revision is an answer; neither is an observation. Confidence is a function of
 * the EVIDENCE, never of the process history — and these tests exist to fail
 * the moment that stops being true.
 *
 * ## Why fixture-backed
 *
 * `anyFixtureBacked` is one of the three signals the firm can actually derive
 * today (with `anyStale`, for sovereign yields, and `evidenceCount`).
 * `weakestEvidence`, `conflictingEvidence` and `methodologyMismatch` are not
 * derivable in production — that is TD-75, and it is deliberately NOT opened
 * here. Using a derivable cap means these tests exercise the production path
 * rather than a signal nobody can compute.
 */

import { describe, expect, it } from 'vitest'
import {
  isPublishable,
  observationRef,
  type ClaimType,
  type EvidenceItem,
} from '~/domain/analysis'
import { buildProvenance, type ProviderTrust, type Quality } from '~/domain/shared/provenance'
import { resolveModelConfidence } from './modelConfidence'

const ASSEMBLED_AT = '2026-08-19T09:00:00.000Z'

function item(
  id: string,
  { quality = 'official-daily' as Quality, trust = 'issuer' as ProviderTrust } = {},
): EvidenceItem {
  const value = {
    yieldPercent: '4.21',
    changeBasisPoints: null,
    observationDate: '2026-08-18',
  }
  return {
    ref: observationRef(
      {
        subjectKind: 'instrument',
        subject: `rate:${id}`,
        kind: 'yield',
        observedAt: '2026-08-18T20:00:00.000Z',
        referencePeriod: '2026-08-18',
        sourceId: 'treasury',
        seriesId: 'BC_10YEAR',
        methodology: 'par-yield',
      },
      value,
    ),
    value,
    provenance: buildProvenance({
      asOf: '2026-08-18T20:00:00.000Z',
      nowMs: Date.parse(ASSEMBLED_AT),
      quality,
      source: { providerId: 'treasury', providerName: 'Treasury', trust },
    }),
  }
}

/** The evidence Rates cites when it contests the Macro attribution. */
const FIXTURE_EVIDENCE = [item('us10y', { quality: 'fixture', trust: 'synthetic' })]
const REAL_EVIDENCE = [item('us10y')]

const confidenceOf = (
  proposed: Parameters<typeof resolveModelConfidence>[0],
  citedItems: readonly EvidenceItem[],
  claimType: ClaimType = 'causal',
) => resolveModelConfidence(proposed, claimType, citedItems, ASSEMBLED_AT)

/* ============================================ 1. the peer's own objection */

describe('a fixture-backed peer challenge is capped', () => {
  /*
   * Rates contests Macro's attribution and cites fixture data for the
   * competing explanation. Its objection is recorded — Half B's whole point is
   * that a qualified desk's disagreement is durable — but the confidence of a
   * claim resting on that evidence is not raised by the desk's seniority, its
   * mandate, or the fact that it was filed as a formal institutional act.
   */
  const rates = confidenceOf('high', FIXTURE_EVIDENCE)

  it('is insufficient however confidently it was proposed', () => {
    expect(rates.level).toBe('insufficient')
  })

  it('says why, in the firm’s own words', () => {
    expect(rates.cappedBy).toBe('fixture-evidence')
    expect(rates.basis).toContain('rests on fixture data')
  })

  it('is not publishable', () => {
    expect(isPublishable(rates)).toBe(false)
  })

  it('is capped identically whether the desk proposed high or low', () => {
    /*
     * The cap is a property of the evidence. A desk that proposes `low` has
     * not been more honest in a way the record rewards, and one that proposes
     * `high` has not been more persuasive.
     */
    expect(confidenceOf('low', FIXTURE_EVIDENCE)).toEqual(rates)
  })
})

/* ================================= 2. the revision the challenge produced */

describe('a revision answering that challenge inherits the cap', () => {
  /*
   * The laundering route, run end to end at the level where it would happen.
   *
   * Macro answers Rates, cites the same evidence, and proposes `high` on the
   * grounds that the argument has now been examined. Confidence must not move.
   */
  const original = confidenceOf('moderate', FIXTURE_EVIDENCE)
  const revision = confidenceOf('high', FIXTURE_EVIDENCE)

  it('is still insufficient', () => {
    expect(revision.level).toBe('insufficient')
  })

  it('is still not publishable', () => {
    expect(isPublishable(revision)).toBe(false)
  })

  it('carries the identical cap, not a softened one', () => {
    expect(revision.cappedBy).toBe('fixture-evidence')
    expect(revision).toEqual(original)
  })

  it('gains nothing from having survived scrutiny', () => {
    /*
     * The explicit statement of the property. Three claims about one body of
     * evidence — before the challenge, the challenge itself, and the revision
     * that answered it — are indistinguishable in confidence, because the
     * evidence never changed.
     *
     * If debate could raise confidence, this is the assertion that would break.
     */
    const beforeAnyChallenge = confidenceOf('moderate', FIXTURE_EVIDENCE)
    const theChallenge = confidenceOf('high', FIXTURE_EVIDENCE)
    const theAnswer = confidenceOf('high', FIXTURE_EVIDENCE)

    expect(new Set([beforeAnyChallenge.level, theChallenge.level, theAnswer.level]))
      .toEqual(new Set(['insufficient']))
    expect(theAnswer).toEqual(beforeAnyChallenge)
  })

  it('is capped by its own citations, not by its predecessor’s', () => {
    /*
     * The converse, so the rule is not mistaken for inheritance-by-lineage.
     * A revision that goes and gets REAL evidence is not punished for what the
     * claim it replaced rested on — otherwise the firm would have an incentive
     * never to revise. The cap follows the evidence in both directions.
     */
    const repaired = confidenceOf('moderate', REAL_EVIDENCE)
    expect(repaired.level).not.toBe('insufficient')
    expect(isPublishable(repaired)).toBe(true)
    expect(repaired.cappedBy).not.toBe('fixture-evidence')
  })

  it('caps a revision that mixes one fixture into otherwise real evidence', () => {
    /*
     * ANY fixture citation caps, which is what stops the cheapest laundering
     * move of all: keep the fixture, add real sources beside it, and let the
     * average look respectable. Confidence is not an average.
     */
    const mixed = confidenceOf('high', [...REAL_EVIDENCE, ...FIXTURE_EVIDENCE])
    expect(mixed.level).toBe('insufficient')
    expect(mixed.cappedBy).toBe('fixture-evidence')
    expect(isPublishable(mixed)).toBe(false)
  })

  it('caps a fixture cited AGAINST the claim as well as for it', () => {
    /*
     * `resolveModelConfidence` is handed supporting and contradicting
     * citations alike. A claim that rests on invented evidence is capped
     * whichever direction it cited it in — a counter-citation is still a
     * citation, and a peer challenge is exactly where contradicting evidence
     * appears.
     */
    const contradicting = confidenceOf('high', FIXTURE_EVIDENCE, 'observation')
    expect(contradicting.cappedBy).toBe('fixture-evidence')
  })
})
