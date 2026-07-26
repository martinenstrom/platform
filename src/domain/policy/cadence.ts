/**
 * Publication-opportunity detection.
 *
 * Answers one question per source: *should* a newer observation exist by now?
 * It is not about how old the data is — a policy rate unchanged for two years
 * is not stale — but about whether the source skipped a publication it owed us.
 *
 * Two rules govern everything here:
 *
 *  1. **A known non-publication day never degrades the state.** A weekend gap
 *     in a business-day series is the series working correctly.
 *  2. **A failed or absent calendar never fabricates an expectation.** When we
 *     cannot tell, the answer is `cadence-unknown`, never `current` and never
 *     `expected-observation-missing`. Guessing in either direction would be a
 *     claim about the institution that we cannot support.
 */

import type { PublicationStatus } from './states'

const DAY_MS = 86_400_000

function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(later) - Date.parse(earlier)) / DAY_MS)
}

/** 0 = Sunday. Uses UTC deliberately: these are dates, not local instants. */
function weekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00.000Z`).getUTCDay()
}

/**
 * ECB — a **calendar-day** series.
 *
 * Verified against the live API: 400 consecutive daily observations covering
 * 400 calendar days, including Saturdays and Sundays. The value is carried
 * forward every day regardless of whether anything happened, so any missing
 * calendar day is a genuine hole rather than a scheduled closure.
 */
export function ecbPublicationStatus(
  latestObservationDate: string,
  today: string,
): PublicationStatus {
  const gap = daysBetween(latestObservationDate, today)
  if (gap < 0) return 'cadence-unknown'
  // One day of slack for the publication landing later in the day than we ask.
  return gap <= 1 ? 'current' : 'expected-observation-missing'
}

/**
 * New York Fed — a **US business-day** series, with no holiday calendar
 * available to us.
 *
 * This is the awkward one and the rule is deliberately conservative. We can
 * skip weekends confidently, but Thanksgiving, Independence Day and the rest
 * are invisible: treating every missing weekday as a missed publication would
 * cry wolf on every federal holiday.
 *
 * So a gap is only reported once it exceeds `MAX_US_HOLIDAY_RUN` business
 * days. No US federal holiday sequence closes the desk for three consecutive
 * business days, so a gap that long is not a holiday. The cost is that a
 * single genuinely missed day goes unreported — an under-report, which is the
 * safe direction, and it is recorded here rather than hidden.
 */
export const MAX_US_HOLIDAY_RUN = 2

export function newYorkFedPublicationStatus(
  latestObservationDate: string,
  today: string,
): PublicationStatus {
  const gap = daysBetween(latestObservationDate, today)
  if (gap < 0) return 'cadence-unknown'
  // Business days STRICTLY between the last observation and today. Today is
  // excluded because its publication may simply not have landed yet, which is
  // the same reason the Riksbank rule below excludes it.
  let owed = 0
  for (let offset = 1; offset < gap; offset += 1) {
    const day = weekday(
      new Date(Date.parse(latestObservationDate) + offset * DAY_MS)
        .toISOString()
        .slice(0, 10),
    )
    if (day !== 0 && day !== 6) owed += 1
  }
  return owed > MAX_US_HOLIDAY_RUN ? 'expected-observation-missing' : 'current'
}

/**
 * Riksbank — a **Swedish bank-day** series, and the only one of the three
 * where the calendar is authoritative rather than inferred.
 *
 * SWEA's `CalendarDays` endpoint states `swedishBankday` per date, which
 * covers Midsummer, Epiphany and the rest exactly. It is used ONLY to decide
 * whether a publication was owed — it is not a monetary-policy meeting
 * calendar and says nothing about decision dates.
 *
 * `bankDays` is `null` when that call failed. The status is then
 * `cadence-unknown`: a broken calendar must not manufacture an expectation.
 */
export function riksbankPublicationStatus(
  latestObservationDate: string,
  today: string,
  bankDays: readonly string[] | null,
): PublicationStatus {
  if (bankDays === null) return 'cadence-unknown'
  const missed = bankDays.filter((date) => date > latestObservationDate && date < today)
  return missed.length > 0 ? 'expected-observation-missing' : 'current'
}
