/**
 * What the desk is told about the evidence it is asked to analyse.
 *
 * The measured defect this closes: the C2-2 live run handed the model an
 * observation id and a raw payload, and the model — correctly — refused five of
 * seven claims because it could not know what the number was. Every fact it
 * needed was already on `item.ref` and `item.provenance`.
 *
 * Two properties are under test, and the second is the one that could quietly
 * break: the briefing must carry the institutional semantics, and it must be a
 * RENDERING of the record rather than a second model of it — no display-name
 * table, no recomputed figure, and the canonical citation identity unchanged.
 */

import { describe, expect, it } from 'vitest'
import {
  buildEvidenceSet,
  observationRef,
  observationRefV1,
  type EvidenceItem,
} from '~/domain/analysis'
import { buildProvenance } from '~/domain/shared/provenance'
import { briefEvidenceSet, renderEvidenceBriefing } from './evidenceBriefing'
import { renderUserPrompt } from '~/infrastructure/analysis/providers/live'

const AT = Date.parse('2026-08-20T00:00:00.000Z')

function yieldItem(args: {
  subject: string
  percent: string
  referencePeriod: string
  sourceId?: string
  providerName?: string
  observedAt?: string
}): EvidenceItem {
  const value = {
    yieldPercent: args.percent,
    changeBasisPoints: null,
    observationDate: args.referencePeriod,
  }
  const observedAt = args.observedAt ?? `${args.referencePeriod}T00:00:00.000Z`
  return {
    ref: observationRef(
      {
        subjectKind: 'instrument',
        subject: args.subject,
        kind: 'yield',
        observedAt,
        referencePeriod: args.referencePeriod,
        sourceId: args.sourceId ?? 'treasury',
        seriesId: 'BC_10YEAR',
        methodology: 'par-yield',
      },
      value,
    ),
    value,
    provenance: buildProvenance({
      asOf: observedAt,
      nowMs: AT,
      asOfPrecision: 'date',
      sourceDate: args.referencePeriod,
      quality: 'official-daily',
      source: {
        providerId: args.sourceId ?? 'treasury',
        providerName: args.providerName ?? 'U.S. Department of the Treasury',
        trust: 'issuer',
      },
    }),
  }
}

function spreadItem(inputs: readonly EvidenceItem[]): EvidenceItem {
  const value = {
    slopeBasisPoints: '20',
    observationDate: '2026-08-14',
    inputs: [
      ['2y', inputs[0]!.ref.id, inputs[0]!.ref.contentHash],
      ['10y', inputs[1]!.ref.id, inputs[1]!.ref.contentHash],
    ],
  }
  return {
    ref: observationRef(
      {
        subjectKind: 'series',
        subject: 'curve:us:2s10s',
        kind: 'derived-spread',
        observedAt: '2026-08-14T00:00:00.000Z',
        referencePeriod: '2026-08-14',
        sourceId: 'derived',
        seriesId: '2s10s',
        methodology: 'spread-2s10s@1',
      },
      value,
    ),
    value,
    provenance: buildProvenance({
      asOf: '2026-08-14T00:00:00.000Z',
      nowMs: AT,
      asOfPrecision: 'date',
      quality: 'derived',
      source: {
        providerId: 'derived',
        providerName: 'Financial OS — derived',
        trust: 'derived',
        originatorTrust: 'issuer',
      },
    }),
  }
}

const twoYear = yieldItem({
  subject: 'rate:us2y',
  percent: '3.9',
  referencePeriod: '2026-08-14',
})
const tenYear = yieldItem({
  subject: 'rate:us10y',
  percent: '4.1',
  referencePeriod: '2026-08-14',
})
const slope = spreadItem([twoYear, tenYear])

const set = buildEvidenceSet({
  items: [twoYear, tenYear, slope],
  assembledAt: '2026-08-20T09:00:00.000Z',
  correlationId: 'corr-1',
})

