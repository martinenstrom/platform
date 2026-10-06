/**
 * The synthetic relationship record: the demonstration and test store.
 *
 * Named for what it is. The institution's fitness rule forbids a memory
 * fallback at the analysis composition root ("constructs the in-memory store
 * nowhere but its own module"), and this is not that: it is the seeded,
 * synthetic advisory record for development, demonstration and tests. The
 * desktop runs on the SQLite adapter behind the same ports
 * (`sqlite/repositories.ts`), and the two are judged by one contract.
 *
 * Held in maps for the life of the process. Every read returns copies of
 * immutable records, sorted where the port says so, so a caller can neither
 * mutate the store nor depend on insertion order. A unit of work snapshots
 * every map and restores it when the work throws, so a multi-record act
 * rolls back here exactly as it does in SQLite.
 */

import type {
  Advisor,
  Asset,
  Client,
  ClientOfficeHistory,
  Commitment,
  ContextFact,
  Goal,
  Household,
  ImportantEvent,
  Interaction,
  Liability,
  LifecycleEvent,
  MarketLedgerState,
  MeetingSnapshot,
  MemoryCandidate,
  Office,
  Opportunity,
  Portfolio,
  SentinelDisposition,
} from '~/domain/advisory'
import type { AdvisoryRepositories, MintedKind } from '~/application/advisory/ports'
import type { AdvisorySeed } from './syntheticClients'

const byId = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.id, item]))

const newestFirst = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  a.date > b.date ? -1 : a.date < b.date ? 1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0

const newestCreatedFirst = (
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
) =>
  a.createdAt > b.createdAt
    ? -1
    : a.createdAt < b.createdAt
      ? 1
      : a.id < b.id
        ? 1
        : a.id > b.id
          ? -1
          : 0

const ofClient = <T extends { clientId: string }>(
  store: Map<string, T>,
  clientId: string,
) => [...store.values()].filter((item) => item.clientId === clientId)

/** The empty record: what a new Financial OS holds before its first relationship. */
export const EMPTY_SEED: AdvisorySeed = Object.freeze({
  advisors: [],
  offices: [],
  clients: [],
  households: [],
  assets: [],
  liabilities: [],
  portfolios: [],
  goals: [],
  interactions: [],
  contextFacts: [],
  commitments: [],
  events: [],
  opportunities: [],
  meetingSnapshots: [],
})

