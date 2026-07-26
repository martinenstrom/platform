import { describe, expect, it } from 'vitest'
import { toneSoftBg, toneText } from './tone'
import type { Tone } from '~/types'

const TONES: Tone[] = ['positive', 'negative', 'neutral', 'warning', 'accent']

describe('tone maps', () => {
  it('cover every Tone with no gaps', () => {
    for (const tone of TONES) {
      expect(toneText[tone]).toBeTruthy()
      expect(toneSoftBg[tone]).toBeTruthy()
    }
    expect(Object.keys(toneText).sort()).toEqual([...TONES].sort())
    expect(Object.keys(toneSoftBg).sort()).toEqual([...TONES].sort())
  })

  it('map to the expected semantic classes (guards against drift)', () => {
    expect(toneText).toEqual({
      positive: 'text-positive',
      negative: 'text-negative',
      warning: 'text-warning',
      accent: 'text-accent',
      neutral: 'text-content-muted',
    })
    expect(toneSoftBg).toEqual({
      positive: 'bg-positive-soft',
      negative: 'bg-negative-soft',
      warning: 'bg-warning-soft',
      accent: 'bg-accent-soft',
      neutral: 'bg-surface-3',
    })
  })
})
