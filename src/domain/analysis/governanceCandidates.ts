/**
 * Governance control acts a model produced and no principal has yet filed.
 *
 * ## The boundary this exists for
 *
 * The firm has established the same rule twice. A specialist model cannot jump
 * directly into institutional claims — its output lands in the produced-claim
 * store and an authorised principal adopts it. A synthesis model cannot jump
 * directly into the institutional thesis — its output lands in
 * `produced_syntheses` and `AggregateManagerConclusion` adopts it.
 *
 * **Governance must not become the exception.** A model's verdict, finding or
 * objection must not jump directly into `reviews`, `verification_findings`,
 * `challenges`, or into a thesis lifecycle transition. A model may produce a
 * candidate control act; a named, authorised, independent institutional
 * principal then files that exact candidate through the governance command it
 * was always filed through.
 *
 * Measured before it was designed: as of 2026-09-11 nothing was leaking, because
 * no provider could produce a verdict or a challenge at all. This closes the
 * boundary **before** the producer exists, rather than after.
 *
 * ## Three contracts, not one
 *
 * A verification finding, a Devil's Advocate objection and a peer examination
 * are not analytical claims, and they are not each other. They are not forced
 * into `produced_claims` to reuse machinery, and there is deliberately no
 * generic produced-artifact store: a table that holds anything guarantees
 * nothing, which is the reason the produced-claim store was kept narrow and the
 * reason `synthesisCandidate` refuses to hold a second kind of work.
 *
 * So each function gets its own artifact type, its own invariants, its own
 * canonicalization version and its own domain separation. A Verification
 * candidate and a Devil's Advocate candidate carrying byte-identical content
 * have different identities, and nothing downstream has to guess which it is
 * looking at.
 *
 * ## Filing is the adoption act — there is no second approval
 *
 * No `AcceptVerificationCandidate` exists, and none should. The institutional
 * commands that already record these acts — `RecordVerificationReview`,
 * `RecordDevilsAdvocateReview`, `RecordPeerExamination` — become the adoption
 * boundary: an agent actor supplies a candidate reference and nothing else, the
 * command loads the candidate from storage, and the principal filing it is
 * accountable for it. One candidate boundary, one institutional act, exactly as
 * the Research Office synthesis proved.
 *
 * ## What a candidate is NOT
 *
 * An unfiled candidate is durable, inspectable and attributable to its run — and
 * it is **not institutional**. Producing a Verification candidate does not
 * satisfy Verification. Producing a Devil's Advocate candidate does not satisfy
 * the challenge mandate. Producing a peer candidate does not satisfy peer
 * scrutiny. Eligibility reads institutional reviews and challenges, never these.
 *
 * ## The encoders are duplicated on purpose
 *
 * The primitives below are the same shape as `synthesisCandidate`'s and are
 * deliberately not imported from it. Sharing an encoder would mean a change made
 * for one artifact silently re-versioned another, and the two would then have to
 * move together forever — the reason that module states for not reusing
 * command-payload canonicalization. Within governance they ARE shared between
 * the three contracts, and each contract pins its own golden vectors, so a
 * primitive that changes breaks all three loudly rather than quietly.
 */

import { sha256Hex, utf8ByteLength } from '../shared/sha256'
import type { EvidenceRef } from './identity'
import {
  buildChallenge,
  buildVerificationFinding,
  type Challenge,
  type VerificationFinding,
  type VerificationStatus,
} from './review'

/* ----------------------------------------------------------------- the basis */

/**
 * The institutional state a governance candidate was produced against.
 *
 * `observedClaimIds` is the load-bearing member, and it is the direct analogue
 * of the synthesis basis's `observedCompletedRunIds`: the exact universe of
 * claims the control function could see when it worked. Filing recomputes it
 * and refuses on inequality, so a verdict produced before a claim was accepted
 * cannot be filed against the state that followed it.
 *
 * **A timestamp would not do this.** "Produced two minutes ago" says nothing
 * about whether the work under review moved, and governance is the layer where
 * stale scrutiny is most dangerous: prose that still reads plausibly is exactly
 * what a stale challenge looks like.
 *
 * The evidence basis is bound transitively and deliberately not separately. An
 * institutional claim is immutable and carries its own evidence references and
 * content hashes, so pinning the claim set pins what those claims cited. A
 * second copy of the citation basis here would be a second thing to keep in
 * step, and a divergence between them would be silent.
 */
