/**
 * The morning brief over the synthetic seed on the frozen clock: who ranks
 * where and why, the metrics the greeting quotes, and the advisor's word —
 * review, snooze, dismiss — including the dismissal that lapses because the
 * facts moved.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { completeCommitment } from './completeCommitment'
import { confirmClientUpdate } from './confirmClientUpdate'
import type { AdvisoryContext } from './ports'
import { recordClientUpdate } from './recordClientUpdate'
import { disposePriority, sentinelBrief } from './sentinel'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T07:30:00.000Z`),
  }
}

describe('the brief over the seed', () => {
  it('ranks the broken promises first, then today’s meeting work, then what is coming — and leaves one client quiet', async () => {
    const brief = await sentinelBrief(contextAt())
    expect(
      brief.entries.map((e) => [
        e.client.id,
        e.priority.theme,
        e.priority.severity,
        e.priority.horizon,
      ]),
    ).toEqual([
      ['cl-berglund', 'overdue-commitment', 'critical', 'today'],
      ['cl-grahn', 'overdue-commitment', 'critical', 'today'],
      ['cl-dahlqvist', 'overdue-commitment', 'critical', 'today'],
      ['cl-ceder', 'meeting-preparation', 'high', 'today'],
      ['cl-alvarsson', 'meeting-preparation', 'high', 'upcoming'],
      ['cl-forsell', 'contact-silence', 'normal', 'upcoming'],
    ])
    expect(brief.quiet.map((c) => c.id)).toEqual(['cl-ekstrand'])
    expect(brief.today).toBe(TODAY)
    expect(brief.method).toBe('sentinel-v1')
  })

  it('folds Henrik’s meeting, refinancing, concern, cash and promises into one priority', async () => {
    const brief = await sentinelBrief(contextAt())
    const henrik = brief.entries.find((e) => e.client.id === 'cl-alvarsson')!
    expect(henrik.priority.drivers.map((d) => d.kind)).toEqual([
      'meeting',
      'event',
      'concern',
      'allocation-drift',
      'excess-cash',
      'open-commitment',
      'open-commitment',
      /* Alvarsson Holding AB was valued 200 days ago, and a meeting is within 30. */
      'stale-valuation',
      'opportunity',
    ])
    expect(henrik.priority.drivers[1]).toMatchObject({
      eventType: 'mortgage-refinancing',
      amount: 6_500_000,
      daysAhead: 53,
    })
    expect(henrik.priority.sourceIds).toEqual(
      expect.arrayContaining([
        'ev-alv-meeting',
        'ev-alv-refi',
        'cf-alv-1',
        'co-alv-1',
        'co-alv-2',
        'op-alv-2',
      ]),
    )
    expect(henrik.priority.sourceIds).not.toContain('op-alv-1')
    expect(brief.entries.filter((e) => e.client.id === 'cl-alvarsson')).toHaveLength(1)
  })

  it('carries the row facts beside the priority', async () => {
    const brief = await sentinelBrief(contextAt())
    const anna = brief.entries.find((e) => e.client.id === 'cl-dahlqvist')!
    expect(anna.client).toMatchObject({
      displayName: 'Anna & Per Dahlqvist',
      advisorName: 'Sofia',
      aum: 4_850_000,
      nextMeeting: '2026-09-26',
    })
    expect(anna.client.lastContact).toEqual({
      date: '2026-09-03',
      type: 'financing-discussion',
    })
    expect(anna.priority.drivers.some((d) => d.kind === 'birthday')).toBe(true)
  })

  it('counts the morning', async () => {
    const { metrics } = await sentinelBrief(contextAt())
    expect(metrics).toEqual({
      clientsNeedingAttention: 5,
      actToday: 4,
      meetingsWithin7Days: 2,
      overdueCommitments: 4,
      relationshipRisks: 1,
      opportunities: 5,
      quietClients: 1,
      snoozed: 0,
    })
  })
})

