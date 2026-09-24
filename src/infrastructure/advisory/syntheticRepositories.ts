/**
 * The synthetic relationship record: the Phase 1 store.
 *
 * Named for what it is. The institution's fitness rule forbids a memory
 * fallback at the analysis composition root ("constructs the in-memory store
 * nowhere but its own module"), and this is not that: it is the seeded,
 * synthetic advisory record the phase gate asked for, held in memory because
 * no durable store may hold client data before the privacy posture is ruled
 * (TD-104). A PostgreSQL adapter replaces it behind the same ports.
 *
 * Phase 1 storage: seeded from the synthetic clients when the process starts
 * and held in maps for the life of the process. Confirmed updates persist
 * across page loads and vanish on restart, and the document says so
 * (TD-104). PostgreSQL repositories later satisfy the same ports behind the
 * same container.
 *
 * Every read returns copies of immutable records, sorted where the port
 * says so, so a caller can neither mutate the store nor depend on insertion
 * order.
 */

import type {
  Advisor,
  Asset,
  Client,
  Commitment,
  ContextFact,
  Goal,
  Household,
  ImportantEvent,
  Interaction,
  Liability,
  MemoryCandidate,
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

export function createSyntheticAdvisoryRepositories(
  seed: AdvisorySeed,
): AdvisoryRepositories {
  const advisors = byId<Advisor>(seed.advisors)
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

  /* Sequences per kind, like a database would keep. */
  const sequences = new Map<MintedKind, number>()
  /* What the advisor decided about Sentinel priorities, in the order decided. Empty at seed. */
  const dispositions: SentinelDisposition[] = []

  return {
    clients: {
      async list() {
        return [...clients.values()]
      },
      async byId(id) {
        return clients.get(id) ?? null
      },
      async householdById(id) {
        return households.get(id) ?? null
      },
      async advisorById(id) {
        return advisors.get(id) ?? null
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
        dispositions.push(disposition)
      },
    },
    ids: {
      async mint(kind) {
        const next = (sequences.get(kind) ?? 0) + 1
        sequences.set(kind, next)
        return `${kind}-${String(next).padStart(4, '0')}`
      },
    },
  }
}
