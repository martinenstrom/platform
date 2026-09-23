/**
 * The live SYNTHESIS provider: a model writes the Research Office's position.
 *
 * A fourth implementation of the same port, and deliberately a separate one
 * rather than a mode on the claim provider. What it produces is a different
 * artifact answering a different question — not "what does the evidence show"
 * but "what, taking every desk together, is the firm's position" — and the two
 * would have shared a prompt id, a contract version and an output schema
 * version while meaning different things by all three.
 *
 * ## What the model is and is not trusted with
 *
 * | | produced by |
 * | --- | --- |
 * | statement, position, rationale, invalidation criteria, horizon, implications | the model |
 * | what became of each claim, and whether an absent desk mattered | the model |
 * | which run a claim came from, what was required, what is missing | the firm |
 * | the candidate's content hash and institutional basis | the firm |
 *
 * The division is the same one the claim provider draws: judgements from the
 * model, record from the record. A producer that could state which run a claim
 * came from would be stating the record rather than reading it.
 *
 * ## Its output is a CANDIDATE
 *
 * Nothing here is institutional. What comes back is persisted in
 * `produced_syntheses`, outside `thesis_revisions`, until the Research Office
 * principal adopts it by reference through `AggregateManagerConclusion`. A
 * synthesis model must not be able to jump into the institutional thesis any
 * more than a specialist model may jump into institutional claims.
 */

import {
  buildClaim,
  EXPLANATORY_POSITION,
  synthesisPermittedFor,
  type InquiryKind,
  type InvestmentImplication,
} from '~/domain/analysis'
import type { AgentClaim, ProviderKind, SynthesisArtifact } from '~/domain/analysis'
import {
  ContributionFailure,
  type ContributionDeclaration,
  type ContributionProvider,
  type ContributionRequest,
  type ContributionResult,
} from '~/application/analysis/contributionPort'
import type { SynthesisContext } from '~/application/analysis/synthesisContext'
import { stableHashHex } from '~/domain/shared/hash'
import { callModel, type ModelClientConfig, type ModelResponse } from './modelClient'

export const LIVE_SYNTHESIS_PROVIDER_ID = 'live-anthropic-synthesis'
export const LIVE_SYNTHESIS_PROVIDER_KIND: ProviderKind = 'live'

/**
 * The cap on one SYNTHESIS answer, which is not the cap on a desk answer.
 *
 * A desk states what it found and stops. A synthesis must additionally account
 * for **every claim it was given, one disposition each** — so its answer grows
 * with the size of the argument, while a desk's grows with nothing. Reusing the
 * desk's 4,096 was the defect: it is a cap for a different shape of work.
 *
 * Measured 2026-09-11, against the first real two-desk synthesis — 31 accepted
 * claims (17 Macro, 14 Rates), the largest the firm has ever had to reconcile:
 *
 * | cap | stop reason | output tokens | of which thinking | parsed |
 * |---|---|---|---|---|
 * | 4,096 | `max_tokens` | 4,096 | 1,615 | no — truncated mid-string |
 * | 8,192 | `end_turn` | 5,512 | 1,519 | yes — all 31 dispositions |
 * | 8,192 — the institutional run | `end_turn` | 3,925 | — | yes |
 *
 * **The last two rows are the same prompt, and they differ by 1,587 tokens.**
 * Sampling varies, which is the argument against fitting a cap to a
 * measurement: a limit set just above 3,925 would have passed the run that
 * produced it and destroyed the one before. TD-82's point about single-sample
 * calibration applies here with two samples.
 *
 * **8,192 is therefore not fitted to either.** Thinking is on by default on
 * this model and shares `max_tokens` with the response text, so roughly
 * 1,500–1,600 tokens of every answer are spent before a character is written;
 * the remaining headroom is what absorbs both the sampling spread and a larger
 * claim set, and an answer cut off at the cap destroys the whole run rather
 * than shortening it.
 *
 * It stays well inside the 12,000 the firm authorized: the institutional run
 * spent 1,989 input + 3,925 output = **5,914 measured**, and the cap's own
 * worst case is 1,989 + 8,192 = 10,181. What it does narrow is the claim count
 * the budget admits, and `RESEARCH_OFFICE_SYNTHESIS_BUDGET` records that.
 */
