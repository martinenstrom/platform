/**
 * Chart colour tokens.
 *
 * Categorical series palette — vibrant but colour-blind-safe on the dark chart
 * surfaces. Validated with the dataviz validator against BOTH surfaces the app
 * renders charts on (#10151f dark pages, #040e17 Overview): dark lightness band,
 * chroma floor, and ≥3:1 contrast all pass; the four line hues (slots 1–4) clear
 * the CVD gate on adjacent AND all-pairs (worst ΔE 8.3 deutan) and the
 * normal-vision floor (worst ΔE 17.2), so every viewer can separate them.
 *
 * Every hue deliberately avoids the reserved status colours (green/red/amber
 * below), so a series can never impersonate up/down/warning — assign in fixed
 * slot order, never cycle or recolour by rank:
 *   1 indigo  #4361e6 — confident blue lead; max-separated from red/amber/green
 *   2 magenta #ec4899 — warm counterpoint; reads as pink, not the negative red
 *   3 teal    #1596ae — cool cyan; clears magenta by ΔE 8.3 (deutan), the tightest pair
 *   4 orange  #e06a24 — the warm energy; only ever a line among 1–3, never beside red status
 *   5 violet  #9d5cff — donut-ONLY 5th slot (violet collapses into indigo under
 *             CVD, so it is quarantined to the spatially-separated, direct-labelled pie)
 */
export const CATEGORICAL = [
  '#4361e6', // 1 — indigo
  '#ec4899', // 2 — magenta
  '#1596ae', // 3 — teal
  '#e06a24', // 4 — orange
  '#9d5cff', // 5 — violet (donut only)
] as const

/** Reserved status colours — state only, never series identity. */
export const STATUS = {
  positive: '#2ecc84',
  negative: '#f2555a',
  warning: '#eaa73c',
} as const

export const CHART_SURFACE = '#10151f'
export const CHART_GRID = '#222b3b'
export const CHART_AXIS_TEXT = '#818da1'

/** Performance chart series: portfolio leads, benchmark is the comparison. */
export const SERIES = {
  portfolio: CATEGORICAL[0],
  benchmark: CATEGORICAL[1],
} as const