export function createSyntheticAdvisoryRepositories(
  seed: AdvisorySeed,
): AdvisoryRepositories {
  const advisors = byId<Advisor>(seed.advisors)
  const offices = byId<Office>(seed.offices)
  const clients = byId<Client>(seed.clients)
  const households = byId<Household>(seed.households)
  const assets = byId<Asset>(seed.assets)
  const liabilities = byId<Liability>(seed.liabilities)
  const portfolios = byId<Portfolio>(seed.portfolios)
  const goals = byId<Goal>(seed.goals)
  const interactions = byId<Interaction>(seed.interactions)
  const candidates = new Map<string, MemoryCandidate>()
  const facts = byId<ContextFact>(seed.contextFacts)
  const commitments = byId<Commitment>(seed.commitments)
  const events = byId<ImportantEvent>(seed.events)
  const opportunities = byId<Opportunity>(seed.opportunities)
  const meetingSnapshots = byId<MeetingSnapshot>(seed.meetingSnapshots)
  const lifecycleEvents = new Map<string, LifecycleEvent>()
  /* Every seeded client stands at its office since the relationship began. */
  const officeHistory = new Map<string, ClientOfficeHistory>(
    seed.clients.map((client) => [
      `stretch-seed-${client.id}`,
      {
        id: `stretch-seed-${client.id}`,
        clientId: client.id,
        officeId: client.officeId,
        from: client.relationshipSince,
        to: null,
      },
    ]),
  )

  /* Sequences per kind, like a database would keep. */
  const sequences = new Map<MintedKind, number>()
  /* What the advisor decided about Sentinel priorities, in the order decided. Empty at seed. */
  let dispositions: SentinelDisposition[] = []
  /* The open market events and the closed ones kept as history. Derived state, rebuilt on every read. */
  let marketLedger: MarketLedgerState = { active: [], history: [] }

  const stores = [
    advisors,
    offices,
    clients,
    households,
    assets,
    liabilities,
    portfolios,
    goals,
    interactions,
    candidates,
    facts,
    commitments,
    events,
    opportunities,
    meetingSnapshots,
    lifecycleEvents,
    officeHistory,
    sequences,
  ] as const
  let depth = 0

  const repositories: AdvisoryRepositories = {
    clients: {
      async list() {
        return [...clients.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
      },
      async byId(id) {
        return clients.get(id) ?? null
      },
      async addClient(client) {
        if (clients.has(client.id)) throw new Error(`client ${client.id} already exists`)
        clients.set(client.id, client)
      },
      async saveClient(client) {
        if (!clients.has(client.id)) throw new Error(`client ${client.id} does not exist`)
        clients.set(client.id, client)
      },
      async householdById(id) {
        return households.get(id) ?? null
      },
      async saveHousehold(household) {
        households.set(household.id, household)
      },
      async advisorById(id) {
        return advisors.get(id) ?? null
      },
      async advisors() {
        return [...advisors.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
      },
      async saveAdvisor(advisor) {
        advisors.set(advisor.id, advisor)
      },
      async offices() {
        return [...offices.values()]
      },
      async officeById(id) {
        return offices.get(id) ?? null
      },
      async addOffice(office) {
        if (offices.has(office.id)) throw new Error(`office ${office.id} already exists`)
        offices.set(office.id, office)
      },
      async saveOffice(office) {
        if (!offices.has(office.id)) throw new Error(`office ${office.id} does not exist`)
        offices.set(office.id, office)
      },
    },
    wealth: {
      async assetsOf(clientId) {
        return ofClient(assets, clientId).sort(
          (a, b) => b.value - a.value || (a.id < b.id ? -1 : 1),
        )
      },
      async liabilitiesOf(clientId) {
        return ofClient(liabilities, clientId).sort(
          (a, b) => b.outstandingBalance - a.outstandingBalance || (a.id < b.id ? -1 : 1),
        )
      },
      async addAsset(asset) {
        assets.set(asset.id, asset)
      },
      async addLiability(liability) {
        liabilities.set(liability.id, liability)
      },
    },
    portfolios: {
      async portfolioOf(clientId) {
        return [...portfolios.values()].find((p) => p.clientId === clientId) ?? null
      },
    },
    goals: {
      async goalsOf(clientId) {
        return ofClient(goals, clientId).sort((a, b) => (a.id < b.id ? -1 : 1))
      },
      async addGoal(goal) {
        goals.set(goal.id, goal)
      },
    },
    interactions: {
      async interactionsOf(clientId) {
        return ofClient(interactions, clientId).sort(newestFirst)
      },
      async addInteraction(interaction) {
        interactions.set(interaction.id, interaction)
      },
      async candidatesOf(clientId) {
        return ofClient(candidates, clientId).sort(newestCreatedFirst)
      },
      async candidateById(id) {
        return candidates.get(id) ?? null
      },
      async saveCandidate(candidate) {
        candidates.set(candidate.id, candidate)
      },
    },
    context: {
      async factsOf(clientId) {
        return ofClient(facts, clientId).sort((a, b) =>
          a.provenance.sourceDate > b.provenance.sourceDate
            ? -1
            : a.provenance.sourceDate < b.provenance.sourceDate
              ? 1
              : a.id < b.id
                ? -1
                : 1,
        )
      },
      async addFact(fact) {
        facts.set(fact.id, fact)
      },
    },
    commitments: {
      async commitmentsOf(clientId) {
        return ofClient(commitments, clientId).sort((a, b) =>
          a.createdAt > b.createdAt
            ? -1
            : a.createdAt < b.createdAt
              ? 1
              : a.id < b.id
                ? -1
                : 1,
        )
      },
      async addCommitment(commitment) {
        commitments.set(commitment.id, commitment)
      },
      async commitmentById(id) {
        return commitments.get(id) ?? null
      },
      async saveCommitment(commitment) {
        commitments.set(commitment.id, commitment)
      },
    },
    events: {
      async eventsOf(clientId) {
        return ofClient(events, clientId).sort((a, b) =>
          a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
        )
      },
      async addEvent(event) {
        events.set(event.id, event)
      },
      async saveEvent(event) {
        events.set(event.id, event)
      },
    },
    opportunities: {
      async opportunitiesOf(clientId) {
        return ofClient(opportunities, clientId).sort(
          (a, b) => b.potentialValue - a.potentialValue || (a.id < b.id ? -1 : 1),
        )
      },
    },
    sentinel: {
      async dispositions() {
        return [...dispositions]
      },
      async dispositionsOf(clientId) {
        return dispositions.filter((d) => d.clientId === clientId)
      },
      async addDisposition(disposition) {
        dispositions = [...dispositions, disposition]
      },
    },
    meetingSnapshots: {
      async latestFor(clientId) {
        return (
          ofClient(meetingSnapshots, clientId).sort((a, b) =>
            a.meetingDate > b.meetingDate
              ? -1
              : a.meetingDate < b.meetingDate
                ? 1
                : a.capturedAt > b.capturedAt
                  ? -1
                  : 1,
          )[0] ?? null
        )
      },
      async allFor(clientId) {
        return ofClient(meetingSnapshots, clientId).sort((a, b) =>
          a.meetingDate > b.meetingDate ? -1 : 1,
        )
      },
      async save(snapshot) {
        meetingSnapshots.set(snapshot.id, snapshot)
      },
    },
    marketEvents: {
      async state() {
        return { active: [...marketLedger.active], history: [...marketLedger.history] }
      },
      async replace(state) {
        marketLedger = { active: [...state.active], history: [...state.history] }
      },
    },
    lifecycle: {
      async eventsOf(subjectId) {
        return [...lifecycleEvents.values()]
          .filter((event) => event.subjectId === subjectId)
          .sort(newestAtFirst)
      },
      async events() {
        return [...lifecycleEvents.values()].sort(newestAtFirst)
      },
      async addEvent(event) {
        lifecycleEvents.set(event.id, event)
      },
      async officeHistoryOf(clientId) {
        return ofClient(officeHistory, clientId).sort((a, b) =>
          a.from < b.from ? -1 : a.from > b.from ? 1 : a.id < b.id ? -1 : 1,
        )
      },
      async addOfficeHistory(stretch) {
        officeHistory.set(stretch.id, stretch)
      },
      async saveOfficeHistory(stretch) {
        officeHistory.set(stretch.id, stretch)
      },
    },
    ids: {
      async mint(kind) {
        const next = (sequences.get(kind) ?? 0) + 1
        sequences.set(kind, next)
        return `${kind}-${String(next).padStart(4, '0')}`
      },
    },
    async transaction(work) {
      if (depth > 0) return work()
      const snapshot = stores.map((store) => new Map(store as Map<unknown, unknown>))
      const dispositionsBefore = dispositions
      const ledgerBefore = marketLedger
      depth += 1
      try {
        return await work()
      } catch (error) {
        stores.forEach((store, index) => {
          const map = store as Map<unknown, unknown>
          map.clear()
          for (const [key, value] of snapshot[index]!) map.set(key, value)
        })
        dispositions = dispositionsBefore
        marketLedger = ledgerBefore
        throw error
      } finally {
        depth -= 1
      }
    },
  }
  return repositories
}

const newestAtFirst = (a: { at: string; id: string }, b: { at: string; id: string }) =>
  a.at > b.at ? -1 : a.at < b.at ? 1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
