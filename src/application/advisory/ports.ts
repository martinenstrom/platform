/**
 * The advisory context's ports — what the relationship record must be able
 * to answer, stated as small repository interfaces the infrastructure
 * implements.
 *
 * Phase 1 wires synthetic in-memory repositories; a CRM, a custodian feed or
 * PostgreSQL later satisfies the same interfaces behind the same composition
 * root, and nothing above this file changes. Every read is per client: the
 * record is a set of relationships, and a surface never needs the whole
 * table at once except the directory, which asks `ClientRepository.list`.
 *
 * Identities are minted by the record, never by a caller — `IdentityMint` is
 * the seam a database sequence later fills.
 */

import type {
  Advisor,
  AdvisorId,
  Asset,
  Client,
  ClientId,
  Commitment,
  ContextFact,
  Goal,
  Household,
  HouseholdId,
  ImportantEvent,
  Interaction,
  Liability,
  MemoryCandidate,
  Opportunity,
  Portfolio,
  SentinelDisposition,
} from '~/domain/advisory'
import type { Clock } from '~/domain/shared/clock'

export interface ClientRepository {
  list(): Promise<readonly Client[]>
  byId(id: ClientId): Promise<Client | null>
  householdById(id: HouseholdId): Promise<Household | null>
  advisorById(id: AdvisorId): Promise<Advisor | null>
}

export interface WealthRepository {
  assetsOf(clientId: ClientId): Promise<readonly Asset[]>
  liabilitiesOf(clientId: ClientId): Promise<readonly Liability[]>
}

export interface PortfolioRepository {
  portfolioOf(clientId: ClientId): Promise<Portfolio | null>
}

export interface GoalRepository {
  goalsOf(clientId: ClientId): Promise<readonly Goal[]>
}

export interface InteractionRepository {
  /** Newest first. */
  interactionsOf(clientId: ClientId): Promise<readonly Interaction[]>
  addInteraction(interaction: Interaction): Promise<void>
  /** Every candidate for the client, newest first, whatever its status. */
  candidatesOf(clientId: ClientId): Promise<readonly MemoryCandidate[]>
  candidateById(id: string): Promise<MemoryCandidate | null>
  /** Insert or replace by id. */
  saveCandidate(candidate: MemoryCandidate): Promise<void>
}

export interface ContextRepository {
  factsOf(clientId: ClientId): Promise<readonly ContextFact[]>
  addFact(fact: ContextFact): Promise<void>
}

export interface CommitmentRepository {
  commitmentsOf(clientId: ClientId): Promise<readonly Commitment[]>
  addCommitment(commitment: Commitment): Promise<void>
  commitmentById(id: string): Promise<Commitment | null>
  /** Replace by id. */
  saveCommitment(commitment: Commitment): Promise<void>
}

export interface EventRepository {
  eventsOf(clientId: ClientId): Promise<readonly ImportantEvent[]>
  addEvent(event: ImportantEvent): Promise<void>
}

export interface OpportunityRepository {
  opportunitiesOf(clientId: ClientId): Promise<readonly Opportunity[]>
}

/** What the advisor decided about Sentinel priorities — the only state Sentinel keeps. */
export interface SentinelRepository {
  dispositions(): Promise<readonly SentinelDisposition[]>
  dispositionsOf(clientId: ClientId): Promise<readonly SentinelDisposition[]>
  addDisposition(disposition: SentinelDisposition): Promise<void>
}

export type MintedKind = 'interaction' | 'candidate' | 'fact' | 'commitment' | 'event'

/** The record mints every identity. A caller never supplies one. */
export interface IdentityMint {
  mint(kind: MintedKind): Promise<string>
}

export interface AdvisoryRepositories {
  clients: ClientRepository
  wealth: WealthRepository
  portfolios: PortfolioRepository
  goals: GoalRepository
  interactions: InteractionRepository
  context: ContextRepository
  commitments: CommitmentRepository
  events: EventRepository
  opportunities: OpportunityRepository
  sentinel: SentinelRepository
  ids: IdentityMint
}

/** Everything an advisory use case needs: the record and the time. */
export interface AdvisoryContext {
  repositories: AdvisoryRepositories
  clock: Clock
}

/** The calendar date the context's clock reads, as the domain wants it. */
export function todayOf(context: AdvisoryContext): string {
  return context.clock.isoNow().slice(0, 10)
}
