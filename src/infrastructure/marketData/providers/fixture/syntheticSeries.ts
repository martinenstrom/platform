/**
 * Synthetic series generation — FIXTURE ONLY.
 *
 * This is the seeded generator that used to live in `LightCommandCenter.tsx`
 * and fabricate chart data inside a production-facing view. It has been moved
 * here rather than deleted outright, because Phase 0's job is to reproduce the
 * current screen exactly while removing invented data from the UI layer.
 *
 * The distinction that makes this acceptable:
 *
 *  - In the component it was **undisclosed** — the chart looked like market
 *    data and nothing said otherwise.
 *  - Here it is **disclosed and contained**: every value it produces is
 *    stamped `quality: 'fixture'`, and `FallbackPolicy.allowFixture` is
 *    `'non-production'` for every category, so it can never reach a
 *    production user.
 *
 * Phases 4 and 6 replace these with real series, at which point this module
 * is deleted. Until then it is the fixture's compact representation of ~900
 * data points; baking them as literals would say the same thing at 30× the
 * size.
 */

/** mulberry32. Same algorithm and seeds as the pre-migration component, so
 *  the rendered output is byte-identical to the golden baseline. */
export function syntheticSeries(seed: number, points: number, drift: number): number[] {
  let a = seed
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out: number[] = []
  let level = 0
  for (let i = 0; i < points; i++) {
    level += (next() - 0.5 + drift) * 0.22
    out.push(level)
  }
  return out
}
