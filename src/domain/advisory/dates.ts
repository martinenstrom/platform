/**
 * Date arithmetic on ISO calendar dates (`YYYY-MM-DD`), pure and locale-free.
 *
 * The domain never asks what time it is: every rule takes `today` from its
 * caller, which gets it from the Clock. Parsing here is by hand, so a value
 * that is not an ISO date is refused rather than guessed.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value)
}

/** Days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = ISO_DATE.exec(from)
  const b = ISO_DATE.exec(to)
  if (!a || !b) throw new Error(`daysBetween needs ISO dates, got "${from}" and "${to}"`)
  const utcA = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))
  const utcB = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]))
  return Math.round((utcB - utcA) / 86_400_000)
}

export function addDays(date: string, days: number): string {
  const m = ISO_DATE.exec(date)
  if (!m) throw new Error(`addDays needs an ISO date, got "${date}"`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return d.toISOString().slice(0, 10)
}

/** The calendar date part of an ISO timestamp or date. */
export function dateOf(iso: string): string {
  const m = ISO_DATE.exec(iso)
  if (!m) throw new Error(`dateOf needs an ISO date or timestamp, got "${iso}"`)
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** The next occurrence, on or after `today`, of a yearly date. */
export function nextYearlyOccurrence(date: string, today: string): string {
  const m = ISO_DATE.exec(date)
  const t = ISO_DATE.exec(today)
  if (!m || !t) throw new Error(`nextYearlyOccurrence needs ISO dates`)
  const month = m[2]!
  const day = m[3]!
  const thisYear = `${t[1]}-${month}-${day}`
  if (daysBetween(today, thisYear) >= 0) return thisYear
  return `${Number(t[1]) + 1}-${month}-${day}`
}

/** Age in whole years at `today`. */
export function ageAt(dateOfBirth: string, today: string): number {
  const b = ISO_DATE.exec(dateOfBirth)
  const t = ISO_DATE.exec(today)
  if (!b || !t) throw new Error('ageAt needs ISO dates')
  let age = Number(t[1]) - Number(b[1])
  if (`${t[2]}-${t[3]}` < `${b[2]}-${b[3]}`) age -= 1
  return age
}

/** ISO weekday index, Monday 1 … Sunday 7. */
export function isoWeekday(date: string): number {
  const m = ISO_DATE.exec(date)
  if (!m) throw new Error('isoWeekday needs an ISO date')
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return day === 0 ? 7 : day
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
