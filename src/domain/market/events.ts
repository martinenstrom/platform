/**
 * Domain event contracts.
 *
 * DEFINITIONS ONLY. There is no bus, no publisher and no subscriber, and
 * nothing in the codebase emits or handles these yet — by design. They exist
 * so that when AI agents and event-driven workflows arrive, the event shapes
 * are already agreed and versioned rather than invented ad hoc at the call
 * site of whatever needs them first.
 *
 * Design notes for whoever wires the bus later:
 *  - Events carry **domain models**, never provider payloads. An event is a
 *    fact about the market, not a notification that an HTTP call returned.
 *  - Every event carries `occurredAt` (when the fact became true for us) as
 *    distinct from the data's own `asOf` inside the payload.
 *  - Events are immutable and past-tense. There are no command events here.
 *  - `eventVersion` is per event type, so one payload can evolve without a
 *    global migration.
 */

import type { CanonicalSymbol } from './instruments'
import type { MarketQuote, MarketSeries } from './observations'
import type { NewsItem } from './news'
import type { GovernmentYield, YieldCurve } from './rates'
import type { MarketSentiment } from './sentiment'
import type { Quality } from './provenance'

/** Fields common to every domain event. */
export interface DomainEventBase {
  /** Unique per emission. A consumer may use it for idempotency. */
  eventId: string
  /** ISO 8601 with offset — when we learned the fact, not when it happened. */
  occurredAt: string
  /** Schema version of this event type, e.g. 1. */
  eventVersion: number
  /**
   * Correlates every event produced while serving one request, so an agent
   * can reconstruct exactly which snapshot a decision was made from.
   */
  correlationId?: string
}

export interface MarketQuoteUpdated extends DomainEventBase {
  type: 'market.quote.updated'
  symbol: CanonicalSymbol
  quote: MarketQuote
  /** Present when a prior value was known, so consumers can diff without state. */
  previous?: MarketQuote
}

export interface MarketSeriesUpdated extends DomainEventBase {
  type: 'market.series.updated'
  symbol: CanonicalSymbol
  series: MarketSeries
}

export interface GovernmentYieldUpdated extends DomainEventBase {
  type: 'market.yield.updated'
  symbol: CanonicalSymbol
  governmentYield: GovernmentYield
  /** Emitted alongside when the whole term structure was refreshed. */
  curve?: YieldCurve
}

export interface NewsItemReceived extends DomainEventBase {
  type: 'market.news.received'
  item: NewsItem
}

export interface SentimentUpdated extends DomainEventBase {
  type: 'market.sentiment.updated'
  sentiment: MarketSentiment
  previousScore?: number
}

/**
 * Emitted once per assembled Overview snapshot. Deliberately carries a
 * summary rather than the whole snapshot: a consumer that needs the data
 * should read it through the application service, so this event stays cheap
 * enough to fan out.
 */
export interface OverviewSnapshotUpdated extends DomainEventBase {
  type: 'market.overview.snapshot.updated'
  /** Oldest category `asOf` — the snapshot's conservative freshness. */
  asOf: string
  /** Per-category quality, for consumers deciding whether to act on it. */
  categoryQuality: Record<string, Quality>
  hasDegradedCategory: boolean
}

/** Discriminated union of every domain event. Switch on `type`. */
export type MarketDomainEvent =
  | MarketQuoteUpdated
  | MarketSeriesUpdated
  | GovernmentYieldUpdated
  | NewsItemReceived
  | SentimentUpdated
  | OverviewSnapshotUpdated

export type MarketDomainEventType = MarketDomainEvent['type']

/**
 * Handler shape for the future bus. Declared now so consumers can be written
 * against a stable signature; nothing dispatches to it yet.
 */
export type DomainEventHandler<E extends MarketDomainEvent = MarketDomainEvent> = (
  event: E,
) => void | Promise<void>