export interface GovernanceCandidateBasis {
  caseId: string
  /** The lineage, kept beside the revision so ownership stays checkable. */
  thesisId: string
  /** The exact immutable revision under review. Never the lineage's latest. */
  sourceRevisionId: string
  playbookId: string
  playbookVersion: string
  /** Which entry authorised this scrutiny, so the act and the workflow agree. */
  playbookEntryKey: string
  /** Every claim in scope when the candidate was produced. */
  observedClaimIds: readonly string[]
}

/**
 * A peer examination's basis, which additionally names whose work was examined.
 *
 * Institutional fact, not producer judgement: which desk is under examination
 * follows from the playbook and the assignment, and a producer that could name
 * it could quietly examine a desk nobody asked it to. It sits in the basis for
 * the same reason the revision does.
 */
export interface PeerExaminationCandidateBasis extends GovernanceCandidateBasis {
  examinedDepartmentId: string
}

/* -------------------------------------------------------------- the artifacts */

/**
 * A challenge as PROPOSED, before the institution derives anything from it.
 *
 * Deliberately not `Challenge`. Three of that record's members are the firm's to
 * state and not a producer's: `id` is derived from the filing command, and
 * `challengerKind` and `byDepartmentId` come from the principal who files it —
 * which is precisely what stops a model from filing an objection as a mandate it
 * does not hold. `resolvedBy` is excluded too: a producer files an open
 * objection and does not get to record who settled it.
 *
 * `materiality` IS proposed here. It becomes the filing function's accountable
 * judgement at adoption — it is not a deterministic fact, and it is not the
 * eligibility threshold. What materiality BLOCKS remains the eligibility
 * policy's to decide (`challengeBlocksAtOrAbove`), and that ownership split is
 * preserved rather than merged.
 */
export type ProposedChallenge = Omit<
  Challenge,
  'id' | 'challengerKind' | 'byDepartmentId' | 'resolvedBy'
>

/**
 * A proposed Verification verdict.
 *
 * Every member of `VerificationFinding` is the verifier's own work — the kind,
 * the claim, the detail, the measured values, the methodology, what would clear
 * it — so there is nothing for a candidate to strip, and the institutional type
 * is reused rather than copied. A parallel `ProposedVerificationFinding` would
 * be ten fields to keep in step for no invariant.
 *
 * `status` is a PROPOSAL. The model may propose `verified`; only the Verification
 * function may institutionalise it, and only filing moves the revision's
 * lifecycle. A candidate changes no lifecycle state.
 */
export interface VerificationCandidateArtifact {
  status: VerificationStatus
  findings: readonly VerificationFinding[]
  /** Claims explicitly checked, so an unchecked claim reads as unchecked. */
  claimsReviewed: readonly string[]
}

/**
 * A proposed Devil's Advocate filing.
 *
 * Challenges only. The Devil's Advocate review carries no status and no detail
 * of its own — its output IS its objections, which is why migration 0036 records
 * a NULL status for it. A candidate with no objections is refused at
 * construction: the institutional command already refuses an empty submission,
 * because a Devil's Advocate that filed nothing did not perform the control.
 */
export interface DevilsAdvocateCandidateArtifact {
  challenges: readonly ProposedChallenge[]
}

/**
 * A proposed peer examination.
 *
 * Structurally the same content as a Devil's Advocate filing and a different act,
 * which is why it is a different type with a different digest domain. The
 * difference that matters is the invariant: **a peer may examine and object to
 * nothing.** An examination that raised no objection is scrutiny that happened,
 * and it is not the same fact as an examination that never happened — the
 * eligibility gate reads the existence of the examination, not its emptiness.
 */
export interface PeerExaminationCandidateArtifact {
  challenges: readonly ProposedChallenge[]
}

/* ---------------------------------------------------------------- the records */

/** A produced Verification verdict as stored: artifact, basis, and identity. */
export interface ProducedVerificationReview {
  /** The run that produced it. One run, one candidate. */
  runId: string
  caseId: string
  artifact: VerificationCandidateArtifact
  basis: GovernanceCandidateBasis
  contentHash: string
  canonicalizationVersion: string
  producedAt: string
}

