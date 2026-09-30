/**
 * An office's book, in sentences: the one-line reading beneath the
 * office's name and the status counts on its folder. Composed from the
 * counts the office book carries — real counts, never a score — and
 * nothing is added that the counts do not say.
 */

import type { OfficeSummary } from '~/application/advisory/officeBook'

const CALM = 'Inga kritiska klientärenden.'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "a, b och c" */
function joinSv(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`
}

/**
 * "4 klienter behöver uppmärksamhet. 2 försenade åtaganden och 1 kommande
 * finansieringshändelse driver prioriteringen." — or the calm line.
 */
export function officeSummaryText(summary: OfficeSummary): string {
  const drivers: string[] = []
  if (summary.overdueCommitments > 0)
    drivers.push(
      plural(summary.overdueCommitments, 'försenat åtagande', 'försenade åtaganden'),
    )
  if (summary.financingApproaching > 0)
    drivers.push(
      plural(
        summary.financingApproaching,
        'kommande finansieringshändelse',
        'kommande finansieringshändelser',
      ),
    )
  if (summary.retentionRisk > 0)
    drivers.push(
      plural(summary.retentionRisk, 'relation i riskzonen', 'relationer i riskzonen'),
    )
  if (summary.needingAttention === 0 && drivers.length === 0) {
    return summary.meetingsWithin14Days > 0
      ? `${CALM} ${plural(summary.meetingsWithin14Days, 'möte', 'möten')} inom 14 dagar.`
      : CALM
  }
  const first =
    summary.needingAttention > 0
      ? `${plural(summary.needingAttention, 'klient behöver', 'klienter behöver')} uppmärksamhet.`
      : ''
  const second =
    drivers.length > 0
      ? `${capitalise(joinSv(drivers))} driver prioriteringen.`
      : summary.meetingsWithin14Days > 0
        ? `${plural(summary.meetingsWithin14Days, 'möte', 'möten')} inom 14 dagar.`
        : ''
  return [first, second].filter(Boolean).join(' ')
}

/** The folder's status lines: ["4 behöver uppmärksamhet", "2 försenade åtaganden", "1 relation i riskzonen"] or the calm line. */
export function officeStatusLines(summary: OfficeSummary): string[] {
  const lines: string[] = []
  if (summary.needingAttention > 0)
    lines.push(`${summary.needingAttention} behöver uppmärksamhet`)
  if (summary.overdueCommitments > 0)
    lines.push(
      plural(summary.overdueCommitments, 'försenat åtagande', 'försenade åtaganden'),
    )
  if (summary.retentionRisk > 0)
    lines.push(
      plural(summary.retentionRisk, 'relation i riskzonen', 'relationer i riskzonen'),
    )
  return lines.length > 0 ? lines : [CALM.replace(/\.$/, '')]
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
