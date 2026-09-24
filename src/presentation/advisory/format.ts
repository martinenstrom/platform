/**
 * Advisory figures and dates as a Swedish Private Banker reads them.
 *
 * Amounts in MSEK with one decimal ("8,4 MSEK"), smaller sums in kSEK,
 * dates as day and short month ("3 okt"), and distances in days as words.
 * Built on the same sv-SE locale as `lib/format.ts`; kept here because the
 * advisory surfaces read money at a different scale from a quote table.
 */

const LOCALE = 'sv-SE'

const oneDecimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const noDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })

/** "8,4 MSEK", "650 kSEK", "0 SEK". Negative amounts keep a real minus sign. */
export function formatMsek(value: number): string {
  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${sign}${oneDecimal.format(abs / 1_000_000)} MSEK`
  if (abs >= 1_000) return `${sign}${noDecimal.format(abs / 1_000)} kSEK`
  return `${sign}${noDecimal.format(abs)} SEK`
}

/** "8 400 000 kr" — the full figure where the exact amount matters. */
export function formatSek(value: number): string {
  return `${noDecimal.format(value)} kr`
}

/** "3,45 %" from a percent value. */
export function formatPct(value: number, fractionDigits = 1): string {
  return `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value)} %`
}

/** "+8 pp" / "−3 pp" — a deviation in percentage points. */
export function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${oneDecimal.format(Math.abs(rounded)).replace(/,0$/, '')} pp`
}

/** "+9,4 %" / "−7,8 %" — signed performance. */
export function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${oneDecimal.format(Math.abs(value))} %`
}

function parts(iso: string): { year: number; month: number; day: number } {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  }
}

const MONTHS_SHORT = [
  'jan',
  'feb',
  'mar',
  'apr',
  'maj',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec',
]

/** "3 okt" — a date without its year, for a timeline or a rail. */
export function formatDayMonth(iso: string): string {
  const { month, day } = parts(iso)
  return `${day} ${MONTHS_SHORT[month - 1] ?? ''}`
}

/** "3 okt 2026". */
export function formatLongDate(iso: string): string {
  const { year, month, day } = parts(iso)
  return `${day} ${MONTHS_SHORT[month - 1] ?? ''} ${year}`
}

/** "2024" — the year of a date. */
export function yearOf(iso: string): string {
  return iso.slice(0, 4)
}

/** "om 53 dagar", "i dag", "i morgon", "för 41 dagar sedan". */
export function formatDaysFromToday(days: number): string {
  if (days === 0) return 'i dag'
  if (days === 1) return 'i morgon'
  if (days === -1) return 'i går'
  if (days > 0) return `om ${days} dagar`
  return `för ${Math.abs(days)} dagar sedan`
}

/** "3/7" — the risk profile on the firm's scale. */
export function formatRiskProfile(profile: number): string {
  return `${profile}/7`
}
