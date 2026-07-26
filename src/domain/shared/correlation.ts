/**
 * Correlation identifiers.
 *
 * One id is minted per inbound request and threaded through every provider
 * call, log record, metric and — once the bus exists — every domain event
 * (`DomainEventBase.correlationId` already reserves the field). That is what
 * makes it possible to reconstruct "which snapshot did this agent act on?"
 * after the fact.
 */

import type { Random } from './random'

declare const correlationIdBrand: unique symbol

export type CorrelationId = string & { readonly [correlationIdBrand]: true }

/**
 * Mints an id from the injected `Random`, so a seeded test produces a stable
 * value. Deliberately never derived from and never containing user input.
 */
export function newCorrelationId(random: Random): CorrelationId {
  return random.hex(16) as CorrelationId
}

/** For call sites that legitimately have no correlation context yet. */
export const NO_CORRELATION = 'uncorrelated' as CorrelationId
