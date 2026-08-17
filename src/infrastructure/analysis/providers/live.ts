/**
 * The live contribution provider: a model produces candidate work.
 *
 * The third implementation of a port two others already satisfy, and the rule
 * that makes it cheap still holds — a recorded contribution goes through
 * exactly the same validation, lifecycle, review and gating code this does.
 *
 * ## What the model is and is not trusted with
 *
 * It produces **candidate** claims. Financial OS decides whether they are
 * admissible, and the division is not negotiable:
 *
 * | | produced by |
 * | --- | --- |
 * | statement, claim type, status, which observations it used, horizon, causal attribution | the model |
 * | content hashes, evidence refs, durable claim ids, confidence caps | the firm |
 *
 * The model never sees or supplies a content hash. It names observations by
 * id, and `citeFrom` builds the reference — which also refuses an id that is
 * not in the set, so a hallucinated citation cannot become an `EvidenceRef` at
 * all. There is no second canonicalisation and no second output schema:
 * `AgentClaim` is the contract, and `validateContribution` is the judge.
 *
 * Confidence is a **proposal** the firm may lower and may never raise — see
 * `resolveModelConfidence`.
 */

import {
  citeFrom,
  type AgentClaim,
  type ClaimType,
  type ConfidenceLevel,
  type EvidenceItem,
  type EvidenceSet,
  type ProviderKind,
} from '~/domain/analysis'
import { resolveModelConfidence } from '~/application/analysis/modelConfidence'
import {
  ContributionFailure,
  type ContributionDeclaration,
  type ContributionProvider,
  type ContributionRequest,
  type ContributionResult,
} from '~/application/analysis/contributionPort'
import { stableHashHex } from '~/domain/shared/hash'
import { callModel, type ModelClientConfig, type ModelResponse } from './modelClient'

export const LIVE_PROVIDER_ID = 'live-anthropic'

/**
 * The kind of producer this is, declared once and used by everything.
 *
 * A provider kind is **declared by the provider**, and the guard in
 * `importGraph.test.ts` exists so that exactly one non-test module can say it:
 * a fixture must not be able to enter the record as live work because whoever
 * wired it up passed the wrong string.
 *
 * Named here so callers that need to reason about live work — resolving what
 * the firm authorizes for it, deciding whether a case can take it — refer to
 * this rather than restating the literal. The factory below reads it too, so a
 * caller's idea of what this provider is cannot drift from what it actually
 * reports.
 */
export const LIVE_PROVIDER_KIND: ProviderKind = 'live'

/**
 * The model the firm's live desks run on.
 *
 * Bare id, no date suffix — the first C2-1 attempt invented
 * `claude-opus-4-5-20251101` and the provider answered 404, which the client
 * correctly mapped to `provider-error`.
 *
 * Here rather than at each call site: the model is part of the execution
 * identity that every run records and every audit reads, and two callers naming
 * their own would let two runs of the same workflow be produced by different
 * models with nothing saying so.
 */
export const LIVE_MODEL_ID = 'claude-opus-5'

/**
 * The cap on one answer.
 *
 * Thinking is on by default on this model and shares `max_tokens` with the
 * response text, so a tight cap truncates the JSON mid-answer. This bounds the
 * ANSWER; what bounds the work is the run's token budget, which is resolved
 * from the firm's policy sources and is a different thing entirely.
 */
export const LIVE_MAX_OUTPUT_TOKENS = 4_096

/** The prompt is versioned and content-addressed, like everything else. */
const PROMPT_ID = 'macro-analysis-brief'
const PROMPT_VERSION = '1'

/** The contract the firm asks for and validates against. */
const AGENT_CONTRACT_VERSION = '1'
const OUTPUT_SCHEMA_VERSION = '1'

export interface LiveProviderConfig extends ModelClientConfig {
  model: string
  maxTokens: number
  /**
   * Reads the evidence the run was given.
   *
   * Injected rather than taken from `ContributionRequest`, which carries only
   * an `evidenceSetId`. A live provider genuinely needs the observations —
   * they are what it reasons over — and widening the port would change a
   * contract two other providers already satisfy for the benefit of one.
   */
  loadEvidenceSet: (evidenceSetId: string) => Promise<EvidenceSet | null>
  version?: string
}

/* ------------------------------------------------------------------ prompt */

