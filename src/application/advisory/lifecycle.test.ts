/**
 * The lifecycle, act by act, on the record: a relationship is created into
 * onboarding with only what is known, activated into the active book,
 * moved with its history kept, closed with what it leaves open counted and
 * cancelled, listed among the former, read historically, and brought back
 * as the same client. A failing act leaves the record untouched. The
 * active book, the office books and Sentinel count only active clients.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { client360 } from './client360'
import { clientDirectory } from './clientDirectory'
import {
  activateClient,
  changeClientAdvisor,
  closeClient,
  closureReviewOf,
  createClient,
  editClient,
  lifecycleFeed,
  moveClientOffice,
  onboardingOverviewOf,
  reactivateClient,
  similarRelationships,
} from './lifecycle'
import { officeBook } from './officeBook'
import type { AdvisoryContext } from './ports'
import { sentinelBrief } from './sentinel'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

const minimal = {
  displayName: 'Anna Exempel',
  segment: 'private-banking' as const,
  officeId: 'of-strandvagen',
  advisorId: 'adv-martin',
  relationshipSince: '2026-09-20',
  status: 'onboarding' as const,
  by: 'adv-martin',
}

describe('creating a relationship', () => {
  it('creates an onboarding client from the minimum, with nothing invented', async () => {
    const context = contextAt()
    const result = await createClient(context, minimal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const client = await context.repositories.clients.byId(result.clientId)
    expect(client?.lifecycle).toEqual({
      status: 'onboarding',
      since: '2026-09-20',
      closure: null,
    })
    expect(client?.riskProfile).toBeNull()
    expect(client?.dateOfBirth).toBeNull()
    expect(await context.repositories.wealth.assetsOf(result.clientId)).toEqual([])
    expect(await context.repositories.portfolios.portfolioOf(result.clientId)).toBeNull()
    const household = await context.repositories.clients.householdById(
      client!.householdId,
    )
    expect(household?.members.map((m) => m.clientId)).toEqual([result.clientId])
    const stretches = await context.repositories.lifecycle.officeHistoryOf(
      result.clientId,
    )
    expect(stretches.map((s) => [s.officeId, s.from, s.to])).toEqual([
      ['of-strandvagen', '2026-09-20', null],
    ])
    const events = await context.repositories.lifecycle.eventsOf(result.clientId)
    expect(events.map((e) => e.kind)).toEqual(['CLIENT_CREATED'])
    /* The view reads the new relationship like any other. */
    const view = await client360(context, result.clientId)
    expect(view?.client.displayName).toBe('Anna Exempel')
    expect(view?.balanceSheet.totalAssets).toBe(0)
  })

  it('records the optional initial information as the client’s own dated statements', async () => {
    const context = contextAt()
    const result = await createClient(context, {
      ...minimal,
      initialFinancial: {
        aum: 2_000_000,
        liquidity: 500_000,
        totalWealth: 5_000_000,
        debt: { amount: 1_000_000, ratePercent: 3.5, interestType: 'variable' },
      },
      initialContext: {
        goal: { kind: 'long-term-growth', title: 'Bygga långsiktigt kapital' },
        nextMeeting: '2026-10-15',
        concern: 'Orolig för räntan',
        note: 'Första samtalet: vill ha en helhetsbild.',
      },
    })
    if (!result.ok) throw new Error(result.code)
    const view = (await client360(context, result.clientId))!
    expect(view.balanceSheet.totalAssets).toBe(5_000_000)
    expect(view.balanceSheet.assetsWithBank).toBe(2_000_000)
    expect(view.balanceSheet.liquidity).toBe(500_000)
    expect(view.balanceSheet.totalLiabilities).toBe(1_000_000)
    expect(
      view.assets.every((a) => a.source === 'client-stated' && a.valuedAt === TODAY),
    ).toBe(true)
    expect(view.goals.map((g) => g.title)).toEqual(['Bygga långsiktigt kapital'])
    expect(view.nextMeeting?.occursOn).toBe('2026-10-15')
    expect(view.contextFacts.map((f) => f.statement)).toEqual(['Orolig för räntan'])
    expect(view.interactions.map((i) => i.title)).toEqual(['Inledande notering'])
  })

  it('warns about a similar relationship and creates only when acknowledged', async () => {
    const context = contextAt()
    const first = await createClient(context, {
      ...minimal,
      displayName: 'Henrik Alvarsson',
    })
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.code).toBe('SIMILAR_EXISTS')
    if (first.code !== 'SIMILAR_EXISTS') return
    expect(first.similar.map((s) => s.id)).toEqual(['cl-alvarsson'])
    const second = await createClient(context, {
      ...minimal,
      displayName: 'Henrik Alvarsson',
      acknowledgeSimilar: true,
    })
    expect(second.ok).toBe(true)
    expect((await similarRelationships(context, 'henrik alvarsson')).length).toBe(2)
  })

  it('refuses an archived office and an unknown advisor', async () => {
    const context = contextAt()
    const office = (await context.repositories.clients.officeById('of-avenyn'))!
    await context.repositories.clients.saveOffice({
      ...office,
      status: 'archived',
      archivedAt: TODAY,
    })
    expect(await createClient(context, { ...minimal, officeId: 'of-avenyn' })).toEqual({
      ok: false,
      code: 'OFFICE_ARCHIVED',
    })
    expect(await createClient(context, { ...minimal, advisorId: 'adv-nobody' })).toEqual({
      ok: false,
      code: 'ADVISOR_NOT_FOUND',
    })
  })
})

