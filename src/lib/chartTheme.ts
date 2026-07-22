/**
 * Chart colour tokens.
 *
 * The categorical palette below was validated against the dark chart surface
 * (#10151f) for lightness band, chroma floor, colour-vision-deficiency
 * separation and contrast. Assign slots in fixed order — never cycle or
 * recolour by rank, and never reuse the status colours as a series colour.
 *
 * The single remaining protan pair (indigo ↔ magenta, ΔE 6.5) is inside the
 * permitted floor band because every categorical chart here carries secondary
 * encoding: the donut legend direct-labels each slice with name, percent and
 * amount, and slices are separated by a 2px surface gap.
 */
export const CATEGORICAL = [
  '#5f71d8', // 1 — indigo
  '#00a0b5', // 2 — cyan
  '#af4aba', // 3 — magenta
  '#3f821e', // 4 — olive
  '#b08b34', // 5 — bronze
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
