/**
 * Deterministic illustrative trend series — same mulberry32-PRNG technique
 * `~/data/mockData.ts` uses for the portfolio performance chart, kept local
 * here so the Country Explorer's mock data doesn't depend on the dashboard
 * domain's fixtures. Used for macro-card sparklines and the two trend charts
 * (`MacroOverview`/`MarketOverview`) — never presented as real history.
 */

function createRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A short random-walk series ending at (or very near) `endValue`, seeded so
 * the same indicator always renders the same sparkline/chart between reloads.
 */
export function buildTrendSeries(endValue: number, seed: number, points = 8): number[] {
  const random = createRandom(seed)
  const drift = Math.max(Math.abs(endValue) * 0.08, 0.2)
  const series: number[] = []

  let value = endValue - drift * (points / 4)
  for (let i = 0; i < points; i += 1) {
    const progress = i / Math.max(points - 1, 1)
    const noise = (random() - 0.5) * drift
    value = endValue - drift * (1 - progress) + noise
    series.push(Number(value.toFixed(2)))
  }
  // Anchor the last point exactly to the real "current value".
  series[series.length - 1] = endValue
  return series
}

export interface ChartPoint {
  t: string
  value: number
}

/** Longer series for `TrendChart`, labeled with a trailing sequence of period markers (e.g. quarters). */
export function buildChartSeries(
  endValue: number,
  seed: number,
  periodLabels: string[],
): ChartPoint[] {
  const values = buildTrendSeries(endValue, seed, periodLabels.length)
  return periodLabels.map((label, i) => ({ t: label, value: values[i] ?? endValue }))
}

/** Generic relative-quarter labels for illustrative charts that don't need real period dates. */
export const RELATIVE_QUARTER_LABELS = ['-5 kv', '-4 kv', '-3 kv', '-2 kv', '-1 kv', 'Nu']

/**
 * Pulls the leading signed number out of a formatted display string (e.g.
 * "+9.8%" → 9.8, "−1.5% mot USD" → −1.5) so `TrendChart` series can be built
 * directly from the same strings already shown in the UI, instead of a
 * second hand-maintained numeric field.
 */
export function parseLeadingNumber(text: string): number | null {
  const normalized = text.replace(/−/g, '-').replace(/,/g, '.')
  const match = normalized.match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

/** Deterministic small-int seed derived from a string id — keeps chart series stable without a dedicated seed field. */
export function seedFromString(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return hash
}
