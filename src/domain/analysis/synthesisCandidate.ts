/**
 * A synthesis a model produced and no principal has yet adopted.
 *
 * ## The boundary this exists for
 *
 * A specialist model cannot jump directly into institutional claims: its output
 * lands in the produced-claim store, and a person or an authorised desk agent
 * has to adopt it. A synthesis model must not be able to jump directly into the
 * institutional thesis either. The hierarchy preserves the same boundary, or it
 * does not have one.
 *
 * The Research Office already crossed that boundary for its CLAIMS. This is the
 * other half of what it produces — the statement, the position, the rationale,
 * the implications and the invalidation criteria — held as a candidate until
 * `AggregateManagerConclusion` adopts it.
 *
 * ## Not a generic artifact
 *
 * One department, one act. Nothing here is designed to hold a second kind of
 * produced work, and nothing should be added to it because a third kind
 * appears: the produced-claim store was kept narrow for the same reason, and a
 * table that holds anything guarantees nothing.
 *
 * ## Adoption, not review
 *
 * An adopted candidate means the Research Office stands behind this synthesis
 * as the firm's position. It does not mean the synthesis is right, has been
 * verified, or has survived challenge — those are separate controls performed
 * by other principals, downstream.
 */

import { sha256Hex, utf8ByteLength } from '../shared/sha256'
import type {
  ClaimDisposition,
  ContributionScope,
  DisagreementMateriality,
  OptionalInputAvailability,
} from './aggregation'
import type { InvestmentImplication } from './theses'

/* ------------------------------------------------------------ the artifact */

/**
 * A disposition as PROPOSED, before the institution derives anything from it.
 *
 * Deliberately not `ClaimDispositionRecord`. That record carries `runId`,
 * `escalationRequired` and `downgradedFrom`, all three of which the aggregation
 * command derives from institutional state at adoption — from the run the claim
 * actually came from, from the escalation rule in force, and from the lineage's
 * recorded history. A producer that could state them would be stating
 * conclusions the firm draws rather than work the firm asked for.
 */
export interface ProposedClaimDisposition {
  claimId: string
  disposition: ClaimDisposition
  explanation?: string
  supersededByClaimId?: string
  /** Required by `retained-unresolved`, refused everywhere else. */
  materiality?: DisagreementMateriality
}

/** An optional perspective, accounted for as the producer found it. */
export interface ProposedOptionalInput {
  playbookEntryKey: string
  availability: OptionalInputAvailability
  scope?: ContributionScope
  materiallyRelevant: boolean
  explanation?: string
}

/** What the model wrote. Exactly the existing synthesis contract. */
export interface SynthesisArtifact {
  statement: string
  position: string
  rationale: string
  invalidationCriteria: string
  /** Absent is absent: a synthesis with no stated horizon has none. */
  horizon?: string
  implications: readonly InvestmentImplication[]
  inputRunIds: readonly string[]
  dispositions: readonly ProposedClaimDisposition[]
  optionalInputs: readonly ProposedOptionalInput[]
}

/**
 * The institutional inputs the synthesis was allowed to reason over.
 *
 * `observedCompletedRunIds` is the whole point. It is the exact run universe
 * the adoption command itself consults — every completed run on the case —
 * captured at production time. Adoption recomputes it and refuses on
 * inequality, so a candidate produced before a new contribution was accepted
 * cannot silently become the institution's conclusion for the state that
 * followed it.
 *
 * A timestamp would not do this. "Produced two minutes ago" says nothing about
 * whether the inputs moved.
 */
export interface SynthesisBasis {
  caseId: string
  sourceRevisionId: string
  playbookId: string
  playbookVersion: string
  observedCompletedRunIds: readonly string[]
}

/** A produced synthesis as stored: artifact, basis, and its content identity. */
export interface ProducedSynthesis {
  /** The run that produced it. One run, one synthesis. */
  runId: string
  caseId: string
  artifact: SynthesisArtifact
  basis: SynthesisBasis
  contentHash: string
  canonicalizationVersion: string
  producedAt: string
}

/* ------------------------------------------------------- canonicalization */

