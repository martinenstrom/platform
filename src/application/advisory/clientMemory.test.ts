/**
 * The daily workflow, end to end against the record: a note becomes a
 * candidate, the advisor's word turns confirmed items into memory, and the
 * directory and the client page read the change back.
 *
 * Run against the synthetic seed through the in-memory repositories — the
 * same composition the server uses, on a frozen clock.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { ExtractedItem } from '~/domain/advisory'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { askAboutClient } from './askAboutClient'
import { client360 } from './client360'
import { clientDirectory } from './clientDirectory'
import { completeCommitment } from './completeCommitment'
import { confirmClientUpdate } from './confirmClientUpdate'
import { prepareMeeting } from './meetingPrep'
import type { AdvisoryContext } from './ports'
import { recordClientUpdate } from './recordClientUpdate'

const TODAY = '2026-09-23'

function contextAt(today = TODAY): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(today)),
    clock: new FakeClock(`${today}T10:00:00.000Z`),
  }
}

const NOTE =
  'Träffade Henrik i dag. Han är fortsatt orolig över energiallokeringen. Vi diskuterade det långsiktiga resonemanget. Bolånet ska omsättas den 14 november. Nästa möte är bokat den 3 december. Jag lovade att återkomma med en jämförelse av två placeringsalternativ.'

describe('recording an update', () => {
  let context: AdvisoryContext
  beforeEach(() => {
    context = contextAt()
  })

  it('keeps the note as written and proposes items without touching the record', async () => {
    const before = await context.repositories.interactions.interactionsOf('cl-alvarsson')
    const result = await recordClientUpdate(context, {
      clientId: 'cl-alvarsson',
      noteText: NOTE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.candidate.noteText).toBe(NOTE)
    expect(result.candidate.status).toBe('pending')
    expect(result.candidate.interactionDate).toBe(TODAY)
    expect(result.candidate.items.map((i) => i.kind)).toEqual(
      expect.arrayContaining([
        'interaction',
        'concern',
        'important-event',
        'next-meeting',
        'commitment',
        'discussion-topics',
      ]),
    )
    expect(
      await context.repositories.interactions.interactionsOf('cl-alvarsson'),
    ).toHaveLength(before.length)
  })

  it('refuses an empty note and an unknown client', async () => {
    expect(
      await recordClientUpdate(context, { clientId: 'cl-alvarsson', noteText: '   ' }),
    ).toEqual({ ok: false, code: 'EMPTY_NOTE' })
    expect(
      await recordClientUpdate(context, { clientId: 'nobody', noteText: NOTE }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('lets the advisor overrule the interaction type', async () => {
    const result = await recordClientUpdate(context, {
      clientId: 'cl-alvarsson',
      noteText: NOTE,
      interactionType: 'phone',
    })
    expect(result.ok && result.candidate.interactionType).toBe('phone')
    expect(result.ok && result.candidate.items[0]?.interactionType).toBe('phone')
  })
})

describe('confirming an update', () => {
  let context: AdvisoryContext
  let candidateId: string
  let items: readonly ExtractedItem[]

  beforeEach(async () => {
    context = contextAt()
    const recorded = await recordClientUpdate(context, {
      clientId: 'cl-alvarsson',
      noteText: NOTE,
    })
    if (!recorded.ok) throw new Error('seed note not recorded')
    candidateId = recorded.candidate.id
    items = recorded.candidate.items
  })

  it('confirm all: the note joins the timeline and every confirmed item becomes a record with provenance', async () => {
    const factsBefore = (await context.repositories.context.factsOf('cl-alvarsson'))
      .length
    const commitmentsBefore = (
      await context.repositories.commitments.commitmentsOf('cl-alvarsson')
    ).length
    const eventsBefore = (await context.repositories.events.eventsOf('cl-alvarsson'))
      .length

    const result = await confirmClientUpdate(context, {
      candidateId,
      decisions: items.map((item) => ({ itemId: item.id, decision: 'confirm' as const })),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.created).toEqual({ contextFacts: 1, commitments: 1, events: 2 })

    const interactions =
      await context.repositories.interactions.interactionsOf('cl-alvarsson')
    const interaction = interactions.find((i) => i.id === result.interactionId)
    expect(interactions[0]?.id).toBe(result.interactionId)
    expect(interaction?.noteText).toBe(NOTE)
    expect(interaction?.type).toBe('meeting')
    expect(interaction?.topics).toEqual(
      expect.arrayContaining(['energy-exposure', 'financing']),
    )
    expect(interaction?.keyPoints).toEqual([
      'Vi diskuterade det långsiktiga resonemanget',
    ])

    const facts = await context.repositories.context.factsOf('cl-alvarsson')
    expect(facts).toHaveLength(factsBefore + 1)
    const concern = facts.find(
      (f) => f.provenance.sourceInteractionId === result.interactionId,
    )
    expect(concern).toMatchObject({
      category: 'concern',
      status: 'active',
      provenance: {
        origin: 'jarvis-extraction',
        confirmedByAdvisor: true,
        sourceDate: TODAY,
        sourceText: 'Han är fortsatt orolig över energiallokeringen.',
      },
    })
    expect(concern?.provenance.confirmedAt).toBe('2026-09-23T10:00:00.000Z')

    const commitments =
      await context.repositories.commitments.commitmentsOf('cl-alvarsson')
    expect(commitments).toHaveLength(commitmentsBefore + 1)
    expect(
      commitments.find((c) => c.provenance.sourceInteractionId === result.interactionId),
    ).toMatchObject({
      title: 'Återkomma med en jämförelse av två placeringsalternativ',
      status: 'open',
      dueDate: null,
      ownerAdvisorId: 'adv-martin',
    })

    const events = await context.repositories.events.eventsOf('cl-alvarsson')
    expect(events).toHaveLength(eventsBefore + 2)
    expect(
      events.find((e) => e.type === 'mortgage-refinancing' && e.date === '2026-11-14')
        ?.reminderRules,
    ).toEqual([{ daysBefore: 30 }])
    expect(
      events.find((e) => e.type === 'client-meeting' && e.date === '2026-12-03')
        ?.reminderRules,
    ).toEqual([{ daysBefore: 7 }])

    const candidate = await context.repositories.interactions.candidateById(candidateId)
    expect(candidate).toMatchObject({
      status: 'confirmed',
      interactionId: result.interactionId,
    })
  })

  it('a discarded or undecided item never becomes a record, but the note is still kept', async () => {
    const factsBefore = (await context.repositories.context.factsOf('cl-alvarsson'))
      .length
    const concern = items.find((i) => i.kind === 'concern')!
    const commitment = items.find((i) => i.kind === 'commitment')!
    const result = await confirmClientUpdate(context, {
      candidateId,
      decisions: [
        { itemId: concern.id, decision: 'discard' },
        {
          itemId: commitment.id,
          decision: 'confirm',
          title: 'Skicka jämförelsen',
          date: '2026-10-01',
        },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.created).toEqual({ contextFacts: 0, commitments: 1, events: 0 })
    expect((await context.repositories.context.factsOf('cl-alvarsson')).length).toBe(
      factsBefore,
    )
    const saved = (
      await context.repositories.commitments.commitmentsOf('cl-alvarsson')
    ).find((c) => c.provenance.sourceInteractionId === result.interactionId)
    expect(saved).toMatchObject({ title: 'Skicka jämförelsen', dueDate: '2026-10-01' })
    expect(
      (await context.repositories.interactions.interactionsOf('cl-alvarsson'))[0]
        ?.noteText,
    ).toBe(NOTE)
  })

  it('refuses an event without a date, and a second confirmation', async () => {
    const event = items.find((i) => i.kind === 'important-event')!
    expect(
      await confirmClientUpdate(context, {
        candidateId,
        decisions: [{ itemId: event.id, decision: 'confirm', date: null }],
      }),
    ).toEqual({
      ok: false,
      code: 'EVENT_NEEDS_DATE',
      itemId: event.id,
    })
    expect(
      await confirmClientUpdate(context, {
        candidateId,
        decisions: [{ itemId: 'nope', decision: 'confirm' }],
      }),
    ).toEqual({ ok: false, code: 'UNKNOWN_ITEM' })
    expect((await confirmClientUpdate(context, { candidateId, decisions: [] })).ok).toBe(
      true,
    )
    expect(await confirmClientUpdate(context, { candidateId, decisions: [] })).toEqual({
      ok: false,
      code: 'ALREADY_RESOLVED',
    })
  })
})

describe('the directory over the synthetic seed', () => {
  const context = contextAt()

  it('lists every client with figures, health and a next best action', async () => {
    const directory = await clientDirectory(context)
    expect(directory.rows).toHaveLength(7)
    expect(directory.metrics.totalClients).toBe(7)
    expect(directory.metrics.totalAum).toBe(directory.rows.reduce((s, r) => s + r.aum, 0))
    for (const row of directory.rows) {
      expect(row.estimatedWealth).toBeGreaterThan(row.aum)
      expect(row.health.drivers.length).toBeGreaterThan(0)
      expect(row.nextBestAction).not.toBeNull()
    }
    expect(directory.today).toBe(TODAY)
  })

  it('flags the relationships the seed was written to exercise', async () => {
    const rows = Object.fromEntries(
      (await clientDirectory(context)).rows.map((r) => [r.id, r]),
    )
    expect(rows['cl-berglund']?.flags.overdueCommitment).toBe(true)
    expect(rows['cl-grahn']?.flags.highCash).toBe(true)
    expect(rows['cl-alvarsson']?.flags.portfolioDeviation).toBe(true)
    expect(rows['cl-ceder']?.flags.noRecentContact).toBe(true)
    expect(rows['cl-ceder']?.flags.needsAttention).toBe(true)
    expect(rows['cl-dahlqvist']?.flags.upcomingMeeting).toBe(true)
    expect(rows['cl-dahlqvist']?.flags.financingOpportunity).toBe(true)
    expect(rows['cl-forsell']?.flags.overdueCommitment).toBe(false)
  })

  it('counts the metrics from the rows', async () => {
    const directory = await clientDirectory(context)
    expect(directory.metrics.overdueCommitments).toBe(4)
    expect(directory.metrics.needingAttention).toBe(
      directory.rows.filter((r) => r.flags.needsAttention).length,
    )
    expect(directory.metrics.upcomingMeetings).toBe(4)
  })
})

describe('the client page', () => {
  const context = contextAt()

  it('reads one relationship in full, derived, with its sources', async () => {
    const view = await client360(context, 'cl-alvarsson')
    expect(view).not.toBeNull()
    if (!view) return
    expect(view.advisor?.displayName).toBe('Martin')
    expect(view.household?.members.map((m) => m.role)).toContain('holding-company')
    expect(view.balanceSheet.assetsWithBank).toBe(21_000_000)
    expect(
      view.deviations.find((d) => d.assetClass === 'equities')?.deviationPoints,
    ).toBe(7)
    expect(view.nextMeeting?.occursOn).toBe('2026-10-03')
    expect(view.lastContact?.date).toBe('2026-09-12')
    expect(view.daysSinceContact).toBe(11)
    expect(view.openCommitments.map((c) => c.id)).toEqual(['co-alv-1', 'co-alv-2'])
    /* 6.8 MSEK cash beside a growth goal: over twice the threshold, so high priority and first. */
    expect(view.signals[0]?.kind).toBe('excess-cash')
    expect(view.signals.map((s) => s.kind)).toEqual(
      expect.arrayContaining([
        'meeting-approaching',
        'allocation-drift',
        'refinancing-approaching',
        'open-concern',
      ]),
    )
    expect(view.reminders.length).toBeGreaterThan(0)
    expect(view.contextFacts.every((f) => f.provenance.sourceDate.length === 10)).toBe(
      true,
    )
  })

  it('is null for a client that does not exist', async () => {
    expect(await client360(context, 'nobody')).toBeNull()
  })

  it('completes a promise and the page reads it as done', async () => {
    expect(await completeCommitment(context, 'co-alv-1')).toEqual({ ok: true })
    expect(await completeCommitment(context, 'co-alv-1')).toEqual({
      ok: false,
      code: 'NOT_OPEN',
    })
    const view = await client360(context, 'cl-alvarsson')
    expect(view?.openCommitments.map((c) => c.id)).toEqual(['co-alv-2'])
    expect(view?.commitments.find((c) => c.id === 'co-alv-1')).toMatchObject({
      status: 'done',
      completedAt: TODAY,
    })
  })

  it('answers a question from the record', async () => {
    const result = await askAboutClient(context, {
      clientId: 'cl-alvarsson',
      question: 'När förfaller bolånet?',
    })
    expect(result.ok && result.answer.kind).toBe('loan-maturity')
    expect(result.ok && result.answer.hits.some((h) => h.date === '2026-11-15')).toBe(
      true,
    )
  })

  it('prepares the meeting from the same facts', async () => {
    const prep = await prepareMeeting(context, 'cl-alvarsson')
    expect(prep?.meeting?.id).toBe('ev-alv-meeting')
    expect(prep?.suggestedTopics.some((t) => t.kind === 'client-concern')).toBe(true)
  })
})
