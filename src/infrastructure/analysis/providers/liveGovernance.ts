/**
 * The control functions' live providers: verification, challenge, peer
 * examination — one model invocation each, under its own prompt, its own
 * context and its own identity.
 *
 * Built in the shape of `liveSynthesis.ts` and for the same reasons. Each
 * provider reads a `GovernanceContext` assembled from the record at
 * dispatch (`application/analysis/governanceContext.ts`), renders it into a
 * prompt that states the control's own contract, asks the model for JSON
 * only, and validates the answer against the firm's vocabulary before it
 * becomes a `GovernanceCandidateOutput`. The orchestrator records that
 * output through `RecordGovernanceCandidate`, whose domain builders decide
 * what a well-formed candidate is — a verdict on claims out of scope, or a
 * Devil's Advocate with nothing to say, is refused there, not here, and
 * the run fails `malformed-output`. Filing is the control function's own
 * principal's act, later, elsewhere.
 *
 * ## What the model never sees
 *
 * A run id, an assignment id, a principal, the Research Office's rationale
 * as an instruction, or the whole case. It sees the revision, the claims in
 * scope with the firm's own ids, and — for verification — what each claim
 * cites, value by value. Independence is the mandate's and the record's;
 * this file only keeps the prompt from undoing it.
 *
 * ## Model diversity
 *
 * Every provider here takes its model from its config. The same vendor may
 * serve every control function today; policy may later require otherwise
 * per function without touching the workflow (TD-97). Nothing here decides.
 */

import { stableHashHex } from '~/domain/shared/hash'
import type {
  DevilsAdvocateCandidateArtifact,
  DisagreementMateriality,
  EvidenceRef,
  FindingSeverity,
  PeerExaminationCandidateArtifact,
  ProposedChallenge,
  ProviderKind,
  VerificationCandidateArtifact,
  VerificationFinding,
  VerificationFindingKind,
  VerificationStatus,
} from '~/domain/analysis'
import type {
  ContributionDeclaration,
  ContributionProvider,
  ContributionRequest,
  ContributionResult,
  GovernanceCandidateOutput,
} from '~/application/analysis/contributionPort'
import { ContributionFailure } from '~/application/analysis/contributionPort'
import type { GovernanceContext, GovernanceKind, ScrutinisedClaim } from '~/application/analysis/governanceContext'
import { callModel, type ModelClientConfig, type ModelResponse } from './modelClient'

export const LIVE_GOVERNANCE_PROVIDER_KIND: ProviderKind = 'live'
/*
 * **8,192 since 2026-09-18, measured.** At 4,096 the first live gold loop
 * through governance (`docs/jarvis-voice-live-proof.md` §14) lost both the
 * Verification and the Devil's Advocate answers to the cap — `budget-exhausted`,
 * the runs `timed-out` — on a revision of 34 accepted claims. Thinking is on
 * by default on this model and shares `max_tokens` with the answer, so a cap
 * fitted to the JSON alone truncates the JSON. The same cure as the desks'
 * and the synthesis's; the v8 budgets are computed against this cap.
 */
export const LIVE_GOVERNANCE_MAX_OUTPUT_TOKENS = 8_192

const AGENT_CONTRACT_VERSION = '1'
const OUTPUT_SCHEMA_VERSION = '1'

const PROVIDER_ID: Record<GovernanceKind, string> = {
  verification: 'live-anthropic-verification',
  'devils-advocate': 'live-anthropic-challenge',
  'peer-examination': 'live-anthropic-peer-examination',
}
const PROMPT_ID: Record<GovernanceKind, string> = {
  verification: 'verification-review',
  'devils-advocate': 'devils-advocate-challenge',
  'peer-examination': 'peer-examination',
}
const PROMPT_VERSION = '1'

