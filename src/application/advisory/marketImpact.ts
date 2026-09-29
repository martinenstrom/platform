/**
 * Market-to-Client, read once: the material market events, which clients
 * they touch and why, and the Sentinel standing that follows — plus the two
 * seams every other advisory read uses to fold the same impacts into its
 * own answer (`activeMarketEvents`, `assessClient`).
 *
 * The events come from the market pipeline's own snapshot through
 * `marketObservationsFrom`: nothing is fetched twice and no second market
 * stack exists. The ledger keeps one evolving event per instrument and
 * horizon between reads, so hysteresis and expiry hold across requests
 * rather than within one.
 */

import {
  assessClient,
  compareImpacts,
  daysBetween,
  marketEventsSince,
  prioritiseClient,
  reconcileMarketLedger,
  relationshipHealth,
  signalsFor,
  statusOf,
  type ClientFacts,
  type ClientMarketImpact,
  type ClientSegment,
  type CloseReason,
  type MarketEvent,
  type MarketLedgerState,
  type MarketObservation,
  type MarketQuality,
  type PriorityStatus,
  type Region,
  type Relevance,
  type Sector,
  type SentinelSeverity,
  type SentinelTheme,
} from '~/domain/advisory'
import type { OverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import type { MarketQuote } from '~/domain/market/observations'
import type { Envelope, Provenance } from '~/domain/shared/provenance'
import { assembleClientFacts } from './clientFacts'
import { groupMarketEpisodes, type MarketEpisode } from './marketEpisodes'
import { todayOf, type AdvisoryContext } from './ports'

/** An impact as surfaces receive it: the domain verdict, unchanged. */
export type ClientMarketImpactView = ClientMarketImpact

/* ------------------------------------------------------------ observations */

/** The region a broad index speaks for, where the advisory record has one. */
const INDEX_REGION: Record<string, Region> = {
  'idx:omxs30': 'sweden',
  'idx:sp500': 'us',
  'idx:nasdaq100': 'us',
  'idx:dax': 'europe',
  'idx:ftse100': 'europe',
}

/** Overview sector symbols mapped onto the advisory record's sector tags; a symbol without one carries no pathway. */
const SECTOR_OF: Record<string, Sector> = {
  'sector:technology': 'technology',
  'sector:industrials': 'industrials',
  'sector:financials': 'financials',
  'sector:healthcare': 'healthcare',
  'sector:realestate': 'real-estate',
  'sector:energy': 'energy',
  'sector:discretionary': 'consumer',
  'sector:staples': 'consumer',
}

/**
 * Pairs quoted in the client's own currency: the base currency's holdings
 * are the exposure. A cross like EUR/USD says nothing direct about a SEK
 * portfolio, so it opens events but reaches no client (documented V1 limit).
 */
const FX_CURRENCY: Record<string, string> = {
  'fx:usdsek': 'USD',
  'fx:eursek': 'EUR',
  'fx:gbpsek': 'GBP',
  'fx:noksek': 'NOK',
  'fx:dkksek': 'DKK',
}

const COMMODITY_CLASS: Record<string, 'energy' | 'metal'> = {
  'cmd:brent': 'energy',
  'cmd:wti': 'energy',
  'cmd:gold': 'metal',
  'cmd:silver': 'metal',
}

const BROAD_INDEX = 'idx:sp500'

function dataOf<T>(envelope: Envelope<T>): T | null {
  if (
    envelope.state === 'ok' ||
    envelope.state === 'stale' ||
    envelope.state === 'fixture'
  ) {
    return envelope.data
  }
  if (envelope.state === 'error' && envelope.lastGood) return envelope.lastGood.data
  return null
}

/** The envelope's freshness and the value's nature, folded into the one label the advisor sees. */
function qualityOf(envelope: Envelope<unknown>, provenance: Provenance): MarketQuality {
  if (envelope.state === 'fixture' || provenance.quality === 'fixture') return 'fixture'
  if (envelope.state === 'stale' || envelope.state === 'error') return 'stale'
  if (provenance.quality === 'official-daily' || provenance.quality === 'eod') {
    return 'official-daily'
  }
  if (provenance.isDelayed || provenance.quality === 'delayed') return 'delayed'
  return 'live'
}

function sourceOf(provenance: Provenance): string {
  const { providerName, originator } = provenance.source
  return originator ? `${providerName} (${originator})` : providerName
}

/**
 * The overview snapshot as the advisory domain reads it: one observation
 * per series the V1 pathways know, with provenance kept and nothing
 * fabricated — a series without a comparable prior carries `change: null`
 * and opens no event.
 */
export function marketObservationsFrom(snapshot: OverviewSnapshot): MarketObservation[] {
  const label = (symbol: string): string =>
    (snapshot.instruments as Record<string, { displayName: string } | undefined>)[symbol]
      ?.displayName ?? symbol
  const out: MarketObservation[] = []

  for (const y of dataOf(snapshot.yields) ?? []) {
    out.push({
      symbol: String(y.symbol),
      category: 'rates',
      label: label(String(y.symbol)),
      value: y.yieldPercent,
      change: y.changeBasisPoints ?? null,
      changeUnit: 'bp',
      observedAt: y.provenance.asOf,
      source: sourceOf(y.provenance),
      quality: qualityOf(snapshot.yields, y.provenance),
      tags: { currency: y.currency, tenorMonths: y.tenorMonths },
    })
  }

  const quote = (
    q: MarketQuote,
    envelope: Envelope<MarketQuote[]>,
    category: MarketObservation['category'],
    tags: MarketObservation['tags'],
    reference?: number | null,
  ): MarketObservation => ({
    symbol: String(q.symbol),
    category,
    label: label(String(q.symbol)),
    value: q.value,
    change: q.percentageChange ?? null,
    changeUnit: 'percent',
    ...(reference === undefined ? {} : { reference }),
    observedAt: q.provenance.asOf,
    source: sourceOf(q.provenance),
    quality: qualityOf(envelope, q.provenance),
    tags,
  })

  const indices = dataOf(snapshot.indices) ?? []
  for (const q of indices) {
    const region = INDEX_REGION[String(q.symbol)]
    out.push(quote(q, snapshot.indices, 'equities', region ? { region } : {}))
  }

  const broad =
    indices.find((q) => String(q.symbol) === BROAD_INDEX)?.percentageChange ?? null
  for (const q of dataOf(snapshot.sectors) ?? []) {
    const sector = SECTOR_OF[String(q.symbol)]
    out.push(quote(q, snapshot.sectors, 'sectors', sector ? { sector } : {}, broad))
  }

  for (const q of dataOf(snapshot.fx) ?? []) {
    const currency = FX_CURRENCY[String(q.symbol)]
    out.push(quote(q, snapshot.fx, 'fx', currency ? { currency } : {}))
  }

  for (const q of dataOf(snapshot.commodities) ?? []) {
    const commodityClass = COMMODITY_CLASS[String(q.symbol)]
    out.push(
      quote(
        q,
        snapshot.commodities,
        'commodities',
        commodityClass ? { commodityClass } : {},
      ),
    )
  }

  const sentiment = dataOf(snapshot.sentiment)
  if (sentiment) {
    out.push({
      symbol: 'sentiment:cross-asset',
      category: 'risk-appetite',
      label: 'Cross-Asset Risk Appetite',
      value: sentiment.score,
      change: Math.round((sentiment.score - 50) * 100) / 100,
      changeUnit: 'points',
      observedAt: sentiment.provenance.asOf,
      source: sourceOf(sentiment.provenance),
      quality: qualityOf(snapshot.sentiment, sentiment.provenance),
      tags: {},
    })
  }

  return out
}

/* ------------------------------------------------------------------ events */

/**
 * The ledger after this read: the open events reconciled with what the
 * market reports now, on the advisory clock and the context's materiality
 * policy, and every episode that ended moved to history. A pipeline that
 * did not answer is not a calm market — the open events then survive until
 * they expire, labelled with the freshness they had.
 */
export async function marketLedger(context: AdvisoryContext): Promise<MarketLedgerState> {
  const state = await context.repositories.marketEvents.state()
  let observations: readonly MarketObservation[] = []
  if (context.market) {
    try {
      observations = await context.market.observe()
    } catch {
      observations = []
    }
  }
  const next = reconcileMarketLedger(
    state,
    observations,
    context.clock.isoNow(),
    context.materiality,
  )
  await context.repositories.marketEvents.replace(next)
  return next
}

/** The events that contribute to current urgency — and nothing that has closed. */
export async function activeMarketEvents(
  context: AdvisoryContext,
): Promise<readonly MarketEvent[]> {
  return (await marketLedger(context)).active
}

/* ----------------------------------------------------------------- history */

/**
 * One client-relevant market change in a window: the impact as the record
 * judges it now, and whether the move is still open or already history.
 * A closed change is quoted at its peak; it contributes to no priority.
 */
export interface MarketChangeSince {
  impact: ClientMarketImpact
  status: 'active' | 'closed'
  closedAt: string | null
  closeReason: CloseReason | null
}

/** How far back a briefing looks when the record holds no previous meeting. */
export const MARKET_HISTORY_WINDOW_DAYS = 30

/**
 * The client-relevant market changes that opened on or after `since` (an ISO
 * date), still open or closed, most relevant first and then newest first.
 * Closed events are judged against the record as it stands today — the only
 * exposure the record holds — and never against a reconstructed past.
 */
export function marketChangesSince(
  ledger: MarketLedgerState,
  facts: ClientFacts,
  since: string,
): MarketChangeSince[] {
  const statuses = marketEventsSince(ledger, since)
  /* Assessed per episode, not per key: two episodes of the same key in the window are two changes. */
  const changes: MarketChangeSince[] = []
  for (const s of statuses) {
    const impact = assessClient([s.event], facts)[0]
    if (!impact) continue
    changes.push({
      impact,
      status: s.status,
      closedAt: s.status === 'closed' ? s.event.closedAt : null,
      closeReason: s.status === 'closed' ? s.event.closeReason : null,
    })
  }
  const rank: Record<Relevance, number> = { high: 0, medium: 1, low: 2 }
  return changes.sort(
    (a, b) =>
      rank[a.impact.relevance] - rank[b.impact.relevance] ||
      (a.impact.event.firstSeenAt > b.impact.event.firstSeenAt ? -1 : 1),
  )
}

/** The ISO date a briefing's market window starts: the last meeting, else the standing window. */
export function marketWindowStart(lastMeetingDate: string | null, today: string): string {
  if (lastMeetingDate) return lastMeetingDate
  const start = new Date(`${today}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - MARKET_HISTORY_WINDOW_DAYS)
  return start.toISOString().slice(0, 10)
}

/** True when the window's start lies within the retained history. */
export function windowWithinRetention(since: string, today: string): boolean {
  return daysBetween(since, today) <= 180
}

/* ------------------------------------------------------------------- brief */

export interface AffectedClientSentinel {
  priorityId: string
  theme: SentinelTheme
  severity: SentinelSeverity
  status: PriorityStatus
  /** The priority exists because of this event: nothing else called. */
  anchoredByMarket: boolean
  /** A high-relevance impact lifted the priority from normal to high. */
  strengthenedByMarket: boolean
  /** This event rides beneath the priority as evidence. */
  carriesEvent: boolean
}

export interface AffectedClient {
  client: {
    id: string
    displayName: string
    segment: ClientSegment
    advisorName: string
  }
  impact: ClientMarketImpact
  /** The client's one Sentinel priority as the impacts leave it; null when the record calls for nothing. */
  sentinel: AffectedClientSentinel | null
}

export interface MarketEventEntry {
  event: MarketEvent
  /** Most relevant first. */
  affected: readonly AffectedClient[]
  counts: Record<Relevance, number>
  /** Clients at medium or high relevance — the count a surface shows. */
  meaningful: number
}

export interface MarketImpactBrief {
  /** Every open event, most material first, including those that touch nobody. */
  events: readonly MarketEventEntry[]
  /**
   * The advisor-facing aggregation over the same events: related moves as
   * one episode, unrelated moves alone. Every event above is inside exactly
   * one episode, intact.
   */
  episodes: readonly MarketEpisode[]
  /** Distinct clients with at least one medium or high impact. */
  affectedClients: number
  clientsAssessed: number
  /** The freshest observation behind an open event; null when none is open. */
  observedAt: string | null
  /** The example scenario the observations were shaped by, where one was. */
  scenario: string | null
  today: string
  generatedAt: string
  method: 'market-to-client-v1'
}

export async function marketImpactBrief(
  context: AdvisoryContext,
): Promise<MarketImpactBrief> {
  const { repositories } = context
  const today = todayOf(context)
  const events = await activeMarketEvents(context)
  const clients = await repositories.clients.list()
  const dispositions = await repositories.sentinel.dispositions()
  const byEvent = new Map<string, AffectedClient[]>(events.map((e) => [e.id, []]))
  const affectedIds = new Set<string>()
  let clientsAssessed = 0

  for (const client of clients) {
    const facts = await assembleClientFacts(context, client.id)
    if (!facts) continue
    clientsAssessed += 1
    const impacts = assessClient(events, facts)
    if (impacts.length === 0) continue
    const health = relationshipHealth(facts)
    const priority = prioritiseClient(facts, health, signalsFor(facts, health), impacts)
    const advisor = await repositories.clients.advisorById(client.primaryAdvisorId)
    for (const impact of impacts) {
      if (impact.relevance !== 'low') affectedIds.add(client.id)
      byEvent.get(impact.eventId)?.push({
        client: {
          id: client.id,
          displayName: client.displayName,
          segment: client.segment,
          advisorName: advisor?.displayName ?? client.primaryAdvisorId,
        },
        impact,
        sentinel: priority
          ? {
              priorityId: priority.id,
              theme: priority.theme,
              severity: priority.severity,
              status: statusOf(priority, dispositions, today),
              anchoredByMarket:
                priority.theme === 'market-impact' &&
                priority.primary.kind === 'market' &&
                priority.primary.eventId === impact.eventId,
              strengthenedByMarket: priority.strengthenedByMarket,
              carriesEvent: priority.drivers.some(
                (d) => d.kind === 'market' && d.eventId === impact.eventId,
              ),
            }
          : null,
      })
    }
  }

  const entries: MarketEventEntry[] = events.map((event) => {
    const affected = [...(byEvent.get(event.id) ?? [])].sort(
      (a, b) =>
        compareImpacts(a.impact, b.impact) ||
        a.client.displayName.localeCompare(b.client.displayName, 'sv'),
    )
    const counts: Record<Relevance, number> = { high: 0, medium: 0, low: 0 }
    for (const a of affected) counts[a.impact.relevance] += 1
    return { event, affected, counts, meaningful: counts.high + counts.medium }
  })

  return {
    events: entries,
    episodes: groupMarketEpisodes(entries),
    affectedClients: affectedIds.size,
    clientsAssessed,
    observedAt: events.reduce<string | null>(
      (latest, e) => (latest === null || e.observedAt > latest ? e.observedAt : latest),
      null,
    ),
    scenario: context.market?.scenario ?? null,
    today,
    generatedAt: context.clock.isoNow(),
    method: 'market-to-client-v1',
  }
}
