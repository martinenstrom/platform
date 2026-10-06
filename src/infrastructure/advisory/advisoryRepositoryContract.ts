/**
 * The contract every advisory store must keep — the synthetic record and
 * SQLite judged by one set of expectations. The contract is the authority;
 * a difference between the adapters is a contract case here, never a fix
 * in one store.
 */

import { describe, expect, it } from 'vitest'
import type { AdvisoryRepositories } from '~/application/advisory/ports'
import type { Client, Office } from '~/domain/advisory'
import { syntheticClients, type AdvisorySeed } from './syntheticClients'

export const CONTRACT_TODAY = '2026-09-23'

export interface ContractSubject {
  name: string
  /** A fresh store holding the given seed. */
  open(seed: AdvisorySeed): Promise<AdvisoryRepositories>
}

export function describeAdvisoryRepositoryContract(subject: ContractSubject): void {
  const seeded = () => subject.open(syntheticClients(CONTRACT_TODAY))

  describe(`${subject.name}: the advisory repository contract`, () => {
    it('reads the seeded register in a stable order', async () => {
      const repositories = await seeded()
      const clients = await repositories.clients.list()
      expect(clients.map((c) => c.id)).toEqual([...clients.map((c) => c.id)].sort())
      expect(clients.length).toBe(7)
      const offices = await repositories.clients.offices()
      expect(offices.map((o) => o.id)).toEqual([
        'of-strandvagen',
        'of-arbetargatan',
        'of-avenyn',
      ])
      expect((await repositories.clients.advisors()).map((a) => a.id)).toEqual([
        'adv-martin',
        'adv-sofia',
      ])
    })

    it('returns every record whole, round-tripped, with its provenance', async () => {
      const repositories = await seeded()
      const seed = syntheticClients(CONTRACT_TODAY)
      const alvarsson = seed.clients.find((c) => c.id === 'cl-alvarsson')!
      expect(await repositories.clients.byId('cl-alvarsson')).toEqual(alvarsson)
      expect(await repositories.clients.householdById(alvarsson.householdId)).toEqual(
        seed.households.find((h) => h.id === alvarsson.householdId),
      )
      const assets = await repositories.wealth.assetsOf('cl-alvarsson')
      expect(assets).toEqual(
        seed.assets
          .filter((a) => a.clientId === 'cl-alvarsson')
          .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1)),
      )
      const portfolio = await repositories.portfolios.portfolioOf('cl-alvarsson')
      expect(portfolio).toEqual(
        seed.portfolios.find((p) => p.clientId === 'cl-alvarsson'),
      )
      const commitments = await repositories.commitments.commitmentsOf('cl-alvarsson')
      expect(commitments.length).toBeGreaterThan(0)
      expect(commitments[0]!.provenance).toEqual(
        seed.commitments.find((c) => c.id === commitments[0]!.id)!.provenance,
      )
      const interactions = await repositories.interactions.interactionsOf('cl-alvarsson')
      expect(interactions.map((i) => i.date)).toEqual(
        [...interactions.map((i) => i.date)].sort().reverse(),
      )
      expect(interactions[0]).toEqual(
        seed.interactions.find((i) => i.id === interactions[0]!.id),
      )
      const events = await repositories.events.eventsOf('cl-alvarsson')
      expect(events.map((e) => e.date)).toEqual([...events.map((e) => e.date)].sort())
      expect(await repositories.goals.goalsOf('cl-alvarsson')).toEqual(
        seed.goals.filter((g) => g.clientId === 'cl-alvarsson'),
      )
      expect(await repositories.opportunities.opportunitiesOf('cl-alvarsson')).toEqual(
        seed.opportunities
          .filter((o) => o.clientId === 'cl-alvarsson')
          .sort((a, b) => b.potentialValue - a.potentialValue || (a.id < b.id ? -1 : 1)),
      )
      expect(await repositories.meetingSnapshots.latestFor('cl-alvarsson')).toEqual(
        seed.meetingSnapshots
          .filter((s) => s.clientId === 'cl-alvarsson')
          .sort((a, b) => (a.meetingDate > b.meetingDate ? -1 : 1))[0] ?? null,
      )
    })

    it('mints identities the record owns, in sequence per kind', async () => {
      const repositories = await seeded()
      expect(await repositories.ids.mint('commitment')).toBe('commitment-0001')
      expect(await repositories.ids.mint('commitment')).toBe('commitment-0002')
      expect(await repositories.ids.mint('client')).toBe('client-0001')
    })

    it('keeps a candidate, a fact, a commitment and an event once written', async () => {
      const repositories = await seeded()
      const seed = syntheticClients(CONTRACT_TODAY)
      const template = seed.commitments[0]!
      await repositories.commitments.addCommitment({
        ...template,
        id: 'commitment-new',
        title: 'Återkomma med jämförelse',
        status: 'open',
        createdAt: '2026-09-23',
      })
      const written = await repositories.commitments.commitmentById('commitment-new')
      expect(written?.title).toBe('Återkomma med jämförelse')
      await repositories.commitments.saveCommitment({
        ...written!,
        status: 'done',
        completedAt: '2026-09-24',
      })
      expect(
        (await repositories.commitments.commitmentById('commitment-new'))?.status,
      ).toBe('done')
      /* A fact's status moves and its provenance stays: a concern resolved is still the concern that was voiced. */
      const concern = (await repositories.context.factsOf('cl-alvarsson')).find(
        (f) => f.category === 'concern' && f.status === 'active',
      )!
      await repositories.context.saveFact({
        ...concern,
        status: 'resolved',
        statusAt: '2026-09-24',
      })
      const resolved = (await repositories.context.factsOf('cl-alvarsson')).find(
        (f) => f.id === concern.id,
      )
      expect(resolved).toEqual({ ...concern, status: 'resolved', statusAt: '2026-09-24' })
      const disposition = {
        priorityId: 'pr-1',
        clientId: 'cl-alvarsson',
        status: 'reviewed' as const,
        fingerprint: 'fp',
        at: '2026-09-23T10:00:00.000Z',
        by: 'adv-martin',
        until: null,
        reason: null,
      }
      await repositories.sentinel.addDisposition(disposition)
      expect(await repositories.sentinel.dispositionsOf('cl-alvarsson')).toEqual([
        disposition,
      ])
    })

    it('adds and saves a client, an office and a household', async () => {
      const repositories = await seeded()
      const office: Office = {
        id: 'of-stureplan',
        name: 'Stureplan',
        city: 'Stockholm',
        displayName: 'Stureplan',
        shortName: 'Sture.',
        status: 'active',
        archivedAt: null,
      }
      await repositories.clients.addOffice(office)
      expect((await repositories.clients.offices()).map((o) => o.id)).toContain(
        'of-stureplan',
      )
      await repositories.clients.saveOffice({
        ...office,
        status: 'archived',
        archivedAt: '2026-09-23',
      })
      expect((await repositories.clients.officeById('of-stureplan'))?.status).toBe(
        'archived',
      )
      await repositories.clients.saveHousehold({
        id: 'hh-new',
        displayName: 'Familjen Ny',
        members: [
          { id: 'mem-new-1', householdId: 'hh-new', role: 'client', displayName: 'Ny' },
        ],
      })
      const client: Client = {
        id: 'cl-new',
        householdId: 'hh-new',
        officeId: 'of-strandvagen',
        displayName: 'Ny Klient',
        segment: 'private-banking',
        relationshipSince: '2026-09-23',
        primaryAdvisorId: 'adv-martin',
        dateOfBirth: '1980-01-01',
        riskProfile: 3,
        preferredChannel: 'email',
        annualIncome: null,
        currency: 'SEK',
        lifecycle: { status: 'onboarding', since: '2026-09-23', closure: null },
      }
      await repositories.clients.addClient(client)
      expect(await repositories.clients.byId('cl-new')).toEqual(client)
      await repositories.clients.saveClient({
        ...client,
        lifecycle: { status: 'active', since: '2026-10-01', closure: null },
      })
      expect((await repositories.clients.byId('cl-new'))?.lifecycle.status).toBe('active')
      await expect(repositories.clients.addClient(client)).rejects.toThrow()
      /* The advisor a personal record is set up for: inserted once, replaced by id. */
      await repositories.clients.saveAdvisor({ id: 'adv-new', displayName: 'Ny' })
      await repositories.clients.saveAdvisor({ id: 'adv-new', displayName: 'Nyare' })
      expect(await repositories.clients.advisorById('adv-new')).toEqual({
        id: 'adv-new',
        displayName: 'Nyare',
      })
    })

    it('keeps the lifecycle history and the office stretches', async () => {
      const repositories = await seeded()
      const stretches = await repositories.lifecycle.officeHistoryOf('cl-alvarsson')
      expect(stretches).toHaveLength(1)
      expect(stretches[0]!.officeId).toBe('of-strandvagen')
      expect(stretches[0]!.to).toBeNull()
      await repositories.lifecycle.saveOfficeHistory({
        ...stretches[0]!,
        to: '2026-09-30',
      })
      await repositories.lifecycle.addOfficeHistory({
        id: 'stretch-2',
        clientId: 'cl-alvarsson',
        officeId: 'of-arbetargatan',
        from: '2026-09-30',
        to: null,
      })
      expect(
        (await repositories.lifecycle.officeHistoryOf('cl-alvarsson')).map(
          (s) => s.officeId,
        ),
      ).toEqual(['of-strandvagen', 'of-arbetargatan'])
      await repositories.lifecycle.addEvent({
        id: 'lifecycle-1',
        subject: 'client',
        subjectId: 'cl-alvarsson',
        kind: 'CLIENT_MOVED_OFFICE',
        effectiveDate: '2026-09-30',
        at: '2026-09-23T10:00:00.000Z',
        by: 'adv-martin',
        detail: { fromOfficeId: 'of-strandvagen', toOfficeId: 'of-arbetargatan' },
        note: null,
      })
      await repositories.lifecycle.addEvent({
        id: 'lifecycle-2',
        subject: 'client',
        subjectId: 'cl-alvarsson',
        kind: 'CLIENT_UPDATED',
        effectiveDate: '2026-09-30',
        at: '2026-09-23T11:00:00.000Z',
        by: 'adv-martin',
        detail: {},
        note: 'x',
      })
      expect(
        (await repositories.lifecycle.eventsOf('cl-alvarsson')).map((e) => e.id),
      ).toEqual(['lifecycle-2', 'lifecycle-1'])
      expect((await repositories.lifecycle.events()).length).toBe(2)
    })

    it('rolls back everything a failing unit of work wrote', async () => {
      const repositories = await seeded()
      const before = await repositories.clients.byId('cl-alvarsson')
      await expect(
        repositories.transaction(async () => {
          await repositories.clients.saveClient({
            ...before!,
            officeId: 'of-arbetargatan',
          })
          await repositories.lifecycle.addEvent({
            id: 'lifecycle-rollback',
            subject: 'client',
            subjectId: 'cl-alvarsson',
            kind: 'CLIENT_MOVED_OFFICE',
            effectiveDate: '2026-09-30',
            at: '2026-09-23T10:00:00.000Z',
            by: 'adv-martin',
            detail: {},
            note: null,
          })
          throw new Error('the office aggregate could not be updated')
        }),
      ).rejects.toThrow('aggregate')
      expect((await repositories.clients.byId('cl-alvarsson'))?.officeId).toBe(
        'of-strandvagen',
      )
      expect(await repositories.lifecycle.eventsOf('cl-alvarsson')).toEqual([])
    })

    it('commits a unit of work that completes, including a nested one', async () => {
      const repositories = await seeded()
      await repositories.transaction(async () => {
        await repositories.transaction(async () => {
          await repositories.ids.mint('office')
        })
        await repositories.clients.saveClient({
          ...(await repositories.clients.byId('cl-alvarsson'))!,
          officeId: 'of-avenyn',
        })
      })
      expect((await repositories.clients.byId('cl-alvarsson'))?.officeId).toBe(
        'of-avenyn',
      )
      expect(await repositories.ids.mint('office')).toBe('office-0002')
    })

    it('replaces the market ledger whole', async () => {
      const repositories = await seeded()
      expect(await repositories.marketEvents.state()).toEqual({ active: [], history: [] })
      const event = {
        id: 'rates:rate:se10y:daily',
        category: 'rates',
        symbol: 'rate:se10y',
        label: 'Svensk 10-årsränta',
        metric: 'yield',
        currentValue: 2.5,
        previousValue: 2.3,
        change: 20,
        changeUnit: 'bp',
        direction: 'up',
        magnitude: 20,
        severity: 'major',
        horizon: 'daily',
        observedAt: '2026-09-23T08:00:00.000Z',
        source: 'fixture',
        quality: 'fixture',
        peakChange: 20,
        peakAt: '2026-09-23T08:00:00.000Z',
        thresholds: { enter: 10, exit: 5, major: 15 },
        firstSeenAt: '2026-09-23T08:00:00.000Z',
        updatedAt: '2026-09-23T08:00:00.000Z',
        expiresAt: '2026-09-30T08:00:00.000Z',
        tags: {},
      }
      await repositories.marketEvents.replace({
        active: [event as never],
        history: [],
      })
      expect((await repositories.marketEvents.state()).active).toEqual([event])
    })
  })
}
