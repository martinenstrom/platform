/**
 * Conflicts are named and the official figure preferred; confidence is a
 * class earned by the evidence, never a number.
 */

import { describe, expect, it } from 'vitest'
import type { ResearchEvidence } from './evidence'
import { asOfOf, confidenceOf, reconcile } from './reconcile'

const evidence = (
  over: Partial<ResearchEvidence> & Pick<ResearchEvidence, 'id' | 'authority'>,
): ResearchEvidence => ({
  title: over.id,
  publisher: 'x',
  url: `https://example.org/${over.id}`,
  publishedAt: '2026-10-02T12:00:00.000Z',
  retrievedAt: '2026-10-02T15:00:00.000Z',
  sourceType: 'other',
  snippet: '',
  claims: [],
  relevantTo: [],
  freshness: 'fresh',
  ...over,
})

describe('reconcile', () => {
  it('names a disagreement on the same figure and prefers the official source', () => {
    const official = evidence({
      id: 'bls',
      authority: 1,
      sourceType: 'official',
      claims: [
        {
          text: 'CPI rose 3.4 percent over the last 12 months.',
          basis: 'retrieved',
          figure: { key: 'us:cpi', value: 3.4, unit: 'percent' },
        },
      ],
    })
    const news = evidence({
      id: 'news',
      authority: 4,
      sourceType: 'news',
      claims: [
        {
          text: 'Inflation came in at 3.5 percent.',
          basis: 'snippet',
          figure: { key: 'us:cpi', value: 3.5, unit: 'percent' },
        },
      ],
    })
    const conflicts = reconcile([news, official])
    expect(conflicts).toEqual([
      {
        key: 'us:cpi',
        values: [
          { evidenceId: 'news', value: 3.5, unit: 'percent' },
          { evidenceId: 'bls', value: 3.4, unit: 'percent' },
        ],
        preferredEvidenceId: 'bls',
      },
    ])
    expect(confidenceOf([news, official], conflicts)).toBe('STRONG_EVIDENCE')
  })

  it('a stated range agrees with a figure inside it, and a sentence with several figures agrees through any of them', () => {
    const fed = evidence({
      id: 'fed',
      authority: 1,
      claims: [
        {
          text: 'The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point to 3-3/4 to 4 percent.',
          basis: 'retrieved',
          figure: { key: 'fed:policy-rate', value: 4, unit: 'percent' },
        },
      ],
    })
    const ap = evidence({
      id: 'ap',
      authority: 4,
      claims: [
        {
          text: 'Fed höjde styrräntan till cirka 3,9 procent.',
          basis: 'snippet',
          figure: { key: 'fed:policy-rate', value: 3.9, unit: 'percent' },
        },
      ],
    })
    expect(reconcile([fed, ap])).toEqual([])
    const bls = evidence({
      id: 'bls',
      authority: 1,
      claims: [
        {
          text: 'Over the last 12 months, the all items index increased 3.4 percent before seasonal adjustment.',
          basis: 'retrieved',
          figure: { key: 'us:cpi', value: 3.4, unit: 'percent' },
        },
      ],
    })
    const news = evidence({
      id: 'news',
      authority: 4,
      claims: [
        {
          text: 'USA:s CPI steg 0,4 % i augusti jämfört med juli och 3,4 % jämfört med augusti 2025.',
          basis: 'snippet',
          figure: { key: 'us:cpi', value: 0.4, unit: 'percent' },
        },
      ],
    })
    expect(reconcile([bls, news])).toEqual([])
    const wrong = evidence({
      id: 'wrong',
      authority: 4,
      claims: [
        {
          text: 'Inflationen landade på 3,6 % i årstakt.',
          basis: 'snippet',
          figure: { key: 'us:cpi', value: 3.6, unit: 'percent' },
        },
      ],
    })
    expect(reconcile([bls, wrong])).toHaveLength(1)
  })

  it('is not a conflict when the figures agree within rounding, or speak of different things', () => {
    const a = evidence({
      id: 'a',
      authority: 1,
      claims: [
        {
          text: '3.4 percent',
          basis: 'retrieved',
          figure: { key: 'us:cpi', value: 3.4, unit: 'percent' },
        },
      ],
    })
    const b = evidence({
      id: 'b',
      authority: 4,
      claims: [
        {
          text: '3.4 percent',
          basis: 'snippet',
          figure: { key: 'us:cpi', value: 3.43, unit: 'percent' },
        },
      ],
    })
    const c = evidence({
      id: 'c',
      authority: 4,
      claims: [
        {
          text: '2.1 percent',
          basis: 'snippet',
          figure: { key: 'se:cpi', value: 2.1, unit: 'percent' },
        },
      ],
    })
    expect(reconcile([a, b, c])).toEqual([])
  })
})

describe('confidenceOf', () => {
  it('classifies support by what the evidence is', () => {
    const retrieved = evidence({
      id: 'fed',
      authority: 1,
      claims: [{ text: 'maintain the range', basis: 'retrieved' }],
    })
    const oneNews = evidence({
      id: 'r',
      authority: 4,
      claims: [{ text: 'stocks fell as yields rose', basis: 'snippet' }],
    })
    const twoNews = evidence({
      id: 'c',
      authority: 4,
      claims: [{ text: 'tech led the decline', basis: 'snippet' }],
    })
    const blog = evidence({
      id: 'b',
      authority: 6,
      claims: [{ text: 'a blogger writes', basis: 'snippet' }],
    })
    const empty = evidence({ id: 'e', authority: 1 })
    expect(confidenceOf([retrieved], [])).toBe('STRONG_EVIDENCE')
    expect(confidenceOf([oneNews, twoNews], [])).toBe('STRONG_EVIDENCE')
    expect(confidenceOf([oneNews], [])).toBe('SUPPORTED')
    expect(confidenceOf([oneNews, blog], [])).toBe('SUPPORTED')
    expect(confidenceOf([blog], [])).toBe('MIXED')
    expect(confidenceOf([empty], [])).toBe('INSUFFICIENT')
    expect(confidenceOf([], [])).toBe('INSUFFICIENT')
  })

  it('is mixed when sources disagree and no official figure settles it', () => {
    const a = evidence({
      id: 'a',
      authority: 4,
      claims: [
        {
          text: '3.5 percent',
          basis: 'snippet',
          figure: { key: 'us:cpi', value: 3.5, unit: 'percent' },
        },
      ],
    })
    const b = evidence({
      id: 'b',
      authority: 4,
      claims: [
        {
          text: '3.7 percent',
          basis: 'snippet',
          figure: { key: 'us:cpi', value: 3.7, unit: 'percent' },
        },
      ],
    })
    const conflicts = reconcile([a, b])
    expect(conflicts).toHaveLength(1)
    expect(confidenceOf([a, b], conflicts)).toBe('MIXED')
  })

  it('asOf is the latest publication; an undated source’s retrieval counts only when nothing is dated', () => {
    expect(asOfOf([])).toBeNull()
    expect(
      asOfOf([
        evidence({ id: 'a', authority: 4, publishedAt: '2026-10-01T10:00:00.000Z' }),
        evidence({
          id: 'b',
          authority: 4,
          publishedAt: null,
          retrievedAt: '2026-10-02T15:00:00.000Z',
        }),
      ]),
    ).toBe('2026-10-01T10:00:00.000Z')
    expect(
      asOfOf([
        evidence({
          id: 'b',
          authority: 4,
          publishedAt: null,
          retrievedAt: '2026-10-02T15:00:00.000Z',
        }),
      ]),
    ).toBe('2026-10-02T15:00:00.000Z')
  })
})