/**
 * The smallest contract that produces one real analysis claim.
 *
 * Deliberately not a conversational agent protocol: no tools, no turns, no
 * function calling. One request, one JSON answer. Anything more would be
 * designing for a capability C2-1 does not have.
 */
export function renderSystemPrompt(): string {
  return [
    'You are an analyst at an investment firm. You produce candidate claims that',
    'the firm will independently validate. You do not decide what is admissible.',
    '',
    'Answer with JSON only, no prose and no code fences, in exactly this shape:',
    '{"claims":[{"type":"observation","statement":"...","observationIds":["..."],',
    '"status":"supported","confidence":"moderate"}]}',
    '',
    'Rules:',
    '- "type" is one of: observation, comparison, forecast, recommendation.',
    '- "observationIds" MUST be ids from the evidence given to you. Never invent one.',
    '- "status" is one of: supported, partially-supported, insufficient-evidence.',
    '- Use "supported" only when you cite at least one observation.',
    '- "confidence" is one of: insufficient, low, moderate, high. It is a proposal;',
    '  the firm applies its own caps and may lower it.',
    '- A forecast or recommendation MUST also carry "horizon", e.g. "3m".',
    '- State only what the cited observations show. Do not assert mechanisms.',
  ].join('\n')
}

export function renderUserPrompt(brief: string, evidence: EvidenceSet): string {
  const observations = evidence.items.map(
    (item) => `- id: ${item.ref.id}\n  value: ${JSON.stringify(item.value)}`,
  )
  return [`Brief:\n${brief}`, '', `Evidence (${evidence.id}):`, ...observations].join(
    '\n',
  )
}

/* ------------------------------------------------------------------ parsing */

interface CandidateClaim {
  type: ClaimType
  statement: string
  observationIds: readonly string[]
  status: AgentClaim['status']
  confidence: ConfidenceLevel
  horizon?: string
}

const CLAIM_TYPES = ['observation', 'comparison', 'forecast', 'recommendation']
const STATUSES = ['supported', 'partially-supported', 'insufficient-evidence']
const LEVELS = ['insufficient', 'low', 'moderate', 'high']

/**
 * Reads the model's answer.
 *
 * Every field is checked. A sampled producer returns something unexpected
 * eventually, and `malformed-output` is a retryable attempt rather than a
 * defect the firm has to store — which is exactly why the pipeline treats it
 * differently from a schema violation.
 *
 * Deliberately NOT a second schema: this parses into the shape `AgentClaim`
 * already defines, and refuses anything it cannot.
 */
export function parseCandidates(text: string): readonly CandidateClaim[] | null {
  let body: unknown
  try {
    body = JSON.parse(text.trim())
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const claims = (body as { claims?: unknown }).claims
  if (!Array.isArray(claims) || claims.length === 0) return null

  const out: CandidateClaim[] = []
  for (const raw of claims) {
    if (typeof raw !== 'object' || raw === null) return null
    const c = raw as Record<string, unknown>
    if (typeof c.type !== 'string' || !CLAIM_TYPES.includes(c.type)) return null
    if (typeof c.statement !== 'string' || c.statement.trim() === '') return null
    if (typeof c.status !== 'string' || !STATUSES.includes(c.status)) return null
    if (typeof c.confidence !== 'string' || !LEVELS.includes(c.confidence)) return null
    if (!Array.isArray(c.observationIds)) return null
    if (!c.observationIds.every((id) => typeof id === 'string')) return null
    if (c.horizon !== undefined && typeof c.horizon !== 'string') return null

    out.push({
      type: c.type as ClaimType,
      statement: c.statement,
      observationIds: c.observationIds as readonly string[],
      status: c.status as AgentClaim['status'],
      confidence: c.confidence as ConfidenceLevel,
      ...(typeof c.horizon === 'string' ? { horizon: c.horizon } : {}),
    })
  }
  return out
}

/* ------------------------------------------------------------- the provider */

export function createLiveContributionProvider(
  config: LiveProviderConfig,
): ContributionProvider {
  /*
   * What the request actually carries, and nothing else.
   *
   * `parametersHash` is a content address of what shaped the output. Recording
   * `temperature` while the body omits it would make the stored identity
   * describe a call that was never sent — and the whole point of hashing the
   * parameters is that a run cannot misreport what produced it.
   */
  const parameters = { maxTokens: config.maxTokens }

  const declare = (request: ContributionRequest): ContributionDeclaration => ({
    agentContractVersion: AGENT_CONTRACT_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    identity: {
      kind: 'model',
      prompt: {
        id: PROMPT_ID,
        version: PROMPT_VERSION,
        /*
         * The exact instruction, hashed before it is sent. Covers the brief,
         * so "which prompt produced this claim" is answerable years later even
         * though the brief varies per entry.
         */
        contentHash: stableHashHex(`${renderSystemPrompt()}\n\n${request.brief}`),
      },
      model: {
        id: config.model,
        provider: 'anthropic',
        parameters,
        parametersHash: stableHashHex(JSON.stringify(parameters)),
      },
    },
  })

  return {
    id: LIVE_PROVIDER_ID,
    version: config.version ?? '1',
    kind: LIVE_PROVIDER_KIND,
    declare,

    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      const evidence = await config.loadEvidenceSet(request.evidenceSetId)
      if (!evidence) throw new ContributionFailure('evidence-unavailable')

      const outcome = await callModel(
        {
          model: config.model,
          system: renderSystemPrompt(),
          user: renderUserPrompt(request.brief, evidence),
          maxTokens: config.maxTokens,
        },
        config,
        request.signal,
      )
      if (outcome.state === 'failed') throw new ContributionFailure(outcome.category)

      const candidates = parseCandidates(outcome.response.text)
      if (!candidates) throw new ContributionFailure('malformed-output')

      const claims = candidates.map((candidate, index) =>
        toAgentClaim(candidate, index, evidence, request),
      )

      return {
        claims,
        agentContractVersion: AGENT_CONTRACT_VERSION,
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        usage: toRunUsage(outcome.response),
        // A provider reports its own progress. How the work settles is the
        // firm's to record.
        observedStates: ['running'],
      }
    },
  }
}

