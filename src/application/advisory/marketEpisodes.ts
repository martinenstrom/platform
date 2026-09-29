/**
 * Market episodes — the advisor-facing aggregation over Market-to-Client's
 * events. Seven touching events in one broad selloff are one story to an
 * advisor, not seven; this layer groups them deterministically, by category,
 * direction, a time window and the few relationships the domain already
 * knows, and never replaces the typed events beneath: every episode carries
 * its `MarketEventEntry`s intact, source evidence included.
 *
 * Nothing here reaches Sentinel. A client's priority is derived from the
 * individual events as before — one priority per client — and an episode
 * only reports what those priorities already are.
 */

import type { Relevance, RelevanceOrNone } from '~/domain/advisory'
import type {
  AffectedClient,
  AffectedClientSentinel,
  ClientMarketImpactView,
  MarketEventEntry,
} from './marketImpact'

export type MarketEpisodeKind =
  | 'global-risk-off'
  | 'equity-selloff'
  | 'equity-rally'
  | 'rates-up'
  | 'rates-down'
  | 'energy-selloff'
  | 'energy-rally'
  | 'sek-weaker'
  | 'sek-stronger'
  /** One event standing on its own: the episode is the event. */
  | 'single'

/** Events group only when their observations fall within this window of each other. */
export const EPISODE_WINDOW_HOURS = 24

/** One client across every event in the episode: the strongest verdict, with every impact kept. */
export interface EpisodeClient {
  client: AffectedClient['client']
  relevance: Relevance
  financialRelevance: RelevanceOrNone
  conversationRelevance: RelevanceOrNone
  /** The client's impacts inside the episode, most relevant first. */
  impacts: readonly ClientMarketImpactView[]
  sentinel: AffectedClientSentinel | null
}

export interface MarketEpisode {
  /** `${kind}:${sorted event ids}` — changes when membership changes, like the aggregate it names. */
  id: string
  kind: MarketEpisodeKind
  direction: 'up' | 'down'
  /** The strongest severity among the events. */
  severity: 'notable' | 'major'
  /** The underlying events, most material first, untouched. */
  events: readonly MarketEventEntry[]
  /** Every client any event touches, most relevant first. */
  affected: readonly EpisodeClient[]
  counts: Record<Relevance, number>
  /** Clients at medium or high relevance. */
  meaningful: number
  /** Clients at high relevance. */
  high: number
  firstSeenAt: string
  observedAt: string
}

const RELEVANCE_RANK: Record<Relevance, number> = { high: 0, medium: 1, low: 2 }
const RELEVANCE_OR_NONE_RANK: Record<RelevanceOrNone, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
}

const stronger = <T extends string>(rank: Record<T, number>, a: T, b: T): T =>
  rank[a] <= rank[b] ? a : b

const isEnergy = (e: MarketEventEntry) =>
  (e.event.category === 'sectors' && e.event.tags.sector === 'energy') ||
  (e.event.category === 'commodities' && e.event.tags.commodityClass === 'energy')

/** A currency-tagged pair is quoted in SEK; up means a weaker krona. */
const isSekPair = (e: MarketEventEntry) =>
  e.event.category === 'fx' && e.event.tags.currency !== undefined

/**
 * Split a candidate group into clusters whose observations lie within the
 * window of the cluster's earliest one. Same day is not enough: a rates
 * event from Monday and one from Wednesday are two episodes.
 */
function withinWindow(entries: readonly MarketEventEntry[]): MarketEventEntry[][] {
  const sorted = [...entries].sort((a, b) =>
    a.event.observedAt < b.event.observedAt
      ? -1
      : a.event.observedAt > b.event.observedAt
        ? 1
        : 0,
  )
  const clusters: MarketEventEntry[][] = []
  for (const entry of sorted) {
    const current = clusters[clusters.length - 1]
    const anchor = current?.[0]
    if (
      current &&
      anchor &&
      new Date(entry.event.observedAt).getTime() -
        new Date(anchor.event.observedAt).getTime() <=
        EPISODE_WINDOW_HOURS * 3_600_000
    ) {
      current.push(entry)
    } else {
      clusters.push([entry])
    }
  }
  return clusters
}

function mergeClients(events: readonly MarketEventEntry[]): EpisodeClient[] {
  const byClient = new Map<string, EpisodeClient>()
  for (const entry of events) {
    for (const a of entry.affected) {
      const existing = byClient.get(a.client.id)
      if (!existing) {
        byClient.set(a.client.id, {
          client: a.client,
          relevance: a.impact.relevance,
          financialRelevance: a.impact.financialRelevance,
          conversationRelevance: a.impact.conversationRelevance,
          impacts: [a.impact],
          sentinel: a.sentinel,
        })
        continue
      }
      byClient.set(a.client.id, {
        ...existing,
        relevance: stronger(RELEVANCE_RANK, existing.relevance, a.impact.relevance),
        financialRelevance: stronger(
          RELEVANCE_OR_NONE_RANK,
          existing.financialRelevance,
          a.impact.financialRelevance,
        ),
        conversationRelevance: stronger(
          RELEVANCE_OR_NONE_RANK,
          existing.conversationRelevance,
          a.impact.conversationRelevance,
        ),
        impacts: [...existing.impacts, a.impact].sort(
          (x, y) =>
            RELEVANCE_RANK[x.relevance] - RELEVANCE_RANK[y.relevance] ||
            y.relevanceScore - x.relevanceScore ||
            (x.id < y.id ? -1 : 1),
        ),
        sentinel: existing.sentinel ?? a.sentinel,
      })
    }
  }
  return [...byClient.values()].sort(
    (a, b) =>
      RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance] ||
      a.client.displayName.localeCompare(b.client.displayName, 'sv'),
  )
}