export const LIVE_SYNTHESIS_MAX_OUTPUT_TOKENS = 8_192

const PROMPT_ID = 'research-office-synthesis'
const PROMPT_VERSION = '1'
const AGENT_CONTRACT_VERSION = '1'
const OUTPUT_SCHEMA_VERSION = '1'

export interface LiveSynthesisConfig extends ModelClientConfig {
  model: string
  maxTokens: number
  /**
   * The institutional facts the synthesis is assembled around.
   *
   * Injected rather than widened onto `ContributionRequest`, the same way the
   * claim provider takes `loadEvidenceSet`: this provider genuinely needs the
   * record, and changing a port three other providers already satisfy for the
   * benefit of one would be the wrong trade.
   */
  loadContext: (request: ContributionRequest) => Promise<SynthesisContext | null>
  version?: string
}

/* ------------------------------------------------------------------ prompt */

const DISPOSITIONS = [
  'adopted-supporting',
  'adopted-opposing',
  'retained-unresolved',
  'superseded-by-stronger-evidence',
  'excluded-out-of-scope',
  'excluded-methodologically-unsound',
] as const

const POSITIONS = ['buy', 'sell', 'hold', 'avoid', 'no-view'] as const
const MATERIALITIES = ['non-material', 'material', 'decision-critical'] as const
const IMPLICATIONS = [
  'actionable-recommendation',
  'asset-allocation',
  'position-sizing',
  'hedging',
  'leverage',
  'liquidity-impact',
  'portfolio-risk',
  'implementation-path',
] as const

export function renderSynthesisSystemPrompt(): string {
  return [
    'You are the head of the Research Office at an investment firm. Several desks',
    'have contributed accepted claims. Your job is to reconcile them into ONE',
    'position the firm is prepared to be judged on, and to say what became of',
    'every claim you were given.',
    '',
    'What you write is a CANDIDATE. It becomes the firm’s position only if the',
    'Research Office adopts it, unchanged, in a separate act.',
    '',
    'Answer with JSON only, no prose and no code fences, in exactly this shape:',
    '{"reconciliation":["..."],',
    ' "statement":"...","position":"hold","rationale":"...",',
    ' "invalidationCriteria":"...","horizon":"6m","implications":["portfolio-risk"],',
    ' "dispositions":[{"claimId":"...","disposition":"adopted-supporting",',
    '   "explanation":"...","materiality":"material"}],',
    ' "optionalInputs":[{"playbookEntryKey":"...","materiallyRelevant":false,',
    '   "explanation":"..."}]}',
    '',
    'Rules:',
    '- "reconciliation" is the Research Office\u2019s OWN findings about how the',
    '  desks relate — where they agree, where they conflict, what the conflict',
    '  turns on. One short sentence each, at least one. These become the',
    '  office\u2019s recorded claims, which governance may examine like any',
    '  other desk\u2019s. They are about the DESKS, not about the market: you',
    '  have read no evidence of your own, and the firm records them as resting',
    '  on none.',
    `- "position" is one of: ${POSITIONS.join(', ')}.`,
    `- "disposition" is one of: ${DISPOSITIONS.join(', ')}.`,
    `- "implications" are drawn from: ${IMPLICATIONS.join(', ')}. It may be empty.`,
    '- EVERY claim id you are given gets exactly one disposition. Losing a claim',
    '  by leaving it out is the single failure this record exists to prevent.',
    '- A claim that argues against the position is "adopted-opposing" if you',
    '  accept it and disagree, or "retained-unresolved" if the disagreement is',
    '  genuinely open. Never drop it.',
    `- "materiality" is required for "retained-unresolved" and is one of: ${MATERIALITIES.join(', ')}.`,
    '  It is refused on every other disposition.',
    '- "explanation" is required wherever you exercised judgement: every',
    '  exclusion, every supersession, every unresolved disagreement.',
    '- "invalidationCriteria" must state what would make this position WRONG.',
    '  A position that cannot be wrong is a preference.',
    '- For each absent optional perspective you are told about, say in',
    '  "optionalInputs" whether its absence was materially relevant, and why.',
    '- Do not invent claim ids, run ids, or desks. Use only what you are given.',
  ].join('\n')
}