/**
 * Canonicalization version 1 for a synthesis candidate.
 *
 * Its own format, deliberately. Command-payload canonicalization exists and
 * would have been quicker to reuse, but it canonicalises a DELIVERY ENVELOPE
 * for idempotency and this canonicalises an institutional artifact for content
 * identity. Sharing an encoder would mean a change made for one reason silently
 * re-versioned the other, and the two would have to move together forever.
 */
export const SYNTHESIS_CANONICALIZATION_VERSION = 1

/**
 * Separates this digest from every other digest in the system.
 *
 * Without it the same bytes produced for another purpose would hash identically
 * and could be presented as a synthesis candidate. The version is also the
 * first element of the encoding, so a cross-version collision is impossible
 * twice over.
 */
export const SYNTHESIS_DOMAIN_SEPARATION =
  `financial-os:synthesis-candidate:v${SYNTHESIS_CANONICALIZATION_VERSION}|`

/**
 * Where every member of the candidate goes, and why.
 *
 * A field the digest does not bind is a field an editor can change without the
 * digest objecting. `synthesisCandidate.test.ts` reads the members out of the
 * types and requires each to appear here exactly once, so a field added next
 * year fails the build until somebody decides, in writing, whether the digest
 * covers it.
 */
export const SYNTHESIS_FIELD_DISPOSITION = {
  artifact: {
    included: [
      'statement',
      'position',
      'rationale',
      'invalidationCriteria',
      'horizon',
      'implications',
      'inputRunIds',
      'dispositions',
      'optionalInputs',
    ],
    excluded: {},
  },
  basis: {
    included: [
      'caseId',
      'sourceRevisionId',
      'playbookId',
      'playbookVersion',
      'observedCompletedRunIds',
    ],
    excluded: {},
  },
  record: {
    included: ['runId'],
    excluded: {
      caseId:
        'Bound through the basis, which carries the same value. Binding it ' +
        'twice would let the two disagree and still hash.',
      artifact: 'Bound field by field, above.',
      basis: 'Bound field by field, above.',
      contentHash:
        'The digest cannot attest itself. Binding a digest over a structure ' +
        'containing that digest has no fixed point.',
      canonicalizationVersion:
        'Emitted as the first element of the encoding rather than read from ' +
        'the record, so a record claiming one version and encoded under ' +
        'another cannot hash as though it were consistent.',
      producedAt:
        'Deliberately unbound. Two runs of the same model over the same ' +
        'institutional basis producing the same synthesis are the same ' +
        'candidate, and a clock reading is not part of what was concluded.',
    },
  },
} as const

/* ------------------------------------------------------------- primitives */

/*
 * Length-prefixed and self-describing, so no separator can be forged by content
 * and no field order has to be sorted at runtime:
 *
 *   string   `s` <utf8ByteLength> `:` <utf8 bytes>
 *   absent   `a`          — distinct from an empty string, deliberately
 *   boolean  `b0` / `b1`
 *   integer  `i` <decimal>
 *   list     `l` <count> `:` <encoded elements, concatenated>
 *
 * Fields appear in a fixed order. Nothing is sorted by key, so there is no
 * comparator to disagree about. Set-like collections are sorted by UTF-16 code
 * unit, the same order `COLLATE "C"` uses.
 */
const str = (value: string) => `s${utf8ByteLength(value)}:${value}`
const ABSENT = 'a'
const optional = (value: string | undefined) =>
  value === undefined ? ABSENT : str(value)
const bool = (value: boolean) => (value ? 'b1' : 'b0')
const list = (values: readonly string[]) => `l${values.length}:${values.join('')}`
const int = (value: number) => `i${value}`

/** UTF-16 code unit order. Never `localeCompare`. */
const codeUnitOrder = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

/**
 * The exact bytes the digest is taken over, before the domain prefix.
 *
 * Order is fixed here and nowhere else. Two identical paragraphs produced
 * against different institutional inputs encode differently, because the basis
 * sits inside the same rendering as the prose — which is the property the whole
 * candidate model depends on.
 */
