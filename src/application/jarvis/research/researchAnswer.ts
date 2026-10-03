/**
 * The typed answer to a research question: the platform's own numbers
 * where the question is about a move, the claims the evidence supports in
 * authority order, the conflicts, the confidence, and what left the
 * platform to get it. The renderers put it into Swedish; nothing here is a
 * sentence nobody wrote.
 *
 * Order of work, per the brief: firewall → plan → market facts → gather →
 * reconcile → classify. A client reference in the line never reaches the
 * gathering step: the public part is the typed market event, and the
 * reference is handed back for the private layer.
 */

import type { CanonicalSymbol } from '~/domain/market'
import type { NamedClient } from '../advisoryIntent'
import type { JarvisScope } from '../context'
import type { MarketBrief, MarketScope } from '../marketBrief'
import { answerMarketQuery, type MarketAnswer } from '../marketAnswer'
import type { MarketHistorySource } from '../marketHistory'
import type { RetrievalTarget } from '../marketIntent'
import type { MarketQuery } from '../marketQuery'
import type {
  PublicResearchResult,
  ResearchClaim,
  ResearchConfidence,
  ResearchEvidence,
} from './evidence'
import {
  decideLine,
  decomposeHybrid,
  type GuardViolation,
  type PrivateVocabulary,
} from './firewall'
import { gatherEvidence } from './gather'
import type { PublicSearchPort } from './publicSearch'
import { asOfOf, confidenceOf, reconcile } from './reconcile'
import { createResearchCache, type ResearchCache } from './researchCache'
import { planFor, type ResearchPlan } from './researchPlan'
import {
  researchContextAfter,
  type ResearchContext,
  type ResearchQuery,
} from './researchQuery'

export interface ResearchAnswerDeps {
  port: PublicSearchPort | null
  cache?: ResearchCache
  /** The register's names, so the firewall knows what must not leave. */
  vocabulary: () => Promise<PrivateVocabulary>
  market: (scope: MarketScope) => Promise<MarketBrief>
  history: MarketHistorySource | null
  now: () => Date
  log?: (line: string) => void
}

/** One claim the answer rests on, in the order the renderer should use it. */
export interface SupportingClaim {
  evidenceId: string
  claim: ResearchClaim
}

export interface ResearchAnswer {
  query: ResearchQuery
  scope: JarvisScope
  plan: ResearchPlan
  result: PublicResearchResult
  /** The platform's own numbers for the move the question is about; null when the question is not about one. */
  marketFacts: MarketAnswer | null
  /** The claims the answer states, most authoritative first, bounded by depth. */
  support: SupportingClaim[]
  confidence: ResearchConfidence
  asOf: string | null
  /** Nothing public could be reached; the answer rests on `marketFacts` alone. */
  unavailable: boolean
  firewall: {
    lineIncluded: boolean
    withheld: 'record-scope' | 'guard' | null
    violations: GuardViolation[]
  }
  /** A client the line referred to, for the private layer; never part of any public query. */
  clientReference: NamedClient | null
  context: ResearchContext
  generatedAt: string
  method: 'research-answer-v1'
}

const SUPPORT_LIMIT = { quick: 3, deep: 6 } as const

const targetOf = (symbol: CanonicalSymbol): RetrievalTarget =>
  symbol.startsWith('rate:') ? { kind: 'rate', symbol } : { kind: 'quote', symbol }

/** The market tier's own answer for the instruments the question is about, over its period. */
async function marketFactsFor(
  plan: ResearchPlan,
  deps: ResearchAnswerDeps,
): Promise<MarketAnswer | null> {
  if (!plan.marketFacts) return null
  const { symbols, region, period } = plan.marketFacts
  /* The rates today are the brief's own sentence; over a period, every rate is measured like an index, in basis points. */
  const allRates = symbols.every((symbol) => symbol.startsWith('rate:'))
  const query: MarketQuery = {
    kind:
      allRates && period.kind === 'today'
        ? 'MARKET_RATES'
        : region && symbols.length > 1 && !allRates
          ? 'MARKET_REGION_PERFORMANCE'
          : 'MARKET_INDEX_PERFORMANCE',
    symbols,
    region,
    period,
    targets: symbols.map(targetOf),
    explicit: { subject: true, period: true },
    notServed: [],
    thread: symbols,
    method: 'market-query-v1',
  }
  try {
    return await answerMarketQuery(query, {
      brief: deps.market,
      history: deps.history,
      now: deps.now,
    })
  } catch (error) {
    deps.log?.(`research market facts failed: ${String(error)}`)
    return null
  }
}