export function renderSynthesisUserPrompt(context: SynthesisContext): string {
  const lines: string[] = [
    `Question: ${context.question}`,
    '',
    ...(context.inquiry === 'explanation'
      ? [
          'This is an EXPLANATION. The person asked why the market moved, not what to do.',
          `"position" MUST be "${EXPLANATORY_POSITION}" and "implications" MUST be []: the firm refuses an`,
          'explanation that manufactures a portfolio judgement. Put the drivers, the competing',
          'interpretations and the uncertainty in "statement", "rationale" and "invalidationCriteria".',
        ]
      : [
          'This is an INVESTMENT JUDGEMENT. State the position the firm is prepared to be judged on',
          'and the implementation implications it carries.',
        ]),
    '',
    'The argument currently on the table:',
    `  ${context.currentStatement}`,
    `  position: ${context.currentPosition}`,
    '',
    'Accepted contributions:',
  ]

  for (const input of context.inputs) {
    lines.push(
      `  [${input.playbookEntryKey}] ${input.departmentId} (${input.requirement})`,
    )
    for (const claimId of input.claimIds) lines.push(`    - ${claimId}`)
  }

  if (context.absentOptionalInputs.length > 0) {
    lines.push('', 'Optional perspectives the firm declared and did not receive:')
    for (const absent of context.absentOptionalInputs) {
      lines.push(`  [${absent.playbookEntryKey}] ${absent.departmentId}`)
    }
  }

  /*
   * A correction round (TD-99, 2026-09-22): the office is told what
   * Verification found against the revision it is replacing, and whose each
   * finding was. The desks named have already contributed corrected claims —
   * they are the accepted contributions above; findings on the office's own
   * claims are the office's to correct here.
   */
  if (context.corrections) {
    lines.push(
      '',
      `CORRECTION ROUND. Verification examined revision ${context.corrections.revisionNumber}`,
      `(${context.corrections.reviewId}) and demanded the corrections below. The desks named have`,
      'since contributed corrected claims — the accepted contributions listed above. Findings on',
      'the Research Office\u2019s own claims are yours to correct in this synthesis. Write the',
      'successor revision so that every finding is addressed: do not restate a figure or a',
      'citation Verification could not confirm, and say in "rationale" what changed and why.',
      'Where the evidence cannot support a corrected claim, the honest successor says so.',
      'The findings below concern claims in the desks’ EARLIER contributions, which the corrected',
      'contributions listed above have replaced. Those earlier claims are quoted for reference only:',
      'give dispositions ONLY to the claim ids listed under "Accepted contributions" — a disposition',
      'for any other id is refused as malformed (measured live, 2026-09-23).',
    )
    for (const finding of context.corrections.findings) {
      lines.push(
        `  - [${finding.departmentId}] "${finding.statement}" (${finding.kind}): ${finding.detail} — required: ${finding.correctionRequired}`,
      )
    }
  }
  return lines.join('\n')
}

/* ----------------------------------------------------------------- parsing */

interface CandidateSynthesis {
  reconciliation: readonly string[]
  statement: string
  position: string
  rationale: string
  invalidationCriteria: string
  horizon?: string
  implications: readonly string[]
  dispositions: readonly {
    claimId: string
    disposition: string
    explanation?: string
    supersededByClaimId?: string
    materiality?: string
  }[]
  optionalInputs: readonly {
    playbookEntryKey: string
    materiallyRelevant: boolean
    explanation?: string
  }[]
}

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

/**
 * Reads the model's answer.
 *
 * Every field is checked, and `null` means malformed rather than empty. A
 * sampled producer eventually returns something unexpected, and a
 * `malformed-output` failure is a retryable attempt rather than a synthesis the
 * firm has to store — which matters far more here than for a claim: half a
 * synthesis is a position with claims silently missing from it.
 */