describe('the books and the aggregates', () => {
  it('counts an onboarding client in no active aggregate until it is activated', async () => {
    const context = contextAt()
    const before = await clientDirectory(context)
    const created = await createClient(context, {
      ...minimal,
      initialFinancial: { aum: 3_000_000 },
    })
    if (!created.ok) throw new Error(created.code)
    const during = await clientDirectory(context)
    expect(during.metrics.totalClients).toBe(before.metrics.totalClients)
    expect(during.metrics.totalAum).toBe(before.metrics.totalAum)
    expect((await clientDirectory(context, 'onboarding')).rows.map((r) => r.id)).toEqual([
      created.clientId,
    ])
    const overview = await onboardingOverviewOf(context, created.clientId)
    expect(overview?.known).toBe(1)
    expect(overview?.total).toBe(7)

    const activated = await activateClient(context, {
      clientId: created.clientId,
      effectiveDate: '2026-09-23',
      by: 'adv-martin',
    })
    expect(activated.ok).toBe(true)
    const after = await clientDirectory(context)
    expect(after.metrics.totalClients).toBe(before.metrics.totalClients + 1)
    expect(after.metrics.totalAum).toBe(before.metrics.totalAum + 3_000_000)
    const strand = (await officeBook(context, 'of-strandvagen'))!
    expect(strand.rows.some((r) => r.id === created.clientId)).toBe(true)
    expect(
      (await context.repositories.lifecycle.eventsOf(created.clientId)).map(
        (e) => e.kind,
      ),
    ).toEqual(['CLIENT_ACTIVATED', 'CLIENT_CREATED'])
  })

  it('cannot activate an active client or close a former one', async () => {
    const context = contextAt()
    expect(
      (await activateClient(context, { clientId: 'cl-alvarsson', by: 'adv-martin' })).ok,
    ).toBe(false)
    await closeClient(context, {
      clientId: 'cl-alvarsson',
      reason: 'CLIENT_CHOICE',
      by: 'adv-martin',
    })
    expect(
      (
        await closeClient(context, {
          clientId: 'cl-alvarsson',
          reason: 'OTHER',
          by: 'adv-martin',
        })
      ).ok,
    ).toBe(false)
  })
})

