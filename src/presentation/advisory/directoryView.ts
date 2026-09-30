/**
 * How the command centre arranges the directory: search, filters, sorts.
 *
 * Presentation over typed rows the server derived — nothing here decides
 * whether a client needs attention; it only chooses which rows to show and
 * in what order, from the flags and figures each row already carries.
 */

import type { ClientDirectoryRow } from '~/application/advisory/clientDirectory'

export type ClientFilter =
  | 'all'
  | 'needs-attention'
  | 'upcoming-meeting'
  | 'investment-opportunity'
  | 'financing-opportunity'
  | 'retention-risk'
  | 'high-cash'
  | 'portfolio-deviation'
  | 'no-recent-contact'
  | 'open-commitment'
  | 'overdue-commitment'
  | 'event-approaching'
  | 'has-opportunity'

export const CLIENT_FILTERS: readonly { id: ClientFilter; label: string }[] = [
  { id: 'all', label: 'Alla klienter' },
  { id: 'needs-attention', label: 'Behöver uppmärksamhet' },
  { id: 'upcoming-meeting', label: 'Kommande möte' },
  { id: 'investment-opportunity', label: 'Placeringsmöjlighet' },
  { id: 'financing-opportunity', label: 'Finansieringsmöjlighet' },
  { id: 'retention-risk', label: 'Risk att förlora' },
  { id: 'high-cash', label: 'Hög kassa' },
  { id: 'portfolio-deviation', label: 'Portföljavvikelse' },
  { id: 'no-recent-contact', label: 'Ingen kontakt nyligen' },
  { id: 'open-commitment', label: 'Öppet åtagande' },
  { id: 'overdue-commitment', label: 'Försenat åtagande' },
  { id: 'event-approaching', label: 'Viktig händelse nära' },
  { id: 'has-opportunity', label: 'Möjligheter' },
]

/**
 * The office book's first row of filters — the questions an advisor asks
 * of an office in five seconds — with the rest behind "Fler filter". The
 * relationship book as a whole offers every filter on one row.
 */
export const OFFICE_PRIMARY_FILTERS: readonly ClientFilter[] = [
  'all',
  'needs-attention',
  'upcoming-meeting',
  'overdue-commitment',
  'financing-opportunity',
  'investment-opportunity',
  'has-opportunity',
  'no-recent-contact',
]

export const OFFICE_SECONDARY_FILTERS: readonly ClientFilter[] = CLIENT_FILTERS.map(
  (f) => f.id,
).filter((id) => !OFFICE_PRIMARY_FILTERS.includes(id))

/** The label for a filter id, as the chips print it. */
export function filterLabel(filter: ClientFilter): string {
  return CLIENT_FILTERS.find((f) => f.id === filter)?.label ?? filter
}

export function matchesFilter(row: ClientDirectoryRow, filter: ClientFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'has-opportunity':
      return row.activeOpportunities > 0
    case 'needs-attention':
      return row.flags.needsAttention
    case 'upcoming-meeting':
      return row.flags.upcomingMeeting
    case 'investment-opportunity':
      return row.flags.investmentOpportunity
    case 'financing-opportunity':
      return row.flags.financingOpportunity
    case 'retention-risk':
      return row.flags.retentionRisk
    case 'high-cash':
      return row.flags.highCash
    case 'portfolio-deviation':
      return row.flags.portfolioDeviation
    case 'no-recent-contact':
      return row.flags.noRecentContact
    case 'open-commitment':
      return row.flags.openCommitment
    case 'overdue-commitment':
      return row.flags.overdueCommitment
    case 'event-approaching':
      return row.flags.eventApproaching
  }
}

export type ClientSort =
  | 'priority'
  | 'aum'
  | 'wealth'
  | 'health'
  | 'last-contact'
  | 'next-meeting'
  | 'opportunity'

export const CLIENT_SORTS: readonly { id: ClientSort; label: string }[] = [
  { id: 'priority', label: 'Prioritet' },
  { id: 'aum', label: 'AUM' },
  { id: 'wealth', label: 'Total förmögenhet' },
  { id: 'health', label: 'Relationshälsa' },
  { id: 'last-contact', label: 'Senaste kontakt' },
  { id: 'next-meeting', label: 'Nästa möte' },
  { id: 'opportunity', label: 'Möjlighet' },
]

const FAR_FUTURE = '9999-12-31'

/** Priority: the most urgent action first, then the most high-priority signals, then the weakest relationship. */
function priorityOf(row: ClientDirectoryRow): number {
  const urgency = row.nextBestAction?.urgency ?? 6
  return urgency * 1000 - row.highPrioritySignals * 10 + row.health.score / 100
}

export function compareRows(
  sort: ClientSort,
): (a: ClientDirectoryRow, b: ClientDirectoryRow) => number {
  const tie = (a: ClientDirectoryRow, b: ClientDirectoryRow) =>
    a.displayName.localeCompare(b.displayName, 'sv')
  switch (sort) {
    case 'priority':
      return (a, b) => priorityOf(a) - priorityOf(b) || tie(a, b)
    case 'aum':
      return (a, b) => b.aum - a.aum || tie(a, b)
    case 'wealth':
      return (a, b) => b.estimatedWealth - a.estimatedWealth || tie(a, b)
    case 'health':
      return (a, b) => a.health.score - b.health.score || tie(a, b)
    case 'last-contact':
      /* Longest silence first: the relationship most in need of a call. */
      return (a, b) =>
        (b.daysSinceContact ?? Number.MAX_SAFE_INTEGER) -
          (a.daysSinceContact ?? Number.MAX_SAFE_INTEGER) || tie(a, b)
    case 'next-meeting':
      return (a, b) =>
        (a.nextMeeting ?? FAR_FUTURE).localeCompare(b.nextMeeting ?? FAR_FUTURE) ||
        tie(a, b)
    case 'opportunity':
      return (a, b) => b.opportunityValue - a.opportunityValue || tie(a, b)
  }
}

/** Free-text search over the name, the advisor, the office and the segment label given. */
export function matchesSearch(
  row: ClientDirectoryRow,
  query: string,
  segmentLabel: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  return [row.displayName, row.advisorName, row.officeName, segmentLabel, row.id].some(
    (field) => field.toLowerCase().includes(q),
  )
}

export function arrangeRows(
  rows: readonly ClientDirectoryRow[],
  options: {
    filter: ClientFilter
    sort: ClientSort
    query: string
    segmentLabelOf: (row: ClientDirectoryRow) => string
  },
): ClientDirectoryRow[] {
  return rows
    .filter((row) => matchesFilter(row, options.filter))
    .filter((row) => matchesSearch(row, options.query, options.segmentLabelOf(row)))
    .sort(compareRows(options.sort))
}

/** How many rows each filter would show — the count on every chip. */
export function filterCounts(
  rows: readonly ClientDirectoryRow[],
): Record<ClientFilter, number> {
  const counts = {} as Record<ClientFilter, number>
  for (const { id } of CLIENT_FILTERS)
    counts[id] = rows.filter((row) => matchesFilter(row, id)).length
  return counts
}