export function parseSynthesis(raw: string, inquiry: InquiryKind = 'judgement'): CandidateSynthesis | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const body = parsed as Record<string, unknown>

  const reconciliation = body.reconciliation
  if (!Array.isArray(reconciliation) || reconciliation.length === 0) return null
  if (!reconciliation.every(text)) return null

  if (!text(body.statement)) return null
  if (!text(body.position)) return null
  /* An explanation keeps the explanatory position; a judgement takes one of the firm's. */
  if (inquiry === 'explanation' ? body.position !== EXPLANATORY_POSITION : !POSITIONS.includes(body.position as never)) return null
  if (!text(body.rationale)) return null
  if (!text(body.invalidationCriteria)) return null
  if (body.horizon !== undefined && !text(body.horizon)) return null

  const implications = body.implications
  if (!Array.isArray(implications)) return null
  if (!implications.every((item) => IMPLICATIONS.includes(item as never))) return null
  /* The domain's own rule, applied where the answer is read: a judgement nobody asked for is malformed, not routed. */
  if (!synthesisPermittedFor(inquiry, body.position, implications as InvestmentImplication[]).permitted) return null

  const dispositions = body.dispositions
  if (!Array.isArray(dispositions) || dispositions.length === 0) return null
  for (const item of dispositions) {
    if (typeof item !== 'object' || item === null) return null
    const record = item as Record<string, unknown>
    if (!text(record.claimId)) return null
    if (
      !text(record.disposition) ||
      !DISPOSITIONS.includes(record.disposition as never)
    ) {
      return null
    }
    if (record.explanation !== undefined && !text(record.explanation)) return null
    if (record.supersededByClaimId !== undefined && !text(record.supersededByClaimId)) {
      return null
    }
    if (
      record.materiality !== undefined &&
      !MATERIALITIES.includes(record.materiality as never)
    ) {
      return null
    }
  }

  const optionalInputs = body.optionalInputs ?? []
  if (!Array.isArray(optionalInputs)) return null
  for (const item of optionalInputs) {
    if (typeof item !== 'object' || item === null) return null
    const record = item as Record<string, unknown>
    if (!text(record.playbookEntryKey)) return null
    if (typeof record.materiallyRelevant !== 'boolean') return null
    if (record.explanation !== undefined && !text(record.explanation)) return null
  }

  return {
    reconciliation: reconciliation as string[],
    statement: body.statement,
    position: body.position,
    rationale: body.rationale,
    invalidationCriteria: body.invalidationCriteria,
    ...(body.horizon !== undefined ? { horizon: body.horizon as string } : {}),
    implications: implications as string[],
    dispositions: dispositions as CandidateSynthesis['dispositions'],
    optionalInputs: optionalInputs as CandidateSynthesis['optionalInputs'],
  }
}

/* ---------------------------------------------------------------- provider */

