/**
 * What each control function reads, and nothing more.
 *
 * Ruled 2026-09-17 (third): a governance function receives only what its
 * mandate requires, assembled from the record at dispatch — never the whole
 * case, never the Research Office's rationale as instruction, never a run id
 * it could name in a verdict. Three contexts, one per control act, each
 * built by the same rule the filing commands use to decide what a verdict
 * may speak about (`claimsInScopeOf`): the aggregated revision and the
 * claims its aggregation disposed of.
 *
 *   - **Verification** reads every claim in scope with what it cites: the
 *     observations by id, subject, period and value, from the evidence set
 *     the claim's own run read. It checks claims against citations; it does
 *     not read the argument's rationale.
 *   - **Challenge** (Devil's Advocate) reads the revision — statement,
 *     position, invalidation criterion, implications — and the claims in
 *     scope with their status and confidence, so it can argue against named
 *     claims. It sees the evidence pool only as ids it may cite as counter-
 *     evidence.
 *   - **Peer examination** reads the revision and the claims in scope from
 *     the examining desk's own discipline, and may raise nothing.
 *
 * Reproducible: everything here is read from persisted records; the same
 * record renders the same context. Token-thin: values, not prose; ids the
 * firm gave, not the provider's.
 */

import type {
  AgentClaim,
  DisagreementMateriality,
  EvidenceSet,
  InvestmentThesis,
  ManagerAggregation,
  EvidenceRef,
  InquiryKind,
} from '~/domain/analysis'
import { inquiryKindOf } from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'

export type GovernanceKind = 'verification' | 'devils-advocate' | 'peer-examination'

/** A claim as a control function sees it: identity, words, status, and what it cites. */
export interface ScrutinisedClaim {
  id: string
  byDepartmentId: string
  type: string
  statement: string
  status: string
  confidence: string
  cites: readonly CitedObservation[]
  /**
   * The claim's own citations as the firm stores them — set, observation,
   * the hash it cited — so a control function's finding can be attached to
   * exactly what the claim rested on. The desks' claims are read here, not
   * off the entry's declared inputs, which name only the office (2026-09-18).
   */
  evidenceRefs: readonly EvidenceRef[]
  /** How the aggregation disposed of it — retained, adopted, excluded — so a reviewer knows its standing. */
  disposition: string
}

export interface CitedObservation {
  observationId: string
  subject: string
  kind: string
  referencePeriod: string | null
  observedAt: string
  sourceId: string
  /** The recorded value, rendered as text; a control function compares, it never recomputes. */
  value: string
  /** True when the cited observation is not in the evidence set the run read: a citation to check, not a fact. */
  unresolved: boolean
}

export interface GovernanceContext {
  kind: GovernanceKind
  caseId: string
  question: string
  /**
   * The kind of question the firm is answering, read off the opening
   * revision. A control function's mandate is its own; its judgement is
   * scoped by this: an explanation is scrutinised as an explanation, not as a
   * decision the firm is about to act on (ruled 2026-09-18).
   */
  inquiry: InquiryKind
  revision: {
    id: string
    /** Its number in the lineage — 3 for the successor a correction round produced. */
    revisionNumber: number
    thesisId: string
    statement: string
    position: string
    invalidationCriteria: string
    horizon: string | null
    implications: readonly string[]
    proposedByDepartmentId: string
  }
  /** The claims a verdict may speak about — exactly the aggregation's dispositions. */
  claims: readonly ScrutinisedClaim[]
  /** For a peer examination: the desk being examined, which is the synthesising department. */
  examinedDepartmentId: string | null
  /** The materialities the firm's policy names, so an objection is graded in the firm's words. */
  materialities: readonly DisagreementMateriality[]
}

export interface GovernanceContextInput {
  repositories: Pick<AnalysisRepositories, 'aggregations' | 'claims' | 'runs' | 'evidence' | 'theses'>
  kind: GovernanceKind
  caseId: string
  question: string
  revision: InvestmentThesis
}

const renderValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * The context, read off the record. Returns null when the revision was not
 * produced by an aggregation — there is then nothing in scope to scrutinise,
 * and a control function handed nothing must say so, not invent a scope.
 */
export async function governanceContext(input: GovernanceContextInput): Promise<GovernanceContext | null> {
  const { repositories, kind, caseId, question, revision } = input
  if (!revision.aggregationId) return null
  const aggregation: ManagerAggregation | null = await repositories.aggregations.get(revision.aggregationId)
  if (!aggregation) return null

  const runs = await repositories.runs.listForCase(caseId)
  const inquiry = inquiryKindOf(await repositories.theses.listForCase(caseId), revision.thesisId)
  const evidenceSets = new Map<string, EvidenceSet | null>()
  const setFor = async (setId: string): Promise<EvidenceSet | null> => {
    if (!evidenceSets.has(setId)) evidenceSets.set(setId, await repositories.evidence.get(setId))
    return evidenceSets.get(setId) ?? null
  }

  const claims: ScrutinisedClaim[] = []
  for (const disposition of aggregation.dispositions) {
    const claim: AgentClaim | null = await repositories.claims.get(disposition.claimId)
    if (!claim) continue
    const run = runs.find((candidate) => candidate.id === disposition.runId) ?? null
    const cites: CitedObservation[] = []
    if (kind === 'verification') {
      for (const ref of claim.evidenceRefs) {
        const set = await setFor(ref.setId)
        const item = set?.items.find((entry) => entry.ref.id === ref.observationId) ?? null
        cites.push(
          item
            ? {
                observationId: item.ref.id,
                subject: item.ref.subject,
                kind: item.ref.kind,
                referencePeriod: item.ref.referencePeriod ?? null,
                observedAt: item.ref.observedAt,
                sourceId: item.ref.sourceId,
                value: renderValue(item.value),
                unresolved: false,
              }
            : {
                observationId: ref.observationId,
                subject: '',
                kind: '',
                referencePeriod: null,
                observedAt: '',
                sourceId: '',
                value: '',
                unresolved: true,
              },
        )
      }
    }
    claims.push({
      id: claim.id,
      byDepartmentId: run?.departmentId ?? 'unknown',
      type: claim.type,
      statement: claim.statement,
      status: claim.status,
      confidence: claim.confidence.level,
      cites,
      evidenceRefs: claim.evidenceRefs,
      disposition: disposition.disposition,
    })
  }

  return {
    kind,
    caseId,
    question,
    inquiry,
    revision: {
      id: revision.revisionId,
      revisionNumber: revision.revisionNumber,
      thesisId: revision.thesisId,
      statement: revision.statement,
      position: revision.position,
      invalidationCriteria: revision.invalidationCriteria,
      horizon: revision.horizon ?? null,
      implications: revision.implications,
      proposedByDepartmentId: revision.proposedByDepartmentId,
    },
    claims,
    examinedDepartmentId: kind === 'peer-examination' ? aggregation.departmentId : null,
    materialities: ['non-material', 'material', 'decision-critical'],
  }
}
