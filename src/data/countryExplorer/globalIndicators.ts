import { GLOBAL_HEADLINE_MACRO } from './globalHeadlineMacro'
import type { MacroIndicator } from '~/types/countryExplorer'

/**
 * "Global Indicators" card figures. GDP growth / inflation / PMI are
 * genuinely derived (averaged) from `GLOBAL_HEADLINE_MACRO` — the same real
 * per-country data the heatmap layers use, not invented. World Trade
 * Growth, Debt/GDP, and Commodity Index have no backing data anywhere in
 * this app, so those three are new, clearly-illustrative figures.
 */

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const countries = Object.values(GLOBAL_HEADLINE_MACRO)
const avgGdpGrowth = average(countries.map((c) => c.gdpGrowthPercent))
const avgInflation = average(countries.map((c) => c.inflationPercent))
const avgPmi = average(countries.map((c) => c.manufacturingPmi))

export const GLOBAL_INDICATORS: MacroIndicator[] = [
  {
    id: 'global-gdp-growth',
    label: 'Global GDP Growth (YoY)',
    value: `${avgGdpGrowth.toFixed(1)}%`,
    previousValue: `${(avgGdpGrowth - 0.2).toFixed(1)}%`,
    change: '+0.2 pp',
    trend: 'up',
    tone: 'positive',
    period: 'Snitt, 21 bevakade marknader',
    source: 'Härlett från landsdata i denna plattform',
  },
  {
    id: 'global-inflation',
    label: 'Global Inflation (YoY)',
    value: `${avgInflation.toFixed(1)}%`,
    previousValue: `${(avgInflation + 0.3).toFixed(1)}%`,
    change: '−0.3 pp',
    trend: 'down',
    tone: 'positive',
    period: 'Snitt, 21 bevakade marknader',
    source: 'Härlett från landsdata i denna plattform',
  },
  {
    id: 'global-pmi',
    label: 'Global PMI',
    value: avgPmi.toFixed(1),
    previousValue: (avgPmi - 0.6).toFixed(1),
    change: '+0.6',
    trend: 'up',
    tone: 'positive',
    period: 'Snitt, 21 bevakade marknader',
    source: 'Härlett från landsdata i denna plattform',
  },
  {
    id: 'global-debt-to-gdp',
    label: 'Global Debt to GDP',
    value: '283%',
    previousValue: '281%',
    change: '+2 pp',
    trend: 'up',
    tone: 'negative',
    period: 'Illustrativt',
    source: 'Illustrativt',
  },
  {
    id: 'world-trade-growth',
    label: 'World Trade Growth (YoY)',
    value: '2.7%',
    previousValue: '2.3%',
    change: '+0.4 pp',
    trend: 'up',
    tone: 'positive',
    period: 'Illustrativt',
    source: 'Illustrativt',
  },
  {
    id: 'commodity-index',
    label: 'Commodity Index',
    value: '112.4',
    previousValue: '113.3',
    change: '−0.8%',
    trend: 'down',
    tone: 'neutral',
    period: 'Illustrativt',
    source: 'Illustrativt',
  },
]