const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'verified',
  'verified-with-qualifications',
  'correction-required',
  'unresolved-discrepancy',
  'insufficient-evidence',
  'blocked',
]
const FINDING_KINDS: readonly VerificationFindingKind[] = [
  'value-mismatch',
  'unit-mismatch',
  'currency-mismatch',
  'basis-point-confusion',
  'percentage-point-confusion',
  'calculation-error',
  'unresolved-citation',
  'revised-evidence',
  'stale-evidence',
  'fixture-evidence',
]
const CHALLENGE_KINDS: readonly ProposedChallenge['kind'][] = [
  'alternative-explanation',
  'fragile-assumption',
  'contradicting-evidence',
  'confirmation-bias',
  'groupthink',
  'overconfidence',
  'adverse-scenario',
  'correlation-not-causation',
]
const MATERIALITIES: readonly DisagreementMateriality[] = ['non-material', 'material', 'decision-critical']
const SEVERITIES: readonly FindingSeverity[] = ['advisory', 'material', 'critical']

export interface LiveGovernanceConfig extends ModelClientConfig {
  kind: GovernanceKind
  model: string
  maxTokens: number
  loadContext: (request: ContributionRequest) => Promise<GovernanceContext | null>
  version?: string
}

/* ------------------------------------------------------------ prompts */

export function renderGovernanceSystemPrompt(kind: GovernanceKind): string {
  const common = [
    'Answer with JSON only: no prose, no code fences, no markdown.',
    'Use only the claim ids and observation ids given to you. Never invent an id.',
    'Write free-text fields in the language of the revision statement.',
  ]
  switch (kind) {
    case 'verification':
      return [
        'You are the Verification desk of an investment firm: an independent control function.',
        'You check every factual claim the revision rests on against what the claim itself cites.',
        'You do not judge the argument, the position or the rationale. You compare values, units,',
        'periods, currencies and citations. Record discrepancies; never correct them.',
        '',
        'Shape:',
        '{"status":"verified|verified-with-qualifications|correction-required|unresolved-discrepancy|insufficient-evidence",',
        ' "findings":[{"kind":"value-mismatch|unit-mismatch|currency-mismatch|basis-point-confusion|percentage-point-confusion|calculation-error|unresolved-citation|revised-evidence|stale-evidence|fixture-evidence",',
        '              "claimId":"...","detail":"...","severity":"advisory|material|critical","blocking":true|false,',
        '              "correctionRequired":"...","observationId":"..."}],',
        ' "claimsReviewed":["..."]}',
        '',
        'Rules:',
        '- "claimsReviewed" lists every claim id you examined; examine every claim given.',
        '- A claim that cites nothing and asserts a figure is "unresolved-citation".',
        '- A cited observation marked unresolved is a citation you could not check: "unresolved-citation".',
        '- "verified" only when you found no discrepancy in any claim.',
        '- "correction-required" when a value, unit or period in a claim contradicts what it cites.',
        '- "insufficient-evidence" when the claims rest on too little to check.',
        '- "severity": "critical" when the claim is wrong in a way the revision rests on, "material" when',
        '  it changes the claim, "advisory" otherwise; "blocking" true only for critical or material findings.',
        '- A blocking finding MUST state "correctionRequired": what the desk must do for it to clear. The',
        '  firm refuses a blocker with no exit. Omit it on advisory findings.',
        '- "stale-evidence" and "revised-evidence" MUST name the "observationId" the claim cited; the firm',
        '  records the hash it cited. Use them only for a claim that cites an observation.',
        '- "observationId" is optional and must be one the claim cites.',
        ...common,
      ].join('\n')
    case 'devils-advocate':
      return [
        "You are the Devil's Advocate of an investment firm: an independent control function whose",
        'mandate is to argue against the revision as strongly as the evidence permits. You MUST',
        'raise at least one objection against a named claim; a review with nothing in it is the',
        'control not being performed. Find the assumption the revision cannot survive being wrong',
        'about. Grade each objection honestly: "material" or "decision-critical" only when it would',
        'change the conclusion, "non-material" when it would not. The conclusion is the answer the',
        'firm was asked for: an explanation when the question asks why, a position when it asks',
        'whether to act.',
        '',
        'Shape:',
        '{"challenges":[{"contests":"<claimId>",',
        '                "kind":"alternative-explanation|fragile-assumption|contradicting-evidence|confirmation-bias|groupthink|overconfidence|adverse-scenario|correlation-not-causation",',
        '                "argument":"...","materiality":"non-material|material|decision-critical",',
        '                "wouldBeResolvedBy":"...","counterEvidenceObservationIds":["..."]}]}',
        '',
        'Rules:',
        '- At least one challenge. Each contests exactly one claim id from the list.',
        '- Every challenge states "wouldBeResolvedBy": the observation or fact that would settle it.',
        '- You see the claims and what they cite by id, not the observations themselves, so your',
        '  objections come from reasoning: "kind" is "fragile-assumption" or "overconfidence", and',
        '  "counterEvidenceObservationIds" is empty. Never cite an observation you were not given.',
        '- Omit "contestsThesis".',
        '- Do not restate the revision; argue against it.',
        ...common,
      ].join('\n')
    case 'peer-examination':
      return [
        'You are a qualified peer desk at an investment firm reading a synthesised revision from',
        'your own discipline. Say on the record whether the argument survives your reading.',
        'Challenge any claim you consider materially unsupported, naming the claim; if the',
        'argument survives, return no challenges — that is a legitimate examination.',
        '',
        'Shape:',
        '{"challenges":[{"contests":"<claimId>",',
        '                "kind":"alternative-explanation|fragile-assumption|contradicting-evidence|confirmation-bias|groupthink|overconfidence|adverse-scenario|correlation-not-causation",',
        '                "argument":"...","materiality":"non-material|material|decision-critical",',
        '                "wouldBeResolvedBy":"...","counterEvidenceObservationIds":["..."]}]}',
        '',
        'Rules:',
        '- Zero challenges is a valid answer. Do not manufacture an objection.',
        '- Each challenge contests exactly one claim id from the list.',
        '- Every challenge states "wouldBeResolvedBy": the observation or fact that would settle it.',
        '- You see the claims and what they cite by id, not the observations themselves, so a',
        '  challenge comes from reasoning: "kind" is "fragile-assumption" or "overconfidence", and',
        '  "counterEvidenceObservationIds" is empty. Never cite an observation you were not given.',
        '- Omit "contestsThesis".',
        ...common,
      ].join('\n')
  }
}