describe('the semantics the firm already holds reach the desk', () => {
  const briefing = briefEvidenceSet(set)
  const ten = briefing.observations.find((o) => o.subject === 'rate:us10y')!

  it('names the subject, kind, unit, source, trust, quality and both times', () => {
    expect(ten.subjectKind).toBe('instrument')
    expect(ten.subject).toBe('rate:us10y')
    expect(ten.kind).toBe('yield')
    expect(ten.measure).toBe('4.1')
    expect(ten.unit).toBe('percent per annum')
    expect(ten.sourceId).toBe('treasury')
    expect(ten.sourceName).toBe('U.S. Department of the Treasury')
    expect(ten.trust).toBe('issuer')
    expect(ten.quality).toBe('official-daily')
    /* What it describes, and when it was published. Two different facts. */
    expect(ten.referencePeriod).toBe('2026-08-14')
    expect(ten.observedAt).toBe('2026-08-14T00:00:00.000Z')
    expect(ten.methodology).toBe('par-yield')
    expect(ten.seriesId).toBe('BC_10YEAR')
  })

  it('states the derived fact as derived, and names its inputs', () => {
    const derived = briefing.observations.find((o) => o.kind === 'derived-spread')!
    expect(derived.methodology).toBe('spread-2s10s@1')
    expect(derived.measure).toBe('20')
    expect(derived.unit).toBe('basis points')
    expect(derived.derivedFrom).toEqual([
      { role: '2y', observationId: twoYear.ref.id, contentHash: twoYear.ref.contentHash },
      { role: '10y', observationId: tenYear.ref.id, contentHash: tenYear.ref.contentHash },
    ])
  })

  it('reports trust as the weaker of route and originator', () => {
    /*
     * `derived` is trust tier 4 and `issuer` is tier 1, and `effectiveTrust`
     * takes the WEAKER of the two — so a spread computed from issuer figures is
     * reported as `derived`, not laundered up to issuer grade by the
     * arithmetic. The domain's own rule, called rather than restated.
     */
    const derived = briefing.observations.find((o) => o.kind === 'derived-spread')!
    expect(derived.trust).toBe('derived')
  })

  it('states co-temporality on both axes', () => {
    expect(briefing.coTemporality.reference).toBe('aligned at 2026-08-14')
    expect(briefing.coTemporality.publication).toBe('aligned at 2026-08-14T00:00:00.000Z')
  })
})

describe('it renders the record and does not become a second one', () => {
  it('keeps the canonical citation identity, unshortened', () => {
    const text = renderEvidenceBriefing(briefEvidenceSet(set))
    for (const item of set.items) {
      expect(text).toContain(`id: ${item.ref.id}`)
    }
  })

  it('carries every field from the set, and invents no display name', () => {
    const text = renderEvidenceBriefing(briefEvidenceSet(set))
    /*
     * The subject is stated in the institution's own vocabulary. A friendly
     * "US 10-year Treasury" would be a mapping the firm does not hold, and the
     * moment one exists there are two answers to what a subject is.
     */
    expect(text).toContain('rate:us10y')
    expect(text).not.toMatch(/10-year Treasury/i)
  })

  it('never computes a figure of its own', () => {
    /*
     * The planted violation is arithmetic: 4.1 − 3.9. The briefing must state
     * the spread the FIRM derived — `20`, from the stored observation — and
     * must not produce a number for a set that carries no derived member.
     */
    const withoutSlope = buildEvidenceSet({
      items: [twoYear, tenYear],
      assembledAt: '2026-08-20T09:00:00.000Z',
      correlationId: 'corr-2',
    })
    const text = renderEvidenceBriefing(briefEvidenceSet(withoutSlope))
    expect(text).not.toContain('basis points')
    expect(text).not.toContain('spread')
  })

  it('says a v1 observation states no reference period rather than inventing one', () => {
    const value = { yieldPercent: '2.41', changeBasisPoints: null, observationDate: '2026-08-15' }
    const v1: EvidenceItem = {
      /* A v1 record, which genuinely states no period. See gate §0.1. */
      ref: observationRefV1(
        {
          subjectKind: 'series',
          subject: 'de10y',
          kind: 'yield',
          observedAt: '2026-08-15T00:00:00.000Z',
          sourceId: 'ecb',
        },
        value,
      ),
      value,
      provenance: buildProvenance({
        asOf: '2026-08-15T00:00:00.000Z',
        nowMs: AT,
        quality: 'official-daily',
        source: { providerId: 'ecb', providerName: 'ECB', trust: 'central-bank' },
      }),
    }
    const text = renderEvidenceBriefing(
      briefEvidenceSet(
        buildEvidenceSet({
          items: [v1],
          assembledAt: '2026-08-20T09:00:00.000Z',
          correlationId: 'corr-3',
        }),
      ),
    )
    expect(text).toContain('reference period: not stated by this observation')
  })
})

describe('what the live desk actually receives', () => {
  it('is the briefing, not an id and a payload', () => {
    const prompt = renderUserPrompt('Describe the US front end.', set)

    /* The C2-2 shape, gone: an id followed immediately by a bare value. */
    expect(prompt).not.toMatch(/id: [0-9a-f]+\n {2}value:/)

    /* And the semantics the run was missing, present. */
    expect(prompt).toContain('Brief:\nDescribe the US front end.')
    expect(prompt).toContain('subject: rate:us10y (instrument)')
    expect(prompt).toContain('source: U.S. Department of the Treasury (treasury)')
    expect(prompt).toContain('trust: issuer; quality: official-daily')
    expect(prompt).toContain('reference period (what it describes): 2026-08-14')
    expect(prompt).toContain('derived by the firm from:')
  })
})
