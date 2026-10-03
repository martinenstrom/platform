/**
 * The compact analytical card for a period answer: one block per
 * instrument with the period's change, the start and the latest
 * observation, the dates, the source and the data's own time, and the
 * measured series thinned to a sparkline. Strings are made here, once, so
 * the component renders and never computes; nothing in the card is a
 * sentence nobody wrote.
 */

import type { MarketAnswer, MarketAnswerItem } from '~/application/jarvis/marketAnswer'
import { periodLabel, signedMove } from './marketAnswerText'

const TZ = 'Europe/Stockholm'

export interface MarketCardItem {
  symbol: string
  name: string
  /** "DEN HÄR VECKAN", "SEPTEMBER". */
  periodLabel: string
  /** "+1,6 %", "−14 bp". */
  change: string
  tone: 'up' | 'down' | 'flat'
  start: { value: string; date: string }
  latest: { value: string; date: string }
  /** "28 sep – 3 okt" */
  span: string
  source: string
  /** "Data t.o.m. 3 okt 2026 10:31" */
  asOf: string
  /** Up to sixty values of the measured series, for a sparkline. */
  spark: readonly number[]
  /** "Senaste observationen är från 26 sep." when the latest point is older than the policy allows. */
  stale: string | null
}

export interface MarketCard {
  items: MarketCardItem[]
  /** Instruments asked for and not served for the period, by name. */
  missing: string[]
  /** "Nasdaq 100 före S&P 500 med 0,7 procentenheter" for a comparison. */
  difference: string | null
}

const sv = (value: number, digits: number) =>
  new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(value)
    .replace(/ /g, ' ')
const levelText = (value: number, symbol: string): string =>
  sv(
    value,
    symbol.startsWith('fx:') ? 4 : symbol.startsWith('rate:') ? 2 : value >= 1000 ? 0 : 2,
  )
const dayShort = (date: string) =>
  new Date(`${date}T12:00:00.000Z`).toLocaleDateString('sv-SE', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  })
const stamp = (iso: string) => {
  const date = new Date(iso)
  const day = date.toLocaleDateString('sv-SE', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  if (iso.endsWith('T00:00:00.000Z')) return day
  const time = date.toLocaleTimeString('sv-SE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${day} ${time}`
}

function cardItem(item: MarketAnswerItem): MarketCardItem | null {
  if (!item.start || !item.end) return null
  const move = item.metric === 'yield' ? item.changeBasisPoints : item.changePercent
  return {
    symbol: item.symbol,
    name: item.name,
    periodLabel: periodLabel(item.period),
    change: signedMove(item),
    tone: move === null || Math.abs(move) < 0.005 ? 'flat' : move > 0 ? 'up' : 'down',
    start: {
      value: levelText(item.start.value, item.symbol),
      date: dayShort(item.start.date),
    },
    latest: {
      value: levelText(item.end.value, item.symbol),
      date: dayShort(item.end.date),
    },
    span: `${dayShort(item.start.date)} – ${dayShort(item.end.date)}`,
    source: item.source ?? '',
    asOf: item.observedAt ? `Data t.o.m. ${stamp(item.observedAt)}` : '',
    spark: item.spark,
    stale: item.latestIsStale
      ? `Senaste observationen är från ${dayShort(item.end.date)}.`
      : null,
  }
}

/** The card for a period answer with at least one measured instrument; null for today's answers. */
export function marketCardOf(answer: MarketAnswer): MarketCard | null {
  if (answer.period.kind === 'today') return null
  const items = answer.items
    .map(cardItem)
    .filter((item): item is MarketCardItem => item !== null)
  if (items.length === 0) return null
  let difference: string | null = null
  if (answer.comparison) {
    const { a, b, differencePercentagePoints, differenceBasisPoints } = answer.comparison
    if (differencePercentagePoints !== null)
      difference = `${a.name} ${differencePercentagePoints >= 0 ? 'före' : 'efter'} ${b.name} med ${sv(Math.abs(differencePercentagePoints), 2)} procentenheter`
    else if (differenceBasisPoints !== null)
      difference = `${a.name} ${differenceBasisPoints >= 0 ? 'före' : 'efter'} ${b.name} med ${Math.abs(Math.round(differenceBasisPoints))} baspunkter`
  }
  return { items, missing: answer.missing.map((entry) => entry.name), difference }
}