export function createLiveSynthesisProvider(
  config: LiveSynthesisConfig,
): ContributionProvider {
  const parameters = { maxTokens: config.maxTokens }

  const declare = (request: ContributionRequest): ContributionDeclaration => ({
    agentContractVersion: AGENT_CONTRACT_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    identity: {
      kind: 'model',
      prompt: {
        id: PROMPT_ID,
        version: PROMPT_VERSION,
        contentHash: stableHashHex(
          `${renderSynthesisSystemPrompt()}\n\n${request.brief}`,
        ),
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
    id: LIVE_SYNTHESIS_PROVIDER_ID,
    version: config.version ?? '1',
    kind: LIVE_SYNTHESIS_PROVIDER_KIND,
    declare,

    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      const context = await config.loadContext(request)
      if (!context) throw new ContributionFailure('evidence-unavailable')

      const outcome = await callModel(
        {
          model: config.model,
          system: renderSynthesisSystemPrompt(),
          user: `${renderSynthesisUserPrompt(context)}\n\nBrief:\n${request.brief}`,
          maxTokens: config.maxTokens,
        },
        config,
        request.signal,
      )
      if (outcome.state === 'failed') throw new ContributionFailure(outcome.category)

      /*
       * Cut off at the answer cap. Reported as the budget it actually is,
       * BEFORE the parser sees it — truncated JSON parses as malformed, and
       * `malformed-output` is retryable, so the firm would otherwise pay for
       * the identical truncation three times and then blame the model's
       * formatting. The first live synthesis did exactly that.
       */
      if (outcome.response.stopReason === 'max_tokens') {
        throw new ContributionFailure('budget-exhausted')
      }

      const candidate = parseSynthesis(outcome.response.text, context.inquiry)
      if (!candidate) throw new ContributionFailure('malformed-output')

      /*
       * Which claims exist, and which run each came from. Read off the record,
       * never off the answer: a disposition naming a claim the firm does not
       * hold is a malformed synthesis, not a synthesis about an unusual claim.
       */
      const runOf = new Map<string, string>()
      for (const input of context.inputs) {
        for (const claimId of input.claimIds) runOf.set(claimId, input.runId)
      }
      if (candidate.dispositions.some((given) => !runOf.has(given.claimId))) {
        throw new ContributionFailure('malformed-output')
      }

      const synthesis: SynthesisArtifact = {
        statement: candidate.statement,
        position: candidate.position,
        rationale: candidate.rationale,
        invalidationCriteria: candidate.invalidationCriteria,
        ...(candidate.horizon !== undefined ? { horizon: candidate.horizon } : {}),
        implications: candidate.implications as SynthesisArtifact['implications'],
        /*
         * Every contribution in view, plus this run — the desk's own claims are
         * part of what the manager reconciles, which is why the Research Office
         * contributes and aggregates as two separate acts.
         *
         * Assembled from the record rather than from the answer. A producer
         * that could name the runs in scope could quietly drop the desk that
         * disagreed, and the whole scope rule exists to make that impossible.
         */
        inputRunIds: [...new Set(context.inputs.map((input) => input.runId))],
        dispositions: candidate.dispositions.map((given) => ({
          claimId: given.claimId,
          disposition: given.disposition as never,
          ...(given.explanation ? { explanation: given.explanation } : {}),
          ...(given.supersededByClaimId
            ? { supersededByClaimId: given.supersededByClaimId }
            : {}),
          ...(given.materiality ? { materiality: given.materiality as never } : {}),
        })),
        /*
         * Availability is a FACT and comes from the record; whether the absence
         * mattered is a judgement and comes from the model. An entry the model
         * said nothing about is still accounted for, as unjudged rather than as
         * absent from the account.
         */
        optionalInputs: context.absentOptionalInputs.map((absent) => {
          const judged = candidate.optionalInputs.find(
            (item) => item.playbookEntryKey === absent.playbookEntryKey,
          )
          return {
            playbookEntryKey: absent.playbookEntryKey,
            availability: 'unavailable-at-aggregation' as const,
            materiallyRelevant: judged?.materiallyRelevant ?? false,
            explanation:
              judged?.explanation ??
              'The Research Office did not say whether this absence mattered.',
          }
        }),
      }

      return {
        /*
         * The Research Office's own findings, so its contribution is a
         * contribution like any other and crosses the same acceptance
         * boundary. The synthesis rides beside them, in the same produced-work
         * transaction — all of it or none of it.
         *
         * Two artifacts rather than one because they answer different
         * questions and are judged separately: the claims are what the office
         * asserts and governance may examine, and the synthesis is the position
         * the office proposes the firm take.
         */
        claims: candidate.reconciliation.map((statement, index) =>
          reconciliationClaim(statement, index, request),
        ),
        agentContractVersion: AGENT_CONTRACT_VERSION,
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        usage: toRunUsage(outcome.response),
        observedStates: ['running'],
        synthesis,
      }
    },
  }
}

/**
 * One Research Office finding, recorded as resting on no evidence.
 *
 * Deliberately uncited and deliberately `insufficient-evidence`. The office
 * read no observations — it read other desks' accepted claims — and a claim
 * that cited the evidence set it never opened would be the epistemic laundering
 * the whole citation model exists to prevent. The firm's confidence cap says
 * the same thing in the vocabulary the record already has.
 */
function reconciliationClaim(
  statement: string,
  index: number,
  request: ContributionRequest,
): AgentClaim {
  return buildClaim({
    /* The provider's own name for it; the firm derives the durable id. */
    id: `${request.assignmentId}-reconciliation-${index + 1}`,
    type: 'observation',
    statement,
    evidenceRefs: [],
    contradictingEvidenceRefs: [],
    confidence: {
      level: 'insufficient',
      basis: ['a reconciliation of accepted desk claims; no evidence was examined'],
      cappedBy: 'no-evidence',
    },
    temporalScope: { asOf: new Date().toISOString() },
    status: 'insufficient-evidence',
  })
}

function toRunUsage(response: ModelResponse): ContributionResult['usage'] {
  /* A live call always consumed something; this one reported nothing at all. */
  if (!response.usage) return { state: 'not-reported' }
  return {
    state: 'measured',
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cost: { state: 'not-reported' },
  }
}
