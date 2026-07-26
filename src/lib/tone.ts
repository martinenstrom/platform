import type { Tone } from '~/types'

/**
 * One source of truth for semantic tone → utility-class mappings, so the same
 * positive/negative/warning/accent/neutral decision isn't re-declared per
 * component. Classes reference the design tokens in `app.css`.
 *
 * `neutral` defaults to the *muted* text; a context that deliberately wants a
 * full-strength neutral (e.g. the market-climate panel) overrides it locally.
 */
export const toneText: Record<Tone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  accent: 'text-accent',
  neutral: 'text-content-muted',
}

/** Tone → soft background wash, used behind badge/pill text. */
export const toneSoftBg: Record<Tone, string> = {
  positive: 'bg-positive-soft',
  negative: 'bg-negative-soft',
  warning: 'bg-warning-soft',
  accent: 'bg-accent-soft',
  neutral: 'bg-surface-3',
}
