/**
 * Swedish (sv-SE) formatting helpers.
 * All monetary values in the UI default to SEK unless a currency is passed.
 */

const LOCALE = 'sv-SE'

export function formatCurrency(
  value: number,
  currency = 'SEK',
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    ...options,
  }).format(value)
}

/** Compact form for large sums, e.g. 1,2 mn kr. */
export function formatCurrencyCompact(value: number, currency = 'SEK'): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatNumber(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/** Signed percentage, e.g. +1,24 %. */
export function formatPercent(value: number, fractionDigits = 2): string {
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.abs(value))
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatted} %`
}

/** Signed amount with explicit +/− prefix. */
export function formatSignedCurrency(value: number, currency = 'SEK'): string {
  const formatted = formatCurrency(Math.abs(value), currency)
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatted}`
}

export function formatDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(date)
}

export function formatDateTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  return new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short' }).format(date)
}

/** Relative Swedish time label, e.g. "för 12 min sedan". */
export function formatRelativeTime(input: string | Date, now = new Date()): string {
  const date = typeof input === 'string' ? new Date(input) : input
  const diffMs = date.getTime() - now.getTime()
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 1000 * 60 * 60 * 24 * 365],
    ['month', 1000 * 60 * 60 * 24 * 30],
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
  ]

  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit)
    }
  }
  return formatter.format(Math.round(diffMs / 1000), 'second')
}

/** Tone helper so positive/negative colouring stays consistent everywhere. */
export function changeTone(value: number): 'positive' | 'negative' | 'neutral' {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}
