/**
 * The office layer adds no rule: an office's book is its rows summed, the
 * office books add up to the whole book, and an office with no clients is
 * a book of zeros with a calm reading.
 */

import { describe, expect, it } from 'vitest'
import type { Office } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import {
  SEED_OFFICES,
  syntheticClients,
} from '~/infrastructure/advisory/syntheticClients'
import { officeStatusLines, officeSummaryText } from '~/presentation/advisory/officeText'
import { clientDirectory } from './clientDirectory'
import { officeBook, officeBookOf } from './officeBook'
import type { AdvisoryContext } from './ports'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

describe('the office register', () => {
  it('names every office once, and every client belongs to one of them', async () => {
    const context = contextAt()
    const offices = await context.repositories.clients.offices()
    expect(offices.map((o) => o.id)).toEqual(SEED_OFFICES.map((o) => o.id))
    expect(new Set(offices.map((o) => o.id)).size).toBe(offices.length)
    const ids = new Set(offices.map((o) => o.id))
    for (const client of await context.repositories.clients.list()) {
      expect(ids.has(client.officeId), client.id).toBe(true)
    }
    expect(await context.repositories.clients.officeById('of-strandvagen')).toMatchObject(
      {
        displayName: 'Strandvägen',
        city: 'Stockholm',
        status: 'active',
      },
    )
    expect(await context.repositories.clients.officeById('of-nope')).toBeNull()
  })

  it('spreads the synthetic relationships over more than one office', async () => {
    const directory = await clientDirectory(contextAt())
    const populated = directory.offices.filter((b) => b.clientCount > 0)
    expect(populated.length).toBeGreaterThanOrEqual(2)
    expect(directory.rows.every((row) => row.officeName.length > 0)).toBe(true)
  })
})

describe('an office book is its rows, summed', () => {
  it('carries one book per office, each summing exactly its own rows', async () => {
    const directory = await clientDirectory(contextAt())
    expect(directory.offices.map((b) => b.office.id)).toEqual(
      SEED_OFFICES.map((o) => o.id),
    )
    for (const book of directory.offices) {
      const rows = directory.rows.filter((row) => row.officeId === book.office.id)
      expect(book.clientCount).toBe(rows.length)
      expect(book.metrics.totalClients).toBe(rows.length)
      expect(book.metrics.totalAum).toBe(rows.reduce((s, r) => s + r.aum, 0))
      expect(book.metrics.estimatedWealth).toBe(
        rows.reduce((s, r) => s + r.estimatedWealth, 0),
      )
      expect(book.metrics.needingAttention).toBe(
        rows.filter((r) => r.flags.needsAttention).length,
      )
      expect(book.metrics.overdueCommitments).toBe(
        rows.reduce((s, r) => s + r.overdueCommitments, 0),
      )
      expect(book.metrics.opportunityValue).toBe(
        rows.reduce((s, r) => s + r.opportunityValue, 0),
      )
      expect(book.summary.retentionRisk).toBe(
        rows.filter((r) => r.flags.retentionRisk).length,
      )
    }
  })

  it('adds up to the whole book', async () => {
    const directory = await clientDirectory(contextAt())
    const sum = (pick: (b: (typeof directory.offices)[number]) => number) =>
      directory.offices.reduce((s, b) => s + pick(b), 0)
    expect(sum((b) => b.metrics.totalAum)).toBe(directory.metrics.totalAum)
    expect(sum((b) => b.metrics.estimatedWealth)).toBe(directory.metrics.estimatedWealth)
    expect(sum((b) => b.metrics.totalClients)).toBe(directory.metrics.totalClients)
    expect(sum((b) => b.metrics.needingAttention)).toBe(
      directory.metrics.needingAttention,
    )
    expect(sum((b) => b.metrics.overdueCommitments)).toBe(
      directory.metrics.overdueCommitments,
    )
    expect(sum((b) => b.metrics.opportunityValue)).toBe(
      directory.metrics.opportunityValue,
    )
  })

  it('reads one office with only its clients, and knows no office it was not told of', async () => {
    const context = contextAt()
    const book = (await officeBook(context, 'of-strandvagen'))!
    expect(book.office.displayName).toBe('Strandvägen')
    expect(book.rows.map((r) => r.id).sort()).toEqual([
      'cl-alvarsson',
      'cl-berglund',
      'cl-ekstrand',
    ])
    expect(book.rows.every((r) => r.officeId === 'of-strandvagen')).toBe(true)
    /* The soonest booked meeting in the office: Alvarsson on 3 Oct. */
    expect(book.metrics.nextMeeting).toMatchObject({ clientId: 'cl-alvarsson' })
    expect(await officeBook(context, 'of-nope')).toBeNull()
  })

  it('reads Strandvägen into one sentence from its counts', async () => {
    const book = (await officeBook(contextAt(), 'of-strandvagen'))!
    const text = officeSummaryText(book.summary)
    expect(text).toMatch(
      new RegExp(`^${book.summary.needingAttention} klienter? behöver`),
    )
    expect(text).toMatch(/driver prioriteringen\.$/)
    expect(officeStatusLines(book.summary)[0]).toBe(
      `${book.summary.needingAttention} behöver uppmärksamhet`,
    )
  })
})

describe('an office with no clients', () => {
  const empty: Office = {
    id: 'of-empty',
    name: 'Tomgatan',
    city: 'Uppsala',
    displayName: 'Tomgatan',
    shortName: 'Tomg.',
    status: 'active',
  }

  it('is a book of zeros with a calm reading, never an error', async () => {
    const directory = await clientDirectory(contextAt())
    const book = officeBookOf(empty, directory.rows, TODAY)
    expect(book.clientCount).toBe(0)
    expect(book.metrics).toMatchObject({
      totalClients: 0,
      totalAum: 0,
      estimatedWealth: 0,
      needingAttention: 0,
      overdueCommitments: 0,
      opportunityValue: 0,
      meetingsWithin14Days: 0,
      nextMeeting: null,
    })
    expect(officeSummaryText(book.summary)).toBe('Inga kritiska klientärenden.')
    expect(officeStatusLines(book.summary)).toEqual(['Inga kritiska klientärenden'])
  })
})
