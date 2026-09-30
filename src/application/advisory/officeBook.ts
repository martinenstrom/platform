/**
 * The office book — the relationship book read office by office.
 *
 * Private Banking is organised by office: the advisor answers for
 * relationships from several offices, and asks of each office what the
 * whole book is asked — how large, how many, who needs attention, whom am
 * I meeting, what is owed, where the openings are. The office layer adds
 * no rule of its own: every figure is a sum or a count over the directory
 * rows the client rules already produced, so an office's book can never
 * disagree with its clients' pages.
 */

import { daysBetween, type Office, type OfficeId } from '~/domain/advisory'
import {
  clientDirectory,
  type ClientDirectoryMetrics,
  type ClientDirectoryRow,
} from './clientDirectory'
import type { AdvisoryContext } from './ports'

const MEETING_WINDOW_DAYS = 30
const NEAR_MEETING_WINDOW_DAYS = 14

export interface OfficeMetrics extends ClientDirectoryMetrics {
  /** Meetings booked within the next 14 days. */
  meetingsWithin14Days: number
  /** The soonest booked meeting in the office, where one is. */
  nextMeeting: { clientId: string; displayName: string; date: string } | null
}

/** The counts an office's one-line reading rests on — real counts, never a score. */
export interface OfficeSummary {
  needingAttention: number
  overdueCommitments: number
  retentionRisk: number
  /** Clients with a financing event or opening approaching. */
  financingApproaching: number
  meetingsWithin14Days: number
  activeOpportunities: number
  opportunityValue: number
}

export interface OfficeBook {
  office: Office
  metrics: OfficeMetrics
  summary: OfficeSummary
  clientCount: number
}

/** The whole-book metrics over a set of rows — the same sums for the book and for each office. */
export function directoryMetricsOf(
  rows: readonly ClientDirectoryRow[],
  today: string,
): ClientDirectoryMetrics {
  return {
    totalClients: rows.length,
    totalAum: rows.reduce((sum, r) => sum + r.aum, 0),
    estimatedWealth: rows.reduce((sum, r) => sum + r.estimatedWealth, 0),
    needingAttention: rows.filter((r) => r.flags.needsAttention).length,
    upcomingMeetings: rows.filter(
      (r) =>
        r.nextMeeting !== null &&
        daysBetween(today, r.nextMeeting) <= MEETING_WINDOW_DAYS,
    ).length,
    openCommitments: rows.reduce((sum, r) => sum + r.openCommitments, 0),
    overdueCommitments: rows.reduce((sum, r) => sum + r.overdueCommitments, 0),
    activeOpportunities: rows.reduce((sum, r) => sum + r.activeOpportunities, 0),
    opportunityValue: rows.reduce((sum, r) => sum + r.opportunityValue, 0),
  }
}

export function officeBookOf(
  office: Office,
  allRows: readonly ClientDirectoryRow[],
  today: string,
): OfficeBook {
  const rows = allRows.filter((row) => row.officeId === office.id)
  const base = directoryMetricsOf(rows, today)
  const booked = rows
    .filter((r) => r.nextMeeting !== null)
    .sort((a, b) => a.nextMeeting!.localeCompare(b.nextMeeting!))
  const soonest = booked[0]
  const meetingsWithin14Days = booked.filter(
    (r) => daysBetween(today, r.nextMeeting!) <= NEAR_MEETING_WINDOW_DAYS,
  ).length
  const metrics: OfficeMetrics = {
    ...base,
    meetingsWithin14Days,
    nextMeeting: soonest
      ? {
          clientId: soonest.id,
          displayName: soonest.displayName,
          date: soonest.nextMeeting!,
        }
      : null,
  }
  return {
    office,
    metrics,
    summary: {
      needingAttention: base.needingAttention,
      overdueCommitments: base.overdueCommitments,
      retentionRisk: rows.filter((r) => r.flags.retentionRisk).length,
      financingApproaching: rows.filter((r) => r.flags.financingOpportunity).length,
      meetingsWithin14Days,
      activeOpportunities: base.activeOpportunities,
      opportunityValue: base.opportunityValue,
    },
    clientCount: rows.length,
  }
}

/** One book per office in the register, in the register's order — an office with no clients is a book with zeros. */
export function officeBooksOf(
  offices: readonly Office[],
  rows: readonly ClientDirectoryRow[],
  today: string,
): OfficeBook[] {
  return offices.map((office) => officeBookOf(office, rows, today))
}

/* -------------------------------------------------------------- one office */

export interface OfficeBookView extends OfficeBook {
  /** The office's clients, the same rows the whole book carries. */
  rows: readonly ClientDirectoryRow[]
  today: string
  generatedAt: string
  method: 'rule-based-v1'
}

/** The office's book read once: null when the office is not in the register. */
export async function officeBook(
  context: AdvisoryContext,
  officeId: OfficeId,
): Promise<OfficeBookView | null> {
  const office = await context.repositories.clients.officeById(officeId)
  if (!office) return null
  const directory = await clientDirectory(context)
  const book = officeBookOf(office, directory.rows, directory.today)
  return {
    ...book,
    rows: directory.rows.filter((row) => row.officeId === office.id),
    today: directory.today,
    generatedAt: directory.generatedAt,
    method: directory.method,
  }
}