describe('moving a relationship between offices', () => {
  it('moves the client, keeps the old stretch and updates both office books', async () => {
    const context = contextAt()
    const strandBefore = (await officeBook(context, 'of-strandvagen'))!
    const arbBefore = (await officeBook(context, 'of-arbetargatan'))!
    const moved = await moveClientOffice(context, {
      clientId: 'cl-alvarsson',
      toOfficeId: 'of-arbetargatan',
      effectiveDate: '2026-09-23',
      note: 'Flytt till Arbetargatan efter omorganisation.',
      by: 'adv-martin',
    })
    expect(moved.ok).toBe(true)
    expect((await context.repositories.clients.byId('cl-alvarsson'))?.officeId).toBe(
      'of-arbetargatan',
    )
    const stretches = await context.repositories.lifecycle.officeHistoryOf('cl-alvarsson')
    expect(stretches.map((s) => [s.officeId, s.to])).toEqual([
      ['of-strandvagen', '2026-09-23'],
      ['of-arbetargatan', null],
    ])
    const strandAfter = (await officeBook(context, 'of-strandvagen'))!
    const arbAfter = (await officeBook(context, 'of-arbetargatan'))!
    expect(strandAfter.clientCount).toBe(strandBefore.clientCount - 1)
    expect(arbAfter.clientCount).toBe(arbBefore.clientCount + 1)
    expect(arbAfter.metrics.totalAum - arbBefore.metrics.totalAum).toBe(
      strandBefore.metrics.totalAum - strandAfter.metrics.totalAum,
    )
    const feed = await lifecycleFeed(context, { kinds: ['CLIENT_MOVED_OFFICE'] })
    expect(feed[0]?.event.detail).toEqual({
      fromOfficeId: 'of-strandvagen',
      toOfficeId: 'of-arbetargatan',
    })
    expect(feed[0]?.subjectName).toBe('Henrik Alvarsson')
  })

  it('refuses a move to the same, an unknown or an archived office', async () => {
    const context = contextAt()
    expect(
      await moveClientOffice(context, {
        clientId: 'cl-alvarsson',
        toOfficeId: 'of-strandvagen',
        by: 'adv-martin',
      }),
    ).toEqual({ ok: false, code: 'NOT_ALLOWED' })
    expect(
      await moveClientOffice(context, {
        clientId: 'cl-alvarsson',
        toOfficeId: 'of-nope',
        by: 'adv-martin',
      }),
    ).toEqual({ ok: false, code: 'OFFICE_NOT_FOUND' })
  })

  it('rolls the whole move back when a write fails midway', async () => {
    const context = contextAt()
    const failing: AdvisoryContext = {
      ...context,
      repositories: {
        ...context.repositories,
        lifecycle: {
          ...context.repositories.lifecycle,
          addEvent: async () => {
            throw new Error('disk full')
          },
        },
      },
    }
    await expect(
      moveClientOffice(failing, {
        clientId: 'cl-alvarsson',
        toOfficeId: 'of-arbetargatan',
        by: 'adv-martin',
      }),
    ).rejects.toThrow('disk full')
    expect((await context.repositories.clients.byId('cl-alvarsson'))?.officeId).toBe(
      'of-strandvagen',
    )
    const stretches = await context.repositories.lifecycle.officeHistoryOf('cl-alvarsson')
    expect(stretches).toHaveLength(1)
    expect(stretches[0]?.to).toBeNull()
  })
})