function renderClaim(claim: ScrutinisedClaim, withCitations: boolean): string[] {
  const lines = [
    `- claim ${claim.id} [${claim.byDepartmentId}, ${claim.type}, ${claim.status}, confidence ${claim.confidence}, ${claim.disposition}]`,
    `  ${claim.statement}`,
  ]
  if (withCitations) {
    if (claim.cites.length === 0) lines.push('  cites: nothing')
    for (const cited of claim.cites) {
      lines.push(
        cited.unresolved
          ? `  cites ${cited.observationId}: UNRESOLVED (not in the evidence the run read)`
          : `  cites ${cited.observationId}: ${cited.subject} ${cited.kind} ${cited.referencePeriod ?? cited.observedAt} = ${cited.value} (${cited.sourceId})`,
      )
    }
  }
  return lines
}

export function renderGovernanceUserPrompt(context: GovernanceContext): string {
  const lines: string[] = [
    `Question: ${context.question}`,
    '',
    ...(context.inquiry === 'explanation'
      ? [
          'The firm is answering an EXPLANATION: why the market moved. It is not deciding a position,',
          'and no portfolio judgement was asked for. Scrutinise the explanation as an explanation — its',
          'evidence, its reasoning, its competing interpretations. Analytical disagreement (another',
          'plausible driver, unsettled causality, a fragile assumption) is recorded as retained dissent',
          'and shapes the confidence of the explanation; only a factual contradiction backed by',
          'evidence stops it.',
        ]
      : [
          'The firm is answering an INVESTMENT JUDGEMENT: whether and how to act. Scrutinise it as a',
          'decision the firm would be held to.',
        ]),
    '',
    `Revision ${context.revision.id} by ${context.revision.proposedByDepartmentId}:`,
    `  statement: ${context.revision.statement}`,
    `  position: ${context.revision.position}`,
    `  invalidation criteria: ${context.revision.invalidationCriteria}`,
    ...(context.revision.horizon ? [`  horizon: ${context.revision.horizon}`] : []),
    `  implications: ${context.revision.implications.length ? context.revision.implications.join(', ') : 'none (descriptive)'}`,
    '',
    context.kind === 'verification' ? 'Claims in scope, each with what it cites:' : 'Claims in scope:',
  ]
  for (const claim of context.claims) lines.push(...renderClaim(claim, context.kind === 'verification'))
  if (context.kind !== 'verification') {
    const observationIds = [...new Set(context.claims.flatMap((claim) => claim.cites.map((c) => c.observationId)))]
    if (observationIds.length > 0) lines.push('', `Observation ids you may cite as counter-evidence: ${observationIds.join(', ')}`)
  }
  if (context.kind === 'peer-examination' && context.examinedDepartmentId) {
    lines.push('', `You are examining the synthesis of ${context.examinedDepartmentId}.`)
  }
  return lines.join('\n')
}