/** The claims worth stating: official before news, one per source first, the order of discovery within a rank. */
export function supportOf(
  evidence: readonly ResearchEvidence[],
  limit: number,
): SupportingClaim[] {
  /* A claim that is only the source's title is a pointer, not a fact. */
  const statable = (item: ResearchEvidence, claim: ResearchClaim): boolean =>
    claim.text.trim() !== item.title.trim() &&
    !item.title.trim().startsWith(claim.text.trim())
  const ranked = evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.claims.some((claim) => statable(item, claim)))
    .sort((a, b) => a.item.authority - b.item.authority || a.index - b.index)
    .map(({ item }) => item)
  const support: SupportingClaim[] = []
  const seen = new Set<string>()
  /* A near-duplicate — the same sentence quoted by two sources, or cut differently — is stated once. */
  const keyOf = (claim: ResearchClaim) =>
    claim.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .slice(0, 80)
  const take = (item: ResearchEvidence, claim: ResearchClaim) => {
    const key = keyOf(claim)
    if (!statable(item, claim) || seen.has(key) || support.length >= limit) return
    seen.add(key)
    support.push({ evidenceId: item.id, claim })
  }
  for (const item of ranked) {
    const claims = item.claims.filter((claim) => statable(item, claim))
    const best =
      claims.find((claim) => claim.basis === 'retrieved' && claim.figure) ??
      claims.find((claim) => claim.basis === 'retrieved') ??
      claims[0]!
    take(item, best)
  }
  for (const item of ranked) for (const claim of item.claims) take(item, claim)
  return support
}

export async function answerResearchQuery(
  query: ResearchQuery,
  scope: JarvisScope,
  deps: ResearchAnswerDeps,
): Promise<ResearchAnswer> {
  const cache = deps.cache ?? createResearchCache()
  const vocabulary = await deps.vocabulary()
  const hybrid = decomposeHybrid(query.line, vocabulary)
  const decision = decideLine(query.line, scope, vocabulary)
  /* A client in the line: the public part is the typed event only, whatever the scope. */
  const lineAllowed =
    decision.lineAllowed && hybrid.clientReference === null && !hybrid.ambiguous
  const plan = planFor(query, deps.now())

  const [marketFacts, gathered] = await Promise.all([
    marketFactsFor(plan, deps),
    gatherEvidence(plan, query, lineAllowed, {
      port: deps.port,
      cache,
      now: deps.now,
      log: deps.log,
    }),
  ])
  const conflicts = reconcile(gathered.evidence)
  const confidence = gathered.unavailable
    ? 'INSUFFICIENT'
    : confidenceOf(gathered.evidence, conflicts)
  const support = supportOf(gathered.evidence, SUPPORT_LIMIT[query.depth])
  const asOf = asOfOf(gathered.evidence) ?? marketFacts?.generatedAt ?? null
  const missing: string[] = []
  if (gathered.unavailable) missing.push('extern research')
  if (plan.marketFacts && (!marketFacts || marketFacts.items.length === 0))
    missing.push('marknadsdata för perioden')

  const result: PublicResearchResult = {
    queries: gathered.queries,
    answerable: support.length > 0 || (marketFacts?.items.length ?? 0) > 0,
    evidence: gathered.evidence,
    conflicts,
    missingInformation: missing,
    asOf: asOfOf(gathered.evidence),
    confidence,
    unavailable: gathered.unavailable,
    steps: gathered.steps,
  }

  return {
    query,
    scope,
    plan,
    result,
    marketFacts,
    support,
    confidence,
    asOf,
    unavailable: gathered.unavailable !== null,
    firewall: {
      lineIncluded: lineAllowed,
      withheld: !decision.lineAllowed
        ? decision.withheld
        : hybrid.clientReference || hybrid.ambiguous
          ? 'guard'
          : null,
      violations:
        hybrid.clientReference || hybrid.ambiguous
          ? [...new Set<GuardViolation>([...decision.violations, 'client-name'])]
          : decision.violations,
    },
    clientReference: hybrid.clientReference,
    context: researchContextAfter(
      query,
      gathered.evidence.map((item) => item.id),
      asOf,
    ),
    generatedAt: deps.now().toISOString(),
    method: 'research-answer-v1',
  }
}