function episodeOf(
  kind: MarketEpisodeKind,
  direction: 'up' | 'down',
  members: readonly MarketEventEntry[],
): MarketEpisode {
  const events = [...members].sort(
    (a, b) =>
      b.event.magnitude / b.event.thresholds.enter -
        a.event.magnitude / a.event.thresholds.enter ||
      (a.event.id < b.event.id ? -1 : 1),
  )
  const affected = mergeClients(events)
  const counts: Record<Relevance, number> = { high: 0, medium: 0, low: 0 }
  for (const c of affected) counts[c.relevance] += 1
  return {
    id: `${kind}:${events
      .map((e) => e.event.id)
      .sort()
      .join('+')}`,
    kind,
    direction,
    severity: events.some((e) => e.event.severity === 'major') ? 'major' : 'notable',
    events,
    affected,
    counts,
    meaningful: counts.high + counts.medium,
    high: counts.high,
    firstSeenAt: events.reduce(
      (min, e) => (e.event.firstSeenAt < min ? e.event.firstSeenAt : min),
      events[0]!.event.firstSeenAt,
    ),
    observedAt: events.reduce(
      (max, e) => (e.event.observedAt > max ? e.event.observedAt : max),
      events[0]!.event.observedAt,
    ),
  }
}

interface Rule {
  kind: MarketEpisodeKind
  direction: 'up' | 'down'
  matches: (e: MarketEventEntry) => boolean
  /** A group forms only when this holds for the clustered members. */
  forms: (members: readonly MarketEventEntry[]) => boolean
}

/**
 * The relationships an episode may rest on, in precedence. Each event joins
 * the first rule it matches; a rule's cluster becomes an episode only when
 * `forms` holds, otherwise its members fall through to the next rule.
 */
const RULES: readonly Rule[] = [
  {
    /* Broad equity weakness with the cross-asset score in risk-off: one regime, not six moves. */
    kind: 'global-risk-off',
    direction: 'down',
    matches: (e) =>
      e.event.category === 'risk-appetite' ||
      (e.event.category === 'equities' && e.event.direction === 'down'),
    forms: (m) =>
      m.some((e) => e.event.category === 'risk-appetite') &&
      m.some((e) => e.event.category === 'equities'),
  },
  {
    kind: 'equity-selloff',
    direction: 'down',
    matches: (e) => e.event.category === 'equities' && e.event.direction === 'down',
    forms: (m) => m.length >= 2,
  },
  {
    kind: 'equity-rally',
    direction: 'up',
    matches: (e) => e.event.category === 'equities' && e.event.direction === 'up',
    forms: (m) => m.length >= 2,
  },
  {
    kind: 'rates-up',
    direction: 'up',
    matches: (e) => e.event.category === 'rates' && e.event.direction === 'up',
    forms: (m) => m.length >= 2,
  },
  {
    kind: 'rates-down',
    direction: 'down',
    matches: (e) => e.event.category === 'rates' && e.event.direction === 'down',
    forms: (m) => m.length >= 2,
  },
  {
    /* The energy sector against the index and the oil price: one theme. */
    kind: 'energy-selloff',
    direction: 'down',
    matches: (e) => isEnergy(e) && e.event.direction === 'down',
    forms: (m) => m.length >= 2,
  },
  {
    kind: 'energy-rally',
    direction: 'up',
    matches: (e) => isEnergy(e) && e.event.direction === 'up',
    forms: (m) => m.length >= 2,
  },
  {
    kind: 'sek-weaker',
    direction: 'up',
    matches: (e) => isSekPair(e) && e.event.direction === 'up',
    forms: (m) => m.length >= 2,
  },
  {
    kind: 'sek-stronger',
    direction: 'down',
    matches: (e) => isSekPair(e) && e.event.direction === 'down',
    forms: (m) => m.length >= 2,
  },
]

/**
 * The episodes over the open events. Deterministic: the same events in any
 * order give the same episodes. Every event lands in exactly one episode,
 * alone when nothing relates it to another, and no event is dropped.
 */
export function groupMarketEpisodes(
  entries: readonly MarketEventEntry[],
): MarketEpisode[] {
  const episodes: MarketEpisode[] = []
  let remaining = [...entries]

  for (const rule of RULES) {
    const candidates = remaining.filter(rule.matches)
    if (candidates.length === 0) continue
    const grouped = new Set<string>()
    for (const cluster of withinWindow(candidates)) {
      if (!rule.forms(cluster)) continue
      episodes.push(episodeOf(rule.kind, rule.direction, cluster))
      for (const e of cluster) grouped.add(e.event.id)
    }
    remaining = remaining.filter((e) => !grouped.has(e.event.id))
  }

  for (const entry of remaining) {
    episodes.push(episodeOf('single', entry.event.direction, [entry]))
  }

  return episodes.sort(
    (a, b) =>
      b.high - a.high ||
      b.meaningful - a.meaningful ||
      (a.severity === b.severity ? 0 : a.severity === 'major' ? -1 : 1) ||
      b.events.length - a.events.length ||
      (a.id < b.id ? -1 : 1),
  )
}

/**
 * What the dashboard shows: the episodes that touch somebody, at most
 * `limit`. A calm day, or a day whose moves reach nobody, gives an empty
 * list — and no module.
 */
export function dashboardEpisodes(
  episodes: readonly MarketEpisode[],
  limit = 3,
): MarketEpisode[] {
  return episodes.filter((e) => e.meaningful > 0).slice(0, limit)
}