/* --------------------------------------------------------- the answers */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

/** The evidence reference a claim actually carries for an observation id, or none. */
function refFor(claimId: string, observationId: string, refsByClaim: Map<string, readonly EvidenceRef[]>): EvidenceRef | null {
  const refs = refsByClaim.get(claimId) ?? []
  return refs.find((ref) => ref.observationId === observationId) ?? null
}

function parseVerification(value: unknown, context: GovernanceContext, refsByClaim: Map<string, readonly EvidenceRef[]>): VerificationCandidateArtifact | null {
  if (!isRecord(value)) return null
  const claimIds = new Set(context.claims.map((claim) => claim.id))
  if (typeof value.status !== 'string' || !VERIFICATION_STATUSES.includes(value.status as VerificationStatus)) return null
  if (!Array.isArray(value.findings) || !Array.isArray(value.claimsReviewed)) return null
  const findings: VerificationFinding[] = []
  const reviewed = new Set<string>()
  for (const given of value.findings) {
    if (!isRecord(given)) return null
    if (typeof given.kind !== 'string' || !FINDING_KINDS.includes(given.kind as VerificationFindingKind)) return null
    if (!nonEmpty(given.claimId) || !claimIds.has(given.claimId) || !nonEmpty(given.detail)) return null
    if (typeof given.severity !== 'string' || !SEVERITIES.includes(given.severity as FindingSeverity)) return null
    const severity = given.severity as FindingSeverity
    const evidence = nonEmpty(given.observationId) ? refFor(given.claimId, given.observationId, refsByClaim) : null
    /* Evidence that moved is recorded with the hash the claim cited, which only a named citation carries. */
    const hashBearing = given.kind === 'stale-evidence' || given.kind === 'revised-evidence'
    if (hashBearing && !evidence) return null
    reviewed.add(given.claimId)
    findings.push({
      kind: given.kind as VerificationFindingKind,
      claimId: given.claimId,
      detail: given.detail.trim(),
      severity,
      /* Blocking is the finding's weight, not the model's mood: a critical or material finding blocks. */
      blocking: typeof given.blocking === 'boolean' ? given.blocking && severity !== 'advisory' : severity !== 'advisory',
      /* What would clear it — the domain refuses a blocker without one (measured live, 2026-09-18). */
      ...(nonEmpty(given.correctionRequired) ? { correctionRequired: given.correctionRequired.trim() } : {}),
      ...(evidence ? { evidence } : {}),
      ...(hashBearing && evidence ? { citedContentHash: evidence.contentHash } : {}),
    })
  }
  const claimsReviewed = value.claimsReviewed.filter((id): id is string => nonEmpty(id) && claimIds.has(id))
  /* A claim a finding was made on was examined, whatever the list says: the candidate rule reads it so. */
  return { status: value.status as VerificationStatus, findings, claimsReviewed: [...new Set([...claimsReviewed, ...reviewed])] }
}

