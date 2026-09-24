/**
 * The client — the foundational object of the advisory context.
 *
 * A client is DATA, never an actor: the advisor is the person the system
 * serves, and the firm's operator is resolved server-side (ruled 2026-08-13).
 * Nothing here knows about markets, cases or the institution's record; the
 * bridges live in `application/advisory`.
 *
 * Records carry facts with dates. They carry no computed labels ("the client
 * is risk-averse") — those are derived in `intelligence.ts` from the facts
 * they rest on, every time, so a later policy change cannot make a stored
 * value wrong.
 */

export type ClientId = string
export type HouseholdId = string
export type AdvisorId = string

export type ClientSegment =
  'private-banking' | 'wealth-management' | 'entrepreneur' | 'family-office'

/** The mandate's risk profile on the firm's seven-step scale, 1 lowest. */
export type RiskProfile = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type CommunicationChannel = 'phone' | 'email' | 'teams' | 'in-person'

export interface Client {
  id: ClientId
  householdId: HouseholdId
  displayName: string
  segment: ClientSegment
  /** ISO date the relationship opened. */
  relationshipSince: string
  primaryAdvisorId: AdvisorId
  /** ISO date of birth. Synthetic in Phase 1; sensitive in production. */
  dateOfBirth: string
  riskProfile: RiskProfile
  preferredChannel: CommunicationChannel
  /** Gross annual income, minor units are not used: whole currency units. */
  annualIncome: number | null
  currency: 'SEK'
}

export type HouseholdMemberRole =
  'client' | 'spouse' | 'child' | 'company' | 'holding-company' | 'foundation' | 'related'

export interface HouseholdMember {
  id: string
  householdId: HouseholdId
  role: HouseholdMemberRole
  displayName: string
  /** The member's own client id where the member is a client of the firm. */
  clientId?: ClientId
  /** ISO date of birth where known and relevant (a child's, a spouse's). */
  dateOfBirth?: string
}

export interface Household {
  id: HouseholdId
  displayName: string
  members: readonly HouseholdMember[]
}

export interface Advisor {
  id: AdvisorId
  displayName: string
}