/** A produced Devil's Advocate filing as stored. */
export interface ProducedDevilsAdvocateReview {
  runId: string
  caseId: string
  artifact: DevilsAdvocateCandidateArtifact
  basis: GovernanceCandidateBasis
  contentHash: string
  canonicalizationVersion: string
  producedAt: string
}

/** A produced peer examination as stored. */
export interface ProducedPeerExamination {
  runId: string
  caseId: string
  artifact: PeerExaminationCandidateArtifact
  basis: PeerExaminationCandidateBasis
  contentHash: string
  canonicalizationVersion: string
  producedAt: string
}

/* --------------------------------------------------------- canonicalization */

export const VERIFICATION_CANDIDATE_CANONICALIZATION_VERSION = 1
export const DEVILS_ADVOCATE_CANDIDATE_CANONICALIZATION_VERSION = 1
export const PEER_EXAMINATION_CANDIDATE_CANONICALIZATION_VERSION = 1

/**
 * One domain separation per act, so identical bytes cannot be presented as a
 * different control act.
 *
 * Without these, a Devil's Advocate candidate and a peer examination carrying
 * the same objections would hash identically, and a peer's zero-objection
 * examination would be indistinguishable from a Devil's Advocate filing that is
 * not permitted to be empty. The version is also the first element of every
 * encoding, so a cross-version collision is impossible twice over.
 */
export const VERIFICATION_CANDIDATE_DOMAIN_SEPARATION = `financial-os:verification-candidate:v${VERIFICATION_CANDIDATE_CANONICALIZATION_VERSION}|`
export const DEVILS_ADVOCATE_CANDIDATE_DOMAIN_SEPARATION = `financial-os:devils-advocate-candidate:v${DEVILS_ADVOCATE_CANDIDATE_CANONICALIZATION_VERSION}|`
export const PEER_EXAMINATION_CANDIDATE_DOMAIN_SEPARATION = `financial-os:peer-examination-candidate:v${PEER_EXAMINATION_CANDIDATE_CANONICALIZATION_VERSION}|`

/**
 * Where every member of every candidate type goes, and why.
 *
 * A field the digest does not bind is a field an editor can change without the
 * digest objecting — silently, and in the direction that makes a stale candidate
 * look filable. `governanceCandidates.test.ts` reads the members out of the
 * types themselves and requires each to appear here exactly once, so a field
 * added next year fails the build until somebody decides, in writing, whether
 * the digest covers it.
 */
