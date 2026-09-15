/**
 * The scorer's own check, so a bake-off number means what it says.
 *
 *   node --test scripts/voice-bakeoff/lib.check.mjs
 *
 * Named `.check.`, not `.test.`: this runs under node:test with no
 * dependency, and vitest — which collects every `*.test.*` in the
 * repository — would otherwise pick it up and find no suite in it.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { median, normalise, termHits, wer } from './lib.mjs'

test('normalise agrees on decimals, percent signs and trailing punctuation', () => {
  /* A dash standing alone is punctuation and goes; a dash inside a token (10-year) stays. */
  assert.equal(normalise('CPI kom in på 3.2 % mot väntade 3,0 – ändrar det?'), 'cpi kom in på 3,2 procent mot väntade 3,0 ändrar det')
  assert.equal(normalise('US 10-year'), 'us 10-year')
  assert.equal(normalise('Nvidia, Microsoft.'), 'nvidia microsoft')
  assert.equal(normalise('P/E 31'), 'p/e 31')
  assert.equal(normalise("Nvidia's valuation"), "nvidia's valuation")
})

test('wer is zero for an identical transcript, and counts every lost or changed word', () => {
  assert.equal(wer('Jarvis, hur ser du på Nvidia?', 'jarvis hur ser du på nvidia'), 0)
  assert.equal(wer('a b c d', 'a b x d'), 0.25)
  assert.equal(wer('a b c d', 'a b d'), 0.25)
  assert.equal(wer('a b c d', ''), 1)
})

test('termHits matches whole words only, under any accepted spelling', () => {
  const terms = [
    { term: 'Fed', accept: ['fed', 'federal reserve'] },
    { term: 'US 10-year', accept: ['us 10-year', 'us tioåring'] },
    { term: 'P/E 31', accept: ['p/e 31', 'pe 31'] },
  ]
  const hits = termHits(terms, 'Vad säger Federal Reserve om US tioåring? Den handlas på P/E 31.')
  assert.deepEqual(hits.map((h) => h.hit), [true, true, true])
  const federalOnly = termHits([{ term: 'Fed', accept: ['fed'] }], 'Federal Reserve höjde.')
  assert.equal(federalOnly[0].hit, false)
  /* Swedish compounds join the term with a hyphen; that is the term, present. */
  const compound = termHits([{ term: 'CPI', accept: ['cpi'] }], 'Nvidia efter senaste CPI-siffran?')
  assert.equal(compound[0].hit, true)
  const split = termHits([{ term: 'US 10-year', accept: ['us 10-year'] }], 'om US 10 year går upp')
  assert.equal(split[0].hit, true)
})

test('median handles odd, even and empty', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 3)
  assert.equal(median([]), null)
})
