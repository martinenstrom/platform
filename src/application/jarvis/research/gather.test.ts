/**
 * What becomes a claim, measured against the shapes the live probe of
 * 2026-10-03 produced: a provider's markdown links as citation anchors, a
 * decimal that is not a sentence end, a page title that is not a fact, an
 * undated source that must not make the answer look fresher.
 */

import { describe, expect, it } from 'vitest'
import type { ResearchEvidence } from './evidence'
import {
  claimsFromDocument,
  claimsFromNarrative,
  sentencesOf,
  withFigure,
} from './gather'
import { asOfOf } from './reconcile'

describe('withFigure', () => {
  it('keys a present fact, never a forecast in a report', () => {
    expect(
      withFigure(
        { text: 'Fed höjde styrräntan till cirka 3,9 procent.', basis: 'snippet' },
        'fed:policy-rate',
      ).figure,
    ).toEqual({ key: 'fed:policy-rate', value: 3.9, unit: 'percent' })
    expect(
      withFigure(
        {
          text: 'Ytterligare en höjning kunde bli aktuell, med en möjlig räntenivå på 4,1 procent.',
          basis: 'snippet',
        },
        'fed:policy-rate',
      ).figure,
    ).toBeUndefined()
    /* The document itself is read as it stands. */
    expect(
      withFigure(
        { text: 'The range could be 4 percent later this year.', basis: 'retrieved' },
        'fed:policy-rate',
      ).figure,
    ).toBeDefined()
  })
})

describe('sentencesOf', () => {
  it('ends a sentence at punctuation before a capital, never inside a decimal or an address', () => {
    const text =
      'The CPI-U rose 0.4 percent on a seasonally adjusted basis in August, after rising 0.1 percent in July. Over the last 12 months, the all items index increased 2.7 percent. See bls.gov for the tables.'
    expect(sentencesOf(text).map((s) => s.text)).toEqual([
      'The CPI-U rose 0.4 percent on a seasonally adjusted basis in August, after rising 0.1 percent in July.',
      'Over the last 12 months, the all items index increased 2.7 percent.',
      'See bls.gov for the tables.',
    ])
  })
})

describe('claimsFromNarrative', () => {
  it('reads the provider’s markdown links as the anchors, one clean sentence per cited source, and nothing uncited', () => {
    const text =
      'Fed höjde styrräntan med 25 punkter till **3,75–4,00 procent** den 16 september. ([apnews.com](https://apnews.com/article/abc?utm_source=openai)) Beslutet var väntat av marknaden. ([reuters.com](https://www.reuters.com/markets/x?utm_source=openai)) Det här står utan källa.'
    const claims = claimsFromNarrative({ text, citations: [] })
    expect([...claims.keys()]).toEqual([
      'https://apnews.com/article/abc',
      'https://www.reuters.com/markets/x',
    ])
    expect(claims.get('https://apnews.com/article/abc')!.claims).toEqual([
      {
        text: 'Fed höjde styrräntan med 25 punkter till 3,75–4,00 procent den 16 september.',
        basis: 'snippet',
      },
    ])
    expect(claims.get('https://www.reuters.com/markets/x')!.claims[0]!.text).toBe(
      'Beslutet var väntat av marknaden.',
    )
    expect(JSON.stringify([...claims.values()])).not.toContain('utan källa')
    expect(JSON.stringify([...claims.values()])).not.toContain('utm_source')
  })

  it('falls back to the provider’s offsets when it wrote no links', () => {
    const text = 'Tech är den svagaste större sektorn. Det här är en gissning.'
    const claims = claimsFromNarrative({
      text,
      citations: [{ url: 'https://www.cnbc.com/x', title: null, start: 0, end: 10 }],
    })
    expect(claims.get('https://www.cnbc.com/x')!.claims.map((c) => c.text)).toEqual([
      'Tech är den svagaste större sektorn.',
    ])
  })
})

describe('claimsFromDocument', () => {
  it('quotes whole sentences with a figure first and never the page title', () => {
    const claims = claimsFromDocument(
      {
        url: 'https://www.riksbank.se/x',
        title: 'Styrräntan oförändrad på 1,75 procent | Sveriges Riksbank',
        text: 'Styrräntan oförändrad på 1,75 procent\nDirektionen har beslutat att lämna styrräntan oförändrad på 1,75 procent. Men konjunkturen är starkare och utbudsstörningarna fortsätter.',
        publishedAt: null,
        retrievedAt: '2026-10-03T12:00:00.000Z',
        publisher: 'Riksbanken',
      },
      'riksbank:policy-rate',
    )
    expect(claims.map((c) => c.text)).toEqual([
      'Direktionen har beslutat att lämna styrräntan oförändrad på 1,75 procent.',
      'Men konjunkturen är starkare och utbudsstörningarna fortsätter.',
    ])
    expect(claims[0]).toMatchObject({
      basis: 'retrieved',
      figure: { key: 'riksbank:policy-rate', value: 1.75, unit: 'percent' },
    })
  })
})

describe('asOfOf', () => {
  const item = (
    id: string,
    publishedAt: string | null,
    retrievedAt: string,
  ): ResearchEvidence => ({
    id,
    title: id,
    publisher: id,
    url: null,
    publishedAt,
    retrievedAt,
    sourceType: 'news',
    authority: 4,
    snippet: '',
    claims: [],
    relevantTo: [],
    freshness: 'unknown',
  })

  it('prefers the latest publication time over an undated source’s retrieval', () => {
    expect(
      asOfOf([
        item('a', '2026-09-16T18:00:00.000Z', '2026-10-03T13:45:00.000Z'),
        item('b', null, '2026-10-03T13:45:00.000Z'),
      ]),
    ).toBe('2026-09-16T18:00:00.000Z')
    expect(asOfOf([item('b', null, '2026-10-03T13:45:00.000Z')])).toBe(
      '2026-10-03T13:45:00.000Z',
    )
  })
})

describe('claimsFromDocument and a page label', () => {
  it('never quotes a label line, and never glues it to the sentence after it', () => {
    const claims = claimsFromDocument(
      {
        url: 'https://www.riksbank.se/x',
        title: 'Styrräntan oförändrad på 1,75 procent | Sveriges Riksbank',
        text: 'Pressmeddelande\nDirektionen har beslutat att lämna styrräntan oförändrad på 1,75 procent.',
        publishedAt: null,
        retrievedAt: '2026-10-04T08:00:00.000Z',
        publisher: 'Riksbanken',
      },
      'riksbank:policy-rate',
    )
    expect(claims.map((c) => c.text)).toEqual([
      'Direktionen har beslutat att lämna styrräntan oförändrad på 1,75 procent.',
    ])
  })
})