export function canonicalSynthesisInput(
  runId: string,
  artifact: SynthesisArtifact,
  basis: SynthesisBasis,
): string {
  const parts: string[] = [
    // 1 — the shape itself, so a v2 rendering can never collide with a v1 one
    int(SYNTHESIS_CANONICALIZATION_VERSION),

    // 2 — which run produced it
    str(runId),

    // 3 — the institutional basis it was produced against
    str(basis.caseId),
    str(basis.sourceRevisionId),
    str(basis.playbookId),
    str(basis.playbookVersion),
    list([...basis.observedCompletedRunIds].sort(codeUnitOrder).map(str)),

    // 4 — the position
    str(artifact.statement),
    str(artifact.position),
    str(artifact.rationale),
    str(artifact.invalidationCriteria),
    optional(artifact.horizon),

    /*
     * Implications and input runs are sorted: the firm's position does not
     * depend on the order a producer happened to emit them, and two renderings
     * that differ only by ordering are the same synthesis.
     */
    list([...artifact.implications].sort(codeUnitOrder).map(str)),
    list([...artifact.inputRunIds].sort(codeUnitOrder).map(str)),

    // 5 — what became of every claim in scope
    list(
      [...artifact.dispositions]
        .sort((left, right) => codeUnitOrder(left.claimId, right.claimId))
        .map((disposition) =>
          list([
            str(disposition.claimId),
            str(disposition.disposition),
            optional(disposition.explanation),
            optional(disposition.supersededByClaimId),
            optional(disposition.materiality),
          ]),
        ),
    ),

    // 6 — and every optional perspective, present or absent
    list(
      [...artifact.optionalInputs]
        .sort((left, right) =>
          codeUnitOrder(left.playbookEntryKey, right.playbookEntryKey),
        )
        .map((record) =>
          list([
            str(record.playbookEntryKey),
            str(record.availability),
            optional(record.scope),
            bool(record.materiallyRelevant),
            optional(record.explanation),
          ]),
        ),
    ),
  ]
  return parts.join('')
}

/** The content identity of a candidate: lowercase 64-character hex. */
export function synthesisContentHash(
  runId: string,
  artifact: SynthesisArtifact,
  basis: SynthesisBasis,
): string {
  return sha256Hex(
    SYNTHESIS_DOMAIN_SEPARATION + canonicalSynthesisInput(runId, artifact, basis),
  )
}

/**
 * Builds a candidate and computes its identity in the same call.
 *
 * One construction path, so a stored candidate whose hash was computed over
 * something other than its own contents is not reachable.
 */
export function buildProducedSynthesis(input: {
  runId: string
  artifact: SynthesisArtifact
  basis: SynthesisBasis
  producedAt: string
}): ProducedSynthesis {
  if (input.basis.caseId.trim() === '') {
    throw new Error('A synthesis candidate must name the case it belongs to')
  }
  for (const [field, value] of [
    ['statement', input.artifact.statement],
    ['position', input.artifact.position],
    ['rationale', input.artifact.rationale],
    ['invalidationCriteria', input.artifact.invalidationCriteria],
  ] as const) {
    if (value.trim() === '') {
      throw new Error(
        `A synthesis candidate states no ${field}. A position the firm cannot ` +
          `read is not a position it can adopt.`,
      )
    }
  }
  if (input.artifact.horizon !== undefined && input.artifact.horizon.trim() === '') {
    throw new Error(
      'A synthesis candidate carries an empty horizon. A stated horizon is ' +
        'stated; an absent one is absent.',
    )
  }

  return Object.freeze({
    runId: input.runId,
    caseId: input.basis.caseId,
    artifact: Object.freeze({ ...input.artifact }),
    basis: Object.freeze({ ...input.basis }),
    contentHash: synthesisContentHash(input.runId, input.artifact, input.basis),
    canonicalizationVersion: String(SYNTHESIS_CANONICALIZATION_VERSION),
    producedAt: input.producedAt,
  })
}

/**
 * Whether a stored candidate still hashes to what it says it does.
 *
 * Corruption-evident, not tamper-proof — the same limitation the eligibility
 * basis manifest carries, and for the same reason: nothing stored beside the
 * data survives an informed writer who updates both. It catches the writer that
 * did not.
 */
export function synthesisHashMatches(candidate: ProducedSynthesis): boolean {
  if (
    candidate.canonicalizationVersion !== String(SYNTHESIS_CANONICALIZATION_VERSION)
  ) {
    return false
  }
  return (
    candidate.contentHash ===
    synthesisContentHash(candidate.runId, candidate.artifact, candidate.basis)
  )
}