/**
 * Candidate onto `AgentClaim`.
 *
 * The firm supplies everything that carries institutional weight: the
 * citations with their hashes, and the confidence after capping.
 */
function toAgentClaim(
  candidate: CandidateClaim,
  index: number,
  evidence: EvidenceSet,
  request: ContributionRequest,
): AgentClaim {
  const items: EvidenceItem[] = []
  const evidenceRefs = candidate.observationIds.map((observationId) => {
    const item = evidence.items.find(
      (candidateItem) => candidateItem.ref.id === observationId,
    )
    /*
     * A citation the evidence set does not contain. `citeFrom` would throw, and
     * a thrown error here is an unclassified crash rather than a category the
     * firm can act on — so it is caught and named. A model naming evidence it
     * was not given is malformed output, and malformed output is retryable.
     */
    if (!item) throw new ContributionFailure('malformed-output')
    items.push(item)
    return citeFrom(evidence, item.ref)
  })

  return {
    // Contribution-local only. `RecordContribution` derives the stored id.
    id: `live-${index + 1}`,
    type: candidate.type,
    statement: candidate.statement,
    evidenceRefs,
    contradictingEvidenceRefs: [],
    confidence: resolveModelConfidence(candidate.confidence, candidate.type, items),
    temporalScope: {
      asOf: evidence.assembledAt,
      ...(candidate.horizon ? { horizon: candidate.horizon } : {}),
    },
    status: candidate.status,
    ...(request.revisionId ? { supportsThesisId: request.revisionId } : {}),
  } as AgentClaim
}

/**
 * What it consumed: the truthful combination this provider actually produces.
 *
 * The Messages API reports token counts and **no price**. Migration 0029 is
 * what makes that sayable — tokens `measured`, money `not-reported` — and it
 * exists because this provider proved the two do not arrive together.
 *
 * `costMinorUnits: 0` is deliberately NOT reported. That states the provider
 * said the call was free, which it did not say. And no per-token price is
 * configured here to manufacture one: a derived number in a field the domain
 * treats as a measurement is worse than an honest absence, because nothing
 * downstream could tell the two apart.
 *
 * The consequence that matters: because tokens are measured, a **token budget
 * is enforceable on this provider** — which was the point of separating the
 * states rather than reporting the whole usage as unreported.
 */
function toRunUsage(response: ModelResponse): ContributionResult['usage'] {
  if (!response.usage) {
    // A live call always consumed something; this one reported nothing at all.
    return { state: 'not-reported' }
  }
  return {
    state: 'measured',
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cost: { state: 'not-reported' },
  }
}