export const GOVERNANCE_CANDIDATE_FIELD_DISPOSITION = {
  basis: {
    included: [
      'caseId',
      'thesisId',
      'sourceRevisionId',
      'playbookId',
      'playbookVersion',
      'playbookEntryKey',
      'observedClaimIds',
    ],
    excluded: {},
  },
  peerBasis: {
    included: ['examinedDepartmentId'],
    excluded: {},
  },
  verificationArtifact: {
    included: ['status', 'findings', 'claimsReviewed'],
    excluded: {},
  },
  devilsAdvocateArtifact: {
    included: ['challenges'],
    excluded: {},
  },
  peerExaminationArtifact: {
    included: ['challenges'],
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
        'institutional basis reaching the same verdict are the same candidate, ' +
        'and a clock reading is not part of what was concluded. Staleness is ' +
        'caught by the basis, never by a timestamp.',
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

/** An evidence reference, bound by the three things that identify one. */
const evidenceRef = (ref: EvidenceRef) =>
  list([str(ref.setId), str(ref.observationId), str(ref.contentHash)])

/**
 * The basis, rendered once for all three acts.
 *
 * Shared between the governance contracts deliberately: they are produced
 * against the same kind of institutional state, and three copies of this would
 * be three chances for one of them to stop binding the revision.
 */
function canonicalBasis(basis: GovernanceCandidateBasis): readonly string[] {
  return [
    str(basis.caseId),
    str(basis.thesisId),
    str(basis.sourceRevisionId),
    str(basis.playbookId),
    str(basis.playbookVersion),
    str(basis.playbookEntryKey),
    list([...basis.observedClaimIds].sort(codeUnitOrder).map(str)),
  ]
}

/**
 * Objections, rendered in an order the producer does not control.
 *
 * Sorted by the claim contested and then by the argument, so two renderings
 * that differ only by emission order are the same filing. A challenge's
 * counter-evidence is sorted for the same reason.
 */
function canonicalChallenges(challenges: readonly ProposedChallenge[]): string {
  return list(
    [...challenges]
      .sort(
        (left, right) =>
          codeUnitOrder(left.contests, right.contests) ||
          codeUnitOrder(left.argument, right.argument),
      )
      .map((challenge) =>
        list([
          str(challenge.contests),
          optional(challenge.contestsThesis),
          str(challenge.kind),
          str(challenge.argument),
          list(
            [...challenge.counterEvidence]
              .sort((left, right) =>
                codeUnitOrder(
                  `${left.setId}|${left.observationId}|${left.contentHash}`,
                  `${right.setId}|${right.observationId}|${right.contentHash}`,
                ),
              )
              .map(evidenceRef),
          ),
          optional(challenge.wouldBeResolvedBy),
          str(challenge.materiality),
        ]),
      ),
  )
}

/** Findings, ordered by the claim they concern and then by their kind. */
function canonicalFindings(findings: readonly VerificationFinding[]): string {
  return list(
    [...findings]
      .sort(
        (left, right) =>
          codeUnitOrder(left.claimId, right.claimId) ||
          codeUnitOrder(left.kind, right.kind) ||
          codeUnitOrder(left.detail, right.detail),
      )
      .map((finding) =>
        list([
          str(finding.kind),
          str(finding.claimId),
          str(finding.detail),
          finding.evidence === undefined ? ABSENT : evidenceRef(finding.evidence),
          optional(finding.citedContentHash),
          bool(finding.blocking),
          str(finding.severity),
          finding.expected === undefined
            ? ABSENT
            : list([
                str(finding.expected.amount),
                optional(finding.expected.unit),
                optional(finding.expected.currency),
              ]),
          finding.observed === undefined
            ? ABSENT
            : list([
                str(finding.observed.amount),
                optional(finding.observed.unit),
                optional(finding.observed.currency),
              ]),
          optional(finding.methodology),
          optional(finding.correctionRequired),
        ]),
      ),
  )
}

/**
 * The exact bytes a Verification candidate's digest is taken over.
 *
 * Order is fixed here and nowhere else. An identical verdict produced against a
 * different revision or a different claim universe encodes differently, because
 * the basis sits inside the same rendering as the verdict — the property the
 * whole candidate model depends on.
 */
export function canonicalVerificationCandidateInput(
  runId: string,
  artifact: VerificationCandidateArtifact,
  basis: GovernanceCandidateBasis,
): string {
  return [
    int(VERIFICATION_CANDIDATE_CANONICALIZATION_VERSION),
    str(runId),
    ...canonicalBasis(basis),
    str(artifact.status),
    list([...artifact.claimsReviewed].sort(codeUnitOrder).map(str)),
    canonicalFindings(artifact.findings),
  ].join('')
}

/** The exact bytes a Devil's Advocate candidate's digest is taken over. */
export function canonicalDevilsAdvocateCandidateInput(
  runId: string,
  artifact: DevilsAdvocateCandidateArtifact,
  basis: GovernanceCandidateBasis,
): string {
  return [
    int(DEVILS_ADVOCATE_CANDIDATE_CANONICALIZATION_VERSION),
    str(runId),
    ...canonicalBasis(basis),
    canonicalChallenges(artifact.challenges),
  ].join('')
}

/** The exact bytes a peer examination candidate's digest is taken over. */
export function canonicalPeerExaminationCandidateInput(
  runId: string,
  artifact: PeerExaminationCandidateArtifact,
  basis: PeerExaminationCandidateBasis,
): string {
  return [
    int(PEER_EXAMINATION_CANDIDATE_CANONICALIZATION_VERSION),
    str(runId),
    ...canonicalBasis(basis),
    str(basis.examinedDepartmentId),
    canonicalChallenges(artifact.challenges),
  ].join('')
}

/* ------------------------------------------------------------- identities */

export function verificationCandidateContentHash(
  runId: string,
  artifact: VerificationCandidateArtifact,
  basis: GovernanceCandidateBasis,
): string {
  return sha256Hex(
    VERIFICATION_CANDIDATE_DOMAIN_SEPARATION +
      canonicalVerificationCandidateInput(runId, artifact, basis),
  )
}

export function devilsAdvocateCandidateContentHash(
  runId: string,
  artifact: DevilsAdvocateCandidateArtifact,
  basis: GovernanceCandidateBasis,
): string {
  return sha256Hex(
    DEVILS_ADVOCATE_CANDIDATE_DOMAIN_SEPARATION +
      canonicalDevilsAdvocateCandidateInput(runId, artifact, basis),
  )
}

export function peerExaminationCandidateContentHash(
  runId: string,
  artifact: PeerExaminationCandidateArtifact,
  basis: PeerExaminationCandidateBasis,
): string {
  return sha256Hex(
    PEER_EXAMINATION_CANDIDATE_DOMAIN_SEPARATION +
      canonicalPeerExaminationCandidateInput(runId, artifact, basis),
  )
}

/* --------------------------------------------------------------- building */

/** Shared basis coherence. A candidate with no institutional target is not one. */
function assertBasis(basis: GovernanceCandidateBasis, act: string): void {
  for (const [field, value] of [
    ['caseId', basis.caseId],
    ['thesisId', basis.thesisId],
    ['sourceRevisionId', basis.sourceRevisionId],
    ['playbookEntryKey', basis.playbookEntryKey],
  ] as const) {
    if (value.trim() === '') {
      throw new Error(
        `A ${act} candidate names no ${field}. Scrutiny that cannot say what ` +
          `it examined cannot be filed against anything.`,
      )
    }
  }
}

/**
 * Builds a Verification candidate and computes its identity in the same call.
 *
 * One construction path, so a stored candidate whose hash was computed over
 * something other than its own contents is not reachable.
 *
 * Findings are validated through `buildVerificationFinding` — the institutional
 * builder, not a copy — so a blocking finding that states no correction and a
 * hash-bearing finding that records no cited hash are refused here for exactly
 * the reasons they are refused at filing. A candidate the command would reject
 * is not worth storing.
 *
 * The two candidate-level coherence rules are named rather than assumed: a
 * verdict must review at least one claim, and a finding must concern a claim the
 * verdict says it reviewed. Both are stricter than the institutional command,
 * deliberately: a finding about an unreviewed claim is incoherent as produced
 * work, and refusing it at production costs nothing, while filing it would put
 * an unexplainable row in the record.
 */
export function buildVerificationCandidate(input: {
  runId: string
  artifact: VerificationCandidateArtifact
  basis: GovernanceCandidateBasis
  producedAt: string
}): ProducedVerificationReview {
  assertBasis(input.basis, 'verification')

  if (input.artifact.claimsReviewed.length === 0) {
    throw new Error(
      'A verification candidate reviews no claims. A verdict on nothing is a ' +
        'verdict the firm cannot read as having checked anything.',
    )
  }

  const reviewed = new Set(input.artifact.claimsReviewed)
  const observed = new Set(input.basis.observedClaimIds)
  for (const claimId of reviewed) {
    if (!observed.has(claimId)) {
      throw new Error(
        `A verification candidate reviews claim "${claimId}", which is not in ` +
          `the claim set it was produced against. Scrutiny of work outside the ` +
          `declared basis cannot be checked at filing.`,
      )
    }
  }
  const findings = input.artifact.findings.map((finding) => {
    if (!reviewed.has(finding.claimId)) {
      throw new Error(
        `A verification candidate reports a finding on claim ` +
          `"${finding.claimId}" without listing it as reviewed. A finding on a ` +
          `claim nobody checked is not a finding.`,
      )
    }
    return buildVerificationFinding(finding)
  })

  const artifact: VerificationCandidateArtifact = Object.freeze({
    status: input.artifact.status,
    findings: Object.freeze(findings),
    claimsReviewed: Object.freeze([...input.artifact.claimsReviewed]),
  })
  const basis = Object.freeze({
    ...input.basis,
    observedClaimIds: Object.freeze([...input.basis.observedClaimIds]),
  })

  return Object.freeze({
    runId: input.runId,
    caseId: basis.caseId,
    artifact,
    basis,
    contentHash: verificationCandidateContentHash(input.runId, artifact, basis),
    canonicalizationVersion: String(VERIFICATION_CANDIDATE_CANONICALIZATION_VERSION),
    producedAt: input.producedAt,
  })
}

/**
 * Validates proposed objections against the basis they were produced over.
 *
 * `buildChallenge` is the institutional builder and does the arguing about what
 * makes an objection an objection — counter-evidence, or a reasoning kind that
 * states what would settle it. It needs the three derived members to run, so a
 * placeholder identity is supplied for validation only and never stored: what is
 * kept is the proposal.
 */
function validateProposedChallenges(
  challenges: readonly ProposedChallenge[],
  basis: GovernanceCandidateBasis,
  act: string,
  challengerKind: Challenge['challengerKind'],
): readonly ProposedChallenge[] {
  const observed = new Set(basis.observedClaimIds)
  return Object.freeze(
    challenges.map((challenge, index) => {
      if (!observed.has(challenge.contests)) {
        throw new Error(
          `A ${act} candidate contests claim "${challenge.contests}", which is ` +
            `not in the claim set it was produced against. An objection to work ` +
            `outside the declared basis cannot be checked at filing.`,
        )
      }
      if (
        challenge.contestsThesis !== undefined &&
        challenge.contestsThesis !== basis.thesisId
      ) {
        throw new Error(
          `A ${act} candidate contests thesis "${challenge.contestsThesis}", ` +
            `which is not the lineage it was produced against ` +
            `("${basis.thesisId}").`,
        )
      }
      /*
       * Validated, not adopted. The identity and mandate are the filing
       * principal's to supply, and the proposal is what gets frozen below.
       */
      buildChallenge({
        ...challenge,
        id: `candidate-${index}`,
        challengerKind,
        byDepartmentId: 'candidate',
      })
      return Object.freeze({
        ...challenge,
        counterEvidence: Object.freeze([...challenge.counterEvidence]),
      })
    }),
  )
}

/**
 * Builds a Devil's Advocate candidate and computes its identity.
 *
 * **An empty filing is refused.** The Devil's Advocate must object; the
 * institutional command already refuses a submission with no challenges, and a
 * candidate that could not be filed is not a candidate. This is the one
 * invariant that separates this contract from the peer one.
 */
export function buildDevilsAdvocateCandidate(input: {
  runId: string
  artifact: DevilsAdvocateCandidateArtifact
  basis: GovernanceCandidateBasis
  producedAt: string
}): ProducedDevilsAdvocateReview {
  assertBasis(input.basis, "devil's advocate")

  if (input.artifact.challenges.length === 0) {
    throw new Error(
      "A devil's advocate candidate raises no objection. The Devil's Advocate " +
        'must object: a filing with nothing in it is the control not being ' +
        'performed, recorded as though it had been.',
    )
  }

  const artifact: DevilsAdvocateCandidateArtifact = Object.freeze({
    challenges: validateProposedChallenges(
      input.artifact.challenges,
      input.basis,
      "devil's advocate",
      'devils-advocate',
    ),
  })
  const basis = Object.freeze({
    ...input.basis,
    observedClaimIds: Object.freeze([...input.basis.observedClaimIds]),
  })

  return Object.freeze({
    runId: input.runId,
    caseId: basis.caseId,
    artifact,
    basis,
    contentHash: devilsAdvocateCandidateContentHash(input.runId, artifact, basis),
    canonicalizationVersion: String(DEVILS_ADVOCATE_CANDIDATE_CANONICALIZATION_VERSION),
    producedAt: input.producedAt,
  })
}

/**
 * Builds a peer examination candidate and computes its identity.
 *
 * **Zero objections is valid.** A peer that looked and agreed performed the
 * scrutiny, and that is not the same fact as an examination that never happened
 * — which is why the gate reads existence rather than emptiness. A peer may not
 * examine its own desk: that rule lives on the institutional command, which
 * knows who is filing; here the basis merely has to say whose work was read.
 */
export function buildPeerExaminationCandidate(input: {
  runId: string
  artifact: PeerExaminationCandidateArtifact
  basis: PeerExaminationCandidateBasis
  producedAt: string
}): ProducedPeerExamination {
  assertBasis(input.basis, 'peer examination')

  if (input.basis.examinedDepartmentId.trim() === '') {
    throw new Error(
      'A peer examination candidate names no examined department. An ' +
        'examination of nobody cannot be filed as scrutiny of anybody.',
    )
  }

  const artifact: PeerExaminationCandidateArtifact = Object.freeze({
    challenges: validateProposedChallenges(
      input.artifact.challenges,
      input.basis,
      'peer examination',
      'peer',
    ),
  })
  const basis = Object.freeze({
    ...input.basis,
    observedClaimIds: Object.freeze([...input.basis.observedClaimIds]),
  })

  return Object.freeze({
    runId: input.runId,
    caseId: basis.caseId,
    artifact,
    basis,
    contentHash: peerExaminationCandidateContentHash(input.runId, artifact, basis),
    canonicalizationVersion: String(PEER_EXAMINATION_CANDIDATE_CANONICALIZATION_VERSION),
    producedAt: input.producedAt,
  })
}

/* ------------------------------------------------------------- attestation */

/*
 * Corruption-evident, not tamper-proof — the same limitation the eligibility
 * basis manifest and the synthesis candidate carry, and for the same reason:
 * nothing stored beside the data survives an informed writer who updates both.
 * It catches the writer that did not.
 */

export function verificationCandidateHashMatches(
  candidate: ProducedVerificationReview,
): boolean {
  if (
    candidate.canonicalizationVersion !==
    String(VERIFICATION_CANDIDATE_CANONICALIZATION_VERSION)
  ) {
    return false
  }
  return (
    candidate.contentHash ===
    verificationCandidateContentHash(candidate.runId, candidate.artifact, candidate.basis)
  )
}

export function devilsAdvocateCandidateHashMatches(
  candidate: ProducedDevilsAdvocateReview,
): boolean {
  if (
    candidate.canonicalizationVersion !==
    String(DEVILS_ADVOCATE_CANDIDATE_CANONICALIZATION_VERSION)
  ) {
    return false
  }
  return (
    candidate.contentHash ===
    devilsAdvocateCandidateContentHash(
      candidate.runId,
      candidate.artifact,
      candidate.basis,
    )
  )
}

export function peerExaminationCandidateHashMatches(
  candidate: ProducedPeerExamination,
): boolean {
  if (
    candidate.canonicalizationVersion !==
    String(PEER_EXAMINATION_CANDIDATE_CANONICALIZATION_VERSION)
  ) {
    return false
  }
  return (
    candidate.contentHash ===
    peerExaminationCandidateContentHash(
      candidate.runId,
      candidate.artifact,
      candidate.basis,
    )
  )
}

/* --------------------------------------------------------- stale detection */

/**
 * Why a candidate may not be filed against the state the firm is now in.
 *
 * Named rather than boolean, because "this cannot be filed" and "this cannot be
 * filed BECAUSE the work under review changed" are different things to put in
 * front of whoever is accountable.
 */
export type CandidateStaleness =
  /** The revision the scrutiny examined is no longer the current one. */
  | 'revision-superseded'
  /** The claim universe moved: work was accepted or withdrawn since. */
  | 'claim-set-changed'
  /** The stored digest does not attest the stored contents. */
  | 'content-hash-mismatch'
  /** The candidate was produced under a canonicalization this build cannot read. */
  | 'unknown-canonicalization'

/**
 * Whether a candidate's declared basis still matches the institution.
 *
 * The stale check the filing commands must perform, expressed once so three
 * commands cannot disagree about what stale means. It compares durable
 * identities and set membership — never timestamps, because prose produced an
 * hour ago against unchanged work is fine and prose produced a second ago
 * against changed work is not.
 *
 * Returns every reason that applies rather than the first, so a caller reports
 * what actually happened instead of whichever check ran first.
 */
export function candidateStaleness(input: {
  basis: GovernanceCandidateBasis
  hashMatches: boolean
  knownCanonicalization: boolean
  /** The revision that is current NOW, recomputed at filing. */
  currentRevisionId: string
  /** The claim universe NOW, recomputed at filing. */
  currentClaimIds: readonly string[]
}): readonly CandidateStaleness[] {
  const reasons: CandidateStaleness[] = []
  if (!input.knownCanonicalization) reasons.push('unknown-canonicalization')
  if (!input.hashMatches) reasons.push('content-hash-mismatch')
  if (input.basis.sourceRevisionId !== input.currentRevisionId) {
    reasons.push('revision-superseded')
  }
  const declared = [...input.basis.observedClaimIds].sort(codeUnitOrder)
  const current = [...input.currentClaimIds].sort(codeUnitOrder)
  if (
    declared.length !== current.length ||
    declared.some((claimId, index) => claimId !== current[index])
  ) {
    reasons.push('claim-set-changed')
  }
  return Object.freeze(reasons)
}