describe('the advisor’s word', () => {
  it('a snooze hides the priority until its date and is counted', async () => {
    const context = contextAt()
    const result = await disposePriority(context, {
      priorityId: 'cl-berglund:overdue-commitment',
      status: 'snoozed',
      until: '2026-09-28',
      reason: 'Semester',
    })
    expect(result).toMatchObject({ ok: true, status: 'snoozed' })
    const brief = await sentinelBrief(context)
    const margareta = brief.entries.find((e) => e.client.id === 'cl-berglund')!
    expect(margareta.status).toBe('snoozed')
    expect(margareta.disposition).toMatchObject({
      until: '2026-09-28',
      reason: 'Semester',
      by: 'adv-martin',
    })
    expect(brief.metrics.snoozed).toBe(1)
    expect(brief.metrics.clientsNeedingAttention).toBe(4)
  })

  it('refuses a snooze without a future date, and a priority that does not exist', async () => {
    const context = contextAt()
    expect(
      await disposePriority(context, {
        priorityId: 'cl-berglund:overdue-commitment',
        status: 'snoozed',
        until: TODAY,
      }),
    ).toEqual({ ok: false, code: 'INVALID_UNTIL' })
    expect(
      await disposePriority(context, {
        priorityId: 'cl-berglund:overdue-commitment',
        status: 'snoozed',
      }),
    ).toEqual({ ok: false, code: 'INVALID_UNTIL' })
    expect(
      await disposePriority(context, {
        priorityId: 'cl-ekstrand:opportunity',
        status: 'reviewed',
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(
      await disposePriority(context, {
        priorityId: 'cl-berglund:birthday',
        status: 'reviewed',
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('a review keeps the priority visible and counted; a dismissal hides it while the facts hold', async () => {
    const context = contextAt()
    expect(
      await disposePriority(context, {
        priorityId: 'cl-ceder:meeting-preparation',
        status: 'reviewed',
      }),
    ).toMatchObject({ ok: true, status: 'reviewed' })
    expect(
      await disposePriority(context, {
        priorityId: 'cl-grahn:overdue-commitment',
        status: 'dismissed',
      }),
    ).toMatchObject({ ok: true, status: 'dismissed' })
    const brief = await sentinelBrief(context)
    expect(brief.entries.find((e) => e.client.id === 'cl-ceder')?.status).toBe('reviewed')
    expect(brief.entries.find((e) => e.client.id === 'cl-grahn')?.status).toBe(
      'dismissed',
    )
    expect(brief.metrics.clientsNeedingAttention).toBe(4)
  })

  it('completing the promise resolves the priority, and the old dismissal no longer applies', async () => {
    const context = contextAt()
    await disposePriority(context, {
      priorityId: 'cl-grahn:overdue-commitment',
      status: 'dismissed',
    })
    expect(await completeCommitment(context, 'co-gra-1')).toEqual({ ok: true })
    const brief = await sentinelBrief(context)
    const lars = brief.entries.find((e) => e.client.id === 'cl-grahn')!
    expect(lars.priority.theme).toBe('portfolio')
    expect(lars.status).toBe('active')
    expect(brief.metrics.overdueCommitments).toBe(3)
  })

  it('a fresh interaction removes the silence', async () => {
    const context = contextAt()
    const recorded = await recordClientUpdate(context, {
      clientId: 'cl-forsell',
      noteText: 'Ringde Ingrid, allt lugnt.',
      interactionType: 'phone',
    })
    if (!recorded.ok) throw new Error('note not recorded')
    await confirmClientUpdate(context, {
      candidateId: recorded.candidate.id,
      decisions: [],
    })
    const brief = await sentinelBrief(context)
    const ingrid = brief.entries.find((e) => e.client.id === 'cl-forsell')
    expect(ingrid?.priority.theme).not.toBe('contact-silence')
    expect(ingrid?.priority.drivers.some((d) => d.kind === 'silence')).toBe(false)
  })
})