describe('closing and reactivating a relationship', () => {
  it('reviews what a closure leaves open, then cancels promises and bookings and keeps everything else', async () => {
    const context = contextAt()
    const review = (await closureReviewOf(context, 'cl-alvarsson'))!
    expect(review.openCommitments).toBeGreaterThan(0)
    expect(review.bookedMeetings).toBe(1)
    const viewBefore = (await client360(context, 'cl-alvarsson'))!
    const closed = await closeClient(context, {
      clientId: 'cl-alvarsson',
      effectiveDate: '2026-09-23',
      reason: 'COMPETITOR',
      note: 'Valde en annan bank.',
      by: 'adv-martin',
    })
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    expect(closed.client.lifecycle).toEqual({
      status: 'former',
      since: '2026-09-23',
      closure: {
        effectiveDate: '2026-09-23',
        reason: 'COMPETITOR',
        note: 'Valde en annan bank.',
      },
    })
    expect(closed.event.detail['cancelledCommitments']).toBe(review.openCommitments)
    /* Nothing is deleted: the dossier still reads; promises and bookings are cancelled, not gone. */
    const view = (await client360(context, 'cl-alvarsson'))!
    expect(view.commitments.length).toBe(viewBefore.commitments.length)
    expect(view.commitments.every((c) => c.status !== 'open')).toBe(true)
    expect(view.openCommitments).toEqual([])
    expect(view.interactions.length).toBe(viewBefore.interactions.length)
    expect(view.contextFacts.length).toBe(viewBefore.contextFacts.length)
    expect(view.assets.length).toBe(viewBefore.assets.length)
    expect(view.nextMeeting).toBeNull()
    const stretches = await context.repositories.lifecycle.officeHistoryOf('cl-alvarsson')
    expect(stretches[0]?.to).toBe('2026-09-23')
    /* Out of every active aggregate and out of Sentinel. */
    expect(
      (await clientDirectory(context)).rows.some((r) => r.id === 'cl-alvarsson'),
    ).toBe(false)
    expect((await clientDirectory(context, 'former')).rows.map((r) => r.id)).toEqual([
      'cl-alvarsson',
    ])
    const brief = await sentinelBrief(context)
    expect(brief.entries.some((e) => e.client.id === 'cl-alvarsson')).toBe(false)
    expect(brief.quiet.some((q) => q.id === 'cl-alvarsson')).toBe(false)
  })

  it('reactivates the same client into a chosen office and advisor, keeping the closure in history', async () => {
    const context = contextAt()
    await closeClient(context, {
      clientId: 'cl-alvarsson',
      effectiveDate: '2026-06-01',
      reason: 'CLIENT_CHOICE',
      by: 'adv-martin',
    })
    const back = await reactivateClient(context, {
      clientId: 'cl-alvarsson',
      officeId: 'of-avenyn',
      advisorId: 'adv-sofia',
      effectiveDate: '2026-09-23',
      by: 'adv-martin',
    })
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.client.lifecycle).toEqual({
      status: 'active',
      since: '2026-09-23',
      closure: null,
    })
    expect(back.client.officeId).toBe('of-avenyn')
    expect(back.client.primaryAdvisorId).toBe('adv-sofia')
    expect(
      (await context.repositories.clients.list()).filter(
        (c) => c.displayName === 'Henrik Alvarsson',
      ),
    ).toHaveLength(1)
    const events = await context.repositories.lifecycle.eventsOf('cl-alvarsson')
    expect(events.map((e) => e.kind)).toEqual(['CLIENT_REACTIVATED', 'CLIENT_CLOSED'])
    expect(events[0]?.detail['previousClosureReason']).toBe('CLIENT_CHOICE')
    const stretches = await context.repositories.lifecycle.officeHistoryOf('cl-alvarsson')
    expect(stretches.map((s) => s.officeId)).toEqual(['of-strandvagen', 'of-avenyn'])
    expect(
      (await clientDirectory(context)).rows.some((r) => r.id === 'cl-alvarsson'),
    ).toBe(true)
  })
})

describe('editing and handing over', () => {
  it('changes the advisor with an event, and refuses a no-op', async () => {
    const context = contextAt()
    const changed = await changeClientAdvisor(context, {
      clientId: 'cl-alvarsson',
      advisorId: 'adv-sofia',
      by: 'adv-martin',
    })
    expect(changed.ok && changed.client.primaryAdvisorId).toBe('adv-sofia')
    expect(
      await changeClientAdvisor(context, {
        clientId: 'cl-alvarsson',
        advisorId: 'adv-sofia',
        by: 'adv-sofia',
      }),
    ).toEqual({ ok: false, code: 'NOT_ALLOWED' })
  })

  it('edits the relationship facts and records which fields changed', async () => {
    const context = contextAt()
    const edited = await editClient(context, {
      clientId: 'cl-alvarsson',
      displayName: 'Henrik Alvarsson-Berg',
      riskProfile: 5,
      by: 'adv-martin',
    })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.event.detail['fields']).toBe('displayName,riskProfile')
    const household = await context.repositories.clients.householdById(
      edited.client.householdId,
    )
    expect(
      household?.members.find((m) => m.clientId === 'cl-alvarsson')?.displayName,
    ).toBe('Henrik Alvarsson-Berg')
  })
})