function parseChallenges(value: unknown, context: GovernanceContext, refsByClaim: Map<string, readonly EvidenceRef[]>): readonly ProposedChallenge[] | null {
  if (!isRecord(value) || !Array.isArray(value.challenges)) return null
  const claimIds = new Set(context.claims.map((claim) => claim.id))
  const challenges: ProposedChallenge[] = []
  for (const given of value.challenges) {
    if (!isRecord(given)) return null
    if (!nonEmpty(given.contests) || !claimIds.has(given.contests)) return null
    if (typeof given.kind !== 'string' || !CHALLENGE_KINDS.includes(given.kind as ProposedChallenge['kind'])) return null
    if (!nonEmpty(given.argument)) return null
    if (typeof given.materiality !== 'string' || !MATERIALITIES.includes(given.materiality as DisagreementMateriality)) return null
    const counterEvidence: EvidenceRef[] = []
    if (Array.isArray(given.counterEvidenceObservationIds)) {
      for (const id of given.counterEvidenceObservationIds) {
        if (!nonEmpty(id)) continue
        for (const claim of context.claims) {
          const ref = refFor(claim.id, id, refsByClaim)
          if (ref && !counterEvidence.some((existing) => existing.observationId === ref.observationId)) counterEvidence.push(ref)
        }
      }
    }
    challenges.push({
      contests: given.contests,
      contestsThesis: context.revision.thesisId,
      kind: given.kind as ProposedChallenge['kind'],
      argument: given.argument.trim(),
      counterEvidence,
      ...(nonEmpty(given.wouldBeResolvedBy) ? { wouldBeResolvedBy: given.wouldBeResolvedBy.trim() } : {}),
      materiality: given.materiality as DisagreementMateriality,
    })
  }
  return challenges
}

function toRunUsage(response: ModelResponse): ContributionResult['usage'] {
  if (!response.usage) return { state: 'not-reported' }
  return {
    state: 'measured',
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cost: { state: 'not-reported' },
  }
}

/* ------------------------------------------------------------ the port */

export function createLiveGovernanceProvider(config: LiveGovernanceConfig): ContributionProvider {
  const parameters = { maxTokens: config.maxTokens }
  const system = renderGovernanceSystemPrompt(config.kind)

  const declare = (request: ContributionRequest): ContributionDeclaration => ({
    agentContractVersion: AGENT_CONTRACT_VERSION,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    identity: {
      kind: 'model',
      prompt: {
        id: PROMPT_ID[config.kind],
        version: PROMPT_VERSION,
        contentHash: stableHashHex(`${system}\n\n${request.brief}`),
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
    id: PROVIDER_ID[config.kind],
    version: config.version ?? '1',
    kind: LIVE_GOVERNANCE_PROVIDER_KIND,
    declare,
    async contribute(request: ContributionRequest): Promise<ContributionResult> {
      const context = await config.loadContext(request)
      if (!context || context.claims.length === 0) throw new ContributionFailure('evidence-unavailable')
      /*
       * What each claim cites, from the claims the function reads. The entry's
       * declared inputs name only the office's step, so a finding on a desk's
       * claim could never resolve its citation from them (measured live,
       * 2026-09-18); the inputs stay as a fallback for what the context lacks.
       */
      const refsByClaim = new Map<string, readonly EvidenceRef[]>()
      for (const claims of Object.values(request.inputs)) {
        for (const claim of claims) refsByClaim.set(claim.id, claim.evidenceRefs)
      }
      for (const claim of context.claims) refsByClaim.set(claim.id, claim.evidenceRefs)
      const outcome = await callModel(
        {
          model: config.model,
          system,
          user: `${renderGovernanceUserPrompt(context)}\n\nBrief:\n${request.brief}`,
          maxTokens: config.maxTokens,
        },
        config,
        request.signal,
      )
      if (outcome.state === 'failed') throw new ContributionFailure(outcome.category)
      if (outcome.response.stopReason === 'max_tokens') throw new ContributionFailure('budget-exhausted')
      const parsed = parseJson(outcome.response.text)
      let governance: GovernanceCandidateOutput
      if (config.kind === 'verification') {
        const artifact = parseVerification(parsed, context, refsByClaim)
        if (!artifact) throw new ContributionFailure('malformed-output')
        governance = { kind: 'verification', artifact }
      } else {
        const challenges = parseChallenges(parsed, context, refsByClaim)
        if (!challenges) throw new ContributionFailure('malformed-output')
        governance =
          config.kind === 'devils-advocate'
            ? { kind: 'devils-advocate', artifact: { challenges } satisfies DevilsAdvocateCandidateArtifact }
            : {
                kind: 'peer-examination',
                artifact: { challenges } satisfies PeerExaminationCandidateArtifact,
                examinedDepartmentId: context.examinedDepartmentId ?? '',
              }
      }
      return {
        claims: [],
        governance,
        agentContractVersion: AGENT_CONTRACT_VERSION,
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        usage: toRunUsage(outcome.response),
        observedStates: ['running'],
      }
    },
  }
}
